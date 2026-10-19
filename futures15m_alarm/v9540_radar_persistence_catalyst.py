from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
CATALYST = JAVA / 'V9540CatalystIntel.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.40 missing required generated file: ' + str(p))

def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

# ---------------------------------------------------------------------------
# V9.5.40 CATALYST / ATTENTION INTELLIGENCE
# Public, keyless discovery context. This is deliberately NOT a trade signal.
# Sources fail open: if unavailable, catalyst contribution is zero/PUANSIZ.
# ---------------------------------------------------------------------------
catalyst = r'''package com.futuresalarm.app;

final class V9540CatalystIntel {
    static final String PREFS = "v9540_catalyst_intel";
    static final String KEY_DOCS = "docs_json";
    static final String KEY_STATUS = "status";
    static final long REFRESH_MS = 5L * 60L * 1000L;
    private static volatile V9540CatalystIntel INSTANCE;

    static final class Snapshot {
        final int score, sources, ageMin;
        final String state, headline, flags;
        Snapshot(int score, int sources, int ageMin, String state, String headline, String flags) {
            this.score=score; this.sources=sources; this.ageMin=ageMin;
            this.state=state; this.headline=headline; this.flags=flags;
        }
    }

    private static final class Doc {
        String title="", source="", url="";
        long at;
        Doc() {}
        Doc(String t,String s,String u,long a){title=t==null?"":t;source=s==null?"":s;url=u==null?"":u;at=a;}
    }

    private final android.content.Context app;
    private final okhttp3.OkHttpClient client;
    private final java.util.concurrent.ScheduledExecutorService scheduler =
            java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    private volatile java.util.List<Doc> docs = java.util.Collections.emptyList();
    private volatile boolean refreshing;

    private static final java.util.Set<String> AMBIG = new java.util.HashSet<>(
            java.util.Arrays.asList("ONE","ID","GAS","HOT","KEY","MASK","MAGIC","PEOPLE","POWER","HIGH","1000SATS","SATS"));
    private static final String[] EVENT_WORDS = new String[]{
            "BURN","BURNING","LISTING","LISTED","LAUNCH","MAINNET","UPGRADE","PARTNERSHIP","PARTNER",
            "AIRDROP","BUYBACK","TOKENOMICS","MIGRATION","MIGRATE","FORK","STAKING","UNSTAKE",
            "DELIST","DELISTING","EXPLOIT","HACK","SECURITY","SHUTDOWN","CLOSES","CLOSURE","VOTE","PROPOSAL"
    };

    static void start(android.content.Context context) {
        if(context==null)return;
        if(INSTANCE==null) synchronized(V9540CatalystIntel.class) {
            if(INSTANCE==null) INSTANCE=new V9540CatalystIntel(context.getApplicationContext());
        }
    }

    static Snapshot snapshot(android.content.Context context,String symbol) {
        start(context);
        V9540CatalystIntel x=INSTANCE;
        return x==null?new Snapshot(0,0,-1,"PUANSIZ","NONE","NONE"):x.snapshotNow(symbol);
    }

    static int score(android.content.Context context,String symbol) {
        return snapshot(context,symbol).score;
    }

    static String status(android.content.Context context) {
        if(context==null)return "PUANSIZ";
        start(context);
        return context.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE)
                .getString(KEY_STATUS,"HAZIRLANIYOR");
    }

    private V9540CatalystIntel(android.content.Context app) {
        this.app=app;
        this.client=new okhttp3.OkHttpClient.Builder()
                .connectTimeout(8,java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(12,java.util.concurrent.TimeUnit.SECONDS)
                .callTimeout(25,java.util.concurrent.TimeUnit.SECONDS)
                .retryOnConnectionFailure(true).build();
        loadCache();
        scheduler.scheduleWithFixedDelay(this::refresh,1500L,REFRESH_MS,java.util.concurrent.TimeUnit.MILLISECONDS);
    }

    private void loadCache() {
        try {
            String raw=app.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE).getString(KEY_DOCS,"");
            if(raw==null||raw.isEmpty())return;
            org.json.JSONArray a=new org.json.JSONArray(raw);
            java.util.ArrayList<Doc> out=new java.util.ArrayList<>();
            for(int i=0;i<a.length();i++){
                org.json.JSONObject j=a.optJSONObject(i); if(j==null)continue;
                out.add(new Doc(j.optString("title",""),j.optString("source",""),j.optString("url",""),j.optLong("at",0)));
            }
            docs=out;
        } catch(Throwable ignored) {}
    }

    private void refresh() {
        synchronized(this){if(refreshing)return;refreshing=true;}
        java.util.ArrayList<Doc> out=new java.util.ArrayList<>();
        java.util.ArrayList<String> ok=new java.util.ArrayList<>();
        try {
            try { loadGdelt(out); if(!out.isEmpty())ok.add("GDELT"); } catch(Throwable ignored) {}
            int before=out.size();
            try { loadReddit(out,"CryptoCurrency"); loadReddit(out,"CryptoMarkets"); } catch(Throwable ignored) {}
            if(out.size()>before)ok.add("REDDIT_RSS");
            dedupe(out);
            if(out.size()>320) out=new java.util.ArrayList<>(out.subList(0,320));
            if(!out.isEmpty()) {
                docs=out;
                persist(out, ok.isEmpty()?"KAYNAK_KISMI":"OK_"+join(ok));
            } else {
                app.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE).edit()
                        .putString(KEY_STATUS,"PUANSIZ_KAYNAK_YOK").apply();
            }
        } finally { refreshing=false; }
    }

    private void loadGdelt(java.util.List<Doc> out)throws java.io.IOException {
        String u="https://api.gdeltproject.org/api/v2/doc/doc?query=%28crypto%20OR%20cryptocurrency%20OR%20blockchain%20OR%20token%29&mode=ArtList&maxrecords=250&format=json&timespan=3h&sort=DateDesc";
        String body=get(u,"Futures15mAlarmPRO/9.5.40 catalyst");
        try {
            org.json.JSONObject root=new org.json.JSONObject(body);
            org.json.JSONArray a=root.optJSONArray("articles"); if(a==null)return;
            for(int i=0;i<a.length();i++){
                org.json.JSONObject j=a.optJSONObject(i); if(j==null)continue;
                String title=j.optString("title","").trim(); if(title.length()<8)continue;
                String domain=j.optString("domain","GDELT");
                long at=parseGdelt(j.optString("seendate",""));
                out.add(new Doc(title,"GDELT:"+domain,j.optString("url",""),at));
            }
        } catch(org.json.JSONException e) { throw new java.io.IOException("GDELT JSON",e); }
    }

    private void loadReddit(java.util.List<Doc> out,String sub)throws java.io.IOException {
        String body=get("https://www.reddit.com/r/"+sub+"/new/.rss?limit=100","Futures15mAlarmPRO/9.5.40 (+public RSS)");
        try {
            org.xmlpull.v1.XmlPullParser p=android.util.Xml.newPullParser();
            p.setInput(new java.io.StringReader(body));
            int event=p.getEventType(); boolean inEntry=false; String title=null,link=null;
            while(event!=org.xmlpull.v1.XmlPullParser.END_DOCUMENT){
                if(event==org.xmlpull.v1.XmlPullParser.START_TAG){
                    String n=p.getName();
                    if("entry".equalsIgnoreCase(n)||"item".equalsIgnoreCase(n)){inEntry=true;title=null;link=null;}
                    else if(inEntry&&"title".equalsIgnoreCase(n))title=p.nextText();
                    else if(inEntry&&"link".equalsIgnoreCase(n)){
                        String href=p.getAttributeValue(null,"href");
                        link=href!=null?href:p.nextText();
                    }
                } else if(event==org.xmlpull.v1.XmlPullParser.END_TAG){
                    String n=p.getName();
                    if("entry".equalsIgnoreCase(n)||"item".equalsIgnoreCase(n)){
                        if(title!=null&&title.trim().length()>8)out.add(new Doc(title.trim(),"REDDIT:r/"+sub,link,System.currentTimeMillis()));
                        inEntry=false;
                    }
                }
                event=p.next();
            }
        } catch(org.xmlpull.v1.XmlPullParserException e) { throw new java.io.IOException("Reddit RSS XML",e); }
    }

    private String get(String url,String ua)throws java.io.IOException {
        okhttp3.Request q=new okhttp3.Request.Builder().url(url).header("User-Agent",ua).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){
            if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            return r.body().string();
        }
    }

    private void dedupe(java.util.ArrayList<Doc> a) {
        java.util.HashSet<String> seen=new java.util.HashSet<>();
        java.util.Iterator<Doc> it=a.iterator();
        while(it.hasNext()){
            Doc d=it.next(); String k=d.title.toLowerCase(java.util.Locale.US).replaceAll("\\s+"," ").trim();
            if(k.isEmpty()||!seen.add(k))it.remove();
        }
        java.util.Collections.sort(a,(x,y)->Long.compare(y.at,x.at));
    }

    private void persist(java.util.List<Doc> a,String status) {
        try {
            org.json.JSONArray j=new org.json.JSONArray();
            for(Doc d:a){org.json.JSONObject x=new org.json.JSONObject();x.put("title",d.title);x.put("source",d.source);x.put("url",d.url);x.put("at",d.at);j.put(x);}
            app.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE).edit()
                    .putString(KEY_DOCS,j.toString()).putString(KEY_STATUS,status).putLong("updated_at",System.currentTimeMillis()).apply();
        } catch(Throwable ignored) {}
    }

    private Snapshot snapshotNow(String futuresSymbol) {
        String base=base(futuresSymbol);
        if(base.isEmpty())return new Snapshot(0,0,-1,"PUANSIZ","NONE","NONE");
        long now=System.currentTimeMillis(), newest=0;
        int raw=0, mentions=0;
        java.util.HashSet<String> sourceKinds=new java.util.HashSet<>();
        java.util.LinkedHashSet<String> flags=new java.util.LinkedHashSet<>();
        String headline="NONE";
        java.util.List<Doc> copy=docs;
        for(Doc d:copy){
            Match m=match(d.title,base); if(!m.hit)continue;
            long age=d.at>0?Math.max(0,now-d.at):0;
            if(age>12L*60L*60L*1000L)continue;
            mentions++;
            newest=Math.max(newest,d.at);
            if("NONE".equals(headline))headline=d.title;
            String kind=d.source.startsWith("REDDIT")?"REDDIT":"NEWS";
            sourceKinds.add(kind);
            int pts=m.explicit?14:9;
            if(age<=60L*60L*1000L)pts+=8; else if(age<=3L*60L*60L*1000L)pts+=4;
            if(d.source.toLowerCase(java.util.Locale.US).contains("binance"))pts+=10;
            if("REDDIT".equals(kind))pts=Math.max(4,pts-5);
            String up=d.title.toUpperCase(java.util.Locale.US);
            for(String w:EVENT_WORDS)if(up.contains(w)){pts+=4;flagFor(w,flags);}
            raw+=Math.min(28,pts);
        }
        if(mentions>=3)raw+=8;
        if(mentions>=6)raw+=8;
        int score=Math.max(0,Math.min(100,raw));
        int ageMin=newest>0?(int)Math.min(9999,Math.max(0,(now-newest)/60000L)):-1;
        String state=score>=60?"GUCLU_KATALIZOR":score>=30?"ARTAN_ILGI":score>=12?"ERKEN_ILGI":"NONE";
        if(copy.isEmpty())state="PUANSIZ";
        return new Snapshot(score,sourceKinds.size(),ageMin,state,clip(headline,150),flags.isEmpty()?"NONE":join(flags));
    }

    private static final class Match { boolean hit,explicit; Match(boolean h,boolean e){hit=h;explicit=e;} }
    private Match match(String title,String base) {
        if(title==null)return new Match(false,false);
        String u=title.toUpperCase(java.util.Locale.US);
        boolean explicit=u.contains("$"+base)||u.contains(base+"USDT")||u.contains("("+base+")")||u.contains("["+base+"]");
        if(explicit)return new Match(true,true);
        if(base.length()<3||AMBIG.contains(base))return new Match(false,false);
        try {
            boolean hit=java.util.regex.Pattern.compile("(^|[^A-Z0-9])"+java.util.regex.Pattern.quote(base)+"([^A-Z0-9]|$)").matcher(u).find();
            return new Match(hit,false);
        } catch(Throwable t){return new Match(false,false);}
    }

    private static String base(String s) {
        if(s==null)return "";
        String x=s.trim().toUpperCase(java.util.Locale.US);
        if(x.endsWith("USDT"))x=x.substring(0,x.length()-4);
        if(x.startsWith("1000")&&x.length()>4)x=x.substring(4);
        return x;
    }

    private static void flagFor(String w,java.util.Set<String> f){
        if(w.startsWith("BURN")||"BUYBACK".equals(w)||"TOKENOMICS".equals(w)||"VOTE".equals(w)||"PROPOSAL".equals(w))f.add("TOKENOMICS");
        else if(w.contains("LIST"))f.add("LISTING");
        else if("EXPLOIT".equals(w)||"HACK".equals(w)||"SECURITY".equals(w))f.add("SECURITY");
        else if("MAINNET".equals(w)||"UPGRADE".equals(w)||"FORK".equals(w)||w.startsWith("MIGRAT")||w.startsWith("SHUT")||"CLOSES".equals(w)||"CLOSURE".equals(w))f.add("NETWORK");
        else if("PARTNERSHIP".equals(w)||"PARTNER".equals(w))f.add("PARTNERSHIP");
        else if("AIRDROP".equals(w)||"STAKING".equals(w)||"UNSTAKE".equals(w))f.add("INCENTIVE");
        else f.add("EVENT");
    }

    private static long parseGdelt(String s){
        if(s==null||s.isEmpty())return System.currentTimeMillis();
        String[] fmts={"yyyyMMdd'T'HHmmss'Z'","yyyyMMddHHmmss"};
        for(String f:fmts)try{
            java.text.SimpleDateFormat d=new java.text.SimpleDateFormat(f,java.util.Locale.US);
            d.setTimeZone(java.util.TimeZone.getTimeZone("UTC")); java.util.Date x=d.parse(s); if(x!=null)return x.getTime();
        }catch(Throwable ignored){}
        return System.currentTimeMillis();
    }

    private static String clip(String s,int n){if(s==null)return "NONE";s=s.replaceAll("\\s+"," ").trim();return s.length()<=n?s:s.substring(0,n-1)+"…";}
    private static String join(java.util.Collection<String> a){StringBuilder b=new StringBuilder();for(String s:a){if(b.length()>0)b.append(',');b.append(s);}return b.toString();}
}
'''
CATALYST.write_text(catalyst)

# ---------------------------------------------------------------------------
# Patch radar engine: early-candidate universe + catalyst context.
# ---------------------------------------------------------------------------
eng = ENGINE.read_text()
eng = eng.replace('v9.5.39 MARKET RADAR','v9.5.40 MARKET RADAR')
eng = eng.replace('--- V9.5.39 APK MARKET RADAR BAĞLAMI ---','--- V9.5.40 APK MARKET RADAR BAĞLAMI ---')

if 'V9540CatalystIntel.start(context);' not in eng:
    anchor='        if (context == null) return;\n'
    if anchor not in eng:
        raise SystemExit('v9.5.40 radar start anchor missing')
    eng=eng.replace(anchor,anchor+'        V9540CatalystIntel.start(context);\n',1)

eng=eng.replace('if(t.rank<4||t.rank>24) continue;','if(t.rank<4||t.rank>120) continue;')
old='t.preScore=65*close+20*rangePos(t)+15*clamp(vel/0.006,-1,1);'
new='double cat=V9540CatalystIntel.score(app,t.symbol)/100.0;\n                t.preScore=42*close+18*rangePos(t)+24*clamp(vel/0.006,-1,1)+30*cat;'
if old not in eng:
    raise SystemExit('v9.5.40 preScore anchor missing')
eng=eng.replace(old,new,1)
eng=eng.replace('if(pool.size()>10) pool=new java.util.ArrayList<>(pool.subList(0,10));',
                'if(pool.size()>14) pool=new java.util.ArrayList<>(pool.subList(0,14));',1)

old='if("EXHAUSTION".equals(d.stage))x-=12;else if("LATE_EXPANSION".equals(d.stage))x-=5;\n        return (int)Math.round(clamp(x,0,100));'
new='if("EXHAUSTION".equals(d.stage))x-=12;else if("LATE_EXPANSION".equals(d.stage))x-=5;\n        x+=15*clamp(V9540CatalystIntel.score(app,t.symbol)/100.0,0,1);\n        return (int)Math.round(clamp(x,0,100));'
if old not in eng:
    raise SystemExit('v9.5.40 score anchor missing')
eng=eng.replace(old,new,1)

anchor='            j.put("downPath",path(r.d.ssl,r.d.down2,"SSL","HTF_LOW"));\n'
if anchor not in eng:
    raise SystemExit('v9.5.40 persist anchor missing')
if 'catalystScore' not in eng:
    eng=eng.replace(anchor,anchor+r'''            V9540CatalystIntel.Snapshot ci=V9540CatalystIntel.snapshot(app,r.t.symbol);
            j.put("catalystScore",ci.score);j.put("catalystSources",ci.sources);j.put("catalystAgeMin",ci.ageMin);
            j.put("catalystState",ci.state);j.put("catalystHeadline",ci.headline);j.put("catalystFlags",ci.flags);
''',1)

anchor='                s.append("DOWN_PATH: ").append(r.optString("downPath","NONE")).append(\'\\n\');\n'
if anchor not in eng:
    raise SystemExit('v9.5.40 prompt catalyst anchor missing')
if 'CATALYST_SCORE:' not in eng:
    eng=eng.replace(anchor,anchor+r'''                s.append("CATALYST_SCORE: ").append(r.optInt("catalystScore",0)).append("/100\n");
                s.append("CATALYST_STATE: ").append(r.optString("catalystState","PUANSIZ")).append('\n');
                s.append("CATALYST_SOURCES: ").append(r.optInt("catalystSources",0)).append(" • yaş ").append(r.optInt("catalystAgeMin",-1)).append(" dk\n");
                s.append("CATALYST_FLAGS: ").append(r.optString("catalystFlags","NONE")).append('\n');
                s.append("CATALYST_HEADLINE: ").append(r.optString("catalystHeadline","NONE")).append('\n');
                s.append("CATALYST_KURAL: Haber/sosyal ilgi yalnız keşif ve bağlamdır; 15m kapanmış mum, yapı, invalidation ve R/R kapılarını bypass edemez. Kaynak yoksa PUANSIZ.\n");
''',1)

ENGINE.write_text(eng)

# ---------------------------------------------------------------------------
# Radar UI.
# ---------------------------------------------------------------------------
r = RADAR.read_text()
r = r.replace('FUTURES RADAR • v9.5.39','FUTURES RADAR • v9.5.40')
r = r.replace('Radar keşif ekranıdır; gerçek işlem kararı için analiz paketi gerekir.',
              'Radar teknik + katalizör keşif ekranıdır; haber/sosyal ilgi işlem sinyali değildir. Gerçek karar için analiz paketi gerekir.')
old='card.addView(txt("24s "+f(change)+"% • Radar "+score+"/100 • "+stage+"\\n15m hacim "+f(r.optDouble("volRatio",Double.NaN))+"x • OI15 "+f(r.optDouble("oiChange15",Double.NaN))+"% • RSI "+f(r.optDouble("rsi15",Double.NaN))+"\\n"+sweep+" • "+r.optString("upPath","NONE")+" | "+r.optString("downPath","NONE"),14,android.graphics.Color.rgb(215,225,238),false));'
if old not in r:
    old='card.addView(txt("24s "+f(change)+"% • TOP3_ENTRY "+score+"/100 • "+stage+"\\n15m hacim "+f(r.optDouble("volRatio",Double.NaN))+"x • OI15 "+f(r.optDouble("oiChange15",Double.NaN))+"% • RSI "+f(r.optDouble("rsi15",Double.NaN))+"\\n"+sweep+" • "+r.optString("upPath","NONE")+" | "+r.optString("downPath","NONE"),14,android.graphics.Color.rgb(215,225,238),false));'
new='card.addView(txt("24s "+f(change)+"% • Radar "+score+"/100 • "+stage+"\\n15m hacim "+f(r.optDouble("volRatio",Double.NaN))+"x • OI15 "+f(r.optDouble("oiChange15",Double.NaN))+"% • RSI "+f(r.optDouble("rsi15",Double.NaN))+"\\n"+sweep+" • "+r.optString("upPath","NONE")+" | "+r.optString("downPath","NONE")+"\\n🧠 Katalizör "+r.optInt("catalystScore",0)+"/100 • "+r.optString("catalystState","PUANSIZ")+" • "+r.optInt("catalystSources",0)+" kaynak • "+r.optString("catalystFlags","NONE")+"\\n"+r.optString("catalystHeadline","NONE"),14,android.graphics.Color.rgb(215,225,238),false));'
if old not in r:
    raise SystemExit('v9.5.40 radar card text anchor missing')
r=r.replace(old,new,1)
RADAR.write_text(r)

# ---------------------------------------------------------------------------
# MainActivity persistence fix.
# ---------------------------------------------------------------------------
m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.40',m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.40  •  MANUEL PRO',m)

if 'private void v9540InstallRadarPersistence()' not in m:
    idx=m.rfind('}')
    if idx<0: raise SystemExit('v9.5.40 MainActivity closing brace missing')
    helper=r'''
    // V9540_RADAR_PERSISTENCE
    private static final String V9540_RADAR_TAG="v9540_futures_radar_card";
    private boolean v9540RadarEnsuring=false;
    private boolean v9540RadarObserverInstalled=false;

    private void v9540InstallRadarPersistence() {
        if(v9540RadarObserverInstalled)return;
        v9540RadarObserverInstalled=true;
        try {
            final android.view.ViewGroup content=findViewById(android.R.id.content);
            if(content==null)return;
            content.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
                if(!v9540RadarEnsuring)content.post(this::v9540EnsureRadarCard);
            });
            content.post(this::v9540EnsureRadarCard);
        } catch(Throwable ignored) {}
    }

    private void v9540EnsureRadarCard() {
        if(v9540RadarEnsuring)return;
        v9540RadarEnsuring=true;
        try {
            android.view.ViewGroup content=findViewById(android.R.id.content);
            if(content==null||content.getChildCount()==0)return;
            android.view.View base=content.getChildAt(0);
            android.widget.LinearLayout root=null;
            if(base instanceof android.widget.ScrollView){
                android.widget.ScrollView sv=(android.widget.ScrollView)base;
                if(sv.getChildCount()>0&&sv.getChildAt(0) instanceof android.widget.LinearLayout)
                    root=(android.widget.LinearLayout)sv.getChildAt(0);
            } else if(base instanceof android.widget.LinearLayout) root=(android.widget.LinearLayout)base;
            if(root==null)return;

            android.view.View radar=root.findViewWithTag(V9540_RADAR_TAG);
            if(radar==null){
                radar=v9540FindRadar(root);
                if(radar!=null){
                    android.view.ViewParent p=radar.getParent();
                    if(p instanceof android.view.ViewGroup)((android.view.ViewGroup)p).removeView(radar);
                } else {
                    android.widget.Button b=new android.widget.Button(this);
                    b.setAllCaps(false);
                    radar=b;
                }
                radar.setTag(V9540_RADAR_TAG);
                if(radar instanceof android.widget.TextView){
                    android.widget.TextView t=(android.widget.TextView)radar;
                    t.setText("📡 FUTURES RADAR\n8 coin • TOP 3 + 5 güçlü aday • teknik + katalizör");
                    t.setTextSize(17);t.setTextColor(android.graphics.Color.WHITE);
                    t.setBackgroundColor(android.graphics.Color.rgb(12,86,126));
                    t.setGravity(android.view.Gravity.CENTER);
                }
                radar.setOnClickListener(v->startActivity(new android.content.Intent(this,MarketRadarActivity.class)));
                int api=-1,analysis=-1;
                for(int i=0;i<root.getChildCount();i++){
                    android.view.View c=root.getChildAt(i);
                    if(v9539HasText(c,"BINANCE API / EMİR"))api=i;
                    if(v9539HasText(c,"ANALİZ PAKETİ"))analysis=i;
                }
                int pos=api>=0?api:(analysis>=0?analysis+1:root.getChildCount());
                pos=Math.max(0,Math.min(pos,root.getChildCount()));
                android.widget.LinearLayout.LayoutParams lp=new android.widget.LinearLayout.LayoutParams(-1,dp(72));
                lp.setMargins(0,dp(8),0,dp(8));
                root.addView(radar,pos,lp);
            }
        } catch(Throwable ignored) {
        } finally {
            v9540RadarEnsuring=false;
        }
    }

    private android.view.View v9540FindRadar(android.view.View v){
        if(v==null)return null;
        if(v instanceof android.widget.TextView){
            CharSequence t=((android.widget.TextView)v).getText();
            if(t!=null&&(t.toString().contains("FUTURES RADAR")||t.toString().contains("8 COİN RADARI")))return v;
        }
        if(v instanceof android.view.ViewGroup){
            android.view.ViewGroup g=(android.view.ViewGroup)v;
            for(int i=0;i<g.getChildCount();i++){
                android.view.View x=v9540FindRadar(g.getChildAt(i));if(x!=null)return x;
            }
        }
        return null;
    }
'''
    m=m[:idx]+helper+m[idx:]

b=method_bounds(m,'protected void onCreate(')
if not b: raise SystemExit('v9.5.40 onCreate missing')
a,_,e=b
body=m[a:e]
if 'V9540_INSTALL_RADAR_PERSISTENCE' not in body:
    anchor='v9539MoveRadarCard();'
    if anchor not in body:
        anchor='v9538InstallMarketRadarButton();'
    if anchor not in body:
        raise SystemExit('v9.5.40 radar install anchor missing in onCreate')
    body=body.replace(anchor,anchor+'\n        // V9540_INSTALL_RADAR_PERSISTENCE\n        v9540InstallRadarPersistence();',1)
    m=m[:a]+body+m[e:]

if 'V9540_AFTER_BUILDUI_REBUILD' not in m:
    pat=r'setContentView\s*\(\s*buildUi\(\)\s*\)\s*;'
    matches=list(re.finditer(pat,m))
    if not matches: raise SystemExit('v9.5.40 buildUi setContentView missing')
    m=re.sub(pat,lambda q:q.group(0)+'\n        // V9540_AFTER_BUILDUI_REBUILD\n        try { getWindow().getDecorView().post(this::v9540EnsureRadarCard); } catch(Throwable ignored) {}',m)

b=method_bounds(m,'protected void onResume(')
if b:
    a,_,e=b; body=m[a:e]
    if 'V9540_RESUME_RADAR_PERSISTENCE' not in body:
        p=body.rfind('}')
        body=body[:p]+'        // V9540_RESUME_RADAR_PERSISTENCE\n        try { v9540EnsureRadarCard(); } catch(Throwable ignored) {}\n'+body[p:]
        m=m[:a]+body+m[e:]

MAIN.write_text(m)

mon=MON.read_text()
mon=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.40',mon)
if 'V9540_CATALYST_SERVICE_START' not in mon:
    b=method_bounds(mon,'void onCreate()')
    if not b: raise SystemExit('v9.5.40 MonitorService onCreate missing')
    a,_,e=b; body=mon[a:e]; bi=body.find('{')
    body=body[:bi+1]+'\n        // V9540_CATALYST_SERVICE_START\n        V9540CatalystIntel.start(this);\n'+body[bi+1:]
    mon=mon[:a]+body+mon[e:]
MON.write_text(mon)

an=ANALYSIS.read_text()
an=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.40',an)
an=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.40',an)
ANALYSIS.write_text(an)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091303',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.40'",bf,count=1)
BUILD.write_text(bf)

main=MAIN.read_text(); eng=ENGINE.read_text(); rad=RADAR.read_text(); mon=MON.read_text(); ana=ANALYSIS.read_text(); build=BUILD.read_text()
checks={
    'radar persistence helper':'V9540_RADAR_PERSISTENCE' in main and 'v9540EnsureRadarCard' in main,
    'radar observer installed':'V9540_INSTALL_RADAR_PERSISTENCE' in main and 'addOnGlobalLayoutListener' in main,
    'rebuild safety':'V9540_AFTER_BUILDUI_REBUILD' in main,
    'legacy dashboard retained':'PORTFÖY / 24 SAAT' in main and 'v9527InstallTopDashboard' in main,
    'catalyst class':CATALYST.exists() and 'GDELT' in CATALYST.read_text() and 'REDDIT_RSS' in CATALYST.read_text(),
    'catalyst radar start':'V9540CatalystIntel.start(context)' in eng,
    'early candidate range':'t.rank>120' in eng,
    'catalyst score in radar':'catalystScore' in eng and 'Katalizör' in rad,
    'catalyst prompt':'CATALYST_SCORE:' in eng and 'CATALYST_KURAL:' in eng,
    'monitor catalyst':'V9540_CATALYST_SERVICE_START' in mon,
    'virtual lifecycle retained':'v9518UpdateSignalResult' in mon and 'v9518Finish' in mon,
    'analysis radar context retained':'V9538_RADAR_PROMPT_CONTEXT' in ana,
    'version code':'versionCode 26091303' in build,
    'version name':"versionName '9.5.40'" in build,
}
for name,ok in checks.items():print(('OK   ' if ok else 'FAIL '),name)
bad=[name for name,ok in checks.items() if not ok]
if bad: raise SystemExit('v9.5.40 sanity failed: '+', '.join(bad))
print('v9.5.40 OK: persistent Futures Radar + public catalyst/news/social discovery context.')
