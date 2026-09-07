from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = APP / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists():
    raise SystemExit('v9.5.22a2 MainActivity missing')

m = MAIN.read_text()
exact = '    private void openBinanceFutures(String symbol) {'

# v9.5.22b intentionally replaces this method, but its old anchor lookup is
# formatting-sensitive. Normalize any equivalent declaration first so the API
# order patch cannot fail merely because whitespace/formatting drifted.
pat = re.compile(
    r'(?m)^[ \t]*private\s+void\s+openBinanceFutures\s*\(\s*String\s+symbol\s*\)\s*\{'
)
match = pat.search(m)
if match:
    m = m[:match.start()] + exact + m[match.end():]
else:
    # v9.5.21 should already have created the handoff. If a previous UI/source
    # transformation removed only the method declaration, restore a minimal,
    # compile-safe handoff. v9.5.22b immediately replaces this body with the
    # active-signal API ticket logic.
    if 'V9521_TRADE_HANDOFF' not in m:
        raise SystemExit('v9.5.22a2: v9.5.21 trade handoff marker missing')
    anchor = '    private double v9521SignalNumber('
    pos = m.find(anchor)
    if pos < 0:
        pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.22a2: MainActivity insertion anchor missing')
    method = r'''    private void openBinanceFutures(String symbol) {
        String sym = symbol == null ? "" : symbol.trim().toUpperCase(Locale.US);
        if (sym.isEmpty()) return;
        try {
            Intent exactIntent = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://www.binance.com/en/futures/" + Uri.encode(sym)));
            exactIntent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(exactIntent);
        } catch (Throwable ignored) {}
    }

'''
    m = m[:pos] + method + m[pos:]

MAIN.write_text(m)
out = MAIN.read_text()
checks = [
    (exact in out, 'exact openBinanceFutures anchor'),
    ('V9521_TRADE_HANDOFF' in out, 'v9.5.21 handoff retained'),
    ('https://www.binance.com/en/futures/' in out, 'exact Futures URL retained'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.22a2 compatibility failed: ' + name)
print('v9.5.22a2 OK: Binance handoff declaration normalized for v9.5.22b API patch.')
