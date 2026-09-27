from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'; MON=JAVA/'MonitorService.java'; ANALYSIS=JAVA/'AnalysisPackActivity.java'; BUILD=APP/'app/build.gradle'
for p in (MAIN,MON,ANALYSIS,BUILD):
    if not p.exists(): raise SystemExit('v9.5.57b missing: '+str(p))

def balance(text,label):
    braces=parens=brackets=0;i=0;ins=inc=esc=lc=bc=False
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

for label,p in (('MainActivity.java',MAIN),('MonitorService.java',MON),('AnalysisPackActivity.java',ANALYSIS)):
    balance(p.read_text(),label)
main=MAIN.read_text();mon=MON.read_text();ana=ANALYSIS.read_text();bld=BUILD.read_text()
checks={
    'scenario not real signal':'SENARYO / ANA KARAR (GERÇEK SİNYAL DEĞİL)' in main,
    'no-signal explicit':'GERÇEK SİNYAL YOK • ANA KARAR yalnız aday senaryodur' in main,
    'terminal history':'V9557_SIGNAL_LIFECYCLE_EXPLAIN' in main and 'SON SONLANAN GERÇEK SİNYALLER' in main,
    'order not sent visible':'Emir durumu: GÖNDERİLMEDİ • kullanıcı onayı bekleniyor.' in main,
    'order sent visible':'Emir durumu: GÖNDERİLDİ • Binance pozisyon/account sync ayrıca doğrulanır.' in main,
    'manual terminal source retained':'v9518_signal_state_' in main and 'v9518_signal_end_' in main,
    'notification terminal source retained':'v9541_last_terminal_' in main,
    'validity card retained':'V9551_VALIDITY_LIFECYCLE_UI' in main,
    'adaptive momentum retained':'V9556_ADAPTIVE_MOMENTUM_REBASE' in mon,
    'no unattended order changed':'V9543C_SINGLE_TAP_APPROVAL' in main and '⚡ ONAYLA & GÖNDER' in main,
    'signal persistence retained':'v9518_signal_active_' in mon and 'v9543b_strict_ticket_' in main,
    'daily adaptive retained':'DAY_MODE=ADAPTIF' in ana and 'REARM:FRESH_15M' in ana,
    'version main':'v9.5.57' in main,
    'version build':'versionCode 26091405' in bld and "versionName '9.5.57'" in bld,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.57b sanity failed: '+', '.join(bad))
# Explanation helper must be observational only.
a=main.find('V9557_SIGNAL_LIFECYCLE_EXPLAIN')
helper=main[a:] if a>=0 else ''
for forbidden in ('/fapi/v1/order','STOP_MARKET','TAKE_PROFIT_MARKET','cancelOrder','v9522ExecuteOrder('):
    if forbidden in helper: raise SystemExit('v9.5.57b explanation helper side effect: '+forbidden)
print('v9.5.57b OK: scenario/real-signal/order states are distinct and recent terminal reasons remain visible; no trading decision or auto-order change.')
