"""v9.5.114 JEV Cortex mobile alignment for BrainHub R2.5.2.

Runs after v95113_claude_live_truth.py. This patch is deliberately UI/metadata only:
- keeps explicit/manual PC LIVE arming and the v9.5.113 verified emergency-stop flow;
- presents JEV as FINAL STRATEGIC AUTHORITY instead of a secondary veto checker;
- states worker authority as EVIDENCE_ONLY and observer authority as READ_ONLY/NONE;
- states the fixed trade-lane rule: 15m main/context, CLOSED 5m scalp execution,
  1m/3m support/timing only, fresh hard opposite 15m veto, forming candle context only;
- keeps learning SHADOW with self-modify / auto-promotion off;
- bumps Android identity to 9.5.114 / 26092301 / v9.5.114-JEV-CORTEX.

No LIVE arm, order, cancel, close, leverage, sizing or risk-rule behavior is added here.
"""
from pathlib import Path
import re

MARKER = "V95114_JEV_CORTEX_MOBILE"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
ANALYSIS = JAVA / "AnalysisPackActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, ANALYSIS, CARD, CLIENT, BUILD):
    if not p.exists():
        raise SystemExit("v9.5.114 missing required file: " + str(p))


def fail(msg):
    raise SystemExit("v9.5.114 " + msg)


def rep(src, old, new, what):
    n = src.count(old)
    if n != 1:
        fail(("anchor missing" if n == 0 else "anchor ambiguous (%dx)" % n) + ": " + what)
    return src.replace(old, new, 1)


# --------------------------------------------------------------------------- MainActivity
main = MAIN.read_text(encoding="utf-8")
if MARKER in main:
    fail("already applied; start a clean Codemagic build")
if "CLAUDE_V113_ANDROID_LIVE_TRUTH" not in main:
    fail("requires v95113 PC LIVE truth patch first")

old_arch = r'''            st.append("\nKarar mimarisi: 15m ana işlem hattı • 1m/3m/5m scalp momentum hattı (tek alt TF karar vermez; en az 2 alt TF + 15m karşı-veto kontrolü) • 30m+ yapı/likidite/formasyon/tükenme bağlamı.");'''
new_arch = r'''            st.append("\nKarar mimarisi: 15m ANA/KONTEXT • scalp execution yalnız KAPANMIŞ 5m • 1m/3m destek/timing, tek başına tetik değil • taze sert ters 15m scalp'i veto eder • oluşan mum bağlamdır, onay değildir • 30m+ yapı/likidite/formasyon/tükenme bağlamı."); // V95114_JEV_CORTEX_MOBILE'''
main = rep(main, old_arch, new_arch, "trade-lane architecture text")

old_jev_status = r'''            st.append("\n").append(sp.getString("v9597_jev_status","Jev durumu bekleniyor"));'''
new_jev_status = r'''            st.append("\nJEV CORTEX P2: FINAL AUTHORITY • worker EVIDENCE_ONLY • learning SHADOW • self-modify/auto-promotion KAPALI"); // V95114_JEV_CORTEX_MOBILE
            st.append("\n").append(sp.getString("v9597_jev_status","JEV bağlantı durumu bekleniyor"));
            st.append("\nPhase-3 observer: READ_ONLY • decision authority NONE • PASS-1 → evidence dispatch → kanıt çözümlenirse tek PASS-2 (en fazla 2 karar turu)");'''
main = rep(main, old_jev_status, new_jev_status, "JEV status/authority block")

old_version_count = main.count("v9.5.113-CLAUDE")
if old_version_count < 2:
    fail("expected at least two v9.5.113-CLAUDE visible identity anchors, found %d" % old_version_count)
main = main.replace("v9.5.113-CLAUDE", "v9.5.114-JEV-CORTEX")

MAIN.write_text(main, encoding="utf-8")

# --------------------------------------------------------------------------- AutoDecisionCard authority wording
card = CARD.read_text(encoding="utf-8")
old_authority = r'''        b.append("\nJev yalnız işlem adayı planın ek güvenlik denetimidir.");'''
new_authority = r'''        b.append("\nJEV: NİHAİ STRATEJİK KARAR MERCİİ • workerlar yalnız EVIDENCE_ONLY kanıt sağlar; QUALIFY/VETO/SIZE/EXECUTE yetkisi yok."); // V95114_JEV_CORTEX_MOBILE
        b.append("\nJEV CORTEX P2: PASS-1 → hedefli evidence dispatch → çözümlenmiş kanıt varsa tek PASS-2; Phase-3 observer READ_ONLY ve decision authority NONE.");
        b.append("\nÖğrenme: ölçülmüş sonuç → lesson/teacher sample → SHADOW öneri; self-modify ve auto-promotion kapalı.");'''
card = rep(card, old_authority, new_authority, "old secondary-veto authority wording")
card = card.replace("Jev modeli: ", "JEV modeli: ")
card = card.replace("Jev sonrası sonuç: ", "JEV final sonuç: ")
card = card.replace("Jev çağrısı ", "JEV çağrısı ")
card = card.replace("Jev veto ", "JEV red/veto ")
CARD.write_text(card, encoding="utf-8")

# --------------------------------------------------------------------------- BrainHubClient status label
client = CLIENT.read_text(encoding="utf-8")
old_label = '''        String label=jev==null?"Jev durumu alınamadı":("Jev: "+(jev.optBoolean("configured")?"hazır • veto denetimi":"yapılandırma/anahtar eksik"));'''
new_label = '''        String label=jev==null?"JEV durumu alınamadı":("JEV: "+(jev.optBoolean("configured")?"hazır • FINAL AUTHORITY":"yapılandırma/anahtar eksik")); // V95114_JEV_CORTEX_MOBILE'''
client = rep(client, old_label, new_label, "BrainHubClient JEV label")
CLIENT.write_text(client, encoding="utf-8")

# --------------------------------------------------------------------------- Analysis pack identity
analysis = ANALYSIS.read_text(encoding="utf-8")
analysis = rep(
    analysis,
    "CLAUDE ANALİZ PAKETİ • v9.5.113",
    "JEV CORTEX ANALİZ PAKETİ • v9.5.114",
    "AnalysisPackActivity title",
)
ANALYSIS.write_text(analysis, encoding="utf-8")

# --------------------------------------------------------------------------- Android build identity
build = BUILD.read_text(encoding="utf-8")
if len(re.findall(r"versionCode\s+\d+", build)) != 1:
    fail("versionCode anchor missing/ambiguous")
if len(re.findall(r"versionName\s+[\"'][^\"']+[\"']", build)) != 1:
    fail("versionName anchor missing/ambiguous")
build = re.sub(r"versionCode\s+\d+", "versionCode 26092301", build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.114'", build, count=1)
BUILD.write_text(build, encoding="utf-8")

# --------------------------------------------------------------------------- final safety/semantic checks
main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
analysis = ANALYSIS.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

checks = {
    "marker": MARKER in main and MARKER in card and MARKER in client,
    "new visible identity": "v9.5.114-JEV-CORTEX" in main and "v9.5.113-CLAUDE" not in main,
    "fixed scalp rule": "scalp execution yalnız KAPANMIŞ 5m" in main and "1m/3m destek/timing, tek başına tetik değil" in main,
    "JEV final authority": "JEV CORTEX P2: FINAL AUTHORITY" in main and "JEV: NİHAİ STRATEJİK KARAR MERCİİ" in card,
    "workers evidence only": "worker EVIDENCE_ONLY" in main and "QUALIFY/VETO/SIZE/EXECUTE yetkisi yok" in card,
    "observer read only": "observer: READ_ONLY" in main and "decision authority NONE" in main,
    "shadow learning": "learning SHADOW" in main and "self-modify/auto-promotion KAPALI" in main,
    "old authority text removed": "Jev yalnız işlem adayı planın ek güvenlik denetimidir" not in card,
    "PC LIVE truth retained": "CLAUDE_V113_ANDROID_LIVE_TRUTH" in main and "v95113StopAndVerify" in main,
    "no automatic live arm added": "V95114_JEV_CORTEX_MOBILE" in main and "liveArm(this" not in new_jev_status and "liveExecute" not in new_jev_status,
    "client authority label": "hazır • FINAL AUTHORITY" in client,
    "analysis identity": "JEV CORTEX ANALİZ PAKETİ • v9.5.114" in analysis,
    "build identity": "versionCode 26092301" in build and "versionName '9.5.114'" in build,
}
bad = [k for k, v in checks.items() if not v]
if bad:
    fail("final checks failed: " + ", ".join(bad))

print("V95114_JEV_CORTEX_MOBILE_OK")
print("Android identity: v9.5.114-JEV-CORTEX / versionCode 26092301")
print("Authority: JEV FINAL; workers EVIDENCE_ONLY; observer READ_ONLY/NONE; learning SHADOW")
print("Trade lanes: 15m main/context; CLOSED 5m scalp execution; 1m/3m support only; fresh hard opposite 15m veto")
print("LIVE: remains explicit/manual; v95113 PC truth + emergency-stop verification retained")
