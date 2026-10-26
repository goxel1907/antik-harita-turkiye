"""R2544.89 (user 27.10: "istediğim zaman tek tık ile canlıya geçebilmeliyim bu modeller ile; ayrıca apk'da bu şekilde güncellenmeli").
Source-generation patch after V95136.
  - lanes card: "Kurul: İlk 3" / "Kurul: ZİRVE-5" switch the decision owner to the free-model committee (PC POST /live/top3 or
    /live/zirve5 {committeeMode}); in LIVE the dialog says GERÇEK PARA and sends the PC's LIVE confirmation.
  - "🤝 Kurulla CANLI'ya geç": gives both strategies to the committee, then opens the phone's normal "CANLI'YA GEÇ — GERÇEK
    PARA" dialog (the final press stays with the user).
  - status: committee members and health, decision owner per strategy, exam progress, closed-trade comparison (committee said
    GİR / GİRME); per open lot: the committee's entry decision and the desk's last decision (YETKİLİ / gölge).
Android stays a PC control/telemetry client: a switch is not an order; it never initiates an order (Codemagic check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95137_R2544_89_KURUL'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95137 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95136_R2544_78_SIZE' not in main:
    raise SystemExit('V95137 requires V95136')
if MARKER in main:
    raise SystemExit('V95137 already applied')

# ------------------------------------------------------------------ client: keep the committee summary; the switch
client = replace(client,
    '            .putString("r2544_78_account",status.optJSONObject("account")==null?"{}":status.optJSONObject("account").toString()) // V95136_R2544_78_SIZE\n',
    '            .putString("r2544_78_account",status.optJSONObject("account")==null?"{}":status.optJSONObject("account").toString()) // V95136_R2544_78_SIZE\n'
    '            .putString("r2544_89_cm",status.optJSONObject("committee")==null?"{}":status.optJSONObject("committee").toString()) // V95137_R2544_89_KURUL\n')
client = replace(client,
    '    public static JSONObject selectLane(Context c, String key, boolean on, boolean liveConfirm) throws Exception {\n',
    '    // V95137_R2544_89_KURUL: decision owner of İlk 3 ("top3") or ZİRVE-5 ("zirve5") = the free-model committee (on) or the rule\n'
    '    // (off). A setting, never an order; in LIVE the PC needs confirm LIVE, sent only after the user\'s GERÇEK PARA dialog.\n'
    '    public static JSONObject setCommittee(Context c, String lane, boolean on, boolean liveConfirm) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put("committeeMode", on);\n'
    '        if (liveConfirm) body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "zirve5".equals(lane) ? "/live/zirve5" : "/live/top3", body, true);\n'
    '    }\n'
    '    public static JSONObject selectLane(Context c, String key, boolean on, boolean liveConfirm) throws Exception {\n')

# ------------------------------------------------------------------ lanes card: two committee switches + Kurulla CANLI
main = replace(main,
    '        card.addView(rowSize, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n',
    '        card.addView(rowSize, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        android.widget.LinearLayout rowCm = new android.widget.LinearLayout(this); // V95137_R2544_89_KURUL\n'
    '        rowCm.setOrientation(android.widget.LinearLayout.HORIZONTAL);\n'
    '        boolean cmT3 = V95113PcTruth.v95137Cm(sp, false), cmZ5 = V95113PcTruth.v95137Cm(sp, true);\n'
    '        Button bCmT3 = button("Kurul İlk 3: " + (cmT3 ? "AÇIK" : "KAPALI"), android.graphics.Color.rgb(64, 45, 98));\n'
    '        bCmT3.setTag("v95137_btn_cm_t3");\n'
    '        bCmT3.setOnClickListener(v -> v95137CommitteeDialog("top3"));\n'
    '        Button bCmZ5 = button("Kurul ZİRVE-5: " + (cmZ5 ? "AÇIK" : "KAPALI"), android.graphics.Color.rgb(64, 45, 98));\n'
    '        bCmZ5.setTag("v95137_btn_cm_z5");\n'
    '        bCmZ5.setOnClickListener(v -> v95137CommitteeDialog("zirve5"));\n'
    '        rowCm.addView(bCmT3, new android.widget.LinearLayout.LayoutParams(hs));\n'
    '        rowCm.addView(bCmZ5, new android.widget.LinearLayout.LayoutParams(hs));\n'
    '        card.addView(rowCm, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        Button bCmLive = button("🤝 Kurulla CANLI’ya geç", android.graphics.Color.rgb(127, 29, 29));\n'
    '        bCmLive.setTag("v95137_btn_cm_live");\n'
    '        bCmLive.setOnClickListener(v -> v95137CmLive());\n'
    '        card.addView(bCmLive, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n')

main = replace(main,
    '    private void v95132GoLive() {\n',
    r'''    // V95137_R2544_89_KURUL: decision owner switch (rule <-> committee) for one strategy; LIVE = GERÇEK PARA confirmation
    private static final String V95137_WARN = "Kurul: ücretsiz modeller (Gemini, Claude, DeepSeek, GLM, MiniMax) koltuklarıyla birlikte karar verir. "
        + "Girişte kurul GİR demezse işlem açılmaz (yalnız veto). Açık pozisyonda kurul yarısını kapatabilir, stopu yalnız kâra doğru yaklaştırabilir, çıkabilir. "
        + "Modeller çalışmazsa kural devam eder. Kurul henüz ölçülmedi (sınav sürüyor).";
    private void v95137CommitteeDialog(final String lane) {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        final boolean z5 = "zirve5".equals(lane);
        final String name = z5 ? "ZİRVE-5" : "İlk 3 Avcısı";
        final boolean on = V95113PcTruth.v95137Cm(sp, z5);
        org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        final boolean live = lanes != null && "LIVE".equals(lanes.optString("mode", ""));
        new AlertDialog.Builder(this).setTitle(name + " — karar sahibi " + (on ? "KURAL’a dönsün mü?" : "KURUL olsun mu?"))
            .setMessage(on ? "Kurul kapatılır; karar kurala döner (kurul gölgede kayıt tutmaya devam eder)."
                           : (V95137_WARN + (live ? "\n\n⚠ PC CANLI modda: GERÇEK PARA." : "\n\nPC TEST modunda (sanal hesap).")))
            .setPositiveButton(on ? "KAPAT" : (live ? "AÇ — GERÇEK PARA" : "AÇ"), (d, w) -> v95132Io.execute(() -> {
                String res;
                try {
                    org.json.JSONObject out = BrainHubClient.setCommittee(this, lane, !on, live && !on);
                    res = out.optBoolean("ok", false) ? (name + ": karar sahibi " + (on ? "KURAL" : "KURUL")) : ("Yapılmadı: " + V95113PcTruth.reasons(out));
                } catch (Throwable e) { res = "PC'ye ulaşılamadı: " + V95113PcTruth.err(e); }
                v95132Done(sp, res);
            }))
            .setNegativeButton("Vazgeç", null).show();
    }
    // one tap: both strategies to the committee, then the phone's normal CANLI'YA GEÇ dialog (the final press stays with the user)
    private void v95137CmLive() {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        final boolean live = lanes != null && "LIVE".equals(lanes.optString("mode", ""));
        new AlertDialog.Builder(this).setTitle("🤝 KURULLA CANLI’YA GEÇ")
            .setMessage("1) İlk 3 ve ZİRVE-5’in karar sahibi KURUL olur.\n2) Ardından “CANLI’YA GEÇ — GERÇEK PARA” onayı açılır; son onay sende.\n\n" + V95137_WARN)
            .setPositiveButton("DEVAM", (d, w) -> v95132Io.execute(() -> {
                String res = null;
                try {
                    org.json.JSONObject a = BrainHubClient.setCommittee(this, "top3", true, live);
                    org.json.JSONObject b = BrainHubClient.setCommittee(this, "zirve5", true, live);
                    if (!a.optBoolean("ok", false) || !b.optBoolean("ok", false)) res = "Kurul açılamadı: " + V95113PcTruth.reasons(a.optBoolean("ok", false) ? b : a);
                } catch (Throwable e) { res = "PC'ye ulaşılamadı: " + V95113PcTruth.err(e); }
                if (res != null) { v95132Done(sp, res); return; }
                v95132Done(sp, "Kurul hazır (İlk 3 + ZİRVE-5). CANLI onayı açılıyor.");
                runOnUiThread(() -> { if (live) Toast.makeText(this, "PC zaten CANLI: kurul yeni kararlarda devrede.", Toast.LENGTH_LONG).show(); else v95132GoLive(); });
            }))
            .setNegativeButton("Vazgeç", null).show();
    }

    private void v95132GoLive() {
''')

# ------------------------------------------------------------------ status: committee summary + per lot
truth = replace(truth,
    '        b.append(v95136AccountText(sp)).append(v95136RenewText(run, "LIVE".equals(lanes.optString("mode", "")))); // V95136_R2544_78_SIZE\n',
    '        b.append(v95136AccountText(sp)).append(v95136RenewText(run, "LIVE".equals(lanes.optString("mode", "")))); // V95136_R2544_78_SIZE\n'
    '        b.append(v95137CommitteeText(sp)); // V95137_R2544_89_KURUL\n')
truth = replace(truth,
    '                 .append(v95135PartText(x.optJSONObject("part"))); // V95135_R2544_76_ZIRVE5\n',
    '                 .append(v95135PartText(x.optJSONObject("part"))) // V95135_R2544_76_ZIRVE5\n'
    '                 .append(v95137LotCm(x.optJSONObject("cm"))); // V95137_R2544_89_KURUL\n')
truth = replace(truth,
    '             .append(v95135PartText(x.optJSONObject("part")));\n            JSONObject m = x.optJSONObject("mtf");\n',
    '             .append(v95135PartText(x.optJSONObject("part")))\n             .append(v95137LotCm(x.optJSONObject("cm"))); // V95137_R2544_89_KURUL\n            JSONObject m = x.optJSONObject("mtf");\n')

helpers = r'''    // ===== V95137_R2544_89_KURUL helpers (PC compact status "committee", switches.committeeMode, active[].cm)
    static boolean v95137Cm(SharedPreferences sp, boolean z5) {
        JSONObject s = json(sp == null ? "" : sp.getString(z5 ? "r2544_76_z5" : "r2544_57_top3", "{}")).optJSONObject("switches");
        return s != null && s.optBoolean("committeeMode", false);
    }
    static String v95137Owner(SharedPreferences sp, boolean z5) {
        JSONObject s = json(sp == null ? "" : sp.getString(z5 ? "r2544_76_z5" : "r2544_57_top3", "{}")).optJSONObject("switches");
        if (s == null) return "—";
        return s.optBoolean("committeeMode", false) ? "KURUL" : s.optBoolean("jevMode", false) ? "JEV" : "KURAL";
    }
    static String v95137R(JSONObject g) {
        if (g == null || g.isNull("avgR")) return "—";
        return String.format(java.util.Locale.US, "%+.2fR", g.optDouble("avgR", 0));
    }
    static String v95137CommitteeText(SharedPreferences sp) {
        JSONObject c = json(sp == null ? "" : sp.getString("r2544_89_cm", "{}"));
        if (c.length() == 0) return "\n🤝 Kurul: PC bilgisi yok (PC R2544.89 kurulunca görünür)";
        StringBuilder b = new StringBuilder("\n🤝 Kurul: ");
        org.json.JSONArray t = c.optJSONArray("team");
        if (t == null || t.length() == 0) b.append("masada sağlıklı model yok (9Router açık mı?)");
        else for (int i = 0; i < t.length(); i++) { if (i > 0) b.append(", "); b.append(t.optString(i, "").replaceAll("^(kr|gc|oc)/", "").replace("-preview", "")); }
        b.append(" • sağlıklı ").append(c.optInt("healthy", 0)).append("/").append(c.optInt("members", 0));
        b.append("\n   karar sahibi: İlk 3 ").append(v95137Owner(sp, false)).append(" • ZİRVE-5 ").append(v95137Owner(sp, true));
        JSONObject ex = c.optJSONObject("exam");
        if (ex != null) b.append(" • sınav ").append(ex.optInt("answered", 0)).append("/").append(ex.optInt("total", 0)).append(ex.optBoolean("finished", false) ? " bitti" : "");
        JSONObject e = c.optJSONObject("entry");
        if (e != null) {
            JSONObject tk = e.optJSONObject("TAKE"), sk = e.optJSONObject("SKIP");
            int n = (tk == null ? 0 : tk.optInt("n", 0)) + (sk == null ? 0 : sk.optInt("n", 0));
            if (n > 0) b.append("\n   kapananlar: kurul GİR dedi ").append(tk == null ? 0 : tk.optInt("n", 0)).append(" işlem ").append(v95137R(tk))
                .append(" • GİRME dedi ").append(sk == null ? 0 : sk.optInt("n", 0)).append(" işlem ").append(v95137R(sk));
        }
        return b.toString();
    }
    static String v95137LotCm(JSONObject cm) {
        if (cm == null) return "";
        StringBuilder b = new StringBuilder();
        JSONObject e = cm.optJSONObject("entry"), d = cm.optJSONObject("desk");
        if (e != null) {
            String dd = e.isNull("d") ? "" : e.optString("d", "");
            b.append("\n     🤝 kurul giriş: ").append(dd.isEmpty() ? ("karar yok" + (e.isNull("err") ? "" : " (" + e.optString("err", "") + ")")) : ("TAKE".equals(dd) ? "GİR" : "GİRME"))
             .append(e.optBoolean("auth", false) ? " (YETKİLİ)" : " (gölge)");
        }
        if (d != null) b.append("\n     🧑‍💼 masa: ").append(d.optString("t", "")).append(d.optBoolean("auth", false) ? " (YETKİLİ)" : " (gölge)");
        return b.toString();
    }
'''
truth = replace(truth, '    static String v95133RuleTr(String r) {\n', helpers + '    static String v95133RuleTr(String r) {\n')

# ------------------------------------------------------------------ identity
build = replace(build, 'versionCode 26102302', 'versionCode 26102701')
build = replace(build, "versionName '9.5.128-r2544.78-size'", "versionName '9.5.129-r2544.89-kurul'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
