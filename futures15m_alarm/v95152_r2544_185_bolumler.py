"""R2544.185 APK 9.5.145: section show/hide ("Bölümler") like the Office (user 16.11: "apk dahil aç kapa butonları").
View-only: a hidden card keeps collecting data; nothing is sent to the PC; the phone never places orders.
Source generation only (Codemagic chain), never connects to the PC.
"""
from pathlib import Path
import re
APP = Path('/tmp/futures15m-build/Futures15mAlarm')
J = APP / 'app/src/main/java/com/futuresalarm/app'
m = (J / 'MainActivity.java').read_text(encoding='utf-8')
def replace(s, a, b, count=1):
    if s.count(a) != count:
        raise RuntimeError('V95152 source anchor mismatch (%d): %s' % (s.count(a), a[:80]))
    return s.replace(a, b)

# 1) apply after every dynamic refresh (the same hook the other cards use)
hook = '        try { v95147HideBars(getWindow().getDecorView()); } catch (Throwable ignored) {} // V95147_R2544_147_SERIT_GIZLE'
m = replace(m, hook, hook + '\n        try { v95152ApplySections(); } catch (Throwable ignored) {} // V95152_R2544_185_BOLUMLER')

methods = r'''
    // ============================================================
    // V95152_R2544_185_BOLUMLER: section show/hide, VIEW ONLY.
    // Only the sections the user switched OFF are hidden after each refresh; switched-on sections are left to their own
    // installers (a card with no data stays hidden by its installer, it is never forced visible). Nothing goes to the PC.
    // ============================================================
    private static final String[][] V95152_SECTIONS = {
        {"v95146_pos_card", "Açık pozisyon", "1"},
        {"v95132_lanes_card", "Hatlar (PC seçimi)", "1"},
        {"v95149_kesif_card", "KEŞİF-SÖZ / beyin", "1"},
        {"v95127_desk_card", "Pozisyon masası", "1"},
        {"v9549_recent_real_trades", "Son gerçek işlemler", "1"},
        {"v9558_signal_journal_card", "Sinyal defteri", "1"},
        {"v9551_validity_card", "Geçerlilik ayrıntısı", "0"},
        {"v9540_futures_radar_card", "Radar (ayrıntı)", "0"},
        {"v9542_attention_card", "Dikkat listesi (ayrıntı)", "0"}
    };
    private boolean v95152On(android.content.SharedPreferences sp, String[] s) {
        return sp.getBoolean("v95152_sec_" + s[0], "1".equals(s[2]));
    }
    private void v95152ApplySections() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        if (root.findViewWithTag("v95152_sections_btn") == null) {
            Button b = button("⚙ Bölümler: aç / kapa (yalnız görünüm)", android.graphics.Color.rgb(40, 52, 70));
            b.setTag("v95152_sections_btn");
            b.setOnClickListener(v -> v95152SectionsDialog());
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, dp(4), 0, dp(8));
            root.addView(b, Math.min(2, root.getChildCount()), lp);
        }
        for (String[] s : V95152_SECTIONS) {
            if (v95152On(sp, s)) continue;
            android.view.View v = root.findViewWithTag(s[0]);
            if (v != null && v.getVisibility() != android.view.View.GONE) v.setVisibility(android.view.View.GONE);
        }
    }
    private void v95152SectionsDialog() {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        final String[] names = new String[V95152_SECTIONS.length];
        final boolean[] on = new boolean[V95152_SECTIONS.length];
        for (int i = 0; i < V95152_SECTIONS.length; i++) { names[i] = V95152_SECTIONS[i][1]; on[i] = v95152On(sp, V95152_SECTIONS[i]); }
        final boolean[] before = on.clone();
        new AlertDialog.Builder(this).setTitle("Bölümler (yalnız görünüm)")
            .setMultiChoiceItems(names, on, (d, which, checked) -> on[which] = checked)
            .setPositiveButton("Kaydet", (d, w) -> {
                android.content.SharedPreferences.Editor e = sp.edit();
                for (int i = 0; i < V95152_SECTIONS.length; i++) e.putBoolean("v95152_sec_" + V95152_SECTIONS[i][0], on[i]);
                e.apply();
                android.widget.LinearLayout root = v9544MainRoot();
                if (root != null) for (int i = 0; i < V95152_SECTIONS.length; i++) {
                    if (on[i] && !before[i]) { android.view.View v = root.findViewWithTag(V95152_SECTIONS[i][0]); if (v != null) v.setVisibility(android.view.View.VISIBLE); }
                }
                try { v95152ApplySections(); } catch (Throwable ignored) {}
                Toast.makeText(this, "Bölümler kaydedildi. Kapalı bölümün verisi toplanmaya devam eder; PC'ye bir şey gönderilmedi.", Toast.LENGTH_LONG).show();
            })
            .setNegativeButton("Vazgeç", null).show();
    }
'''
anchor = '    private void v95146InstallPositionCard() {'
m = replace(m, anchor, methods + '\n' + anchor)
(J / 'MainActivity.java').write_text(m, encoding='utf-8')

f = APP / 'app/build.gradle'
s = f.read_text(encoding='utf-8')
s = re.sub(r'versionCode\s+(\d+)', lambda x: 'versionCode ' + str(int(x.group(1)) + 1), s, count=1)
s = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.145-r2544.185-bolumler'", s, count=1)
f.write_text(s, encoding='utf-8')
print('V95152_R2544_185_BOLUMLER_SOURCE_OK')
