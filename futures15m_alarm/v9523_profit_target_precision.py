from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'
for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.23 missing: ' + str(p))

# ================================================================
# 1) Prompt: preserve precise chart/data reading, but stop treating the
# minimum R/R thresholds as target anchors. Targets must be independent
# structural objectives, not three nearby labels inside the same liquidity
# cluster.
# ================================================================
a = ANALYSIS.read_text()

# The first hard veto already covers unusable critical data. Clarify that a
# material chart/text contradiction belongs to this veto instead of creating
# a fifth veto and overloading the decision engine.
a = a.replace(
    '(1) kritik veri eski/eksik, (2) fiyat yapısal geçersizlik veya STOP tarafını geçmiş,',
    '(1) kritik veri eski/eksik veya grafik-metin arasında maddi çelişki var, (2) fiyat yapısal geçersizlik veya STOP tarafını geçmiş,',
    1
)

cross_anchor = '        sb.append("3) SAYISAL YAPI TARAMASI KULLANIMI\\n");'
cross_rule = r'''        sb.append("GRAFİK/VERİ ÇAPRAZ DOĞRULAMA: Her zaman diliminde önce grafikte görünen SON TAMAMLANMIŞ kapanışı, sağdaki mavi çerçeveli AÇIK mumun O/H/L/C değerlerini, görünür son anlamlı swing high/low'ları, hacim davranışını ve RSI bağlamını aşağıdaki sayısal metinle eşleştir. Açık mumu kapanmış gibi kullanma. Sayısal tarama bir aday haritadır; grafikte bariz biçimde geçersizleşmiş yapıyı sırf metinde ADAY/ACTIVE yazıyor diye aktif sayma. Buna karşılık grafikte ve kapanmış OHLC'de açıkça doğrulanan yapıyı yalnız otomatik tarama NONE dedi diye yok sayma. Grafik ile paket metni kritik fiyat/kapanış/yön açısından gerçekten uyuşmuyorsa VERİ ÇELİŞKİSİ yaz; bunu kritik veri güvenilir değil kapsamında değerlendir ve yeni gerçek giriş sinyali üretme. 15m ana senaryo/tetik çerçevesidir; 5m kaçan giriş için yeni bağımsız yeniden giriş yapısını arar; 3m yalnız 5m setup zaten geçerliyken hassas zamanlamadır.\\n");
'''
if 'GRAFİK/VERİ ÇAPRAZ DOĞRULAMA:' not in a:
    if cross_anchor not in a:
        raise SystemExit('v9.5.23 chart/data anchor missing')
    a = a.replace(cross_anchor, cross_anchor + cross_rule, 1)

risk_anchor = '        sb.append("6) RİSK/ÖDÜL VE SEVİYE KALİTESİ\\n");'
profit_rule = r'''        sb.append("KÂR POTANSİYELİ KURALI: 1.0R ve 1.5R eşikleri yalnız ASGARİ KALİTE FİLTRESİDİR; TP üretirken hedef/çıpa değildir. Model minimum eşiğe ulaşınca hedef aramayı bırakmayacak. Önce STOP ile gerçek 1R mesafesini hesapla, sonra grafikte ve sayısal haritada fiyatın önündeki BAĞIMSIZ yapısal hedefleri sırayla ara. Güçlü trend yönünde, 1H/4H yapı uyumlu ve önünde açık fiyat alanı varsa TP2 için tercihen >=2R, TP3 için tercihen >=3R potansiyelini ayrıca araştır. Ancak sırf 2R/3R yazmak için görünmeyen seviye uydurma; hedef mutlaka swing, BSL/SSL, aktif FVG/OB sınırı, teyitli destek/direnç veya üst zaman dilimi yapısına dayanmalı. Range veya trend-karşıtı senaryoda piyasa alanı sınırlıysa daha yakın gerçek hedef kabul edilebilir ve güven/öncelik buna göre düşürülür.\\n");
        sb.append("TP AYRIŞMA KURALI: TP1/TP2/TP3 aynı likidite kümesinin birkaç yakın fiyatı olmamalı. Ardışık iki TP arasındaki mesafe 0.40R'den küçükse veya ikisi aynı BSL/SSL/direnç-destek kümesini temsil ediyorsa bunları TEK HEDEF BÖLGESİ olarak değerlendir; sonraki TP için bir sonraki bağımsız yapısal hedefi ara. Üç bağımsız hedef bulunamıyorsa yakın seviyeleri sırf formatı doldurmak için üretme: senaryoyu UYGUN yapma, BEKLE/GEÇERSİZ tut ve yeni yapı/alan bekle. UYGUN senaryoda TP1, TP2 ve TP3 mutlaka fiyat sıralaması doğru olan üç ayrı sayısal seviye olmalı. TP3 güçlü trendde mümkünse daha uzak trend-devam/runner referansıdır; fakat yine gerçek bir yapısal hedefe dayanır.\\n");
        sb.append("HER SENARYODA hedeflerin dayanağını ayrı yaz ve R1/R2/R3 değerlerini göster. R/R hesabında LONG için giriş aralığının en kötü üst fiyatını, SHORT için en kötü alt fiyatını kullan. Komisyon, fonlama ve kayma R hesabına dahil değilse bunu brüt yapı hesabı olarak kabul et.\\n");
'''
if 'KÂR POTANSİYELİ KURALI:' not in a:
    if risk_anchor not in a:
        raise SystemExit('v9.5.23 risk anchor missing')
    a = a.replace(risk_anchor, risk_anchor + profit_rule, 1)

# Strengthen the scenario-output contract without adding more mandatory market
# confirmations. This is target-quality output, not another entry gate.
out_old = 'Her birine DURUM: UYGUN / BEKLE / GEÇERSİZ yaz; geçerliyse giriş bölgesi, STOP, TP1, TP2, TP3, geçersizlik ve dayandığı yapısal confluence\'ı belirt.'
out_new = ('Her birine DURUM: UYGUN / BEKLE / GEÇERSİZ yaz; geçerliyse giriş bölgesi, STOP, TP1, TP2, TP3, '
           'geçersizlik ve dayandığı yapısal confluence\'ı belirt. Her TP için hangi bağımsız swing/likidite/FVG/OB/HTF hedefinden geldiğini ve R1/R2/R3 oranını yaz; aynı hedef kümesini üç ayrı TP gibi sayma.')
a = a.replace(out_old, out_new, 1)

a = a.replace('ChatGPT ANALİZ PAKETİ • v9.5.22', 'ChatGPT ANALİZ PAKETİ • v9.5.23')
a = re.sub(r'Futures15mAlarmPRO/9\.5\.22', 'Futures15mAlarmPRO/9.5.23', a)
if 'V9523_TARGET_QUALITY_CHART_CROSSCHECK' not in a:
    p = a.find('\n', a.find('public class '))
    if p < 0: p = 0
    a = a[:p+1] + '    // V9523_TARGET_QUALITY_CHART_CROSSCHECK\n' + a[p+1:]
ANALYSIS.write_text(a)

# ================================================================
# 2) Order ticket: keep user interaction limited to margin + leverage, but
# calculate and show the actual gross USDT risk/reward before final approval.
# Profit split automatically leaves more size for TP3 when the structural
# plan really has 2R/3R room. It falls back to balanced splitting otherwise.
# ================================================================
m = MAIN.read_text()

# UI label must match the six chart panels actually produced.
m = m.replace('4 zaman dilimi • güncel mumlar', '6 zaman dilimi • 15m / 5m / 3m / 1h / 4h / 1D')

old_warn = 'TextView warn = text("Marj × kaldıraç = yaklaşık pozisyon büyüklüğü. Emir kendi kendine gönderilmez; ikinci ekranda son onay gerekir. TP dağılımı %33 / %33 / %34\'tür.",'
new_warn = 'TextView warn = text("Marj × kaldıraç = yaklaşık pozisyon büyüklüğü. Emir kendi kendine gönderilmez; ikinci ekranda son onay gerekir. TP dağılımı hedeflerin R potansiyeline göre otomatik seçilir; son ekranda risk/kâr USDT olarak gösterilir.",'
if old_warn in m:
    m = m.replace(old_warn, new_warn, 1)
else:
    # tolerate the post-patch source if typography changed only slightly
    m = m.replace('TP dağılımı %33 / %33 / %34\'tür.', 'TP dağılımı hedeflerin R potansiyeline göre otomatik seçilir; son ekranda risk/kâr USDT olarak gösterilir.', 1)

old_draft = '''    private static class V9522OrderDraft {
        String symbol, side, reason, qtyText, q1Text, q2Text, q3Text, positionSide;
        double entryRef, live, stop, tp1, tp2, tp3, margin, step, minQty;
        int leverage; boolean hedge;
    }'''
new_draft = '''    private static class V9522OrderDraft {
        String symbol, side, reason, qtyText, q1Text, q2Text, q3Text, positionSide, splitLabel;
        double entryRef, live, stop, tp1, tp2, tp3, margin, step, minQty;
        double r1, r2, r3, riskUsd, riskMarginPct, tp1FullUsd, tp2FullUsd, tp3FullUsd, splitAllTpUsd;
        int leverage; boolean hedge;
    }'''
if old_draft not in m:
    raise SystemExit('v9.5.23 order draft anchor missing')
m = m.replace(old_draft, new_draft, 1)

old_split = '''                double q1 = v9522Floor(qty * 0.33, step);
                double q2 = v9522Floor(qty * 0.33, step);
                double q3 = v9522Floor(qty - q1 - q2, step);
                if (q1 < minQty || q2 < minQty || q3 < minQty)
                    throw new Exception("Pozisyon miktarı TP1/TP2/TP3'e güvenli bölünemiyor. Marj veya kaldıracı artırın.");'''
new_split = '''                // V9523_DYNAMIC_TP_SPLIT_AND_PNL
                double riskPerUnit = Math.abs(live - stop);
                if (!(riskPerUnit > 0)) throw new Exception("STOP mesafesi sıfır/geçersiz; R/R hesaplanamadı.");
                double r1 = Math.abs(t1 - live) / riskPerUnit;
                double r2 = Math.abs(t2 - live) / riskPerUnit;
                double r3 = Math.abs(t3 - live) / riskPerUnit;

                // Minimum R eşikleri hedef çıpası değildir. Dağılım yalnız daha
                // uzak gerçek hedefler zaten plan içinde varsa TP3'e daha fazla
                // pozisyon bırakır. Yeni fiyat seviyesi burada üretilmez.
                double p1 = 0.33, p2 = 0.33;
                String splitLabel = "DENGELİ %33 / %33 / %34";
                if (r2 >= 2.0 && r3 >= 3.0) {
                    p1 = 0.25; p2 = 0.25; splitLabel = "TREND %25 / %25 / %50";
                } else if (r3 >= 2.5) {
                    p1 = 0.30; p2 = 0.30; splitLabel = "UZATILMIŞ %30 / %30 / %40";
                }
                double q1 = v9522Floor(qty * p1, step);
                double q2 = v9522Floor(qty * p2, step);
                double q3 = v9522Floor(qty - q1 - q2, step);
                if (q1 < minQty || q2 < minQty || q3 < minQty) {
                    p1 = 0.33; p2 = 0.33; splitLabel = "DENGELİ %33 / %33 / %34 (min miktar)";
                    q1 = v9522Floor(qty * p1, step);
                    q2 = v9522Floor(qty * p2, step);
                    q3 = v9522Floor(qty - q1 - q2, step);
                }
                if (q1 < minQty || q2 < minQty || q3 < minQty)
                    throw new Exception("Pozisyon miktarı TP1/TP2/TP3'e güvenli bölünemiyor. Marj veya kaldıracı artırın.");

                double riskUsd = qty * riskPerUnit;
                double riskMarginPct = margin > 0 ? (riskUsd / margin * 100.0) : Double.NaN;
                double tp1FullUsd = qty * Math.abs(t1 - live);
                double tp2FullUsd = qty * Math.abs(t2 - live);
                double tp3FullUsd = qty * Math.abs(t3 - live);
                double splitAllTpUsd = q1 * Math.abs(t1 - live) + q2 * Math.abs(t2 - live) + q3 * Math.abs(t3 - live);'''
if old_split not in m:
    raise SystemExit('v9.5.23 TP split anchor missing')
m = m.replace(old_split, new_split, 1)

old_assign = '''                d.step=step; d.minQty=minQty; d.qtyText=v9522StepText(qty,step);
                d.q1Text=v9522StepText(q1,step); d.q2Text=v9522StepText(q2,step); d.q3Text=v9522StepText(q3,step);'''
new_assign = '''                d.step=step; d.minQty=minQty; d.qtyText=v9522StepText(qty,step);
                d.q1Text=v9522StepText(q1,step); d.q2Text=v9522StepText(q2,step); d.q3Text=v9522StepText(q3,step);
                d.splitLabel=splitLabel; d.r1=r1; d.r2=r2; d.r3=r3;
                d.riskUsd=riskUsd; d.riskMarginPct=riskMarginPct;
                d.tp1FullUsd=tp1FullUsd; d.tp2FullUsd=tp2FullUsd; d.tp3FullUsd=tp3FullUsd;
                d.splitAllTpUsd=splitAllTpUsd;'''
if old_assign not in m:
    raise SystemExit('v9.5.23 order assignment anchor missing')
m = m.replace(old_assign, new_assign, 1)

start = m.find('    private void v9522FinalConfirm(V9522OrderDraft d, long signalTs) {')
end = m.find('    private java.util.LinkedHashMap<String,String> v9522BaseOrder', start)
if start < 0 or end < 0:
    raise SystemExit('v9.5.23 final confirm anchor missing')
new_confirm = r'''    private void v9522FinalConfirm(V9522OrderDraft d, long signalTs) {
        String riskPct = Double.isNaN(d.riskMarginPct) ? "-" : String.format(java.util.Locale.US, "%.2f", d.riskMarginPct);
        String body = d.symbol + " • " + d.side +
                "\nSİNYAL NEDENİ: " + d.reason +
                "\n\nGİRİŞ: PİYASA\nSinyal referansı: " + v9522P(d.entryRef) +
                "\nCanlı fiyat: " + v9522P(d.live) +
                "\nMarj: " + v9522P(d.margin) + " USDT • Kaldıraç: " + d.leverage + "x" +
                "\nMiktar: " + d.qtyText +
                "\nPozisyon modu: " + (d.hedge ? "HEDGE / " + d.positionSide : "TEK YÖN") +
                "\n\nRİSK (STOP): yaklaşık -" + String.format(java.util.Locale.US, "%.2f", d.riskUsd) + " USDT" +
                " • marjın %" + riskPct +
                "\nSTOP: " + v9522P(d.stop) +
                "\n\nTP DAĞILIMI: " + d.splitLabel +
                "\nTP1: " + v9522P(d.tp1) + " • " + String.format(java.util.Locale.US, "%.2fR", d.r1) +
                " • tam pozisyon brüt +" + String.format(java.util.Locale.US, "%.2f", d.tp1FullUsd) + " USDT" +
                " • miktar " + d.q1Text +
                "\nTP2: " + v9522P(d.tp2) + " • " + String.format(java.util.Locale.US, "%.2fR", d.r2) +
                " • tam pozisyon brüt +" + String.format(java.util.Locale.US, "%.2f", d.tp2FullUsd) + " USDT" +
                " • miktar " + d.q2Text +
                "\nTP3: " + v9522P(d.tp3) + " • " + String.format(java.util.Locale.US, "%.2fR", d.r3) +
                " • tam pozisyon brüt +" + String.format(java.util.Locale.US, "%.2f", d.tp3FullUsd) + " USDT" +
                " • miktar " + d.q3Text +
                "\nTüm TP'ler gerçekleşirse parçalı brüt sonuç: yaklaşık +" +
                String.format(java.util.Locale.US, "%.2f", d.splitAllTpUsd) + " USDT" +
                "\n\nNot: Bunlar canlı fiyat ve hesaplanan miktardan türetilen BRÜT tahminlerdir; komisyon, fonlama ve kayma dahil değildir." +
                "\n\nBu düğmeye basılmadan Binance'a hiçbir emir gönderilmez.";
        new android.app.AlertDialog.Builder(this)
                .setTitle("SON EMİR ONAYI • RİSK / KÂR")
                .setMessage(body)
                .setNegativeButton("VAZGEÇ", null)
                .setPositiveButton("EMİRLERİ BINANCE'A GÖNDER", (x,w) -> v9522ExecuteOrder(d, signalTs))
                .show();
    }

'''
m = m[:start] + new_confirm + m[end:]

# Visible version only; do not touch method/marker identifiers.
m = m.replace('v9.5.22  •  MANUEL PRO', 'v9.5.23  •  MANUEL PRO')
m = m.replace('15m Futures Alarm PRO v9.5.22', '15m Futures Alarm PRO v9.5.23')
if 'V9523_PROFIT_TARGET_PNL' not in m:
    p = m.find('\n', m.find('public class '))
    if p < 0: p = 0
    m = m[:p+1] + '    // V9523_PROFIT_TARGET_PNL\n' + m[p+1:]
MAIN.write_text(m)

# ================================================================
# 3) Version bump.
# ================================================================
b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 37', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.23'", b, count=1)
BUILD.write_text(b)

# ================================================================
# Sanity checks: decision precision and order preview must both survive.
# ================================================================
af = ANALYSIS.read_text(); mf = MAIN.read_text(); bf = BUILD.read_text()
checks = [
    ('V9523_TARGET_QUALITY_CHART_CROSSCHECK' in af, 'prompt marker'),
    ('GRAFİK/VERİ ÇAPRAZ DOĞRULAMA:' in af, 'chart/data cross-check'),
    ('KÂR POTANSİYELİ KURALI:' in af, 'profit potential rule'),
    ('TP AYRIŞMA KURALI:' in af, 'TP separation rule'),
    ('ASGARİ KALİTE FİLTRESİDİR' in af, 'minimum R is not target anchor'),
    ('0.40R' in af and '>=2R' in af and '>=3R' in af, 'dynamic R guidance'),
    ('V9523_PROFIT_TARGET_PNL' in mf, 'order/PnL marker'),
    ('V9523_DYNAMIC_TP_SPLIT_AND_PNL' in mf, 'dynamic split marker'),
    ('TREND %25 / %25 / %50' in mf, 'trend split'),
    ('SON EMİR ONAYI • RİSK / KÂR' in mf, 'risk reward preview'),
    ('komisyon, fonlama ve kayma dahil değildir' in mf, 'gross PnL disclosure'),
    ('6 zaman dilimi • 15m / 5m / 3m / 1h / 4h / 1D' in mf, 'six timeframe UI'),
    ('versionCode 37' in bf and "versionName '9.5.23'" in bf, 'version'),
]
for ok, name in checks:
    print(('OK   ' if ok else 'FAIL '), name)
    if not ok:
        raise SystemExit('v9.5.23 sanity failed: ' + name)
print('v9.5.23 OK: precise chart/data cross-check + independent structural TP logic + dynamic TP split + USDT risk/reward preview.')
