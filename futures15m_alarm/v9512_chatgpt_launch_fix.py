from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, MANIFEST, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.12 missing: {p}')

# ---------------------------------------------------------------
# Android 11+ package visibility: without <queries>,
# getLaunchIntentForPackage("com.openai.chatgpt") may return null
# even when the official ChatGPT app is installed.
# ---------------------------------------------------------------
manifest = MANIFEST.read_text()
if 'com.openai.chatgpt' not in manifest:
    q = '''\n    <queries>\n        <package android:name="com.openai.chatgpt" />\n        <intent>\n            <action android:name="android.intent.action.VIEW" />\n            <data android:scheme="https" android:host="chatgpt.com" />\n        </intent>\n    </queries>\n'''
    idx = manifest.find('>')
    if idx < 0:
        raise SystemExit('v9.5.12 malformed AndroidManifest.xml')
    manifest = manifest[:idx+1] + q + manifest[idx+1:]
MANIFEST.write_text(manifest)

# ---------------------------------------------------------------
# Robust external ChatGPT launch.
# Same-chat mode cannot inject text into another app's existing
# composer. Therefore the full current prompt is copied reliably
# to Android clipboard, and the native ChatGPT app is opened.
# If native app is genuinely unavailable, browser is fallback.
# ---------------------------------------------------------------
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*',
           'ChatGPT ANALİZ PAKETİ • v9.5.12', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*',
           'Futures15mAlarmPRO/9.5.12', a)
a = a.replace("CHATGPT'Yİ AÇ • AYNI SOHBETE DEVAM",
              "CHATGPT UYGULAMASINI AÇ • PROMPT PANODA")

start = a.find('    private void sharePack() {')
end = a.find('    private String buildPrompt(', start + 10)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('v9.5.12 sharePack boundary not found')

share_method = r'''    private void sharePack() {
        if (shareText == null || shareText.trim().isEmpty()) {
            Toast.makeText(this, "Analiz promptu hazır değil. Paketi yeniden oluştur.", Toast.LENGTH_LONG).show();
            return;
        }

        // v9.5.12 V9512_CHATGPT_NATIVE_LAUNCH
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("15m Futures PRO MASTER ANALİZ PROMPTU", shareText));
        }

        String imageNote = imageUri != null
                ? " Grafik Pictures/FuturesAlarm klasöründe."
                : "";

        // 1) Normal launcher intent. <queries> in manifest makes this reliable on Android 11+.
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage("com.openai.chatgpt");
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(launch);
                Toast.makeText(this,
                        "ChatGPT açıldı. MASTER PROMPT panoda — mevcut sohbette giriş alanına dokunup YAPIŞTIR." + imageNote,
                        Toast.LENGTH_LONG).show();
                return;
            }
        } catch (Exception ignored) { }

        // 2) Explicit launcher package fallback.
        try {
            Intent explicit = new Intent(Intent.ACTION_MAIN);
            explicit.addCategory(Intent.CATEGORY_LAUNCHER);
            explicit.setPackage("com.openai.chatgpt");
            explicit.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(explicit);
            Toast.makeText(this,
                    "ChatGPT açıldı. MASTER PROMPT panoda — mevcut sohbette YAPIŞTIR." + imageNote,
                    Toast.LENGTH_LONG).show();
            return;
        } catch (Exception ignored) { }

        // 3) Ask the installed ChatGPT app to handle its own https URL.
        try {
            Intent appWeb = new Intent(Intent.ACTION_VIEW, Uri.parse("https://chatgpt.com/"));
            appWeb.setPackage("com.openai.chatgpt");
            appWeb.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(appWeb);
            Toast.makeText(this,
                    "ChatGPT açıldı. MASTER PROMPT panoda — mevcut sohbette YAPIŞTIR." + imageNote,
                    Toast.LENGTH_LONG).show();
            return;
        } catch (Exception ignored) { }

        // 4) Native ChatGPT is truly unavailable: browser only as final fallback.
        try {
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse("https://chatgpt.com/"));
            browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(browser);
            Toast.makeText(this,
                    "Resmî ChatGPT Android uygulaması bulunamadı; tarayıcı açıldı. MASTER PROMPT yine panoda." + imageNote,
                    Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this,
                    "ChatGPT açılamadı. MASTER PROMPT panoya kopyalandı." + imageNote,
                    Toast.LENGTH_LONG).show();
        }
    }

'''
a = a[:start] + share_method + a[end:]

# Make the limitation explicit inside the analysis package so the UI never
# implies that Android can auto-paste into an existing ChatGPT conversation.
notice_anchor = 'AYNI SOHBET GÜVENLİK KURALI:'
if notice_anchor in a and 'ANDROID AKTARIM KURALI:' not in a:
    rule = ('        sb.append("ANDROID AKTARIM KURALI: Aynı mevcut ChatGPT sohbetini korumak için uygulama ACTION_SEND kullanmaz. "\n'
            '                + "Android güvenliği nedeniyle başka uygulamanın mevcut mesaj kutusuna otomatik metin yapıştırılamaz. "\n'
            '                + "Bu nedenle MASTER PROMPT panoya kopyalanır; ChatGPT uygulaması açıldığında aynı sohbette yalnız YAPIŞTIR işlemi gerekir.\\n\\n");\n')
    pos = a.find('        sb.append("AYNI SOHBET GÜVENLİK KURALI:')
    if pos >= 0:
        # Insert before the same-chat safety paragraph.
        a = a[:pos] + rule + a[pos:]

ANALYSIS.write_text(a)

m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
           '15m Futures Alarm PRO v9.5.12', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
           'v9.5.12  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:',
           'v9.5.12 MANUEL PRO çalışma şekli:', m)
MAIN.write_text(m)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 26', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.12'", b, count=1)
BUILD.write_text(b)

# Fail-fast checks.
af = ANALYSIS.read_text()
mf = MAIN.read_text()
bf = BUILD.read_text()
manf = MANIFEST.read_text()
checks = [
    ('V9512_CHATGPT_NATIVE_LAUNCH' in af, 'native launch marker'),
    ('<package android:name="com.openai.chatgpt" />' in manf, 'ChatGPT package query'),
    ('setPackage("com.openai.chatgpt")' in af, 'explicit ChatGPT package fallback'),
    ('MASTER PROMPT panoda' in af, 'clipboard handoff text'),
    ("CHATGPT UYGULAMASINI AÇ • PROMPT PANODA" in af, 'accurate button label'),
    ('ChatGPT ANALİZ PAKETİ • v9.5.12' in af, 'analysis version'),
    ('v9.5.12' in mf, 'main version'),
    ('versionCode 26' in bf and "versionName '9.5.12'" in bf, 'build version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.12 check failed: ' + msg)

print('v9.5.12 OK: Android package visibility fixed; native ChatGPT launch has 3 fallbacks; full prompt copied reliably; browser is final fallback only.')
