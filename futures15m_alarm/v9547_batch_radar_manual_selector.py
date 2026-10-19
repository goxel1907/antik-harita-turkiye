from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
SELECTOR = JAVA / 'V9547BatchSelector.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.47 missing required generated file: ' + str(p))


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


# ---------------------------------------------------------------------------
# Shared selector used from Main, Radar and Analysis Pack screens.
# Radar is discovery only; this selector never creates a trade or bypasses 15m.
# ---------------------------------------------------------------------------
selector = r'''package com.futuresalarm.app;

final class V9547BatchSelector {
    private static final int MAX_BATCH = 8;
    private static final int RADAR_LIMIT = 9;

    private V9547BatchSelector() {}

    static void show(final android.app.Activity host, String preselectRaw) {
        if (host == null) return;

        final java.util.ArrayList<String> radarSymbols = new java.util.ArrayList<>();
        final java.util.ArrayList<String> radarLabels = new java.util.ArrayList<>();
        try {
            String raw = V9538MarketRadarEngine.latestJson(host);
            org.json.JSONObject root = raw == null || raw.trim().isEmpty()
                    ? null : new org.json.JSONObject(raw);
            org.json.JSONArray rows = root == null ? null : root.optJSONArray("rows");
            if (rows != null) {
                for (int i = 0; i < rows.length() && radarSymbols.size() < RADAR_LIMIT; i++) {
                    org.json.JSONObject r = rows.optJSONObject(i);
                    if (r == null) continue;
                    String sym = normalize(r.optString("symbol", ""));
                    if (sym.isEmpty() || radarSymbols.contains(sym)) continue;
                    radarSymbols.add(sym);
                    String role = r.optString("role", "ADAY");
                    int rank = r.optInt("rank", -1);
                    String stage = r.optString("stage", "");
                    StringBuilder label = new StringBuilder(sym);
                    if (rank > 0) label.append("  •  #").append(rank);
                    if (role != null && !role.trim().isEmpty()) label.append("  •  ").append(role);
                    if (stage != null && !stage.trim().isEmpty()) label.append("  •  ").append(stage);
                    radarLabels.add(label.toString());
                }
            }
        } catch (Throwable ignored) {}

        final String preselect = normalize(preselectRaw);
        android.widget.ScrollView scroll = new android.widget.ScrollView(host);
        android.widget.LinearLayout body = new android.widget.LinearLayout(host);
        body.setOrientation(android.widget.LinearLayout.VERTICAL);
        body.setPadding(dp(host, 18), dp(host, 8), dp(host, 18), dp(host, 10));
        scroll.addView(body, new android.widget.ScrollView.LayoutParams(-1, -2));

        android.widget.TextView info = tv(host,
                "Güncel Radar listesinden işaretle veya aşağıya coinleri elle yaz. "
                        + "Eski/izlenen planlar seçim kaynağı değildir. Toplam 2–8 coin hazırlanır.",
                13f, android.graphics.Color.rgb(226,232,240), false);
        info.setLineSpacing(0, 1.08f);
        body.addView(info, new android.widget.LinearLayout.LayoutParams(-1, -2));

        android.widget.TextView selectedCount = tv(host, "Seçilen: 0 / 8", 12.5f,
                android.graphics.Color.rgb(52,211,153), true);
        android.widget.LinearLayout.LayoutParams clp = new android.widget.LinearLayout.LayoutParams(-1, -2);
        clp.setMargins(0, dp(host, 8), 0, dp(host, 4));
        body.addView(selectedCount, clp);

        android.widget.TextView radarTitle = tv(host,
                "📡 GÜNCEL FUTURES RADAR • TOP 3 + 6 güçlü aday",
                12.5f, android.graphics.Color.rgb(96,165,250), true);
        android.widget.LinearLayout.LayoutParams rtlp = new android.widget.LinearLayout.LayoutParams(-1, -2);
        rtlp.setMargins(0, dp(host, 7), 0, dp(host, 3));
        body.addView(radarTitle, rtlp);

        final java.util.ArrayList<android.widget.CheckBox> checks = new java.util.ArrayList<>();
        if (radarSymbols.isEmpty()) {
            body.addView(tv(host,
                    "Radar henüz hazır değil. Manuel coin alanı yine kullanılabilir.",
                    12f, android.graphics.Color.rgb(251,191,36), false),
                    new android.widget.LinearLayout.LayoutParams(-1, -2));
        } else {
            for (int i = 0; i < radarSymbols.size(); i++) {
                final int idx = i;
                android.widget.CheckBox cb = new android.widget.CheckBox(host);
                cb.setText(radarLabels.get(i));
                cb.setTextColor(android.graphics.Color.WHITE);
                cb.setTextSize(13f);
                cb.setPadding(dp(host, 2), dp(host, 2), dp(host, 2), dp(host, 2));
                if (!preselect.isEmpty() && preselect.equals(radarSymbols.get(i))) cb.setChecked(true);
                cb.setOnCheckedChangeListener((buttonView, isChecked) -> {
                    int count = checkedCount(checks);
                    if (isChecked && count > MAX_BATCH) {
                        buttonView.setChecked(false);
                        android.widget.Toast.makeText(host,
                                "En fazla 8 coin seçilebilir.", android.widget.Toast.LENGTH_SHORT).show();
                    }
                    selectedCount.setText("Seçilen: " + checkedCount(checks) + " / 8");
                });
                checks.add(cb);
                body.addView(cb, new android.widget.LinearLayout.LayoutParams(-1, dp(host, 40)));
            }
        }

        android.widget.TextView manualTitle = tv(host, "✍ MANUEL COİN GİRİŞİ", 12.5f,
                android.graphics.Color.rgb(52,211,153), true);
        android.widget.LinearLayout.LayoutParams mtlp = new android.widget.LinearLayout.LayoutParams(-1, -2);
        mtlp.setMargins(0, dp(host, 10), 0, dp(host, 3));
        body.addView(manualTitle, mtlp);

        final android.widget.EditText manual = new android.widget.EditText(host);
        manual.setHint("Örn: BTC, ETH, CVC, FIL  veya  BTCUSDT ETHUSDT");
        manual.setHintTextColor(android.graphics.Color.rgb(125,138,160));
        manual.setTextColor(android.graphics.Color.WHITE);
        manual.setTextSize(14f);
        manual.setMinLines(2);
        manual.setMaxLines(4);
        manual.setSingleLine(false);
        manual.setPadding(dp(host, 12), dp(host, 8), dp(host, 12), dp(host, 8));
        manual.setBackgroundColor(android.graphics.Color.rgb(18,29,48));
        if (!preselect.isEmpty() && !radarSymbols.contains(preselect)) manual.setText(preselect);
        body.addView(manual, new android.widget.LinearLayout.LayoutParams(-1, dp(host, 82)));

        android.widget.TextView hint = tv(host,
                "Radar + manuel seçimler birleştirilir; tekrar eden semboller tek sayılır. "
                        + "Radar sıralaması işlem sinyali değildir.",
                11.5f, android.graphics.Color.rgb(148,163,184), false);
        android.widget.LinearLayout.LayoutParams hlp = new android.widget.LinearLayout.LayoutParams(-1, -2);
        hlp.setMargins(0, dp(host, 5), 0, 0);
        body.addView(hint, hlp);

        final android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(host)
                .setTitle("📦 TOPLU COİN SEÇ • 2–8")
                .setView(scroll)
                .setNegativeButton("İPTAL", null)
                .setPositiveButton("PAKETLERİ HAZIRLA", null)
                .create();

        dlg.setOnShowListener(x -> dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(v -> {
                    java.util.LinkedHashSet<String> chosen = new java.util.LinkedHashSet<>();
                    for (int i = 0; i < checks.size() && i < radarSymbols.size(); i++)
                        if (checks.get(i).isChecked()) chosen.add(radarSymbols.get(i));

                    String typed = manual.getText() == null ? "" : manual.getText().toString().trim();
                    if (!typed.isEmpty()) {
                        String[] parts = typed.split("[\\s,;]+", -1);
                        for (String p : parts) {
                            String sym = normalize(p);
                            if (!sym.isEmpty()) chosen.add(sym);
                        }
                    }

                    if (chosen.size() < 2 || chosen.size() > MAX_BATCH) {
                        android.widget.Toast.makeText(host,
                                "Toplam 2–8 coin seçmelisin. Şu an: " + chosen.size(),
                                android.widget.Toast.LENGTH_LONG).show();
                        return;
                    }

                    java.util.ArrayList<String> selected = new java.util.ArrayList<>(chosen);
                    android.content.Intent in = new android.content.Intent(host, AnalysisPackActivity.class);
                    in.putStringArrayListExtra("v9545_batch_symbols", selected);
                    host.startActivity(in);
                    dlg.dismiss();
                    if (host instanceof AnalysisPackActivity) host.finish();
                }));
        dlg.show();
        selectedCount.setText("Seçilen: " + checkedCount(checks) + " / 8");
    }

    private static int checkedCount(java.util.List<android.widget.CheckBox> checks) {
        int n = 0;
        if (checks != null) for (android.widget.CheckBox c : checks) if (c != null && c.isChecked()) n++;
        return n;
    }

    private static String normalize(String raw) {
        if (raw == null) return "";
        String s = raw.toUpperCase(java.util.Locale.US).trim();
        if (s.isEmpty()) return "";
        s = s.replace("PERPETUAL", "").replace("PERP", "");
        s = s.replaceAll("[^A-Z0-9]", "");
        if (s.isEmpty() || "USDT".equals(s)) return "";
        if (!s.endsWith("USDT")) s += "USDT";
        if (s.length() < 5 || s.length() > 28) return "";
        return s;
    }

    private static android.widget.TextView tv(android.content.Context c, String s, float sp, int color, boolean bold) {
        android.widget.TextView t = new android.widget.TextView(c);
        t.setText(s); t.setTextSize(sp); t.setTextColor(color);
        if (bold) t.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
        return t;
    }

    private static int dp(android.content.Context c, int x) {
        return (int)(x * c.getResources().getDisplayMetrics().density + 0.5f);
    }
}
'''
SELECTOR.write_text(selector)


# ---------------------------------------------------------------------------
# Radar engine: TOP3 + SIX sticky candidates = 9 discovery coins.
# Candidate scoring logic itself is untouched.
# ---------------------------------------------------------------------------
e = ENGINE.read_text()
e = e.replace('candidates=stickyFive(candidates);', 'candidates=stickySix(candidates);')
e = e.replace('if (all.size() < 8) return;', 'if (all.size() < 9) return;', 1)

b = method_bounds(e, '    private java.util.ArrayList<Row> stickyFive(')
if not b:
    # Allow rerun on an already migrated source.
    b = method_bounds(e, '    private java.util.ArrayList<Row> stickySix(')
if not b:
    raise SystemExit('v9.5.47 sticky candidate method missing')
a0, _, e0 = b
sticky_six = r'''    // V9547_TOP3_PLUS_6_CANDIDATES
    private java.util.ArrayList<Row> stickySix(java.util.ArrayList<Row> ranked) {
        java.util.ArrayList<Row> sel=new java.util.ArrayList<>();
        java.util.HashMap<String,Row> by=new java.util.HashMap<>();
        for(Row r:ranked) by.put(r.t.symbol,r);
        for(String s:stickyCandidates){Row r=by.get(s);if(r!=null&&sel.size()<6)sel.add(r);}
        for(Row r:ranked){if(sel.size()>=6)break;if(!has(sel,r.t.symbol))sel.add(r);}
        for(Row c:ranked){
            if(has(sel,c.t.symbol))continue;
            int low=-1,ls=101;
            for(int i=0;i<sel.size();i++)if(sel.get(i).score<ls){ls=sel.get(i).score;low=i;}
            if(low>=0&&c.score>=ls+7)sel.set(low,c);
        }
        java.util.Collections.sort(sel,(x,y)->Integer.compare(y.score,x.score));
        stickyCandidates.clear();for(Row r:sel)stickyCandidates.add(r.t.symbol);
        return sel;
    }'''
e = e[:a0] + sticky_six + e[e0:]
e = e.replace('top-3 gainers + five sticky candidates', 'top-3 gainers + six sticky candidates')
e = re.sub(r'v9\.5(?:\.\d+)*', 'v9.5.47', e)
e = re.sub(r'V9\.5(?:\.\d+)*', 'V9.5.47', e)
ENGINE.write_text(e)


# ---------------------------------------------------------------------------
# Main screen: batch button is ALWAYS available. It no longer depends on how
# many old plans are already stored. Selection comes from current Radar/manual.
# ---------------------------------------------------------------------------
m = MAIN.read_text()
for marker in ('V9545_BATCH_ANALYSIS', 'V9546_ANALYSIS_DELETE_SHORTCUT',
               'v9543b_strict_ticket_', 'V9543C_EXECUTION_DRIFT_RECHECK'):
    if marker not in m:
        raise SystemExit('v9.5.47 prerequisite missing in MainActivity: ' + marker)

b = method_bounds(m, '    private void v9545ShowBatchAnalysisDialog()')
if not b:
    raise SystemExit('v9.5.47 main batch dialog missing')
a0, _, e0 = b
main_batch = r'''    // V9547_SHARED_BATCH_SELECTOR
    private void v9545ShowBatchAnalysisDialog() {
        V9547BatchSelector.show(this, null);
    }'''
m = m[:a0] + main_batch + m[e0:]

b = method_bounds(m, '    private void v9544InstallCoinNavigator()')
if not b:
    raise SystemExit('v9.5.47 coin navigator installer missing')
a0, _, e0 = b
nav = m[a0:e0]
if 'V9545_BATCH_BUTTON' not in nav:
    raise SystemExit('v9.5.47 batch button marker missing in navigator')
nav = nav.replace('if (symbols.size() >= 2) {', 'if (true) { // V9547_BATCH_BUTTON_ALWAYS', 1)
nav = nav.replace('📦 TOPLU ANALİZ • 2–8 COİN', '📦 TOPLU ANALİZ • RADAR / MANUEL')
nav = nav.replace('İki ile sekiz analizli coini tek ChatGPT paketinde hazırla',
                  'Radar listesinden seç veya 2–8 coini elle yaz; tek ChatGPT paketinde hazırla')
m = m[:a0] + nav + m[e0:]

m = m.replace('8 coin • TOP 3 + 5 güçlü aday', '9 coin • TOP 3 + 6 güçlü aday')
m = m.replace('8 COİN RADARI', '9 COİN RADARI').replace('TOP3 + 5 güçlü aday', 'TOP3 + 6 güçlü aday')
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.47', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.47  •  MANUEL PRO', m)
MAIN.write_text(m)


# ---------------------------------------------------------------------------
# Analysis Pack screen: keep single-coin field, but expose the SAME batch
# selector directly beside it. This fixes the dead-end single-coin UX.
# ---------------------------------------------------------------------------
an = ANALYSIS.read_text()
if 'V9545_BATCH_FIELDS' not in an:
    raise SystemExit('v9.5.47 batch engine missing in AnalysisPackActivity')

b = method_bounds(an, '    protected void onCreate(')
if not b:
    raise SystemExit('v9.5.47 Analysis onCreate missing')
a0, _, e0 = b
oc = an[a0:e0]
if 'V9547_ANALYSIS_MULTI_SELECTOR' not in oc:
    anchor = '        setContentView(scroll);'
    if anchor not in oc:
        raise SystemExit('v9.5.47 Analysis setContentView anchor missing')
    injection = r'''
        // V9547_ANALYSIS_MULTI_SELECTOR — available in both single and batch entry flows.
        try {
            android.view.ViewParent parent = symbolInput.getParent();
            if (parent instanceof android.widget.LinearLayout) {
                android.widget.LinearLayout group = (android.widget.LinearLayout) parent;
                android.widget.Button multi = new android.widget.Button(this);
                multi.setText("📦 ÇOKLU COİN SEÇ / ANALİZ • 2–8");
                multi.setAllCaps(false);
                multi.setTextSize(14f);
                multi.setTextColor(android.graphics.Color.WHITE);
                multi.setBackgroundColor(android.graphics.Color.rgb(88,45,150));
                multi.setContentDescription("Güncel Radar listesinden veya manuel girişle 2–8 coin seç");
                multi.setOnClickListener(v -> V9547BatchSelector.show(this,
                        symbolInput.getText() == null ? null : symbolInput.getText().toString()));
                int at = group.indexOfChild(symbolInput);
                android.widget.LinearLayout.LayoutParams mlp =
                        new android.widget.LinearLayout.LayoutParams(-1, dp(54));
                mlp.setMargins(0, dp(7), 0, dp(7));
                group.addView(multi, Math.min(group.getChildCount(), Math.max(0, at + 1)), mlp);
            }
        } catch (Throwable ignored) {}
'''
    oc = oc.replace(anchor, anchor + injection, 1)
    an = an[:a0] + oc + an[e0:]

an = an.replace('Coin adını yaz. Uygulama Binance Futures',
                'Tek coin için adını yaz; çoklu analiz için “ÇOKLU COİN SEÇ / ANALİZ” düğmesini kullan. Uygulama Binance Futures')
an = re.sub(r'ChatGPT ANALİZ PAKETİ\s*•\s*v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.47', an)
an = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.47', an)
ANALYSIS.write_text(an)


# ---------------------------------------------------------------------------
# Radar screen: prominent multi-select button; single ANALİZ PAKETİ buttons
# remain for users who only want one coin.
# ---------------------------------------------------------------------------
r = RADAR.read_text()
r = r.replace('📡 8 COİN MARKET RADARI', '📡 9 COİN MARKET RADARI')
r = r.replace('TOP3 + ilk 3\'e yaklaşabilecek 5 güçlü aday', 'TOP3 + ilk 3\'e yaklaşabilecek 6 güçlü aday')
r = r.replace('3 TOP + 5 ADAY', '3 TOP + 6 ADAY')
r = r.replace('8 coin', '9 coin').replace('8 COİN', '9 COİN')
r = r.replace('5 güçlü aday', '6 güçlü aday')

b = method_bounds(r, '    protected void onCreate(')
if not b:
    raise SystemExit('v9.5.47 Radar onCreate missing')
a0, _, e0 = b
roc = r[a0:e0]
if 'V9547_RADAR_MULTI_SELECTOR' not in roc:
    anchor = '        list=new android.widget.LinearLayout(this);'
    if anchor not in roc:
        raise SystemExit('v9.5.47 radar list anchor missing')
    button = r'''
        // V9547_RADAR_MULTI_SELECTOR
        android.widget.Button batch=btn("☑ TOPLU COİN SEÇ / ANALİZ • 2–8",android.graphics.Color.rgb(88,45,150));
        root.addView(batch,lp(-1,dp(54),0,10));
        batch.setOnClickListener(v->V9547BatchSelector.show(this,null));
'''
    roc = roc.replace(anchor, button + anchor, 1)
    r = r[:a0] + roc + r[e0:]

r = re.sub(r'v9\.5(?:\.\d+)*', 'v9.5.47', r)
r = re.sub(r'V9\.5(?:\.\d+)*', 'V9.5.47', r)
RADAR.write_text(r)


# Keep service/version metadata aligned; monitoring decisions are untouched.
mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.47', mon)
MON.write_text(mon)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091311', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.47'", bf, count=1)
BUILD.write_text(bf)

# Fail fast on the UX + retention invariants.
main = MAIN.read_text(); ana = ANALYSIS.read_text(); radar = RADAR.read_text(); eng = ENGINE.read_text(); build = BUILD.read_text()
checks = {
    'shared selector class': SELECTOR.exists() and 'RADAR_LIMIT = 9' in SELECTOR.read_text() and 'MAX_BATCH = 8' in SELECTOR.read_text(),
    'main selector': 'V9547_SHARED_BATCH_SELECTOR' in main and 'V9547BatchSelector.show(this, null)' in main,
    'main batch always visible': 'V9547_BATCH_BUTTON_ALWAYS' in main,
    'analysis selector': 'V9547_ANALYSIS_MULTI_SELECTOR' in ana and 'ÇOKLU COİN SEÇ / ANALİZ' in ana,
    'radar selector': 'V9547_RADAR_MULTI_SELECTOR' in radar and 'TOPLU COİN SEÇ / ANALİZ' in radar,
    'radar 3+6 engine': 'V9547_TOP3_PLUS_6_CANDIDATES' in eng and 'stickySix(candidates)' in eng,
    'radar 9 ui': '9 COİN MARKET RADARI' in radar and '3 TOP + 6 ADAY' in radar,
    'batch engine retained': 'V9545_BATCH_FIELDS' in ana and 'ACTION_SEND_MULTIPLE' in ana,
    'delete shortcut retained': 'V9546_ANALYSIS_DELETE_SHORTCUT' in main,
    'signal persistence retained': 'v9543b_strict_ticket_' in main,
    'late entry retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'version build': 'versionCode 26091311' in build and "versionName '9.5.47'" in build,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.47 sanity failed: ' + ', '.join(bad))
print('v9.5.47 OK: 9-coin radar (TOP3+6) + shared Radar/manual multi-select on Main, Radar and Analysis Pack; trading core untouched.')
