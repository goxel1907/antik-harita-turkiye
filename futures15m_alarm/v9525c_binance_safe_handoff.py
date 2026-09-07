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

        // The HTTPS Futures URL is intentionally NOT attempted first inside
        // Binance. On current Android builds it can resolve to the contract
        // chart/detail page instead of the USD-M Futures order ticket. Native
        // Binance Futures routes are tried first and stay package-pinned by
        // v9524TryBinanceUri().
        if (v9524BinanceInstalled()) {
            // 1) Native symbol-specific Futures route. Prefer the selected
            // perpetual contract's Futures trading module/order ticket.
            if (v9524TryBinanceUri("bnc://app.binance.com/futures/" + q)) {
                Toast.makeText(this,
                        s + " USDⓈ-M Futures işlem ekranı açılıyor...",
                        Toast.LENGTH_SHORT).show();
                return;
            }

            // 2) Compatibility variant used by some Binance Android builds.
            if (v9524TryBinanceUri("bnc://app.binance.com/en/futures/" + q)) {
                Toast.makeText(this,
                        s + " USDⓈ-M Futures işlem ekranı açılıyor...",
                        Toast.LENGTH_SHORT).show();
                return;
            }

            // 3) If a symbol-specific route is not exposed by this Binance
            // version, enter the native Futures area rather than coin/chart
            // detail. Copy the symbol so it can be pasted into Futures search.
            if (v9524TryBinanceUri("bnc://app.binance.com/markets/markets?at=futures")) {
                try {
                    android.content.ClipboardManager cm = (android.content.ClipboardManager)
                            getSystemService(CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText(
                            "Binance Futures sembolü", s));
                } catch (Throwable ignored) {}
                Toast.makeText(this,
                        "Binance Futures açıldı • " + s + " panoya kopyalandı.",
                        Toast.LENGTH_LONG).show();
                return;
            }

            // 4) Last in-app fallback. Keep this AFTER all native Futures
            // routes so Binance web/chart routing cannot pre-empt the native
            // Futures order-ticket handoff.
            try {
                String b64 = android.util.Base64.encodeToString(
                        web.getBytes("UTF-8"), android.util.Base64.NO_WRAP);
                String inApp = "bnc://app.binance.com/webview/webview?type=default&needLogin=true&url="
                        + Uri.encode(b64);
                if (v9524TryBinanceUri(inApp)) {
                    Toast.makeText(this,
                            s + " Futures bağlantısı Binance içinde açılıyor...",
                            Toast.LENGTH_SHORT).show();
                    return;
                }
            } catch (Throwable ignored) {}

            if (v9524LaunchBinanceHome(s)) return;
        }

        // Browser fallback only when the Binance app/native Futures routes are
        // unavailable. Never let the HTTPS route pre-empt native Futures.
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web)));
            Toast.makeText(this,
                    "Binance uygulaması native Futures bağlantısını açamadı; tarayıcı kullanıldı.",
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
    ('binance://futures/trade?symbol=' not in out, 'broken custom URI removed'),
    ('bnc://app.binance.com/futures/' in out, 'native exact Futures route'),
    ('bnc://app.binance.com/en/futures/' in out, 'native exact Futures compatibility route'),
    ('bnc://app.binance.com/markets/markets?at=futures' in out, 'native Futures markets fallback'),
    ('https://www.binance.com/en/futures/' in out, 'browser Futures fallback'),
    ('bnc://app.binance.com/webview/webview' in out, 'late in-app webview fallback'),
    ('v9524LaunchBinanceHome' in out, 'home fallback retained'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.25c sanity failed: ' + name)
print('v9.5.25c OK: native symbol-specific Binance Futures routes are first; HTTP/chart routing no longer pre-empts the Futures order-ticket handoff.')
