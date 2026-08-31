from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit(f'v9.5.14 missing: {p}')

# v9.5.13 could generate a literal newline inside a Java string in the
# ANDROID AKTARIM KURALI paragraph. Repair that generated source safely.
a = ANALYSIS.read_text()
pattern = re.compile(
    r'\+ "Android başka uygulamanın mevcut mesaj kutusuna grafik ve metni otomatik yapıştıramadığı için grafik gerektiğinde analiz paketinden eklenir\.\s*"\);',
    re.S,
)
replacement = '+ "Android başka uygulamanın mevcut mesaj kutusuna grafik ve metni otomatik yapıştıramadığı için grafik gerektiğinde analiz paketinden eklenir.\\n\\n");'
a, n = pattern.subn(lambda m: replacement, a, count=1)
if n != 1:
    raise SystemExit('v9.5.14 compile fix target not found')

a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*',
           'ChatGPT ANALİZ PAKETİ • v9.5.14', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*',
           'Futures15mAlarmPRO/9.5.14', a)
ANALYSIS.write_text(a)

m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*',
           '15m Futures Alarm PRO v9.5.14', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO',
           'v9.5.14  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:',
           'v9.5.14 MANUEL PRO çalışma şekli:', m)
MAIN.write_text(m)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 28', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.14'", b, count=1)
BUILD.write_text(b)

# Sanity checks: no raw newline may remain inside the repaired Java literal.
af = ANALYSIS.read_text()
if 'eklenir.\\n\\n");' not in af:
    raise SystemExit('v9.5.14 escaped newline check failed')
if re.search(r'eklenir\.\s*\n\s*\n\s*"\);', af):
    raise SystemExit('v9.5.14 raw newline still present')
if 'ChatGPT ANALİZ PAKETİ • v9.5.14' not in af:
    raise SystemExit('v9.5.14 analysis version check failed')
if 'v9.5.14' not in MAIN.read_text():
    raise SystemExit('v9.5.14 main version check failed')
if "versionName '9.5.14'" not in BUILD.read_text() or 'versionCode 28' not in BUILD.read_text():
    raise SystemExit('v9.5.14 build version check failed')

print('v9.5.14 OK: repaired unclosed Java string literal and bumped app version.')
