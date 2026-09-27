from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = APP / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
BUILD = APP / 'app/build.gradle'
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'
RES = APP / 'app/src/main/res'

for p in (MAIN, BUILD, MANIFEST):
    if not p.exists():
        raise SystemExit('v9.5.7 missing: ' + str(p))

# Version text.
s = MAIN.read_text()
s = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.7', s)
s = s.replace('v9.5.6  •  MANUEL PRO', 'v9.5.7  •  MANUEL PRO')
s = s.replace('v9.5.5  •  MANUEL PRO', 'v9.5.7  •  MANUEL PRO')
MAIN.write_text(s)

# Brand-new resource name is intentional: some Android launchers cache the old
# icon by package/resource identity. Changing the resource name forces a fresh
# launcher lookup after APK update.
(RES / 'values').mkdir(parents=True, exist_ok=True)
(RES / 'drawable').mkdir(parents=True, exist_ok=True)
(RES / 'mipmap-anydpi').mkdir(parents=True, exist_ok=True)
(RES / 'mipmap-anydpi-v26').mkdir(parents=True, exist_ok=True)

(RES / 'values' / 'v957_launcher_colors.xml').write_text(r'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="launcher_bg_v957">#07111F</color>
</resources>
''')

# Resolution-independent foreground: trading candles + rising price path +
# alarm/bell motif. This is deliberately nothing like the default Android icon.
(RES / 'drawable' / 'ic_launcher_foreground_v957.xml').write_text(r'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">

    <!-- soft inner panel -->
    <path
        android:fillColor="#10263A"
        android:pathData="M14,14 L94,14 L94,94 L14,94 Z" />

    <!-- cyan market grid -->
    <path android:fillColor="@android:color/transparent" android:strokeColor="#1F6F8B" android:strokeWidth="1.4"
        android:pathData="M20,32 L88,32 M20,50 L88,50 M20,68 L88,68 M32,20 L32,82 M50,20 L50,82 M68,20 L68,82" />

    <!-- candlesticks -->
    <path android:fillColor="#22C55E" android:pathData="M26,53 L35,53 L35,72 L26,72 Z" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#86EFAC" android:strokeWidth="2.2"
        android:pathData="M30.5,45 L30.5,79" />

    <path android:fillColor="#EF4444" android:pathData="M44,41 L53,41 L53,60 L44,60 Z" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#FCA5A5" android:strokeWidth="2.2"
        android:pathData="M48.5,34 L48.5,68" />

    <path android:fillColor="#22C55E" android:pathData="M62,30 L71,30 L71,51 L62,51 Z" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#86EFAC" android:strokeWidth="2.2"
        android:pathData="M66.5,23 L66.5,59" />

    <!-- rising trigger line -->
    <path android:fillColor="@android:color/transparent" android:strokeColor="#38BDF8" android:strokeWidth="4"
        android:strokeLineCap="round" android:strokeLineJoin="round"
        android:pathData="M22,72 L38,61 L51,65 L65,48 L82,35" />
    <path android:fillColor="#38BDF8" android:pathData="M76,33 L86,31 L83,41 Z" />

    <!-- compact alarm bell -->
    <path android:fillColor="#F8FAFC"
        android:pathData="M39,79 C39,71 45,66 54,66 C63,66 69,71 69,79 L74,84 L34,84 Z" />
    <path android:fillColor="#F8FAFC" android:pathData="M49,87 C50,91 58,91 59,87 Z" />
    <path android:fillColor="#07111F" android:pathData="M43,79 C43,73 47,70 54,70 C61,70 65,73 65,79 L67,81 L41,81 Z" />
</vector>
''')

# Pre-Android-8 fallback icon. Vector = crisp at every launcher size.
(RES / 'mipmap-anydpi' / 'ic_launcher_pro_v957.xml').write_text(r'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#07111F" android:pathData="M0,0 L108,0 L108,108 L0,108 Z" />
    <path android:fillColor="#10263A" android:pathData="M12,12 L96,12 L96,96 L12,96 Z" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#1F6F8B" android:strokeWidth="1.4"
        android:pathData="M20,32 L88,32 M20,50 L88,50 M20,68 L88,68 M32,20 L32,82 M50,20 L50,82 M68,20 L68,82" />
    <path android:fillColor="#22C55E" android:pathData="M26,53 L35,53 L35,72 L26,72 Z" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#86EFAC" android:strokeWidth="2.2" android:pathData="M30.5,45 L30.5,79" />
    <path android:fillColor="#EF4444" android:pathData="M44,41 L53,41 L53,60 L44,60 Z" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#FCA5A5" android:strokeWidth="2.2" android:pathData="M48.5,34 L48.5,68" />
    <path android:fillColor="#22C55E" android:pathData="M62,30 L71,30 L71,51 L62,51 Z" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#86EFAC" android:strokeWidth="2.2" android:pathData="M66.5,23 L66.5,59" />
    <path android:fillColor="@android:color/transparent" android:strokeColor="#38BDF8" android:strokeWidth="4" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="M22,72 L38,61 L51,65 L65,48 L82,35" />
    <path android:fillColor="#38BDF8" android:pathData="M76,33 L86,31 L83,41 Z" />
    <path android:fillColor="#F8FAFC" android:pathData="M39,79 C39,71 45,66 54,66 C63,66 69,71 69,79 L74,84 L34,84 Z" />
    <path android:fillColor="#07111F" android:pathData="M43,79 C43,73 47,70 54,70 C61,70 65,73 65,79 L67,81 L41,81 Z" />
</vector>
''')

# Android 8+ adaptive icon. Launcher supplies the circle/squircle mask itself.
(RES / 'mipmap-anydpi-v26' / 'ic_launcher_pro_v957.xml').write_text(r'''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/launcher_bg_v957" />
    <foreground android:drawable="@drawable/ic_launcher_foreground_v957" />
</adaptive-icon>
''')

# Replace old icon/roundIcon references in the application tag only.
m = MANIFEST.read_text()
app = re.search(r'<application\b[^>]*>', m, re.S)
if not app:
    raise SystemExit('v9.5.7 application tag missing')
tag = app.group(0)
tag = re.sub(r'\s+android:icon="[^"]*"', '', tag)
tag = re.sub(r'\s+android:roundIcon="[^"]*"', '', tag)
tag = tag[:-1] + '\n        android:icon="@mipmap/ic_launcher_pro_v957"\n        android:roundIcon="@mipmap/ic_launcher_pro_v957">'
MANIFEST.write_text(m[:app.start()] + tag + m[app.end():])

# Version bump so Android/launcher sees a real package update.
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 21', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.7'", b, count=1)
BUILD.write_text(b)

mf = MANIFEST.read_text()
bf = BUILD.read_text()
checks = [
    ('@mipmap/ic_launcher_pro_v957' in mf, 'manifest icon'),
    ('android:roundIcon="@mipmap/ic_launcher_pro_v957"' in mf, 'round icon'),
    ((RES/'mipmap-anydpi/ic_launcher_pro_v957.xml').exists(), 'fallback icon'),
    ((RES/'mipmap-anydpi-v26/ic_launcher_pro_v957.xml').exists(), 'adaptive icon'),
    ((RES/'drawable/ic_launcher_foreground_v957.xml').exists(), 'foreground'),
    ('versionCode 21' in bf and "versionName '9.5.7'" in bf, 'version bump'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.7 check failed: ' + msg)

print('v9.5.7 OK: cache-busting adaptive launcher icon + new trading/alarm vector brand.')
