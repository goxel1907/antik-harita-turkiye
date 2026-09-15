from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
ANA = APP / 'app/src/main/java/com/futuresalarm/app/AnalysisPackActivity.java'
if not ANA.exists():
    raise SystemExit('v9.5.65b AnalysisPackActivity missing')

a = ANA.read_text()
if 'V9565_EXTERNAL_SAME_CHAT_BROWSER' not in a:
    raise SystemExit('v9.5.65b external same-chat route missing')

# User-facing labels must describe the new default behavior accurately.
a = a.replace(
    'shareButton = button("CHATGPT\'YE AKTAR • PROMPT + GRAFİK", Color.rgb(111, 34, 226));',
    'shareButton = button("CHATGPT SOHBETTE AÇ • PROMPT PANODA", Color.rgb(111, 34, 226));'
)
a = a.replace(
    'shareButton.setText("CHATGPT\'YE AKTAR • " + v9545BatchDoneSymbols.size() + " COİN");',
    'shareButton.setText("SOHBETTE AÇ • " + v9545BatchDoneSymbols.size() + " COİN");'
)
ANA.write_text(a)

def java_lex_sanity(src):
    depth=0; i=0; line=1; state='code'; esc=False
    while i < len(src):
        c=src[i]; n=src[i+1] if i+1 < len(src) else ''
        if c=='\n': line += 1
        if state=='line':
            if c=='\n': state='code'
            i+=1; continue
        if state=='block':
            if c=='*' and n=='/': state='code'; i+=2; continue
            i+=1; continue
        if state=='string':
            if c=='\n': return False,'newline inside Java string near line '+str(line)
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': state='code'
            i+=1; continue
        if state=='char':
            if c=='\n': return False,'newline inside Java char near line '+str(line)
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=="'": state='code'
            i+=1; continue
        if c=='/' and n=='/': state='line'; i+=2; continue
        if c=='/' and n=='*': state='block'; i+=2; continue
        if c=='"': state='string'; esc=False; i+=1; continue
        if c=="'": state='char'; esc=False; i+=1; continue
        if c=='{': depth += 1
        elif c=='}':
            depth -= 1
            if depth < 0: return False,'extra closing brace near line '+str(line)
        i += 1
    if state in ('string','char','block'): return False,'unclosed Java lexical state '+state
    if depth != 0: return False,'unclosed structural brace depth '+str(depth)
    return True,'OK'

out = ANA.read_text()
checks = {
    'single browser label': 'CHATGPT SOHBETTE AÇ • PROMPT PANODA' in out,
    'batch browser label': 'SOHBETTE AÇ • " + v9545BatchDoneSymbols.size() + " COİN' in out,
    'route retained': 'v9565OpenSavedChat(payload, false);' in out and 'v9565OpenSavedChat(v9545CombinedPrompt, true);' in out,
    'long press settings': 'V9565_CHAT_ROUTE_LONG_PRESS' in out and 'v9565ShowChatRouteMenu' in out,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '), k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.65b sanity failed: '+', '.join(bad))
ok,why=java_lex_sanity(out)
print(('OK   ' if ok else 'FAIL '),'java lexical AnalysisPackActivity',why)
if not ok: raise SystemExit('v9.5.65b Java lexical mismatch: '+why)
print('v9.5.65b OK: external-browser same-chat labels match behavior and AnalysisPackActivity remains lexically balanced.')