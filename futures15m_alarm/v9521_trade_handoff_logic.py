from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
MON = JAVA / 'MonitorService.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'
TRADE = JAVA / 'TradePlan.java'
for p in (MAIN, MON, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.21 missing: ' + str(p))


def method_bounds(src, signature):
    a = src.find(signature)
    if a < 0:
        return None
    b = src.find('{', a)
    if b < 0:
        return None
    depth = 1
    i = b + 1
    quote = False
    char_quote = False
    esc = False
    while i < len(src) and depth:
        c = src[i]
        if quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                quote = False
        elif char_quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == "'":
                char_quote = False
        else:
            if c == '"':
                quote = True
            elif c == "'":
                char_quote = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return None if depth else (a, b, i)

# ================================================================
# MainActivity: exact Binance Futures contract + real-signal ticket
# ================================================================
m = MAIN.read_text()
m = m.replace('v9.5.20', 'v9.5.21')
m = re.sub(r'15m Futures Alarm PRO\s*v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.21', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.21  •  MANUEL PRO', m)
m = m.replace("BINANCE FUTURES'TA AÇ", 'BINANCE FUTURES SAYFASINI AÇ')

b = method_bounds(m, '    private void openBinanceFutures(String symbol) ')
if not b:
    raise SystemExit('v9.5.21 openBinanceFutures not found')
a0, _, e0 = b
new_open = r'''    private void openBinanceFutures(String symbol) {
        String sym = symbol == null ? "" : symbol.trim().toUpperCase(Locale.US);
        if (sym.isEmpty()) return;

        boolean ticketCopied = v9521CopyActiveSignalTicket(sym);
        String futuresUrl = "https://www.binance.com/en/futures/" + Uri.encode(sym);

        // Önce Binance uygulamasına tam sözleşme universal linkini ver.
        try {
            Intent direct = new Intent(Intent.ACTION_VIEW, Uri.parse(futuresUrl));
            direct.setPackage("com.binance.dev");
            direct.addCategory(Intent.CATEGORY_BROWSABLE);
            direct.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(direct);
            if (!ticketCopied) Toast.makeText(this,
                    sym + " Futures açılıyor. Giriş/STOP/TP yalnız gerçek sinyalde hazırlanır.",
                    Toast.LENGTH_LONG).show();
            return;
        } catch (Throwable ignored) {}

        // Binance sürümü linki yakalamıyorsa ana sayfaya düşmek yerine tam
        // sözleşmenin resmi Futures web sayfasını aç. Android destekliyorsa bu
        // yine Binance uygulamasına, değilse tarayıcıdaki doğru sözleşmeye gider.
        try {
            Intent exact = new Intent(Intent.ACTION_VIEW, Uri.parse(futuresUrl));
            exact.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(exact);
            if (!ticketCopied) Toast.makeText(this,
                    sym + " Futures sayfası açılıyor. Giriş/STOP/TP yalnız gerçek sinyalde hazırlanır.",
                    Toast.LENGTH_LONG).show();
            return;
        } catch (Throwable ignored) {}

        // Son çare: Binance'i aç, sembolü panoya bırak.
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage("com.binance.dev");
            if (launch != null) {
                ClipboardManager cb = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cb != null && !ticketCopied)
                    cb.setPrimaryClip(ClipData.newPlainText("Binance Futures sembolü", sym));
                startActivity(launch);
                Toast.makeText(this,
                        ticketCopied
                                ? "Sinyal planı panoda • Binance açıldı. Kaldıraç ve marjı siz seçip emri onaylayın."
                                : sym + " panoya kopyalandı • Binance Futures aramasına yapıştırın.",
                        Toast.LENGTH_LONG).show();
                return;
            }
        } catch (Throwable ignored) {}

        Toast.makeText(this, "Binance Futures açılamadı.", Toast.LENGTH_LONG).show();
    }'''
m = m[:a0] + new_open + m[e0:]

if 'private boolean v9521CopyActiveSignalTicket(' not in m:
    pos = m.rfind('}')
    helper = r'''

    private double v9521SignalNumber(android.content.SharedPreferences sp, String key) {
        try { return Double.parseDouble(sp.getString(key, "NaN")); }
        catch (Throwable ignored) { return Double.NaN; }
    }

    private boolean v9521CopyActiveSignalTicket(String symbol) {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE);
            if (!sp.getBoolean("v9518_signal_active_" + symbol, false)) return false;
            String side = sp.getString("v9518_signal_side_" + symbol, "-");
            String reason = sp.getString("v9518_signal_reason_short_" + symbol, "gerçek giriş teyidi");
            double entry = v9521SignalNumber(sp, "v9518_signal_price_" + symbol);
            double stop = v9521SignalNumber(sp, "v9518_signal_stop_" + symbol);
            double t1 = v9521SignalNumber(sp, "v9518_signal_tp1_" + symbol);
            double t2 = v9521SignalNumber(sp, "v9518_signal_tp2_" + symbol);
            double t3 = v9521SignalNumber(sp, "v9518_signal_tp3_" + symbol);
            if (Double.isNaN(entry) || Double.isNaN(stop)) return false;

            StringBuilder x = new StringBuilder();
            x.append(symbol).append(" • ").append(side).append("\n");
            x.append("SİNYAL NEDENİ: ").append(reason).append("\n");
            x.append("GİRİŞ (SİNYAL FİYATI): ").append(String.format(java.util.Locale.US, "%.8f", entry)).append("\n");
            x.append("STOP: ").append(String.format(java.util.Locale.US, "%.8f", stop)).append("\n");
            if (!Double.isNaN(t1)) x.append("TP1: ").append(String.format(java.util.Locale.US, "%.8f", t1)).append("\n");
            if (!Double.isNaN(t2)) x.append("TP2: ").append(String.format(java.util.Locale.US, "%.8f", t2)).append("\n");
            if (!Double.isNaN(t3)) x.append("TP3: ").append(String.format(java.util.Locale.US, "%.8f", t3)).append("\n");
            x.append("KALDIRAÇ / MARJ: Binance'ta kullanıcı tarafından seçilecek\n");
            x.append("EMİR: kullanıcı onayı olmadan açılmaz");

            ClipboardManager cb = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cb == null) return false;
            cb.setPrimaryClip(ClipData.newPlainText(symbol + " Futures sinyal planı", x.toString()));
            Toast.makeText(this,
                    "Gerçek sinyalin GİRİŞ / STOP / TP planı panoya kopyalandı. Kaldıraç ve marjı Binance'ta siz seçin.",
                    Toast.LENGTH_LONG).show();
            return true;
        } catch (Throwable ignored) { return false; }
    }

    private String v9521ScenarioStatus(String symbol, String code) {
        String raw = getSharedPreferences(MonitorService.PREFS, MODE_PRIVATE)
                .getString("v95_meta_" + symbol, "");
        if (raw == null) return "";
        String u = raw.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G')
                .replace('Ü','U').replace('Ö','O').replace('Ç','C');
        java.util.regex.Matcher q = java.util.regex.Pattern.compile(
                "(?:^|;)\\s*" + java.util.regex.Pattern.quote(code + "_DURUM") + "\\s*[:=]\\s*([^;]+)")
                .matcher(u);
        return q.find() ? q.group(1).trim() : "";
    }
'''
    m = m[:pos] + helper + '\n' + m[pos:]

# Senaryo kartı yeni META durumunu gösterir.
b = method_bounds(m, '    private String v953ScenarioLabel(String symbol, String side, String base) ')
if b:
    a0, _, e0 = b
    body = m[a0:e0]
    if 'v9521ScenarioStatus' not in body:
        insert = '''\n        String v9521Code = base.contains("PULLBACK") || base.contains("GERİ ÇEKİLME") ? "LP"\n                : base.contains("BREAKOUT") || base.contains("YUKARI KIRILIM") ? "LB"\n                : base.contains("DİRENÇ") || base.contains("DIRENC") ? "SR"\n                : base.contains("BREAKDOWN") || base.contains("AŞAĞI KIRILIM") ? "SB" : "";\n        String v9521Status = v9521ScenarioStatus(symbol, v9521Code);\n        if (v9521Status.contains("GECERSIZ")) return "GEÇERSİZ • " + base;\n'''
        p = body.find('{') + 1
        body = body[:p] + insert + body[p:]
        m = m[:a0] + body + m[e0:]

# Yeni plan yapıştırıldığında runtime geçersizlik kilitlerini temizle.
b = method_bounds(m, '    private void v953ResetSignalLocks(String symbol) ')
if b:
    a0, _, e0 = b
    body = m[a0:e0]
    if 'v9521_invalid_' not in body:
        body = body.replace('.remove("v953_trade_lock_" + symbol + "_SHORT")',
                            '.remove("v953_trade_lock_" + symbol + "_SHORT")\n'
                            '                .remove("v9521_invalid_" + symbol + "_LP")\n'
                            '                .remove("v9521_invalid_" + symbol + "_SR")')
        m = m[:a0] + body + m[e0:]

if 'V9521_TRADE_HANDOFF' not in m:
    p = m.find('\n', m.find('public class '))
    if p < 0: p = 0
    m = m[:p+1] + '    // V9521_TRADE_HANDOFF\n' + m[p+1:]
MAIN.write_text(m)

# ================================================================
# MonitorService: META scenario gate + permanent LP/SR invalidation
# ================================================================
mon = MON.read_text().replace('v9.5.20', 'v9.5.21')

if 'private boolean v9521ScenarioAllowed(' not in mon:
    anchor = '    private boolean v9517StableFlow('
    if anchor not in mon:
        anchor = '    private String v953Decision(String symbol) {'
    idx = mon.find(anchor)
    if idx < 0:
        raise SystemExit('v9.5.21 monitor helper anchor missing')
    helper = r'''    private String v9521Norm(String x) {
        return x == null ? "" : x.toUpperCase(java.util.Locale.ROOT)
                .replace('İ','I').replace('Ş','S').replace('Ğ','G')
                .replace('Ü','U').replace('Ö','O').replace('Ç','C');
    }

    private String v9521MetaStatus(String symbol, String code) {
        String raw = prefs.getString("v95_meta_" + symbol, "");
        String u = v9521Norm(raw);
        java.util.regex.Matcher q = java.util.regex.Pattern.compile(
                "(?:^|;)\\s*" + java.util.regex.Pattern.quote(code + "_DURUM") + "\\s*[:=]\\s*([^;]+)")
                .matcher(u);
        return q.find() ? q.group(1).trim() : "";
    }

    private boolean v9521ScenarioAllowed(String symbol, String code) {
        if (prefs.getBoolean("v9521_invalid_" + symbol + "_" + code, false)) return false;
        String st = v9521MetaStatus(symbol, code);
        return !(st.contains("GECERSIZ") || st.contains("PASIF"));
    }

    private double v9521StopFromDetail(String detail) {
        if (detail == null) return Double.NaN;
        try {
            java.util.regex.Matcher q = java.util.regex.Pattern.compile(
                    "STOP\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
                    java.util.regex.Pattern.CASE_INSENSITIVE).matcher(detail);
            return q.find() ? Double.parseDouble(q.group(1)) : Double.NaN;
        } catch (Throwable ignored) { return Double.NaN; }
    }

'''
    mon = mon[:idx] + helper + mon[idx:]

repls = [
    ('boolean pullConfirmed = v953DirectionAllowed(p.symbol, true)\n',
     'boolean pullConfirmed = v953DirectionAllowed(p.symbol, true)\n                && v9521ScenarioAllowed(p.symbol, "LP")\n'),
    ('boolean resConfirmed = v953DirectionAllowed(p.symbol, false)\n',
     'boolean resConfirmed = v953DirectionAllowed(p.symbol, false)\n                && v9521ScenarioAllowed(p.symbol, "SR")\n'),
    ('boolean breakout = v953DirectionAllowed(p.symbol, true)\n',
     'boolean breakout = v953DirectionAllowed(p.symbol, true)\n                && v9521ScenarioAllowed(p.symbol, "LB")\n'),
    ('boolean breakdown = v953DirectionAllowed(p.symbol, false)\n',
     'boolean breakdown = v953DirectionAllowed(p.symbol, false)\n                && v9521ScenarioAllowed(p.symbol, "SB")\n'),
]
for old, new in repls:
    if old in mon and new not in mon:
        mon = mon.replace(old, new, 1)

# TradePlan alan adlarını build sırasında keşfet. LP/SR yapısal STOP aşılırsa
# aynı eski senaryo yeni plan gelene kadar yeniden canlanmaz. Breakout/breakdown
# STOP'u giriş sonrası içindir; bunları pre-trigger geçersiz sayma.
trade_src = TRADE.read_text() if TRADE.exists() else ''
def choose_field(candidates):
    for c in candidates:
        if re.search(r'\b' + re.escape(c) + r'\b', trade_src):
            return c
    return None
lp_field = choose_field(['longPullDetail','longPullbackDetail','lpDetail','pullDetail'])
sr_field = choose_field(['shortResDetail','shortResistanceDetail','srDetail','resDetail'])

live_anchor = '        double v953LivePrice = (set.current != null ? set.current.close : closed.close);'
if live_anchor in mon and 'V9521_RUNTIME_INVALIDATION' not in mon:
    code = '\n        // V9521_RUNTIME_INVALIDATION\n'
    if lp_field:
        code += f'        double v9521LpStop = v9521StopFromDetail(p.{lp_field});\n'
        code += '        if (!Double.isNaN(v9521LpStop) && v953LivePrice <= v9521LpStop) prefs.edit().putBoolean("v9521_invalid_" + p.symbol + "_LP", true).apply();\n'
    if sr_field:
        code += f'        double v9521SrStop = v9521StopFromDetail(p.{sr_field});\n'
        code += '        if (!Double.isNaN(v9521SrStop) && v953LivePrice >= v9521SrStop) prefs.edit().putBoolean("v9521_invalid_" + p.symbol + "_SR", true).apply();\n'
    code += '        // Yeni plan yapıştırılınca MainActivity kilitleri sıfırlar.\n'
    mon = mon.replace(live_anchor, live_anchor + code, 1)

if 'V9521_SCENARIO_STATUS_GATE' not in mon:
    p = mon.find('\n', mon.find('public class '))
    if p < 0: p = 0
    mon = mon[:p+1] + '    // V9521_SCENARIO_STATUS_GATE\n' + mon[p+1:]
MON.write_text(mon)

# ================================================================
# Analysis prompt: decision semantics + sequential trigger contract
# ================================================================
a = ANALYSIS.read_text()
a = a.replace('v9.5.20', 'v9.5.21')
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.21', a)

old = ('LONG geri çekilmede yalnız temas yetmez: bölge teması sonrası TAMAMLANMIŞ 15m mum pullHigh üzerinde kapanarak bölgeyi geri kazanmalı. '
       'SHORT direnç reddinde yalnız temas yetmez: bölge teması sonrası TAMAMLANMIŞ 15m mum resLow altında kapanmalı. Fitil/temas tek başına sinyal değildir.')
if old not in a:
    old = ('LONG geri çekilmede yalnız temas yetmez: bölge teması sonrası TAMAMLANMIŞ 15m mum pullHigh üzerinde kapanarak bölgeyi geri kazanmalı. '
           'SHORT direnç reddinde yalnız temas yetmez: bölge teması sonrası TAMAMLANMIŞ 15m mum resLow altında kapanmalı. Wick/temas tek başına sinyal değildir.')
new = ('LONG geri çekilmede yalnız temas yetmez: bölge teması sonrası TAMAMLANMIŞ 15m mum pullHigh üzerinde kapanarak bölgeyi geri kazanmalı. '
       'Bu kapanış SENARYO TEYİDİDİR; tek başına giriş değildir. Teyitten sonra güncel fiyat giriş/yeniden test alanında değilse fiyatı kovalamadan yeniden testi bekle. '
       'SHORT direnç reddinde bölge teması sonrası TAMAMLANMIŞ 15m mum resLow altında kapanmalı; bu da SENARYO TEYİDİDİR. Teyit sonrası fiyat giriş/yeniden test alanına dönmeden sinyal verme. '
       'Yukarı/aşağı kırılımda da tamamlanmış 15m kapanış önce senaryoyu teyit eder; gerçek sinyal için ardından fiyat LB/SB giriş alanında veya geçerli yeniden testte olmalı ve canlı akış filtresi sağlanmalıdır. Fitil/temas tek başına sinyal değildir.')
if old in a:
    a = a.replace(old, new, 1)
else:
    anchor = 'Gerçek işlem tetik teyidi yalnız TAMAMLANMIŞ 15m mum kapanışından gelebilir.'
    if anchor in a and 'Bu kapanış SENARYO TEYİDİDİR' not in a:
        a = a.replace(anchor, anchor + ' ' + new, 1)

old_conf = ('80-100 yalnız temiz çoklu zaman dilimi uyumu, geçerli 15m tetik ve yeterince taze/uyumlu yardımcı veri varsa kullanılacak; 80+ nadir olmalı. '
            '65-79 güçlü fakat koşullu adaydır. 60-64 karışık/sınırda yapı; mevcut giriş için İŞLEM YOK tercih et. 60 altı veya kritik çelişki/veri eksikliği varsa İŞLEM YOK. '
            'Kısa/kısmi CVD, karşıt OI-taker-book veya belirsiz HTF yapı varken aşırı güven puanı verme.')
new_conf = ('GÜVEN yalnız ANA KARARIN doğruluğuna duyulan güvendir; senaryo kalitesi veya işlem açma olasılığı değildir. '
            'Örneğin ANA KARAR=İŞLEM YOK ve GÜVEN=68 ise bunun anlamı bekleme kararına 68/100 güvenilmesidir; LONG/SHORT senaryo kalitesi 68 değildir. '
            'GÜVEN tek başına işlem açtırmaz. 80+ yalnız çoklu zaman dilimi, konum, tamamlanmış 15m teyit ve taze yardımcı veriler aynı kararı güçlü biçimde destekliyorsa kullanılmalı ve nadir olmalıdır. '
            '65-79 orta-yüksek karar güveni, 50-64 sınırda/belirsiz karar güveni, 50 altı düşük karar güvenidir. Kısa/kısmi CVD, karşıt OI-akış/emir defteri veya belirsiz üst zaman dilimi yapı varken aşırı güven verme.')
if old_conf in a:
    a = a.replace(old_conf, new_conf, 1)

old_rr = ('Giriş, STOP ve TP seviyeleri mutlaka yapı dayanağına bağlanacak: salınım, FVG, OB, likidite, Fibonacci veya teyitli kırılım/yeniden test. '
          'STOP rastgele yakın/uzak konmayacak; yapısal geçersizlik tarafında olacak. Giriş aralığında R/R hesabını en kötü giriş fiyatından yap. '
          'TP1 en az 1.0R ve TP2 en az 1.5R sağlamıyorsa senaryoyu UYGUN sayma; BEKLE/GEÇERSİZ yap. Hedefi önündeki bariz karşı likidite/direnç-destek engelinin ötesine körlemesine koyma.')
if old_rr not in a:
    old_rr = ('Giriş, STOP ve TP seviyeleri mutlaka yapı dayanağına bağlanacak: swing, FVG, OB, likidite, Fibonacci veya teyitli kırılım/retest. STOP rastgele yakın/uzak konmayacak; yapısal geçersizlik tarafında olacak. Giriş aralığında R/R hesabını en kötü giriş fiyatından yap. TP1 en az 1.0R ve TP2 en az 1.5R sağlamıyorsa senaryoyu UYGUN sayma; BEKLE/GEÇERSİZ yap. Hedefi önündeki bariz karşı likidite/direnç-destek engelinin ötesine körlemesine koyma.')
new_rr = ('Giriş, STOP ve TP seviyeleri mutlaka yapı dayanağına bağlanacak: salınım, FVG, OB, likidite, Fibonacci veya teyitli kırılım/yeniden test. '
          'STOP yapısal geçersizlik tarafında olmalı. R/R hesabında LONG için en kötü giriş giriş aralığının ÜST sınırı, SHORT için en kötü giriş ALT sınırıdır. '
          'LONG: STOP < giriş ve TP1 < TP2 < TP3 sıralaması; SHORT: STOP > giriş ve TP1 > TP2 > TP3 sıralaması zorunludur. '
          'TP1 en az 1.0R ve TP2 en az 1.5R sağlamıyorsa senaryoyu UYGUN sayma. Hedefi bariz karşı likidite/direnç-destek engelinin ötesine körlemesine koyma.')
if old_rr in a:
    a = a.replace(old_rr, new_rr, 1)

late_anchor = "Giriş toleransını sonradan genişleterek eski senaryoyu kurtarma."
if late_anchor not in a:
    late_anchor = "Giriş toleransını sonradan genişleterek eski setup'ı kurtarma."
if late_anchor in a and 'aynı planla yeniden canlandırma' not in a:
    a = a.replace(late_anchor,
                  late_anchor + ' LONG geri çekilme veya SHORT direnç senaryosunda fiyat yapısal STOP/geçersizlik tarafını görürse o senaryoyu GECERSIZ say ve aynı planla yeniden canlandırma; yeni analiz/plan gerekir.',
                  1)

meta_old = 'META biçimi: ANA_KARAR:<LONG/SHORT/ISLEM_YOK>;GUVEN:<0-100>;REGIME:;STRUCT:;BOS:;CHOCH:;FVG:;OB:;BREAKER:;FIB:;PD:;LIQ:;TF15:;TF1H:;TF4H:;TF1D:;CONFLUENCE:;WAIT:.'
meta_new = 'META biçimi: ANA_KARAR:<LONG/SHORT/ISLEM_YOK>;GUVEN:<0-100>;REGIME:;STRUCT:;BOS:;CHOCH:;FVG:;OB:;BREAKER:;FIB:;PD:;LIQ:;TF15:;TF1H:;TF4H:;TF1D:;CONFLUENCE:;LP_DURUM:<UYGUN/BEKLE/GECERSIZ>;LB_DURUM:<UYGUN/BEKLE/GECERSIZ>;SR_DURUM:<UYGUN/BEKLE/GECERSIZ>;SB_DURUM:<UYGUN/BEKLE/GECERSIZ>;WAIT:.'
if meta_old in a:
    a = a.replace(meta_old, meta_new, 1)

wait_old = 'WAIT mutlaka Türkçe ve gerçekleşmemiş bir sonraki şartı kısa yazsın.'
wait_new = ('WAIT mutlaka Türkçe ve yalnız BİR SONRAKİ gerçekleşmemiş şartı yazsın. Aşamaları atlama: önce tamamlanmış 15m senaryo teyidi; teyit olduysa giriş/yeniden test alanı; o da olduysa canlı akış filtresi. '
            'Örneğin aşağı kırılım kapanışı oluştu fakat fiyat SB giriş alanının altında kaldıysa WAIT=0.x–0.y yeniden test alanına dönüş; fiyatı kovalamayın yaz.')
if wait_old in a:
    a = a.replace(wait_old, wait_new, 1)

status_anchor = 'Her birine DURUM: UYGUN / BEKLE / GEÇERSİZ yaz;'
if status_anchor in a and 'META içinde LP_DURUM' not in a:
    a = a.replace(status_anchor,
                  status_anchor + ' bu dört DURUMU final META içinde LP_DURUM/LB_DURUM/SR_DURUM/SB_DURUM anahtarlarına da aynen aktar;',
                  1)

if 'V9521_DECISION_SEMANTICS' not in a:
    p = a.find('\n', a.find('public class '))
    if p < 0: p = 0
    a = a[:p+1] + '    // V9521_DECISION_SEMANTICS\n' + a[p+1:]
ANALYSIS.write_text(a)

# Version bump.
bld = BUILD.read_text()
bld = re.sub(r'versionCode\s+\d+', 'versionCode 35', bld, count=1)
bld = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.21'", bld, count=1)
BUILD.write_text(bld)

main = MAIN.read_text()
mon = MON.read_text()
ana = ANALYSIS.read_text()
bld = BUILD.read_text()
checks = [
    ('V9521_TRADE_HANDOFF' in main, 'trade handoff marker'),
    ('https://www.binance.com/en/futures/' in main, 'exact Futures URL'),
    ('v9521CopyActiveSignalTicket' in main and 'KALDIRAÇ / MARJ' in main, 'active signal ticket'),
    ('V9521_SCENARIO_STATUS_GATE' in mon, 'scenario status marker'),
    (mon.count('v9521ScenarioAllowed(p.symbol') >= 4, 'four scenario status gates'),
    ('LP_DURUM:<UYGUN/BEKLE/GECERSIZ>' in ana, 'META scenario statuses'),
    ('GÜVEN yalnız ANA KARARIN doğruluğuna duyulan güvendir' in ana, 'confidence semantics'),
    ('Bu kapanış SENARYO TEYİDİDİR' in ana, 'two-stage confirmation'),
    ('LONG için en kötü giriş giriş aralığının ÜST sınırı' in ana, 'directional RR rule'),
    ('yalnız BİR SONRAKİ gerçekleşmemiş şartı' in ana, 'sequential WAIT'),
    ('versionCode 35' in bld and "versionName '9.5.21'" in bld, 'version'),
]
print('v9.5.21 detected TradePlan fields: LP=%s SR=%s' % (lp_field, sr_field))
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.21 sanity failed: ' + name)
print('v9.5.21 OK: exact Futures handoff + active-signal ticket + scenario-status gate + prompt decision semantics.')
