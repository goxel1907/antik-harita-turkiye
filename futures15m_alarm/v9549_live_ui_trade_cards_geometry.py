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
        raise SystemExit('v9.5.49 missing required generated file: ' + str(p))


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


m = MAIN.read_text()
for marker in (
    'V9548_DYNAMIC_CARD_REFRESH',
    'V9543_LIVE_ACCOUNT_POLL',
    'v9527RefreshTopText',
    'v9527InstallTopDashboard',
    'v9518_signal_time_',
    'V9544_COIN_JUMP_NAV',
    'v9540EnsureRadarCard',
    'v9542EnsureAttentionCard',
):
    if marker not in m:
        raise SystemExit('v9.5.49 prerequisite missing in MainActivity: ' + marker)

# ---------------------------------------------------------------------------
# 1) FOREGROUND UI COHERENCE
# Existing account polling is kept authoritative. This layer only refreshes
# visible UI from already-persisted state and performs a full, scroll-preserving
# redraw at the normal 15-second monitor cadence, plus immediately when the
# persisted signal state changes. No order endpoint is called here.
# ---------------------------------------------------------------------------
if 'V9549_FOREGROUND_UI_COHERENCE' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.49 MainActivity closing brace missing')
    helpers = r'''

    // ============================================================
    // V9549_FOREGROUND_UI_COHERENCE
    // MainActivity must not require process/activity restart to reflect a new
    // signal, an account reconciliation, a closed position or refreshed cards.
    // UI-only: no send/cancel/order side effects.
    // ============================================================
    private final android.os.Handler v9549UiHandler =
            new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean v9549UiLoopRunning = false;
    private boolean v9549UiRebuilding = false;
    private long v9549LastSignalFingerprint = Long.MIN_VALUE;
    private long v9549LastFullRefreshAt = 0L;

    private final Runnable v9549UiLoop = new Runnable() {
        @Override public void run() {
            if (!v9549UiLoopRunning) return;
            try { v9527RefreshTopText(); } catch (Throwable ignored) {}
            try { v9549RefreshRecentTradesCard(); } catch (Throwable ignored) {}
            try { v9540EnsureRadarCard(); } catch (Throwable ignored) {}
            try { v9542EnsureAttentionCard(); } catch (Throwable ignored) {}

            long fp = v9549SignalFingerprint();
            long now = System.currentTimeMillis();
            boolean signalChanged = v9549LastSignalFingerprint != Long.MIN_VALUE
                    && fp != v9549LastSignalFingerprint;
            if (v9549LastSignalFingerprint == Long.MIN_VALUE) v9549LastSignalFingerprint = fp;

            boolean periodic = now - v9549LastFullRefreshAt >= 15000L;
            if ((signalChanged || periodic) && v9549CanRebuildUi()) {
                v9549LastSignalFingerprint = fp;
                v9549LastFullRefreshAt = now;
                v9549RebuildPreservingScroll(signalChanged ? "signal" : "periodic");
            } else if (!signalChanged) {
                v9549LastSignalFingerprint = fp;
            }
            v9549UiHandler.postDelayed(this, 1500L);
        }
    };

    private void v9549StartUiLoop() {
        v9549UiLoopRunning = true;
        v9549UiHandler.removeCallbacks(v9549UiLoop);
        v9549LastSignalFingerprint = v9549SignalFingerprint();
        v9549LastFullRefreshAt = System.currentTimeMillis();
        try { v9527RefreshTopText(); } catch (Throwable ignored) {}
        try { v9549InstallRecentTradesCard(); } catch (Throwable ignored) {}
        // Returning from Binance/background should refresh all cards once even
        // if the activity instance itself never got recreated.
        v9549UiHandler.postDelayed(() -> {
            if (v9549UiLoopRunning && v9549CanRebuildUi())
                v9549RebuildPreservingScroll("resume");
        }, 260L);
        v9549UiHandler.postDelayed(v9549UiLoop, 700L);
    }

    private void v9549StopUiLoop() {
        v9549UiLoopRunning = false;
        v9549UiHandler.removeCallbacks(v9549UiLoop);
    }

    private boolean v9549CanRebuildUi() {
        if (v9549UiRebuilding || isFinishing()) return false;
        try {
            android.view.View d = getWindow() == null ? null : getWindow().getDecorView();
            if (d != null && !d.hasWindowFocus()) return false; // dialog/menu open
            android.view.View f = getCurrentFocus();
            if (f instanceof android.widget.EditText) return false; // never interrupt typing/import
        } catch (Throwable ignored) {}
        return true;
    }

    private long v9549SignalFingerprint() {
        long h = 1469598103934665603L;
        try {
            java.util.TreeMap<String,String> rows = new java.util.TreeMap<>();
            java.util.Map<String,?> all = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).getAll();
            for (java.util.Map.Entry<String,?> e : all.entrySet()) {
                String k = e.getKey();
                if (k == null || !k.startsWith("v9518_signal_")) continue;
                // signal price/side/state/time/end/best/active/pct are stable event
                // state. v9518_live_* is intentionally excluded to avoid redraws
                // on every market tick.
                rows.put(k, String.valueOf(e.getValue()));
            }
            for (java.util.Map.Entry<String,String> e : rows.entrySet()) {
                h ^= e.getKey().hashCode(); h *= 1099511628211L;
                h ^= e.getValue().hashCode(); h *= 1099511628211L;
            }
        } catch (Throwable ignored) {}
        return h;
    }

    private void v9549RebuildPreservingScroll(String why) {
        if (v9549UiRebuilding) return;
        v9549UiRebuilding = true;
        int oldY = 0;
        try {
            android.widget.ScrollView old = v9544MainScroll();
            if (old != null) oldY = old.getScrollY();
        } catch (Throwable ignored) {}
        final int restoreY = Math.max(0, oldY);
        try {
            setContentView(buildUi());
            try { v9527InstallTopDashboard(); } catch (Throwable ignored) {}
            try { v9527RefreshTopText(); } catch (Throwable ignored) {}
            try { v9540EnsureRadarCard(); } catch (Throwable ignored) {}
            try { v9542EnsureAttentionCard(); } catch (Throwable ignored) {}
            try { v9548RefreshDynamicCards(); } catch (Throwable ignored) {}
            try { v9549InstallRecentTradesCard(); } catch (Throwable ignored) {}
            Runnable restore = () -> {
                try {
                    android.widget.ScrollView sv = v9544MainScroll();
                    if (sv != null) sv.scrollTo(0, Math.min(restoreY,
                            Math.max(0, sv.getChildAt(0).getHeight() - sv.getHeight())));
                } catch (Throwable ignored) {}
            };
            v9549UiHandler.postDelayed(restore, 90L);
            v9549UiHandler.postDelayed(restore, 420L);
            v9549UiHandler.postDelayed(() -> {
                try { v9549InstallRecentTradesCard(); } catch (Throwable ignored) {}
                v9549UiRebuilding = false;
            }, 700L);
        } catch (Throwable ex) {
            v9549UiRebuilding = false;
        }
    }

    // ============================================================
    // V9549_RECENT_REAL_TRADES_CARD
    // Reads only local account/trade reconciliation records already stored by
    // the app. v9518 virtual-signal history is explicitly excluded so a virtual
    // result can never be presented as a real Binance trade.
    // ============================================================
    private static final class V9549TradeRow {
        String symbol = "";
        String side = "";
        String status = "";
        double margin = Double.NaN;
        double leverage = Double.NaN;
        double roi = Double.NaN;
        double pnl = Double.NaN;
        long ts = 0L;
        int quality = 0;
    }

    private String v9549Upper(Object x) {
        return x == null ? "" : String.valueOf(x).trim().toUpperCase(java.util.Locale.US);
    }

    private double v9549Number(Object x) {
        if (x == null) return Double.NaN;
        try {
            String s = String.valueOf(x).trim().replace("%", "").replace(',', '.');
            if (s.isEmpty() || "NULL".equalsIgnoreCase(s)) return Double.NaN;
            return Double.parseDouble(s);
        } catch (Throwable ignored) { return Double.NaN; }
    }

    private String v9549Symbol(Object x) {
        String s = v9549Upper(x).replaceAll("[^A-Z0-9]", "");
        if (!s.endsWith("USDT") || s.length() < 5 || s.length() > 28) return "";
        return s;
    }

    private String v9549Status(String raw) {
        String u = v9549Upper(raw);
        if (u.contains("CLOSED") || u.contains("CLOSE") || u.contains("KAPALI") || u.contains("CLOSED_BY")) return "KAPALI";
        if (u.contains("OPEN") || u.contains("ACTIVE") || u.contains("AÇIK") || u.contains("ACIK")) return "AÇIK";
        return raw == null ? "" : raw.trim();
    }

    private V9549TradeRow v9549JsonRow(org.json.JSONObject o) {
        V9549TradeRow r = new V9549TradeRow();
        try {
            java.util.Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next(); Object v = o.opt(k);
                if (v == null || v == org.json.JSONObject.NULL) continue;
                String q = k == null ? "" : k.toLowerCase(java.util.Locale.US).replace("_", "");
                if (r.symbol.isEmpty() && (q.equals("symbol") || q.equals("sym") || q.endsWith("symbol")))
                    r.symbol = v9549Symbol(v);
                else if (q.equals("side") || q.equals("direction")) r.side = v9549Upper(v);
                else if (q.contains("leverage") || q.equals("lev")) r.leverage = v9549Number(v);
                else if (q.contains("margin") && !q.contains("ratio")) {
                    double z = v9549Number(v); if (!Double.isNaN(z) && z >= 0) r.margin = z;
                } else if (q.equals("roi") || q.contains("roipct") || q.equals("roe") || q.contains("returnpct"))
                    r.roi = v9549Number(v);
                else if ((q.contains("pnl") && !q.contains("unrealized")) || q.equals("profit") || q.equals("netprofit"))
                    r.pnl = v9549Number(v);
                else if (q.equals("status") || q.equals("state") || q.contains("closereason"))
                    r.status = v9549Status(String.valueOf(v));
                else if (q.equals("closed") && v instanceof Boolean && ((Boolean)v)) r.status = "KAPALI";
                if (q.contains("time") || q.endsWith("at")) {
                    double z = v9549Number(v);
                    if (!Double.isNaN(z) && z > 1000000000000L) r.ts = Math.max(r.ts, (long)z);
                }
            }
        } catch (Throwable ignored) {}
        if (!r.symbol.isEmpty()) {
            if (!Double.isNaN(r.pnl)) r.quality += 3;
            if (!Double.isNaN(r.roi)) r.quality += 2;
            if (!Double.isNaN(r.margin)) r.quality++;
            if (!Double.isNaN(r.leverage)) r.quality++;
            if (!r.status.isEmpty()) r.quality++;
        }
        return r;
    }

    private void v9549ScanJson(Object node, java.util.ArrayList<V9549TradeRow> out, int depth) {
        if (node == null || depth > 5 || out.size() > 80) return;
        try {
            if (node instanceof org.json.JSONObject) {
                org.json.JSONObject o = (org.json.JSONObject) node;
                V9549TradeRow r = v9549JsonRow(o);
                if (!r.symbol.isEmpty() && r.quality >= 2) out.add(r);
                java.util.Iterator<String> it = o.keys();
                while (it.hasNext()) {
                    Object v = o.opt(it.next());
                    if (v instanceof org.json.JSONObject || v instanceof org.json.JSONArray)
                        v9549ScanJson(v, out, depth + 1);
                }
            } else if (node instanceof org.json.JSONArray) {
                org.json.JSONArray a = (org.json.JSONArray) node;
                for (int i = 0; i < a.length() && i < 80; i++) v9549ScanJson(a.opt(i), out, depth + 1);
            }
        } catch (Throwable ignored) {}
    }

    private V9549TradeRow v9549TextRow(String s) {
        V9549TradeRow r = new V9549TradeRow();
        if (s == null) return r;
        String u = s.toUpperCase(java.util.Locale.US);
        try {
            java.util.regex.Matcher sm = java.util.regex.Pattern.compile("(?<![A-Z0-9])([A-Z0-9]{2,20}USDT)(?![A-Z0-9])").matcher(u);
            if (sm.find()) r.symbol = sm.group(1);
            java.util.regex.Matcher roi = java.util.regex.Pattern.compile("(?:ROI|ROE)\\s*[:=]?\\s*([+-]?[0-9]+(?:[.,][0-9]+)?)\\s*%").matcher(u);
            if (roi.find()) r.roi = v9549Number(roi.group(1));
            java.util.regex.Matcher pnl = java.util.regex.Pattern.compile("(?:REALIZED\\s*PNL|REALIZEDPNL|PNL|NET\\s*REALIZED|NET)\\s*(?:\\(USDT\\))?\\s*[:=]?\\s*([+-]?[0-9]+(?:[.,][0-9]+)?)").matcher(u);
            if (pnl.find()) r.pnl = v9549Number(pnl.group(1));
            java.util.regex.Matcher mar = java.util.regex.Pattern.compile("(?:MARGIN|MARJ|BAŞLANGIÇ\\s*MARJI|BASLANGIC\\s*MARJI)\\s*[:=]?\\s*([0-9]+(?:[.,][0-9]+)?)").matcher(u);
            if (mar.find()) r.margin = v9549Number(mar.group(1));
            java.util.regex.Matcher lev = java.util.regex.Pattern.compile("(?<![0-9])([1-9][0-9]{0,2})\\s*[Xx](?![A-Z])").matcher(s);
            if (lev.find()) r.leverage = v9549Number(lev.group(1));
            if (u.contains("SHORT") || u.contains(" SELL")) r.side = "SHORT";
            else if (u.contains("LONG") || u.contains(" BUY")) r.side = "LONG";
            r.status = v9549Status(u);
        } catch (Throwable ignored) {}
        if (!r.symbol.isEmpty()) {
            if (!Double.isNaN(r.pnl)) r.quality += 3;
            if (!Double.isNaN(r.roi)) r.quality += 2;
            if (!Double.isNaN(r.margin)) r.quality++;
            if (!Double.isNaN(r.leverage)) r.quality++;
            if (!r.status.isEmpty()) r.quality++;
        }
        return r;
    }

    private java.util.ArrayList<V9549TradeRow> v9549RecentTradeRows() {
        java.util.ArrayList<V9549TradeRow> raw = new java.util.ArrayList<>();
        try {
            java.util.Map<String,?> all = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).getAll();
            for (java.util.Map.Entry<String,?> e : all.entrySet()) {
                String key = e.getKey() == null ? "" : e.getKey();
                if (key.startsWith("v9518_")) continue; // virtual signal store != real trade
                Object value = e.getValue();
                if (!(value instanceof String)) continue;
                String s = ((String)value).trim();
                if (s.isEmpty() || !s.toUpperCase(java.util.Locale.US).contains("USDT")) continue;
                String kl = key.toLowerCase(java.util.Locale.US);
                String su = s.toUpperCase(java.util.Locale.US);
                boolean tradeLike = kl.contains("trade") || kl.contains("position") || kl.contains("order") ||
                        kl.startsWith("v9527") || kl.startsWith("v9528") || kl.startsWith("v9529") ||
                        su.contains("PNL") || su.contains("ROI") || su.contains("LEVERAGE") || su.contains("MARGIN") || su.contains("MARJ");
                if (!tradeLike) continue;
                try {
                    if (s.startsWith("{")) v9549ScanJson(new org.json.JSONObject(s), raw, 0);
                    else if (s.startsWith("[")) v9549ScanJson(new org.json.JSONArray(s), raw, 0);
                } catch (Throwable ignored) {}
                V9549TradeRow t = v9549TextRow(s);
                if (!t.symbol.isEmpty() && t.quality >= 2) raw.add(t);
            }
        } catch (Throwable ignored) {}

        // Merge partial records for the same symbol/status; prefer richer/newer data.
        java.util.LinkedHashMap<String,V9549TradeRow> merged = new java.util.LinkedHashMap<>();
        for (V9549TradeRow r : raw) {
            if (r == null || r.symbol.isEmpty()) continue;
            String k = r.symbol + "|" + (r.status == null ? "" : r.status);
            V9549TradeRow old = merged.get(k);
            if (old == null || r.quality > old.quality || r.ts > old.ts) merged.put(k, r);
        }
        java.util.ArrayList<V9549TradeRow> out = new java.util.ArrayList<>(merged.values());
        java.util.Collections.sort(out, (x,y) -> {
            if (x.ts != y.ts) return x.ts < y.ts ? 1 : -1;
            return Integer.compare(y.quality, x.quality);
        });
        if (out.size() > 4) return new java.util.ArrayList<>(out.subList(0, 4));
        return out;
    }

    private String v9549Fmt(double v, String suffix) {
        if (Double.isNaN(v)) return "—";
        return String.format(java.util.Locale.US, "%+.2f%s", v, suffix == null ? "" : suffix);
    }

    private void v9549FillRecentTradesCard(android.widget.LinearLayout box) {
        if (box == null) return;
        box.removeAllViews();
        android.widget.TextView head = text("💼 CANLI / SON GERÇEK İŞLEMLER", 14f,
                android.graphics.Color.WHITE, true);
        box.addView(head, new android.widget.LinearLayout.LayoutParams(-1,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        java.util.ArrayList<V9549TradeRow> rows = v9549RecentTradeRows();
        if (rows.isEmpty()) {
            android.widget.TextView empty = text("Binance/app işlem kayıtları senkronize oldukça burada coin • marj • kaldıraç • ROI • PnL görünür. Ayrıntı için üstteki PORTFÖY kartına dokun.",
                    11.5f, android.graphics.Color.rgb(148,163,184), false);
            empty.setPadding(0, dp(5), 0, 0);
            box.addView(empty, new android.widget.LinearLayout.LayoutParams(-1,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
            return;
        }
        for (V9549TradeRow r : rows) {
            StringBuilder x = new StringBuilder();
            x.append(r.symbol);
            if (r.side != null && !r.side.isEmpty()) x.append(" • ").append(r.side);
            if (r.status != null && !r.status.isEmpty()) x.append(" • ").append(r.status);
            if (!Double.isNaN(r.pnl)) x.append(r.pnl >= 0 ? " • KÂR" : " • ZARAR");
            x.append("\nMarj: ").append(Double.isNaN(r.margin) ? "—" : String.format(java.util.Locale.US,"%.2f USDT",r.margin));
            x.append("  •  Kaldıraç: ").append(Double.isNaN(r.leverage) ? "—" : String.format(java.util.Locale.US,"%.0fx",r.leverage));
            x.append("\nROI: ").append(v9549Fmt(r.roi, "%"));
            x.append("  •  PnL: ").append(Double.isNaN(r.pnl) ? "—" : v9549Fmt(r.pnl, " USDT"));
            int bg = Double.isNaN(r.pnl) ? android.graphics.Color.rgb(22,36,51)
                    : (r.pnl >= 0 ? android.graphics.Color.rgb(20,83,45) : android.graphics.Color.rgb(127,29,29));
            android.widget.TextView tv = text(x.toString(), 12.2f, android.graphics.Color.WHITE, true);
            tv.setPadding(dp(9), dp(7), dp(9), dp(7));
            tv.setBackgroundColor(bg);
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, dp(6), 0, 0);
            box.addView(tv, lp);
        }
    }

    private void v9549InstallRecentTradesCard() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        android.widget.LinearLayout box = null;
        for (int i=0; i<root.getChildCount(); i++) {
            android.view.View c = root.getChildAt(i);
            Object tag = c.getTag();
            if (tag != null && "v9549_recent_real_trades".equals(String.valueOf(tag)) && c instanceof android.widget.LinearLayout) {
                box = (android.widget.LinearLayout)c; break;
            }
        }
        if (box == null) {
            box = new android.widget.LinearLayout(this);
            box.setTag("v9549_recent_real_trades");
            box.setOrientation(android.widget.LinearLayout.VERTICAL);
            box.setPadding(dp(12), dp(9), dp(12), dp(9));
            box.setBackgroundColor(android.graphics.Color.rgb(8,30,38));
            int at = 0;
            for (int i=0; i<root.getChildCount(); i++) {
                String t = v9544FlatText(root.getChildAt(i));
                if (t.contains("PORTFÖY / 24 SAAT")) { at = i + 1; break; }
            }
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, dp(6), 0, dp(6));
            root.addView(box, Math.min(at, root.getChildCount()), lp);
        }
        v9549FillRecentTradesCard(box);
    }

    private void v9549RefreshRecentTradesCard() {
        v9549InstallRecentTradesCard();
    }

    // ============================================================
    // V9549_PLAN_GEOMETRY_ADVISORY
    // Advisory only. It never rewrites a stop/target and never creates a new
    // hard veto. It highlights narrow structural buffers and TP1 < 1R so the
    // user/ChatGPT can repair the daily map rather than manufacture RR by
    // squeezing the stop.
    // ============================================================
    private double v9549P(String x) {
        try { return Double.parseDouble(x == null ? "" : x.trim().replace(',', '.')); }
        catch (Throwable ignored) { return Double.NaN; }
    }

    private double[] v9549Group(String raw, int n) {
        double[] z = new double[n]; java.util.Arrays.fill(z, Double.NaN);
        if (raw == null) return z;
        String s = raw.trim(); int cut = s.indexOf('=');
        if (cut >= 0) s = s.substring(cut + 1);
        String[] p = s.split(";", -1);
        for (int i=0; i<n && i<p.length; i++) z[i] = v9549P(p[i]);
        return z;
    }

    private void v9549AddGeometryCheck(StringBuilder w, String name, boolean lng,
                                       double lo, double hi, double stop, double tp1) {
        if (Double.isNaN(lo) || Double.isNaN(hi) || Double.isNaN(stop) || Double.isNaN(tp1)) return;
        if (lo > hi) { double q=lo; lo=hi; hi=q; }
        if (lo <= 0 || hi <= 0 || stop <= 0 || tp1 <= 0) return;
        boolean geometry = lng ? (stop < lo && tp1 > lo) : (stop > hi && tp1 < hi);
        if (!geometry) {
            if (w.length()>0) w.append(" • ");
            w.append(name).append(": STOP/TP geometrisi yönle uyumsuz");
            return;
        }
        double zone = Math.max(1e-12, hi-lo);
        double buffer = lng ? lo-stop : stop-hi;
        if (buffer < zone * 0.15) {
            if (w.length()>0) w.append(" • ");
            w.append(name).append(": STOP tamponu çok dar (bölge genişliğinin %15'inden az)");
        }
        double rrLo = lng ? (tp1-lo)/(lo-stop) : (lo-tp1)/(stop-lo);
        double rrHi = lng ? (tp1-hi)/(hi-stop) : (hi-tp1)/(stop-hi);
        double rr = Math.min(rrLo, rrHi);
        if (!Double.isNaN(rr) && !Double.isInfinite(rr) && rr < 1.0) {
            if (w.length()>0) w.append(" • ");
            w.append(name).append(": TP1 en kötü girişte ").append(String.format(java.util.Locale.US,"%.2fR",rr)).append(" < 1R");
        }
    }

    private String v9549PlanGeometryWarning(String[] a) {
        try {
            if (a == null || a.length < 13) return "";
            double pullLo=v9549P(a[1]), pullHi=v9549P(a[2]), resLo=v9549P(a[3]), resHi=v9549P(a[4]);
            double[] lp=v9549Group(a[9],4), lb=v9549Group(a[10],6), sr=v9549Group(a[11],4), sb=v9549Group(a[12],6);
            StringBuilder w = new StringBuilder();
            v9549AddGeometryCheck(w,"LP",true,pullLo,pullHi,lp[0],lp[1]);
            if (!Double.isNaN(lb[0]) && lb[0] > 0 && !Double.isNaN(lb[1]) && lb[1] > 0)
                v9549AddGeometryCheck(w,"LB",true,lb[0],lb[1],lb[2],lb[3]);
            v9549AddGeometryCheck(w,"SR",false,resLo,resHi,sr[0],sr[1]);
            if (!Double.isNaN(sb[0]) && sb[0] > 0 && !Double.isNaN(sb[1]) && sb[1] > 0)
                v9549AddGeometryCheck(w,"SB",false,sb[0],sb[1],sb[2],sb[3]);
            return w.toString();
        } catch (Throwable ignored) { return ""; }
    }
'''
    m = m[:pos] + helpers + '\n' + m[pos:]

# Start/stop the live UI loop with Activity visibility.
b = method_bounds(m, 'protected void onResume(')
if not b:
    raise SystemExit('v9.5.49 onResume missing')
a0, _, e0 = b
body = m[a0:e0]
if 'V9549_START_UI_LOOP' not in body:
    p = body.rfind('}')
    body = body[:p] + '        // V9549_START_UI_LOOP\n        v9549StartUiLoop();\n' + body[p:]
    m = m[:a0] + body + m[e0:]

b = method_bounds(m, 'protected void onPause(')
if not b:
    raise SystemExit('v9.5.49 onPause missing')
a0, _, e0 = b
body = m[a0:e0]
if 'V9549_STOP_UI_LOOP' not in body:
    brace = body.find('{')
    body = body[:brace+1] + '\n        // V9549_STOP_UI_LOOP\n        v9549StopUiLoop();' + body[brace+1:]
    m = m[:a0] + body + m[e0:]

# Add advisory geometry validation after every successfully parsed plan line.
b = method_bounds(m, 'private void openImportDialog()')
if not b:
    raise SystemExit('v9.5.49 openImportDialog missing')
a0, _, e0 = b
imp = m[a0:e0]
if 'V9549_PLAN_GEOMETRY_IMPORT' not in imp:
    hit = re.search(r'(?m)^(\s*)success\+\+;\s*$', imp)
    if not hit:
        raise SystemExit('v9.5.49 import success++ anchor missing')
    ind = hit.group(1)
    add = (hit.group(0) + '\n' + ind + '// V9549_PLAN_GEOMETRY_IMPORT — advisory only.\n'
           + ind + 'String v9549Gw = v9549PlanGeometryWarning(a);\n'
           + ind + 'getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).edit()\n'
           + ind + '        .putString("v9549_plan_geometry_" + sym, v9549Gw).apply();')
    imp = imp[:hit.start()] + add + imp[hit.end():]
    m = m[:a0] + imp + m[e0:]

# Show the warning in each analyzed symbol card without affecting signal logic.
b = method_bounds(m, 'private void v9518AddSignalPanel(')
if not b:
    raise SystemExit('v9.5.49 v9518AddSignalPanel missing')
a0, _, e0 = b
panel = m[a0:e0]
if 'V9549_PLAN_GEOMETRY_PANEL' not in panel:
    p = panel.rfind('}')
    inject = r'''        // V9549_PLAN_GEOMETRY_PANEL
        try {
            String gw = getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE)
                    .getString("v9549_plan_geometry_"+symbol,"");
            if (gw != null && !gw.trim().isEmpty()) {
                TextView g = text("⚠️ PLAN GEOMETRİ UYARISI\n" + gw +
                        "\nBu uyarı alarmı otomatik engellemez; STOP yapısal swing/likidite arkasında olmalı ve TP1 en az 1R kalmalıdır.",
                        11.5f, Color.rgb(254,240,138), true);
                g.setPadding(dp(9),dp(7),dp(9),dp(7));
                g.setBackgroundColor(Color.rgb(120,72,8));
                LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
                gp.setMargins(0,dp(6),0,dp(5)); card.addView(g,gp);
            }
        } catch (Throwable ignored) {}
'''
    panel = panel[:p] + inject + panel[p:]
    m = m[:a0] + panel + m[e0:]

m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.49', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.49  •  MANUEL PRO', m)
MAIN.write_text(m)

# Keep visible version strings aligned without touching signal/radar semantics.
for p in (MON, ANALYSIS, RADAR, ENGINE):
    s = p.read_text()
    s = s.replace('v9.5.48','v9.5.49').replace('V9.5.48','V9.5.49')
    p.write_text(s)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091313', bf, count=1)
bf = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.49'", bf, count=1)
BUILD.write_text(bf)

print('v9.5.49 patch applied: foreground UI coherence + recent real-trade mini cards + advisory plan geometry checks.')
