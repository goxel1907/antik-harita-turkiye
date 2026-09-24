"""R2.5.3.3 Android telemetry alignment for JEV Professional Trader Cortex.

Runs after v95116_jev_sovereign_r2532_mobile.py.
UI/metadata only:
- shows Trader Cortex SHADOW knowledge-reference status;
- shows measured outcome + JEV lesson experience-memory status;
- keeps the live strategic/execution contract unchanged at R2.5.3.2;
- does not add order, close, cancel, sizing or LIVE-arm behavior.
"""
from pathlib import Path
import re

MARKER = "V95117_JEV_CORTEX_SHADOW_R2533_MOBILE"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
ANALYSIS = JAVA / "AnalysisPackActivity.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, CARD, CLIENT, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit("v9.5.117 missing required file: " + str(p))

def fail(msg):
    raise SystemExit("v9.5.117 " + msg)

main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
analysis = ANALYSIS.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

if MARKER in main:
    fail("already applied; start a clean Codemagic build")
if "V95116_JEV_SOVEREIGN_R2532_MOBILE" not in main:
    fail("requires v95116 R2532 mobile patch first")

old_identity = "v9.5.114-JEV-SOVEREIGN-R2532"
if old_identity not in main:
    fail("v95116 identity anchor missing")
main = main.replace(old_identity, "v9.5.114-JEV-CORTEX-R2533", 1)

anchor = '            st.append("\\nR2532: JEV evidence director + final trade manager + SHADOW teacher; scanner/worker stratejik karar vermez.");'
if anchor not in main:
    fail("R2532 status anchor missing")
main = main.replace(anchor, anchor + '\n            st.append("\\nR2533 CORTEX: profesyonel trader/scalper bilgi referansı SHADOW • ölçülmüş sonuç + JEV lesson deneyim hafızası • canlı stratejik sözleşme R2532 olarak korunur."); // ' + MARKER, 1)

card_anchor = '        b.append("\\nR2532 ACTIVE: JEV PASS-1 evidence request → worker EVIDENCE_ONLY → PASS-2 LONG/SHORT/WAIT → hard safety only.");'
if card_anchor not in card:
    fail("AutoDecisionCard R2532 anchor missing")
card = card.replace(card_anchor, card_anchor + '\n        b.append("\\nR2533 SHADOW CORTEX: market-regime/location/structure/liquidity/order-flow/depth/derivatives/trap/risk-management bilgisi + measured experience memory; hard gate/score eklenmez."); // ' + MARKER, 1)

if "R2.5.3.2 SOVEREIGN • R2532" not in client:
    fail("BrainHubClient R2532 label missing")
client = client.replace("R2.5.3.2 SOVEREIGN • R2532", "R2.5.3.2 SOVEREIGN • R2533 CORTEX SHADOW", 1)
client += "\n// " + MARKER + "\n"

if "JEV PRO TRADER/SCALPER ANALİZ PAKETİ • R2.5.3.2" not in analysis:
    fail("AnalysisPack title missing")
analysis = analysis.replace("JEV PRO TRADER/SCALPER ANALİZ PAKETİ • R2.5.3.2", "JEV PRO TRADER/SCALPER • R2533 CORTEX SHADOW", 1)
analysis += "\n// " + MARKER + "\n"

if len(re.findall(r"versionCode\s+\d+", build)) != 1:
    fail("versionCode anchor missing/ambiguous")
if len(re.findall(r"versionName\s+[\"'][^\"']+[\"']", build)) != 1:
    fail("versionName anchor missing/ambiguous")
build = re.sub(r"versionCode\s+\d+", "versionCode 26092402", build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.114-r2533'", build, count=1)

MAIN.write_text(main, encoding="utf-8")
CARD.write_text(card, encoding="utf-8")
CLIENT.write_text(client, encoding="utf-8")
ANALYSIS.write_text(analysis, encoding="utf-8")
BUILD.write_text(build, encoding="utf-8")

checks = {
    "marker": MARKER in MAIN.read_text(encoding="utf-8"),
    "identity": "v9.5.114-JEV-CORTEX-R2533" in MAIN.read_text(encoding="utf-8"),
    "shadow cortex": "R2533 CORTEX" in MAIN.read_text(encoding="utf-8"),
    "card": "R2533 SHADOW CORTEX" in CARD.read_text(encoding="utf-8"),
    "client": "R2533 CORTEX SHADOW" in CLIENT.read_text(encoding="utf-8"),
    "build": "versionCode 26092402" in BUILD.read_text(encoding="utf-8") and "versionName '9.5.114-r2533'" in BUILD.read_text(encoding="utf-8"),
}
bad = [k for k,v in checks.items() if not v]
if bad:
    fail("final checks failed: " + ", ".join(bad))

print("V95117_JEV_CORTEX_SHADOW_R2533_MOBILE_OK")
print("Android identity: v9.5.114-JEV-CORTEX-R2533 / versionCode 26092402 / versionName 9.5.114-r2533")
print("Cortex: SHADOW knowledge reference + measured experience memory")
print("Live strategy contract: unchanged R2.5.3.2 sovereign flow")
print("LIVE: unchanged")
