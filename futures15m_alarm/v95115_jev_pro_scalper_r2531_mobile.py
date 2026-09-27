"""v9.5.115-style mobile alignment for BrainHub R2.5.3.1 JEV Pro Trader/Scalper evidence mode.

Runs after v95114_jev_cortex_mobile.py. UI/metadata only:
- keeps PC as the strategic/execution brain; Android remains presentation/control surface;
- aligns visible identity with BrainHub R2.5.3.1 sovereign evidence hotfix;
- removes legacy wording that implied an external/worker 15m strategic veto;
- presents JEV's pro futures trader/scalper evidence review contract;
- states TradingView visual validation + Binance/BrainHub numeric-truth precedence;
- states order-flow source semantics: streaming preferred, labeled REST fallback, missing != neutral;
- keeps LIVE arming explicit/manual and preserves v9.5.113 emergency-stop behavior.

No order, close, cancel, leverage, sizing, risk-rule or LIVE-arm behavior is added here.
"""
from pathlib import Path
import re

MARKER = "V95115_JEV_PRO_SCALPER_R2531_MOBILE"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
ANALYSIS = JAVA / "AnalysisPackActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, ANALYSIS, CARD, CLIENT, BUILD):
    if not p.exists():
        raise SystemExit("v9.5.115 missing required file: " + str(p))

def fail(msg):
    raise SystemExit("v9.5.115 " + msg)

def rep(src, old, new, what):
    n = src.count(old)
    if n != 1:
        fail(("anchor missing" if n == 0 else "anchor ambiguous (%dx)" % n) + ": " + what)
    return src.replace(old, new, 1)

# --------------------------------------------------------------------------- MainActivity
main = MAIN.read_text(encoding="utf-8")
if MARKER in main:
    fail("already applied; start a clean Codemagic build")
if "V95114_JEV_CORTEX_MOBILE" not in main:
    fail("requires v95114 JEV Cortex mobile patch first")

old_arch = r'''            st.append("\nKarar mimarisi: 15m ANA/KONTEXT • scalp execution yalnız KAPANMIŞ 5m • 1m/3m destek/timing, tek başına tetik değil • taze sert ters 15m scalp'i veto eder • oluşan mum bağlamdır, onay değildir • 30m+ yapı/likidite/formasyon/tükenme bağlamı."); // V95114_JEV_CORTEX_MOBILE'''
new_arch = r'''            st.append("\nKarar mimarisi: 5m LONG/SHORT SCALP • scalp execution yalnız KAPANMIŞ 5m • 15m LONG/SHORT TRADE • 1m/3m/30m+ yalnız JEV isterse ek kanıttır • 15m ters yapı JEV için kanıttır; worker stratejik veto üretmez • oluşan mum bağlamdır, onay değildir."); // V95115_JEV_PRO_SCALPER_R2531_MOBILE
            st.append("\nJEV PATRON: PASS-1 hangi kanıtın gerekli olduğunu seçer → workerlar yalnız o kanıtı getirir → PASS-2 LONG / SHORT / WAIT final kararını verir.");
            st.append("\nJEV PRO FUTURES TRADER/SCALPER: 5m scalp ve 15m trade için yapı/SMC/likidite/grafik/order-flow/depth/OI/funding/taker/top-trader/observed liquidation kanıtlarının önem sırasını JEV kendisi belirler; tüm şartların aynı anda hizalanması gerekmez.");
            st.append("\nJEV YÖNETİMİ: seçilen işlemde invalidation/stop tabanı, hedef profili, partial dağılımı, breakeven ve runner/trailing yaklaşımını JEV belirler; kod yalnız sayısal/exchange bütünlüğünü uygular.");
            st.append("\nJEV TEACHER: kapanmış ölçülmüş işlemlerden SHADOW lesson üretir; self-modify ve auto-promotion kapalıdır.");
            st.append("\nChart truth: yalnız doğrulanmış TradingView görsel kanıtı; sayısal çatışmada Binance/BrainHub üstündür.");
            st.append("\nOrder-flow truth: streaming tercih edilir; REST aggTrades fallback açıkça etiketlenir; eksik veri NÖTR/0 kabul edilmez.");'''
main = rep(main, old_arch, new_arch, "R2.5.3.2 trade/chart evidence wording")

old_status = r'''            st.append("\nJEV CORTEX P2: FINAL AUTHORITY • worker EVIDENCE_ONLY • learning SHADOW • self-modify/auto-promotion KAPALI"); // V95114_JEV_CORTEX_MOBILE'''
new_status = r'''            st.append("\nJEV CORTEX P2 + R2.5.3.2 SOVEREIGN FLOW: FINAL AUTHORITY • scanner ATTENTION_ONLY • worker EVIDENCE_ONLY • learning SHADOW • self-modify/auto-promotion KAPALI"); // V95115_JEV_PRO_SCALPER_R2531_MOBILE'''
main = rep(main, old_status, new_status, "JEV sovereign evidence status")

if "v9.5.114-JEV-CORTEX" not in main:
    fail("v95114 visible identity anchor missing")
main = main.replace("v9.5.114-JEV-CORTEX", "v9.5.114-JEV-PRO-SCALPER-R2531")
MAIN.write_text(main, encoding="utf-8")

# --------------------------------------------------------------------------- AutoDecisionCard
card = CARD.read_text(encoding="utf-8")
old_card = r'''        b.append("\nJEV CORTEX P2: PASS-1 → hedefli evidence dispatch → çözümlenmiş kanıt varsa tek PASS-2; Phase-3 observer READ_ONLY ve decision authority NONE.");'''
new_card = r'''        b.append("\nJEV CORTEX P2: PASS-1 → JEV kanıtı seçer → worker yalnız isteneni toplar → tek PASS-2 → JEV FINAL LONG/SHORT/WAIT; Phase-3 observer READ_ONLY ve decision authority NONE.");
        b.append("\nR2.5.3.2 SOVEREIGN FLOW: 5m LONG/SHORT scalp + 15m LONG/SHORT trade; 1m/3m/30m+ zorunlu oy değil, yalnız JEV isterse ek kanıttır. Sabit puan/2-of-3/hard-15m stratejik veto yoktur."); // V95115_JEV_PRO_SCALPER_R2531_MOBILE
        b.append("\nTV görseli ancak identity/freshness/range/nonblank doğrulanırsa kanıttır; numeric conflict → Binance/BrainHub wins.");
        b.append("\nJEV ayrıca target/partial/BE/trail yönetim tercihini verir; kapanan işlemlerden SHADOW teacher lesson üretir. Self-modify / auto-promotion yok.");'''
card = rep(card, old_card, new_card, "AutoDecisionCard pro scalper evidence review")
CARD.write_text(card, encoding="utf-8")

# --------------------------------------------------------------------------- BrainHubClient label
client = CLIENT.read_text(encoding="utf-8")
old_label = '''        String label=jev==null?"JEV durumu alınamadı":("JEV: "+(jev.optBoolean("configured")?"hazır • FINAL AUTHORITY":"yapılandırma/anahtar eksik")); // V95114_JEV_CORTEX_MOBILE'''
new_label = '''        String label=jev==null?"JEV durumu alınamadı":("JEV: "+(jev.optBoolean("configured")?"hazır • FINAL AUTHORITY • R2.5.3.2 SOVEREIGN":"yapılandırma/anahtar eksik")); // V95115_JEV_PRO_SCALPER_R2531_MOBILE'''
client = rep(client, old_label, new_label, "BrainHubClient R2.5.3.2 label")
CLIENT.write_text(client, encoding="utf-8")

# --------------------------------------------------------------------------- Analysis title
analysis = ANALYSIS.read_text(encoding="utf-8")
analysis = rep(
    analysis,
    "JEV CORTEX ANALİZ PAKETİ • v9.5.114",
    "JEV PRO TRADER/SCALPER ANALİZ PAKETİ • R2.5.3.2",
    "AnalysisPackActivity title",
)
ANALYSIS.write_text(analysis, encoding="utf-8")

# --------------------------------------------------------------------------- build identity
build = BUILD.read_text(encoding="utf-8")
if len(re.findall(r"versionCode\s+\d+", build)) != 1:
    fail("versionCode anchor missing/ambiguous")
if len(re.findall(r"versionName\s+[\"'][^\"']+[\"']", build)) != 1:
    fail("versionName anchor missing/ambiguous")
build = re.sub(r"versionCode\s+\d+", "versionCode 26092302", build, count=1)
build = re.sub(r"versionName\s+[\"'][^\"']+[\"']", "versionName '9.5.114-r2531'", build, count=1)
BUILD.write_text(build, encoding="utf-8")

# --------------------------------------------------------------------------- final checks
main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
analysis = ANALYSIS.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

checks = {
    "marker": MARKER in main and MARKER in card and MARKER in client,
    "identity": "v9.5.114-JEV-PRO-SCALPER-R2531" in main,
    "no legacy hard-veto text": "taze sert ters 15m scalp'i veto eder" not in main,
    "closed5m": "scalp execution yalnız KAPANMIŞ 5m" in main,
    "worker no veto": "worker stratejik veto üretmez" in main,
    "pro review": "JEV PRO FUTURES TRADER/SCALPER" in main and "R2.5.3.2 SOVEREIGN FLOW" in card and "JEV PATRON" in main,
    "jev management": "JEV YÖNETİMİ" in main and "target/partial/BE/trail" in card,
    "jev teacher": "JEV TEACHER" in main and "SHADOW teacher lesson" in card,
    "numeric truth": "Binance/BrainHub üstündür" in main and "Binance/BrainHub wins" in card,
    "missing not neutral": "eksik veri NÖTR/0 kabul edilmez" in main,
    "authority": "scanner ATTENTION_ONLY" in main and "worker EVIDENCE_ONLY" in main,
    "live truth retained": "CLAUDE_V113_ANDROID_LIVE_TRUTH" in main and "v95113StopAndVerify" in main,
    "client label": "R2.5.3.2 SOVEREIGN" in client,
    "analysis title": "JEV PRO TRADER/SCALPER ANALİZ PAKETİ • R2.5.3.2" in analysis,
    "build identity": "versionCode 26092302" in build and "versionName '9.5.114-r2531'" in build,
}
bad = [k for k, v in checks.items() if not v]
if bad:
    fail("final checks failed: " + ", ".join(bad))

print("V95115_JEV_PRO_SCALPER_R2531_MOBILE_OK")
print("Android identity: v9.5.114-JEV-PRO-SCALPER-R2531 / versionCode 26092302 / versionName 9.5.114-r2531")
print("Authority: JEV PATRON / FINAL; scanner ATTENTION_ONLY; workers JEV-DIRECTED EVIDENCE_ONLY; observer READ_ONLY/NONE")
print("Trade lanes: 5m LONG/SHORT scalp; 15m LONG/SHORT trade; extra TF evidence only when JEV requests it")
print("Chart truth: validated TradingView visual evidence; Binance/BrainHub numeric authority")
print("Order flow: streaming preferred; labeled REST fallback; missing evidence is not neutral")
print("LIVE: unchanged; explicit/manual PC truth and emergency-stop verification retained")
