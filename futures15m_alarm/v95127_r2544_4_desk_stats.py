r"""V95127_R2544_4_DESK_STATS (Claude, Anthropic • Cowork • 2026-09-29): ana ekran sadeleştirme.
Kullanıcı isteği (29.09, ekran görüntüsünde çarpı): "PLAN / SİNYAL GEÇERLİLİĞİ" ve "GERÇEK SİNYAL KAYDI • KAYBOLMAZ"
kartları kaldırılır; yerine PC defterinden (GET /live/positions, salt-okunur) gelen
  • 5M SCALPER MASASI ve 15M TRADER MASASI istatistikleri (son kapanışlar + son 24 saat)
  • SON 5 KAPANAN İŞLEM sonuçları
gösterilir. Yalnız görünüm. Yürütme DEĞİŞMEZ (PC-only / fail-closed; /live/execute POST yok — aşağıda doğrulanır).
Sürüm: 9.5.119-r2544.4-claude / 26092901.
"""
import re
from pathlib import Path

app = Path('/tmp/futures15m-build/Futures15mAlarm')
java = app / 'app/src/main/java/com/futuresalarm/app'
main_path, truth_path = java / 'MainActivity.java', java / 'V95113PcTruth.java'
main, truth = main_path.read_text(encoding='utf-8'), truth_path.read_text(encoding='utf-8')
assert 'V95126_R2544_PRO_UI' in main, 'v95126 must run first'


def rep(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit('V95127 anchor count %d: %s' % (n, label))
    return text.replace(old, new)


# 1) PC defterinden masa özeti + son 5 kapanış (salt-okunur kopya)
truth = rep(truth,
'''                out.put("summary", s2);
            }''',
'''                out.put("summary", s2);
            }
            // V95127_R2544_4_DESK_STATS: masa özeti + son 5 kapanış (PC defteri, salt-okunur).
            JSONArray v95127Desks = src.optJSONArray("deskSummary"), v95127D2 = new JSONArray();
            if (v95127Desks != null) for (int i = 0; i < v95127Desks.length(); i++) {
                JSONObject d = v95127Desks.optJSONObject(i);
                if (d == null) continue;
                JSONObject q = new JSONObject();
                for (String k : new String[]{"desk", "open", "closed", "wins", "losses", "winRatePct", "netPnl", "avgR"})
                    if (d.has(k) && !d.isNull(k)) q.put(k, d.get(k));
                JSONObject l24 = d.optJSONObject("last24h");
                if (l24 != null) q.put("last24h", l24);
                v95127D2.put(q);
            }
            out.put("deskSummary", v95127D2);
            JSONArray v95127Closed = src.optJSONArray("closed"), v95127C2 = new JSONArray();
            if (v95127Closed != null) for (int i = 0; i < Math.min(5, v95127Closed.length()); i++) {
                JSONObject x = v95127Closed.optJSONObject(i);
                if (x == null) continue;
                JSONObject q = new JSONObject();
                for (String k : new String[]{"symbol", "side", "netPnl", "rMultiple", "exitType", "closedAt", "tradeLane", "originTF", "holdMinutes"})
                    if (x.has(k) && !x.isNull(k)) q.put(k, x.get(k));
                v95127C2.put(q);
            }
            out.put("lastClosed", v95127C2);''', 'fetchPositions summary')

truth = rep(truth,
'''    public static int positionsBackground(SharedPreferences sp, long now, boolean configured) {''',
'''    // V95127_R2544_4_DESK_STATS: telefon ana ekranı masa kartı metni.
    public static String deskStatsText(SharedPreferences sp, long now, boolean configured) {
        StringBuilder b = new StringBuilder();
        int state = positionsState(sp, now, configured);
        JSONObject j = json(sp == null ? "" : sp.getString(K_POS_JSON, ""));
        JSONArray desks = j.optJSONArray("deskSummary");
        if (state != POS_OK) b.append("⚠ PC defteri güncel değil • son geçerli veri gösteriliyor\\n");
        if (desks == null || desks.length() == 0) {
            b.append(state == POS_OK ? "Masa istatistiği PC'den bekleniyor (PC R2544.4 güncellemesi gerekir)" : "Henüz masa verisi yok");
        } else {
            boolean first = true;
            for (int i = 0; i < desks.length(); i++) {
                JSONObject d = desks.optJSONObject(i);
                if (d == null) continue;
                String code = str(d, "desk");
                String name = "5M_SCALP".equals(code) ? "⚡ 5M SCALPER MASASI" : "15M_TRADE".equals(code) ? "📈 15M TRADER MASASI" : code;
                double net = num(d, "netPnl"), wr = num(d, "winRatePct"), avgR = num(d, "avgR");
                if (!first) b.append("\\n");
                first = false;
                b.append(name)
                 .append("\\n  Son kapanışlar ").append(d.optInt("closed", 0)).append(" • ")
                 .append(d.optInt("wins", 0)).append(" kazanç / ").append(d.optInt("losses", 0)).append(" kayıp")
                 .append(" • isabet ").append(Double.isNaN(wr) ? "—" : String.format(java.util.Locale.US, "%%%.0f", wr))
                 .append("\\n  Net ").append(Double.isNaN(net) ? "—" : String.format(java.util.Locale.US, "%+.2f USDT", net))
                 .append(" • ort ").append(Double.isNaN(avgR) ? "—" : String.format(java.util.Locale.US, "%+.2fR", avgR))
                 .append(" • açık ").append(d.optInt("open", 0));
                JSONObject l = d.optJSONObject("last24h");
                if (l != null) {
                    double ln = num(l, "netPnl");
                    b.append("\\n  Son 24 saat: ").append(l.optInt("closed", 0)).append(" işlem • ")
                     .append(l.optInt("wins", 0)).append(" kazanç • net ")
                     .append(Double.isNaN(ln) ? "—" : String.format(java.util.Locale.US, "%+.2f USDT", ln));
                }
            }
        }
        JSONArray lc = j.optJSONArray("lastClosed");
        b.append("\\n\\n🧾 SON 5 KAPANAN İŞLEM");
        if (lc == null || lc.length() == 0) b.append("\\nKayıt yok");
        else for (int i = 0; i < Math.min(5, lc.length()); i++) {
            JSONObject x = lc.optJSONObject(i);
            if (x == null) continue;
            double net = num(x, "netPnl"), r = num(x, "rMultiple");
            String side = str(x, "side").toUpperCase(java.util.Locale.US);
            String lane = str(x, "tradeLane").toUpperCase(java.util.Locale.US);
            String desk = lane.startsWith("5M") || "SCALP_MOMENTUM".equals(lane) ? "5m" : lane.startsWith("15M") || "MAIN_15M".equals(lane) ? "15m" : str(x, "originTF");
            b.append("\\n").append(Double.isNaN(net) ? "⚪ " : net > 0 ? "🟢 " : net < 0 ? "🔴 " : "⚪ ")
             .append(str(x, "symbol").replace("USDT", "")).append(' ')
             .append("LONG".equals(side) ? "ALIŞ" : "SHORT".equals(side) ? "SATIŞ" : side)
             .append(" • ").append(Double.isNaN(net) ? "—" : String.format(java.util.Locale.US, "%+.2f$", net))
             .append(" • ").append(Double.isNaN(r) ? "R —" : String.format(java.util.Locale.US, "%+.2fR", r))
             .append(" • ").append(desk.isEmpty() ? "—" : desk)
             .append("\\n     ").append(v95127ExitTr(str(x, "exitType")))
             .append(" • ").append(v95127DayTime(str(x, "closedAt")));
        }
        return b.toString();
    }

    static String v95127ExitTr(String t) {
        String u = t == null ? "" : t.toUpperCase(java.util.Locale.US);
        if ("STOP_LOSS".equals(u)) return "stop";
        if ("TP1_RUNNER_TRAIL".equals(u)) return "TP1 + iz süren";
        if ("TP1_BREAKEVEN".equals(u)) return "TP1 + başabaş";
        if ("TP1_THEN_STOP".equals(u)) return "TP1 sonra stop";
        if ("JEV_EXIT_NOW".equals(u)) return "JEV çıkış";
        if ("JEV_PARTIAL_TAKE_PROFIT".equals(u)) return "JEV kısmi";
        if ("EXTERNAL_CLOSE".equals(u)) return "BrainHub dışı kapanış";
        if (u.startsWith("GUARD")) return "koruma kapanışı";
        if (u.isEmpty() || "OTHER_CLOSE".equals(u)) return "diğer kapanış";
        return t;
    }

    static String v95127DayTime(String iso) {
        if (iso == null || iso.trim().isEmpty()) return "—";
        String[] fmts = {"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"};
        for (String f : fmts) {
            try {
                java.text.SimpleDateFormat p = new java.text.SimpleDateFormat(f, java.util.Locale.US);
                p.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                java.util.Date d = p.parse(iso.trim());
                if (d != null) return new java.text.SimpleDateFormat("dd.MM HH:mm", java.util.Locale.US).format(d);
            } catch (Exception ignored) {}
        }
        return "—";
    }

    public static int positionsBackground(SharedPreferences sp, long now, boolean configured) {''', 'deskStatsText')

# 2) Eski iki kart yerine masa kartı
main = rep(main, '''        try { v9551InstallValidityCard(); } catch (Throwable ignored) {}''',
           '''        try { v95127InstallDeskStatsCard(); } catch (Throwable ignored) {}''', 'validity hook')
main = rep(main, '''        try { v9558InstallPersistentSignalCard(); } catch (Throwable ignored) {}''',
           '''        try { v95127RemoveLegacySignalCards(); } catch (Throwable ignored) {}''', 'signal hook')

main = rep(main, '''    private void v9558InstallPersistentSignalCard() {''',
'''    // V95127_R2544_4_DESK_STATS: kullanıcı isteğiyle kaldırılan kartlar (geçerlilik + kalıcı sinyal kaydı).
    private void v95127RemoveLegacySignalCards() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        for (int i = root.getChildCount() - 1; i >= 0; i--) {
            Object tag = root.getChildAt(i).getTag();
            String t = tag == null ? "" : String.valueOf(tag);
            if ("v9551_validity_card".equals(t) || "v9558_signal_journal_card".equals(t)) root.removeViewAt(i);
        }
    }

    private CharSequence v95127Styled(String raw) {
        String text = raw == null ? "" : raw;
        android.text.SpannableStringBuilder sb = new android.text.SpannableStringBuilder();
        String[] lines = text.split("\\n", -1);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            int start = sb.length();
            sb.append(line);
            int end = sb.length();
            if (i < lines.length - 1) sb.append("\\n");
            if (end <= start) continue;
            int color = 0; boolean bold = false; float size = 1f;
            if (line.startsWith("⚡") || line.startsWith("📈") || line.startsWith("🧾")) { bold = true; size = 1.08f; color = android.graphics.Color.rgb(125, 211, 252); }
            else if (line.startsWith("🟢")) color = android.graphics.Color.rgb(74, 222, 128);
            else if (line.startsWith("🔴")) color = android.graphics.Color.rgb(248, 113, 113);
            else if (line.startsWith("⚠")) { bold = true; color = android.graphics.Color.rgb(251, 146, 60); }
            else if (line.startsWith("     ")) { size = 0.9f; color = android.graphics.Color.rgb(148, 163, 184); }
            if (bold) sb.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), start, end, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (color != 0) sb.setSpan(new android.text.style.ForegroundColorSpan(color), start, end, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (size != 1f) sb.setSpan(new android.text.style.RelativeSizeSpan(size), start, end, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return sb;
    }

    private void v95127InstallDeskStatsCard() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        v95127RemoveLegacySignalCards();
        android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        long now = System.currentTimeMillis();
        String bodyText = V95113PcTruth.deskStatsText(sp, now, true);
        for (int i = 0; i < root.getChildCount(); i++) {
            android.view.View v = root.getChildAt(i);
            if ("v95127_desk_card".equals(String.valueOf(v.getTag())) && v instanceof android.widget.LinearLayout) {
                android.widget.LinearLayout card = (android.widget.LinearLayout) v;
                for (int k = 0; k < card.getChildCount(); k++) {
                    android.view.View c = card.getChildAt(k);
                    if ("v95127_desk_body".equals(String.valueOf(c.getTag())) && c instanceof android.widget.TextView)
                        ((android.widget.TextView) c).setText(v95127Styled(bodyText));
                }
                return;
            }
        }
        android.widget.LinearLayout card = new android.widget.LinearLayout(this);
        card.setTag("v95127_desk_card");
        card.setOrientation(android.widget.LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(11), dp(14), dp(12));
        card.setBackground(v95126Card(android.graphics.Color.rgb(13, 27, 46), android.graphics.Color.rgb(56, 189, 248)));
        android.widget.TextView head = text("🏢 MASA İSTATİSTİKLERİ • PC DEFTERİ", 13.8f, android.graphics.Color.WHITE, true);
        card.addView(head, new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        android.widget.TextView body = text("", 12.0f, android.graphics.Color.rgb(226, 232, 240), false);
        body.setTag("v95127_desk_body");
        body.setLineSpacing(0f, 1.12f);
        body.setText(v95127Styled(bodyText));
        android.widget.LinearLayout.LayoutParams bp = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.setMargins(0, dp(6), 0, 0);
        card.addView(body, bp);
        int insert = -1;
        for (int i = 0; i < root.getChildCount(); i++) {
            Object tag = root.getChildAt(i).getTag();
            if (tag != null && "v9544_coin_jump_nav".equals(String.valueOf(tag))) { insert = i + 1; break; }
        }
        if (insert < 0) {
            int title = v9544TitleIndex(root);
            insert = title >= 0 ? title : Math.min(4, root.getChildCount());
        }
        android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), 0, dp(8));
        root.addView(card, Math.max(0, Math.min(insert, root.getChildCount())), lp);
    }

    private void v9558InstallPersistentSignalCard() {''', 'desk card methods')

# 3) Sürüm
build_path = app / 'app/build.gradle'
build = build_path.read_text(encoding='utf-8')
build = re.sub(r'versionCode\s+\d+', 'versionCode 26092901', build, count=1)
build = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.119-r2544.4-claude'", build, count=1)
build_path.write_text(build, encoding='utf-8')

client = (java / 'BrainHubClient.java').read_text(encoding='utf-8')
assert 'ANDROID_ORDER_INITIATION_DISABLED_PC_ONLY' in client
assert 'post(c, "/live/execute", intent, true)' not in client
main += '\n// V95127_R2544_4_DESK_STATS\n'
truth += '\n// V95127_R2544_4_DESK_STATS\n'
main_path.write_text(main, encoding='utf-8')
truth_path.write_text(truth, encoding='utf-8')
print('V95127_R2544_4_DESK_STATS_OK')
