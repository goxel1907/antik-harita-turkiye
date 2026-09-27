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
        raise SystemExit('v9.5.35 missing required file: ' + str(p))

OLD = '🔒 Bu plan için aynı yönde tekrar alarm kilitlendi. Yeni plan yapıştırılınca yeniden kurulur.'
NEW = ('🔒 Bu sembolde mevcut sinyal sonuçlanana kadar yeni/ters sinyal kilitli. '
       'Sonuçtan sonra GÜNLÜK ADAPTİF plan korunur; en az bir tamamen yeni 15m mum tamamlanınca '
       'yeni cycle otomatik değerlendirmeye açılır.')

# ---------------------------------------------------------------------------
# 1) Main UI: migrate every persisted legacy lifecycle sentence, regardless of
#    which old preference key/card stored it. This closes the v9.5.34 render
#    gap visible on existing signal cards.
# ---------------------------------------------------------------------------
s = MAIN.read_text()
s = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.35', s)
s = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.35  •  MANUEL PRO', s)

if 'v9535MigrateLegacyLifecycleText();' not in s:
    anchor = 'super.onCreate(savedInstanceState);'
    if anchor not in s:
        raise SystemExit('v9.5.35 onCreate anchor missing')
    s = s.replace(anchor, anchor + '\n        v9535MigrateLegacyLifecycleText();', 1)

# Every new plan import re-enables the symbol if the user had explicitly deleted
# the previous exhausted analysis.
imp_start = s.find('    private void openImportDialog() {')
if imp_start < 0:
    raise SystemExit('v9.5.35 openImportDialog missing')
next_method = re.search(r'\n    private [^\n]+\(', s[imp_start + 10:])
if not next_method:
    raise SystemExit('v9.5.35 import method boundary missing')
imp_end = imp_start + 10 + next_method.start()
imp = s[imp_start:imp_end]
if 'v9535_analysis_deleted_' not in imp:
    marker = 'success++;'
    if marker not in imp:
        raise SystemExit('v9.5.35 import success anchor missing')
    reactivate = '''getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).edit()\n                                .remove("v9535_analysis_deleted_" + sym)\n                                .putLong("v9535_analysis_import_" + sym, System.currentTimeMillis())\n                                .apply();\n                        '''
    imp = imp.replace(marker, reactivate + marker, 1)
    s = s[:imp_start] + imp + s[imp_end:]

# Add plan-health panel immediately after the existing professional META panel.
if 'v9535AddAnalysisHealthPanel(card, p.symbol);' not in s:
    anchor = 'v95AddMetaPanel(card, p.symbol);'
    if anchor not in s:
        raise SystemExit('v9.5.35 plan-card META anchor missing')
    s = s.replace(anchor, anchor + '\n        v9535AddAnalysisHealthPanel(card, p.symbol);', 1)

helper = r'''

    private String v9535AsciiUpper(String x) {
        if (x == null) return "";
        return x.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G')
                .replace('Ü','U').replace('Ö','O').replace('Ç','C');
    }

    private int v9535InvalidScenarioCount(String symbol) {
        String raw = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE)
                .getString("v95_meta_" + symbol, "");
        String u = v9535AsciiUpper(raw);
        int n = 0;
        String[] keys = {"LP_DURUM", "LB_DURUM", "SR_DURUM", "SB_DURUM"};
        for (String k : keys) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile(
                    java.util.regex.Pattern.quote(k) + "\\s*[:=]\\s*([^;]+)")
                    .matcher(u);
            if (m.find() && m.group(1).contains("GECERSIZ")) n++;
        }
        return n;
    }

    private boolean v9535AdaptivePlan(String symbol) {
        String raw = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE)
                .getString("v95_meta_" + symbol, "");
        String u = v9535AsciiUpper(raw);
        return u.contains("DAY_MODE:ADAPTIF") || u.contains("DAY_MODE=ADAPTIF");
    }

    private void v9535MigrateLegacyLifecycleText() {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
            android.content.SharedPreferences.Editor ed = sp.edit();
            boolean changed = false;
            for (java.util.Map.Entry<String, ?> e : sp.getAll().entrySet()) {
                Object v = e.getValue();
                if (!(v instanceof String)) continue;
                String x = (String) v;
                String y = x.replace("🔒 Bu plan için aynı yönde tekrar alarm kilitlendi. Yeni plan yapıştırılınca yeniden kurulur.",
                        "🔒 Bu sembolde mevcut sinyal sonuçlanana kadar yeni/ters sinyal kilitli. Sonuçtan sonra GÜNLÜK ADAPTİF plan korunur; en az bir tamamen yeni 15m mum tamamlanınca yeni cycle otomatik değerlendirmeye açılır.")
                        .replace("Yeni plan yapıştırılınca yeniden kurulur.",
                                "Günlük adaptif plan korunur; normal cycle sonrası yeni 15m mumla otomatik yeniden değerlendirilir.");
                if (!x.equals(y)) { ed.putString(e.getKey(), y); changed = true; }
            }
            if (changed) ed.apply();
        } catch (Throwable ignored) {}
    }

    private void v9535AddAnalysisHealthPanel(LinearLayout card, final String symbol) {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        final boolean deleted = sp.getBoolean("v9535_analysis_deleted_" + symbol, false);
        final int invalid = v9535InvalidScenarioCount(symbol);
        if (!deleted && (!v9535AdaptivePlan(symbol) || invalid < 3)) return;

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(10), dp(9), dp(10), dp(9));
        box.setBackground(v955Panel(
                deleted ? Color.rgb(69,10,10) : (invalid >= 4 ? Color.rgb(92,36,8) : Color.rgb(74,54,8)),
                Color.rgb(148,163,184), 12));

        String body;
        if (deleted) {
            body = "🗑 BU ANALİZ DEVRE DIŞI\nYeni plan yapıştırılana kadar bu sembolde eski analiz alarm üretmez.";
        } else if (invalid >= 4) {
            body = "⚠ GÜNLÜK ANALİZ TÜKENDİ\nLP/LB/SR/SB dallarının tamamı META içinde GEÇERSİZ. Eski seviyeleri zorlamayın. Yeni analiz oluşturun veya bu analizi silin.";
        } else {
            body = "⚠ GÜNLÜK ANALİZ TÜKENME AŞAMASINDA\nDört senaryodan " + invalid + " tanesi META içinde GEÇERSİZ. Kalan dal da geçersizleşirse yeni analiz gerekir; eski seviyeleri zorlamayın.";
        }
        TextView t = text(body, 12.5f, Color.rgb(255,237,213), true);
        t.setLineSpacing(0, 1.10f);
        box.addView(t, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        if (!deleted) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            Button fresh = button("YENİ ANALİZ\nGüncel 8-TF paket oluştur", Color.rgb(3,105,161));
            Button remove = button("BU ANALİZİ SİL\nEski planı devre dışı bırak", Color.rgb(153,27,27));
            fresh.setOnClickListener(v -> {
                try {
                    android.content.Intent i = new android.content.Intent(this, AnalysisPackActivity.class);
                    i.putExtra("symbol", symbol);
                    startActivity(i);
                } catch (Throwable e) {
                    android.widget.Toast.makeText(this, "Analiz paketi açılamadı.", android.widget.Toast.LENGTH_LONG).show();
                }
            });
            remove.setOnClickListener(v -> {
                if (sp.getBoolean("v9518_signal_active_" + symbol, false)) {
                    android.widget.Toast.makeText(this,
                            "Aktif sinyal/cycle sonuçlanmadan günlük analiz silinemez.",
                            android.widget.Toast.LENGTH_LONG).show();
                    return;
                }
                new android.app.AlertDialog.Builder(this)
                        .setTitle("Bu analizi sil?")
                        .setMessage(symbol + " için mevcut günlük adaptif analiz devre dışı bırakılacak. Yeni plan yapıştırılana kadar eski seviyeler alarm üretemez.")
                        .setNegativeButton("VAZGEÇ", null)
                        .setPositiveButton("ANALİZİ SİL", (d,w) -> {
                            sp.edit()
                                    .putBoolean("v9535_analysis_deleted_" + symbol, true)
                                    .remove("v95_meta_" + symbol)
                                    .remove("v953_trade_lock_" + symbol + "_LONG")
                                    .remove("v953_trade_lock_" + symbol + "_SHORT")
                                    .apply();
                            recreate();
                        }).show();
            });
            LinearLayout.LayoutParams a = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            LinearLayout.LayoutParams b = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            a.setMargins(0, dp(8), dp(4), 0); b.setMargins(dp(4), dp(8), 0, 0);
            row.addView(fresh, a); row.addView(remove, b); box.addView(row);
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), 0, dp(6));
        card.addView(box, lp);
    }
'''
if 'private void v9535AddAnalysisHealthPanel(' not in s:
    pos = s.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.35 MainActivity closing brace missing')
    s = s[:pos] + helper + '\n' + s[pos:]

MAIN.write_text(s)

# ---------------------------------------------------------------------------
# 2) Monitor: future alert detail never uses the legacy sentence, and a user-
#    deleted exhausted analysis cannot keep producing alarms from stale levels.
# ---------------------------------------------------------------------------
m = MON.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.35', m)
m = m.replace(OLD, NEW)

# Evaluate guard.
sig = '    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)'
idx = m.find(sig)
if idx < 0:
    raise SystemExit('v9.5.35 evaluate anchor missing')
brace = m.find('{', idx)
end_probe = m.find('\n', brace)
chunk = m[brace:end_probe + 1]
if 'v9535_analysis_deleted_' not in m[brace:brace + 600]:
    guard = '\n        if (p == null || prefs.getBoolean("v9535_analysis_deleted_" + p.symbol, false)) return;'
    m = m[:brace+1] + guard + m[brace+1:]

# Final notification guard too.
su = '    private void sendUrgent(String symbol, String direction, String detail)'
idx = m.find(su)
if idx < 0:
    raise SystemExit('v9.5.35 sendUrgent anchor missing')
brace = m.find('{', idx)
if 'v9535_analysis_deleted_' not in m[brace:brace + 500]:
    m = m[:brace+1] + '\n        if (prefs.getBoolean("v9535_analysis_deleted_" + symbol, false)) return;' + m[brace+1:]

MON.write_text(m)

# ---------------------------------------------------------------------------
# 3) Analysis prompt: make the exhaustion contract explicit so META statuses
#    remain meaningful for the in-app health warning.
# ---------------------------------------------------------------------------
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ\s*[•-]?\s*v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.35', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.35', a)
if 'V9.5.35 ANALIZ TUKENME DURUMU' not in a:
    anchor = '        sb.append("V9.5.34 CYCLE REARM NETLESTIRME:'
    idx = a.find(anchor)
    if idx < 0:
        raise SystemExit('v9.5.35 v9.5.34 prompt anchor missing')
    line_start = a.rfind('\n', 0, idx) + 1
    extra = r'''        sb.append("V9.5.35 ANALIZ TUKENME DURUMU: LP_DURUM/LB_DURUM/SR_DURUM/SB_DURUM alanlarini gercek durumla tutarli yaz. Bir dalin yapisal seviyeleri tuketilmis veya anlamsizlasmissa GECERSIZ yaz; sirf format dolsun diye BEKLE tutma. Dallarin cogu GECERSIZ hale gelmisse bu gunluk harita TUKENME ASAMASINDADIR; tum dallar GECERSIZ ise YENI ANALIZ GEREKIR. Uygulama bu META durumlarini kullanarak kullaniciyi yeni analiz veya mevcut analizi silme konusunda uyarabilir.\n\n");
'''
    a = a[:line_start] + extra + a[line_start:]
ANALYSIS.write_text(a)

# ---------------------------------------------------------------------------
# 4) Version bump.
# ---------------------------------------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 26091206', b, count=1)
b = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.35'", b, count=1)
BUILD.write_text(b)

# Fail-fast sanity.
main = MAIN.read_text(); mon = MON.read_text(); ana = ANALYSIS.read_text(); build = BUILD.read_text()
checks = {
    'legacy preference migration': 'v9535MigrateLegacyLifecycleText();' in main and 'Yeni plan yapıştırılınca yeniden kurulur.' in main,
    'health panel': 'GÜNLÜK ANALİZ TÜKENME AŞAMASINDA' in main and 'GÜNLÜK ANALİZ TÜKENDİ' in main,
    'new analysis action': 'Güncel 8-TF paket oluştur' in main and 'AnalysisPackActivity.class' in main,
    'safe delete action': 'v9535_analysis_deleted_' in main and 'Aktif sinyal/cycle sonuçlanmadan' in main,
    'new import reactivates': '.remove("v9535_analysis_deleted_" + sym)' in main,
    'monitor deleted guard': 'prefs.getBoolean("v9535_analysis_deleted_" + p.symbol, false)' in mon,
    'future lifecycle text': OLD not in mon and 'GÜNLÜK ADAPTİF plan korunur' in mon,
    'prompt exhaustion contract': 'V9.5.35 ANALIZ TUKENME DURUMU' in ana,
    'version': "versionName '9.5.35'" in build and 'versionCode 26091206' in build,
}
for k, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), k)
if not all(checks.values()):
    raise SystemExit('v9.5.35 sanity failed: ' + ', '.join(k for k,v in checks.items() if not v))
print('v9.5.35 OK: legacy lock UI migrated; adaptive analysis exhaustion warning + new-analysis/delete choices added.')
