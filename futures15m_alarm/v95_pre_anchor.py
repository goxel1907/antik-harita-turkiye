from pathlib import Path

p = Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app/AnalysisPackActivity.java')
if not p.exists():
    raise SystemExit('v9.5 pre-anchor: AnalysisPackActivity.java missing')

s = p.read_text()
old = '        sb.append("LP=stop;tp1;tp2;tp3\\nLB=girisAlt;girisUst;stop;tp1;tp2;tp3\\nSR=stop;tp1;tp2;tp3\\nSB=girisAlt;girisUst;stop;tp1;tp2;tp3\\n\\n");'
new = '        sb.append("LP=stop;tp1;tp2;tp3\\nLB=girisAlt;girisUst;stop;tp1;tp2;tp3\\nSR=stop;tp1;tp2;tp3\\n");\n        sb.append("SB=girisAlt;girisUst;stop;tp1;tp2;tp3\\n\\n");'

if old not in s:
    raise SystemExit('v9.5 pre-anchor: combined LP/LB/SR/SB format line not found')

s = s.replace(old, new, 1)
s = s.replace('📊 ChatGPT ANALİZ PAKETİ • v9.4', '📊 ChatGPT ANALİZ PAKETİ • v9.5')
p.write_text(s)

final = p.read_text()
anchor = '        sb.append("SB=girisAlt;girisUst;stop;tp1;tp2;tp3\\n\\n");'
if anchor not in final:
    raise SystemExit('v9.5 pre-anchor: SB anchor still missing')
print('v9.5 pre-anchor OK: SB format split for META insertion.')
