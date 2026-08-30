from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MONITOR = JAVA / 'MonitorService.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MONITOR, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.3 missing: {p}')

# ---------------- MAIN ACTIVITY ----------------
s = MAIN.read_text()
s = s.replace('15m Futures Alarm PRO v9.5.2', '15m Futures Alarm PRO v9.5.3')
s = s.replace('15m Futures Alarm PRO v9.5.1', '15m Futures Alarm PRO v9.5.3')
s = s.replace('15m Futures Alarm PRO v9.5', '15m Futures Alarm PRO v9.5.3')
s = s.replace('15m Futures Alarm PRO v9.4', '15m Futures Alarm PRO v9.5.3')
s = s.replace('15m Futures Alarm PRO v9.3', '15m Futures Alarm PRO v9.5.3')

s = s.replace('🟢 LONG SİNYALLERİ', '🟢 LONG SENARYOLARI')
s = s.replace('🔴 SHORT SİNYALLERİ', '🔴 SHORT SENARYOLARI')

repls = {
    'addSetup(card, "LONG PULLBACK",': 'addSetup(card, v953ScenarioLabel(p.symbol, "LONG", "LONG PULLBACK"),',
    'addSetup(card, "LONG BREAKOUT",': 'addSetup(card, v953ScenarioLabel(p.symbol, "LONG", "LONG BREAKOUT"),',
    'addSetup(card, "SHORT DİRENÇ",': 'addSetup(card, v953ScenarioLabel(p.symbol, "SHORT", "SHORT DİRENÇ"),',
    'addSetup(card, "SHORT BREAKDOWN",': 'addSetup(card, v953ScenarioLabel(p.symbol, "SHORT", "SHORT BREAKDOWN"),',
}
for old, new in repls.items():
    if old in s:
        s = s.replace(old, new, 1)

if 'v953AddDecisionGate(card, p.symbol);' not in s:
    anchor = '        v95AddMetaPanel(card, p.symbol);'
    if anchor in s:
        s = s.replace(anchor, anchor + '\n        v953AddDecisionGate(card, p.symbol);', 1)
    else:
        anchor2 = '        card.addView(symbolTitle);'
        if anchor2 not in s:
            raise SystemExit('v9.5.3: plan card title anchor not found')
        s = s.replace(anchor2, anchor2 + '\n        v953AddDecisionGate(card, p.symbol);', 1)

if 'v953ResetSignalLocks(sym);' not in s:
    anchor = 'lpDetail, lbDetail, srDetail, sbDetail));'
    if anchor not in s:
        raise SystemExit('v9.5.3: PlanStore upsert anchor not found')
    s = s.replace(anchor, anchor + '\n                    v953ResetSignalLocks(sym);', 1)

main_helper = r'''

    private String v953Decision(String symbol) {
        String raw = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE)
                .getString("v95_meta_" + symbol, "");
        if (raw == null) raw = "";
        String u = raw.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G').replace('Ü','U').replace('Ö','O').replace('Ç','C');
        if (u.contains("ANA_KARAR=ISLEM_YOK") || u.contains("ANA_KARAR:ISLEM_YOK") || u.contains("ANA KARAR=ISLEM YOK")) return "ISLEM_YOK";
        if (u.contains("ANA_KARAR=LONG") || u.contains("ANA_KARAR:LONG") || u.contains("ANA KARAR=LONG")) return "LONG";
        if (u.contains("ANA_KARAR=SHORT") || u.contains("ANA_KARAR:SHORT") || u.contains("ANA KARAR=SHORT")) return "SHORT";
        return "UNKNOWN";
    }

    private String v953ScenarioLabel(String symbol, String side, String base) {
        String d = v953Decision(symbol);
        if ("ISLEM_YOK".equals(d)) return "KOŞULLU • " + base;
        if (side.equals(d)) return "AKTİF ADAY • " + base;
        if ("LONG".equals(d) || "SHORT".equals(d)) return "PASİF • " + base;
        return "META EKSİK • " + base;
    }

    private void v953AddDecisionGate(LinearLayout card, String symbol) {
        String d = v953Decision(symbol);
        String body;
        int fg;
        if ("ISLEM_YOK".equals(d)) {
            body = "🔒 ANA KARAR: İŞLEM YOK\n"
                    + "Kritik işlem alarmı KAPALI. Aşağıdaki LONG/SHORT seviyeleri yalnız KOŞULLU SENARYODUR. "
                    + "Yeni ChatGPT analizi ANA KARAR'ı LONG veya SHORT yapmadan giriş alarmı üretilmez.";
            fg = Color.rgb(251, 191, 36);
        } else if ("LONG".equals(d)) {
            body = "🎯 ANA KARAR: LONG\n"
                    + "Yalnız LONG senaryoları aktif adaydır. Alarm için: tamamlanmış 15m teyit + fiyat hâlâ giriş aralığında + canlı flow kabul edilebilir olmalı.";
            fg = Color.rgb(74, 222, 128);
        } else if ("SHORT".equals(d)) {
            body = "🎯 ANA KARAR: SHORT\n"
                    + "Yalnız SHORT senaryoları aktif adaydır. Alarm için: tamamlanmış 15m teyit + fiyat hâlâ giriş aralığında + canlı flow kabul edilebilir olmalı.";
            fg = Color.rgb(248, 113, 113);
        } else {
            body = "⚠ META ANA KARAR EKSİK\n"
                    + "Güvenlik için kritik işlem alarmı KAPALI. 14 alanlı ChatGPT planını yeniden yapıştır.";
            fg = Color.rgb(251, 191, 36);
        }
        TextView t = text(body, 12.5f, fg, true);
        t.setLineSpacing(0, 1.10f);
        t.setPadding(dp(10), dp(8), dp(10), dp(8));
        t.setBackgroundColor(Color.rgb(15, 23, 42));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(7), 0, dp(5));
        card.addView(t, lp);
    }

    private void v953ResetSignalLocks(String symbol) {
        getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).edit()
                .remove("v953_trade_lock_" + symbol + "_LONG")
                .remove("v953_trade_lock_" + symbol + "_SHORT")
                .apply();
    }
'''
if 'private String v953Decision(' not in s:
    pos = s.rfind('}')
    if pos < 0: raise SystemExit('v9.5.3: MainActivity closing brace missing')
    s = s[:pos] + main_helper + '\n' + s[pos:]
MAIN.write_text(s)

# ---------------- MONITOR SERVICE ----------------
m = MONITOR.read_text()
m = m.replace('15m Futures Alarm PRO v9.5.2', '15m Futures Alarm PRO v9.5.3')
m = m.replace('15m Futures Alarm PRO v9.5.1', '15m Futures Alarm PRO v9.5.3')
m = m.replace('15m Futures Alarm PRO v9.5', '15m Futures Alarm PRO v9.5.3')
m = m.replace('15m Futures Alarm PRO v9.4', '15m Futures Alarm PRO v9.5.3')
m = m.replace('15m Futures Alarm PRO v9.3', '15m Futures Alarm PRO v9.5.3')

if 'evaluate(plan, set, market);' not in m:
    if 'evaluate(plan, set);' not in m:
        raise SystemExit('v9.5.3: evaluate call anchor missing')
    m = m.replace('evaluate(plan, set);', 'evaluate(plan, set, market);', 1)

if 'private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)' not in m:
    if 'private void evaluate(TradePlan p, CandleSet set)' not in m:
        raise SystemExit('v9.5.3: evaluate signature anchor missing')
    m = m.replace('private void evaluate(TradePlan p, CandleSet set)',
                  'private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)', 1)

m = m.replace('b.append("İZLENEN SENARYO: ").append(scenario).append("\\n");',
              'b.append("EN YAKIN KOŞULLU SENARYO: ").append(scenario).append("\\n");')
m = m.replace('b.append("⏳ SİNYAL İÇİN BEKLENEN: ").append(wait).append("\\n\\n");',
              'b.append("📍 SEVİYE İÇİN BEKLENEN: ").append(wait).append("\\n\\n");')

flow_anchor = '        b.append("• Flow destek puanı: LONG ").append(longScore).append("/80  •  SHORT ").append(shortScore).append("/80\\n");'
if '🎯 ALARM KAPISI' not in m:
    if flow_anchor not in m:
        raise SystemExit('v9.5.3: live flow anchor missing')
    gate = flow_anchor + r'''
        String v953d = v953Decision(p.symbol);
        boolean v953LongFlow = v953FlowAcceptable(true, m, false);
        boolean v953ShortFlow = v953FlowAcceptable(false, m, false);
        b.append("\n🎯 ALARM KAPISI\n");
        if ("ISLEM_YOK".equals(v953d)) {
            b.append("• ANA KARAR: İŞLEM YOK → kritik alarm KİLİTLİ\n");
            b.append("• Seviyeler yalnız koşullu referanstır; yeni ChatGPT planı beklenir.\n");
        } else if ("LONG".equals(v953d)) {
            b.append("• ANA KARAR: LONG → SHORT senaryoları PASİF\n");
            b.append("• LONG flow filtresi: ").append(v953LongFlow ? "UYGUN" : "BEKLE / YETERSİZ").append("\n");
            b.append("• Alarm = tamamlanmış 15m teyit + fiyat giriş aralığında + flow filtresi uygun\n");
        } else if ("SHORT".equals(v953d)) {
            b.append("• ANA KARAR: SHORT → LONG senaryoları PASİF\n");
            b.append("• SHORT flow filtresi: ").append(v953ShortFlow ? "UYGUN" : "BEKLE / YETERSİZ").append("\n");
            b.append("• Alarm = tamamlanmış 15m teyit + fiyat giriş aralığında + flow filtresi uygun\n");
        } else {
            b.append("• META ANA KARAR yok → güvenlik için kritik alarm KİLİTLİ\n");
        }
'''
    m = m.replace(flow_anchor, gate, 1)

old = '        boolean pullConfirmed = pullTouched && closed.close > closed.open && closed.close >= pullMid;'
new = '''        boolean pullRaw = pullTouched && closed.close > closed.open && closed.close >= pullMid;
        double v953LivePrice = (set.current != null ? set.current.close : closed.close);
        boolean pullConfirmed = v953DirectionAllowed(p.symbol, true)
                && pullRaw
                && v953FlowAcceptable(true, market, false)
                && v953InEntryRange(v953LivePrice, p.pullbackLow, p.pullbackHigh, 0.50);'''
if old in m:
    m = m.replace(old, new, 1)
elif 'boolean pullConfirmed = v953DirectionAllowed' not in m:
    raise SystemExit('v9.5.3: pullback condition anchor missing')

old = '        boolean resConfirmed = resTouched && closed.close < closed.open && closed.close <= resMid;'
new = '''        boolean resRaw = resTouched && closed.close < closed.open && closed.close <= resMid;
        boolean resConfirmed = v953DirectionAllowed(p.symbol, false)
                && resRaw
                && v953FlowAcceptable(false, market, false)
                && v953InEntryRange(v953LivePrice, p.resistanceLow, p.resistanceHigh, 0.50);'''
if old in m:
    m = m.replace(old, new, 1)
elif 'boolean resConfirmed = v953DirectionAllowed' not in m:
    raise SystemExit('v9.5.3: resistance condition anchor missing')

old = '        boolean breakout = closed.close > p.breakoutClose;'
new = '''        double[] v953LbEntry = v953EntryRange(p.longBreakDetail, p.breakoutClose, true);
        boolean breakout = v953DirectionAllowed(p.symbol, true)
                && closed.close > p.breakoutClose
                && v953FlowAcceptable(true, market, true)
                && v953InEntryRange(v953LivePrice, v953LbEntry[0], v953LbEntry[1], 0.30);'''
if old in m:
    m = m.replace(old, new, 1)
elif 'double[] v953LbEntry' not in m:
    raise SystemExit('v9.5.3: breakout condition anchor missing')

old = '        boolean breakdown = closed.close < p.breakdownClose;'
new = '''        double[] v953SbEntry = v953EntryRange(p.shortBreakDetail, p.breakdownClose, false);
        boolean breakdown = v953DirectionAllowed(p.symbol, false)
                && closed.close < p.breakdownClose
                && v953FlowAcceptable(false, market, true)
                && v953InEntryRange(v953LivePrice, v953SbEntry[0], v953SbEntry[1], 0.30);'''
if old in m:
    m = m.replace(old, new, 1)
elif 'double[] v953SbEntry' not in m:
    raise SystemExit('v9.5.3: breakdown condition anchor missing')

if 'v953_trade_lock_' not in m:
    urgent_sig = '    private void sendUrgent(String symbol, String direction, String detail) {\n'
    if urgent_sig not in m:
        raise SystemExit('v9.5.3: sendUrgent signature missing')
    guard = urgent_sig + '''        String v953Side = direction.startsWith("LONG") ? "LONG" : "SHORT";\n        String v953LockKey = "v953_trade_lock_" + symbol + "_" + v953Side;\n        if (prefs.getBoolean(v953LockKey, false)) return;\n        prefs.edit().putBoolean(v953LockKey, true).apply();\n        detail = detail + "\\n\\n🔒 Bu plan için aynı yönde tekrar alarm kilitlendi. Yeni plan yapıştırılınca yeniden kurulur.";\n'''
    m = m.replace(urgent_sig, guard, 1)

monitor_helper = r'''

    private String v953Decision(String symbol) {
        String raw = prefs.getString("v95_meta_" + symbol, "");
        if (raw == null) raw = "";
        String u = raw.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G').replace('Ü','U').replace('Ö','O').replace('Ç','C');
        if (u.contains("ANA_KARAR=ISLEM_YOK") || u.contains("ANA_KARAR:ISLEM_YOK") || u.contains("ANA KARAR=ISLEM YOK")) return "ISLEM_YOK";
        if (u.contains("ANA_KARAR=LONG") || u.contains("ANA_KARAR:LONG") || u.contains("ANA KARAR=LONG")) return "LONG";
        if (u.contains("ANA_KARAR=SHORT") || u.contains("ANA_KARAR:SHORT") || u.contains("ANA KARAR=SHORT")) return "SHORT";
        return "UNKNOWN";
    }

    private boolean v953DirectionAllowed(String symbol, boolean wantLong) {
        String d = v953Decision(symbol);
        return wantLong ? "LONG".equals(d) : "SHORT".equals(d);
    }

    private int[] v953FlowScores(MarketSnapshot m) {
        int longScore = 0, shortScore = 0;
        if (m == null) return new int[]{0,0,0};
        int available = 0;
        if (!Double.isNaN(m.cvd15)) { available++; if (m.cvd15 > 0) longScore += 18; if (m.cvd15 < 0) shortScore += 18; }
        if (!Double.isNaN(m.oiChangePct)) {
            available++;
            if (m.priceChange15Pct > 0 && m.oiChangePct > 0) longScore += 16;
            else if (m.priceChange15Pct < 0 && m.oiChangePct > 0) shortScore += 16;
            else { longScore += 5; shortScore += 5; }
        }
        if (!Double.isNaN(m.volumeRatio)) { available++; int v = m.volumeRatio >= 1.2 ? 14 : (m.volumeRatio >= 1.0 ? 9 : 3); longScore += v; shortScore += v; }
        if (!Double.isNaN(m.takerBuyPct)) { available++; if (m.takerBuyPct >= 52) longScore += 14; if (m.takerSellPct >= 52) shortScore += 14; }
        if (!Double.isNaN(m.bidPct)) { available++; if (m.bidPct >= 55) longScore += 10; if (m.askPct >= 55) shortScore += 10; }
        if (!Double.isNaN(m.fundingRate)) { available++; if (m.fundingRate <= 0.01) longScore += 8; if (m.fundingRate >= 0.01) shortScore += 8; }
        return new int[]{Math.min(80,longScore), Math.min(80,shortScore), available};
    }

    private boolean v953FlowAcceptable(boolean wantLong, MarketSnapshot m, boolean breakoutStyle) {
        int[] sc = v953FlowScores(m);
        int support = wantLong ? sc[0] : sc[1];
        int opposite = wantLong ? sc[1] : sc[0];
        if (sc[2] < 3) return false;
        if (support < 35) return false;
        if (opposite > support + 8) return false;
        if (m != null && !Double.isNaN(m.volumeRatio)) {
            double minVol = breakoutStyle ? 0.70 : 0.55;
            if (m.volumeRatio < minVol) return false;
        }
        return true;
    }

    private boolean v953InEntryRange(double price, double low, double high, double tolerancePct) {
        if (Double.isNaN(price) || low <= 0 || high <= 0) return false;
        if (low > high) { double t = low; low = high; high = t; }
        double lo = low * (1.0 - tolerancePct / 100.0);
        double hi = high * (1.0 + tolerancePct / 100.0);
        return price >= lo && price <= hi;
    }

    private double[] v953EntryRange(String detail, double trigger, boolean longBreakout) {
        try {
            java.util.regex.Matcher x = java.util.regex.Pattern
                    .compile("Giriş:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*[–-]\\s*([0-9]+(?:\\.[0-9]+)?)",
                            java.util.regex.Pattern.CASE_INSENSITIVE)
                    .matcher(detail == null ? "" : detail);
            if (x.find()) return new double[]{Double.parseDouble(x.group(1)), Double.parseDouble(x.group(2))};
        } catch (Throwable ignored) {}
        double span = trigger * 0.0030;
        return longBreakout
                ? new double[]{trigger, trigger + span}
                : new double[]{trigger - span, trigger};
    }
'''
if 'private String v953Decision(' not in m:
    pos = m.rfind('}')
    if pos < 0: raise SystemExit('v9.5.3: MonitorService closing brace missing')
    m = m[:pos] + monitor_helper + '\n' + m[pos:]
MONITOR.write_text(m)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 17', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.3'", b, count=1)
BUILD.write_text(b)

mf = MAIN.read_text(); mon = MONITOR.read_text(); bf = BUILD.read_text()
checks = [
    ('15m Futures Alarm PRO v9.5.3' in mf, 'title'),
    ('LONG SENARYOLARI' in mf and 'SHORT SENARYOLARI' in mf, 'scenario headings'),
    ('v953ScenarioLabel' in mf, 'scenario labels'),
    ('ANA KARAR: İŞLEM YOK' in mf, 'decision gate'),
    ('v953ResetSignalLocks(sym);' in mf, 'rearm on import'),
    ('evaluate(plan, set, market);' in mon, 'market-aware evaluate'),
    ('v953DirectionAllowed' in mon, 'decision filter'),
    ('v953FlowAcceptable' in mon, 'flow filter'),
    ('v953InEntryRange' in mon, 'entry price filter'),
    ('v953_trade_lock_' in mon, 'repeat lock'),
    ('EN YAKIN KOŞULLU SENARYO' in mon, 'live scenario wording'),
    ('🎯 ALARM KAPISI' in mon, 'live gate panel'),
    ('versionCode 17' in bf and "versionName '9.5.3'" in bf, 'version bump'),
]
for ok, msg in checks:
    if not ok: raise SystemExit('v9.5.3 check failed: ' + msg)

print('v9.5.3 OK: META decision gate + entry-price guard + live-flow filter + one-alert-per-plan-side lock.')
