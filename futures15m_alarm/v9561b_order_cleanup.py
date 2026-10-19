from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN=APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists(): raise SystemExit('v9.5.61b MainActivity missing')


def bounds(src,fragment):
    a=src.find(fragment)
    if a<0:return None
    b=src.find('{',a)
    if b<0:return None
    d=1;i=b+1;qs=qc=esc=lc=bc=False
    while i<len(src) and d:
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if lc:
            if c=='\n':lc=False
        elif bc:
            if c=='*' and n=='/':bc=False;i+=1
        elif qs:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':qs=False
        elif qc:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":qc=False
        else:
            if c=='/' and n=='/':lc=True;i+=1
            elif c=='/' and n=='*':bc=True;i+=1
            elif c=='"':qs=True
            elif c=="'":qc=True
            elif c=='{':d+=1
            elif c=='}':d-=1
        i+=1
    return None if d else (a,b,i)

s=MAIN.read_text()

# Run the reconciliation next to the already existing foreground account sync.
b=bounds(s,'    private final Runnable v9543LiveAccountPoll')
if not b: raise SystemExit('v9.5.61b live poll missing')
a,_,e=b
x=s[a:e]
if 'V9561_MANAGED_ORDER_CLEANUP_POLL' not in x:
    q='v9527RequestAccountSync(false);'
    if q not in x: raise SystemExit('v9.5.61b poll call missing')
    x=x.replace(q,q+'\n                // V9561_MANAGED_ORDER_CLEANUP_POLL\n                v9561ScheduleManagedCleanup();',1)
    s=s[:a]+x+s[e:]

b=bounds(s,'    private void v9543StartLiveAccountSync()')
if not b: raise SystemExit('v9.5.61b resume sync missing')
a,_,e=b
x=s[a:e]
if 'V9561_MANAGED_ORDER_CLEANUP_RESUME' not in x:
    q='v9527RequestAccountSync(true);'
    if q not in x: raise SystemExit('v9.5.61b resume call missing')
    x=x.replace(q,q+'\n        // V9561_MANAGED_ORDER_CLEANUP_RESUME\n        v9561ScheduleManagedCleanup();',1)
    s=s[:a]+x+s[e:]

if 'V9561_MANAGED_PROTECTIVE_ORDER_CLEANUP' not in s:
    pos=s.rfind('}')
    if pos<0: raise SystemExit('v9.5.61b Main close missing')
    helper=r'''

    // ============================================================
    // V9561_MANAGED_PROTECTIVE_ORDER_CLEANUP
    // A Binance position may close at STOP while its reduce-only TP algo orders
    // remain open. Cancel only orders that can be proven to match this app's
    // exact symbol + exit side + persisted STOP/TP trigger levels.
    // ============================================================
    private final java.util.concurrent.ExecutorService v9561CleanupIo =
            java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.HashMap<String,Long> v9561CleanupAttempt = new java.util.HashMap<>();
    private volatile boolean v9561CleanupBusy=false;

    private String v9561NormSymbol(String raw) {
        if(raw==null)return "";
        String x=raw.trim().toUpperCase(java.util.Locale.US).replaceAll("[^A-Z0-9]","");
        if(!x.endsWith("USDT") || x.length()<5 || x.length()>28)return "";
        return x;
    }
    private boolean v9561SameSymbol(String a,String b) {
        String x=v9561NormSymbol(a),y=v9561NormSymbol(b);
        return !x.isEmpty() && x.equals(y);
    }
    private double v9561PrefDouble(android.content.SharedPreferences sp,String k) {
        try{return Double.parseDouble(sp.getString(k,"NaN"));}catch(Throwable ignored){return Double.NaN;}
    }
    private boolean v9561Bool(Object x) {
        if(x instanceof Boolean)return (Boolean)x;
        String q=x==null?"":String.valueOf(x).trim();
        return "true".equalsIgnoreCase(q)||"1".equals(q);
    }
    private boolean v9561Near(double a,double b) {
        if(Double.isNaN(a)||Double.isNaN(b)||a<=0||b<=0)return false;
        return Math.abs(a-b)<=Math.max(1e-12,Math.abs(b)*0.00035);
    }
    private boolean v9561ProtectedLevel(android.content.SharedPreferences sp,String sym,double p) {
        return v9561Near(p,v9561PrefDouble(sp,"v9518_signal_stop_"+sym))
                ||v9561Near(p,v9561PrefDouble(sp,"v9518_signal_tp1_"+sym))
                ||v9561Near(p,v9561PrefDouble(sp,"v9518_signal_tp2_"+sym))
                ||v9561Near(p,v9561PrefDouble(sp,"v9518_signal_tp3_"+sym));
    }
    private boolean v9561PositionFlat(String sym) throws Exception {
        java.util.LinkedHashMap<String,String> p=new java.util.LinkedHashMap<>();p.put("symbol",sym);
        org.json.JSONArray a=new org.json.JSONArray(v9522Http("GET","/fapi/v2/positionRisk",p,true));
        boolean saw=false;
        for(int i=0;i<a.length();i++){
            org.json.JSONObject o=a.optJSONObject(i);if(o==null||!v9561SameSymbol(sym,o.optString("symbol","")))continue;
            saw=true;double q=0;try{q=Math.abs(Double.parseDouble(o.optString("positionAmt","0")));}catch(Throwable ignored){}
            if(q>1e-12)return false;
        }
        return saw;
    }
    private org.json.JSONArray v9561OpenAlgo(String sym) throws Exception {
        java.util.LinkedHashMap<String,String> p=new java.util.LinkedHashMap<>();p.put("symbol",sym);
        return new org.json.JSONArray(v9522Http("GET","/fapi/v1/openAlgoOrders",p,true));
    }
    private boolean v9561ManagedAlgo(android.content.SharedPreferences sp,String sym,String signalSide,org.json.JSONObject o) {
        if(o==null||!v9561SameSymbol(sym,o.optString("symbol","")))return false;
        String exit="SHORT".equalsIgnoreCase(signalSide)?"BUY":"SELL";
        if(!exit.equalsIgnoreCase(o.optString("side","")))return false;
        String type=o.optString("orderType",o.optString("type","")).toUpperCase(java.util.Locale.US);
        if(!"STOP_MARKET".equals(type)&&!"TAKE_PROFIT_MARKET".equals(type))return false;
        if(!(v9561Bool(o.opt("reduceOnly"))||v9561Bool(o.opt("closePosition"))))return false;
        double trig=Double.NaN;try{trig=Double.parseDouble(o.optString("triggerPrice",o.optString("stopPrice","NaN")));}catch(Throwable ignored){}
        return v9561ProtectedLevel(sp,sym,trig);
    }
    private void v9561StoreIncomeNet(android.content.SharedPreferences sp,String sym,long signalTs) {
        if(sp.getLong("v9561_income_signal_"+sym,-1L)==signalTs)return;
        try{
            long sig=sp.getLong("v9518_signal_time_"+sym,signalTs);
            long opened=sp.getLong("v9550_trade_open_ts_"+sym,0L);
            long st=Math.max(0L,Math.max(sig,opened>0?opened:sig)-90000L);
            long ended=sp.getLong("v9518_signal_end_"+sym,0L);
            long en=ended>st?ended+120000L:System.currentTimeMillis();
            java.util.LinkedHashMap<String,String> p=new java.util.LinkedHashMap<>();
            p.put("symbol",sym);p.put("startTime",Long.toString(st));p.put("endTime",Long.toString(en));p.put("limit","1000");
            org.json.JSONArray a=new org.json.JSONArray(v9522Http("GET","/fapi/v1/income",p,true));
            double net=0;int n=0;long latest=ended;
            for(int i=0;i<a.length();i++){
                org.json.JSONObject o=a.optJSONObject(i);if(o==null||!v9561SameSymbol(sym,o.optString("symbol","")))continue;
                String type=o.optString("incomeType","").toUpperCase(java.util.Locale.US);
                if(!("REALIZED_PNL".equals(type)||"COMMISSION".equals(type)||"FUNDING_FEE".equals(type)))continue;
                if(!"USDT".equalsIgnoreCase(o.optString("asset","USDT")))continue;
                try{net+=Double.parseDouble(o.optString("income","0"));n++;}catch(Throwable ignored){}
                latest=Math.max(latest,o.optLong("time",0L));
            }
            if(n<=0)return;
            double margin=v9561PrefDouble(sp,"v9550_trade_margin_"+sym);
            double lev=v9561PrefDouble(sp,"v9550_trade_leverage_"+sym);
            String side=sp.getString("v9518_signal_side_"+sym,sp.getString("v9550_trade_side_"+sym,""));
            org.json.JSONObject row=new org.json.JSONObject();
            row.put("symbol",sym);row.put("side",side);row.put("status","KAPALI");row.put("pnl",net);
            row.put("time",latest>0?latest:System.currentTimeMillis());row.put("source","BINANCE_INCOME_NET");
            if(!Double.isNaN(margin)&&margin>0){row.put("margin",margin);row.put("roi",net/margin*100.0);}
            if(!Double.isNaN(lev)&&lev>0)row.put("leverage",lev);
            sp.edit().putString("v9561_real_trade_"+sym,row.toString()).putLong("v9561_income_signal_"+sym,signalTs).apply();
        }catch(Throwable ex){
            sp.edit().putString("v9561_cleanup_status_"+sym,"Binance net PnL bekliyor: "+ex.getClass().getSimpleName()).apply();
        }
    }
    private void v9561CleanupOne(android.content.SharedPreferences sp,String sym,long signalTs) {
        try{
            if(!v9561PositionFlat(sym))return;
            if(sp.getLong("v9561_cleanup_signal_"+sym,-1L)!=signalTs){
                String side=sp.getString("v9518_signal_side_"+sym,sp.getString("v9550_trade_side_"+sym,""));
                org.json.JSONArray a=v9561OpenAlgo(sym);int found=0,cancelled=0;
                for(int i=0;i<a.length();i++){
                    org.json.JSONObject o=a.optJSONObject(i);if(!v9561ManagedAlgo(sp,sym,side,o))continue;found++;
                    String id=o.optString("algoId","");if(id.isEmpty()&&o.opt("algoId")!=null)id=String.valueOf(o.opt("algoId"));
                    if(id.isEmpty())continue;
                    java.util.LinkedHashMap<String,String> cp=new java.util.LinkedHashMap<>();cp.put("algoId",id);
                    v9522Http("DELETE","/fapi/v1/algoOrder",cp,true);cancelled++;
                }
                org.json.JSONArray after=v9561OpenAlgo(sym);int left=0;
                for(int i=0;i<after.length();i++)if(v9561ManagedAlgo(sp,sym,side,after.optJSONObject(i)))left++;
                if(left==0)sp.edit().putLong("v9561_cleanup_signal_"+sym,signalTs)
                        .putString("v9561_cleanup_status_"+sym,found==0?"Koruma emri artığı yok":"Artık STOP/TP temizlendi: "+cancelled).apply();
            }
            v9561StoreIncomeNet(sp,sym,signalTs);
        }catch(Throwable ex){
            sp.edit().putString("v9561_cleanup_status_"+sym,"Koruma emri temizliği tekrar denenecek: "+ex.getMessage()).apply();
        }
    }
    private void v9561ScheduleManagedCleanup() {
        if(v9561CleanupBusy)return;v9561CleanupBusy=true;
        v9561CleanupIo.execute(() -> {try{
            android.content.SharedPreferences sp=v9522Prefs();java.util.Map<String,?> all=sp.getAll();
            final String pre="v9522_order_sent_signal_";long now=System.currentTimeMillis();
            for(java.util.Map.Entry<String,?> e:all.entrySet()){
                String k=e.getKey();if(k==null||!k.startsWith(pre))continue;
                String sym=v9561NormSymbol(k.substring(pre.length()));if(sym.isEmpty())continue;
                long ts=-1;Object vv=e.getValue();if(vv instanceof Number)ts=((Number)vv).longValue();
                else try{ts=Long.parseLong(String.valueOf(vv));}catch(Throwable ignored){}
                if(ts<=0)continue;Long last=v9561CleanupAttempt.get(sym);if(last!=null&&now-last<20000L)continue;
                v9561CleanupAttempt.put(sym,now);v9561CleanupOne(sp,sym,ts);
            }
        }catch(Throwable ignored){}finally{v9561CleanupBusy=false;}});
    }
'''
    s=s[:pos]+helper+'\n'+s[pos:]

MAIN.write_text(s)
out=MAIN.read_text()
checks={
 'poll':'V9561_MANAGED_ORDER_CLEANUP_POLL' in out,
 'resume':'V9561_MANAGED_ORDER_CLEANUP_RESUME' in out,
 'exact match':'v9561SameSymbol' in out,
 'flat first':'/fapi/v2/positionRisk' in out,
 'list algo':'/fapi/v1/openAlgoOrders' in out,
 'precise cancel':'"DELETE","/fapi/v1/algoOrder"' in out,
 'no cancel all':'/fapi/v1/algoOpenOrders' not in out[out.find('V9561_MANAGED_PROTECTIVE_ORDER_CLEANUP'):],
 'net pnl':'/fapi/v1/income' in out and 'BINANCE_INCOME_NET' in out,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.61b failed: '+', '.join(bad))
print('v9.5.61b OK: flat positions clean only app-matched protective algos; Binance income net reconciles recent real trade PnL.')
