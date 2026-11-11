"""R2544.147 (11.11 02:08: the user saved the phone's OTO dialog only to change the margin; LIVE was stopped and its auto-renew ended).
Source-generation patch after V95147. Root cause: since V95113 saving the dialog with its box unchecked calls
v95113StopAndVerify("ANDROID_AUTO_OFF") = PC LIVE disarm. V95144 (my change) made the box show the PC's NORMAL system state, which is
off while only İlk 3 / ZİRVE-5 run - so every plain KAYDET stopped LIVE. Now:
  - KAYDET never stops PC LIVE. The box only switches the normal system (JEV lane) through the same config call; İlk 3 / ZİRVE-5 keep
    running. Stopping everything stays on the lanes card ("Durdur", "TEST'e dön") and on ACİL DURDUR.
  - the toast says what was saved instead of "KAPATILIYOR • PC LIVE ...".
Android stays a PC control/telemetry client: it never initiates an order.
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95148_R2544_147_KAYDET'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95148 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95147_R2544_147_SERIT_GIZLE' not in main:
    raise SystemExit('V95148 requires V95147')
if MARKER in main:
    raise SystemExit('V95148 already applied')

main = replace(main,
    'if(!v95113AutoOn&&v95113Hub)v95113StopAndVerify("ANDROID_AUTO_OFF",null);',
    '/* V95148_R2544_147_KAYDET: saving this dialog never stops PC LIVE (the box is the normal system only; İlk 3 / ZİRVE-5 keep running) */')
main = replace(main,
    'Toast.makeText(this,v95113AutoOn?"OTO AÇMA AYARI KAYDEDİLDİ • LIVE yalnız PC onayıyla açılır":"KAPATILIYOR • PC LIVE + LEADER AUTO onayı bekleniyor",Toast.LENGTH_LONG).show();',
    'Toast.makeText(this,"Ayar kaydedildi • Normal sistem (JEV): "+(v95113AutoOn?"AÇIK":"KAPALI")+" • İlk 3 / ZİRVE-5 ve CANLI durumu değişmez",Toast.LENGTH_LONG).show();')

build = replace(build, 'versionCode 26111006', 'versionCode 26111101')
build = replace(build, "versionName '9.5.139-r2544.147-sade'", "versionName '9.5.140-r2544.147-kaydet'")

MAIN.write_text(main, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
