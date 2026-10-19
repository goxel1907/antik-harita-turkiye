from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'
MON=JAVA/'MonitorService.java'
ANALYSIS=JAVA/'AnalysisPackActivity.java'
RADAR=JAVA/'MarketRadarActivity.java'
ENGINE=JAVA/'V9538MarketRadarEngine.java'
SELECTOR=JAVA/'V9547BatchSelector.java'
BUILD=APP/'app/build.gradle'
for p in (MAIN,MON,ANALYSIS,RADAR,ENGINE,SELECTOR,BUILD):
    if not p.exists(): raise SystemExit('v9.5.56b missing: '+str(p))

def balance(text,label):
    braces=parens=brackets=0;i=0
    ins=inc=esc=lc=bc=False
    while i<len(text):
        c=text[i];n=text[i+1] if i+1<len(text) else ''
        if lc:
            if c=='\n': lc=False
        elif bc:
            if c=='*' and n=='/': bc=False;i+=1
        elif ins:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': ins=False
        elif inc:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=="'": inc=False
        else:
            if c=='/' and n=='/': lc=True;i+=1
            elif c=='/' and n=='*': bc=True;i+=1
            elif c=='"': ins=True
            elif c=="'": inc=True
            elif c=='{': braces+=1
            elif c=='}': braces-=1
            elif c=='(': parens+=1
            elif c==')': parens-=1
            elif c=='[': brackets+=1
            elif c==']': brackets-=1
            if braces<0 or parens<0 or brackets<0: raise SystemExit(label+': negative delimiter balance')
        i+=1
    if ins or inc or bc or braces or parens or brackets:
        raise SystemExit(f'{label}: unbalanced braces={braces} parens={parens} brackets={brackets}')

for label,p in (('MainActivity.java',MAIN),('MonitorService.java',MON),('AnalysisPackActivity.java',ANALYSIS),('MarketRadarActivity.java',RADAR),('V9538MarketRadarEngine.java',ENGINE),('V9547BatchSelector.java',SELECTOR)):
    balance(p.read_text(),label)

main=MAIN.read_text();mon=MON.read_text();ana=ANALYSIS.read_text();bld=BUILD.read_text()
checks={
    'adaptive rebase prompt':'YASAK YERINE ADAPTIF REBASE' in ana and 'REBASE_STATE=FRESH' in ana,
    'no cumulative move veto':'+%20/+%50/+%100' in ana and 'TEK BAŞINA continuation/reversal yasağı değildir' in ana,
    'dual hypothesis':'IKI HIPOTEZ AYNI ANDA' in ana and 'CONT_SCORE' in ana and 'REV_SCORE' in ana,
    'efficiency context':'TREND EFFICIENCY / PATH QUALITY' in ana and 'ER=|C_now-C_n|' in ana,
    'momentum relay':'MOMENTUM RELAY' in ana and 'Fresh rebase' in ana,
    'reversal relay':'REVERSAL RELAY' in ana and 'gerçek tepe/dip reversal' in ana,
    'extension reset':'EXTENSION RESET / LEG AGE' in ana and 'son FRESH REBASE anchor' in ana,
    'target exhaustion safe':'TARGET EXHAUSTION' in ana and 'MOMENTUM_RELAY_ANALYSIS_REQUIRED' in ana and 'yeni hedef UYDURMASIN' in ana,
    'overfit guard':'BASITLIK / OVERFIT KORUMASI' in ana and 'Hard veto sayısı yine yalnız dört' in ana,
    'crowding multiplier':'CROWDING YON DEGIL KUVVET CARPANI' in ana,
    'runtime rebase helper':'V9556_ADAPTIVE_MOMENTUM_REBASE' in mon and 'v9556ContinuationAnchor' in mon,
    'runtime efficiency':'v9556Efficiency' in mon and 'net/path' in mon,
    'runtime adaptive drift':'v9556FreshDriftBudget' in mon and 'cumulative % move is irrelevant' in mon,
    'fixed fresh chase removed':'live>c.c*1.0035' not in mon and 'live<c.c*0.9965' not in mon,
    'dynamic continuation alternative':'if(!rr.ok) rr=v9556ContinuationAnchor(m5,true,p.breakoutClose);' in mon and 'if(!rr.ok) rr=v9556ContinuationAnchor(m5,false,p.breakdownClose);' in mon,
    'old 5m reentry retained':'v9525FindRetest' in mon and 'v9525Recent15mConfirmation' in mon,
    'four hard-veto runtime retained':'v9555HardHoldReason' in mon and 'r.contains("STOP")' in mon and 'r.contains("R/R")' in mon,
    'structural stop guard retained':'V9553_BREAKOUT_ACCEPTANCE_STRUCTURAL_STOP' in mon and 'v9553Recent5mSwing' in mon,
    'same symbol lifecycle':'V9533_SYMBOL_LIFECYCLE_LOCK' in mon and 'v9533CycleReady' in mon,
    'daily adaptive retained':'DAY_MODE=ADAPTIF' in ana and 'REARM:FRESH_15M' in ana,
    '14 fields retained':'14 ALANLI' in ana,
    'minimum rr retained':'TP1 >= 1.0R' in ana and 'TP2 >= 1.5R' in ana,
    'signal persistence':'v9518_signal_active_' in mon and 'v9543b_strict_ticket_' in main,
    'version main':'v9.5.56' in main,
    'version analysis':'v9.5.56' in ana,
    'version build':'versionCode 26091404' in bld and "versionName '9.5.56'" in bld,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.56b sanity failed: '+', '.join(bad))
print('v9.5.56b OK: cumulative move is not a ban; current structure can rebase continuation, reversal remains possible with evidence, target exhaustion requests fresh analysis instead of inventing levels.')