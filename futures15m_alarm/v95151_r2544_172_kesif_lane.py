"""R2544.172: expose PC-authoritative selected lanes and KEŞİF-SÖZ real-entry control.
Source generation only; never connects to PC or changes any runtime preference.
"""
from pathlib import Path
import os,re
APP=Path('/tmp/futures15m-build/Futures15mAlarm')
J=APP/'app/src/main/java/com/futuresalarm/app'
m=(J/'MainActivity.java').read_text(encoding='utf-8')
p=(J/'V95113PcTruth.java').read_text(encoding='utf-8')
def replace(s,a,b,count=1):
 if s.count(a)!=count:raise RuntimeError('V95151 source anchor mismatch: '+a[:70])
 return s.replace(a,b)
for var,key,name in [('normalLabel','normal','Normal sistem (JEV)'),('top3Label','top3','İlk 3 Avcısı'),('z5Label','zirve5','ZİRVE-5')]:
 a=re.search(r'        String '+var+r' = .*?;\n',m)
 if not a:raise RuntimeError('Missing lane label '+var)
 m=replace(m,a.group(0),'        String '+var+' = V95113PcTruth.v95151LaneLabel(sp, "'+key+'", "'+name+'", now);\n')
needle='        org.json.JSONObject v95142N = lanes == null ? null : lanes.optJSONObject("normal");'
m=replace(m,needle,'        String kesifLabel = V95113PcTruth.v95151LaneLabel(sp, "kesif", "KEŞİF-SÖZ gerçek giriş izni", now);\n'+needle)
needle='                android.view.View bz = v.findViewWithTag("v95135_btn_z5");'
m=replace(m,needle,'                android.view.View bk = v.findViewWithTag("v95151_btn_kesif");\n                if (bk instanceof Button) { ((Button) bk).setText(kesifLabel); bk.setEnabled(lanes != null && lanes.optJSONObject("kesif") != null && V95113PcTruth.v95151Fresh(sp,now)); }\n'+needle)
needle='        card.addView(bZ5, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));'
m=replace(m,needle,needle+r'''
        Button bKesif = button(kesifLabel, android.graphics.Color.rgb(45, 65, 88));
        bKesif.setTag("v95151_btn_kesif");
        bKesif.setEnabled(lanes != null && lanes.optJSONObject("kesif") != null && V95113PcTruth.v95151Fresh(sp,now));
        bKesif.setOnClickListener(v -> v95151KesifLane());
        card.addView(bKesif, new android.widget.LinearLayout.LayoutParams(-1,-2));
        card.addView(text("KEŞİF gölge tahmin / öğrenim ayrı çalışır. KEŞİF-SÖZ seçimi yalnız yeni işlem giriş iznidir; seçili olmak emir açıldığı anlamına gelmez.",11.5f,android.graphics.Color.rgb(160,175,190),false));
''')
method=r'''
    private void v95151KesifLane() {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        final org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        final org.json.JSONObject lane = lanes == null ? null : lanes.optJSONObject("kesif");
        if (!V95113PcTruth.v95151Fresh(sp,System.currentTimeMillis()) || lane == null || !lane.has("selected")) {
            Toast.makeText(this,"KEŞİF-SÖZ güncel PC seçimi doğrulanamadı; PC durumunu yenileyin.",Toast.LENGTH_LONG).show(); return;
        }
        final boolean on=lane.optBoolean("selected",false),live="LIVE".equals(lanes.optString("mode",""));
        final String msg=on?"Yalnız yeni KEŞİF-SÖZ girişleri kapatılsın mı?\n\nGölge öğrenim ve açık pozisyon yönetimi sürer; diğer hatlar ve marj değişmez."
            : "KEŞİF-SÖZ yeni giriş izni açılsın mı?\n\n"+(live?"CANLI: PC uygun tahminde GERÇEK PARA ile emir açabilir.":"TEST: sanal işlem hattıdır.")+"\n\nKendi PC marj tercihi kullanılır; bakiye, stop ve güvenlik kontrolleri ayrıca geçmelidir.";
        new AlertDialog.Builder(this).setTitle("KEŞİF-SÖZ gerçek giriş izni").setMessage(msg)
            .setPositiveButton(on?"YENİ GİRİŞİ KAPAT":live?"AÇ - GERÇEK PARA":"AÇ",(d,w)->v95132Io.execute(()->{
                String res;
                try {
                    org.json.JSONObject out=BrainHubClient.selectLane(this, "kesif", !on, live && !on);
                    org.json.JSONObject all=out.optJSONObject("lanes");
                    org.json.JSONObject accepted=all==null?null:all.optJSONObject("kesif");
                    boolean ok=out.optBoolean("ok",false)&&accepted!=null&&accepted.has("selected")&&accepted.optBoolean("selected",on)==!on;
                    res=ok?"PC onayı: KEŞİF-SÖZ "+(!on?"SEÇİLİ":"SEÇİLİ DEĞİL")+"; gölge öğrenim ve açık pozisyon yönetimi sürer."
                        :"Seçim doğrulanamadı: "+V95113PcTruth.reasons(out);
                }catch(Throwable e){res="PC seçimi değiştiği doğrulanamadı: "+V95113PcTruth.err(e);}
                v95132Done(sp,res);
            })).setNegativeButton("Vazgeç",null).show();
    }
'''
needle='    private void v95135Z5Lane() {'
m=replace(m,needle,method+'\n'+needle)
helpers=r'''
    static boolean v95151Fresh(SharedPreferences sp,long now) {
        long at=sp==null?0:sp.getLong("r2544_57_status_ts",0L);
        return at>0 && now>=at && now-at<=30000L;
    }
    static String v95151LaneLabel(SharedPreferences sp,String key,String name,long now) {
        JSONObject lanes=json(sp==null?"{}":sp.getString("r2544_57_run","{}")).optJSONObject("lanes");
        JSONObject lane=lanes==null?null:lanes.optJSONObject(key);
        if(!v95151Fresh(sp,now)||lane==null||!lane.has("selected"))return name+": PC SEÇİMİ DOĞRULANAMADI";
        boolean selected=lane.optBoolean("selected",false);
        return name+": "+(selected?"✓ SEÇİLİ":"SEÇİLİ DEĞİL")+(selected?(lane.optBoolean("active",false)?" • PC hattı açık; sinyal/güvenlik beklenir":" • bekliyor: "+lane.optString("gate","başlatma veya hat koşulları")):"");
    }
'''
i=p.rfind('\n}');assert i>0
p=p[:i]+helpers+p[i:]
# Also refresh the primary summary from the same authoritative lane record.
m=replace(m,'String bodyText = V95113PcTruth.lanesText(sp, now);','String bodyText = V95113PcTruth.lanesText(sp, now) + "\\n" + V95113PcTruth.v95151LaneLabel(sp, "kesif", "KEŞİF-SÖZ", now);')
(J/'MainActivity.java').write_text(m,encoding='utf-8')
(J/'V95113PcTruth.java').write_text(p,encoding='utf-8')
f=APP/'app/build.gradle';s=f.read_text(encoding='utf-8')
s=re.sub(r'versionCode\s+(\d+)',lambda x:'versionCode '+str(int(x.group(1))+1),s,count=1)
s=re.sub(r"versionName\s+'[^']+'","versionName '9.5.144-r2544.172-kesif'",s,count=1)
f.write_text(s,encoding='utf-8')
print('V95151_R2544_172_KESIF_LANE_SOURCE_OK')
