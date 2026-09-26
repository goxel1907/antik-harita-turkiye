"""R2542 professional Android UI post-patch.

Runs after v95122_r2541_turkish_contract.py and after the existing contract checks.
This patch is presentation/integration only:
- keeps Android PC-only / fail-closed execution ownership,
- keeps PC LIVE truth at FRESH_MS=45000 and 3 consecutive failures,
- keeps the 5 USD JEV daily cap on the PC unchanged,
- makes the default AUTO card concise and user-oriented,
- keeps full technical diagnostics behind the card tap,
- hides legacy duplicate diagnostics and the OpenRouter credit shortcut from the main screen,
- bumps the installable Android identity because the Android UI changed.
"""
from pathlib import Path
import re

MARKER = "V95123_PRO_UI_R2542"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
CARD = JAVA / "AutoDecisionCard.java"
CLIENT = JAVA / "BrainHubClient.java"
AUTO = JAVA / "AutoTradeEngine.java"
TRUTH = JAVA / "V95113PcTruth.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, CARD, CLIENT, AUTO, TRUTH, BUILD):
    if not p.exists():
        raise SystemExit("R2542 UI missing required file: " + str(p))

main = MAIN.read_text(encoding="utf-8")
card = CARD.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
auto = AUTO.read_text(encoding="utf-8")
truth = TRUTH.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

required = [
    ("R2541/HF4 base", "v9.5.115-JEV-PC-ONLY-R2541-HF4" in main),
    ("Android direct execution disabled", "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in client),
    ("phone executor inert", "historical PHONE Binance executor permanently inert" in auto),
    ("45 s PC truth", "FRESH_MS = 45000L" in truth),
    ("3 failure grace", "MIN_FAILURES_BEFORE_UNHEALTHY = 3" in truth),
    ("truth helper", "shouldMarkProbeUnhealthy" in truth),
]
missing = [name for name, ok in required if not ok]
if missing:
    raise SystemExit("R2542 UI safety prerequisite missing: " + ", ".join(missing))

if MARKER in main or MARKER in card:
    raise SystemExit("R2542 professional UI already applied; start a clean Codemagic build")

# ---------------------------------------------------------------------------
# AutoDecisionCard: default screen becomes a concise professional command card.
# Full diagnostics remain available through detailed=true when the card is tapped.
render_sig = "    public static String render(SharedPreferences sp,long now,boolean detailed) {"
if card.count(render_sig) != 1:
    raise SystemExit("R2542 UI AutoDecisionCard.render anchor missing/ambiguous")
card = card.replace(
    render_sig,
    render_sig + "\n        if(!detailed)return renderProfessionalSummary(sp,now);",
    1,
)

# Remove the old 15-second presentation freshness rule. The canonical helper keeps
# the already-verified 45-second / 3-failure contract.
legacy_fresh = '        boolean fresh=ts>0&&now>=ts&&now-ts<=15000&&sp.getBoolean("v9582_pc_probe_ok",false);'
if legacy_fresh in card:
    card = card.replace(legacy_fresh, "        boolean fresh=V95113PcTruth.fresh(sp,now);", 1)
elif "boolean fresh=V95113PcTruth.fresh(sp,now);" not in card:
    raise SystemExit("R2542 UI freshness anchor missing")

helper = r'''
    // V95123_PRO_UI_R2542
    // Main-screen summary only. It never calls a model, changes settings, or sends an order.
    private static String renderProfessionalSummary(SharedPreferences sp,long now) {
        StringBuilder b=new StringBuilder("İŞLEM MERKEZİ • PC BRAINHUB");
        int pc=V95113PcTruth.state(sp,now);
        if(pc==V95113PcTruth.ARMED)b.append("\nLIVE • AÇIK");
        else if(pc==V95113PcTruth.DISARMED)b.append("\nLIVE • KAPALI");
        else b.append("\nLIVE • BİLİNMİYOR");
        b.append(" • Android kontrol/telemetri");
        long contact=V95113PcTruth.lastContact(sp);
        if(contact>0)b.append("\nPC son bağlantı: ").append(V95113PcTruth.hhmmss(contact));

        JSONObject h=json(sp.getString("v95104_pc_auto_health","{}"));
        int scans=h.optInt("scanRuns",0), analyses=h.optInt("deepAnalyses",0), unique=h.optInt("uniqueAnalyzedSymbols",0);
        int pass1=h.optInt("sovereignPass1Calls",h.optInt("jevPass1Calls",0));
        int pass2=h.optInt("sovereignFinalCalls",h.optInt("jevCalled",0));
        b.append("\nTarama: ").append(scans).append(" tur • ").append(analyses).append(" analiz • ").append(unique).append(" farklı coin");
        b.append("\nJEV: PASS-1 ").append(pass1).append(" • SON KARAR ").append(pass2);

        JSONObject jev=json(sp.getString("v9598_jev","{}"));
        JSONObject budget=jev.optJSONObject("budget");
        if(budget!=null){
            double spent=budget.optDouble("spentUsd",0), remaining=budget.optDouble("remainingUsd",0), cap=budget.optDouble("dailyCapUsd",5.0);
            boolean blocked=budget.optBoolean("budgetCallBlocked",false)||budget.has("canReserveNextCall")&&!budget.optBoolean("canReserveNextCall",true);
            if(blocked){
                b.append(String.format(java.util.Locale.US,"\nBütçe: BEKLİYOR • $%.4f/$%.2f • kalan $%.4f",spent,cap,remaining));
                b.append("\nTarama devam eder; yeni ücretli JEV çağrısı yapılmaz.");
            }else{
                b.append(String.format(java.util.Locale.US,"\nBütçe: HAZIR • $%.4f/$%.2f • kalan $%.4f",spent,cap,remaining));
            }
        }

        String exec=sp.getString("v9588_pc_auto_last_execution","");
        String reasons=sp.getString("v9592_pc_auto_last_reasons","");
        b.append("\nOTO: ").append(exec==null||exec.trim().isEmpty()?"durum bekleniyor":trText(exec.trim()));
        if(reasons!=null&&!reasons.trim().isEmpty())b.append(" • ").append(trText(reasons.trim()));

        JSONObject diag=json(sp.getString("v9593_pc_auto_diagnostics","{}"));
        JSONArray rows=diag.optJSONArray("candidates");
        JSONObject row=null;
        if(rows!=null){
            for(int i=0;i<rows.length();i++){
                JSONObject x=rows.optJSONObject(i);
                if(x!=null&&x.optBoolean("selected",false)){row=x;break;}
            }
            if(row==null&&rows.length()>0)row=rows.optJSONObject(0);
        }
        if(row!=null){
            String symbol=val(row,"symbol","?");
            String side=val(row,"side","");
            if("LONG".equalsIgnoreCase(side))side="ALIŞ (LONG)";
            else if("SHORT".equalsIgnoreCase(side))side="SATIŞ (SHORT)";
            b.append("\n\nSON ADAY • ").append(symbol).append(side.isEmpty()?"":" • "+side);
            b.append("\nPlan: ").append(trPlan(val(row,"planStatus","")));
            String stage=val(row,"stageTr",val(row,"stage",""));
            if(!stage.isEmpty())b.append(" • ").append(trText(stage));
            JSONObject jd=row.optJSONObject("jevDecision");
            if(jd!=null){
                String action=jd.optString("action","");
                if("LONG".equalsIgnoreCase(action))action="ALIŞ";
                else if("SHORT".equalsIgnoreCase(action))action="SATIŞ";
                else if("WAIT".equalsIgnoreCase(action))action="BEKLE";
                if(!action.isEmpty())b.append("\nJEV son karar: ").append(action);
                String timing=jd.optString("entryTiming","");
                if(!timing.isEmpty())b.append(" • ").append(trText(timing));
                String setup=jd.optString("setupFamily","");
                if(!setup.isEmpty())b.append("\nSetup: ").append(trText(setup));
            }
            String wait=val(row,"waitFor","");
            if(!wait.isEmpty())b.append("\nBeklenen: ").append(trText(wait));
        }else{
            b.append("\n\nSon aday: henüz güncel aday yok");
        }

        b.append("\n\nGÜVENLİK • PC tek yürütücü • Android doğrudan emir göndermez • max 2 pozisyon");
        b.append("\nAyrıntılar için bu karta dokunun.");
        return b.toString();
    }
'''
insert_at = card.rfind("}")
if insert_at < 0:
    raise SystemExit("R2542 UI AutoDecisionCard class end missing")
card = card[:insert_at] + helper + "\n// " + MARKER + "\n" + card[insert_at:]

# ---------------------------------------------------------------------------
# Main screen cleanup. Keep code paths for compatibility but hide legacy duplicate
# technical panels from the normal surface. Detailed card tap remains available.
main = main.replace(
    'new android.app.AlertDialog.Builder(this).setTitle("OTO • Model ve karar ayrıntıları")',
    'new android.app.AlertDialog.Builder(this).setTitle("İşlem Merkezi • Ayrıntılar")',
)
main = main.replace('extraReview.setText("OTO ADAYI • EK ANALİZ PAKETİ")', 'extraReview.setText("ADAYI DERİN İNCELE (İSTEĞE BAĞLI)")')

# The credit shortcut is not an execution/control function. Keep the object for binary
# compatibility with the generated source but remove it from the normal UI.
credit_line = '        android.widget.Button openRouterCredit=new android.widget.Button(this);'
if main.count(credit_line) != 1:
    raise SystemExit('R2542 UI OpenRouter credit anchor missing/ambiguous')
if 'openRouterCredit.setVisibility(android.view.View.GONE);' not in main:
    main = main.replace(credit_line, credit_line + '\n        openRouterCredit.setVisibility(android.view.View.GONE);', 1)

# Older detailed telemetry blocks duplicate the tap-to-open diagnostics. Hide them on
# the main screen; the data and code are retained for diagnostics/compatibility.
detail_line = 'android.widget.TextView detail=text(v9599UiTr(detailedAuto),11.15f,android.graphics.Color.WHITE,false);'
if main.count(detail_line) != 1:
    raise SystemExit('R2542 UI legacy detail anchor missing/ambiguous')
if 'detail.setVisibility(android.view.View.GONE);' not in main:
    main = main.replace(detail_line, detail_line + '\n        detail.setVisibility(android.view.View.GONE);', 1)
life_line = 'android.widget.TextView life=text(v9599UiTr(lifecycleText),10.9f,android.graphics.Color.WHITE,false);'
if main.count(life_line) != 1:
    raise SystemExit('R2542 UI legacy lifecycle anchor missing/ambiguous')
if 'life.setVisibility(android.view.View.GONE);' not in main:
    main = main.replace(life_line, life_line + '\n        life.setVisibility(android.view.View.GONE);', 1)

main = main.replace("v9.5.115-JEV-PC-ONLY-R2541-HF4", "v9.5.116-JEV-PC-ONLY-R2542-UI1", 1)
main += "\n// " + MARKER + "\n"

# This is an Android-source change, so ship a real installable version bump.
build = re.sub(r"versionCode\s+\d+", "versionCode 26092701", build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.116-r2542-ui1'", build, count=1)

MAIN.write_text(main, encoding="utf-8")
CARD.write_text(card, encoding="utf-8")
BUILD.write_text(build, encoding="utf-8")

# ---------------------------------------------------------------------------
# Fail-closed release contract checks.
main2 = MAIN.read_text(encoding="utf-8")
card2 = CARD.read_text(encoding="utf-8")
client2 = CLIENT.read_text(encoding="utf-8")
auto2 = AUTO.read_text(encoding="utf-8")
truth2 = TRUTH.read_text(encoding="utf-8")
build2 = BUILD.read_text(encoding="utf-8")

checks = {
    "marker main": MARKER in main2,
    "marker card": MARKER in card2,
    "professional summary": "renderProfessionalSummary" in card2 and "İŞLEM MERKEZİ • PC BRAINHUB" in card2,
    "45s summary truth": "boolean fresh=V95113PcTruth.fresh(sp,now);" in card2,
    "no legacy 15s card rule": "now-ts<=15000" not in card2,
    "Android direct execution blocked": "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in client2,
    "no Android /live/execute post": 'post(c, "/live/execute", intent, true)' not in client2,
    "phone executor inert": "historical PHONE Binance executor permanently inert" in auto2,
    "45s canonical truth": "FRESH_MS = 45000L" in truth2,
    "3 failure grace": "MIN_FAILURES_BEFORE_UNHEALTHY = 3" in truth2,
    "truth helper": "shouldMarkProbeUnhealthy" in truth2,
    "version": "versionName '9.5.116-r2542-ui1'" in build2 and "versionCode 26092701" in build2,
    "identity": "v9.5.116-JEV-PC-ONLY-R2542-UI1" in main2,
    "credit shortcut hidden": "openRouterCredit.setVisibility(android.view.View.GONE);" in main2,
    "legacy detail hidden": "detail.setVisibility(android.view.View.GONE);" in main2,
    "legacy lifecycle hidden": "life.setVisibility(android.view.View.GONE);" in main2,
    "professional dialog title": "İşlem Merkezi • Ayrıntılar" in main2,
}
failed = [k for k, v in checks.items() if not v]
if failed:
    raise SystemExit("R2542 professional UI contract failed: " + ", ".join(failed))

print(MARKER + "_OK")
