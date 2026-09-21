from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.53 missing: ' + str(p))


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    ins = inc = esc = lc = bc = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i+1] if i+1 < len(src) else ''
        if lc:
            if c == '\n': lc = False
        elif bc:
            if c == '*' and n == '/': bc = False; i += 1
        elif ins:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': ins = False
        elif inc:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": inc = False
        else:
            if c == '/' and n == '/': lc = True; i += 1
            elif c == '/' and n == '*': bc = True; i += 1
            elif c == '"': ins = True
            elif c == "'": inc = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)


# ---------------------------------------------------------------------------
# MonitorService: completed-15m breakout acceptance quality + structural STOP.
# A weak 15m breakout remains a confirmed scenario, but immediate execution is
# withheld. The existing 45m/5m retest engine must then create a fresh setup.
# ---------------------------------------------------------------------------
m = MON.read_text()

if 'V9553_BREAKOUT_ACCEPTANCE_STRUCTURAL_STOP' not in m:
    anchor = '    private String v9521Norm(String x) {'
    if anchor not in m:
        anchor = '    private String v953Decision(String symbol) {'
    idx = m.find(anchor)
    if idx < 0:
        raise SystemExit('v9.5.53 Monitor helper anchor missing')
    helper = r'''
    // ============================================================
    // V9553_BREAKOUT_ACCEPTANCE_STRUCTURAL_STOP
    // Scenario confirmation and immediate execution are separate.
    // Marginal 15m acceptance, late expansion with weak flow, or a STOP
    // inside the recent 5m structural swing forces a completed-5m retest.
    // Existing daily plan levels are never rewritten here.
    // ============================================================
    private static final class V9553BreakoutGate {
        boolean immediate = true;
        String reason = "";
    }

    private boolean v9553LateExpansion(String symbol) {
        String raw = prefs.getString("v95_meta_" + symbol, "");
        if (raw == null) return false;
        String u = raw.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G')
                .replace('Ü','U').replace('Ö','O').replace('Ç','C');
        return u.contains("LATE_EXPANSION") || u.contains("EXHAUSTION")
                || u.contains("GEC_GENISLEME") || u.contains("TUKEN");
    }

    private double v9553Recent5mSwing(java.util.List<V9525MiniCandle> a, boolean lng) {
        if (a == null || a.size() < 7) return Double.NaN;
        for (int i=a.size()-3; i>=Math.max(2,a.size()-20); i--) {
            V9525MiniCandle x=a.get(i);
            boolean pivot = lng
                    ? x.l<a.get(i-1).l && x.l<=a.get(i-2).l
                        && x.l<=a.get(i+1).l && x.l<=a.get(i+2).l
                    : x.h>a.get(i-1).h && x.h>=a.get(i-2).h
                        && x.h>=a.get(i+1).h && x.h>=a.get(i+2).h;
            if (pivot) return lng ? x.l : x.h;
        }
        return Double.NaN;
    }

    private V9553BreakoutGate v9553BreakoutGate(
            String symbol, boolean lng, double trigger,
            double o, double h, double l, double c,
            String detail, MarketSnapshot market) {
        V9553BreakoutGate g = new V9553BreakoutGate();
        java.util.ArrayList<String> why = new java.util.ArrayList<>();
        try {
            java.util.List<V9525MiniCandle> m15=v9525ClosedKlines(symbol,"15m",40);
            java.util.List<V9525MiniCandle> m5=v9525ClosedKlines(symbol,"5m",48);
            double atr15=v9525Atr(m15,14), atr5=v9525Atr(m5,14);
            if (Double.isNaN(atr15) || !(atr15>0) || Double.isNaN(atr5) || !(atr5>0)) {
                g.immediate=false;
                why.add("15m/5m ATR-yapı verisi doğrulanamadı");
            } else {
                double range=Math.max(1e-12,h-l);
                double body=Math.abs(c-o)/range;
                double oppWick=lng ? (h-Math.max(o,c))/range : (Math.min(o,c)-l)/range;
                double through=lng ? c-trigger : trigger-c;
                boolean marginal=through>=0 && through<atr15*0.15;
                boolean weakCandle=body<0.35 || oppWick>0.40;
                if (marginal && weakCandle) {
                    g.immediate=false;
                    why.add("15m kırılım kapanışı marjinal ve kabul mumu zayıf");
                }

                double stop=v9518Num(detail,"STOP");
                double swing=v9553Recent5mSwing(m5,lng);
                if (Double.isNaN(stop) || Double.isNaN(swing)) {
                    g.immediate=false;
                    why.add("5m yapısal STOP referansı doğrulanamadı");
                } else {
                    double buffer=Math.max(atr5*0.08,Math.max(trigger,1e-12)*0.0004);
                    boolean structural=lng ? stop<=swing-buffer : stop>=swing+buffer;
                    if (!structural) {
                        g.immediate=false;
                        why.add("plan STOP'u son anlamlı 5m swing'in yapısal dışına taşmıyor");
                    }
                }

                double[] entry=v953EntryRange(detail,trigger,lng);
                double tp1=v9518Num(detail,"TP1"), tp2=v9518Num(detail,"TP2");
                double worst=lng ? Math.max(entry[0],entry[1]) : Math.min(entry[0],entry[1]);
                double risk=lng ? worst-stop : stop-worst;
                double r1=lng ? (tp1-worst)/risk : (worst-tp1)/risk;
                double r2=lng ? (tp2-worst)/risk : (worst-tp2)/risk;
                if (!(risk>0) || Double.isNaN(r1) || Double.isNaN(r2) || r1<1.0 || r2<1.5) {
                    g.immediate=false;
                    why.add("yapıştırılmış STOP ile güncel brüt R/R yetersiz");
                }

                if (v9553LateExpansion(symbol)
                        && !v9517StableFlow(symbol,lng,market,false)) {
                    g.immediate=false;
                    why.add("geç genişleme/tükenme + zayıf veya çelişkili flow");
                }
            }
        } catch (Throwable ex) {
            g.immediate=false;
            why.add("kırılım kalite verisi geçici olarak doğrulanamadı");
        }
        if (!why.isEmpty()) {
            StringBuilder s=new StringBuilder();
            for (String x:why) {
                if (s.length()>0) s.append(" • ");
                s.append(x);
            }
            g.reason=s.toString();
        }
        return g;
    }

    private void v9553ArmRetest(String symbol, boolean lng, String reason) {
        String side=lng?"LONG":"SHORT";
        prefs.edit()
                .putBoolean("v9553_retest_"+symbol+"_"+side,true)
                .putLong("v9553_retest_at_"+symbol+"_"+side,System.currentTimeMillis())
                .putString("v9553_retest_reason_"+symbol+"_"+side,
                        reason==null?"5m yapısal retest/reclaim bekleniyor":reason)
                .apply();
    }

    private void v9553ClearRetest(String symbol, boolean lng) {
        String side=lng?"LONG":"SHORT";
        prefs.edit()
                .remove("v9553_retest_"+symbol+"_"+side)
                .remove("v9553_retest_at_"+symbol+"_"+side)
                .remove("v9553_retest_reason_"+symbol+"_"+side)
                .apply();
    }

    private boolean v9553NeedsRetest(String symbol, boolean lng) {
        String side=lng?"LONG":"SHORT";
        if (!prefs.getBoolean("v9553_retest_"+symbol+"_"+side,false)) return false;
        long at=prefs.getLong("v9553_retest_at_"+symbol+"_"+side,0L);
        return at>0L && System.currentTimeMillis()-at<=45L*60L*1000L;
    }

'''
    m = m[:idx] + helper + m[idx:]

b = method_bounds(m, '    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)')
if not b:
    raise SystemExit('v9.5.53 evaluate missing')
a0, _, e0 = b
body = m[a0:e0]

if 'V9553_LB_ACCEPTANCE_GATE' not in body:
    lb_anchor = '        double[] v953LbEntry = v953EntryRange(p.longBreakDetail, p.breakoutClose, true);'
    if lb_anchor not in body:
        raise SystemExit('v9.5.53 LB entry anchor missing')
    lb_code = r'''        // V9553_LB_ACCEPTANCE_GATE
        boolean v9553LbRaw = closed.close > p.breakoutClose;
        V9553BreakoutGate v9553LbGate = v9553LbRaw
                ? v9553BreakoutGate(p.symbol,true,p.breakoutClose,
                        closed.open,closed.high,closed.low,closed.close,p.longBreakDetail,market)
                : new V9553BreakoutGate();
        if (v9553LbRaw && !v9553LbGate.immediate)
            v9553ArmRetest(p.symbol,true,v9553LbGate.reason);
        else if (v9553LbRaw)
            v9553ClearRetest(p.symbol,true);
'''
    body = body.replace(lb_anchor, lb_code + lb_anchor, 1)
    needle = '                && closed.close > p.breakoutClose\n'
    if needle not in body:
        raise SystemExit('v9.5.53 LB closed-close anchor missing')
    body = body.replace(needle, needle + '                && v9553LbGate.immediate\n', 1)

if 'V9553_SB_ACCEPTANCE_GATE' not in body:
    sb_anchor = '        double[] v953SbEntry = v953EntryRange(p.shortBreakDetail, p.breakdownClose, false);'
    if sb_anchor not in body:
        raise SystemExit('v9.5.53 SB entry anchor missing')
    sb_code = r'''        // V9553_SB_ACCEPTANCE_GATE
        boolean v9553SbRaw = closed.close < p.breakdownClose;
        V9553BreakoutGate v9553SbGate = v9553SbRaw
                ? v9553BreakoutGate(p.symbol,false,p.breakdownClose,
                        closed.open,closed.high,closed.low,closed.close,p.shortBreakDetail,market)
                : new V9553BreakoutGate();
        if (v9553SbRaw && !v9553SbGate.immediate)
            v9553ArmRetest(p.symbol,false,v9553SbGate.reason);
        else if (v9553SbRaw)
            v9553ClearRetest(p.symbol,false);
'''
    body = body.replace(sb_anchor, sb_code + sb_anchor, 1)
    needle = '                && closed.close < p.breakdownClose\n'
    if needle not in body:
        raise SystemExit('v9.5.53 SB closed-close anchor missing')
    body = body.replace(needle, needle + '                && v9553SbGate.immediate\n', 1)

m = m[:a0] + body + m[e0:]

# A v9.5.53 quality-forced retest is allowed even if price is still in the old
# LB/SB corridor. The new 5m setup still needs a fresh close, structural stop,
# current RR and weighted flow through the existing dynamic engine.
b = method_bounds(m, '    private void v9525EvaluateDynamicReentry(TradePlan p,MarketSnapshot market,double live)')
if not b:
    raise SystemExit('v9.5.53 dynamic reentry missing')
a0, _, e0 = b
body = m[a0:e0]
old_l = 'if(v953InEntryRange(live,old[0],old[1],0.30)) return; // original engine owns this case'
if old_l in body:
    body = body.replace(old_l,
        'if(v953InEntryRange(live,old[0],old[1],0.30) && !v9553NeedsRetest(p.symbol,true)) return; // v9.5.53 forced fresh 5m retest',
        1)
old_s = 'if(v953InEntryRange(live,old[0],old[1],0.30)) return;'
if old_s in body:
    body = body.replace(old_s,
        'if(v953InEntryRange(live,old[0],old[1],0.30) && !v9553NeedsRetest(p.symbol,false)) return;',
        1)
if 'v9553ClearRetest(p.symbol,true);' not in body:
    call='                sendUrgent(p.symbol,"LONG DİNAMİK RETEST",d);'
    if call not in body:
        raise SystemExit('v9.5.53 dynamic LONG send anchor missing')
    body=body.replace(call,'                v9553ClearRetest(p.symbol,true);\n'+call,1)
if 'v9553ClearRetest(p.symbol,false);' not in body:
    call='                sendUrgent(p.symbol,"SHORT DİNAMİK RETEST",d);'
    if call not in body:
        raise SystemExit('v9.5.53 dynamic SHORT send anchor missing')
    body=body.replace(call,'                v9553ClearRetest(p.symbol,false);\n'+call,1)
m = m[:a0] + body + m[e0:]

MON.write_text(m)

# ---------------------------------------------------------------------------
# MainActivity: read-only explanation of a confirmed 15m scenario that has been
# deliberately held for 5m execution quality. New plan paste clears old flags.
# ---------------------------------------------------------------------------
s = MAIN.read_text()
if 'V9553_RETEST_GUARD_UI' not in s:
    pos = s.rfind('}')
    if pos < 0: raise SystemExit('v9.5.53 Main closing brace missing')
    ui = r'''

    // V9553_RETEST_GUARD_UI — display only; no plan/order side effects.
    private String v9553RetestGuardText(String symbol) {
        try {
            android.content.SharedPreferences sp=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE);
            long now=System.currentTimeMillis();
            for (String side:new String[]{"LONG","SHORT"}) {
                if (!sp.getBoolean("v9553_retest_"+symbol+"_"+side,false)) continue;
                long at=sp.getLong("v9553_retest_at_"+symbol+"_"+side,0L);
                if (at<=0L || now-at>45L*60L*1000L) continue;
                String why=sp.getString("v9553_retest_reason_"+symbol+"_"+side,"");
                long left=Math.max(0L,45L*60L*1000L-(now-at));
                return "⏳ 15m "+side+" senaryosu teyitli; DOĞRUDAN GİRİŞ BEKLEMEDE\n"
                        +(why==null?"":why)
                        +"\n5m yapısal retest/reclaim gerekli • yaklaşık "
                        +(left/60000L)+" dk pencere kaldı. Plan seviyeleri değiştirilmedi.";
            }
        } catch (Throwable ignored) {}
        return "";
    }
'''
    s=s[:pos]+ui+'\n'+s[pos:]

b = method_bounds(s, 'private void v9518AddSignalPanel(')
if not b:
    raise SystemExit('v9.5.53 signal panel missing')
a0, _, e0 = b
panel=s[a0:e0]
if 'V9553_RETEST_GUARD_PANEL' not in panel:
    p=panel.rfind('}')
    inject=r'''        // V9553_RETEST_GUARD_PANEL
        try {
            String q=v9553RetestGuardText(symbol);
            if(q!=null && !q.isEmpty()){
                TextView v=text(q,11.5f,Color.rgb(253,230,138),true);
                v.setPadding(dp(9),dp(7),dp(9),dp(7));
                v.setBackgroundColor(Color.rgb(113,63,18));
                LinearLayout.LayoutParams vp=new LinearLayout.LayoutParams(-1,ViewGroup.LayoutParams.WRAP_CONTENT);
                vp.setMargins(0,dp(6),0,dp(5)); card.addView(v,vp);
            }
        } catch(Throwable ignored){}
'''
    panel=panel[:p]+inject+panel[p:]
    s=s[:a0]+panel+s[e0:]

fp_old='if (k == null || !k.startsWith("v9518_signal_")) continue;'
if fp_old in s:
    s=s.replace(fp_old,
        'if (k == null || !(k.startsWith("v9518_signal_") || k.startsWith("v9553_retest_"))) continue;',
        1)

b = method_bounds(s, 'private void v953ResetSignalLocks(String symbol)')
if b:
    a0,_,e0=b
    reset=s[a0:e0]
    if 'v9553_retest_at_' not in reset:
        p=reset.rfind('}')
        clear=r'''
        getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).edit()
                .remove("v9553_retest_"+symbol+"_LONG")
                .remove("v9553_retest_"+symbol+"_SHORT")
                .remove("v9553_retest_at_"+symbol+"_LONG")
                .remove("v9553_retest_at_"+symbol+"_SHORT")
                .remove("v9553_retest_reason_"+symbol+"_LONG")
                .remove("v9553_retest_reason_"+symbol+"_SHORT")
                .apply();
'''
        reset=reset[:p]+clear+reset[p:]
        s=s[:a0]+reset+s[e0:]

MAIN.write_text(s)

# ---------------------------------------------------------------------------
# Analysis prompt: future plans mirror the runtime rule. Existing pasted plans
# are not regenerated, refreshed or rewritten by this patch.
# ---------------------------------------------------------------------------
a = ANALYSIS.read_text()
if 'V9.5.53 ZAYIF KIRILIM KABULU' not in a:
    anchor='        sb.append("5) GEÇ GİRİŞ / KOVALAMA / GEÇERSİZLİK FİLTRESİ\\n");'
    if anchor not in a:
        raise SystemExit('v9.5.53 prompt section anchor missing')
    rules=r'''        sb.append("V9.5.53 ZAYIF KIRILIM KABULU: Yukarı/aşağı kırılım TAMAMLANMIŞ 15m kapanışla senaryo olarak teyit edilmiş olsa bile kapanış kırılım çizgisini yaklaşık 0.15 ATR'den az geçmişse ve aynı mumda gövde yaklaşık %35'ten küçük veya karşı fitil yaklaşık %40'tan büyükse bunu güçlü acceptance sayma. Senaryoyu silme; LTF=5M_BEKLE yap ve gerçek giriş için tamamlanmış 5m yapısal retest/reclaim/rejection iste. Bu ek bir kalıcı yön vetosu değildir.\n");
        sb.append("V9.5.53 GEC GENISLEME KURALI: Radar/META LATE_EXPANSION veya EXHAUSTION gösterirken leverage/flow ailesi zayıf ya da çelişkiliyse tamamlanmış 15m kırılımı tek başına hemen girişe çevirmeyin; fiyatı kovalamadan 5m yapısal retest bekleyin. Kısmi CVD tek başına negatif oy veya hard veto değildir.\n");
        sb.append("V9.5.53 YAPISAL STOP DOGRULAMA: LB/SB dahil gerçek giriş STOP'u anlamlı 5m/15m swing, SSL/BSL veya rejection wick'in yapısal dışına ATR/tick tamponıyla konmalıdır. STOP bu yapının içinde kalıyorsa sırf R/R iyi görünsün diye daraltmayın. Gerçek yapısal STOP kullanıldığında TP1<1R veya TP2<1.5R kalıyorsa UYGUN yazmayın; BEKLE/GEÇERSİZ veya yeni 5m retest kurun.\n");
'''
    a=a.replace(anchor,anchor+rules,1)
ANALYSIS.write_text(a)

# Version only; plan contents remain untouched.
for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE):
    z=p.read_text()
    z=re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.53',z)
    z=z.replace('v9.5.52','v9.5.53').replace('V9.5.52','V9.5.53')
    p.write_text(z)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091401',bf,count=1)
bf=re.sub(r"versionName\s+'[^']+'","versionName '9.5.53'",bf,count=1)
BUILD.write_text(bf)

print('v9.5.53 patch applied: weak 15m breakout -> 5m retest, structural STOP/RR validation, late-expansion flow guard; existing plans unchanged.')