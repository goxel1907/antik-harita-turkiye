"""R2544.148 KEŞİF (user 11.11: "beyin o andaki grafiği, coinin verilerini her şeyini alıp matrixte olasılıklarına bakacak, modeller ile
birlikte hem modeller öğrenecek hem beyin ... apk ve office'i buna göre güncelle").
Source-generation patch after V95148. A card under the open-position card:
  - the brain's matrix: how many labelled rounds of the 20 it needs, up / down / flat counts, how many formations it has seen;
  - the last round: the coin, why it was chosen, how many models answered, and every forecast (direction, stop %, target %, hours);
  - the forward karne: who has been right so far (results, hit %, average R, without the best trade, state).
Data: the PC's compact status (new key `kesif`, stored as r2544_148_kesif). Read-only: the phone never places an order and the switch stays
in Office.
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
CLIENT = JAVA / 'BrainHubClient.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95149_R2544_148_KESIF'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95149 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
client = CLIENT.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95148_R2544_147_KAYDET' not in main:
    raise SystemExit('V95149 requires V95148')
if MARKER in main:
    raise SystemExit('V95149 already applied')

client = replace(client,
    '            .putString("r2544_129_funnel",status.optJSONObject("funnel")==null?"{}":status.optJSONObject("funnel").toString())\n',
    '            .putString("r2544_129_funnel",status.optJSONObject("funnel")==null?"{}":status.optJSONObject("funnel").toString())\n'
    '            .putString("r2544_148_kesif",status.optJSONObject("kesif")==null?"{}":status.optJSONObject("kesif").toString()) // V95149_R2544_148_KESIF\n')

main = replace(main,
    '        try { v95146InstallPositionCard(); } catch (Throwable ignored) {} // V95146_R2544_147_POZ_KART\n',
    '        try { v95146InstallPositionCard(); } catch (Throwable ignored) {} // V95146_R2544_147_POZ_KART\n'
    '        try { v95149InstallKesifCard(); } catch (Throwable ignored) {} // V95149_R2544_148_KESIF\n')

methods = r'''    // V95149_R2544_148_KESIF: the models' own forecasts, the brain's live matrix and the forward karne (read-only, shadow)
    private android.animation.ValueAnimator v95149Anim;
    private static String v95149St(String s) {
        if (s == null) return "";
        switch (s) { case "SOZ_SAHIBI": return "söz sahibi"; case "ADAY": return "aday"; case "KANITSIZ": return "kanıtsız"; case "YENI": return "yeni"; default: return s; }
    }
    private static String v95149R(double v) {
        if (Double.isNaN(v)) return "—";
        return String.format(java.util.Locale.US, "%+.2fR", v);
    }
    private void v95149InstallKesifCard() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        org.json.JSONObject k = V95113PcTruth.json(sp.getString("r2544_148_kesif", "{}"));
        android.widget.LinearLayout card = null;
        int posIdx = -1;
        for (int i = 0; i < root.getChildCount(); i++) {
            android.view.View v = root.getChildAt(i);
            String tag = String.valueOf(v.getTag());
            if ("v95149_kesif_card".equals(tag) && v instanceof android.widget.LinearLayout) card = (android.widget.LinearLayout) v;
            if ("v95146_pos_card".equals(tag) && v.getVisibility() == android.view.View.VISIBLE) posIdx = i;
        }
        if (k.length() == 0 || !k.has("mx")) { if (card != null) card.setVisibility(android.view.View.GONE); return; }
        if (card == null) {
            card = new android.widget.LinearLayout(this);
            card.setTag("v95149_kesif_card");
            card.setOrientation(android.widget.LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            final android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
            bg.setCornerRadius(dp(16));
            bg.setColor(android.graphics.Color.rgb(13, 10, 32));
            card.setBackground(bg);
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, dp(4), 0, dp(10));
            root.addView(card, Math.min(root.getChildCount(), posIdx + 1), lp);
            v95149Anim = android.animation.ValueAnimator.ofObject(new android.animation.ArgbEvaluator(), android.graphics.Color.rgb(76, 29, 149), android.graphics.Color.rgb(46, 197, 255));
            v95149Anim.setDuration(1800);
            v95149Anim.setRepeatCount(android.animation.ValueAnimator.INFINITE);
            v95149Anim.setRepeatMode(android.animation.ValueAnimator.REVERSE);
            v95149Anim.addUpdateListener(an -> bg.setStroke(dp(2), (Integer) an.getAnimatedValue()));
            v95149Anim.start();
        }
        card.setVisibility(android.view.View.VISIBLE);
        card.removeAllViews();
        boolean on = k.optBoolean("on", false);
        card.addView(text("🔭 KEŞİF • modellerin kendi tahmini + beynin matrisi" + (on ? "" : "  •  KAPALI (Office'ten açılır)"), 13.5f, android.graphics.Color.rgb(196, 181, 253), true));
        card.addView(text("gölge: işlem açmaz, emir göndermez • her " + k.optInt("min", 15) + " dk bir coin, sonuç gerçek mumlarla puanlanır", 11f, android.graphics.Color.rgb(148, 163, 184), false));
        org.json.JSONObject mx = k.optJSONObject("mx");
        int n = mx == null ? 0 : mx.optInt("n", 0), need = mx == null ? 20 : Math.max(1, mx.optInt("need", 20));
        android.widget.LinearLayout.LayoutParams gap = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        gap.setMargins(0, dp(8), 0, 0);
        card.addView(text("🧠 BEYNİN MATRİSİ: " + n + "/" + need + " etiket" + (n >= need ? " • hazır, kendi tahminini yapıyor" : " • öğreniyor")
            + (mx == null ? "" : "\nyukarı önce " + mx.optInt("up", 0) + " • aşağı önce " + mx.optInt("dn", 0) + " • yatay " + mx.optInt("fl", 0) + " • " + mx.optInt("f", 0) + " farklı oluşum"),
            12.5f, android.graphics.Color.WHITE, true), gap);
        android.widget.ProgressBar bar = new android.widget.ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(need);
        bar.setProgress(Math.min(need, n));
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(android.graphics.Color.rgb(167, 139, 250)));
        android.widget.LinearLayout.LayoutParams bl = new android.widget.LinearLayout.LayoutParams(-1, dp(10));
        bl.setMargins(0, dp(6), 0, dp(2));
        card.addView(bar, bl);
        org.json.JSONObject last = k.optJSONObject("last");
        if (last != null) {
            StringBuilder b = new StringBuilder("📍 SON TUR: " + last.optString("s", "?") + " • " + last.optString("why", "") + " • " + last.optInt("a", 0) + "/" + last.optInt("q", 0) + " model");
            org.json.JSONArray fs = last.optJSONArray("f");
            if (fs != null) for (int i = 0; i < fs.length(); i++) {
                org.json.JSONObject f = fs.optJSONObject(i); if (f == null) continue;
                String d = f.optString("d", "");
                b.append("\n").append("LONG".equals(d) ? "▲ " : "SHORT".equals(d) ? "▼ " : "• ").append(f.optString("m", "?")).append(": ");
                if ("NONE".equals(d)) b.append("hamle yok");
                else b.append(d).append(" stop %").append(f.optDouble("s", 0)).append(" hedef %").append(f.optDouble("g", 0)).append(" ").append(f.optDouble("h", 0)).append(" sa");
            }
            android.widget.TextView tl = text(b.toString(), 12f, android.graphics.Color.rgb(203, 213, 225), false);
            tl.setPadding(dp(10), dp(8), dp(10), dp(8));
            android.graphics.drawable.GradientDrawable db = new android.graphics.drawable.GradientDrawable();
            db.setCornerRadius(dp(10)); db.setColor(android.graphics.Color.rgb(24, 22, 52));
            tl.setBackground(db);
            android.widget.LinearLayout.LayoutParams dl = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            dl.setMargins(0, dp(8), 0, 0);
            card.addView(tl, dl);
        }
        org.json.JSONArray kr = k.optJSONArray("karne");
        StringBuilder kb = new StringBuilder("🏅 İLERİYE DÖNÜK KARNE");
        if (kr == null || kr.length() == 0) kb.append("\nhenüz sonuçlanan tahmin yok");
        else for (int i = 0; i < kr.length(); i++) {
            org.json.JSONObject r = kr.optJSONObject(i); if (r == null) continue;
            kb.append("\n").append(r.optString("m", "?")).append(": ").append(r.optInt("n", 0)).append(" sonuç");
            if (r.has("hit") && !r.isNull("hit")) kb.append(" • isabet %").append(r.optInt("hit", 0));
            kb.append(" • ort ").append(v95149R(r.optDouble("R", Double.NaN))).append(" • en iyi hariç ").append(v95149R(r.optDouble("x", Double.NaN)))
              .append(" • ").append(v95149St(r.optString("st", "")));
        }
        card.addView(text(kb.toString(), 12f, android.graphics.Color.rgb(253, 224, 71), false), gap);
        // R2544.149: the balance gate (pre-registered: 40 forward results, average, without the best, lower bound, both halves) and the brain's learning proof
        org.json.JSONObject bk = k.optJSONObject("bk");
        if (bk != null) {
            boolean ready = "HAZIR".equals(bk.optString("st", ""));
            card.addView(text((ready ? "💰 BAKİYE ZAMANI: KRİTER GEÇTİ" : "💰 BAKİYE ZAMANI: HENÜZ DEĞİL") + "\n" + bk.optString("t", "") + "\nölçümdür, tavsiye değildir; karar senin",
                12.5f, ready ? android.graphics.Color.rgb(52, 211, 153) : android.graphics.Color.rgb(251, 191, 36), true), gap);
        }
        org.json.JSONObject og = k.optJSONObject("ogr");
        if (og != null) card.addView(text("🔬 Beyin gerçekten öğreniyor mu? " + og.optString("t", ""), 11.5f, android.graphics.Color.rgb(196, 181, 253), false), gap);
        String err = k.optString("err", "");
        if (!err.isEmpty() && !"null".equals(err)) card.addView(text("⚠ " + err, 11f, android.graphics.Color.rgb(248, 113, 113), false));
    }

    private void v95142SubLane(final String key, final String label) {
'''
main = replace(main, '    private void v95142SubLane(final String key, final String label) {\n', methods)

build = replace(build, 'versionCode 26111101', 'versionCode 26111201')
build = replace(build, "versionName '9.5.140-r2544.147-kaydet'", "versionName '9.5.141-r2544.148-kesif'")

MAIN.write_text(main, encoding='utf-8')
CLIENT.write_text(client, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
