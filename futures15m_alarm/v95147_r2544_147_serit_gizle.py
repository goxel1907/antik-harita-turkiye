"""R2544.147 (user 11.11 01:50: the two bottom bars "🔥 ERKEN İLGİ / ÇOK KONUŞULAN" and "📡 FUTURES RADAR keşif listesi" crossed out: "gizle").
Source-generation patch after V95146. The bars are built by old patches (V9538-V9547) in several places, so instead of editing each one
the main screen hides the two views on every refresh (found by their text). The AJAN and ÜSTE buttons stay. Text/visibility only.
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95147_R2544_147_SERIT_GIZLE'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95147 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95146_R2544_147_POZ_KART' not in main:
    raise SystemExit('V95147 requires V95146')
if MARKER in main:
    raise SystemExit('V95147 already applied')

main = replace(main,
    '        try { v95146InstallPositionCard(); } catch (Throwable ignored) {} // V95146_R2544_147_POZ_KART',
    '        try { v95146InstallPositionCard(); } catch (Throwable ignored) {} // V95146_R2544_147_POZ_KART\n'
    '        try { v95147HideBars(getWindow().getDecorView()); } catch (Throwable ignored) {} // V95147_R2544_147_SERIT_GIZLE')

methods = r'''    // V95147_R2544_147_SERIT_GIZLE: hide the "ERKEN İLGİ / ÇOK KONUŞULAN" and "FUTURES RADAR" bars (the user crossed them out)
    private void v95147HideBars(android.view.View v) {
        if (v == null) return;
        if (v instanceof android.widget.TextView) {
            CharSequence cs = ((android.widget.TextView) v).getText();
            String s = cs == null ? "" : cs.toString();
            if ((s.startsWith("🔥 ERKEN İLGİ") || s.startsWith("📡 FUTURES RADAR")) && v.getVisibility() != android.view.View.GONE) v.setVisibility(android.view.View.GONE);
        }
        if (v instanceof android.view.ViewGroup) {
            android.view.ViewGroup g = (android.view.ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) v95147HideBars(g.getChildAt(i));
        }
    }

    private void v95142SubLane(final String key, final String label) {
'''
main = replace(main, '    private void v95142SubLane(final String key, final String label) {\n', methods)

build = replace(build, 'versionCode 26111005', 'versionCode 26111006')
build = replace(build, "versionName '9.5.138-r2544.147-pozkart'", "versionName '9.5.139-r2544.147-sade'")

MAIN.write_text(main, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
