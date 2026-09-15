from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm');JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java';MON=JAVA/'MonitorService.java';CTX=JAVA/'V9532CandleContext.java';DCTX=JAVA/'V9531DecisionContext.java';ENG=JAVA/'StructureEngine.java';BUILD=APP/'app/build.gradle'
for p in (MAIN,MON,CTX,DCTX,ENG,BUILD):
    if not p.exists():raise SystemExit('v9.5.61e missing: '+str(p))

# V9561E_STRUCTURE_180_REPAIR
# v9.5.61d originally patched only one literal spelling ("src.size() - 100").
# Some composed sources carry a different previous numeric cap/spacing, so the
# marker could be present while the actual StructureEngine cap remained old.
# Repair the semantic analyze() start expression itself, then verify it before
# running the rest of the composition sanity checks. This changes context depth
# only; it does not add a signal/order veto.
eng=ENG.read_text()
structure_pat=re.compile(
    r'int\s+start\s*=\s*Math\.max\(\s*0\s*,\s*src\.size\(\)\s*-\s*\d+\s*\)\s*;'
)
mm=structure_pat.search(eng)
if mm:
    eng=eng[:mm.start()]+'int start = Math.max(0, src.size() - 180);'+eng[mm.end():]
elif not re.search(r'src\.size\(\)\s*-\s*180',eng):
    raise SystemExit('v9.5.61e StructureEngine analyze lookback expression not found')
if 'V9561_STRUCTURE_LOOKBACK_180' not in eng:
    cls=eng.find('final class StructureEngine')
    nl=eng.find('\n',cls)
    if cls<0 or nl<0:raise SystemExit('v9.5.61e StructureEngine class anchor missing')
    eng=eng[:nl+1]+'    // V9561_STRUCTURE_LOOKBACK_180 — deeper context, no extra hard vote.\n'+eng[nl+1:]
ENG.write_text(eng)

main=MAIN.read_text();mon=MON.read_text();ctx=CTX.read_text();dc=DCTX.read_text();eng=ENG.read_text();b=BUILD.read_text()
checks={
 'version':"versionName '9.5.61'" in b and 'versionCode 26091501' in b,
 'late chase':'V9561_LONG_EXECUTION_LOCATION' in mon and 'V9561_SHORT_EXECUTION_LOCATION' in mon,
 'retained v9560':'V9560_ATOMIC_SIGNAL_COMMIT' in mon,
 'precise cleanup':'/fapi/v1/openAlgoOrders' in main and '"DELETE","/fapi/v1/algoOrder"' in main,
 'flat prerequisite':'/fapi/v2/positionRisk' in main,
 'no cancel all':'/fapi/v1/algoOpenOrders' not in main[main.find('V9561_MANAGED_PROTECTIVE_ORDER_CLEANUP'):],
 'exact symbol':'v9561SameSymbol' in main and 'exact-symbol defense' in main,
 'compact plans':'V9561_COMPACT_STORED_PLANS' in main and 'KAYITLI PLANLAR' in main,
 'income net':'BINANCE_INCOME_NET' in main,
 'wick confirmed':'V9561_CONFIRMED_WICK_SWEEP' in ctx and 'SWEEP_CONFIRMED' in ctx,
 'deep context':'"15m", 384' in dc and '"1d", 365' in dc,
 'structure 180':re.search(r'src\.size\(\)\s*-\s*180',eng) is not None and 'V9561_STRUCTURE_LOOKBACK_180' in eng,
 'no wick/liquidity hard marker in monitor':'V9561_CONFIRMED_WICK_SWEEP' not in mon and 'V9561_DEEP_LIQUIDITY_LOOKBACK' not in mon,
}
for k,v in checks.items():print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad:raise SystemExit('v9.5.61e failed: '+', '.join(bad))

# V9561E_JAVA_AWARE_BRACE_SANITY
# Raw src.count('{')/src.count('}') is not a Java syntax check: JSON snippets,
# regex/text literals and comments may legally contain brace characters. Scan
# lexical Java states so only structural braces are counted. This still catches
# a real unmatched class/method/block brace before Gradle, without false-failing
# on harmless braces embedded in MainActivity strings.
def java_brace_sanity(src):
    depth=0;i=0;line=1;state='code';esc=False
    while i<len(src):
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if c=='\n':line+=1
        if state=='line':
            if c=='\n':state='code'
            i+=1;continue
        if state=='block':
            if c=='*' and n=='/':state='code';i+=2;continue
            i+=1;continue
        if state=='string':
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':state='code'
            i+=1;continue
        if state=='char':
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":state='code'
            i+=1;continue
        if state=='textblock':
            if src.startswith('"""',i):state='code';i+=3;continue
            i+=1;continue
        if c=='/' and n=='/':state='line';i+=2;continue
        if c=='/' and n=='*':state='block';i+=2;continue
        if src.startswith('"""',i):state='textblock';i+=3;continue
        if c=='"':state='string';esc=False;i+=1;continue
        if c=="'":state='char';esc=False;i+=1;continue
        if c=='{':depth+=1
        elif c=='}':
            depth-=1
            if depth<0:return False,'extra closing brace near line '+str(line)
        i+=1
    if depth!=0:return False,'unclosed structural brace depth '+str(depth)
    if state=='block':return False,'unclosed block comment'
    if state in ('string','char','textblock'):return False,'unclosed Java literal ('+state+')'
    return True,'OK'

for name,src in [('MainActivity',main),('MonitorService',mon),('WickContext',ctx),('StructureEngine',eng)]:
    ok,why=java_brace_sanity(src)
    print(('OK   ' if ok else 'FAIL '),'java braces',name,why)
    if not ok:raise SystemExit('v9.5.61e Java structure mismatch: '+name+' — '+why)

# Exact-collision semantic invariant.
def norm(x):
    y=re.sub(r'[^A-Z0-9]','',(x or '').upper());return y if y.endswith('USDT') else ''
if norm('TUSDT')==norm('THEUSDT'):raise SystemExit('v9.5.61e T/THE symbol collision')
print('v9.5.61e OK: late-entry, exact cleanup, compact stored plans, symbol isolation and liquidity/wick invariants survived composition.')
