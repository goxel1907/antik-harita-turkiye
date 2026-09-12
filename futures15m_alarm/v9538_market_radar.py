from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'
BUILD = APP / 'app/build.gradle'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
RADAR = JAVA / 'MarketRadarActivity.java'

for p in (MAIN, MON, ANALYSIS, MANIFEST, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.38 missing required file: ' + str(p))

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

engine = r'''package com.futuresalarm.app;

/**
 * v9.5.38 MARKET RADAR.
 * Current Binance USD-M top-3 gainers + five sticky candidates from ranks 4..24.
 * Discovery score is NOT a trade signal and cannot bypass the existing 15m core.
 * The implementation is independent Java; no third-party source code is copied.
 */
final class V9538MarketRadarEngine {
    static final String PREFS = "v9538_market_radar";
    static final String KEY_JSON = "radar_json";
    private static final String BASE = "https://fapi.binance.com";
    private static final long REFRESH_MS = 60_000L;
    private static volatile V9538MarketRadarEngine INSTANCE;

    private final android.content.Context app;
    private final okhttp3.OkHttpClient client;
    private final java.util.concurrent.ScheduledExecutorService scheduler =
            java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    private final java.util.HashMap<String, Double> previousPrice = new java.util.HashMap<>();
    private final java.util.ArrayList<String> stickyCandidates = new java.util.ArrayList<>();
    private final java.util.HashMap<String, Long> stageSince = new java.util.HashMap<>();
    private final java.util.HashMap<String, String> lastStage = new java.util.HashMap<>();
    private volatile java.util.Set<String> perpetuals = java.util.Collections.emptySet();
    private volatile long perpetualsAt;
    private volatile boolean refreshing;

    static void start(android.content.Context context) {
        if (context == null) return;
        if (INSTANCE == null) synchronized (V9538MarketRadarEngine.class) {
            if (INSTANCE == null) INSTANCE = new V9538MarketRadarEngine(context.getApplicationContext());
        }
    }

    static void requestRefresh(android.content.Context context) {
        start(context);
        if (INSTANCE != null) INSTANCE.scheduler.execute(INSTANCE::refresh);
    }

    static String latestJson(android.content.Context context) {
        if (context == null) return "";
        start(context);
        return context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
                .getString(KEY_JSON, "");
    }

    static String promptContext(android.content.Context context, String symbol) {
        if (context == null || symbol == null) return "";
        String want = symbol.trim().toUpperCase(java.util.Locale.US);
        try {
            org.json.JSONObject root = new org.json.JSONObject(latestJson(context));
            org.json.JSONArray rows = root.optJSONArray("rows");
            if (rows == null) return "";
            for (int i=0; i<rows.length(); i++) {
                org.json.JSONObject r = rows.optJSONObject(i);
                if (r == null || !want.equals(r.optString("symbol"))) continue;
                StringBuilder s = new StringBuilder();
                s.append("--- V9.5.38 APK MARKET RADAR BAĞLAMI ---\n");
                s.append("RADAR_ROLE: ").append(r.optString("role","N/A")).append('\n');
                s.append("BINANCE_24H_RANK: ").append(r.optInt("rank",-1)).append('\n');
                s.append("CHANGE_24H: ").append(f2(r.optDouble("change24",Double.NaN))).append("%\n");
                s.append("TOP3_ENTRY_SCORE: ").append(r.optInt("score",0))
                        .append("/100 (yalnız keşif sıralaması; trade sinyali değildir)\n");
                s.append("MOVE_STAGE: ").append(r.optString("stage","N/A")).append('\n');
                s.append("MOVE_AGE: ").append(r.optInt("moveAgeMin",0)).append(" dk\n");
                s.append("EXTENSION_15M_ATR: ").append(f2(r.optDouble("extensionAtr",Double.NaN))).append('\n');
                s.append("VOL15_RATIO: ").append(f2(r.optDouble("volRatio",Double.NaN))).append("x\n");
                s.append("OI_15M_CHANGE: ").append(f2(r.optDouble("oiChange15",Double.NaN))).append("%\n");
                s.append("RSI15: ").append(f2(r.optDouble("rsi15",Double.NaN))).append('\n');
                s.append("SWEEP_STATE: ").append(r.optString("sweep","NONE")).append('\n');
                s.append("NEAREST_BSL: ").append(r.optString("bsl","NONE")).append('\n');
                s.append("NEAREST_SSL: ").append(r.optString("ssl","NONE")).append('\n');
                s.append("UP_PATH: ").append(r.optString("upPath","NONE")).append('\n');
                s.append("DOWN_PATH: ").append(r.optString("downPath","NONE")).append('\n');
                s.append("RADAR_KURAL: TOP3_ENTRY_SCORE ana karar değildir. LATE_EXPANSION/EXHAUSTION durumunda fiyat kovalanmaz. Sweep tek başına dönüş sayılmaz; tamamlanmış mum kabul/reddetme ve sonraki yapı ile doğrulanır. UP_PATH/DOWN_PATH kesin gelecek değil, koşullu continuation/rejection haritasıdır.\n\n");
                return s.toString();
            }
        } catch (Throwable ignored) {}
        return "";
    }

    private V9538MarketRadarEngine(android.content.Context app) {
        this.app = app;
        client = new okhttp3.OkHttpClient.Builder()
                .connectTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .callTimeout(40, java.util.concurrent.TimeUnit.SECONDS)
                .retryOnConnectionFailure(true).build();
        scheduler.scheduleWithFixedDelay(this::refresh, 2_000L, REFRESH_MS,
                java.util.concurrent.TimeUnit.MILLISECONDS);
    }

    private static final class Candle {
        long closeTime;
        double h,l,c,qv;
    }
    private static final class Ticker {
        String symbol;
        int rank;
        double change24,last,high24,low24,quoteVolume,preScore;
    }
    private static final class Detail {
        String structure="GEÇİŞ", sweep="NONE", stage="GEÇİŞ";
        double extensionAtr=Double.NaN,rsi15=Double.NaN,volRatio=Double.NaN,oiChange15=Double.NaN;
        double mom5,mom15,bsl=Double.NaN,ssl=Double.NaN,up2=Double.NaN,down2=Double.NaN;
    }
    private static final class Row {
        Ticker t; Detail d; String role; int score,moveAgeMin;
    }

    private void refresh() {
        synchronized (this) { if (refreshing) return; refreshing=true; }
        try {
            ensurePerpetuals();
            java.util.ArrayList<Ticker> all = loadTickers();
            if (all.size() < 8) return;
            java.util.Collections.sort(all,(a,b)->Double.compare(b.change24,a.change24));
            for(int i=0;i<all.size();i++) all.get(i).rank=i+1;

            java.util.ArrayList<Ticker> top = new java.util.ArrayList<>(all.subList(0,Math.min(3,all.size())));
            double thirdPct=top.get(top.size()-1).change24;
            java.util.ArrayList<Ticker> pool=new java.util.ArrayList<>();
            for(Ticker t:all){
                if(t.rank<4||t.rank>24) continue;
                double close=thirdPct>0?clamp(t.change24/thirdPct,0,1.2):0;
                double vel=velocity(t.symbol,t.last);
                t.preScore=65*close+20*rangePos(t)+15*clamp(vel/0.006,-1,1);
                pool.add(t);
            }
            java.util.Collections.sort(pool,(a,b)->Double.compare(b.preScore,a.preScore));
            if(pool.size()>10) pool=new java.util.ArrayList<>(pool.subList(0,10));

            java.util.HashMap<String,Detail> details=new java.util.HashMap<>();
            for(Ticker t:top) details.put(t.symbol,loadDetail(t));
            for(Ticker t:pool) if(!details.containsKey(t.symbol)) details.put(t.symbol,loadDetail(t));

            java.util.ArrayList<Row> topRows=new java.util.ArrayList<>();
            for(Ticker t:top) topRows.add(makeRow(t,details.get(t.symbol),"TOP3",thirdPct));
            java.util.ArrayList<Row> candidates=new java.util.ArrayList<>();
            for(Ticker t:pool) candidates.add(makeRow(t,details.get(t.symbol),"ADAY",thirdPct));
            java.util.Collections.sort(candidates,(a,b)->Integer.compare(b.score,a.score));
            candidates=stickyFive(candidates);

            java.util.ArrayList<Row> rows=new java.util.ArrayList<>(topRows);
            rows.addAll(candidates);
            persist(rows);
            for(Ticker t:all) previousPrice.put(t.symbol,t.last);
        } catch(Throwable t) {
            app.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE).edit()
                    .putString("last_error",t.getClass().getSimpleName()+": "+String.valueOf(t.getMessage())).apply();
        } finally { refreshing=false; }
    }

    private Row makeRow(Ticker t, Detail d, String role, double thirdPct) {
        Row r=new Row(); r.t=t; r.d=d==null?new Detail():d; r.role=role;
        r.score=score(t,r.d,thirdPct);
        long now=System.currentTimeMillis();
        String old=lastStage.get(t.symbol);
        if(old==null||!old.equals(r.d.stage)) stageSince.put(t.symbol,now);
        lastStage.put(t.symbol,r.d.stage);
        Long since=stageSince.get(t.symbol);
        r.moveAgeMin=(int)Math.max(0,(now-(since==null?now:since))/60_000L);
        return r;
    }

    private java.util.ArrayList<Row> stickyFive(java.util.ArrayList<Row> ranked) {
        java.util.ArrayList<Row> sel=new java.util.ArrayList<>();
        java.util.HashMap<String,Row> by=new java.util.HashMap<>();
        for(Row r:ranked) by.put(r.t.symbol,r);
        for(String s:stickyCandidates){Row r=by.get(s);if(r!=null&&sel.size()<5)sel.add(r);}
        for(Row r:ranked){if(sel.size()>=5)break;if(!has(sel,r.t.symbol))sel.add(r);}
        for(Row c:ranked){
            if(has(sel,c.t.symbol))continue;
            int low=-1,ls=101;
            for(int i=0;i<sel.size();i++)if(sel.get(i).score<ls){ls=sel.get(i).score;low=i;}
            if(low>=0&&c.score>=ls+7)sel.set(low,c);
        }
        java.util.Collections.sort(sel,(a,b)->Integer.compare(b.score,a.score));
        stickyCandidates.clear();for(Row r:sel)stickyCandidates.add(r.t.symbol);
        return sel;
    }
    private static boolean has(java.util.List<Row> x,String s){for(Row r:x)if(r.t.symbol.equals(s))return true;return false;}

    private int score(Ticker t,Detail d,double thirdPct){
        double x=0;
        x+=18*(thirdPct>0?clamp(t.change24/thirdPct,0,1.15):0);
        x+=10*rangePos(t);
        x+=12*clamp(Math.max(0,d.mom5)/0.035,0,1);
        x+=12*clamp(Math.max(0,d.mom15)/0.06,0,1);
        x+=14*clamp((safe(d.volRatio,1)-1)/3,0,1);
        x+=10*clamp(Math.max(0,safe(d.oiChange15,0))/12,0,1);
        if("HH-HL".equals(d.structure))x+=10;else if("GEÇİŞ".equals(d.structure))x+=4;
        if(d.sweep.startsWith("TRUE_BREAKOUT_ACCEPTED_UP"))x+=7;else if(d.sweep.startsWith("BSL_ATTACK"))x+=4;
        double ext=safe(d.extensionAtr,0);
        if(ext>2)x-=clamp((ext-2)*9,0,22);
        if(safe(d.rsi15,50)>82)x-=7;
        if("EXHAUSTION".equals(d.stage))x-=12;else if("LATE_EXPANSION".equals(d.stage))x-=5;
        return (int)Math.round(clamp(x,0,100));
    }

    private Detail loadDetail(Ticker t){
        Detail d=new Detail();
        try{
            java.util.ArrayList<Candle> m5=klines(t.symbol,"5m",48);
            java.util.ArrayList<Candle> m15=klines(t.symbol,"15m",64);
            java.util.ArrayList<Candle> h1=klines(t.symbol,"1h",36);
            if(m5.size()>4)d.mom5=ret(m5,3);
            if(m15.size()>=22){
                Candle last=m15.get(m15.size()-1);
                double atr=atr(m15,14),ema=ema(m15,20);
                d.extensionAtr=atr>0?Math.abs(t.last-ema)/atr:Double.NaN;
                d.rsi15=rsi(m15,14);d.volRatio=volRatio(m15,20);d.mom15=ret(m15,3);d.structure=structure(m15);
                double sh=swingHigh(m15),sl=swingLow(m15);
                d.bsl=firstAbove(t.last,sh,recentHigh(m15,24),t.high24);
                d.ssl=firstBelow(t.last,sl,recentLow(m15,24),t.low24);
                d.up2=firstAbove(t.last,recentHigh(h1,24),t.high24);
                d.down2=firstBelow(t.last,recentLow(h1,24),t.low24);
                d.sweep=sweep(last,t.last,sh,sl,atr);
                d.stage=stage(d,t);
            }
            d.oiChange15=oi15(t.symbol);
        }catch(Throwable ignored){}
        return d;
    }

    private String stage(Detail d,Ticker t){
        double e=safe(d.extensionAtr,0),r=safe(d.rsi15,50),v=safe(d.volRatio,1),rp=rangePos(t);
        if(e>=3||(r>=86&&rp>.92))return "EXHAUSTION";
        if(e>=2||(r>=80&&rp>.90))return "LATE_EXPANSION";
        if(d.mom15>.025&&v>=1.5&&e<=1.25)return "EARLY_EXPANSION";
        if(d.mom15>.012||d.mom5>.01||v>=1.35)return "EXPANSION";
        return "GEÇİŞ";
    }

    private static String sweep(Candle last,double live,double sh,double sl,double atr){
        if(last==null)return "NONE";
        if(finite(sh)){
            if(last.h>sh&&last.c<sh)return "BSL_SWEPT_REJECTED";
            if(last.c>sh)return "TRUE_BREAKOUT_ACCEPTED_UP";
            if(atr>0&&sh>live&&sh-live<=atr*.30)return "BSL_ATTACK";
        }
        if(finite(sl)){
            if(last.l<sl&&last.c>sl)return "SSL_SWEPT_RECLAIMED";
            if(last.c<sl)return "TRUE_BREAKOUT_ACCEPTED_DOWN";
            if(atr>0&&sl<live&&live-sl<=atr*.30)return "SSL_ATTACK";
        }
        return "NONE";
    }

    private void persist(java.util.List<Row> rows)throws org.json.JSONException{
        org.json.JSONObject root=new org.json.JSONObject();
        root.put("updatedAt",System.currentTimeMillis());root.put("mode","BINANCE_TOP3_PLUS_5");
        root.put("contract","DISCOVERY_NOT_SIGNAL");
        org.json.JSONArray a=new org.json.JSONArray();
        for(Row r:rows){
            org.json.JSONObject j=new org.json.JSONObject();
            j.put("symbol",r.t.symbol);j.put("role",r.role);j.put("rank",r.t.rank);j.put("change24",r.t.change24);
            j.put("price",r.t.last);j.put("score",r.score);j.put("stage",r.d.stage);j.put("moveAgeMin",r.moveAgeMin);
            j.put("extensionAtr",finite(r.d.extensionAtr)?r.d.extensionAtr:org.json.JSONObject.NULL);
            j.put("rsi15",finite(r.d.rsi15)?r.d.rsi15:org.json.JSONObject.NULL);
            j.put("volRatio",finite(r.d.volRatio)?r.d.volRatio:org.json.JSONObject.NULL);
            j.put("oiChange15",finite(r.d.oiChange15)?r.d.oiChange15:org.json.JSONObject.NULL);
            j.put("structure15",r.d.structure);j.put("sweep",r.d.sweep);
            j.put("bsl",level(r.d.bsl,"BSL"));j.put("ssl",level(r.d.ssl,"SSL"));
            j.put("upPath",path(r.d.bsl,r.d.up2,"BSL","HTF_HIGH"));
            j.put("downPath",path(r.d.ssl,r.d.down2,"SSL","HTF_LOW"));
            a.put(j);
        }
        root.put("rows",a);
        app.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE).edit()
                .putString(KEY_JSON,root.toString()).putLong("updated_at",System.currentTimeMillis()).remove("last_error").apply();
    }

    private void ensurePerpetuals()throws java.io.IOException{
        long now=System.currentTimeMillis();
        if(!perpetuals.isEmpty()&&now-perpetualsAt<6L*60L*60L*1000L)return;
        org.json.JSONArray a=getObject("/fapi/v1/exchangeInfo").optJSONArray("symbols");
        java.util.HashSet<String>s=new java.util.HashSet<>();
        if(a!=null)for(int i=0;i<a.length();i++){
            org.json.JSONObject j=a.optJSONObject(i);if(j==null)continue;
            if("TRADING".equals(j.optString("status"))&&"PERPETUAL".equals(j.optString("contractType"))
                    &&"USDT".equals(j.optString("quoteAsset")))s.add(j.optString("symbol"));
        }
        if(!s.isEmpty()){perpetuals=s;perpetualsAt=now;}
    }

    private java.util.ArrayList<Ticker> loadTickers()throws java.io.IOException{
        org.json.JSONArray a=getArray("/fapi/v1/ticker/24hr");java.util.ArrayList<Ticker>out=new java.util.ArrayList<>();
        for(int i=0;i<a.length();i++){
            org.json.JSONObject j=a.optJSONObject(i);if(j==null)continue;String sym=j.optString("symbol","");
            if(!perpetuals.contains(sym))continue;
            double last=num(j.optString("lastPrice","")),ch=num(j.optString("priceChangePercent",""));
            if(!finite(last)||last<=0||!finite(ch))continue;
            Ticker t=new Ticker();t.symbol=sym;t.last=last;t.change24=ch;t.high24=num(j.optString("highPrice",""));
            t.low24=num(j.optString("lowPrice",""));t.quoteVolume=num(j.optString("quoteVolume","0"));out.add(t);
        }return out;
    }

    private java.util.ArrayList<Candle> klines(String symbol,String interval,int limit)throws java.io.IOException{
        org.json.JSONArray a=getArray("/fapi/v1/klines?symbol="+symbol+"&interval="+interval+"&limit="+limit);
        java.util.ArrayList<Candle>out=new java.util.ArrayList<>();long now=System.currentTimeMillis();
        for(int i=0;i<a.length();i++){org.json.JSONArray r=a.optJSONArray(i);if(r==null||r.length()<8)continue;
            long ct=r.optLong(6,0);if(ct<=0||ct>=now)continue;
            Candle c=new Candle();c.closeTime=ct;c.h=num(String.valueOf(r.opt(2)));c.l=num(String.valueOf(r.opt(3)));
            c.c=num(String.valueOf(r.opt(4)));c.qv=num(String.valueOf(r.opt(7)));
            if(finite(c.h)&&finite(c.l)&&finite(c.c)&&c.c>0)out.add(c);
        }return out;
    }

    private double oi15(String symbol){
        try{org.json.JSONArray a=getArray("/futures/data/openInterestHist?symbol="+symbol+"&period=5m&limit=4");
            if(a.length()<2)return Double.NaN;org.json.JSONObject f=a.optJSONObject(0),l=a.optJSONObject(a.length()-1);
            double x=num(f.optString("sumOpenInterest","")),y=num(l.optString("sumOpenInterest",""));
            return x>0&&finite(y)?(y/x-1)*100:Double.NaN;}catch(Throwable t){return Double.NaN;}
    }

    private org.json.JSONArray getArray(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            return new org.json.JSONArray(r.body().string());}
    }
    private org.json.JSONObject getObject(String p)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(BASE+p).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());
            return new org.json.JSONObject(r.body().string());}
    }

    private double velocity(String s,double p){Double o=previousPrice.get(s);return o!=null&&o>0?p/o-1:0;}
    private static double rangePos(Ticker t){return finite(t.high24)&&finite(t.low24)&&t.high24>t.low24?clamp((t.last-t.low24)/(t.high24-t.low24),0,1):.5;}
    private static double ret(java.util.List<Candle>a,int n){if(a.size()<=n)return 0;double x=a.get(a.size()-1-n).c,y=a.get(a.size()-1).c;return x>0?y/x-1:0;}
    private static double atr(java.util.List<Candle>a,int n){if(a.size()<n+1)return Double.NaN;double s=0;int k=0;for(int i=Math.max(1,a.size()-n);i<a.size();i++){Candle c=a.get(i),p=a.get(i-1);s+=Math.max(c.h-c.l,Math.max(Math.abs(c.h-p.c),Math.abs(c.l-p.c)));k++;}return k>0?s/k:Double.NaN;}
    private static double ema(java.util.List<Candle>a,int n){if(a.isEmpty())return Double.NaN;double e=a.get(0).c,al=2.0/(n+1);for(int i=1;i<a.size();i++)e=al*a.get(i).c+(1-al)*e;return e;}
    private static double rsi(java.util.List<Candle>a,int n){if(a.size()<n+1)return Double.NaN;double g=0,l=0;for(int i=a.size()-n;i<a.size();i++){double d=a.get(i).c-a.get(i-1).c;if(d>0)g+=d;else l-=d;}if(l==0)return 100;double rs=g/l;return 100-100/(1+rs);}
    private static double volRatio(java.util.List<Candle>a,int n){if(a.size()<n+1)return Double.NaN;double s=0;for(int i=a.size()-1-n;i<a.size()-1;i++)s+=Math.max(0,a.get(i).qv);double av=s/n;return av>0?a.get(a.size()-1).qv/av:Double.NaN;}

    private static String structure(java.util.List<Candle>a){
        java.util.ArrayList<Double>h=new java.util.ArrayList<>(),l=new java.util.ArrayList<>();
        for(int i=a.size()-3;i>=2&&(h.size()<2||l.size()<2);i--){Candle x=a.get(i);
            boolean hi=x.h>a.get(i-1).h&&x.h>=a.get(i-2).h&&x.h>=a.get(i+1).h&&x.h>=a.get(i+2).h;
            boolean lo=x.l<a.get(i-1).l&&x.l<=a.get(i-2).l&&x.l<=a.get(i+1).l&&x.l<=a.get(i+2).l;
            if(hi&&h.size()<2)h.add(x.h);if(lo&&l.size()<2)l.add(x.l);}
        if(h.size()>=2&&l.size()>=2){if(h.get(0)>h.get(1)&&l.get(0)>l.get(1))return "HH-HL";if(h.get(0)<h.get(1)&&l.get(0)<l.get(1))return "LH-LL";}return "GEÇİŞ";
    }
    private static double swingHigh(java.util.List<Candle>a){for(int i=a.size()-3;i>=2;i--){Candle x=a.get(i);if(x.h>a.get(i-1).h&&x.h>=a.get(i-2).h&&x.h>=a.get(i+1).h&&x.h>=a.get(i+2).h)return x.h;}return Double.NaN;}
    private static double swingLow(java.util.List<Candle>a){for(int i=a.size()-3;i>=2;i--){Candle x=a.get(i);if(x.l<a.get(i-1).l&&x.l<=a.get(i-2).l&&x.l<=a.get(i+1).l&&x.l<=a.get(i+2).l)return x.l;}return Double.NaN;}
    private static double recentHigh(java.util.List<Candle>a,int n){if(a.isEmpty())return Double.NaN;double x=-Double.MAX_VALUE;for(int i=Math.max(0,a.size()-n);i<a.size();i++)x=Math.max(x,a.get(i).h);return x;}
    private static double recentLow(java.util.List<Candle>a,int n){if(a.isEmpty())return Double.NaN;double x=Double.MAX_VALUE;for(int i=Math.max(0,a.size()-n);i<a.size();i++)x=Math.min(x,a.get(i).l);return x;}
    private static double firstAbove(double p,double...x){double b=Double.NaN;for(double v:x)if(finite(v)&&v>p&&(!finite(b)||v<b))b=v;return b;}
    private static double firstBelow(double p,double...x){double b=Double.NaN;for(double v:x)if(finite(v)&&v<p&&(!finite(b)||v>b))b=v;return b;}
    private static String level(double x,String n){return finite(x)?n+"@"+px(x):"NONE";}
    private static String path(double a,double b,String an,String bn){StringBuilder s=new StringBuilder();if(finite(a))s.append(an).append('@').append(px(a));if(finite(b)&&(!finite(a)||Math.abs(b-a)/Math.max(1e-12,Math.abs(a))>.002)){if(s.length()>0)s.append(" -> ");s.append(bn).append('@').append(px(b));}return s.length()==0?"NONE":s.toString();}
    private static String px(double x){if(x>=10)return String.format(java.util.Locale.US,"%.4f",x);if(x>=1)return String.format(java.util.Locale.US,"%.5f",x);if(x>=.01)return String.format(java.util.Locale.US,"%.6f",x);return String.format(java.util.Locale.US,"%.8f",x);}
    private static String f2(double x){return finite(x)?String.format(java.util.Locale.US,"%.2f",x):"N/A";}
    private static double num(String s){try{return Double.parseDouble(s);}catch(Throwable t){return Double.NaN;}}
    private static double safe(double x,double d){return finite(x)?x:d;}
    private static boolean finite(double x){return !Double.isNaN(x)&&!Double.isInfinite(x);}
    private static double clamp(double x,double a,double b){return Math.max(a,Math.min(b,x));}
}
'''

radar = r'''package com.futuresalarm.app;

public class MarketRadarActivity extends android.app.Activity {
    private android.widget.LinearLayout list;
    private android.widget.TextView status;
    private final android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable updater=new Runnable(){@Override public void run(){render();handler.postDelayed(this,15_000L);}};

    @Override protected void onCreate(android.os.Bundle b){
        super.onCreate(b);
        if(android.os.Build.VERSION.SDK_INT>=21){getWindow().setStatusBarColor(android.graphics.Color.rgb(8,13,22));getWindow().setNavigationBarColor(android.graphics.Color.rgb(8,13,22));}
        V9538MarketRadarEngine.start(this);
        android.widget.ScrollView scroll=new android.widget.ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(android.graphics.Color.rgb(8,13,22));
        android.widget.LinearLayout root=new android.widget.LinearLayout(this);root.setOrientation(android.widget.LinearLayout.VERTICAL);root.setPadding(dp(16),dp(16),dp(16),dp(30));scroll.addView(root,new android.widget.ScrollView.LayoutParams(-1,-2));
        root.addView(txt("📡 8 COİN MARKET RADARI • v9.5.38",25,android.graphics.Color.WHITE,true));
        android.widget.TextView info=txt("Binance USDⓈ-M mevcut TOP3 + ilk 3'e yaklaşabilecek 5 güçlü aday. Radar puanı işlem sinyali değildir; hangi coin için ayrıntılı paket hazırlayacağımızı seçer.",15,android.graphics.Color.rgb(170,185,205),false);info.setPadding(0,dp(8),0,dp(10));root.addView(info);
        status=txt("Radar başlatılıyor...",14,android.graphics.Color.rgb(255,193,7),true);root.addView(status);
        android.widget.Button refresh=btn("ŞİMDİ YENİLE",android.graphics.Color.rgb(0,130,170));root.addView(refresh,lp(-1,dp(54),0,10));refresh.setOnClickListener(v->{status.setText("⏳ Binance taraması yenileniyor...");V9538MarketRadarEngine.requestRefresh(this);handler.postDelayed(this::render,2500L);});
        list=new android.widget.LinearLayout(this);list.setOrientation(android.widget.LinearLayout.VERTICAL);root.addView(list,new android.widget.LinearLayout.LayoutParams(-1,-2));
        android.widget.Button back=btn("GERİ",android.graphics.Color.rgb(65,78,98));root.addView(back,lp(-1,dp(52),12,0));back.setOnClickListener(v->finish());
        setContentView(scroll);render();
    }
    @Override protected void onResume(){super.onResume();handler.removeCallbacks(updater);handler.post(updater);}
    @Override protected void onPause(){handler.removeCallbacks(updater);super.onPause();}

    private void render(){
        if(list==null)return;list.removeAllViews();String raw=V9538MarketRadarEngine.latestJson(this);
        if(raw==null||raw.trim().isEmpty()){status.setText("⏳ İlk radar taraması hazırlanıyor. Birkaç saniye sonra yenile.");return;}
        try{org.json.JSONObject root=new org.json.JSONObject(raw);long at=root.optLong("updatedAt",0);long age=at>0?Math.max(0,(System.currentTimeMillis()-at)/1000):-1;status.setText(age>=0?"Son radar: "+age+" sn önce • 3 TOP + 5 ADAY":"Radar verisi hazır");
            org.json.JSONArray rows=root.optJSONArray("rows");if(rows==null)return;for(int i=0;i<rows.length();i++){org.json.JSONObject r=rows.optJSONObject(i);if(r!=null)addCard(r);}
        }catch(Throwable t){status.setText("Radar verisi okunamadı: "+t.getClass().getSimpleName());}
    }

    private void addCard(org.json.JSONObject r){
        String symbol=r.optString("symbol","?"),role=r.optString("role","ADAY"),stage=r.optString("stage","N/A"),sweep=r.optString("sweep","NONE");
        int rank=r.optInt("rank",-1),score=r.optInt("score",0);double change=r.optDouble("change24",Double.NaN);
        android.widget.LinearLayout card=new android.widget.LinearLayout(this);card.setOrientation(android.widget.LinearLayout.VERTICAL);card.setPadding(dp(14),dp(12),dp(14),dp(12));card.setBackgroundColor(android.graphics.Color.rgb(14,28,45));list.addView(card,lp(-1,-2,7,0));
        int accent="TOP3".equals(role)?android.graphics.Color.rgb(70,220,135):android.graphics.Color.rgb(80,180,255);
        card.addView(txt(("TOP3".equals(role)?"🔥 ":"🧭 ")+symbol+" • #"+rank+" • "+role,19,accent,true));
        card.addView(txt("24s "+f(change)+"% • TOP3_ENTRY "+score+"/100 • "+stage+"\n15m hacim "+f(r.optDouble("volRatio",Double.NaN))+"x • OI15 "+f(r.optDouble("oiChange15",Double.NaN))+"% • RSI "+f(r.optDouble("rsi15",Double.NaN))+"\n"+sweep+" • "+r.optString("upPath","NONE")+" | "+r.optString("downPath","NONE"),14,android.graphics.Color.rgb(215,225,238),false));
        android.widget.LinearLayout actions=new android.widget.LinearLayout(this);actions.setOrientation(android.widget.LinearLayout.HORIZONTAL);card.addView(actions,lp(-1,dp(52),10,0));
        android.widget.Button pack=btn("PROMPT + GRAFİK",android.graphics.Color.rgb(91,61,190));android.widget.LinearLayout.LayoutParams p1=new android.widget.LinearLayout.LayoutParams(0,-1,1);p1.setMargins(0,0,dp(5),0);actions.addView(pack,p1);pack.setOnClickListener(v->openPack(symbol));
        android.widget.Button copy=btn("RADAR BAĞLAMI",android.graphics.Color.rgb(34,110,130));android.widget.LinearLayout.LayoutParams p2=new android.widget.LinearLayout.LayoutParams(0,-1,1);p2.setMargins(dp(5),0,0,0);actions.addView(copy,p2);copy.setOnClickListener(v->{String s=V9538MarketRadarEngine.promptContext(this,symbol);android.content.ClipboardManager cm=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(cm!=null)cm.setPrimaryClip(android.content.ClipData.newPlainText("Market Radar "+symbol,s));android.widget.Toast.makeText(this,"Radar bağlamı panoya kopyalandı.",android.widget.Toast.LENGTH_SHORT).show();});
    }
    private void openPack(String symbol){android.content.Intent i=new android.content.Intent(this,AnalysisPackActivity.class);i.putExtra("v9538_symbol",symbol);i.putExtra("v9538_autobuild",true);startActivity(i);}
    private android.widget.TextView txt(String s,float sp,int c,boolean b){android.widget.TextView v=new android.widget.TextView(this);v.setText(s);v.setTextSize(sp);v.setTextColor(c);if(b)v.setTypeface(android.graphics.Typeface.DEFAULT,android.graphics.Typeface.BOLD);v.setLineSpacing(0,1.08f);return v;}
    private android.widget.Button btn(String s,int c){android.widget.Button b=new android.widget.Button(this);b.setText(s);b.setTextColor(android.graphics.Color.WHITE);b.setTextSize(13);b.setAllCaps(false);b.setBackgroundColor(c);return b;}
    private android.widget.LinearLayout.LayoutParams lp(int w,int h,int top,int bottom){android.widget.LinearLayout.LayoutParams p=new android.widget.LinearLayout.LayoutParams(w,h);p.setMargins(0,dp(top),0,dp(bottom));return p;}
    private int dp(int x){return(int)(x*getResources().getDisplayMetrics().density+.5f);}
    private static String f(double x){return Double.isNaN(x)||Double.isInfinite(x)?"N/A":String.format(java.util.Locale.US,"%.2f",x);}
}
'''

ENGINE.write_text(engine)
RADAR.write_text(radar)

mf=MANIFEST.read_text()
if 'MarketRadarActivity' not in mf:
    if '</application>' not in mf: raise SystemExit('v9.5.38 manifest anchor missing')
    mf=mf.replace('</application>','        <activity android:name=".MarketRadarActivity" android:exported="false" />\n</application>',1)
MANIFEST.write_text(mf)

m=MAIN.read_text()
m=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.38',m)
m=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.38  •  MANUEL PRO',m)
if 'private void v9538InstallMarketRadarButton()' not in m:
    idx=m.rfind('}')
    helper=r'''
    private void v9538InstallMarketRadarButton() {
        try {
            android.view.ViewGroup content=findViewById(android.R.id.content);
            if(content==null||content.getChildCount()==0)return;
            android.view.View v=content.getChildAt(0);
            android.widget.LinearLayout root=null;
            if(v instanceof android.widget.ScrollView){
                android.widget.ScrollView sv=(android.widget.ScrollView)v;
                if(sv.getChildCount()>0&&sv.getChildAt(0) instanceof android.widget.LinearLayout)root=(android.widget.LinearLayout)sv.getChildAt(0);
            } else if(v instanceof android.widget.LinearLayout) root=(android.widget.LinearLayout)v;
            if(root==null)return;
            android.widget.Button b=new android.widget.Button(this);
            b.setText("📡 8 COİN RADARI\nBinance TOP3 + 5 güçlü aday");
            b.setTextSize(17);b.setTextColor(android.graphics.Color.WHITE);b.setAllCaps(false);b.setBackgroundColor(android.graphics.Color.rgb(19,102,150));
            android.widget.LinearLayout.LayoutParams lp=new android.widget.LinearLayout.LayoutParams(-1,dp(66));lp.setMargins(0,dp(8),0,dp(8));root.addView(b,lp);
            b.setOnClickListener(x->startActivity(new android.content.Intent(this,MarketRadarActivity.class)));
        } catch(Throwable ignored) {}
    }
'''
    m=m[:idx]+helper+m[idx:]
b=method_bounds(m,'protected void onCreate(')
if not b: raise SystemExit('v9.5.38 MainActivity onCreate missing')
a0,_,e0=b;body=m[a0:e0];anchor='setContentView(buildUi());'
if anchor not in body: raise SystemExit('v9.5.38 MainActivity content anchor missing')
if 'V9538_MARKET_RADAR_START' not in body:
    body=body.replace(anchor,anchor+'\n        // V9538_MARKET_RADAR_START\n        V9538MarketRadarEngine.start(this);\n        v9538InstallMarketRadarButton();',1);m=m[:a0]+body+m[e0:]
MAIN.write_text(m)

ms=MON.read_text()
ms=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.38',ms)
if 'V9538_RADAR_SERVICE_START' not in ms:
    b=method_bounds(ms,'void onCreate()')
    if not b: raise SystemExit('v9.5.38 MonitorService onCreate missing')
    a0,_,e0=b;body=ms[a0:e0];bi=body.find('{')
    body=body[:bi+1]+'\n        // V9538_RADAR_SERVICE_START\n        V9538MarketRadarEngine.start(this);\n'+body[bi+1:];ms=ms[:a0]+body+ms[e0:]
MON.write_text(ms)

an=ANALYSIS.read_text()
an=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.38',an)
an=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.38',an)
if 'V9538_PREFILL_SYMBOL' not in an:
    anchor='        setContentView(scroll);'
    if anchor not in an: raise SystemExit('v9.5.38 AnalysisPack content anchor missing')
    an=an.replace(anchor,anchor+r'''
        // V9538_PREFILL_SYMBOL
        try {
            String pre=getIntent().getStringExtra("v9538_symbol");
            if(pre!=null&&!pre.trim().isEmpty()){
                symbolInput.setText(pre.trim().toUpperCase(java.util.Locale.US));
                if(getIntent().getBooleanExtra("v9538_autobuild",false))symbolInput.postDelayed(()->buildPack(),250L);
            }
        } catch(Throwable ignored) {}''',1)
if 'V9538_SEPARATE_PROMPT_CHART' not in an:
    anchor='        shareButton.setOnClickListener(v -> sharePack());'
    if anchor not in an: raise SystemExit('v9.5.38 share anchor missing')
    an=an.replace(anchor,anchor+r'''
        // V9538_SEPARATE_PROMPT_CHART
        Button copyPromptOnly=button("PROMPTU KOPYALA",Color.rgb(25,125,105));
        root.addView(copyPromptOnly,lp(-1,dp(58),0,0,0,8));
        copyPromptOnly.setOnClickListener(v->{if(shareText==null||shareText.trim().isEmpty()){Toast.makeText(this,"Önce analiz paketini hazırla.",Toast.LENGTH_SHORT).show();return;}copyMasterPromptToClipboard();Toast.makeText(this,"MASTER PROMPT panoya kopyalandı.",Toast.LENGTH_SHORT).show();});
        Button shareChartOnly=button("GRAFİĞİ AYRI PAYLAŞ",Color.rgb(34,92,150));
        root.addView(shareChartOnly,lp(-1,dp(58),0,0,0,10));
        shareChartOnly.setOnClickListener(v->v9538ShareChartOnly());''',1)
if 'private void v9538ShareChartOnly()' not in an:
    idx=an.find('    private void sharePack() {')
    if idx<0: raise SystemExit('v9.5.38 sharePack missing')
    method=r'''    private void v9538ShareChartOnly() {
        if(imageUri==null){Toast.makeText(this,"Önce grafiği hazırla.",Toast.LENGTH_SHORT).show();return;}
        try{Intent send=new Intent(Intent.ACTION_SEND);send.setType("image/*");send.putExtra(Intent.EXTRA_STREAM,imageUri);send.setClipData(ClipData.newRawUri("Futures PRO analiz grafiği",imageUri));send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(send,"Analiz grafiğini paylaş"));}
        catch(Throwable t){Toast.makeText(this,"Grafik paylaşımı açılamadı.",Toast.LENGTH_LONG).show();}
    }

'''
    an=an[:idx]+method+an[idx:]
b=method_bounds(an,'    private String buildPrompt(')
if not b: raise SystemExit('v9.5.38 buildPrompt missing')
a0,_,e0=b;body=an[a0:e0]
if 'V9538_RADAR_PROMPT_CONTEXT' not in body:
    anchor='StringBuilder sb = new StringBuilder();'
    if anchor not in body: raise SystemExit('v9.5.38 StringBuilder anchor missing')
    body=body.replace(anchor,anchor+'\n        // V9538_RADAR_PROMPT_CONTEXT\n        String v9538Radar=V9538MarketRadarEngine.promptContext(this,symbol);\n        if(v9538Radar!=null&&!v9538Radar.isEmpty())sb.append(v9538Radar);',1);an=an[:a0]+body+an[e0:]
ANALYSIS.write_text(an)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091301',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.38'",bf,count=1)
BUILD.write_text(bf)

main=MAIN.read_text();mon=MON.read_text();analysis=ANALYSIS.read_text();manifest=MANIFEST.read_text();build=BUILD.read_text()
checks={
 'v9537 dashboard retained':'v9527InstallTopDashboard' in main and 'PORTFÖY / 24 SAAT' in main,
 'virtual signal history retained':'v9518SignalOzet' in main and 'v9518_signal_active_' in main,
 'virtual result engine retained':'v9518UpdateSignalResult' in mon and 'v9518Finish' in mon,
 'notification trade ticket retained':'v9536_open_trade_ticket' in main and 'v9536OpenTradeTicketIntent' in mon,
 'adaptive lifecycle retained':'v9533CycleReady' in mon,
 'radar engine':ENGINE.exists() and 'BINANCE_TOP3_PLUS_5' in ENGINE.read_text(),
 'radar activity':RADAR.exists() and 'PROMPT + GRAFİK' in RADAR.read_text(),
 'manifest':'MarketRadarActivity' in manifest,
 'service':'V9538_RADAR_SERVICE_START' in mon,
 'main button':'V9538_MARKET_RADAR_START' in main and '8 COİN RADARI' in main,
 'prompt context':'V9538_RADAR_PROMPT_CONTEXT' in analysis,
 'separate prompt/chart':'V9538_SEPARATE_PROMPT_CHART' in analysis and 'v9538ShareChartOnly' in analysis,
 'version code':'versionCode 26091301' in build,
 'version name':"versionName '9.5.38'" in build,
}
for n,ok in checks.items():print(('OK   ' if ok else 'FAIL '),n)
bad=[n for n,ok in checks.items() if not ok]
if bad:raise SystemExit('v9.5.38 sanity failed: '+', '.join(bad))
print('v9.5.38 OK: 8-coin radar foundation + move-stage/sweep/path context + separate prompt/chart controls.')
