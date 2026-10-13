"""R2544.57: lanes on the phone - Normal sistem (JEV) and Ilk 3 Avcisi selected separately, run control, Ilk 3 summary.
Source-generation patch after V95131. Android stays a PC control/telemetry client: it selects lanes and switches the
PC run (the PC alone places orders); /live/execute and /live/burst stay forbidden.
The periodic 60 s PC config sync no longer carries the on/off switch: a phone preference must never override a newer
lane choice made in Office (and the PC refuses OTO ON in LIVE without confirm 'LIVE').
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95132_R2544_57_LANES'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95132 anchor count %d: %s' % (s.count(old), old[:100]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95131_R2544_35_PC_SYNC_UI' not in main:
    raise SystemExit('V95132 requires V95131')
if MARKER in main:
    raise SystemExit('V95132 already applied')

# ---------------------------------------------------------------- client
client = replace(client,
    '        body.put("allowShort", allowShort);\n        return post(c, "/live/leader-auto", body, true);\n    }',
    '        body.put("allowShort", allowShort);\n'
    '        // V95132: an explicit OTO ON from the phone is the user\'s confirmation (the PC needs it in LIVE).\n'
    '        if (enabled) body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "/live/leader-auto", body, true);\n    }\n'
    '    // V95132_R2544_57_LANES: periodic sizing sync never carries the on/off switch.\n'
    '    public static JSONObject syncLeaderAutoSizing(Context c, double marginQuote, int leverage, int maxOpenPositions, boolean allowLong, boolean allowShort) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put("marginQuote", marginQuote);\n'
    '        body.put("leverage", leverage);\n'
    '        body.put("maxOpenPositions", maxOpenPositions);\n'
    '        body.put("allowLong", allowLong);\n'
    '        body.put("allowShort", allowShort);\n'
    '        return post(c, "/live/leader-auto", body, true);\n'
    '    }\n'
    '    // Lanes: "normal" = Normal sistem (JEV), "top3" = Ilk 3 Avcisi. ON in LIVE needs liveConfirm (user tapped the dialog).\n'
    '    public static JSONObject selectLanes(Context c, Boolean normal, Boolean top3, boolean liveConfirm) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        if (normal != null) body.put("normal", normal.booleanValue());\n'
    '        if (top3 != null) body.put("top3", top3.booleanValue());\n'
    '        if (liveConfirm) body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "/live/lanes", body, true);\n'
    '    }\n'
    '    // PC run control (same as Office): GO_LIVE (confirm LIVE), GO_TEST, START_TEST, STOP. Never an order.\n'
    '    public static JSONObject runControl(Context c, String action, boolean liveConfirm) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put("action", action);\n'
    '        if (liveConfirm) body.put("confirm", "LIVE");\n'
    '        return post(c, "/live/run", body, true);\n'
    '    }')
client = replace(client,
    '.putString("v9599_learning",status.optJSONObject("learning")==null?"{}":status.optJSONObject("learning").toString())',
    '.putString("v9599_learning",status.optJSONObject("learning")==null?"{}":status.optJSONObject("learning").toString())\n'
    '            .putString("r2544_57_top3",status.optJSONObject("top3")==null?"{}":status.optJSONObject("top3").toString())\n'
    '            .putString("r2544_57_run",status.optJSONObject("tradingMode")==null||status.optJSONObject("tradingMode").optJSONObject("run")==null?"{}":status.optJSONObject("tradingMode").optJSONObject("run").toString())\n'
    '            .putLong("r2544_57_status_ts",System.currentTimeMillis())')

# ---------------------------------------------------------------- periodic sync: sizing only
main = replace(main,
    'org.json.JSONObject cfg=BrainHubClient.configureLeaderAuto(this,sp.getBoolean("v9576_auto_enabled",false),m,l,syncMaxPositions,',
    'org.json.JSONObject cfg=BrainHubClient.syncLeaderAutoSizing(this,m,l,syncMaxPositions,')

# ---------------------------------------------------------------- lanes card (after the desk card)
main = replace(main,
    '        try { v95127InstallDeskStatsCard(); } catch (Throwable ignored) {}',
    '        try { v95127InstallDeskStatsCard(); } catch (Throwable ignored) {}\n'
    '        try { v95132InstallLanesCard(); } catch (Throwable ignored) {} // V95132_R2544_57_LANES')

card = r'''    // V95132_R2544_57_LANES: "Hatlar & Ilk 3 Avcisi" card. The phone selects lanes and switches the PC run; the PC alone
    // places orders. Every action asks for confirmation; LIVE actions say GERCEK PARA.
    private final java.util.concurrent.ExecutorService v95132Io=java.util.concurrent.Executors.newSingleThreadExecutor();
    private void v95132InstallLanesCard() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        long now = System.currentTimeMillis();
        String bodyText = V95113PcTruth.lanesText(sp, now);
        org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        boolean normalOn = lanes != null && lanes.optJSONObject("normal") != null && lanes.optJSONObject("normal").optBoolean("selected", false);
        boolean top3On = lanes != null && lanes.optJSONObject("top3") != null && lanes.optJSONObject("top3").optBoolean("selected", false);
        String normalLabel = "Normal sistem (JEV): " + (normalOn ? "AÇIK" : "KAPALI");
        String top3Label = "İlk 3 Avcısı: " + (top3On ? "AÇIK" : "KAPALI");
        for (int i = 0; i < root.getChildCount(); i++) {
            android.view.View v = root.getChildAt(i);
            if ("v95132_lanes_card".equals(String.valueOf(v.getTag())) && v instanceof android.widget.LinearLayout) {
                android.view.View body = v.findViewWithTag("v95132_lanes_body");
                if (body instanceof android.widget.TextView) ((android.widget.TextView) body).setText(v95127Styled(bodyText));
                android.view.View bn = v.findViewWithTag("v95132_btn_normal");
                if (bn instanceof Button) ((Button) bn).setText(normalLabel);
                android.view.View bt = v.findViewWithTag("v95132_btn_top3");
                if (bt instanceof Button) ((Button) bt).setText(top3Label);
                return;
            }
        }
        android.widget.LinearLayout card = new android.widget.LinearLayout(this);
        card.setTag("v95132_lanes_card");
        card.setOrientation(android.widget.LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(11), dp(14), dp(12));
        card.setBackground(v95126Card(android.graphics.Color.rgb(16, 32, 44), android.graphics.Color.rgb(79, 163, 209)));
        android.widget.TextView head = text("🧭 HATLAR & 🎯 İLK 3 AVCISI • PC", 13.8f, android.graphics.Color.WHITE, true);
        card.addView(head, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        android.widget.TextView body = text("", 12.0f, android.graphics.Color.rgb(226, 232, 240), false);
        body.setTag("v95132_lanes_body");
        body.setLineSpacing(0f, 1.12f);
        body.setText(v95127Styled(bodyText));
        android.widget.LinearLayout.LayoutParams bp = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.setMargins(0, dp(6), 0, dp(6));
        card.addView(body, bp);
        android.widget.LinearLayout row1 = new android.widget.LinearLayout(this);
        row1.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        Button bNormal = button(normalLabel, android.graphics.Color.rgb(30, 64, 95));
        bNormal.setTag("v95132_btn_normal");
        bNormal.setOnClickListener(v -> v95132Lane("normal", "Normal sistem (JEV)"));
        Button bTop3 = button(top3Label, android.graphics.Color.rgb(30, 64, 95));
        bTop3.setTag("v95132_btn_top3");
        bTop3.setOnClickListener(v -> v95132Lane("top3", "İlk 3 Avcısı"));
        android.widget.LinearLayout.LayoutParams half = new android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        half.setMargins(dp(2), dp(2), dp(2), dp(2));
        row1.addView(bNormal, half);
        row1.addView(bTop3, new android.widget.LinearLayout.LayoutParams(half));
        card.addView(row1, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        android.widget.LinearLayout row2 = new android.widget.LinearLayout(this);
        row2.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        Button bLive = button("CANLI’ya geç", android.graphics.Color.rgb(127, 29, 29));
        bLive.setOnClickListener(v -> v95132GoLive());
        Button bTest = button("TEST’e dön", android.graphics.Color.rgb(30, 64, 95));
        bTest.setOnClickListener(v -> v95132Run("GO_TEST", "CANLI’yı kapat — TEST’e dön", "Yeni gerçek işlem açılmaz; açık gerçek işlemler kendi kurallarıyla kapanınca TEST’e dönülür.", false));
        Button bStart = button("TEST’i başlat", android.graphics.Color.rgb(22, 101, 52));
        bStart.setOnClickListener(v -> v95132Run("START_TEST", "TEST’i başlat", "Sanal hesap seçili hatlarla çalışır (emir Binance’e gitmez).", false));
        Button bStop = button("Durdur", android.graphics.Color.rgb(68, 64, 60));
        bStop.setOnClickListener(v -> v95132Run("STOP", "Durdur", "Her şey durur (yeni giriş yok). TEST’te sanal pozisyonlar kapatılır; CANLI’da açık gerçek pozisyonun stop/hedef emirleri yerinde kalır.", false));
        android.widget.LinearLayout.LayoutParams q = new android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        q.setMargins(dp(2), dp(2), dp(2), dp(2));
        row2.addView(bLive, q);
        row2.addView(bTest, new android.widget.LinearLayout.LayoutParams(q));
        row2.addView(bStart, new android.widget.LinearLayout.LayoutParams(q));
        row2.addView(bStop, new android.widget.LinearLayout.LayoutParams(q));
        card.addView(row2, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        int insert = -1;
        for (int i = 0; i < root.getChildCount(); i++) {
            if ("v95127_desk_card".equals(String.valueOf(root.getChildAt(i).getTag()))) { insert = i + 1; break; }
        }
        if (insert < 0) insert = Math.min(4, root.getChildCount());
        android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), 0, dp(8));
        root.addView(card, Math.max(0, Math.min(insert, root.getChildCount())), lp);
    }

    private void v95132Lane(final String key, final String label) {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        final org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        if (lanes == null) { Toast.makeText(this, "PC hat bilgisi henüz yok (PC R2544.57 gerekir).", Toast.LENGTH_LONG).show(); return; }
        final org.json.JSONObject lane = lanes.optJSONObject(key);
        final boolean on = lane != null && lane.optBoolean("selected", false);
        final boolean live = "LIVE".equals(lanes.optString("mode", ""));
        String msg = on ? (label + " kapatılsın mı?\n\nYeni giriş durur; açık işlemler kendi kurallarıyla yönetilmeye devam eder.")
                        : (label + " açılsın mı?\n\n" + (live ? "PC CANLI modda: GERÇEK PARA ile işlem açar." : "PC TEST modunda (sanal hesap)."));
        new AlertDialog.Builder(this).setTitle(label).setMessage(msg)
            .setPositiveButton(on ? "KAPAT" : (live ? "AÇ — GERÇEK PARA" : "AÇ"), (d, w) -> v95132Io.execute(() -> {
                String res;
                try {
                    org.json.JSONObject out = BrainHubClient.selectLanes(this, "normal".equals(key) ? Boolean.valueOf(!on) : null,
                        "top3".equals(key) ? Boolean.valueOf(!on) : null, live && !on);
                    res = out.optBoolean("ok", false) ? (label + (on ? " kapatıldı" : " açıldı")) : ("Yapılmadı: " + V95113PcTruth.reasons(out));
                } catch (Throwable e) { res = "PC'ye ulaşılamadı: " + V95113PcTruth.err(e); }
                v95132Done(sp, res);
            }))
            .setNegativeButton("Vazgeç", null).show();
    }

    private void v95132GoLive() {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        if (lanes == null) { Toast.makeText(this, "PC hat bilgisi henüz yok (PC R2544.57 gerekir).", Toast.LENGTH_LONG).show(); return; }
        boolean n = lanes.optJSONObject("normal") != null && lanes.optJSONObject("normal").optBoolean("selected", false);
        boolean t = lanes.optJSONObject("top3") != null && lanes.optJSONObject("top3").optBoolean("selected", false);
        if (!n && !t) { Toast.makeText(this, "Önce en az bir hat seçin: Normal sistem (JEV) veya İlk 3 Avcısı.", Toast.LENGTH_LONG).show(); return; }
        v95132Run("GO_LIVE", "CANLI’YA GEÇ — GERÇEK PARA",
            "Seçili hatlar: Normal sistem (JEV) " + (n ? "AÇIK" : "KAPALI") + " • İlk 3 Avcısı " + (t ? "AÇIK" : "KAPALI")
            + "\n\nSanal pozisyonlar kapatılır, PC Binance bakiyenizle GERÇEK PARA işlem açar. Bakiye ve açık pozisyon PC’de kontrol edilir.", true);
    }

    private void v95132Run(final String action, final String title, final String msg, final boolean liveConfirm) {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        new AlertDialog.Builder(this).setTitle(title).setMessage(msg)
            .setPositiveButton("ONAYLA", (d, w) -> v95132Io.execute(() -> {
                String res;
                try {
                    org.json.JSONObject out = BrainHubClient.runControl(this, action, liveConfirm);
                    res = out.optBoolean("ok", false) ? (title + ": PC kabul etti") : ("Yapılmadı: " + V95113PcTruth.reasons(out));
                } catch (Throwable e) { res = "PC'ye ulaşılamadı: " + V95113PcTruth.err(e); }
                v95132Done(sp, res);
            }))
            .setNegativeButton("Vazgeç", null).show();
    }

    private void v95132Done(final android.content.SharedPreferences sp, final String res) {
        sp.edit().putString("r2544_57_last_action", res + " • " + V95113PcTruth.hhmmss(System.currentTimeMillis())).apply();
        try { BrainHubClient.liveStatus(this); } catch (Throwable ignored) {}
        runOnUiThread(() -> {
            Toast.makeText(this, res, Toast.LENGTH_LONG).show();
            try { v95132InstallLanesCard(); } catch (Throwable ignored) {}
        });
    }

'''
main = replace(main, '    private void v95127InstallDeskStatsCard() {', card + '    private void v95127InstallDeskStatsCard() {')

# ---------------------------------------------------------------- PC truth text
lanes_text = r'''    // V95132_R2544_57_LANES: lanes + Ilk 3 Avcisi summary (from /live/status?compact=1).
    public static String lanesText(SharedPreferences sp, long now) {
        StringBuilder b = new StringBuilder();
        JSONObject run = json(sp == null ? "" : sp.getString("r2544_57_run", "{}"));
        JSONObject lanes = run.optJSONObject("lanes");
        JSONObject t = json(sp == null ? "" : sp.getString("r2544_57_top3", "{}"));
        long at = sp == null ? 0L : sp.getLong("r2544_57_status_ts", 0L);
        if (lanes == null) { b.append("⚠ PC hat bilgisi yok (PC R2544.57 kurulunca görünür)"); return b.toString(); }
        if (at > 0 && now - at > 60000L) b.append("⚠ PC durumu ").append((now - at) / 1000L).append(" sn önceki\n");
        JSONObject n = lanes.optJSONObject("normal"), h = lanes.optJSONObject("top3");
        boolean nOn = n != null && n.optBoolean("selected", false), hOn = h != null && h.optBoolean("selected", false);
        b.append("LIVE".equals(lanes.optString("mode", "")) ? "⚠ MOD: CANLI (gerçek para)" : "MOD: TEST (sanal)").append(" • ").append(v95132StateTr(run.optString("state", "")));
        b.append("\n").append(nOn ? "🟢" : "🔴").append(" Normal sistem (yalnız JEV karar verir): ").append(nOn ? "SEÇİLİ" : "kapalı")
         .append(n != null && n.optBoolean("active", false) ? " • çalışıyor" : "");
        b.append("\n").append(hOn ? "🟢" : "🔴").append(" İlk 3 Avcısı: ").append(hOn ? "SEÇİLİ" : "kapalı")
         .append(h != null && h.optBoolean("active", false) ? " • çalışıyor" : "")
         .append(h != null && "RULE_PLUS_JEV".equals(h.optString("decisions", "")) ? " • JEV’li" : " • JEV’siz");
        if (t.length() > 0) {
            b.append("\n\n🎯 İLK 3 AVCISI");
            JSONObject w = t.optJSONObject("testWindow");
            if (w != null && !"LIVE".equals(t.optString("tradingMode", ""))) {
                int rm = w.optInt("remainingMin", 0);
                b.append("\n24 saatlik test: ").append(w.optBoolean("done", false) ? "BİTTİ" : String.format(java.util.Locale.US, "%.1f / 24 saat • kalan %d sa %d dk", w.optDouble("elapsedH", 0), rm / 60, rm % 60))
                 .append("\n     ").append(w.optInt("okScans", 0)).append("/").append(w.optInt("scans", 0)).append(" tarama • ")
                 .append(w.optInt("signals", 0)).append(" sinyal • ").append(w.optInt("entries", 0)).append(" işlem");
            }
            JSONObject st = t.optJSONObject("settings");
            if (st != null) b.append("\nMarj: ").append(st.optBoolean("marginAuto", true) ? "otomatik" : String.format(java.util.Locale.US, "%.0f USDT", st.optDouble("marginQuote", 0)))
                .append(" • kaldıraç ").append(st.optInt("leverage", 10)).append("x (LONG etkin ").append(st.optInt("effectiveLong", 10)).append("x)");
            JSONArray a = t.optJSONArray("active");
            b.append("\nAçık İlk 3 işlemi: ").append(a == null ? 0 : a.length());
            if (a != null) for (int i = 0; i < Math.min(8, a.length()); i++) {
                JSONObject x = a.optJSONObject(i);
                if (x == null) continue;
                double pnl = num(x, "unrealizedPnl");
                b.append("\n").append(Double.isNaN(pnl) || pnl >= 0 ? "🟢" : "🔴").append(" ").append(str(x, "symbol")).append(" ").append(str(x, "side"))
                 .append("REPEAT".equals(x.optString("signalKind", "")) ? " • TEKRAR" : "")
                 .append(" • ").append(Double.isNaN(pnl) ? "—" : String.format(java.util.Locale.US, "%+.2f $", pnl))
                 .append("\n     giriş ").append(px(num(x, "entryPrice"))).append(" • stop ").append(px(num(x, "stopPrice")))
                 .append(" • hedef ").append(px(num(x, "tpPrice"))).append(" • kalan ").append(x.optInt("remainingMin", 0) / 60).append(" sa");
            }
            JSONObject r = t.optJSONObject("results");
            JSONObject rt = r == null ? null : r.optJSONObject("test"), rl = r == null ? null : r.optJSONObject("live");
            if (rt != null) b.append("\nTEST sonuçları (30 g): ").append(rt.optInt("closed", 0)).append(" işlem • ").append(rt.optInt("wins", 0)).append(" kazanç / ")
                .append(rt.optInt("losses", 0)).append(" kayıp • net ").append(String.format(java.util.Locale.US, "%+.2f $", rt.optDouble("netPnl", 0)));
            if (rl != null) b.append("\nCANLI sonuçları (30 g): ").append(rl.optInt("closed", 0)).append(" işlem • ").append(rl.optInt("wins", 0)).append(" kazanç / ")
                .append(rl.optInt("losses", 0)).append(" kayıp • net ").append(String.format(java.util.Locale.US, "%+.2f $", rl.optDouble("netPnl", 0)));
            JSONObject L = t.optJSONObject("learning");
            if (L != null) b.append("\nİlk 3 hafızası: ").append(L.optInt("lessons", 0)).append(" ders");
        }
        String last = sp == null ? "" : sp.getString("r2544_57_last_action", "");
        if (!last.isEmpty()) b.append("\n\nSon telefon komutu: ").append(last);
        b.append("\nEmirleri yalnız PC yürütür; telefon hat seçer, PC’yi başlatır/durdurur ve izler.");
        return b.toString();
    }
    static String v95132StateTr(String s) {
        if ("TEST_RUNNING".equals(s)) return "TEST ÇALIŞIYOR";
        if ("LIVE_RUNNING".equals(s)) return "CANLI ÇALIŞIYOR";
        if ("STOPPED".equals(s)) return "DURDURULDU";
        if ("CLOSING_TEST".equals(s)) return "CANLIYA GEÇİLİYOR";
        if ("LIVE_WIND_DOWN".equals(s)) return "CANLIDAN ÇIKILIYOR";
        if ("RESETTING_TEST".equals(s)) return "TEST SIFIRLANIYOR";
        if ("HALF_ON".equals(s)) return "YARIM AÇIK";
        return s.isEmpty() ? "—" : s;
    }

'''
truth = replace(truth, '    private static JSONArray v95129AllDesks(JSONObject src) throws Exception {',
                lanes_text + '    private static JSONArray v95129AllDesks(JSONObject src) throws Exception {')

# ---------------------------------------------------------------- version
build = replace(build, 'versionCode 26100402', 'versionCode 26101301')
build = replace(build, "versionName '9.5.123-r2544.35-pc-sync-ui'", "versionName '9.5.124-r2544.57-lanes'")

main = main.rstrip('\n') + '\n// ' + MARKER + '\n'
truth = truth.rstrip('\n') + '\n// ' + MARKER + '\n'
MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + ' applied')
