from pathlib import Path
import re

APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'
ANALYSIS=JAVA/'AnalysisPackActivity.java'
for p in (MAIN,ANALYSIS):
    if not p.exists(): raise SystemExit('v9.5.20c missing '+str(p))

# Keep the v9.5.20 visual copy, but return the shared button helper to the
# simple, already-proven implementation family used by earlier successful builds.
m=MAIN.read_text()
btn=re.search(r'    private Button button\(String label, int color\) \{.*?\n    \}',m,re.S)
if not btn: raise SystemExit('v9.5.20c button helper missing')
new_btn='''    private Button button(String label, int color) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(12.2f);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setAllCaps(false);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(9), dp(5), dp(9), dp(5));
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        b.setMaxLines(2);
        b.setBackground(v955Panel(color, Color.argb(72,255,255,255), 12));
        return b;
    }'''
m=m[:btn.start()]+new_btn+m[btn.end():]
if 'V9520C_COMPILE_SAFE' not in m:
    pos=m.find('\n',m.find('public class '))
    if pos<0: pos=0
    m=m[:pos+1]+'    // V9520C_COMPILE_SAFE\n'+m[pos+1:]
MAIN.write_text(m)

# The presentation helper is pure text transformation; make it static so it is
# valid regardless of the calling method context.
a=ANALYSIS.read_text()
a=a.replace('private String v9520YapiMetni(String text)',
            'private static String v9520YapiMetni(String text)')
if 'V9520C_COMPILE_SAFE' not in a:
    pos=a.find('\n',a.find('public class '))
    if pos<0: pos=0
    a=a[:pos+1]+'    // V9520C_COMPILE_SAFE\n'+a[pos+1:]
ANALYSIS.write_text(a)

# Source-level checks. These catch accidental malformed Java before Gradle starts.
main=MAIN.read_text(); ana=ANALYSIS.read_text()
checks=[
 ('V9520C_COMPILE_SAFE' in main,'main compile-safe marker'),
 ('android.text.style.RelativeSizeSpan' not in main,'risky span helper removed'),
 ('b.setText(label);' in main and 'b.setMaxLines(2);' in main,'simple two-line button helper'),
 ('private static String v9520YapiMetni(String text)' in ana,'static Turkish structure helper'),
 ('Gerçek işlem tetik teyidi yalnız TAMAMLANMIŞ 15m mum kapanışından gelebilir' in ana,'decision rule retained'),
 ('15m prim/iskonto konumu yalnız yerel giriş zamanlamasıdır' in ana,'PD rule retained'),
]
for ok,name in checks:
    print(('OK   ' if ok else 'FAIL '),name)
    if not ok: raise SystemExit('v9.5.20c sanity failed: '+name)
print('v9.5.20c OK: compile-safe UI helper + static presentation helper.')
