from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
ANALYSIS = APP/'app/src/main/java/com/futuresalarm/app/AnalysisPackActivity.java'
if not MAIN.exists() or not ANALYSIS.exists(): raise SystemExit('v9.5.18a UI source missing')


def bounds(src, sig):
    a=src.find(sig)
    if a<0: return None
    b=src.find('{',a); d=1; i=b+1; q=False; esc=False
    while i<len(src) and d:
        c=src[i]
        if q:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': q=False
        else:
            if c=='"': q=True
            elif c=='{': d+=1
            elif c=='}': d-=1
        i+=1
    return None if d else (a,b,i)

s=MAIN.read_text()
s=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.18',s)
s=s.replace('canlı flow','canlı akış').replace('flow filtresi','akış filtresi')
s=s.replace('reclaim/rejection','geri kazanım/ret').replace('reclaim','geri kazanım').replace('rejection','ret')

if 'base = v9518Turkcelestir(base);' not in s:
    sig='    private String v953ScenarioLabel(String symbol, String side, String base) {'
    if sig not in s: raise SystemExit('v9.5.18a scenario label anchor missing')
    s=s.replace(sig,sig+'\n        base = v9518Turkcelestir(base);',1)

b=bounds(s,'    private String v952PostProcessLivePanel(String text) ')
if not b: raise SystemExit('v9.5.18a live panel missing')
a,_,e=b; method=s[a:e]
if 'v9518BeklentiDuzelt' not in method:
    def wrap(m): return 'return v9518Turkcelestir(v9518BeklentiDuzelt('+m.group(1).strip()+'));'
    method,n=re.subn(r'return\s+([^;]+);',wrap,method)
    if n<2: raise SystemExit('v9.5.18a live returns not wrapped')
    s=s[:a]+method+s[e:]

if 'v9518AddSignalPanel(card, symbol);' not in s:
    b=bounds(s,'    private void v953AddDecisionGate(LinearLayout card, String symbol) ')
    if not b: raise SystemExit('v9.5.18a decision gate missing')
    a,_,e=b; method=s[a:e]; p=method.rfind('}')
    method=method[:p]+'        v9518AddSignalPanel(card, symbol);\n'+method[p:]
    s=s[:a]+method+s[e:]

helper=r'''

    private String v9518Turkcelestir(String text) {
        if (text == null) return null;
        return text.replace("LONG PULLBACK", "LONG GERİ ÇEKİLME")
                .replace("LONG BREAKOUT", "LONG YUKARI KIRILIM")
                .replace("SHORT BREAKDOWN", "SHORT AŞAĞI KIRILIM")
                .replace("PULLBACK", "GERİ ÇEKİLME")
                .replace("BREAKOUT", "YUKARI KIRILIM")
                .replace("BREAKDOWN", "AŞAĞI KIRILIM")
                .replace("Flow destek puanı", "Akış destek puanı")
                .replace("LONG flow", "LONG canlı akış")
                .replace("SHORT flow", "SHORT canlı akış")
                .replace("flow filtresi", "akış filtresi")
                .replace("retest/reclaim", "yeniden test/geri kazanım")
                .replace("retest/rejection", "yeniden test/ret")
                .replace("retest", "yeniden test")
                .replace("reclaim", "geri kazanım")
                .replace("rejection", "ret")
                .replace("bullish", "yükseliş").replace("bearish", "düşüş")
                .replace("📍 SEVİYE İÇİN BEKLENEN:", "⏳ NE BEKLENİYOR?:");
    }

    private String v9518BeklentiDuzelt(String text) {
        if (text == null) return null;
        try {
            double now = v952NumberAfter(text, "Anlık:");
            if (Double.isNaN(now)) return text;
            java.util.regex.Matcher r = java.util.regex.Pattern.compile(
                    "Fiyat\\s+([0-9]+(?:\\.[0-9]+)?)\\s*[–-]\\s*([0-9]+(?:\\.[0-9]+)?)\\s+direnç bölgesine yaklaşsın",
                    java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text);
            if (r.find()) {
                double lo=Double.parseDouble(r.group(1)), hi=Double.parseDouble(r.group(2));
                if (lo>hi) { double z=lo; lo=hi; hi=z; }
                if (now>hi) text=r.replaceFirst(java.util.regex.Matcher.quoteReplacement(
                        "Fiyat direnç bölgesinin üzerinde. SHORT için fiyatın yeniden direnç alanına dönmesi ve tamamlanmış 15 dakikalık düşüş mumunun bölgenin alt sınırı altında kapanması bekleniyor"));
            }
            java.util.regex.Matcher p = java.util.regex.Pattern.compile(
                    "Fiyat\\s+([0-9]+(?:\\.[0-9]+)?)\\s*[–-]\\s*([0-9]+(?:\\.[0-9]+)?)\\s+(?:geri çekilme|pullback) bölgesine yaklaşsın",
                    java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text);
            if (p.find()) {
                double lo=Double.parseDouble(p.group(1)), hi=Double.parseDouble(p.group(2));
                if (lo>hi) { double z=lo; lo=hi; hi=z; }
                if (now<lo) text=p.replaceFirst(java.util.regex.Matcher.quoteReplacement(
                        "Fiyat geri çekilme bölgesinin altında. LONG için fiyatın bölgeyi yeniden kazanması ve tamamlanmış 15 dakikalık yükseliş mumunun üst sınır üzerinde kapanması bekleniyor"));
            }
        } catch (Throwable ignored) {}
        return text;
    }

    private String v9518Saat(long ts) {
        if (ts<=0L) return "-";
        try { return new java.text.SimpleDateFormat("dd.MM.yyyy HH:mm:ss", java.util.Locale.getDefault()).format(new java.util.Date(ts)); }
        catch (Throwable ignored) { return Long.toString(ts); }
    }

    private double v9518D(android.content.SharedPreferences sp, String key) {
        try { return Double.parseDouble(sp.getString(key,"NaN")); } catch(Throwable ignored) { return Double.NaN; }
    }

    private String v9518SignalOzet(String symbol) {
        android.content.SharedPreferences sp=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE);
        long ts=sp.getLong("v9518_signal_time_"+symbol,0L);
        String hist=sp.getString("v9518_history_"+symbol,"");
        if (ts<=0L && (hist==null || hist.trim().isEmpty()))
            return "📒 SİNYAL TAKİBİ\n• Henüz gerçek giriş sinyali oluşmadı.\n• Alarmdan önce canlı teyit panelindeki NE BEKLENİYOR? şartlarının tamamı sağlanmalıdır.";
        StringBuilder o=new StringBuilder("📒 SİNYAL TAKİBİ\n");
        if (ts>0L) {
            String side=sp.getString("v9518_signal_side_"+symbol,"-");
            String reason=sp.getString("v9518_signal_reason_"+symbol,"-");
            String state=sp.getString("v9518_signal_state_"+symbol,"-");
            long end=sp.getLong("v9518_signal_end_"+symbol,0L);
            double entry=v9518D(sp,"v9518_signal_price_"+symbol), stop=v9518D(sp,"v9518_signal_stop_"+symbol);
            double t1=v9518D(sp,"v9518_signal_tp1_"+symbol),t2=v9518D(sp,"v9518_signal_tp2_"+symbol),t3=v9518D(sp,"v9518_signal_tp3_"+symbol),pct=v9518D(sp,"v9518_signal_pct_"+symbol);
            o.append("• Sinyal saati: ").append(v9518Saat(ts)).append("\n• Yön: ").append(side)
                    .append("\n• Sinyal nedeni: ").append(reason).append("\n");
            if(!Double.isNaN(entry)) o.append("• Sinyal fiyatı: ").append(String.format(java.util.Locale.US,"%.8f",entry)).append("\n");
            if(!Double.isNaN(stop)) o.append("• STOP: ").append(String.format(java.util.Locale.US,"%.8f",stop)).append("\n");
            if(!Double.isNaN(t1)) o.append("• TP1: ").append(String.format(java.util.Locale.US,"%.8f",t1)).append("  ");
            if(!Double.isNaN(t2)) o.append("TP2: ").append(String.format(java.util.Locale.US,"%.8f",t2)).append("  ");
            if(!Double.isNaN(t3)) o.append("TP3: ").append(String.format(java.util.Locale.US,"%.8f",t3));
            if(!Double.isNaN(t1)||!Double.isNaN(t2)||!Double.isNaN(t3)) o.append("\n");
            o.append("• Durum: ").append(state).append("\n");
            if(end>0L) o.append("• Sonuç saati: ").append(v9518Saat(end)).append("\n");
            if(!Double.isNaN(pct)) o.append("• Fiyat hareketi: ").append(String.format(java.util.Locale.US,"%+.2f%%",pct)).append("\n");
        }
        if(hist!=null && !hist.trim().isEmpty()) {
            o.append("\n🗂 SON TAMAMLANAN SİNYALLER\n"); int n=0;
            for(String row:hist.split("\\n")) if(row!=null&&!row.trim().isEmpty()&&n++<5) o.append("• ").append(row.trim()).append("\n");
        }
        return o.toString().trim();
    }

    private void v9518AddSignalPanel(LinearLayout card, String symbol) {
        TextView t=text(v9518SignalOzet(symbol),12.5f,Color.rgb(226,232,240),false);
        t.setLineSpacing(0,1.10f); t.setPadding(dp(10),dp(9),dp(10),dp(9)); t.setBackgroundColor(Color.rgb(8,30,38));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0,dp(7),0,dp(5)); card.addView(t,lp);
    }
'''
if 'private String v9518Turkcelestir(' not in s:
    p=s.rfind('}')
    if p<0: raise SystemExit('v9.5.18a closing brace missing')
    s=s[:p]+helper+'\n'+s[p:]
MAIN.write_text(s)

a=ANALYSIS.read_text()
a=re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.18',a)
a=re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.18',a)
ANALYSIS.write_text(a)

f=MAIN.read_text()
for ok,msg in [
    ('v9518AddSignalPanel(card, symbol);' in f,'signal panel'),
    ('SİNYAL TAKİBİ' in f and 'Sinyal nedeni:' in f,'tracking UI'),
    ('SON TAMAMLANAN SİNYALLER' in f,'history UI'),
    ('NE BEKLENİYOR?' in f,'waiting label'),
    ('v9518BeklentiDuzelt' in f,'waiting correction')]:
    if not ok: raise SystemExit('v9.5.18a failed: '+msg)
print('v9.5.18a OK: Turkish UI + clear waiting state + signal/result panel.')
