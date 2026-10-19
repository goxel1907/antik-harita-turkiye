from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.67 missing required file: ' + str(p))


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n':
                line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
        elif in_chr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                in_chr = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"':
                in_str = True
            elif c == "'":
                in_chr = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)


def replace_method(src, signature, replacement):
    b = method_bounds(src, signature)
    if not b:
        raise SystemExit('v9.5.67 method missing: ' + signature)
    a, _, e = b
    return src[:a] + replacement + src[e:]


def java_lex_sanity(src):
    depth = 0
    i = 0
    line = 1
    state = 'code'
    esc = False
    while i < len(src):
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if c == '\n':
            line += 1
        if state == 'line':
            if c == '\n':
                state = 'code'
            i += 1
            continue
        if state == 'block':
            if c == '*' and n == '/':
                state = 'code'
                i += 2
                continue
            i += 1
            continue
        if state == 'string':
            if c == '\n':
                return False, 'newline inside Java string near line ' + str(line)
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                state = 'code'
            i += 1
            continue
        if state == 'char':
            if c == '\n':
                return False, 'newline inside Java char near line ' + str(line)
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                state = 'code'
            i += 1
            continue
        if c == '/' and n == '/':
            state = 'line'
            i += 2
            continue
        if c == '/' and n == '*':
            state = 'block'
            i += 2
            continue
        if c == '"':
            state = 'string'
            esc = False
            i += 1
            continue
        if c == "'":
            state = 'char'
            esc = False
            i += 1
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth < 0:
                return False, 'extra closing brace near line ' + str(line)
        i += 1
    if state in ('string', 'char', 'block'):
        return False, 'unclosed Java lexical state ' + state
    if depth != 0:
        return False, 'unclosed structural brace depth ' + str(depth)
    return True, 'OK'


a = ANALYSIS.read_text()
main = MAIN.read_text()
mon = MON.read_text()
bf = BUILD.read_text()

for marker in ('V9565_EXTERNAL_SAME_CHAT_BROWSER', 'v9565OpenSavedChat', 'v9565OpenBrowserTab',
               'V9564_PLAN_CODE_ONLY_CONTRACT', 'V9564_BATCH_FINAL_OUTPUT'):
    if marker not in a:
        raise SystemExit('v9.5.67 prerequisite missing: ' + marker)
if 'if (unique.size() >= 8) break;' not in a:
    raise SystemExit('v9.5.67 batch max-8 guard missing')
if 'selected.size() < 2 || selected.size() > 8' not in main:
    raise SystemExit('v9.5.67 main 2-8 selector guard missing')

# App-first route to the one saved private /c/ conversation. Browser remains a
# compatibility fallback. Prompt stays on clipboard; nothing is injected into ChatGPT.
if 'V9567_CLIPBOARD_GALLERY_SAME_CHAT' not in a:
    pos = a.rfind('}')
    helper = r'''
    // ============================================================
    // V9567_CLIPBOARD_GALLERY_SAME_CHAT
    // Flow: prompt -> clipboard, chart(s) -> phone Gallery, then open the one
    // saved private ChatGPT /c/ conversation in the official app first.
    // The user manually pastes the prompt and manually selects Gallery images.
    // No ACTION_SEND payload is used for normal analysis transfer.
    // ============================================================
    private boolean v9567OpenChatGptAppFirst(String url) {
        if (url == null || url.trim().isEmpty()) return false;
        android.net.Uri uri;
        try {
            uri = android.net.Uri.parse(url.trim());
        } catch (Throwable ignored) {
            return false;
        }
        try {
            android.content.Intent appIntent = new android.content.Intent(
                    android.content.Intent.ACTION_VIEW, uri);
            appIntent.setPackage("com.openai.chatgpt");
            appIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(appIntent);
            return true;
        } catch (Throwable appUnavailableOrRouteUnsupported) {
            return v9565OpenBrowserTab(url);
        }
    }

    private android.content.SharedPreferences v9567GalleryPrefs() {
        return getSharedPreferences("v9567_gallery_export", MODE_PRIVATE);
    }

    private String v9567SourceName(android.net.Uri src, int index) {
        String name = "";
        android.database.Cursor c = null;
        try {
            c = getContentResolver().query(
                    src,
                    new String[]{android.provider.OpenableColumns.DISPLAY_NAME},
                    null, null, null);
            if (c != null && c.moveToFirst()) {
                int col = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (col >= 0) name = c.getString(col);
            }
        } catch (Throwable ignored) {
        } finally {
            if (c != null) try { c.close(); } catch (Throwable ignored) { }
        }
        if (name == null) name = "";
        name = name.trim().replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.isEmpty()) {
            name = "FuturesPRO_" + System.currentTimeMillis() + "_" + (index + 1) + ".png";
        } else if (!name.contains(".")) {
            name = name + ".png";
        }
        return name;
    }

    private void v9567Copy(android.net.Uri src, java.io.OutputStream out) throws java.io.IOException {
        java.io.InputStream in = null;
        try {
            in = getContentResolver().openInputStream(src);
            if (in == null) throw new java.io.IOException("source image unavailable");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) >= 0) {
                if (n > 0) out.write(buf, 0, n);
            }
            out.flush();
        } finally {
            if (in != null) try { in.close(); } catch (Throwable ignored) { }
        }
    }

    private boolean v9567ExportImage(android.net.Uri src, int index) {
        if (src == null) return false;
        String sourceKey = "src_" + Integer.toHexString(src.toString().hashCode());
        String prior = v9567GalleryPrefs().getString(sourceKey, "");
        if (prior != null && !prior.isEmpty()) {
            java.io.InputStream check = null;
            try {
                check = getContentResolver().openInputStream(android.net.Uri.parse(prior));
                if (check != null) return true;
            } catch (Throwable ignored) {
            } finally {
                if (check != null) try { check.close(); } catch (Throwable ignored) { }
            }
        }

        String name = v9567SourceName(src, index);
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            android.content.ContentValues cv = new android.content.ContentValues();
            cv.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, name);
            cv.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
            cv.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,
                    android.os.Environment.DIRECTORY_PICTURES + "/Futures15mAlarm");
            cv.put(android.provider.MediaStore.Images.Media.IS_PENDING, 1);
            android.net.Uri outUri = null;
            java.io.OutputStream out = null;
            try {
                outUri = getContentResolver().insert(
                        android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                if (outUri == null) return false;
                out = getContentResolver().openOutputStream(outUri, "w");
                if (out == null) return false;
                v9567Copy(src, out);
                out.close();
                out = null;
                android.content.ContentValues done = new android.content.ContentValues();
                done.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0);
                getContentResolver().update(outUri, done, null, null);
                v9567GalleryPrefs().edit().putString(sourceKey, outUri.toString()).apply();
                return true;
            } catch (Throwable ex) {
                if (outUri != null) try { getContentResolver().delete(outUri, null, null); } catch (Throwable ignored) { }
                return false;
            } finally {
                if (out != null) try { out.close(); } catch (Throwable ignored) { }
            }
        }

        // Legacy Android fallback. If platform storage permission blocks this,
        // analysis transfer still continues; Gallery export is soft convenience only.
        java.io.OutputStream out = null;
        try {
            java.io.File base = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_PICTURES);
            java.io.File dir = new java.io.File(base, "Futures15mAlarm");
            if (!dir.exists() && !dir.mkdirs()) return false;
            java.io.File dst = new java.io.File(dir, name);
            out = new java.io.FileOutputStream(dst);
            v9567Copy(src, out);
            out.close();
            out = null;
            android.media.MediaScannerConnection.scanFile(
                    this,
                    new String[]{dst.getAbsolutePath()},
                    new String[]{"image/png"},
                    null);
            v9567GalleryPrefs().edit().putString(sourceKey,
                    android.net.Uri.fromFile(dst).toString()).apply();
            return true;
        } catch (Throwable ignored) {
            return false;
        } finally {
            if (out != null) try { out.close(); } catch (Throwable ignored) { }
        }
    }

    private int v9567SaveChartsToGallery(boolean batch) {
        java.util.ArrayList<android.net.Uri> sources = new java.util.ArrayList<>();
        if (batch) {
            if (v9545BatchUris != null) {
                for (android.net.Uri u : v9545BatchUris) {
                    if (u != null && !sources.contains(u)) sources.add(u);
                }
            }
        } else if (imageUri != null) {
            sources.add(imageUri);
        }
        int ok = 0;
        for (int i = 0; i < sources.size(); i++) {
            if (v9567ExportImage(sources.get(i), i)) ok++;
        }
        return ok;
    }
'''
    a = a[:pos] + helper + a[pos:]

# Use app-first behavior anywhere the saved-chat workflow opens a URL.
a = a.replace('if (v9565OpenBrowserTab(url)) {', 'if (v9567OpenChatGptAppFirst(url)) {')
a = a.replace('if (!v9565OpenBrowserTab(normalized)) {', 'if (!v9567OpenChatGptAppFirst(normalized)) {')
a = a.replace('boolean ok = v9565OpenBrowserTab("https://chatgpt.com/");',
              'boolean ok = v9567OpenChatGptAppFirst("https://chatgpt.com/");')

# Normal single/batch action: clipboard + Gallery + same saved chat. No automatic
# message/image injection and no share sheet ambiguity.
a = replace_method(a, '    private void v9565OpenSavedChat(String payload, boolean batch)', r'''    private void v9565OpenSavedChat(String payload, boolean batch) {
        if (payload == null || payload.trim().isEmpty()) {
            Toast.makeText(this, "Analiz promptu hazır değil. Paketi yeniden oluştur.", Toast.LENGTH_LONG).show();
            return;
        }
        v9565CopyPayload(payload, batch);
        int galleryCount = v9567SaveChartsToGallery(batch);
        String url = v9565SavedChatUrl();
        if (url.isEmpty()) {
            Toast.makeText(this,
                    "Prompt panoda" + (galleryCount > 0 ? " • grafikler Galeri'de" : "")
                            + ". Önce bu sohbetin /c/ bağlantısını kaydet.",
                    Toast.LENGTH_LONG).show();
            v9565EditChatRoute(payload, batch, true);
            return;
        }
        boolean opened = v9567OpenChatGptAppFirst(url);
        String galleryText = galleryCount > 0
                ? " • " + galleryCount + " grafik Galeri'de"
                : " • grafik Galeri kaydı yok/başarısız";
        Toast.makeText(this,
                (batch ? "Toplu prompt" : "Analiz promptu")
                        + " panoda" + galleryText
                        + (opened ? " • aynı sohbet açıldı. Yapıştır; grafikleri Galeri'den seç."
                                  : " • ChatGPT açılamadı."),
                Toast.LENGTH_LONG).show();
    }''')

# Old "share prompt + charts" fallback becomes an explicit Gallery saver only.
a = replace_method(a, '    private void v9565SharePromptAndCharts()', r'''    private void v9565SharePromptAndCharts() {
        String payload = v9564ActivePrompt();
        if (payload == null || payload.trim().isEmpty()) {
            Toast.makeText(this, "Analiz promptu hazır değil.", Toast.LENGTH_LONG).show();
            return;
        }
        v9565CopyPayload(payload, v9545BatchMode);
        int count = v9567SaveChartsToGallery(v9545BatchMode);
        Toast.makeText(this,
                "Prompt panoda • " + count + " grafik Galeri'de. ChatGPT'de + düğmesinden Galeri'yi seç.",
                Toast.LENGTH_LONG).show();
    }''')

# User-facing wording mirrors the manual, stable workflow.
a = a.replace('CHATGPT SOHBETTE AÇ • PROMPT PANODA',
              'CHATGPT APP • PROMPT PANODA')
a = a.replace('SOHBETTE AÇ • " + v9545BatchDoneSymbols.size() + " COİN',
              'CHATGPT APP • " + v9545BatchDoneSymbols.size() + " COİN')
a = a.replace('Kayıtlı ChatGPT sohbetini dış tarayıcıda aç. Uzun bas: sohbet bağlantısı veya grafik paylaşımı.',
              'Aynı kayıtlı ChatGPT sohbetini açar; prompt panoda, grafik Galeri\'de. Uzun bas: sohbet/grafik ayarları.')
a = a.replace('"PROMPT + GRAFİKLERİ CHATGPT UYGULAMASINA PAYLAŞ"',
              '"GRAFİKLERİ GALERİYE KAYDET"')
a = a.replace('Normal dokunuş kayıtlı sohbeti dış tarayıcıda yeni sekmede açar. "\n                        + "Sohbet limiti dolduğunda yeni sohbet açıp onun /c/ adresini kaydet.',
              'Normal dokunuş aynı kayıtlı sohbeti ChatGPT uygulamasında açar; prompt panodadır ve grafikler Galeriye kaydedilir. "\n                        + "Sohbet limiti dolduğunda yeni sohbet açıp onun /c/ adresini kaydet.')
a = a.replace(' panoda • kayıtlı ChatGPT sohbeti yeni sekmede açıldı. YAPIŞTIR ve gönder.',
              ' panoda • aynı ChatGPT sohbeti açıldı. Yapıştır; grafikleri Galeri\'den seç.')
a = a.replace('Tarayıcı açılamadı. Prompt panoda kaldı.',
              'ChatGPT uygulaması ve tarayıcı yedeği açılamadı. Prompt panoda kaldı.')

# Current package/prompt identity. Historical protocol subsection versions are kept.
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.67', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.67', a)
a = a.replace('V9.5.64 TOPLU ANALİZ PAKETİ', 'V9.5.67 TOPLU ANALİZ PAKETİ')
main = re.sub(r'(?i)v9\.5(?:\.\d+)+', 'v9.5.67', main)
mon = re.sub(r'(?i)v9\.5(?:\.\d+)+', 'v9.5.67', mon)
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091507', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.67'", bf, count=1)

ANALYSIS.write_text(a)
MAIN.write_text(main)
MON.write_text(mon)
BUILD.write_text(bf)

ana = ANALYSIS.read_text()
main = MAIN.read_text()
mon = MON.read_text()
bf = BUILD.read_text()
share_bounds = method_bounds(ana, '    private void v9565SharePromptAndCharts()')
share_body = ana[share_bounds[0]:share_bounds[2]] if share_bounds else ''
checks = {
    'same-chat route retained': 'v9565_chat_route' in ana and 'current_chat_url' in ana and 'path.contains("/c/")' in ana,
    'chatgpt app first': 'V9567_CLIPBOARD_GALLERY_SAME_CHAT' in ana and 'setPackage("com.openai.chatgpt")' in ana,
    'browser fallback': 'return v9565OpenBrowserTab(url);' in ana,
    'gallery export': 'MediaStore.Images.Media.RELATIVE_PATH' in ana,
    'gallery folder': 'Futures15mAlarm' in ana,
    'no auto share in transfer helper': 'ACTION_SEND' not in share_body and 'EXTRA_STREAM' not in share_body,
    'clipboard retained': 'v9565CopyPayload(payload, batch);' in ana,
    'plan-only output retained': 'V9564_PLAN_CODE_ONLY_CONTRACT' in ana and 'V9564_BATCH_FINAL_OUTPUT' in ana,
    'batch 2-8 retained': 'if (unique.size() >= 8) break;' in ana and 'selected.size() < 2 || selected.size() > 8' in main,
    'single prompt version': 'ChatGPT ANALİZ PAKETİ • v9.5.67' in ana,
    'batch prompt version': 'V9.5.67 TOPLU ANALİZ PAKETİ' in ana,
    'version main': 'v9.5.67' in main,
    'version build': 'versionCode 26091507' in bf and "versionName '9.5.67'" in bf,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.67 sanity failed: ' + ', '.join(bad))

for name, src in (('AnalysisPackActivity', ana), ('MainActivity', main), ('MonitorService', mon)):
    ok, why = java_lex_sanity(src)
    print(('OK   ' if ok else 'FAIL '), 'java lexical ' + name, why)
    if not ok:
        raise SystemExit('v9.5.67 Java lexical mismatch in ' + name + ': ' + why)

print('v9.5.67 OK: prompt clipboard + Gallery chart export + one saved ChatGPT conversation; app-first with browser fallback; no automatic chart/message share; 2-8 batch and plan-code-only contracts preserved; trading logic untouched.')
