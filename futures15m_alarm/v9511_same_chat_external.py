from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.11 missing: {p}')

# ------------------------------------------------------------------
# v9.5.11: SAME CHAT / EXTERNAL CHATGPT MODE
# ACTION_SEND to ChatGPT tends to open a fresh share composer/new chat.
# Instead, copy the latest master prompt, keep the analysis image saved,
# and launch the standalone ChatGPT app itself. Android then returns to
# ChatGPT's last active conversation when possible.
# ------------------------------------------------------------------
a = ANALYSIS.read_text()

a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*',
           'ChatGPT ANALİZ PAKETİ • v9.5.11', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*',
           'Futures15mAlarmPRO/9.5.11', a)

a = a.replace('shareButton = button("CHATGPT\'YE GÖNDER", Color.rgb(111, 34, 226));',
              'shareButton = button("CHATGPT\'Yİ AÇ • AYNI SOHBETE DEVAM", Color.rgb(111, 34, 226));')
a = a.replace('CHATGPT\'YE GÖNDER\'e bas.',
              'CHATGPT\'Yİ AÇ • AYNI SOHBETE DEVAM butonuna bas. Prompt panoya kopyalanır; grafik telefona kaydedilir.')

start = a.find('    private void sharePack() {')
end = a.find('    private String buildPrompt(', start + 10)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('v9.5.11 sharePack boundary not found')

share_method = r'''    private void sharePack() {
        if (shareText == null) return;

        // v9.5.11 V9511_SAME_CHAT_EXTERNAL
        // Do NOT ACTION_SEND into ChatGPT: that path commonly starts a new
        // share composer/conversation. Keep the latest prompt on clipboard,
        // leave the chart image in Pictures/FuturesAlarm, and launch the
        // standalone ChatGPT application so its last active chat stays open.
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("15m Futures PRO master analiz", shareText));
        }

        String imageNote = imageUri != null
                ? " Grafik de Pictures/FuturesAlarm klasörüne kaydedildi."
                : "";

        Intent launch = getPackageManager().getLaunchIntentForPackage("com.openai.chatgpt");
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(launch);
            Toast.makeText(this,
                    "AYNI SOHBET MODU: ChatGPT harici uygulama olarak açıldı. Prompt panoda." + imageNote,
                    Toast.LENGTH_LONG).show();
            return;
        }

        // Official app is not installed: open ChatGPT in the external browser.
        try {
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse("https://chatgpt.com/"));
            browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(browser);
            Toast.makeText(this,
                    "ChatGPT uygulaması bulunamadı; dış tarayıcı açıldı. Prompt panoda." + imageNote,
                    Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this,
                    "ChatGPT açılamadı. Prompt panoya kopyalandı." + imageNote,
                    Toast.LENGTH_LONG).show();
        }
    }

'''
a = a[:start] + share_method + a[end:]

# Same-chat safety: history is useful for continuity, but old coin/price plans
# must never contaminate the current analysis package.
prompt_anchor = '        sb.append("15M FUTURES PRO MANUEL ANALİZ PROTOKOLÜ\\n\\n");\n'
if prompt_anchor not in a:
    raise SystemExit('v9.5.11 prompt header anchor not found')
if 'AYNI SOHBET GÜVENLİK KURALI' not in a:
    same_chat_rule = (
        '        sb.append("AYNI SOHBET GÜVENLİK KURALI: Bu mesaj önceki analizlerle aynı ChatGPT sohbetinde olabilir. "\n'
        '                + "Bağlam devamlılığı için geçmişi görebilirsin ancak ANA KARAR ve tüm yeni seviyeler yalnız EN SON gönderilen bu paket, "\n'
        '                + "ekli güncel grafik ve aşağıdaki canlı verilerden üretilmelidir. Önceki coin, eski fiyat, eski FVG/OB/Fibonacci veya eski giriş seviyelerini "\n'
        '                + "güncelmiş gibi taşıma. Aynı sembol olsa bile eski planı yalnız karşılaştırma için kullan; güncel yapı desteklemiyorsa at. "\n'
        '                + "Sembol değiştiyse önceki sembole ait tüm seviyeleri yok say. Eksik veriyi uydurma.\\n\\n");\n'
    )
    a = a.replace(prompt_anchor, prompt_anchor + same_chat_rule, 1)

ANALYSIS.write_text(a)

# Main screen version label.
m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
           '15m Futures Alarm PRO v9.5.11', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
           'v9.5.11  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:',
           'v9.5.11 MANUEL PRO çalışma şekli:', m)
MAIN.write_text(m)

# Version bump.
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 25', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.11'", b, count=1)
BUILD.write_text(b)

# Fail-fast checks.
af = ANALYSIS.read_text()
mf = MAIN.read_text()
bf = BUILD.read_text()
checks = [
    ('V9511_SAME_CHAT_EXTERNAL' in af, 'same-chat external marker'),
    ('getLaunchIntentForPackage("com.openai.chatgpt")' in af, 'external ChatGPT launch'),
    ('Intent.ACTION_SEND' not in af[af.find('private void sharePack'):af.find('private String buildPrompt')], 'ACTION_SEND still present in sharePack'),
    ('AYNI SOHBET GÜVENLİK KURALI' in af, 'same-chat anti-contamination prompt'),
    ('CHATGPT\'Yİ AÇ • AYNI SOHBETE DEVAM' in af, 'same-chat button label'),
    ('ChatGPT ANALİZ PAKETİ • v9.5.11' in af, 'analysis version'),
    ('v9.5.11' in mf, 'main version'),
    ('versionCode 25' in bf and "versionName '9.5.11'" in bf, 'build version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.11 check failed: ' + msg)

print('v9.5.11 OK: ChatGPT opens externally in last-active-chat mode; prompt is copied; chart remains saved; current-package-only safety rule added.')
