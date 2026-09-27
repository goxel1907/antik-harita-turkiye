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
        raise SystemExit('v9.5.51b missing: ' + str(p))

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
    'v9550 targeted refresh retained': 'V9550_TARGETED_UI_REFRESH' in main,
    'v9550 lightweight loop retained': 'V9550C_LIGHTWEIGHT_DIRECT_NAV' in main,
    'no timer full rebuild': 'signalChanged || periodic' not in main,
    'validity card': 'V9551_VALIDITY_LIFECYCLE_UI' in main and 'v9551_validity_card' in main,
    'validity live refresh': 'V9551_VALIDITY_REFRESH_HOOK' in main,
    'daily plan is read-only': 'Günlük analizler OTOMATİK YENİLENMEZ' in main,
    '24h freshness': '24L * 60L * 60L * 1000L' in main,
    '45m reentry': '45L * 60L * 1000L' in main and '5m re-entry' in main,
    '120s data freshness rule': 'paket >120 sn eskiyse' in main,
    'exhaustion precedence': 'YENİ ANALİZ GEREKİR' in main and 'TÜKENME AŞAMASINDA' in main,
    'signal lifecycle': 'v9518_signal_active_' in main and 'v9518_signal_time_' in main,
    'notification persistence': 'v9543b_strict_ticket_' in main,
    'late entry hard check': 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'real trade card retained': 'V9549_RECENT_REAL_TRADES_CARD' in main,
    'batch selector retained': 'V9547_SHARED_BATCH_SELECTOR' in main,
    'quick nav retained': 'V9544_COIN_JUMP_NAV' in main,
    'version main': 'v9.5.51' in main,
    'version build': 'versionCode 26091315' in BUILD.read_text() and "versionName '9.5.51'" in BUILD.read_text(),
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.51b sanity failed: ' + ', '.join(bad))

# New validity UI must remain observational only.
a = main.find('V9551_VALIDITY_LIFECYCLE_UI')
ui = main[a:] if a >= 0 else ''
for forbidden in (
    'AnalysisPackActivity.class', 'startActivity(', 'buildPack(', 'openImportDialog(',
    '/fapi/v1/order', 'STOP_MARKET', 'TAKE_PROFIT_MARKET', 'cancelOrder',
    '.edit()',
):
    if forbidden in ui:
        raise SystemExit('v9.5.51b validity UI unexpectedly has side effect: ' + forbidden)

print('v9.5.51b OK: validity UI is read-only; analyses are not auto-refreshed/replaced; signal/order safety and v9.5.50 targeted updates remain intact.')
