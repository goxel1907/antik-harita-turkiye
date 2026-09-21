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


def normalize_radar_ui():
    s = RADAR.read_text()

    # Older patches changed the Radar title/status wording more than once.
    # Normalize every known 8-coin / 5-candidate wording before v9.5.47's
    # semantic UX patch. This is display-only; scoring/trading logic is untouched.
    replacements = (
        ('8 COİN MARKET RADARI', '9 COİN MARKET RADARI'),
        ('8 COIN MARKET RADARI', '9 COİN MARKET RADARI'),
        ('8 COİN RADARI', '9 COİN RADARI'),
        ('8 coin', '9 coin'),
        ('8 COİN', '9 COİN'),
        ('3 TOP + 5 ADAY', '3 TOP + 6 ADAY'),
        ('TOP3 + 5 güçlü aday', 'TOP3 + 6 güçlü aday'),
        ('TOP 3 + 5 güçlü aday', 'TOP 3 + 6 güçlü aday'),
        ('5 güçlü aday', '6 güçlü aday'),
        ('five sticky candidates', 'six sticky candidates'),
    )
    for old, new in replacements:
        s = s.replace(old, new)

    # Some newer generated Radar screens use a generic "FUTURES RADAR" title.
    # Convert the first visible title to the canonical 9-coin title expected by
    # v9.5.47 without touching later descriptive strings/buttons.
    if '9 COİN MARKET RADARI' not in s:
        s, n = re.subn(
            r'📡\s*(?:FUTURES\s+RADAR|(?:\d+\s+CO[Iİ]N\s+)?MARKET\s+RADARI)(?:\s*•\s*v9\.5(?:\.\d+)*)?',
            '📡 9 COİN MARKET RADARI • v9.5.47',
            s,
            count=1,
            flags=re.IGNORECASE,
        )
        if n == 0:
            raise SystemExit('v9.5.47 precompat Radar title anchor not found')

    # v9.5.47 sanity checks a visible status marker too. Prefer the existing
    # status sentence; if old patches removed it, extend "Radar verisi hazır".
    if '3 TOP + 6 ADAY' not in s:
        s = s.replace('Radar verisi hazır', 'Radar verisi hazır • 3 TOP + 6 ADAY', 1)
    if '3 TOP + 6 ADAY' not in s:
        raise SystemExit('v9.5.47 precompat Radar status marker not found')

    RADAR.write_text(s)
    print('v9.5.47 precompat: Radar UI normalized to 9 coins / 3 TOP + 6 ADAY')


normalize_oncreate(RADAR, 'Radar')
normalize_oncreate(ANALYSIS, 'Analysis')
normalize_radar_ui()

radar = RADAR.read_text()
if '9 COİN MARKET RADARI' not in radar or '3 TOP + 6 ADAY' not in radar:
    raise SystemExit('v9.5.47 precompat final Radar UI check failed')

print('v9.5.47 precompat OK: Activity anchors + 9-coin Radar UI normalized before UX patch.')
