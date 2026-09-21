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
        raise SystemExit('v9.5.66 missing required file: ' + str(p))

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

for marker in ('V9565_EXTERNAL_SAME_CHAT_BROWSER', 'v9565OpenSavedChat', 'v9565OpenBrowserTab', 'V9564_PLAN_CODE_ONLY_CONTRACT'):
    if marker not in a:
        raise SystemExit('v9.5.66 prerequisite missing: ' + marker)

# Keep v9.5.65 browser opening code intact as a safe fallback, but make the
# official ChatGPT Android app the first route for all normal chat opens.
if 'V9566_CHATGPT_APP_FIRST' not in a:
    pos = a.rfind('}')
    helper = r'''
    // ============================================================
    // V9566_CHATGPT_APP_FIRST
    // Primary route: official OpenAI ChatGPT Android app.
    // Fallback: existing external browser route from v9.5.65.
    // Saved /c/... URL remains the single source of conversation identity.
    // ============================================================
    private boolean v9566OpenChatGptAppFirst(String url) {
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
            // Do not lose the saved-chat workflow if Android/App Links change.
            return v9565OpenBrowserTab(url);
        }
    }
'''
    a = a[:pos] + helper + a[pos:]

# Route every ordinary saved-chat/new-chat open through app-first behavior.
a = a.replace('if (v9565OpenBrowserTab(url)) {', 'if (v9566OpenChatGptAppFirst(url)) {')
a = a.replace('if (!v9565OpenBrowserTab(normalized)) {', 'if (!v9566OpenChatGptAppFirst(normalized)) {')
a = a.replace('boolean ok = v9565OpenBrowserTab("https://chatgpt.com/");',
              'boolean ok = v9566OpenChatGptAppFirst("https://chatgpt.com/");')

# User-facing copy: app first, browser only a compatibility fallback.
a = a.replace('CHATGPT SOHBETTE AÇ • PROMPT PANODA',
              'CHATGPT UYGULAMASINDA AÇ • PROMPT PANODA')
a = a.replace('SOHBETTE AÇ • " + v9545BatchDoneSymbols.size() + " COİN',
              'CHATGPT APP • " + v9545BatchDoneSymbols.size() + " COİN')
a = a.replace('Kayıtlı ChatGPT sohbetini dış tarayıcıda aç. Uzun bas: sohbet bağlantısı veya grafik paylaşımı.',
              'Kayıtlı ChatGPT sohbetini ChatGPT uygulamasında aç. Uzun bas: sohbet bağlantısı veya grafik paylaşımı.')
a = a.replace('Normal dokunuş kayıtlı sohbeti dış tarayıcıda yeni sekmede açar. ',
              'Normal dokunuş kayıtlı sohbeti önce ChatGPT uygulamasında açar; uygulama bağlantıyı kabul etmezse tarayıcı yedeği kullanılır. ')
a = a.replace(' panoda • kayıtlı ChatGPT sohbeti yeni sekmede açıldı. YAPIŞTIR ve gönder.',
              ' panoda • kayıtlı sohbet ChatGPT uygulamasında açıldı. YAPIŞTIR ve gönder.')
a = a.replace('Tarayıcı açılamadı. Prompt panoda kaldı.',
              'ChatGPT uygulaması ve tarayıcı yedeği açılamadı. Prompt panoda kaldı.')
a = a.replace('Yeni ChatGPT sekmesi açıldı. Prompt panoda. İlk mesajı gönderdikten sonra yeni /c/ adresini uzun basarak kaydet.',
              'ChatGPT uygulaması yeni sohbet için açıldı. Prompt panoda. İlk mesajdan sonra yeni /c/ adresini uzun basarak kaydet.')
a = a.replace('Yeni sohbet sekmesi açıldı. Prompt panoda. İlk mesajdan sonra yeni /c/ adresini kaydet.',
              'ChatGPT uygulaması yeni sohbet için açıldı. Prompt panoda. İlk mesajdan sonra yeni /c/ adresini kaydet.')
a = a.replace('Bağlantı kaydedildi fakat tarayıcı açılamadı.',
              'Bağlantı kaydedildi fakat ChatGPT uygulaması/tarayıcı açılamadı.')
a = a.replace('Sohbet kaydedildi • prompt panoda • yeni sekme açıldı.',
              'Sohbet kaydedildi • prompt panoda • ChatGPT uygulaması açıldı.')

# Version bump. Older protocol subsection labels intentionally remain historical;
# visible app/package/build identity must move forward for this release.
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.66', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.66', a)
main = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.66', main)
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.66', mon)
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091506', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.66'", bf, count=1)

ANALYSIS.write_text(a)
MAIN.write_text(main)
MON.write_text(mon)
BUILD.write_text(bf)

ana = ANALYSIS.read_text()
main = MAIN.read_text()
mon = MON.read_text()
bf = BUILD.read_text()

checks = {
    'app-first helper': 'V9566_CHATGPT_APP_FIRST' in ana and 'setPackage("com.openai.chatgpt")' in ana,
    'saved chat app-first': 'if (v9566OpenChatGptAppFirst(url)) {' in ana,
    'saved route retained': 'v9565_chat_route' in ana and 'current_chat_url' in ana,
    'browser fallback retained': 'return v9565OpenBrowserTab(url);' in ana,
    'single app label': 'CHATGPT UYGULAMASINDA AÇ • PROMPT PANODA' in ana,
    'batch app label': 'CHATGPT APP • " + v9545BatchDoneSymbols.size() + " COİN' in ana,
    'plan-only contract retained': 'V9564_PLAN_CODE_ONLY_CONTRACT' in ana and 'V9564_BATCH_FINAL_OUTPUT' in ana,
    'batch prompt retained': 'v9545CombinedPrompt' in ana and 'V9.5.64 TOPLU ANALİZ PAKETİ' in ana,
    'version analysis': 'ChatGPT ANALİZ PAKETİ • v9.5.66' in ana,
    'version main': 'v9.5.66' in main,
    'version build': 'versionCode 26091506' in bf and "versionName '9.5.66'" in bf,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.66 sanity failed: ' + ', '.join(bad))

for name, src in (('AnalysisPackActivity', ana), ('MainActivity', main), ('MonitorService', mon)):
    ok, why = java_lex_sanity(src)
    print(('OK   ' if ok else 'FAIL '), 'java lexical ' + name, why)
    if not ok:
        raise SystemExit('v9.5.66 Java lexical mismatch in ' + name + ': ' + why)

print('v9.5.66 OK: ChatGPT Android app is primary, saved-chat identity is preserved, browser remains fallback, plan-only/batch contracts retained, and version identity advanced.')
