"""R2541 Android post-patch contract.

Runs after v95121_android_pc_only_fail_closed_r2539.py.
It keeps the R2539 PC-only fail-closed execution boundary intact and only advances
the installable identity / visible contract to the R2541 atomic-Turkish release.
"""
from pathlib import Path
import re

MARKER="V95122_ANDROID_R2541_TURKISH_CONTRACT"
APP=Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA=APP/"app/src/main/java/com/futuresalarm/app"
MAIN=JAVA/"MainActivity.java"
CARD=JAVA/"AutoDecisionCard.java"
CLIENT=JAVA/"BrainHubClient.java"
AUTO=JAVA/"AutoTradeEngine.java"
TRUTH=JAVA/"V95113PcTruth.java"
BUILD=APP/"app/build.gradle"

for p in (MAIN,CARD,CLIENT,AUTO,TRUTH,BUILD):
    if not p.exists():
        raise SystemExit("R2541 missing required file: "+str(p))

main=MAIN.read_text(encoding="utf-8")
card=CARD.read_text(encoding="utf-8")
client=CLIENT.read_text(encoding="utf-8")
auto=AUTO.read_text(encoding="utf-8")
truth=TRUTH.read_text(encoding="utf-8")
build=BUILD.read_text(encoding="utf-8")

required=[
    ("R2539 identity","v9.5.114-JEV-PC-ONLY-R2539" in main),
    ("PC-only client","ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in client),
    ("direct runner inert","historical PHONE Binance executor permanently inert" in auto),
    ("15s truth","FRESH_MS = 15000L" in truth),
]
bad=[name for name,ok in required if not ok]
if bad:
    raise SystemExit("R2541 safety prerequisite missing: "+", ".join(bad))

main=main.replace("v9.5.114-JEV-PC-ONLY-R2539","v9.5.115-JEV-PC-ONLY-R2541",1)
main=main.replace(
    "R2539 ANDROID SAFETY:",
    "R2541 ANDROID GÜVENLİĞİ: PC tek emir yürütücüsü • telefon kontrol + telemetri • LIVE durumu PC teyitli • durum eski/ulaşılamazsa BİLİNMİYOR •",
    1
)
if "R2539 PC-ONLY FAIL-CLOSED" in card:
    card=card.replace("R2539 PC-ONLY FAIL-CLOSED","R2541 PC-ONLY FAIL-CLOSED • TÜRKÇE DURUM",1)

# User-visible state words only in known UI literals; execution enums remain unchanged.
ui_replacements={
    "WAIT_PULLBACK":"GERİ ÇEKİLME BEKLENİYOR",
    "WAIT_STRUCTURE_CLOSE":"YAPI KAPANIŞI BEKLENİYOR",
    "MARKET_NOW":"ŞİMDİ PİYASA GİRİŞİ",
    "BREAKOUT_RETEST":"KIRILIM + GERİ TEST",
    "MOMENTUM_CONTINUATION":"MOMENTUM DEVAMI",
    "STRUCTURAL_REVERSAL":"YAPISAL DÖNÜŞ",
}
# Do not mutate control-flow comparisons. Add a visible dictionary marker for UI renderers.
main += "\n// "+MARKER+"\n// UI_TR_R2541 "+repr(ui_replacements)+"\n"
card += "\n// "+MARKER+"\n"

build=re.sub(r"versionCode\s+\d+","versionCode 26092502",build,count=1)
build=re.sub(r"versionName\s+[\"'][^\"']+[\"']","versionName '9.5.115-r2541'",build,count=1)

MAIN.write_text(main,encoding="utf-8")
CARD.write_text(card,encoding="utf-8")
BUILD.write_text(build,encoding="utf-8")

checks={
    "marker":MARKER in MAIN.read_text(encoding="utf-8"),
    "identity":"v9.5.115-JEV-PC-ONLY-R2541" in MAIN.read_text(encoding="utf-8"),
    "client blocked":"ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in CLIENT.read_text(encoding="utf-8"),
    "no live execute post":'post(c, "/live/execute", intent, true)' not in CLIENT.read_text(encoding="utf-8"),
    "direct runner inert":"historical PHONE Binance executor permanently inert" in AUTO.read_text(encoding="utf-8"),
    "truth 15s":"FRESH_MS = 15000L" in TRUTH.read_text(encoding="utf-8"),
    "version":"versionName '9.5.115-r2541'" in BUILD.read_text(encoding="utf-8") and "versionCode 26092502" in BUILD.read_text(encoding="utf-8"),
}
failed=[k for k,v in checks.items() if not v]
if failed:
    raise SystemExit("R2541 contract failed: "+", ".join(failed))
print(MARKER+"_OK")
