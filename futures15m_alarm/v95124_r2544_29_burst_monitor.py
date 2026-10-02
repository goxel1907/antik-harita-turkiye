"""R2544.29 Android BURST monitor post-patch.
Runs after v95123. Read-only BURST telemetry; phone never originates BURST/normal orders.
"""
from pathlib import Path
import re

MARKER="V95124_ANDROID_R2544_29_BURST_MONITOR"
APP=Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA=APP/'app/src/main/java/com/futuresalarm/app'
MAIN=JAVA/'MainActivity.java'; CARD=JAVA/'AutoDecisionCard.java'; CLIENT=JAVA/'BrainHubClient.java'; BUILD=APP/'app/build.gradle'
for p in (MAIN,CARD,CLIENT,BUILD):
    if not p.exists(): raise SystemExit('R2544.29 missing required file: '+str(p))
main=MAIN.read_text(encoding='utf-8'); card=CARD.read_text(encoding='utf-8'); client=CLIENT.read_text(encoding='utf-8'); build=BUILD.read_text(encoding='utf-8')

# Preserve PC-only execution boundary.
if 'ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY' not in client: raise SystemExit('R2544.29 PC-only boundary missing')
if 'post(c, "/live/execute", intent, true)' in client: raise SystemExit('R2544.29 forbidden Android live execute present')

# Fetch /live/burst with each normal status refresh and cache it for UI.
anchor='        JSONObject status=get(c, "/live/status");\n'
if anchor not in client: raise SystemExit('R2544.29 liveStatus anchor missing')
client=client.replace(anchor,anchor+'        JSONObject burst=new JSONObject();\n        try { burst=get(c, "/live/burst"); } catch(Throwable ignored) {}\n',1)
anchor2='            .putString("v9599_learning",status.optJSONObject("learning")==null?"{}":status.optJSONObject("learning").toString()).apply();'
if anchor2 not in client: raise SystemExit('R2544.29 prefs anchor missing')
client=client.replace(anchor2,'            .putString("v9599_learning",status.optJSONObject("learning")==null?"{}":status.optJSONObject("learning").toString())\n            .putString("r2544_29_burst",burst.toString()).apply();',1)
account_anchor='    public static JSONObject liveAccount(Context c) throws Exception {'
if account_anchor not in client: raise SystemExit('R2544.29 liveAccount anchor missing')
client=client.replace(account_anchor,'    // R2544.29 read-only BURST telemetry. No order endpoint exists on Android.\n    public static JSONObject liveBurst(Context c) throws Exception { check(c); return get(c, "/live/burst"); }\n'+account_anchor,1)

# Visible monitoring card: armed max 4, active BURST, pause exception state.
card_anchor='        b.append("\\nSon bağlantı kontrolü: ").append(new java.text.SimpleDateFormat("HH:mm:ss",java.util.Locale.getDefault()).format(new java.util.Date(ts)));\n'
if card_anchor not in card: raise SystemExit('R2544.29 card anchor missing')
burst_ui='''        JSONObject burstState=json(sp.getString("r2544_29_burst","{}"));
        org.json.JSONArray burstArmed=burstState.optJSONArray("armed"), burstActive=burstState.optJSONArray("active");
        b.append("\\n\\n⚡ BURST SCALP • JEV ÖN-YETKİLİ • TELEFON SALT-OKUNUR");
        b.append("\\nARMED: ").append(burstArmed==null?0:burstArmed.length()).append("/4 • aktif: ").append(burstActive==null?0:burstActive.length()).append("/1");
        if(burstArmed!=null)for(int bi=0;bi<Math.min(4,burstArmed.length());bi++){ JSONObject x=burstArmed.optJSONObject(bi);if(x!=null)b.append("\\n• ").append(x.optString("symbol","?")).append(" ").append(x.optString("side","?")).append(" • JEV koşullu izin"); }
        if(burstActive!=null&&burstActive.length()>0){ JSONObject x=burstActive.optJSONObject(0);if(x!=null)b.append("\\nAKTİF BURST: ").append(x.optString("symbol","?")).append(" ").append(x.optString("side","?")).append(" • ").append(x.optInt("leverage",0)).append("x"); }
        JSONObject burstPause=burstState.optJSONObject("pause");
        if(burstPause!=null&&burstPause.optBoolean("active",false))b.append("\\n30 dk zarar molası AKTİF • güçlü BURST istisnası: ").append(burstPause.optBoolean("exceptionAvailable",false)?"1 adet uygun":"kullanıldı/uygun değil");
        b.append("\\nBURST emirleri yalnız PC/JEV tarafından yürütülür.");
'''
card=card.replace(card_anchor,card_anchor+burst_ui,1)

# Installable identity only; execution semantics remain PC-side.
if 'v9.5.116-JEV-PC-ONLY-R2543' in main:
    main=main.replace('v9.5.116-JEV-PC-ONLY-R2543','v9.5.117-JEV-PC-ONLY-R2544.29-BURST',1)
main += '\n// '+MARKER+'\n// BURST monitor is read-only; /live/burst GET only.\n'
card += '\n// '+MARKER+'\n'
client += '\n// '+MARKER+'\n'
build=re.sub(r'versionCode\s+\d+','versionCode 26100229',build,count=1)
build=re.sub(r'versionName\s+["\'][^"\']+["\']',"versionName '9.5.117-r2544.29-burst'",build,count=1)
MAIN.write_text(main,encoding='utf-8');CARD.write_text(card,encoding='utf-8');CLIENT.write_text(client,encoding='utf-8');BUILD.write_text(build,encoding='utf-8')

# Final safety checks.
client=CLIENT.read_text(encoding='utf-8'); card=CARD.read_text(encoding='utf-8'); build=BUILD.read_text(encoding='utf-8')
checks={
 'marker':MARKER in MAIN.read_text(encoding='utf-8'),
 'version':"versionName '9.5.117-r2544.29-burst'" in build and 'versionCode 26100229' in build,
 'burst GET':'get(c, "/live/burst")' in client and 'liveBurst(Context c)' in client,
 'burst UI':'BURST SCALP' in card and 'ARMED:' in card,
 'pc-only':'ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY' in client,
 'no burst post':'post(c, "/live/burst"' not in client,
 'no live execute':'post(c, "/live/execute", intent, true)' not in client,
}
bad=[k for k,v in checks.items() if not v]
if bad: raise SystemExit('R2544.29 Android contract failed: '+', '.join(bad))
print(MARKER+'_OK')
