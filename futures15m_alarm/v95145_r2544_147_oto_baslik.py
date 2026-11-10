"""R2544.147 (user 10.11 23:44: "OTO AÇIK • PC AUTO SENKRON BEKLİYOR" while the PC's normal system was OFF by the user's choice).
Source-generation patch after V95144. The OTO card's first line came from the PHONE's old OTO flag, so it read "OTO AÇIK ... senkron
bekliyor" although nothing waits: the PC's normal system (JEV lane) was switched off and İlk 3 / ZİRVE-5 run on their own. The line now
says the PC state in plain words. Text only; it never sends anything.
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95145_R2544_147_OTO_BASLIK'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95145 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95144_R2544_147_ETIKET' not in main:
    raise SystemExit('V95145 requires V95144')
if MARKER in main:
    raise SystemExit('V95145 already applied')

main = replace(main,
    'else if(!pcAutoConfigured||!pcAutoEnabled) state="🟡 OTO AÇIK • PC AUTO SENKRON BEKLİYOR";',
    'else if(!pcAutoConfigured||!pcAutoEnabled) state="⚪ NORMAL SİSTEM (JEV) PC\'DE KAPALI • İlk 3 / ZİRVE-5 kendi hatlarında çalışır"; // V95145_R2544_147_OTO_BASLIK')

build = replace(build, 'versionCode 26111003', 'versionCode 26111004')
build = replace(build, "versionName '9.5.136-r2544.147-etiket'", "versionName '9.5.137-r2544.147-oto'")

MAIN.write_text(main, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
