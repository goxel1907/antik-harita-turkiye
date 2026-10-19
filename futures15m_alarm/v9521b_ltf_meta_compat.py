from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
ANALYSIS = APP / 'app/src/main/java/com/futuresalarm/app/AnalysisPackActivity.java'
if not ANALYSIS.exists():
    raise SystemExit('v9.5.21b missing AnalysisPackActivity.java')

a = ANALYSIS.read_text()

# v9.5.21 adds LP/LB/SR/SB status keys between CONFLUENCE and WAIT.
# v9.5.22a originally expected the older META layout, so its exact-string
# replacement could not insert TF5M/TF3M/LTF and the sanity check stopped.
# Insert the lower-timeframe keys directly while preserving all scenario states.
if 'TF5M:' not in a:
    a = a.replace('TF15:;TF1H:', 'TF15:;TF5M:;TF3M:;TF1H:')

if 'LTF:<KAPALI/5M_BEKLE/5M_UYGUN>' not in a:
    if ';CONFLUENCE:;LP_DURUM:' in a:
        a = a.replace(';CONFLUENCE:;LP_DURUM:',
                      ';CONFLUENCE:;LTF:<KAPALI/5M_BEKLE/5M_UYGUN>;LP_DURUM:')
    elif ';CONFLUENCE:;WAIT:' in a:
        a = a.replace(';CONFLUENCE:;WAIT:',
                      ';CONFLUENCE:;LTF:<KAPALI/5M_BEKLE/5M_UYGUN>;WAIT:')

ANALYSIS.write_text(a)

out = ANALYSIS.read_text()
checks = [
    ('TF5M:' in out and 'TF3M:' in out, 'TF5M/TF3M META keys'),
    ('LTF:<KAPALI/5M_BEKLE/5M_UYGUN>' in out, 'LTF META key'),
    ('LP_DURUM:<UYGUN/BEKLE/GECERSIZ>' in out, 'LP status preserved'),
    ('LB_DURUM:<UYGUN/BEKLE/GECERSIZ>' in out, 'LB status preserved'),
    ('SR_DURUM:<UYGUN/BEKLE/GECERSIZ>' in out, 'SR status preserved'),
    ('SB_DURUM:<UYGUN/BEKLE/GECERSIZ>' in out, 'SB status preserved'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.21b compatibility failed: ' + name)
print('v9.5.21b OK: lower-timeframe META keys inserted without dropping scenario states.')
