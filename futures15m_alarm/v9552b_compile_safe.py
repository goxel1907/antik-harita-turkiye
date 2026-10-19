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
        raise SystemExit('v9.5.52b missing: ' + str(p))

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
    'v9552 live open card': 'V9552_LIVE_OPEN_TRADE_CARD' in main and 'V9552_OPEN_ROW_AUTHORITATIVE_DISPLAY' in main,
    'live pnl reader': 'v9552LiveOpenPnl' in main and 'AÇIK|ACIK|OPEN|UNREALIZED' in main,
    'opening margin source': 'v9550_trade_margin_' in main and 'v9552OpeningMargin' in main,
    'open roi live': '(shownPnl / opening) * 100.0' in main,
    'no false realized-zero fallback for open': 'shownPnl = v9552LiveOpenPnl(r.symbol)' in main,
    'explicit open labels': 'Başlangıç marjı:' in main and 'Canlı PnL:' in main,
    'margin wording': 'pozisyon marj tahmini ≈' in main and 'kalan marj ≈' not in main,
    'age wording unambiguous': ' gün ' in main and ' saat' in main and '45 dk doldu' in main,
    'plan auto refresh still forbidden': 'Günlük analizler OTOMATİK YENİLENMEZ' in main,
    'validity retained': 'V9551_VALIDITY_LIFECYCLE_UI' in main,
    'stable ui retained': 'V9550_TARGETED_UI_REFRESH' in main and 'V9550C_LIGHTWEIGHT_DIRECT_NAV' in main,
    'account sync retained': 'V9543_LIVE_ACCOUNT_POLL' in main and 'postDelayed(this, 5000L)' in main,
    'signal persistence retained': 'v9543b_strict_ticket_' in main,
    'late entry retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'batch retained': 'V9547_SHARED_BATCH_SELECTOR' in main,
    'radar retained': '9 coin' in main.lower() or '9 COİN' in main,
    'version main': 'v9.5.52' in main,
    'version build': 'versionCode 26091316' in BUILD.read_text() and "versionName '9.5.52'" in BUILD.read_text(),
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.52b sanity failed: ' + ', '.join(bad))

# v9.5.52 helpers are display/read-only. They must not place/cancel orders or
# launch a new analysis. Existing trading code elsewhere is intentionally kept.
a = main.find('V9552_LIVE_OPEN_TRADE_CARD')
b = main.rfind('}')
ui = main[a:b] if a >= 0 else ''
for forbidden in (
    '/fapi/v1/order', 'STOP_MARKET', 'TAKE_PROFIT_MARKET', 'cancelOrder',
    'AnalysisPackActivity.class', 'buildPack(', 'openImportDialog(',
):
    if forbidden in ui:
        raise SystemExit('v9.5.52b display helper unexpectedly has side effect: ' + forbidden)

print('v9.5.52b OK: live open trade card truthfulness, starting-margin ROI, explicit validity wording and existing trading protections retained.')
