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
        raise SystemExit('v9.5.55b missing: ' + str(p))


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

main=MAIN.read_text()
mon=MON.read_text()
ana=ANALYSIS.read_text()
ana_lower=ana.lower()
bld=BUILD.read_text()

checks={
    'multi path prompt': 'COKLU EXECUTION YOLLARI' in ana and 'RETEST_RECLAIM' in ana and 'SWEEP_RECLAIM' in ana and 'DISPLACEMENT_ACCEPTANCE' in ana,
    'compression and micro bos': 'COMPRESSION_BREAK' in ana and 'MICRO_BOS/CHOCH' in ana,
    'retest not mandatory': '5m retest yalnızca BİR execution yoludur' in ana and '5m retest zorunlu değildir' in ana,
    # Turkish sentence begins with "Aynı" in the MASTER prompt. Keep this
    # semantic check case-insensitive so a capitalization-only text change does
    # not fail the build while the family-cap rule is actually present.
    'family cap retained': 'EXECUTION AILE SINIRI' in ana and 'aynı mikro hareketten' in ana_lower,
    'crowding squeeze matrix': 'CROWDING/SQUEEZE MATRISI' in ana and 'SHORT_SQUEEZE' in ana and 'LONG_SQUEEZE' in ana,
    'top mover trap': 'TOP-MOVER CONTRARIAN TRAP' in ana and 'Çok yükseldi -> SHORT' in ana,
    'failed auction': 'TIME-AT-LEVEL / FAILED-AUCTION' in ana,
    'liquidity not trigger': 'LIKIDITE HEDEF, TEK BASINA TETIK DEGIL' in ana,
    'scenario execution confidence split': 'SENARYO GUVENI / EXECUTION GUVENI' in ana and 'SCENARIO_CONF' in ana and 'EXEC_CONF' in ana,
    'volatility normalized': 'VOLATILITEYE UYARLAN' in ana and 'ATR/tick/son salınım' in ana,
    'meta additions': all(x in ana for x in ('MOVE_STATE','CROWDING','SQUEEZE_RISK','EXEC_PATH','TRAP_RISK')),
    '14 fields retained': '14 ALANLI' in ana,
    'daily adaptive retained': 'DAY_MODE=ADAPTIF' in ana and 'REARM:FRESH_15M' in ana,
    'minimum rr retained': 'TP1 >= 1.0R' in ana and 'TP2 >= 1.5R' in ana,
    'runtime multipath helper': 'V9555_MULTI_PATH_EXECUTION' in mon and 'v9555AlternativeExecution' in mon,
    'runtime family cap': 'families>=2' in mon and 'famAcceptance' in mon and 'famLiquidity' in mon and 'famStructure' in mon,
    'runtime squeeze support': 'v9555SqueezeSupport' in mon and 'SHORTS_AT_RISK' in mon and 'LONGS_AT_RISK' in mon,
    'hard hold cannot bypass': 'v9555HardHoldReason' in mon and 'r.contains("STOP")' in mon and 'r.contains("R/R")' in mon,
    'lb alternative gate': 'V9555_LB_MULTI_PATH_GATE' in mon and '(v9553LbGate.immediate || v9555LbAlternative)' in mon,
    'sb alternative gate': 'V9555_SB_MULTI_PATH_GATE' in mon and '(v9553SbGate.immediate || v9555SbAlternative)' in mon,
    'v9553 structural gate retained': 'V9553_BREAKOUT_ACCEPTANCE_STRUCTURAL_STOP' in mon and 'v9553Recent5mSwing' in mon,
    'dynamic reentry retained': 'v9525EvaluateDynamicReentry' in mon and '45L*60L*1000L' in mon,
    'same symbol lifecycle retained': 'V9533_SYMBOL_LIFECYCLE_LOCK' in mon and 'v9533CycleReady' in mon,
    'signal persistence retained': 'v9518_signal_active_' in mon and 'v9543b_strict_ticket_' in main,
    'ui wording generalized': 'çoklu execution teyidi bekleniyor (retest şart değil)' in main,
    'no automatic analysis launch': 'AnalysisPackActivity' not in mon,
    'version main': 'v9.5.55' in main,
    'version analysis': 'v9.5.55' in ana,
    'version build': 'versionCode 26091403' in bld and "versionName '9.5.55'" in bld,
}

for k,v in checks.items():
    print(('OK   ' if v else 'FAIL '),k)

bad=[k for k,v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.55b sanity failed: '+', '.join(bad))

print('v9.5.55b OK: retest is optional, multi-path execution and crowding/squeeze awareness are active, hard data/STOP/RR vetoes remain, daily plans are not auto-regenerated.')
