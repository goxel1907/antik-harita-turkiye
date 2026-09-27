from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
FILES=[JAVA/'MainActivity.java',JAVA/'MonitorService.java',JAVA/'AnalysisPackActivity.java',JAVA/'TradeAgentActivity.java',JAVA/'BrainCore.java',JAVA/'BrainLearning.java',JAVA/'AutoTradeEngine.java']
BUILD=APP/'app/build.gradle'
for p in FILES+[BUILD]:
    if not p.exists():raise SystemExit('v9.5.76b missing '+str(p))

def lex(src):
    d=0;i=0;state='code';esc=False;line=1
    while i<len(src):
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if c=='\n':line+=1
        if state=='line':
            if c=='\n':state='code'
            i+=1;continue
        if state=='block':
            if c=='*' and n=='/':state='code';i+=2;continue
            i+=1;continue
        if state=='str':
            if c=='\n':return False,'newline in string line '+str(line)
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':state='code'
            i+=1;continue
        if state=='chr':
            if c=='\n':return False,'newline in char line '+str(line)
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":state='code'
            i+=1;continue
        if c=='/' and n=='/':state='line';i+=2;continue
        if c=='/' and n=='*':state='block';i+=2;continue
        if c=='"':state='str';i+=1;continue
        if c=="'":state='chr';i+=1;continue
        if c=='{':d+=1
        elif c=='}':
            d-=1
            if d<0:return False,'extra close brace line '+str(line)
        i+=1
    if state in ('str','chr','block'):return False,'unclosed '+state
    return (d==0,'brace depth '+str(d))

for p in FILES:
    ok,msg=lex(p.read_text());print(('OK   ' if ok else 'FAIL '),p.name,msg)
    if not ok:raise SystemExit('v9.5.76b lexical failure '+p.name+': '+msg)

main=(JAVA/'MainActivity.java').read_text();mon=(JAVA/'MonitorService.java').read_text();agent=(JAVA/'TradeAgentActivity.java').read_text();learn=(JAVA/'BrainLearning.java').read_text();auto=(JAVA/'AutoTradeEngine.java').read_text();bf=BUILD.read_text()
checks={
 'agent request compatibility':'V9574_OPENCODE_DEFAULT_REQUEST_RETRY' in agent,
 'healthy multi-free':'V9575_MULTI_FREE_HEALTH_POOL' in agent and 'probeFreeModel' in agent,
 'learning journal':'V9575_BRAIN_LEARNING_MEMORY' in learn and 'recordOutcome' in learn,
 'auto explicit opt-in':'V9576_LIVE_AUTO_SETTINGS' in main and 'CANLI OTO EMİRİ ETKİNLEŞTİR' in main,
 'monitor trigger':'AutoTradeEngine.onSignal(this, symbol)' in mon,
 'auto engine':'V9576_GUARDED_LIVE_AUTO_EXECUTION' in auto,
 'no AI direct trigger':'BrainLearning.recordChat' in agent and 'AutoTradeEngine.onSignal' not in agent,
 'risk guards':'age>120000L' in auto and 'dev>0.50' in auto and 'openCount(acct)>=max' in auto,
 'stop fail-safe':'STOP kurulamadı; acil kapatma denendi' in auto and 'emergency(' in auto,
 'encrypted API':'AndroidKeyStore' in auto and 'AES/GCM/NoPadding' in auto,
 'position cap 1-5':'max<1||max>5' in main,
 'version':"versionName '9.5.76'" in bf and 'versionCode 26091516' in bf,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.76b sanity failed: '+', '.join(bad))
print('v9.5.76b OK: lexical + feature safety checks passed. This is static validation, not a successful Android build/device test.')
