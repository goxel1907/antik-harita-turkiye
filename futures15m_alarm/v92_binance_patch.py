from pathlib import Path
import re

ROOT = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = ROOT / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
GRADLE = ROOT / 'app/build.gradle'

for path in (MAIN, GRADLE):
    if not path.exists():
        raise SystemExit(f'Missing required file: {path}')

s = MAIN.read_text()

# Binance'in bu uygulama surumunde hata veren eski bnc:// futures deeplinklerini tamamen kaldir.
# Once resmi Futures web URL'sini dogrudan Binance Android paketine ver.
# Binance bu universal linki desteklemiyorsa uygulamayi ac ve sembolu panoya kopyala.
new_method = '''    private void openBinanceFutures(String symbol) {
        String sym = symbol == null ? "" : symbol.trim().toUpperCase(Locale.US);
        if (sym.isEmpty()) return;

        String futuresUrl = "https://www.binance.com/en/futures/" + Uri.encode(sym);

        try {
            Intent direct = new Intent(Intent.ACTION_VIEW, Uri.parse(futuresUrl));
            direct.setPackage("com.binance.dev");
            direct.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(direct);
            return;
        } catch (Exception ignored) {
        }

        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage("com.binance.dev");
            if (launch != null) {
                ClipboardManager cb = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cb != null) cb.setPrimaryClip(ClipData.newPlainText("Binance Futures coin", sym));
                startActivity(launch);
                Toast.makeText(this,
                        sym + " kopyalandi • Binance acildi. Futures aramasina yapistir.",
                        Toast.LENGTH_LONG).show();
                return;
            }
        } catch (Exception ignored) {
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(futuresUrl)));
        } catch (Exception e) {
            Toast.makeText(this, "Binance Futures acilamadi.", Toast.LENGTH_LONG).show();
        }
    }'''

pattern = re.compile(r'    private void openBinanceFutures\(String symbol\) \{.*?\n    \}\n\n    private void copyPlan', re.S)
s, count = pattern.subn(new_method + '\n\n    private void copyPlan', s)
if count != 1:
    raise SystemExit(f'Could not replace Binance method; matches={count}')

s = s.replace('15m Futures Alarm PRO v9.1 • MANUEL PRO',
              '15m Futures Alarm PRO v9.2 • MANUEL PRO')
MAIN.write_text(s)

b = GRADLE.read_text()
b = b.replace('versionCode 10', 'versionCode 11')
b = b.replace("versionName '9.1.0'", "versionName '9.2.0'")
GRADLE.write_text(b)

final = MAIN.read_text()
if 'bnc://app.binance.com/futures' in final:
    raise SystemExit('Old broken Binance bnc:// futures deeplink is still present')
if 'https://www.binance.com/en/futures/' not in final:
    raise SystemExit('Binance HTTPS futures URL missing')
if 'direct.setPackage("com.binance.dev")' not in final:
    raise SystemExit('Explicit Binance Android package routing missing')
if '15m Futures Alarm PRO v9.2' not in final:
    raise SystemExit('v9.2 title missing')
if 'versionCode 11' not in GRADLE.read_text():
    raise SystemExit('versionCode 11 missing')

print('v9.2 Binance link patch OK: broken bnc:// removed; HTTPS Futures URL routed to Binance app.')
