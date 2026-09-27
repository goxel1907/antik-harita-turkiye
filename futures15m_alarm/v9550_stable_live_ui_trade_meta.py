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
        raise SystemExit('v9.5.50 missing required generated file: ' + str(p))

m = MAIN.read_text()

for marker in (
    'V9549_FOREGROUND_UI_COHERENCE',
    'V9549_RECENT_REAL_TRADES_CARD',
    'V9548_DYNAMIC_CARD_REFRESH',
    'V9543_LIVE_ACCOUNT_POLL',
    'V9543C_SINGLE_TAP_APPROVAL',
    'v9549InstallRecentTradesCard',
):
    if marker not in m:
        raise SystemExit('v9.5.50 prerequisite missing: ' + marker)

old = '''            boolean periodic = now - v9549LastFullRefreshAt >= 15000L;
            if ((signalChanged || periodic) && v9549CanRebuildUi()) {
                v9549LastSignalFingerprint = fp;
                v9549LastFullRefreshAt = now;
                v9549RebuildPreservingScroll(signalChanged ? "signal" : "periodic");
            } else if (!signalChanged) {
                v9549LastSignalFingerprint = fp;
            }
'''
new = '''            // V9550_TARGETED_UI_REFRESH
            // Do not rebuild the entire activity on a timer. A full rebuild is
            // reserved for a real persisted signal-state change.
            if (signalChanged && v9549CanRebuildUi()) {
                v9549LastSignalFingerprint = fp;
                v9549LastFullRefreshAt = now;
                v9549RebuildPreservingScroll("signal");
            } else {
                v9549LastSignalFingerprint = fp;
            }
            try { v9550RefreshStableCards(); } catch (Throwable ignored) {}
'''
if old not in m:
    raise SystemExit('v9.5.50 periodic rebuild block missing')
m = m.replace(old, new, 1)

anchor = '            try { v9549InstallRecentTradesCard(); } catch (Throwable ignored) {}\n'
if anchor not in m:
    raise SystemExit('v9.5.50 trade-card reinstall anchor missing')
m = m.replace(anchor, anchor + '            try { v9550PostStableCards(); } catch (Throwable ignored) {}\n', 1)

snap_anchor = '''                                .putLong("v9543c_quick_approved_at_" + symbol, System.currentTimeMillis()).apply();
                        v9522PrepareOrder(symbol, side, reason, ts, entry, stop, t1, t2, t3, mg, lv);'''
snap_new = '''                                .putLong("v9543c_quick_approved_at_" + symbol, System.currentTimeMillis())
                                // V9550_ORDER_OPEN_METADATA
                                .putString("v9550_trade_margin_" + symbol, v9522P(mg))
                                .putString("v9550_trade_leverage_" + symbol, Integer.toString(lv))
                                .putString("v9550_trade_side_" + symbol, side == null ? "" : side)
                                .putLong("v9550_trade_open_ts_" + symbol, System.currentTimeMillis()).apply();
                        v9522PrepareOrder(symbol, side, reason, ts, entry, stop, t1, t2, t3, mg, lv);'''
if snap_anchor not in m:
    raise SystemExit('v9.5.50 quick approval metadata anchor missing')
m = m.replace(snap_anchor, snap_new, 1)

if 'V9550_STABLE_DASHBOARD_HELPERS' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.50 MainActivity close missing')
    helpers = r'''
    // ============================================================
    // V9550_STABLE_DASHBOARD_HELPERS
    // UI-only helpers. No Binance order/cancel side effects.
    // ============================================================
    private void v9550PostStableCards() {
        try {
            android.view.View content = findViewById(android.R.id.content);
            if (content == null) return;
            long[] delays = new long[]{0L, 120L, 420L, 900L};
            for (long d : delays) {
                content.postDelayed(() -> {
                    try { v9550RefreshStableCards(); } catch (Throwable ignored) {}
                }, d);
            }
        } catch (Throwable ignored) {}
    }

    private void v9550RefreshStableCards() {
        try { v9527RefreshTopText(); } catch (Throwable ignored) {}
        try { v9540EnsureRadarCard(); } catch (Throwable ignored) {}
        try { v9542EnsureAttentionCard(); } catch (Throwable ignored) {}
        try { v9548RefreshDynamicCards(); } catch (Throwable ignored) {}
        try { v9549InstallRecentTradesCard(); } catch (Throwable ignored) {}
        try { v9550NormalizeRecentTradeCardPosition(); } catch (Throwable ignored) {}
    }

    private void v9550NormalizeRecentTradeCardPosition() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        android.view.View trade = null;
        int portfolio = -1;
        for (int i = 0; i < root.getChildCount(); i++) {
            android.view.View c = root.getChildAt(i);
            Object tag = c.getTag();
            if (tag != null && "v9549_recent_real_trades".equals(String.valueOf(tag))) trade = c;
            String t = v9544FlatText(c);
            if (portfolio < 0 && t.contains("PORTFÖY / 24 SAAT")) portfolio = i;
        }
        if (trade == null || portfolio < 0) return;
        int wanted = Math.min(portfolio + 1, root.getChildCount() - 1);
        int current = root.indexOfChild(trade);
        if (current == wanted) return;
        android.view.ViewGroup.LayoutParams oldLp = trade.getLayoutParams();
        root.removeView(trade);
        int idx = Math.min(portfolio + 1, root.getChildCount());
        if (oldLp instanceof android.widget.LinearLayout.LayoutParams)
            root.addView(trade, idx, oldLp);
        else
            root.addView(trade, idx);
    }

    private void v9550EnrichTradeRow(V9549TradeRow r) {
        if (r == null || r.symbol == null || r.symbol.isEmpty()) return;
        try {
            android.content.SharedPreferences sp = v9522Prefs();
            if (Double.isNaN(r.margin) || r.margin <= 0.0) {
                double x = v9549Number(sp.getString("v9550_trade_margin_" + r.symbol, ""));
                if (!Double.isNaN(x) && x > 0.0) r.margin = x;
            }
            if (Double.isNaN(r.leverage) || r.leverage <= 0.0) {
                double x = v9549Number(sp.getString("v9550_trade_leverage_" + r.symbol, ""));
                if (!Double.isNaN(x) && x > 0.0) r.leverage = x;
            }
            if (r.side == null || r.side.isEmpty()) {
                String s = sp.getString("v9550_trade_side_" + r.symbol, "");
                if (s != null && !s.trim().isEmpty())
                    r.side = s.trim().toUpperCase(java.util.Locale.US);
            }
            if (Double.isNaN(r.roi) && !Double.isNaN(r.pnl)
                    && !Double.isNaN(r.margin) && r.margin > 0.0)
                r.roi = (r.pnl / r.margin) * 100.0;
        } catch (Throwable ignored) {}
    }
'''
    m = m[:pos] + helpers + '\n' + m[pos:]

row_anchor = '        for (V9549TradeRow r : rows) {\n            StringBuilder x = new StringBuilder();'
row_new = '        for (V9549TradeRow r : rows) {\n            // V9550_ENRICH_TRADE_ROW\n            v9550EnrichTradeRow(r);\n            StringBuilder x = new StringBuilder();'
if row_anchor not in m:
    raise SystemExit('v9.5.50 recent row display anchor missing')
m = m.replace(row_anchor, row_new, 1)

old_margin = 'x.append("\\nMarj: ").append(Double.isNaN(r.margin) ? "—" : String.format(java.util.Locale.US,"%.2f USDT",r.margin));'
new_margin = 'x.append("\\nMarj: ").append((Double.isNaN(r.margin) || r.margin <= 0.0) ? "—" : String.format(java.util.Locale.US,"%.2f USDT",r.margin));'
if old_margin not in m:
    raise SystemExit('v9.5.50 margin display anchor missing')
m = m.replace(old_margin, new_margin, 1)

dyn = '''                    v9544InstallCoinNavigator();
                    v9545InstallTopOverlay();'''
dyn_new = '''                    v9544InstallCoinNavigator();
                    v9545InstallTopOverlay();
                    // V9550_DYNAMIC_REINSTALL_REAL_TRADES
                    try { v9549InstallRecentTradesCard(); } catch (Throwable ignored) {}
                    try { v9550NormalizeRecentTradeCardPosition(); } catch (Throwable ignored) {}'''
if dyn not in m:
    raise SystemExit('v9.5.50 v9548 dynamic helper anchor missing')
m = m.replace(dyn, dyn_new, 1)

m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.50', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.50  •  MANUEL PRO', m)
MAIN.write_text(m)

for p in (MON, ANALYSIS, RADAR, ENGINE):
    s = p.read_text()
    s = s.replace('v9.5.49', 'v9.5.50').replace('V9.5.49', 'V9.5.50')
    p.write_text(s)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091314', bf, count=1)
bf = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.50'", bf, count=1)
BUILD.write_text(bf)

out = MAIN.read_text()
checks = {
    'targeted refresh': 'V9550_TARGETED_UI_REFRESH' in out and 'signalChanged && v9549CanRebuildUi()' in out,
    'no periodic full rebuild': 'signalChanged || periodic' not in out,
    'stable cards': 'V9550_STABLE_DASHBOARD_HELPERS' in out and 'v9550NormalizeRecentTradeCardPosition' in out,
    'trade metadata': 'V9550_ORDER_OPEN_METADATA' in out and 'v9550_trade_margin_' in out,
    'trade enrichment': 'V9550_ENRICH_TRADE_ROW' in out and '(r.pnl / r.margin) * 100.0' in out,
    'zero margin hidden': 'r.margin <= 0.0' in out,
    'dynamic trade reinstall': 'V9550_DYNAMIC_REINSTALL_REAL_TRADES' in out,
    'real virtual separation retained': 'if (key.startsWith("v9518_")) continue' in out,
    'signal persistence retained': 'v9543b_strict_ticket_' in out,
    'late entry retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in out,
    'version main': 'v9.5.50' in out,
    'version build': 'versionCode 26091314' in BUILD.read_text() and "versionName '9.5.50'" in BUILD.read_text(),
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.50 sanity failed: ' + ', '.join(bad))

a = out.find('V9550_STABLE_DASHBOARD_HELPERS')
ui = out[a:] if a >= 0 else ''
for forbidden in ('/fapi/v1/order', 'STOP_MARKET', 'TAKE_PROFIT_MARKET', 'cancelOrder'):
    if forbidden in ui:
        raise SystemExit('v9.5.50 stable UI helper contains trading side effect: ' + forbidden)

print('v9.5.50 OK: timer-driven full redraw removed; dynamic cards remain stable; recent real trades keep starting-margin metadata and derive ROI when supported.')
