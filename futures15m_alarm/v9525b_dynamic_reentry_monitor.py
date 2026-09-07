from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MON = APP / 'app/src/main/java/com/futuresalarm/app/MonitorService.java'
if not MON.exists():
    raise SystemExit('v9.5.25b missing MonitorService.java')


def method_bounds(src, signature):
    a = src.find(signature)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    quote = False
    char_quote = False
    esc = False
    line_comment = False
    block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/': block_comment = False; i += 1
        elif quote:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': quote = False
        elif char_quote:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": char_quote = False
        else:
            if c == '/' and n == '/': line_comment = True; i += 1
            elif c == '/' and n == '*': block_comment = True; i += 1
            elif c == '"': quote = True
            elif c == "'": char_quote = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

m = MON.read_text()

# Cache public 15m/5m klines so multiple monitored coins do not spam Binance.
if 'V9525B_LIVE_5M_DYNAMIC_REENTRY' not in m:
    cls = re.search(r'(?m)^public class MonitorService[^\n]*\{', m)
    if not cls:
        raise SystemExit('v9.5.25b MonitorService class declaration missing')
    fields = r'''
    // V9525B_LIVE_5M_DYNAMIC_REENTRY
    private final java.util.Map<String, V9525KlineCache> v9525KlineCache = new java.util.HashMap<>();
'''
    m = m[:cls.end()] + fields + m[cls.end():]

# Evaluate the live 5m re-entry AFTER the original LP/LB/SR/SB logic. The
# original signal path remains authoritative whenever price is still inside the
# plan's original entry corridor.
b = method_bounds(m, '    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)')
if not b:
    raise SystemExit('v9.5.25b evaluate method missing')
a0, _, e0 = b
body = m[a0:e0]
if 'v9525EvaluateDynamicReentry(p, market, v953LivePrice);' not in body:
    close = body.rfind('}')
    if close < 0:
        raise SystemExit('v9.5.25b evaluate closing brace missing')
    call = r'''
        // Missed confirmed 15m moves may form a NEW 5m structural re-entry.
        // This is separate from the original LP/SR gate and never relaxes it.
        try { v9525EvaluateDynamicReentry(p, market, v953LivePrice); }
        catch (Throwable ignored) {}
'''
    body = body[:close] + call + body[close:]
    m = m[:a0] + body + m[e0:]

# Insert helpers before the existing v9521 META helpers so all later methods can
# use them without changing imports or the TradePlan outer format.
if 'private void v9525EvaluateDynamicReentry(' not in m:
    anchor = '    private String v9521Norm(String x) {'
    if anchor not in m:
        anchor = '    private String v953Decision(String symbol) {'
    idx = m.find(anchor)
    if idx < 0:
        raise SystemExit('v9.5.25b helper anchor missing')
    helper = r'''
    private static final class V9525MiniCandle {
        final long closeTime;
        final double o, h, l, c;
        V9525MiniCandle(long closeTime, double o, double h, double l, double c) {
            this.closeTime=closeTime; this.o=o; this.h=h; this.l=l; this.c=c;
        }
    }

    private static final class V9525KlineCache {
        final long fetchedAt;
        final java.util.List<V9525MiniCandle> rows;
        V9525KlineCache(long fetchedAt, java.util.List<V9525MiniCandle> rows) {
            this.fetchedAt=fetchedAt; this.rows=rows;
        }
    }

    private static final class V9525Zone {
        final double low, high;
        final int weight;
        final String family, label;
        V9525Zone(double low,double high,int weight,String family,String label) {
            this.low=Math.min(low,high); this.high=Math.max(low,high);
            this.weight=weight; this.family=family; this.label=label;
        }
    }

    private static final class V9525Retest {
        boolean ok;
        double zoneLow, zoneHigh, stop;
        String label;
    }

    private synchronized java.util.List<V9525MiniCandle> v9525ClosedKlines(String symbol, String interval, int limit) throws Exception {
        long now=System.currentTimeMillis();
        String key=symbol+"_"+interval;
        V9525KlineCache hit=v9525KlineCache.get(key);
        if(hit!=null && now-hit.fetchedAt<20000L) return hit.rows;
        String u="https://fapi.binance.com/fapi/v1/klines?symbol="
                +java.net.URLEncoder.encode(symbol,"UTF-8")+"&interval="
                +java.net.URLEncoder.encode(interval,"UTF-8")+"&limit="+limit;
        java.net.HttpURLConnection c=(java.net.HttpURLConnection)new java.net.URL(u).openConnection();
        c.setConnectTimeout(4500); c.setReadTimeout(4500); c.setRequestMethod("GET");
        int code=c.getResponseCode();
        java.io.InputStream in=code>=200&&code<300?c.getInputStream():c.getErrorStream();
        java.io.BufferedReader br=new java.io.BufferedReader(new java.io.InputStreamReader(in,"UTF-8"));
        StringBuilder raw=new StringBuilder(); String line;
        while((line=br.readLine())!=null) raw.append(line);
        br.close(); c.disconnect();
        if(code<200||code>=300) throw new Exception("kline HTTP "+code);
        org.json.JSONArray root=new org.json.JSONArray(raw.toString());
        java.util.List<V9525MiniCandle> out=new java.util.ArrayList<>();
        for(int i=0;i<root.length();i++){
            org.json.JSONArray r=root.getJSONArray(i);
            long closeTime=r.getLong(6);
            if(closeTime>=now) continue; // current/open candle is context, never confirmation
            out.add(new V9525MiniCandle(closeTime,
                    Double.parseDouble(r.getString(1)),Double.parseDouble(r.getString(2)),
                    Double.parseDouble(r.getString(3)),Double.parseDouble(r.getString(4))));
        }
        v9525KlineCache.put(key,new V9525KlineCache(now,out));
        return out;
    }

    private double v9525Atr(java.util.List<V9525MiniCandle> a, int period) {
        if(a==null||a.size()<2) return Double.NaN;
        int from=Math.max(1,a.size()-period); double sum=0; int n=0;
        for(int i=from;i<a.size();i++){
            V9525MiniCandle x=a.get(i),p=a.get(i-1);
            double tr=Math.max(x.h-x.l,Math.max(Math.abs(x.h-p.c),Math.abs(x.l-p.c)));
            sum+=tr; n++;
        }
        return n==0?Double.NaN:sum/n;
    }

    private String v9525MetaValue(String symbol,String key){
        String raw=prefs.getString("v95_meta_"+symbol,"");
        if(raw==null) return "";
        try{
            java.util.regex.Matcher q=java.util.regex.Pattern.compile(
                    "(?:^|;)\\s*"+java.util.regex.Pattern.quote(key)+"\\s*[:=]\\s*([^;]+)",
                    java.util.regex.Pattern.CASE_INSENSITIVE).matcher(raw);
            return q.find()?q.group(1).trim():"";
        }catch(Throwable ignored){return "";}
    }

    private long v9525Recent15mConfirmation(java.util.List<V9525MiniCandle> a,double trigger,boolean lng,long planArmed){
        if(a==null||a.isEmpty()||!(trigger>0)) return 0L;
        long now=System.currentTimeMillis(); long maxAge=45L*60L*1000L;
        for(int i=a.size()-1;i>=Math.max(0,a.size()-5);i--){
            V9525MiniCandle x=a.get(i);
            boolean ok=lng?x.c>trigger:x.c<trigger;
            if(!ok) continue;
            if(now-x.closeTime>maxAge) continue;
            if(planArmed>0L&&planArmed>x.closeTime) continue; // no historical replay
            return x.closeTime;
        }
        return 0L;
    }

    private boolean v9525Touch(V9525MiniCandle c,V9525Zone z,double pad){
        return c!=null && c.h>=z.low-pad && c.l<=z.high+pad;
    }

    private void v9525AddFvgZones(java.util.List<V9525Zone> out,java.util.List<V9525MiniCandle> a,boolean lng){
        int from=Math.max(2,a.size()-36);
        int added=0;
        for(int i=a.size()-1;i>=from&&added<4;i--){
            V9525MiniCandle x=a.get(i),p2=a.get(i-2);
            if(lng && x.l>p2.h){
                double lo=p2.h,hi=x.l; boolean filled=false;
                for(int j=i+1;j<a.size();j++) if(a.get(j).l<=lo){filled=true;break;}
                if(!filled){out.add(new V9525Zone(lo,hi,3,"FVG","FVG "+lo+"-"+hi));added++;}
            }else if(!lng && x.h<p2.l){
                double lo=x.h,hi=p2.l; boolean filled=false;
                for(int j=i+1;j<a.size();j++) if(a.get(j).h>=hi){filled=true;break;}
                if(!filled){out.add(new V9525Zone(lo,hi,3,"FVG","FVG "+lo+"-"+hi));added++;}
            }
        }
    }

    private void v9525AddObZone(java.util.List<V9525Zone> out,java.util.List<V9525MiniCandle> a,boolean lng,double atr){
        int from=Math.max(1,a.size()-24);
        for(int i=a.size()-3;i>=from;i--){
            V9525MiniCandle q=a.get(i),n1=a.get(i+1),n2=a.get(i+2);
            if(lng){
                if(q.c>=q.o) continue;
                double impulse=Math.max(n1.h,n2.h)-q.l;
                if(n2.c<=q.h||impulse<atr*0.80) continue;
                boolean invalid=false; for(int j=i+1;j<a.size();j++) if(a.get(j).c<q.l){invalid=true;break;}
                if(!invalid){out.add(new V9525Zone(q.l,q.h,3,"OB","OB "+q.l+"-"+q.h));return;}
            }else{
                if(q.c<=q.o) continue;
                double impulse=q.h-Math.min(n1.l,n2.l);
                if(n2.c>=q.l||impulse<atr*0.80) continue;
                boolean invalid=false; for(int j=i+1;j<a.size();j++) if(a.get(j).c>q.h){invalid=true;break;}
                if(!invalid){out.add(new V9525Zone(q.l,q.h,3,"OB","OB "+q.l+"-"+q.h));return;}
            }
        }
    }

    private void v9525AddFibZones(java.util.List<V9525Zone> out,java.util.List<V9525MiniCandle> a,boolean lng,double atr){
        int from=Math.max(0,a.size()-24),n=a.size();
        if(n-from<6) return;
        int extreme=-1,start=-1; double hi=-Double.MAX_VALUE,lo=Double.MAX_VALUE;
        if(lng){
            for(int i=from;i<n;i++) if(a.get(i).h>hi){hi=a.get(i).h;extreme=i;}
            for(int i=from;i<extreme;i++) if(a.get(i).l<lo){lo=a.get(i).l;start=i;}
            if(start<0||extreme<=start||hi-lo<atr*1.20) return;
            double[] r={0.50,0.618,0.705,0.786};
            for(double x:r){double p=hi-(hi-lo)*x,t=Math.max(atr*0.08,p*0.0004);out.add(new V9525Zone(p-t,p+t,1,"FIB","FIB"+x+" "+p));}
        }else{
            for(int i=from;i<n;i++) if(a.get(i).l<lo){lo=a.get(i).l;extreme=i;}
            for(int i=from;i<extreme;i++) if(a.get(i).h>hi){hi=a.get(i).h;start=i;}
            if(start<0||extreme<=start||hi-lo<atr*1.20) return;
            double[] r={0.50,0.618,0.705,0.786};
            for(double x:r){double p=lo+(hi-lo)*x,t=Math.max(atr*0.08,p*0.0004);out.add(new V9525Zone(p-t,p+t,1,"FIB","FIB"+x+" "+p));}
        }
    }

    private void v9525AddSwingZone(java.util.List<V9525Zone> out,java.util.List<V9525MiniCandle> a,boolean lng,double atr){
        for(int i=a.size()-3;i>=Math.max(2,a.size()-18);i--){
            V9525MiniCandle x=a.get(i);
            boolean swing=lng
                    ? x.l<a.get(i-1).l&&x.l<a.get(i-2).l&&x.l<a.get(i+1).l&&x.l<a.get(i+2).l
                    : x.h>a.get(i-1).h&&x.h>a.get(i-2).h&&x.h>a.get(i+1).h&&x.h>a.get(i+2).h;
            if(!swing) continue;
            double p=lng?x.l:x.h,t=Math.max(atr*0.10,p*0.0005);
            out.add(new V9525Zone(p-t,p+t,2,"SWING",(lng?"MIKRO HL/SWING ":"MIKRO LH/SWING ")+p));
            return;
        }
    }

    private V9525Retest v9525FindRetest(java.util.List<V9525MiniCandle> a,boolean lng,double trigger){
        V9525Retest r=new V9525Retest();
        if(a==null||a.size()<10) return r;
        int n=a.size(); V9525MiniCandle last=a.get(n-1),prev=a.get(n-2),prev2=a.get(n-3);
        long age=System.currentTimeMillis()-last.closeTime;
        if(age<0||age>90000L) return r; // completed 5m close must be fresh
        double atr=v9525Atr(a,14); if(Double.isNaN(atr)||atr<=0) return r;
        java.util.List<V9525Zone> z=new java.util.ArrayList<>();
        double flipPad=Math.max(atr*0.12,trigger*0.0006);
        z.add(new V9525Zone(trigger-flipPad,trigger+flipPad,3,"FLIP","KIRILAN SEVIYE/ROL DEGISIMI "+trigger));
        v9525AddFvgZones(z,a,lng);
        v9525AddObZone(z,a,lng,atr);
        v9525AddFibZones(z,a,lng,atr);
        v9525AddSwingZone(z,a,lng,atr);

        double touchPad=atr*0.12,clusterTol=Math.max(atr*0.35,last.c*0.0015);
        V9525Zone best=null; int bestScore=-1; String bestLabel="";
        for(V9525Zone q:z){
            boolean touched=v9525Touch(prev,q,touchPad)||v9525Touch(last,q,touchPad);
            if(!touched) continue;
            java.util.Set<String> fam=new java.util.HashSet<>();
            int score=0; boolean strong=false; StringBuilder labels=new StringBuilder();
            double mid=(q.low+q.high)*0.5;
            for(V9525Zone x:z){
                double xm=(x.low+x.high)*0.5;
                if(Math.abs(xm-mid)>clusterTol) continue;
                if(fam.add(x.family)){score+=x.weight;if(x.weight>=3) strong=true;}
                if(labels.length()<180){if(labels.length()>0)labels.append(" + ");labels.append(x.label);}
            }
            if((strong&&score>=3)||(!strong&&score>=3)){
                if(score>bestScore){bestScore=score;best=q;bestLabel=labels.toString();}
            }
        }
        if(best==null) return r;
        boolean touchedPrev=v9525Touch(prev,best,touchPad);
        double range=Math.max(1e-12,last.h-last.l);
        boolean bodyOk=lng?last.c>last.o:last.c<last.o;
        boolean closeQuality=lng?(last.c-last.l)/range>=0.62:(last.h-last.c)/range>=0.62;
        boolean reclaim=lng?last.c>best.high:last.c<best.low;
        boolean microBos=lng?last.c>Math.max(prev.h,prev2.h):last.c<Math.min(prev.l,prev2.l);
        if(!(bodyOk&&closeQuality&&(reclaim||microBos))) return r;

        double local=lng?Double.MAX_VALUE:-Double.MAX_VALUE;
        for(int i=Math.max(0,n-6);i<n;i++) local=lng?Math.min(local,a.get(i).l):Math.max(local,a.get(i).h);
        double buffer=Math.max(atr*0.12,last.c*0.0006);
        double stop=lng?local-buffer:local+buffer;
        if(lng&&stop>=last.c) return r;
        if(!lng&&stop<=last.c) return r;
        r.ok=true;r.zoneLow=best.low;r.zoneHigh=best.high;r.stop=stop;
        r.label=(touchedPrev?"5M RETEST + SONRAKI 5M TEYIT: ":"5M AYNI MUM RETEST/RECLAIM: ")+bestLabel;
        return r;
    }

    private void v9525EvaluateDynamicReentry(TradePlan p,MarketSnapshot market,double live){
        if(p==null||Double.isNaN(live)||live<=0) return;
        if(prefs.getBoolean("v953_trade_lock_"+p.symbol+"_LONG",false)
                && prefs.getBoolean("v953_trade_lock_"+p.symbol+"_SHORT",false)) return;
        String ltf=v9525MetaValue(p.symbol,"LTF").toUpperCase(java.util.Locale.ROOT);
        if(ltf.isEmpty()||ltf.contains("KAPALI")) return; // old/unknown plans do not silently gain new semantics
        long now=System.currentTimeMillis();
        long fiveClose=(now/(5L*60L*1000L))*(5L*60L*1000L);
        if(now-fiveClose>90000L) return; // only evaluate near a fresh completed 5m boundary
        try{
            java.util.List<V9525MiniCandle> m15=v9525ClosedKlines(p.symbol,"15m",8);
            java.util.List<V9525MiniCandle> m5=v9525ClosedKlines(p.symbol,"5m",64);
            if(m15.isEmpty()||m5.size()<12) return;
            long planArmed=prefs.getLong("v9517_plan_armed_"+p.symbol,0L);
            long la=v9525Recent15mConfirmation(m15,p.breakoutClose,true,planArmed);
            long sa=v9525Recent15mConfirmation(m15,p.breakdownClose,false,planArmed);
            boolean wantLong=la>0 && la>=sa;
            boolean wantShort=sa>0 && sa>la;
            if(!wantLong&&!wantShort) return;

            if(wantLong){
                if(prefs.getBoolean("v953_trade_lock_"+p.symbol+"_LONG",false)) return;
                if(!v953DirectionAllowed(p.symbol,true)||!v9521ScenarioAllowed(p.symbol,"LB")) return;
                double[] old=v953EntryRange(p.longBreakDetail,p.breakoutClose,true);
                if(v953InEntryRange(live,old[0],old[1],0.30)) return; // original engine owns this case
                double oldStop=v9518Num(p.longBreakDetail,"STOP");
                if(!Double.isNaN(oldStop)&&live<=oldStop) return;
                V9525Retest rr=v9525FindRetest(m5,true,p.breakoutClose); if(!rr.ok) return;
                V9525MiniCandle c=m5.get(m5.size()-1);
                if(live>c.c*1.0035) return; // no chase after the fresh 5m confirmation
                double t1=v9518Num(p.longBreakDetail,"TP1"),t2=v9518Num(p.longBreakDetail,"TP2"),t3=v9518Num(p.longBreakDetail,"TP3");
                if(Double.isNaN(t1)||Double.isNaN(t2)||Double.isNaN(t3)||!(t1<t2&&t2<t3&&t1>live)) return;
                double risk=live-rr.stop; if(!(risk>0)) return;
                if((t1-live)/risk<1.0||(t2-live)/risk<1.5) return;
                if(!v9517StableFlow(p.symbol,true,market,false)) return;
                String d="5M DİNAMİK YAPISAL RETEST\\nYapı: "+rr.label
                        +"\\nRetest bölgesi: "+rr.zoneLow+" - "+rr.zoneHigh
                        +"\\nGiriş: "+live+"\\nSTOP: "+rr.stop
                        +"\\nTP1: "+t1+"\\nTP2: "+t2+"\\nTP3: "+t3
                        +"\\n15m ana kırılım önceden teyitli; orijinal giriş kovalanmadı. Kapanmış 5m yapısal kabul + güncel R/R + ağırlıklı akış uygun.";
                sendUrgent(p.symbol,"LONG DİNAMİK RETEST",d);
            }else{
                if(prefs.getBoolean("v953_trade_lock_"+p.symbol+"_SHORT",false)) return;
                if(!v953DirectionAllowed(p.symbol,false)||!v9521ScenarioAllowed(p.symbol,"SB")) return;
                double[] old=v953EntryRange(p.shortBreakDetail,p.breakdownClose,false);
                if(v953InEntryRange(live,old[0],old[1],0.30)) return;
                double oldStop=v9518Num(p.shortBreakDetail,"STOP");
                if(!Double.isNaN(oldStop)&&live>=oldStop) return;
                V9525Retest rr=v9525FindRetest(m5,false,p.breakdownClose); if(!rr.ok) return;
                V9525MiniCandle c=m5.get(m5.size()-1);
                if(live<c.c*0.9965) return;
                double t1=v9518Num(p.shortBreakDetail,"TP1"),t2=v9518Num(p.shortBreakDetail,"TP2"),t3=v9518Num(p.shortBreakDetail,"TP3");
                if(Double.isNaN(t1)||Double.isNaN(t2)||Double.isNaN(t3)||!(t1>t2&&t2>t3&&t1<live)) return;
                double risk=rr.stop-live; if(!(risk>0)) return;
                if((live-t1)/risk<1.0||(live-t2)/risk<1.5) return;
                if(!v9517StableFlow(p.symbol,false,market,false)) return;
                String d="5M DİNAMİK YAPISAL RETEST\\nYapı: "+rr.label
                        +"\\nRetest bölgesi: "+rr.zoneLow+" - "+rr.zoneHigh
                        +"\\nGiriş: "+live+"\\nSTOP: "+rr.stop
                        +"\\nTP1: "+t1+"\\nTP2: "+t2+"\\nTP3: "+t3
                        +"\\n15m ana kırılım önceden teyitli; orijinal giriş kovalanmadı. Kapanmış 5m yapısal ret + güncel R/R + ağırlıklı akış uygun.";
                sendUrgent(p.symbol,"SHORT DİNAMİK RETEST",d);
            }
        }catch(Throwable ignored){}
    }

'''
    m = m[:idx] + helper + m[idx:]

# Signal journal must state the real reason instead of falling back to the old
# generic 15m wording.
b = method_bounds(m, '    private String v9518TurkishDirection(String d)')
if b:
    a0,_,e0=b; x=m[a0:e0]
    if 'DİNAMİK RETEST' not in x:
        brace=x.find('{')+1
        ins='''\n        String v9525u=d==null?"":d.toUpperCase(java.util.Locale.ROOT);\n        if(v9525u.contains("DİNAMİK")||v9525u.contains("DINAMIK")) return v9525u.startsWith("SHORT")?"SHORT SİNYALİ - 5M DİNAMİK RETEST":"LONG SİNYALİ - 5M DİNAMİK RETEST";'''
        x=x[:brace]+ins+x[brace:]; m=m[:a0]+x+m[e0:]

b = method_bounds(m, '    private String v9518Reason(String d)')
if b:
    a0,_,e0=b; x=m[a0:e0]
    if 'orijinal giriş kovalanmadı' not in x:
        brace=x.find('{')+1
        ins='''\n        String v9525u=d==null?"":d.toUpperCase(java.util.Locale.ROOT);\n        if(v9525u.contains("DİNAMİK")||v9525u.contains("DINAMIK")) return "15m ana yön/senaryo daha önce tamamlanmış kapanışla teyit edildi; orijinal giriş kovalanmadı. Yeni 5m yapısal retest koridorunda tamamlanmış 5m kabul/yapı kırılımı oluştu; güncel R/R ve ağırlıklı canlı akış uygun bulundu.";'''
        x=x[:brace]+ins+x[brace:]; m=m[:a0]+x+m[e0:]

b = method_bounds(m, '    private String v9518ShortReason(String d)')
if b:
    a0,_,e0=b; x=m[a0:e0]
    if '5m dinamik retest teyidi' not in x:
        brace=x.find('{')+1
        ins='''\n        String v9525u=d==null?"":d.toUpperCase(java.util.Locale.ROOT);\n        if(v9525u.contains("DİNAMİK")||v9525u.contains("DINAMIK")) return "5m dinamik retest teyidi";'''
        x=x[:brace]+ins+x[brace:]; m=m[:a0]+x+m[e0:]

MON.write_text(m)

out=MON.read_text()
checks=[
    ('V9525B_LIVE_5M_DYNAMIC_REENTRY' in out,'5m dynamic monitor marker'),
    ('v9525ClosedKlines' in out and 'interval,"5m"' in out,'public 5m closed-kline fetch'),
    ('closeTime>=now' in out,'open candle excluded'),
    ('v9525Recent15mConfirmation' in out and '45L*60L*1000L' in out,'45m 15m-confirmation window'),
    ('v9525AddFvgZones' in out and 'v9525AddObZone' in out and 'v9525AddFibZones' in out and 'v9525AddSwingZone' in out,'structural retest families'),
    ('java.util.Set<String> fam' in out,'same-family evidence deduplicated'),
    ('age>90000L' in out,'fresh completed 5m confirmation gate'),
    ('v9517StableFlow' in out,'weighted live-flow gate retained'),
    ('(t1-live)/risk<1.0' in out and '(t2-live)/risk<1.5' in out,'long RR veto'),
    ('(live-t1)/risk<1.0' in out and '(live-t2)/risk<1.5' in out,'short RR veto'),
    ('LONG DİNAMİK RETEST' in out and 'SHORT DİNAMİK RETEST' in out,'dynamic urgent signal types'),
    ('orijinal giriş kovalanmadı' in out,'accurate signal reason'),
    ('v9525EvaluateDynamicReentry(p, market, v953LivePrice);' in out,'evaluate integration'),
]
for ok,name in checks:
    print(('OK   ' if ok else 'FAIL '),name)
    if not ok: raise SystemExit('v9.5.25b sanity failed: '+name)
print('v9.5.25b OK: confirmed 15m move can create a fresh structural 5m re-entry from role-flip/FVG/OB/Fib/swing clusters; 3m is not mandatory; R/R, no-chase, flow and manual-order safety remain.')
