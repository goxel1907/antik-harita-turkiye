from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.10 missing: {p}')

# ------------------------------------------------------------------
# v9.5.10 import parser fix
# Accept both legacy bare numeric detail groups and ChatGPT's explicit
# LP=/LB=/SR=/SB= labels. The 14th META field may keep META=.
# ------------------------------------------------------------------
s = MAIN.read_text()
start = s.find('    private void openImportDialog() {')
if start < 0:
    raise SystemExit('v9.5.10 openImportDialog not found')
next_method = re.search(r'\n    private [^\n]+\(', s[start + 10:])
if not next_method:
    raise SystemExit('v9.5.10 import method boundary not found')
end = start + 10 + next_method.start()
imp = s[start:end]

if 'V9510_PLAN_LABEL_NORMALIZER' not in imp:
    # Locate the parser's String[] a = ... statement without assuming the
    # exact source expression used by earlier versions.
    m = re.search(r'(?m)^(\s*)String\[\]\s+a\s*=\s*[^;]+;\s*$', imp)
    if not m:
        raise SystemExit('v9.5.10 String[] a parser anchor not found')
    indent = m.group(1)
    normalization = (
        '\n' + indent + '// v9.5.10 V9510_PLAN_LABEL_NORMALIZER\n'
        + indent + 'if (a.length >= 13) {\n'
        + indent + '    a[9] = v9510StripPlanLabel(a[9], "LP");\n'
        + indent + '    a[10] = v9510StripPlanLabel(a[10], "LB");\n'
        + indent + '    a[11] = v9510StripPlanLabel(a[11], "SR");\n'
        + indent + '    a[12] = v9510StripPlanLabel(a[12], "SB");\n'
        + indent + '}\n'
    )
    imp = imp[:m.end()] + normalization + imp[m.end():]

# Make the dialog wording match what the parser actually accepts.
imp = imp.replace(
    '13 veya 14 alanlı detaylı plan kodu kabul edilir. Coin kayıtlıysa güncellenir; değilse eklenir. Uzun kod kutunun içinde kaydırılır.',
    '13 veya 14 alanlı detaylı plan kodu kabul edilir. LP=/LB=/SR=/SB= etiketli veya eski etiketsiz format kabul edilir. Coin kayıtlıysa güncellenir; değilse eklenir. Uzun kod kutunun içinde kaydırılır.'
)

s = s[:start] + imp + s[end:]

helper = r'''

    private String v9510StripPlanLabel(String raw, String label) {
        if (raw == null) return "";
        String x = raw.trim();
        int eq = x.indexOf('=');
        int colon = x.indexOf(':');
        int cut = -1;
        if (eq >= 0) cut = eq;
        if (colon >= 0 && (cut < 0 || colon < cut)) cut = colon;
        if (cut > 0) {
            String head = x.substring(0, cut).trim();
            if (head.equalsIgnoreCase(label)) return x.substring(cut + 1).trim();
        }
        return x;
    }
'''
if 'private String v9510StripPlanLabel(' not in s:
    pos = s.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.10 MainActivity closing brace not found')
    s = s[:pos] + helper + '\n' + s[pos:]

# Robust version text update: both full-title and separate version labels.
s = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.10', s)
s = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.10  •  MANUEL PRO', s)
s = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:', 'v9.5.10 MANUEL PRO çalışma şekli:', s)
MAIN.write_text(s)

# Analysis package: explicitly request the labelled format that the app now
# accepts, so new chats cannot accidentally mismatch parser expectations.
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.10', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.10', a)
a = a.replace(
    'SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP|LB|SR|SB|META',
    'SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP=stop;tp1;tp2;tp3|LB=girisAlt;girisUst;stop;tp1;tp2;tp3|SR=stop;tp1;tp2;tp3|SB=girisAlt;girisUst;stop;tp1;tp2;tp3|META=...'
)
# Keep old separate explanatory LP/LB/SR/SB lines; just add one hard rule.
anchor = 'META alanında | karakteri KULLANMA; yalnız ; ve = kullan.'
if anchor in a and 'LP=/LB=/SR=/SB= etiketlerini final kod satırında KORU' not in a:
    a = a.replace(anchor,
        'LP=/LB=/SR=/SB= etiketlerini final kod satırında KORU. Uygulama eski etiketsiz kodları da kabul eder. ' + anchor,
        1)
ANALYSIS.write_text(a)

# Version bump.
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 24', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.10'", b, count=1)
BUILD.write_text(b)

# Fail-fast checks.
mf = MAIN.read_text()
af = ANALYSIS.read_text()
bf = BUILD.read_text()
checks = [
    ('V9510_PLAN_LABEL_NORMALIZER' in mf, 'import normalizer marker'),
    ('v9510StripPlanLabel(a[9], "LP")' in mf, 'LP label stripping'),
    ('v9510StripPlanLabel(a[10], "LB")' in mf, 'LB label stripping'),
    ('v9510StripPlanLabel(a[11], "SR")' in mf, 'SR label stripping'),
    ('v9510StripPlanLabel(a[12], "SB")' in mf, 'SB label stripping'),
    ('LP=/LB=/SR=/SB= etiketli' in mf, 'dialog help wording'),
    ('v9.5.10' in mf, 'MainActivity version'),
    ('ChatGPT ANALİZ PAKETİ • v9.5.10' in af, 'analysis version'),
    ('LP=stop;tp1;tp2;tp3' in af, 'analysis labelled final format'),
    ('versionCode 24' in bf and "versionName '9.5.10'" in bf, 'build version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.10 check failed: ' + msg)

print('v9.5.10 OK: 13/14-field parser accepts LP=/LB=/SR=/SB= labels and legacy bare groups; META= remains supported.')
