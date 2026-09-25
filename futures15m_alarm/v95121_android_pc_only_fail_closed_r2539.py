"""R2539 Android fail-closed execution ownership.

Runs after v95120_jev_resilient_r2536_mobile.py.

Safety goals:
- Android is CONTROL + TELEMETRY only; it cannot originate a Binance/BrainHub order.
- PC BrainHub scheduler remains the sole entry executor.
- First launch after installing R2539 migrates fail-closed: local AUTO OFF + PC leader-auto OFF + LIVE DISARM verification.
- An unconfirmed OFF request is retried when PC connectivity returns.
- PC LIVE truth expires after 15 s; disconnected/stale state is UNKNOWN, never falsely shown as OFF.
- OTO OFF UI says "PC onayı bekleniyor" until the PC confirms both LIVE disarmed and leader-auto disabled.
- Does not close existing positions; it only prevents new entries and disarms new LIVE execution.
"""
from pathlib import Path
import re

MARKER="V95121_ANDROID_PC_ONLY_FAIL_CLOSED_R2539"
APP=Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA=APP/"app/src/main/java/com/futuresalarm/app"
MAIN=JAVA/"MainActivity.java"
CARD=JAVA/"AutoDecisionCard.java"
CLIENT=JAVA/"BrainHubClient.java"
AUTO=JAVA/"AutoTradeEngine.java"
TRUTH=JAVA/"V95113PcTruth.java"
ANALYSIS=JAVA/"AnalysisPackActivity.java"
BUILD=APP/"app/build.gradle"

for p in (MAIN,CARD,CLIENT,AUTO,TRUTH,ANALYSIS,BUILD):
    if not p.exists():
        raise SystemExit("v9.5.121 missing required file: "+str(p))

def fail(msg):
    raise SystemExit("v9.5.121 "+msg)

def method_bounds(src, signature):
    start=src.find(signature)
    if start<0:return None
    brace=src.find("{",start)
    if brace<0:return None
    depth=0; ins=False; inc=False; esc=False; lc=False; bc=False; i=brace
    while i<len(src):
        c=src[i]; n=src[i+1] if i+1<len(src) else ""
        if lc:
            if c=="\n":lc=False
        elif bc:
            if c=="*" and n=="/":bc=False;i+=1
        elif ins:
            if esc:esc=False
            elif c=="\\":esc=True
            elif c=='"':ins=False
        elif inc:
            if esc:esc=False
            elif c=="\\":esc=True
            elif c=="'":inc=False
        else:
            if c=="/" and n=="/":lc=True;i+=1
            elif c=="/" and n=="*":bc=True;i+=1
            elif c=='"':ins=True
            elif c=="'":inc=True
            elif c=="{":depth+=1
            elif c=="}":
                depth-=1
                if depth==0:return start,i+1
        i+=1
    return None

main=MAIN.read_text(encoding="utf-8")
card=CARD.read_text(encoding="utf-8")
client=CLIENT.read_text(encoding="utf-8")
auto=AUTO.read_text(encoding="utf-8")
truth=TRUTH.read_text(encoding="utf-8")
analysis=ANALYSIS.read_text(encoding="utf-8")
build=BUILD.read_text(encoding="utf-8")

if MARKER in main:
    fail("already applied; start a clean Codemagic build")
for need in ("V95120_JEV_RESILIENT_R2536_MOBILE","CLAUDE_V113_ANDROID_LIVE_TRUTH","V9579_PC_LIVE_AUTO"):
    if need not in (main+"\n"+auto):
        fail("requires prior mobile chain marker: "+need)

# ------------------------------------------------------------------ hard execution ownership
# Even if an old local signal fires, Android does not invoke runPc or the legacy PHONE executor.
b=method_bounds(auto,"    public static void onSignal(Context c,String symbol)")
if not b: fail("AutoTradeEngine.onSignal missing")
old_on=auto[b[0]:b[1]]
new_on=r'''    // V95121_ANDROID_PC_ONLY_FAIL_CLOSED_R2539
    // Phone signals are attention/UI context only. They never originate an order.
    // PC BrainHub leader-auto / fast-lane scheduler is the sole LIVE entry executor.
    public static void onSignal(Context c,String symbol){
        if(c==null)return;
        try{
            android.content.SharedPreferences p=c.getApplicationContext()
                .getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE);
            p.edit()
                .putString("v9576_executor_owner","PC")
                .putString("v9576_auto_last_status","ANDROID PC-ONLY • telefondan emir başlatılmaz • PC BrainHub tek executor")
                .apply();
        }catch(Throwable ignored){}
    }'''
auto=auto[:b[0]]+new_on+auto[b[1]:]

# Remove the historical direct-Binance PHONE runner body as a second independent barrier.
rb=method_bounds(auto,"    private static void run(Context c,String s)")
if not rb: fail("legacy AutoTradeEngine.run method missing")
new_run=r'''    // R2539: historical PHONE Binance executor permanently inert.
    private static void run(Context c,String s){
        if(c==null)return;
        try{
            c.getApplicationContext().getSharedPreferences(MonitorService.PREFS,Context.MODE_PRIVATE)
                .edit().putString("v9576_auto_last_status","ANDROID DIRECT EXECUTOR DISABLED • PC ONLY").apply();
        }catch(Throwable ignored){}
    }'''
auto=auto[:rb[0]]+new_run+auto[rb[1]:]

if "runPc(app,s)" in auto[auto.find("public static void onSignal"):auto.find("public static void onSignal")+1800]:
    fail("onSignal still reaches runPc")
if "IO.execute(()->run(app,s))" in auto:
    fail("legacy PHONE onSignal execution path still reachable")

# BrainHubClient itself must be a second independent boundary.
if "R2539_ANDROID_PC_ONLY_FAIL_CLOSED" not in client:
    fail("BrainHubClient source does not contain R2539 PC-only liveExecute boundary")
if 'post(c, "/live/execute", intent, true)' in client:
    fail("Android BrainHubClient still posts /live/execute")

# Disable every direct signed Android Binance mutation too. Read-only signed GETs
# may remain for balance/account display, but POST/PUT/DELETE cannot reach Binance.
hb=method_bounds(main,"    private String v9522Http(String method, String path, java.util.Map<String,String> params, boolean signed)")
if not hb:
    fail("MainActivity v9522Http signed transport missing")
hsrc=main[hb[0]:hb[1]]
brace=hsrc.find("{")
if brace<0:
    fail("v9522Http opening brace missing")
mutation_guard='''\n        // R2539_ANDROID_SIGNED_MUTATION_DISABLED_PC_ONLY\n        if(signed && !"GET".equalsIgnoreCase(method))\n            throw new Exception("ANDROID SIGNED MUTATION DISABLED • PC BrainHub only");'''
hsrc=hsrc[:brace+1]+mutation_guard+hsrc[brace+1:]
main=main[:hb[0]]+hsrc+main[hb[1]:]

# ------------------------------------------------------------------ fail-closed migration on first R2539 launch
oncreate="super.onCreate(savedInstanceState);"
if main.count(oncreate)!=1:
    fail("MainActivity onCreate anchor missing/ambiguous")
migration=r'''super.onCreate(savedInstanceState);
        // V95121_ANDROID_PC_ONLY_FAIL_CLOSED_R2539:
        // one-time migration after APK upgrade. Never inherit a stale PHONE/AUTO execution state.
        try{
            android.content.SharedPreferences v95121sp=getSharedPreferences(MonitorService.PREFS,MODE_PRIVATE);
            boolean v95121first=!v95121sp.getBoolean("v95121_pc_only_migration_done",false);
            v95121sp.edit()
                .putString("v9576_executor_owner","PC")
                .putBoolean("v9576_auto_enabled",false)
                .putBoolean("v95121_pc_only_migration_done",true)
                .apply();
            if(v95121first&&BrainHubClient.configured(this)){
                v95113StopAndVerify("R2539_FIRST_RUN_FAIL_CLOSED",null);
            }
        }catch(Throwable ignored){}'''
main=main.replace(oncreate,migration,1)

# Retry an explicitly requested OFF when Tailscale/PC connectivity comes back.
probe='''                V95113PcTruth.recordStatus(sp,st,System.currentTimeMillis()); // CLAUDE_V113_ANDROID_LIVE_TRUTH
                org.json.JSONObject la=st.optJSONObject("leaderAuto");'''
if probe not in main:
    fail("PC truth probe anchor missing")
probe_new='''                V95113PcTruth.recordStatus(sp,st,System.currentTimeMillis()); // CLAUDE_V113_ANDROID_LIVE_TRUTH
                // R2539: a failed/pending OFF is sticky. Connectivity restoration retries the stop.
                long v95121now=System.currentTimeMillis();
                if(V95113PcTruth.stopNeedsRetry(sp)
                        && !sp.getBoolean("v9576_auto_enabled",false)
                        && v95121now-sp.getLong("v95121_stop_retry_at",0L)>=30000L){
                    sp.edit().putLong("v95121_stop_retry_at",v95121now).apply();
                    runOnUiThread(()->v95113StopAndVerify("R2539_RETRY_PENDING_STOP",null));
                }
                org.json.JSONObject la=st.optJSONObject("leaderAuto");'''
main=main.replace(probe,probe_new,1)

# Do not claim OFF before PC confirmation.
old_toast='Toast.makeText(this,"Oto işlem ayarı kaydedildi • "+(en.isChecked()?"CANLI AÇIK":"KAPALI"),Toast.LENGTH_LONG).show();'
if old_toast not in main:
    fail("OTO settings toast anchor missing")
new_toast='Toast.makeText(this,v95113AutoOn?"OTO AÇMA AYARI KAYDEDİLDİ • LIVE yalnız PC onayıyla açılır":"KAPATILIYOR • PC LIVE + LEADER AUTO onayı bekleniyor",Toast.LENGTH_LONG).show();'
main=main.replace(old_toast,new_toast,1)

# ------------------------------------------------------------------ visible R2539 / PC R2538 truth
if "v9.5.114-JEV-RESILIENT-R2536" not in main:
    fail("R2536 identity anchor missing")
main=main.replace("v9.5.114-JEV-RESILIENT-R2536","v9.5.114-JEV-PC-ONLY-R2539",1)

old_status='            st.append("\\nR2536 JEV: R2535 otonom yönetim korunur • Vision TRIGGER/INVALIDATION ID eksikliği deterministik same-TF adaylardan yalnız şema onarımıyla tamamlanır • bilgi araştırması 9Router + OpenRouter free retry/failover kullanır • seçili açık kaynak repolar read-only mühendislik referansıdır ve JEV doğrulamadan kalıcı bilgi olmaz."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE V95119_JEV_AUTONOMOUS_R2535_MOBILE V95120_JEV_RESILIENT_R2536_MOBILE'
if old_status not in main:
    fail("R2536 status anchor missing")
new_status='            st.append("\\nR2539 ANDROID SAFETY: PC BrainHub R2538 JEV Live Mirror + R2537 complete context kullanır • Android CONTROL/TELEMETRY only • telefondan emir başlatma KAPALI • LIVE KAPAT yalnız PC armed=false + leaderAuto=false onayıyla tamamlanmış sayılır • bağlantı koparsa durum BİLİNMİYOR ve bekleyen stop bağlantı gelince yeniden denenir."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE V95119_JEV_AUTONOMOUS_R2535_MOBILE V95120_JEV_RESILIENT_R2536_MOBILE '+MARKER
main=main.replace(old_status,new_status,1)

old_card='        b.append("\\nR2536 RESILIENT JEV: R2535 autonomous management + lifetime memory korunur; Vision level-ID schema repair yalnız deterministik adaylardan yapılır; free araştırma retry/failover + JEV doğrulamalı curated OSS reference kullanır."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE V95119_JEV_AUTONOMOUS_R2535_MOBILE V95120_JEV_RESILIENT_R2536_MOBILE'
if old_card not in card:
    fail("R2536 card anchor missing")
new_card='        b.append("\\nR2539 PC-ONLY FAIL-CLOSED: PC R2538 karar/uygulama beynidir; Android emir başlatmaz. OTO KAPAT / ACİL DURDUR ancak PC LIVE kapalı + Leader Auto kapalı doğrulamasıyla başarılıdır; stale bağlantı KAPALI diye gösterilmez."); // V95117_JEV_CORTEX_SHADOW_R2533_MOBILE V95118_JEV_FULL_CORTEX_R2534_MOBILE V95119_JEV_AUTONOMOUS_R2535_MOBILE V95120_JEV_RESILIENT_R2536_MOBILE '+MARKER
card=card.replace(old_card,new_card,1)

old_client="R2.5.3.2 SOVEREIGN • R2536 RESILIENT VISION • VERIFIED OSS RESEARCH • LIFETIME MEMORY"
if old_client not in client:
    fail("BrainHubClient visible label anchor missing")
client=client.replace(old_client,"R2.5.3.2 SOVEREIGN • PC R2538 LIVE MIRROR • ANDROID PC-ONLY FAIL-CLOSED",1)
client+="\n// "+MARKER+"\n"

if "JEV PRO TRADER/SCALPER • R2536 RESILIENT VISION + VERIFIED OSS RESEARCH" in analysis:
    analysis=analysis.replace(
        "JEV PRO TRADER/SCALPER • R2536 RESILIENT VISION + VERIFIED OSS RESEARCH",
        "JEV PRO TRADER/SCALPER • PC R2538 LIVE MIRROR • ANDROID PC-ONLY",
        1
    )
analysis+="\n// "+MARKER+"\n"

# ------------------------------------------------------------------ version
if len(re.findall(r"versionCode\s+\d+",build))!=1:fail("versionCode anchor missing/ambiguous")
if len(re.findall(r"versionName\s+[\"'][^\"']+[\"']",build))!=1:fail("versionName anchor missing/ambiguous")
build=re.sub(r"versionCode\s+\d+","versionCode 26092501",build,count=1)
build=re.sub(r"versionName\s+[\"'][^\"']+[\"']","versionName '9.5.114-r2539'",build,count=1)

MAIN.write_text(main,encoding="utf-8")
CARD.write_text(card,encoding="utf-8")
CLIENT.write_text(client,encoding="utf-8")
AUTO.write_text(auto,encoding="utf-8")
ANALYSIS.write_text(analysis,encoding="utf-8")
BUILD.write_text(build,encoding="utf-8")

checks={
    "marker":MARKER in MAIN.read_text(encoding="utf-8"),
    "identity":"v9.5.114-JEV-PC-ONLY-R2539" in MAIN.read_text(encoding="utf-8"),
    "first-run fail closed":"R2539_FIRST_RUN_FAIL_CLOSED" in MAIN.read_text(encoding="utf-8"),
    "sticky stop retry":"R2539_RETRY_PENDING_STOP" in MAIN.read_text(encoding="utf-8") and "stopNeedsRetry" in MAIN.read_text(encoding="utf-8"),
    "no premature off toast":"KAPATILIYOR • PC LIVE + LEADER AUTO onayı bekleniyor" in MAIN.read_text(encoding="utf-8"),
    "client order boundary":"ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in CLIENT.read_text(encoding="utf-8") and 'post(c, "/live/execute", intent, true)' not in CLIENT.read_text(encoding="utf-8"),
    "auto onSignal pc-only":"telefondan emir başlatılmaz" in AUTO.read_text(encoding="utf-8") and "runPc(app,s)" not in AUTO.read_text(encoding="utf-8")[AUTO.read_text(encoding="utf-8").find("public static void onSignal"):AUTO.read_text(encoding="utf-8").find("public static void onSignal")+1800],
    "legacy direct runner inert":"historical PHONE Binance executor permanently inert" in AUTO.read_text(encoding="utf-8") and "ANDROID DIRECT EXECUTOR DISABLED • PC ONLY" in AUTO.read_text(encoding="utf-8"),
    "signed Android mutations blocked":"R2539_ANDROID_SIGNED_MUTATION_DISABLED_PC_ONLY" in MAIN.read_text(encoding="utf-8") and 'if(signed && !"GET".equalsIgnoreCase(method))' in MAIN.read_text(encoding="utf-8"),
    "truth 15s":"FRESH_MS = 15000L" in TRUTH.read_text(encoding="utf-8"),
    "card":"R2539 PC-ONLY FAIL-CLOSED" in CARD.read_text(encoding="utf-8"),
    "client label":"PC R2538 LIVE MIRROR • ANDROID PC-ONLY FAIL-CLOSED" in CLIENT.read_text(encoding="utf-8"),
    "build":"versionCode 26092501" in BUILD.read_text(encoding="utf-8") and "versionName '9.5.114-r2539'" in BUILD.read_text(encoding="utf-8"),
}
bad=[k for k,v in checks.items() if not v]
for k,v in checks.items():print(("OK   " if v else "FAIL ")+k)
if bad:fail("final checks failed: "+", ".join(bad))

print("V95121_ANDROID_PC_ONLY_FAIL_CLOSED_R2539_OK")
print("Android identity: v9.5.114-JEV-PC-ONLY-R2539 / versionCode 26092501 / versionName 9.5.114-r2539")
print("Android execution: CONTROL_TELEMETRY_ONLY; order initiation disabled at AutoTradeEngine + BrainHubClient boundaries")
print("LIVE OFF: PC confirmation required; stale state becomes UNKNOWN; failed stop is retried when connectivity returns")
print("First R2539 launch: local AUTO OFF + PC leader-auto OFF + LIVE DISARM verification")
