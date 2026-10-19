from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MONITOR = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MONITOR, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.6 missing: {p}')

# ------------------------------------------------------------------
# MainActivity: visible engine freshness panel that keeps updating even when
# the long live-detail snapshot itself has not been redrawn yet.
# ------------------------------------------------------------------
s = MAIN.read_text()
s = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.6', s)

if 'v956AddDataHealthPanel(card, p.symbol);' not in s:
    anchor = '        v953AddDecisionGate(card, p.symbol);'
    if anchor not in s:
        raise SystemExit('v9.5.6 MainActivity decision-gate anchor missing')
    s = s.replace(anchor, anchor + '\n        v956AddDataHealthPanel(card, p.symbol);', 1)

main_helper = r'''

    // v9.5.6: the service writes a heartbeat + latest engine price every cycle.
    // This mini panel refreshes locally every 5 seconds, so a stale UI snapshot
    // cannot look like fresh Binance data.
    private final android.os.Handler v956UiHandler =
            new android.os.Handler(android.os.Looper.getMainLooper());
    private final java.util.Map<String, TextView> v956HealthViews =
            new java.util.HashMap<>();
    private boolean v956TickerRunning = false;

    private final Runnable v956Ticker = new Runnable() {
        @Override public void run() {
            if (isFinishing() || (android.os.Build.VERSION.SDK_INT >= 17 && isDestroyed())) {
                v956TickerRunning = false;
                return;
            }
            v956UpdateHealthViews();
            v956UiHandler.postDelayed(this, 5000L);
        }
    };

    private void v956StartTicker() {
        if (v956TickerRunning) return;
        v956TickerRunning = true;
        v956UiHandler.post(v956Ticker);
    }

    private String v956FmtPrice(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) return "—";
        try {
            return java.math.BigDecimal.valueOf(value).stripTrailingZeros().toPlainString();
        } catch (Throwable ignored) {
            return String.format(java.util.Locale.US, "%.8f", value);
        }
    }

    private void v956AddDataHealthPanel(LinearLayout card, String symbol) {
        TextView t = text("🛰 MOTOR VERİSİ • ilk Binance turu bekleniyor", 11.8f,
                Color.rgb(148, 163, 184), true);
        t.setPadding(dp(10), dp(7), dp(10), dp(7));
        t.setBackground(v955Panel(Color.rgb(6, 20, 31), Color.rgb(30, 64, 83), 10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(4), 0, dp(6));
        card.addView(t, lp);
        v956HealthViews.put(symbol, t);
        v956StartTicker();
        v956UpdateHealthViews();
    }

    private void v956UpdateHealthViews() {
        android.content.SharedPreferences sp =
                getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        long now = System.currentTimeMillis();
        for (java.util.Map.Entry<String, TextView> e : v956HealthViews.entrySet()) {
            String symbol = e.getKey();
            TextView t = e.getValue();
            if (t == null) continue;
            long last = sp.getLong("v956_last_success_" + symbol, 0L);
            long ageSec = last <= 0 ? Long.MAX_VALUE : Math.max(0L, (now - last) / 1000L);
            double px = Double.NaN, close15 = Double.NaN;
            if (sp.contains("v956_price_bits_" + symbol))
                px = Double.longBitsToDouble(sp.getLong("v956_price_bits_" + symbol, 0L));
            if (sp.contains("v956_close15_bits_" + symbol))
                close15 = Double.longBitsToDouble(sp.getLong("v956_close15_bits_" + symbol, 0L));

            if (last <= 0) {
                t.setText("🛰 MOTOR VERİSİ • ilk Binance turu bekleniyor • alarm kilitli");
                t.setTextColor(Color.rgb(251, 191, 36));
            } else if (ageSec <= 30L) {
                t.setText("🟢 MOTOR VERİSİ CANLI • " + ageSec + " sn • Anlık " + v956FmtPrice(px)
                        + " • Son 15m " + v956FmtPrice(close15));
                t.setTextColor(Color.rgb(74, 222, 128));
            } else if (ageSec <= 45L) {
                t.setText("🟡 MOTOR VERİSİ GECİKİYOR • " + ageSec + " sn • Anlık " + v956FmtPrice(px)
                        + " • 45 sn üstünde alarm kilitlenir");
                t.setTextColor(Color.rgb(251, 191, 36));
            } else {
                t.setText("🔴 VERİ ESKİ • " + ageSec + " sn • KRİTİK ALARM KİLİTLİ • son motor fiyatı "
                        + v956FmtPrice(px));
                t.setTextColor(Color.rgb(248, 113, 113));
            }
        }
    }
'''
if 'private void v956AddDataHealthPanel(' not in s:
    pos = s.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.6 MainActivity closing brace missing')
    s = s[:pos] + main_helper + '\n' + s[pos:]
MAIN.write_text(s)

# ------------------------------------------------------------------
# MonitorService: heartbeat/stale protection + screen-only early-flow radar.
# The radar NEVER fires a notification. It only detects probabilistic precursors
# from public futures data: CVD/OI/taker/depth/funding/volume divergences,
# absorption and likely short/long position exits.
# ------------------------------------------------------------------
m = MONITOR.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.6', m)

price_anchor = '        double v953LivePrice = (set.current != null ? set.current.close : closed.close);'
if 'v956_price_bits_' not in m:
    if price_anchor not in m:
        raise SystemExit('v9.5.6 live-price anchor missing')
    heartbeat = price_anchor + r'''
        // v9.5.6 heartbeat: this timestamp is refreshed only when the monitor
        // reaches a real evaluation round with candle + market data.
        if (market != null && !Double.isNaN(v953LivePrice) && !Double.isInfinite(v953LivePrice)) {
            prefs.edit()
                    .putLong("v956_last_success_" + p.symbol, System.currentTimeMillis())
                    .putLong("v956_price_bits_" + p.symbol, Double.doubleToRawLongBits(v953LivePrice))
                    .putLong("v956_close15_bits_" + p.symbol, Double.doubleToRawLongBits(closed.close))
                    .apply();
        }
'''
    m = m.replace(price_anchor, heartbeat, 1)

# Hard fail-safe: urgent trade notifications cannot be emitted from data older
# than 45 seconds. Silent screen tracking remains available.
urgent_sig = '    private void sendUrgent(String symbol, String direction, String detail) {\n'
if 'v956_last_success_' not in m[m.find(urgent_sig):m.find(urgent_sig)+1200] if urgent_sig in m else True:
    if urgent_sig not in m:
        raise SystemExit('v9.5.6 sendUrgent anchor missing')
    guard = urgent_sig + '''        long v956Last = prefs.getLong("v956_last_success_" + symbol, 0L);\n        long v956Age = v956Last <= 0L ? Long.MAX_VALUE : (System.currentTimeMillis() - v956Last);\n        if (v956Age > 45000L) {\n            return; // stale/missing public data: never create a critical trading alarm\n        }\n'''
    m = m.replace(urgent_sig, guard, 1)

flow_anchor = '        b.append("• Flow destek puanı: LONG ").append(longScore).append("/80  •  SHORT ").append(shortScore).append("/80\\n");'
if '🧭 ERKEN AKIŞ RADARI' not in m:
    if flow_anchor not in m:
        raise SystemExit('v9.5.6 flow-score anchor missing')
    radar = flow_anchor + r'''
        b.append("\n🧭 ERKEN AKIŞ RADARI\n");
        b.append(v956EarlyFlowRadar(p.symbol, m)).append("\n");
'''
    m = m.replace(flow_anchor, radar, 1)

monitor_helper = r'''

    private boolean v956Finite(double x) {
        return !Double.isNaN(x) && !Double.isInfinite(x);
    }

    private int v956Clamp(int x) {
        return Math.max(0, Math.min(100, x));
    }

    private String v956EarlyFlowRadar(String symbol, MarketSnapshot m) {
        if (m == null) return "• Veri yetersiz • erken akış skoru hesaplanamadı\n• Radar alarm üretmez.";

        int available = 0;
        if (v956Finite(m.cvd15)) available++;
        if (v956Finite(m.oiChangePct)) available++;
        if (v956Finite(m.priceChange15Pct)) available++;
        if (v956Finite(m.volumeRatio)) available++;
        if (v956Finite(m.takerBuyPct)) available++;
        if (v956Finite(m.bidPct)) available++;
        if (v956Finite(m.fundingRate)) available++;
        if (available < 4) return "• Veri yetersiz (" + available + "/7) • öncü akış güvenilmez\n• Radar alarm üretmez.";

        double px = v956Finite(m.priceChange15Pct) ? m.priceChange15Pct : 0.0;
        double oi = v956Finite(m.oiChangePct) ? m.oiChangePct : 0.0;
        double cvd = v956Finite(m.cvd15) ? m.cvd15 : 0.0;
        double vol = v956Finite(m.volumeRatio) ? m.volumeRatio : 1.0;
        double buy = v956Finite(m.takerBuyPct) ? m.takerBuyPct : 50.0;
        double sell = v956Finite(m.takerSellPct) ? m.takerSellPct : 50.0;
        double bid = v956Finite(m.bidPct) ? m.bidPct : 50.0;
        double ask = v956Finite(m.askPct) ? m.askPct : 50.0;
        double funding = v956Finite(m.fundingRate) ? m.fundingRate : 0.0;

        int bull = 0, bear = 0;
        if (cvd > 0) bull += 18; else if (cvd < 0) bear += 18;
        if (buy >= 52.0) bull += 14;
        if (sell >= 52.0) bear += 14;
        if (bid >= 53.0) bull += 10;
        if (ask >= 53.0) bear += 10;

        if (oi >= 0.20) {
            if (px >= 0.0) bull += 14; else bear += 14;
        } else if (oi <= -0.20) {
            // OI falling is position closure, not fresh directional conviction.
            if (px > 0.15) bull += 8;
            else if (px < -0.15) bear += 8;
        }

        if (funding <= -0.03) bull += 6; // crowded shorts / squeeze fuel proxy
        if (funding >= 0.03) bear += 6;  // crowded longs / downside flush proxy

        long prevBitsKey = prefs.getLong("v956_cvd_bits_" + symbol, Long.MIN_VALUE);
        if (prevBitsKey != Long.MIN_VALUE && v956Finite(cvd)) {
            double prevCvd = Double.longBitsToDouble(prevBitsKey);
            if (v956Finite(prevCvd)) {
                double accel = cvd - prevCvd;
                double gate = Math.max(1000.0, Math.abs(cvd) * 0.05);
                if (accel > gate) bull += 7;
                else if (accel < -gate) bear += 7;
            }
        }
        if (v956Finite(cvd))
            prefs.edit().putLong("v956_cvd_bits_" + symbol, Double.doubleToRawLongBits(cvd)).apply();

        // Passive absorption proxies: aggressive flow is one-sided but price
        // fails to travel in that direction while opposite book liquidity holds.
        boolean buyAbsorption = Math.abs(px) <= 0.40 && cvd < 0.0
                && (bid >= 53.0 || sell >= 52.0) && vol >= 0.90;
        boolean sellAbsorption = Math.abs(px) <= 0.40 && cvd > 0.0
                && (ask >= 53.0 || buy >= 52.0) && vol >= 0.90;
        if (buyAbsorption) bull += 22;
        if (sellAbsorption) bear += 22;

        int bullClues = (cvd > 0 ? 1 : 0) + (oi > 0.15 ? 1 : 0)
                + (buy >= 52.0 ? 1 : 0) + (bid >= 53.0 ? 1 : 0);
        int bearClues = (cvd < 0 ? 1 : 0) + (oi > 0.15 ? 1 : 0)
                + (sell >= 52.0 ? 1 : 0) + (ask >= 53.0 ? 1 : 0);
        boolean hiddenAccum = Math.abs(px) <= 0.65 && bullClues >= 3;
        boolean hiddenDistrib = Math.abs(px) <= 0.65 && bearClues >= 3;
        if (hiddenAccum) bull += 18;
        if (hiddenDistrib) bear += 18;

        // Position-exit proxies. OI falling + opposite aggressive flow can appear
        // before the price expansion. This cannot identify individual traders;
        // it is deliberately labelled as probability, never certainty.
        boolean shortExit = oi <= -0.20 && cvd > 0.0 && buy >= 51.5 && px >= -0.20;
        boolean longExit = oi <= -0.20 && cvd < 0.0 && sell >= 51.5 && px <= 0.20;
        if (shortExit) bull += 20;
        if (longExit) bear += 20;

        if (vol >= 1.20) {
            if (bull > bear) bull += 8;
            else if (bear > bull) bear += 8;
        } else if (vol < 0.55) {
            bull -= 5; bear -= 5;
        }
        bull = v956Clamp(bull);
        bear = v956Clamp(bear);

        String state;
        if (shortExit) state = "SHORT_EXIT";
        else if (longExit) state = "LONG_EXIT";
        else if (buyAbsorption) state = "BUY_ABSORPTION";
        else if (sellAbsorption) state = "SELL_ABSORPTION";
        else if (hiddenAccum) state = "HIDDEN_ACCUM";
        else if (hiddenDistrib) state = "HIDDEN_DISTRIB";
        else if (bull >= bear + 15 && bull >= 45) state = "UP_PREP";
        else if (bear >= bull + 15 && bear >= 45) state = "DOWN_PREP";
        else state = "NEUTRAL";

        String old = prefs.getString("v956_flow_state_" + symbol, "");
        int streak = state.equals(old) ? Math.min(20, prefs.getInt("v956_flow_streak_" + symbol, 0) + 1) : 1;
        prefs.edit().putString("v956_flow_state_" + symbol, state)
                .putInt("v956_flow_streak_" + symbol, streak).apply();

        int dominant = Math.max(bull, bear);
        int confidence = Math.min(95, dominant + Math.min(12, Math.max(0, streak - 1) * 3));
        String label;
        if ("SHORT_EXIT".equals(state)) label = "🟢 SHORT ÇIKIŞ BİRİKİMİ / SQUEEZE OLASILIĞI";
        else if ("LONG_EXIT".equals(state)) label = "🔴 LONG ÇIKIŞ BİRİKİMİ / AŞAĞI BOŞALMA OLASILIĞI";
        else if ("BUY_ABSORPTION".equals(state)) label = "🟢 ALICI ABSORBSİYONU • satışlar emiliyor olabilir";
        else if ("SELL_ABSORPTION".equals(state)) label = "🔴 SATICI ABSORBSİYONU • alımlar emiliyor olabilir";
        else if ("HIDDEN_ACCUM".equals(state)) label = "🟢 GİZLİ HACİM BİRİKİMİ • yukarı hazırlık olasılığı";
        else if ("HIDDEN_DISTRIB".equals(state)) label = "🔴 GİZLİ DAĞITIM • aşağı hazırlık olasılığı";
        else if ("UP_PREP".equals(state)) label = "🟢 YUKARI HAZIRLIK BASKISI";
        else if ("DOWN_PREP".equals(state)) label = "🔴 AŞAĞI HAZIRLIK BASKISI";
        else label = "⚪ NÖTR • belirgin öncü akış yok";

        StringBuilder r = new StringBuilder();
        r.append("• ").append(label).append("\n");
        r.append("• Yukarı hazırlık: ").append(bull).append("/100  •  Aşağı hazırlık: ").append(bear).append("/100\n");
        r.append("• Kalıcılık: ").append(streak).append(" tur (~").append(streak * 15).append(" sn)  •  Güven: ").append(confidence).append("/100\n");
        r.append("• OI ").append(String.format(java.util.Locale.US, "%+.2f%%", oi))
                .append(" • CVD ").append(cvd > 0 ? "+" : "").append(String.format(java.util.Locale.US, "%.0f", cvd))
                .append(" • Taker ").append(String.format(java.util.Locale.US, "%.1f/%.1f", buy, sell))
                .append(" • Book ").append(String.format(java.util.Locale.US, "%.1f/%.1f", bid, ask)).append("\n");
        r.append("• Bu radar TAHMİN/ÖNCÜL olasılığıdır; tek başına giriş sinyali veya bildirim üretmez.");
        return r.toString();
    }
'''
if 'private String v956EarlyFlowRadar(' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.6 MonitorService closing brace missing')
    m = m[:pos] + monitor_helper + '\n' + m[pos:]
MONITOR.write_text(m)

# Analysis package wording: include the new public-flow precursors in what is
# sent to ChatGPT, without pretending that these proxies are certain.
a = ANALYSIS.read_text()
a = a.replace('ChatGPT ANALİZ PAKETİ • v9.5', 'ChatGPT ANALİZ PAKETİ • v9.5.6')
needle = 'Bu sayısal veriler yardımcı teyittir. Ana öncelik yine fiyat yapısı ve tamamlanmış 15m mum kapanışıdır.'
extra = ('Bu sayısal veriler yardımcı teyittir. Ana öncelik yine fiyat yapısı ve tamamlanmış 15m mum kapanışıdır. '
         'Ayrıca OI düşüşü + karşı yön CVD/taker akışı ile short-cover/long-exit olasılığını, fiyat yatayken CVD/OI/taker/depth ayrışması ile gizli birikim/dağıtım ve absorpsiyon olasılığını kontrol et; bunları kesinlik gibi yazma.')
if needle in a and 'short-cover/long-exit olasılığını' not in a:
    a = a.replace(needle, extra, 1)
ANALYSIS.write_text(a)

# Version bump.
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 20', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.6'", b, count=1)
BUILD.write_text(b)

mf = MAIN.read_text(); mon = MONITOR.read_text(); af = ANALYSIS.read_text(); bf = BUILD.read_text()
checks = [
    ('v9.5.6' in mf, 'title/version'),
    ('v956AddDataHealthPanel(card, p.symbol);' in mf, 'health panel wiring'),
    ('VERİ ESKİ' in mf and 'KRİTİK ALARM KİLİTLİ' in mf, 'stale UI warning'),
    ('v956_last_success_' in mon, 'service heartbeat'),
    ('v956Age > 45000L' in mon, '45s urgent stale guard'),
    ('🧭 ERKEN AKIŞ RADARI' in mon, 'flow radar panel'),
    ('SHORT ÇIKIŞ BİRİKİMİ' in mon, 'short-exit proxy'),
    ('GİZLİ HACİM BİRİKİMİ' in mon and 'GİZLİ DAĞITIM' in mon, 'hidden accumulation/distribution'),
    ('ALICI ABSORBSİYONU' in mon and 'SATICI ABSORBSİYONU' in mon, 'absorption proxies'),
    ('tek başına giriş sinyali veya bildirim üretmez' in mon, 'screen-only safety wording'),
    ('short-cover/long-exit olasılığını' in af, 'analysis prompt extension'),
    ('versionCode 20' in bf and "versionName '9.5.6'" in bf, 'version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.6 check failed: ' + msg)

print('v9.5.6 OK: 45s stale-data alarm lock + live engine heartbeat panel + early-flow/absorption/position-exit radar (screen only).')
