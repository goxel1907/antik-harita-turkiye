from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'
MON=JAVA/'MonitorService.java'
ANALYSIS=JAVA/'AnalysisPackActivity.java'
RADAR=JAVA/'MarketRadarActivity.java'
ENGINE=JAVA/'V9538MarketRadarEngine.java'
BUILD=APP/'app/build.gradle'
EMACTX=JAVA/'V9558EmaContext.java'
for p in (MAIN,MON,ANALYSIS,RADAR,ENGINE,BUILD):
    if not p.exists(): raise SystemExit('v9.5.58 missing: '+str(p))


def method_bounds(src, fragment):
    a=src.find(fragment)
    if a<0: return None
    b=src.find('{',a)
    if b<0: return None
    depth=1;i=b+1;ins=inc=esc=lc=bc=False
    while i<len(src) and depth:
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if lc:
            if c=='\n': lc=False
        elif bc:
            if c=='*' and n=='/': bc=False;i+=1
        elif ins:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': ins=False
        elif inc:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=="'": inc=False
        else:
            if c=='/' and n=='/': lc=True;i+=1
            elif c=='/' and n=='*': bc=True;i+=1
            elif c=='"': ins=True
            elif c=="'": inc=True
            elif c=='{': depth+=1
            elif c=='}': depth-=1
        i+=1
    return None if depth else (a,b,i)

# ---------------------------------------------------------------------------
# 1) REAL SIGNAL JOURNAL
# A real signal that was emitted must never disappear merely because the active
# card is rebuilt, the app resumes, or the lifecycle later becomes terminal.
# MonitorService writes an immutable per-signal snapshot keyed by symbol+signalTs.
# MainActivity always renders the latest snapshot and compact recent history.
# ---------------------------------------------------------------------------
mon=MON.read_text()
for marker in ('v9518_signal_time_','v9518_signal_active_','v9518_signal_state_','v9518UpdateSignalResult','v9518Finish','V9556_ADAPTIVE_MOMENTUM_REBASE'):
    if marker not in mon: raise SystemExit('v9.5.58 Monitor prerequisite missing: '+marker)

if 'private void v9558PersistSignalJournal(' not in mon:
    idx=mon.find('    private String v953Decision(String symbol)')
    if idx<0: idx=mon.rfind('}')
    if idx<0: raise SystemExit('v9.5.58 Monitor helper anchor missing')
    helper=r'''
    // ============================================================
    // V9558_PERSISTENT_SIGNAL_JOURNAL
    // One immutable snapshot per REAL emitted signal. The normal active flag can
    // later become false, but the journal entry remains until normal app-data
    // deletion. This does not create/close orders and does not regenerate plans.
    // ============================================================
    private String v9558Num(double x) {
        return Double.isNaN(x) || Double.isInfinite(x) ? "" : Double.toString(x);
    }

    private String v9558JournalId(String symbol,long ts) {
        String s=symbol==null?"":symbol.trim().toUpperCase(java.util.Locale.US);
        return s+"_"+Math.max(0L,ts);
    }

    private void v9558PersistSignalJournal(String symbol,String direction,String detail) {
        try {
            String sym=symbol==null?"":symbol.trim().toUpperCase(java.util.Locale.US);
            if(sym.isEmpty()) return;
            long ts=prefs.getLong("v9518_signal_time_"+sym,0L);
            if(ts<=0L) return; // only REAL persisted signals are journaled
            String id=v9558JournalId(sym,ts);
            String side=prefs.getString("v9518_signal_side_"+sym,direction==null?"":direction);
            String reason=detail==null?"":detail.trim();
            String oldReason=prefs.getString("v9558_journal_reason_"+id,"");
            if(reason.isEmpty()) reason=oldReason==null?"":oldReason;

            String raw=prefs.getString("v9558_signal_journal_index","");
            java.util.ArrayList<String> ids=new java.util.ArrayList<>();
            ids.add(id);
            if(raw!=null&&!raw.trim().isEmpty()) {
                for(String x:raw.split("\\|")) {
                    String q=x==null?"":x.trim();
                    if(q.isEmpty()||q.equals(id)||ids.contains(q)) continue;
                    ids.add(q);
                    if(ids.size()>=12) break;
                }
            }
            StringBuilder joined=new StringBuilder();
            for(String x:ids){ if(joined.length()>0) joined.append('|'); joined.append(x); }

            android.content.SharedPreferences.Editor ed=prefs.edit()
                    .putString("v9558_signal_journal_index",joined.toString())
                    .putString("v9558_journal_symbol_"+id,sym)
                    .putString("v9558_journal_side_"+id,side==null?"":side)
                    .putLong("v9558_journal_ts_"+id,ts)
                    .putString("v9558_journal_reason_"+id,reason)
                    .putString("v9558_journal_state_"+id,prefs.getString("v9518_signal_state_"+sym,"AÇIK - HEDEF/STOP TAKİBİNDE"))
                    .putString("v9558_journal_entry_"+id,v9558Num(v9518D("v9518_signal_price_"+sym)))
                    .putString("v9558_journal_stop_"+id,v9558Num(v9518D("v9518_signal_stop_"+sym)))
                    .putString("v9558_journal_tp1_"+id,v9558Num(v9518D("v9518_signal_tp1_"+sym)))
                    .putString("v9558_journal_tp2_"+id,v9558Num(v9518D("v9518_signal_tp2_"+sym)))
                    .putString("v9558_journal_tp3_"+id,v9558Num(v9518D("v9518_signal_tp3_"+sym)));
            ed.apply();
        } catch(Throwable ignored) {}
    }

    private void v9558MarkSignalJournalTerminal(String symbol,double exit,String terminalState) {
        try {
            String sym=symbol==null?"":symbol.trim().toUpperCase(java.util.Locale.US);
            if(sym.isEmpty()) return;
            long ts=prefs.getLong("v9518_signal_time_"+sym,0L);
            if(ts<=0L) return;
            String id=v9558JournalId(sym,ts);
            v9558PersistSignalJournal(sym,prefs.getString("v9518_signal_side_"+sym,""),"");
            prefs.edit()
                    .putString("v9558_journal_state_"+id,terminalState==null?"SONLANDI":terminalState)
                    .putLong("v9558_journal_end_"+id,System.currentTimeMillis())
                    .putString("v9558_journal_exit_"+id,v9558Num(exit))
                    .apply();
        } catch(Throwable ignored) {}
    }

'''
    mon=mon[:idx]+helper+mon[idx:]

# Snapshot as soon as the final real-signal emission path is reached.
b=method_bounds(mon,'    private void sendUrgent(')
if not b: raise SystemExit('v9.5.58 sendUrgent missing')
a,brace,e=b
body=mon[a:e]
if 'V9558_JOURNAL_AT_EMIT' not in body:
    ins='''\n        // V9558_JOURNAL_AT_EMIT\n        try { v9558PersistSignalJournal(symbol,direction,detail); } catch (Throwable ignored) {}\n'''
    body=body[:body.find('{')+1]+ins+body[body.find('{')+1:]
    mon=mon[:a]+body+mon[e:]

# Signal result loop is a second idempotent persistence point. If sendUrgent ran
# just before the signal fields were committed, the first live tick fills them.
b=method_bounds(mon,'    private void v9518UpdateSignalResult(')
if not b: raise SystemExit('v9.5.58 v9518UpdateSignalResult missing')
a,brace,e=b
body=mon[a:e]
if 'V9558_JOURNAL_SIGNAL_TICK' not in body:
    side_anchor='String side=prefs.getString("v9518_signal_side_"+symbol,"LONG");'
    if side_anchor not in body:
        raise SystemExit('v9.5.58 signal side anchor missing')
    body=body.replace(side_anchor,side_anchor+'\n        // V9558_JOURNAL_SIGNAL_TICK\n        try { v9558PersistSignalJournal(symbol,side,""); } catch (Throwable ignored) {}',1)
    mon=mon[:a]+body+mon[e:]

# Capture terminal state before the normal lifecycle code clears/rearms anything.
b=method_bounds(mon,'    private void v9518Finish(')
if not b: raise SystemExit('v9.5.58 v9518Finish missing')
a,brace,e=b
body=mon[a:e]
if 'V9558_JOURNAL_TERMINAL' not in body:
    sig=body[:body.find('{')]
    mm=re.search(r'v9518Finish\s*\(\s*String\s+(\w+)\s*,\s*double\s+(\w+)\s*,\s*String\s+(\w+)\s*\)',sig)
    if not mm: raise SystemExit('v9.5.58 v9518Finish parameter parse failed')
    sym,exitv,state=mm.groups()
    ins=f'''\n        // V9558_JOURNAL_TERMINAL\n        try {{ v9558MarkSignalJournalTerminal({sym},{exitv},{state}); }} catch (Throwable ignored) {{}}\n'''
    body=body[:body.find('{')+1]+ins+body[body.find('{')+1:]
    mon=mon[:a]+body+mon[e:]

MON.write_text(mon)

# ---------------------------------------------------------------------------
# 2) MAIN UI: sticky signal record. The active card may change state, but the
# journal record is always visible and explains ACTIVE / TERMINAL / ORDER state.
# ---------------------------------------------------------------------------
main=MAIN.read_text()
for marker in ('V9557_SIGNAL_LIFECYCLE_EXPLAIN','v9551InstallValidityCard','v9550NormalizeRecentTradeCardPosition','v9522_order_sent_signal_'):
    if marker not in main: raise SystemExit('v9.5.58 Main prerequisite missing: '+marker)

refresh='        try { v9551InstallValidityCard(); } catch (Throwable ignored) {}'
if 'V9558_STICKY_SIGNAL_REFRESH' not in main:
    if refresh not in main: raise SystemExit('v9.5.58 stable refresh anchor missing')
    main=main.replace(refresh,refresh+'\n        // V9558_STICKY_SIGNAL_REFRESH\n        try { v9558InstallPersistentSignalCard(); } catch (Throwable ignored) {}',1)

if 'private void v9558InstallPersistentSignalCard()' not in main:
    pos=main.rfind('}')
    if pos<0: raise SystemExit('v9.5.58 Main close missing')
    helpers=r'''

    // ============================================================
    // V9558_PERSISTENT_SIGNAL_JOURNAL_UI
    // A REAL signal that was emitted remains visible after UI rebuild/resume and
    // after terminal completion. New signals are prepended; old ones remain in
    // compact history. This UI is observational and cannot place/cancel orders.
    // ============================================================
    private String v9558FmtPrice(String raw) {
        try {
            if(raw==null||raw.trim().isEmpty()) return "-";
            double x=Double.parseDouble(raw.trim());
            if(!(x>0)) return "-";
            if(x>=1000) return String.format(java.util.Locale.US,"%.2f",x);
            if(x>=1) return String.format(java.util.Locale.US,"%.5f",x);
            if(x>=0.01) return String.format(java.util.Locale.US,"%.6f",x);
            return String.format(java.util.Locale.US,"%.8f",x);
        } catch(Throwable ignored){ return raw==null?"-":raw; }
    }

    private String v9558Time(long ts) {
        if(ts<=0L) return "?";
        return new java.text.SimpleDateFormat("dd.MM HH:mm:ss",java.util.Locale.getDefault()).format(new java.util.Date(ts));
    }

    private void v9558EnsureCurrentSignalsJournaled(android.content.SharedPreferences sp) {
        try {
            java.util.Map<String,?> all=sp.getAll();
            final String p="v9518_signal_time_";
            for(String k:all.keySet()) {
                if(k==null||!k.startsWith(p)) continue;
                String sym=k.substring(p.length()).trim().toUpperCase(java.util.Locale.US);
                long ts=sp.getLong(k,0L); if(sym.isEmpty()||ts<=0L) continue;
                String id=sym+"_"+ts;
                String index=sp.getString("v9558_signal_journal_index","");
                boolean listed=false;
                if(index!=null) for(String q:index.split("\\|")) if(id.equals(q)){listed=true;break;}
                if(!listed) {
                    java.util.ArrayList<String> ids=new java.util.ArrayList<>(); ids.add(id);
                    if(index!=null) for(String q:index.split("\\|")) { q=q.trim(); if(!q.isEmpty()&&!q.equals(id)&&!ids.contains(q)&&ids.size()<12) ids.add(q); }
                    StringBuilder j=new StringBuilder(); for(String q:ids){if(j.length()>0)j.append('|');j.append(q);}
                    sp.edit().putString("v9558_signal_journal_index",j.toString())
                            .putString("v9558_journal_symbol_"+id,sym)
                            .putString("v9558_journal_side_"+id,sp.getString("v9518_signal_side_"+sym,""))
                            .putLong("v9558_journal_ts_"+id,ts)
                            .putString("v9558_journal_state_"+id,sp.getString("v9518_signal_state_"+sym,"AÇIK - HEDEF/STOP TAKİBİNDE"))
                            .apply();
                }
                // Update only state/order/terminal metadata for this exact cycle;
                // immutable price levels written by MonitorService are preserved.
                android.content.SharedPreferences.Editor ed=sp.edit();
                ed.putString("v9558_journal_state_"+id,sp.getString("v9518_signal_state_"+sym,sp.getString("v9558_journal_state_"+id,"AÇIK")));
                long end=sp.getLong("v9518_signal_end_"+sym,0L);
                if(end>0L && end>=ts) ed.putLong("v9558_journal_end_"+id,end);
                String term=sp.getString("v9541_last_terminal_"+sym,"");
                long termAt=sp.getLong("v9541_last_terminal_at_"+sym,0L);
                if(termAt>=ts && term!=null&&!term.trim().isEmpty()) {
                    ed.putString("v9558_journal_state_"+id,term.trim()).putLong("v9558_journal_end_"+id,termAt);
                }
                ed.apply();
            }
        } catch(Throwable ignored) {}
    }

    private String v9558BuildPersistentSignalText(android.content.SharedPreferences sp) {
        v9558EnsureCurrentSignalsJournaled(sp);
        String raw=sp.getString("v9558_signal_journal_index","");
        if(raw==null||raw.trim().isEmpty()) return "Henüz kaydedilmiş GERÇEK sinyal yok. ANA KARAR aday senaryodur; burada yalnız gerçekten üretilmiş alarmlar tutulur.";
        String[] ids=raw.split("\\|");
        StringBuilder b=new StringBuilder();
        int shown=0;
        for(String id:ids) {
            id=id==null?"":id.trim(); if(id.isEmpty()) continue;
            String sym=sp.getString("v9558_journal_symbol_"+id,"");
            String side=sp.getString("v9558_journal_side_"+id,"");
            long ts=sp.getLong("v9558_journal_ts_"+id,0L);
            String state=sp.getString("v9558_journal_state_"+id,"AÇIK");
            long end=sp.getLong("v9558_journal_end_"+id,0L);
            boolean current = ts>0L && ts==sp.getLong("v9518_signal_time_"+sym,0L);
            boolean active = current && sp.getBoolean("v9518_signal_active_"+sym,false);
            long sent=sp.getLong("v9522_order_sent_signal_"+sym,0L);
            if(shown==0) {
                b.append(sym).append(' ').append(side).append(" • ").append(active?"AKTİF":"SONLANDI/KAYITLI").append('\n');
                b.append("Sinyal: ").append(v9558Time(ts)).append(" • Emir: ").append(sent==ts&&ts>0L?"GÖNDERİLDİ":"GÖNDERİLMEDİ").append('\n');
                b.append("Giriş ").append(v9558FmtPrice(sp.getString("v9558_journal_entry_"+id,"")))
                        .append(" • STOP ").append(v9558FmtPrice(sp.getString("v9558_journal_stop_"+id,""))).append('\n');
                b.append("TP1 ").append(v9558FmtPrice(sp.getString("v9558_journal_tp1_"+id,"")))
                        .append(" • TP2 ").append(v9558FmtPrice(sp.getString("v9558_journal_tp2_"+id,"")))
                        .append(" • TP3 ").append(v9558FmtPrice(sp.getString("v9558_journal_tp3_"+id,""))).append('\n');
                String why=sp.getString("v9558_journal_reason_"+id,"");
                if(why!=null&&!why.trim().isEmpty()) b.append("Neden: ").append(why.trim()).append('\n');
                b.append("Durum: ").append(state==null?"?":state);
                if(end>0L) b.append(" • Sonuç: ").append(v9558Time(end));
                b.append("\n\nÖNCEKİ GERÇEK SİNYALLER\n");
            } else {
                b.append("• ").append(sym).append(' ').append(side).append(" • ").append(v9558Time(ts)).append(" • ").append(state==null?"?":state).append('\n');
            }
            shown++;
            if(shown>=5) break;
        }
        b.append("\nKural: Gerçek sinyal kaydı UI yenilenmesiyle silinmez. Aktif sinyal TP3/STOP/Binance-manuel-harici kapanışa kadar takip edilir; terminal olunca kayıt geçmişte kalır.");
        return b.toString();
    }

    private void v9558InstallPersistentSignalCard() {
        android.widget.LinearLayout root=v9544MainRoot(); if(root==null) return;
        android.content.SharedPreferences sp=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE);
        String bodyText=v9558BuildPersistentSignalText(sp);
        android.widget.LinearLayout card=null; android.widget.TextView body=null;
        for(int i=0;i<root.getChildCount();i++) {
            android.view.View v=root.getChildAt(i); Object tag=v.getTag();
            if(tag!=null&&"v9558_signal_journal_card".equals(String.valueOf(tag))&&v instanceof android.widget.LinearLayout){card=(android.widget.LinearLayout)v;break;}
        }
        if(card!=null) {
            for(int i=0;i<card.getChildCount();i++){android.view.View v=card.getChildAt(i);if("v9558_signal_journal_body".equals(String.valueOf(v.getTag()))&&v instanceof android.widget.TextView){body=(android.widget.TextView)v;break;}}
            if(body!=null) body.setText(bodyText);
            return;
        }
        card=new android.widget.LinearLayout(this); card.setTag("v9558_signal_journal_card"); card.setOrientation(android.widget.LinearLayout.VERTICAL);
        card.setPadding(dp(12),dp(9),dp(12),dp(9)); card.setBackgroundColor(android.graphics.Color.rgb(22,45,37));
        android.widget.TextView head=text("📌 GERÇEK SİNYAL KAYDI • KAYBOLMAZ",13.5f,android.graphics.Color.WHITE,true);
        card.addView(head,new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        body=text(bodyText,11.2f,android.graphics.Color.rgb(220,235,226),false); body.setTag("v9558_signal_journal_body");
        android.widget.LinearLayout.LayoutParams bp=new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT); bp.setMargins(0,dp(4),0,0); card.addView(body,bp);
        int insert=-1;
        for(int i=0;i<root.getChildCount();i++) { Object tag=root.getChildAt(i).getTag(); if(tag!=null&&"v9551_validity_card".equals(String.valueOf(tag))){insert=i;break;} }
        if(insert<0) insert=Math.min(5,root.getChildCount());
        android.widget.LinearLayout.LayoutParams lp=new android.widget.LinearLayout.LayoutParams(-1,android.view.ViewGroup.LayoutParams.WRAP_CONTENT); lp.setMargins(0,dp(6),0,dp(8));
        root.addView(card,Math.max(0,Math.min(insert,root.getChildCount())),lp);
    }
'''
    main=main[:pos]+helpers+'\n'+main[pos:]

MAIN.write_text(main)

# ---------------------------------------------------------------------------
# 3) EMA13 / EMA21 multi-TF context for NEW analysis packages.
# EMA is a soft path/mean/context family, never a fifth hard veto and never a
# standalone reversal/continuation trigger.
# ---------------------------------------------------------------------------
ema_java=r'''package com.futuresalarm.app;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/** v9.5.58 completed-candle EMA13/EMA21 context. */
final class V9558EmaContext {
    private V9558EmaContext() {}

    static String summary(Map<String, List<AnalysisPackActivity.Candle>> data) {
        StringBuilder s=new StringBuilder();
        s.append("EMA13/EMA21 COKLU-TF BAGLAM - yalniz tamamlanmis mumlar; tek basina sinyal/veto degildir.\n");
        append(s,"3M", data==null?null:data.get("3m"));
        append(s,"5M", data==null?null:data.get("5m"));
        append(s,"15M",data==null?null:data.get("15m"));
        append(s,"1H", data==null?null:data.get("1h"));
        append(s,"4H", data==null?null:data.get("4h"));
        append(s,"1D", data==null?null:data.get("1d"));
        s.append("YORUM: EMA13 hizli momentum/mean; EMA21 daha yavas kabul/denge baglamidir. Cross gecikmeli olabilir; fiyat yapisi, acceptance, likidite ve R/R yerine gecmez.\n");
        return s.toString();
    }

    private static void append(StringBuilder s,String tf,List<AnalysisPackActivity.Candle> a) {
        s.append(tf).append(": ");
        if(a==null||a.size()<24){s.append("YETERSIZ VERI • PUANSIZ\n");return;}
        int n=a.size();
        double e13=ema(a,13,n), e21=ema(a,21,n);
        double p13=ema(a,13,n-2), p21=ema(a,21,n-2);
        double atr=atr(a,14,n);
        AnalysisPackActivity.Candle last=a.get(n-1), prev=a.get(n-2);
        double slope13=e13-p13, slope21=e21-p21;
        String stack;
        if(e13>e21&&slope13>0&&slope21>=0) stack="BULL_STACK";
        else if(e13<e21&&slope13<0&&slope21<=0) stack="BEAR_STACK";
        else stack="MIXED";
        String loc=last.close>Math.max(e13,e21)?"ABOVE_BOTH":(last.close<Math.min(e13,e21)?"BELOW_BOTH":"BETWEEN");
        boolean loss13=prev.close>=p13&&last.close<e13;
        boolean loss21=prev.close>=p21&&last.close<e21;
        boolean reclaim13=prev.close<=p13&&last.close>e13;
        boolean reclaim21=prev.close<=p21&&last.close>e21;
        String event=loss21?"LOSS21":(loss13?"LOSS13":(reclaim21?"RECLAIM21":(reclaim13?"RECLAIM13":"NONE")));
        double gapAtr=atr>0?Math.abs(e13-e21)/atr:Double.NaN;
        double dist21=atr>0?(last.close-e21)/atr:Double.NaN;
        s.append("EMA13=").append(f(e13)).append(" EMA21=").append(f(e21))
                .append(" • ").append(stack).append(" • PRICE=").append(loc)
                .append(" • EVENT=").append(event)
                .append(" • GAP_ATR=").append(f2(gapAtr))
                .append(" • DIST21_ATR=").append(f2(dist21)).append('\n');
    }

    private static double ema(List<AnalysisPackActivity.Candle> a,int period,int endExclusive) {
        int end=Math.min(a.size(),Math.max(1,endExclusive));
        int start=Math.max(0,end-Math.max(period*5,period+2));
        double k=2.0/(period+1.0),e=a.get(start).close;
        for(int i=start+1;i<end;i++) e=a.get(i).close*k+e*(1.0-k);
        return e;
    }

    private static double atr(List<AnalysisPackActivity.Candle> a,int period,int endExclusive) {
        int end=Math.min(a.size(),Math.max(2,endExclusive));
        int start=Math.max(1,end-period); double sum=0;int c=0;
        for(int i=start;i<end;i++) {
            AnalysisPackActivity.Candle x=a.get(i),p=a.get(i-1);
            double tr=Math.max(x.high-x.low,Math.max(Math.abs(x.high-p.close),Math.abs(x.low-p.close)));
            sum+=tr;c++;
        }
        return c>0?sum/c:Double.NaN;
    }
    private static String f(double x){return Double.isNaN(x)?"?":String.format(Locale.US,"%.8f",x);}
    private static String f2(double x){return Double.isNaN(x)?"?":String.format(Locale.US,"%.2f",x);}
}
'''
EMACTX.write_text(ema_java)

ana=ANALYSIS.read_text()
needle='        sb.append(V9533DayMapContext.summary(data)).append("\\n");'
if 'V9558EmaContext.summary(data)' not in ana:
    if needle not in ana: raise SystemExit('v9.5.58 day-map prompt injection anchor missing')
    inject=needle+r'''
        sb.append("\n--- V9.5.58 EMA13 / EMA21 TAMAMLANMIS-MUM BAGLAMI ---\n");
        sb.append(V9558EmaContext.summary(data)).append("\n");
        sb.append("V9.5.58 EMA KULLANIM SOZLESMESI: EMA13/EMA21 yardimci path/mean baglamidir; tek basina LONG/SHORT, reversal, continuation veya hard veto URETMEZ. Fiyat EMA'lardan cok uzak diye otomatik ters yon alma; FRESH REBASE + acceptance + ileri hedef boslugu + yapisal STOP + yeterli R/R varsa momentum devam edebilir.\n");
        sb.append("V9.5.58 EMA CONTINUATION: tamamlanmis 5m/15m'de EMA13>EMA21, iki EMA egimi yukari ve kapanis ikisinin ustundeyse LONG continuation/rebase'e SOFT destek; tersi SHORT'a soft destektir. Bu destek structure/acceptance ailesini iki kez saymaz ve tek basina giris acmaz.\n");
        sb.append("V9.5.58 EMA LOSS/RECLAIM: parabolik hareket sonrasi tamamlanmis 5m/15m kapanisin EMA13 kaybi momentum sogumasi; EMA21 kaybi + ayni yonde mikro-yapi bozulmasi/failed-auction/flow zayiflamasi daha guclu pullback-reversal kanitidir. Buna karsilik sweep sonrasi EMA13/21 reclaim, yapisal teyitle birlikte alternatif execution yolu olabilir. Cross tek basina sinyal degildir.\n");
        sb.append("V9.5.58 KAR KORUMA BAGLAMI: aktif pozisyon karda iken 5m/15m EMA13 kaybi -> dikkat; EMA21 kaybi + karsi mikro BOS/CHOCH veya failed-auction -> PROTECT_PROFIT/partial-exit degerlendirmesi. Bu OTOMATIK KAPATMA emri degildir; kullanici onayi/plan TP-STOP yonetimi korunur.\n");
        sb.append("V9.5.58 META: 14 pipe alanini degistirme. Mevcut META icine mümkünse EMA5M=BULL_STACK|BEAR_STACK|MIXED/LOSS13/LOSS21/RECLAIM13/RECLAIM21 ve EMA15M=... ekle. EMA aile etkisi EXECUTION/MICRO veya REGIME icinde en fazla bir oy sayilir.\n");
'''
    ana=ana.replace(needle,inject,1)

ANALYSIS.write_text(ana)

# Version bump. Trading hard-veto set remains unchanged.
for p in (MAIN,MON,ANALYSIS,RADAR,ENGINE):
    s=p.read_text()
    s=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.58',s)
    s=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.58  •  MANUEL PRO',s)
    p.write_text(s)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091406',bf,count=1)
bf=re.sub(r"versionName\s+'[^']+'","versionName '9.5.58'",bf,count=1)
BUILD.write_text(bf)

print('v9.5.58 patch applied: real emitted signals persist in a sticky journal; EMA13/EMA21 completed-candle context added as a soft multi-TF decision family; no auto-order/auto-exit introduced.')
