from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
L2=JAVA/'V9563MicrostructureFeed.java'
ANA=JAVA/'AnalysisPackActivity.java'
MON=JAVA/'MonitorService.java'
MAIN=JAVA/'MainActivity.java'
BUILD=APP/'app/build.gradle'
for p in (L2,ANA,MON,MAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.63c missing: '+str(p))


def java_lex_sanity(src):
    depth=0;i=0;line=1;state='code';esc=False
    while i<len(src):
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if c=='\n': line+=1
        if state=='line':
            if c=='\n':state='code'
            i+=1;continue
        if state=='block':
            if c=='*' and n=='/':state='code';i+=2;continue
            i+=1;continue
        if state=='string':
            if c=='\n': return False,'newline inside Java string near line '+str(line)
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':state='code'
            i+=1;continue
        if state=='char':
            if c=='\n': return False,'newline inside Java char near line '+str(line)
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":state='code'
            i+=1;continue
        if c=='/' and n=='/':state='line';i+=2;continue
        if c=='/' and n=='*':state='block';i+=2;continue
        if c=='"':state='string';esc=False;i+=1;continue
        if c=="'":state='char';esc=False;i+=1;continue
        if c=='{':depth+=1
        elif c=='}':
            depth-=1
            if depth<0:return False,'extra closing brace near line '+str(line)
        i+=1
    if state in ('string','char','block'):return False,'unclosed Java lexical state '+state
    if depth!=0:return False,'unclosed structural brace depth '+str(depth)
    return True,'OK'

l2=L2.read_text(); ana=ANA.read_text(); mon=MON.read_text(); main=MAIN.read_text(); b=BUILD.read_text()
for name,src in [('V9563MicrostructureFeed',l2),('AnalysisPackActivity',ana),('MonitorService',mon),('MainActivity',main)]:
    ok,why=java_lex_sanity(src)
    print(('OK   ' if ok else 'FAIL '),'java lexical',name,why)
    if not ok: raise SystemExit('v9.5.63c Java lexical mismatch: '+name+' — '+why)

# Strategy-isolation audit: the monitor may only warm an already-created feed.
# It must not read L2 labels/scores inside its LONG/SHORT boolean gates or order code.
refs=[m.start() for m in re.finditer('V9563MicrostructureFeed',mon)]
if len(refs)!=1 or 'touch(p.symbol)' not in mon:
    raise SystemExit('v9.5.63c unexpected MonitorService L2 coupling: refs='+str(len(refs)))

checks={
    'version':"versionName '9.5.63'" in b and 'versionCode 26091503' in b,
    'l2 class marker':'GERCEK L2 MICROSTRUCTURE' in l2 and 'depth@100ms' in l2 and 'aggTrade' in l2,
    'mobile budget':'MAX_SYMBOLS=6' in l2 and 'V9563B_MOBILE_BUDGET' in l2,
    'gap invalidation':'sequenceGap' in l2 and 'pu!=s.lastU' in l2,
    'provenance prompt':'V9.5.63 VERI PROVENANCE KURALI' in ana,
    'oracle prompt':'V9.5.63 SMC ORACLE SEMANTIGI' in ana,
    'old exact-symbol guard retained':'V9.5.62 ANALIZ PAKETI BUTUNLUK' in ana,
    'no monitor hard read':len(refs)==1,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.63c failed: '+', '.join(bad))
print('v9.5.63c OK: new L2 class is lexically balanced, versioned, mobile-bounded and isolated from MonitorService trading gates.')
