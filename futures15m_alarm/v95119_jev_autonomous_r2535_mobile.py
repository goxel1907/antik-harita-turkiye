"""R2.5.3.5 Android telemetry alignment for JEV autonomous position management and verified research.

Runs after v95118_jev_full_cortex_r2534_mobile.py.
UI/metadata only:
- shows R2535 JEV EXIT_NOW binding truth from the PC;
- shows verified 9Router + OpenRouter-free research with JEV verification;
- shows lifetime measured-memory semantics;
- removes stale UI copy that can contradict the authoritative PC position ledger/JEV result;
- does not arm LIVE, place orders, close positions, cancel orders, change sizing, or change risk rules.
"""
from pathlib import Path
import re

MARKER = "V95119_JEV_AUTONOMOUS_R2535_MOBILE"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
ANALYSIS = JAVA / "AnalysisPackActivity.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, CARD, CLIENT, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit("v9.5.119 missing required file: " + str(p))

def fail(msg):
    raise SystemExit("v9.5.119 " + msg)

main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
analysis = ANALYSIS.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

if MARKER in main:
    fail("already applied; start a clean Codemagic build")
if "V95118_JEV_FULL_CORTEX_R2534_MOBILE" not in main:
    fail("requires v95118 R2534 mobile patch first")

old_identity = "v9.5.114-JEV-FULL-CORTEX-R2534"
if old_identity not in main:
    fail("v95118 identity anchor missing")
main = main.replace(old_identity, "v9.5.114-JEV-AUTONOMOUS-R2535", 1)

old_status = '            st.append("\\nR2534 FULL CORTEX: profesyonel trader/scalper bilgi referansı PASS-1 + PASS-2 + pozisyon yönetiminde sürekli • measured outcome + JEV lesson hafızası ALWAYS-ON • bilinmeyen bilgi uydurulmaz."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE'
if old_status not in main:
    fail("R2534 status anchor missing")
new_status = '            st.append("\\nR2535 JEV: FULL CORTEX sürekli • lifetime measured memory + son ayrıntılar ALWAYS-ON • bilgi boşluğunda 9Router + OpenRouter free araştırır, kaynak getirir, JEV doğrulamadan bilgi kalıcı olmaz • EXIT_NOW ve PARTIAL_TAKE_PROFIT PC LIVE açık ve BrainHub-owned pozisyonda reduce-only MARKET olarak uygulanır."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE ' + MARKER
main = main.replace(old_status, new_status, 1)

old_card = '        b.append("\\nR2534 LIVE READ-ONLY CORTEX: chart formations + price action/SMC + indicators + order-flow/depth + derivatives + execution/risk bilgisi; geçmiş ölçülmüş işlemler PASS-1/PASS-2/pozisyon yönetiminde istemeden hatırlanır."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE'
if old_card not in card:
    fail("AutoDecisionCard R2534 anchor missing")
new_card = '        b.append("\\nR2535 AUTONOMOUS JEV: LIVE read-only Cortex + lifetime measured experience + doğrulanmış dinamik araştırma; EXIT_NOW ve PARTIAL_TAKE_PROFIT BrainHub-owned pozisyonda LIVE açıkken gerçek reduce-only yönetim emrine bağlanır. External/manual pozisyon otomatik yönetilmez."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE ' + MARKER
card = card.replace(old_card, new_card, 1)

# Remove stale authority wording if an older source/patch path left it visible.
stale_authority = "Jev yalnız işlem adayı planın ek güvenlik denetimidir."
new_authority = "JEV stratejik FINAL AUTHORITY'dir; PASS-1 kanıtı seçer, PASS-2 LONG/SHORT/WAIT verir ve açık BrainHub pozisyonunu yönetir."
main = main.replace(stale_authority, new_authority)
card = card.replace(stale_authority, new_authority)

# The authoritative PC/Binance ledger wins over old local-app ownership copy.
for stale in [
    "uygulamanın açtığı aktif işlem yok",
    "Uygulamanın açtığı aktif işlem yok",
    "uygulamanın açtığı aktif pozisyon yok",
    "Uygulamanın açtığı aktif pozisyon yok",
]:
    main = main.replace(stale, "PC/Binance pozisyon defteri otoritatiftir; aktif pozisyon durumu aşağıdaki PC pozisyon panelinden alınır.")
    card = card.replace(stale, "PC/Binance pozisyon defteri otoritatiftir; aktif pozisyon durumu aşağıdaki PC pozisyon panelinden alınır.")

# Never show an old local JEV placeholder as if it overruled a newer PC FINAL result.
for stale in ["Jev henüz değerlendirilmedi", "JEV henüz değerlendirilmedi"]:
    main = main.replace(stale, "JEV sonucu PC FINAL AUTHORITY telemetrisinden alınır")
    card = card.replace(stale, "JEV sonucu PC FINAL AUTHORITY telemetrisinden alınır")

if "R2.5.3.2 SOVEREIGN • R2534 FULL CORTEX ALWAYS-ON" not in client:
    fail("BrainHubClient R2534 label missing")
client = client.replace(
    "R2.5.3.2 SOVEREIGN • R2534 FULL CORTEX ALWAYS-ON",
    "R2.5.3.2 SOVEREIGN • R2535 AUTONOMOUS MGMT • VERIFIED RESEARCH • LIFETIME MEMORY",
    1,
)
client = client.replace("Jev: hazır • veto denetimi", "JEV: hazır • FINAL AUTHORITY")
client += "\n// " + MARKER + "\n"

if "JEV PRO TRADER/SCALPER • R2534 FULL CORTEX" in analysis:
    analysis = analysis.replace(
        "JEV PRO TRADER/SCALPER • R2534 FULL CORTEX",
        "JEV PRO TRADER/SCALPER • R2535 AUTONOMOUS MGMT + VERIFIED RESEARCH",
        1,
    )
analysis += "\n// " + MARKER + "\n"

if len(re.findall(r"versionCode\s+\d+", build)) != 1:
    fail("versionCode anchor missing/ambiguous")
if len(re.findall(r"versionName\s+[\"'][^\"']+[\"']", build)) != 1:
    fail("versionName anchor missing/ambiguous")
build = re.sub(r"versionCode\s+\d+", "versionCode 26092404", build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.114-r2535'", build, count=1)

MAIN.write_text(main, encoding="utf-8")
CARD.write_text(card, encoding="utf-8")
CLIENT.write_text(client, encoding="utf-8")
ANALYSIS.write_text(analysis, encoding="utf-8")
BUILD.write_text(build, encoding="utf-8")

joined = "\n".join([
    MAIN.read_text(encoding="utf-8"),
    CARD.read_text(encoding="utf-8"),
    CLIENT.read_text(encoding="utf-8"),
])
stale_checks = [
    "Jev yalnız işlem adayı planın ek güvenlik denetimidir.",
    "uygulamanın açtığı aktif işlem yok",
    "Uygulamanın açtığı aktif işlem yok",
    "Jev henüz değerlendirilmedi",
    "JEV henüz değerlendirilmedi",
]
bad_stale = [x for x in stale_checks if x in joined]
if bad_stale:
    fail("stale mobile telemetry remains: " + " | ".join(bad_stale))

checks = {
    "marker": MARKER in MAIN.read_text(encoding="utf-8"),
    "identity": "v9.5.114-JEV-AUTONOMOUS-R2535" in MAIN.read_text(encoding="utf-8"),
    "R2535 status": "R2535 JEV: FULL CORTEX" in MAIN.read_text(encoding="utf-8"),
    "R2535 card": "R2535 AUTONOMOUS JEV" in CARD.read_text(encoding="utf-8"),
    "client": "R2535 AUTONOMOUS MGMT" in CLIENT.read_text(encoding="utf-8"),
    "build": "versionCode 26092404" in BUILD.read_text(encoding="utf-8") and "versionName '9.5.114-r2535'" in BUILD.read_text(encoding="utf-8"),
}
bad = [k for k,v in checks.items() if not v]
if bad:
    fail("final checks failed: " + ", ".join(bad))

print("V95119_JEV_AUTONOMOUS_R2535_MOBILE_OK")
print("Android identity: v9.5.114-JEV-AUTONOMOUS-R2535 / versionCode 26092404 / versionName 9.5.114-r2535")
print("Position truth: authoritative PC/Binance ledger")
print("JEV: FINAL AUTHORITY + R2535 research/memory/position-management telemetry")
print("Android remains UI/telemetry only; LIVE execution stays on PC BrainHub")
