"""R2.5.3.2 Android identity + sovereign management alignment.

Runs after v95115_jev_pro_scalper_r2531_mobile.py.
- keeps the verified v95115 UI/behavior and emergency-stop truth;
- bumps Android package identity so the sovereign build installs as a real update;
- surfaces JEV as evidence director, final trade manager, and SHADOW teacher;
- does not add order, close, cancel, sizing or LIVE-arm behavior.
"""
from pathlib import Path
import re

MARKER = "V95116_JEV_SOVEREIGN_R2532_MOBILE"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
ANALYSIS = JAVA / "AnalysisPackActivity.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, CARD, CLIENT, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit("v9.5.116 missing required file: " + str(p))

def fail(msg):
    raise SystemExit("v9.5.116 " + msg)

main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
analysis = ANALYSIS.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

if MARKER in main:
    fail("already applied; start a clean Codemagic build")
if "V95115_JEV_PRO_SCALPER_R2531_MOBILE" not in main:
    fail("requires v95115 sovereign base patch first")

old_identity = "v9.5.114-JEV-PRO-SCALPER-R2531"
if old_identity not in main:
    fail("v95115 identity anchor missing")
main = main.replace(old_identity, "v9.5.114-JEV-SOVEREIGN-R2532", 1)

anchor = '            st.append("\\nJEV TEACHER: kapanmış ölçülmüş işlemlerden SHADOW lesson üretir; self-modify ve auto-promotion kapalıdır.");'
if anchor not in main:
    fail("JEV teacher anchor missing")
main = main.replace(anchor, anchor + '\n            st.append("\\nR2532: JEV evidence director + final trade manager + SHADOW teacher; scanner/worker stratejik karar vermez."); // ' + MARKER, 1)

card_anchor = '        b.append("\\nJEV ayrıca target/partial/BE/trail yönetim tercihini verir; kapanan işlemlerden SHADOW teacher lesson üretir. Self-modify / auto-promotion yok.");'
if card_anchor not in card:
    fail("AutoDecisionCard R2532 anchor missing")
card = card.replace(card_anchor, card_anchor + '\n        b.append("\\nR2532 ACTIVE: JEV PASS-1 evidence request → worker EVIDENCE_ONLY → PASS-2 LONG/SHORT/WAIT → hard safety only."); // ' + MARKER, 1)

client_anchor = 'R2.5.3.2 SOVEREIGN'
if client_anchor not in client:
    fail("BrainHubClient sovereign label missing")
client = client.replace(client_anchor, "R2.5.3.2 SOVEREIGN • R2532", 1) + "\n// " + MARKER + "\n"

if "JEV PRO TRADER/SCALPER ANALİZ PAKETİ • R2.5.3.2" not in analysis:
    fail("AnalysisPack R2532 title missing")
analysis = analysis + "\n// " + MARKER + "\n"

if len(re.findall(r"versionCode\s+\d+", build)) != 1:
    fail("versionCode anchor missing/ambiguous")
if len(re.findall(r"versionName\s+[\"'][^\"']+[\"']", build)) != 1:
    fail("versionName anchor missing/ambiguous")
build = re.sub(r"versionCode\s+\d+", "versionCode 26092401", build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.114-r2532'", build, count=1)

MAIN.write_text(main, encoding="utf-8")
CARD.write_text(card, encoding="utf-8")
CLIENT.write_text(client, encoding="utf-8")
ANALYSIS.write_text(analysis, encoding="utf-8")
BUILD.write_text(build, encoding="utf-8")

main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
analysis = ANALYSIS.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

checks = {
    "marker": MARKER in main and MARKER in card and MARKER in client and MARKER in analysis,
    "identity": "v9.5.114-JEV-SOVEREIGN-R2532" in main,
    "jev patron": "JEV PATRON" in main,
    "management": "JEV YÖNETİMİ" in main,
    "teacher": "JEV TEACHER" in main,
    "sovereign card": "R2532 ACTIVE" in card and "PASS-2 LONG/SHORT/WAIT" in card,
    "client": "R2.5.3.2 SOVEREIGN • R2532" in client,
    "build identity": "versionCode 26092401" in build and "versionName '9.5.114-r2532'" in build,
}
bad = [k for k, v in checks.items() if not v]
if bad:
    fail("final checks failed: " + ", ".join(bad))

print("V95116_JEV_SOVEREIGN_R2532_MOBILE_OK")
print("Android identity: v9.5.114-JEV-SOVEREIGN-R2532 / versionCode 26092401 / versionName 9.5.114-r2532")
print("Authority: JEV PATRON / FINAL; scanner ATTENTION_ONLY; workers JEV-DIRECTED EVIDENCE_ONLY")
print("Lanes: 5m LONG/SHORT scalp + 15m LONG/SHORT trade")
print("Learning: JEV SHADOW teacher; self-modify=false; auto-promotion=false")
print("LIVE: unchanged; explicit/manual PC truth and emergency-stop verification retained")
