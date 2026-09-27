from pathlib import Path
import os, re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
BUILD = APP / 'app/build.gradle'
MAIN = APP / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'

for p in (BUILD, MAIN):
    if not p.exists():
        raise SystemExit(f'v9.5.30 missing required file: {p}')

# Android only installs an APK over an existing package when both conditions hold:
#   1) the signing certificate is the same
#   2) versionCode is not lower than the installed build
# Codemagic exports the CM_* variables below when a persistent Android keystore
# is attached to this workflow. We intentionally refuse to publish an installable
# APK with an ephemeral CI debug key, because that would force an uninstall again.
required = {
    'CM_KEYSTORE_PATH': os.environ.get('CM_KEYSTORE_PATH', '').strip(),
    'CM_KEYSTORE_PASSWORD': os.environ.get('CM_KEYSTORE_PASSWORD', '').strip(),
    'CM_KEY_ALIAS': os.environ.get('CM_KEY_ALIAS', '').strip(),
    'CM_KEY_PASSWORD': os.environ.get('CM_KEY_PASSWORD', '').strip(),
}
compile_only = os.environ.get('FUTURES_COMPILE_ONLY', '').strip() == '1'
missing = [k for k, v in required.items() if not v]
if missing and not compile_only:
    raise SystemExit('v9.5.30 stable signing missing: ' + ', '.join(missing)
                     + '. Attach Codemagic keystore reference futures15m_stable.')
if not compile_only and not Path(required['CM_KEYSTORE_PATH']).exists():
    raise SystemExit('v9.5.30 CM_KEYSTORE_PATH does not exist on build machine')

b = BUILD.read_text()

# Keep the same applicationId/package. Never rename it between updates.
app_id = re.search(r"applicationId\s+['\"]([^'\"]+)['\"]", b)
if app_id and app_id.group(1) != 'com.futuresalarm.app':
    raise SystemExit('v9.5.30 unexpected applicationId: ' + app_id.group(1))

# Date-based monotonic code. Future releases should use a larger YYMMDDNN number.
b = re.sub(r'versionCode\s+\d+', 'versionCode 26091201', b, count=1)
b = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.30'", b, count=1)

if not compile_only:
    if 'futuresStable' in b:
        raise SystemExit('v9.5.30 signing config unexpectedly already present')

    android_match = re.search(r'android\s*\{', b)
    if not android_match:
        raise SystemExit('v9.5.30 android block not found')

    signing = '''\n    signingConfigs {\n        futuresStable {\n            storeFile file(System.getenv("CM_KEYSTORE_PATH"))\n            storePassword System.getenv("CM_KEYSTORE_PASSWORD")\n            keyAlias System.getenv("CM_KEY_ALIAS")\n            keyPassword System.getenv("CM_KEY_PASSWORD")\n        }\n    }\n'''
    insert_at = android_match.end()
    b = b[:insert_at] + signing + b[insert_at:]

    # Find the matching closing brace of android { ... } after insertion.
    start = b.find('{', android_match.start())
    depth = 0
    end = -1
    in_string = False
    quote = ''
    esc = False
    for i in range(start, len(b)):
        ch = b[i]
        if in_string:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == quote:
                in_string = False
        else:
            if ch in ('\"', "'"):
                in_string = True
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i
                    break
    if end < 0:
        raise SystemExit('v9.5.30 android block closing brace not found')

    release = '''\n    buildTypes {\n        release {\n            minifyEnabled false\n            signingConfig signingConfigs.futuresStable\n        }\n    }\n'''
    b = b[:end] + release + b[end:]

BUILD.write_text(b)

s = MAIN.read_text()
s = s.replace('v9.5.29', 'v9.5.30')
s = s.replace('v9.5.28', 'v9.5.30')
MAIN.write_text(s)

final_b = BUILD.read_text()
checks = [
    ('versionCode 26091201' in final_b, 'monotonic versionCode missing'),
    ("versionName '9.5.30'" in final_b, 'versionName missing'),
]
if not compile_only:
    checks += [
        ('futuresStable' in final_b, 'stable signing config missing'),
        ('CM_KEYSTORE_PATH' in final_b, 'keystore path env missing'),
        ('signingConfig signingConfigs.futuresStable' in final_b, 'release signing not wired'),
    ]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.30 check failed: ' + msg)

print('v9.5.30 OK: stable signing + monotonic versionCode for in-place Android updates.')
