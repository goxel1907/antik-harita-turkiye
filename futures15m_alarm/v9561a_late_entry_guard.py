from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MON=APP/'app/src/main/java/com/futuresalarm/app/MonitorService.java'
if not MON.exists(): raise SystemExit('v9.5.61a MonitorService missing')


def bounds(src,fragment):
    a=src.find(fragment)
    if a<0:return None
    b=src.find('{',a)
    if b<0:return None
    d=1;i=b+1;qs=qc=esc=lc=bc=False
    while i<len(src) and d:
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if lc:
            if c=='\n':lc=False
        elif bc:
            if c=='*' and n=='/':bc=False;i+=1
        elif qs:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':qs=False
        elif qc:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":qc=False
        else:
            if c=='/' and n=='/':lc=True;i+=1
            elif c=='/' and n=='*':bc=True;i+=1
            elif c=='"':qs=True
            elif c=="'":qc=True
            elif c=='{':d+=1
            elif c=='}':d-=1
        i+=1
    return None if d else (a,b,i)


def add_gate(body,name,gate):
    mm=re.search(r'(^\s*boolean\s+'+re.escape(name)+r'\s*=.*?;)',body,re.M|re.S)
    if not mm: raise SystemExit('v9.5.61a '+name+' boolean missing')
    stmt=mm.group(1)
    if gate in stmt:return body
    return body[:mm.start(1)]+stmt[:-1]+'\n                && '+gate+';'+body[mm.end(1):]

m=MON.read_text()
b=bounds(m,'    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)')
if not b: raise SystemExit('v9.5.61a evaluate missing')
a,_,e=b
body=m[a:e]

lb='        double[] v953LbEntry = v953EntryRange(p.longBreakDetail, p.breakoutClose, true);'
if 'V9561_LONG_EXECUTION_LOCATION' not in body:
    if lb not in body: raise SystemExit('v9.5.61a LONG entry anchor missing')
    body=body.replace(lb,lb+r'''
        // V9561_LONG_EXECUTION_LOCATION
        // Confirmed scenario != permission to market-chase a late extension.
        // When location is too stretched, preserve scenario and wait for fresh 5m retest.
        double v9561LbLo=Math.min(v953LbEntry[0],v953LbEntry[1]);
        double v9561LbHi=Math.max(v953LbEntry[0],v953LbEntry[1]);
        double v9561LbRange=Math.max(1e-12,closed.high-closed.low);
        double v9561LbWidth=Math.max(0.0,v9561LbHi-v9561LbLo);
        double v9561LbTol=Math.max(p.breakoutClose*0.0025,
                Math.min(p.breakoutClose*0.0080,v9561LbRange*0.35));
        v9561LbTol=Math.max(v9561LbTol,
                Math.min(p.breakoutClose*0.0120,v9561LbWidth*1.50));
        double v9561LbCeiling=Math.max(p.breakoutClose,v9561LbHi)+v9561LbTol;
        boolean v9561LbLocationOk=!Double.isNaN(v953LivePrice) && v953LivePrice>0
                && v953LivePrice<=v9561LbCeiling;
        if (v9553LbRaw && !v9561LbLocationOk)
            v9553ArmRetest(p.symbol,true,
                    "Geç giriş engellendi: canlı fiyat plan/giriş koridoru ve kırılım seviyesinden fazla uzaklaştı; tamamlanmış 5m retest/re-entry bekleniyor");
''',1)

sb='        double[] v953SbEntry = v953EntryRange(p.shortBreakDetail, p.breakdownClose, false);'
if 'V9561_SHORT_EXECUTION_LOCATION' not in body:
    if sb not in body: raise SystemExit('v9.5.61a SHORT entry anchor missing')
    body=body.replace(sb,sb+r'''
        // V9561_SHORT_EXECUTION_LOCATION
        double v9561SbLo=Math.min(v953SbEntry[0],v953SbEntry[1]);
        double v9561SbHi=Math.max(v953SbEntry[0],v953SbEntry[1]);
        double v9561SbRange=Math.max(1e-12,closed.high-closed.low);
        double v9561SbWidth=Math.max(0.0,v9561SbHi-v9561SbLo);
        double v9561SbTol=Math.max(p.breakdownClose*0.0025,
                Math.min(p.breakdownClose*0.0080,v9561SbRange*0.35));
        v9561SbTol=Math.max(v9561SbTol,
                Math.min(p.breakdownClose*0.0120,v9561SbWidth*1.50));
        double v9561SbFloor=Math.min(p.breakdownClose,v9561SbLo)-v9561SbTol;
        boolean v9561SbLocationOk=!Double.isNaN(v953LivePrice) && v953LivePrice>0
                && v953LivePrice>=v9561SbFloor;
        if (v9553SbRaw && !v9561SbLocationOk)
            v9553ArmRetest(p.symbol,false,
                    "Geç giriş engellendi: canlı fiyat plan/giriş koridoru ve kırılım seviyesinden fazla uzaklaştı; tamamlanmış 5m retest/re-entry bekleniyor");
''',1)

body=add_gate(body,'breakout','v9561LbLocationOk')
body=add_gate(body,'breakdown','v9561SbLocationOk')
m=m[:a]+body+m[e:]

# Do not claim the price stayed in an entry/retest zone unless the engine enforced it.
m=m.replace('fiyat giriş veya yeniden test alanında kaldı ve canlı akış iki ardışık kontrolde uygun bulundu.',
            'canlı yürütme konumu geç-giriş filtresinden geçti ve canlı akış iki ardışık kontrolde uygun bulundu.')
MON.write_text(m)

out=MON.read_text()
checks={
 'long location':'V9561_LONG_EXECUTION_LOCATION' in out and '&& v9561LbLocationOk' in out,
 'short location':'V9561_SHORT_EXECUTION_LOCATION' in out and '&& v9561SbLocationOk' in out,
 'hold not kill':'Geç giriş engellendi' in out and 'v9553ArmRetest' in out,
 'old trigger gate':'V9559_BREAKOUT_LIVE_ACCEPTANCE' in out,
 'atomic signal':'V9560_ATOMIC_SIGNAL_COMMIT' in out,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.61a failed: '+', '.join(bad))
print('v9.5.61a OK: late breakout chase is converted to fresh 5m retest wait, not scenario invalidation.')
