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
        raise SystemExit('v9.5.46 missing required file: ' + str(p))

m = MAIN.read_text()
for marker in (
    'V9544_COIN_JUMP_NAV',
    'V9545_BATCH_ANALYSIS',
    'v9544AnalyzedSymbols(',
    'v9544MainRoot()',
    'v9544ScrollToCoin(',
    'V9543C_SINGLE_TAP_APPROVAL',
    'v9543b_strict_ticket_',
):
    if marker not in m:
        raise SystemExit('v9.5.46 prerequisite missing: ' + marker)

# ---------------------------------------------------------------------------
# Fast delete UX:
# 1) every quick-jump coin chip supports LONG PRESS -> existing delete flow
# 2) a visible red ANALİZ SİL button opens a coin picker
# We deliberately reuse the already-rendered plan-card delete control instead
# of duplicating SharedPreferences/storage deletion logic. This keeps every
# existing confirmation/cleanup rule authoritative and avoids lifecycle drift.
# ---------------------------------------------------------------------------
if 'V9546_LONG_PRESS_DELETE' not in m:
    anchor = '            b.setOnClickListener(v -> v9544ScrollToCoin(sym));'
    if anchor not in m:
        raise SystemExit('v9.5.46 coin chip click anchor missing')
    m = m.replace(anchor, anchor + r'''
            // V9546_LONG_PRESS_DELETE — same existing delete flow, shorter path.
            b.setOnLongClickListener(v -> {
                v9546RequestDelete(sym);
                return true;
            });''', 1)

# Make the gesture discoverable without adding noise to every chip.
m = m.replace(
    'Coine dokun → uygulama doğrudan o analiz kartına iner',
    'Dokun: analize git • basılı tut: analizi sil',
    1,
)

if 'V9546_DELETE_SHORTCUT_BUTTON' not in m:
    nav_anchor = '        box.addView(hs, new LinearLayout.LayoutParams(-1, dp(40)));'
    if nav_anchor not in m:
        raise SystemExit('v9.5.46 navigator row anchor missing')
    delete_button = r'''

        // V9546_DELETE_SHORTCUT_BUTTON — storage semantics remain owned by the
        // plan card's existing delete action.
        Button del = new Button(this);
        del.setText("🗑 ANALİZ SİL");
        del.setAllCaps(false);
        del.setTextSize(12.5f);
        del.setTextColor(Color.WHITE);
        del.setMinHeight(0); del.setMinimumHeight(0);
        del.setPadding(dp(12), dp(5), dp(12), dp(5));
        del.setBackgroundColor(Color.rgb(145, 35, 35));
        del.setContentDescription("Analizli coin seç ve mevcut güvenli silme akışını aç");
        del.setOnClickListener(v -> v9546ShowDeletePicker());
        LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(-1, dp(42));
        dlp.setMargins(0, dp(7), 0, 0);
        box.addView(del, dlp);
'''
    m = m.replace(nav_anchor, nav_anchor + delete_button, 1)

if 'private void v9546ShowDeletePicker()' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.46 MainActivity closing brace missing')
    helper = r'''

    // ============================================================
    // V9546_ANALYSIS_DELETE_SHORTCUT
    // UI bridge only. It never edits trade/signal state directly.
    // ============================================================
    private void v9546ShowDeletePicker() {
        final java.util.ArrayList<String> symbols = v9544AnalyzedSymbols(v9544MainRoot());
        if (symbols.isEmpty()) {
            Toast.makeText(this, "Silinecek analiz yok.", Toast.LENGTH_SHORT).show();
            return;
        }
        final String[] labels = new String[symbols.size()];
        for (int i = 0; i < symbols.size(); i++) {
            String state;
            try { state = v9545AnalysisState(symbols.get(i)); }
            catch (Throwable ignored) { state = ""; }
            labels[i] = symbols.get(i) + (state == null || state.isEmpty() ? "" : "  •  " + state);
        }
        new android.app.AlertDialog.Builder(this)
                .setTitle("🗑 ANALİZ SİL")
                .setMessage("Coini seç. Uygulama o kartın mevcut silme işlemini açacak; mevcut güvenlik/onay mantığı değişmez.")
                .setItems(labels, (d, which) -> {
                    if (which >= 0 && which < symbols.size())
                        v9546RequestDelete(symbols.get(which));
                })
                .setNegativeButton("İPTAL", null)
                .show();
    }

    private void v9546RequestDelete(String symbol) {
        if (symbol == null || symbol.trim().isEmpty()) return;
        final String sym = symbol.trim().toUpperCase(java.util.Locale.US);
        final android.view.View card = v9546FindPlanCard(sym);
        if (card == null) {
            Toast.makeText(this, sym + " analiz kartı bulunamadı.", Toast.LENGTH_LONG).show();
            v9544ScheduleCoinNavigator();
            return;
        }
        final android.view.View del = v9546FindDeleteControl(card);
        if (del != null) {
            // Existing card action stays authoritative: if it already has a
            // confirmation dialog, the same confirmation is shown here too.
            del.performClick();
            android.view.View content = findViewById(android.R.id.content);
            if (content != null) {
                content.postDelayed(() -> {
                    try { v9544ScheduleCoinNavigator(); } catch (Throwable ignored) {}
                }, 450L);
                content.postDelayed(() -> {
                    try { v9544ScheduleCoinNavigator(); } catch (Throwable ignored) {}
                }, 1100L);
            }
            return;
        }

        // Safe fallback: never invent a second storage delete implementation.
        // Move the user to the correct card so the existing delete control is
        // immediately reachable if a future UI revision renames/rebuilds it.
        Toast.makeText(this,
                sym + " için mevcut silme düğmesi otomatik bulunamadı; analiz kartına gidiliyor.",
                Toast.LENGTH_LONG).show();
        v9544ScrollToCoin(sym);
    }

    private android.view.View v9546FindPlanCard(String symbol) {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return null;
        int start = 0;
        for (int i = 0; i < root.getChildCount(); i++) {
            String t = v9544FlatText(root.getChildAt(i));
            if (t.contains("İZLENEN PLANLAR") || t.contains("IZLENEN PLANLAR")) {
                start = i;
                break;
            }
        }
        for (int i = start; i < root.getChildCount(); i++) {
            android.view.View c = root.getChildAt(i);
            if (v9544ContainsSymbol(v9544FlatText(c), symbol)) return c;
        }
        return null;
    }

    private android.view.View v9546FindDeleteControl(android.view.View root) {
        if (root == null) return null;
        android.view.View fallback = null;
        if (root instanceof android.widget.TextView && root.isClickable()) {
            CharSequence cs = ((android.widget.TextView) root).getText();
            String t = cs == null ? "" : v9546Norm(cs.toString());
            boolean delWord = t.contains(" SIL") || t.startsWith("SIL") || t.contains("KALDIR") || t.contains("DELETE");
            boolean planWord = t.contains("ANALIZ") || t.contains("PLAN") || t.contains("COIN");
            if (delWord && planWord) return root;
            if (delWord && (t.equals("SIL") || t.equals("SIL ANALIZ") || t.equals("ANALIZI SIL")))
                fallback = root;
        }
        if (root instanceof android.view.ViewGroup) {
            android.view.ViewGroup g = (android.view.ViewGroup) root;
            for (int i = 0; i < g.getChildCount(); i++) {
                android.view.View x = v9546FindDeleteControl(g.getChildAt(i));
                if (x != null) return x;
            }
        }
        return fallback;
    }

    private String v9546Norm(String s) {
        if (s == null) return "";
        return s.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G')
                .replace('Ü','U').replace('Ö','O').replace('Ç','C')
                .replaceAll("\\s+", " ").trim();
    }
'''
    m = m[:pos] + helper + '\n' + m[pos:]

# Version strings only; no monitoring, signal or order decision method changes.
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.46', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.46  •  MANUEL PRO', m)
MAIN.write_text(m)

mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.46', mon)
MON.write_text(mon)

ana = ANALYSIS.read_text()
ana = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.46', ana)
ana = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.46', ana)
ANALYSIS.write_text(ana)

for p in (RADAR, ENGINE):
    if p.exists():
        s = p.read_text()
        s = re.sub(r'v9\.5(?:\.\d+)*', 'v9.5.46', s)
        s = re.sub(r'V9\.5(?:\.\d+)*', 'V9.5.46', s)
        p.write_text(s)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091310', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.46'", bf, count=1)
BUILD.write_text(bf)

main = MAIN.read_text(); build = BUILD.read_text()
checks = {
    'delete visible shortcut': 'V9546_DELETE_SHORTCUT_BUTTON' in main and '🗑 ANALİZ SİL' in main,
    'long press shortcut': 'V9546_LONG_PRESS_DELETE' in main and 'setOnLongClickListener' in main,
    'existing delete reuse': 'v9546FindDeleteControl' in main and 'del.performClick()' in main,
    'no direct delete storage': 'V9546_DIRECT_STORAGE_DELETE' not in main,
    'navigator retained': 'V9544_COIN_JUMP_NAV' in main and 'v9544ScrollToCoin' in main,
    'batch retained': 'V9545_BATCH_ANALYSIS' in main and 'TOPLU ANALİZ' in main,
    'portfolio retained': 'PORTFÖY / 24 SAAT' in main,
    'radar retained': 'FUTURES RADAR' in main or 'v9540EnsureRadarCard' in main,
    'notification lock retained': 'v9543b_strict_ticket_' in main,
    'quick explicit order retained': 'V9543C_SINGLE_TAP_APPROVAL' in main and 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'version build': 'versionCode 26091310' in build and "versionName '9.5.46'" in build,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.46 sanity failed: ' + ', '.join(bad))
print('v9.5.46 OK: fast analysis-delete shortcut reuses existing card deletion; trading core untouched.')
