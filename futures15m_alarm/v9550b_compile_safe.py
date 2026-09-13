from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
SELECTOR = JAVA / 'V9547BatchSelector.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, SELECTOR, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.50b missing: ' + str(p))

def balance(text, label):
    braces = parens = brackets = 0
    i = 0
    ins = inc = esc = lc = bc = False
    while i < len(text):
        c = text[i]
        n = text[i+1] if i+1 < len(text) else ''
        if lc:
            if c == '\n': lc = False
        elif bc:
            if c == '*' and n == '/': bc = False; i += 1
        elif ins:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': ins = False
        elif inc:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": inc = False
        else:
            if c == '/' and n == '/': lc = True; i += 1
            elif c == '/' and n == '*': bc = True; i += 1
            elif c == '"': ins = True
            elif c == "'": inc = True
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
    if ins or inc or bc or braces or parens or brackets:
        raise SystemExit(f'{label}: unbalanced braces={braces} parens={parens} brackets={brackets}')

main = MAIN.read_text()
for label, p in (
    ('MainActivity.java', MAIN), ('MonitorService.java', MON),
    ('AnalysisPackActivity.java', ANALYSIS), ('MarketRadarActivity.java', RADAR),
    ('V9538MarketRadarEngine.java', ENGINE), ('V9547BatchSelector.java', SELECTOR),
):
    balance(p.read_text(), label)

checks = {
    'targeted ui refresh': 'V9550_TARGETED_UI_REFRESH' in main,
    'no timer full redraw': 'signalChanged || periodic' not in main,
    'stable recent card': 'V9550_STABLE_DASHBOARD_HELPERS' in main and 'v9550NormalizeRecentTradeCardPosition' in main,
    'order open metadata': 'V9550_ORDER_OPEN_METADATA' in main and 'v9550_trade_margin_' in main,
    'zero margin not shown': '(Double.isNaN(r.margin) || r.margin <= 0.0)' in main,
    'roi derivation': '(r.pnl / r.margin) * 100.0' in main,
    'dynamic nav retained': 'V9548_DYNAMIC_CARD_REFRESH' in main and 'V9544_COIN_JUMP_NAV' in main,
    'batch retained': 'V9547_SHARED_BATCH_SELECTOR' in main,
    'recent real only': 'if (key.startsWith("v9518_")) continue' in main,
    'signal persistence retained': 'v9543b_strict_ticket_' in main,
    'late entry retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'position poll retained': 'V9543_LIVE_ACCOUNT_POLL' in main and 'postDelayed(this, 5000L)' in main,
    'geometry advisory retained': 'V9549_PLAN_GEOMETRY_ADVISORY' in main,
    'version main': 'v9.5.50' in main,
    'version build': 'versionCode 26091314' in BUILD.read_text() and "versionName '9.5.50'" in BUILD.read_text(),
}
for k,v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k,v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.50b sanity failed: ' + ', '.join(bad))

a = main.find('V9550_STABLE_DASHBOARD_HELPERS')
ui = main[a:] if a >= 0 else ''
for forbidden in ('/fapi/v1/order', 'STOP_MARKET', 'TAKE_PROFIT_MARKET', 'cancelOrder'):
    if forbidden in ui:
        raise SystemExit('v9.5.50b UI helper contains trading side effect: ' + forbidden)

print('v9.5.50b OK: targeted in-app updates, stable real-trade card, saved opening margin metadata; trading core retained.')
