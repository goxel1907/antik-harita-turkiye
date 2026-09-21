from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
RADAR = JAVA / 'MarketRadarActivity.java'
ENGINE = JAVA / 'V9538MarketRadarEngine.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.51 missing required generated file: ' + str(p))

m = MAIN.read_text()
for marker in (
    'V9545_PLAN_IMPORT_TIMESTAMP',
    'v9545_plan_import_ts_',
    'v9518_signal_time_',
    'v9518_signal_active_',
    'V9550_STABLE_DASHBOARD_HELPERS',
    'V9550C_LIGHTWEIGHT_DIRECT_NAV',
    'v9544MainRoot()',
    'v9544AnalyzedSymbols(',
    'V9543C_EXECUTION_DRIFT_RECHECK',
):
    if marker not in m:
        raise SystemExit('v9.5.51 prerequisite missing: ' + marker)

# ---------------------------------------------------------------------------
# Daily-plan age semantics: the plan is an adaptive day map. 24h is an
# advisory freshness horizon, never an auto-refresh or signal veto.
# Structural exhaustion still has precedence and may request a new analysis
# earlier. Nothing here launches AnalysisPackActivity or replaces plan values.
# ---------------------------------------------------------------------------
age_pat = re.compile(
    r'if \(h < 8L\) return "GÜNCEL";\s*'
    r'if \(h < 16L\) return "YENİLE ÖNERİLİR";\s*'
    r'return "ESKİ PLAN";'
)
age_repl = (
    'if (h < 24L) return "GÜNLÜK PLAN AKTİF";\n'
    '            if (h < 36L) return "24S+ YENİLE ÖNERİLİR";\n'
    '            return "ESKİ PLAN • YENİ ANALİZ ÖNERİLİR";'
)
m, n_age = age_pat.subn(age_repl, m, count=1)
if n_age == 0:
    print('v9.5.51 note: old 8h/16h advisory labels not found; validity card still uses 24h semantics.')

# Hook the lightweight stable-card refresh. This is an idempotent text update,
# not a full buildUi() and not an analysis refresh.
refresh_anchor = '        try { v9550NormalizeRecentTradeCardPosition(); } catch (Throwable ignored) {}'
if 'V9551_VALIDITY_REFRESH_HOOK' not in m:
    if refresh_anchor not in m:
        raise SystemExit('v9.5.51 stable refresh anchor missing')
    m = m.replace(
        refresh_anchor,
        refresh_anchor + '\n        // V9551_VALIDITY_REFRESH_HOOK\n        try { v9551InstallValidityCard(); } catch (Throwable ignored) {}',
        1,
    )

if 'private void v9551InstallValidityCard()' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.51 MainActivity close missing')
    helpers = r'''

    // ============================================================
    // V9551_VALIDITY_LIFECYCLE_UI
    // READ-ONLY status UI. It never refreshes/replaces an analysis and never
    // sends/cancels an order. Daily plan age is advisory; structure exhaustion
    // can request a new analysis earlier. Active signal tracking remains until
    // TP3/STOP/manual/external closure.
    // ============================================================
    private String v9551ShortSymbol(String symbol) {
        if (symbol == null) return "?";
        String s = symbol.trim().toUpperCase(java.util.Locale.US);
        return s.endsWith("USDT") && s.length() > 4 ? s.substring(0, s.length()-4) : s;
    }

    private String v9551AgeText(long ageMs) {
        if (ageMs < 0L) return "?";
        long totalMin = ageMs / 60000L;
        long d = totalMin / (24L * 60L);
        long h = (totalMin / 60L) % 24L;
        long min = totalMin % 60L;
        if (d > 0L) return d + "g " + h + "s";
        if (h > 0L) return h + "s " + min + "dk";
        return Math.max(0L, min) + "dk";
    }

    private String v9551PlanStatus(String symbol) {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
            String raw = sp.getString("v95_meta_" + symbol, "");
            String u = raw == null ? "" : raw.toUpperCase(java.util.Locale.ROOT);
            int invalid = 0;
            if (u.contains("LP_DURUM:GECERSIZ") || u.contains("LP_DURUM=GECERSIZ")) invalid++;
            if (u.contains("LB_DURUM:GECERSIZ") || u.contains("LB_DURUM=GECERSIZ")) invalid++;
            if (u.contains("SR_DURUM:GECERSIZ") || u.contains("SR_DURUM=GECERSIZ")) invalid++;
            if (u.contains("SB_DURUM:GECERSIZ") || u.contains("SB_DURUM=GECERSIZ")) invalid++;
            if (u.contains("YENI ANALIZ GEREKIR") || u.contains("YENİ ANALİZ GEREKİR") || invalid >= 4)
                return "YENİ ANALİZ GEREKİR";
            if (u.contains("TUKENME ASAMASINDA") || u.contains("TÜKENME AŞAMASINDA") || invalid >= 3)
                return "TÜKENME AŞAMASINDA";

            long ts = sp.getLong("v9545_plan_import_ts_" + symbol, 0L);
            if (ts <= 0L) return "YAŞ BİLİNMİYOR";
            long age = System.currentTimeMillis() - ts;
            if (age < 0L) return "YAŞ BİLİNMİYOR";
            if (age < 24L * 60L * 60L * 1000L)
                return "AKTİF • " + v9551AgeText(age);
            if (age < 36L * 60L * 60L * 1000L)
                return "24S+ • YENİLE ÖNERİLİR • " + v9551AgeText(age);
            return "ESKİ PLAN • " + v9551AgeText(age);
        } catch (Throwable ignored) {
            return "DURUM BİLİNMİYOR";
        }
    }

    private java.util.ArrayList<String> v9551ActiveSignalSymbols() {
        java.util.ArrayList<String> out = new java.util.ArrayList<>();
        try {
            android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
            java.util.Map<String, ?> all = sp.getAll();
            final String p = "v9518_signal_active_";
            for (java.util.Map.Entry<String, ?> e : all.entrySet()) {
                String k = e.getKey();
                Object v = e.getValue();
                if (k != null && k.startsWith(p) && Boolean.TRUE.equals(v)) {
                    String sym = k.substring(p.length()).trim().toUpperCase(java.util.Locale.US);
                    if (!sym.isEmpty()) out.add(sym);
                }
            }
            java.util.Collections.sort(out);
        } catch (Throwable ignored) {}
        return out;
    }

    private String v9551BuildValidityText(java.util.ArrayList<String> analyzed) {
        android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
        StringBuilder b = new StringBuilder();
        b.append("Günlük analizler OTOMATİK YENİLENMEZ. 24 saat yalnız tazelik ufkudur; ")
                .append("plan ancak kullanıcı yeni analiz yapıştırırsa değişir. Yapı/seviyeler daha erken tükenirse uyarı verilir.\n");

        if (analyzed != null && !analyzed.isEmpty()) {
            b.append("\n📅 PLAN YAŞI (yapıştırma zamanı)\n");
            int shown = 0;
            for (String sym : analyzed) {
                if (shown++ >= 8) break;
                b.append(v9551ShortSymbol(sym)).append(" • ").append(v9551PlanStatus(sym)).append('\n');
            }
        }

        java.util.ArrayList<String> active = v9551ActiveSignalSymbols();
        b.append("\n🚨 SİNYAL / GİRİŞ SÜRESİ\n");
        if (active.isEmpty()) {
            b.append("Aktif sinyal yok.\n");
        } else {
            long now = System.currentTimeMillis();
            for (String sym : active) {
                long ts = sp.getLong("v9518_signal_time_" + sym, 0L);
                String side = sp.getString("v9518_signal_side_" + sym, "");
                String state = sp.getString("v9518_signal_state_" + sym, "AÇIK");
                long age = ts > 0L ? Math.max(0L, now - ts) : -1L;
                long rearmWindow = 45L * 60L * 1000L;
                long left = age >= 0L ? rearmWindow - age : -1L;
                b.append(v9551ShortSymbol(sym)).append(' ')
                        .append(side == null ? "" : side.trim().toUpperCase(java.util.Locale.US))
                        .append(" • sinyal yaşı ").append(age >= 0L ? v9551AgeText(age) : "?")
                        .append(" • ").append(state == null ? "AÇIK" : state).append('\n');
                b.append("Sinyal kaydı: sonuçlanana kadar takipte • ");
                if (left > 0L) {
                    b.append("5m re-entry için yaklaşık ").append(v9551AgeText(left)).append(" kaldı");
                } else if (age >= 0L) {
                    b.append("5m re-entry 45dk penceresi doldu; yeni giriş için yeni 15m bağlam beklenir");
                } else {
                    b.append("5m re-entry süresi bilinmiyor");
                }
                b.append('\n');
                b.append("Emir uygunluğu: gönderim anında %0,50 fiyat sapması + STOP/TP geometrisi yeniden kontrol edilir.\n");
            }
        }
        b.append("\n🌐 Canlı akış kuralı: paket >120 sn eskiyse immediate-entry için bayat sayılır; izleme servisi taze veriyi yeniden ölçer.");
        return b.toString();
    }

    private void v9551InstallValidityCard() {
        android.widget.LinearLayout root = v9544MainRoot();
        if (root == null) return;
        java.util.ArrayList<String> symbols = v9544AnalyzedSymbols(root);
        String bodyText = v9551BuildValidityText(symbols);

        android.widget.LinearLayout existing = null;
        android.widget.TextView body = null;
        for (int i = 0; i < root.getChildCount(); i++) {
            android.view.View c = root.getChildAt(i);
            Object tag = c.getTag();
            if (tag != null && "v9551_validity_card".equals(String.valueOf(tag)) && c instanceof android.widget.LinearLayout) {
                existing = (android.widget.LinearLayout)c;
                break;
            }
        }
        if (existing != null) {
            for (int i = 0; i < existing.getChildCount(); i++) {
                android.view.View c = existing.getChildAt(i);
                Object tag = c.getTag();
                if (tag != null && "v9551_validity_body".equals(String.valueOf(tag)) && c instanceof android.widget.TextView) {
                    body = (android.widget.TextView)c;
                    break;
                }
            }
            if (body != null) body.setText(bodyText);
            return;
        }

        LinearLayout card = new LinearLayout(this);
        card.setTag("v9551_validity_card");
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(9), dp(12), dp(9));
        card.setBackgroundColor(Color.rgb(17, 39, 60));

        TextView head = text("⏱ PLAN / SİNYAL GEÇERLİLİĞİ", 13.5f, Color.rgb(226,232,240), true);
        card.addView(head, new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT));
        body = text(bodyText, 11.5f, Color.rgb(203,213,225), false);
        body.setTag("v9551_validity_body");
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.setMargins(0, dp(4), 0, 0);
        card.addView(body, bp);

        int insert = -1;
        for (int i = 0; i < root.getChildCount(); i++) {
            android.view.View c = root.getChildAt(i);
            Object tag = c.getTag();
            if (tag != null && "v9544_coin_jump_nav".equals(String.valueOf(tag))) {
                insert = i + 1;
                break;
            }
        }
        if (insert < 0) {
            int title = v9544TitleIndex(root);
            insert = title >= 0 ? title : Math.min(4, root.getChildCount());
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, dp(6), 0, dp(8));
        root.addView(card, Math.max(0, Math.min(insert, root.getChildCount())), lp);
    }
'''
    m = m[:pos] + helpers + '\n' + m[pos:]

# Version strings only; no trading/analysis decision logic changes.
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.51', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.51  •  MANUEL PRO', m)
MAIN.write_text(m)

for p in (MON, ANALYSIS, RADAR, ENGINE):
    s = p.read_text()
    s = re.sub(r'v9\.5(?:\.\d+)*', 'v9.5.51', s)
    s = re.sub(r'V9\.5(?:\.\d+)*', 'V9.5.51', s)
    p.write_text(s)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091315', bf, count=1)
bf = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.51'", bf, count=1)
BUILD.write_text(bf)

out = MAIN.read_text()
checks = {
    'validity ui': 'V9551_VALIDITY_LIFECYCLE_UI' in out and 'PLAN / SİNYAL GEÇERLİLİĞİ' in out,
    'daily 24h advisory': '24L * 60L * 60L * 1000L' in out and 'Günlük analizler OTOMATİK YENİLENMEZ' in out,
    '45m reentry display': '45L * 60L * 1000L' in out and '5m re-entry' in out,
    '120s live rule': 'paket >120 sn eskiyse' in out,
    'signal lifecycle retained': 'sonuçlanana kadar takipte' in out and 'v9518_signal_active_' in out,
    'entry drift retained': 'V9543C_EXECUTION_DRIFT_RECHECK' in out and '%0,50 fiyat sapması' in out,
    'stable refresh hook': 'V9551_VALIDITY_REFRESH_HOOK' in out and 'v9551InstallValidityCard();' in out,
    'v9550 stable ui retained': 'V9550_STABLE_DASHBOARD_HELPERS' in out and 'V9550C_LIGHTWEIGHT_DIRECT_NAV' in out,
    'version main': 'v9.5.51' in out,
    'version build': 'versionCode 26091315' in BUILD.read_text() and "versionName '9.5.51'" in BUILD.read_text(),
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL '), k)
bad = [k for k, v in checks.items() if not v]
if bad:
    raise SystemExit('v9.5.51 sanity failed: ' + ', '.join(bad))

# Strong safety: the new helper is display-only. It must not start analysis,
# mutate plans, or touch order endpoints.
a = out.find('V9551_VALIDITY_LIFECYCLE_UI')
ui = out[a:] if a >= 0 else ''
for forbidden in (
    'AnalysisPackActivity.class', 'buildPack(', 'openImportDialog(',
    '/fapi/v1/order', 'STOP_MARKET', 'TAKE_PROFIT_MARKET', 'cancelOrder',
    '.edit().putString("v95_', '.edit().putLong("v9545_plan_import_ts_',
):
    if forbidden in ui:
        raise SystemExit('v9.5.51 validity helper must be read-only; found: ' + forbidden)

print('v9.5.51 OK: daily plans are never auto-refreshed; 24h freshness, signal age, 45m re-entry window and 120s live-data rule are visible as read-only status.')
