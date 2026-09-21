from pathlib import Path

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN=APP/'app/src/main/java/com/futuresalarm/app/MainActivity.java'
MON=APP/'app/src/main/java/com/futuresalarm/app/MonitorService.java'
for p in (MAIN,MON):
    if not p.exists(): raise SystemExit('v9.5.58e missing: '+str(p))

m=MAIN.read_text()
if 'private String v9558NormalizeSignalText(' not in m:
    pos=m.rfind('}')
    if pos<0: raise SystemExit('v9.5.58e Main close missing')
    helper=r'''

    // V9558E_SIGNAL_TEXT_NORMALIZE
    // Dynamic re-entry descriptions historically contained literal "\\n".
    // Convert only presentation text; persisted trading values are unchanged.
    private String v9558NormalizeSignalText(String s) {
        if(s==null) return "";
        return s.replace("\\r\\n","\n").replace("\\n","\n").replace("\\t","  ");
    }
'''
    m=m[:pos]+helper+'\n'+m[pos:]

# Existing signal tracking panel.
old='String reason=sp.getString("v9518_signal_reason_"+symbol,"-");'
new='String reason=v9558NormalizeSignalText(sp.getString("v9518_signal_reason_"+symbol,"-"));'
if old in m: m=m.replace(old,new,1)
elif new not in m: raise SystemExit('v9.5.58e v9518 signal reason anchor missing')

# Sticky journal card reason.
old2='String why=sp.getString("v9558_journal_reason_"+id,"");'
new2='String why=v9558NormalizeSignalText(sp.getString("v9558_journal_reason_"+id,""));'
if old2 in m: m=m.replace(old2,new2,1)
elif new2 not in m: raise SystemExit('v9.5.58e journal reason anchor missing')

MAIN.write_text(m)
print('v9.5.58e applied: literal escaped newlines in dynamic signal/retest reason text now render as real lines; trading data and lifecycle unchanged.')
