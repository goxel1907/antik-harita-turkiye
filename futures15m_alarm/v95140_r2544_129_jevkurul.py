"""R2544.129 (user 04.11: "APK'yı ver"; "ister kurul ile ister JEV+kurul+bot ile tek tık canlı, APK buna göre senkron olacak").
Source-generation patch after V95139.
  - KÂR / ZARAR from the PC (the account's own ledger, compact status pnl): today / 24 h / this week / 30 days / since the start,
    the last 7 days, and the TEST virtual top-up shown apart (it is NOT profit).
  - BEYİN: the brain's last recall (coin, lean, sentence, the 5 most similar past trades with result and why) and its report card
    (hit rate next to the always-negative baseline, average R when it said olumlu / olumsuz).
  - SİNYAL HUNİSİ: last 24 h counts and the last signals with their fate ("lot sınırı dolu" and the rule reasons in Turkish).
  - each open lot: live R and best R (the PC's minute path) and what happened to the desk's command (✓ uygulandı / ✗ / ⛔ koruma / ⏳ yolda).
  - lane labels JEV+Kurul / Kurul / JEV'li / JEV'siz; "🧠🤝 JEV + Kurul ile CANLI'ya geç" (both strategies JEV + KURUL + bot and selected
    for LIVE, then the phone's normal "CANLI'YA GEÇ — GERÇEK PARA" dialog: the last press stays with the user); "Kurulla CANLI" turns JEV off.
  - the committee warning says what really happens since R2544.116: the bot opens every signal, the committee votes, never blocks.
Android stays a PC control/telemetry client: a switch is not an order; it never initiates an order (Codemagic check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95140_R2544_129_JEVKURUL'


def replace(s, old, new, n=1):
    if s.count(old) != n:
        raise SystemExit('V95140 anchor count %d (want %d): %s' % (s.count(old), n, old[:110]))
    return s.replace(old, new)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95139_R2544_103_SAGLIK' not in main:
    raise SystemExit('V95140 requires V95139')
if MARKER in main:
    raise SystemExit('V95140 already applied')

# ------------------------------------------------------------------ client: keep pnl / brain / funnel; JEV + KURUL live switch
client = replace(client,
    '            .putString("r2544_89_cm",status.optJSONObject("committee")==null?"{}":status.optJSONObject("committee").toString()) // V95137_R2544_89_KURUL\n',
    '            .putString("r2544_89_cm",status.optJSONObject("committee")==null?"{}":status.optJSONObject("committee").toString()) // V95137_R2544_89_KURUL\n'
    '            .putString("r2544_129_pnl",status.optJSONObject("pnl")==null?"{}":status.optJSONObject("pnl").toString()) // V95140_R2544_129_JEVKURUL\n'
    '            .putString("r2544_129_brain",status.optJSONObject("brain")==null?"{}":status.optJSONObject("brain").toString())\n'
    '            .putString("r2544_129_funnel",status.optJSONObject("funnel")==null?"{}":status.optJSONObject("funnel").toString())\n')
client = replace(client,
    '        body.put("committeeMode", true);\n        body.put("liveEnabled", true);\n        body.put("confirm", "LIVE");\n        body.put("source", "APK");\n        return post(c, "zirve5".equals(lane) ? "/live/zirve5" : "/live/top3", body, true);\n    }\n',
    '        body.put("committeeMode", true);\n        body.put("jevMode", false); // V95140: "Kurulla CANLI" = the committee alone\n        body.put("liveEnabled", true);\n        body.put("confirm", "LIVE");\n        body.put("source", "APK");\n        return post(c, "zirve5".equals(lane) ? "/live/zirve5" : "/live/top3", body, true);\n    }\n'
    '    // V95140_R2544_129_JEVKURUL: JEV + KURUL + bot (both switches in one press) and selected for LIVE; the LIVE start itself stays a separate press\n'
    '    public static JSONObject setJevCommitteeLive(Context c, String lane) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put("committeeMode", true);\n'
    '        body.put("jevMode", true);\n'
    '        body.put("liveEnabled", true);\n'
    '        body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "zirve5".equals(lane) ? "/live/zirve5" : "/live/top3", body, true);\n'
    '    }\n')

# ------------------------------------------------------------------ status text
truth = replace(truth,
    '        b.append(v95137CommitteeText(sp)).append(v95139Models(sp)).append(v95138Recent(sp)); // V95137_R2544_89_KURUL + V95138_R2544_98_MUTABIK + V95139_R2544_103_SAGLIK\n',
    '        b.append(v95140Pnl(sp)); // V95140_R2544_129_JEVKURUL\n'
    '        b.append(v95137CommitteeText(sp)).append(v95139Models(sp)).append(v95138Recent(sp)); // V95137_R2544_89_KURUL + V95138_R2544_98_MUTABIK + V95139_R2544_103_SAGLIK\n'
    '        b.append(v95140Brain(sp)).append(v95140Funnel(sp)); // V95140_R2544_129_JEVKURUL\n')
truth = replace(truth,
    '         .append(h != null && "RULE_PLUS_JEV".equals(h.optString("decisions", "")) ? " • JEV’li" : " • JEV’siz");\n',
    '         .append(v95140DecTr(h)); // V95140_R2544_129_JEVKURUL\n')
truth = replace(truth,
    '         .append(zl != null && "RULE_PLUS_JEV".equals(zl.optString("decisions", "")) ? " • JEV’li" : " • JEV’siz")\n',
    '         .append(v95140DecTr(zl)) // V95140_R2544_129_JEVKURUL\n')
truth = replace(truth,
    '.append(v95137LotCm(x.optJSONObject("cm"))); // V95137_R2544_89_KURUL\n',
    '.append(v95140LiveR(x.optJSONObject("r"))).append(v95137LotCm(x.optJSONObject("cm"))); // V95137_R2544_89_KURUL + V95140_R2544_129_JEVKURUL\n', 2)
truth = replace(truth,
    '            b.append(d.optBoolean("auth", false) ? " (YETKİLİ)" : " (gölge)");\n',
    '            b.append(d.optBoolean("auth", false) ? " (YETKİLİ)" : " (gölge)").append(v95140Fate(d.optJSONObject("f"))); // V95140_R2544_129_JEVKURUL\n')

helpers = r'''    // ===== V95140_R2544_129_JEVKURUL: P&L (account ledger), the brain, the funnel, live R, the desk command's fate, lane labels
    static String v95140Usd(double v) { return Double.isNaN(v) ? "—" : String.format(java.util.Locale.US, "%+.2f $", v); }
    static String v95140DecTr(JSONObject lane) {
        String d = lane == null ? "" : lane.optString("decisions", "");
        if ("RULE_PLUS_JEV_COMMITTEE".equals(d)) return " • JEV+Kurul";
        if ("RULE_PLUS_COMMITTEE".equals(d)) return " • Kurul";
        if ("RULE_PLUS_JEV".equals(d)) return " • JEV’li";
        return " • JEV’siz";
    }
    static String v95140PnlRow(String label, JSONObject x) {
        if (x == null) return "";
        double net = x.optDouble("net", Double.NaN);
        StringBuilder b = new StringBuilder("\n     ").append(Double.isNaN(net) || net >= 0 ? "🟢 " : "🔴 ").append(label).append(": ").append(v95140Usd(net))
            .append(" • ").append(x.optInt("n", 0)).append(" işlem • ").append(x.optInt("w", 0)).append(" kazanç");
        if (!x.isNull("R") && x.has("R")) b.append(String.format(java.util.Locale.US, " • %+.2fR", x.optDouble("R", 0)));
        return b.toString();
    }
    static String v95140Pnl(SharedPreferences sp) {
        JSONObject p = json(sp == null ? "" : sp.getString("r2544_129_pnl", "{}"));
        if (p.length() == 0) return "";
        StringBuilder b = new StringBuilder("\n\n💵 KÂR / ZARAR (hesabın kendi defteri: gerçekleşen kâr + komisyon + fonlama)");
        b.append(v95140PnlRow("Bugün", p.optJSONObject("today"))).append(v95140PnlRow("Son 24 saat", p.optJSONObject("h24")))
         .append(v95140PnlRow("Bu hafta", p.optJSONObject("week"))).append(v95140PnlRow("Son 30 gün", p.optJSONObject("d30")))
         .append(v95140PnlRow("Başlangıçtan beri", p.optJSONObject("all")));
        org.json.JSONArray days = p.optJSONArray("days");
        if (days != null && days.length() > 0) {
            b.append("\n     günler: ");
            for (int i = 0; i < days.length(); i++) { org.json.JSONArray d = days.optJSONArray(i); if (d == null) continue; if (i > 0) b.append(" · "); b.append(d.optString(0, "?")).append(" ").append(v95140Usd(d.optDouble(1, Double.NaN))); }
        }
        JSONObject cash = p.optJSONObject("cash");
        if (cash != null && cash.optInt("n", 0) > 0) b.append("\n     ").append("LIVE".equals(p.optString("mode", "")) ? "hesaba yatan / çekilen: " : "TEST’e eklenen sanal ek bakiye: ")
            .append(v95140Usd(cash.optDouble("total", Double.NaN))).append(" (").append(cash.optInt("n", 0)).append(" kez) — kâr/zarara KATILMAZ");
        if (!p.isNull("err") && p.has("err")) b.append("\n     ⚠ defter okunamadı: ").append(p.optString("err", ""));
        return b.toString();
    }
    static String v95140Brain(SharedPreferences sp) {
        JSONObject br = json(sp == null ? "" : sp.getString("r2544_129_brain", "{}"));
        if (br.length() == 0) return "";
        StringBuilder b = new StringBuilder("\n\n🧠 BEYİN (").append(br.optInt("lessons", 0)).append(" işlem hafızada; her sinyalde en benzer 5 işlemi hatırlar, engellemez)");
        JSONObject l = br.optJSONObject("last");
        if (l != null) {
            String lean = l.optString("lean", "");
            b.append("\n   ").append("OLUMLU".equals(lean) ? "🟢" : "OLUMSUZ".equals(lean) ? "🔴" : "🟡").append(" ").append(l.optString("s", "?")).append(" ").append(l.optString("side", ""))
             .append("OPEN".equals(l.optString("st", "")) ? " (açık)" : l.optBoolean("replay", false) ? " (son işlem, geçmişe dönük)" : " (son işlem)")
             .append(": ").append(l.optString("txt", ""));
            if (!l.isNull("R") && l.has("R")) b.append(String.format(java.util.Locale.US, " • sonuç %+.2fR", l.optDouble("R", 0))).append(l.isNull("hit") ? "" : l.optBoolean("hit", false) ? " ✓ dediği oldu" : " ✗ dediği olmadı");
            org.json.JSONArray cs = l.optJSONArray("cases");
            if (cs != null) for (int i = 0; i < cs.length(); i++) {
                JSONObject c = cs.optJSONObject(i); if (c == null) continue;
                double r = c.optDouble("R", 0);
                b.append("\n     ").append(r > 0 ? "🟢 " : "🔴 ").append(c.optString("s", "?")).append(" ").append(c.optString("side", ""))
                 .append(String.format(java.util.Locale.US, " %+.2fR", r)).append(" — ").append(c.optString("why", ""));
            }
        }
        JSONObject sc = br.optJSONObject("score");
        if (sc != null) {
            b.append("\n   📒 karne (").append("live".equals(sc.optString("src", "")) ? "canlı tahmin" : "geçmişe dönük").append(", ").append(sc.optInt("n", 0)).append(" tahmin): isabet %")
             .append(sc.optInt("hit", 0)).append(" (hep “olumsuz” deseydi %").append(sc.optInt("neg", 0)).append(")")
             .append(String.format(java.util.Locale.US, "\n     olumlu dediğinde %+.2fR • olumsuz dediğinde %+.2fR", sc.optDouble("pos", 0), sc.optDouble("negR", 0)));
        }
        return b.toString();
    }
    static String v95140Why(String w) {
        if (w == null) return "";
        switch (w) {
            case "TOP3_SLOTS_FULL": case "ZIRVE5_SLOTS_FULL": return "lot sınırı dolu (hat başına 2)";
            case "ZIRVE5_STOP_OUT_OF_BAND": case "V2_STOP_OUT_OF_RANGE": return "stop bant dışı";
            case "TOP3_EXCHANGE_MAX_UNDER_10X": case "TOP3_BRACKET_UNDER_10X": return "borsa 10x vermiyor";
            case "TOP3_STOP_BEYOND_LIQUIDATION_AT_10X": return "stop 10x’te likidasyondan uzak";
            case "TOP3_PRICE_UNAVAILABLE": return "fiyat alınamadı";
            default: return w;
        }
    }
    static String v95140Funnel(SharedPreferences sp) {
        JSONObject f = json(sp == null ? "" : sp.getString("r2544_129_funnel", "{}"));
        if (f.length() == 0) return "";
        StringBuilder b = new StringBuilder("\n\n📡 SON 24 SAAT SİNYAL: ").append(f.optInt("n", 0)).append(" sinyal → ").append(f.optInt("opened", 0)).append(" açıldı • ")
            .append(f.optInt("blocked", 0)).append(" kural eledi • ").append(f.optInt("none", 0)).append(" sonuç yok");
        org.json.JSONArray rows = f.optJSONArray("rows");
        if (rows != null) for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.optJSONObject(i); if (r == null) continue;
            String fate = r.optString("f", "");
            b.append("\n     ").append("OPENED".equals(fate) ? "✅ " : "RULE_BLOCKED".equals(fate) ? "⛔ " : "• ").append("ZIRVE5".equals(r.optString("l", "")) ? "Z5 " : "İlk 3 ")
             .append(r.optString("s", "?")).append(" ").append(r.optString("side", "")).append(" — ")
             .append("OPENED".equals(fate) ? "açıldı" : "RULE_BLOCKED".equals(fate) ? v95140Why(r.isNull("why") ? null : r.optString("why", null)) : "COMMITTEE_SKIP".equals(fate) ? "kurul girme" : "sonuç yok");
        }
        return b.toString();
    }
    static String v95140LiveR(JSONObject r) {
        if (r == null || !r.has("R")) return "";
        return String.format(java.util.Locale.US, "\n     📈 şimdi %+.2fR • en iyi %+.2fR", r.optDouble("R", 0), r.optDouble("best", 0));
    }
    static String v95140Fate(JSONObject f) {
        if (f == null) return "";
        if (f.optBoolean("pending", false)) return " • ⏳ emir yolda";
        if (f.optBoolean("guard", false)) return String.format(java.util.Locale.US, " • ⛔ uygulanmadı: gürültü koruması (açık %d dk, %+.2fR)", f.optInt("min", 0), f.optDouble("R", 0));
        if (f.has("ok")) return f.optBoolean("ok", false) ? " • ✓ uygulandı" : " • ✗ uygulanamadı" + (f.isNull("why") ? "" : ": " + f.optString("why", ""));
        return "";
    }
'''
truth = replace(truth, '    static String v95133RuleTr(String r) {\n', helpers + '    static String v95133RuleTr(String r) {\n')

# ------------------------------------------------------------------ main: the JEV + KURUL button and the honest warning
main = replace(main,
    '        bCmLive.setOnClickListener(v -> v95137CmLive());\n        card.addView(bCmLive, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n',
    '        bCmLive.setOnClickListener(v -> v95137CmLive());\n        card.addView(bCmLive, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        Button bJkLive = button("🧠🤝 JEV + Kurul ile CANLI’ya geç", android.graphics.Color.rgb(120, 53, 15)); // V95140_R2544_129_JEVKURUL\n'
    '        bJkLive.setTag("v95140_btn_jk_live");\n'
    '        bJkLive.setOnClickListener(v -> v95140JkLive());\n'
    '        card.addView(bJkLive, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n')
main = replace(main,
    '        + "Girişte kurul ANLAŞARAK (oybirliği / tartışma sonrası çoğunluk, en az 2 model) GİRME derse işlem açılmaz; tek model ya da anlaşmazlıkta kural karar verir. "\n',
    '        + "Girişte kural (bot) her sinyali açar; kurul oy verir, engellemez (R2544.116). "\n')
main = replace(main,
    '    private void v95132GoLive() {\n',
    r'''    // V95140_R2544_129_JEVKURUL: JEV + KURUL + bot - the bot opens every signal; JEV decides first on the open position, the committee when JEV
    // cannot answer (OpenRouter credit / error); then the normal LIVE dialog (the last press stays with the user)
    private static final String V95140_JK_WARN = "JEV + KURUL + BOT: kural (bot) her sinyalde işlemi açar; JEV ve kurul girişte oy verir, engellemez. "
        + "Açık pozisyonda önce JEV karar verir; JEV cevap veremezse (OpenRouter kredisi bitti / hata) kurul karar verir. Yalnız risk azaltan emirler "
        + "(yarısını kapat, stopu kâra doğru yaklaştır, çık); gürültü koruması: 30 dk ve -0,6R altı ya da en iyi +1R. JEV çağrıları ÜCRETLİ (OpenRouter). "
        + "Marj ve kaldıraç hattın ayarıdır; CANLI’da Binance serbest bakiyesi okunur, yetmezse geçiş olmaz.";
    private void v95140JkLive() {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        final boolean live = lanes != null && "LIVE".equals(lanes.optString("mode", ""));
        new AlertDialog.Builder(this).setTitle("🧠🤝 JEV + KURUL İLE CANLI’YA GEÇ")
            .setMessage("1) İlk 3 ve ZİRVE-5 JEV + KURUL + BOT olur ve ikisi CANLI’da seçili olur.\n2) Ardından “CANLI’YA GEÇ — GERÇEK PARA” onayı açılır; son onay sende (onaylamazsan PC TEST’te kalır).\n\n" + V95140_JK_WARN)
            .setPositiveButton("DEVAM", (d, w) -> v95132Io.execute(() -> {
                String res = null;
                try {
                    org.json.JSONObject a = BrainHubClient.setJevCommitteeLive(this, "top3");
                    org.json.JSONObject b = BrainHubClient.setJevCommitteeLive(this, "zirve5");
                    if (!a.optBoolean("ok", false) || !b.optBoolean("ok", false)) res = "JEV + Kurul açılamadı: " + V95113PcTruth.reasons(a.optBoolean("ok", false) ? b : a);
                } catch (Throwable e) { res = "PC'ye ulaşılamadı: " + V95113PcTruth.err(e); }
                if (res != null) { v95132Done(sp, res); return; }
                v95132Done(sp, "JEV + Kurul hazır, İlk 3 + ZİRVE-5 CANLI’da seçili. CANLI onayı açılıyor.");
                runOnUiThread(() -> { if (live) Toast.makeText(this, "PC zaten CANLI: JEV + Kurul yeni kararlarda devrede.", Toast.LENGTH_LONG).show(); else v95132GoLive(); });
            }))
            .setNegativeButton("Vazgeç", null).show();
    }

    private void v95132GoLive() {
''')

build = replace(build, 'versionCode 26110201', 'versionCode 26110401')
build = replace(build, "versionName '9.5.131-r2544.103-saglik'", "versionName '9.5.132-r2544.129-jevkurul'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
