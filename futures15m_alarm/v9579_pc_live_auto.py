from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
AUTO=JAVA/'AutoTradeEngine.java'
MAIN=JAVA/'MainActivity.java'
BUILD=APP/'app/build.gradle'
for p in (AUTO,MAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.79 missing '+str(p))

auto=AUTO.read_text()
if 'V9577_DRY_RUN_LOCK' not in auto:
    raise SystemExit('v9.5.79 requires v9.5.78 dry-run lock first')
start=auto.find('    // V9577_DRY_RUN_LOCK:')
end=auto.find('    private static void run(Context c,String s)',start)
if start<0 or end<0:
    raise SystemExit('v9.5.79 AutoTradeEngine dry-run anchor changed')

pc_bridge=r'''    // V9579_PC_LIVE_AUTO: phone never signs Binance orders; PC BrainHub owns the executor.
    public static void onSignal(Context c,String symbol){
        if(c==null||symbol==null||symbol.trim().isEmpty())return;
        Context app=c.getApplicationContext();String s=symbol.trim().toUpperCase(Locale.US);
        SharedPreferences p=app.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);
        if(!p.getBoolean("v9576_auto_enabled",false))return;
        if(!"PC".equals(p.getString("v9576_executor_owner","PC")))return;
        IO.execute(()->runPc(app,s));
    }

    private static void runPc(Context c,String s){
        SharedPreferences p=c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);long now=System.currentTimeMillis();
        try{
            if(!BrainHubClient.configured(c))throw new Exception("PC Brain Hub bağlı değil");
            if(!p.getBoolean("v9576_auto_enabled",false))return;
            if(!p.getBoolean("v9518_signal_active_"+s,false))throw new Exception("aktif sinyal yok");
            long ts=p.getLong("v9518_signal_time_"+s,0L),age=now-ts;
            if(ts<=0||age<0||age>120000L)throw new Exception("sinyal oto giriş için bayat (>2dk)");
            if(p.getLong("v9522_order_sent_signal_"+s,-1L)==ts)throw new Exception("bu sinyal daha önce PC yürütücüsüne gönderildi");
            if(p.getBoolean("v9522_order_inflight_"+s,false))throw new Exception("bu sembolde LIVE istek zaten işleniyor");
            long last=p.getLong("v9576_last_auto_"+s,0L);if(last>0&&now-last<5L*60L*1000L)throw new Exception("sembol cooldown 5dk");

            String side=p.getString("v9518_signal_side_"+s,"LONG");boolean lng="LONG".equalsIgnoreCase(side);
            if(!lng&&!"SHORT".equalsIgnoreCase(side))throw new Exception("sinyal yönü geçersiz");
            if(lng&&!p.getBoolean("v9576_auto_long",true))throw new Exception("LONG oto kapalı");
            if(!lng&&!p.getBoolean("v9576_auto_short",true))throw new Exception("SHORT oto kapalı");
            double entry=d(p,"v9518_signal_price_"+s),stop=d(p,"v9518_signal_stop_"+s);
            if(bad(entry)||bad(stop))throw new Exception("sinyal giriş/stop seviyesi eksik");
            if(lng&&!(stop<entry))throw new Exception("LONG stop geometrisi geçersiz");
            if(!lng&&!(stop>entry))throw new Exception("SHORT stop geometrisi geçersiz");

            double margin=Double.parseDouble(p.getString("v9576_auto_margin",p.getString("v9522_last_margin","0")));
            int configuredLev=Integer.parseInt(p.getString("v9576_auto_leverage",p.getString("v9522_last_leverage","0")));
            if(!(margin>0)||configuredLev<1||configuredLev>125)throw new Exception("oto marj/kaldıraç ayarı geçersiz");

            JSONObject liveStatus=BrainHubClient.liveStatus(c);
            if(!liveStatus.optBoolean("liveConfigured")||!liveStatus.optBoolean("armed"))throw new Exception("PC LIVE arm kapalı");
            JSONObject policy=liveStatus.optJSONObject("policy");
            int policyLev=policy==null?0:policy.optInt("expectedLeverage",0);
            if(policyLev<1||policyLev>125)throw new Exception("PC LIVE kaldıraç policy eksik");
            if(configuredLev!=policyLev)throw new Exception("telefon kaldıraç "+configuredLev+"x, PC policy "+policyLev+"x; eşitleyin");

            p.edit().putBoolean("v9522_order_inflight_"+s,true).apply();

            // Public Binance data only: no API key/secret and no signed order from Android.
            double live=new JSONObject(http(c,"GET","/fapi/v1/ticker/price",map("symbol",s),false)).getDouble("price");
            if(bad(live))throw new Exception("canlı fiyat alınamadı");
            JSONObject si=symbolInfo(c,s);JSONObject lot=filter(si,"MARKET_LOT_SIZE");if(lot==null)lot=filter(si,"LOT_SIZE");
            if(lot==null)throw new Exception("MARKET_LOT_SIZE/LOT_SIZE filtresi yok");
            double step=lot.optDouble("stepSize",0),min=lot.optDouble("minQty",0),max=lot.optDouble("maxQty",Double.POSITIVE_INFINITY);
            if(!(step>0)||!(min>=0)||!(max>0))throw new Exception("lot filtresi geçersiz");
            double qty=floor(margin*policyLev/live,step);
            if(!(qty>0)||qty<min||qty>max)throw new Exception("hesaplanan miktar Binance lot sınırı dışında");

            String tsText=Long.toString(ts),tail=tsText.substring(Math.max(0,tsText.length()-10));
            String hash=Integer.toHexString(s.hashCode());
            String clientId="F15P"+tail+hash;
            if(clientId.length()>36)clientId=clientId.substring(0,36);
            String lineage="SIG:"+s+":"+tsText;
            String eventId="ANDROID:"+s+":"+tsText;

            JSONObject order=new JSONObject();
            order.put("action","OPEN");order.put("symbol",s);order.put("side",lng?"LONG":"SHORT");order.put("orderType","MARKET");
            order.put("quantity",qty);order.put("entryPrice",entry);order.put("stopPrice",stop);order.put("clientOrderId",clientId);order.put("lineageId",lineage);
            JSONObject body=new JSONObject();body.put("eventId",eventId);body.put("order",order);
            // Existing deterministic signal stores one structural stop boundary; no separate buffer field exists on mobile yet.
            body.put("structuralInvalidationPrice",stop);body.put("bufferQuote",0.0);body.put("initialStopPrice",stop);

            JSONObject out=BrainHubClient.liveExecute(c,body);
            boolean protectedEntry=out.optBoolean("ok",false)&&out.optBoolean("orderPlaced",false)&&out.optBoolean("stopProtected",false);
            boolean uncertain=out.optBoolean("manualReviewRequired",false)||"LIVE_ENTRY_REVIEW_REQUIRED".equals(out.optString("execution"));
            if(protectedEntry){
                p.edit().putLong("v9522_order_sent_signal_"+s,ts).putLong("v9576_last_auto_"+s,now).apply();
                String msg="PC LIVE KORUMALI GİRİŞ • "+s+" "+side+" • "+fmt(margin)+" USDT • "+policyLev+"x";
                status(p,s,msg);BrainLearning.recordExecution(c,s,msg);return;
            }
            if(uncertain){
                // Never retry an uncertain submit automatically; Binance may have received it.
                p.edit().putLong("v9522_order_sent_signal_"+s,ts).putLong("v9576_last_auto_"+s,now).apply();
            }
            String reason="";org.json.JSONArray rs=out.optJSONArray("reasons");if(rs!=null&&rs.length()>0)reason=rs.optString(0,"");
            if(reason.isEmpty())reason=out.optString("execution","LIVE_BLOCKED");
            throw new Exception((uncertain?"MANUEL KONTROL GEREKİR • ":"")+reason);
        }catch(Throwable e){
            String msg="PC LIVE RED/HATA • "+s+" • "+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());
            status(p,s,msg);BrainLearning.recordExecution(c,s,msg);
        }finally{
            p.edit().putBoolean("v9522_order_inflight_"+s,false).putLong("v9576_executor_lease_until",0L).apply();
        }
    }

'''
auto=auto[:start]+pc_bridge+auto[end:]
AUTO.write_text(auto)

main=MAIN.read_text()
repls=[
    ('boolean v9576On=false;','boolean v9576On=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE).getBoolean("v9576_auto_enabled",false);'),
    ('en.setChecked(false);en.setEnabled(false);en.setText("Canlı otomatik emir testler bitene kadar kilitli");','en.setChecked(sp.getBoolean("v9576_auto_enabled",false));en.setEnabled(BrainHubClient.configured(this));en.setText("PC LIVE oto yürütücü (PC arm ayrıca gerekli)");'),
    ('if(en.isChecked())v9522Credentials(); // encrypted key/secret must exist before LIVE AUTO can be enabled','if(en.isChecked()&&!BrainHubClient.configured(this))throw new Exception("Önce PC Brain Hub bağlantısını ayarlayın");'),
    ('.putBoolean("v9576_auto_enabled",false)','.putBoolean("v9576_auto_enabled",en.isChecked())'),
    ('.putString("v9576_executor_owner","PHONE")','.putString("v9576_executor_owner","PC")'),
    ('"DRY-RUN: AÇIK"','"PC LIVE: "+(v9576On?"OTO AÇIK":"KAPALI")')
]
for old,new in repls:
    if old not in main: raise SystemExit('v9.5.79 MainActivity anchor missing: '+old[:70])
    main=main.replace(old,new,1)
MAIN.write_text(main)

build=BUILD.read_text()
build=re.sub(r'versionCode\s+\d+','versionCode 26091719',build,count=1)
build=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.79'",build,count=1)
BUILD.write_text(build)

checks={
    'PC signal executor':'V9579_PC_LIVE_AUTO' in AUTO.read_text() and 'BrainHubClient.liveExecute(c,body)' in AUTO.read_text(),
    'old live run unreachable':'IO.execute(()->run(app,s))' not in AUTO.read_text(),
    'no signed Binance order in PC path':'runPc(app,s)' in AUTO.read_text(),
    'PC executor owner':'putString("v9576_executor_owner","PC")' in MAIN.read_text(),
    'phone live toggle enabled only with BrainHub':'en.setEnabled(BrainHubClient.configured(this))' in MAIN.read_text(),
    'phone credentials not required for auto':'if(en.isChecked())v9522Credentials()' not in MAIN.read_text(),
    'identity':"versionName '9.5.79'" in BUILD.read_text() and 'versionCode 26091719' in BUILD.read_text(),
}
for name,ok in checks.items(): print(('OK   ' if ok else 'FAIL '),name)
if not all(checks.values()): raise SystemExit('v9.5.79 PC LIVE bridge integration check failed')
print('v9.5.79 OK: deterministic mobile signals can request PC LIVE execution; Android does not sign Binance orders and PC arm/gates remain mandatory.')
