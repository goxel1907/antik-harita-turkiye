from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'
BUILD = APP / 'app/build.gradle'
ATTN = JAVA / 'V9542AttentionRadar.java'
ATTN_ACTIVITY = JAVA / 'V9542AttentionActivity.java'

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, MANIFEST, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.42 missing required generated file: ' + str(p))


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
            if c == '\n':
                line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
        elif in_chr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                in_chr = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"':
                in_str = True
            elif c == "'":
                in_chr = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)


# ---------------------------------------------------------------------------
# v9.5.42 SOCIAL / NEWS ATTENTION RADAR
# Discovery-only early warning. It never creates a LONG/SHORT trade signal.
# Public sources fail open: unavailable sources contribute zero, never a veto.
# ---------------------------------------------------------------------------
attention = r'''package com.futuresalarm.app;

final class V9542AttentionRadar {
    static final String PREFS="v9542_attention_radar";
    static final String KEY_JSON="attention_json";
    static final long REFRESH_MS=4L*60L*1000L;
    private static final String FAPI="https://fapi.binance.com";
    private static volatile V9542AttentionRadar INSTANCE;

    private final android.content.Context app;
    private final okhttp3.OkHttpClient client;
    private final java.util.concurrent.ScheduledExecutorService scheduler=
            java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    private volatile boolean refreshing;

    private static final java.util.Set<String> AMBIG=new java.util.HashSet<>(java.util.Arrays.asList(
            "ONE","ID","GAS","HOT","KEY","MASK","MAGIC","PEOPLE","POWER","HIGH","SATS","1000SATS"));
    private static final String[] POS_WORDS={
            "BURN","BURNING","BUYBACK","LISTING","LISTED","PARTNERSHIP","PARTNER","MAINNET","UPGRADE",
            "AIRDROP","STAKING","LAUNCH","INTEGRATION","ADOPTION","APPROVED","GRANT","MIGRATION"
    };
    private static final String[] NEG_WORDS={
            "DELIST","DELISTING","HACK","HACKED","EXPLOIT","BREACH","SECURITY","SHUTDOWN","CLOSURE",
            "INVESTIGATION","LAWSUIT","SUSPEND","SUSPENDED","PAUSE","FROZEN","ATTACK","SCAM"
    };

    static void start(android.content.Context context){
        if(context==null)return;
        if(INSTANCE==null)synchronized(V9542AttentionRadar.class){
            if(INSTANCE==null)INSTANCE=new V9542AttentionRadar(context.getApplicationContext());
        }
    }
    static void requestRefresh(android.content.Context context){start(context);if(INSTANCE!=null)INSTANCE.scheduler.execute(INSTANCE::refresh);}
    static String latestJson(android.content.Context context){
        if(context==null)return "";start(context);
        return context.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE).getString(KEY_JSON,"");
    }
    static String promptContext(android.content.Context context,String symbol){
        if(context==null||symbol==null)return "";
        String want=symbol.trim().toUpperCase(java.util.Locale.US);
        try{
            org.json.JSONObject root=new org.json.JSONObject(latestJson(context));
            org.json.JSONArray rows=root.optJSONArray("rows");if(rows==null)return "";
            for(int i=0;i<rows.length();i++){
                org.json.JSONObject r=rows.optJSONObject(i);if(r==null||!want.equals(r.optString("symbol")))continue;
                StringBuilder s=new StringBuilder();
                s.append("--- V9.5.42 ERKEN İLGİ / ÇOK KONUŞULAN BAĞLAMI ---\n");
                s.append("TALK_SCORE: ").append(r.optInt("talkScore",0)).append("/100\n");
                s.append("TALK_VELOCITY: ").append(f2(r.optDouble("talkVelocity",Double.NaN))).append("x\n");
                s.append("MENTIONS_60M: ").append(r.optInt("mentions60",0)).append("\n");
                s.append("SENTIMENT: ").append(r.optString("sentiment","KARISIK")).append("\n");
                s.append("SOURCE_CONFIDENCE: ").append(r.optInt("sourceConfidence",0)).append("/100\n");
                s.append("SOURCE_FAMILIES: ").append(r.optString("sourceFamilies","NONE")).append("\n");
                s.append("EARLY_MOVE_SCORE: ").append(r.optInt("earlyMoveScore",0)).append("/100\n");
                s.append("DIRECTION: ").append(r.optString("direction","NÖTR")).append("\n");
                s.append("PRE_MOVE_STATE: ").append(r.optString("preMoveState","N/A")).append("\n");
                s.append("ATTENTION_FLAGS: ").append(r.optString("flags","NONE")).append("\n");
                s.append("WHY_NOW: ").append(r.optString("whyNow","NONE")).append("\n");
                s.append("ATTENTION_HEADLINE: ").append(r.optString("headline","NONE")).append("\n");
                s.append("ATTENTION_KURAL: Bu katman yalnız erken keşif/temel-sosyal bağlamdır. Haber, konuşulma veya sentiment tek başına LONG/SHORT üretmez; tamamlanmış 15m yapı, giriş konumu, invalidation ve R/R kuralları aynen korunur. PRE_MOVE_STATE=GEC_KOVALAMA ise fiyat kovalanmaz.\n\n");
                return s.toString();
            }
        }catch(Throwable ignored){}
        return "";
    }

    private static final class Doc{
        String title="",source="",url="";long at;boolean searchTrend;
        Doc(String t,String s,String u,long a,boolean q){title=t==null?"":t;source=s==null?"":s;url=u==null?"":u;at=a;searchTrend=q;}
    }
    private static final class Ticker{
        String symbol="",base="";double last,change24,quoteVolume;
    }
    private static final class Market{
        double extensionAtr=Double.NaN,volRatio=Double.NaN,mom15=Double.NaN,oi15=Double.NaN,rsi15=Double.NaN;
    }
    private static final class Candidate{
        Ticker t;Market m=new Market();int mentions60,mentionsPrev,pos,neg,sourceConfidence,talkScore,earlyMoveScore,catalystScore;
        double velocity;boolean trending,official;String sentiment="KARISIK",direction="NÖTR",preMoveState="N/A",families="NONE",flags="NONE",headline="NONE",whyNow="NONE";
    }

    private V9542AttentionRadar(android.content.Context app){
        this.app=app;
        client=new okhttp3.OkHttpClient.Builder().connectTimeout(8,java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(12,java.util.concurrent.TimeUnit.SECONDS).callTimeout(35,java.util.concurrent.TimeUnit.SECONDS)
                .retryOnConnectionFailure(true).build();
        scheduler.scheduleWithFixedDelay(this::refresh,2500L,REFRESH_MS,java.util.concurrent.TimeUnit.MILLISECONDS);
    }

    private void refresh(){
        synchronized(this){if(refreshing)return;refreshing=true;}
        try{
            java.util.ArrayList<Doc> docs=new java.util.ArrayList<>();
            java.util.LinkedHashSet<String> sourceStatus=new java.util.LinkedHashSet<>();
            try{loadGdelt(docs);sourceStatus.add("GDELT");}catch(Throwable ignored){}
            try{loadReddit(docs,"CryptoCurrency");loadReddit(docs,"CryptoMarkets");sourceStatus.add("REDDIT");}catch(Throwable ignored){}
            try{loadCoinGeckoTrending(docs);sourceStatus.add("COINGECKO_TREND");}catch(Throwable ignored){}
            dedupe(docs);

            java.util.ArrayList<Ticker> tickers=loadTickers();
            java.util.ArrayList<Candidate> prelim=new java.util.ArrayList<>();
            for(Ticker t:tickers){
                Candidate c=fromDocs(t,docs);
                if(c.mentions60<=0&&c.catalystScore<=0&&!c.trending)continue;
                prelim.add(c);
            }
            java.util.Collections.sort(prelim,(a,b)->Integer.compare(preScore(b),preScore(a)));
            int detailN=Math.min(14,prelim.size());
            for(int i=0;i<detailN;i++){
                Candidate c=prelim.get(i);c.m=market(c.t.symbol);finish(c);
            }
            for(int i=detailN;i<prelim.size();i++)finish(prelim.get(i));
            java.util.Collections.sort(prelim,(a,b)->{
                int x=Integer.compare(b.talkScore,a.talkScore);return x!=0?x:Integer.compare(b.earlyMoveScore,a.earlyMoveScore);
            });
            if(prelim.size()>18)prelim=new java.util.ArrayList<>(prelim.subList(0,18));
            persist(prelim,sourceStatus);
            maybeNotify(prelim);
        }catch(Throwable t){
            app.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE).edit()
                    .putString("last_error",t.getClass().getSimpleName()+": "+String.valueOf(t.getMessage())).apply();
        }finally{refreshing=false;}
    }

    private Candidate fromDocs(Ticker t,java.util.List<Doc> docs){
        Candidate c=new Candidate();c.t=t;
        long now=System.currentTimeMillis();
        java.util.LinkedHashSet<String> fam=new java.util.LinkedHashSet<>();
        java.util.LinkedHashSet<String> flags=new java.util.LinkedHashSet<>();
        java.util.HashSet<String> distinct=new java.util.HashSet<>();
        String headline="NONE";
        for(Doc d:docs){
            if(!matches(d.title,t.base,t.symbol))continue;
            long age=d.at>0?Math.max(0,now-d.at):0;
            if(age>6L*60L*60L*1000L)continue;
            if(age<=60L*60L*1000L)c.mentions60++;else c.mentionsPrev++;
            if("NONE".equals(headline))headline=d.title;
            String f=family(d.source);fam.add(f);distinct.add(d.source.toLowerCase(java.util.Locale.US));
            if(d.searchTrend)c.trending=true;
            String lo=d.source.toLowerCase(java.util.Locale.US);
            if(lo.contains("binance.com")||lo.contains("binance")){c.official=true;flags.add("OFFICIAL_OR_BINANCE");}
            String up=d.title.toUpperCase(java.util.Locale.US);
            for(String w:POS_WORDS)if(up.contains(w)){c.pos++;flag(w,flags);}
            for(String w:NEG_WORDS)if(up.contains(w)){c.neg++;flag(w,flags);}
        }
        double baseline=c.mentionsPrev/5.0;
        c.velocity=Math.min(8.0,(c.mentions60+0.5)/(baseline+0.5));
        int src=Math.min(100,fam.size()*24+Math.min(32,distinct.size()*8)+(c.official?20:0));
        c.sourceConfidence=src;
        c.families=fam.isEmpty()?"NONE":join(fam);
        c.flags=flags.isEmpty()?"NONE":join(flags);
        c.headline=clip(headline,170);
        if(c.pos>=c.neg+2){c.sentiment="POZITIF";c.direction="YUKARI_İLGİ";}
        else if(c.neg>=c.pos+2){c.sentiment="NEGATIF_RISK";c.direction="AŞAĞI_RİSK";}
        else{c.sentiment="KARISIK";c.direction="NÖTR/KARIŞIK";}
        try{V9540CatalystIntel.Snapshot cs=V9540CatalystIntel.snapshot(app,t.symbol);c.catalystScore=cs==null?0:cs.score;}catch(Throwable ignored){}
        return c;
    }

    private static int preScore(Candidate c){
        double v=Math.min(1,c.velocity/4.0),m=Math.min(1,c.mentions60/6.0);
        return (int)Math.round(35*v+25*m+20*c.sourceConfidence/100.0+10*c.catalystScore/100.0+(c.trending?10:0));
    }

    private void finish(Candidate c){
        c.talkScore=Math.max(0,Math.min(100,preScore(c)));
        double abs24=Math.abs(c.t.change24),ext=safe(c.m.extensionAtr,0);
        if(abs24>=40||ext>=2.4)c.preMoveState="GEC_KOVALAMA";
        else if(abs24>=18||ext>=1.5)c.preMoveState="HAREKET_BASLADI";
        else if(c.talkScore>=35)c.preMoveState="ERKEN";
        else c.preMoveState="IZLE";

        double tech=0;
        if(finite(c.m.volRatio))tech+=35*clamp((c.m.volRatio-0.8)/1.7,0,1);
        if(finite(c.m.oi15))tech+=30*clamp(Math.abs(c.m.oi15)/7.0,0,1);
        if(finite(c.m.mom15))tech+=20*clamp(Math.abs(c.m.mom15)/0.035,0,1);
        if(ext>0&&ext<1.5)tech+=15;
        double early=.45*c.talkScore+.20*c.sourceConfidence+.15*c.catalystScore+.20*Math.min(100,tech);
        if("HAREKET_BASLADI".equals(c.preMoveState))early-=12;
        if("GEC_KOVALAMA".equals(c.preMoveState))early-=38;
        c.earlyMoveScore=(int)Math.round(clamp(early,0,100));
        c.whyNow="60dk "+c.mentions60+" konuşma • hız "+f2(c.velocity)+"x • kaynak "+c.families+
                " • 24s "+f2(c.t.change24)+"% • hacim15 "+f2(c.m.volRatio)+"x • OI15 "+f2(c.m.oi15)+"% • "+c.preMoveState;
    }

    private void persist(java.util.List<Candidate> rows,java.util.Set<String> status)throws org.json.JSONException{
        org.json.JSONObject root=new org.json.JSONObject();root.put("updatedAt",System.currentTimeMillis());
        root.put("contract","DISCOVERY_NOT_SIGNAL");root.put("sources",status.isEmpty()?"PUANSIZ":join(status));
        org.json.JSONArray a=new org.json.JSONArray();
        for(Candidate c:rows){
            org.json.JSONObject j=new org.json.JSONObject();
            j.put("symbol",c.t.symbol);j.put("price",c.t.last);j.put("change24",c.t.change24);
            j.put("talkScore",c.talkScore);j.put("talkVelocity",c.velocity);j.put("mentions60",c.mentions60);j.put("mentionsPrev5h",c.mentionsPrev);
            j.put("sourceConfidence",c.sourceConfidence);j.put("sourceFamilies",c.families);j.put("sentiment",c.sentiment);j.put("direction",c.direction);
            j.put("earlyMoveScore",c.earlyMoveScore);j.put("preMoveState",c.preMoveState);j.put("flags",c.flags);j.put("headline",c.headline);j.put("whyNow",c.whyNow);
            j.put("catalystScore",c.catalystScore);j.put("trendingSearch",c.trending);
            j.put("extensionAtr",finite(c.m.extensionAtr)?c.m.extensionAtr:org.json.JSONObject.NULL);
            j.put("volRatio",finite(c.m.volRatio)?c.m.volRatio:org.json.JSONObject.NULL);
            j.put("oi15",finite(c.m.oi15)?c.m.oi15:org.json.JSONObject.NULL);
            j.put("mom15",finite(c.m.mom15)?c.m.mom15:org.json.JSONObject.NULL);
            j.put("rsi15",finite(c.m.rsi15)?c.m.rsi15:org.json.JSONObject.NULL);
            a.put(j);
        }
        root.put("rows",a);
        app.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE).edit().putString(KEY_JSON,root.toString())
                .putLong("updated_at",System.currentTimeMillis()).remove("last_error").apply();
    }

    private void maybeNotify(java.util.List<Candidate> rows){
        long now=System.currentTimeMillis();android.content.SharedPreferences sp=app.getSharedPreferences(PREFS,android.content.Context.MODE_PRIVATE);
        int sent=0;
        for(Candidate c:rows){
            boolean risk="AŞAĞI_RİSK".equals(c.direction)&&c.talkScore>=70&&c.sourceConfidence>=40;
            boolean early=c.talkScore>=65&&c.earlyMoveScore>=55&&"ERKEN".equals(c.preMoveState);
            if(!(risk||early))continue;
            long last=sp.getLong("notif_at_"+c.t.symbol,0L);int old=sp.getInt("notif_score_"+c.t.symbol,0);
            if(now-last<75L*60L*1000L&&c.talkScore<old+8)continue;
            notifyCandidate(c,risk);sp.edit().putLong("notif_at_"+c.t.symbol,now).putInt("notif_score_"+c.t.symbol,c.talkScore).apply();
            if(++sent>=2)break;
        }
    }

    private void notifyCandidate(Candidate c,boolean risk){
        try{
            android.app.NotificationManager nm=(android.app.NotificationManager)app.getSystemService(android.content.Context.NOTIFICATION_SERVICE);if(nm==null)return;
            String ch="v9542_early_attention";
            if(android.os.Build.VERSION.SDK_INT>=26){android.app.NotificationChannel nc=new android.app.NotificationChannel(ch,"Erken İlgi / Haber Radarı",android.app.NotificationManager.IMPORTANCE_DEFAULT);nc.setDescription("Sosyal, haber ve teknik öncü keşif uyarıları; işlem sinyali değildir.");nm.createNotificationChannel(nc);}
            android.content.Intent in=new android.content.Intent(app,V9542AttentionActivity.class);in.setAction("v9542."+c.t.symbol+"."+System.currentTimeMillis());in.putExtra("v9542_symbol",c.t.symbol);in.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK|android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flags=android.app.PendingIntent.FLAG_UPDATE_CURRENT;if(android.os.Build.VERSION.SDK_INT>=23)flags|=android.app.PendingIntent.FLAG_IMMUTABLE;
            android.app.PendingIntent pi=android.app.PendingIntent.getActivity(app,22000+Math.abs(c.t.symbol.hashCode()%7000),in,flags);
            String title=(risk?"⚠️ ERKEN RİSK • ":"🧠 ERKEN İLGİ • ")+c.t.symbol+" — "+c.talkScore+"/100";
            String body="Hız "+f2(c.velocity)+"x • "+c.sourceConfidence+"/100 kaynak • "+c.preMoveState+" • işlem sinyali değil, 15m teyit bekleniyor";
            androidx.core.app.NotificationCompat.Builder b=new androidx.core.app.NotificationCompat.Builder(app,ch)
                    .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(body)
                    .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(body+"\n"+c.whyNow+"\n"+c.headline))
                    .setAutoCancel(true).setContentIntent(pi).setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT);
            nm.notify(22000+Math.abs(c.t.symbol.hashCode()%7000),b.build());
        }catch(Throwable ignored){}
    }

    private java.util.ArrayList<Ticker> loadTickers()throws java.io.IOException{
        org.json.JSONObject ex=getObject(FAPI+"/fapi/v1/exchangeInfo");org.json.JSONArray sy=ex.optJSONArray("symbols");
        java.util.HashMap<String,String> bases=new java.util.HashMap<>();
        if(sy!=null)for(int i=0;i<sy.length();i++){org.json.JSONObject j=sy.optJSONObject(i);if(j==null)continue;
            if("TRADING".equals(j.optString("status"))&&"PERPETUAL".equals(j.optString("contractType"))&&"USDT".equals(j.optString("quoteAsset")))bases.put(j.optString("symbol"),j.optString("baseAsset"));}
        org.json.JSONArray a=getArray(FAPI+"/fapi/v1/ticker/24hr");java.util.ArrayList<Ticker> out=new java.util.ArrayList<>();
        for(int i=0;i<a.length();i++){org.json.JSONObject j=a.optJSONObject(i);if(j==null)continue;String symbol=j.optString("symbol","");String base=bases.get(symbol);if(base==null)continue;
            double p=num(j.optString("lastPrice","")),ch=num(j.optString("priceChangePercent",""));if(!finite(p)||p<=0||!finite(ch))continue;
            Ticker t=new Ticker();t.symbol=symbol;t.base=base;t.last=p;t.change24=ch;t.quoteVolume=num(j.optString("quoteVolume","0"));out.add(t);}
        return out;
    }

    private Market market(String symbol){
        Market m=new Market();try{
            org.json.JSONArray a=getArray(FAPI+"/fapi/v1/klines?symbol="+symbol+"&interval=15m&limit=48");
            java.util.ArrayList<double[]> c=new java.util.ArrayList<>();long now=System.currentTimeMillis();
            for(int i=0;i<a.length();i++){org.json.JSONArray r=a.optJSONArray(i);if(r==null||r.length()<8||r.optLong(6,0)>=now)continue;
                c.add(new double[]{num(String.valueOf(r.opt(2))),num(String.valueOf(r.opt(3))),num(String.valueOf(r.opt(4))),num(String.valueOf(r.opt(7)))});}
            if(c.size()>=22){double atr=atr(c,14),ema=ema(c,20),last=c.get(c.size()-1)[2];m.extensionAtr=atr>0?Math.abs(last-ema)/atr:Double.NaN;m.rsi15=rsi(c,14);m.volRatio=vol(c,20);m.mom15=ret(c,3);}
            org.json.JSONArray oi=getArray(FAPI+"/futures/data/openInterestHist?symbol="+symbol+"&period=5m&limit=4");
            if(oi.length()>=2){double x=num(oi.optJSONObject(0).optString("sumOpenInterest","")),y=num(oi.optJSONObject(oi.length()-1).optString("sumOpenInterest",""));if(x>0&&finite(y))m.oi15=(y/x-1)*100;}
        }catch(Throwable ignored){}return m;
    }

    private void loadGdelt(java.util.List<Doc> out)throws java.io.IOException{
        String u="https://api.gdeltproject.org/api/v2/doc/doc?query=%28crypto%20OR%20cryptocurrency%20OR%20blockchain%20OR%20token%20OR%20binance%29&mode=ArtList&maxrecords=250&format=json&timespan=6h&sort=DateDesc";
        String body=get(u,"Futures15mAlarmPRO/9.5.42 attention");
        try{org.json.JSONObject root=new org.json.JSONObject(body);org.json.JSONArray a=root.optJSONArray("articles");if(a==null)return;
            for(int i=0;i<a.length();i++){org.json.JSONObject j=a.optJSONObject(i);if(j==null)continue;String t=j.optString("title","").trim();if(t.length()<8)continue;
                out.add(new Doc(t,"NEWS:"+j.optString("domain","GDELT"),j.optString("url",""),parseDate(j.optString("seendate","")),false));}}
        catch(org.json.JSONException e){throw new java.io.IOException("GDELT JSON",e);}
    }

    private void loadReddit(java.util.List<Doc> out,String sub)throws java.io.IOException{
        String xml=get("https://www.reddit.com/r/"+sub+"/new/.rss?limit=100","Futures15mAlarmPRO/9.5.42 public RSS");
        try{org.xmlpull.v1.XmlPullParser p=android.util.Xml.newPullParser();p.setInput(new java.io.StringReader(xml));int ev=p.getEventType();boolean in=false;String title=null,link=null,stamp=null;
            while(ev!=org.xmlpull.v1.XmlPullParser.END_DOCUMENT){
                if(ev==org.xmlpull.v1.XmlPullParser.START_TAG){String n=p.getName();if("entry".equalsIgnoreCase(n)||"item".equalsIgnoreCase(n)){in=true;title=null;link=null;stamp=null;}
                    else if(in&&"title".equalsIgnoreCase(n))title=p.nextText();else if(in&&("updated".equalsIgnoreCase(n)||"published".equalsIgnoreCase(n)||"pubDate".equalsIgnoreCase(n)))stamp=p.nextText();
                    else if(in&&"link".equalsIgnoreCase(n)){String h=p.getAttributeValue(null,"href");link=h!=null?h:p.nextText();}}
                else if(ev==org.xmlpull.v1.XmlPullParser.END_TAG){String n=p.getName();if("entry".equalsIgnoreCase(n)||"item".equalsIgnoreCase(n)){if(title!=null&&title.trim().length()>8)out.add(new Doc(title.trim(),"REDDIT:r/"+sub,link,parseDate(stamp),false));in=false;}}
                ev=p.next();}}
        catch(org.xmlpull.v1.XmlPullParserException e){throw new java.io.IOException("Reddit RSS XML",e);}
    }

    private void loadCoinGeckoTrending(java.util.List<Doc> out)throws java.io.IOException{
        String body=get("https://api.coingecko.com/api/v3/search/trending","Futures15mAlarmPRO/9.5.42 attention");
        try{org.json.JSONObject root=new org.json.JSONObject(body);org.json.JSONArray a=root.optJSONArray("coins");if(a==null)return;long now=System.currentTimeMillis();
            for(int i=0;i<a.length();i++){org.json.JSONObject wrap=a.optJSONObject(i);org.json.JSONObject item=wrap==null?null:wrap.optJSONObject("item");if(item==null)continue;String sym=item.optString("symbol","").toUpperCase(java.util.Locale.US),name=item.optString("name","");if(sym.isEmpty())continue;
                out.add(new Doc("$"+sym+" "+name+" TRENDING SEARCH","COINGECKO_TREND","",now,true));}}
        catch(org.json.JSONException e){throw new java.io.IOException("CoinGecko JSON",e);}
    }

    private String get(String url,String ua)throws java.io.IOException{
        okhttp3.Request q=new okhttp3.Request.Builder().url(url).header("User-Agent",ua).get().build();
        try(okhttp3.Response r=client.newCall(q).execute()){if(!r.isSuccessful()||r.body()==null)throw new java.io.IOException("HTTP "+r.code());return r.body().string();}
    }
    private org.json.JSONArray getArray(String url)throws java.io.IOException{
        String body=get(url,"Futures15mAlarmPRO/9.5.42");try{return new org.json.JSONArray(body);}catch(org.json.JSONException e){throw new java.io.IOException("JSON array",e);}
    }
    private org.json.JSONObject getObject(String url)throws java.io.IOException{
        String body=get(url,"Futures15mAlarmPRO/9.5.42");try{return new org.json.JSONObject(body);}catch(org.json.JSONException e){throw new java.io.IOException("JSON object",e);}
    }

    private static boolean matches(String title,String base,String symbol){
        if(title==null||base==null)return false;String u=title.toUpperCase(java.util.Locale.US),b=base.toUpperCase(java.util.Locale.US);
        if(u.contains("$"+b)||u.contains(symbol)||u.contains("("+b+")")||u.contains("["+b+"]"))return true;
        if(b.length()<3||AMBIG.contains(b))return false;
        try{return java.util.regex.Pattern.compile("(^|[^A-Z0-9])"+java.util.regex.Pattern.quote(b)+"([^A-Z0-9]|$)").matcher(u).find();}catch(Throwable t){return false;}
    }
    private static String family(String s){if(s==null)return "OTHER";if(s.startsWith("REDDIT"))return "SOCIAL";if(s.startsWith("COINGECKO"))return "SEARCH_TREND";return "NEWS";}
    private static void flag(String w,java.util.Set<String> f){
        if(w.contains("BURN")||"BUYBACK".equals(w))f.add("TOKENOMICS");else if(w.contains("LIST"))f.add("LISTING");else if(w.contains("HACK")||"EXPLOIT".equals(w)||"BREACH".equals(w)||"SECURITY".equals(w))f.add("SECURITY");
        else if(w.contains("SHUT")||"CLOSURE".equals(w)||w.contains("SUSPEND")||"PAUSE".equals(w))f.add("NETWORK_RISK");else if("PARTNERSHIP".equals(w)||"PARTNER".equals(w))f.add("PARTNERSHIP");
        else if("MAINNET".equals(w)||"UPGRADE".equals(w)||"MIGRATION".equals(w))f.add("NETWORK");else if("AIRDROP".equals(w)||"STAKING".equals(w))f.add("INCENTIVE");else f.add("EVENT");
    }
    private static long parseDate(String s){
        if(s==null||s.trim().isEmpty())return System.currentTimeMillis();String x=s.trim();String[] fmts={"yyyyMMdd'T'HHmmss'Z'","yyyyMMddHHmmss","yyyy-MM-dd'T'HH:mm:ssXXX","yyyy-MM-dd'T'HH:mm:ss.SSSXXX","EEE, dd MMM yyyy HH:mm:ss Z"};
        for(String f:fmts)try{java.text.SimpleDateFormat d=new java.text.SimpleDateFormat(f,java.util.Locale.US);d.setLenient(true);if(f.endsWith("'Z'"))d.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));java.util.Date z=d.parse(x);if(z!=null)return z.getTime();}catch(Throwable ignored){}
        return System.currentTimeMillis();
    }
    private static void dedupe(java.util.ArrayList<Doc> a){java.util.HashSet<String>s=new java.util.HashSet<>();java.util.Iterator<Doc>it=a.iterator();while(it.hasNext()){Doc d=it.next();String k=d.title.toLowerCase(java.util.Locale.US).replaceAll("\\s+"," ").trim();if(k.isEmpty()||!s.add(k))it.remove();}java.util.Collections.sort(a,(x,y)->Long.compare(y.at,x.at));}
    private static double ret(java.util.List<double[]>a,int n){if(a.size()<=n)return Double.NaN;double x=a.get(a.size()-1-n)[2],y=a.get(a.size()-1)[2];return x>0?y/x-1:Double.NaN;}
    private static double atr(java.util.List<double[]>a,int n){if(a.size()<n+1)return Double.NaN;double s=0;int k=0;for(int i=Math.max(1,a.size()-n);i<a.size();i++){double[]c=a.get(i),p=a.get(i-1);s+=Math.max(c[0]-c[1],Math.max(Math.abs(c[0]-p[2]),Math.abs(c[1]-p[2])));k++;}return k>0?s/k:Double.NaN;}
    private static double ema(java.util.List<double[]>a,int n){if(a.isEmpty())return Double.NaN;double e=a.get(0)[2],al=2.0/(n+1);for(int i=1;i<a.size();i++)e=al*a.get(i)[2]+(1-al)*e;return e;}
    private static double rsi(java.util.List<double[]>a,int n){if(a.size()<n+1)return Double.NaN;double g=0,l=0;for(int i=a.size()-n;i<a.size();i++){double d=a.get(i)[2]-a.get(i-1)[2];if(d>0)g+=d;else l-=d;}if(l==0)return 100;double rs=g/l;return 100-100/(1+rs);}
    private static double vol(java.util.List<double[]>a,int n){if(a.size()<n+1)return Double.NaN;double s=0;for(int i=a.size()-1-n;i<a.size()-1;i++)s+=Math.max(0,a.get(i)[3]);double av=s/n;return av>0?a.get(a.size()-1)[3]/av:Double.NaN;}
    private static double num(String s){try{return Double.parseDouble(s);}catch(Throwable t){return Double.NaN;}}
    private static double safe(double x,double d){return finite(x)?x:d;}private static boolean finite(double x){return !Double.isNaN(x)&&!Double.isInfinite(x);}private static double clamp(double x,double a,double b){return Math.max(a,Math.min(b,x));}
    private static String f2(double x){return finite(x)?String.format(java.util.Locale.US,"%.2f",x):"N/A";}private static String clip(String s,int n){if(s==null||s.trim().isEmpty())return "NONE";String x=s.replaceAll("\\s+"," ").trim();return x.length()<=n?x:x.substring(0,n-1)+"…";}
    private static String join(java.util.Collection<String>a){StringBuilder b=new StringBuilder();for(String s:a){if(b.length()>0)b.append(',');b.append(s);}return b.toString();}
}
'''
ATTN.write_text(attention)

activity = r'''package com.futuresalarm.app;

public class V9542AttentionActivity extends android.app.Activity {
    private android.widget.LinearLayout list;private android.widget.TextView status;
    private final android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable updater=new Runnable(){@Override public void run(){render();handler.postDelayed(this,20_000L);}};

    @Override protected void onCreate(android.os.Bundle b){super.onCreate(b);if(android.os.Build.VERSION.SDK_INT>=21){getWindow().setStatusBarColor(android.graphics.Color.rgb(8,13,22));getWindow().setNavigationBarColor(android.graphics.Color.rgb(8,13,22));}
        V9542AttentionRadar.start(this);android.widget.ScrollView scroll=new android.widget.ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(android.graphics.Color.rgb(8,13,22));
        android.widget.LinearLayout root=new android.widget.LinearLayout(this);root.setOrientation(android.widget.LinearLayout.VERTICAL);root.setPadding(dp(16),dp(16),dp(16),dp(30));scroll.addView(root,new android.widget.ScrollView.LayoutParams(-1,-2));
        root.addView(txt("🔥 ERKEN İLGİ / ÇOK KONUŞULAN • v9.5.42",24,android.graphics.Color.WHITE,true));
        android.widget.TextView info=txt("Haber + Reddit + arama ilgisi + Binance Futures öncü hareketi. Amaç fiyat genişlemeden önce dikkat gerektiren coinleri bulmaktır; bu ekran işlem sinyali değildir.",14,android.graphics.Color.rgb(170,185,205),false);info.setPadding(0,dp(7),0,dp(8));root.addView(info);
        status=txt("İlgi radarı hazırlanıyor...",14,android.graphics.Color.rgb(255,193,7),true);root.addView(status);
        android.widget.Button refresh=btn("↻ ŞİMDİ TARA",android.graphics.Color.rgb(0,130,170));root.addView(refresh,lp(-1,dp(54),8,8));refresh.setOnClickListener(v->{status.setText("⏳ Haber / sosyal / Futures verisi yenileniyor...");V9542AttentionRadar.requestRefresh(this);handler.postDelayed(this::render,3500L);});
        list=new android.widget.LinearLayout(this);list.setOrientation(android.widget.LinearLayout.VERTICAL);root.addView(list,new android.widget.LinearLayout.LayoutParams(-1,-2));
        android.widget.Button back=btn("GERİ",android.graphics.Color.rgb(65,78,98));root.addView(back,lp(-1,dp(52),12,0));back.setOnClickListener(v->finish());setContentView(scroll);render();}
    @Override protected void onResume(){super.onResume();handler.removeCallbacks(updater);handler.post(updater);}@Override protected void onPause(){handler.removeCallbacks(updater);super.onPause();}

    private void render(){if(list==null)return;list.removeAllViews();String raw=V9542AttentionRadar.latestJson(this);if(raw==null||raw.trim().isEmpty()){status.setText("⏳ İlk tarama hazırlanıyor. Birkaç saniye sonra ŞİMDİ TARA'ya dokun.");return;}
        try{org.json.JSONObject root=new org.json.JSONObject(raw);long at=root.optLong("updatedAt",0);long age=at>0?Math.max(0,(System.currentTimeMillis()-at)/1000):-1;status.setText((age>=0?"Son tarama: "+age+" sn önce":"Tarama hazır")+" • kaynak: "+root.optString("sources","PUANSIZ"));org.json.JSONArray rows=root.optJSONArray("rows");if(rows==null)return;
            section("🔥 ÇOK KONUŞULAN",rows,0);section("🚀 ERKEN POZİTİF İLGİ",rows,1);section("⚠️ ERKEN NEGATİF / RİSK",rows,2);}catch(Throwable t){status.setText("İlgi verisi okunamadı: "+t.getClass().getSimpleName());}}

    private void section(String title,org.json.JSONArray rows,int mode){android.widget.TextView h=txt(title,19,mode==2?android.graphics.Color.rgb(255,115,115):mode==1?android.graphics.Color.rgb(80,225,145):android.graphics.Color.rgb(255,190,70),true);h.setPadding(0,dp(15),0,dp(5));list.addView(h);int shown=0;
        for(int i=0;i<rows.length()&&shown<5;i++){org.json.JSONObject r=rows.optJSONObject(i);if(r==null)continue;String dir=r.optString("direction","NÖTR/KARIŞIK"),state=r.optString("preMoveState","N/A");
            if(mode==1&&(!"YUKARI_İLGİ".equals(dir)||"GEC_KOVALAMA".equals(state)))continue;if(mode==2&&!"AŞAĞI_RİSK".equals(dir))continue;addCard(r,mode);shown++;}
        if(shown==0){android.widget.TextView none=txt("Bu kategoride şu an yeterli güvenli aday yok.",13,android.graphics.Color.rgb(145,160,180),false);none.setPadding(dp(8),dp(4),0,dp(5));list.addView(none);}}

    private void addCard(org.json.JSONObject r,int mode){String symbol=r.optString("symbol","?"),dir=r.optString("direction","NÖTR/KARIŞIK"),state=r.optString("preMoveState","N/A");int talk=r.optInt("talkScore",0),early=r.optInt("earlyMoveScore",0),conf=r.optInt("sourceConfidence",0);
        android.widget.LinearLayout c=new android.widget.LinearLayout(this);c.setOrientation(android.widget.LinearLayout.VERTICAL);c.setPadding(dp(13),dp(11),dp(13),dp(11));c.setBackgroundColor(android.graphics.Color.rgb(14,28,45));list.addView(c,lp(-1,-2,6,0));int accent=mode==2?android.graphics.Color.rgb(255,110,110):mode==1?android.graphics.Color.rgb(75,220,140):android.graphics.Color.rgb(100,185,255);
        c.addView(txt(symbol+" • TALK "+talk+"/100 • ERKEN "+early+"/100",18,accent,true));c.addView(txt("Hız "+f(r.optDouble("talkVelocity",Double.NaN))+"x • 60dk "+r.optInt("mentions60",0)+" konuşma • kaynak güveni "+conf+"/100\n"+dir+" • "+state+" • "+r.optString("sourceFamilies","NONE")+"\n"+r.optString("whyNow","NONE")+"\n"+r.optString("headline","NONE"),13,android.graphics.Color.rgb(215,225,238),false));
        android.widget.Button pack=btn("ANALİZ PAKETİ • TEKNİK TEYİT",android.graphics.Color.rgb(91,61,190));c.addView(pack,lp(-1,dp(48),8,0));pack.setOnClickListener(v->{android.content.Intent x=new android.content.Intent(this,AnalysisPackActivity.class);x.putExtra("v9538_symbol",symbol);x.putExtra("v9538_autobuild",true);startActivity(x);});}
    private android.widget.TextView txt(String s,float sp,int color,boolean bold){android.widget.TextView v=new android.widget.TextView(this);v.setText(s);v.setTextSize(sp);v.setTextColor(color);if(bold)v.setTypeface(android.graphics.Typeface.DEFAULT,android.graphics.Typeface.BOLD);v.setLineSpacing(0,1.07f);return v;}
    private android.widget.Button btn(String s,int color){android.widget.Button b=new android.widget.Button(this);b.setText(s);b.setTextColor(android.graphics.Color.WHITE);b.setTextSize(13);b.setAllCaps(false);b.setBackgroundColor(color);return b;}
    private android.widget.LinearLayout.LayoutParams lp(int w,int h,int top,int bottom){android.widget.LinearLayout.LayoutParams p=new android.widget.LinearLayout.LayoutParams(w,h);p.setMargins(0,dp(top),0,dp(bottom));return p;}private int dp(int x){return(int)(x*getResources().getDisplayMetrics().density+.5f);}private static String f(double x){return Double.isNaN(x)||Double.isInfinite(x)?"N/A":String.format(java.util.Locale.US,"%.2f",x);}
}
'''
ATTN_ACTIVITY.write_text(activity)

# Manifest activity
mf=MANIFEST.read_text()
if 'V9542AttentionActivity' not in mf:
    if '</application>' not in mf:raise SystemExit('v9.5.42 manifest application anchor missing')
    mf=mf.replace('</application>','        <activity android:name=".V9542AttentionActivity" android:exported="false" />\n</application>',1)
MANIFEST.write_text(mf)

# MainActivity: persistent separate card + engine start.
m=MAIN.read_text()
m=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.42',m)
m=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.42  •  MANUEL PRO',m)
if 'private void v9542EnsureAttentionCard()' not in m:
    idx=m.rfind('}')
    if idx<0:raise SystemExit('v9.5.42 MainActivity closing brace missing')
    helper=r'''

    // V9542_ATTENTION_CARD_PERSISTENCE
    private static final String V9542_ATTENTION_TAG="v9542_attention_card";
    private boolean v9542AttentionEnsuring=false,v9542AttentionObserverInstalled=false;
    private void v9542InstallAttentionPersistence(){
        if(v9542AttentionObserverInstalled)return;v9542AttentionObserverInstalled=true;
        try{final android.view.ViewGroup content=findViewById(android.R.id.content);if(content==null)return;content.getViewTreeObserver().addOnGlobalLayoutListener(()->{if(!v9542AttentionEnsuring)content.post(this::v9542EnsureAttentionCard);});content.post(this::v9542EnsureAttentionCard);}catch(Throwable ignored){}
    }
    private void v9542EnsureAttentionCard(){
        if(v9542AttentionEnsuring)return;v9542AttentionEnsuring=true;
        try{android.view.ViewGroup content=findViewById(android.R.id.content);if(content==null||content.getChildCount()==0)return;android.view.View base=content.getChildAt(0);android.widget.LinearLayout root=null;
            if(base instanceof android.widget.ScrollView){android.widget.ScrollView sv=(android.widget.ScrollView)base;if(sv.getChildCount()>0&&sv.getChildAt(0) instanceof android.widget.LinearLayout)root=(android.widget.LinearLayout)sv.getChildAt(0);}else if(base instanceof android.widget.LinearLayout)root=(android.widget.LinearLayout)base;if(root==null)return;
            android.view.View card=root.findViewWithTag(V9542_ATTENTION_TAG);if(card==null){android.widget.Button b=new android.widget.Button(this);b.setAllCaps(false);card=b;card.setTag(V9542_ATTENTION_TAG);android.widget.LinearLayout.LayoutParams lp=new android.widget.LinearLayout.LayoutParams(-1,dp(88));lp.setMargins(0,dp(8),0,dp(8));int radar=-1,api=-1;for(int i=0;i<root.getChildCount();i++){android.view.View c=root.getChildAt(i);if(v9539HasText(c,"FUTURES RADAR"))radar=i;if(v9539HasText(c,"BINANCE API / EMİR"))api=i;}int pos=radar>=0?radar:(api>=0?api:root.getChildCount());root.addView(card,Math.max(0,Math.min(pos,root.getChildCount())),lp);}
            if(card instanceof android.widget.TextView){android.widget.TextView t=(android.widget.TextView)card;t.setText(v9542AttentionSummary());t.setTextSize(16);t.setTextColor(android.graphics.Color.WHITE);t.setGravity(android.view.Gravity.CENTER);t.setBackgroundColor(android.graphics.Color.rgb(118,68,18));t.setOnClickListener(v->startActivity(new android.content.Intent(this,V9542AttentionActivity.class)));}
        }catch(Throwable ignored){}finally{v9542AttentionEnsuring=false;}
    }
    private String v9542AttentionSummary(){
        String raw=V9542AttentionRadar.latestJson(this);if(raw==null||raw.trim().isEmpty())return "🔥 ERKEN İLGİ / ÇOK KONUŞULAN\nHaber • sosyal • arama ilgisi • Futures öncü tarama hazırlanıyor";
        try{org.json.JSONObject root=new org.json.JSONObject(raw);org.json.JSONArray a=root.optJSONArray("rows");StringBuilder s=new StringBuilder("🔥 ERKEN İLGİ / ÇOK KONUŞULAN\n");if(a==null||a.length()==0)return s.append("Şu an güçlü aday yok • dokun: ayrıntı").toString();int n=Math.min(3,a.length());for(int i=0;i<n;i++){org.json.JSONObject r=a.optJSONObject(i);if(r==null)continue;if(i>0)s.append("  •  ");s.append(r.optString("symbol","?")).append(' ').append(r.optInt("talkScore",0));}s.append("\nDokun: Çok Konuşulan • Erken Pozitif • Erken Risk");return s.toString();}catch(Throwable ignored){return "🔥 ERKEN İLGİ / ÇOK KONUŞULAN\nVeri yenileniyor • dokun: ayrıntı";}
    }
'''
    m=m[:idx]+helper+'\n'+m[idx:]

b=method_bounds(m,'protected void onCreate(')
if not b:raise SystemExit('v9.5.42 MainActivity onCreate missing')
a,_,e=b;body=m[a:e]
if 'V9542_ATTENTION_START' not in body:
    anchor='v9540InstallRadarPersistence();'
    if anchor not in body:raise SystemExit('v9.5.42 radar persistence anchor missing')
    body=body.replace(anchor,anchor+'\n        // V9542_ATTENTION_START\n        V9542AttentionRadar.start(this);\n        v9542InstallAttentionPersistence();',1);m=m[:a]+body+m[e:]
if 'V9542_AFTER_BUILDUI_REBUILD' not in m:
    pat=r'setContentView\s*\(\s*buildUi\(\)\s*\)\s*;'
    if not re.search(pat,m):raise SystemExit('v9.5.42 buildUi setContentView anchor missing')
    m=re.sub(pat,lambda q:q.group(0)+'\n        // V9542_AFTER_BUILDUI_REBUILD\n        try { getWindow().getDecorView().post(this::v9542EnsureAttentionCard); } catch(Throwable ignored) {}',m)
b=method_bounds(m,'protected void onResume(')
if b:
    a,_,e=b;body=m[a:e]
    if 'V9542_RESUME_ATTENTION' not in body:
        p=body.rfind('}');body=body[:p]+'        // V9542_RESUME_ATTENTION\n        try { v9542EnsureAttentionCard(); } catch(Throwable ignored) {}\n'+body[p:];m=m[:a]+body+m[e:]
MAIN.write_text(m)

# MonitorService keeps the attention engine alive while normal monitoring is active.
mon=MON.read_text();mon=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.42',mon)
if 'V9542_ATTENTION_SERVICE_START' not in mon:
    b=method_bounds(mon,'void onCreate()')
    if not b:raise SystemExit('v9.5.42 MonitorService onCreate missing')
    a,_,e=b;body=mon[a:e];bi=body.find('{');body=body[:bi+1]+'\n        // V9542_ATTENTION_SERVICE_START\n        V9542AttentionRadar.start(this);\n'+body[bi+1:];mon=mon[:a]+body+mon[e:]
MON.write_text(mon)

# Analysis package includes attention context beside existing market-radar context.
an=ANALYSIS.read_text();an=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.42',an);an=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.42',an)
b=method_bounds(an,'    private String buildPrompt(')
if not b:raise SystemExit('v9.5.42 buildPrompt missing')
a,_,e=b;body=an[a:e]
if 'V9542_ATTENTION_PROMPT_CONTEXT' not in body:
    anchor='if(v9538Radar!=null&&!v9538Radar.isEmpty())sb.append(v9538Radar);'
    if anchor not in body:raise SystemExit('v9.5.42 radar prompt anchor missing')
    body=body.replace(anchor,anchor+'\n        // V9542_ATTENTION_PROMPT_CONTEXT\n        String v9542Attention=V9542AttentionRadar.promptContext(this,symbol);\n        if(v9542Attention!=null&&!v9542Attention.isEmpty())sb.append(v9542Attention);',1);an=an[:a]+body+an[e:]
ANALYSIS.write_text(an)

# Consistent version text in generated radar files.
for p in (RADAR,ENGINE):
    s=p.read_text();s=re.sub(r'v9\.5(?:\.\d+)*','v9.5.42',s);s=re.sub(r'V9\.5(?:\.\d+)*','V9.5.42',s);p.write_text(s)

bf=BUILD.read_text();bf=re.sub(r'versionCode\s+\d+','versionCode 26091305',bf,count=1);bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.42'",bf,count=1);BUILD.write_text(bf)

# Fail-fast regression checks.
main=MAIN.read_text();mon=MON.read_text();ana=ANALYSIS.read_text();manifest=MANIFEST.read_text();att=ATTN.read_text();act=ATTN_ACTIVITY.read_text();build=BUILD.read_text()
checks={
    'attention engine generated':ATTN.exists() and 'TALK_SCORE:' in att and 'COINGECKO_TREND' in att and 'REDDIT' in att and 'GDELT' in att,
    'three attention rankings':'ÇOK KONUŞULAN' in act and 'ERKEN POZİTİF İLGİ' in act and 'ERKEN NEGATİF / RİSK' in act,
    'persistent main attention card':'V9542_ATTENTION_CARD_PERSISTENCE' in main and 'v9542EnsureAttentionCard' in main,
    'attention survives buildUi':'V9542_AFTER_BUILDUI_REBUILD' in main,
    'monitor attention start':'V9542_ATTENTION_SERVICE_START' in mon,
    'analysis attention context':'V9542_ATTENTION_PROMPT_CONTEXT' in ana and 'V9542AttentionRadar.promptContext' in ana,
    'manifest activity':'V9542AttentionActivity' in manifest,
    'discovery-only guard':'ATTENTION_KURAL:' in att and 'işlem sinyali değil' in att,
    'notification early warning':'v9542_early_attention' in att and '15m teyit bekleniyor' in att,
    'radar persistence retained':'v9540EnsureRadarCard' in main,
    'signal tap persistence retained':'v9541RepairNotificationSignal' in main,
    'version code':'versionCode 26091305' in build,
    'version name':"versionName '9.5.42'" in build,
}
for name,ok in checks.items():print(('OK   ' if ok else 'FAIL '),name)
bad=[name for name,ok in checks.items() if not ok]
if bad:raise SystemExit('v9.5.42 sanity failed: '+', '.join(bad))
print('v9.5.42 OK: persistent attention card + most-talked / early-positive / early-risk rankings + discovery notifications + prompt context.')
