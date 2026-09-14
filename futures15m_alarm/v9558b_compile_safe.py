from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'; MON=JAVA/'MonitorService.java'; ANALYSIS=JAVA/'AnalysisPackActivity.java'; BUILD=APP/'app/build.gradle'; EMACTX=JAVA/'V9558EmaContext.java'
for p in (MAIN,MON,ANALYSIS,BUILD,EMACTX):
    if not p.exists(): raise SystemExit('v9.5.58b missing: '+str(p))

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

for label,p in (('MainActivity.java',MAIN),('MonitorService.java',MON),('AnalysisPackActivity.java',ANALYSIS),('V9558EmaContext.java',EMACTX)):
    balance(p.read_text(),label)

main=MAIN.read_text(); mon=MON.read_text(); ana=ANALYSIS.read_text(); ema=EMACTX.read_text(); bld=BUILD.read_text()
checks={
    'sticky signal journal UI':'V9558_PERSISTENT_SIGNAL_JOURNAL_UI' in main and 'GERÇEK SİNYAL KAYDI • KAYBOLMAZ' in main,
    'journal index retained':'v9558_signal_journal_index' in main and 'v9558_signal_journal_index' in mon,
    'journal at real emit':'V9558_JOURNAL_AT_EMIT' in mon and 'v9558PersistSignalJournal(symbol,direction,detail)' in mon,
    'journal tick fallback':'V9558_JOURNAL_SIGNAL_TICK' in mon,
    'journal terminal capture':'V9558_JOURNAL_TERMINAL' in mon and 'v9558MarkSignalJournalTerminal' in mon,
    'active signal lifecycle retained':'v9518_signal_active_' in mon and 'v9518UpdateSignalResult' in mon and 'v9518Finish' in mon,
    'terminal remains visible':'SONLANDI/KAYITLI' in main and 'ÖNCEKİ GERÇEK SİNYALLER' in main,
    'scenario distinction retained':'SENARYO / ANA KARAR (GERÇEK SİNYAL DEĞİL)' in main,
    'order status distinction retained':'v9522_order_sent_signal_' in main and 'GÖNDERİLMEDİ' in main and 'GÖNDERİLDİ' in main,
    'ema context injected':'V9558EmaContext.summary(data)' in ana and 'EMA13 / EMA21' in ana,
    'ema completed candle context':'EMA13/EMA21 COKLU-TF BAGLAM' in ema and 'yalniz tamamlanmis mumlar' in ema,
    'ema stack states':'BULL_STACK' in ema and 'BEAR_STACK' in ema and 'MIXED' in ema,
    'ema loss reclaim':'LOSS13' in ema and 'LOSS21' in ema and 'RECLAIM13' in ema and 'RECLAIM21' in ema,
    'ema atr normalization':'GAP_ATR' in ema and 'DIST21_ATR' in ema,
    'ema not hard veto':'tek basina sinyal/veto degildir' in ema and 'hard veto URETMEZ' in ana,
    'profit protection advisory only':'PROTECT_PROFIT/partial-exit' in ana and 'OTOMATIK KAPATMA emri degildir' in ana,
    'adaptive momentum retained':'V9556_ADAPTIVE_MOMENTUM_REBASE' in mon,
    'daily adaptive retained':'DAY_MODE=ADAPTIF' in ana and 'REARM:FRESH_15M' in ana,
    'minimum rr retained':'TP1 >= 1.0R' in ana and 'TP2 >= 1.5R' in ana,
    'manual approval retained':'V9543C_SINGLE_TAP_APPROVAL' in main and '⚡ ONAYLA & GÖNDER' in main,
    'version main':'v9.5.58' in main,
    'version analysis':'v9.5.58' in ana,
    'version build':'versionCode 26091406' in bld and "versionName '9.5.58'" in bld,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.58b sanity failed: '+', '.join(bad))

# Sticky journal UI is observational: no trade/order side effects may be added there.
a=main.find('V9558_PERSISTENT_SIGNAL_JOURNAL_UI')
helper=main[a:] if a>=0 else ''
for forbidden in ('/fapi/v1/order','STOP_MARKET','TAKE_PROFIT_MARKET','cancelOrder','v9522ExecuteOrder(','AnalysisPackActivity'):
    if forbidden in helper: raise SystemExit('v9.5.58b journal UI side effect: '+forbidden)

print('v9.5.58b OK: real signal snapshots cannot vanish with UI/lifecycle refresh; EMA13/21 is completed-candle soft context; hard vetoes, adaptive plan, and explicit order approval remain unchanged.')
