from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
ENGINE = JAVA / 'StructureEngine.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.16 missing: {p}')

engine = r'''package com.futuresalarm.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Deterministic OHLC structure candidate scanner.
 *
 * It does NOT create orders and it does NOT confirm trades. It maps objective
 * candidates from CLOSED candles so ChatGPT and the user do not have to infer
 * every BOS/CHoCH/FVG/OB/liquidity/Fibonacci level only from pixels.
 * A trade still requires the manual plan + completed 15m confirmation + live
 * flow filters in MonitorService.
 */
final class StructureEngine {
    private static final String[] KEYS = {"15m", "1h", "4h", "1d"};
    private static final String[] LABELS = {"15M", "1H", "4H", "1D"};

    private StructureEngine() {}

    static String analyzeAll(Map<String, List<AnalysisPackActivity.Candle>> data) {
        StringBuilder out = new StringBuilder();
        out.append("🧭 SAYISAL YAPI TARAMASI • KAPANMIŞ MUMLAR\n");
        out.append("Aday yapılar OHLC ile hesaplanır; açık mum bağlamdır, teyit değildir.\n");
        for (int i = 0; i < KEYS.length; i++) {
            Frame f = analyze(data == null ? null : data.get(KEYS[i]));
            out.append("\n").append(LABELS[i]).append("\n");
            out.append("• Yapı: ").append(f.structure).append("\n");
            out.append("• BOS: ").append(f.bos).append("   CHoCH: ").append(f.choch).append("\n");
            out.append("• FVG: ").append(f.fvg).append("\n");
            out.append("• Order Block: ").append(f.ob).append("\n");
            out.append("• Breaker/Mitigation: ").append(f.breaker).append("\n");
            out.append("• EQH/EQL: ").append(f.eqh).append(" / ").append(f.eql).append("\n");
            out.append("• Likidite: BSL ").append(f.bsl).append("   SSL ").append(f.ssl).append("\n");
            out.append("• Fibonacci: ").append(f.fib).append("\n");
            out.append("• Premium/Discount: ").append(f.pd).append("\n");
        }
        out.append("\nNOT: 'ADAY' etiketi otomatik geometrik tespittir. ChatGPT görselde doğrulamalı; "
                + "bariz aday varken yalnız eski META'da NONE yazdığı için yapıyı yok saymamalıdır.");
        return out.toString();
    }

    private static Frame analyze(List<AnalysisPackActivity.Candle> src) {
        Frame f = new Frame();
        if (src == null || src.size() < 12) {
            f.setNoData();
            return f;
        }

        int start = Math.max(0, src.size() - 100);
        List<AnalysisPackActivity.Candle> a = new ArrayList<>(src.subList(start, src.size()));
        int n = a.size();
        AnalysisPackActivity.Candle last = a.get(n - 1);
        double atr = atr(a, 14);
        double px = Math.max(1e-12, last.close);
        double swingTol = Math.max(px * 0.0015, atr * 0.18);

        List<Swing> highs = new ArrayList<>();
        List<Swing> lows = new ArrayList<>();
        final int strength = 2;
        for (int i = strength; i < n - strength; i++) {
            boolean hi = true, lo = true;
            double h = a.get(i).high, l = a.get(i).low;
            for (int j = i - strength; j <= i + strength; j++) {
                if (j == i) continue;
                if (a.get(j).high >= h) hi = false;
                if (a.get(j).low <= l) lo = false;
            }
            if (hi) highs.add(new Swing(i, h));
            if (lo) lows.add(new Swing(i, l));
        }

        Swing h1 = fromEnd(highs, 2), h2 = fromEnd(highs, 1);
        Swing l1 = fromEnd(lows, 2), l2 = fromEnd(lows, 1);
        double eps = 0.0008;
        boolean hh = h1 != null && h2 != null && h2.price > h1.price * (1.0 + eps);
        boolean lh = h1 != null && h2 != null && h2.price < h1.price * (1.0 - eps);
        boolean hl = l1 != null && l2 != null && l2.price > l1.price * (1.0 + eps);
        boolean ll = l1 != null && l2 != null && l2.price < l1.price * (1.0 - eps);
        if (hh && hl) f.structure = "HH-HL";
        else if (lh && ll) f.structure = "LH-LL";
        else if ((hh && ll) || (lh && hl)) f.structure = "TRANSITION/MIXED";
        else f.structure = "RANGE/MIXED";

        f.bos = "NONE_CONFIRMED";
        f.choch = "NONE_CONFIRMED";
        if (h2 != null && h2.index < n - 1 && last.close > h2.price * 1.0002) {
            f.bos = "BULL > " + p(h2.price);
            if ("LH-LL".equals(f.structure) || "TRANSITION/MIXED".equals(f.structure))
                f.choch = "BULL > " + p(h2.price);
        }
        if (l2 != null && l2.index < n - 1 && last.close < l2.price * 0.9998) {
            f.bos = "BEAR < " + p(l2.price);
            if ("HH-HL".equals(f.structure) || "TRANSITION/MIXED".equals(f.structure))
                f.choch = "BEAR < " + p(l2.price);
        }

        Gap bullGap = null, bearGap = null;
        double minGap = Math.max(px * 0.00025, atr * 0.025);
        for (int i = 2; i < n; i++) {
            double bullLow = a.get(i - 2).high;
            double bullHigh = a.get(i).low;
            if (bullHigh - bullLow > minGap) {
                Gap g = gapState(a, i, bullLow, bullHigh, true);
                if (!g.filled || bullGap == null) bullGap = g;
            }
            double bearLow = a.get(i).high;
            double bearHigh = a.get(i - 2).low;
            if (bearHigh - bearLow > minGap) {
                Gap g = gapState(a, i, bearLow, bearHigh, false);
                if (!g.filled || bearGap == null) bearGap = g;
            }
        }
        StringBuilder fvgs = new StringBuilder();
        if (bullGap != null) fvgs.append("BULL ").append(bullGap.text());
        if (bearGap != null) {
            if (fvgs.length() > 0) fvgs.append(" | ");
            fvgs.append("BEAR ").append(bearGap.text());
        }
        f.fvg = fvgs.length() == 0 ? "NONE_DETECTED" : fvgs.toString();

        Ob bullOb = null, bearOb = null;
        double avgBody = avgBody(a, 20);
        for (int i = 5; i < n; i++) {
            AnalysisPackActivity.Candle c = a.get(i);
            double body = Math.abs(c.close - c.open);
            if (body < Math.max(avgBody * 1.45, atr * 0.28)) continue;
            double prevHigh = -Double.MAX_VALUE, prevLow = Double.MAX_VALUE;
            for (int j = Math.max(0, i - 5); j < i; j++) {
                prevHigh = Math.max(prevHigh, a.get(j).high);
                prevLow = Math.min(prevLow, a.get(j).low);
            }
            if (c.close > c.open && c.close > prevHigh) {
                for (int j = i - 1; j >= Math.max(0, i - 3); j--) {
                    AnalysisPackActivity.Candle q = a.get(j);
                    if (q.close < q.open) { bullOb = obState(a, j, q.low, q.high, true); break; }
                }
            }
            if (c.close < c.open && c.close < prevLow) {
                for (int j = i - 1; j >= Math.max(0, i - 3); j--) {
                    AnalysisPackActivity.Candle q = a.get(j);
                    if (q.close > q.open) { bearOb = obState(a, j, q.low, q.high, false); break; }
                }
            }
        }
        StringBuilder obs = new StringBuilder();
        if (bullOb != null) obs.append("BULL ").append(bullOb.text());
        if (bearOb != null) {
            if (obs.length() > 0) obs.append(" | ");
            obs.append("BEAR ").append(bearOb.text());
        }
        f.ob = obs.length() == 0 ? "NONE_DETECTED" : obs.toString();

        f.breaker = breakerText(bullOb, bearOb, a);

        f.eqh = equalLevel(highs, swingTol);
        f.eql = equalLevel(lows, swingTol);
        f.bsl = liquidityLevels(highs);
        f.ssl = liquidityLevels(lows);

        Swing lastH = fromEnd(highs, 1), lastL = fromEnd(lows, 1);
        if (lastH != null && lastL != null && Math.abs(lastH.price - lastL.price) > Math.max(atr, px * 0.003)) {
            boolean up = lastH.index > lastL.index;
            double lo = Math.min(lastH.price, lastL.price);
            double hi = Math.max(lastH.price, lastL.price);
            double range = hi - lo;
            if (up) {
                f.fib = "UP 0.382=" + p(hi - range * 0.382)
                        + " 0.5=" + p(hi - range * 0.5)
                        + " 0.618=" + p(hi - range * 0.618)
                        + " 0.705=" + p(hi - range * 0.705)
                        + " 0.786=" + p(hi - range * 0.786);
            } else {
                f.fib = "DOWN 0.382=" + p(lo + range * 0.382)
                        + " 0.5=" + p(lo + range * 0.5)
                        + " 0.618=" + p(lo + range * 0.618)
                        + " 0.705=" + p(lo + range * 0.705)
                        + " 0.786=" + p(lo + range * 0.786);
            }
            double mid = (hi + lo) * 0.5;
            double eqTol = Math.max(atr * 0.10, px * 0.0008);
            f.pd = last.close > mid + eqTol ? "PREMIUM" : (last.close < mid - eqTol ? "DISCOUNT" : "EQUILIBRIUM");
        } else {
            f.fib = "IMPULSE_NOT_CLEAR";
            f.pd = "UNRESOLVED";
        }
        return f;
    }

    private static Gap gapState(List<AnalysisPackActivity.Candle> a, int formed, double low, double high, boolean bull) {
        double best = bull ? high : low;
        boolean filled = false;
        for (int j = formed + 1; j < a.size(); j++) {
            if (bull) {
                best = Math.min(best, a.get(j).low);
                if (a.get(j).low <= low) filled = true;
            } else {
                best = Math.max(best, a.get(j).high);
                if (a.get(j).high >= high) filled = true;
            }
        }
        double width = Math.max(1e-12, high - low);
        double mitigated = bull ? (high - best) / width : (best - low) / width;
        mitigated = Math.max(0, Math.min(1, mitigated));
        return new Gap(low, high, filled, mitigated);
    }

    private static Ob obState(List<AnalysisPackActivity.Candle> a, int formed, double low, double high, boolean bull) {
        boolean invalid = false;
        boolean touched = false;
        for (int j = formed + 1; j < a.size(); j++) {
            AnalysisPackActivity.Candle c = a.get(j);
            if (c.high >= low && c.low <= high) touched = true;
            if (bull && c.close < low) invalid = true;
            if (!bull && c.close > high) invalid = true;
        }
        return new Ob(formed, low, high, bull, touched, invalid);
    }

    private static String breakerText(Ob bull, Ob bear, List<AnalysisPackActivity.Candle> a) {
        List<String> out = new ArrayList<>();
        if (bull != null && bull.invalid && retestedAfterBreak(bull, a))
            out.add("BEAR BREAKER ADAY " + p(bull.low) + "-" + p(bull.high));
        if (bear != null && bear.invalid && retestedAfterBreak(bear, a))
            out.add("BULL BREAKER ADAY " + p(bear.low) + "-" + p(bear.high));
        if (out.isEmpty()) return "NONE_DETECTED";
        return join(out, " | ");
    }

    private static boolean retestedAfterBreak(Ob ob, List<AnalysisPackActivity.Candle> a) {
        boolean broken = false;
        for (int j = ob.index + 1; j < a.size(); j++) {
            AnalysisPackActivity.Candle c = a.get(j);
            if (!broken) {
                if (ob.bull && c.close < ob.low) broken = true;
                if (!ob.bull && c.close > ob.high) broken = true;
            } else if (c.high >= ob.low && c.low <= ob.high) {
                return true;
            }
        }
        return false;
    }

    private static String equalLevel(List<Swing> s, double tol) {
        int from = Math.max(0, s.size() - 7);
        Swing bestA = null, bestB = null;
        for (int i = from; i < s.size(); i++) {
            for (int j = i + 1; j < s.size(); j++) {
                if (Math.abs(s.get(i).price - s.get(j).price) <= tol) {
                    bestA = s.get(i); bestB = s.get(j);
                }
            }
        }
        if (bestA == null) return "NONE_DETECTED";
        return p((bestA.price + bestB.price) * 0.5) + " ADAY";
    }

    private static String liquidityLevels(List<Swing> s) {
        if (s.isEmpty()) return "NONE_DETECTED";
        StringBuilder b = new StringBuilder();
        int from = Math.max(0, s.size() - 3);
        for (int i = s.size() - 1; i >= from; i--) {
            if (b.length() > 0) b.append(" / ");
            b.append(p(s.get(i).price));
        }
        return b.toString();
    }

    private static double atr(List<AnalysisPackActivity.Candle> a, int period) {
        int from = Math.max(1, a.size() - period);
        double sum = 0; int n = 0;
        for (int i = from; i < a.size(); i++) {
            AnalysisPackActivity.Candle c = a.get(i), prev = a.get(i - 1);
            double tr = Math.max(c.high - c.low, Math.max(Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
            sum += tr; n++;
        }
        return n == 0 ? 0 : sum / n;
    }

    private static double avgBody(List<AnalysisPackActivity.Candle> a, int period) {
        int from = Math.max(0, a.size() - period);
        double sum = 0; int n = 0;
        for (int i = from; i < a.size(); i++) { sum += Math.abs(a.get(i).close - a.get(i).open); n++; }
        return n == 0 ? 0 : sum / n;
    }

    private static Swing fromEnd(List<Swing> s, int back) {
        int i = s.size() - back;
        return i >= 0 && i < s.size() ? s.get(i) : null;
    }

    private static String p(double v) {
        if (v >= 1000) return String.format(Locale.US, "%.2f", v);
        if (v >= 100) return String.format(Locale.US, "%.3f", v);
        if (v >= 1) return String.format(Locale.US, "%.4f", v);
        if (v >= 0.1) return String.format(Locale.US, "%.5f", v);
        if (v >= 0.01) return String.format(Locale.US, "%.6f", v);
        return String.format(Locale.US, "%.8f", v);
    }

    private static String join(List<String> x, String sep) {
        StringBuilder b = new StringBuilder();
        for (String s : x) { if (b.length() > 0) b.append(sep); b.append(s); }
        return b.toString();
    }

    private static final class Swing {
        final int index; final double price;
        Swing(int index, double price) { this.index = index; this.price = price; }
    }

    private static final class Gap {
        final double low, high; final boolean filled; final double mitigated;
        Gap(double low, double high, boolean filled, double mitigated) {
            this.low = low; this.high = high; this.filled = filled; this.mitigated = mitigated;
        }
        String text() {
            return p(low) + "-" + p(high) + (filled ? " FILLED" : " ACTIVE")
                    + " • mitigasyon " + String.format(Locale.US, "%.0f%%", mitigated * 100.0);
        }
    }

    private static final class Ob {
        final int index; final double low, high; final boolean bull, touched, invalid;
        Ob(int index, double low, double high, boolean bull, boolean touched, boolean invalid) {
            this.index = index; this.low = low; this.high = high; this.bull = bull; this.touched = touched; this.invalid = invalid;
        }
        String text() {
            return p(low) + "-" + p(high) + " ADAY • " + (invalid ? "INVALIDATED" : (touched ? "MITIGATED/TOUCHED" : "UNMITIGATED"));
        }
    }

    private static final class Frame {
        String structure, bos, choch, fvg, ob, breaker, eqh, eql, bsl, ssl, fib, pd;
        void setNoData() {
            structure = bos = choch = fvg = ob = breaker = eqh = eql = bsl = ssl = fib = pd = "YETERSIZ_VERI";
        }
    }
}
'''
ENGINE.write_text(engine)

# ------------------------------------------------------------------
# Analysis package: show and share the deterministic structure map.
# ------------------------------------------------------------------
a = ANALYSIS.read_text()

# Robust version replacement regardless of the exact previous patch spelling.
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.16', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.16', a)

if 'private TextView structureView;' not in a:
    a = a.replace('    private TextView status;\n', '    private TextView status;\n    private TextView structureView;\n', 1)
if 'private String structureText;' not in a:
    a = a.replace('    private String shareText;\n', '    private String shareText;\n    private String structureText;\n', 1)

ui_anchor = '        root.addView(status);\n'
if 'SAYISAL YAPI TARAMASI paket hazırlanırken' not in a:
    if ui_anchor not in a:
        raise SystemExit('v9.5.16 status UI anchor not found')
    ui = '''        structureView = text("🧭 SAYISAL YAPI TARAMASI paket hazırlanırken burada görünecek.", 13, Color.rgb(165, 180, 205), false);\n        structureView.setPadding(dp(10), dp(10), dp(10), dp(10));\n        structureView.setBackgroundColor(Color.rgb(11, 27, 40));\n        structureView.setLineSpacing(0, 1.08f);\n        root.addView(structureView, lp(-1, -2, 0, 0, 0, 12));\n'''
    a = a.replace(ui_anchor, ui_anchor + ui, 1)

if 'structureText = null;' not in a:
    reset_anchor = '        shareText = null;\n'
    if reset_anchor not in a:
        raise SystemExit('v9.5.16 build reset anchor not found')
    a = a.replace(reset_anchor, reset_anchor + '        structureText = null;\n        if (structureView != null) structureView.setText("🧭 SAYISAL YAPI TARAMASI hazırlanıyor...");\n', 1)

if 'StructureEngine.analyzeAll(candles)' not in a:
    calc_anchor = '                List<Candle> m15 = candles.get("15m");\n'
    if calc_anchor not in a:
        raise SystemExit('v9.5.16 candle calculation anchor not found')
    calc = '''                structureText = StructureEngine.analyzeAll(candles);\n                getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).edit()\n                        .putString("v9516_structure_" + symbol, structureText).apply();\n'''
    a = a.replace(calc_anchor, calc + calc_anchor, 1)

success_anchor = '                    preview.setImageBitmap(packBitmap);\n'
if 'structureView.setText(structureText)' not in a:
    if success_anchor not in a:
        raise SystemExit('v9.5.16 success UI anchor not found')
    a = a.replace(success_anchor,
                  '                    if (structureView != null) structureView.setText(structureText == null ? "Yapı taraması hazır değil." : structureText);\n' + success_anchor,
                  1)

# Inject strict structure-first workflow into buildPrompt only.
start = a.find('    private String buildPrompt(')
end = a.find('    private String get(', start + 10)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('v9.5.16 buildPrompt boundary not found')
method = a[start:end]
if 'V9516_STRUCTURE_FIRST_PROTOCOL' not in method:
    ret = '        return sb.toString();\n'
    if ret not in method:
        raise SystemExit('v9.5.16 buildPrompt return not found')
    inject = r'''        // v9.5.16 V9516_STRUCTURE_FIRST_PROTOCOL
        sb.append("\n--- UYGULAMANIN SAYISAL YAPI TARAMASI ---\n");
        sb.append(StructureEngine.analyzeAll(data)).append("\n\n");
        sb.append("ZORUNLU ANALİZ SIRASI:\n");
        sb.append("1) Önce 15M, 1H, 4H ve 1D için AYRI AYRI yapı envanteri çıkar: swing H/L, HH-HL veya LH-LL, BOS, CHoCH, aktif/dolmuş FVG, bullish/bearish OB, breaker/mitigation, EQH/EQL, BSL/SSL, Fibonacci ve premium/discount.\n");
        sb.append("2) Uygulamanın SAYISAL YAPI TARAMASI aday haritadır; grafikte doğrula. Bariz aday varken yalnız eski META NONE diye NONE yazma. NONE ancak hem sayısal aday hem görsel kriter yoksa kullanılabilir.\n");
        sb.append("3) 4H/1H yön ve konum bağlamını, 15M tetik/retesti birlikte kullan. Açık 1H/4H/1D mum yalnız bağlamdır; kapanmış kabul edilmez. Kritik işlem teyidi yalnız TAMAMLANMIŞ 15M mumdan gelir.\n");
        sb.append("4) SETUP ancak yapı haritasından SONRA kurulur. Giriş/STOP/TP seviyelerinin hangi FVG/OB/swing/likidite/Fibonacci confluence'ına dayandığını açıkça yaz. Yapısal dayanak yoksa İŞLEM YOK.\n");
        sb.append("5) Son META alanına mümkünse TF15, TF1H, TF4H, TF1D ve CONFLUENCE anahtarlarını da ekle. META içinde | kullanma.\n\n");
'''
    method = method.replace(ret, inject + ret, 1)
    a = a[:start] + method + a[end:]

ANALYSIS.write_text(a)

# ------------------------------------------------------------------
# Main coin card: show the last deterministic structure scan separately
# from ChatGPT META so a bad/old META=NONE cannot hide the app's own map.
# ------------------------------------------------------------------
m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.16', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.16  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:', 'v9.5.16 MANUEL PRO çalışma şekli:', m)

helper = r'''

    private String v9516StructureText(String symbol) {
        return getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE)
                .getString("v9516_structure_" + symbol, "");
    }

    private void v9516AddStructurePanel(LinearLayout card, String symbol) {
        String raw = v9516StructureText(symbol);
        String body;
        int fg;
        if (raw == null || raw.trim().isEmpty()) {
            body = "🧭 UYGULAMA YAPI TARAMASI\n"
                    + "Henüz sayısal yapı haritası yok. ANALİZ PAKETİ'ni bu coin için bir kez hazırla; "
                    + "15M/1H/4H/1D BOS-CHoCH-FVG-OB-likidite-Fibonacci adayları burada saklanır.";
            fg = Color.rgb(251, 191, 36);
        } else {
            body = "🧭 UYGULAMA YAPI TARAMASI • ChatGPT META'dan bağımsız\n" + raw;
            fg = Color.rgb(203, 213, 225);
        }
        TextView t = text(body, 12, fg, false);
        t.setLineSpacing(0, 1.08f);
        t.setPadding(dp(10), dp(9), dp(10), dp(9));
        t.setBackgroundColor(Color.rgb(8, 28, 38));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, dp(6), 0, dp(7));
        card.addView(t, p);
    }
'''
if 'private void v9516AddStructurePanel' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.16 MainActivity closing brace not found')
    m = m[:pos] + helper + '\n' + m[pos:]

if 'v9516AddStructurePanel(card, p.symbol);' not in m:
    anchor = '        v95AddMetaPanel(card, p.symbol);\n'
    if anchor in m:
        m = m.replace(anchor, anchor + '        v9516AddStructurePanel(card, p.symbol);\n', 1)
    else:
        pc_start = m.find('    private View planCard(TradePlan p)')
        pc_end = m.find('    private ', pc_start + 20) if pc_start >= 0 else -1
        if pc_start < 0 or pc_end < 0:
            raise SystemExit('v9.5.16 planCard boundary not found')
        pc = m[pc_start:pc_end]
        title_anchor = '        card.addView(symbolTitle);\n'
        if title_anchor not in pc:
            raise SystemExit('v9.5.16 card title anchor not found')
        pc = pc.replace(title_anchor, title_anchor + '        v9516AddStructurePanel(card, p.symbol);\n', 1)
        m = m[:pc_start] + pc + m[pc_end:]

MAIN.write_text(m)

# ------------------------------------------------------------------
# Deterministic version bump.
# ------------------------------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 30', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.16'", b, count=1)
BUILD.write_text(b)

# Final patch guards.
af = ANALYSIS.read_text()
mf = MAIN.read_text()
bf = BUILD.read_text()
ef = ENGINE.read_text()
checks = [
    ('V9516_STRUCTURE_FIRST_PROTOCOL' in af, 'structure-first prompt protocol'),
    ('StructureEngine.analyzeAll(candles)' in af, 'deterministic structure calculation'),
    ('v9516_structure_' in af, 'structure persistence'),
    ('SAYISAL YAPI TARAMASI' in af, 'visible analysis structure panel'),
    ('v9516AddStructurePanel' in mf, 'main-card structure panel'),
    ('class StructureEngine' in ef, 'StructureEngine class'),
    ('Fair' not in '', 'sanity'),
    ("versionName '9.5.16'" in bf and 'versionCode 30' in bf, 'build version'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.16 check failed: ' + msg)

print('v9.5.16 OK: deterministic 15M/1H/4H/1D structure scanner + structure-first ChatGPT setup protocol + visible independent structure map installed.')
