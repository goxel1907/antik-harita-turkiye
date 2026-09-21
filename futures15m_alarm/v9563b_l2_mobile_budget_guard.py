from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
L2=APP/'app/src/main/java/com/futuresalarm/app/V9563MicrostructureFeed.java'
BUILD=APP/'app/build.gradle'
if not L2.exists(): raise SystemExit('v9.5.63b L2 class missing')
if not BUILD.exists(): raise SystemExit('v9.5.63b build file missing')

s=L2.read_text()
s=s.replace('private static final int MAX_SYMBOLS=12;','private static final int MAX_SYMBOLS=6;',1)
old='void touch(String symbol){State s=state(symbol);if(s!=null)ensure(s);}'
new='''void touch(String symbol){
        // V9563B_MOBILE_BUDGET: monitor evaluations must NOT open a 100ms L2
        // socket for every stored plan.  They only keep an already analysis-
        // activated symbol warm. promptSummary() remains the explicit creator.
        String n=norm(symbol); if(n.isEmpty())return;
        State s;
        synchronized(states){s=states.get(n);if(s!=null)s.lastRequestedAt=System.currentTimeMillis();}
        if(s!=null)ensure(s);
    }'''
if 'V9563B_MOBILE_BUDGET' not in s:
    if old not in s: raise SystemExit('v9.5.63b touch anchor missing')
    s=s.replace(old,new,1)
L2.write_text(s)

out=L2.read_text(); b=BUILD.read_text()
checks={
    'bounded live symbols':'MAX_SYMBOLS=6' in out,
    'passive monitor touch':'V9563B_MOBILE_BUDGET' in out,
    'touch does not create':'void touch(String symbol){' in out and 'State s=state(symbol);if(s!=null)ensure(s);' not in out,
    'prompt still creates':'State s=state(symbol);if(s==null)return "V9.5.63 L2:' in out,
    'soft only':'YENI HARD GATE DEGILDIR' in out,
    'version':"versionName '9.5.63'" in b,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.63b sanity failed: '+', '.join(bad))
print('v9.5.63b OK: 100ms L2 sockets are analysis-activated and capped at 6; monitor only keeps already-active feeds warm, preventing battery/data thrash across long plan lists.')
