"""R2544.76 (user 23.10: "APK'yı da güncelle, canlıya geçtiğimizde sorun olmasın"). Source-generation patch after V95134.
The phone had no ZİRVE-5: no lane switch, no lots, no size - and "CANLI'ya geç" listed only Normal / İlk 3 while the PC takes a
selected ZİRVE-5 LIVE too (and refused when only ZİRVE-5 was selected). Now:
  - lanes card: ZİRVE-5 lane button (PC /live/lanes {zirve5}); LIVE ON needs the user's dialog (confirm LIVE), OFF is immediate;
  - "CANLI'ya geç" lists all three lanes and what ONE stop costs with each lane's size (margin x leverage x typical stop);
  - status text: a ZİRVE-5 section (switches, size, kâr koruma level, open lots with partial taken / rest at break-even and the
    1h/4h/5m information, last scan, latest decisions with reasons, results) and the kâr koruma state on İlk 3 lots.
Android stays a PC control/telemetry client: it never initiates an order (Codemagic check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95135_R2544_76_ZIRVE5'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95135 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95134_R2544_58_SYSTEM' not in main:
    raise SystemExit('V95135 requires V95134')
if MARKER in main:
    raise SystemExit('V95135 already applied')

# ------------------------------------------------------------------ client: keep the ZİRVE-5 status; one-lane switch
client = replace(client,
    '            .putString("r2544_57_top3",status.optJSONObject("top3")==null?"{}":status.optJSONObject("top3").toString())\n',
    '            .putString("r2544_57_top3",status.optJSONObject("top3")==null?"{}":status.optJSONObject("top3").toString())\n'
    '            .putString("r2544_76_z5",status.optJSONObject("zirve5")==null?"{}":status.optJSONObject("zirve5").toString()) // V95135_R2544_76_ZIRVE5\n')
client = replace(client,
    '    public static JSONObject selectLanes(Context c, Boolean normal, Boolean top3, boolean liveConfirm) throws Exception {\n',
    '    // V95135_R2544_76_ZIRVE5: one lane on/off ("zirve5"); ON in LIVE carries confirm LIVE only after the user\'s dialog. Never an order.\n'
    '    public static JSONObject selectLane(Context c, String key, boolean on, boolean liveConfirm) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put(key, on);\n'
    '        if (liveConfirm) body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "/live/lanes", body, true);\n'
    '    }\n'
    '    public static JSONObject selectLanes(Context c, Boolean normal, Boolean top3, boolean liveConfirm) throws Exception {\n')

# ------------------------------------------------------------------ lanes card: ZİRVE-5 button, header, refresh
main = replace(main,
    '        String top3Label = "İlk 3 Avcısı: " + (top3On ? "AÇIK" : "KAPALI");\n',
    '        String top3Label = "İlk 3 Avcısı: " + (top3On ? "AÇIK" : "KAPALI");\n'
    '        boolean z5On = lanes != null && lanes.optJSONObject("zirve5") != null && lanes.optJSONObject("zirve5").optBoolean("selected", false); // V95135_R2544_76_ZIRVE5\n'
    '        String z5Label = "ZİRVE-5: " + (z5On ? "AÇIK" : "KAPALI");\n')
main = replace(main,
    '                if (bt instanceof Button) ((Button) bt).setText(top3Label);\n',
    '                if (bt instanceof Button) ((Button) bt).setText(top3Label);\n'
    '                android.view.View bz = v.findViewWithTag("v95135_btn_z5");\n'
    '                if (bz instanceof Button) ((Button) bz).setText(z5Label);\n')
main = replace(main,
    '        android.widget.TextView head = text("🧭 HATLAR & 🎯 İLK 3 AVCISI • PC", 13.8f, android.graphics.Color.WHITE, true);\n',
    '        android.widget.TextView head = text("🧭 HATLAR • 🎯 İLK 3 • 🔺🔻 ZİRVE-5 • PC", 13.8f, android.graphics.Color.WHITE, true);\n')
main = replace(main,
    '        card.addView(row1, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n',
    '        card.addView(row1, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        Button bZ5 = button(z5Label, android.graphics.Color.rgb(95, 30, 52));\n'
    '        bZ5.setTag("v95135_btn_z5");\n'
    '        bZ5.setOnClickListener(v -> v95135Z5Lane());\n'
    '        card.addView(bZ5, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n')

# ------------------------------------------------------------------ CANLI'ya geç: three lanes + what one stop costs
main = replace(main,
    '        if (!n && !t) { Toast.makeText(this, "Önce en az bir hat seçin: Normal sistem (JEV) veya İlk 3 Avcısı.", Toast.LENGTH_LONG).show(); return; }\n'
    '        v95132Run("GO_LIVE", "CANLI’YA GEÇ — GERÇEK PARA",\n'
    '            "Seçili hatlar: Normal sistem (JEV) " + (n ? "AÇIK" : "KAPALI") + " • İlk 3 Avcısı " + (t ? "AÇIK" : "KAPALI")\n'
    '            + "\\n\\nSanal pozisyonlar kapatılır, PC Binance bakiyenizle GERÇEK PARA işlem açar. Bakiye ve açık pozisyon PC’de kontrol edilir.", true);\n',
    '        boolean z = lanes.optJSONObject("zirve5") != null && lanes.optJSONObject("zirve5").optBoolean("selected", false); // V95135_R2544_76_ZIRVE5\n'
    '        if (!n && !t && !z) { Toast.makeText(this, "Önce en az bir hat seçin: Normal sistem (JEV), İlk 3 Avcısı veya ZİRVE-5.", Toast.LENGTH_LONG).show(); return; }\n'
    '        v95132Run("GO_LIVE", "CANLI’YA GEÇ — GERÇEK PARA",\n'
    '            "Seçili hatlar: Normal sistem (JEV) " + (n ? "AÇIK" : "KAPALI") + " • İlk 3 Avcısı " + (t ? "AÇIK" : "KAPALI") + " • ZİRVE-5 " + (z ? "AÇIK" : "KAPALI")\n'
    '            + "\\n\\n" + V95113PcTruth.v95135StopCostText(sp, t, z)\n'
    '            + "\\n\\nSanal pozisyonlar kapatılır, PC Binance bakiyenizle GERÇEK PARA işlem açar. Bakiye ve açık pozisyon PC’de kontrol edilir. JEV modu açıksa OpenRouter kredisi gerekir; yoksa o hat işlem açmaz.", true);\n')

main = replace(main,
    '    private void v95132GoLive() {\n',
    '    // V95135_R2544_76_ZIRVE5: ZİRVE-5 lane on/off from the phone (LIVE ON: the user confirms in the dialog; OFF is immediate)\n'
    '    private void v95135Z5Lane() {\n'
    '        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);\n'
    '        final org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");\n'
    '        if (lanes == null || lanes.optJSONObject("zirve5") == null) { Toast.makeText(this, "PC ZİRVE-5 bilgisi henüz yok (PC R2544.76 gerekir).", Toast.LENGTH_LONG).show(); return; }\n'
    '        final boolean on = lanes.optJSONObject("zirve5").optBoolean("selected", false);\n'
    '        final boolean live = "LIVE".equals(lanes.optString("mode", ""));\n'
    '        String msg = on ? "ZİRVE-5 kapatılsın mı?\\n\\nYeni giriş durur; açık ZİRVE-5 işlemleri kendi stop/hedef ve kâr korumasıyla yönetilmeye devam eder."\n'
    '                        : ("ZİRVE-5 açılsın mı?\\n\\n" + (live ? "PC CANLI modda: GERÇEK PARA ile işlem açar.\\n\\n" + V95113PcTruth.v95135StopCostText(sp, false, true) : "PC TEST modunda (sanal hesap)."));\n'
    '        new AlertDialog.Builder(this).setTitle("ZİRVE-5").setMessage(msg)\n'
    '            .setPositiveButton(on ? "KAPAT" : (live ? "AÇ — GERÇEK PARA" : "AÇ"), (d, w) -> v95132Io.execute(() -> {\n'
    '                String res;\n'
    '                try {\n'
    '                    org.json.JSONObject out = BrainHubClient.selectLane(this, "zirve5", !on, live && !on);\n'
    '                    res = out.optBoolean("ok", false) ? ("ZİRVE-5" + (on ? " kapatıldı" : " açıldı")) : ("Yapılmadı: " + V95113PcTruth.reasons(out));\n'
    '                } catch (Throwable e) { res = "PC\'ye ulaşılamadı: " + V95113PcTruth.err(e); }\n'
    '                v95132Done(sp, res);\n'
    '            }))\n'
    '            .setNegativeButton("Vazgeç", null).show();\n'
    '    }\n\n'
    '    private void v95132GoLive() {\n')

# ------------------------------------------------------------------ status text: ZİRVE-5 lane line + section, İlk 3 kâr koruma
truth = replace(truth,
    '         .append(h != null && "RULE_PLUS_JEV".equals(h.optString("decisions", "")) ? " • JEV’li" : " • JEV’siz");\n',
    '         .append(h != null && "RULE_PLUS_JEV".equals(h.optString("decisions", "")) ? " • JEV’li" : " • JEV’siz");\n'
    '        JSONObject zl = lanes.optJSONObject("zirve5"); // V95135_R2544_76_ZIRVE5\n'
    '        boolean zOn = zl != null && zl.optBoolean("selected", false);\n'
    '        b.append("\\n").append(zOn ? "🟢" : "🔴").append(" ZİRVE-5: ").append(zOn ? "SEÇİLİ" : "kapalı")\n'
    '         .append(zl != null && zl.optBoolean("active", false) ? " • çalışıyor" : "")\n'
    '         .append(zl != null && "RULE_PLUS_JEV".equals(zl.optString("decisions", "")) ? " • JEV’li" : " • JEV’siz")\n'
    '         .append(zl != null && "LIVE".equals(lanes.optString("mode", "")) && !zl.optBoolean("liveAllowed", false) ? " • CANLI izni yok" : "");\n')
truth = replace(truth,
    '                 .append(" • hedef ").append(px(num(x, "tpPrice"))).append(" • kalan ").append(x.optInt("remainingMin", 0) / 60).append(" sa");\n',
    '                 .append(" • hedef ").append(px(num(x, "tpPrice"))).append(" • kalan ").append(x.optInt("remainingMin", 0) / 60).append(" sa")\n'
    '                 .append(v95135PartText(x.optJSONObject("part"))); // V95135_R2544_76_ZIRVE5\n')
truth = replace(truth,
    '        String last = sp == null ? "" : sp.getString("r2544_57_last_action", "");\n',
    '        b.append(v95135Z5Text(sp)); // V95135_R2544_76_ZIRVE5\n'
    '        String last = sp == null ? "" : sp.getString("r2544_57_last_action", "");\n')

helpers = r'''    // ===== V95135_R2544_76_ZIRVE5 helpers (PC compact status "zirve5", contract R2544.76_PC_STATUS)
    static String v95135PartText(JSONObject p) {
        if (p == null) return "";
        if (p.has("skipped")) return "\n     kâr koruma yok (hedef yakın)";
        String lvl = String.format(java.util.Locale.US, "%%%d %sR", Math.round(p.optDouble("share", 0.5) * 100), v95135R(p.optDouble("atR", 1)));
        if (p.optBoolean("done", false)) return "\n     ✅ " + lvl + "’de alındı" + (p.optBoolean("beDone", false) ? " • kalan başabaşta (zararla kapanamaz)" : "");
        return "\n     kâr koruma: " + lvl + "’de (" + px(num(p, "price")) + ") borsada bekliyor";
    }
    static String v95135R(double x) {
        if (Double.isNaN(x)) return "—";
        String s = (Math.abs(x - Math.rint(x)) < 1e-9) ? String.valueOf((long) Math.rint(x)) : String.format(java.util.Locale.US, "%.2f", x).replaceAll("0+$", "");
        return s.replace('.', ',');
    }
    static String v95135Trend(String t) {
        if ("UP".equals(t)) return "yükselen";
        if ("DOWN".equals(t)) return "düşen";
        if ("RANGE".equals(t)) return "yatay";
        return "—";
    }
    static String v95135ReasonTr(String r) {
        if (r == null || r.isEmpty()) return "açıldı";
        if ("ZIRVE5_NO_SWEEP".equals(r)) return "süpürme (SFP) yok";
        if ("ZIRVE5_STOP_OUT_OF_BAND".equals(r)) return "stop bant dışı (çok geniş/dar)";
        if ("ZIRVE5_SIDE_OFF".equals(r)) return "bu yön kapalı";
        if ("ZIRVE5_SIGNAL_STALE".equals(r)) return "sinyal bayat";
        if ("ZIRVE5_SLOTS_FULL".equals(r)) return "CANLI lot sınırı dolu";
        if ("ZIRVE5_SYMBOL_BUSY".equals(r)) return "bu coinde açık işlem var";
        if ("TOP3_MARGIN_ABOVE_FREE_BALANCE".equals(r)) return "marj serbest bakiyeyi aşıyor";
        if ("TOP3_MARGIN_TOO_SMALL".equals(r)) return "marj 5 USDT altında";
        if (r.contains("JEV")) return "JEV onaylamadı / ulaşılamadı";
        return r;
    }
    // what ONE stop costs with each selected lane's size (margin x leverage x the measured typical stop); risk-based = % of the account
    static String v95135StopCostText(SharedPreferences sp, boolean top3, boolean z5) {
        StringBuilder b = new StringBuilder("Bir stopta kayıp (ortalama stop mesafesiyle):");
        if (z5) {
            JSONObject s = json(sp == null ? "" : sp.getString("r2544_76_z5", "{}")).optJSONObject("sizing");
            if (s == null) b.append("\n• ZİRVE-5: PC bilgisi yok");
            else if (s.optBoolean("automatic", false)) b.append(String.format(java.util.Locale.US, "\n• ZİRVE-5: riske göre — hesabın %%%.1f’i", s.optDouble("riskPct", 0.02) * 100));
            else { double n = s.optDouble("marginQuote", 0) * s.optDouble("leverage", 10);
                b.append(String.format(java.util.Locale.US, "\n• ZİRVE-5: %.0f USDT × %dx → ortanca stop %%5,5 ≈ %.1f USDT, en geniş %%7,9 ≈ %.1f USDT", s.optDouble("marginQuote", 0), s.optInt("leverage", 10), n * 0.055, n * 0.079)); }
        }
        if (top3) {
            JSONObject s = json(sp == null ? "" : sp.getString("r2544_57_top3", "{}")).optJSONObject("settings");
            if (s == null) b.append("\n• İlk 3: PC bilgisi yok");
            else if (s.optBoolean("marginAuto", true)) b.append("\n• İlk 3: riske göre (stopta hesabın küçük bir yüzdesi)");
            else { double n = s.optDouble("marginQuote", 0) * s.optInt("leverage", 10);
                b.append(String.format(java.util.Locale.US, "\n• İlk 3: %.0f USDT × %dx → ortanca stop %%2,8 ≈ %.1f USDT, en geniş %%6 ≈ %.1f USDT", s.optDouble("marginQuote", 0), s.optInt("leverage", 10), n * 0.028, n * 0.06)); }
        }
        if (!top3 && !z5) b.append("\n• (yalnız Normal sistem: büyüklüğü JEV planı ve panel marjı belirler)");
        return b.toString();
    }
    static String v95135Z5Text(SharedPreferences sp) {
        JSONObject z = json(sp == null ? "" : sp.getString("r2544_76_z5", "{}"));
        if (z.length() == 0) return "\n\n🔺🔻 ZİRVE-5: PC bilgisi yok (PC R2544.76 kurulunca görünür)";
        StringBuilder b = new StringBuilder("\n\n🔺🔻 ZİRVE-5 (15 dk, ilk 5 volatil)");
        JSONObject sw = z.optJSONObject("switches");
        if (sw != null) b.append("\nLONG ").append(sw.optBoolean("longEnabled", false) ? "açık" : "kapalı").append(" • SHORT ").append(sw.optBoolean("shortEnabled", false) ? "açık" : "kapalı")
            .append(" • süpürme şartı ").append(sw.optBoolean("requireSweep", true) ? "açık" : "KAPALI").append(" • CANLI izni ").append(sw.optBoolean("liveEnabled", false) ? "VAR" : "yok")
            .append(" • ").append(sw.optBoolean("jevMode", false) ? "JEV’li" : "JEV’siz");
        JSONObject si = z.optJSONObject("sizing");
        if (si != null) b.append("\nBüyüklük: ").append(si.optBoolean("automatic", false) ? String.format(java.util.Locale.US, "riske göre (stopta hesabın %%%.1f’i)", si.optDouble("riskPct", 0.02) * 100)
            : String.format(java.util.Locale.US, "marj %.0f USDT × %dx", si.optDouble("marginQuote", 0), si.optInt("leverage", 10)));
        JSONObject pa = z.optJSONObject("partial");
        if (pa != null) b.append(" • kâr koruma ").append(pa.optBoolean("enabled", false) ? String.format(java.util.Locale.US, "%%%d %sR’de", Math.round(pa.optDouble("share", 0.5) * 100), v95135R(pa.optDouble("atR", 2))) : "KAPALI");
        JSONArray a = z.optJSONArray("active");
        b.append("\nAçık ZİRVE-5 işlemi: ").append(a == null ? 0 : a.length());
        if (a != null) for (int i = 0; i < Math.min(6, a.length()); i++) {
            JSONObject x = a.optJSONObject(i);
            if (x == null) continue;
            double pnl = num(x, "unrealizedPnl");
            b.append("\n").append(Double.isNaN(pnl) || pnl >= 0 ? "🟢" : "🔴").append(" ").append(str(x, "symbol")).append(" ").append(str(x, "side"))
             .append(" • ").append(Double.isNaN(pnl) ? "—" : String.format(java.util.Locale.US, "%+.2f $", pnl))
             .append("\n     giriş ").append(px(num(x, "entryPrice"))).append(" • stop ").append(px(num(x, "stopPrice"))).append(" • hedef ").append(px(num(x, "tpPrice")))
             .append(" • kalan ").append(x.optInt("remainingMin", 0) / 60).append(" sa")
             .append(v95135PartText(x.optJSONObject("part")));
            JSONObject m = x.optJSONObject("mtf");
            if (m != null) b.append("\n     bilgi: 1 sa ").append(v95135Trend(m.optString("h1", ""))).append(m.optBoolean("against1h", false) ? " (TERS)" : "")
                .append(" • 4 sa ").append(v95135Trend(m.optString("h4", ""))).append(m.optBoolean("against4h", false) ? " (TERS)" : "")
                .append(" • 5 dk onay ").append(m.isNull("m5") ? "yoktu" : (m.optInt("m5", 0) + " dk önce vardı"));
        }
        JSONObject ls = z.optJSONObject("lastScan");
        if (ls != null) {
            b.append("\nSon tarama ").append(hhmm(parseIso(ls.optString("at", "")))).append(" • ilk 5: ");
            JSONArray top = ls.optJSONArray("top");
            if (top != null) for (int i = 0; i < top.length(); i++) { JSONObject r = top.optJSONObject(i); if (r == null) continue; if (i > 0) b.append(", "); b.append(str(r, "symbol").replace("USDT", "")); }
            b.append(" • bekleyen alan ").append(ls.optInt("armed", 0)).append(" • sinyal ").append(ls.optInt("signals", 0));
        }
        JSONArray rc = z.optJSONArray("recent");
        if (rc != null && rc.length() > 0) {
            b.append("\nSon kararlar:");
            for (int i = 0; i < Math.min(4, rc.length()); i++) { JSONObject r = rc.optJSONObject(i); if (r == null) continue;
                b.append("\n     ").append(hhmm(parseIso(r.optString("at", "")))).append(" ").append(str(r, "symbol")).append(" ").append(str(r, "side")).append(" → ")
                 .append(r.optBoolean("opened", false) ? "AÇILDI" : v95135ReasonTr(r.optString("reason", ""))); }
        }
        JSONObject rs = z.optJSONObject("results");
        JSONObject rt = rs == null ? null : rs.optJSONObject("test"), rl = rs == null ? null : rs.optJSONObject("live");
        if (rt != null) b.append("\nTEST (30 g): ").append(rt.optInt("closed", 0)).append(" işlem • ").append(rt.optInt("wins", 0)).append("/").append(rt.optInt("losses", 0))
            .append(" • net ").append(String.format(java.util.Locale.US, "%+.2f $", rt.optDouble("netPnl", 0)));
        if (rl != null) b.append("\nCANLI (30 g): ").append(rl.optInt("closed", 0)).append(" işlem • ").append(rl.optInt("wins", 0)).append("/").append(rl.optInt("losses", 0))
            .append(" • net ").append(String.format(java.util.Locale.US, "%+.2f $", rl.optDouble("netPnl", 0)));
        return b.toString();
    }
'''
truth = replace(truth, '    static String v95133RuleTr(String r) {\n', helpers + '    static String v95133RuleTr(String r) {\n')

# ------------------------------------------------------------------ identity
build = replace(build, 'versionCode 26101901', 'versionCode 26102301')
build = replace(build, "versionName '9.5.126-r2544.58-system'", "versionName '9.5.127-r2544.76-zirve5'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
