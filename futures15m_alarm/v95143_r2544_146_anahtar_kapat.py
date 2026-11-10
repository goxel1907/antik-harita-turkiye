"""R2544.146 (user 10.11: "uygulamadan IP değişirse Binance'te API girip ... açık olan pozları istersem hem uygulamadan hem office'ten
kapatabilmek"; "officeden api girme olmasın, eskisi gibi uygulamadan").
Source-generation patch after V95142. The lanes card gets:
  - "API ANAHTARINI PC'YE KAYDET": the key / secret already saved (encrypted) in the phone's Binance API dialog is sent to the PC
    (POST /live/credentials over the paired PC link). The PC tests it read-only on Binance BEFORE saving it with DPAPI; the answer
    carries only the last 4 characters. The orders run on the PC, so the PC's internet address must be on the key's IP list.
  - an open-lot list (İlk 3 + ZİRVE-5) with a KAPAT button per lot: the PC closes it (market, reduce-only, stop / target cancelled);
    LIVE asks GERÇEK PARA and sends confirm LIVE. The phone never places an order itself.
  - the PC label says "PC TEST ÇALIŞIYOR (CANLI KAPALI)" while TEST runs (it said "PC LIVE: AÇIK" for a running TEST).
Codemagic keeps the check that Android never posts /live/execute or /live/burst.
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
TRUTH = JAVA / 'V95113PcTruth.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95143_R2544_146_ANAHTAR'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95143 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
truth = TRUTH.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95142_R2544_142_HATLAR' not in main:
    raise SystemExit('V95143 requires V95142')
if MARKER in main:
    raise SystemExit('V95143 already applied')

# ------------------------------------------------------------------ client
client = replace(client,
    '    public static JSONObject selectLanesBody(Context c, JSONObject body, boolean liveConfirm) throws Exception {\n',
    '    // V95143_R2544_146_ANAHTAR: the phone\'s saved Binance key to the PC (tested on Binance by the PC before it is saved).\n'
    '    public static JSONObject sendCredentials(Context c, String apiKey, String apiSecret) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put("apiKey", apiKey);\n'
    '        body.put("apiSecret", apiSecret);\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "/live/credentials", body, true);\n'
    '    }\n'
    '    // V95143: ask the PC to close one İlk 3 / ZİRVE-5 lot (the PC sends the reduce-only order; LIVE needs confirm LIVE).\n'
    '    public static JSONObject closeLot(Context c, String id, boolean liveConfirm) throws Exception {\n'
    '        check(c);\n'
    '        JSONObject body = new JSONObject();\n'
    '        body.put("id", id);\n'
    '        if (liveConfirm) body.put("confirm", "LIVE");\n'
    '        body.put("source", "APK");\n'
    '        return post(c, "/live/position/close", body, true);\n'
    '    }\n'
    '    public static JSONObject selectLanesBody(Context c, JSONObject body, boolean liveConfirm) throws Exception {\n')

# ------------------------------------------------------------------ PC label: a running TEST is not LIVE
truth = replace(truth,
    '            return "PC LIVE: AÇIK (kalan " + (m < 0 ? "?" : Long.toString(m)) + " dk)";\n',
    '            if ("TEST".equals(v95143Mode(sp))) return "PC TEST ÇALIŞIYOR (CANLI KAPALI • gerçek para yok)"; // V95143_R2544_146_ANAHTAR\n'
    '            return "PC LIVE: AÇIK (kalan " + (m < 0 ? "?" : Long.toString(m)) + " dk)";\n')
helper = r'''
    // V95143_R2544_146_ANAHTAR: the PC trading mode from the last lane status (TEST / LIVE / "")
    static String v95143Mode(SharedPreferences sp) {
        if (sp == null) return "";
        JSONObject run = json(sp.getString("r2544_57_run", "{}"));
        JSONObject lanes = run.optJSONObject("lanes");
        String m = lanes == null ? "" : lanes.optString("mode", "");
        return m == null ? "" : m;
    }
'''
idx = truth.rfind('}')
truth = truth[:idx] + helper + truth[idx:]

# ------------------------------------------------------------------ lanes card: key button + open lots with KAPAT
main = replace(main,
    '        card.addView(rowSub, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n',
    '        card.addView(rowSub, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        Button bKey = button("🔑 API ANAHTARINI PC\'YE KAYDET", android.graphics.Color.rgb(68, 64, 60)); // V95143_R2544_146_ANAHTAR\n'
    '        bKey.setOnClickListener(v -> v95143SendKeys());\n'
    '        card.addView(bKey, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        android.widget.LinearLayout lots = new android.widget.LinearLayout(this);\n'
    '        lots.setOrientation(android.widget.LinearLayout.VERTICAL);\n'
    '        lots.setTag("v95143_lots");\n'
    '        card.addView(lots, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));\n'
    '        v95143FillLots(lots);\n')
main = replace(main,
    '                if (bb instanceof Button) ((Button) bb).setText(sbLabel);\n',
    '                if (bb instanceof Button) ((Button) bb).setText(sbLabel);\n'
    '                android.view.View lv = v.findViewWithTag("v95143_lots"); // V95143_R2544_146_ANAHTAR\n'
    '                if (lv instanceof android.widget.LinearLayout) v95143FillLots((android.widget.LinearLayout) lv);\n')

methods = r'''    // V95143_R2544_146_ANAHTAR: one KAPAT button per open İlk 3 / ZİRVE-5 lot (from the PC's compact status; the PC closes it)
    private void v95143FillLots(android.widget.LinearLayout box) {
        if (box == null) return;
        box.removeAllViews();
        android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        org.json.JSONObject run = V95113PcTruth.json(sp.getString("r2544_57_run", "{}"));
        org.json.JSONObject lanes = run.optJSONObject("lanes");
        final boolean live = lanes != null && "LIVE".equals(lanes.optString("mode", ""));
        String[][] src = {{"r2544_57_top3", "İlk 3"}, {"r2544_76_z5", "ZİRVE-5"}};
        int n = 0;
        for (String[] s : src) {
            org.json.JSONArray arr = V95113PcTruth.json(sp.getString(s[0], "{}")).optJSONArray("active");
            if (arr == null) continue;
            for (int i = 0; i < arr.length(); i++) {
                final org.json.JSONObject a = arr.optJSONObject(i);
                if (a == null) continue;
                final String id = a.optString("id", ""), sym = a.optString("symbol", "").replace("USDT", "");
                if (id.isEmpty()) continue;
                double pnl = a.optDouble("unrealizedPnl", Double.NaN);
                String money = Double.isNaN(pnl) ? "" : String.format(java.util.Locale.US, " • %s%.2f $", pnl >= 0 ? "+" : "", pnl);
                Button b = button("✖ KAPAT • " + sym + " " + a.optString("side", "") + " (" + s[1] + ")" + money,
                    pnl < 0 ? android.graphics.Color.rgb(127, 29, 29) : android.graphics.Color.rgb(22, 101, 52));
                final String label = sym + " " + a.optString("side", "");
                b.setOnClickListener(v -> v95143Close(id, label, live));
                box.addView(b, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
                n++;
            }
        }
        if (n == 0) {
            android.widget.TextView t = text("Açık İlk 3 / ZİRVE-5 pozisyonu yok.", 11.5f, android.graphics.Color.rgb(148, 163, 184), false);
            box.addView(t, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        }
    }

    private void v95143Close(final String id, final String label, final boolean live) {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        String msg = label + " piyasa fiyatından kapatılsın mı?\n\nPC kapatır: stop ve hedef emirleri silinir."
            + (live ? "\n\nCANLI: GERÇEK PARA pozisyonu kapanır." : "\n\nTEST (sanal hesap).");
        new AlertDialog.Builder(this).setTitle("Pozisyonu kapat").setMessage(msg)
            .setPositiveButton(live ? "KAPAT — GERÇEK PARA" : "KAPAT", (d, w) -> v95132Io.execute(() -> {
                String res;
                try {
                    org.json.JSONObject out = BrainHubClient.closeLot(this, id, live);
                    if (!out.optBoolean("ok", false)) {
                        try { out = BrainHubClient.closeLot(this, id, live); } catch (Throwable ignored) {} // one retry: a dropped link changed nothing
                    }
                    res = out.optBoolean("ok", false) ? (label + ": kapatma emri PC'de" + (out.optBoolean("closed", false) ? " • KAPANDI" : " • birkaç saniye içinde kapanır"))
                        : ("Yapılmadı: " + V95113PcTruth.reasons(out));
                } catch (Throwable e) { res = "PC'ye ulaşılamadı: " + V95113PcTruth.err(e); }
                v95132Done(sp, res);
            }))
            .setNegativeButton("Vazgeç", null).show();
    }

    // V95143_R2544_146_ANAHTAR: the key saved in the phone's Binance API dialog goes to the PC (tested there before it is saved)
    private void v95143SendKeys() {
        final android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        String msg = "Telefondaki Binance API penceresinde kayıtlı anahtar ve secret PC'ye gönderilir.\n\n"
            + "PC önce anahtarı Binance'te emir göndermeden sınar; geçerse şifreli kaydeder ve hemen kullanır.\n\n"
            + "Emirleri PC gönderir: anahtarın IP listesinde PC'nin internet adresi olmalı.\n\n"
            + "CANLI çalışırken değiştirilmez (önce TEST'e dön).";
        new AlertDialog.Builder(this).setTitle("API anahtarını PC'ye kaydet").setMessage(msg)
            .setPositiveButton("GÖNDER", (d, w) -> v95132Io.execute(() -> {
                String res;
                try {
                    String[] cr = v9522Credentials();
                    org.json.JSONObject out = BrainHubClient.sendCredentials(this, cr[0], cr[1]);
                    cr[0] = ""; cr[1] = "";
                    if (out.optBoolean("ok", false)) {
                        res = "PC anahtarı kaydetti (…" + out.optString("keyTail", "") + ") • Binance cüzdan "
                            + String.format(java.util.Locale.US, "%.2f", out.optDouble("walletBalance", 0)) + " USDT • kullanılabilir "
                            + String.format(java.util.Locale.US, "%.2f", out.optDouble("availableBalance", 0)) + " USDT";
                    } else {
                        org.json.JSONObject det = out.optJSONObject("detail");
                        String bmsg = det == null ? "" : (" • Binance " + det.optString("code", "") + " " + det.optString("msg", ""));
                        res = "Yapılmadı: " + V95113PcTruth.reasons(out) + bmsg
                            + ("BINANCE_REJECTED_NEW_KEY".equals(out.optJSONArray("reasons") == null ? "" : out.optJSONArray("reasons").optString(0, ""))
                                ? "\nPC'nin internet adresini Binance'te anahtarın IP listesine ekle." : "");
                    }
                } catch (Throwable e) { res = "Gönderilemedi: " + V95113PcTruth.err(e); }
                v95132Done(sp, res);
            }))
            .setNegativeButton("Vazgeç", null).show();
    }

    private void v95142SubLane(final String key, final String label) {
'''
main = replace(main, '    private void v95142SubLane(final String key, final String label) {\n', methods)

build = replace(build, 'versionCode 26111001', 'versionCode 26111002')
build = replace(build, "versionName '9.5.134-r2544.142-hatlar'", "versionName '9.5.135-r2544.146-anahtar'")

MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
TRUTH.write_text(truth, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
