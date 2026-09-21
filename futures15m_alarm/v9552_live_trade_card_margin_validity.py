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
        raise SystemExit('v9.5.52 missing required generated file: ' + str(p))


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

m = MAIN.read_text()
for marker in (
    'V9549_RECENT_REAL_TRADES_CARD',
    'V9550_ORDER_OPEN_METADATA',
    'V9550_STABLE_DASHBOARD_HELPERS',
    'V9551_VALIDITY_LIFECYCLE_UI',
    'V9543_LIVE_ACCOUNT_POLL',
    'V9543C_EXECUTION_DRIFT_RECHECK',
):
    if marker not in m:
        raise SystemExit('v9.5.52 prerequisite missing: ' + marker)

# ---------------------------------------------------------------------------
# V9552: live open-position mini cards.
# The existing signed account reconciliation remains authoritative and keeps
# local trade/account strings fresh every ~5s. This helper only READS those
# persisted snapshots. For OPEN rows it must not mistake realized=0 for live
# PnL=0. Instead it extracts the explicit open/unrealized PnL for that symbol,
# then derives ROI against the saved opening margin from v9.5.50.
# ---------------------------------------------------------------------------
if 'V9552_LIVE_OPEN_TRADE_CARD' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.52 MainActivity close missing')
    helper = r'''

    // ============================================================
    // V9552_LIVE_OPEN_TRADE_CARD
    // READ ONLY. Uses the already-reconciled local Binance/account snapshot.
    // No API request and no order/cancel side effect is performed here.
    // ============================================================
    private double v9552OpeningMargin(String symbol) {
        try {
            android.content.SharedPreferences sp = v9522Prefs();
            double x = v9549Number(sp.getString("v9550_trade_margin_" + symbol, ""));
            return (!Double.isNaN(x) && x > 0.0) ? x : Double.NaN;
        } catch (Throwable ignored) { return Double.NaN; }
    }

    private double v9552PnlFromSnapshotText(String raw) {
        if (raw == null || raw.trim().isEmpty()) return Double.NaN;
        String u = raw.toUpperCase(java.util.Locale.ROOT);
        String num = "([+-]?[0-9]+(?:[\\.,][0-9]+)?)";
        try {
            // JSON/account naming variants.
            java.util.regex.Matcher j = java.util.regex.Pattern.compile(
                    "\\\"(?:UNREALIZEDPROFIT|UNREALIZEDPNL|UNREALIZED_PNL|OPENPNL|OPEN_PNL)\\\"\\s*:\\s*\\\"?" + num,
                    java.util.regex.Pattern.CASE_INSENSITIVE).matcher(raw);
            if (j.find()) return v9549Number(j.group(1));
        } catch (Throwable ignored) {}
        try {
            // Local dashboard/trade-record text variants.
            java.util.regex.Matcher t = java.util.regex.Pattern.compile(
                    "(?:AÇIK|ACIK|OPEN|UNREALIZED)\\s*PNL(?:\\s*\\(USDT\\))?\\s*[:=]?\\s*" + num,
                    java.util.regex.Pattern.CASE_INSENSITIVE | java.util.regex.Pattern.UNICODE_CASE).matcher(u);
            if (t.find()) return v9549Number(t.group(1));
        } catch (Throwable ignored) {}
        return Double.NaN;
    }

    private int v9552SnapshotScore(String key, String raw, String symbol) {
        if (raw == null || symbol == null) return -1;
        String u = raw.toUpperCase(java.util.Locale.ROOT);
        if (!u.contains(symbol.toUpperCase(java.util.Locale.US))) return -1;
        int q = 0;
        String kl = key == null ? "" : key.toLowerCase(java.util.Locale.US);
        if (kl.startsWith("v9527") || kl.startsWith("v9528") || kl.startsWith("v9529")) q += 6;
        if (kl.contains("position") || kl.contains("trade") || kl.contains("account")) q += 3;
        if (u.contains("AÇIK PNL") || u.contains("ACIK PNL") || u.contains("OPEN PNL") || u.contains("UNREALIZED")) q += 8;
        if (u.contains("OPEN") || u.contains("AÇIK") || u.contains("ACIK")) q += 3;
        // Prefer a symbol-specific record over a portfolio summary containing
        // several USDT symbols, otherwise total portfolio PnL could leak here.
        String rest = u.replace(symbol.toUpperCase(java.util.Locale.US), "");
        if (!java.util.regex.Pattern.compile("[A-Z0-9]{2,20}USDT").matcher(rest).find()) q += 6;
        return q;
    }

    private double v9552LiveOpenPnl(String symbol) {
        double best = Double.NaN;
        int bestScore = -1;
        try {
            java.util.Map<String,?> all = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).getAll();
            for (java.util.Map.Entry<String,?> e : all.entrySet()) {
                Object v = e.getValue();
                if (!(v instanceof String)) continue;
                String raw = ((String)v).trim();
                if (raw.isEmpty()) continue;
                int score = v9552SnapshotScore(e.getKey(), raw, symbol);
                if (score < 0) continue;
                double pnl = v9552PnlFromSnapshotText(raw);
                if (Double.isNaN(pnl)) continue;
                if (score > bestScore) {
                    bestScore = score;
                    best = pnl;
                }
            }
        } catch (Throwable ignored) {}
        return best;
    }
'''
    m = m[:pos] + helper + '\n' + m[pos:]

# Replace only the recent-real-trades renderer. Parsing/reconciliation/storage
# remain untouched. Open rows use live unrealized PnL + saved opening margin;
# closed rows keep their realized historical PnL semantics.
b = method_bounds(m, 'private void v9549FillRecentTradesCard(')
if not b:
    raise SystemExit('v9.5.52 recent trade renderer missing')
a, _, e = b
new_method = r'''private void v9549FillRecentTradesCard(android.widget.LinearLayout box) {
        if (box == null) return;
        box.removeAllViews();
        android.widget.TextView head = text("💼 CANLI / SON GERÇEK İŞLEMLER", 14f,
                android.graphics.Color.WHITE, true);
        box.addView(head, new android.widget.LinearLayout.LayoutParams(-1,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        java.util.ArrayList<V9549TradeRow> rows = v9549RecentTradeRows();
        if (rows.isEmpty()) {
            android.widget.TextView empty = text("Binance/app işlem kayıtları senkronize oldukça burada coin • başlangıç marjı • kaldıraç • ROI • PnL görünür. Ayrıntı için üstteki PORTFÖY kartına dokun.",
                    11.5f, android.graphics.Color.rgb(148,163,184), false);
            empty.setPadding(0, dp(5), 0, 0);
            box.addView(empty, new android.widget.LinearLayout.LayoutParams(-1,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
            return;
        }
        for (V9549TradeRow r : rows) {
            // V9552_OPEN_ROW_AUTHORITATIVE_DISPLAY
            v9550EnrichTradeRow(r);
            boolean open = "AÇIK".equalsIgnoreCase(r.status) || "ACIK".equalsIgnoreCase(r.status) || "OPEN".equalsIgnoreCase(r.status);
            double shownMargin = r.margin;
            double shownPnl = r.pnl;
            double shownRoi = r.roi;
            if (open) {
                double opening = v9552OpeningMargin(r.symbol);
                shownMargin = opening; // never label a current-notional estimate as opening margin
                shownPnl = v9552LiveOpenPnl(r.symbol); // no realized=0 fallback for an open trade
                shownRoi = (!Double.isNaN(shownPnl) && !Double.isNaN(opening) && opening > 0.0)
                        ? (shownPnl / opening) * 100.0 : Double.NaN;
            }

            StringBuilder x = new StringBuilder();
            x.append(r.symbol);
            if (r.side != null && !r.side.isEmpty()) x.append(" • ").append(r.side);
            if (r.status != null && !r.status.isEmpty()) x.append(" • ").append(r.status);
            if (!Double.isNaN(shownPnl)) x.append(shownPnl >= 0 ? " • KÂR" : " • ZARAR");
            x.append("\n").append(open ? "Başlangıç marjı: " : "Marj: ")
                    .append((Double.isNaN(shownMargin) || shownMargin <= 0.0) ? "—" : String.format(java.util.Locale.US,"%.2f USDT",shownMargin));
            x.append("  •  Kaldıraç: ").append(Double.isNaN(r.leverage) ? "—" : String.format(java.util.Locale.US,"%.0fx",r.leverage));
            x.append("\nROI: ").append(v9549Fmt(shownRoi, "%"));
            x.append(open ? "  •  Canlı PnL: " : "  •  PnL: ")
                    .append(Double.isNaN(shownPnl) ? "—" : v9549Fmt(shownPnl, " USDT"));
            int bg = Double.isNaN(shownPnl) ? android.graphics.Color.rgb(22,36,51)
                    : (shownPnl >= 0 ? android.graphics.Color.rgb(20,83,45) : android.graphics.Color.rgb(127,29,29));
            android.widget.TextView tv = text(x.toString(), 12.2f, android.graphics.Color.WHITE, true);
            tv.setPadding(dp(9), dp(7), dp(9), dp(7));
            tv.setBackgroundColor(bg);
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, dp(6), 0, 0);
            box.addView(tv, lp);
        }
    }'''
m = m[:a] + new_method + m[e:]

# The old dashboard value is current notional/leverage style approximation,
# not guaranteed to equal Binance's UI "Margin" field. Do not call it exact
# remaining margin. Opening margin remains separately persisted and displayed.
m = m.replace('kalan marj ≈', 'pozisyon marj tahmini ≈')

# v9.5.51 used compact g/s abbreviations (gün/saat) that can be mistaken for
# seconds. Make lifecycle wording explicit and keep the 45-minute rule intact.
m = m.replace('return d + "g " + h + "s";', 'return d + " gün " + h + " saat";')
m = m.replace('return h + "s " + min + "dk";', 'return h + " saat " + min + " dk";')
m = m.replace('return Math.max(0L, min) + "dk";', 'return Math.max(0L, min) + " dk";')
m = m.replace(
    '5m re-entry 45dk penceresi doldu; yeni giriş için yeni 15m bağlam beklenir',
    '5m yeniden giriş kapalı (45 dk doldu); sinyal yalnız sonuç takibinde, yeni giriş için yeni 15m bağlam beklenir'
)
m = m.replace('5m re-entry için yaklaşık ', '5m yeniden giriş için yaklaşık ')
m = m.replace('5m re-entry süresi bilinmiyor', '5m yeniden giriş süresi bilinmiyor')

# Visible version only. No plan/trading rule is changed.
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.52', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.52  •  MANUEL PRO', m)
MAIN.write_text(m)

for p in (MON, ANALYSIS, RADAR, ENGINE):
    s = p.read_text()
    s = re.sub(r'v9\.5(?:\.\d+)*', 'v9.5.52', s)
    s = re.sub(r'V9\.5(?:\.\d+)*', 'V9.5.52', s)
    p.write_text(s)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091316', bf, count=1)
bf = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.52'", bf, count=1)
BUILD.write_text(bf)

out = MAIN.read_text()
checks = {
    'live open pnl helper': 'V9552_LIVE_OPEN_TRADE_CARD' in out and 'v9552LiveOpenPnl' in out,
    'open rows do not use realized zero fallback': 'shownPnl = v9552LiveOpenPnl(r.symbol)' in out,
    'open ROI from opening margin': '(shownPnl / opening) * 100.0' in out,
    'opening margin label': 'Başlangıç marjı:' in out,
    'live pnl label': 'Canlı PnL:' in out,
    'clear margin semantics': 'pozisyon marj tahmini ≈' in out and 'kalan marj ≈' not in out,
    'clear age units': ' gün ' in out and ' saat' in out,
    '45m lifecycle retained': '45L * 60L * 1000L' in out and '45 dk doldu' in out,
    'daily plan remains read-only': 'Günlük analizler OTOMATİK YENİLENMEZ' in out,
    'account polling retained': 'V9543_LIVE_ACCOUNT_POLL' in out and 'postDelayed(this, 5000L)' in out,
    'signal persistence retained': 'v9543b_strict_ticket_' in out,
    'late entry retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in out,
    'version main': 'v9.5.52' in out,
    'version build': 'versionCode 26091316' in BUILD.read_text() and "versionName '9.5.52'" in BUILD.read_text(),
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.52 sanity failed: ' + ', '.join(bad))

print('v9.5.52 OK: open real-trade cards use live open PnL + saved opening margin for ROI, margin wording is non-misleading, and lifecycle age units are explicit; trading/plan logic unchanged.')
