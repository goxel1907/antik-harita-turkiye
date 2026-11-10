"""R2544.142 (user 10.11: "kartta hangi işlemi aktif etmek istiyorsam o aktif çalışmalı: İlk 3 tek, İlk 3 + ZİRVE-5, herhangi biri
veya hepsi; APK'da da böyle olmalı - 5 dk scalp, 15 dk ana işlem, vur-kaç, İlk 3 Avcısı, ZİRVE-5").
Source-generation patch after V95141. The phone's lanes card had Normal sistem, İlk 3 and ZİRVE-5; the normal system's three
sub-lanes (5 dk scalp, 15 dk ana işlem, vur-kaç) could only be chosen in Office. Now each has its own button, with the same rule as
the Office card: turning a sub-lane ON while the normal system is off turns it on and runs ONLY that sub-lane; turning the last
sub-lane OFF turns the normal system off. ON in LIVE: the user's GERÇEK PARA dialog sends confirm LIVE. OFF is immediate.
Android stays a PC control/telemetry client: it never initiates an order (Codemagic check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95142_R2544_142_HATLAR'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95142 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95141_R2544_135_KALDIRAC' not in main:
    raise SystemExit('V95142 requires V95141')
if MARKER in main:
    raise SystemExit('V95142 already applied')

# ------------------------------------------------------------------ client: several lane keys in one switch request
client = replace(client,
    '    public static JSONObject selectLane(Context c, String key, boolean on, boolean liveConfirm) throws Exception {\n',
    '    // V95142_R2544_142_HATLAR: a sub-lane switch may carry the normal system and the other sub-lanes too (one PC call).\n'
    '    // Never an order; confirm LIVE only after the user\'s GERÇEK PARA dialog.\n'
    '    public static JSONObject selectLanesBody(Context c, JSONObject body, boolean liveConfirm) throws Exception {\n'
    '        check(c);\n'
    '        if (liveConfirm) body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "/live/lanes", body, true);\n'
    '    }\n'
    '    public static JSONObject selectLane(Context c, String key, boolean on, boolean liveConfirm) throws Exception {\n')

# ------------------------------------------------------------------ lanes card: three sub-lane buttons
main = replace(main,
    '        String z5Label = "ZİRVE-5: " + (z5On ? "AÇIK" : "KAPALI");\n',
    '        String z5Label = "ZİRVE-5: " + (z5On ? "AÇIK" : "KAPALI");\n'
    '        org.json.JSONObject v95142N = lanes == null ? null : lanes.optJSONObject("normal"); // V95142_R2544_142_HATLAR\n'
    '        boolean v95142NOn = v95142N != null && v95142N.optBoolean("selected", false);\n'
    '        org.json.JSONObject v95142Sub = v95142N == null ? null : v95142N.optJSONObject("sub");\n'
    '        String s5Label = "5 dk scalp: " + (v95142SubOn(v95142NOn, v95142Sub, "scalp5m") ? "AÇIK" : "KAPALI");\n'
    '        String s15Label = "15 dk ana: " + (v95142SubOn(v95142NOn, v95142Sub, "trade15m") ? "AÇIK" : "KAPALI");\n'
    '        String sbLabel = "Vur-kaç: " + (v95142SubOn(v95142NOn, v95142Sub, "burst") ? "AÇIK" : "KAPALI");\n')
main = replace(main,
    '                if (bz instanceof Button) ((Button) bz).setText(z5Label);\n',
    '                if (bz instanceof Button) ((Button) bz).setText(z5Label);\n'
    '                android.view.View b5 = v.findViewWithTag("v95142_btn_scalp5m"); // V95142_R2544_142_HATLAR\n'
    '                if (b5 instanceof Button) ((Button) b5).setText(s5Label);\n'
    '                android.view.View b15 = v.findViewWithTag("v95142_btn_trade15m");\n'
    '                if (b15 instanceof Button) ((Button) b15).setText(s15Label);\n'
    '                android.view.View bb = v.findViewWithTag("v95142_btn_burst");\n'
    '                if (bb instanceof Button) ((Button) bb).setText(sbLabel);\n')
main = replace(main,
    '        card.addView(bZ5, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n',
    '        card.addView(bZ5, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        android.widget.LinearLayout rowSub = new android.widget.LinearLayout(this); // V95142_R2544_142_HATLAR\n'
    '        rowSub.setOrientation(android.widget.LinearLayout.HORIZONTAL);\n'
    '        Button bS5 = button(s5Label, android.graphics.Color.rgb(30, 64, 95));\n'
    '        bS5.setTag("v95142_btn_scalp5m");\n'
    '        bS5.setOnClickListener(v -> v95142SubLane("scalp5m", "5 dk scalp"));\n'
    '        Button bS15 = button(s15Label, android.graphics.Color.rgb(30, 64, 95));\n'
    '        bS15.setTag("v95142_btn_trade15m");\n'
    '        bS15.setOnClickListener(v -> v95142SubLane("trade15m", "15 dk ana işlem"));\n'
    '        Button bSb = button(sbLabel, android.graphics.Color.rgb(30, 64, 95));\n'
    '        bSb.setTag("v95142_btn_burst");\n'
    '        bSb.setOnClickListener(v -> v95142SubLane("burst", "Vur-kaç"));\n'
    '        android.widget.LinearLayout.LayoutParams t3p = new android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f);\n'
    '        t3p.setMargins(dp(2), dp(2), dp(2), dp(2));\n'
    '        rowSub.addView(bS5, t3p);\n'
    '        rowSub.addView(bS15, new android.widget.LinearLayout.LayoutParams(t3p));\n'
    '        rowSub.addView(bSb, new android.widget.LinearLayout.LayoutParams(t3p));\n'
    '        card.addView(rowSub, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n')

methods = r'''    // V95142_R2544_142_HATLAR: a sub-lane works only with the normal system on (the PC gate); shown AÇIK only then
    private static boolean v95142SubOn(boolean normalOn, org.json.JSONObject sub, String key) {
        return normalOn && sub != null && sub.optJSONObject(key) != null && sub.optJSONObject(key).optBoolean("selected", false);
    }
    // ON with the normal system off: the normal system turns on and ONLY this sub-lane runs. The last sub-lane OFF: the normal system
    // turns off. LIVE ON: the dialog says GERÇEK PARA and sends confirm LIVE. OFF is immediate; open lots keep their stop / target.
    private void v95142SubLane(final String key, final String label) {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        final org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        final org.json.JSONObject n = lanes == null ? null : lanes.optJSONObject("normal");
        if (n == null || n.optJSONObject("sub") == null) { Toast.makeText(this, "PC alt hat bilgisi henüz yok (PC R2544.60 gerekir).", Toast.LENGTH_LONG).show(); return; }
        final boolean nOn = n.optBoolean("selected", false);
        final org.json.JSONObject sub = n.optJSONObject("sub");
        final boolean on = v95142SubOn(nOn, sub, key);
        final boolean live = "LIVE".equals(lanes.optString("mode", ""));
        final String[] keys = {"scalp5m", "trade15m", "burst"};
        boolean others = false;
        for (String k : keys) if (!k.equals(key) && v95142SubOn(nOn, sub, k)) others = true;
        final boolean othersOn = others;
        String msg = on ? (label + " kapatılsın mı?\n\nYeni giriş durur; açık işlemler kendi stop / hedefiyle yönetilmeye devam eder."
                            + (othersOn ? "" : "\n\nNormal sistemin başka açık alt hattı kalmadığı için Normal sistem de kapanır."))
                        : (label + " açılsın mı?\n\n" + (nOn ? "" : "Normal sistem kapalı: açılır ve yalnız " + label + " çalışır.\n\n")
                            + (live ? "PC CANLI modda: GERÇEK PARA ile işlem açar." : "PC TEST modunda (sanal hesap)."));
        new AlertDialog.Builder(this).setTitle(label).setMessage(msg)
            .setPositiveButton(on ? "KAPAT" : (live ? "AÇ — GERÇEK PARA" : "AÇ"), (d, w) -> v95132Io.execute(() -> {
                String res;
                try {
                    org.json.JSONObject body = new org.json.JSONObject();
                    body.put(key, !on);
                    if (!on && !nOn) { body.put("normal", true); for (String k : keys) if (!k.equals(key)) body.put(k, false); }
                    if (on && !othersOn) body.put("normal", false);
                    org.json.JSONObject out = BrainHubClient.selectLanesBody(this, body, live && !on);
                    res = out.optBoolean("ok", false) ? (label + (on ? " kapatıldı" : " açıldı")) : ("Yapılmadı: " + V95113PcTruth.reasons(out));
                } catch (Throwable e) { res = "PC'ye ulaşılamadı: " + V95113PcTruth.err(e); }
                v95132Done(sp, res);
            }))
            .setNegativeButton("Vazgeç", null).show();
    }

    private void v95132GoLive() {
'''
main = replace(main, '    private void v95132GoLive() {\n', methods)

build = replace(build, 'versionCode 26110901', 'versionCode 26111001')
build = replace(build, "versionName '9.5.133-r2544.135-kaldirac'", "versionName '9.5.134-r2544.142-hatlar'")

MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
