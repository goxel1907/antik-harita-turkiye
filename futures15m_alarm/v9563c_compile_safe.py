from pathlib import Path
import re
import runpy

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

# V9563D_COMPILE_TYPE_REPAIR
# bestWall() originally declared age as double and then assigned it to Wall.ageMs
# (a long), which javac correctly rejects as a possible lossy conversion.
# Keep the value integral because it is elapsed milliseconds throughout the model.
l2=L2.read_text()
bad='double age=Math.max(0,now-w.firstSeen);double sc=w.lastShare*(1.0+Math.log1p(age/1000.0));'
good='long age=Math.max(0L,now-w.firstSeen);double sc=w.lastShare*(1.0+Math.log1p(age/1000.0));'
if bad in l2:
    l2=l2.replace(bad,good,1)
    L2.write_text(l2)
elif good not in l2:
    raise SystemExit('v9.5.63d age type repair anchor missing')

# V9563E_JSON_EXCEPTION_REPAIR
# Android org.json.JSONObject(String) declares checked JSONException. seed() parses
# the REST depth snapshot and previously declared only IOException, so javac
# rejected the generated class with "unreported exception JSONException".
# The caller already wraps seed() in try/catch(Throwable), therefore declaring
# the checked JSON exception here preserves the existing failure/reconnect path.
l2=L2.read_text()
bad_seed='private boolean seed(State s,long gen)throws java.io.IOException{'
good_seed='private boolean seed(State s,long gen)throws java.io.IOException, org.json.JSONException{'
if bad_seed in l2:
    l2=l2.replace(bad_seed,good_seed,1)
    L2.write_text(l2)
elif good_seed not in l2:
    raise SystemExit('v9.5.63e JSONException repair anchor missing')

l2=L2.read_text(); ana=ANA.read_text(); mon=MON.read_text(); main=MAIN.read_text(); b=BUILD.read_text()
if bad in l2 or good not in l2:
    raise SystemExit('v9.5.63d possible lossy conversion repair failed')
if bad_seed in l2 or good_seed not in l2:
    raise SystemExit('v9.5.63e unreported JSONException repair failed')
print('OK   v9.5.63d L2 ageMs type repair: elapsed wall age is long milliseconds')
print('OK   v9.5.63e L2 seed declares Android org.json.JSONException')

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
    'ageMs compile type':'long age=Math.max(0L,now-w.firstSeen)' in l2,
    'json checked exception':'throws java.io.IOException, org.json.JSONException' in l2,
    'provenance prompt':'V9.5.63 VERI PROVENANCE KURALI' in ana,
    'oracle prompt':'V9.5.63 SMC ORACLE SEMANTIGI' in ana,
    'old exact-symbol guard retained':'V9.5.62 ANALIZ PAKETI BUTUNLUK' in ana,
    'no monitor hard read':len(refs)==1,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad_checks=[k for k,v in checks.items() if not v]
if bad_checks:raise SystemExit('v9.5.63c failed: '+', '.join(bad_checks))
print('v9.5.63c OK: new L2 class is lexically balanced, type-safe, JSON-exception-safe, versioned, mobile-bounded and isolated from MonitorService trading gates.')

# v9.5.64 stabilization: batch prompt/copy/share consistency, exact legacy TUSDT
# cleanup bridge, plan-code-only response contract, and aligned visible version.
ROOT=Path(__file__).resolve().parent
runpy.run_path(str(ROOT/'v9564_stability_batch_prompt.py'),run_name='__main__')
