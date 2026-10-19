from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = APP / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
BUILD = APP / 'app/build.gradle'

if not MAIN.exists() or not BUILD.exists():
    raise SystemExit('v9.5.1: required files missing')

s = MAIN.read_text()
start = s.find('    private void openImportDialog() {')
if start < 0:
    raise SystemExit('v9.5.1: openImportDialog not found')
next_method = re.search(r'\n    private [^\n]+\(', s[start + 10:])
if not next_method:
    raise SystemExit('v9.5.1: method boundary not found')
end = start + 10 + next_method.start()
imp = s[start:end]

# Shorter, correct explanation for the new META format.
imp = imp.replace(
    'Sadece 13 alanlı detaylı plan kodu kabul edilir. Coin kayıtlıysa güncellenir; kayıtlı değilse otomatik eklenir.',
    '13 veya 14 alanlı detaylı plan kodu kabul edilir. Coin kayıtlıysa güncellenir; değilse eklenir. Uzun kod kutunun içinde kaydırılır.'
)
imp = imp.replace(
    'Sadece 13 alanlı detaylı plan kodu kabul edilir.',
    '13 veya 14 alanlı detaylı plan kodu kabul edilir. Uzun kod kutunun içinde kaydırılır.'
)

# Find the plan EditText regardless of its local variable name.
m = re.search(r'(?m)^(\s*)(?:final\s+)?EditText\s+(\w+)\s*=\s*new\s+EditText\(this\);\s*$', imp)
if not m:
    raise SystemExit('v9.5.1: import EditText declaration not found')
var = m.group(2)

# Apply the size/scroll settings immediately before the dialog Builder so
# they override older minLines/height settings from previous versions.
builder = re.search(r'(?m)^\s*(?:final\s+)?AlertDialog(?:\.Builder)?\b|new\s+AlertDialog\.Builder\(', imp)
if not builder:
    # Fallback to the first setTitle/setView chain if the builder is inline.
    builder = re.search(r'new\s+android\.app\.AlertDialog\.Builder\(', imp)
if not builder:
    raise SystemExit('v9.5.1: AlertDialog builder not found')

marker = '        // v9.5.1 LONG_PLAN_DIALOG_SCROLL_FIX\n'
settings = marker + (
    f'        {var}.setSingleLine(false);\n'
    f'        {var}.setMinLines(5);\n'
    f'        {var}.setMaxLines(8);\n'
    f'        {var}.setMinHeight(dp(170));\n'
    f'        {var}.setMaxHeight(dp(280));\n'
    f'        {var}.setGravity(Gravity.TOP | Gravity.START);\n'
    f'        {var}.setVerticalScrollBarEnabled(true);\n'
    f'        {var}.setHorizontallyScrolling(false);\n'
    f'        {var}.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);\n'
    f'        {var}.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);\n'
    f'        {var}.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI);\n'
)

if 'LONG_PLAN_DIALOG_SCROLL_FIX' not in imp:
    imp = imp[:builder.start()] + settings + imp[builder.start():]

s = s[:start] + imp + s[end:]
s = s.replace('15m Futures Alarm PRO v9.5', '15m Futures Alarm PRO v9.5.1')
MAIN.write_text(s)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+14\b', 'versionCode 15', b)
b = re.sub(r"versionName\s+'9\.5\.0'", "versionName '9.5.1'", b)
if 'versionCode 15' not in b:
    b = re.sub(r'versionCode\s+\d+', 'versionCode 15', b, count=1)
if "versionName '9.5.1'" not in b:
    b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.1'", b, count=1)
BUILD.write_text(b)

final = MAIN.read_text()
checks = [
    ('LONG_PLAN_DIALOG_SCROLL_FIX' in final, 'scroll marker missing'),
    ('.setMaxHeight(dp(280));' in final, 'EditText max height missing'),
    ('.setVerticalScrollBarEnabled(true);' in final, 'EditText scrolling missing'),
    ('13 veya 14 alanlı' in final, '14-field help text missing'),
    ('15m Futures Alarm PRO v9.5.1' in final, 'v9.5.1 title missing'),
    ('versionCode 15' in BUILD.read_text(), 'versionCode 15 missing'),
    ("versionName '9.5.1'" in BUILD.read_text(), 'versionName 9.5.1 missing'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.1 check failed: ' + msg)

print('v9.5.1 dialog fix OK: long META plan stays inside scrollable box; dialog action buttons remain reachable.')
