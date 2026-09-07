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

        // Do NOT use binance://futures/trade?... here. Some current Binance
        // Android builds accept the Intent but then show an in-app
        // "This link does not work" error, which cannot be detected by
        // startActivity(). Prefer routes that the official app can actually
        // resolve, while pinning every app route to com.binance.dev.
        if (v9524BinanceInstalled()) {
            // 1) Exact official Futures URL, package-pinned to Binance. If the
            // installed version owns this App Link it opens the exact contract.
            if (v9524TryBinanceUri(web)) {
                Toast.makeText(this, s + " Binance Futures uygulamasında açılıyor...", Toast.LENGTH_SHORT).show();
                return;
            }

            // 2) Robust Binance in-app webview fallback. This keeps the user
            // inside the Binance app and still opens the exact Futures URL.
            try {
                String b64 = android.util.Base64.encodeToString(
                        web.getBytes("UTF-8"), android.util.Base64.NO_WRAP);
                String inApp = "bnc://app.binance.com/webview/webview?type=default&needLogin=true&url="
                        + Uri.encode(b64);
                if (v9524TryBinanceUri(inApp)) {
                    Toast.makeText(this, s + " Binance uygulaması içinde Futures sayfası açılıyor...", Toast.LENGTH_SHORT).show();
                    return;
                }
            } catch (Throwable ignored) {}

            // 3) Last native route: open Binance Markets/Futures area and put
            // the symbol on the clipboard. This is intentionally preferred to
            // an unsupported custom URI that displays an error dialog.
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

            if (v9524LaunchBinanceHome(s)) return;
        }

        // Browser is used only when the official Binance app is unavailable or
        // the installed build exposes none of the safe package-pinned routes.
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web)));
            Toast.makeText(this,
                    "Binance uygulaması bu bağlantıyı desteklemedi; Futures sayfası tarayıcıda açıldı.",
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
    ('https://www.binance.com/en/futures/' in out, 'exact official Futures URL'),
    ('bnc://app.binance.com/webview/webview' in out, 'Binance in-app webview fallback'),
    ('bnc://app.binance.com/markets/markets?at=futures' in out, 'native Futures markets fallback'),
    ('v9524LaunchBinanceHome' in out, 'home fallback retained'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.25c sanity failed: ' + name)
print('v9.5.25c OK: unsupported Binance custom URI removed; exact app-link/in-app-webview/native-markets fallbacks installed.')
