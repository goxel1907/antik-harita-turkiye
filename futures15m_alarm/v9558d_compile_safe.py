from pathlib import Path
import runpy

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MON=JAVA/'MonitorService.java'
MAIN=JAVA/'MainActivity.java'
BUILD=APP/'app/build.gradle'
for p in (MON,MAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.58d missing: '+str(p))

# ---------------------------------------------------------------------------
# JAVA LITERAL SANITIZER
# v9.5.57 terminal-history helper was generated from a Python raw string with
# Java char literal '\\n' double-escaped as '\\\\n'. In Java a char literal may
# contain one escaped character (e.g. '\n'), not an escaped backslash plus 'n'.
# javac therefore reports exactly: unclosed character literal (x2) + not a
# statement. Repair only these known presentation char literals; trading values,
# lifecycle state and order logic are untouched.
# ---------------------------------------------------------------------------
repaired=[]
for p in JAVA.glob('*.java'):
    s=p.read_text()
    n=s
    for esc in ('n','r','t'):
        bad="'\\\\"+esc+"'"   # Java source: '\\n' / '\\r' / '\\t' (invalid char literal)
        good="'\\"+esc+"'"     # Java source: '\n' / '\r' / '\t' (valid escaped char)
        n=n.replace(bad,good)
    if n!=s:
        p.write_text(n)
        repaired.append(p.name)
print('v9.5.58d Java char-literal repairs:', repaired if repaired else 'none needed')

# Hard fail if a double-escaped one-character literal survives.
for p in JAVA.glob('*.java'):
    s=p.read_text()
    leftovers=[]
    for esc in ('n','r','t'):
        bad="'\\\\"+esc+"'"
        if bad in s: leftovers.append(bad)
    if leftovers:
        raise SystemExit('v9.5.58d invalid Java char literal remains in '+p.name+': '+', '.join(leftovers))

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

# Presentation-only follow-up: render escaped newline tokens in dynamic signal
# descriptions as real UI line breaks. Keep Codemagic wiring stable by chaining
# through this already-wired v9558d guard.
ROOT=Path(__file__).resolve().parent
runpy.run_path(str(ROOT/'v9558e_signal_text_newline_fix.py'),run_name='__main__')
runpy.run_path(str(ROOT/'v9558f_compile_safe.py'),run_name='__main__')

# v9.5.59 lost-breakout follow-up. This is entry-validity only: a confirmed 15m
# scenario cannot emit an immediate entry after live price loses its trigger.
# No day-profit, trailing-profit or PnL-based protection is added.
runpy.run_path(str(ROOT/'v9559_day_profit_breakout_guard.py'),run_name='__main__')
# Defense-in-depth/idempotent sanity layer. The main v9.5.59 patch already writes
# these markers; this script verifies the same invariant without adding PnL logic.
runpy.run_path(str(ROOT/'v9559b_lost_trigger_retest_fix.py'),run_name='__main__')

# Re-run the literal check after all follow-up patching as well.
for p in JAVA.glob('*.java'):
    s=p.read_text()
    for esc in ('n','r','t'):
        bad="'\\\\"+esc+"'"
        if bad in s:
            raise SystemExit('v9.5.58d post-followup invalid Java char literal in '+p.name+': '+bad)

mon=MON.read_text(); main=MAIN.read_text(); bld=BUILD.read_text()
checks59={
    'v9559 live breakout acceptance':'V9559_BREAKOUT_LIVE_ACCEPTANCE' in mon,
    'v9559 lost-trigger rearm':'V9559B_LB_LOST_TRIGGER_REARM' in mon and 'V9559B_SB_LOST_TRIGGER_REARM' in mon,
    'v9559 no day-profit guard':'V9559_DAY_PROFIT_RISK_GUARD' not in main,
    'v9559 no PnL order guards':'V9559_PREPARE_ORDER_RISK_GUARD' not in main and 'V9559_FINAL_ORDER_RISK_RECHECK' not in main,
    'v9559 version':'v9.5.59' in main and "versionName '9.5.59'" in bld,
}
for k,v in checks59.items(): print(('OK   ' if v else 'FAIL '),k)
bad59=[k for k,v in checks59.items() if not v]
if bad59: raise SystemExit('v9.5.59 chained sanity failed: '+', '.join(bad59))
print('v9.5.59 chained patch OK: live breakout acceptance + 5m reclaim wait active; no profit/day-PnL protection added.')

# v9.5.60 provenance follow-up. This intentionally adds no signal gate or new
# order-book score; it hardens what the existing data is allowed to mean.
runpy.run_path(str(ROOT/'v9560_orderflow_provenance.py'),run_name='__main__')

main=MAIN.read_text(); bld=BUILD.read_text()
if 'v9.5.60' not in main or "versionName '9.5.60'" not in bld:
    raise SystemExit('v9.5.60 chained version sanity failed')
print('v9.5.60 chained patch OK: source provenance contract applied after v9.5.59 checks.')
