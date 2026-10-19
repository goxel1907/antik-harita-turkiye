from pathlib import Path
import re

ENGINE = Path('/tmp/futures15m-build/Futures15mAlarm/app/src/main/java/com/futuresalarm/app/V9538MarketRadarEngine.java')
if not ENGINE.exists():
    raise SystemExit('v9.5.40 precompat missing radar engine: ' + str(ENGINE))

s = ENGINE.read_text()
expected = 't.preScore=65*close+20*rangePos(t)+15*clamp(vel/0.006,-1,1);'
if expected not in s:
    # v9.5.40 historically used an exact-string anchor here. Normalize harmless
    # whitespace / prior hotfix variants back to the v9.5.38 expression before
    # the real v9.5.40 patch runs. This changes no runtime logic by itself.
    refresh_at = s.find('private void refresh()')
    if refresh_at < 0:
        raise SystemExit('v9.5.40 precompat refresh() missing')
    score_at = s.find('private int score(', refresh_at)
    if score_at < 0:
        score_at = len(s)
    block = s[refresh_at:score_at]
    pat = re.compile(r't\.preScore\s*=\s*[^;\n]+;')
    m = pat.search(block)
    if not m:
        raise SystemExit('v9.5.40 precompat preScore assignment missing')
    block = block[:m.start()] + expected + block[m.end():]
    s = s[:refresh_at] + block + s[score_at:]
    ENGINE.write_text(s)
    print('v9.5.40 precompat: preScore anchor normalized.')
else:
    print('v9.5.40 precompat: exact preScore anchor already present.')

out = ENGINE.read_text()
if expected not in out:
    raise SystemExit('v9.5.40 precompat sanity failed')
print('v9.5.40 precompat OK.')
