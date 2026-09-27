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
        raise SystemExit('v9.5.65 missing required file: ' + str(p))

def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0: return None
    b = src.find('{', a)
    if b < 0: return None
    depth = 1; i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(src) and depth:
        c = src[i]; n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n': line_comment = False
        elif block_comment:
            if c == '*' and n == '/': block_comment = False; i += 1
        elif in_str:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
        elif in_chr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == "'": in_chr = False
        else:
            if c == '/' and n == '/': line_comment = True; i += 1
            elif c == '/' and n == '*': block_comment = True; i += 1
            elif c == '"': in_str = True
            elif c == "'": in_chr = True
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
        i += 1
    return None if depth else (a, b, i)

def replace_method(src, signature, replacement):
    b = method_bounds(src, signature)
    if not b: raise SystemExit('v9.5.65 method missing: ' + signature)
    a, _, e = b
    return src[:a] + replacement + src[e:]

def java_lex_sanity(src):
    depth=0; i=0; line=1; state='code'; esc=False
    while i < len(src):
        c=src[i]; n=src[i+1] if i+1 < len(src) else ''
        if c=='\n': line += 1
        if state=='line':
            if c=='\n': state='code'
            i+=1; continue
        if state=='block':
            if c=='*' and n=='/': state='code'; i+=2; continue
            i+=1; continue
        if state=='string':
            if c=='\n': return False,'newline inside Java string near line '+str(line)
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': state='code'
            i+=1; continue
        if state=='char':
            if c=='\n': return False,'newline inside Java char near line '+str(line)
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=="'": state='code'
            i+=1; continue
        if c=='/' and n=='/': state='line'; i+=2; continue
        if c=='/' and n=='*': state='block'; i+=2; continue
        if c=='"': state='string'; esc=False; i+=1; continue
        if c=="'": state='char'; esc=False; i+=1; continue
        if c=='{': depth += 1
        elif c=='}':
            depth -= 1
            if depth < 0: return False,'extra closing brace near line '+str(line)
        i += 1
    if state in ('string','char','block'): return False,'unclosed Java lexical state '+state
    if depth != 0: return False,'unclosed structural brace depth '+str(depth)
    return True,'OK'

a = ANALYSIS.read_text()
main = MAIN.read_text()
for marker in ('V9564_BATCH_AWARE_PROMPT_PAYLOAD','V9564_PLAN_CODE_ONLY_CONTRACT','V9564_BATCH_FINAL_OUTPUT','V9545_BATCH_ANALYSIS','V9513_PROMPT_IMAGE_HANDOFF'):
    if marker not in a: raise SystemExit('v9.5.65 analysis prerequisite missing: ' + marker)
if 'if (unique.size() >= 8) break;' not in a: raise SystemExit('v9.5.65 batch max-8 guard missing')
if 'selected.size() < 2 || selected.size() > 8' not in main: raise SystemExit('v9.5.65 main 2-8 selector guard missing')

share_pack = r'''    private void sharePack() {
        String payload = v9564ActivePrompt();
        v9565OpenSavedChat(payload, false);
    }'''
a = replace_method(a, '    private void sharePack()', share_pack)

a = replace_method(a, '    private void sendPromptAndChartToChatGPT()', r'''    private void sendPromptAndChartToChatGPT() {
        v9565SharePromptAndCharts();
    }''')

a = replace_method(a, '    private void openChatGptSameChatMode()', r'''    private void openChatGptSameChatMode() {
        v9565OpenSavedChat(v9564ActivePrompt(), v9545BatchMode);
    }''')

a = replace_method(a, '    private void v9545ShareBatch()', r'''    private void v9545ShareBatch() {
        if (!v9545BatchMode || v9545CombinedPrompt == null || v9545CombinedPrompt.trim().isEmpty()) {
            Toast.makeText(this, "Toplu prompt henüz hazır değil.", Toast.LENGTH_LONG).show();
            return;
        }
        v9565OpenSavedChat(v9545CombinedPrompt, true);
    }''')

a = a.replace('shareButton = button("CHATGPT\\\'YE AKTAR • PROMPT + GRAFİK", Color.rgb(111, 34, 226));',
              'shareButton = button("CHATGPT SOHBETTE AÇ • PROMPT PANODA", Color.rgb(111, 34, 226));')
a = a.replace('shareButton.setText("CHATGPT\\\'YE AKTAR • " + v9545BatchDoneSymbols.size() + " COİN");',
              'shareButton.setText("SOHBETTE AÇ • " + v9545BatchDoneSymbols.size() + " COİN");')

b = method_bounds(a, '    protected void onCreate(')
if not b: raise SystemExit('v9.5.65 Analysis onCreate missing')
os, _, oe = b
onc = a[os:oe]
if 'V9565_CHAT_ROUTE_LONG_PRESS' not in onc:
    close = onc.rfind('}')
    hook = r'''
        // V9565_CHAT_ROUTE_LONG_PRESS
        if (shareButton != null) {
            shareButton.setOnLongClickListener(v -> {
                v9565ShowChatRouteMenu();
                return true;
            });
            shareButton.setContentDescription(
                    "Kayıtlı ChatGPT sohbetini dış tarayıcıda aç. Uzun bas: sohbet bağlantısı veya grafik paylaşımı.");
        }
'''
    onc = onc[:close] + hook + onc[close:]
    a = a[:os] + onc + a[oe:]

if 'private void v9565OpenSavedChat(' not in a:
    pos = a.rfind('}')
    helpers = r'''
    // ============================================================
    // V9565_EXTERNAL_SAME_CHAT_BROWSER
    // Stores one private chatgpt.com ... /c/... URL and opens it externally.
    // The app never inspects ChatGPT page state or injects into the browser DOM.
    // ============================================================
    private String v9565NormalizeChatUrl(String raw) {
        if (raw == null) return "";
        String u = raw.trim();
        if (u.isEmpty()) return "";
        try {
            android.net.Uri uri = android.net.Uri.parse(u);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            String path = uri.getPath();
            if (!"https".equalsIgnoreCase(scheme)) return "";
            if (host == null || !"chatgpt.com".equalsIgnoreCase(host)) return "";
            if (path == null || !path.contains("/c/")) return "";
            if (path.startsWith("/share/") || path.contains("/share/")) return "";
            return u;
        } catch (Throwable ignored) { return ""; }
    }

    private android.content.SharedPreferences v9565ChatPrefs() {
        return getSharedPreferences("v9565_chat_route", MODE_PRIVATE);
    }

    private String v9565SavedChatUrl() {
        return v9565NormalizeChatUrl(v9565ChatPrefs().getString("current_chat_url", ""));
    }

    private String v9565ClipboardChatUrl() {
        try {
            android.content.ClipboardManager cm =
                    (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip()) return "";
            android.content.ClipData clip = cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return "";
            CharSequence cs = clip.getItemAt(0).coerceToText(this);
            return v9565NormalizeChatUrl(cs == null ? "" : cs.toString());
        } catch (Throwable ignored) { return ""; }
    }

    private void v9565CopyPayload(String payload, boolean batch) {
        if (payload == null || payload.trim().isEmpty()) return;
        try {
            android.content.ClipboardManager cm =
                    (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(android.content.ClipData.newPlainText(
                        batch ? "15m Futures PRO TOPLU ANALIZ PROMPTU" : "15m Futures PRO MASTER ANALIZ PROMPTU",
                        payload));
            }
        } catch (Throwable ignored) { }
    }

    private boolean v9565OpenBrowserTab(String url) {
        try {
            android.content.Intent view = new android.content.Intent(
                    android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url));
            view.putExtra(android.provider.Browser.EXTRA_CREATE_NEW_TAB, true);
            if (android.os.Build.VERSION.SDK_INT >= 21) {
                view.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_DOCUMENT);
            }
            startActivity(view);
            return true;
        } catch (Throwable ignored) {
            try {
                android.content.Intent view = new android.content.Intent(
                        android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url));
                startActivity(android.content.Intent.createChooser(view, "ChatGPT sohbetini tarayıcıda aç"));
                return true;
            } catch (Throwable ignored2) { return false; }
        }
    }

    private void v9565OpenSavedChat(String payload, boolean batch) {
        if (payload == null || payload.trim().isEmpty()) {
            Toast.makeText(this, "Analiz promptu hazır değil. Paketi yeniden oluştur.", Toast.LENGTH_LONG).show();
            return;
        }
        String url = v9565SavedChatUrl();
        if (url.isEmpty()) {
            v9565EditChatRoute(payload, batch, true);
            return;
        }
        v9565CopyPayload(payload, batch);
        if (v9565OpenBrowserTab(url)) {
            Toast.makeText(this,
                    (batch ? "Toplu prompt" : "Analiz promptu")
                            + " panoda • kayıtlı ChatGPT sohbeti yeni sekmede açıldı. YAPIŞTIR ve gönder.",
                    Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, "Tarayıcı açılamadı. Prompt panoda kaldı.", Toast.LENGTH_LONG).show();
        }
    }

    private void v9565EditChatRoute(final String payload, final boolean batch, final boolean openAfterSave) {
        final android.widget.EditText input = new android.widget.EditText(this);
        input.setSingleLine(false);
        input.setMinLines(2);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        String current = v9565SavedChatUrl();
        String fromClipboard = v9565ClipboardChatUrl();
        input.setText(!fromClipboard.isEmpty() ? fromClipboard : current);
        input.setHint("https://chatgpt.com/c/...");

        final android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(this)
                .setTitle("ChatGPT analiz sohbeti")
                .setMessage("Bu bağlantı tekli ve toplu analizlerde aynı sohbet için kullanılacak. "
                        + "Tarayıcıdaki özel konuşmanın adresini (/c/ içeren URL) yapıştır. "
                        + "Sohbet dolduğunda uzun basıp yeni sohbeti seçebilirsin.")
                .setView(input)
                .setNegativeButton("İPTAL", null)
                .setNeutralButton("YENİ SOHBET AÇ", (d, which) -> {
                    v9565ChatPrefs().edit().remove("current_chat_url").apply();
                    if (payload != null && !payload.trim().isEmpty()) v9565CopyPayload(payload, batch);
                    boolean ok = v9565OpenBrowserTab("https://chatgpt.com/");
                    Toast.makeText(this,
                            ok ? "Yeni ChatGPT sekmesi açıldı. Prompt panoda. İlk mesajı gönderdikten sonra yeni /c/ adresini uzun basarak kaydet."
                               : "Yeni sohbet açılamadı. Prompt panoda.",
                            Toast.LENGTH_LONG).show();
                })
                .setPositiveButton("KAYDET" + (openAfterSave ? " VE AÇ" : ""), null)
                .create();

        dlg.setOnShowListener(x -> dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String normalized = v9565NormalizeChatUrl(input.getText() == null ? "" : input.getText().toString());
            if (normalized.isEmpty()) {
                input.setError("Özel ChatGPT konuşma adresi gerekli: https://chatgpt.com/.../c/...");
                return;
            }
            v9565ChatPrefs().edit().putString("current_chat_url", normalized).apply();
            if (openAfterSave) {
                v9565CopyPayload(payload, batch);
                if (!v9565OpenBrowserTab(normalized)) {
                    Toast.makeText(this, "Bağlantı kaydedildi fakat tarayıcı açılamadı.", Toast.LENGTH_LONG).show();
                    return;
                }
            }
            dlg.dismiss();
            Toast.makeText(this,
                    openAfterSave ? "Sohbet kaydedildi • prompt panoda • yeni sekme açıldı."
                                  : "ChatGPT analiz sohbeti kaydedildi.",
                    Toast.LENGTH_LONG).show();
        }));
        dlg.show();
    }

    private void v9565ShowChatRouteMenu() {
        final String payload = v9564ActivePrompt();
        final boolean batch = v9545BatchMode;
        final String[] items = new String[] {
                "SOHBET BAĞLANTISINI DEĞİŞTİR",
                "YENİ CHATGPT SOHBETİ AÇ",
                "PROMPT + GRAFİKLERİ CHATGPT UYGULAMASINA PAYLAŞ"
        };
        new android.app.AlertDialog.Builder(this)
                .setTitle("ChatGPT aktarım ayarları")
                .setMessage("Normal dokunuş kayıtlı sohbeti dış tarayıcıda yeni sekmede açar. "
                        + "Sohbet limiti dolduğunda yeni sohbet açıp onun /c/ adresini kaydet.")
                .setItems(items, (d, which) -> {
                    if (which == 0) {
                        v9565EditChatRoute(payload, batch, false);
                    } else if (which == 1) {
                        v9565ChatPrefs().edit().remove("current_chat_url").apply();
                        if (payload != null && !payload.trim().isEmpty()) v9565CopyPayload(payload, batch);
                        boolean ok = v9565OpenBrowserTab("https://chatgpt.com/");
                        Toast.makeText(this,
                                ok ? "Yeni sohbet sekmesi açıldı. Prompt panoda. İlk mesajdan sonra yeni /c/ adresini kaydet."
                                   : "Yeni sohbet açılamadı. Prompt panoda.",
                                Toast.LENGTH_LONG).show();
                    } else {
                        v9565SharePromptAndCharts();
                    }
                })
                .setNegativeButton("KAPAT", null)
                .show();
    }

    private void v9565SharePromptAndCharts() {
        String payload = v9564ActivePrompt();
        if (payload == null || payload.trim().isEmpty()) {
            Toast.makeText(this, "Analiz promptu hazır değil.", Toast.LENGTH_LONG).show();
            return;
        }
        v9565CopyPayload(payload, v9545BatchMode);
        try {
            android.content.Intent send;
            if (v9545BatchMode) {
                send = new android.content.Intent(android.content.Intent.ACTION_SEND_MULTIPLE);
                java.util.ArrayList<android.net.Uri> images = new java.util.ArrayList<>(v9545BatchUris);
                send.putExtra(android.content.Intent.EXTRA_TEXT, payload);
                if (!images.isEmpty()) {
                    send.setType("image/*");
                    send.putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, images);
                    android.content.ClipData clip = android.content.ClipData.newRawUri("Futures PRO toplu grafik", images.get(0));
                    for (int i = 1; i < images.size(); i++) clip.addItem(new android.content.ClipData.Item(images.get(i)));
                    send.setClipData(clip);
                    send.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else send.setType("text/plain");
            } else {
                send = new android.content.Intent(android.content.Intent.ACTION_SEND);
                send.putExtra(android.content.Intent.EXTRA_TEXT, payload);
                if (imageUri != null) {
                    send.setType("image/*");
                    send.putExtra(android.content.Intent.EXTRA_STREAM, imageUri);
                    send.setClipData(android.content.ClipData.newRawUri("Futures PRO analiz grafiği", imageUri));
                    send.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else send.setType("text/plain");
            }
            send.setPackage("com.openai.chatgpt");
            startActivity(send);
            Toast.makeText(this,
                    "Prompt + grafik paylaşımı açıldı. Bu yedek mod mevcut sohbeti korumayı garanti etmez.",
                    Toast.LENGTH_LONG).show();
            return;
        } catch (Throwable ignored) { }

        try {
            android.content.Intent send = new android.content.Intent(
                    v9545BatchMode ? android.content.Intent.ACTION_SEND_MULTIPLE : android.content.Intent.ACTION_SEND);
            send.putExtra(android.content.Intent.EXTRA_TEXT, payload);
            if (v9545BatchMode) {
                java.util.ArrayList<android.net.Uri> images = new java.util.ArrayList<>(v9545BatchUris);
                if (!images.isEmpty()) {
                    send.setType("image/*");
                    send.putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, images);
                    send.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else send.setType("text/plain");
            } else if (imageUri != null) {
                send.setType("image/*");
                send.putExtra(android.content.Intent.EXTRA_STREAM, imageUri);
                send.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else send.setType("text/plain");
            startActivity(android.content.Intent.createChooser(send, "Analiz paketini paylaş"));
        } catch (Throwable ex) {
            Toast.makeText(this, "Paylaşım açılamadı. Prompt panoda kaldı.", Toast.LENGTH_LONG).show();
        }
    }

'''
    a = a[:pos] + helpers + a[pos:]

a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*','ChatGPT ANALİZ PAKETİ • v9.5.65', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*','Futures15mAlarmPRO/9.5.65', a)
ANALYSIS.write_text(a)

main = MAIN.read_text()
main = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.65', main)
main = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO','v9.5.65  •  MANUEL PRO', main)
main = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:','v9.5.65 MANUEL PRO çalışma şekli:', main)
MAIN.write_text(main)

mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*','15m Futures Alarm PRO v9.5.65', mon)
MON.write_text(mon)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091505', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.65'", bf, count=1)
BUILD.write_text(bf)

ana = ANALYSIS.read_text(); main = MAIN.read_text(); mon = MON.read_text(); bf = BUILD.read_text()
checks = {
    'v9564 plan-only retained': 'V9564_PLAN_CODE_ONLY_CONTRACT' in ana and 'V9564_BATCH_FINAL_OUTPUT' in ana,
    'batch 2-8 retained': 'if (unique.size() >= 8) break;' in ana and 'selected.size() < 2 || selected.size() > 8' in main,
    'single external route': 'v9565OpenSavedChat(payload, false);' in ana,
    'batch external route': 'v9565OpenSavedChat(v9545CombinedPrompt, true);' in ana,
    'private conversation URL guard': 'path.contains("/c/")' in ana and 'path.contains("/share/")' in ana,
    'new browser tab hint': 'android.provider.Browser.EXTRA_CREATE_NEW_TAB' in ana and 'FLAG_ACTIVITY_NEW_DOCUMENT' in ana,
    'route persistence': 'v9565_chat_route' in ana and 'current_chat_url' in ana,
    'manual new-chat turnover': 'YENİ CHATGPT SOHBETİ AÇ' in ana and 'remove("current_chat_url")' in ana,
    'explicit chart-share fallback': 'V9565_EXTERNAL_SAME_CHAT_BROWSER' in ana and 'ACTION_SEND_MULTIPLE' in ana and 'FLAG_GRANT_READ_URI_PERMISSION' in ana,
    'batch prompt retained': 'v9545CombinedPrompt' in ana and 'V9.5.64 TOPLU ANALİZ PAKETİ' in ana,
    'version analysis': 'ChatGPT ANALİZ PAKETİ • v9.5.65' in ana,
    'version main': 'v9.5.65' in main,
    'version build': 'versionCode 26091505' in bf and "versionName '9.5.65'" in bf,
}
for name, ok in checks.items(): print(('OK   ' if ok else 'FAIL '), name)
bad=[name for name,ok in checks.items() if not ok]
if bad: raise SystemExit('v9.5.65 sanity failed: ' + ', '.join(bad))
for name,src in (('AnalysisPackActivity',ana),('MainActivity',main),('MonitorService',mon)):
    ok,why=java_lex_sanity(src)
    print(('OK   ' if ok else 'FAIL '),'java lexical',name,why)
    if not ok: raise SystemExit('v9.5.65 Java lexical mismatch: '+name+' — '+why)
print('v9.5.65 OK: 2-8 batch limit retained; single/batch prompts route to one saved private ChatGPT conversation in an external new browser tab; long press handles chat turnover and explicit chart-share fallback; trading logic untouched.')