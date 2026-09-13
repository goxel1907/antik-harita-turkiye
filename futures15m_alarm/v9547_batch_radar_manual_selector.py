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

for p in (MAIN, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.47 missing required file: ' + str(p))


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0: return None
    b = src.find('{', a)
    if b < 0: return None
    depth = 1; i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(src) and depth:
        c = src[i]; n = src[i+1] if i + 1 < len(src) else ''
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
for marker in ('V9545_BATCH_ANALYSIS','V9546_ANALYSIS_DELETE_SHORTCUT','v9543b_strict_ticket_','V9543C_EXECUTION_DRIFT_RECHECK'):
    if marker not in m:
        raise SystemExit('v9.5.47 prerequisite missing: ' + marker)

# Make the batch launcher explain the two real sources: latest radar or manual entry.
m = m.replace('📦 TOPLU ANALİZ • 2–8 COİN', '📦 TOPLU ANALİZ • RADAR / MANUEL', 1)
m = m.replace('İki ile sekiz analizli coini tek ChatGPT paketinde hazırla',
              'Radar listesinden seç veya 2–8 coini elle yaz; tek ChatGPT paketinde hazırla', 1)

b = method_bounds(m, '    private void v9545ShowBatchAnalysisDialog()')
if not b:
    raise SystemExit('v9.5.47 batch dialog method missing')
a, _, e = b
new_method = r'''    // V9547_BATCH_RADAR_MANUAL_SELECTOR
    private void v9545ShowBatchAnalysisDialog() {
        final java.util.ArrayList<String> radarSymbols = new java.util.ArrayList<>();
        final java.util.ArrayList<String> radarLabels = new java.util.ArrayList<>();

        // Primary source: the CURRENT Futures Radar 8-coin discovery map.
        // This is selection convenience only; radar rank is never a trade signal.
        try {
            String raw = V9538MarketRadarEngine.latestJson(this);
            org.json.JSONObject root = raw == null || raw.trim().isEmpty()
                    ? null : new org.json.JSONObject(raw);
            org.json.JSONArray rows = root == null ? null : root.optJSONArray("rows");
            if (rows != null) {
                for (int i = 0; i < rows.length() && radarSymbols.size() < 8; i++) {
                    org.json.JSONObject r = rows.optJSONObject(i);
                    if (r == null) continue;
                    String sym = v9547NormalizeBatchSymbol(r.optString("symbol", ""));
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

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(18), dp(6), dp(18), dp(4));

        TextView info = text(
                "Coinleri iki şekilde seçebilirsin:\n"
                        + "1) Aşağıdaki güncel RADAR coinlerini işaretle.\n"
                        + "2) Alttaki kutuya istediğin coinleri elle yaz.\n"
                        + "Toplam 2–8 coin olmalı. Eski analizli coinler artık otomatik seçilmez.",
                13f, Color.rgb(226,232,240), false);
        info.setLineSpacing(0, 1.08f);
        body.addView(info, new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView radarTitle = text("📡 GÜNCEL FUTURES RADAR • seçim önerisi, sinyal değil", 12.5f,
                Color.rgb(96,165,250), true);
        LinearLayout.LayoutParams rtlp = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
        rtlp.setMargins(0, dp(12), 0, dp(4));
        body.addView(radarTitle, rtlp);

        final java.util.ArrayList<android.widget.CheckBox> radarChecks = new java.util.ArrayList<>();
        android.widget.ScrollView radarScroll = new android.widget.ScrollView(this);
        LinearLayout radarBox = new LinearLayout(this);
        radarBox.setOrientation(LinearLayout.VERTICAL);
        radarScroll.addView(radarBox, new android.widget.ScrollView.LayoutParams(-1, -2));

        if (radarSymbols.isEmpty()) {
            TextView noRadar = text("Radar listesi henüz hazır değil. Aşağıdaki MANUEL COİN alanını kullanabilirsin.",
                    12f, Color.rgb(251,191,36), false);
            radarBox.addView(noRadar, new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT));
        } else {
            for (int i = 0; i < radarSymbols.size(); i++) {
                android.widget.CheckBox cb = new android.widget.CheckBox(this);
                cb.setText(radarLabels.get(i));
                cb.setTextColor(Color.WHITE);
                cb.setTextSize(13f);
                cb.setChecked(false); // never auto-select old/current coins
                cb.setPadding(dp(2), dp(3), dp(2), dp(3));
                radarBox.addView(cb, new LinearLayout.LayoutParams(-1, dp(42)));
                radarChecks.add(cb);
            }
        }
        LinearLayout.LayoutParams rslp = new LinearLayout.LayoutParams(-1, dp(230));
        body.addView(radarScroll, rslp);

        TextView manualTitle = text("✍ MANUEL COİN GİRİŞİ", 12.5f, Color.rgb(52,211,153), true);
        LinearLayout.LayoutParams mtlp = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
        mtlp.setMargins(0, dp(10), 0, dp(4));
        body.addView(manualTitle, mtlp);

        final EditText manual = new EditText(this);
        manual.setHint("Örn: BTC, ETH, CVC, FIL\nveya BTCUSDT ETHUSDT ...");
        manual.setHintTextColor(Color.rgb(125,138,160));
        manual.setTextColor(Color.WHITE);
        manual.setTextSize(14f);
        manual.setMinLines(2);
        manual.setMaxLines(4);
        manual.setSingleLine(false);
        manual.setPadding(dp(12), dp(9), dp(12), dp(9));
        manual.setBackgroundColor(Color.rgb(18,29,48));
        body.addView(manual, new LinearLayout.LayoutParams(-1, dp(86)));

        TextView hint = text("Radar + manuel seçimler birleştirilir, tekrar eden coinler tek sayılır.",
                11.5f, Color.rgb(148,163,184), false);
        LinearLayout.LayoutParams hlp = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
        hlp.setMargins(0, dp(5), 0, 0);
        body.addView(hint, hlp);

        final android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(this)
                .setTitle("📦 TOPLU ANALİZ • RADAR / MANUEL")
                .setView(body)
                .setNegativeButton("İPTAL", null)
                .setPositiveButton("PAKETLERİ HAZIRLA", null)
                .create();

        dlg.setOnShowListener(x -> dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            java.util.LinkedHashSet<String> chosen = new java.util.LinkedHashSet<>();

            for (int i = 0; i < radarChecks.size() && i < radarSymbols.size(); i++) {
                if (radarChecks.get(i).isChecked()) chosen.add(radarSymbols.get(i));
            }

            String typed = manual.getText() == null ? "" : manual.getText().toString().trim();
            if (!typed.isEmpty()) {
                String[] parts = typed.split("[\\s,;]+", -1);
                for (String part : parts) {
                    String sym = v9547NormalizeBatchSymbol(part);
                    if (!sym.isEmpty()) chosen.add(sym);
                }
            }

            if (chosen.size() < 2 || chosen.size() > 8) {
                Toast.makeText(this,
                        "Toplam 2–8 coin seçmelisin. Şu an: " + chosen.size(),
                        Toast.LENGTH_LONG).show();
                return;
            }

            java.util.ArrayList<String> selected = new java.util.ArrayList<>(chosen);
            android.content.Intent in = new android.content.Intent(this, AnalysisPackActivity.class);
            in.putStringArrayListExtra("v9545_batch_symbols", selected);
            startActivity(in);
            dlg.dismiss();
        }));
        dlg.show();
    }'''
m = m[:a] + new_method + m[e:]

if 'private String v9547NormalizeBatchSymbol(' not in m:
    pos = m.rfind('}')
    if pos < 0: raise SystemExit('v9.5.47 MainActivity close missing')
    helper = r'''

    private String v9547NormalizeBatchSymbol(String raw) {
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
'''
    m = m[:pos] + helper + '\n' + m[pos:]

m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.47', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.47  •  MANUEL PRO', m)
MAIN.write_text(m)

mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.47', mon)
MON.write_text(mon)

ana = ANALYSIS.read_text()
ana = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.47', ana)
ana = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.47', ana)
ANALYSIS.write_text(ana)

# Keep Radar screen/version aligned too; screenshot-visible stale v9.5.42 is fixed here.
for p in (RADAR, ENGINE):
    if p.exists():
        s = p.read_text()
        s = re.sub(r'v9\.5(?:\.\d+)*', 'v9.5.47', s)
        s = re.sub(r'V9\.5(?:\.\d+)*', 'V9.5.47', s)
        p.write_text(s)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091311', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.47'", bf, count=1)
BUILD.write_text(bf)

main = MAIN.read_text(); ana = ANALYSIS.read_text(); build = BUILD.read_text()
checks = {
    'radar manual selector': 'V9547_BATCH_RADAR_MANUAL_SELECTOR' in main,
    'reads latest radar': 'V9538MarketRadarEngine.latestJson(this)' in main,
    'manual edit field': 'MANUEL COİN GİRİŞİ' in main and 'final EditText manual' in main,
    'no old auto-selection': 'Eski analizli coinler artık otomatik seçilmez' in main and 'cb.setChecked(false)' in main,
    '2-8 validation': 'chosen.size() < 2 || chosen.size() > 8' in main,
    'batch handoff retained': 'v9545_batch_symbols' in main,
    'batch engine retained': 'V9545_BATCH_FIELDS' in ana,
    'delete shortcut retained': 'V9546_ANALYSIS_DELETE_SHORTCUT' in main,
    'signal persistence retained': 'v9543b_strict_ticket_' in main,
    'late-entry guard retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'version build': 'versionCode 26091311' in build and "versionName '9.5.47'" in build,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '), k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.47 sanity failed: '+', '.join(bad))
print('v9.5.47 OK: batch analysis selects from CURRENT RADAR and/or manual 2-8 symbols; old analyzed coins are not auto-selected.')
