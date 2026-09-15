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
        raise SystemExit('v9.5.64 missing required file: ' + str(p))


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


# ---------------------------------------------------------------------------
# Analysis package:
# 1) one canonical current-version header;
# 2) batch-aware copy/share/preview;
# 3) plan-code-only answer contract;
# 4) batch completeness: ISLEM_YOK is still a plan, not an omitted coin.
# ---------------------------------------------------------------------------
a = ANALYSIS.read_text()

# Check semantic markers rather than synthetic shorthand names. The previous
# V9562 shorthand check was wrong because v9.5.62 intentionally writes the
# human-readable protocol marker, not the literal token "V9562".
prereqs = (
    ('batch analysis', 'V9545_BATCH_ANALYSIS'),
    ('exact-symbol/package guard', 'V9.5.62 ANALIZ PAKETI BUTUNLUK / EXACT SYMBOL / GORSEL KANIT KORUMASI'),
    ('real L2 prompt context', 'V9.5.63 GERCEK L2 MICROSTRUCTURE'),
)
for name, marker in prereqs:
    if marker not in a:
        raise SystemExit('v9.5.64 Analysis prerequisite missing: ' + name + ' / ' + marker)

# Canonical current version at the very top of the generated single-coin prompt.
b = method_bounds(a, '    private String buildPrompt(')
if not b:
    raise SystemExit('v9.5.64 buildPrompt missing')
bs, _, be = b
bp = a[bs:be]

if 'V9564_CURRENT_MASTER_HEADER' not in bp:
    sb_decl = re.search(r'(?m)^(\s*)StringBuilder\s+sb\s*=\s*new\s+StringBuilder\s*\([^;]*\);\s*$', bp)
    if not sb_decl:
        raise SystemExit('v9.5.64 StringBuilder sb declaration missing in buildPrompt')
    ind = sb_decl.group(1)
    header = (
        '\n' + ind + '// V9564_CURRENT_MASTER_HEADER\n'
        + ind + 'sb.append("--- V9.5.64 CURRENT MASTER / TEK COIN PAKETI ---\\n");\n'
        + ind + 'sb.append("CURRENT_PROTOCOL_VERSION: 9.5.64\\n");\n'
        + ind + 'sb.append("Bu ust surum etiketi gecerlidir; asagidaki daha eski v9.5.xx etiketleri yalniz kuralin kaynak/provenans etiketidir.\\n\\n");'
    )
    bp = bp[:sb_decl.end()] + header + bp[sb_decl.end():]

# Final contract is intentionally LAST so it overrides the older verbose
# CIKTI DUZENI section without deleting any analytical reasoning inputs.
if 'V9564_PLAN_CODE_ONLY_CONTRACT' not in bp:
    ret = bp.rfind('return sb.toString();')
    if ret < 0:
        raise SystemExit('v9.5.64 buildPrompt return missing')
    line_start = bp.rfind('\n', 0, ret) + 1
    ind = re.match(r'\s*', bp[line_start:ret]).group(0)
    contract = (
        ind + '// V9564_PLAN_CODE_ONLY_CONTRACT\n'
        + ind + 'sb.append("\\n--- V9.5.64 FINAL CIKTI KONTRATI ---\\n");\n'
        + ind + 'sb.append("BU BOLUM ONCEKI CIKTI DUZENI MADDELERINE USTUNDUR. ");\n'
        + ind + 'sb.append("Tek-coin pakette cevabin TAMAMI yalniz uygulamaya yapistirilacak TEK SATIR 14 alanli plan kodu olsun. ");\n'
        + ind + 'sb.append("Baslik, tablo, aciklama, gerekce, markdown/code-fence veya plan kodu disinda tek karakter ekleme. ");\n'
        + ind + 'sb.append("ANA_KARAR=ISLEM_YOK olsa bile paket yapisal gunluk harita kurmaya yeterliyse plan kodunu yine uret; sirf o anda giris yok diye coin planini atlama. ");\n'
        + ind + 'sb.append("UYGUN olmayan dali META icinde BEKLE/GECERSIZ olarak isaretle; sayisal seviye uydurma ve hard-veto/RR kurallarini gevsetme. ");\n'
        + ind + 'sb.append("Paket gercekten yetersiz/celiskiliyse kod uretmek yerine mevcut veri-yenileme kuralini uygula. ");\n'
        + ind + 'sb.append("Eger ustte TOPLU ANALIZ PAKETI basligi varsa bu tek-satir kurali coin basina uygulanir ve toplu cikti kurali onceliklidir.\\n");\n'
    )
    bp = bp[:line_start] + contract + bp[line_start:]

a = a[:bs] + bp + a[be:]

# Batch composer: current version + ONLY plan-code lines + do not drop ISLEM_YOK.
b = method_bounds(a, '    private String v9545ComposeCombinedPrompt()')
if not b:
    raise SystemExit('v9.5.64 batch composer missing')
cs, _, ce = b
comp = a[cs:ce]
comp, header_count = re.subn(
    r'--- V9\.5(?:\.\d+)* TOPLU ANAL[İI]Z PAKET[İI] ---',
    '--- V9.5.64 TOPLU ANALİZ PAKETİ ---',
    comp,
    count=1,
)
if header_count == 0 and '--- V9.5.64 TOPLU ANALİZ PAKETİ ---' not in comp:
    raise SystemExit('v9.5.64 batch header anchor missing')

old1 = 'out.append("ÇIKTI: Her coin için ayrı ANA KARAR/GÜVEN/senaryolar ve ayrı TEK SATIR 14 alanlı plan kodu üret. ");'
old2 = 'out.append("Cevabın en sonunda \'TOPLU PLAN KODLARI\' başlığı altında yalnız başarılı her sembol için bir plan kodu satırı ver; satırları birbirine karıştırma.\\n\\n");'
if old1 in comp:
    comp = comp.replace(old1,
        'out.append("V9.5.64 CIKTI ZORUNLU: Yanitin TAMAMI yalniz 14 alanli plan kodu satirlarindan olussun; baslik, tablo, aciklama, gerekce ve markdown yazma. ");', 1)
if old2 in comp:
    comp = comp.replace(old2,
        'out.append("Her HAZIRLANAN gecerli coin icin TAM BIR satir uret; ANA_KARAR=ISLEM_YOK olsa da coin planini atlama. Yalniz HAZIRLANAMAYAN COINLER bolumundekilere kod uretme.\\n\\n");', 1)
if 'V9.5.64 CIKTI ZORUNLU' not in comp:
    header_anchor = 'out.append("--- V9.5.64 TOPLU ANALİZ PAKETİ ---\\n");'
    if header_anchor not in comp:
        raise SystemExit('v9.5.64 batch output contract anchor missing')
    extra = (
        '\n        out.append("V9.5.64 CIKTI ZORUNLU: Yanitin TAMAMI yalniz 14 alanli plan kodu satirlarindan olussun; baslik, tablo, aciklama, gerekce ve markdown yazma. ");'
        '\n        out.append("Her HAZIRLANAN gecerli coin icin TAM BIR satir uret; ANA_KARAR=ISLEM_YOK olsa da coin planini atlama. Yalniz HAZIRLANAMAYAN COINLER bolumundekilere kod uretme.\\n\\n");'
    )
    comp = comp.replace(header_anchor, header_anchor + extra, 1)

if 'V9564_BATCH_FINAL_OUTPUT' not in comp:
    rr = comp.rfind('return out.toString();')
    if rr < 0:
        raise SystemExit('v9.5.64 batch return missing')
    line_start = comp.rfind('\n', 0, rr) + 1
    ind = re.match(r'\s*', comp[line_start:rr]).group(0)
    tail = (
        ind + '// V9564_BATCH_FINAL_OUTPUT\n'
        + ind + 'out.append("\\nSON CIKTI KURALI: Sadece plan kodu satirlari. Her hazirlanan gecerli sembol = 1 satir. ISLEM_YOK sembolunu atlama.\\n");\n'
    )
    comp = comp[:line_start] + tail + comp[line_start:]

a = a[:cs] + comp + a[ce:]

# One active payload helper. In batch mode every copy/share/preview path must
# use the combined prompt instead of the last single-coin shareText.
if 'private String v9564ActivePrompt()' not in a:
    anchor = a.find('    private void copyMasterPromptToClipboard()')
    if anchor < 0:
        raise SystemExit('v9.5.64 clipboard method anchor missing')
    helper = r'''    // V9564_BATCH_AWARE_PROMPT_PAYLOAD
    private String v9564ActivePrompt() {
        if (v9545BatchMode && v9545CombinedPrompt != null && !v9545CombinedPrompt.trim().isEmpty()) {
            return v9545CombinedPrompt;
        }
        return shareText == null ? "" : shareText;
    }

'''
    a = a[:anchor] + helper + a[anchor:]

b = method_bounds(a, '    private void copyMasterPromptToClipboard()')
if not b:
    raise SystemExit('v9.5.64 copyMasterPromptToClipboard missing')
ms, _, me = b
new_copy = r'''    private void copyMasterPromptToClipboard() {
        String payload = v9564ActivePrompt();
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null && payload != null && !payload.trim().isEmpty()) {
            cm.setPrimaryClip(ClipData.newPlainText(
                    v9545BatchMode ? "15m Futures PRO TOPLU ANALIZ PROMPTU" : "15m Futures PRO MASTER ANALIZ PROMPTU",
                    payload));
            String msg = v9545BatchMode
                    ? ("Toplu analiz promptu kopyalandı • " + v9545BatchDoneSymbols.size() + " coin")
                    : "Tek coin analiz promptu kopyalandı";
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        } else {
            Toast.makeText(this, "Analiz promptu henüz hazır değil.", Toast.LENGTH_SHORT).show();
        }
    }'''
a = a[:ms] + new_copy + a[me:]

b = method_bounds(a, '    private void sharePack()')
if not b:
    raise SystemExit('v9.5.64 sharePack missing')
ss, _, se = b
share = a[ss:se]
share = share.replace('promptView.setText(shareText);', 'promptView.setText(v9564ActivePrompt());')
a = a[:ss] + share + a[se:]

b = method_bounds(a, '    private void sendPromptAndChartToChatGPT()')
if not b:
    raise SystemExit('v9.5.64 sendPromptAndChartToChatGPT missing')
ss, _, se = b
sendm = a[ss:se]
if 'V9564_BATCH_SEND_DELEGATE' not in sendm:
    guard = r'''
        // V9564_BATCH_SEND_DELEGATE
        if (v9545BatchMode && v9545CombinedPrompt != null && !v9545CombinedPrompt.trim().isEmpty()) {
            v9545ShareBatch();
            return;
        }
'''
    at = sendm.find('{') + 1
    sendm = sendm[:at] + guard + sendm[at:]
a = a[:ss] + sendm + a[se:]

a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.64', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.64', a)
ANALYSIS.write_text(a)

# ---------------------------------------------------------------------------
# MainActivity: current version + safe one-time exact-TUSDT cleanup bridge.
# ---------------------------------------------------------------------------
m = MAIN.read_text()
for marker in ('V9546_ANALYSIS_DELETE_SHORTCUT', 'V9546A_PRECISE_DELETE_TARGET', 'V9561'):
    if marker not in m:
        raise SystemExit('v9.5.64 Main prerequisite missing: ' + marker)

b = method_bounds(m, '    protected void onCreate(')
if not b:
    raise SystemExit('v9.5.64 MainActivity onCreate missing')
os, _, oe = b
onc = m[os:oe]
if 'V9564_LEGACY_TUSDT_CLEANUP_HOOK' not in onc:
    close = onc.rfind('}')
    if close < 0:
        raise SystemExit('v9.5.64 MainActivity onCreate close missing')
    onc = onc[:close] + r'''
        // V9564_LEGACY_TUSDT_CLEANUP_HOOK
        v9564ScheduleLegacyTusdtCleanup();
''' + onc[close:]
    m = m[:os] + onc + m[oe:]

if 'private void v9564ScheduleLegacyTusdtCleanup()' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.64 MainActivity class close missing')
    helper = r'''
    // V9564_EXACT_TUSDT_MIGRATION
    // Legacy phantom TUSDT only. The existing exact-symbol delete action is
    // reused, so its normal confirmation/cleanup remains authoritative.
    // Once TUSDT is absent, the migration seals itself and a future legitimate
    // TUSDT plan is never touched.
    private void v9564ScheduleLegacyTusdtCleanup() {
        final android.content.SharedPreferences sp =
                getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        if (sp.getBoolean("v9564_legacy_tusdt_cleanup_done", false)) return;

        final android.view.View root = findViewById(android.R.id.content);
        if (root == null) return;
        root.postDelayed(() -> {
            try {
                android.view.View card = v9546FindPlanCard("TUSDT");
                if (card == null) {
                    sp.edit().putBoolean("v9564_legacy_tusdt_cleanup_done", true).apply();
                    return;
                }

                // Never interrupt a still-active real/virtual TUSDT lifecycle.
                if (sp.getBoolean("v9518_signal_active_TUSDT", false)) return;

                // Exact symbol only; THEUSDT/SUSDT/TURBOUSDT cannot match.
                Toast.makeText(this,
                        "Eski TUSDT kaydı bulundu • güvenli temizleme açılıyor.",
                        Toast.LENGTH_SHORT).show();
                v9546RequestDelete("TUSDT");
            } catch (Throwable ignored) { }
        }, 1200L);
    }

'''
    m = m[:pos] + helper + m[pos:]

m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.64', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.64  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:', 'v9.5.64 MANUEL PRO çalışma şekli:', m)
MAIN.write_text(m)

mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.64', mon)
MON.write_text(mon)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091504', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.64'", bf, count=1)
BUILD.write_text(bf)

main = MAIN.read_text()
ana = ANALYSIS.read_text()
mon = MON.read_text()
bf = BUILD.read_text()

# Pre-Gradle lexical checks catch accidental brace/string corruption in the
# generated Java before the expensive Android build starts.
for name, src in (('MainActivity', main), ('AnalysisPackActivity', ana), ('MonitorService', mon)):
    ok, why = java_lex_sanity(src)
    print(('OK   ' if ok else 'FAIL '), 'java lexical', name, why)
    if not ok:
        raise SystemExit('v9.5.64 Java lexical mismatch: ' + name + ' — ' + why)

checks = {
    'v9563 retained': 'V9.5.63 GERCEK L2 MICROSTRUCTURE' in ana,
    'exact symbol guard retained': 'V9.5.62 ANALIZ PAKETI BUTUNLUK' in ana,
    'batch combined prompt retained': 'v9545CombinedPrompt' in ana and 'ACTION_SEND_MULTIPLE' in ana,
    'batch-aware clipboard': 'V9564_BATCH_AWARE_PROMPT_PAYLOAD' in ana and ana.count('private String v9564ActivePrompt()') == 1,
    'copy UX feedback': 'Toplu analiz promptu kopyalandı' in ana and 'Analiz promptu henüz hazır değil.' in ana,
    'batch send delegate': 'V9564_BATCH_SEND_DELEGATE' in ana and 'v9545ShareBatch();' in ana,
    'batch preview combined': 'promptView.setText(v9564ActivePrompt());' in ana,
    'single current header': 'V9564_CURRENT_MASTER_HEADER' in ana and 'CURRENT_PROTOCOL_VERSION: 9.5.64' in ana,
    'single code-only output': 'V9564_PLAN_CODE_ONLY_CONTRACT' in ana,
    'batch code-only output': 'V9564_BATCH_FINAL_OUTPUT' in ana and 'ISLEM_YOK sembolunu atlama' in ana,
    'precise delete retained': 'V9546A_PRECISE_DELETE_TARGET' in main,
    'legacy tusdt exact migration': 'V9564_EXACT_TUSDT_MIGRATION' in main and 'v9546FindPlanCard("TUSDT")' in main and 'v9546RequestDelete("TUSDT")' in main,
    'single tusdt migration helper': main.count('private void v9564ScheduleLegacyTusdtCleanup()') == 1,
    'active signal safety': 'v9518_signal_active_TUSDT' in main,
    'main version': 'v9.5.64' in main,
    'analysis version': 'ChatGPT ANALİZ PAKETİ • v9.5.64' in ana,
    'build version': 'versionCode 26091504' in bf and "versionName '9.5.64'" in bf,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.64 sanity failed: ' + ', '.join(bad))

print('v9.5.64 OK: prerequisites verified semantically; batch clipboard/share stabilized; plan-code-only output active; exact legacy TUSDT cleanup is guarded; Java lexical and visible-version checks passed.')
