from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
RADAR = JAVA / 'MarketRadarActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'

for p in (RADAR, ANALYSIS):
    if not p.exists():
        raise SystemExit('v9.5.47 precompat missing: ' + str(p))


def normalize_oncreate(path, label):
    s = path.read_text()
    if '    protected void onCreate(' in s:
        print('v9.5.47 precompat:', label, 'canonical onCreate already present')
        return

    # Earlier generated activities may be minified onto one line, use public
    # visibility, or place @Override directly before the declaration. v9.5.47
    # only needs a stable semantic anchor; this changes formatting/visibility
    # to the normal Activity override form without changing the method body.
    pat = re.compile(
        r'(?m)^[ \t]*(?:@Override[ \t]+)?(?:public|protected)?[ \t]*void[ \t]+onCreate[ \t]*\('
    )
    m = pat.search(s)
    if not m:
        # Fallback for generated/minified source where the declaration follows
        # another token on the same line.
        pat2 = re.compile(r'(?:@Override[ \t]+)?(?:public|protected)?[ \t]*void[ \t]+onCreate[ \t]*\(')
        m = pat2.search(s)
        if not m:
            sample = s[:600].replace('\n', '\\n')
            raise SystemExit('v9.5.47 precompat ' + label + ' onCreate declaration not found; head=' + sample)

    s = s[:m.start()] + '    protected void onCreate(' + s[m.end():]
    path.write_text(s)
    out = path.read_text()
    if '    protected void onCreate(' not in out:
        raise SystemExit('v9.5.47 precompat failed for ' + label)
    print('v9.5.47 precompat:', label, 'onCreate anchor normalized')


normalize_oncreate(RADAR, 'Radar')
normalize_oncreate(ANALYSIS, 'Analysis')
print('v9.5.47 precompat OK: Activity onCreate anchors normalized before UX patch.')
