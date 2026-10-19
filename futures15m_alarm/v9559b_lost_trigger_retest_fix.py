from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MON=APP/'app/src/main/java/com/futuresalarm/app/MonitorService.java'
if not MON.exists(): raise SystemExit('v9.5.59b missing MonitorService.java')


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

m=MON.read_text()
b=bounds(m,'    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)')
if not b: raise SystemExit('v9.5.59b evaluate missing')
a,_,e=b
body=m[a:e]

if 'v9559LbLiveAccepted' not in body or 'v9559SbLiveAccepted' not in body:
    raise SystemExit('v9.5.59b v9559 live-acceptance variables missing')

if 'V9559B_LB_LOST_TRIGGER_REARM' not in body:
    anchor='''        else if (v9553LbRaw)\n            v9553ClearRetest(p.symbol,true);'''
    if anchor not in body: raise SystemExit('v9.5.59b LONG v9555 clear anchor missing')
    add=anchor+'''\n        // V9559B_LB_LOST_TRIGGER_REARM\n        // v9.5.55 may clear a soft retest flag when its own gate is immediate.\n        // Lost live breakout acceptance is stronger: keep the scenario alive,\n        // but force a fresh completed-5m reclaim/acceptance before entry.\n        if (v9553LbRaw && !v9559LbLiveAccepted)\n            v9553ArmRetest(p.symbol,true,\n                    "15m yukarı kırılım teyitli fakat canlı fiyat kırılım seviyesinin altına geri döndü; tamamlanmış 5m reclaim/acceptance bekleniyor");'''
    body=body.replace(anchor,add,1)

if 'V9559B_SB_LOST_TRIGGER_REARM' not in body:
    anchor='''        else if (v9553SbRaw)\n            v9553ClearRetest(p.symbol,false);'''
    if anchor not in body: raise SystemExit('v9.5.59b SHORT v9555 clear anchor missing')
    add=anchor+'''\n        // V9559B_SB_LOST_TRIGGER_REARM\n        if (v9553SbRaw && !v9559SbLiveAccepted)\n            v9553ArmRetest(p.symbol,false,\n                    "15m aşağı kırılım teyitli fakat canlı fiyat kırılım seviyesinin üstüne geri döndü; tamamlanmış 5m reclaim/acceptance bekleniyor");'''
    body=body.replace(anchor,add,1)

# Defense in depth: immediate breakout/breakdown must still carry the live side gate.
if '&& v9559LbLiveAccepted' not in body:
    needle='                && (v9553LbGate.immediate || v9555LbAlternative)\n'
    if needle not in body: raise SystemExit('v9.5.59b LONG immediate condition anchor missing')
    body=body.replace(needle,needle+'                && v9559LbLiveAccepted\n',1)
if '&& v9559SbLiveAccepted' not in body:
    needle='                && (v9553SbGate.immediate || v9555SbAlternative)\n'
    if needle not in body: raise SystemExit('v9.5.59b SHORT immediate condition anchor missing')
    body=body.replace(needle,needle+'                && v9559SbLiveAccepted\n',1)

m=m[:a]+body+m[e:]
MON.write_text(m)

out=MON.read_text()
checks={
    'LONG lost-trigger rearm':'V9559B_LB_LOST_TRIGGER_REARM' in out and 'v9553LbRaw && !v9559LbLiveAccepted' in out,
    'SHORT lost-trigger rearm':'V9559B_SB_LOST_TRIGGER_REARM' in out and 'v9553SbRaw && !v9559SbLiveAccepted' in out,
    'LONG hard live gate':'&& v9559LbLiveAccepted' in out,
    'SHORT hard live gate':'&& v9559SbLiveAccepted' in out,
    'reclaim text':'tamamlanmış 5m reclaim/acceptance bekleniyor' in out,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.59b sanity failed: '+', '.join(bad))
print('v9.5.59b OK: a confirmed 15m breakout that loses the live trigger cannot be re-cleared by v9.5.55; it stays in 5m reclaim/acceptance wait instead of emitting an immediate entry.')
