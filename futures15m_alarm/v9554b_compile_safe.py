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
        raise SystemExit('v9.5.54b missing: ' + str(p))


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
    'location before direction': 'V9.5.54 KARAR SIRASI: ONCE KONUM, SONRA YON' in ana,
    'entry target path': 'V9.5.54 GIRIS-HEDEF YOL KONTROLU' in ana and 'GİRİŞ -> TP1 -> TP2 -> TP3' in ana,
    'extension changes execution not direction': 'V9.5.54 UZAMA MODU' in ana and 'tek başına işlem yasağı değildir' in ana,
    '15m confirmation separated from execution': 'V9.5.54 15M SENARYO TEYIDI ILE HEMEN GIRISI AYIR' in ana,
    'stop before rr': 'V9.5.54 STOP ONCE, RR SONRA' in ana and 'TP1 < 1R' in ana and 'TP2 < 1.5R' in ana,
    'four branch symmetry': 'V9.5.54 DORT DAL SIMETRISI' in ana,
    'anti choke': 'V9.5.54 SINYALI BOGMAMA' in ana and 'Amaç daha az işlem üretmek değil' in ana,
    'mandatory final audit': 'V9.5.54 ZORUNLU FINAL PLAN DENETIMI' in ana and 'UYGUN yazmak YASAKTIR' in ana,
    'long geometry': 'STOP < en kötü giriş < TP1 < TP2 < TP3' in ana,
    'short geometry': 'STOP > en kötü giriş > TP1 > TP2 > TP3' in ana,
    'minimum rr': 'TP1 >= 1.0R' in ana and 'TP2 >= 1.5R' in ana,
    'self check chain': 'V9.5.54 SELF-CHECK' in ana and 'Şimdi giriş mi, yoksa 5m retest mi?' in ana,
    'daily adaptive retained': 'DAY_MODE=ADAPTIF' in ana and 'REARM:FRESH_15M' in ana,
    'four scenario meta retained': all(x in ana for x in ('LP_DURUM','LB_DURUM','SR_DURUM','SB_DURUM')),
    '14 field format retained': '14 ALANLI' in ana,
    'v9553 runtime guard retained': 'V9553_BREAKOUT_ACCEPTANCE_STRUCTURAL_STOP' in mon,
    'v9553 structural stop runtime retained': 'v9553Recent5mSwing' in mon and 'r1<1.0 || r2<1.5' in mon,
    'dynamic 5m engine retained': 'v9525EvaluateDynamicReentry' in mon and '45L*60L*1000L' in mon,
    'same symbol lifecycle retained': 'V9533_SYMBOL_LIFECYCLE_LOCK' in mon and 'v9533CycleReady' in mon,
    'signal persistence retained': 'v9518_signal_active_' in mon and 'v9543b_strict_ticket_' in main,
    'live account sync retained': 'V9543_LIVE_ACCOUNT_POLL' in main,
    'radar retained': '9 coin' in main.lower() or '9 COİN' in main,
    'version main': 'v9.5.54' in main,
    'version analysis': 'v9.5.54' in ana,
    'version build': 'versionCode 26091402' in bld and "versionName '9.5.54'" in bld,
}

for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)

bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.54b sanity failed: ' + ', '.join(bad))

print('v9.5.54b OK: future MASTER prompts enforce location/path/structural-stop/RR/final-plan self-audit without auto-renewing or rewriting existing daily plans; v9.5.53 runtime guards remain intact.')