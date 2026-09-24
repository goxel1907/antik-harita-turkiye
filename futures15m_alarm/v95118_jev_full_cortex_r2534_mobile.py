"""R2.5.3.4 Android telemetry alignment for JEV Full Trader Cortex.

Runs after v95117_jev_cortex_shadow_r2533_mobile.py.
UI/metadata only:
- shows R2.5.3.4 LIVE read-only professional trader/scalper Cortex;
- shows ALWAYS-ON measured outcome + JEV lesson experience memory;
- keeps live strategic/execution contract at R2.5.3.2 sovereign flow;
- does not add order, close, cancel, sizing or LIVE-arm behavior.
"""
from pathlib import Path
import re

MARKER = "V95118_JEV_FULL_CORTEX_R2534_MOBILE"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
ANALYSIS = JAVA / "AnalysisPackActivity.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, CARD, CLIENT, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit("v9.5.118 missing required file: " + str(p))

def fail(msg):
    raise SystemExit("v9.5.118 " + msg)

main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
analysis = ANALYSIS.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

if MARKER in main:
    fail("already applied; start a clean Codemagic build")
if "V95117_JEV_CORTEX_SHADOW_R2533_MOBILE" not in main:
    fail("requires v95117 R2533 mobile patch first")

old_identity = "v9.5.114-JEV-CORTEX-R2533"
if old_identity not in main:
    fail("v95117 identity anchor missing")
main = main.replace(old_identity, "v9.5.114-JEV-FULL-CORTEX-R2534", 1)

anchor = '            st.append("\\nR2533 CORTEX: profesyonel trader/scalper bilgi referansı SHADOW • ölçülmüş sonuç + JEV lesson deneyim hafızası • canlı stratejik sözleşme R2532 olarak korunur."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE'
if anchor not in main:
    fail("R2533 status anchor missing")
main = main.replace(
    anchor,
    anchor + '\n            st.append("\\nR2534 FULL CORTEX: profesyonel trader/scalper bilgi referansı PASS-1 + PASS-2 + pozisyon yönetiminde sürekli • measured outcome + JEV lesson hafızası ALWAYS-ON • bilinmeyen bilgi uydurulmaz."); // ' + MARKER,
    1,
)

card_anchor = '        b.append("\\nR2533 SHADOW CORTEX: market-regime/location/structure/liquidity/order-flow/depth/derivatives/trap/risk-management bilgisi + measured experience memory; hard gate/score eklenmez."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE'
if card_anchor not in card:
    fail("AutoDecisionCard R2533 anchor missing")
card = card.replace(
    card_anchor,
    card_anchor + '\n        b.append("\\nR2534 LIVE READ-ONLY CORTEX: chart formations + price action/SMC + indicators + order-flow/depth + derivatives + execution/risk bilgisi; geçmiş ölçülmüş işlemler PASS-1/PASS-2/pozisyon yönetiminde istemeden hatırlanır."); // ' + MARKER,
    1,
)

if "R2.5.3.2 SOVEREIGN • R2533 CORTEX SHADOW" not in client:
    fail("BrainHubClient R2533 label missing")
client = client.replace(
    "R2.5.3.2 SOVEREIGN • R2533 CORTEX SHADOW",
    "R2.5.3.2 SOVEREIGN • R2534 FULL CORTEX ALWAYS-ON",
    1,
)
client += "\n// " + MARKER + "\n"

if "JEV PRO TRADER/SCALPER • R2533 CORTEX SHADOW" not in analysis:
    fail("AnalysisPack R2533 title missing")
analysis = analysis.replace(
    "JEV PRO TRADER/SCALPER • R2533 CORTEX SHADOW",
    "JEV PRO TRADER/SCALPER • R2534 FULL CORTEX",
    1,
)
analysis += "\n// " + MARKER + "\n"

if len(re.findall(r"versionCode\s+\d+", build)) != 1:
    fail("versionCode anchor missing/ambiguous")
if len(re.findall(r"versionName\s+[\"'][^\"']+[\"']", build)) != 1:
    fail("versionName anchor missing/ambiguous")
build = re.sub(r"versionCode\s+\d+", "versionCode 26092403", build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.114-r2534'", build, count=1)

MAIN.write_text(main, encoding="utf-8")
CARD.write_text(card, encoding="utf-8")
CLIENT.write_text(client, encoding="utf-8")
ANALYSIS.write_text(analysis, encoding="utf-8")
BUILD.write_text(build, encoding="utf-8")

checks = {
    "marker": MARKER in MAIN.read_text(encoding="utf-8"),
    "identity": "v9.5.114-JEV-FULL-CORTEX-R2534" in MAIN.read_text(encoding="utf-8"),
    "full cortex": "R2534 FULL CORTEX" in MAIN.read_text(encoding="utf-8"),
    "card": "R2534 LIVE READ-ONLY CORTEX" in CARD.read_text(encoding="utf-8"),
    "client": "R2534 FULL CORTEX ALWAYS-ON" in CLIENT.read_text(encoding="utf-8"),
    "build": "versionCode 26092403" in BUILD.read_text(encoding="utf-8") and "versionName '9.5.114-r2534'" in BUILD.read_text(encoding="utf-8"),
}
bad = [k for k,v in checks.items() if not v]
if bad:
    fail("final checks failed: " + ", ".join(bad))

print("V95118_JEV_FULL_CORTEX_R2534_MOBILE_OK")
print("Android identity: v9.5.114-JEV-FULL-CORTEX-R2534 / versionCode 26092403 / versionName 9.5.114-r2534")
print("Cortex: LIVE read-only reasoning reference + ALWAYS-ON measured experience memory")
print("Live strategy contract: unchanged R2.5.3.2 sovereign flow")
print("LIVE arm behavior: unchanged")
