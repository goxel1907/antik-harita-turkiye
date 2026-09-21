from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
ANALYSIS = APP / 'app/src/main/java/com/futuresalarm/app/AnalysisPackActivity.java'
if not ANALYSIS.exists():
    raise SystemExit('v9.5.25d missing AnalysisPackActivity.java')

a = ANALYSIS.read_text()
# v9525 appends an example to an existing Java string. Remove the decorative
# inner quotation marks so the generated Java remains syntactically valid.
a = a.replace('örn. "5m aktif FVG/Fib kümesinde tamamlanmış 5m geri kazanım" gibi',
              'örn. 5m aktif FVG/Fib kümesinde tamamlanmış 5m geri kazanım gibi')
a = a.replace('orn. "5m aktif FVG/Fib kumesinde tamamlanmis 5m geri kazanim" gibi',
              'orn. 5m aktif FVG/Fib kumesinde tamamlanmis 5m geri kazanim gibi')
ANALYSIS.write_text(a)
out = ANALYSIS.read_text()
if '"5m aktif FVG/Fib kümesinde tamamlanmış 5m geri kazanım"' in out:
    raise SystemExit('v9.5.25d inner WAIT quotes still present')
print('v9.5.25d OK: WAIT example is Java-string safe.')
