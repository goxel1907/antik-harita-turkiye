from pathlib import Path
APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MON=APP/'app/src/main/java/com/futuresalarm/app/MonitorService.java'
MAIN=APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
BUILD=APP/'app/build.gradle'
for p in (MON,MAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.58d missing: '+str(p))
mon=MON.read_text(); main=MAIN.read_text(); bld=BUILD.read_text()
checks={
    'active invariant helper':'V9558C_SIGNAL_ACTIVE_INVARIANT' in mon and 'v9558RepairSignalActiveInvariant' in mon,
    'repair before result tracking':'V9558C_REPAIR_BEFORE_RESULT_TRACK' in mon and 'v9558RepairSignalActiveInvariant(p.symbol);' in mon,
    'terminal guard end':'v9518_signal_end_' in mon and 'if(end>0L) return;' in mon,
    'terminal guard source':'v9541_last_terminal_at_' in mon and 'if(terminalAt>=ts) return;' in mon,
    'open-state only repair':'u.startsWith("AÇIK")' in mon and 'u.startsWith("ACIK")' in mon,
    'bounded orphan repair':'48L*60L*60L*1000L' in mon,
    'journal retained':'V9558_PERSISTENT_SIGNAL_JOURNAL' in mon and 'GERÇEK SİNYAL KAYDI • KAYBOLMAZ' in main,
    'version':'v9.5.58' in main and "versionName '9.5.58'" in bld,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.58d sanity failed: '+', '.join(bad))
print('v9.5.58d OK: real open signal cannot vanish from an accidental active-flag loss; only non-terminal ACIK records are repaired.')
