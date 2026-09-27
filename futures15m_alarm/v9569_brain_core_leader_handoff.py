from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANA = JAVA / 'AnalysisPackActivity.java'
AGENT = JAVA / 'TradeAgentActivity.java'
BRAIN = JAVA / 'BrainCore.java'
BRAIN_UI = JAVA / 'BrainActivity.java'
BUILD = APP / 'app/build.gradle'
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'

for p in (MAIN, MON, ANA, AGENT, BUILD, MANIFEST):
    if not p.exists():
        raise SystemExit('v9.5.69 missing required file: ' + str(p))

def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0: return None
    b = src.find('{', a)
    if b < 0: return None
    depth = 1
    i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/': block_comment = False; i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/': line_comment = True; i += 1
            elif c == '/' and n == '*': block_comment = True; i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

def replace_method(src, signature, replacement):
    b = method_bounds(src, signature)
    if not b: raise SystemExit('v9.5.69 method missing: ' + signature)
    a, _, e = b
    return src[:a] + replacement + src[e:]

def java_lex_sanity(src):
    depth=0; i=0; line=1; state='code'; esc=False
    while i < len(src):
        c=src[i]; n=src[i+1] if i+1<len(src) else ''
        if c=='\n': line+=1
        if state=='line':
            if c=='\n': state='code'
            i+=1; continue
        if state=='block':
            if c=='*' and n=='/': state='code'; i+=2; continue
            i+=1; continue
        if state=='string':
            if c=='\n': return False,'newline in string near line '+str(line)
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': state='code'
            i+=1; continue
        if state=='char':
            if c=='\n': return False,'newline in char near line '+str(line)
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=="'": state='code'
            i+=1; continue
        if c=='/' and n=='/': state='line'; i+=2; continue
        if c=='/' and n=='*': state='block'; i+=2; continue
        if c=='"': state='string'; esc=False; i+=1; continue
        if c=="'": state='char'; esc=False; i+=1; continue
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth<0: return False,'extra closing brace near line '+str(line)
        i+=1
    if state in ('string','char','block'): return False,'unclosed lexical state '+state
    if depth!=0: return False,'brace depth '+str(depth)
    return True,'OK'

agent=AGENT.read_text()
main=MAIN.read_text()
mon=MON.read_text()
ana=ANA.read_text()
bf=BUILD.read_text()
manifest=MANIFEST.read_text()

if 'V9568_FREE_FIRST_TRADE_AGENT' not in agent:
    raise SystemExit('v9.5.69 prerequisite missing: v9568 agent')
if 'V9567_CLIPBOARD_GALLERY_SAME_CHAT' not in ana:
    raise SystemExit('v9.5.69 prerequisite missing: v9567 same-chat flow')

brain_java = r'''package com.futuresalarm.app;

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
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

// V9569_BRAIN_CORE
// Shared deterministic data layer for agent + Leader Hunter.
// No order is placed here. Execution will consume these snapshots later.
public final class BrainCore {
    private static final String PREF="v9569_brain_core";
    private static final String BINANCE="https://fapi.binance.com";
    private static final String CG="https://api.coingecko.com/api/v3";
    private static final String[] TFS={"1m","3m","5m","15m","30m","1h","4h","1d"};
    private static final String[] TAGS={"1M","3M","5M","15M","30M","1H","4H","1D"};

    private BrainCore(){}

    private static final class Tf {
        String tf,tag; double last,e20,e50,rsi,atrPct,ret,hi,lo; int dir;
    }
    private static final class C {
        String s,label,reason; int dir,rank,prevRank;
        double price,ch24,qv,r1,r3,r5,vx,oiDelta,funding,l2,spread,taker,attack,quality;
    }

    public static String symbolSnapshot(Context ctx,String symbol){
        String s=symbol==null?"":symbol.toUpperCase(Locale.US).replace("/","").replace("-","");
        StringBuilder b=new StringBuilder("BRAIN_CORE=v9.5.69\nSYMBOL=").append(s).append("\nSNAPSHOT_MS=").append(System.currentTimeMillis()).append('\n');
        try{
            JSONObject t=new JSONObject(get(BINANCE+"/fapi/v1/ticker/24hr?symbol="+s));
            b.append("24H_CHANGE=").append(t.optString("priceChangePercent","?")).append("% QUOTE_VOLUME=").append(t.optString("quoteVolume","?")).append('\n');
        }catch(Throwable e){b.append("24H=UNAVAILABLE\n");}
        try{
            JSONObject p=new JSONObject(get(BINANCE+"/fapi/v1/premiumIndex?symbol="+s));
            b.append("MARK=").append(p.optString("markPrice","?")).append(" FUNDING=").append(p.optString("lastFundingRate","?")).append('\n');
        }catch(Throwable e){b.append("FUNDING=UNAVAILABLE\n");}
        try{
            JSONObject o=new JSONObject(get(BINANCE+"/fapi/v1/openInterest?symbol="+s));
            b.append("OPEN_INTEREST=").append(o.optString("openInterest","?")).append('\n');
        }catch(Throwable e){b.append("OPEN_INTEREST=UNAVAILABLE\n");}

        ArrayList<Tf> ms=new ArrayList<>();
        for(int i=0;i<TFS.length;i++){
            try{Tf m=tf(s,TFS[i],TAGS[i],90);ms.add(m);b.append(fmt(m));}
            catch(Throwable e){b.append(TAGS[i]).append("=UNAVAILABLE\n");}
        }
        try{
            JSONObject d=new JSONObject(get(BINANCE+"/fapi/v1/depth?symbol="+s+"&limit=50"));
            JSONArray bids=d.getJSONArray("bids"),asks=d.getJSONArray("asks");
            double bq=sum(bids,20),aq=sum(asks,20),imb=(bq+aq)==0?0:(bq-aq)/(bq+aq);
            double bid=Double.parseDouble(bids.getJSONArray(0).getString(0)),ask=Double.parseDouble(asks.getJSONArray(0).getString(0));
            b.append("L2_IMBALANCE=").append(f(imb)).append(" SPREAD_PCT=").append(f((ask-bid)/((ask+bid)/2.0)*100.0)).append('\n');
        }catch(Throwable e){b.append("L2=UNAVAILABLE\n");}
        try{
            JSONArray a=new JSONArray(get(BINANCE+"/futures/data/takerlongshortRatio?symbol="+s+"&period=5m&limit=1"));
            if(a.length()>0)b.append("TAKER_BUYSELL_RATIO=").append(a.getJSONObject(0).optString("buySellRatio","?")).append('\n');
        }catch(Throwable e){b.append("TAKER=UNAVAILABLE\n");}

        b.append(handoff(ms)).append("\nGLOBAL_CONTEXT:\n").append(global(ctx));
        return b.toString().trim();
    }

    private static Tf tf(String s,String interval,String tag,int limit)throws Exception{
        JSONArray k=new JSONArray(get(BINANCE+"/fapi/v1/klines?symbol="+s+"&interval="+interval+"&limit="+limit));
        ArrayList<Double> c=new ArrayList<>(),h=new ArrayList<>(),l=new ArrayList<>();
        for(int i=0;i<k.length();i++){JSONArray r=k.getJSONArray(i);c.add(r.getDouble(4));h.add(r.getDouble(2));l.add(r.getDouble(3));}
        if(c.size()<55)throw new Exception("short kline");
        Tf m=new Tf();m.tf=interval;m.tag=tag;m.last=c.get(c.size()-1);m.e20=ema(c,20);m.e50=ema(c,50);m.rsi=rsi(c,14);
        m.atrPct=atr(h,l,c,14)/m.last*100.0;
        int back=interval.equals("1m")?5:interval.equals("3m")?4:interval.equals("5m")?4:interval.equals("1d")?3:4;
        back=Math.min(back,c.size()-1);m.ret=(m.last/c.get(c.size()-1-back)-1)*100.0;
        int n=Math.min(50,c.size());m.hi=-Double.MAX_VALUE;m.lo=Double.MAX_VALUE;
        for(int i=c.size()-n;i<c.size();i++){m.hi=Math.max(m.hi,h.get(i));m.lo=Math.min(m.lo,l.get(i));}
        if(m.last>m.e20&&m.e20>m.e50)m.dir=1;else if(m.last<m.e20&&m.e20<m.e50)m.dir=-1;else if(m.ret>0.18)m.dir=1;else if(m.ret<-0.18)m.dir=-1;else m.dir=0;
        return m;
    }

    private static String fmt(Tf m){
        return m.tag+" LAST="+f(m.last)+" EMA20="+f(m.e20)+" EMA50="+f(m.e50)+" RSI="+f(m.rsi)+" ATR_PCT="+f(m.atrPct)
                +" RET="+f(m.ret)+"% TREND="+(m.dir>0?"UP":m.dir<0?"DOWN":"MIXED")+" UP_LIQ="+f(m.hi)+" DOWN_LIQ="+f(m.lo)+"\n";
    }

    private static String handoff(ArrayList<Tf> ms){
        if(ms.isEmpty())return "TRADE_LIFECYCLE=UNKNOWN\n";
        int start=-1,dir=0;for(int i=0;i<ms.size();i++){if(ms.get(i).dir!=0){start=i;dir=ms.get(i).dir;break;}}
        if(start<0)return "TRADE_LIFECYCLE=NO_CLEAR_OWNER\n";
        int owner=start;StringBuilder chain=new StringBuilder(ms.get(start).tag);
        for(int i=start+1;i<ms.size();i++){if(ms.get(i).dir==dir){owner=i;chain.append("→").append(ms.get(i).tag);}else break;}
        Tf o=ms.get(owner);String next=owner+1<ms.size()?ms.get(owner+1).tag:"HIGHER_TF";
        String state=owner==start?(start<=2?"SCALP":"TREND"):(owner>=5?"RUNNER":"HANDOFF");
        return "TRADE_LIFECYCLE="+state+" SIDE="+(dir>0?"LONG":"SHORT")+" ENTRY_TF="+ms.get(start).tag+" OWNER_TF="+o.tag+
                " NEXT_TF="+next+" CHAIN="+chain+" OWNER_LIQ_TARGET="+f(dir>0?o.hi:o.lo)+" OWNER_INVALIDATION="+f(dir>0?o.lo:o.hi)+
                " RISK_RULE=HANDOFF_MUST_NOT_WIDEN_INITIAL_RISK\n";
    }

    public static String global(Context ctx){
        SharedPreferences sp=ctx.getSharedPreferences(PREF,Context.MODE_PRIVATE);long now=System.currentTimeMillis();
        String cache=sp.getString("global_cache","");long ts=sp.getLong("global_ts",0);
        if(cache!=null&&!cache.isEmpty()&&now-ts<60000)return cache;
        StringBuilder b=new StringBuilder("GLOBAL_MS=").append(now).append('\n');
        b.append(asset("BTCUSDT","BTC")).append(asset("ETHUSDT","ETH"));
        try{
            Tf e=tf("ETHUSDT","15m","ETH15",90),x=tf("BTCUSDT","15m","BTC15",90);
            b.append("ETH_BTC_RELATIVE_15M=").append(f(e.ret-x.ret)).append("%\n");
        }catch(Throwable e){b.append("ETH_BTC_RELATIVE=UNAVAILABLE\n");}
        try{
            JSONObject g=new JSONObject(get(CG+"/global")).getJSONObject("data");
            double total=g.getJSONObject("total_market_cap").optDouble("usd",Double.NaN);
            JSONObject pct=g.getJSONObject("market_cap_percentage");double btc=pct.optDouble("btc",Double.NaN),eth=pct.optDouble("eth",Double.NaN);
            JSONArray u=new JSONArray(get(CG+"/coins/markets?vs_currency=usd&ids=tether"));
            double um=u.length()>0?u.getJSONObject(0).optDouble("market_cap",Double.NaN):Double.NaN;
            double ud=(!Double.isNaN(total)&&total>0&&!Double.isNaN(um))?um/total*100.0:Double.NaN;
            double t2=(!Double.isNaN(total)&&!Double.isNaN(btc))?total*(1-btc/100.0):Double.NaN;
            double t3=(!Double.isNaN(total)&&!Double.isNaN(btc)&&!Double.isNaN(eth))?total*(1-(btc+eth)/100.0):Double.NaN;
            b.append("USDT_D=").append(f(ud)).append("% TOTAL2_USD=").append(f(t2)).append(" TOTAL3_USD=").append(f(t3)).append('\n');
            recordGlobal(ctx,now,ud,t2,t3);
        }catch(Throwable e){b.append("USDT_D_TOTAL2_TOTAL3=UNAVAILABLE\n");}
        b.append(globalHistory(ctx));
        String out=b.toString().trim();sp.edit().putString("global_cache",out).putLong("global_ts",now).apply();return out;
    }

    private static String asset(String s,String tag){
        StringBuilder b=new StringBuilder(tag+"_REGIME=");
        String[] iv={"1m","5m","15m","1h","4h","1d"};String[] tg={"1M","5M","15M","1H","4H","1D"};
        for(int i=0;i<iv.length;i++){try{Tf m=tf(s,iv[i],tg[i],70);b.append(tg[i]).append(':').append(m.dir>0?"UP":m.dir<0?"DOWN":"MIX").append('(').append(f(m.ret)).append("%)");}catch(Throwable e){b.append(tg[i]).append(":NA");}if(i+1<iv.length)b.append(' ');}
        return b.append('\n').toString();
    }

    private static void recordGlobal(Context c,long ts,double u,double t2,double t3){
        try{
            SharedPreferences sp=c.getSharedPreferences(PREF,Context.MODE_PRIVATE);JSONArray a=new JSONArray(sp.getString("global_history","[]"));
            a.put(new JSONObject().put("ts",ts).put("u",u).put("t2",t2).put("t3",t3));
            JSONArray k=new JSONArray();for(int i=Math.max(0,a.length()-360);i<a.length();i++)k.put(a.getJSONObject(i));
            sp.edit().putString("global_history",k.toString()).apply();
        }catch(Throwable ignored){}
    }

    private static String globalHistory(Context c){
        try{
            JSONArray a=new JSONArray(c.getSharedPreferences(PREF,Context.MODE_PRIVATE).getString("global_history","[]"));
            return "GLOBAL_HISTORY_POINTS="+a.length()+" • 5m/15m/1h/4h/1D USDT.D-TOTAL2-TOTAL3 trendi yeterli örnek biriktikçe Brain tarafından kullanılacak.\n";
        }catch(Throwable e){return "GLOBAL_HISTORY=UNAVAILABLE\n";}
    }

    public static String leaders(Context ctx,int max){
        SharedPreferences sp=ctx.getSharedPreferences(PREF,Context.MODE_PRIVATE);long now=System.currentTimeMillis();
        String cache=sp.getString("leader_cache","");long ts=sp.getLong("leader_ts",0);
        if(cache!=null&&!cache.isEmpty()&&now-ts<40000)return cache;
        try{
            Set<String> allowed=perpetuals();JSONArray ta=new JSONArray(get(BINANCE+"/fapi/v1/ticker/24hr"));
            ArrayList<C> all=new ArrayList<>();
            for(int i=0;i<ta.length();i++){JSONObject t=ta.getJSONObject(i);String s=t.optString("symbol","");if(!allowed.contains(s))continue;double q=d(t.optString("quoteVolume","0"));if(q<2000000)continue;C c=new C();c.s=s;c.price=d(t.optString("lastPrice","0"));c.ch24=d(t.optString("priceChangePercent","0"));c.qv=q;all.add(c);}
            ArrayList<C> bv=new ArrayList<>(all),bm=new ArrayList<>(all);Collections.sort(bv,(a,b)->Double.compare(b.qv,a.qv));Collections.sort(bm,(a,b)->Double.compare(Math.abs(b.ch24),Math.abs(a.ch24)));
            LinkedHashSet<String> pick=new LinkedHashSet<>();for(int i=0;i<Math.min(34,bv.size());i++)pick.add(bv.get(i).s);for(int i=0;i<Math.min(18,bm.size());i++)pick.add(bm.get(i).s);
            Map<String,C> map=new HashMap<>();for(C c:all)map.put(c.s,c);ArrayList<C> stage=new ArrayList<>();
            for(String s:pick){C c=map.get(s);try{shortM(c);stage.add(c);}catch(Throwable ignored){}}
            Collections.sort(stage,(a,b)->Double.compare(coarse(b),coarse(a)));
            for(int i=0;i<stage.size();i++){C c=stage.get(i);c.rank=i+1;c.prevRank=sp.getInt("rank_"+c.s,0);}
            Map<String,Double> fm=funding();ArrayList<C> det=new ArrayList<>();
            for(int i=0;i<Math.min(18,stage.size());i++){C c=stage.get(i);detail(ctx,c,fm);score(c);det.add(c);}
            Collections.sort(det,(a,b)->{int z=Double.compare(b.attack,a.attack);return z!=0?z:Double.compare(b.quality,a.quality);});
            SharedPreferences.Editor ed=sp.edit();for(C c:stage)ed.putInt("rank_"+c.s,c.rank);ed.apply();journal(ctx,det);
            StringBuilder out=new StringBuilder("LEADER_HUNTER_MS=").append(now).append('\n').append("GOAL=Top-5 olmadan önce hızlanan futures adayını bul. ATTACK_SCORE ve TRADE_QUALITY ayrıdır.\n");
            for(int i=0;i<Math.min(Math.max(1,max),det.size());i++){C c=det.get(i);int rv=c.prevRank>0?c.prevRank-c.rank:0;out.append('#').append(i+1).append(' ').append(c.s).append(" • ").append(c.label).append(" • ").append(c.dir>0?"LONG":"SHORT").append(" • ATTACK=").append((int)c.attack).append(" • QUALITY=").append((int)c.quality).append(" • RANK_VEL=").append(rv>=0?"+":"").append(rv).append('\n').append("  1m=").append(f(c.r1)).append("% 3m=").append(f(c.r3)).append("% 5m=").append(f(c.r5)).append("% VOLx=").append(f(c.vx)).append(" OIΔ=").append(Double.isNaN(c.oiDelta)?"NA":f(c.oiDelta)+"%").append(" TAKER=").append(Double.isNaN(c.taker)?"NA":f(c.taker)).append(" L2=").append(Double.isNaN(c.l2)?"NA":f(c.l2)).append(" SPREAD=").append(Double.isNaN(c.spread)?"NA":f(c.spread)+"%").append(" FUNDING=").append(f(c.funding)).append('\n').append("  ").append(c.reason).append('\n');}
            out.append("JOURNAL_COUNT=").append(journalCount(ctx)).append('\n');
            String text=out.toString().trim();sp.edit().putString("leader_cache",text).putLong("leader_ts",now).apply();return text;
        }catch(Throwable e){return "LEADER_HUNTER=UNAVAILABLE • "+e.getClass().getSimpleName()+": "+safe(e.getMessage());}
    }

    private static Set<String> perpetuals()throws Exception{
        JSONObject x=new JSONObject(get(BINANCE+"/fapi/v1/exchangeInfo"));JSONArray a=x.getJSONArray("symbols");Set<String>s=new HashSet<>();
        for(int i=0;i<a.length();i++){JSONObject o=a.getJSONObject(i);if("TRADING".equals(o.optString("status"))&&"PERPETUAL".equals(o.optString("contractType"))&&"USDT".equals(o.optString("quoteAsset")))s.add(o.optString("symbol"));}
        return s;
    }

    private static void shortM(C c)throws Exception{
        JSONArray k=new JSONArray(get(BINANCE+"/fapi/v1/klines?symbol="+c.s+"&interval=1m&limit=8"));int n=k.length();if(n<7)throw new Exception("kline");
        double z=k.getJSONArray(n-1).getDouble(4);c.r1=(z/k.getJSONArray(n-2).getDouble(4)-1)*100;c.r3=(z/k.getJSONArray(n-4).getDouble(4)-1)*100;c.r5=(z/k.getJSONArray(n-6).getDouble(4)-1)*100;
        double lv=k.getJSONArray(n-1).getDouble(7),av=0;int ct=0;for(int i=Math.max(0,n-6);i<n-1;i++){av+=k.getJSONArray(i).getDouble(7);ct++;}av=ct==0?0:av/ct;c.vx=av<=0?1:lv/av;c.dir=(c.r1*1.8+c.r3*0.8+c.r5*0.35)>=0?1:-1;
    }
    private static double coarse(C c){return Math.min(35,Math.abs(c.r1)*12)+Math.min(22,Math.abs(c.r3)*4)+Math.min(14,Math.abs(c.r5)*1.8)+Math.min(18,Math.max(0,c.vx-1)*5)+Math.min(11,Math.abs(c.ch24)*0.35);}
    private static Map<String,Double> funding(){Map<String,Double>m=new HashMap<>();try{JSONArray a=new JSONArray(get(BINANCE+"/fapi/v1/premiumIndex"));for(int i=0;i<a.length();i++){JSONObject o=a.getJSONObject(i);m.put(o.optString("symbol"),o.optDouble("lastFundingRate",0));}}catch(Throwable ignored){}return m;}

    private static void detail(Context ctx,C c,Map<String,Double> fm){
        c.funding=fm.containsKey(c.s)?fm.get(c.s):0;c.oiDelta=Double.NaN;c.l2=Double.NaN;c.spread=Double.NaN;c.taker=Double.NaN;
        SharedPreferences sp=ctx.getSharedPreferences(PREF,Context.MODE_PRIVATE);
        try{JSONObject o=new JSONObject(get(BINANCE+"/fapi/v1/openInterest?symbol="+c.s));double oi=o.optDouble("openInterest",Double.NaN);long bits=sp.getLong("oi_"+c.s,Long.MIN_VALUE);double old=bits==Long.MIN_VALUE?Double.NaN:Double.longBitsToDouble(bits);if(!Double.isNaN(old)&&old>0&&!Double.isNaN(oi))c.oiDelta=(oi/old-1)*100;if(!Double.isNaN(oi))sp.edit().putLong("oi_"+c.s,Double.doubleToRawLongBits(oi)).apply();}catch(Throwable ignored){}
        try{JSONObject o=new JSONObject(get(BINANCE+"/fapi/v1/depth?symbol="+c.s+"&limit=20"));JSONArray b=o.getJSONArray("bids"),a=o.getJSONArray("asks");double bq=sum(b,15),aq=sum(a,15);c.l2=(bq+aq)==0?0:(bq-aq)/(bq+aq);double bid=Double.parseDouble(b.getJSONArray(0).getString(0)),ask=Double.parseDouble(a.getJSONArray(0).getString(0));c.spread=(ask-bid)/((ask+bid)/2)*100;}catch(Throwable ignored){}
        try{JSONArray a=new JSONArray(get(BINANCE+"/futures/data/takerlongshortRatio?symbol="+c.s+"&period=5m&limit=1"));if(a.length()>0)c.taker=a.getJSONObject(0).optDouble("buySellRatio",Double.NaN);}catch(Throwable ignored){}
    }

    private static void score(C c){
        int rv=c.prevRank>0?c.prevRank-c.rank:0;double a=34+Math.min(24,Math.abs(c.r1)*10)+Math.min(16,Math.abs(c.r3)*3.2)+Math.min(10,Math.abs(c.r5)*1.25)+Math.min(12,Math.max(0,c.vx-1)*4)+Math.min(8,Math.max(0,rv)*0.75);if(!Double.isNaN(c.oiDelta))a+=Math.min(8,Math.abs(c.oiDelta)*1.8);c.attack=clamp(a,0,100);
        double q=48;boolean al=(c.dir>0&&c.r1>0&&c.r3>0)||(c.dir<0&&c.r1<0&&c.r3<0);q+=al?12:-8;if(c.vx>1.6)q+=8;if(!Double.isNaN(c.l2))q+=clamp(c.dir*c.l2*28,-12,12);if(!Double.isNaN(c.taker)){double e=c.dir>0?c.taker-1:1-c.taker;q+=clamp(e*22,-12,12);}if(!Double.isNaN(c.spread)){if(c.spread<0.04)q+=8;else if(c.spread>0.16)q-=15;}if(Math.abs(c.ch24)>35&&Math.abs(c.r1)>1.5)q-=10;c.quality=clamp(q,0,100);
        c.label=c.attack>=88?(c.dir>0?"PRE-LEADER":"SHORT COLLAPSE"):c.attack>=80?(c.dir>0?"BREAKOUT LOADING":"BREAKDOWN LOADING"):c.attack>=72?"MOMENTUM WATCH":"WATCH";
        c.reason="rank "+(c.prevRank>0?c.prevRank+"→"+c.rank:"new→"+c.rank)+" • volume "+f(c.vx)+"x"+(Double.isNaN(c.oiDelta)?"":" • OI "+(c.oiDelta>=0?"+":"")+f(c.oiDelta)+"%")+" • global rejim lider adayında tek başına hard veto değildir.";
    }

    private static void journal(Context ctx,ArrayList<C> list){
        try{SharedPreferences sp=ctx.getSharedPreferences(PREF,Context.MODE_PRIVATE);JSONArray a=new JSONArray(sp.getString("journal","[]"));long now=System.currentTimeMillis();for(int i=0;i<Math.min(5,list.size());i++){C c=list.get(i);a.put(new JSONObject().put("ts",now).put("symbol",c.s).put("side",c.dir>0?"LONG":"SHORT").put("attack",c.attack).put("quality",c.quality).put("price",c.price));}JSONArray k=new JSONArray();for(int i=Math.max(0,a.length()-180);i<a.length();i++)k.put(a.getJSONObject(i));sp.edit().putString("journal",k.toString()).apply();}catch(Throwable ignored){}
    }
    public static int journalCount(Context ctx){try{return new JSONArray(ctx.getSharedPreferences(PREF,Context.MODE_PRIVATE).getString("journal","[]")).length();}catch(Throwable e){return 0;}}

    private static double sum(JSONArray a,int n)throws Exception{double s=0;for(int i=0;i<Math.min(n,a.length());i++)s+=Double.parseDouble(a.getJSONArray(i).getString(1));return s;}
    private static double ema(ArrayList<Double>x,int p){double k=2.0/(p+1),e=x.get(0);for(int i=1;i<x.size();i++)e=k*x.get(i)+(1-k)*e;return e;}
    private static double rsi(ArrayList<Double>x,int p){if(x.size()<p+1)return Double.NaN;double g=0,l=0;for(int i=x.size()-p;i<x.size();i++){double z=x.get(i)-x.get(i-1);if(z>=0)g+=z;else l-=z;}if(l==0)return 100;double rs=(g/p)/(l/p);return 100-100/(1+rs);}
    private static double atr(ArrayList<Double>h,ArrayList<Double>l,ArrayList<Double>c,int p){if(c.size()<p+1)return Double.NaN;double s=0;for(int i=c.size()-p;i<c.size();i++){double tr=Math.max(h.get(i)-l.get(i),Math.max(Math.abs(h.get(i)-c.get(i-1)),Math.abs(l.get(i)-c.get(i-1))));s+=tr;}return s/p;}
    private static double d(String x){try{return Double.parseDouble(x);}catch(Throwable e){return 0;}}
    private static double clamp(double x,double a,double b){return Math.max(a,Math.min(b,x));}
    private static String f(double x){if(Double.isNaN(x)||Double.isInfinite(x))return "NA";double a=Math.abs(x);if(a>=1e9)return String.format(Locale.US,"%.3fB",x/1e9);if(a>=1e6)return String.format(Locale.US,"%.3fM",x/1e6);return String.format(Locale.US,"%.5f",x);}
    private static String safe(String x){return x==null?"":(x.length()>160?x.substring(0,160):x);}
    private static String get(String url)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setConnectTimeout(7000);c.setReadTimeout(14000);c.setRequestMethod("GET");c.setUseCaches(false);c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent","Futures15mAlarmPRO/9.5.69");int code=c.getResponseCode();InputStream in=code>=200&&code<300?c.getInputStream():c.getErrorStream();String text=read(in);c.disconnect();if(code<200||code>=300)throw new Exception("HTTP "+code);return text;}
    private static String read(InputStream in)throws Exception{if(in==null)return "";StringBuilder b=new StringBuilder();try(BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){String z;while((z=r.readLine())!=null)b.append(z);}return b.toString();}
}
'''

brain_ui_java = r'''package com.futuresalarm.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// V9569_BRAIN_ACTIVITY
public class BrainActivity extends Activity {
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Handler ui=new Handler(Looper.getMainLooper());
    private TextView body,status;
    @Override protected void onCreate(Bundle b){super.onCreate(b);setTitle("Trade Brain");build();scan();}
    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
    private GradientDrawable bg(int c,int r){GradientDrawable g=new GradientDrawable();g.setColor(c);g.setCornerRadius(dp(r));return g;}
    private Button btn(String t){Button b=new Button(this);b.setText(t);b.setAllCaps(false);b.setTextColor(Color.WHITE);b.setTextSize(12f);b.setMinHeight(0);b.setMinimumHeight(0);b.setBackground(bg(Color.rgb(30,64,175),9));return b;}
    private void build(){
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(10),dp(10),dp(10),dp(10));root.setBackgroundColor(Color.rgb(7,12,20));
        TextView title=new TextView(this);title.setText("🧠 TRADE BRAIN • LEADER HUNTER");title.setTextColor(Color.WHITE);title.setTextSize(17f);title.setTypeface(Typeface.DEFAULT_BOLD);root.addView(title,new LinearLayout.LayoutParams(-1,dp(40)));
        status=new TextView(this);status.setTextColor(Color.rgb(148,163,184));status.setTextSize(11.5f);root.addView(status,new LinearLayout.LayoutParams(-1,dp(34)));
        LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);Button scan=btn("⚡ EVRENİ TARA");scan.setOnClickListener(v->scan());Button back=btn("💬 AJANA DÖN");back.setOnClickListener(v->finish());row.addView(scan,new LinearLayout.LayoutParams(0,dp(44),1));LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(0,dp(44),1);bp.setMargins(dp(7),0,0,0);row.addView(back,bp);root.addView(row,new LinearLayout.LayoutParams(-1,dp(48)));
        TextView note=new TextView(this);note.setText("Top-5'i görmek değil, Top-5 olmadan önce oluşan imzayı bulmak. ATTACK_SCORE hızlanmayı, TRADE_QUALITY giriş kalitesini ölçer.");note.setTextColor(Color.rgb(203,213,225));note.setTextSize(11.5f);note.setPadding(0,dp(5),0,dp(7));root.addView(note);
        ScrollView sc=new ScrollView(this);body=new TextView(this);body.setTextColor(Color.rgb(226,232,240));body.setTextSize(12.5f);body.setTextIsSelectable(true);body.setLineSpacing(0,1.08f);body.setPadding(dp(9),dp(9),dp(9),dp(18));body.setBackground(bg(Color.rgb(15,23,42),10));sc.addView(body,new ScrollView.LayoutParams(-1,-2));root.addView(sc,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
    }
    private void scan(){status.setText("USDT perpetual evreni taranıyor…");body.setText("1m/3m/5m ivme + volume + OI + taker + L2 + funding + rank velocity…");io.execute(()->{String text="=== GLOBAL MARKET REGIME ===\n"+BrainCore.global(this)+"\n\n=== PRE-LEADER / TOP-5 HUNTER ===\n"+BrainCore.leaders(this,10)+"\n\n=== TIMEFRAME HANDOFF ===\nSembol analizinde 1m→3m→5m→15m→30m→1h→4h→1D owner zinciri hesaplanır. Handoff ilk riski genişletemez.";ui.post(()->{body.setText(text);status.setText("Tamamlandı • Brain journal: "+BrainCore.journalCount(this));});});}
    @Override protected void onDestroy(){io.shutdownNow();super.onDestroy();}
}
'''

BRAIN.write_text(brain_java)
BRAIN_UI.write_text(brain_ui_java)

if 'BrainActivity' not in manifest:
    manifest=manifest.replace('</application>','        <activity android:name=".BrainActivity" android:exported="false" android:screenOrientation="portrait"/>\n    </application>',1)
MANIFEST.write_text(manifest)

if 'V9569_BRAIN_LAUNCH' not in agent:
    anchor='        root.addView(actions, new LinearLayout.LayoutParams(-1, dp(42)));'
    if anchor not in agent: raise SystemExit('v9.5.69 agent actions anchor missing')
    insert=r'''

        // V9569_BRAIN_LAUNCH
        LinearLayout brainRow = new LinearLayout(this); brainRow.setOrientation(LinearLayout.HORIZONTAL);
        Button brain = smallButton("🧠 BEYİN / LİDER TARA");
        brain.setBackground(bg(Color.rgb(88,45,150), 8));
        brain.setOnClickListener(v -> startActivity(new android.content.Intent(this, BrainActivity.class)));
        brainRow.addView(brain, new LinearLayout.LayoutParams(-1, dp(40)));
        root.addView(brainRow, new LinearLayout.LayoutParams(-1, dp(42)));
'''
    agent=agent.replace(anchor,anchor+insert,1)

agent=replace_method(agent,'    private String marketSnapshot(String s)',r'''    private String marketSnapshot(String s) {
        return BrainCore.symbolSnapshot(this, s);
    }''')

old='''                String symbol = detectSymbol(q);
                String market = symbol == null ? "Kullanıcı mesajında net sembol yok." : marketSnapshot(symbol);
                String app = symbol == null ? "" : appContext(symbol);'''
new='''                String symbol = detectSymbol(q);
                String market;
                if (symbol != null) {
                    market = marketSnapshot(symbol);
                    if (wantsUniverse(q)) market += "\\n\\n" + BrainCore.leaders(this, 8);
                } else if (wantsUniverse(q)) {
                    market = BrainCore.global(this) + "\\n\\n" + BrainCore.leaders(this, 10);
                } else {
                    market = "Kullanıcı mesajında net sembol yok.\\n" + BrainCore.global(this);
                }
                String app = symbol == null ? "Genel uygulama bağlamı: sembol seçilmedi." : appContext(symbol);'''
if old not in agent: raise SystemExit('v9.5.69 send anchor missing')
agent=agent.replace(old,new,1)

if 'private boolean wantsUniverse(String q)' not in agent:
    anchor='    private String appContext(String s) {'
    helper=r'''    private boolean wantsUniverse(String q) {
        String x = q == null ? "" : q.toLowerCase(java.util.Locale.US);
        return x.contains("top") || x.contains("lider") || x.contains("fırsat") || x.contains("firsat")
                || x.contains("atak") || x.contains("tara") || x.contains("hangi coin")
                || x.contains("en güçlü") || x.contains("en guclu") || x.contains("pre-leader");
    }

'''
    if anchor not in agent: raise SystemExit('v9.5.69 appContext anchor missing')
    agent=agent.replace(anchor,helper+anchor,1)

oldp='''                + "Emir açma/kapama talimatı verme; yalnız fikir, tetik, invalidation, risk ve alternatif senaryo üret. "
                + "Trade fikri sorulursa şu sırayı kullan: KARAR (LONG ADAY/SHORT ADAY/BEKLE), GÜVEN 0-100, VERİ KALİTESİ, ANA GEREKÇE, TETİK, INVALIDATION, STOP MANTIĞI, HEDEFLER/RR, KARŞI SENARYO, NEYİ BEKLİYORUZ. "'''
newp='''                + "Bu aşamada ajan emir yürütmez; fikir, tetik, invalidation, risk ve alternatif senaryo üretir. "
                + "1m/3m/5m/15m/30m giriş ivmesini 1h/4h/1D sahiplik ve likidite hedeflerine devredebilen lifecycle mantığını açıkça anlat; handoff ilk riski genişletemez. "
                + "Leader Hunter bağlamında ATTACK_SCORE ile TRADE_QUALITY'yi ayır; top-5 olduktan sonrayı değil top-5'e doğru hızlanmayı değerlendir. Genel piyasa bağlamı istisnai liderlerde tek başına hard veto değildir. "
                + "Trade fikri sorulursa şu sırayı kullan: KARAR (LONG ADAY/SHORT ADAY/BEKLE), GÜVEN 0-100, VERİ KALİTESİ, ANA GEREKÇE, TETİK, INVALIDATION, STOP MANTIĞI, OWNER_TF/HANDOFF, LIKIDITE HEDEFİ, HEDEFLER/RR, KARŞI SENARYO, NEYİ BEKLİYORUZ. "'''
if oldp not in agent: raise SystemExit('v9.5.69 prompt anchor missing')
agent=agent.replace(oldp,newp,1)

needle='''        if(h.startsWith("172.")) { try { int p=Integer.parseInt(h.split("\\\\.")[1]); return p>=16&&p<=31; } catch(Throwable ignored){} }
        return false;'''
repl='''        if(h.startsWith("172.")) { try { int p=Integer.parseInt(h.split("\\\\.")[1]); return p>=16&&p<=31; } catch(Throwable ignored){} }
        if(h.startsWith("100.")) { try { int p=Integer.parseInt(h.split("\\\\.")[1]); return p>=64&&p<=127; } catch(Throwable ignored){} }
        return false;'''
if needle in agent: agent=agent.replace(needle,repl,1)

agent=agent.replace('Futures15mAlarmPRO/9.5.67','Futures15mAlarmPRO/9.5.69').replace('Futures15mAlarmPRO/9.5.68','Futures15mAlarmPRO/9.5.69')
AGENT.write_text(agent)

main=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.69',main)
main=re.sub(r'v9\.5(?:\.\d+)+','v9.5.69',main)
mon=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.69',mon)
ana=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.69',ana)
ana=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.69',ana)
bf=re.sub(r'versionCode\s+\d+','versionCode 26091509',bf,count=1)
bf=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.69'",bf,count=1)
MAIN.write_text(main);MON.write_text(mon);ANA.write_text(ana);BUILD.write_text(bf)

checks={
    'brain core':BRAIN.exists() and 'V9569_BRAIN_CORE' in BRAIN.read_text(),
    'brain ui':BRAIN_UI.exists() and 'V9569_BRAIN_ACTIVITY' in BRAIN_UI.read_text(),
    'leader hunter':'LEADER_HUNTER_MS' in BRAIN.read_text() and 'RANK_VEL=' in BRAIN.read_text(),
    'timeframes':'"1m","3m","5m","15m","30m","1h","4h","1d"' in BRAIN.read_text() and 'OWNER_TF=' in BRAIN.read_text(),
    'global':'USDT_D=' in BRAIN.read_text() and 'TOTAL2_USD=' in BRAIN.read_text() and 'TOTAL3_USD=' in BRAIN.read_text(),
    'agent brain':'BrainCore.symbolSnapshot(this, s)' in AGENT.read_text(),
    'launcher':'V9569_BRAIN_LAUNCH' in AGENT.read_text(),
    'manifest':'BrainActivity' in MANIFEST.read_text(),
    'same chat':'V9567_CLIPBOARD_GALLERY_SAME_CHAT' in ANA.read_text(),
    'plan only':'V9564_PLAN_CODE_ONLY_CONTRACT' in ANA.read_text(),
    'version':"versionName '9.5.69'" in BUILD.read_text() and 'versionCode 26091509' in BUILD.read_text(),
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.69 sanity failed: '+', '.join(bad))
for name,src in (('BrainCore',BRAIN.read_text()),('BrainActivity',BRAIN_UI.read_text()),('TradeAgentActivity',AGENT.read_text()),('MainActivity',MAIN.read_text()),('AnalysisPackActivity',ANA.read_text()),('MonitorService',MON.read_text())):
    ok,why=java_lex_sanity(src);print(('OK   ' if ok else 'FAIL '),'java lexical '+name,why)
    if not ok: raise SystemExit('v9.5.69 Java lexical mismatch: '+name+' — '+why)

print('v9.5.69 OK: BrainCore + Leader Hunter + rank velocity + 1m→1D handoff + BTC/ETH/USDT.D/TOTAL2/TOTAL3 + brain journal. Existing flows retained; live execution not yet added.')