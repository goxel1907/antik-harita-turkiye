"""V95130_R2544_33_BRAINHUB_8443

Transport hotfix after V95129:
  * 443 remains owned by the existing 9Router Funnel.
  * BrainHub Android telemetry moves to dedicated tailnet-only HTTPS 8443.
  * Tailscale Serve 8443 proxies to PC localhost:8787.
  * Android remains read-only / PC-only for execution.
"""
from pathlib import Path
import re

MARKER="V95130_R2544_33_BRAINHUB_8443"
OLD="https://8z9rvd.tail8c30c4.ts.net"
NEW="https://8z9rvd.tail8c30c4.ts.net:8443"
APP=Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA=APP/"app/src/main/java/com/futuresalarm/app"
MAIN=JAVA/"MainActivity.java"
CLIENT=JAVA/"BrainHubClient.java"
BUILD=APP/"app/build.gradle"

for p in (MAIN,CLIENT,BUILD):
    if not p.exists():
        raise SystemExit("V95130 missing required file: "+str(p))

main=MAIN.read_text(encoding="utf-8")
client=CLIENT.read_text(encoding="utf-8")
build=BUILD.read_text(encoding="utf-8")

if "V95129_R2544_30_OFFICE_BURST" not in main:
    raise SystemExit("V95130 requires V95129 first")
if "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" not in client:
    raise SystemExit("V95130 PC-only boundary missing")

old_line='private static final String FIXED_ENDPOINT = "'+OLD+'";'
new_line='private static final String FIXED_ENDPOINT = "'+NEW+'";'
if old_line not in client:
    raise SystemExit("V95130 fixed endpoint anchor missing")
client=client.replace(old_line,new_line,1)

build=re.sub(r"versionCode\s+\d+","versionCode 26100401",build,count=1)
build=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '9.5.122-r2544.33-brainhub-8443'",build,count=1)

main += "\n// "+MARKER+"\n"
client += "\n// "+MARKER+"\n"

MAIN.write_text(main,encoding="utf-8")
CLIENT.write_text(client,encoding="utf-8")
BUILD.write_text(build,encoding="utf-8")

c=CLIENT.read_text(encoding="utf-8")
b=BUILD.read_text(encoding="utf-8")
checks={
 "endpoint8443": ('private static final String FIXED_ENDPOINT = "'+NEW+'";') in c,
 "no_stale_fixed443": ('private static final String FIXED_ENDPOINT = "'+OLD+'";') not in c,
 "no_8787_android": ":8787" not in c,
 "burst_get": 'get(c, "/live/burst")' in c,
 "positions_compact": 'get(c, "/live/positions?limit=5&compact=1")' in c,
 "pc_only": "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in c,
 "no_burst_post": 'post(c, "/live/burst"' not in c,
 "no_live_execute": 'post(c, "/live/execute", intent, true)' not in c,
 "version": "versionCode 26100401" in b and "versionName '9.5.122-r2544.33-brainhub-8443'" in b,
}
bad=[k for k,v in checks.items() if not v]
if bad:
    raise SystemExit("V95130 contract failed: "+", ".join(bad))
print(MARKER+"_OK")
