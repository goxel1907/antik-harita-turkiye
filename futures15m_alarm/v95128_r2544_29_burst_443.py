"""V95128_R2544_29_BURST_443

Runs after V95127 on the current public-build branch.
Purpose:
  * keep the latest v9.5.119 desk/pro UI work,
  * bump install identity to v9.5.120,
  * make BrainHub URL fixed in the APK:
      https://8z9rvd.tail8c30c4.ts.net
    (Tailscale Serve HTTPS 443 -> PC localhost:8787),
  * add GET-only /live/burst telemetry to the existing PC-led UI,
  * preserve Android PC-only/fail-closed order authority.

The phone never originates a normal or BURST order.
"""
from pathlib import Path
import re

MARKER = "V95128_R2544_29_BURST_443"
FIXED = "https://8z9rvd.tail8c30c4.ts.net"
APP = Path("/tmp/futures15m-build/Futures15mAlarm")
JAVA = APP / "app/src/main/java/com/futuresalarm/app"
MAIN = JAVA / "MainActivity.java"
CLIENT = JAVA / "BrainHubClient.java"
TRUTH = JAVA / "V95113PcTruth.java"
BUILD = APP / "app/build.gradle"

for p in (MAIN, CLIENT, TRUTH, BUILD):
    if not p.exists():
        raise SystemExit("V95128 missing required file: " + str(p))

main = MAIN.read_text(encoding="utf-8")
client = CLIENT.read_text(encoding="utf-8")
truth = TRUTH.read_text(encoding="utf-8")
build = BUILD.read_text(encoding="utf-8")

if "V95127_R2544_4_DESK_STATS" not in main:
    raise SystemExit("V95128 requires V95127 first")
if "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" not in client:
    raise SystemExit("V95128 PC-only boundary missing")
if 'post(c, "/live/execute", intent, true)' in client:
    raise SystemExit("V95128 forbidden Android live execute present")

# 1) Fixed tailnet-only HTTPS endpoint. Ignore any stale :8787 preference.
alias_anchor = '    private static final String ALIAS = "futures_alarm_brainhub_token_v1";\n'
if alias_anchor not in client:
    raise SystemExit("V95128 ALIAS anchor missing")
client = client.replace(
    alias_anchor,
    alias_anchor +
    '    // V95128: fixed tailnet-only Tailscale Serve endpoint; user does not enter a URL.\n'
    '    private static final String FIXED_ENDPOINT = "' + FIXED + '";\n',
    1,
)

old_save = '''    public static void save(Context c, String endpoint, String newToken) throws Exception {
        endpoint = endpoint == null ? "" : endpoint.trim().replaceAll("/+$", "");
        if (!endpoint.isEmpty()) validate(endpoint);
        SharedPreferences.Editor ed = prefs(c).edit().putString("endpoint", endpoint);
'''
new_save = '''    public static void save(Context c, String endpoint, String newToken) throws Exception {
        // Endpoint is fixed in the APK. Keep the encrypted token behavior unchanged.
        validate(FIXED_ENDPOINT);
        SharedPreferences.Editor ed = prefs(c).edit().putString("endpoint", FIXED_ENDPOINT);
'''
if old_save not in client:
    raise SystemExit("V95128 save() endpoint anchor missing")
client = client.replace(old_save, new_save, 1)

old_config = '''    public static boolean configured(Context c) {
        String e = prefs(c).getString("endpoint", "");
        return e != null && !e.isEmpty() && prefs(c).contains("token");
    }
'''
new_config = '''    public static boolean configured(Context c) {
        return prefs(c).contains("token");
    }
'''
if old_config not in client:
    raise SystemExit("V95128 configured() anchor missing")
client = client.replace(old_config, new_config, 1)

old_base = '        String base = prefs(c).getString("endpoint", "");\n'
if old_base not in client:
    raise SystemExit("V95128 request base anchor missing")
client = client.replace(old_base, '        String base = FIXED_ENDPOINT;\n', 1)

old_endpoint = '    public static String endpoint(Context c) { return prefs(c).getString("endpoint", ""); }\n'
if old_endpoint not in client:
    raise SystemExit("V95128 endpoint() anchor missing")
client = client.replace(old_endpoint, '    public static String endpoint(Context c) { return FIXED_ENDPOINT; }\n', 1)

# 2) GET-only BURST telemetry piggybacks on the existing status refresh.
status_anchor = '        JSONObject status=get(c, "/live/status");\n'
if status_anchor not in client:
    raise SystemExit("V95128 liveStatus anchor missing")
client = client.replace(
    status_anchor,
    status_anchor +
    '        JSONObject burst=new JSONObject();\n'
    '        try { burst=get(c, "/live/burst"); } catch(Throwable ignored) {}\n',
    1,
)

prefs_anchor = '            .putString("v9599_learning",status.optJSONObject("learning")==null?"{}":status.optJSONObject("learning").toString()).apply();'
if prefs_anchor not in client:
    raise SystemExit("V95128 learning prefs anchor missing")
client = client.replace(
    prefs_anchor,
    '            .putString("v9599_learning",status.optJSONObject("learning")==null?"{}":status.optJSONObject("learning").toString())\n'
    '            .putString("r2544_29_burst",burst.toString()).apply();',
    1,
)

account_anchor = '    public static JSONObject liveAccount(Context c) throws Exception {'
if account_anchor not in client:
    raise SystemExit("V95128 liveAccount anchor missing")
client = client.replace(
    account_anchor,
    '    // V95128 read-only BURST telemetry. Android has no BURST execution endpoint.\n'
    '    public static JSONObject liveBurst(Context c) throws Exception { check(c); return get(c, "/live/burst"); }\n'
    + account_anchor,
    1,
)

# 3) Append the BURST monitor to the latest desk-stats card text.
truth_anchor = '''        return b.toString();
    }

    static String v95127ExitTr'''
if truth_anchor not in truth:
    raise SystemExit("V95128 deskStatsText anchor missing")
truth_burst = '''        JSONObject v95128Burst = json(sp == null ? "" : sp.getString("r2544_29_burst", "{}"));
        JSONArray v95128Armed = v95128Burst.optJSONArray("armed"), v95128Active = v95128Burst.optJSONArray("active");
        b.append("\\n\\n⚡ BURST SCALP • JEV ÖN-YETKİLİ • TELEFON SALT-OKUNUR");
        b.append("\\nARMED: ").append(v95128Armed == null ? 0 : v95128Armed.length()).append("/4 • aktif: ")
         .append(v95128Active == null ? 0 : v95128Active.length()).append("/1");
        if (v95128Armed != null) for (int i = 0; i < Math.min(4, v95128Armed.length()); i++) {
            JSONObject x = v95128Armed.optJSONObject(i);
            if (x != null) b.append("\\n• ").append(str(x, "symbol")).append(" ").append(str(x, "side")).append(" • JEV koşullu izin");
        }
        if (v95128Active != null && v95128Active.length() > 0) {
            JSONObject x = v95128Active.optJSONObject(0);
            if (x != null) b.append("\\nAKTİF BURST: ").append(str(x, "symbol")).append(" ").append(str(x, "side"))
                .append(" • ").append(x.optInt("leverage", 0)).append("x");
        }
        JSONObject v95128Pause = v95128Burst.optJSONObject("pause");
        if (v95128Pause != null && v95128Pause.optBoolean("active", false))
            b.append("\\n30 dk zarar molası AKTİF • güçlü BURST istisnası: ")
             .append(v95128Pause.optBoolean("exceptionAvailable", false) ? "1 adet uygun" : "kullanıldı/uygun değil");
        b.append("\\nBURST emirleri yalnız PC/JEV tarafından yürütülür.");
        return b.toString();
    }

    static String v95127ExitTr'''
truth = truth.replace(truth_anchor, truth_burst, 1)

# 4) Installable identity. Newer than the existing v9.5.119 branch.
build = re.sub(r"versionCode\s+\d+", "versionCode 26100331", build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.120-r2544.29-burst-443'", build, count=1)

main += "\n// " + MARKER + "\n"
truth += "\n// " + MARKER + "\n"
client += "\n// " + MARKER + "\n"

MAIN.write_text(main, encoding="utf-8")
CLIENT.write_text(client, encoding="utf-8")
TRUTH.write_text(truth, encoding="utf-8")
BUILD.write_text(build, encoding="utf-8")

# Final fail-closed proof.
client2 = CLIENT.read_text(encoding="utf-8")
truth2 = TRUTH.read_text(encoding="utf-8")
build2 = BUILD.read_text(encoding="utf-8")
checks = {
    "fixed443": FIXED in client2 and ":8787" not in client2,
    "burst_get": 'get(c, "/live/burst")' in client2 and "liveBurst(Context c)" in client2,
    "burst_ui": "BURST SCALP" in truth2 and "ARMED:" in truth2,
    "pc_only": "ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY" in client2,
    "no_burst_post": 'post(c, "/live/burst"' not in client2,
    "no_live_execute": 'post(c, "/live/execute", intent, true)' not in client2,
    "version": "versionCode 26100331" in build2 and "versionName '9.5.120-r2544.29-burst-443'" in build2,
}
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit("V95128 contract failed: " + ", ".join(bad))
print(MARKER + "_OK")
