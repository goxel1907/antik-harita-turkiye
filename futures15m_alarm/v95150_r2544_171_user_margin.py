"""R2544.171: canonical, versioned PC sizing. No orders, account changes or mode controls."""
from pathlib import Path
import re
APP=Path('/tmp/futures15m-build/Futures15mAlarm')
J=APP/'app/src/main/java/com/futuresalarm/app'
def replace(s,old,new):
 if s.count(old)!=1:raise SystemExit('V95150 anchor mismatch: '+old[:70])
 return s.replace(old,new,1)
def method(s,signature,new):
 a=s.index(signature);b=s.index('\n    }',a)+6
 return s[:a]+new+s[b:]
c=(J/'BrainHubClient.java').read_text(encoding='utf-8')
c=replace(c,'.putString("r2544_148_kesif",status.optJSONObject("kesif")==null?"{}":status.optJSONObject("kesif").toString())',
 '.putString("r2544_171_user_sizing",status.optJSONObject("userSizing")==null?"{}":status.optJSONObject("userSizing").toString())\n            .putString("r2544_148_kesif",status.optJSONObject("kesif")==null?"{}":status.optJSONObject("kesif").toString())')
c=method(c,'    public static JSONObject syncLeaderAutoSizing(','''    public static JSONObject syncLeaderAutoSizing(Context c, double marginQuote, int leverage, int maxOpenPositions, boolean allowLong, boolean allowShort) throws Exception {
        // Periodic telemetry is read-only: stale phone preferences never write to PC.
        return leaderAutoStatus(c);
    }''')
c=method(c,'    public static JSONObject configureLeaderAuto(','''    public static JSONObject configureLeaderAuto(Context c, boolean enabled, double marginQuote, int leverage, int maxOpenPositions, boolean allowLong, boolean allowShort) throws Exception {
        // Kept only for the existing explicit emergency-stop path. Never writes sizing.
        if(enabled) throw new Exception("SIZING_REFRESH_REQUIRED");
        JSONObject body=new JSONObject();body.put("enabled",false);body.put("source","APK");
        return post(c,"/live/leader-auto",body,true);
    }
    public static JSONObject configureLeaderAuto(Context c, boolean enabled, double marginQuote, int leverage, int maxOpenPositions, boolean allowLong, boolean allowShort, String expectedRevision) throws Exception {
        JSONObject saved=setLaneSize(c,"normal",String.valueOf(marginQuote),leverage,false,expectedRevision);
        if(!saved.optBoolean("ok",false))return saved;
        JSONObject options=new JSONObject();options.put("maxOpenPositions",maxOpenPositions);
        options.put("allowLong",allowLong);options.put("allowShort",allowShort);options.put("source","APK");
        JSONObject extra=post(c,"/live/leader-auto",options,true);
        if(!extra.optBoolean("ok",false)){extra.put("marginSaved",true);extra.put("acceptedMarginQuote",saved.optDouble("marginQuote"));return extra;}
        return saved;
    }''')
c=method(c,'    public static JSONObject setLaneSize(','''    public static JSONObject setLaneSize(Context c, String lane, String margin, int leverage, boolean liveConfirm, String expectedRevision) throws Exception {
        check(c);
        JSONObject body=new JSONObject();
        double m=Double.parseDouble(margin.trim().replace(',','.'));
        if(Double.isNaN(m)||Double.isInfinite(m)||m<=0)throw new Exception("SIZING_MARGIN_INVALID");
        body.put("lane",lane);body.put("marginQuote",m);body.put("leverage",leverage);
        body.put("source","APK");body.put("expectedRevision",expectedRevision);
        JSONObject out=post(c,"/live/sizing",body,true);
        JSONObject accepted=out.optBoolean("ok",false)?out:out.optJSONObject("current");
        if(accepted!=null){
            android.content.SharedPreferences sp=c.getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);
            JSONObject all=new JSONObject(sp.getString("r2544_171_user_sizing","{}"));all.put(lane,accepted);
            sp.edit().putString("r2544_171_user_sizing",all.toString()).apply();
        }
        return out;
    }''')
m=(J/'MainActivity.java').read_text(encoding='utf-8')
beg=m.index('    private void v95136SizeDialog(');end=m.index('\n    }',beg)+6
prefix,tail=m[:beg],m[end:];m=m[beg:end]
m=replace(m,'        final String name = z5 ? "ZİRVE-5" : "İlk 3 Avcısı";',
 '        final String name = z5 ? "ZİRVE-5" : "normal".equals(lane) ? "Normal sistem" : "burst".equals(lane) ? "Vur-kaç" : "kesif".equals(lane) ? "KEŞİF-SÖZ" : "İlk 3 Avcısı";')
m=replace(m,'''        org.json.JSONObject s = z5 ? V95113PcTruth.json(sp.getString("r2544_76_z5", "{}")).optJSONObject("sizing")
                                   : V95113PcTruth.json(sp.getString("r2544_57_top3", "{}")).optJSONObject("settings");''',
 '''        org.json.JSONObject s=V95113PcTruth.json(sp.getString("r2544_171_user_sizing","{}")).optJSONObject(lane);
        final String expectedRevision=s==null?"":s.optString("revision","");
        if(expectedRevision.isEmpty()){Toast.makeText(this,"PC marj verisini yenileyin; ayar değiştirilmedi.",Toast.LENGTH_LONG).show();return;}''')
m=replace(m,'        boolean auto = z5 ? s.optBoolean("automatic", false) : s.optBoolean("marginAuto", true);','        boolean auto = !s.has("marginQuote") || s.isNull("marginQuote");')
m=replace(m,'eM.setHint("Marj USDT (5 ve üstü; boş = riske göre)")','eM.setHint("Pozitif marj USDT — bakiye olmasa da kaydedilir")')
m=replace(m,'if (lev < 10 || lev > 20)', 'if (lev < (("normal".equals(lane)||"burst".equals(lane))?1:10) || lev > ("burst".equals(lane)?25:20))')
m=replace(m,'if (!m.isEmpty() && !(mv >= 5 && mv <= 100000))','if (!(mv > 0) || Double.isInfinite(mv))')
m=replace(m,'final Runnable upd = () -> prev.setText(V95113PcTruth.v95136SizePreview(eM.getText().toString(), eL.getText().toString(), medStop, maxStop, wallet, avail));','final Runnable upd = () -> prev.setText((z5 || "top3".equals(lane)) ? V95113PcTruth.v95136SizePreview(eM.getText().toString(), eL.getText().toString(), medStop, maxStop, wallet, avail) : "Marj teminattır. Bakiye olmasa da tercih kaydedilir; stop ve işlem uygunluğu sinyal geldiğinde kendi hattında hesaplanır.");')
m=replace(m,'BrainHubClient.setLaneSize(this, lane, m, fl, live)','BrainHubClient.setLaneSize(this, lane, m, fl, false, expectedRevision)')
old='res = out.optBoolean("ok", false) ? (name + ": " + (m.isEmpty() ? "riske göre" : m + " USDT") + " × " + fl + "x kaydedildi") : ("Yapılmadı: " + V95113PcTruth.reasons(out));'
new='res = out.optBoolean("ok", false) ? (name + ": PC kalıcı marj " + out.optDouble("marginQuote") + " USDT × " + out.optInt("leverage") + "x kaydedildi") : ("Kaydedilmedi: " + V95113PcTruth.reasons(out) + " • güncel PC değerini kontrol edip pencereyi yeniden açın.");'
m=replace(m,old,new)
m=replace(m,'Marj 5 USDT ve üstü olmalı (boş = riske göre).','Geçerli pozitif marj yazın. Bakiye yalnız işlem açarken kontrol edilir.')
m=prefix+m+tail
# Insert extra lane controls immediately after the existing two-button row is attached.
needle='        card.addView(rowSize, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));'
extra='''        for(String sizeLane:new String[]{"normal","burst","kesif"}){
            final String selectedSizeLane=sizeLane;
            Button sizeButton=button(("normal".equals(sizeLane)?"Normal sistem":"burst".equals(sizeLane)?"Vur-kaç":"KEŞİF-SÖZ")+": marj / kaldıraç",android.graphics.Color.rgb(45,55,72));
            sizeButton.setOnClickListener(v->v95136SizeDialog(selectedSizeLane));
            card.addView(sizeButton,new android.widget.LinearLayout.LayoutParams(-1,-2));
        }
'''
m=replace(m,needle,needle+'\n'+extra)
# Freeze the dialog's version, not a refreshed version at the time of Save.
sig='    private void v9576ShowAutoSettings(){'
m=replace(m,sig,sig+"""
        final org.json.JSONObject normalSizing=V95113PcTruth.json(getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE).getString("r2544_171_user_sizing","{}")).optJSONObject("normal");
        if(normalSizing==null||normalSizing.optString("revision","").isEmpty()){Toast.makeText(this,"PC marj verisini yenileyin; ayar değiştirilmedi.",Toast.LENGTH_LONG).show();return;}
        final String sizingRevision=normalSizing.optString("revision","");
""")
m=replace(m,'mg.setText(sp.getString("v9576_auto_margin",sp.getString("v9522_last_margin","")));lv.setText(sp.getString("v9576_auto_leverage",sp.getString("v9522_last_leverage","")));',
 'mg.setText(String.valueOf(normalSizing.optDouble("marginQuote")));lv.setText(String.valueOf(normalSizing.optInt("leverage")));')
m=replace(m,'setTitle("🤖 CANLI OTO İŞLEM / BEYİN")','setTitle("Normal sistem — PC marjı ve ayarlar")')
m=replace(m,'BrainHubClient.configureLeaderAuto(this,v95113AutoOn,margin,lev,max,lng.isChecked(),sht.isChecked())',
 'BrainHubClient.configureLeaderAuto(this,v95113AutoOn,margin,lev,max,lng.isChecked(),sht.isChecked(),sizingRevision)')
m=m.replace('return status; // V95150','return status; // V95150')

m=replace(m,'en.setEnabled(BrainHubClient.configured(this));en.setText("Normal sistem (JEV) açık • PC\'deki durum (yalnız işareti değiştirirsen açar/kapatır; açmak için Hatlar kartını kullan)");','en.setEnabled(false);en.setText("Normal sistem PC durumudur; aç/kapat Hatlar kartından. Kaydet yalnız ayarları saklar.");')
# The older Normal dialog must not claim success before PC acceptance.
m=replace(m,'Toast.makeText(this,"Ayar kaydedildi • Normal sistem (JEV): "+(v95113AutoOn?"AÇIK":"KAPALI")+" • İlk 3 / ZİRVE-5 ve CANLI durumu değişmez",Toast.LENGTH_LONG).show();',
 'Toast.makeText(this,"PC marj onayı bekleniyor; henüz kaydedildi sayılmaz.",Toast.LENGTH_LONG).show();')
m=replace(m,'org.json.JSONObject cfg=BrainHubClient.configureLeaderAuto(this,v95113AutoOn,margin,lev,max,lng.isChecked(),sht.isChecked(),sizingRevision);',
 'org.json.JSONObject cfg=BrainHubClient.configureLeaderAuto(this,v95113AutoOn,margin,lev,max,lng.isChecked(),sht.isChecked(),sizingRevision);\n                            if(cfg.optBoolean("ok",false))runOnUiThread(()->Toast.makeText(this,"PC kalıcı Normal marj: "+cfg.optDouble("marginQuote")+" USDT × "+cfg.optInt("leverage")+"x kaydedildi",Toast.LENGTH_LONG).show());')
m=m.replace('eM.setText(V95113PcTruth.v95135R(curM))','eM.setText(String.valueOf(curM))')
m=m.replace('String.format(java.util.Locale.US, "%.0f USDT", curM)','String.valueOf(curM)+" USDT"')

m=m.replace('"Kaydedilmedi: " + V95113PcTruth.reasons(out) + " • güncel PC değerini kontrol edip pencereyi yeniden açın."',
 '"Kaydedilmedi: " + V95113PcTruth.reasons(out) + (out.optJSONObject("current")==null?"":" • PC marjı "+out.optJSONObject("current").optDouble("marginQuote")+" USDT") + " • pencereyi yeniden açıp inceleyin."')
m+='\n// V95150_R2544_171_USER_MARGIN — versioned PC settings; no order permission.\n'
(J/'BrainHubClient.java').write_text(c,encoding='utf-8')
(J/'MainActivity.java').write_text(m,encoding='utf-8')
p=APP/'app/build.gradle';s=p.read_text(encoding='utf-8')
s=re.sub(r'versionCode\s+(\d+)',lambda x:'versionCode '+str(int(x.group(1))+1),s,count=1)
s=re.sub(r"versionName\s+'[^']+'","versionName '9.5.143-r2544.171-marj'",s,count=1)
p.write_text(s,encoding='utf-8')
print('V95150_R2544_171_USER_MARGIN_OK (source generation, not Android compilation)')
