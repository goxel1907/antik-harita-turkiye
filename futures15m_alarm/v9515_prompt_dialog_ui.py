from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.15 missing: {p}')

a = ANALYSIS.read_text()
start = a.find('    private void sharePack() {')
end = a.find('    private void copyMasterPromptToClipboard()', start + 10)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('v9.5.15 sharePack boundary not found')

method = r'''    private void sharePack() {
        if (shareText == null || shareText.trim().isEmpty()) {
            Toast.makeText(this, "Analiz promptu hazır değil. Paketi yeniden oluştur.", Toast.LENGTH_LONG).show();
            return;
        }

        // v9.5.15 V9515_VISIBLE_PROMPT_DIALOG
        // Keep the full MASTER PROMPT visible and selectable instead of hiding
        // transfer actions behind AlertDialog setMessage + setItems competition.
        copyMasterPromptToClipboard();

        final float density = getResources().getDisplayMetrics().density;
        final int pad = (int) (16f * density);
        final int gap = (int) (8f * density);
        final int previewHeight = (int) (260f * density);

        android.widget.LinearLayout root = new android.widget.LinearLayout(this);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        root.setPadding(pad, gap, pad, gap);

        android.widget.TextView info = new android.widget.TextView(this);
        info.setText("MASTER PROMPT hazır ve şu anda panoya da kopyalandı. Aşağıdaki kutudan tamamını görebilir/seçebilirsin.\n\n" +
                "PROMPT + GRAFİK modu ikisini birlikte ChatGPT paylaşımına yollar.\n" +
                "AYNI SOHBET modu son açık ChatGPT konuşmasını öne getirir; prompt panoda kalır.");
        info.setTextSize(16f);
        info.setPadding(0, 0, 0, gap);
        root.addView(info, new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));

        android.widget.TextView label = new android.widget.TextView(this);
        label.setText("MASTER PROMPT ÖNİZLEME");
        label.setTextSize(15f);
        label.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        label.setPadding(0, gap, 0, gap);
        root.addView(label);

        android.widget.ScrollView promptScroll = new android.widget.ScrollView(this);
        android.widget.TextView promptView = new android.widget.TextView(this);
        promptView.setText(shareText);
        promptView.setTextSize(12f);
        promptView.setTextIsSelectable(true);
        promptView.setPadding(gap, gap, gap, gap);
        promptView.setBackgroundColor(android.graphics.Color.rgb(20, 30, 45));
        promptView.setTextColor(android.graphics.Color.WHITE);
        promptScroll.addView(promptView, new android.widget.ScrollView.LayoutParams(
                android.widget.ScrollView.LayoutParams.MATCH_PARENT,
                android.widget.ScrollView.LayoutParams.WRAP_CONTENT));
        android.widget.LinearLayout.LayoutParams scrollLp = new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT, previewHeight);
        scrollLp.setMargins(0, 0, 0, gap);
        root.addView(promptScroll, scrollLp);

        android.widget.Button copyButton = new android.widget.Button(this);
        copyButton.setText("MASTER PROMPTU KOPYALA");
        root.addView(copyButton, new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));

        android.widget.Button sendButton = new android.widget.Button(this);
        sendButton.setText("PROMPT + GRAFİĞİ CHATGPT'YE GÖNDER");
        root.addView(sendButton, new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));

        android.widget.Button sameChatButton = new android.widget.Button(this);
        sameChatButton.setText("AYNI SOHBETİ AÇ • PROMPT PANODA");
        root.addView(sameChatButton, new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));

        final android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(this)
                .setTitle("ChatGPT aktarımı • MASTER PROMPT")
                .setView(root)
                .setNegativeButton("KAPAT", null)
                .create();

        copyButton.setOnClickListener(v -> {
            copyMasterPromptToClipboard();
            Toast.makeText(this, "MASTER PROMPT panoya kopyalandı.", Toast.LENGTH_SHORT).show();
        });
        sendButton.setOnClickListener(v -> {
            dialog.dismiss();
            sendPromptAndChartToChatGPT();
        });
        sameChatButton.setOnClickListener(v -> {
            dialog.dismiss();
            openChatGptSameChatMode();
        });

        dialog.show();
    }

'''

a = a[:start] + method + a[end:]
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*',
           'ChatGPT ANALİZ PAKETİ • v9.5.15', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*',
           'Futures15mAlarmPRO/9.5.15', a)
ANALYSIS.write_text(a)

m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
           '15m Futures Alarm PRO v9.5.15', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
           'v9.5.15  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:',
           'v9.5.15 MANUEL PRO çalışma şekli:', m)
MAIN.write_text(m)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 29', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.15'", b, count=1)
BUILD.write_text(b)

af = ANALYSIS.read_text()
checks = [
    ('V9515_VISIBLE_PROMPT_DIALOG' in af, 'visible prompt dialog marker'),
    ('MASTER PROMPT ÖNİZLEME' in af, 'prompt preview label'),
    ('promptView.setText(shareText)' in af, 'full prompt preview'),
    ('MASTER PROMPTU KOPYALA' in af, 'copy prompt button'),
    ("PROMPT + GRAFİĞİ CHATGPT'YE GÖNDER" in af, 'combined transfer button'),
    ('AYNI SOHBETİ AÇ • PROMPT PANODA' in af, 'same-chat button'),
    ('ChatGPT ANALİZ PAKETİ • v9.5.15' in af, 'analysis version'),
    ('v9.5.15' in MAIN.read_text(), 'main version'),
    ("versionName '9.5.15'" in BUILD.read_text() and 'versionCode 29' in BUILD.read_text(), 'build version'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.15 check failed: ' + msg)

print('v9.5.15 OK: MASTER PROMPT is visible/selectable in a scroll box; copy, prompt+chart share, and same-chat actions are always visible.')
