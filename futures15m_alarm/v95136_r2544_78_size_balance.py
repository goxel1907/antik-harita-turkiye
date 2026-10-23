"""R2544.78 (user 23.10: "otomatik yenileme olacak canlıda ... istersem office'den istersem apk'dan; apk'da marj ve kaldıraç
ayarı, güncel bakiye durumu da olmalı"). Source-generation patch after V95135.
  - lanes card: "İlk 3: marj / kaldıraç" and "ZİRVE-5: marj / kaldıraç" open a dialog with the current balance, the current
    size and what ONE stop costs with the typed size (live preview); PC POST /live/top3 or /live/zirve5 {marginQuote, leverage}.
    In LIVE the dialog says GERÇEK PARA and sends the PC's LIVE confirmation; open lots keep their orders (new size = new lots).
  - status: the balance of the current mode's account (TEST: paper, CANLI: Binance) from the PC compact status "account";
    the LIVE auto-renew state (PC R2544.78: CANLI stays on until Durdur / TEST'e dön).
  - "CANLI'ya geç" / "Durdur" texts say how the LIVE start renews itself and what ends it.
Android stays a PC control/telemetry client: a size setting is not an order; it never initiates an order (Codemagic check kept).
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95136_R2544_78_SIZE'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95136 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95135_R2544_76_ZIRVE5' not in main:
    raise SystemExit('V95136 requires V95135')
if MARKER in main:
    raise SystemExit('V95136 already applied')

# ------------------------------------------------------------------ client: keep the balance; size setting
client = replace(client,
    '            .putString("r2544_76_z5",status.optJSONObject("zirve5")==null?"{}":status.optJSONObject("zirve5").toString()) // V95135_R2544_76_ZIRVE5\n',
    '            .putString("r2544_76_z5",status.optJSONObject("zirve5")==null?"{}":status.optJSONObject("zirve5").toString()) // V95135_R2544_76_ZIRVE5\n'
    '            .putString("r2544_78_account",status.optJSONObject("account")==null?"{}":status.optJSONObject("account").toString()) // V95136_R2544_78_SIZE\n')
client = replace(client,
    '    public static JSONObject selectLane(Context c, String key, boolean on, boolean liveConfirm) throws Exception {\n',
    '    // V95136_R2544_78_SIZE: margin (empty = risk based) and leverage of İlk 3 ("top3") or ZİRVE-5 ("zirve5"). A setting, never an\n'
    '    // order; in LIVE the PC needs confirm LIVE, sent only after the user\'s GERÇEK PARA dialog.\n'
    '    public static JSONObject setLaneSize(Context c, String lane, String margin, int leverage, boolean liveConfirm) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        String m = margin == null ? "" : margin.trim().replace(\',\', \'.\');\n'
    '        body.put("marginQuote", m.isEmpty() ? JSONObject.NULL : (Object) Double.valueOf(Double.parseDouble(m)));\n'
    '        body.put("leverage", leverage);\n'
    '        if (liveConfirm) body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "zirve5".equals(lane) ? "/live/zirve5" : "/live/top3", body, true);\n'
    '    }\n'
    '    public static JSONObject selectLane(Context c, String key, boolean on, boolean liveConfirm) throws Exception {\n')

# ------------------------------------------------------------------ lanes card: the two size buttons
main = replace(main,
    '        card.addView(bZ5, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n',
    '        card.addView(bZ5, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        android.widget.LinearLayout rowSize = new android.widget.LinearLayout(this); // V95136_R2544_78_SIZE\n'
    '        rowSize.setOrientation(android.widget.LinearLayout.HORIZONTAL);\n'
    '        Button bSizeT3 = button("İlk 3: marj / kaldıraç", android.graphics.Color.rgb(45, 55, 72));\n'
    '        bSizeT3.setTag("v95136_btn_size_t3");\n'
    '        bSizeT3.setOnClickListener(v -> v95136SizeDialog("top3"));\n'
    '        Button bSizeZ5 = button("ZİRVE-5: marj / kaldıraç", android.graphics.Color.rgb(45, 55, 72));\n'
    '        bSizeZ5.setTag("v95136_btn_size_z5");\n'
    '        bSizeZ5.setOnClickListener(v -> v95136SizeDialog("zirve5"));\n'
    '        android.widget.LinearLayout.LayoutParams hs = new android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f);\n'
    '        hs.setMargins(dp(2), dp(2), dp(2), dp(2));\n'
    '        rowSize.addView(bSizeT3, hs);\n'
    '        rowSize.addView(bSizeZ5, new android.widget.LinearLayout.LayoutParams(hs));\n'
    '        card.addView(rowSize, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n')

# ------------------------------------------------------------------ CANLI'ya geç / Durdur texts
main = replace(main,
    '            + "\\n\\nSanal pozisyonlar kapatılır, PC Binance bakiyenizle GERÇEK PARA işlem açar. Bakiye ve açık pozisyon PC’de kontrol edilir. JEV modu açıksa OpenRouter kredisi gerekir; yoksa o hat işlem açmaz.", true);\n',
    '            + "\\n\\nSanal pozisyonlar kapatılır, PC Binance bakiyenizle GERÇEK PARA işlem açar. Bakiye ve açık pozisyon PC’de kontrol edilir. JEV modu açıksa OpenRouter kredisi gerekir; yoksa o hat işlem açmaz."\n'
    '            + "\\n\\nCANLI, sen “Durdur” ya da “TEST’e dön” diyene kadar açık kalır: PC başlatmayı 24 saatte bir Binance kontrolüyle kendiliğinden yeniler (V95136_R2544_78_SIZE).", true);\n')
main = replace(main,
    '"Her şey durur (yeni giriş yok). TEST’te sanal pozisyonlar kapatılır; CANLI’da açık gerçek pozisyonun stop/hedef emirleri yerinde kalır."',
    '"Her şey durur (yeni giriş yok). TEST’te sanal pozisyonlar kapatılır; CANLI’da açık gerçek pozisyonun stop/hedef emirleri yerinde kalır. CANLI’nın otomatik yenilemesi de durur."')

# ------------------------------------------------------------------ the size dialog
main = replace(main,
    '    private void v95132GoLive() {\n',
    r'''    // V95136_R2544_78_SIZE: margin / leverage of İlk 3 or ZİRVE-5 from the phone, with the current balance and a live preview of
    // what ONE stop costs. Empty margin = risk based (the PC sizes the lot so a stop costs a small % of the account).
    private void v95136SizeDialog(final String lane) {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        final boolean z5 = "zirve5".equals(lane);
        final String name = z5 ? "ZİRVE-5" : "İlk 3 Avcısı";
        org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        final boolean live = lanes != null && "LIVE".equals(lanes.optString("mode", ""));
        org.json.JSONObject s = z5 ? V95113PcTruth.json(sp.getString("r2544_76_z5", "{}")).optJSONObject("sizing")
                                   : V95113PcTruth.json(sp.getString("r2544_57_top3", "{}")).optJSONObject("settings");
        if (s == null) { Toast.makeText(this, "PC " + name + " büyüklük bilgisi henüz yok (PC R2544.76 gerekir).", Toast.LENGTH_LONG).show(); return; }
        boolean auto = z5 ? s.optBoolean("automatic", false) : s.optBoolean("marginAuto", true);
        double curM = s.optDouble("marginQuote", Double.NaN);
        int curL = s.optInt("leverage", 10);
        final double medStop = z5 ? 0.055 : 0.028, maxStop = z5 ? 0.079 : 0.06;
        final org.json.JSONObject acc = V95113PcTruth.json(sp.getString("r2544_78_account", "{}"));
        final double wallet = acc.optBoolean("ok", false) ? acc.optDouble("walletBalance", Double.NaN) : Double.NaN;
        final double avail = acc.optBoolean("ok", false) ? acc.optDouble("availableBalance", Double.NaN) : Double.NaN;
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        box.setPadding(dp(18), dp(8), dp(18), dp(4));
        TextView info = new TextView(this);
        info.setText(V95113PcTruth.v95136AccountText(sp).trim() + "\nŞu an: " + (auto || Double.isNaN(curM) ? "riske göre (marj boş)" : String.format(java.util.Locale.US, "%.0f USDT", curM)) + " × " + curL + "x"
            + (live ? "\n⚠ PC CANLI modda: yeni büyüklük GERÇEK PARA ile açılacak yeni işlemlere uygulanır; açık işlemler değişmez." : "\nPC TEST modunda (sanal hesap)."));
        box.addView(info);
        final EditText eM = new EditText(this);
        eM.setHint("Marj USDT (5 ve üstü; boş = riske göre)");
        eM.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        if (!auto && !Double.isNaN(curM)) eM.setText(V95113PcTruth.v95135R(curM));
        box.addView(eM);
        final EditText eL = new EditText(this);
        eL.setHint("Kaldıraç (1–20)");
        eL.setInputType(InputType.TYPE_CLASS_NUMBER);
        eL.setText(String.valueOf(curL));
        box.addView(eL);
        final TextView prev = new TextView(this);
        prev.setTextSize(13);
        box.addView(prev);
        final Runnable upd = () -> prev.setText(V95113PcTruth.v95136SizePreview(eM.getText().toString(), eL.getText().toString(), medStop, maxStop, wallet, avail));
        android.text.TextWatcher tw = new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence a, int b, int c, int d) {}
            public void onTextChanged(CharSequence a, int b, int c, int d) {}
            public void afterTextChanged(android.text.Editable e) { upd.run(); }
        };
        eM.addTextChangedListener(tw);
        eL.addTextChangedListener(tw);
        upd.run();
        new AlertDialog.Builder(this).setTitle(name + " — marj / kaldıraç").setView(box)
            .setPositiveButton(live ? "KAYDET — GERÇEK PARA" : "KAYDET", (d, w) -> {
                final String m = eM.getText().toString().trim().replace(',', '.');
                int lev;
                try { lev = Integer.parseInt(eL.getText().toString().trim()); } catch (Throwable e) { lev = -1; }
                double mv = Double.NaN;
                try { if (!m.isEmpty()) mv = Double.parseDouble(m); } catch (Throwable e) { mv = -1; }
                if (lev < 1 || lev > 20) { Toast.makeText(this, "Kaldıraç 1–20 arası olmalı.", Toast.LENGTH_LONG).show(); return; }
                if (!m.isEmpty() && !(mv >= 5 && mv <= 100000)) { Toast.makeText(this, "Marj 5 USDT ve üstü olmalı (boş = riske göre).", Toast.LENGTH_LONG).show(); return; }
                final int fl = lev;
                v95132Io.execute(() -> {
                    String res;
                    try {
                        org.json.JSONObject out = BrainHubClient.setLaneSize(this, lane, m, fl, live);
                        res = out.optBoolean("ok", false) ? (name + ": " + (m.isEmpty() ? "riske göre" : m + " USDT") + " × " + fl + "x kaydedildi") : ("Yapılmadı: " + V95113PcTruth.reasons(out));
                    } catch (Throwable e) { res = "PC'ye ulaşılamadı: " + V95113PcTruth.err(e); }
                    v95132Done(sp, res);
                });
            })
            .setNegativeButton("Vazgeç", null).show();
    }

    private void v95132GoLive() {
''')

# ------------------------------------------------------------------ status text: balance + LIVE auto-renew
truth = replace(truth,
    '        b.append("LIVE".equals(lanes.optString("mode", "")) ? "⚠ MOD: CANLI (gerçek para)" : "MOD: TEST (sanal)").append(" • ").append(v95132StateTr(run.optString("state", "")));\n',
    '        b.append("LIVE".equals(lanes.optString("mode", "")) ? "⚠ MOD: CANLI (gerçek para)" : "MOD: TEST (sanal)").append(" • ").append(v95132StateTr(run.optString("state", "")));\n'
    '        b.append(v95136AccountText(sp)).append(v95136RenewText(run, "LIVE".equals(lanes.optString("mode", "")))); // V95136_R2544_78_SIZE\n')

helpers = r'''    // ===== V95136_R2544_78_SIZE helpers (PC compact status "account" and run.liveAutoRun, contract R2544.78_PC_STATUS)
    static String v95136When(String iso) {
        long t = parseIso(iso);
        return t <= 0 ? "—" : new java.text.SimpleDateFormat("dd.MM HH:mm", java.util.Locale.getDefault()).format(new java.util.Date(t));
    }
    static String v95136AccountText(SharedPreferences sp) {
        JSONObject a = json(sp == null ? "" : sp.getString("r2544_78_account", "{}"));
        JSONObject run = json(sp == null ? "" : sp.getString("r2544_57_run", "{}"));
        JSONObject lanes = run.optJSONObject("lanes");
        String acct = lanes != null && "LIVE".equals(lanes.optString("mode", "")) ? "Binance" : "TEST sanal";
        if (a.length() == 0) return "\n💰 Bakiye: PC bilgisi yok (PC R2544.78 kurulunca görünür)";
        if (!a.optBoolean("ok", false)) return "\n💰 Bakiye (" + acct + ") okunamadı: " + str(a, "reason");
        return String.format(java.util.Locale.US, "\n💰 Bakiye (%s): cüzdan %.2f • serbest %.2f • açık K/Z %+.2f USDT • %s", acct,
            a.optDouble("walletBalance", 0), a.optDouble("availableBalance", 0), a.optDouble("unrealizedPnl", 0), hhmm(parseIso(a.optString("asOf", ""))));
    }
    static String v95136RenewText(JSONObject run, boolean live) {
        if (run == null || !live) return "";
        if (run.optBoolean("liveAutoRun", false)) {
            String s = "\n🔁 Otomatik yenileme AÇIK: “Durdur” ya da “TEST’e dön” diyene kadar CANLI • başlatma " + v95136When(run.optString("armExpiresAt", "")) + "’e kadar, kendiliğinden yenilenir";
            JSONObject e = run.optJSONObject("lastError");
            if (e != null && !"LIVE_RUNNING".equals(run.optString("state", "")) && !run.optBoolean("liveWindDown", false)) s += "\n⚠ Yenileme bekliyor (" + reasons(e) + ") — her dakika yeniden denenir, bu arada yeni işlem açılmaz";
            return s;
        }
        if ("LIVE_RUNNING".equals(run.optString("state", ""))) return "\nBaşlatma " + v95136When(run.optString("armExpiresAt", "")) + "’e kadar • otomatik yenileme için “CANLI’ya geç”e bir kez daha bas";
        return "";
    }
    // what one stop costs with the typed size (median / widest measured stop) and as % of the wallet
    static String v95136SizePreview(String m, String l, double medStop, double maxStop, double wallet, double avail) {
        String ms = m == null ? "" : m.trim().replace(',', '.');
        int lev;
        try { lev = Integer.parseInt(l == null ? "" : l.trim()); } catch (Throwable e) { return "Kaldıraç girin (1–20)."; }
        if (lev < 1 || lev > 20) return "Kaldıraç 1–20 arası olmalı.";
        if (ms.isEmpty()) return "Marj boş: riske göre — PC lotu, stopta hesabın küçük bir yüzdesi kaybedilecek kadar açar.";
        double mv;
        try { mv = Double.parseDouble(ms); } catch (Throwable e) { return "Marj sayı olmalı."; }
        if (!(mv >= 5)) return "Marj 5 USDT ve üstü olmalı.";
        double n = mv * lev, a = n * medStop, b = n * maxStop;
        StringBuilder s = new StringBuilder(String.format(java.util.Locale.US, "Pozisyon %.0f USDT • bir stopta ≈ %.1f USDT (ortanca), en geniş stopta ≈ %.1f USDT", n, a, b));
        if (!Double.isNaN(wallet) && wallet > 0) {
            s.append(String.format(java.util.Locale.US, " = cüzdanın %%%.0f / %%%.0f", a / wallet * 100, b / wallet * 100));
            if (a / wallet > 0.10) s.append("\n⚠ Bir stop cüzdanın %10’undan fazla.");
        }
        if (!Double.isNaN(avail) && mv > avail * 0.95) s.append(String.format(java.util.Locale.US, "\n⚠ Marj serbest bakiyenin (%.2f) %%95’inden büyük: PC bu büyüklükte işlem açmaz.", avail));
        return s.toString();
    }
'''
truth = replace(truth, '    static String v95133RuleTr(String r) {\n', helpers + '    static String v95133RuleTr(String r) {\n')

# ------------------------------------------------------------------ identity
build = replace(build, 'versionCode 26102301', 'versionCode 26102302')
build = replace(build, "versionName '9.5.127-r2544.76-zirve5'", "versionName '9.5.128-r2544.78-size'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
