from pathlib import Path
import subprocess, sys

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
MON = JAVA / 'MonitorService.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, ANALYSIS, MON, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.46b missing: ' + str(p))


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

main = MAIN.read_text()
ana = ANALYSIS.read_text()
mon = MON.read_text()
bf = BUILD.read_text()

java_balance(main, 'MainActivity.java')
java_balance(ana, 'AnalysisPackActivity.java')
java_balance(mon, 'MonitorService.java')

checks = {
    'delete button': 'V9546_DELETE_SHORTCUT_BUTTON' in main and '🗑 ANALİZ SİL' in main,
    'delete picker': 'v9546ShowDeletePicker' in main and 'setItems(labels' in main,
    'long press': 'V9546_LONG_PRESS_DELETE' in main and 'setOnLongClickListener' in main,
    'existing delete proxy': 'v9546FindDeleteControl' in main and 'del.performClick()' in main,
    'safe fallback': 'mevcut silme düğmesi otomatik bulunamadı' in main and 'v9544ScrollToCoin(sym)' in main,
    'no direct preference deletion': 'V9546_DIRECT_STORAGE_DELETE' not in main,
    'coin navigator retained': 'V9544_COIN_JUMP_NAV' in main and 'v9544ScrollToCoin' in main,
    'batch retained': 'V9545_BATCH_ANALYSIS' in main and 'V9545_TOP_OVERLAY' in main,
    'radar retained': 'FUTURES RADAR' in main or 'v9540EnsureRadarCard' in main,
    'portfolio retained': 'PORTFÖY / 24 SAAT' in main,
    'signal persistence retained': 'v9543b_strict_ticket_' in main,
    'quick explicit order retained': 'V9543C_SINGLE_TAP_APPROVAL' in main and 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'late-entry cap retained': 'dv>0.50' in main and 'dev > 0.50' in main,
    'version main': 'v9.5.46' in main,
    'version analysis': 'v9.5.46' in ana,
    'version build': 'versionCode 26091310' in bf and "versionName '9.5.46'" in bf,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.46b sanity failed: ' + ', '.join(bad))

for forbidden in ('V9546_AUTO_ORDER', 'v9546AutoOrder', 'V9546_DIRECT_STORAGE_DELETE'):
    if forbidden in main or forbidden in ana or forbidden in mon:
        raise SystemExit('v9.5.46b forbidden marker: ' + forbidden)

print('v9.5.46b OK: delete shortcut is UI-only, existing delete semantics reused, trading safety retained.')

# Fold the batch-selector UX correction into the same v9.5.46 artifact so the
# Codemagic chain/artifact name stays aligned with the visible app version.
repo_root = Path(__file__).resolve().parent
for patch in ('v9546c_batch_selector_fix.py', 'v9546d_batch_selector_compile_safe.py'):
    p = repo_root / patch
    if not p.exists():
        raise SystemExit('v9.5.46b chained patch missing: ' + str(p))
    print('--- chained patch:', patch)
    subprocess.run([sys.executable, str(p)], check=True)
