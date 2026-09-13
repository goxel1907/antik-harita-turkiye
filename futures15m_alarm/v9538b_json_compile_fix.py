from pathlib import Path
import re

ENGINE = Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app/V9538MarketRadarEngine.java')

if not ENGINE.exists():
    raise SystemExit('v9.5.38b missing generated radar engine: ' + str(ENGINE))

src = ENGINE.read_text()

old = '''    private org.json.JSONArray getArray(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            return new org.json.JSONArray(r.body().string());}
    }
    private org.json.JSONObject getObject(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            return new org.json.JSONObject(r.body().string());}
    }
'''

new = '''    private org.json.JSONArray getArray(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){
            if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            String body=r.body().string();
            try{return new org.json.JSONArray(body);}
            catch(org.json.JSONException e){throw new java.io.IOException("Invalid JSON array from "+p,e);}
        }
    }
    private org.json.JSONObject getObject(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){
            if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            String body=r.body().string();
            try{return new org.json.JSONObject(body);}
            catch(org.json.JSONException e){throw new java.io.IOException("Invalid JSON object from "+p,e);}
        }
    }
'''

if old not in src:
    if 'catch(org.json.JSONException e)' in src:
        print('v9.5.38b already applied.')
    else:
        raise SystemExit('v9.5.38b JSON method anchor not found')
else:
    src = src.replace(old, new, 1)
    ENGINE.write_text(src)

out = ENGINE.read_text()
checks = {
    'array JSON checked exception wrapped': 'Invalid JSON array from' in out,
    'object JSON checked exception wrapped': 'Invalid JSON object from' in out,
    'two JSONException catches': out.count('catch(org.json.JSONException e)') >= 2,
    'radar engine retained': 'BINANCE_TOP3_PLUS_5' in out,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)

bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.38b sanity failed: ' + ', '.join(bad))

print('v9.5.38b OK: Android org.json checked JSONException is wrapped as IOException.')

# v9.5.39 USER-FRIENDLY RADAR UI
APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, RADAR, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.39 missing generated file: ' + str(p))

m = MAIN.read_text()
if 'private void v9539MoveRadarCard()' not in m:
    idx = m.rfind('}')
    if idx < 0:
        raise SystemExit('v9.5.39 MainActivity closing brace missing')
    helper = r'''
    private void v9539MoveRadarCard() {
        try {
            android.view.ViewGroup content=findViewById(android.R.id.content);
            if(content==null||content.getChildCount()==0)return;
            android.view.View base=content.getChildAt(0);
            android.widget.LinearLayout root=null;
            if(base instanceof android.widget.ScrollView){
                android.widget.ScrollView sv=(android.widget.ScrollView)base;
                if(sv.getChildCount()>0&&sv.getChildAt(0) instanceof android.widget.LinearLayout)
                    root=(android.widget.LinearLayout)sv.getChildAt(0);
            }else if(base instanceof android.widget.LinearLayout)root=(android.widget.LinearLayout)base;
            if(root==null)return;
            android.view.View radar=null;
            int api=-1, analysis=-1;
            for(int i=0;i<root.getChildCount();i++){
                android.view.View c=root.getChildAt(i);
                if(v9539HasText(c,"8 COİN RADARI")||v9539HasText(c,"FUTURES RADAR"))radar=c;
                if(v9539HasText(c,"BINANCE API / EMİR"))api=i;
                if(v9539HasText(c,"ANALİZ PAKETİ"))analysis=i;
            }
            if(radar==null)return;
            if(radar instanceof android.widget.TextView){
                android.widget.TextView t=(android.widget.TextView)radar;
                t.setText("📡 FUTURES RADAR\n8 coin • TOP 3 + 5 güçlü aday • dokun: aç");
                t.setTextSize(17);t.setTextColor(android.graphics.Color.WHITE);
                t.setBackgroundColor(android.graphics.Color.rgb(12,86,126));
            }
            root.removeView(radar);
            int pos=api>=0?api:(analysis>=0?analysis+1:root.getChildCount());
            pos=Math.max(0,Math.min(pos,root.getChildCount()));
            android.widget.LinearLayout.LayoutParams lp=new android.widget.LinearLayout.LayoutParams(-1,dp(72));
            lp.setMargins(0,dp(8),0,dp(8));
            root.addView(radar,pos,lp);
        }catch(Throwable ignored){}
    }
    private boolean v9539HasText(android.view.View v,String needle){
        if(v==null||needle==null)return false;
        if(v instanceof android.widget.TextView){
            CharSequence t=((android.widget.TextView)v).getText();
            if(t!=null&&t.toString().contains(needle))return true;
        }
        if(v instanceof android.view.ViewGroup){
            android.view.ViewGroup g=(android.view.ViewGroup)v;
            for(int i=0;i<g.getChildCount();i++)if(v9539HasText(g.getChildAt(i),needle))return true;
        }
        return false;
    }
'''
    m = m[:idx] + helper + m[idx:]

if 'v9539MoveRadarCard();' not in m:
    anchor = '        v9538InstallMarketRadarButton();'
    if anchor not in m:
        raise SystemExit('v9.5.39 v9538 radar install call missing')
    m = m.replace(anchor, anchor + '\n        v9539MoveRadarCard();', 1)

m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.39',m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.39  •  MANUEL PRO',m)
MAIN.write_text(m)

r = RADAR.read_text()
r = r.replace('📡 8 COİN MARKET RADARI • v9.5.38','📡 FUTURES RADAR • v9.5.39')
r = r.replace('Binance USDⓈ-M mevcut TOP3 + ilk 3\'e yaklaşabilecek 5 güçlü aday. Radar puanı işlem sinyali değildir; hangi coin için ayrıntılı paket hazırlayacağımızı seçer.',
              'Binance USDⓈ-M • TOP 3 + ilk 3\'e girebilecek 5 güçlü aday. Radar keşif ekranıdır; gerçek işlem kararı için analiz paketi gerekir.')
r = r.replace('ŞİMDİ YENİLE','↻ ŞİMDİ TARA')
r = r.replace('PROMPT + GRAFİK','ANALİZ PAKETİ')
r = r.replace('RADAR BAĞLAMI','BAĞLAMI KOPYALA')
r = r.replace('TOP3_ENTRY ','Radar ')
r = r.replace('Son radar: "+age+" sn önce • 3 TOP + 5 ADAY','Son tarama: "+age+" sn önce • 3 TOP + 5 ADAY • otomatik 60 sn')
if 'V9539_RADAR_USAGE_HINT' not in r:
    anchor = 'root.addView(status);'
    if anchor not in r:
        raise SystemExit('v9.5.39 radar status anchor missing')
    r = r.replace(anchor, anchor + r'''
        // V9539_RADAR_USAGE_HINT
        android.widget.TextView usage=txt("Kullanım: coin seç → ANALİZ PAKETİ → ChatGPT → 14 alanlı plan kodu → MANUEL PRO",13,android.graphics.Color.rgb(140,165,195),false);
        usage.setPadding(0,dp(5),0,dp(4));root.addView(usage);''', 1)
RADAR.write_text(r)

mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.39',mon)
MON.write_text(mon)

an = ANALYSIS.read_text()
an = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.39',an)
an = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.39',an)
ANALYSIS.write_text(an)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+','versionCode 26091302',bf,count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.39'",bf,count=1)
BUILD.write_text(bf)

eng = ENGINE.read_text().replace('v9.5.38 MARKET RADAR','v9.5.39 MARKET RADAR')
eng = eng.replace('--- V9.5.38 APK MARKET RADAR BAĞLAMI ---','--- V9.5.39 APK MARKET RADAR BAĞLAMI ---')
ENGINE.write_text(eng)

final_checks = {
    'main radar moved': 'v9539MoveRadarCard();' in MAIN.read_text() and 'BINANCE API / EMİR' in MAIN.read_text(),
    'radar title': 'FUTURES RADAR • v9.5.39' in RADAR.read_text(),
    'radar workflow hint': 'V9539_RADAR_USAGE_HINT' in RADAR.read_text(),
    'analysis button': 'ANALİZ PAKETİ' in RADAR.read_text(),
    'version code': 'versionCode 26091302' in BUILD.read_text(),
    'version name': "versionName '9.5.39'" in BUILD.read_text(),
}
for name, ok in final_checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
failed=[name for name,ok in final_checks.items() if not ok]
if failed:
    raise SystemExit('v9.5.39 sanity failed: ' + ', '.join(failed))
print('v9.5.39 OK: Futures Radar main-card placement + friendlier radar workflow.')

# v9.5.40 chain: persistent radar + public catalyst/news/social discovery.
v9540 = Path(__file__).with_name('v9540_radar_persistence_catalyst.py')
if not v9540.exists():
    raise SystemExit('v9.5.40 patch missing: ' + str(v9540))
exec(compile(v9540.read_text(), str(v9540), 'exec'), {'__name__':'__main__','__file__':str(v9540)})
