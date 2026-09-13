from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.45 missing required file: ' + str(p))


def method_bounds(src, signature_fragment):
    a = src.find(signature_fragment)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    in_str = in_chr = esc = line_comment = block_comment = False
    while i < len(src) and depth:
        c = src[i]
        n = src[i + 1] if i + 1 < len(src) else ''
        if line_comment:
            if c == '\n':
                line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
        elif in_chr:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                in_chr = False
        else:
            if c == '/' and n == '/':
                line_comment = True
                i += 1
            elif c == '/' and n == '*':
                block_comment = True
                i += 1
            elif c == '"':
                in_str = True
            elif c == "'":
                in_chr = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)


# ================================================================
# MainActivity: top overlay + batch launcher + advisory plan age.
# No signal/order/monitor decision method is modified here.
# ================================================================
m = MAIN.read_text()

required_main = [
    'V9544_COIN_JUMP_NAV',
    'v9544AnalyzedSymbols(',
    'v9544MainRoot()',
    'v9544MainScroll()',
    'V9543C_SINGLE_TAP_APPROVAL',
    'v9543b_strict_ticket_',
]
for marker in required_main:
    if marker not in m:
        raise SystemExit('v9.5.45 prerequisite missing in MainActivity: ' + marker)

# Timestamp every successfully imported plan. This is advisory freshness only.
b = method_bounds(m, '    private void openImportDialog()')
if not b:
    raise SystemExit('v9.5.45 openImportDialog missing')
a, _, e = b
imp = m[a:e]
if 'V9545_PLAN_IMPORT_TIMESTAMP' not in imp:
    hit = re.search(r'(?m)^(\s*)success\+\+;\s*$', imp)
    if not hit:
        raise SystemExit('v9.5.45 import success++ anchor missing')
    indent = hit.group(1)
    stamp = (
        indent + '// V9545_PLAN_IMPORT_TIMESTAMP — advisory only; never a signal veto.\n'
        + indent + 'getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE).edit()\n'
        + indent + '        .putLong("v9545_plan_import_ts_" + sym, System.currentTimeMillis()).apply();\n'
    )
    imp = imp[:hit.start()] + stamp + imp[hit.start():]

# Clarify existing bulk parser capability without changing its parsing logic.
imp = imp.replace(
    '13 veya 14 alanlı detaylı plan kodu kabul edilir.',
    '13 veya 14 alanlı detaylı plan kodu kabul edilir. Birden fazla coin planını ALT ALTA tek seferde yapıştırabilirsin.'
)
m = m[:a] + imp + m[e:]

# Make the main button describe the already-supported bulk paste flow.
m = m.replace('PLAN KODU\\nYapıştır veya güncelle', 'PLAN KODU\\nTekli / toplu yapıştır')

# Add a batch-analysis button beneath the existing horizontal coin navigator.
nav_anchor = '        box.addView(hs, new LinearLayout.LayoutParams(-1, dp(40)));'
if 'V9545_BATCH_BUTTON' not in m:
    if nav_anchor not in m:
        raise SystemExit('v9.5.45 navigator row anchor missing')
    batch_button = r'''

        // V9545_BATCH_BUTTON — analysis convenience only; trading logic untouched.
        if (symbols.size() >= 2) {
            Button batch = new Button(this);
            batch.setText("📦 TOPLU ANALİZ • 2–8 COİN");
            batch.setAllCaps(false);
            batch.setTextSize(12.5f);
            batch.setTextColor(Color.WHITE);
            batch.setMinHeight(0); batch.setMinimumHeight(0);
            batch.setPadding(dp(12), dp(5), dp(12), dp(5));
            batch.setBackgroundColor(Color.rgb(88, 45, 150));
            batch.setContentDescription("İki ile sekiz analizli coini tek ChatGPT paketinde hazırla");
            batch.setOnClickListener(v -> v9545ShowBatchAnalysisDialog());
            LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-1, dp(42));
            blp.setMargins(0, dp(7), 0, 0);
            box.addView(batch, blp);
        }
'''
    m = m.replace(nav_anchor, nav_anchor + batch_button, 1)

# Ensure the fixed top control is reinstalled whenever v9544 refreshes the UI.
b = method_bounds(m, '    private void v9544ScheduleCoinNavigator()')
if not b:
    raise SystemExit('v9.5.45 v9544ScheduleCoinNavigator missing')
a, _, e = b
sched = m[a:e]
if 'V9545_TOP_OVERLAY_REFRESH' not in sched:
    sched = sched.replace(
        'try { v9544InstallCoinNavigator(); } catch (Throwable ignored) {}',
        'try { v9544InstallCoinNavigator(); v9545InstallTopOverlay(); } catch (Throwable ignored) {}'
    )
    if 'v9545InstallTopOverlay();' not in sched:
        raise SystemExit('v9.5.45 could not hook top overlay into nav scheduler')
    p = sched.find('{')
    sched = sched[:p+1] + '\n        // V9545_TOP_OVERLAY_REFRESH\n' + sched[p+1:]
    m = m[:a] + sched + m[e:]

if 'private void v9545ShowBatchAnalysisDialog()' not in m:
    pos = m.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.45 MainActivity close missing')
    helpers = r'''

    // ============================================================
    // V9545_BATCH_ANALYSIS + V9545_TOP_OVERLAY
    // UI/navigation only. Plan age is advisory; it never gates signals.
    // ============================================================
    private String v9545AnalysisState(String symbol) {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
            String raw = sp.getString("v95_meta_" + symbol, "");
            String u = raw == null ? "" : raw.toUpperCase(java.util.Locale.US);
            int invalid = 0;
            if (u.contains("LP_DURUM:GECERSIZ") || u.contains("LP_DURUM=GECERSIZ")) invalid++;
            if (u.contains("LB_DURUM:GECERSIZ") || u.contains("LB_DURUM=GECERSIZ")) invalid++;
            if (u.contains("SR_DURUM:GECERSIZ") || u.contains("SR_DURUM=GECERSIZ")) invalid++;
            if (u.contains("SB_DURUM:GECERSIZ") || u.contains("SB_DURUM=GECERSIZ")) invalid++;
            if (u.contains("YENI ANALIZ GEREKIR") || u.contains("YENİ ANALİZ GEREKİR") || invalid >= 4)
                return "YENİ ANALİZ";
            if (u.contains("TUKENME ASAMASINDA") || u.contains("TÜKENME AŞAMASINDA") || invalid >= 3)
                return "TÜKENİYOR";

            long ts = sp.getLong("v9545_plan_import_ts_" + symbol, 0L);
            if (ts <= 0L) return "YAŞ BİLİNMİYOR";
            long age = System.currentTimeMillis() - ts;
            if (age < 0L) return "YAŞ BİLİNMİYOR";
            long h = age / 3600000L;
            if (h < 8L) return "GÜNCEL";
            if (h < 16L) return "YENİLE ÖNERİLİR";
            return "ESKİ PLAN";
        } catch (Throwable ignored) {
            return "DURUM BİLİNMİYOR";
        }
    }

    private void v9545ShowBatchAnalysisDialog() {
        final java.util.ArrayList<String> symbols = v9544AnalyzedSymbols(v9544MainRoot());
        if (symbols.size() < 2) {
            Toast.makeText(this, "Toplu analiz için en az 2 analizli coin gerekli.", Toast.LENGTH_LONG).show();
            return;
        }
        final String[] labels = new String[symbols.size()];
        final boolean[] checked = new boolean[symbols.size()];
        int initial = Math.min(8, symbols.size());
        for (int i = 0; i < symbols.size(); i++) {
            labels[i] = symbols.get(i) + "  •  " + v9545AnalysisState(symbols.get(i));
            checked[i] = i < initial;
        }

        final android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(this)
                .setTitle("📦 TOPLU ANALİZ • 2–8 COİN")
                .setMessage("MASTER protokol yalnız bir kez aktarılır; her coin kendi güncel grafik/verisiyle bağımsız analiz edilir. Analiz yaşı yalnız uyarıdır, sinyal filtresi değildir.")
                .setMultiChoiceItems(labels, checked, (di, which, isChecked) -> {
                    checked[which] = isChecked;
                    int count = 0;
                    for (boolean x : checked) if (x) count++;
                    if (count > 8) {
                        checked[which] = false;
                        try { ((android.app.AlertDialog) di).getListView().setItemChecked(which, false); } catch (Throwable ignored) {}
                        Toast.makeText(this, "En fazla 8 coin seçilebilir.", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("İPTAL", null)
                .setPositiveButton("PAKETLERİ HAZIRLA", null)
                .create();
        dlg.setOnShowListener(x -> dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            java.util.ArrayList<String> selected = new java.util.ArrayList<>();
            for (int i = 0; i < checked.length; i++) if (checked[i]) selected.add(symbols.get(i));
            if (selected.size() < 2 || selected.size() > 8) {
                Toast.makeText(this, "2 ile 8 arasında coin seç.", Toast.LENGTH_LONG).show();
                return;
            }
            android.content.Intent in = new android.content.Intent(this, AnalysisPackActivity.class);
            in.putStringArrayListExtra("v9545_batch_symbols", selected);
            startActivity(in);
            dlg.dismiss();
        }));
        dlg.show();
    }

    private void v9545InstallTopOverlay() {
        try {
            android.view.ViewGroup content = findViewById(android.R.id.content);
            if (!(content instanceof android.widget.FrameLayout)) return;
            android.widget.FrameLayout frame = (android.widget.FrameLayout) content;
            for (int i = 0; i < frame.getChildCount(); i++) {
                android.view.View c = frame.getChildAt(i);
                Object tag = c.getTag();
                if (tag != null && "v9545_top_overlay".equals(String.valueOf(tag))) return;
            }
            final android.widget.ScrollView sv = v9544MainScroll();
            if (sv == null) return;

            Button up = new Button(this);
            up.setTag("v9545_top_overlay");
            up.setText("↑ ÜSTE");
            up.setAllCaps(false);
            up.setTextSize(11.5f);
            up.setTextColor(Color.WHITE);
            up.setMinHeight(0); up.setMinimumHeight(0); up.setMinWidth(0); up.setMinimumWidth(0);
            up.setPadding(dp(10), dp(3), dp(10), dp(3));
            up.setBackgroundColor(Color.rgb(30, 64, 175));
            up.setVisibility(android.view.View.GONE);
            if (android.os.Build.VERSION.SDK_INT >= 21) up.setElevation(dp(8));
            up.setOnClickListener(v -> sv.smoothScrollTo(0, 0));

            android.widget.FrameLayout.LayoutParams fp = new android.widget.FrameLayout.LayoutParams(dp(82), dp(42));
            fp.gravity = android.view.Gravity.END | android.view.Gravity.BOTTOM;
            fp.setMargins(dp(8), dp(8), dp(12), dp(18));
            frame.addView(up, fp);

            final Runnable vis = () -> up.setVisibility(sv.getScrollY() > dp(360)
                    ? android.view.View.VISIBLE : android.view.View.GONE);
            sv.getViewTreeObserver().addOnScrollChangedListener(vis::run);
            sv.post(vis);
        } catch (Throwable ignored) {}
    }
'''
    m = m[:pos] + helpers + '\n' + m[pos:]

m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.45', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.45  •  MANUEL PRO', m)
MAIN.write_text(m)

# Keep service visible version aligned; no monitoring decision logic changes.
mon = MON.read_text()
mon = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.45', mon)
MON.write_text(mon)


# ================================================================
# AnalysisPackActivity: batch mode wraps the EXISTING buildPack().
# Each coin therefore keeps all current data, prompt and chart logic.
# ================================================================
a = ANALYSIS.read_text()
if 'private void buildPack()' not in a:
    raise SystemExit('v9.5.45 AnalysisPackActivity buildPack missing')
if 'private String shareText;' not in a or 'private Uri imageUri;' not in a:
    raise SystemExit('v9.5.45 AnalysisPackActivity share fields missing')

if 'V9545_BATCH_FIELDS' not in a:
    field_anchor = '    private Bitmap packBitmap;'
    if field_anchor not in a:
        raise SystemExit('v9.5.45 packBitmap field anchor missing')
    fields = r'''

    // V9545_BATCH_FIELDS
    private boolean v9545BatchMode = false;
    private boolean v9545BatchInternalKick = false;
    private final java.util.ArrayList<String> v9545BatchSymbols = new java.util.ArrayList<>();
    private final java.util.ArrayList<String> v9545BatchDoneSymbols = new java.util.ArrayList<>();
    private final java.util.ArrayList<String> v9545BatchPrompts = new java.util.ArrayList<>();
    private final java.util.ArrayList<android.net.Uri> v9545BatchUris = new java.util.ArrayList<>();
    private final java.util.ArrayList<String> v9545BatchErrors = new java.util.ArrayList<>();
    private int v9545BatchIndex = 0;
    private String v9545CombinedPrompt = null;
'''
    a = a.replace(field_anchor, field_anchor + fields, 1)

# Batch init after all existing widgets are attached.
b = method_bounds(a, '    protected void onCreate(')
if not b:
    raise SystemExit('v9.5.45 Analysis onCreate missing')
os, _, oe = b
oncreate = a[os:oe]
if 'V9545_BATCH_INIT' not in oncreate:
    anchor = '        setContentView(scroll);'
    if anchor not in oncreate:
        raise SystemExit('v9.5.45 Analysis setContentView(scroll) missing')
    oncreate = oncreate.replace(anchor, anchor + '\n        // V9545_BATCH_INIT\n        v9545InitBatchMode();', 1)
    a = a[:os] + oncreate + a[oe:]

# Reject accidental manual build taps while the internal batch sequence owns buildPack().
b = method_bounds(a, '    private void buildPack()')
if not b:
    raise SystemExit('v9.5.45 buildPack bounds missing')
bs, bb, be = b
bp = a[bs:be]
if 'V9545_BATCH_BUILD_GUARD' not in bp:
    guard = r'''
        // V9545_BATCH_BUILD_GUARD
        if (v9545BatchMode && !v9545BatchInternalKick) {
            Toast.makeText(this, "Toplu paket hazırlanırken tekli hazırlama kapalı.", Toast.LENGTH_SHORT).show();
            return;
        }
'''
    bp = bp[:bp.find('{')+1] + guard + bp[bp.find('{')+1:]

# Hook existing success path, preserving the current single-coin implementation.
if 'V9545_BATCH_SUCCESS_HOOK' not in bp:
    success_anchor = '                    shareButton.setAlpha(1f);'
    if success_anchor not in bp:
        raise SystemExit('v9.5.45 buildPack success anchor missing')
    bp = bp.replace(success_anchor, success_anchor + '\n                    // V9545_BATCH_SUCCESS_HOOK\n                    if (v9545BatchMode) v9545OnBatchReady(symbol);', 1)

# Hook existing failure path. Use a narrow replacement first, then a regex fallback.
if 'V9545_BATCH_FAILURE_HOOK' not in bp:
    old = '                runOnUiThread(() -> status.setText("❌ Paket hazırlanamadı: " + msg));'
    new = '''                runOnUiThread(() -> {\n                    status.setText("❌ Paket hazırlanamadı: " + msg);\n                    // V9545_BATCH_FAILURE_HOOK\n                    if (v9545BatchMode) v9545OnBatchFailed(symbol, msg);\n                });'''
    if old in bp:
        bp = bp.replace(old, new, 1)
    else:
        pat = re.compile(r'runOnUiThread\(\(\)\s*->\s*status\.setText\("❌ Paket hazırlanamadı: "\s*\+\s*msg\)\);')
        bp, n = pat.subn(new.strip(), bp, count=1)
        if n != 1:
            raise SystemExit('v9.5.45 buildPack failure anchor missing')

a = a[:bs] + bp + a[be:]

if 'private void v9545InitBatchMode()' not in a:
    pos = a.rfind('}')
    if pos < 0:
        raise SystemExit('v9.5.45 Analysis class close missing')
    helpers = r'''

    // ============================================================
    // V9545_BATCH_ANALYSIS
    // Sequentially reuses buildPack(); no parallel market snapshots and no
    // duplicated analysis engine. Every coin is stored as an independent unit.
    // ============================================================
    private void v9545InitBatchMode() {
        try {
            java.util.ArrayList<String> raw = getIntent() == null ? null
                    : getIntent().getStringArrayListExtra("v9545_batch_symbols");
            if (raw == null) return;
            java.util.LinkedHashSet<String> unique = new java.util.LinkedHashSet<>();
            for (String x : raw) {
                String s = normalizeSymbol(x);
                if (s != null && s.length() >= 5) unique.add(s);
                if (unique.size() >= 8) break;
            }
            if (unique.size() < 2) return;
            v9545BatchMode = true;
            v9545BatchSymbols.clear();
            v9545BatchSymbols.addAll(unique);
            symbolInput.setEnabled(false);
            shareButton.setEnabled(false);
            shareButton.setAlpha(0.45f);
            shareButton.setText("TOPLU PAKET HAZIRLANIYOR…");
            shareButton.setOnClickListener(v -> v9545ShareBatch());
            status.setText("📦 Toplu analiz başlıyor • " + v9545BatchSymbols.size()
                    + " coin • aynı analiz motoru sırayla çalışacak");
            status.postDelayed(() -> v9545RunNext(), 180L);
        } catch (Throwable ex) {
            v9545BatchMode = false;
            status.setText("❌ Toplu analiz başlatılamadı: " + ex.getMessage());
        }
    }

    private void v9545RunNext() {
        if (!v9545BatchMode) return;
        if (v9545BatchIndex >= v9545BatchSymbols.size()) {
            v9545FinishBatch();
            return;
        }
        String symbol = v9545BatchSymbols.get(v9545BatchIndex);
        symbolInput.setText(symbol);
        status.setText("⏳ Toplu analiz " + (v9545BatchIndex + 1) + "/" + v9545BatchSymbols.size()
                + " • " + symbol + " güncel paketi hazırlanıyor…");
        try {
            v9545BatchInternalKick = true;
            buildPack();
        } finally {
            v9545BatchInternalKick = false;
        }
    }

    private void v9545OnBatchReady(String symbol) {
        if (!v9545BatchMode) return;
        try {
            v9545BatchDoneSymbols.add(symbol);
            v9545BatchPrompts.add(shareText == null ? "" : shareText);
            if (imageUri != null) v9545BatchUris.add(imageUri);
        } catch (Throwable ex) {
            v9545BatchErrors.add(symbol + ": kayıt hatası " + ex.getMessage());
        }
        v9545BatchIndex++;
        shareButton.setEnabled(false);
        shareButton.setAlpha(0.45f);
        shareButton.setText("TOPLU PAKET HAZIRLANIYOR…");
        status.postDelayed(() -> v9545RunNext(), 120L);
    }

    private void v9545OnBatchFailed(String symbol, String msg) {
        if (!v9545BatchMode) return;
        v9545BatchErrors.add(symbol + ": " + (msg == null ? "bilinmeyen hata" : msg));
        v9545BatchIndex++;
        shareButton.setEnabled(false);
        shareButton.setAlpha(0.45f);
        status.postDelayed(() -> v9545RunNext(), 120L);
    }

    private int v9545ProtocolStart(String p) {
        if (p == null) return -1;
        String[] keys = new String[] {
                "V9.5.41 ANALIZ TUKENME DURUMU",
                "V9.5.41 GUNLUK ADAPTIF HARITA PROTOKOLU",
                "15M FUTURES PRO MANUEL ANALİZ PROTOKOLÜ"
        };
        int best = -1;
        for (String k : keys) {
            int x = p.indexOf(k);
            if (x >= 0 && (best < 0 || x < best)) best = x;
        }
        return best;
    }

    private String v9545ComposeCombinedPrompt() {
        StringBuilder out = new StringBuilder(65536);
        out.append("--- V9.5.45 TOPLU ANALİZ PAKETİ ---\n");
        out.append("Bu paket ").append(v9545BatchDoneSymbols.size()).append(" coini tek aktarımda içerir.\n");
        out.append("KURAL: Her coini TAMAMEN BAĞIMSIZ analiz et; semboller arasında fiyat, STOP, TP, FVG/OB, likidite veya META seviyesi TAŞIMA. ");
        out.append("Ortak MASTER protokol aşağıda yalnız bir kez verilmiştir ve tüm coinlere aynen uygulanır.\n");
        out.append("ÇIKTI: Her coin için ayrı ANA KARAR/GÜVEN/senaryolar ve ayrı TEK SATIR 14 alanlı plan kodu üret. ");
        out.append("Cevabın en sonunda 'TOPLU PLAN KODLARI' başlığı altında yalnız başarılı her sembol için bir plan kodu satırı ver; satırları birbirine karıştırma.\n\n");

        String first = v9545BatchPrompts.isEmpty() ? "" : v9545BatchPrompts.get(0);
        int firstPs = v9545ProtocolStart(first);
        int firstDs = first.indexOf("--- UYGULAMANIN OTOMATİK TOPLADIĞI CANLI VERİLER ---");
        boolean dedupe = firstPs >= 0 && firstDs > firstPs;
        if (dedupe) {
            out.append("--- ORTAK MASTER PROTOKOL ---\n");
            out.append(first, firstPs, firstDs).append("\n");
        } else {
            out.append("NOT: Ortak protokol sınırı güvenle ayrılamadı; veri kaybını önlemek için her coin paketi tam haliyle korunmuştur.\n\n");
        }

        for (int i = 0; i < v9545BatchDoneSymbols.size(); i++) {
            String sym = v9545BatchDoneSymbols.get(i);
            String p = i < v9545BatchPrompts.size() ? v9545BatchPrompts.get(i) : "";
            out.append("\n--- COIN ").append(i + 1).append(" / ").append(v9545BatchDoneSymbols.size())
                    .append(" • ").append(sym).append(" ---\n");
            if (!dedupe) {
                out.append(p).append("\n");
                continue;
            }
            int ps = v9545ProtocolStart(p);
            int ds = p.indexOf("--- UYGULAMANIN OTOMATİK TOPLADIĞI CANLI VERİLER ---");
            if (ps >= 0 && ds > ps) {
                if (ps > 0) out.append(p, 0, ps).append("\n");
                out.append(p.substring(ds)).append("\n");
            } else {
                out.append(p).append("\n");
            }
        }
        if (!v9545BatchErrors.isEmpty()) {
            out.append("\n--- HAZIRLANAMAYAN COINLER ---\n");
            for (String e : v9545BatchErrors) out.append("• ").append(e).append("\n");
            out.append("Bu coinler için veri uydurma ve plan kodu üretme.\n");
        }
        return out.toString();
    }

    private void v9545FinishBatch() {
        if (!v9545BatchMode) return;
        if (v9545BatchDoneSymbols.isEmpty()) {
            shareButton.setEnabled(false);
            shareButton.setAlpha(0.45f);
            shareButton.setText("TOPLU PAKET HAZIRLANAMADI");
            status.setText("❌ Hiçbir coin paketi hazırlanamadı. " + v9545BatchErrors.toString());
            return;
        }
        v9545CombinedPrompt = v9545ComposeCombinedPrompt();
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText(
                    "15m Futures PRO toplu analiz", v9545CombinedPrompt));
        } catch (Throwable ignored) {}
        shareButton.setText("CHATGPT'YE AKTAR • " + v9545BatchDoneSymbols.size() + " COİN");
        shareButton.setEnabled(true);
        shareButton.setAlpha(1f);
        status.setText("✅ Toplu paket hazır • " + v9545BatchDoneSymbols.size() + "/"
                + v9545BatchSymbols.size() + " coin • MASTER bir kez + coin verileri ayrı\n"
                + (v9545BatchErrors.isEmpty() ? "" : "⚠️ Hazırlanamayan: " + v9545BatchErrors.toString()));
    }

    private void v9545ShareBatch() {
        if (!v9545BatchMode || v9545CombinedPrompt == null || v9545CombinedPrompt.trim().isEmpty()) {
            Toast.makeText(this, "Toplu prompt henüz hazır değil.", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText(
                    "15m Futures PRO toplu analiz", v9545CombinedPrompt));
        } catch (Throwable ignored) {}

        android.content.Intent send = new android.content.Intent(android.content.Intent.ACTION_SEND_MULTIPLE);
        send.putExtra(android.content.Intent.EXTRA_TEXT, v9545CombinedPrompt);
        java.util.ArrayList<android.net.Uri> images = new java.util.ArrayList<>(v9545BatchUris);
        if (!images.isEmpty()) {
            send.setType("image/*");
            send.putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, images);
            android.content.ClipData clip = android.content.ClipData.newRawUri("Futures PRO toplu grafik", images.get(0));
            for (int i = 1; i < images.size(); i++) clip.addItem(new android.content.ClipData.Item(images.get(i)));
            send.setClipData(clip);
            send.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } else {
            send.setType("text/plain");
        }

        try {
            send.setPackage("com.openai.chatgpt");
            startActivity(send);
            Toast.makeText(this, "Toplu prompt + grafikler ChatGPT paylaşımına gönderildi. Prompt panoda da duruyor.", Toast.LENGTH_LONG).show();
            return;
        } catch (Throwable ignored) {}

        try {
            send.setPackage(null);
            startActivity(android.content.Intent.createChooser(send, "Toplu analiz paketini paylaş"));
            Toast.makeText(this, "Doğrudan ChatGPT çoklu paylaşımı bulunamadı; Android paylaşım menüsü açıldı. Prompt panoda.", Toast.LENGTH_LONG).show();
        } catch (Throwable ex) {
            Toast.makeText(this, "Paylaşım açılamadı. Toplu MASTER + coin verileri panoya kopyalandı.", Toast.LENGTH_LONG).show();
        }
    }
'''
    a = a[:pos] + helpers + '\n' + a[pos:]

a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.45', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.45', a)
ANALYSIS.write_text(a)

# Version bump only after all modifications succeeded.
bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091309', bf, count=1)
bf = re.sub(r"versionName\s+['\"][^'\"]+['\"]", "versionName '9.5.45'", bf, count=1)
BUILD.write_text(bf)

# Fail fast on behavior retention.
main = MAIN.read_text(); mon = MON.read_text(); ana = ANALYSIS.read_text(); bf = BUILD.read_text()
checks = {
    'v9544 coin jump retained': 'V9544_COIN_JUMP_NAV' in main and 'v9544ScrollToCoin' in main,
    'batch launcher': 'V9545_BATCH_BUTTON' in main and 'v9545ShowBatchAnalysisDialog' in main,
    'top overlay': 'V9545_TOP_OVERLAY' in main and 'v9545_top_overlay' in main,
    'advisory timestamp': 'V9545_PLAN_IMPORT_TIMESTAMP' in main and 'v9545_plan_import_ts_' in main,
    'quick order retained': 'V9543C_SINGLE_TAP_APPROVAL' in main and 'V9543C_EXECUTION_DRIFT_RECHECK' in main,
    'notification ticket lock retained': 'v9543b_strict_ticket_' in main,
    'batch wraps current buildPack': 'V9545_BATCH_BUILD_GUARD' in ana and 'v9545BatchInternalKick' in ana,
    'success/failure hooks': 'V9545_BATCH_SUCCESS_HOOK' in ana and 'V9545_BATCH_FAILURE_HOOK' in ana,
    'multi share': 'ACTION_SEND_MULTIPLE' in ana and 'v9545ComposeCombinedPrompt' in ana,
    'no auto order added by v9545': 'V9545_AUTO_ORDER' not in main and 'V9545_AUTO_ORDER' not in ana,
    'version code': 'versionCode 26091309' in bf,
    'version name': "versionName '9.5.45'" in bf,
}
for name, ok in checks.items():
    print(('OK   ' if ok else 'FAIL '), name)
bad = [name for name, ok in checks.items() if not ok]
if bad:
    raise SystemExit('v9.5.45 sanity failed: ' + ', '.join(bad))
print('v9.5.45 OK: fixed top return + 2–8 coin sequential batch analysis + advisory freshness; trading core/explicit-order guards retained.')
