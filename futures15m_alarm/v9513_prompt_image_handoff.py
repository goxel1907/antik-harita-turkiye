from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.13 missing: {p}')

a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*',
           'ChatGPT ANALİZ PAKETİ • v9.5.13', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*',
           'Futures15mAlarmPRO/9.5.13', a)
a = a.replace("CHATGPT UYGULAMASINI AÇ • PROMPT PANODA",
              "CHATGPT'YE AKTAR • PROMPT + GRAFİK")

start = a.find('    private void sharePack() {')
end = a.find('    private String buildPrompt(', start + 10)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('v9.5.13 sharePack boundary not found')

methods = r'''    private void sharePack() {
        if (shareText == null || shareText.trim().isEmpty()) {
            Toast.makeText(this, "Analiz promptu hazır değil. Paketi yeniden oluştur.", Toast.LENGTH_LONG).show();
            return;
        }

        // v9.5.13 V9513_PROMPT_IMAGE_HANDOFF
        // Android clipboard cannot reliably paste both long text and an image URI
        // into another app's *existing* composer. Therefore expose two honest modes:
        // 1) share prompt + chart together via ACTION_SEND;
        // 2) preserve the last active ChatGPT conversation by opening the app and
        //    keeping the full prompt on clipboard.
        copyMasterPromptToClipboard();

        final String[] modes = new String[] {
                "PROMPT + GRAFİĞİ CHATGPT'YE GÖNDER",
                "AYNI SOHBETİ AÇ • PROMPT PANODA"
        };

        new android.app.AlertDialog.Builder(this)
                .setTitle("ChatGPT aktarım şekli")
                .setMessage("Prompt hazır. Grafik de analiz paketinden hazırlandı.\n\n" +
                        "PROMPT + GRAFİK: İkisini birlikte ChatGPT paylaşımına yollar; mevcut sohbet korunması Android/ChatGPT tarafından garanti edilmez.\n\n" +
                        "AYNI SOHBET: ChatGPT uygulamasını son açık konuşmada öne getirir; prompt panodadır. Grafik otomatik yapıştırılamaz, analiz ekranından/galeriden eklenir.")
                .setItems(modes, (dialog, which) -> {
                    if (which == 0) {
                        sendPromptAndChartToChatGPT();
                    } else {
                        openChatGptSameChatMode();
                    }
                })
                .setNegativeButton("İPTAL", null)
                .show();
    }

    private void copyMasterPromptToClipboard() {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null && shareText != null) {
            cm.setPrimaryClip(ClipData.newPlainText(
                    "15m Futures PRO MASTER ANALİZ PROMPTU", shareText));
        }
    }

    private void sendPromptAndChartToChatGPT() {
        copyMasterPromptToClipboard();

        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setPackage("com.openai.chatgpt");
            send.putExtra(Intent.EXTRA_TEXT, shareText);

            if (imageUri != null) {
                send.setType("image/*");
                send.putExtra(Intent.EXTRA_STREAM, imageUri);
                send.setClipData(ClipData.newRawUri("Futures PRO analiz grafiği", imageUri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                send.setType("text/plain");
            }

            startActivity(send);
            Toast.makeText(this,
                    imageUri != null
                            ? "ChatGPT paylaşımı açıldı: MASTER PROMPT + analiz grafiği birlikte gönderime hazır."
                            : "Grafik URI hazır değil; MASTER PROMPT ChatGPT paylaşımına gönderildi ve panoya da kopyalandı.",
                    Toast.LENGTH_LONG).show();
            return;
        } catch (Exception ignored) { }

        // If ChatGPT does not expose a compatible ACTION_SEND activity on this
        // device/version, keep the payload intact and show Android's share chooser.
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.putExtra(Intent.EXTRA_TEXT, shareText);
            if (imageUri != null) {
                send.setType("image/*");
                send.putExtra(Intent.EXTRA_STREAM, imageUri);
                send.setClipData(ClipData.newRawUri("Futures PRO analiz grafiği", imageUri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                send.setType("text/plain");
            }
            startActivity(Intent.createChooser(send, "Prompt + grafiği ChatGPT ile paylaş"));
            Toast.makeText(this,
                    "Doğrudan ChatGPT paylaşımı bulunamadı; Android paylaşım menüsü açıldı. Prompt panoda da duruyor.",
                    Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this,
                    "Paylaşım açılamadı. MASTER PROMPT panoda; grafik analiz ekranında kayıtlı.",
                    Toast.LENGTH_LONG).show();
        }
    }

    private void openChatGptSameChatMode() {
        copyMasterPromptToClipboard();
        String imageNote = imageUri != null
                ? " Grafik analiz paketinde ve Pictures/FuturesAlarm klasöründe kayıtlı."
                : "";

        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage("com.openai.chatgpt");
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(launch);
                Toast.makeText(this,
                        "ChatGPT açıldı. MASTER PROMPT panoda — mesaj alanına dokunup YAPIŞTIR." + imageNote,
                        Toast.LENGTH_LONG).show();
                return;
            }
        } catch (Exception ignored) { }

        try {
            Intent explicit = new Intent(Intent.ACTION_MAIN);
            explicit.addCategory(Intent.CATEGORY_LAUNCHER);
            explicit.setPackage("com.openai.chatgpt");
            explicit.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(explicit);
            Toast.makeText(this,
                    "ChatGPT açıldı. MASTER PROMPT panoda — mesaj alanına dokunup YAPIŞTIR." + imageNote,
                    Toast.LENGTH_LONG).show();
            return;
        } catch (Exception ignored) { }

        try {
            Intent appWeb = new Intent(Intent.ACTION_VIEW, Uri.parse("https://chatgpt.com/"));
            appWeb.setPackage("com.openai.chatgpt");
            appWeb.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(appWeb);
            Toast.makeText(this,
                    "ChatGPT açıldı. MASTER PROMPT panoda — mesaj alanına dokunup YAPIŞTIR." + imageNote,
                    Toast.LENGTH_LONG).show();
            return;
        } catch (Exception ignored) { }

        try {
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse("https://chatgpt.com/"));
            browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(browser);
            Toast.makeText(this,
                    "ChatGPT uygulaması bulunamadı; tarayıcı açıldı. MASTER PROMPT panoda." + imageNote,
                    Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this,
                    "ChatGPT açılamadı. MASTER PROMPT panoya kopyalandı." + imageNote,
                    Toast.LENGTH_LONG).show();
        }
    }

'''
a = a[:start] + methods + a[end:]

# Correct any older transfer rule that implied the chart itself could live in
# clipboard alongside text as a reliable ChatGPT paste operation.
if 'ANDROID AKTARIM KURALI:' in a:
    a = re.sub(
        r'        sb\.append\("ANDROID AKTARIM KURALI:.*?\\n\\n"\);\n',
        '        sb.append("ANDROID AKTARIM KURALI: PROMPT + GRAFİK modunda Android paylaşımı ile metin ve grafik birlikte ChatGPTye aktarılır. "\n'
        '                + "AYNI SOHBET modunda mevcut konuşmayı korumak için MASTER PROMPT panoya kopyalanır ve ChatGPT uygulaması öne getirilir; "\n'
        '                + "Android başka uygulamanın mevcut mesaj kutusuna grafik ve metni otomatik yapıştıramadığı için grafik gerektiğinde analiz paketinden eklenir.\\n\\n");\n',
        a, count=1, flags=re.S)

ANALYSIS.write_text(a)

m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
           '15m Futures Alarm PRO v9.5.13', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
           'v9.5.13  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:',
           'v9.5.13 MANUEL PRO çalışma şekli:', m)
MAIN.write_text(m)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 27', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.13'", b, count=1)
BUILD.write_text(b)

af = ANALYSIS.read_text()
mf = MAIN.read_text()
bf = BUILD.read_text()
checks = [
    ('V9513_PROMPT_IMAGE_HANDOFF' in af, 'handoff marker'),
    ('Intent.EXTRA_STREAM' in af, 'chart stream payload'),
    ('Intent.EXTRA_TEXT' in af, 'prompt payload'),
    ('FLAG_GRANT_READ_URI_PERMISSION' in af, 'image URI permission'),
    ('setPackage("com.openai.chatgpt")' in af, 'direct ChatGPT share target'),
    ("PROMPT + GRAFİĞİ CHATGPT'YE GÖNDER" in af, 'combined transfer mode'),
    ('AYNI SOHBETİ AÇ • PROMPT PANODA' in af, 'same-chat mode'),
    ('ChatGPT ANALİZ PAKETİ • v9.5.13' in af, 'analysis version'),
    ('v9.5.13' in mf, 'main version'),
    ('versionCode 27' in bf and "versionName '9.5.13'" in bf, 'build version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.13 check failed: ' + msg)

print('v9.5.13 OK: honest two-mode ChatGPT handoff added; prompt+chart can be shared together; same-chat mode keeps prompt on clipboard without falsely claiming image paste support.')
