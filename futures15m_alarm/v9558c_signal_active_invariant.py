from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MON=APP/'app/src/main/java/com/futuresalarm/app/MonitorService.java'
if not MON.exists(): raise SystemExit('v9.5.58c MonitorService missing')


def method_bounds(src,fragment):
    a=src.find(fragment)
    if a<0:return None
    b=src.find('{',a)
    if b<0:return None
    depth=1;i=b+1;ins=inc=esc=lc=bc=False
    while i<len(src) and depth:
        c=src[i];n=src[i+1] if i+1<len(src) else ''
        if lc:
            if c=='\n':lc=False
        elif bc:
            if c=='*' and n=='/':bc=False;i+=1
        elif ins:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=='"':ins=False
        elif inc:
            if esc:esc=False
            elif c=='\\':esc=True
            elif c=="'":inc=False
        else:
            if c=='/' and n=='/':lc=True;i+=1
            elif c=='/' and n=='*':bc=True;i+=1
            elif c=='"':ins=True
            elif c=="'":inc=True
            elif c=='{':depth+=1
            elif c=='}':depth-=1
        i+=1
    return None if depth else (a,b,i)

m=MON.read_text()
for marker in ('V9558_PERSISTENT_SIGNAL_JOURNAL','v9518_signal_active_','v9518_signal_state_','v9518_signal_end_','v9518UpdateSignalResult'):
    if marker not in m: raise SystemExit('v9.5.58c prerequisite missing: '+marker)

if 'private void v9558RepairSignalActiveInvariant(' not in m:
    idx=m.find('    private String v953Decision(String symbol)')
    if idx<0: raise SystemExit('v9.5.58c helper anchor missing')
    helper=r'''
    // ============================================================
    // V9558C_SIGNAL_ACTIVE_INVARIANT
    // A real signal whose persisted state still says ACIK and has no terminal
    // timestamp must remain active/tracked. This only repairs accidental flag
    // loss; terminal/manual/TP/STOP signals are never resurrected.
    // ============================================================
    private void v9558RepairSignalActiveInvariant(String symbol) {
        try {
            String sym=symbol==null?"":symbol.trim().toUpperCase(java.util.Locale.US);
            if(sym.isEmpty()||prefs.getBoolean("v9518_signal_active_"+sym,false)) return;
            long ts=prefs.getLong("v9518_signal_time_"+sym,0L); if(ts<=0L) return;
            long end=prefs.getLong("v9518_signal_end_"+sym,0L); if(end>0L) return;
            long terminalAt=prefs.getLong("v9541_last_terminal_at_"+sym,0L); if(terminalAt>=ts) return;
            String state=prefs.getString("v9518_signal_state_"+sym,"");
            String u=state==null?"":state.trim().toUpperCase(java.util.Locale.ROOT);
            if(!(u.startsWith("AÇIK")||u.startsWith("ACIK"))) return;
            // Extremely old orphan records should not be revived forever.
            long age=System.currentTimeMillis()-ts;
            if(age<0L||age>48L*60L*60L*1000L) return;
            prefs.edit().putBoolean("v9518_signal_active_"+sym,true)
                    .putLong("v9558_invariant_repair_at_"+sym,System.currentTimeMillis()).apply();
            v9558PersistSignalJournal(sym,prefs.getString("v9518_signal_side_"+sym,""),"");
        } catch(Throwable ignored) {}
    }

'''
    m=m[:idx]+helper+m[idx:]

b=method_bounds(m,'    private void evaluate(TradePlan p, CandleSet set, MarketSnapshot market)')
if not b: raise SystemExit('v9.5.58c evaluate missing')
a,brace,e=b
body=m[a:e]
if 'V9558C_REPAIR_BEFORE_RESULT_TRACK' not in body:
    anchor='        v9518UpdateSignalResult(p.symbol, v953LivePrice);'
    if anchor not in body: raise SystemExit('v9.5.58c result anchor missing')
    body=body.replace(anchor,'        // V9558C_REPAIR_BEFORE_RESULT_TRACK\n        v9558RepairSignalActiveInvariant(p.symbol);\n'+anchor,1)
    m=m[:a]+body+m[e:]

MON.write_text(m)
print('v9.5.58c applied: accidental active-flag loss is repaired only for non-terminal persisted ACIK signals; terminal/manual/TP/STOP records are never resurrected.')
