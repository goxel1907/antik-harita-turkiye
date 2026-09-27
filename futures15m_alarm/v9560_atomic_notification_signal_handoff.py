from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MON=JAVA/'MonitorService.java'
MAIN=JAVA/'MainActivity.java'
BUILD=APP/'app/build.gradle'
for p in (MON,MAIN,BUILD):
    if not p.exists(): raise SystemExit('v9.5.60 missing: '+str(p))


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

mon=MON.read_text()

# ---------------------------------------------------------------------------
# V9.5.60 ROOT FIX — SIGNAL MUST EXIST BEFORE ITS NOTIFICATION IS CREATED.
#
# Historical composition order was accidentally:
#   journal attempt -> build PendingIntent snapshot -> v9518RecordSignal -> notify
# Therefore the notification could carry signalTs=0 / the previous cycle, while
# the sticky journal also ran before the new signal existed. A fast notification
# tap could race the activity/service lifecycle and the just-emitted signal was
# then not recoverable by the v9.5.41/v9.5.43b exact-signal guards.
#
# Correct invariant:
#   synchronously persist REAL signal -> persist immutable journal -> construct
#   exact-signal PendingIntent -> post notification.
# No trading gate, direction, STOP/TP, PnL or auto-order rule is changed here.
# ---------------------------------------------------------------------------

# 1) Make the real-signal creation durable before sendUrgent can continue.
b=bounds(mon,'    private void v9518RecordSignal(')
if not b: raise SystemExit('v9.5.60 v9518RecordSignal missing')
a,_,e=b
rec=mon[a:e]
if 'V9560_ATOMIC_SIGNAL_COMMIT' not in rec:
    # v9518RecordSignal has one final Editor e.apply(); after all signal fields.
    pos=rec.rfind('e.apply();')
    if pos<0: raise SystemExit('v9.5.60 signal record apply anchor missing')
    rec=rec[:pos]+'''// V9560_ATOMIC_SIGNAL_COMMIT\n        if(!e.commit()) throw new IllegalStateException("real signal persistence commit failed: "+symbol);'''+rec[pos+len('e.apply();'):]
    mon=mon[:a]+rec+mon[e:]

# 2) Reorder the final notification emission method structurally.
b=bounds(mon,'    private void sendUrgent(')
if not b: raise SystemExit('v9.5.60 sendUrgent missing')
a,_,e=b
body=mon[a:e]

# Remove the old pre-record journal attempt. It is reinserted after record.
body=re.sub(r'\n\s*// V9558_JOURNAL_AT_EMIT\s*\n\s*try\s*\{\s*v9558PersistSignalJournal\(symbol,direction,detail\);\s*\}\s*catch\s*\(Throwable ignored\)\s*\{\s*\}\s*', '\n', body, count=1)

# Remove the old PendingIntent construction wherever v9.5.36 placed it. Keep all
# setContentIntent/setFullScreenIntent uses; the same variable is recreated after
# the persisted signal below.
body=re.sub(r'\n\s*// V9536_NOTIFICATION_TRADE_TICKET:[^\n]*\n', '\n', body, count=1)
body,npi=re.subn(r'\n\s*PendingIntent\s+tradePi\s*=\s*v9536OpenTradeTicketIntent\(symbol,\s*500\s*\+\s*Math\.abs\(symbol\.hashCode\(\)\s*%\s*10000\)\);\s*', '\n', body, count=1)
if npi!=1 and 'V9560_SIGNAL_FIRST_NOTIFICATION_ORDER' not in body:
    raise SystemExit('v9.5.60 old tradePi construction missing')

if 'V9560_SIGNAL_FIRST_NOTIFICATION_ORDER' not in body:
    # v9.5.18b records the signal using the preserved raw direction.
    anchors=[
        '        v9518RecordSignal(symbol, v9518RawDirection, detail);',
        '        v9518RecordSignal(symbol,v9518RawDirection,detail);',
    ]
    anchor=next((x for x in anchors if x in body),None)
    if anchor is None: raise SystemExit('v9.5.60 signal record call missing in sendUrgent')
    ordered=anchor+'''\n        // V9560_SIGNAL_FIRST_NOTIFICATION_ORDER\n        // The notification is now created only AFTER the exact real signal is durable.\n        try { v9558PersistSignalJournal(symbol, v9518RawDirection, detail); }\n        catch (Throwable ignored) {}\n        PendingIntent tradePi = v9536OpenTradeTicketIntent(symbol,\n                500 + Math.abs(symbol.hashCode() % 10000));'''
    body=body.replace(anchor,ordered,1)

mon=mon[:a]+body+mon[e:]

# 3) Make the immutable v9.5.58 journal write durable as well. This is only the
# signal journal helper; normal high-frequency SharedPreferences writes stay async.
b=bounds(mon,'    private void v9558PersistSignalJournal(')
if not b: raise SystemExit('v9.5.60 journal helper missing')
a,_,e=b
journal=mon[a:e]
if 'V9560_DURABLE_SIGNAL_JOURNAL' not in journal:
    pos=journal.rfind('ed.apply();')
    if pos<0: raise SystemExit('v9.5.60 journal apply anchor missing')
    journal=journal[:pos]+'''// V9560_DURABLE_SIGNAL_JOURNAL\n            ed.commit();'''+journal[pos+len('ed.apply();'):]
    mon=mon[:a]+journal+mon[e:]

MON.write_text(mon)

# 4) Version only. This patch changes persistence/handoff ordering, not strategy.
main=MAIN.read_text()
main=re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.60',main)
main=re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.60  •  MANUEL PRO',main)
MAIN.write_text(main)

mon=MON.read_text()
mon=re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.60',mon)
MON.write_text(mon)

bf=BUILD.read_text()
bf=re.sub(r'versionCode\s+\d+','versionCode 26091408',bf,count=1)
bf=re.sub(r"versionName\s+'[^']+'","versionName '9.5.60'",bf,count=1)
BUILD.write_text(bf)

# 5) Fail-fast ordering contract. The key regression check is positional: the
# record MUST precede both journal persistence and PendingIntent construction.
out=MON.read_text(); main=MAIN.read_text(); bld=BUILD.read_text()
b=bounds(out,'    private void sendUrgent(')
if not b: raise SystemExit('v9.5.60 final sendUrgent missing')
send=out[b[0]:b[2]]
p_record=send.find('v9518RecordSignal(symbol')
p_journal=send.find('v9558PersistSignalJournal(symbol, v9518RawDirection, detail)')
p_pi=send.find('v9536OpenTradeTicketIntent(symbol')
checks={
    'atomic signal commit':'V9560_ATOMIC_SIGNAL_COMMIT' in out and 'e.commit()' in out,
    'signal-first handoff marker':'V9560_SIGNAL_FIRST_NOTIFICATION_ORDER' in send,
    'record before journal':p_record>=0 and p_journal>p_record,
    'record before PendingIntent':p_record>=0 and p_pi>p_record,
    'journal before PendingIntent':p_journal>p_record and p_pi>p_journal,
    'durable immutable journal':'V9560_DURABLE_SIGNAL_JOURNAL' in out,
    'exact-signal notification retained':'V9541_NOTIFICATION_SIGNAL_PERSISTENCE' in out and 'v9541_signal_ts' in out,
    'strict tap lock retained':'V9543B_NOTIFICATION_TICKET_LOCK' in main,
    'persistent card retained':'GERÇEK SİNYAL KAYDI • KAYBOLMAZ' in main,
    'no day-profit protection':'V9559_DAY_PROFIT_RISK_GUARD' not in main,
    'version':'v9.5.60' in main and "versionName '9.5.60'" in bld,
}
for k,v in checks.items(): print(('OK   ' if v else 'FAIL '),k)
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('v9.5.60 sanity failed: '+', '.join(bad))
print('v9.5.60 OK: real signal is synchronously persisted and journaled BEFORE its exact-signal notification PendingIntent is created; notification tap cannot outrun signal persistence.')
