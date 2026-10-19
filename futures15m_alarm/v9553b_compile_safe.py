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
        raise SystemExit('v9.5.53b missing: ' + str(p))


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

for label, p in (
    ('MainActivity.java', MAIN), ('MonitorService.java', MON),
    ('AnalysisPackActivity.java', ANALYSIS), ('MarketRadarActivity.java', RADAR),
    ('V9538MarketRadarEngine.java', ENGINE), ('V9547BatchSelector.java', SELECTOR),
):
    balance(p.read_text(), label)

main = MAIN.read_text()
mon = MON.read_text()
ana = ANALYSIS.read_text()
bld = BUILD.read_text()

checks = {
    'v9553 monitor marker': 'V9553_BREAKOUT_ACCEPTANCE_STRUCTURAL_STOP' in mon,
    'weak 15m acceptance': 'through<atr15*0.15' in mon and 'body<0.35 || oppWick>0.40' in mon,
    'long immediate gate': 'V9553_LB_ACCEPTANCE_GATE' in mon and 'v9553LbGate.immediate' in mon,
    'short immediate gate': 'V9553_SB_ACCEPTANCE_GATE' in mon and 'v9553SbGate.immediate' in mon,
    'structural swing stop': 'v9553Recent5mSwing' in mon and 'stop<=swing-buffer' in mon and 'stop>=swing+buffer' in mon,
    'runtime rr retained': 'r1<1.0 || r2<1.5' in mon,
    'late expansion flow family': 'v9553LateExpansion' in mon and 'v9517StableFlow(symbol,lng,market,false)' in mon,
    'forced 5m reentry': 'v9553NeedsRetest(p.symbol,true)' in mon and 'v9553NeedsRetest(p.symbol,false)' in mon,
    'dynamic retest still structural': 'v9525FindRetest' in mon and '(t1-live)/risk<1.0' in mon and '(live-t1)/risk<1.0' in mon,
    'open candle still excluded': 'closeTime>=now' in mon,
    '45m window retained': '45L*60L*1000L' in mon,
    'same-symbol lifecycle retained': 'V9533_SYMBOL_LIFECYCLE_LOCK' in mon and 'v9533CycleReady' in mon,
    'read-only wait ui': 'V9553_RETEST_GUARD_UI' in main and 'V9553_RETEST_GUARD_PANEL' in main,
    'wait state refreshes without restart': 'k.startsWith("v9553_retest_")' in main,
    'new plan clears wait flag': 'v9553_retest_at_' in main and 'v953ResetSignalLocks' in main,
    'prompt weak acceptance': 'V9.5.53 ZAYIF KIRILIM KABULU' in ana and "0.15 ATR" in ana,
    'prompt structural stop': 'V9.5.53 YAPISAL STOP DOGRULAMA' in ana,
    'prompt late expansion': 'V9.5.53 GEC GENISLEME KURALI' in ana,
    'daily plan still not auto renewed': 'DAY_MODE=ADAPTIF' in ana and 'Günlük analizler OTOMATİK YENİLENMEZ' in main,
    'signal persistence retained': 'v9543b_strict_ticket_' in main and 'v9518_signal_active_' in mon,
    'execution drift retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'live account sync retained': 'V9543_LIVE_ACCOUNT_POLL' in main and 'postDelayed(this, 5000L)' in main,
    'v9552 live trade card retained': 'V9552_LIVE_OPEN_TRADE_CARD' in main,
    'validity ui retained': 'V9551_VALIDITY_LIFECYCLE_UI' in main,
    'radar 9 retained': '9 coin' in main.lower() or '9 COİN' in main,
    'version main': 'v9.5.53' in main,
    'version build': 'versionCode 26091401' in bld and "versionName '9.5.53'" in bld,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.53b sanity failed: ' + ', '.join(bad))

# v9.5.53 must never regenerate/delete a plan or auto-place orders. It may only
# gate the existing breakout signal and hand control to the existing 5m retest.
start = main.find('V9553_RETEST_GUARD_UI')
ui = main[start:main.rfind('}')] if start >= 0 else ''
for forbidden in ('AnalysisPackActivity.class', 'buildPack(', '/fapi/v1/order', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'):
    if forbidden in ui:
        raise SystemExit('v9.5.53b UI helper has forbidden side effect: ' + forbidden)

print('v9.5.53b OK: completed-15m core retained; weak acceptance/late expansion/structural-stop issues force fresh 5m retest without rewriting daily plans.')