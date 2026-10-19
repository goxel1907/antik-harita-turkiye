from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MON=JAVA/'MonitorService.java'
MAIN=JAVA/'MainActivity.java'
BUILD=APP/'app/build.gradle'
for p in (MON,MAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.59 missing: '+str(p))


def bounds(src, fragment):
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


def add_gate_to_boolean(body, name, gate):
    mm=re.search(r'(^\s*boolean\s+'+re.escape(name)+r'\s*=.*?;)',body,re.M|re.S)
    if not mm:
        raise SystemExit('v9.5.59 '+name+' boolean missing')
    stmt=mm.group(1)
    if gate in stmt:
        return body
    indent='                '
    new=stmt[:-1]+'\n'+indent+'&& '+gate+';'
    return body[:mm.start(1)]+new+body[mm.end(1):]

m=MON.read_text()
b=bounds(m,'    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)')
if not b: raise SystemExit('v9.5.59 evaluate missing')
a,_,e=b
body=m[a:e]

# V9559_BREAKOUT_LIVE_ACCEPTANCE
# A completed 15m breakout remains a valid scenario, but immediate execution is
# forbidden after live price has fallen back through its breakout trigger.
# This is entry-validity logic only; it is NOT a profit/day-PnL protection layer.
if 'V9559_BREAKOUT_LIVE_ACCEPTANCE' not in body:
    mm=re.search(r'^(\s*double\s+v953LivePrice\s*=.*?;\s*)$',body,re.M)
    if not mm: raise SystemExit('v9.5.59 live price anchor missing')
    code='''\n        // V9559_BREAKOUT_LIVE_ACCEPTANCE\n        // Closed 15m confirmation is scenario state; live trigger side is execution state.\n        boolean v9559LbLiveAccepted = !Double.isNaN(v953LivePrice) && v953LivePrice > 0\n                && v953LivePrice > p.breakoutClose;\n        boolean v9559SbLiveAccepted = !Double.isNaN(v953LivePrice) && v953LivePrice > 0\n                && v953LivePrice < p.breakdownClose;\n'''
    body=body[:mm.end(1)]+code+body[mm.end(1):]

if 'v9553LbRaw' not in body or 'v9553SbRaw' not in body:
    raise SystemExit('v9.5.59 v9.5.53 breakout raw gates missing')

# Re-arm AFTER v9.5.55's soft-path clear logic and immediately before the final
# breakout/breakdown boolean. This makes lost live acceptance authoritative.
if 'V9559B_LB_LOST_TRIGGER_REARM' not in body:
    anchor='        double[] v953LbEntry = v953EntryRange(p.longBreakDetail, p.breakoutClose, true);'
    pos=body.find(anchor)
    if pos<0: raise SystemExit('v9.5.59 LONG entry anchor missing')
    code='''        // V9559B_LB_LOST_TRIGGER_REARM\n        if (v9553LbRaw && !v9559LbLiveAccepted)\n            v9553ArmRetest(p.symbol,true,\n                    "15m yukarı kırılım teyitli fakat canlı fiyat kırılım seviyesinin altına geri döndü; tamamlanmış 5m reclaim/acceptance bekleniyor");\n'''
    body=body[:pos]+code+body[pos:]

if 'V9559B_SB_LOST_TRIGGER_REARM' not in body:
    anchor='        double[] v953SbEntry = v953EntryRange(p.shortBreakDetail, p.breakdownClose, false);'
    pos=body.find(anchor)
    if pos<0: raise SystemExit('v9.5.59 SHORT entry anchor missing')
    code='''        // V9559B_SB_LOST_TRIGGER_REARM\n        if (v9553SbRaw && !v9559SbLiveAccepted)\n            v9553ArmRetest(p.symbol,false,\n                    "15m aşağı kırılım teyitli fakat canlı fiyat kırılım seviyesinin üstüne geri döndü; tamamlanmış 5m reclaim/acceptance bekleniyor");\n'''
    body=body[:pos]+code+body[pos:]

body=add_gate_to_boolean(body,'breakout','v9559LbLiveAccepted')
body=add_gate_to_boolean(body,'breakdown','v9559SbLiveAccepted')

m=m[:a]+body+m[e:]
MON.write_text(m)

# Version only. No day-profit, trailing-profit or PnL-based order veto is added.
s=MAIN.read_text()
s=re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.59',s)
s=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.59  •  MANUEL PRO',s)
MAIN.write_text(s)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091407',bf,count=1)
bf=re.sub(r"versionName\s+'[^']+'","versionName '9.5.59'",bf,count=1)
BUILD.write_text(bf)

out=MON.read_text(); main=MAIN.read_text(); bld=BUILD.read_text()
checks={
    'live acceptance marker':'V9559_BREAKOUT_LIVE_ACCEPTANCE' in out,
    'LONG hard live gate':'boolean breakout' in out and '&& v9559LbLiveAccepted' in out,
    'SHORT hard live gate':'boolean breakdown' in out and '&& v9559SbLiveAccepted' in out,
    'LONG lost-trigger rearm':'V9559B_LB_LOST_TRIGGER_REARM' in out,
    'SHORT lost-trigger rearm':'V9559B_SB_LOST_TRIGGER_REARM' in out,
    'no day-profit protection':'V9559_DAY_PROFIT_RISK_GUARD' not in main,
    'no PnL order guard':'V9559_PREPARE_ORDER_RISK_GUARD' not in main and 'V9559_FINAL_ORDER_RISK_RECHECK' not in main,
    'version':'v9.5.59' in main and "versionName '9.5.59'" in bld,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.59 sanity failed: '+', '.join(bad))
print('v9.5.59 OK: lost live breakout trigger forces 5m reclaim wait; no profit/day-PnL protection added.')
