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
        raise SystemExit('v9.5.34 missing required file: ' + str(p))

OLD = '🔒 Bu plan için aynı yönde tekrar alarm kilitlendi. Yeni plan yapıştırılınca yeniden kurulur.'
NEW = ('🔒 Bu sembolde mevcut sinyal sonuçlanana kadar yeni/ters sinyal kilitli. '
       'Sonuçtan sonra GÜNLÜK ADAPTİF plan korunur; en az bir tamamen yeni 15m mum tamamlanınca '
       'yeni cycle otomatik değerlendirmeye açılır.')

# ---------------------------------------------------------------------------
# 1) Future notifications/details must describe the v9.5.33 lifecycle correctly.
# ---------------------------------------------------------------------------
m = MON.read_text()
if OLD not in m:
    raise SystemExit('v9.5.34 legacy lock text not found in MonitorService')
m = m.replace(OLD, NEW)
m = m.replace('15m Futures Alarm PRO v9.5.33', '15m Futures Alarm PRO v9.5.34')
MON.write_text(m)

# ---------------------------------------------------------------------------
# 2) Existing persisted signal detail from v9.5.33 may still contain the old
#    sentence. Translate it at render time, so the current FLOCK card is fixed
#    after installing the update without requiring another plan paste.
# ---------------------------------------------------------------------------
s = MAIN.read_text()
s = s.replace('v9.5.33  •  MANUEL PRO', 'v9.5.34  •  MANUEL PRO')
s = s.replace('v9.5.33 • MANUEL PRO', 'v9.5.34 • MANUEL PRO')
s = s.replace('15m Futures Alarm PRO v9.5.33', '15m Futures Alarm PRO v9.5.34')

sig = '    private String v9518Turkcelestir(String text) {'
if sig not in s:
    raise SystemExit('v9.5.34 v9518Turkcelestir anchor missing')
if 'V9534_DAILY_REARM_UI' not in s:
    anchor = '        if (text == null) return null;'
    pos = s.find(anchor, s.find(sig))
    if pos < 0:
        raise SystemExit('v9.5.34 text normalizer null-guard missing')
    inject = anchor + '\n' + \
'''        // V9534_DAILY_REARM_UI: old stored alarm text must not imply that a\n        // new ChatGPT plan is required after every completed trade cycle.\n        text = text.replace("🔒 Bu plan için aynı yönde tekrar alarm kilitlendi. Yeni plan yapıştırılınca yeniden kurulur.",\n                "🔒 Bu sembolde mevcut sinyal sonuçlanana kadar yeni/ters sinyal kilitli. Sonuçtan sonra GÜNLÜK ADAPTİF plan korunur; en az bir tamamen yeni 15m mum tamamlanınca yeni cycle otomatik değerlendirmeye açılır.");'''
    s = s[:pos] + inject + s[pos + len(anchor):]

# Make the signal tracking panel explicitly show the post-close daily lifecycle.
state_anchor = '            o.append("• Durum: ").append(state).append("\\n");'
if 'Günlük plan: KORUNUYOR' not in s:
    if state_anchor not in s:
        raise SystemExit('v9.5.34 signal status anchor missing')
    lifecycle = state_anchor + r'''
            boolean v9534Active = sp.getBoolean("v9518_signal_active_" + symbol, false);
            long v9534Rearm = sp.getLong("v9533_cycle_rearm_after_" + symbol, 0L);
            long v9534Now = System.currentTimeMillis();
            if (!v9534Active) {
                if (v9534Rearm > v9534Now) {
                    o.append("• Günlük plan: KORUNUYOR • yeni cycle için tamamen yeni 15m mum bekleniyor\n");
                } else {
                    o.append("• Günlük plan: AKTİF • yeni cycle otomatik değerlendiriliyor\n");
                }
            }
'''
    s = s.replace(state_anchor, lifecycle, 1)

MAIN.write_text(s)

# ---------------------------------------------------------------------------
# 3) Clarify the adaptive-day prompt contract: a normal completed cycle never
#    requires ChatGPT again. Re-analysis is only for map invalidation/regime
#    change/consumed levels, exactly as the daily-map design intended.
# ---------------------------------------------------------------------------
a = ANALYSIS.read_text()
if 'V9.5.34 CYCLE REARM NETLESTIRME' not in a:
    prompt_anchor = '        sb.append("V9.5.33 GUNLUK ADAPTIF HARITA PROTOKOLU'
    idx = a.find(prompt_anchor)
    if idx < 0:
        raise SystemExit('v9.5.34 adaptive prompt anchor missing')
    line_start = a.rfind('\n', 0, idx) + 1
    extra = r'''        sb.append("V9.5.34 CYCLE REARM NETLESTIRME: Normal TP3/STOP veya Binance manuel/harici kapanis SONRASI yeni ChatGPT plani ISTEME. Mevcut DAY_MODE=ADAPTIF plan korunur. Sonuc arsivlenir, en az bir tamamen yeni 15m mum tamamlanir ve ayni planin 3m/5m/15m/30m/45m/1h/4h/1D dallari yeniden degerlendirilir. Yalniz genis yapisal harita bozulduysa, ana rejim temelden degistiyse veya plan seviyeleri tuketilip anlamsizlastiysa YENI ANALIZ GEREKIR.\n\n");
'''
    a = a[:line_start] + extra + a[line_start:]
ANALYSIS.write_text(a)

# ---------------------------------------------------------------------------
# 4) Version bump.
# ---------------------------------------------------------------------------
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 26091205', b, count=1)
b = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.34'", b, count=1)
BUILD.write_text(b)

# Sanity.
mon = MON.read_text()
main = MAIN.read_text()
ana = ANALYSIS.read_text()
build = BUILD.read_text()
checks = {
    'legacy future text removed': OLD not in mon,
    'new lifecycle text': 'GÜNLÜK ADAPTİF plan korunur' in mon,
    'persisted text render migration': 'V9534_DAILY_REARM_UI' in main and OLD in main and 'GÜNLÜK ADAPTİF plan korunur' in main,
    'dynamic post-close status': 'Günlük plan: KORUNUYOR' in main and 'Günlük plan: AKTİF' in main,
    'uses v9533 rearm state': 'v9533_cycle_rearm_after_' in main,
    'prompt no-repaste contract': 'V9.5.34 CYCLE REARM NETLESTIRME' in ana and 'yeni ChatGPT plani ISTEME' in ana,
    'version code': 'versionCode 26091205' in build,
    'version name': "versionName '9.5.34'" in build,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.34 sanity failed: ' + ', '.join(bad))
print('v9.5.34 OK: daily adaptive plan survives normal cycle completion; UI no longer asks for a new plan after every trade.')
