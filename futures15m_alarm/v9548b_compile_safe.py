from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
MON = JAVA / 'MonitorService.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
SELECTOR = JAVA / 'V9547BatchSelector.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, MON, RADAR, ENGINE, SELECTOR, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.48b missing: ' + str(p))


def java_balance(text, label):
    braces = parens = brackets = 0
    i = 0
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(text):
        c = text[i]
        n = text[i + 1] if i + 1 < len(text) else ''
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
radar = RADAR.read_text()
eng = ENGINE.read_text()
selector = SELECTOR.read_text()
bf = BUILD.read_text()

for label, text in (
    ('MainActivity.java', main),
    ('AnalysisPackActivity.java', ana),
    ('MonitorService.java', mon),
    ('MarketRadarActivity.java', radar),
    ('V9538MarketRadarEngine.java', eng),
    ('V9547BatchSelector.java', selector),
):
    java_balance(text, label)

checks = {
    'dynamic refresh helper': 'V9548_DYNAMIC_CARD_REFRESH' in main and 'v9548PostDynamicCardRefresh' in main,
    'refresh after import': 'V9548_REFRESH_AFTER_PLAN_IMPORT' in main,
    'refresh after UI rebuild': 'V9548_REINSTALL_AFTER_BUILDUI' in main,
    'quick nav retained': 'V9544_COIN_JUMP_NAV' in main and 'v9544ScrollToCoin' in main,
    'top overlay retained': 'V9545_TOP_OVERLAY' in main and 'v9545InstallTopOverlay' in main,
    'batch selector retained': 'V9547_SHARED_BATCH_SELECTOR' in main and 'final class V9547BatchSelector' in selector,
    'radar manual selector retained': 'RADAR_LIMIT = 9' in selector and 'MAX_BATCH = 8' in selector and 'MANUEL COİN GİRİŞİ' in selector,
    'delete shortcut retained': 'V9546_ANALYSIS_DELETE_SHORTCUT' in main,
    'radar 3+6 retained': 'stickySix(candidates)' in eng and 'sel.size()<6' in eng and '9 COİN MARKET RADARI' in radar,
    'portfolio retained': 'PORTFÖY / 24 SAAT' in main,
    'notification lock retained': 'v9543b_strict_ticket_' in main,
    'quick explicit order retained': 'V9543C_SINGLE_TAP_APPROVAL' in main,
    'late-entry cap retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in main and ('dv>0.50' in main or 'dev > 0.50' in main),
    'batch analysis engine retained': 'V9545_BATCH_FIELDS' in ana and 'V9545_BATCH_BUILD_GUARD' in ana,
    'version main': 'v9.5.48' in main,
    'version analysis': 'v9.5.48' in ana,
    'version build': 'versionCode 26091312' in bf and "versionName '9.5.48'" in bf,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.48b sanity failed: ' + ', '.join(bad))

for forbidden in ('V9548_AUTO_ORDER', 'v9548AutoOrder', 'V9548_DIRECT_STORAGE_DELETE'):
    if forbidden in main or forbidden in ana or forbidden in mon or forbidden in selector:
        raise SystemExit('v9.5.48b forbidden marker: ' + forbidden)

print('v9.5.48b OK: dynamic cards persist through plan import/rebuild; signal/order/radar safety retained.')
