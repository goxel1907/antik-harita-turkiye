"""R2.5.3.6 Android telemetry alignment for resilient Vision and verified OSS-assisted research.

Runs after v95119_jev_autonomous_r2535_mobile.py.
UI/metadata only:
- shows R2536 deterministic Vision schema repair truth from PC;
- shows 9Router + OpenRouter-free retry/failover research;
- shows curated open-source reference registry as read-only engineering support;
- preserves R2535 binding position management, lifetime memory and JEV final authority;
- does not arm LIVE, place orders, close positions, cancel orders, change sizing or change risk rules.
"""
from pathlib import Path
import re

MARKER = "V95120_JEV_RESILIENT_R2536_MOBILE"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
ANALYSIS = JAVA / "AnalysisPackActivity.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, CARD, CLIENT, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit("v9.5.120 missing required file: " + str(p))

def fail(msg):
    raise SystemExit("v9.5.120 " + msg)

main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
analysis = ANALYSIS.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

if MARKER in main:
    fail("already applied; start a clean Codemagic build")
if "V95119_JEV_AUTONOMOUS_R2535_MOBILE" not in main:
    fail("requires v95119 R2535 mobile patch first")

old_identity = "v9.5.114-JEV-AUTONOMOUS-R2535"
if old_identity not in main:
    fail("R2535 identity anchor missing")
main = main.replace(old_identity, "v9.5.114-JEV-RESILIENT-R2536", 1)

old_status = '            st.append("\\nR2535 JEV: FULL CORTEX sürekli • lifetime measured memory + son ayrıntılar ALWAYS-ON • bilgi boşluğunda 9Router + OpenRouter free araştırır, kaynak getirir, JEV doğrulamadan bilgi kalıcı olmaz • EXIT_NOW ve PARTIAL_TAKE_PROFIT PC LIVE açık ve BrainHub-owned pozisyonda reduce-only MARKET olarak uygulanır."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE V95119_JEV_AUTONOMOUS_R2535_MOBILE'
if old_status not in main:
    fail("R2535 status anchor missing")
new_status = '            st.append("\\nR2536 JEV: R2535 otonom yönetim korunur • Vision TRIGGER/INVALIDATION ID eksikliği deterministik same-TF adaylardan yalnız şema onarımıyla tamamlanır • bilgi araştırması 9Router + OpenRouter free retry/failover kullanır • seçili açık kaynak repolar read-only mühendislik referansıdır ve JEV doğrulamadan kalıcı bilgi olmaz."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE V95119_JEV_AUTONOMOUS_R2535_MOBILE ' + MARKER
main = main.replace(old_status, new_status, 1)

old_card = '        b.append("\\nR2535 AUTONOMOUS JEV: LIVE read-only Cortex + lifetime measured experience + doğrulanmış dinamik araştırma; EXIT_NOW ve PARTIAL_TAKE_PROFIT BrainHub-owned pozisyonda LIVE açıkken gerçek reduce-only yönetim emrine bağlanır. External/manual pozisyon otomatik yönetilmez."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE V95119_JEV_AUTONOMOUS_R2535_MOBILE'
if old_card not in card:
    fail("R2535 card anchor missing")
new_card = '        b.append("\\nR2536 RESILIENT JEV: R2535 autonomous management + lifetime memory korunur; Vision level-ID schema repair yalnız deterministik adaylardan yapılır; free araştırma retry/failover + JEV doğrulamalı curated OSS reference kullanır."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE V95119_JEV_AUTONOMOUS_R2535_MOBILE ' + MARKER
card = card.replace(old_card, new_card, 1)

old_client = "R2.5.3.2 SOVEREIGN • R2535 AUTONOMOUS MGMT • VERIFIED RESEARCH • LIFETIME MEMORY"
if old_client not in client:
    fail("BrainHubClient R2535 label missing")
client = client.replace(
    old_client,
    "R2.5.3.2 SOVEREIGN • R2536 RESILIENT VISION • VERIFIED OSS RESEARCH • LIFETIME MEMORY",
    1,
)
client += "\n// " + MARKER + "\n"

if "JEV PRO TRADER/SCALPER • R2535 AUTONOMOUS MGMT + VERIFIED RESEARCH" in analysis:
    analysis = analysis.replace(
        "JEV PRO TRADER/SCALPER • R2535 AUTONOMOUS MGMT + VERIFIED RESEARCH",
        "JEV PRO TRADER/SCALPER • R2536 RESILIENT VISION + VERIFIED OSS RESEARCH",
        1,
    )
analysis += "\n// " + MARKER + "\n"

if len(re.findall(r"versionCode\s+\d+", build)) != 1:
    fail("versionCode anchor missing/ambiguous")
if len(re.findall(r"versionName\s+[\"'][^\"']+[\"']", build)) != 1:
    fail("versionName anchor missing/ambiguous")
build = re.sub(r"versionCode\s+\d+", "versionCode 26092405", build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.114-r2536'", build, count=1)

MAIN.write_text(main, encoding="utf-8")
CARD.write_text(card, encoding="utf-8")
CLIENT.write_text(client, encoding="utf-8")
ANALYSIS.write_text(analysis, encoding="utf-8")
BUILD.write_text(build, encoding="utf-8")

checks = {
    "marker": MARKER in MAIN.read_text(encoding="utf-8"),
    "identity": "v9.5.114-JEV-RESILIENT-R2536" in MAIN.read_text(encoding="utf-8"),
    "status": "R2536 JEV:" in MAIN.read_text(encoding="utf-8"),
    "card": "R2536 RESILIENT JEV" in CARD.read_text(encoding="utf-8"),
    "client": "R2536 RESILIENT VISION" in CLIENT.read_text(encoding="utf-8"),
    "build": "versionCode 26092405" in BUILD.read_text(encoding="utf-8") and "versionName '9.5.114-r2536'" in BUILD.read_text(encoding="utf-8"),
}
bad = [k for k,v in checks.items() if not v]
if bad:
    fail("final checks failed: " + ", ".join(bad))

print("V95120_JEV_RESILIENT_R2536_MOBILE_OK")
print("Android identity: v9.5.114-JEV-RESILIENT-R2536 / versionCode 26092405 / versionName 9.5.114-r2536")
print("Vision: deterministic schema-only level repair; no side/status override")
print("Research: 9Router + OpenRouter free retry/failover + JEV-verified curated OSS reference")
print("Android remains UI/telemetry only; LIVE execution stays on PC BrainHub")
