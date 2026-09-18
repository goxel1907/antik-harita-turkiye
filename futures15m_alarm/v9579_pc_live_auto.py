from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
AUTO=JAVA/'AutoTradeEngine.java'
MAIN=JAVA/'MainActivity.java'
BUILD=APP/'app/build.gradle'
for p in (AUTO,MAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.91 missing '+str(p))

def method_bounds(src, signature_fragment):
    a=src.find(signature_fragment)
    if a<0:return None
    b=src.find('{',a)
    if b<0:return None
    depth=1;i=b+1;ins=inc=esc=lc=bc=False
    while i<len(src) and depth:
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if lc:
            if c=='\n':lc=False
        elif bc:
            if c=='*' and n=='/':bc=False;i+=1
        elif ins:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':ins=False
        elif inc:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":inc=False
        else:
            if c=='/' and n=='/':lc=True;i+=1
            elif c=='/' and n=='*':bc=True;i+=1
            elif c=='"':ins=True
            elif c=="'":inc=True
            elif c=='{':depth+=1
            elif c=='}':depth-=1
        i+=1
    return None if depth else (a,b,i)

auto=AUTO.read_text()
auto=auto.replace('private static final ExecutorService IO=Executors.newSingleThreadExecutor();',
                  'private static final java.util.concurrent.ScheduledExecutorService IO=Executors.newSingleThreadScheduledExecutor();')
if 'V9577_DRY_RUN_LOCK' not in auto:
    raise SystemExit('v9.5.91 requires v9.5.78 dry-run lock first')
start=auto.find('    // V9577_DRY_RUN_LOCK:')
end=auto.find('    private static void run(Context c,String s)',start)
if start<0 or end<0:
    raise SystemExit('v9.5.91 AutoTradeEngine dry-run anchor changed')

pc_bridge=r'''    // V9579_PC_LIVE_AUTO: phone never signs Binance orders; PC BrainHub owns the executor.
    public static void onSignal(Context c,String symbol){
        if(c==null||symbol==null||symbol.trim().isEmpty())return;
        Context app=c.getApplicationContext();String s=symbol.trim().toUpperCase(Locale.US);
        SharedPreferences p=app.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);
        if(!p.getBoolean("v9576_auto_enabled",false))return;
        if(!"PC".equals(p.getString("v9576_executor_owner","PC")))return;
        IO.execute(()->runPc(app,s));
    }

    // V9586_TICK_SAFE_LIVE_LEVELS
    private static double ceilStep(double v,double step){
        if(!(step>0))return v;
        return java.math.BigDecimal.valueOf(v)
            .divide(java.math.BigDecimal.valueOf(step),0,java.math.RoundingMode.CEILING)
            .multiply(java.math.BigDecimal.valueOf(step)).doubleValue();
    }

    // V9587_SAFE_LIVE_RETRY
    private static void scheduleSafeRetry(Context c,String s,long signalTs,String reason){
        if(c==null||s==null||signalTs<=0)return;
        SharedPreferences p=c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);
        long now=System.currentTimeMillis(),age=now-signalTs;
        if(!p.getBoolean("v9576_auto_enabled",false)||age<0||age>105000L)return;
        long seen=p.getLong("v9587_retry_signal_"+s,0L);
        int n=(seen==signalTs)?p.getInt("v9587_retry_count_"+s,0):0;
        if(n>=3)return;
        n++;
        p.edit().putLong("v9587_retry_signal_"+s,signalTs)
            .putInt("v9587_retry_count_"+s,n).apply();
        status(p,s,"PC LIVE GÜVENLİ RETRY "+n+"/3 • 15 sn sonra • "+(reason==null?"geçici red":reason));
        IO.schedule(()->runPc(c,s),15L,java.util.concurrent.TimeUnit.SECONDS);
    }

    private static void runPc(Context c,String s){
        SharedPreferences p=c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);long now=System.currentTimeMillis();
        long signalTsForRetry=0L;boolean safeRetry=false;String safeRetryReason="";
        try{
            if(!BrainHubClient.configured(c))throw new Exception("PC Brain Hub bağlı değil");
            if(!p.getBoolean("v9576_auto_enabled",false))return;
            if(!p.getBoolean("v9518_signal_active_"+s,false))throw new Exception("aktif sinyal yok");
            long ts=p.getLong("v9518_signal_time_"+s,0L),age=now-ts;signalTsForRetry=ts;
            if(ts<=0||age<0||age>120000L)throw new Exception("sinyal oto giriş için bayat (>2dk)");
            if(p.getLong("v9522_order_sent_signal_"+s,-1L)==ts)throw new Exception("bu sinyal daha önce PC yürütücüsüne gönderildi");
            if(p.getBoolean("v9522_order_inflight_"+s,false))throw new Exception("bu sembolde LIVE istek zaten işleniyor");
            long last=p.getLong("v9576_last_auto_"+s,0L);if(last>0&&now-last<5L*60L*1000L)throw new Exception("sembol cooldown 5dk");

            String side=p.getString("v9518_signal_side_"+s,"LONG");boolean lng="LONG".equalsIgnoreCase(side);
            if(!lng&&!"SHORT".equalsIgnoreCase(side))throw new Exception("sinyal yönü geçersiz");
            if(lng&&!p.getBoolean("v9576_auto_long",true))throw new Exception("LONG oto kapalı");
            if(!lng&&!p.getBoolean("v9576_auto_short",true))throw new Exception("SHORT oto kapalı");
            double entry=d(p,"v9518_signal_price_"+s),stop=d(p,"v9518_signal_stop_"+s);
            double tp1=d(p,"v9518_signal_tp1_"+s),tp2=d(p,"v9518_signal_tp2_"+s),tp3=d(p,"v9518_signal_tp3_"+s);
            if(bad(entry)||bad(stop)||bad(tp1)||bad(tp2)||bad(tp3))throw new Exception("sinyal giriş/stop/TP seviyeleri eksik");
            if(lng&&!(stop<entry&&entry<tp1&&tp1<tp2&&tp2<tp3))throw new Exception("LONG stop/TP geometrisi geçersiz");
            if(!lng&&!(stop>entry&&entry>tp1&&tp1>tp2&&tp2>tp3))throw new Exception("SHORT stop/TP geometrisi geçersiz");

            double margin=Double.parseDouble(p.getString("v9576_auto_margin",p.getString("v9522_last_margin","0")));
            int configuredLev=Integer.parseInt(p.getString("v9576_auto_leverage",p.getString("v9522_last_leverage","0")));
            int maxPositions=p.getInt("v9576_auto_max_positions",1);
            if(!(margin>0)||configuredLev<1||configuredLev>125||maxPositions<1||maxPositions>5)throw new Exception("oto marj/kaldıraç/max pozisyon ayarı geçersiz");

            JSONObject liveStatus=BrainHubClient.liveStatus(c);
            if(!liveStatus.optBoolean("liveConfigured")||!liveStatus.optBoolean("armed"))throw new Exception("PC LIVE arm kapalı");
            JSONObject policy=liveStatus.optJSONObject("policy");
            JSONObject limits=policy==null?null:policy.optJSONObject("limits");
            int pcMaxPositions=limits==null?0:limits.optInt("maxOpenPositions",0);
            if(pcMaxPositions>0&&maxPositions>pcMaxPositions)throw new Exception("telefon max pozisyon "+maxPositions+", PC güvenlik tavanı "+pcMaxPositions);

            p.edit().putBoolean("v9522_order_inflight_"+s,true).apply();
            status(p,s,"PC LIVE ÖN KONTROL • "+s+" "+side+" • risk / lineage / grant doğrulanıyor");

            // Public Binance data only: no API key/secret and no signed order from Android.
            double live=new JSONObject(http(c,"GET","/fapi/v1/ticker/price",map("symbol",s),false)).getDouble("price");
            if(bad(live))throw new Exception("canlı fiyat alınamadı");
            JSONObject si=symbolInfo(c,s);JSONObject lot=filter(si,"MARKET_LOT_SIZE");if(lot==null)lot=filter(si,"LOT_SIZE");
            if(lot==null)throw new Exception("MARKET_LOT_SIZE/LOT_SIZE filtresi yok");
            double step=lot.optDouble("stepSize",0),min=lot.optDouble("minQty",0),max=lot.optDouble("maxQty",Double.POSITIVE_INFINITY);
            if(!(step>0)||!(min>=0)||!(max>0))throw new Exception("lot filtresi geçersiz");
            double qty=floor(margin*configuredLev/live,step);
            if(!(qty>0)||qty<min||qty>max)throw new Exception("hesaplanan miktar Binance lot sınırı dışında");

            JSONObject pf=filter(si,"PRICE_FILTER");
            double tick=pf==null?0.0:pf.optDouble("tickSize",0.0);
            if(!(tick>0))throw new Exception("PRICE_FILTER/tickSize geçersiz");
            if(lng){
                stop=ceilStep(stop,tick);
                tp1=floor(tp1,tick);tp2=floor(tp2,tick);tp3=floor(tp3,tick);
                if(!(stop<live&&live<tp1&&tp1<tp2&&tp2<tp3))throw new Exception("LONG tick-normalize sonrası stop/TP geometrisi geçersiz");
            }else{
                stop=floor(stop,tick);
                tp1=ceilStep(tp1,tick);tp2=ceilStep(tp2,tick);tp3=ceilStep(tp3,tick);
                if(!(stop>live&&live>tp1&&tp1>tp2&&tp2>tp3))throw new Exception("SHORT tick-normalize sonrası stop/TP geometrisi geçersiz");
            }

            String tsText=Long.toString(ts),tail=tsText.substring(Math.max(0,tsText.length()-10));
            String hash=Integer.toHexString(s.hashCode());
            String clientId="F15P"+tail+hash;
            if(clientId.length()>36)clientId=clientId.substring(0,36);
            String lineage="SIG:"+s+":"+tsText;
            String eventId="ANDROID:"+s+":"+tsText;

            JSONObject order=new JSONObject();
            order.put("action","OPEN");order.put("symbol",s);order.put("side",lng?"LONG":"SHORT");order.put("orderType","MARKET");
            order.put("quantity",qty);order.put("entryPrice",entry);order.put("stopPrice",stop);
            order.put("takeProfit1",tp1);order.put("takeProfit2",tp2);order.put("takeProfit3",tp3);
            order.put("clientOrderId",clientId);order.put("lineageId",lineage);
            JSONObject body=new JSONObject();body.put("eventId",eventId);body.put("order",order);
            body.put("requestedMarginQuote",margin);body.put("requestedLeverage",configuredLev);body.put("requestedMaxOpenPositions",maxPositions);
            // Existing deterministic signal stores one structural stop boundary; no separate buffer field exists on mobile yet.
            body.put("structuralInvalidationPrice",stop);body.put("bufferQuote",0.0);body.put("initialStopPrice",stop);

            JSONObject out=BrainHubClient.liveExecute(c,body);
            boolean stopProtectedEntry=out.optBoolean("orderPlaced",false)&&out.optBoolean("stopProtected",false);
            boolean tpProtected=out.optBoolean("tpProtected",false);
            boolean fullyProtected=out.optBoolean("ok",false)&&stopProtectedEntry&&tpProtected;
            boolean uncertain=out.optBoolean("manualReviewRequired",false)||"LIVE_ENTRY_REVIEW_REQUIRED".equals(out.optString("execution"));
            safeRetry=out.optBoolean("retryable",false)&&!uncertain&&!out.optBoolean("orderPlaced",false);
            if(stopProtectedEntry){
                android.content.SharedPreferences.Editor ed=p.edit()
                    .putLong("v9522_order_sent_signal_"+s,ts).putLong("v9576_last_auto_"+s,now)
                    .putString("v9550_trade_margin_"+s,fmt(margin))
                    .putString("v9550_trade_leverage_"+s,Integer.toString(configuredLev))
                    .putString("v9550_trade_side_"+s,side)
                    .putLong("v9550_trade_open_ts_"+s,now)
                    .putString("v9582_trade_entry_ref_"+s,fmt(entry))
                    .putString("v9582_trade_stop_"+s,fmt(stop))
                    .putString("v9582_trade_qty_"+s,out.optString("executedQty",fmt(qty)))
                    .putString("v9582_trade_entry_order_id_"+s,out.optString("entryOrderId",""))
                    .putString("v9582_trade_stop_algo_id_"+s,out.optString("stopAlgoId",""))
                    .putBoolean("v9582_trade_stop_protected_"+s,out.optBoolean("stopProtected",false))
                    .putBoolean("v9582_trade_tp_protected_"+s,tpProtected)
                    .putString("v9582_trade_tp_algo_ids_"+s,out.optJSONArray("tpAlgoIds")==null?"":out.optJSONArray("tpAlgoIds").toString())
                    .putLong("v9582_trade_meta_ts_"+s,now);
                if(!bad(tp1))ed.putString("v9582_trade_tp1_"+s,fmt(tp1));
                if(!bad(tp2))ed.putString("v9582_trade_tp2_"+s,fmt(tp2));
                if(!bad(tp3))ed.putString("v9582_trade_tp3_"+s,fmt(tp3));
                ed.apply();
                String msg=fullyProtected
                    ? "PC LIVE TAM KORUMALI GİRİŞ • "+s+" "+side+" • STOP + TP1/TP2/TP3 AKTİF • "+fmt(margin)+" USDT • "+configuredLev+"x"
                    : "PC LIVE STOP AKTİF • TP EKSİK • MANUEL KONTROL • "+s+" "+side+" • "+out.optString("execution","LIVE_TP_REVIEW");
                status(p,s,msg);BrainLearning.recordExecution(c,s,msg);return;
            }
            if(uncertain){
                // Never retry an uncertain submit automatically; Binance may have received it.
                p.edit().putLong("v9522_order_sent_signal_"+s,ts).putLong("v9576_last_auto_"+s,now).apply();
            }
            String reason="";org.json.JSONArray rs=out.optJSONArray("reasons");if(rs!=null&&rs.length()>0)reason=rs.optString(0,"");
            if(reason.isEmpty())reason=out.optString("execution","LIVE_BLOCKED");
            safeRetryReason=reason;
            throw new Exception((uncertain?"MANUEL KONTROL GEREKİR • ":"")+reason);
        }catch(Throwable e){
            String msg="PC LIVE RED/HATA • "+s+" • "+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());
            status(p,s,msg);BrainLearning.recordExecution(c,s,msg);
            if(safeRetry&&signalTsForRetry>0)scheduleSafeRetry(c,s,signalTsForRetry,safeRetryReason);
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
    ('.putBoolean("v9576_auto_short",sht.isChecked()).putBoolean("v9576_auto_enabled",false)','.putBoolean("v9576_auto_short",sht.isChecked()).putBoolean("v9576_auto_enabled",en.isChecked())'),
    ('.putString("v9576_executor_owner","PHONE")','.putString("v9576_executor_owner","PC")'),
    ('"DRY-RUN: AÇIK"','"PC LIVE: "+(v9576On?"OTO AÇIK":"KAPALI")')
]
for old,new in repls:
    if old not in main: raise SystemExit('v9.5.91 MainActivity anchor missing: '+old[:70])
    main=main.replace(old,new,1)

# V9588_PC_LEADER_AUTO_SYNC
save_anchor='Toast.makeText(this,"Oto işlem ayarı kaydedildi • "+(en.isChecked()?"CANLI AÇIK":"KAPALI"),Toast.LENGTH_LONG).show();dlg.dismiss();'
save_new='''v9522Io.execute(()->{
                        try{
                            org.json.JSONObject cfg=BrainHubClient.configureLeaderAuto(this,en.isChecked(),margin,lev,max,lng.isChecked(),sht.isChecked());
                            sp.edit().putBoolean("v9588_pc_auto_sync_ok",cfg.optBoolean("ok",false))
                              .putString("v9588_pc_auto_sync_error",cfg.optBoolean("ok",false)?"":cfg.optJSONArray("reasons")==null?cfg.optString("error","PC_AUTO_CONFIG_REJECTED"):cfg.optJSONArray("reasons").toString())
                              .putLong("v9588_pc_auto_sync_ts",System.currentTimeMillis()).apply();
                        }catch(Throwable syncError){
                            sp.edit().putBoolean("v9588_pc_auto_sync_ok",false)
                              .putString("v9588_pc_auto_sync_error",syncError.getClass().getSimpleName())
                              .putLong("v9588_pc_auto_sync_ts",System.currentTimeMillis()).apply();
                        }
                    });
                    Toast.makeText(this,"Oto işlem ayarı kaydedildi • "+(en.isChecked()?"CANLI AÇIK":"KAPALI"),Toast.LENGTH_LONG).show();dlg.dismiss();'''
if save_anchor not in main: raise SystemExit('v9.5.91 save sync anchor missing')
main=main.replace(save_anchor,save_new,1)

emergency_anchor='dlg.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->{sp.edit().putBoolean("v9576_auto_enabled",false).apply();en.setChecked(false);st.setText("SON DURUM: ACİL DURDUR • yeni oto girişler kapalı");Toast.makeText(this,"CANLI OTO yeni girişleri durduruldu. Açık Binance pozisyonları otomatik kapatılmadı.",Toast.LENGTH_LONG).show();});'
emergency_new='''dlg.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v->{
                sp.edit().putBoolean("v9576_auto_enabled",false).apply();en.setChecked(false);
                st.setText("SON DURUM: ACİL DURDUR • PC auto kapatılıyor ve LIVE disarm ediliyor");
                v9522Io.execute(()->{
                    try{
                        double m=v9549Number(sp.getString("v9576_auto_margin","0")); if(Double.isNaN(m))m=0.0;
                        int emergencyLev=1;try{emergencyLev=Integer.parseInt(sp.getString("v9576_auto_leverage","1"));}catch(Throwable ignored){}
                        int emergencyMaxPositions=sp.getInt("v9576_auto_max_positions",1);
                        BrainHubClient.configureLeaderAuto(this,false,m,emergencyLev,emergencyMaxPositions,sp.getBoolean("v9576_auto_long",true),sp.getBoolean("v9576_auto_short",true));
                    }catch(Throwable ignored){}
                    try{BrainHubClient.liveDisarm(this,"ANDROID_EMERGENCY_STOP");}catch(Throwable ignored){}
                });
                Toast.makeText(this,"ACİL DURDUR: yeni PC oto girişleri kapatılıyor ve LIVE disarm ediliyor.",Toast.LENGTH_LONG).show();
            });'''
if emergency_anchor not in main: raise SystemExit('v9.5.91 emergency sync anchor missing')
main=main.replace(emergency_anchor,emergency_new,1)

# V9582_VISIBLE_LIVE_STATUS_PANEL
# Replace the historical-only real-trades card with a persistent operating-state
# panel. It reads local radar/signal/account snapshots and probes BrainHub LIVE
# status at a throttled interval. No order/cancel side effects live here.
if 'V9582_VISIBLE_LIVE_STATUS_PANEL' not in main:
    pos=main.rfind('}')
    if pos<0: raise SystemExit('v9.5.91 MainActivity close missing')
    helpers=r'''
    // ============================================================
    // V9582_VISIBLE_LIVE_STATUS_PANEL
    // UI/read-only telemetry. No Binance order/cancel side effects.
    // ============================================================
    private volatile long v9582PcProbeAt=0L;
    private volatile boolean v9582PcProbeBusy=false;

    private void v9582MaybeProbePcLive(){
        final long now=System.currentTimeMillis();
        if(v9582PcProbeBusy||now-v9582PcProbeAt<5000L)return;
        v9582PcProbeAt=now;v9582PcProbeBusy=true;
        v9522Io.execute(()->{
            android.content.SharedPreferences sp=v9522Prefs();
            try{
                org.json.JSONObject st=BrainHubClient.liveStatus(this);
                org.json.JSONObject la=st.optJSONObject("leaderAuto");
                sp.edit().putBoolean("v9582_pc_probe_ok",true)
                    .putBoolean("v9582_pc_armed",st.optBoolean("armed",false))
                    .putString("v9582_pc_expires_at",st.optString("expiresAt",""))
                    .putString("v9582_pc_execution",st.optString("execution",""))
                    .putBoolean("v9588_pc_auto_configured",la!=null&&la.optBoolean("configured",false))
                    .putBoolean("v9588_pc_auto_enabled",la!=null&&la.optBoolean("enabled",false))
                    .putString("v9588_pc_auto_last_execution",la==null?"":la.optString("lastExecution",""))
                    .putLong("v9582_pc_probe_ts",System.currentTimeMillis()).apply();
                if(now-sp.getLong("v9588_pc_auto_sync_ts",0L)>=60000L){
                    try{
                        double m=v9549Number(sp.getString("v9576_auto_margin","0"));if(Double.isNaN(m))m=0.0;
                        int l=1;try{l=Integer.parseInt(sp.getString("v9576_auto_leverage","1"));}catch(Throwable ignored){}
                        int syncMaxPositions=sp.getInt("v9576_auto_max_positions",1);
                        org.json.JSONObject cfg=BrainHubClient.configureLeaderAuto(this,sp.getBoolean("v9576_auto_enabled",false),m,l,syncMaxPositions,
                            sp.getBoolean("v9576_auto_long",true),sp.getBoolean("v9576_auto_short",true));
                        sp.edit().putBoolean("v9588_pc_auto_sync_ok",cfg.optBoolean("ok",false))
                          .putString("v9588_pc_auto_sync_error",cfg.optBoolean("ok",false)?"":cfg.optJSONArray("reasons")==null?cfg.optString("error","PC_AUTO_CONFIG_REJECTED"):cfg.optJSONArray("reasons").toString())
                          .putLong("v9588_pc_auto_sync_ts",System.currentTimeMillis()).apply();
                    }catch(Throwable syncError){
                        sp.edit().putBoolean("v9588_pc_auto_sync_ok",false)
                          .putString("v9588_pc_auto_sync_error",syncError.getClass().getSimpleName())
                          .putLong("v9588_pc_auto_sync_ts",System.currentTimeMillis()).apply();
                    }
                }
                try{
                    org.json.JSONObject acc=BrainHubClient.liveAccount(this);
                    sp.edit().putBoolean("v9583_pc_account_ok",acc.optBoolean("ok",false))
                        .putString("v9583_pc_wallet",acc.has("walletBalance")?acc.optString("walletBalance",""):"")
                        .putString("v9583_pc_equity",acc.has("equity")?acc.optString("equity",""):"")
                        .putString("v9583_pc_available",acc.has("availableBalance")?acc.optString("availableBalance",""):"")
                        .putString("v9583_pc_unrealized",acc.has("unrealizedPnl")?acc.optString("unrealizedPnl",""):"")
                        .putInt("v9583_pc_open_positions",acc.optInt("openPositions",0))
                        .putLong("v9583_pc_account_ts",System.currentTimeMillis()).apply();
                }catch(Throwable accountError){
                    sp.edit().putBoolean("v9583_pc_account_ok",false)
                        .putString("v9583_pc_account_error",accountError.getClass().getSimpleName())
                        .putLong("v9583_pc_account_ts",System.currentTimeMillis()).apply();
                }
            }catch(Throwable e){
                sp.edit().putBoolean("v9582_pc_probe_ok",false)
                    .putString("v9582_pc_probe_error",e.getClass().getSimpleName())
                    .putLong("v9582_pc_probe_ts",System.currentTimeMillis()).apply();
            }finally{
                v9582PcProbeBusy=false;
                runOnUiThread(()->{try{v9549InstallRecentTradesCard();}catch(Throwable ignored){}});
            }
        });
    }

    private String v9582Age(long ts){
        if(ts<=0)return "—";
        long sec=Math.max(0L,(System.currentTimeMillis()-ts)/1000L);
        if(sec<60L)return sec+" sn";
        long min=sec/60L;if(min<60L)return min+" dk";
        return (min/60L)+" saat "+(min%60L)+" dk";
    }

    private String v9582ArmRemaining(String iso){
        if(iso==null||iso.trim().isEmpty())return "—";
        try{
            java.text.SimpleDateFormat f=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",java.util.Locale.US);
            f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            long ms=f.parse(iso).getTime()-System.currentTimeMillis();
            if(ms<=0)return "süre doldu";
            long sec=ms/1000L;return (sec/60L)+" dk "+(sec%60L)+" sn";
        }catch(Throwable ignored){return iso;}
    }

    private int v9582ActiveSignalCount(){
        int n=0;
        try{
            java.util.Map<String,?> all=v9522Prefs().getAll();
            for(java.util.Map.Entry<String,?> e:all.entrySet())
                if(e.getKey().startsWith("v9518_signal_active_")&&Boolean.TRUE.equals(e.getValue()))n++;
        }catch(Throwable ignored){}
        return n;
    }

    private boolean v9582AnyInflight(){
        try{
            java.util.Map<String,?> all=v9522Prefs().getAll();
            for(java.util.Map.Entry<String,?> e:all.entrySet())
                if(e.getKey().startsWith("v9522_order_inflight_")&&Boolean.TRUE.equals(e.getValue()))return true;
        }catch(Throwable ignored){}
        return false;
    }

    private String v9582RadarSummary(){
        try{
            String raw=V9538MarketRadarEngine.latestJson(this);
            org.json.JSONObject j=new org.json.JSONObject(raw);
            long at=j.optLong("updatedAt",0L);
            org.json.JSONArray rows=j.optJSONArray("rows");
            int n=rows==null?0:rows.length();
            return n+" aday • son tarama "+v9582Age(at)+" önce";
        }catch(Throwable ignored){return "radar verisi bekleniyor";}
    }

    private double v9582PrefNumber(android.content.SharedPreferences sp,String primary,String fallback){
        double x=v9549Number(sp.getString(primary,""));
        if(Double.isNaN(x)&&fallback!=null)x=v9549Number(sp.getString(fallback,""));
        return x;
    }

    private String v9582Level(double x){
        if(Double.isNaN(x)||Double.isInfinite(x)||x<=0.0)return "—";
        return java.math.BigDecimal.valueOf(x).stripTrailingZeros().toPlainString();
    }

    // V9583_BINANCE_BALANCE_SUMMARY
    // Reads the existing foreground account-sync snapshot only. No extra signed
    // Binance request is made here and credentials are never rendered/logged.
    private double v9583JsonNumber(String raw,String key){
        if(raw==null||raw.trim().isEmpty()||key==null)return Double.NaN;
        try{
            org.json.JSONObject j=new org.json.JSONObject(raw);
            Object v=j.opt(key);
            if(v!=null&&v!=org.json.JSONObject.NULL){
                double x=v9549Number(String.valueOf(v));
                if(!Double.isNaN(x))return x;
            }
        }catch(Throwable ignored){}
        try{
            String needle=String.valueOf((char)34)+key+(char)34;
            int p=raw.indexOf(needle);
            if(p<0)return Double.NaN;
            int c=raw.indexOf(':',p+needle.length());
            if(c<0)return Double.NaN;
            int i=c+1;
            while(i<raw.length()&&(raw.charAt(i)==' '||raw.charAt(i)=='\t'||raw.charAt(i)==(char)34))i++;
            int j=i;
            while(j<raw.length()){
                char ch=raw.charAt(j);
                if((ch>='0'&&ch<='9')||ch=='+'||ch=='-'||ch=='.'||ch==',')j++;
                else break;
            }
            if(j>i)return v9549Number(raw.substring(i,j));
        }catch(Throwable ignored){}
        return Double.NaN;
    }

    private String v9583BinanceBalanceSummary(){
        android.content.SharedPreferences sp=v9522Prefs();
        long accountTs=sp.getLong("v9583_pc_account_ts",0L);
        if(sp.getBoolean("v9583_pc_account_ok",false)&&accountTs>0&&System.currentTimeMillis()-accountTs<=15000L){
            double wallet=v9549Number(sp.getString("v9583_pc_wallet",""));
            double equity=v9549Number(sp.getString("v9583_pc_equity",""));
            double available=v9549Number(sp.getString("v9583_pc_available",""));
            StringBuilder pc=new StringBuilder("Binance Futures");
            if(!Double.isNaN(wallet))pc.append(" • Cüzdan ").append(String.format(java.util.Locale.US,"%.2f USDT",wallet));
            if(!Double.isNaN(equity))pc.append(" • Equity ").append(String.format(java.util.Locale.US,"%.2f USDT",equity));
            if(!Double.isNaN(available))pc.append(" • Kullanılabilir ").append(String.format(java.util.Locale.US,"%.2f USDT",available));
            if(pc.length()>"Binance Futures".length())return pc.toString();
        }
        double wallet=Double.NaN,equity=Double.NaN,available=Double.NaN;
        int best=-1;
        try{
            java.util.Map<String,?> all=sp.getAll();
            for(java.util.Map.Entry<String,?> e:all.entrySet()){
                Object v=e.getValue();
                if(!(v instanceof String))continue;
                String raw=((String)v).trim();
                if(raw.isEmpty())continue;
                double w=v9583JsonNumber(raw,"totalWalletBalance");
                double q=v9583JsonNumber(raw,"totalMarginBalance");
                double a=v9583JsonNumber(raw,"availableBalance");
                if(Double.isNaN(w)&&Double.isNaN(q)&&Double.isNaN(a))continue;
                String k=e.getKey()==null?"":e.getKey().toLowerCase(java.util.Locale.US);
                int score=0;
                if(k.startsWith("v9527")||k.startsWith("v9543"))score+=8;
                if(k.contains("account")||k.contains("portfolio")||k.contains("balance"))score+=4;
                if(raw.contains("positions")||raw.contains("\"canTrade\""))score+=3;
                if(score>best){
                    best=score;wallet=w;equity=q;available=a;
                }
            }
        }catch(Throwable ignored){}
        if(Double.isNaN(wallet)&&Double.isNaN(equity)&&Double.isNaN(available))
            return "Binance Futures bakiye: senkron bekleniyor";
        StringBuilder b=new StringBuilder("Binance Futures");
        if(!Double.isNaN(wallet))b.append(" • Cüzdan ").append(String.format(java.util.Locale.US,"%.2f USDT",wallet));
        if(!Double.isNaN(equity))b.append(" • Equity ").append(String.format(java.util.Locale.US,"%.2f USDT",equity));
        if(!Double.isNaN(available))b.append(" • Kullanılabilir ").append(String.format(java.util.Locale.US,"%.2f USDT",available));
        return b.toString();
    }
'''
    main=main[:pos]+helpers+'\n'+main[pos:]

b=method_bounds(main,'private void v9549FillRecentTradesCard(')
if not b: raise SystemExit('v9.5.91 recent trades renderer missing')
a,_,e=b
renderer=r'''private void v9549FillRecentTradesCard(android.widget.LinearLayout box) {
        if(box==null)return;
        box.removeAllViews();
        v9582MaybeProbePcLive();
        android.content.SharedPreferences sp=v9522Prefs();
        long now=System.currentTimeMillis();
        boolean autoOn=sp.getBoolean("v9576_auto_enabled",false);
        long probeTs=sp.getLong("v9582_pc_probe_ts",0L);
        boolean pcFresh=probeTs>0&&now-probeTs<=15000L&&sp.getBoolean("v9582_pc_probe_ok",false);
        boolean armed=pcFresh&&sp.getBoolean("v9582_pc_armed",false);
        boolean pcAutoConfigured=pcFresh&&sp.getBoolean("v9588_pc_auto_configured",false);
        boolean pcAutoEnabled=pcFresh&&sp.getBoolean("v9588_pc_auto_enabled",false);
        boolean inflight=v9582AnyInflight();
        int activeSignals=v9582ActiveSignalCount();

        android.widget.TextView head=text("🤖 OTO İŞLEM DURUMU • SABİT",14f,android.graphics.Color.WHITE,true);
        box.addView(head,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));

        String margin=sp.getString("v9576_auto_margin","—");
        String lev=sp.getString("v9576_auto_leverage","—");
        int max=sp.getInt("v9576_auto_max_positions",1);
        boolean lng=sp.getBoolean("v9576_auto_long",true),sht=sp.getBoolean("v9576_auto_short",true);
        String state;
        if(!autoOn) state="⏹ OTO MOTOR KAPALI";
        else if(!pcFresh) state="🟡 OTO AÇIK • PC LIVE DURUMU YENİLENİYOR";
        else if(!pcAutoConfigured||!pcAutoEnabled) state="🟡 OTO AÇIK • PC AUTO SENKRON BEKLİYOR";
        else if(!armed) state="🟠 OTO HAZIR • PC ARM KAPALI";
        else if(inflight) state="🔵 SİNYAL İŞLENİYOR • RİSK / LINEAGE / GRANT KONTROLÜ";
        else state="🟢 PC LEADER AUTO TARIYOR • TAZE FIRSAT BEKLİYOR";

        StringBuilder st=new StringBuilder(state);
        st.append("\n").append(v9583BinanceBalanceSummary());
        st.append("\nRadar: ").append(v9582RadarSummary());
        st.append(" • aktif sinyal ").append(activeSignals);
        st.append("\nAyar: ").append(margin).append(" USDT • ").append(lev).append("x • max ").append(max)
          .append(" • ").append(lng?"LONG ":"").append(sht?"SHORT":"");
        if(pcFresh){
            st.append("\nPC LIVE: ").append(armed?"ARMED":"KAPALI");
            if(armed)st.append(" • kalan ").append(v9582ArmRemaining(sp.getString("v9582_pc_expires_at","")));
            st.append("\nPC LEADER AUTO: ").append(pcAutoEnabled&&pcAutoConfigured?"AKTİF":"KAPALI/SENKRON");
            String lex=sp.getString("v9588_pc_auto_last_execution","");
            if(lex!=null&&!lex.trim().isEmpty())st.append(" • son ").append(lex.trim());
        }
        String last=sp.getString("v9576_auto_last_status","");
        if(last!=null&&!last.trim().isEmpty())st.append("\nSon motor durumu: ").append(last.trim());
        int stateBg=!autoOn?android.graphics.Color.rgb(51,65,85)
                :(!armed?android.graphics.Color.rgb(120,74,18)
                :(inflight?android.graphics.Color.rgb(30,64,175):android.graphics.Color.rgb(20,83,45)));
        android.widget.TextView status=text(st.toString(),11.8f,android.graphics.Color.WHITE,false);
        status.setPadding(dp(9),dp(7),dp(9),dp(7));status.setBackgroundColor(stateBg);
        android.widget.LinearLayout.LayoutParams slp=new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.setMargins(0,dp(6),0,0);box.addView(status,slp);

        // V9589_MOBILE_REARM: explicit user tap only; never auto-rearms after expiry/restart.
        android.widget.Button armButton=new android.widget.Button(this);
        armButton.setAllCaps(false);
        armButton.setText(armed?"✅ LIVE AÇIK":"▶ LIVE 24 SAAT BAŞLAT / YENİDEN BAŞLAT");
        boolean armReady=!armed&&autoOn&&pcFresh&&pcAutoConfigured&&pcAutoEnabled&&BrainHubClient.configured(this);
        armButton.setEnabled(armReady);
        armButton.setOnClickListener(v->{
            if(!armReady){
                Toast.makeText(this,"Önce OTO ayarlarını PC'ye senkronlayın; PC bağlantısı ve Leader Auto aktif olmalı.",Toast.LENGTH_LONG).show();
                return;
            }
            armButton.setEnabled(false);armButton.setText("LIVE BAŞLATILIYOR…");
            v9522Io.execute(()->{
                try{
                    org.json.JSONObject out=BrainHubClient.liveArm(this);
                    if(!out.optBoolean("ok",false)||!out.optBoolean("armed",false)){
                        String reason=out.optString("execution","LIVE_BLOCKED");
                        org.json.JSONArray rs=out.optJSONArray("reasons");
                        if(rs!=null&&rs.length()>0)reason=rs.optString(0,reason);
                        final String msg=reason;
                        runOnUiThread(()->{
                            Toast.makeText(this,"LIVE başlatılamadı: "+msg,Toast.LENGTH_LONG).show();
                            try{v9582PcProbeAt=0L;v9549InstallRecentTradesCard();}catch(Throwable ignored){}
                        });
                        return;
                    }
                    sp.edit().putBoolean("v9582_pc_probe_ok",true)
                        .putBoolean("v9582_pc_armed",true)
                        .putString("v9582_pc_expires_at",out.optString("expiresAt",""))
                        .putString("v9582_pc_execution",out.optString("execution",""))
                        .putLong("v9582_pc_probe_ts",System.currentTimeMillis()).apply();
                    runOnUiThread(()->{
                        Toast.makeText(this,"PC LIVE 24 saat başlatıldı.",Toast.LENGTH_LONG).show();
                        try{v9582PcProbeAt=0L;v9549InstallRecentTradesCard();}catch(Throwable ignored){}
                    });
                }catch(Throwable ex){
                    final String msg=ex.getMessage()==null?ex.getClass().getSimpleName():ex.getMessage();
                    runOnUiThread(()->{
                        Toast.makeText(this,"LIVE başlatma hatası: "+msg,Toast.LENGTH_LONG).show();
                        try{v9582PcProbeAt=0L;v9549InstallRecentTradesCard();}catch(Throwable ignored){}
                    });
                }
            });
        });
        android.widget.LinearLayout.LayoutParams alp=new android.widget.LinearLayout.LayoutParams(-1,dp(46));
        alp.setMargins(0,dp(6),0,0);box.addView(armButton,alp);

        java.util.ArrayList<V9549TradeRow> rows=v9549RecentTradeRows();
        int openShown=0;
        for(V9549TradeRow r:rows){
            v9550EnrichTradeRow(r);
            boolean open="AÇIK".equalsIgnoreCase(r.status)||"ACIK".equalsIgnoreCase(r.status)||"OPEN".equalsIgnoreCase(r.status);
            if(!open)continue;
            openShown++;
            double shownMargin=v9552OpeningMargin(r.symbol);
            if(Double.isNaN(shownMargin)||shownMargin<=0.0)shownMargin=r.margin;
            double shownPnl=v9552LiveOpenPnl(r.symbol);
            double shownRoi=(!Double.isNaN(shownPnl)&&!Double.isNaN(shownMargin)&&shownMargin>0.0)?(shownPnl/shownMargin)*100.0:Double.NaN;
            double entry=v9582PrefNumber(sp,"v9582_trade_entry_ref_"+r.symbol,"v9518_signal_price_"+r.symbol);
            double stop=v9582PrefNumber(sp,"v9582_trade_stop_"+r.symbol,"v9518_signal_stop_"+r.symbol);
            double tp1=v9582PrefNumber(sp,"v9582_trade_tp1_"+r.symbol,"v9518_signal_tp1_"+r.symbol);
            double tp2=v9582PrefNumber(sp,"v9582_trade_tp2_"+r.symbol,"v9518_signal_tp2_"+r.symbol);
            double tp3=v9582PrefNumber(sp,"v9582_trade_tp3_"+r.symbol,"v9518_signal_tp3_"+r.symbol);
            boolean stopProtected=sp.getBoolean("v9582_trade_stop_protected_"+r.symbol,false);
            boolean tpProtected=sp.getBoolean("v9582_trade_tp_protected_"+r.symbol,false);
            StringBuilder x=new StringBuilder();
            x.append("⚡ AUTO POZİSYON • ").append(r.symbol);
            if(r.side!=null&&!r.side.isEmpty())x.append(" • ").append(r.side);
            x.append("\nMarj: ").append((Double.isNaN(shownMargin)||shownMargin<=0.0)?"—":String.format(java.util.Locale.US,"%.2f USDT",shownMargin));
            x.append(" • Kaldıraç: ").append(Double.isNaN(r.leverage)?lev+"x":String.format(java.util.Locale.US,"%.0fx",r.leverage));
            x.append("\nCanlı PnL: ").append(Double.isNaN(shownPnl)?"—":v9549Fmt(shownPnl," USDT"));
            x.append(" • ROI: ").append(v9549Fmt(shownRoi,"%"));
            x.append("\nGiriş ref: ").append(v9582Level(entry));
            x.append(" • STOP: ").append(v9582Level(stop)).append(stopProtected?" ✓ KORUMALI":" • doğrulama bekliyor");
            x.append("\n").append(tpProtected?"TP AKTİF • ":"PLAN TP • ");
            x.append("TP1: ").append(v9582Level(tp1)).append(" • TP2: ").append(v9582Level(tp2)).append(" • TP3: ").append(v9582Level(tp3));
            android.widget.TextView tv=text(x.toString(),12.2f,android.graphics.Color.WHITE,true);
            tv.setPadding(dp(9),dp(7),dp(9),dp(7));
            int bg=Double.isNaN(shownPnl)?android.graphics.Color.rgb(22,36,51)
                    :(shownPnl>=0?android.graphics.Color.rgb(20,83,45):android.graphics.Color.rgb(127,29,29));
            tv.setBackgroundColor(bg);
            android.widget.LinearLayout.LayoutParams lp=new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0,dp(7),0,0);box.addView(tv,lp);
        }
        if(openShown==0){
            android.widget.TextView wait=text("Açık oto pozisyon yok • uygun sinyal oluşursa burada coin / yön / canlı PnL / STOP / TP durumları görünür.",
                    11.2f,android.graphics.Color.rgb(148,163,184),false);
            wait.setPadding(0,dp(6),0,0);
            box.addView(wait,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        }
    }'''
main=main[:a]+renderer+main[e:]
MAIN.write_text(main)

build=BUILD.read_text()
build=re.sub(r'versionCode\s+\d+','versionCode 26091831',build,count=1)
build=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.91'",build,count=1)
BUILD.write_text(build)

checks={
    'PC signal executor':'V9579_PC_LIVE_AUTO' in AUTO.read_text() and 'BrainHubClient.liveExecute(c,body)' in AUTO.read_text(),
    'old live run unreachable':'IO.execute(()->run(app,s))' not in AUTO.read_text(),
    'no signed Binance order in PC path':'runPc(app,s)' in AUTO.read_text(),
    'PC executor owner':'putString("v9576_executor_owner","PC")' in MAIN.read_text(),
    'phone live toggle enabled only with BrainHub':'en.setEnabled(BrainHubClient.configured(this))' in MAIN.read_text(),
    'phone credentials not required for auto':'if(en.isChecked())v9522Credentials()' not in MAIN.read_text(),
    'live toggle persists':'putBoolean("v9576_auto_short",sht.isChecked()).putBoolean("v9576_auto_enabled",en.isChecked())' in MAIN.read_text(),
    'emergency stop disarms PC':'ANDROID_EMERGENCY_STOP' in MAIN.read_text() and 'BrainHubClient.liveDisarm(this' in MAIN.read_text(),
    'dynamic trade settings':'requestedMarginQuote' in AUTO.read_text() and 'requestedLeverage' in AUTO.read_text() and 'requestedMaxOpenPositions' in AUTO.read_text(),
    'visible live status panel':'V9582_VISIBLE_LIVE_STATUS_PANEL' in MAIN.read_text() and 'PC LEADER AUTO TARIYOR • TAZE FIRSAT BEKLİYOR' in MAIN.read_text(),
    'active trade detail':'AUTO POZİSYON' in MAIN.read_text() and 'TP AKTİF' in MAIN.read_text() and 'KORUMALI' in MAIN.read_text(),
    'live metadata persisted':'v9582_trade_stop_protected_' in AUTO.read_text() and 'v9582_trade_tp_protected_' in AUTO.read_text() and 'v9582_trade_tp1_' in AUTO.read_text(),
    'balance summary':'V9583_BINANCE_BALANCE_SUMMARY' in MAIN.read_text() and 'v9583_pc_wallet' in MAIN.read_text() and 'v9583_pc_equity' in MAIN.read_text() and 'v9583_pc_available' in MAIN.read_text(),
    'TPs bound into LIVE intent':'takeProfit1' in AUTO.read_text() and 'takeProfit2' in AUTO.read_text() and 'takeProfit3' in AUTO.read_text() and 'stop/TP geometrisi' in AUTO.read_text(),
    'tick-safe live levels':'V9586_TICK_SAFE_LIVE_LEVELS' in AUTO.read_text() and 'PRICE_FILTER/tickSize geçersiz' in AUTO.read_text() and 'ceilStep(stop,tick)' in AUTO.read_text(),
    'safe retry':'V9587_SAFE_LIVE_RETRY' in AUTO.read_text() and 'newSingleThreadScheduledExecutor' in AUTO.read_text() and 'retryable' in AUTO.read_text(),
    'PC leader auto sync':'BrainHubClient.configureLeaderAuto(this' in MAIN.read_text() and 'v9588_pc_auto_enabled' in MAIN.read_text() and 'PC LEADER AUTO:' in MAIN.read_text(),
    'explicit mobile rearm':'V9589_MOBILE_REARM' in MAIN.read_text() and 'BrainHubClient.liveArm(this)' in MAIN.read_text() and 'LIVE 24 SAAT BAŞLAT / YENİDEN BAŞLAT' in MAIN.read_text(),
    'identity':"versionName '9.5.91'" in BUILD.read_text() and 'versionCode 26091831' in BUILD.read_text(),
}
for name,ok in checks.items(): print(('OK   ' if ok else 'FAIL '),name)
if not all(checks.values()): raise SystemExit('v9.5.91 PC LIVE bridge integration check failed')
print('v9.5.91 OK: deterministic mobile signals can request PC LIVE execution; Android does not sign Binance orders and PC arm/gates remain mandatory.')
