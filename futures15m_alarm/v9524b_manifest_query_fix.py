from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
MANIFEST = APP / 'app/src/main/AndroidManifest.xml'
if not MANIFEST.exists():
    raise SystemExit('v9.5.24b manifest missing')

m = MANIFEST.read_text()

# Normalize any Binance package-visibility block that may have been inserted
# before the <manifest> root (e.g. after an XML declaration). Android requires
# <queries> to be a direct child of <manifest>.
m = re.sub(
    r'\s*<queries>\s*<package\s+android:name="com\.binance\.dev"\s*/>\s*</queries>\s*',
    '\n',
    m,
    flags=re.S,
)
root = m.find('<manifest')
if root < 0:
    raise SystemExit('v9.5.24b <manifest> root missing')
tag_end = m.find('>', root)
if tag_end < 0:
    raise SystemExit('v9.5.24b malformed <manifest> tag')
queries = '\n    <queries>\n        <package android:name="com.binance.dev" />\n    </queries>\n'
m = m[:tag_end+1] + queries + m[tag_end+1:]
MANIFEST.write_text(m)

out = MANIFEST.read_text()
root = out.find('<manifest')
q = out.find('<queries>', root)
app = out.find('<application', root)
if q < 0 or (app >= 0 and q > app):
    raise SystemExit('v9.5.24b queries not a direct pre-application manifest child')
if out.count('android:name="com.binance.dev"') != 1:
    raise SystemExit('v9.5.24b Binance package query count invalid')
print('v9.5.24b OK: Binance package visibility is inside <manifest>.')
