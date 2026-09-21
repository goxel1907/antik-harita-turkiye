from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, MANIFEST, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.24 missing: ' + str(p))


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

# ------------------------------------------------------------------
# Native Binance handoff.
# Previous implementation targeted the HTTPS futures URL at com.binance.dev;
# current Binance Android builds can reject that activity route and Android
# then falls back to Chrome. Use Binance's native URL scheme first and keep
# browser fallback only when the Binance package is genuinely unavailable.
# ------------------------------------------------------------------
b = method_bounds(m, '    private void v9522OpenExactFutures(String sym) ')
if not b:
    raise SystemExit('v9.5.24 v9522OpenExactFutures anchor missing')
a0, _, e0 = b
new_open = r'''    // V9524_BINANCE_NATIVE_DEEPLINK
    private boolean v9524TryBinanceUri(String raw) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(raw));
            i.setPackage("com.binance.dev");
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(i);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private boolean v9524BinanceInstalled() {
        try {
            getPackageManager().getPackageInfo("com.binance.dev", 0);
            return true;
        } catch (Throwable ignored) {
            try {
                return getPackageManager().getLaunchIntentForPackage("com.binance.dev") != null;
            } catch (Throwable ignored2) {
                return false;
            }
        }
    }

    private boolean v9524LaunchBinanceHome(String sym) {
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage("com.binance.dev");
            if (launch == null) return false;
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(launch);
            try {
                android.content.ClipboardManager cm = (android.content.ClipboardManager)
                        getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText("Binance Futures sembolü", sym));
            } catch (Throwable ignored) {}
            Toast.makeText(this,
                    "Binance uygulaması açıldı. " + sym + " sembolü panoya kopyalandı; uygulama sürümü doğrudan Futures deep linkini desteklemedi.",
                    Toast.LENGTH_LONG).show();
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private void v9522OpenExactFutures(String sym) {
        String s = sym == null ? "" : sym.trim().toUpperCase(java.util.Locale.US);
        if (s.isEmpty()) return;
        String q = Uri.encode(s);

        // Primary native route used by current mobile integrations.
        if (v9524TryBinanceUri("binance://futures/trade?symbol=" + q)) {
            Toast.makeText(this, s + " Binance Futures uygulamasında açılıyor...", Toast.LENGTH_SHORT).show();
            return;
        }

        // Compatibility routes for Binance builds/regions with a different
        // registered path. All are package-pinned, so they cannot open Chrome.
        String[] nativeRoutes = new String[]{
                "binance://futures/trade/" + q,
                "binance://futures/" + q,
                "bnc://app.binance.com/futures/" + q,
                "https://www.binance.com/en/futures/" + q
        };
        for (String route : nativeRoutes) {
            if (v9524TryBinanceUri(route)) {
                Toast.makeText(this, s + " Binance Futures uygulamasında açılıyor...", Toast.LENGTH_SHORT).show();
                return;
            }
        }

        // If Binance is installed, never dump the user into Chrome. Open the
        // native app home as a safe fallback and copy the contract symbol.
        if (v9524BinanceInstalled() && v9524LaunchBinanceHome(s)) return;

        // Browser fallback only when the official Binance Android app is not
        // installed/resolvable on this device.
        String web = "https://www.binance.com/en/futures/" + q;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web)));
            Toast.makeText(this, "Binance uygulaması bulunamadı; Futures sayfası tarayıcıda açıldı.", Toast.LENGTH_LONG).show();
        } catch (Throwable ignored) {
            Toast.makeText(this, "Binance Futures açılamadı.", Toast.LENGTH_LONG).show();
        }
    }'''
m = m[:a0] + new_open + m[e0:]

# Visible version bump only. Internal v9522 helper names deliberately remain
# stable because later order-ticket code calls them.
m = m.replace('v9.5.23  •  MANUEL PRO', 'v9.5.24  •  MANUEL PRO')
m = m.replace('15m Futures Alarm PRO v9.5.23', '15m Futures Alarm PRO v9.5.24')
if 'V9524_NATIVE_BINANCE_APP' not in m:
    p = m.find('\n', m.find('public class '))
    if p < 0:
        p = 0
    m = m[:p+1] + '    // V9524_NATIVE_BINANCE_APP\n' + m[p+1:]
MAIN.write_text(m)

# Android 11+ package visibility: explicitly declare the official Binance app
# package so package/install checks are reliable. Existing manifest remains
# otherwise untouched.
manifest = MANIFEST.read_text()
if 'android:name="com.binance.dev"' not in manifest:
    tag_end = manifest.find('>')
    if tag_end < 0:
        raise SystemExit('v9.5.24 malformed AndroidManifest.xml')
    queries = '\n    <queries>\n        <package android:name="com.binance.dev" />\n    </queries>\n'
    manifest = manifest[:tag_end+1] + queries + manifest[tag_end+1:]
MANIFEST.write_text(manifest)

build = BUILD.read_text()
build = re.sub(r'versionCode\s+\d+', 'versionCode 38', build, count=1)
build = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.24'", build, count=1)
BUILD.write_text(build)

mf = MAIN.read_text(); man = MANIFEST.read_text(); bf = BUILD.read_text()
checks = [
    ('V9524_NATIVE_BINANCE_APP' in mf, 'native app marker'),
    ('binance://futures/trade?symbol=' in mf, 'primary Binance futures deep link'),
    ('i.setPackage("com.binance.dev")' in mf, 'deep link pinned to Binance package'),
    ('v9524LaunchBinanceHome' in mf, 'native home fallback'),
    ('Binance uygulaması bulunamadı' in mf, 'browser only if app unavailable'),
    ('<package android:name="com.binance.dev" />' in man, 'Android package visibility'),
    ('versionCode 38' in bf and "versionName '9.5.24'" in bf, 'version bump'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.24 sanity failed: ' + name)
print('v9.5.24 OK: Binance Futures native deep link first; Chrome fallback only if Binance app unavailable.')
