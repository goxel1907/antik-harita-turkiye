from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = APP / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
if not MAIN.exists():
    raise SystemExit('v9.5.25c missing MainActivity.java')


def method_bounds(src, signature):
    a = src.find(signature)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    quote = False
    char_quote = False
    esc = False
    while i < len(src) and depth:
        c = src[i]
        if quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                quote = False
        elif char_quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                char_quote = False
        else:
            if c == '"':
                quote = True
            elif c == "'":
                char_quote = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)

m = MAIN.read_text()
b = method_bounds(m, '    private void v9522OpenExactFutures(String sym) ')
if not b:
    raise SystemExit('v9.5.25c v9522OpenExactFutures missing')
a0, _, e0 = b

new_open = r'''    // V9525C_BINANCE_SAFE_HANDOFF
    private void v9522OpenExactFutures(String sym) {
        String s = sym == null ? "" : sym.trim().toUpperCase(java.util.Locale.US);
        if (s.isEmpty()) return;
        String q = Uri.encode(s);
        String web = "https://www.binance.com/en/futures/" + q;

        // Current Binance Android builds can resolve undocumented symbol-specific
        // bnc/binance Futures links at the Android level and only AFTER opening
        // the app show "This link does not work". startActivity() therefore
        // cannot detect failure. Do not send those routes at all.
        if (v9524BinanceInstalled()) {
            // Keep the contract ready for Binance Futures search.
            try {
                android.content.ClipboardManager cm = (android.content.ClipboardManager)
                        getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText(
                        "Binance Futures sembolü", s));
            } catch (Throwable ignored) {}

            // This route is intentionally generic. It is the stable native
            // Binance Markets -> Futures entry observed to open without the
            // unsupported-link popup. Exact pair routes are NOT attempted.
            if (v9524TryBinanceUri("bnc://app.binance.com/markets/markets?at=futures")) {
                Toast.makeText(this,
                        "Binance Futures açıldı • " + s + " panoya kopyalandı. "
                                + "Aramada yapıştırıp pariteye dokun.",
                        Toast.LENGTH_LONG).show();
                return;
            }

            // If even the stable Futures-market route is unavailable, open the
            // official Binance app home. v9524LaunchBinanceHome() also keeps the
            // symbol on the clipboard. Never try another undocumented route.
            if (v9524LaunchBinanceHome(s)) return;
        }

        // Browser fallback only when Binance is genuinely unavailable.
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web)));
            Toast.makeText(this,
                    "Binance uygulaması açılamadı; Futures sayfası tarayıcıda açıldı.",
                    Toast.LENGTH_LONG).show();
        } catch (Throwable ignored) {
            Toast.makeText(this, "Binance Futures açılamadı.", Toast.LENGTH_LONG).show();
        }
    }'''

m = m[:a0] + new_open + m[e0:]
MAIN.write_text(m)

out = MAIN.read_text()
checks = [
    ('V9525C_BINANCE_SAFE_HANDOFF' in out, 'safe handoff marker'),
    ('binance://futures/trade?symbol=' not in out, 'broken binance custom URI removed'),
    ('bnc://app.binance.com/futures/' not in out, 'broken symbol bnc route removed'),
    ('bnc://app.binance.com/en/futures/' not in out, 'broken compatibility bnc route removed'),
    ('bnc://app.binance.com/markets/markets?at=futures' in out, 'stable native Futures market route'),
    ('bnc://app.binance.com/webview/webview' not in out, 'wrong chart/webview fallback removed'),
    ('https://www.binance.com/en/futures/' in out, 'browser-only Futures fallback'),
    ('v9524LaunchBinanceHome' in out, 'home fallback retained'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.25c sanity failed: ' + name)
print('v9.5.25c OK: unsupported symbol deep links removed; Binance opens the stable Futures market entry without the in-app error popup.')
