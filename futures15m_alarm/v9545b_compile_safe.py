from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
MON = JAVA / 'MonitorService.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, ANALYSIS, MON, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.45b missing: ' + str(p))


def java_balance(text, label):
    braces = parens = brackets = 0
    i = 0
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(text):
        c = text[i]
        n = text[i+1] if i + 1 < len(text) else ''
        if line_comment:
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': braces += 1
            elif c == '}':
                braces -= 1
                if braces < 0: raise SystemExit(label + ': extra }')
            elif c == '(': parens += 1
            elif c == ')':
                parens -= 1
                if parens < 0: raise SystemExit(label + ': extra )')
            elif c == '[': brackets += 1
            elif c == ']':
                brackets -= 1
                if brackets < 0: raise SystemExit(label + ': extra ]')
        i += 1
    if in_str or in_chr or block_comment:
        raise SystemExit(label + ': unterminated string/char/comment')
    if braces or parens or brackets:
        raise SystemExit(f'{label}: unbalanced braces={braces} parens={parens} brackets={brackets}')


# Avoid a method-reference edge case on older Android Java desugaring; lambda is simpler.
m = MAIN.read_text()
m = m.replace('sv.getViewTreeObserver().addOnScrollChangedListener(vis::run);',
              'sv.getViewTreeObserver().addOnScrollChangedListener(() -> vis.run());')
MAIN.write_text(m)

main = MAIN.read_text()
ana = ANALYSIS.read_text()
mon = MON.read_text()
bf = BUILD.read_text()

java_balance(main, 'MainActivity.java')
java_balance(ana, 'AnalysisPackActivity.java')
java_balance(mon, 'MonitorService.java')

checks = {
    'batch marker': 'V9545_BATCH_ANALYSIS' in main and 'V9545_BATCH_ANALYSIS' in ana,
    'top overlay marker': 'V9545_TOP_OVERLAY' in main and 'v9545_top_overlay' in main,
    'coin navigator retained': 'V9544_COIN_JUMP_NAV' in main and 'v9544ScrollToCoin' in main,
    'radar retained': 'FUTURES RADAR' in main or 'v9540EnsureRadarCard' in main,
    'portfolio retained': 'PORTFÖY / 24 SAAT' in main,
    'signal persistence retained': 'v9543b_strict_ticket_' in main,
    'quick explicit order retained': 'V9543C_SINGLE_TAP_APPROVAL' in main and 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'late-entry cap retained': 'dv>0.50' in main and 'dev > 0.50' in main,
    'batch sequential existing engine': 'v9545BatchInternalKick' in ana and 'buildPack();' in ana,
    'batch 2-8 limit': 'unique.size() >= 8' in ana and 'selected.size() < 2 || selected.size() > 8' in main,
    'master dedupe with fallback': 'ORTAK MASTER PROTOKOL' in ana and 'Never drop data just to deduplicate' in ana,
    'multi-image handoff': 'ACTION_SEND_MULTIPLE' in ana and 'putParcelableArrayListExtra' in ana,
    'bulk plan wording': 'Tekli / toplu yapıştır' in main,
    'freshness advisory wording': 'sinyal filtresi değildir' in main,
    'version main': 'v9.5.45' in main,
    'version analysis': 'v9.5.45' in ana,
    'version build': 'versionCode 26091309' in bf and "versionName '9.5.45'" in bf,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.45b sanity failed: ' + ', '.join(bad))

for forbidden in ('V9545_AUTO_ORDER', 'v9545AutoOrder', 'AUTO ORDER V9545'):
    if forbidden in main or forbidden in ana:
        raise SystemExit('v9.5.45b forbidden unattended-order marker: ' + forbidden)

print('v9.5.45b OK: Java lexical balance + feature-retention guards passed. Trading core and explicit-order safety markers remain present.')
