from pathlib import Path
import re

ROOT = Path('/tmp/futures15m-build/Futures15mAlarm')
MAIN = ROOT / 'app/src/main/java/com/futuresalarm/app/MainActivity.java'
STORE = ROOT / 'app/src/main/java/com/futuresalarm/app/PlanStore.java'
GRADLE = ROOT / 'app/build.gradle'
MANIFEST = ROOT / 'app/src/main/AndroidManifest.xml'

for path in (MAIN, STORE, GRADLE, MANIFEST):
    if not path.exists():
        raise SystemExit(f'Missing required file: {path}')

s = MAIN.read_text()

# v9.1 başlık ve akış metinleri.
s = s.replace('15m Futures Alarm PRO v9 • MANUEL PRO',
              '15m Futures Alarm PRO v9.1 • MANUEL PRO')
s = s.replace('CHATGPT ANALİZ PLAN KODU / TOPLU GÜNCELLE',
              'CHATGPT PLAN KODU YAPIŞTIR / TOPLU GÜNCELLE')
s = s.replace('CHATGPT PRO ANALİZ PROMPTUNU KOPYALA',
              'MASTER ANALİZ PROMPTUNU KOPYALA • GRAFİKLERLE GÖNDER')
s = s.replace('v9 MANUEL PRO çalışma şekli:', 'v9.1 MANUEL PRO çalışma şekli:')

# Tek tek coin / seviye ekleme butonunu kaldır.
s, add_count = re.subn(
    r'\n        Button add = button\("\+ YENİ COIN / MANUEL PLAN EKLE".*?\n        root\.addView\(add, addLp\);\n',
    '\n', s, flags=re.S)
if add_count not in (0, 1):
    raise SystemExit(f'Unexpected manual add matches: {add_count}')

# Karttaki DÜZENLE butonunu kaldır; yalnız SİL kalsın.
actions_pattern = re.compile(
    r'\n        LinearLayout actions = new LinearLayout\(this\);.*?\n        card\.addView\(actions, actionsLp\);',
    flags=re.S)
delete_only = '''
        Button del = button("SİL", Color.rgb(127, 29, 29));
        del.setOnClickListener(v -> confirmDelete(p));
        LinearLayout.LayoutParams delLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(42));
        delLp.setMargins(0, dp(7), 0, 0);
        card.addView(del, delLp);'''
s, action_count = actions_pattern.subn(delete_only, s)
if action_count not in (0, 1):
    raise SystemExit(f'Unexpected edit-action matches: {action_count}')

# Toplu plan girişi: giriş kutusu SABİT yükseklikte ve kendi içinde kaydırılabilir.
# Böylece uzun kodlarda GÜNCELLE / EKLE butonu ekranın altında kaybolmaz.
start = s.find('    private void openImportDialog() {')
end = s.find('    private void openPlanDialog(TradePlan existing) {')
if start < 0 or end < 0 or end <= start:
    raise SystemExit('Could not locate import dialog methods')
new_import = r'''    private void openImportDialog() {
        EditText input = new EditText(this);
        input.setHint("ChatGPT cevabının EN SONUNDAKİ | işaretli detaylı plan kodunu yapıştır.\nBirden fazla coin varsa alt alta yapıştır.");
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.rgb(148, 163, 184));
        input.setSingleLine(false);
        input.setMinLines(6);
        input.setMaxLines(8);
        input.setGravity(Gravity.TOP | Gravity.START);
        input.setPadding(dp(14), dp(10), dp(14), dp(10));
        input.setVerticalScrollBarEnabled(true);
        input.setHorizontallyScrolling(false);
        input.setOverScrollMode(View.OVER_SCROLL_ALWAYS);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("ChatGPT detaylı plan kodunu yapıştır")
                .setMessage("Sadece 13 alanlı | işaretli plan kodları kabul edilir. Coin kayıtlıysa güncellenir, değilse otomatik eklenir.")
                .setView(input)
                .setNegativeButton("İPTAL", null)
                .setPositiveButton("GÜNCELLE / EKLE", null)
                .create();

        dialog.setOnShowListener(x -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                String rawText = input.getText().toString()
                        .replace("```text", "")
                        .replace("```", "")
                        .trim();
                if (rawText.isEmpty()) {
                    Toast.makeText(this, "Plan kodu boş.", Toast.LENGTH_LONG).show();
                    return;
                }

                String[] lines = rawText.split("\\r?\\n");
                int success = 0;
                int failed = 0;
                StringBuilder failedLines = new StringBuilder();

                for (String line : lines) {
                    String code = line.trim();
                    if (code.isEmpty()) continue;
                    code = code.replaceFirst("^[\\-•*]+\\s*", "")
                               .replaceFirst("^\\d+[\\.)]\\s*", "");
                    if (!code.contains("|")) continue;
                    try {
                        String[] a = code.replace(',', '.').split("\\|", -1);
                        if (a.length != 13)
                            throw new IllegalArgumentException("13 alanlı detaylı plan kodu gerekli");
                        String sym = a[0].trim().toUpperCase(Locale.US).replace("/", "");
                        if (!sym.endsWith("USDT")) sym += "USDT";
                        double pl = Double.parseDouble(a[1].trim());
                        double ph = Double.parseDouble(a[2].trim());
                        double rl = Double.parseDouble(a[3].trim());
                        double rh = Double.parseDouble(a[4].trim());
                        double bo = Double.parseDouble(a[5].trim());
                        double bd = Double.parseDouble(a[6].trim());
                        int dec = Math.max(0, Math.min(8, Integer.parseInt(a[7].trim())));
                        double pre = Math.max(0.05, Math.min(5.0, Double.parseDouble(a[8].trim())));
                        if (sym.length() < 5 || pl >= ph || rl >= rh || bo <= 0 || bd <= 0)
                            throw new IllegalArgumentException("Ana seviyeler hatalı");

                        String lpDetail = detailLp(a[9], dec);
                        String lbDetail = detailLb(a[10], dec);
                        String srDetail = detailSr(a[11], dec);
                        String sbDetail = detailSb(a[12], dec);
                        PlanStore.upsert(this, new TradePlan(sym, pl, ph, rl, rh, bo, bd, dec, pre,
                                lpDetail, lbDetail, srDetail, sbDetail));
                        success++;
                    } catch (Exception e) {
                        failed++;
                        if (failedLines.length() < 260) {
                            if (failedLines.length() > 0) failedLines.append("\n");
                            failedLines.append(code);
                        }
                    }
                }

                if (success > 0) {
                    dialog.dismiss();
                    setContentView(buildUi());
                    refreshStatus();
                    String msg = success + " plan eklendi/güncellendi";
                    if (failed > 0) msg += " • " + failed + " kod satırı hatalı";
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                    if (failed > 0) {
                        new AlertDialog.Builder(this)
                                .setTitle("Bazı kod satırları alınamadı")
                                .setMessage("Başarılı: " + success + "\nHatalı: " + failed + "\n\nKontrol et:\n" + failedLines)
                                .setPositiveButton("TAMAM", null)
                                .show();
                    }
                } else {
                    Toast.makeText(this,
                            "Plan kodu okunamadı. ChatGPT cevabının en sonundaki 13 alanlı | işaretli kod satırını aynen yapıştır.",
                            Toast.LENGTH_LONG).show();
                }
            });
        });
        dialog.show();
    }

'''
s = s[:start] + new_import + s[end:]

# Binance mobil uygulamasını önce explicit deeplink ile aç.
new_method = '''    private void openBinanceFutures(String symbol) {
        String sym = symbol == null ? "" : symbol.trim().toUpperCase(Locale.US);
        if (sym.isEmpty()) return;

        String[] appLinks = new String[] {
                "bnc://app.binance.com/futures/trade?symbol=" + Uri.encode(sym),
                "bnc://app.binance.com/futures/" + Uri.encode(sym),
                "https://www.binance.com/en/futures/" + Uri.encode(sym)
        };
        for (String link : appLinks) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(link));
                i.setPackage("com.binance.dev");
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                startActivity(i);
                return;
            } catch (Exception ignored) {
            }
        }

        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage("com.binance.dev");
            if (launch != null) {
                ClipboardManager cb = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cb != null) cb.setPrimaryClip(ClipData.newPlainText("Binance Futures coin", sym));
                startActivity(launch);
                Toast.makeText(this, sym + " kopyalandı • Binance açıldı. Futures aramasına yapıştır.", Toast.LENGTH_LONG).show();
                return;
            }
        } catch (Exception ignored) {
        }

        try {
            Uri web = Uri.parse("https://www.binance.com/en/futures/" + Uri.encode(sym));
            startActivity(new Intent(Intent.ACTION_VIEW, web));
        } catch (Exception e) {
            Toast.makeText(this, "Binance Futures açılamadı.", Toast.LENGTH_LONG).show();
        }
    }'''
pattern = re.compile(r'    private void openBinanceFutures\(String symbol\) \{.*?\n    \}\n\n    private void copyPlan', re.S)
s, binance_count = pattern.subn(new_method + '\n\n    private void copyPlan', s)
if binance_count != 1:
    raise SystemExit(f'Could not patch Binance method; matches={binance_count}')

# STOP/TP eksik planları açıkça işaretle.
s = s.replace('STOP/TP henüz yok — detaylı plan koduyla güncelle',
              '⚠ STOP/TP EKSİK — güncel ChatGPT detaylı plan kodunu yapıştır')
s = s.replace('return s == null || s.trim().isEmpty() ? "STOP/TP yok" : s.replace("\\n", " • ");',
              'return s == null || s.trim().isEmpty() ? "STOP/TP EKSİK — detaylı plan kodu gerekli" : s.replace("\\n", " • ");')

# Master prompt sürümünü ve son kod gereksinimini netleştir.
s = s.replace('Bu prompt uygulamanın resmi analiz standardıdır.',
              'Bu prompt uygulamanın resmi v9.1 analiz standardıdır.')
s = s.replace('SON ÇIKTI: Uygulamadaki MANUEL PRO planını güncellemek için tek satırlık plan kodu üret.',
              'SON ÇIKTI: Uygulamadaki MANUEL PRO planını güncellemek için TEK SATIR 13 ALANLI detaylı plan kodu üret.')

MAIN.write_text(s)

# Temiz kurulumda eski, STOP/TP'siz varsayılan planları otomatik ekleme.
t = STORE.read_text()
t, defaults_count = re.subn(
    r'    public static List<TradePlan> defaults\(\) \{.*?\n    \}\n',
    '    public static List<TradePlan> defaults() {\n        return new ArrayList<>();\n    }\n',
    t, flags=re.S)
if defaults_count != 1:
    raise SystemExit(f'Could not replace defaults; matches={defaults_count}')
STORE.write_text(t)

# Sürüm yükselt.
b = GRADLE.read_text()
b = b.replace('versionCode 9', 'versionCode 10')
b = b.replace("versionName '9.0.0'", "versionName '9.1.0'")
GRADLE.write_text(b)

# Android 11+ package visibility: Binance uygulamasını launch fallback ile görebil.
m = MANIFEST.read_text()
if '<queries>' not in m:
    m = m.replace('<application',
                  '    <queries>\n        <package android:name="com.binance.dev" />\n    </queries>\n\n    <application',
                  1)
MANIFEST.write_text(m)

# Final sanity checks.
final = MAIN.read_text()
checks = [
    ('+ YENİ COIN / MANUEL PLAN EKLE' not in final, 'manual add button still present'),
    ('button("DÜZENLE"' not in final, 'edit button still present'),
    ('a.length != 13' in final, '13-field parser missing'),
    ('input.setMaxLines(8)' in final, 'scrollable limited-height import box missing'),
    ('GÜNCELLE / EKLE' in final, 'import action button missing'),
    ('bnc://app.binance.com/futures/trade?symbol=' in final, 'Binance deeplink missing'),
    ('MASTER ANALİZ PROMPTUNU KOPYALA' in final, 'master prompt button missing'),
    ('versionCode 10' in GRADLE.read_text(), 'versionCode not bumped'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit(msg)

print('v9.1 patch OK: plan box scrolls internally; GUNCELLE/EKLE remains visible.')
