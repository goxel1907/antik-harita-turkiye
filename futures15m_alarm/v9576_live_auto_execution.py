from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java';MON=JAVA/'MonitorService.java';ANA=JAVA/'AnalysisPackActivity.java';AGENT=JAVA/'TradeAgentActivity.java';BRAIN=JAVA/'BrainCore.java';LEARN=JAVA/'BrainLearning.java';AUTO=JAVA/'AutoTradeEngine.java';BUILD=APP/'app/build.gradle'
for p in (MAIN,MON,ANA,AGENT,BRAIN,LEARN,BUILD):
    if not p.exists():raise SystemExit('v9.5.76 missing '+str(p))

main=MAIN.read_text();mon=MON.read_text();ana=ANA.read_text();agent=AGENT.read_text();brain=BRAIN.read_text();learn=LEARN.read_text();bf=BUILD.read_text()
if 'V9575_BRAIN_LEARNING_MEMORY' not in learn or 'V9575_MULTI_FREE_HEALTH_POOL' not in agent:raise SystemExit('v9.5.76 requires v9.5.75')
if 'V9522_API_ORDER' not in main or 'AndroidKeyStore' not in main:raise SystemExit('v9.5.76 requires existing encrypted Binance order engine')
if 'V9543C_QUICK_SETTINGS_BUTTON' not in main:raise SystemExit('v9.5.76 quick settings prerequisite missing')

# Visible live-auto settings button. AUTO stays OFF until the user explicitly enables it.
anchor='        root.addView(v9543cQuickCfg,v9543cLp);'
if anchor not in main:raise SystemExit('v9.5.76 quick button anchor missing')
ui=r'''

        // V9576_LIVE_AUTO_SETTINGS_BUTTON
        boolean v9576On=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE).getBoolean("v9576_auto_enabled",false);
        Button v9576Auto=button("🤖 OTO İŞLEM / BEYİN\n"+(v9576On?"CANLI OTO: AÇIK":"CANLI OTO: KAPALI")+" • marj / kaldıraç / max pozisyon",v9576On?Color.rgb(22,101,52):Color.rgb(71,85,105));
        v9576Auto.setOnClickListener(v -> v9576ShowAutoSettings());
        LinearLayout.LayoutParams v9576Lp=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(68));
        v9576Lp.setMargins(0,0,0,dp(18));root.addView(v9576Auto,v9576Lp);'''
main=main.replace(anchor,anchor+ui,1)

if 'private void v9576ShowAutoSettings()' not in main:
    pos=main.rfind('}')
    if pos<0:raise SystemExit('v9.5.76 MainActivity closing brace missing')
    helper=r'''

    // V9576_LIVE_AUTO_SETTINGS
    private void v9576ShowAutoSettings(){
        android.content.SharedPreferences sp=v9522Prefs();
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(16),dp(8),dp(16),dp(4));
        TextView info=text("CANLI OTO mod yalnız uygulamanın deterministik, aktif ve taze sinyallerini işler. AI tek başına emir gönderemez. STOP kurulamazsa pozisyonu acil piyasa emriyle kapatma denenir. PC yürütücüsü eklendiğinde tek lider kilidi kullanılacaktır.\n\nÖĞRENİM: "+BrainLearning.summary(this),11.5f,Color.rgb(203,213,225),false);box.addView(info);
        EditText mg=v9522Input("Oto marj / işlem (USDT)",false),lv=v9522Input("Oto kaldıraç (1-125)",false),mx=v9522Input("Maksimum eşzamanlı pozisyon (1-5)",false);
        mg.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);lv.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);mx.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        mg.setText(sp.getString("v9576_auto_margin",sp.getString("v9522_last_margin","")));lv.setText(sp.getString("v9576_auto_leverage",sp.getString("v9522_last_leverage","")));mx.setText(Integer.toString(sp.getInt("v9576_auto_max_positions",1)));
        LinearLayout.LayoutParams ep=new LinearLayout.LayoutParams(-1,dp(50));ep.setMargins(0,dp(8),0,0);box.addView(mg,ep);box.addView(lv,ep);box.addView(mx,ep);
        android.widget.CheckBox lng=new android.widget.CheckBox(this),sht=new android.widget.CheckBox(this),en=new android.widget.CheckBox(this);
        lng.setText("LONG otomatik işlemlere izin ver");sht.setText("SHORT otomatik işlemlere izin ver");en.setText("⚠ CANLI OTO EMİRİ ETKİNLEŞTİR");
        for(android.widget.CheckBox c:new android.widget.CheckBox[]{lng,sht,en}){c.setTextColor(Color.WHITE);box.addView(c);}
        lng.setChecked(sp.getBoolean("v9576_auto_long",true));sht.setChecked(sp.getBoolean("v9576_auto_short",true));en.setChecked(sp.getBoolean("v9576_auto_enabled",false));
        String last=sp.getString("v9576_auto_last_status","Henüz oto işlem yok.");TextView st=text("SON DURUM: "+last,11.5f,Color.rgb(147,197,253),false);st.setPadding(0,dp(8),0,0);box.addView(st);
        android.app.AlertDialog dlg=new android.app.AlertDialog.Builder(this).setTitle("🤖 CANLI OTO İŞLEM / BEYİN").setView(box).setNegativeButton("KAPAT",null).setNeutralButton("ACİL DURDUR",null).setPositiveButton("KAYDET",null).create();
        dlg.setOnShowListener(x->{
            dlg.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->{sp.edit().putBoolean("v9576_auto_enabled",false).apply();en.setChecked(false);st.setText("SON DURUM: ACİL DURDUR • yeni oto girişler kapalı");Toast.makeText(this,"CANLI OTO yeni girişleri durduruldu. Açık Binance pozisyonları otomatik kapatılmadı.",Toast.LENGTH_LONG).show();});
            dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
                try{
                    double margin=Double.parseDouble(mg.getText().toString().trim());int lev=Integer.parseInt(lv.getText().toString().trim()),max=Integer.parseInt(mx.getText().toString().trim());
                    if(!(margin>0)||lev<1||lev>125||max<1||max>5)throw new Exception("Marj >0, kaldıraç 1-125, max pozisyon 1-5 olmalı.");
                    if(!lng.isChecked()&&!sht.isChecked())throw new Exception("LONG veya SHORT yönlerinden en az biri açık olmalı.");
                    if(en.isChecked())v9522Credentials(); // encrypted key/secret must exist before LIVE AUTO can be enabled
                    sp.edit().putString("v9576_auto_margin",v9522P(margin)).putString("v9576_auto_leverage",Integer.toString(lev)).putInt("v9576_auto_max_positions",max)
                      .putBoolean("v9576_auto_long",lng.isChecked()).putBoolean("v9576_auto_short",sht.isChecked()).putBoolean("v9576_auto_enabled",en.isChecked())
                      .putString("v9576_executor_owner","PHONE").apply();
                    Toast.makeText(this,"Oto işlem ayarı kaydedildi • "+(en.isChecked()?"CANLI AÇIK":"KAPALI"),Toast.LENGTH_LONG).show();dlg.dismiss();
                }catch(Throwable ex){Toast.makeText(this,"Ayar kaydedilmedi: "+ex.getMessage(),Toast.LENGTH_LONG).show();}
            });
        });dlg.show();
    }
'''
    main=main[:pos]+helper+'\n'+main[pos:]

# Trigger unattended execution only after the existing deterministic signal record has been committed.
needle='        BrainLearning.recordSignal(this, symbol);'
if needle not in mon:raise SystemExit('v9.5.76 learning signal hook missing')
mon=mon.replace(needle,needle+'\n        AutoTradeEngine.onSignal(this, symbol);',1)

# Standalone service-safe engine using the same encrypted API material and order semantics as the existing manual engine.
auto_java=r'''package com.futuresalarm.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// V9576_GUARDED_LIVE_AUTO_EXECUTION
// Executes ONLY deterministic app signals after explicit user opt-in. LLM output is not an order trigger.
public final class AutoTradeEngine {
    private static final String BASE="https://fapi.binance.com";
    private static final String ALIAS="futures_alarm_binance_api_v1";
    private static final ExecutorService IO=Executors.newSingleThreadExecutor();
    private static volatile long offset=0L;
    private AutoTradeEngine(){}

    public static void onSignal(Context c,String symbol){
        if(c==null||symbol==null||symbol.trim().isEmpty())return;
        Context app=c.getApplicationContext();String s=symbol.trim().toUpperCase(Locale.US);
        SharedPreferences p=app.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);
        if(!p.getBoolean("v9576_auto_enabled",false))return;
        if(!"PHONE".equals(p.getString("v9576_executor_owner","PHONE")))return;
        IO.execute(()->run(app,s));
    }

    private static void run(Context c,String s){SharedPreferences p=c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);long now=System.currentTimeMillis();
        try{
            if(!p.getBoolean("v9576_auto_enabled",false))return;
            if(!p.getBoolean("v9518_signal_active_"+s,false))throw new Exception("aktif sinyal yok");
            long ts=p.getLong("v9518_signal_time_"+s,0L),age=now-ts;if(ts<=0||age<0||age>120000L)throw new Exception("sinyal oto giriş için bayat (>2dk)");
            if(p.getLong("v9522_order_sent_signal_"+s,-1L)==ts)throw new Exception("bu sinyal daha önce gönderildi");
            if(p.getBoolean("v9522_order_inflight_"+s,false))throw new Exception("bu sembolde emir zaten gönderiliyor");
            long last=p.getLong("v9576_last_auto_"+s,0L);if(last>0&&now-last<5L*60L*1000L)throw new Exception("sembol cooldown 5dk");
            String side=p.getString("v9518_signal_side_"+s,"LONG");boolean lng="LONG".equalsIgnoreCase(side);
            if(lng&&!p.getBoolean("v9576_auto_long",true))throw new Exception("LONG oto kapalı");if(!lng&&!p.getBoolean("v9576_auto_short",true))throw new Exception("SHORT oto kapalı");
            double entry=d(p,"v9518_signal_price_"+s),stop=d(p,"v9518_signal_stop_"+s),t1=d(p,"v9518_signal_tp1_"+s),t2=d(p,"v9518_signal_tp2_"+s),t3=d(p,"v9518_signal_tp3_"+s);
            if(bad(entry)||bad(stop)||bad(t1)||bad(t2)||bad(t3))throw new Exception("sinyal giriş/stop/tp seviyeleri eksik");
            if(lng&&!(stop<entry&&entry<t1&&t1<t2&&t2<t3))throw new Exception("LONG geometri geçersiz");if(!lng&&!(stop>entry&&entry>t1&&t1>t2&&t2>t3))throw new Exception("SHORT geometri geçersiz");
            double margin=Double.parseDouble(p.getString("v9576_auto_margin",p.getString("v9522_last_margin","0")));int lev=Integer.parseInt(p.getString("v9576_auto_leverage",p.getString("v9522_last_leverage","0"))),max=p.getInt("v9576_auto_max_positions",1);
            if(!(margin>0)||lev<1||lev>125||max<1||max>5)throw new Exception("oto marj/kaldıraç/max ayarı geçersiz");
            p.edit().putBoolean("v9522_order_inflight_"+s,true).putLong("v9576_executor_lease_until",now+90000L).apply();
            sync();JSONObject acct=new JSONObject(http(c,"GET","/fapi/v2/account",null,true));
            if(open(acct,s))throw new Exception("sembolde zaten açık Binance pozisyonu var");if(openCount(acct)>=max)throw new Exception("maksimum eşzamanlı pozisyon sınırı dolu");
            double live=new JSONObject(http(c,"GET","/fapi/v1/ticker/price",map("symbol",s),false)).getDouble("price"),dev=Math.abs(live-entry)/entry*100.0;if(dev>0.50)throw new Exception(String.format(Locale.US,"geç giriş %.2f%% > 0.50%%",dev));
            if((lng&&live<=stop)||(!lng&&live>=stop))throw new Exception("canlı fiyat stop/geçersizlik tarafında");
            JSONObject si=symbolInfo(c,s);JSONObject lot=filter(si,"LOT_SIZE");double step=lot==null?0.001:lot.optDouble("stepSize",0.001),min=lot==null?0:lot.optDouble("minQty",0);double qty=floor(margin*lev/live,step);if(qty<=0||qty<min)throw new Exception("hesaplanan miktar minQty altında");String qtyText=fmt(qty);
            boolean hedge=dual(c);String positionSide=lng?"LONG":"SHORT";
            http(c,"POST","/fapi/v1/leverage",map("symbol",s,"leverage",Integer.toString(lev)),true);
            LinkedHashMap<String,String> ep=base(s,lng?"BUY":"SELL",hedge,positionSide);ep.put("type","MARKET");ep.put("quantity",qtyText);ep.put("newOrderRespType","RESULT");ep.put("newClientOrderId","F15A"+Long.toString(ts).substring(Math.max(0,Long.toString(ts).length()-10)));
            JSONObject er=new JSONObject(http(c,"POST","/fapi/v1/order",ep,true));String exq=er.optString("executedQty",qtyText);double fq=qty;try{double q=Double.parseDouble(exq);if(q>0)fq=floor(q,step);}catch(Throwable ignored){}
            p.edit().putLong("v9522_order_sent_signal_"+s,ts).putLong("v9576_last_auto_"+s,now).apply();
            try{algo(c,s,lng,hedge,positionSide,"STOP_MARKET",stop,null,true);}catch(Throwable stopEx){emergency(c,s,lng,hedge,positionSide,fmt(fq));throw new Exception("STOP kurulamadı; acil kapatma denendi: "+stopEx.getMessage());}
            String brain="";try{brain=BrainCore.symbolSnapshot(c,s);}catch(Throwable ignored){}boolean runner=brain.contains("TRADE_LIFECYCLE=RUNNER")||brain.contains("TRADE_LIFECYCLE=HANDOFF");double a=runner?0.25:0.33,b=runner?0.25:0.33;double q1=floor(fq*a,step),q2=floor(fq*b,step),q3=floor(Math.max(0,fq-q1-q2),step);StringBuilder errs=new StringBuilder();
            try{if(q1>=min)algo(c,s,lng,hedge,positionSide,"TAKE_PROFIT_MARKET",t1,fmt(q1),false);}catch(Throwable e){errs.append("TP1 ").append(e.getMessage()).append(" | ");}
            try{if(q2>=min)algo(c,s,lng,hedge,positionSide,"TAKE_PROFIT_MARKET",t2,fmt(q2),false);}catch(Throwable e){errs.append("TP2 ").append(e.getMessage()).append(" | ");}
            try{if(q3>=min)algo(c,s,lng,hedge,positionSide,"TAKE_PROFIT_MARKET",t3,fmt(q3),false);}catch(Throwable e){errs.append("TP3 ").append(e.getMessage()).append(" | ");}
            String ok="OTO GİRİŞ GÖNDERİLDİ • "+s+" "+side+" • "+fmt(margin)+" USDT • "+lev+"x • "+(runner?"ÜST-TF HANDOFF 25/25/50":"SCALP 33/33/34")+(errs.length()>0?" • TP UYARI: "+errs:" • STOP+TP koruması gönderildi");status(p,s,ok);BrainLearning.recordExecution(c,s,ok);
        }catch(Throwable e){String msg="OTO RED/HA TA • "+s+" • "+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());status(p,s,msg);BrainLearning.recordExecution(c,s,msg);}finally{p.edit().putBoolean("v9522_order_inflight_"+s,false).putLong("v9576_executor_lease_until",0L).apply();}
    }

    private static void status(SharedPreferences p,String s,String x){p.edit().putString("v9576_auto_last_status",x).putString("v9576_auto_status_"+s,x).putLong("v9576_auto_status_ts",System.currentTimeMillis()).apply();}
    private static boolean bad(double x){return Double.isNaN(x)||Double.isInfinite(x)||x<=0;}private static double d(SharedPreferences p,String k){try{return Double.parseDouble(p.getString(k,"NaN"));}catch(Throwable e){return Double.NaN;}}
    private static double floor(double v,double step){if(!(step>0))return v;return java.math.BigDecimal.valueOf(v).divide(java.math.BigDecimal.valueOf(step),0,java.math.RoundingMode.DOWN).multiply(java.math.BigDecimal.valueOf(step)).doubleValue();}
    private static String fmt(double x){return java.math.BigDecimal.valueOf(x).stripTrailingZeros().toPlainString();}
    private static LinkedHashMap<String,String> map(String...x){LinkedHashMap<String,String>m=new LinkedHashMap<>();for(int i=0;i+1<x.length;i+=2)m.put(x[i],x[i+1]);return m;}
    private static LinkedHashMap<String,String> base(String s,String side,boolean hedge,String ps){LinkedHashMap<String,String>p=map("symbol",s,"side",side);if(hedge)p.put("positionSide",ps);return p;}
    private static boolean open(JSONObject a,String s){JSONArray p=a.optJSONArray("positions");if(p==null)return false;for(int i=0;i<p.length();i++){JSONObject x=p.optJSONObject(i);if(x!=null&&s.equals(x.optString("symbol"))){try{if(Math.abs(Double.parseDouble(x.optString("positionAmt","0")))>0)return true;}catch(Throwable ignored){}}}return false;}
    private static int openCount(JSONObject a){JSONArray p=a.optJSONArray("positions");Set<String>ss=new HashSet<>();if(p!=null)for(int i=0;i<p.length();i++){JSONObject x=p.optJSONObject(i);if(x==null)continue;try{if(Math.abs(Double.parseDouble(x.optString("positionAmt","0")))>0)ss.add(x.optString("symbol"));}catch(Throwable ignored){}}return ss.size();}
    private static JSONObject symbolInfo(Context c,String s)throws Exception{JSONObject ex=new JSONObject(http(c,"GET","/fapi/v1/exchangeInfo",null,false));JSONArray a=ex.getJSONArray("symbols");for(int i=0;i<a.length();i++){JSONObject x=a.getJSONObject(i);if(s.equals(x.optString("symbol")))return x;}throw new Exception("exchangeInfo symbol yok");}
    private static JSONObject filter(JSONObject s,String t){JSONArray a=s.optJSONArray("filters");if(a!=null)for(int i=0;i<a.length();i++){JSONObject x=a.optJSONObject(i);if(x!=null&&t.equals(x.optString("filterType")))return x;}return null;}
    private static boolean dual(Context c)throws Exception{return new JSONObject(http(c,"GET","/fapi/v1/positionSide/dual",null,true)).optBoolean("dualSidePosition",false);}
    private static void algo(Context c,String s,boolean lng,boolean hedge,String ps,String type,double trigger,String qty,boolean close)throws Exception{LinkedHashMap<String,String>p=base(s,lng?"SELL":"BUY",hedge,ps);p.put("algoType","CONDITIONAL");p.put("type",type);p.put("triggerPrice",fmt(trigger));p.put("workingType","MARK_PRICE");p.put("priceProtect","false");if(close)p.put("closePosition","true");else{p.put("quantity",qty);if(!hedge)p.put("reduceOnly","true");}http(c,"POST","/fapi/v1/algoOrder",p,true);}
    private static void emergency(Context c,String s,boolean lng,boolean hedge,String ps,String qty){try{LinkedHashMap<String,String>p=base(s,lng?"SELL":"BUY",hedge,ps);p.put("type","MARKET");p.put("quantity",qty);if(!hedge)p.put("reduceOnly","true");http(c,"POST","/fapi/v1/order",p,true);}catch(Throwable ignored){}}

    private static String[] creds(Context c)throws Exception{SharedPreferences p=c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);String k=decrypt(p.getString("v9522_api_key_enc","")),s=decrypt(p.getString("v9522_api_secret_enc",""));if(k.trim().isEmpty()||s.trim().isEmpty())throw new Exception("Binance API key/secret yok");return new String[]{k.trim(),s.trim()};}
    private static javax.crypto.SecretKey aes()throws Exception{java.security.KeyStore ks=java.security.KeyStore.getInstance("AndroidKeyStore");ks.load(null);if(!ks.containsAlias(ALIAS))throw new Exception("Android Keystore API anahtarı yok");return ((java.security.KeyStore.SecretKeyEntry)ks.getEntry(ALIAS,null)).getSecretKey();}
    private static String decrypt(String z)throws Exception{if(z==null||z.isEmpty())return "";String[]p=z.split(":",2);if(p.length!=2)throw new Exception("şifreli API kaydı bozuk");javax.crypto.Cipher x=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");x.init(javax.crypto.Cipher.DECRYPT_MODE,aes(),new javax.crypto.spec.GCMParameterSpec(128,android.util.Base64.decode(p[0],android.util.Base64.NO_WRAP)));return new String(x.doFinal(android.util.Base64.decode(p[1],android.util.Base64.NO_WRAP)),StandardCharsets.UTF_8);}
    private static String enc(String x)throws Exception{return java.net.URLEncoder.encode(x==null?"":x,"UTF-8");}private static String query(LinkedHashMap<String,String>p)throws Exception{StringBuilder b=new StringBuilder();for(java.util.Map.Entry<String,String>e:p.entrySet()){if(b.length()>0)b.append('&');b.append(enc(e.getKey())).append('=').append(enc(e.getValue()));}return b.toString();}
    private static String hmac(String s,String d)throws Exception{javax.crypto.Mac m=javax.crypto.Mac.getInstance("HmacSHA256");m.init(new javax.crypto.spec.SecretKeySpec(s.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));StringBuilder h=new StringBuilder();for(byte q:m.doFinal(d.getBytes(StandardCharsets.UTF_8)))h.append(String.format(Locale.US,"%02x",q&0xff));return h.toString();}
    private static String read(InputStream in)throws Exception{BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();String l;while((l=r.readLine())!=null)b.append(l);r.close();return b.toString();}
    private static String http(Context c,String method,String path,LinkedHashMap<String,String>params,boolean signed)throws Exception{LinkedHashMap<String,String>p=new LinkedHashMap<>();if(params!=null)p.putAll(params);String key=null,sec=null;if(signed){String[]cr=creds(c);key=cr[0];sec=cr[1];p.put("recvWindow","5000");p.put("timestamp",Long.toString(System.currentTimeMillis()+offset));}String q=query(p);if(signed)q+="&signature="+hmac(sec,q);HttpURLConnection h=(HttpURLConnection)new URL(BASE+path+(q.isEmpty()?"":"?"+q)).openConnection();h.setRequestMethod(method);h.setConnectTimeout(8000);h.setReadTimeout(12000);h.setRequestProperty("Accept","application/json");h.setRequestProperty("User-Agent","Futures15mAlarmPRO/9.5.76");if(signed)h.setRequestProperty("X-MBX-APIKEY",key);int code=h.getResponseCode();InputStream in=code>=200&&code<300?h.getInputStream():h.getErrorStream();String body=in==null?"":read(in);h.disconnect();if(code<200||code>=300){String msg=body;try{msg=new JSONObject(body).optString("msg",body);}catch(Throwable ignored){}throw new Exception("Binance API "+code+": "+msg);}return body;}
    private static void sync()throws Exception{HttpURLConnection h=(HttpURLConnection)new URL(BASE+"/fapi/v1/time").openConnection();h.setConnectTimeout(5000);h.setReadTimeout(5000);JSONObject o=new JSONObject(read(h.getInputStream()));offset=o.getLong("serverTime")-System.currentTimeMillis();h.disconnect();}
}
'''
AUTO.write_text(auto_java)

# Final release identity is aligned everywhere to v9.5.76.
for name,text in [('main',main),('mon',mon),('ana',ana),('agent',agent),('brain',brain)]:
    text=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.76',text)
    text=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.76',text)
    text=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.76',text)
    text=text.replace('BRAIN_CORE=v9.5.75','BRAIN_CORE=v9.5.76').replace('BRAIN_CORE=v9.5.71','BRAIN_CORE=v9.5.76')
    if name=='main':main=text
    elif name=='mon':mon=text
    elif name=='ana':ana=text
    elif name=='agent':agent=text
    else:brain=text
bf=re.sub(r'versionCode\s+\d+','versionCode 26091516',bf,count=1);bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.76'",bf,count=1)
MAIN.write_text(main);MON.write_text(mon);ANA.write_text(ana);AGENT.write_text(agent);BRAIN.write_text(brain);BUILD.write_text(bf)

checks={
 'auto button':'V9576_LIVE_AUTO_SETTINGS_BUTTON' in MAIN.read_text(),
 'explicit opt-in':'CANLI OTO EMİRİ ETKİNLEŞTİR' in MAIN.read_text() and 'v9576_auto_enabled' in MAIN.read_text(),
 'controls':'v9576_auto_margin' in MAIN.read_text() and 'v9576_auto_leverage' in MAIN.read_text() and 'v9576_auto_max_positions' in MAIN.read_text(),
 'signal hook':'AutoTradeEngine.onSignal(this, symbol)' in MON.read_text(),
 'engine':'V9576_GUARDED_LIVE_AUTO_EXECUTION' in AUTO.read_text(),
 'hard safety':'STOP kurulamadı; acil kapatma denendi' in AUTO.read_text() and 'dev>0.50' in AUTO.read_text() and 'openCount(acct)>=max' in AUTO.read_text(),
 'duplicate guard':'v9522_order_sent_signal_' in AUTO.read_text() and 'v9522_order_inflight_' in AUTO.read_text(),
 'encrypted credentials':'AndroidKeyStore' in AUTO.read_text() and 'AES/GCM/NoPadding' in AUTO.read_text(),
 'protective orders':'STOP_MARKET' in AUTO.read_text() and AUTO.read_text().count('TAKE_PROFIT_MARKET')>=3,
 'brain handoff split':'ÜST-TF HANDOFF 25/25/50' in AUTO.read_text(),
 'learning retained':'V9575_BRAIN_LEARNING_MEMORY' in LEARN.read_text(),
 'multi-free retained':'V9575_MULTI_FREE_HEALTH_POOL' in AGENT.read_text(),
 'version':"versionName '9.5.76'" in BUILD.read_text() and 'versionCode 26091516' in BUILD.read_text(),
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.76 sanity failed: '+', '.join(bad))
print('v9.5.76 OK: explicit-user-opt-in live AUTO execution, encrypted Binance credentials, max 1-5 positions, LONG/SHORT controls, stale/chase/duplicate/open-position guards, STOP fail-safe, and upper-TF handoff TP weighting. AI remains advisory-only.')
