from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.44 missing required file: ' + str(p))


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
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

m = MAIN.read_text()

# Visible version.
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.44', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.44  •  MANUEL PRO', m)

# Schedule the navigator after the normal UI has been attached. Two delayed runs
# make this tolerant of the dashboard / attention / radar cards being inserted
# by their existing post-build helpers.
b = method_bounds(m, 'protected void onCreate(')
if not b:
    raise SystemExit('v9.5.44 onCreate missing')
a, _, e = b
body = m[a:e]
if 'V9544_NAV_ON_CREATE' not in body:
    anchor = 'setContentView(buildUi());'
    if anchor not in body:
        raise SystemExit('v9.5.44 setContentView(buildUi()) anchor missing')
    body = body.replace(anchor, anchor + '\n        // V9544_NAV_ON_CREATE\n        v9544ScheduleCoinNavigator();', 1)
    m = m[:a] + body + m[e:]

b = method_bounds(m, 'protected void onResume(')
if not b:
    raise SystemExit('v9.5.44 onResume missing')
a, _, e = b
body = m[a:e]
if 'V9544_NAV_ON_RESUME' not in body:
    p = body.rfind('}')
    if p < 0:
        raise SystemExit('v9.5.44 onResume close missing')
    body = body[:p] + '''        // V9544_NAV_ON_RESUME\n        v9544ScheduleCoinNavigator();\n''' + body[p:]
    m = m[:a] + body + m[e:]

if 'private void v9544InstallCoinNavigator()' not in m:
    i = m.rfind('}')
    if i < 0:
        raise SystemExit('v9.5.44 MainActivity close missing')
    helper = r'''

    // ============================================================
    // V9544_COIN_JUMP_NAV
    // Compact analyzed-coin navigator placed immediately above the app title.
    // It reads the already-rendered "İZLENEN PLANLAR" section, so radar-only
    // candidates are never mixed into the analyzed/monitored coin list.
    // ============================================================
    private void v9544ScheduleCoinNavigator() {
        try {
            android.view.View content = findViewById(android.R.id.content);
            if (content == null) return;
            content.postDelayed(() -> {
                try { v9544InstallCoinNavigator(); } catch (Throwable ignored) {}
            }, 180L);
            content.postDelayed(() -> {
                try { v9544InstallCoinNavigator(); } catch (Throwable ignored) {}
            }, 700L);
        } catch (Throwable ignored) {}
    }

    private android.widget.ScrollView v9544MainScroll() {
        try {
            android.view.ViewGroup content = findViewById(android.R.id.content);
            if (content == null || content.getChildCount() == 0) return null;
            android.view.View base = content.getChildAt(0);
            if (base instanceof android.widget.ScrollView) return (android.widget.ScrollView) base;
            if (base instanceof android.view.ViewGroup) {
                android.view.View x = v9544FindFirstScroll((android.view.ViewGroup) base);
                if (x instanceof android.widget.ScrollView) return (android.widget.ScrollView) x;
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private android.view.View v9544FindFirstScroll(android.view.ViewGroup g) {
        if (g == null) return null;
        for (int i=0; i<g.getChildCount(); i++) {
            android.view.View c = g.getChildAt(i);
            if (c instanceof android.widget.ScrollView) return c;
            if (c instanceof android.view.ViewGroup) {
                android.view.View x = v9544FindFirstScroll((android.view.ViewGroup)c);
                if (x != null) return x;
            }
        }
        return null;
    }

    private android.widget.LinearLayout v9544MainRoot() {
        android.widget.ScrollView sv = v9544MainScroll();
        if (sv == null || sv.getChildCount() == 0) return null;
        android.view.View c = sv.getChildAt(0);
        return c instanceof android.widget.LinearLayout ? (android.widget.LinearLayout)c : null;
    }

    private String v9544FlatText(android.view.View v) {
        StringBuilder b = new StringBuilder();
        v9544AppendText(v, b);
        return b.toString();
    }

    private void v9544AppendText(android.view.View v, StringBuilder b) {
        if (v == null || b == null) return;
        if (v instanceof android.widget.TextView) {
            CharSequence t = ((android.widget.TextView)v).getText();
            if (t != null && t.length() > 0) b.append(t).append('\n');
        }
        if (v instanceof android.view.ViewGroup) {
            android.view.ViewGroup g = (android.view.ViewGroup)v;
            for (int i=0; i<g.getChildCount(); i++) v9544AppendText(g.getChildAt(i), b);
        }
    }

    private boolean v9544ContainsSymbol(String text, String symbol) {
        if (text == null || symbol == null || symbol.isEmpty()) return false;
        try {
            return java.util.regex.Pattern.compile("(?<![A-Z0-9])" +
                    java.util.regex.Pattern.quote(symbol) + "(?![A-Z0-9])")
                    .matcher(text.toUpperCase(java.util.Locale.US)).find();
        } catch (Throwable ignored) {
            return text.toUpperCase(java.util.Locale.US).contains(symbol.toUpperCase(java.util.Locale.US));
        }
    }

    private void v9544ExtractSymbols(String text, java.util.LinkedHashSet<String> out) {
        if (text == null || out == null) return;
        try {
            java.util.regex.Matcher mm = java.util.regex.Pattern.compile(
                    "(?<![A-Z0-9])([A-Z0-9]{2,20}USDT)(?![A-Z0-9])")
                    .matcher(text.toUpperCase(java.util.Locale.US));
            while (mm.find() && out.size() < 24) out.add(mm.group(1));
        } catch (Throwable ignored) {}
    }

    private java.util.ArrayList<String> v9544AnalyzedSymbols(android.widget.LinearLayout root) {
        java.util.LinkedHashSet<String> out = new java.util.LinkedHashSet<>();
        if (root == null) return new java.util.ArrayList<>(out);
        int header = -1, title = -1;
        for (int i=0; i<root.getChildCount(); i++) {
            String t = v9544FlatText(root.getChildAt(i));
            if (title < 0 && t.contains("15m Futures Alarm PRO")) title = i;
            if (t.contains("İZLENEN PLANLAR") || t.contains("IZLENEN PLANLAR")) {
                header = i;
                break;
            }
        }
        if (header >= 0) {
            for (int i=header; i<root.getChildCount(); i++)
                v9544ExtractSymbols(v9544FlatText(root.getChildAt(i)), out);
        } else {
            // Fallback for old layouts where the heading is nested differently.
            int start = Math.max(0, title + 1);
            for (int i=start; i<root.getChildCount(); i++) {
                String t = v9544FlatText(root.getChildAt(i));
                boolean planLike = t.contains("SİNYAL TAKİBİ") || t.contains("CANLI TEYİT") ||
                        t.contains("GÜNLÜK PLAN") || (t.contains("PLAN") && t.contains("STOP") && t.contains("TP1"));
                if (planLike) v9544ExtractSymbols(t, out);
            }
        }
        return new java.util.ArrayList<>(out);
    }

    private int v9544TitleIndex(android.widget.LinearLayout root) {
        if (root == null) return -1;
        for (int i=0; i<root.getChildCount(); i++) {
            String t = v9544FlatText(root.getChildAt(i));
            if (t.contains("15m Futures Alarm PRO") && !t.contains("PORTFÖY / 24 SAAT")) return i;
        }
        return -1;
    }

    private void v9544InstallCoinNavigator() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;

        // Remove the old instance before rebuilding so import/delete/recreate
        // always reflects the current analyzed coin set.
        for (int i=root.getChildCount()-1; i>=0; i--) {
            android.view.View c = root.getChildAt(i);
            Object tag = c.getTag();
            if (tag != null && "v9544_coin_jump_nav".equals(String.valueOf(tag))) root.removeViewAt(i);
        }

        java.util.ArrayList<String> symbols = v9544AnalyzedSymbols(root);
        if (symbols.isEmpty()) return;
        int titleIndex = v9544TitleIndex(root);
        if (titleIndex < 0) return;

        LinearLayout box = new LinearLayout(this);
        box.setTag("v9544_coin_jump_nav");
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(8), dp(12), dp(8));
        box.setBackgroundColor(Color.rgb(10, 26, 43));

        TextView head = text("🧭 ANALİZLERE HIZLI GEÇİŞ  •  " + symbols.size() + " coin", 13.5f,
                Color.rgb(226,232,240), true);
        box.addView(head, new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView hint = text("Coine dokun → uygulama doğrudan o analiz kartına iner", 11.5f,
                Color.rgb(148,163,184), false);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.setMargins(0, dp(2), 0, dp(6));
        box.addView(hint, hp);

        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        hs.setFillViewport(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        hs.addView(row, new HorizontalScrollView.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        for (String symbol : symbols) {
            final String sym = symbol;
            Button b = new Button(this);
            String label = symbol.endsWith("USDT") && symbol.length() > 4
                    ? symbol.substring(0, symbol.length()-4) : symbol;
            b.setText(label);
            b.setAllCaps(false);
            b.setTextSize(12.5f);
            b.setTextColor(Color.WHITE);
            b.setSingleLine(true);
            b.setMinHeight(0); b.setMinimumHeight(0); b.setMinWidth(0); b.setMinimumWidth(0);
            b.setPadding(dp(12), dp(5), dp(12), dp(5));
            b.setBackgroundColor(Color.rgb(30, 64, 175));
            b.setContentDescription(symbol + " analizine git");
            b.setOnClickListener(v -> v9544ScrollToCoin(sym));
            LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, dp(38));
            bp.setMargins(0, 0, dp(7), 0);
            row.addView(b, bp);
        }
        box.addView(hs, new LinearLayout.LayoutParams(-1, dp(40)));

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(8), 0, dp(8));
        root.addView(box, Math.max(0, Math.min(titleIndex, root.getChildCount())), lp);
    }

    private android.view.View v9544FindCoinTarget(android.view.View v, String symbol) {
        if (v == null) return null;
        if (v instanceof android.widget.TextView) {
            CharSequence t = ((android.widget.TextView)v).getText();
            if (t != null && v9544ContainsSymbol(t.toString(), symbol)) return v;
        }
        if (v instanceof android.view.ViewGroup) {
            android.view.ViewGroup g = (android.view.ViewGroup)v;
            for (int i=0; i<g.getChildCount(); i++) {
                android.view.View x = v9544FindCoinTarget(g.getChildAt(i), symbol);
                if (x != null) return x;
            }
        }
        return null;
    }

    private void v9544ScrollToCoin(String symbol) {
        android.widget.ScrollView sv = v9544MainScroll();
        android.widget.LinearLayout root = v9544MainRoot();
        if (sv == null || root == null || symbol == null) return;
        int start = 0;
        for (int i=0; i<root.getChildCount(); i++) {
            String t = v9544FlatText(root.getChildAt(i));
            if (t.contains("İZLENEN PLANLAR") || t.contains("IZLENEN PLANLAR")) {
                start = i;
                break;
            }
        }
        android.view.View target = null;
        for (int i=start; i<root.getChildCount() && target==null; i++)
            target = v9544FindCoinTarget(root.getChildAt(i), symbol);
        if (target == null) {
            Toast.makeText(this, symbol + " analiz kartı bulunamadı.", Toast.LENGTH_SHORT).show();
            v9544ScheduleCoinNavigator();
            return;
        }
        try {
            int[] ty = new int[2], sy = new int[2];
            target.getLocationOnScreen(ty);
            sv.getLocationOnScreen(sy);
            int dest = Math.max(0, sv.getScrollY() + (ty[1] - sy[1]) - dp(18));
            sv.smoothScrollTo(0, dest);
        } catch (Throwable ex) {
            try { sv.smoothScrollTo(0, Math.max(0, target.getTop() - dp(18))); } catch (Throwable ignored) {}
        }
    }
'''
    m = m[:i] + helper + '\n' + m[i:]

MAIN.write_text(m)

mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.44', mon)
MON.write_text(mon)

ana = ANALYSIS.read_text()
ana = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.44', ana)
ana = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.44', ana)
ANALYSIS.write_text(ana)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091308', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.44'", bf, count=1)
BUILD.write_text(bf)

main = MAIN.read_text(); mon = MON.read_text(); ana = ANALYSIS.read_text(); bf = BUILD.read_text()
checks = {
    'navigator marker': 'V9544_COIN_JUMP_NAV' in main,
    'placed before title logic': 'v9544TitleIndex' in main and 'root.addView(box' in main,
    'analyzed plan header source': 'İZLENEN PLANLAR' in main and 'v9544AnalyzedSymbols' in main,
    'horizontal coin chips': 'HorizontalScrollView' in main and 'analizine git' in main,
    'coin jump scroll': 'v9544ScrollToCoin' in main and 'smoothScrollTo' in main,
    'refresh after resume': 'V9544_NAV_ON_RESUME' in main,
    'dashboard retained': 'PORTFÖY / 24 SAAT' in main,
    'radar retained': 'FUTURES RADAR' in main or 'v9540EnsureRadarCard' in main,
    'quick order retained': 'V9543C_SINGLE_TAP_APPROVAL' in main,
    'notification lock retained': 'v9543b_strict_ticket_' in main,
    'version code': 'versionCode 26091308' in bf,
    'version name': "versionName '9.5.44'" in bf,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.44 sanity failed: ' + ', '.join(bad))
print('v9.5.44 OK: analyzed-coin quick navigator above title; tap a coin to jump directly to its existing analysis card.')
