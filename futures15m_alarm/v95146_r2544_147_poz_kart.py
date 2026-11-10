"""R2544.147 (user 11.11 01:13: "uygulamaya Office'teki gibi animasyon koyabilir misin, en başa pozisyonu, altına kurulu, pozisyonu kapat
zaten uygulamada yok").
Source-generation patch after V95145. A card at the very top of the main screen, only while an İlk 3 / ZİRVE-5 lot is open:
  - an animated border (green in profit, red in loss; it breathes) and the mode (CANLI • GERÇEK PARA / TEST);
  - per lot: symbol, side, lane, leverage and who chose it; the dollar P&L and R (best R so far); entry / mark / stop / target with the
    dollar value at stop and target; a stop -> target bar with the mark;
  - the position desk's last decision (TUT / ÇIK / YARI AL / STOP ↑, consensus, authority, noise guard) and up to 5 votes, plus the entry
    committee's decision;
  - a KAPAT button per lot (the PC closes it; LIVE asks GERÇEK PARA) - the same path as the lanes card (v95143Close).
Data: the PC's compact status already on the phone (no new request). Android never places an order itself.
"""
from pathlib import Path

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
BUILD = APP / 'app/build.gradle'
MARKER = 'V95146_R2544_147_POZ_KART'


def replace(s, old, new):
    if s.count(old) != 1:
        raise SystemExit('V95146 anchor count %d: %s' % (s.count(old), old[:110]))
    return s.replace(old, new, 1)


main = MAIN.read_text(encoding='utf-8')
build = BUILD.read_text(encoding='utf-8')
if 'V95145_R2544_147_OTO_BASLIK' not in main:
    raise SystemExit('V95146 requires V95145')
if MARKER in main:
    raise SystemExit('V95146 already applied')

main = replace(main,
    '        try { v95132InstallLanesCard(); } catch (Throwable ignored) {} // V95132_R2544_57_LANES',
    '        try { v95132InstallLanesCard(); } catch (Throwable ignored) {} // V95132_R2544_57_LANES\n'
    '        try { v95146InstallPositionCard(); } catch (Throwable ignored) {} // V95146_R2544_147_POZ_KART')

methods = r'''    // V95146_R2544_147_POZ_KART: animated open-position card at the very top (data: the PC compact status already stored)
    private android.animation.ValueAnimator v95146Anim;
    private android.graphics.drawable.GradientDrawable v95146Bg;
    private boolean v95146Loss;
    private static String v95146Act(String a) {
        if (a == null) return "—";
        switch (a) { case "HOLD": return "TUT"; case "EXIT": return "ÇIK"; case "PARTIAL": return "YARI AL"; case "TIGHTEN": case "STOP_UP": return "STOP ↑";
            case "ENTER": case "GO": return "GİR"; case "SKIP": return "GİRME"; default: return a; }
    }
    private static String v95146Cons(String c) {
        if (c == null || c.isEmpty()) return "";
        switch (c) { case "UNANIMOUS": return "oybirliği"; case "STRONG_MAJORITY": return "güçlü çoğunluk"; case "MAJORITY": return "çoğunluk";
            case "DEBATE_MAJORITY": return "tartışma → çoğunluk"; case "SPLIT": return "bölünmüş"; default: return c.toLowerCase(java.util.Locale.ROOT).replace('_', ' '); }
    }
    private static String v95146Usd(double v, boolean sign) {
        if (Double.isNaN(v)) return "—";
        return (v < 0 ? "−" : (sign && v > 0 ? "+" : "")) + String.format(java.util.Locale.US, "%.2f $", Math.abs(v));
    }
    private static String v95146Px(double v) {
        if (Double.isNaN(v) || v <= 0) return "—";
        return v >= 100 ? String.format(java.util.Locale.US, "%.2f", v) : v >= 1 ? String.format(java.util.Locale.US, "%.4f", v) : String.format(java.util.Locale.US, "%.6f", v);
    }
    private void v95146InstallPositionCard() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        org.json.JSONObject lanes = V95113PcTruth.json(sp.getString("r2544_57_run", "{}")).optJSONObject("lanes");
        final boolean live = lanes != null && "LIVE".equals(lanes.optString("mode", ""));
        java.util.List<org.json.JSONObject> lots = new java.util.ArrayList<>();
        java.util.List<String> names = new java.util.ArrayList<>();
        String[][] src = {{"r2544_57_top3", "İlk 3"}, {"r2544_76_z5", "ZİRVE-5"}};
        for (String[] s : src) {
            org.json.JSONArray arr = V95113PcTruth.json(sp.getString(s[0], "{}")).optJSONArray("active");
            if (arr == null) continue;
            for (int i = 0; i < arr.length(); i++) { org.json.JSONObject a = arr.optJSONObject(i); if (a != null && !a.optString("id", "").isEmpty()) { lots.add(a); names.add(s[1]); } }
        }
        android.widget.LinearLayout card = null;
        for (int i = 0; i < root.getChildCount(); i++) {
            android.view.View v = root.getChildAt(i);
            if ("v95146_pos_card".equals(String.valueOf(v.getTag())) && v instanceof android.widget.LinearLayout) { card = (android.widget.LinearLayout) v; break; }
        }
        if (lots.isEmpty()) {
            if (card != null) card.setVisibility(android.view.View.GONE);
            if (v95146Anim != null) { v95146Anim.cancel(); v95146Anim = null; }
            return;
        }
        double total = 0;
        for (org.json.JSONObject a : lots) { double p = a.optDouble("unrealizedPnl", 0); if (!Double.isNaN(p)) total += p; }
        boolean loss = total < 0;
        if (card == null) {
            card = new android.widget.LinearLayout(this);
            card.setTag("v95146_pos_card");
            card.setOrientation(android.widget.LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            v95146Bg = new android.graphics.drawable.GradientDrawable();
            v95146Bg.setCornerRadius(dp(16));
            v95146Bg.setColor(android.graphics.Color.rgb(13, 18, 30));
            card.setBackground(v95146Bg);
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, dp(4), 0, dp(10));
            root.addView(card, 0, lp);
        }
        card.setVisibility(android.view.View.VISIBLE);
        if (v95146Anim == null || v95146Loss != loss) {
            if (v95146Anim != null) v95146Anim.cancel();
            int c1 = loss ? android.graphics.Color.rgb(127, 29, 29) : android.graphics.Color.rgb(20, 83, 45);
            int c2 = loss ? android.graphics.Color.rgb(248, 113, 113) : android.graphics.Color.rgb(74, 222, 128);
            v95146Anim = android.animation.ValueAnimator.ofObject(new android.animation.ArgbEvaluator(), c1, c2);
            v95146Anim.setDuration(1300);
            v95146Anim.setRepeatCount(android.animation.ValueAnimator.INFINITE);
            v95146Anim.setRepeatMode(android.animation.ValueAnimator.REVERSE);
            final android.graphics.drawable.GradientDrawable bg = v95146Bg;
            v95146Anim.addUpdateListener(an -> { if (bg != null) bg.setStroke(dp(2), (Integer) an.getAnimatedValue()); });
            v95146Anim.start();
            v95146Loss = loss;
        }
        card.removeAllViews();
        long age = (System.currentTimeMillis() - sp.getLong("r2544_57_status_ts", 0L)) / 1000L;
        android.widget.TextView head = text("📍 AÇIK POZİSYON • " + (live ? "CANLI • GERÇEK PARA" : "TEST • sanal hesap")
            + (age > 90 ? "  ⚠ PC durumu " + age + " sn önceki" : ""), 13.5f, live ? android.graphics.Color.rgb(252, 165, 165) : android.graphics.Color.rgb(253, 224, 71), true);
        card.addView(head);
        for (int i = 0; i < lots.size(); i++) v95146Lot(card, lots.get(i), names.get(i), live);
    }
    private void v95146Lot(android.widget.LinearLayout card, final org.json.JSONObject a, String lane, final boolean live) {
        final String id = a.optString("id", ""), sym = a.optString("symbol", "").replace("USDT", ""), side = a.optString("side", "");
        double e = a.optDouble("entryPrice", Double.NaN), mk = a.optDouble("markPrice", Double.NaN), st = a.optDouble("stopPrice", Double.NaN), tp = a.optDouble("tpPrice", Double.NaN);
        double pnl = a.optDouble("unrealizedPnl", Double.NaN), risk = a.optDouble("riskQuote", Double.NaN);
        org.json.JSONObject r = a.optJSONObject("r");
        double rNow = r == null ? Double.NaN : r.optDouble("R", Double.NaN), best = r == null ? Double.NaN : r.optDouble("best", Double.NaN);
        String by = a.optString("leverageBy", ""), byTr = "KURUL".equals(by) ? "kurul seçti" : "JEV".equals(by) ? "JEV seçti" : "AYAR".equals(by) ? "ayar" : "";
        android.widget.TextView t1 = text(sym + "  " + ("LONG".equals(side) ? "▲ LONG" : "▼ SHORT") + "  •  " + lane + "  •  " + a.optInt("leverage", 0) + "x" + (byTr.isEmpty() ? "" : " (" + byTr + ")")
            + "  •  marj " + v95146Usd(a.optDouble("marginQuote", Double.NaN), false), 14.5f, android.graphics.Color.WHITE, true);
        android.widget.LinearLayout.LayoutParams gap = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        gap.setMargins(0, dp(8), 0, 0);
        card.addView(t1, gap);
        int pc = Double.isNaN(pnl) ? android.graphics.Color.rgb(203, 213, 225) : pnl >= 0 ? android.graphics.Color.rgb(74, 222, 128) : android.graphics.Color.rgb(248, 113, 113);
        android.widget.TextView t2 = text(v95146Usd(pnl, true) + (Double.isNaN(rNow) ? "" : String.format(java.util.Locale.US, "   %+.2fR", rNow))
            + (Double.isNaN(best) ? "" : String.format(java.util.Locale.US, "   (en iyi %+.2fR)", best)), 24f, pc, true);
        card.addView(t2);
        double sgn = "LONG".equals(side) ? 1 : -1;
        double tR = (!Double.isNaN(e) && !Double.isNaN(st) && !Double.isNaN(tp) && e != st) ? Math.abs(tp - e) / Math.abs(e - st) : Double.NaN;
        String atS = Double.isNaN(risk) ? "" : " (" + v95146Usd(-risk, true) + ")", atT = Double.isNaN(risk) || Double.isNaN(tR) ? "" : " (" + v95146Usd(risk * tR, true) + ")";
        card.addView(text("Giriş " + v95146Px(e) + "  •  Anlık " + v95146Px(mk) + "\nStop " + v95146Px(st) + atS + "  •  Hedef " + v95146Px(tp) + atT,
            12.5f, android.graphics.Color.rgb(203, 213, 225), false));
        if (!Double.isNaN(st) && !Double.isNaN(tp) && !Double.isNaN(mk) && tp != st) {
            android.widget.ProgressBar bar = new android.widget.ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
            bar.setMax(1000);
            double f = Math.max(0, Math.min(1, (mk - st) / (tp - st)));
            bar.setProgress((int) Math.round(f * 1000));
            bar.setProgressTintList(android.content.res.ColorStateList.valueOf(pc));
            android.widget.LinearLayout.LayoutParams bl = new android.widget.LinearLayout.LayoutParams(-1, dp(10));
            bl.setMargins(0, dp(6), 0, dp(2));
            card.addView(bar, bl);
            card.addView(text("stop ◀──────────── fiyat ────────────▶ hedef", 10.5f, android.graphics.Color.rgb(148, 163, 184), false));
        }
        org.json.JSONObject cm = a.optJSONObject("cm");
        org.json.JSONObject desk = cm == null ? null : cm.optJSONObject("desk"), ent = cm == null ? null : cm.optJSONObject("entry");
        if (desk != null) {
            StringBuilder b = new StringBuilder("🤝 MASA: " + v95146Act(desk.optString("a", null)));
            String c = v95146Cons(desk.optString("c", ""));
            if (!c.isEmpty()) b.append("  •  ").append(c);
            b.append(desk.optBoolean("auth", false) ? "  •  YETKİLİ" : "  •  gölge");
            org.json.JSONObject f = desk.optJSONObject("f");
            if (f != null) {
                if (f.optBoolean("guard", false)) b.append("\n⛔ uygulanmadı: gürültü koruması (30 dk dolmadan ya da −0,6R altına inmeden / +1R görmeden çıkmaz)");
                else if (f.optBoolean("pending", false)) b.append("\n⏳ emir yolda");
                else if (f.has("ok")) b.append(f.optBoolean("ok", false) ? "\n✓ uygulandı" : "\n✗ uygulanamadı: " + f.optString("why", ""));
            }
            org.json.JSONArray vs = desk.optJSONArray("v");
            if (vs != null && vs.length() > 0) {
                b.append("\n");
                for (int k = 0; k < vs.length(); k++) { org.json.JSONObject v = vs.optJSONObject(k); if (v == null) continue; b.append(k == 0 ? "" : " · ").append(v.optString("m", "?")).append(": ").append(v95146Act(v.optString("d", null))); }
            }
            String why = desk.optString("t", "");
            if (!why.isEmpty()) b.append("\n“").append(why).append("”");
            int dc = "EXIT".equals(desk.optString("a", "")) ? android.graphics.Color.rgb(252, 165, 165) : "HOLD".equals(desk.optString("a", "")) ? android.graphics.Color.rgb(134, 239, 172) : android.graphics.Color.rgb(253, 224, 71);
            android.widget.TextView td = text(b.toString(), 12.5f, dc, false);
            td.setPadding(dp(10), dp(8), dp(10), dp(8));
            android.graphics.drawable.GradientDrawable db = new android.graphics.drawable.GradientDrawable();
            db.setCornerRadius(dp(10)); db.setColor(android.graphics.Color.rgb(24, 30, 46));
            td.setBackground(db);
            android.widget.LinearLayout.LayoutParams dl = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            dl.setMargins(0, dp(8), 0, 0);
            card.addView(td, dl);
        }
        if (ent != null) {
            String d = ent.optString("cd", ent.optString("d", ""));
            card.addView(text("giriş kurulu: " + v95146Act(d) + (ent.optString("c", "").isEmpty() ? "" : " (" + v95146Cons(ent.optString("c", "")) + ")")
                + (ent.optBoolean("auth", false) ? "" : " • kural girdi (kurul engellemez)"), 11.5f, android.graphics.Color.rgb(165, 180, 252), false));
        }
        Button k = button("✖ " + sym + " POZİSYONUNU KAPAT" + (live ? " • GERÇEK PARA" : ""), android.graphics.Color.rgb(153, 27, 27));
        final String label = sym + " " + side;
        k.setOnClickListener(v -> v95143Close(id, label, live));
        android.widget.LinearLayout.LayoutParams kl = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        kl.setMargins(0, dp(8), 0, 0);
        card.addView(k, kl);
    }

    private void v95142SubLane(final String key, final String label) {
'''
main = replace(main, '    private void v95142SubLane(final String key, final String label) {\n', methods)

build = replace(build, 'versionCode 26111004', 'versionCode 26111005')
build = replace(build, "versionName '9.5.137-r2544.147-oto'", "versionName '9.5.138-r2544.147-pozkart'")

MAIN.write_text(main, encoding='utf-8')
BUILD.write_text(build, encoding='utf-8')
print(MARKER + '_APPLIED')
