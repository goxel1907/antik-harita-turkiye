from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'; BUILD=APP/'app/build.gradle'
for p in (MAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.43c missing '+str(p))

def bounds(src, sig):
    a=src.find(sig)
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

m=MAIN.read_text()
for x in ('private void v9522ShowTradeTicket(String symbol)',
          'private void v9522PrepareOrder(String symbol, String side, String reason, long signalTs,',
          'private void v9522FinalConfirm(V9522OrderDraft d, long signalTs)',
          'private void v9522ExecuteOrder(V9522OrderDraft d, long signalTs)',
          'V9543B_NOTIFICATION_TICKET_LOCK'):
    if x not in m: raise SystemExit('v9.5.43c missing marker: '+x)

# Main-screen saved margin/leverage control. No order is sent from this control.
if 'V9543C_QUICK_SETTINGS_BUTTON' not in m:
    a='        root.addView(v9522ApiButton, v9522ApiLp);'
    if a not in m: raise SystemExit('v9.5.43c API button anchor missing')
    m=m.replace(a,a+r'''

        // V9543C_QUICK_SETTINGS_BUTTON
        Button v9543cQuickCfg=button("⚡ HIZLI EMİR AYARI\nMarj / kaldıraç kaydet • geç giriş kilidi %0,50",Color.rgb(126,74,18));
        v9543cQuickCfg.setOnClickListener(v -> v9543cShowQuickSettings());
        LinearLayout.LayoutParams v9543cLp=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(64));
        v9543cLp.setMargins(0,0,0,dp(18));root.addView(v9543cQuickCfg,v9543cLp);''',1)

# In the existing trade ticket, the single positive click becomes the explicit
# approval. It still goes through v9522PrepareOrder and every existing guard.
b=bounds(m,'    private void v9522ShowTradeTicket(String symbol)')
if not b: raise SystemExit('v9.5.43c trade ticket bounds missing')
a,_,e=b;t=m[a:e]
if 'V9543C_SINGLE_TAP_APPROVAL' not in t:
    old='''                        sp.edit().putString("v9522_last_margin", v9522P(mg))\n                                .putString("v9522_last_leverage", Integer.toString(lv)).apply();\n                        v9522PrepareOrder(symbol, side, reason, ts, entry, stop, t1, t2, t3, mg, lv);'''
    new='''                        // V9543C_SINGLE_TAP_APPROVAL\n                        sp.edit().putString("v9522_last_margin", v9522P(mg))\n                                .putString("v9522_last_leverage", Integer.toString(lv))\n                                .putLong("v9543c_quick_signal_ts_" + symbol, ts)\n                                .putString("v9543c_quick_side_" + symbol, side == null ? "" : side)\n                                .putLong("v9543c_quick_approved_at_" + symbol, System.currentTimeMillis()).apply();\n                        v9522PrepareOrder(symbol, side, reason, ts, entry, stop, t1, t2, t3, mg, lv);'''
    if old not in t: raise SystemExit('v9.5.43c trade-ticket approval anchor missing')
    t=t.replace(old,new,1)
    t=t.replace('.setPositiveButton("EMRİ HAZIRLA",', '.setPositiveButton("⚡ ONAYLA & GÖNDER",',1)
    t=t.replace('"Marj × kaldıraç = yaklaşık pozisyon büyüklüğü. Emir kendi kendine gönderilmez; ikinci ekranda son onay gerekir. TP dağılımı %33 / %33 / %34\'tür."',
                '"Marj × kaldıraç = yaklaşık pozisyon büyüklüğü. Bu düğmeye basmanız açık emir onayıdır; fiyat ve risk kontrolleri geçmeden emir gönderilmez. TP dağılımı %33 / %33 / %34\'tür."',1)
    m=m[:a]+t+m[e:]

# If preparation rejects the setup (late price, stale signal, geometry, API...),
# clear the short-lived approval token immediately.
b=bounds(m,'    private void v9522PrepareOrder(String symbol, String side, String reason, long signalTs,')
if not b: raise SystemExit('v9.5.43c prepare bounds missing')
a,_,e=b;p=m[a:e]
if 'V9543C_CLEAR_APPROVAL_ON_REJECT' not in p:
    old='''            } catch (Throwable ex) {\n                runOnUiThread(() -> Toast.makeText(this, "EMİR HAZIRLANMADI: " + ex.getMessage(), Toast.LENGTH_LONG).show());'''
    new='''            } catch (Throwable ex) {\n                // V9543C_CLEAR_APPROVAL_ON_REJECT\n                v9543cClearQuickApproval(symbol, signalTs);\n                runOnUiThread(() -> Toast.makeText(this, "EMİR HAZIRLANMADI: " + ex.getMessage(), Toast.LENGTH_LONG).show());'''
    if old not in p: raise SystemExit('v9.5.43c prepare reject anchor missing')
    p=p.replace(old,new,1);m=m[:a]+p+m[e:]

# Consume exact-signal approval once. If not present/valid, preserve the old
# second-confirmation dialog as a safe fallback.
b=bounds(m,'    private void v9522FinalConfirm(V9522OrderDraft d, long signalTs)')
if not b: raise SystemExit('v9.5.43c final confirm bounds missing')
a,_,e=b;f=m[a:e]
if 'V9543C_CONSUME_SINGLE_TAP' not in f:
    brace=f.find('{')
    ins=r'''
        // V9543C_CONSUME_SINGLE_TAP
        if (v9543cConsumeQuickApproval(d.symbol,d.side,signalTs)) {
            Toast.makeText(this,"⚡ Hızlı onay doğrulandı • emir gönderiliyor",Toast.LENGTH_SHORT).show();
            v9522ExecuteOrder(d,signalTs);
            return;
        }
'''
    f=f[:brace+1]+ins+f[brace+1:];m=m[:a]+f+m[e:]

# Final price/geometry recheck immediately before the MARKET order. This closes
# the race between preparation and execution and keeps the hard %0.50 chase cap.
b=bounds(m,'    private void v9522ExecuteOrder(V9522OrderDraft d, long signalTs)')
if not b: raise SystemExit('v9.5.43c execute bounds missing')
a,_,e=b;x=m[a:e]
if 'V9543C_EXECUTION_DRIFT_RECHECK' not in x:
    anchor='                java.util.LinkedHashMap<String,String> lp = new java.util.LinkedHashMap<>();\n'
    if anchor not in x: raise SystemExit('v9.5.43c leverage anchor missing')
    guard=r'''                // V9543C_EXECUTION_DRIFT_RECHECK
                java.util.LinkedHashMap<String,String> qpx=new java.util.LinkedHashMap<>();qpx.put("symbol",d.symbol);
                double px=Double.parseDouble(new org.json.JSONObject(v9522Http("GET","/fapi/v1/ticker/price",qpx,false)).getString("price"));
                double dv=Math.abs(px-d.entryRef)/d.entryRef*100.0;
                if(dv>0.50)throw new Exception(String.format(java.util.Locale.US,"Emir anında fiyat referanstan %%.2f uzaklaştı (sınır %%0.50). Geç giriş engellendi.",dv));
                boolean qlong="LONG".equalsIgnoreCase(d.side);
                if((qlong&&px<=d.stop)||(!qlong&&px>=d.stop))throw new Exception("Emir anında fiyat STOP/geçersizlik tarafına geçti.");
                if(qlong&&!(d.stop<px&&px<d.tp1&&d.tp1<d.tp2&&d.tp2<d.tp3))throw new Exception("Emir anında LONG STOP/TP geometrisi geçersizleşti.");
                if(!qlong&&!(d.stop>px&&px>d.tp1&&d.tp1>d.tp2&&d.tp2>d.tp3))throw new Exception("Emir anında SHORT STOP/TP geometrisi geçersizleşti.");

'''
    x=x.replace(anchor,guard+anchor,1);m=m[:a]+x+m[e:]

if 'private void v9543cShowQuickSettings()' not in m:
    i=m.rfind('}')
    if i<0:raise SystemExit('v9.5.43c MainActivity close missing')
    h=r'''

    // V9543C_QUICK_HELPERS
    private void v9543cShowQuickSettings(){
        android.content.SharedPreferences sp=v9522Prefs();
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(16),dp(8),dp(16),dp(4));
        box.addView(text("Bu ayar yalnız hızlı emir ekranını doldurur. Emir kendiliğinden gönderilmez. Maksimum giriş sapması sabit %0,50.",12.5f,Color.rgb(203,213,225),false));
        EditText mg=v9522Input("Varsayılan marj (USDT)",false),lv=v9522Input("Varsayılan kaldıraç (1-125)",false);
        mg.setInputType(android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);lv.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        mg.setText(sp.getString("v9522_last_margin",""));lv.setText(sp.getString("v9522_last_leverage",""));
        LinearLayout.LayoutParams ep=new LinearLayout.LayoutParams(-1,dp(52));ep.setMargins(0,dp(10),0,0);box.addView(mg,ep);box.addView(lv,ep);
        new android.app.AlertDialog.Builder(this).setTitle("⚡ HIZLI EMİR AYARI").setView(box).setNegativeButton("KAPAT",null).setPositiveButton("KAYDET",(d,w)->{
            try{double a=Double.parseDouble(mg.getText().toString().trim());int b=Integer.parseInt(lv.getText().toString().trim());if(!(a>0)||b<1||b>125)throw new Exception("Marj > 0 ve kaldıraç 1-125 olmalı.");sp.edit().putString("v9522_last_margin",v9522P(a)).putString("v9522_last_leverage",Integer.toString(b)).apply();Toast.makeText(this,"Hızlı emir ayarı kaydedildi: "+v9522P(a)+" USDT • "+b+"x",Toast.LENGTH_LONG).show();}
            catch(Throwable ex){Toast.makeText(this,"Ayar kaydedilmedi: "+ex.getMessage(),Toast.LENGTH_LONG).show();}
        }).show();
    }

    private void v9543cClearQuickApproval(String symbol,long ts){
        if(symbol==null||symbol.trim().isEmpty())return;android.content.SharedPreferences sp=v9522Prefs();long s=sp.getLong("v9543c_quick_signal_ts_"+symbol,0L);if(ts>0&&s>0&&s!=ts)return;
        sp.edit().remove("v9543c_quick_signal_ts_"+symbol).remove("v9543c_quick_side_"+symbol).remove("v9543c_quick_approved_at_"+symbol).apply();
    }

    private boolean v9543cConsumeQuickApproval(String symbol,String side,long ts){
        if(symbol==null||side==null)return false;android.content.SharedPreferences sp=v9522Prefs();long s=sp.getLong("v9543c_quick_signal_ts_"+symbol,0L),at=sp.getLong("v9543c_quick_approved_at_"+symbol,0L);String sd=sp.getString("v9543c_quick_side_"+symbol,"");long age=System.currentTimeMillis()-at;
        boolean ok=s==ts&&ts>0&&at>0&&age>=0&&age<=15000L&&sd!=null&&sd.trim().equalsIgnoreCase(side.trim())&&sp.getBoolean("v9518_signal_active_"+symbol,false)&&sp.getLong("v9518_signal_time_"+symbol,0L)==ts;
        sp.edit().remove("v9543c_quick_signal_ts_"+symbol).remove("v9543c_quick_side_"+symbol).remove("v9543c_quick_approved_at_"+symbol).apply();return ok;
    }
'''
    m=m[:i]+h+'\n'+m[i:]

m=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.43',m)
m=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.43  •  MANUEL PRO',m)
MAIN.write_text(m)
b=BUILD.read_text();b=re.sub(r'versionCode\s+\d+','versionCode 26091307',b,count=1);b=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.43'",b,count=1);BUILD.write_text(b)

m=MAIN.read_text();b=BUILD.read_text()
checks={
 '43b notification lock':'v9543b_strict_ticket_' in m,
 'quick settings':'V9543C_QUICK_SETTINGS_BUTTON' in m and 'HIZLI EMİR AYARI' in m,
 'single explicit approval':'V9543C_SINGLE_TAP_APPROVAL' in m and '⚡ ONAYLA & GÖNDER' in m,
 'exact one-use token':'v9543c_quick_signal_ts_' in m and 'v9543cConsumeQuickApproval' in m and 'age<=15000L' in m,
 'old final confirm fallback':'SON EMİR ONAYI' in m,
 'prepare chase guard':'dev > 0.50' in m,
 'execution chase guard':'V9543C_EXECUTION_DRIFT_RECHECK' in m and 'dv>0.50' in m,
 'stop+tp':'STOP_MARKET' in m and m.count('TAKE_PROFIT_MARKET')>=3,
 'duplicate locks':'v9522_order_inflight_' in m and 'v9522_order_sent_signal_' in m,
 'version code':'versionCode 26091307' in b,
 'version name':"versionName '9.5.43'" in b,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.43c sanity failed: '+', '.join(bad))
print('v9.5.43c OK: one-tap explicit approval + final execution late-entry recheck; no unattended auto-order.')
