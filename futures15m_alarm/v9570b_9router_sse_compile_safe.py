from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
AGENT = JAVA / 'TradeAgentActivity.java'
MAIN = JAVA / 'MainActivity.java'
ANA = JAVA / 'AnalysisPackActivity.java'
MON = JAVA / 'MonitorService.java'
BRAIN = JAVA / 'BrainCore.java'
BUILD = APP / 'app/build.gradle'
for p in (AGENT, MAIN, ANA, MON, BRAIN, BUILD):
    if not p.exists(): raise SystemExit('v9.5.70b missing: '+str(p))

def java_lex_sanity(src):
    depth=0; i=0; line=1; state='code'; esc=False
    while i < len(src):
        c=src[i]; n=src[i+1] if i+1<len(src) else ''
        if c=='\n': line+=1
        if state=='line':
            if c=='\n': state='code'
            i+=1; continue
        if state=='block':
            if c=='*' and n=='/': state='code'; i+=2; continue
            i+=1; continue
        if state=='string':
            if c=='\n': return False,'newline in string near line '+str(line)
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': state='code'
            i+=1; continue
        if state=='char':
            if c=='\n': return False,'newline in char near line '+str(line)
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=="'": state='code'
            i+=1; continue
        if c=='/' and n=='/': state='line'; i+=2; continue
        if c=='/' and n=='*': state='block'; i+=2; continue
        if c=='"': state='string'; esc=False; i+=1; continue
        if c=="'": state='char'; esc=False; i+=1; continue
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth<0: return False,'extra closing brace near line '+str(line)
        i+=1
    if state in ('string','char','block'): return False,'unclosed lexical state '+state
    if depth!=0: return False,'brace depth '+str(depth)
    return True,'OK'

agent=AGENT.read_text(); ana=ANA.read_text(); brain=BRAIN.read_text(); bf=BUILD.read_text()
checks={
    'v9570 marker':'V9570_9ROUTER_SSE_RESPONSE' in agent,
    'classic + sse':'decodeChatResponse' in agent and 'decodeChatObject' in agent,
    'sse prefix':'line.startsWith("data:")' in agent,
    'delta chunks':'choice.optJSONObject("delta")' in agent,
    'done event':'"[DONE]".equals(line)' in agent,
    'newlines preserved':"append('\\n')" in agent,
    '90s read timeout':'setReadTimeout(90000)' in agent,
    'free agent retained':'V9568_FREE_FIRST_TRADE_AGENT' in agent,
    'brain retained':'V9569_BRAIN_CORE' in brain,
    'leader retained':'LEADER_HUNTER_MS' in brain,
    'same chat retained':'V9567_CLIPBOARD_GALLERY_SAME_CHAT' in ana,
    'plan only retained':'V9564_PLAN_CODE_ONLY_CONTRACT' in ana,
    'version':"versionName '9.5.70'" in bf and 'versionCode 26091510' in bf,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.70b checks failed: '+', '.join(bad))
for name,src in (('TradeAgentActivity',agent),('MainActivity',MAIN.read_text()),('AnalysisPackActivity',ana),('MonitorService',MON.read_text()),('BrainCore',brain)):
    ok,why=java_lex_sanity(src); print(('OK   ' if ok else 'FAIL '),'java lexical '+name,why)
    if not ok: raise SystemExit('v9.5.70b Java lexical mismatch: '+name+' — '+why)
print('v9.5.70b OK: SSE parser and retained flows passed static/lexical checks.')
