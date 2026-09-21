from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
ANA=JAVA/'AnalysisPackActivity.java'
MAIN=JAVA/'MainActivity.java'
MON=JAVA/'MonitorService.java'
BUILD=APP/'app/build.gradle'
L2=JAVA/'V9563MicrostructureFeed.java'
for p in (ANA,MAIN,MON,BUILD):
    if not p.exists():
        raise SystemExit('v9.5.63 missing: '+str(p))


def method_bounds(src, fragment):
    a=src.find(fragment)
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

# ---------------------------------------------------------------------------
# V9.5.63 REAL L2 MICROSTRUCTURE — SOFT CONTEXT ONLY
#
# Independent Android implementation informed by public market-microstructure
# literature and MIT-licensed research references (liquidity-scanner,
# orderbook-heatmap, Entropy-Liquidity-Monitor, orderbook-microstructure).
# No third-party source is copied.  GPL/unlicensed projects were research-only.
#
# Goals:
# - Binance USD-M depth@100ms + aggTrade, seeded by REST depth snapshot.
# - sequence-gap detection: a broken local book is never silently trusted.
# - observed resting-liquidity wall age/persistence, top-book OFI, trade delta,
#   microprice, normalized depth entropy, absorption and pull/spoof *risk*.
# - absolutely NO new trade hard gate. Missing/stale/warming data is PUANSIZ.
# - when live L2 exists it supersedes the old REST BOOK_MICRO inside the SAME
#   execution/micro family, so it is never double-counted.
# ---------------------------------------------------------------------------

java=r'''package com.futuresalarm.app;

/**
 * v9.5.63 observed Binance USD-M L2 microstructure context.
 *
 * IMPORTANT: this class does not create signals/orders and is never a hard veto.
 * Resting orders may be cancelled/spoofed; wall/spoof/absorption outputs are
 * probabilistic context labels, never market-maker intent claims.
 */
final class V9563MicrostructureFeed {
    private static final String REST="https://fapi.binance.com";
    private static final String WSS="wss://fstream.binance.com/stream?streams=";
    private static final int MAX_SYMBOLS=12;
    private static final long STALE_MS=8_000L;
    private static final long KEEP_FLOW_MS=15_000L;
    private static volatile V9563MicrostructureFeed INSTANCE;

    private final android.content.Context app;
    private final okhttp3.OkHttpClient client;
    private final java.util.concurrent.ExecutorService pool=
            java.util.concurrent.Executors.newFixedThreadPool(3);
    private final android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final java.util.LinkedHashMap<String,State> states=
            new java.util.LinkedHashMap<String,State>(16,0.75f,true);

    private static final class Flow {
        final long t; final double signed; final double abs;
        Flow(long t,double signed,double abs){this.t=t;this.signed=signed;this.abs=abs;}
    }
    private static final class Mid {
        final long t; final double p;
        Mid(long t,double p){this.t=t;this.p=p;}
    }
    private static final class WallTrack {
        final boolean bid; final double price;
        long firstSeen,lastSeen,pulledAt; int seen;
        double lastNotional,lastShare;
        WallTrack(boolean bid,double price,long now){this.bid=bid;this.price=price;firstSeen=lastSeen=now;}
    }
    private static final class Wall {
        boolean valid,bid; double price,notional,share; long ageMs; int seen; String trust="LOW";
    }
    private static final class State {
        final String symbol;
        final java.util.NavigableMap<Double,Double> bids=
                new java.util.TreeMap<Double,Double>(java.util.Collections.reverseOrder());
        final java.util.NavigableMap<Double,Double> asks=new java.util.TreeMap<Double,Double>();
        final java.util.ArrayDeque<Flow> trades=new java.util.ArrayDeque<>();
        final java.util.ArrayDeque<Flow> ofi=new java.util.ArrayDeque<>();
        final java.util.ArrayDeque<Mid> mids=new java.util.ArrayDeque<>();
        final java.util.HashMap<Long,WallTrack> walls=new java.util.HashMap<>();
        okhttp3.WebSocket ws;
        boolean connecting,connected,seeded,firstDepth=true;
        long generation,seedId,lastU,continuousSince,lastEventAt,lastBookAt,lastTradeAt,lastScanAt,lastRequestedAt;
        long lastSpoofAt,spoofWindowStart; int spoofPulls;
        String lastSpoofSide="NONE";
        State(String symbol){this.symbol=symbol;}
    }

    static V9563MicrostructureFeed get(android.content.Context c){
        V9563MicrostructureFeed x=INSTANCE;
        if(x==null){synchronized(V9563MicrostructureFeed.class){x=INSTANCE;if(x==null){
            x=new V9563MicrostructureFeed(c.getApplicationContext());INSTANCE=x;
        }}}
        return x;
    }
    private V9563MicrostructureFeed(android.content.Context c){
        app=c;
        client=new okhttp3.OkHttpClient.Builder()
                .connectTimeout(8,java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(0,java.util.concurrent.TimeUnit.MILLISECONDS)
                .pingInterval(90,java.util.concurrent.TimeUnit.SECONDS)
                .retryOnConnectionFailure(true).build();
    }

    private static boolean finite(double x){return !Double.isNaN(x)&&!Double.isInfinite(x);}
    private static double clamp(double x,double lo,double hi){return Math.max(lo,Math.min(hi,x));}
    private static String norm(String symbol){
        if(symbol==null)return "";
        String s=symbol.trim().toUpperCase(java.util.Locale.US);
        return s.matches("[A-Z0-9_]{3,30}")?s:"";
    }
    private State state(String symbol){
        String s=norm(symbol); if(s.isEmpty())return null;
        synchronized(states){
            State st=states.get(s);
            if(st==null){
                if(states.size()>=MAX_SYMBOLS){
                    java.util.Iterator<java.util.Map.Entry<String,State>> it=states.entrySet().iterator();
                    if(it.hasNext()){
                        State old=it.next().getValue();
                        if(old.ws!=null)try{old.ws.cancel();}catch(Throwable ignored){}
                        it.remove();
                    }
                }
                st=new State(s); states.put(s,st);
            }
            st.lastRequestedAt=System.currentTimeMillis();
            return st;
        }
    }

    void touch(String symbol){State s=state(symbol);if(s!=null)ensure(s);}

    private void ensure(final State s){
        synchronized(s){
            if(s.connected||s.connecting)return;
            s.connecting=true; s.generation++;
        }
        final long gen=s.generation;
        pool.execute(() -> {
            try{
                if(!seed(s,gen)){failed(s,gen,1500L);return;}
                open(s,gen);
            }catch(Throwable t){failed(s,gen,1800L);}
        });
    }

    private boolean seed(State s,long gen)throws java.io.IOException{
        okhttp3.Request req=new okhttp3.Request.Builder()
                .url(REST+"/fapi/v1/depth?symbol="+s.symbol+"&limit=100").get().build();
        try(okhttp3.Response res=client.newCall(req).execute()){
            if(!res.isSuccessful()||res.body()==null)return false;
            org.json.JSONObject o=new org.json.JSONObject(res.body().string());
            java.util.NavigableMap<Double,Double> nb=
                    new java.util.TreeMap<Double,Double>(java.util.Collections.reverseOrder());
            java.util.NavigableMap<Double,Double> na=new java.util.TreeMap<Double,Double>();
            parseSnapshotSide(o.optJSONArray("bids"),nb);
            parseSnapshotSide(o.optJSONArray("asks"),na);
            long id=o.optLong("lastUpdateId",0L);
            if(id<=0||nb.isEmpty()||na.isEmpty())return false;
            synchronized(s){
                if(gen!=s.generation)return false;
                s.bids.clear();s.bids.putAll(nb);s.asks.clear();s.asks.putAll(na);
                s.seedId=id;s.lastU=0L;s.firstDepth=true;s.seeded=true;
                s.lastBookAt=System.currentTimeMillis();
                noteMid(s,s.lastBookAt);
                scanWalls(s,s.lastBookAt,true);
            }
            return true;
        }
    }
    private static void parseSnapshotSide(org.json.JSONArray a,java.util.NavigableMap<Double,Double> out){
        if(a==null)return;
        for(int i=0;i<a.length();i++){
            org.json.JSONArray r=a.optJSONArray(i);if(r==null||r.length()<2)continue;
            try{
                double p=Double.parseDouble(r.optString(0,""));
                double q=Double.parseDouble(r.optString(1,""));
                if(finite(p)&&finite(q)&&p>0&&q>0)out.put(p,q);
            }catch(Throwable ignored){}
        }
    }

    private void open(final State s,final long gen){
        String low=s.symbol.toLowerCase(java.util.Locale.US);
        String url=WSS+low+"@depth@100ms/"+low+"@aggTrade";
        okhttp3.Request req=new okhttp3.Request.Builder().url(url).build();
        okhttp3.WebSocket ws=client.newWebSocket(req,new okhttp3.WebSocketListener(){
            @Override public void onOpen(okhttp3.WebSocket w,okhttp3.Response response){
                synchronized(s){
                    if(gen!=s.generation){w.cancel();return;}
                    s.ws=w;s.connected=true;s.connecting=false;s.continuousSince=System.currentTimeMillis();
                    s.lastEventAt=s.continuousSince;
                }
            }
            @Override public void onMessage(okhttp3.WebSocket w,String text){handle(s,gen,text);}
            @Override public void onClosed(okhttp3.WebSocket w,int code,String reason){failed(s,gen,1200L);}
            @Override public void onFailure(okhttp3.WebSocket w,Throwable t,okhttp3.Response response){failed(s,gen,1800L);}
        });
        synchronized(s){if(gen==s.generation)s.ws=ws;else ws.cancel();}
    }

    private void failed(final State s,long gen,long delay){
        synchronized(s){
            if(gen!=s.generation)return;
            s.connected=false;s.connecting=false;s.seeded=false;s.continuousSince=0L;s.lastU=0L;
            if(s.ws!=null)try{s.ws.cancel();}catch(Throwable ignored){}
        }
        handler.postDelayed(() -> {
            if(System.currentTimeMillis()-s.lastRequestedAt<=2L*60L*60L*1000L)ensure(s);
        },delay);
    }
    private void sequenceGap(final State s,long gen){
        synchronized(s){
            if(gen!=s.generation)return;
            s.generation++;s.connected=false;s.connecting=false;s.seeded=false;s.continuousSince=0L;s.lastU=0L;
            if(s.ws!=null)try{s.ws.cancel();}catch(Throwable ignored){}
        }
        handler.postDelayed(() -> ensure(s),250L);
    }

    private void handle(State s,long gen,String text){
        if(text==null||text.isEmpty())return;
        try{
            org.json.JSONObject root=new org.json.JSONObject(text);
            org.json.JSONObject d=root.optJSONObject("data");if(d==null)d=root;
            String e=d.optString("e","");
            if("depthUpdate".equals(e))handleDepth(s,gen,d);
            else if("aggTrade".equals(e))handleTrade(s,gen,d);
        }catch(Throwable ignored){}
    }

    private void handleDepth(State s,long gen,org.json.JSONObject d){
        long U=d.optLong("U",0L),u=d.optLong("u",0L),pu=d.optLong("pu",0L);
        if(U<=0||u<=0)return;
        long now=System.currentTimeMillis();
        synchronized(s){
            if(gen!=s.generation||!s.seeded)return;
            if(s.firstDepth){
                if(u<s.seedId)return;
                if(U>s.seedId+1L){pool.execute(() -> sequenceGap(s,gen));return;}
                s.firstDepth=false;
            }else if(s.lastU>0L&&pu>0L&&pu!=s.lastU){
                pool.execute(() -> sequenceGap(s,gen));return;
            }
            double pb=bestBid(s),pba=bidQty(s),pa=bestAsk(s),paa=askQty(s);
            applySide(s.bids,d.optJSONArray("b"));applySide(s.asks,d.optJSONArray("a"));
            trim(s.bids,220);trim(s.asks,220);
            s.lastU=u;s.lastBookAt=now;s.lastEventAt=now;
            double nb=bestBid(s),nba=bidQty(s),na=bestAsk(s),naa=askQty(s);
            double ev=ofiEvent(pb,pba,pa,paa,nb,nba,na,naa);
            double mag=Math.abs(ev)+Math.abs(nba-pba)+Math.abs(naa-paa);
            if(finite(ev)&&finite(mag)&&mag>0)s.ofi.addLast(new Flow(now,ev,mag));
            noteMid(s,now);prune(s,now);
            if(now-s.lastScanAt>=300L){scanWalls(s,now,false);s.lastScanAt=now;}
        }
    }
    private static void applySide(java.util.NavigableMap<Double,Double> book,org.json.JSONArray a){
        if(a==null)return;
        for(int i=0;i<a.length();i++){
            org.json.JSONArray r=a.optJSONArray(i);if(r==null||r.length()<2)continue;
            try{
                double p=Double.parseDouble(r.optString(0,""));double q=Double.parseDouble(r.optString(1,""));
                if(!finite(p)||!finite(q)||p<=0||q<0)continue;
                if(q==0)book.remove(p);else book.put(p,q);
            }catch(Throwable ignored){}
        }
    }
    private static void trim(java.util.NavigableMap<Double,Double> m,int n){
        while(m.size()>n){try{m.pollLastEntry();}catch(Throwable t){break;}}
    }

    private void handleTrade(State s,long gen,org.json.JSONObject d){
        long now=System.currentTimeMillis();
        try{
            double p=Double.parseDouble(d.optString("p",""));double q=Double.parseDouble(d.optString("q",""));
            if(!finite(p)||!finite(q)||p<=0||q<=0)return;
            boolean buyerMaker=d.optBoolean("m",false);
            double abs=p*q;double signed=buyerMaker?-abs:abs;
            synchronized(s){
                if(gen!=s.generation)return;
                s.trades.addLast(new Flow(now,signed,abs));s.lastTradeAt=now;s.lastEventAt=now;prune(s,now);
            }
        }catch(Throwable ignored){}
    }

    private static double bestBid(State s){return s.bids.isEmpty()?Double.NaN:s.bids.firstKey();}
    private static double bestAsk(State s){return s.asks.isEmpty()?Double.NaN:s.asks.firstKey();}
    private static double bidQty(State s){return s.bids.isEmpty()?0:s.bids.firstEntry().getValue();}
    private static double askQty(State s){return s.asks.isEmpty()?0:s.asks.firstEntry().getValue();}
    private static double mid(State s){double b=bestBid(s),a=bestAsk(s);return finite(b)&&finite(a)&&a>b?(a+b)*0.5:Double.NaN;}
    private static double micro(State s){
        double b=bestBid(s),a=bestAsk(s),bq=bidQty(s),aq=askQty(s),den=bq+aq;
        return finite(b)&&finite(a)&&den>0?(a*bq+b*aq)/den:Double.NaN;
    }
    private static double ofiEvent(double pb,double qb,double pa,double qa,double b,double bq,double a,double aq){
        if(!finite(pb)||!finite(pa)||!finite(b)||!finite(a))return Double.NaN;
        double bid=(b>=pb?bq:0)-(b<=pb?qb:0);
        double ask=(a<=pa?aq:0)-(a>=pa?qa:0);
        return bid-ask;
    }
    private static void noteMid(State s,long now){double m=mid(s);if(finite(m))s.mids.addLast(new Mid(now,m));}
    private static void prune(State s,long now){
        while(!s.trades.isEmpty()&&now-s.trades.peekFirst().t>KEEP_FLOW_MS)s.trades.removeFirst();
        while(!s.ofi.isEmpty()&&now-s.ofi.peekFirst().t>KEEP_FLOW_MS)s.ofi.removeFirst();
        while(!s.mids.isEmpty()&&now-s.mids.peekFirst().t>KEEP_FLOW_MS)s.mids.removeFirst();
    }

    private static long wallKey(boolean bid,double p){
        long x=Double.doubleToLongBits(p);return bid?x:(x^0x8000000000000000L);
    }
    private static java.util.List<java.util.Map.Entry<Double,Double>> top(java.util.NavigableMap<Double,Double> m,int n){
        java.util.ArrayList<java.util.Map.Entry<Double,Double>> out=new java.util.ArrayList<>();
        int i=0;for(java.util.Map.Entry<Double,Double> e:m.entrySet()){out.add(e);if(++i>=n)break;}return out;
    }
    private void scanWalls(State s,long now,boolean seed){
        java.util.HashSet<Long> seen=new java.util.HashSet<>();
        scanSide(s,true,top(s.bids,30),now,seen);
        scanSide(s,false,top(s.asks,30),now,seen);
        double m=mid(s);
        java.util.Iterator<java.util.Map.Entry<Long,WallTrack>> it=s.walls.entrySet().iterator();
        while(it.hasNext()){
            WallTrack w=it.next().getValue();
            long age=now-w.lastSeen;
            if(!seen.contains(wallKey(w.bid,w.price))&&age>700L&&w.pulledAt==0L){
                w.pulledAt=now;
                boolean untouched=finite(m)&&(w.bid?m>w.price*1.00005:m<w.price*0.99995);
                if(untouched&&now-w.firstSeen>=700L){
                    if(s.spoofWindowStart==0L||now-s.spoofWindowStart>60_000L){s.spoofWindowStart=now;s.spoofPulls=0;}
                    s.spoofPulls++;s.lastSpoofAt=now;s.lastSpoofSide=w.bid?"BID_PULL":"ASK_PULL";
                }
            }
            if(now-w.lastSeen>20_000L)it.remove();
        }
    }
    private void scanSide(State s,boolean bid,java.util.List<java.util.Map.Entry<Double,Double>> rows,long now,java.util.Set<Long> seen){
        if(rows.isEmpty())return;
        java.util.ArrayList<Double> vals=new java.util.ArrayList<>();double total=0;
        for(java.util.Map.Entry<Double,Double> e:rows){double v=e.getKey()*e.getValue();if(v>0){vals.add(v);total+=v;}}
        if(vals.isEmpty()||total<=0)return;
        java.util.Collections.sort(vals);double med=vals.get(vals.size()/2);double threshold=Math.max(med*2.5,total*0.08);
        for(java.util.Map.Entry<Double,Double> e:rows){
            double v=e.getKey()*e.getValue();if(v<threshold)continue;
            long k=wallKey(bid,e.getKey());seen.add(k);WallTrack w=s.walls.get(k);
            if(w==null){w=new WallTrack(bid,e.getKey(),now);s.walls.put(k,w);}
            w.lastSeen=now;w.seen++;w.lastNotional=v;w.lastShare=v/total;if(w.pulledAt>0)w.pulledAt=0;
        }
    }

    private static Wall bestWall(State s,boolean bid,long now){
        Wall out=new Wall();double score=-1;
        for(WallTrack w:s.walls.values()){
            if(w.bid!=bid||now-w.lastSeen>1200L||w.pulledAt>0)continue;
            double age=Math.max(0,now-w.firstSeen);double sc=w.lastShare*(1.0+Math.log1p(age/1000.0));
            if(sc>score){score=sc;out.valid=true;out.bid=bid;out.price=w.price;out.notional=w.lastNotional;out.share=w.lastShare;out.ageMs=age;out.seen=w.seen;}
        }
        if(out.valid){
            if(out.ageMs>=8000L&&out.seen>=12)out.trust="HIGH";
            else if(out.ageMs>=2500L&&out.seen>=5)out.trust="MED";
            else out.trust="LOW";
        }
        return out;
    }
    private static double imbalance(State s,int n){
        double b=0,a=0;int i=0;for(java.util.Map.Entry<Double,Double> e:s.bids.entrySet()){b+=e.getKey()*e.getValue();if(++i>=n)break;}
        i=0;for(java.util.Map.Entry<Double,Double> e:s.asks.entrySet()){a+=e.getKey()*e.getValue();if(++i>=n)break;}
        return b+a>0?(b-a)/(b+a):0;
    }
    private static double entropySide(java.util.NavigableMap<Double,Double> m,int n){
        java.util.ArrayList<Double> x=new java.util.ArrayList<>();double sum=0;int i=0;
        for(java.util.Map.Entry<Double,Double> e:m.entrySet()){double v=e.getKey()*e.getValue();if(v>0){x.add(v);sum+=v;}if(++i>=n)break;}
        if(x.size()<2||sum<=0)return Double.NaN;double h=0;for(double v:x){double p=v/sum;h-=p*Math.log(p);}return h/Math.log(x.size());
    }
    private static double flowRatio(java.util.ArrayDeque<Flow> q,long now,long win){
        double s=0,a=0;for(Flow f:q){if(now-f.t<=win){s+=f.signed;a+=f.abs;}}return a>0?clamp(s/a,-1,1):0;
    }
    private static double rangeBps(State s,long now,long win){
        double lo=Double.POSITIVE_INFINITY,hi=Double.NEGATIVE_INFINITY;for(Mid m:s.mids){if(now-m.t<=win){lo=Math.min(lo,m.p);hi=Math.max(hi,m.p);}}
        double md=mid(s);return finite(md)&&finite(lo)&&finite(hi)&&md>0?(hi-lo)/md*10000.0:Double.NaN;
    }
    private static String absorb(State s,long now,Wall bid,Wall ask){
        if(s.continuousSince<=0||now-s.continuousSince<20_000L||now-s.lastTradeAt>2500L)return "UNKNOWN";
        double dr=flowRatio(s.trades,now,5000L),rb=rangeBps(s,now,5000L),m=mid(s);
        if(!finite(rb)||!finite(m))return "UNKNOWN";
        if(dr<=-0.45&&rb<=3.5&&bid.valid&&Math.abs(m/bid.price-1.0)*10000.0<=18.0)return "BID_ABSORPTION_ADAY";
        if(dr>=0.45&&rb<=3.5&&ask.valid&&Math.abs(ask.price/m-1.0)*10000.0<=18.0)return "ASK_ABSORPTION_ADAY";
        return "NONE";
    }
    private static String entropyLabel(double e){if(!finite(e))return "UNKNOWN";if(e<0.72)return "CONCENTRATED";if(e<0.90)return "MIXED";return "DISTRIBUTED";}
    private static String px(double x){
        if(!finite(x)||x<=0)return "-";try{return java.math.BigDecimal.valueOf(x).stripTrailingZeros().toPlainString();}catch(Throwable t){return String.format(java.util.Locale.US,"%.8f",x);}
    }
    private static String wallText(Wall w){
        if(w==null||!w.valid)return "NONE";
        return px(w.price)+" share="+String.format(java.util.Locale.US,"%.0f%%",w.share*100.0)+" age="+String.format(java.util.Locale.US,"%.1fs",w.ageMs/1000.0)+" trust="+w.trust;
    }

    private void awaitSeed(State s,long ms){
        if(android.os.Looper.myLooper()==android.os.Looper.getMainLooper())return;
        long end=System.currentTimeMillis()+Math.max(0,ms);
        while(System.currentTimeMillis()<end){synchronized(s){if(s.seeded)return;}try{Thread.sleep(35L);}catch(InterruptedException x){Thread.currentThread().interrupt();return;}}
    }

    String promptSummary(String symbol){
        State s=state(symbol);if(s==null)return "V9.5.63 L2: gecersiz sembol; PUANSIZ.";
        ensure(s);awaitSeed(s,1100L);long now=System.currentTimeMillis();
        synchronized(s){
            prune(s,now);
            if(!s.seeded)return "V9.5.63 L2 verisi henuz hazir degil; PUANSIZ. Eksik L2 nedeniyle sinyali engelleme.";
            boolean stale=now-s.lastBookAt>STALE_MS;
            String state=stale?"STALE":(s.connected?"LIVE":"SNAPSHOT_ONLY");
            long cov=s.continuousSince>0?Math.max(0,now-s.continuousSince):0;
            Wall bw=bestWall(s,true,now),aw=bestWall(s,false,now);
            double imb5=imbalance(s,5),imb20=imbalance(s,20),md=mid(s),mp=micro(s);
            double microBps=finite(md)&&finite(mp)&&md>0?(mp-md)/md*10000.0:Double.NaN;
            double delta5=flowRatio(s.trades,now,5000L),ofi5=flowRatio(s.ofi,now,5000L);
            double eb=entropySide(s.bids,20),ea=entropySide(s.asks,20),ent=finite(eb)&&finite(ea)?(eb+ea)*0.5:Double.NaN;
            String abs=absorb(s,now,bw,aw);
            String spoof=(s.lastSpoofAt>0&&now-s.lastSpoofAt<=10_000L)?(s.spoofPulls>=2?"HIGH_ADAY":"MED_ADAY"):"LOW";
            String weight=stale?"PUANSIZ":(cov>=120_000L?"YUKSEK_YARDIMCI":(cov>=30_000L?"ORTA_YARDIMCI":"DUSUK_ISINMA"));
            StringBuilder b=new StringBuilder();
            b.append("V9.5.63 GERCEK L2 MICROSTRUCTURE — YALNIZ EXECUTION/MICRO SOFT CONTEXT; YENI HARD GATE DEGILDIR.\n");
            b.append("L2_SOURCE=BINANCE_USDM_PUBLIC depth@100ms+aggTrade; REST depth snapshot ile seed; STATE=").append(state)
                    .append("; COVERAGE=").append(String.format(java.util.Locale.US,"%.1fs",cov/1000.0))
                    .append("; WEIGHT=").append(weight).append("; lastBookAge=").append(now-s.lastBookAt).append("ms.\n");
            b.append("BOOK_L2: imb5=").append(String.format(java.util.Locale.US,"%+.1f%%",imb5*100.0))
                    .append(" imb20=").append(String.format(java.util.Locale.US,"%+.1f%%",imb20*100.0))
                    .append(" micropriceDev=").append(finite(microBps)?String.format(java.util.Locale.US,"%+.2fbp",microBps):"N/A")
                    .append(" entropy20=").append(finite(ent)?String.format(java.util.Locale.US,"%.2f",ent):"N/A")
                    .append("/").append(entropyLabel(ent)).append(".\n");
            b.append("OBS_RESTING_LIQ: BID_WALL=").append(wallText(bw)).append(" | ASK_WALL=").append(wallText(aw)).append(".\n");
            b.append("FLOW_5S: tradeDelta=").append(String.format(java.util.Locale.US,"%+.1f%%",delta5*100.0))
                    .append(" | OFI=").append(String.format(java.util.Locale.US,"%+.1f%%",ofi5*100.0))
                    .append(" | ABSORPTION=").append(abs)
                    .append(" | SPOOF_RISK=").append(spoof)
                    .append(" lastPullSide=").append(s.lastSpoofSide).append(".\n");
            b.append("L2 SEMANTIK: OBS_RESTING_LIQ gercek gozlenen emir defteri likiditesidir ama emirler iptal edilebilir; kesin destek/direnc, gizli emir veya market-maker niyeti degildir. SPOOF_RISK yalniz duvarin fiyat dokunmadan hizli cekilmesi/persistence davranisindan turetilen ADAY etikettir. ABSORPTION agresif tape + sinirli fiyat ilerlemesi + yakindaki gozlenen duvar uyumudur; tek basina reversal/continuation sinyali degildir.\n");
            b.append("CIFT SAYMAMA: L2 STATE LIVE ve taze ise v9.5.31 REST BOOK_MICRO yerine BU L2 katmanini execution/micro ailesinde kullan; ikisini iki oy sayma. OFI+delta+imbalance+microprice+absorption ayni mikrostructure ailesidir, toplamda en fazla BIR yumusak katkidir. OI/CVD/funding/OBS_LIQ ayri leverage-flow ailesinde kalir.\n");
            b.append("BOGMAMA: WARMING/STALE/GAP/SNAPSHOT_ONLY veya celiskili L2 PUANSIZ/az agirliktir; sirf L2 eksik/ters diye temiz tamamlanmis 15m yapi + uygun konum + yapisal STOP + yeterli R/R senaryosunu veto etme. L2 ancak sinira yakin execution guvenini bir kademe ayarlar veya retest/acceptance zamanlamasini iyilestirir.");
            return b.toString();
        }
    }
}
'''
L2.write_text(java)

# ---------------------------------------------------------------------------
# Warm L2 silently for every symbol the monitor already evaluates.  No UI line
# is appended here: this deliberately avoids making the dashboard longer.
# ---------------------------------------------------------------------------
m=MON.read_text()
if 'V9563_L2_SILENT_WARMUP' not in m:
    b=method_bounds(m,'    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)')
    if not b:
        raise SystemExit('v9.5.63 evaluate anchor missing')
    _,brace,end=b
    inject='''\n        // V9563_L2_SILENT_WARMUP — data collection only; NEVER a signal/order gate.\n        try { V9563MicrostructureFeed.get(this).touch(p.symbol); } catch (Throwable ignored) {}\n'''
    m=m[:brace+1]+inject+m[brace+1:]
MON.write_text(m)

# ---------------------------------------------------------------------------
# Add L2 + structural-oracle semantics to the ChatGPT package only.  This keeps
# the on-screen tracked-coin cards compact while giving analysis exact source,
# freshness and anti-double-counting semantics.
# ---------------------------------------------------------------------------
a=ANA.read_text()
b=method_bounds(a,'    private String buildPrompt(')
if not b:
    raise SystemExit('v9.5.63 buildPrompt missing')
start,brace,end=b
method=a[start:end]
if 'V9563MicrostructureFeed.get(this).promptSummary(symbol)' not in method:
    ret='        return sb.toString();\n'
    if ret not in method:
        raise SystemExit('v9.5.63 buildPrompt return missing')
    inject=r'''        sb.append("\n--- V9.5.63 GERCEK L2 MICROSTRUCTURE / KAYNAK TAZELIGI ---\n");
        sb.append(V9563MicrostructureFeed.get(this).promptSummary(symbol)).append("\n\n");
        sb.append("V9.5.63 SMC ORACLE SEMANTIGI: FVG/OB/BOS/CHoCH/likidite etiketlerini tekrar tekrar oy sayma. BOS/CHoCH icin ayni swing'in ilk gercek cross'unu esas al; wick excursion ile close acceptance'i ayir. FVG'de dolum/mitigasyon ve mum kapanisiyla tersine donen IFVG ihtimalini ayri durum olarak dusun; paket CE50/IFVG seviyesini vermiyorsa rakam UYDURMA. OB'de temas=mitigasyon, kapanisla yapisal gecersizlik ve sonrasindaki breaker rolunu ayir. EQH/EQL/BSL/SSL sweep ancak anlamli swing seviyesinin gezilmesi + geri kabul/rejection ile guclenir. OTE/Fib yalniz net secilebilir impuls varsa kullan. Bunlar pyvsmc/smart-money-concepts benzeri bagimsiz referans motorlarin tutarlilik prensipleriyle uyumlu SEMANTIK denetimdir; yeni bir hard veto veya ekstra oy degildir.\n");
        sb.append("V9.5.63 VERI PROVENANCE KURALI: BINANCE_WS gozlenen L2/tape, BINANCE_FORCEORDER gozlenen liquidation snapshot, LIQ_DENS ise tahmini modeldir. Bu ucunu birbirinin kaniti gibi sunma. Kaynak/coverage/age eksikse UNKNOWN/PUANSIZ yaz; tahmini veriyi gerceklesmis veri gibi adlandirma.\n");
'''
    method=method.replace(ret,inject+ret,1)
    a=a[:start]+method+a[end:]
ANA.write_text(a)

# Version/UI identity. Codemagic stage titles may still say an older composition
# name, but the built APK itself must always expose the actual composed version.
for p in (MAIN,MON,ANA):
    z=p.read_text()
    z=re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.63',z)
    z=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.63',z)
    z=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.63  •  MANUEL PRO',z)
    p.write_text(z)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091503',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.63'",bf,count=1)
BUILD.write_text(bf)

# Fail-fast composition contract.
l2=L2.read_text();a=ANA.read_text();m=MON.read_text();bf=BUILD.read_text()
checks={
    'l2 class':L2.exists() and 'depth@100ms' in l2 and 'aggTrade' in l2,
    'snapshot seed':'/fapi/v1/depth?symbol=' in l2 and 'lastUpdateId' in l2,
    'sequence gap safety':'pu!=s.lastU' in l2 and 'sequenceGap' in l2,
    'wall persistence':'WallTrack' in l2 and 'trust="HIGH"' in l2,
    'ofi microprice entropy':'ofiEvent' in l2 and 'micropriceDev' in l2 and 'entropy20' in l2,
    'absorption spoof risk':'ABSORPTION=' in l2 and 'SPOOF_RISK=' in l2,
    'no hard gate contract':'YENI HARD GATE DEGILDIR' in l2 and 'BOGMAMA:' in l2,
    'silent monitor warmup':'V9563_L2_SILENT_WARMUP' in m and 'touch(p.symbol)' in m,
    'prompt injection':'V9563MicrostructureFeed.get(this).promptSummary(symbol)' in a,
    'oracle semantics':'V9.5.63 SMC ORACLE SEMANTIGI' in a and 'IFVG' in a,
    'provenance':'V9.5.63 VERI PROVENANCE KURALI' in a,
    'v9562 retained':'V9.5.62 ANALIZ PAKETI BUTUNLUK' in a,
    'version':"versionName '9.5.63'" in bf and 'versionCode 26091503' in bf,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.63 sanity failed: '+', '.join(bad))
print('v9.5.63 OK: observed Binance L2 + OFI/delta/microprice/wall persistence/entropy/absorption/spoof-risk context added as ONE soft execution family; no new signal veto and no dashboard length increase.')
