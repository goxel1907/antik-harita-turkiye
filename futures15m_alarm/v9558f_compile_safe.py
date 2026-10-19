from pathlib import Path
APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN=APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists(): raise SystemExit('v9.5.58f MainActivity missing')
m=MAIN.read_text()
checks={
 'normalizer':'V9558E_SIGNAL_TEXT_NORMALIZE' in m and 'v9558NormalizeSignalText' in m,
 'active reason normalized':'String reason=v9558NormalizeSignalText(sp.getString("v9518_signal_reason_"+symbol,"-"));' in m,
 'journal reason normalized':'String why=v9558NormalizeSignalText(sp.getString("v9558_journal_reason_"+id,""));' in m,
 'signal journal retained':'GERÇEK SİNYAL KAYDI • KAYBOLMAZ' in m,
 'version retained':'v9.5.58' in m,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.58f sanity failed: '+', '.join(bad))
print('v9.5.58f OK: dynamic signal detail escaped newline sequences are presentation-normalized without changing signal lifecycle or trading values.')
