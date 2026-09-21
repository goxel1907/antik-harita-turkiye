from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = APP / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists():
    raise SystemExit('v9.5.22a2 MainActivity missing')

m = MAIN.read_text()

# v9.5.22b uses an old brace scanner that does not understand Java comments.
# The v9.5.21 openBinanceFutures body contains Turkish comments/apostrophes,
# which can make that scanner think it entered a char literal and report the
# method as "missing" even though the declaration exists. Do not try to make
# that old body parseable in-place. Rename the legacy method and put a tiny,
# comment-free bridge in front of it; v9.5.22b immediately replaces the bridge.
pat = re.compile(
    r'(?m)^(?P<indent>[ \t]*)private\s+void\s+openBinanceFutures\s*\(\s*String\s+symbol\s*\)\s*\{'
)
match = pat.search(m)

bridge = r'''    private void openBinanceFutures(String symbol) {
        String sym = symbol == null ? "" : symbol.trim().toUpperCase(Locale.US);
        if (sym.isEmpty()) return;
        Intent i = new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://www.binance.com/en/futures/" + Uri.encode(sym)));
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        startActivity(i);
    }

'''

if match:
    # Rename only the declaration. The old body stays intact under a legacy
    # name, while the parser-safe bridge becomes the authoritative method.
    renamed_decl = match.group(0).replace('openBinanceFutures', 'v9522LegacyOpenBinanceFutures', 1)
    m = m[:match.start()] + bridge + renamed_decl + m[match.end():]
else:
    if 'V9521_TRADE_HANDOFF' not in m:
        raise SystemExit('v9.5.22a2: v9.5.21 trade handoff marker missing')
    anchor = '    private double v9521SignalNumber('
    pos = m.find(anchor)
    if pos < 0:
        pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.22a2: MainActivity insertion anchor missing')
    m = m[:pos] + bridge + m[pos:]

MAIN.write_text(m)
out = MAIN.read_text()

# Re-run the exact legacy scanner contract used at the top of v9.5.22b.
# This catches the previous false-positive sanity result before v9.5.22b runs.
def legacy_method_bounds(src, signature):
    a = src.find(signature)
    if a < 0: return None
    b = src.find('{', a)
    if b < 0: return None
    depth = 1; i = b + 1; quote = False; char_quote = False; esc = False
    while i < len(src) and depth:
        c = src[i]
        if quote:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': quote = False
        elif char_quote:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": char_quote = False
        else:
            if c == '"': quote = True
            elif c == "'": char_quote = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

legacy_ok = legacy_method_bounds(out, '    private void openBinanceFutures(String symbol) ') is not None
checks = [
    ('    private void openBinanceFutures(String symbol) {' in out, 'parser-safe openBinanceFutures bridge'),
    (legacy_ok, 'v9.5.22b legacy scanner can parse bridge'),
    ('V9521_TRADE_HANDOFF' in out, 'v9.5.21 handoff retained'),
    ('https://www.binance.com/en/futures/' in out, 'exact Futures URL retained'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.22a2 compatibility failed: ' + name)
print('v9.5.22a2 OK: parser-safe Binance handoff bridge verified for v9.5.22b.')
