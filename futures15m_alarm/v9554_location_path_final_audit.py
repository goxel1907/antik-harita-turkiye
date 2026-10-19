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
        raise SystemExit('v9.5.54 missing: ' + str(p))

# ---------------------------------------------------------------------------
# v9.5.54 is deliberately a decision-discipline / MASTER prompt layer.
# It does NOT regenerate, delete or rewrite any already-pasted daily plan.
# The objective is not "fewer trades"; it is to distinguish a valid direction
# from a bad execution location, and to force a final geometry/RR self-audit.
# ---------------------------------------------------------------------------
a = ANALYSIS.read_text()

if 'V9.5.54 KARAR SIRASI: ONCE KONUM, SONRA YON' not in a:
    anchor = '        sb.append("5) GEÇ GİRİŞ / KOVALAMA / GEÇERSİZLİK FİLTRESİ\\n");'
    if anchor not in a:
        raise SystemExit('v9.5.54 prompt section-5 anchor missing')

    rules = r'''        sb.append("V9.5.54 KARAR SIRASI: ONCE KONUM, SONRA YON. HTF yükseliş trendi tek başına LONG, düşüş trendi tek başına SHORT gerekçesi değildir. Her dalda önce güncel fiyatın son anlamlı impuls içindeki konumunu, aktif destek/direnci, karşı FVG/OB/breaker alanını, BSL/SSL tarafını, premium/discount durumunu ve ATR/salınım uzamasını belirle; sonra yön kararını ver. Güçlü hareketin son kısmında karşı likidite veya supply/demand yapısına dayanmış fiyat için aynı yönde continuation daha güçlü acceptance veya daha iyi retest ister. RSI veya 24s yüzde hareketi tek başına ters yön sinyali de üretmez.\n");
        sb.append("V9.5.54 GIRIS-HEDEF YOL KONTROLU: LP/LB/SR/SB için yalnız giriş kutusunu değil GİRİŞ -> TP1 -> TP2 -> TP3 yolunu incele. LONG giriş ile ilk gerçek hedef arasında henüz geçerli bearish OB/FVG, teyitli direnç veya BSL sweep-rejection alanı 1R dolmadan yolu kesiyorsa LONG dalını UYGUN yapma; SHORT için ayna mantığını uygula. Karşı yapı varsa fakat yapısal STOP'a göre hâlâ yeterli temiz alan ve minimum R/R kalıyorsa bunu hard veto yapma; yalnız güveni/önceliği düşür veya TP yolunu düzelt. Tüketilmiş, doldurulmuş ya da geçersiz yapı engel sayılmaz.\n");
        sb.append("V9.5.54 UZAMA MODU: LATE_EXPANSION, EXHAUSTION, yüksek ATR uzaması veya parabolik hareket tek başına işlem yasağı değildir; execution standardını yükseltir. Tepeye yakın LONG veya dibe yakın SHORT kovalanmaz. Uzamış harekette yüzeysel tek küçük reclaim yeterli sayılmasın; anlamlı yeni demand/supply, aktif FVG/OB/breaker, swing veya SSL/BSL kümesine dönüş ve gerekiyorsa tamamlanmış 5m yapısal kabul/rejection ara. Buna karşılık temiz ve aşırı uzamamış 15m acceptance + iyi konum + yeterli R/R varsa sırf fazladan filtre olsun diye 5m teyidi zorunlu kılma.\n");
        sb.append("V9.5.54 15M SENARYO TEYIDI ILE HEMEN GIRISI AYIR: Tamamlanmış 15m mum senaryoyu teyit edebilir fakat execution hâlâ BEKLE olabilir. Kapanış eşik üzerinde/altında marjinal kaldıysa, gövde kabulü zayıfsa, karşı fitil belirginse, fiyat hemen karşı yapısal engele dayanıyorsa veya yeni giriş bölgesi artık kötü konumdaysa senaryoyu silmeden LTF=5M_BEKLE yap. 5m yeni ana yön üretmez; yalnız aynı teyitli senaryoda güvenli execution/re-entry arar.\n");
        sb.append("V9.5.54 STOP ONCE, RR SONRA: Önce setup'ı gerçekten geçersiz kılan anlamlı swing/SSL/BSL/rejection wick ve uygun ATR/tick tamponundan yapısal STOP'u belirle; ancak bundan SONRA R/R hesapla. Minimum R/R'ye ulaşmak için STOP'u yapının içine daraltmak yasaktır. Gerçek yapısal STOP ile TP1 < 1R veya TP2 < 1.5R kalıyorsa dal UYGUN olamaz; BEKLE/GECERSIZ yap veya daha iyi yeni 5m retest bekle.\n");
        sb.append("V9.5.54 DORT DAL SIMETRISI: LP/LB/SR/SB bağımsız koşullu dallardır ve aynı kalite standardıyla değerlendirilecektir. LONG için tepeyi kovalamama kuralının aynası SHORT için dibi kovalamamadır. ANA_KARAR yalnız paket anındaki bias'tır; karşı yön dalını gün boyu kalıcı yasaklamaz. Aynı sembolde aktif sinyal yaşam döngüsü bitmeden ters/yeni sinyal üretmeme kuralı aynen korunur.\n");
        sb.append("V9.5.54 SINYALI BOGMAMA: Amaç daha az işlem üretmek değil, kötü konumdaki işlemi iyi konumdaki işlemden ayırmaktır. OI, CVD, OBS_LIQ, hacim, taker, orderbook, funding ve RSI çekirdek fiyat yapısının yerine geçmez; aynı olay aynı aile içinde bir kez sayılır. Temiz tamamlanmış 15m yapı + uygun güncel konum + gerçek yapısal STOP + yeterli R/R varsa tek ters yardımcı veri yeni hard veto değildir. Ancak yapı zaten sınırda veya hareket uzamışsa flow/execution ailesindeki belirgin çelişki hemen giriş yerine retest beklemeyi destekleyebilir. Paket 120 sn'den eskiyse canlı akışa dayanarak şimdi giriş deme.\n");
        sb.append("V9.5.54 ZORUNLU FINAL PLAN DENETIMI: Son 14 alanlı plan kodunu yazmadan hemen önce dört dalın SAYISAL geometrisini baştan kontrol et. LONG için STOP < en kötü giriş < TP1 < TP2 < TP3; SHORT için STOP > en kötü giriş > TP1 > TP2 > TP3 zorunludur. UYGUN yazılan her dalda gerçek yapısal STOP ile TP1 >= 1.0R ve TP2 >= 1.5R olmalı; TP1/TP2/TP3 üç bağımsız yapısal hedefi temsil etmeli; güncel fiyat giriş/retest mantığını hâlâ ihlal etmemeli ve STOP gerçek invalidation tarafında kalmalıdır. Bu kontrollerden BİRİ bile başarısızsa o dala UYGUN yazmak YASAKTIR; BEKLE veya GECERSIZ yap ve WAIT'te yalnız bir sonraki gerçekleşmemiş somut şartı yaz. R/R veya sıralama hatalı bir taslak planı format dolsun diye final satıra taşıma.\n");
        sb.append("V9.5.54 SELF-CHECK: Her analizde karar vermeden önce sırayla kendine şunları sor ve veriden cevapla: Neredeyiz? Hareket ne kadar uzadı? Önümüzde hangi geçerli yapı/likidite engeli var? Gerçek invalidation neresi? O yapısal STOP ile gerçek R/R kaç? Tamamlanmış 15m senaryosu gerçekten teyitli mi? Şimdi giriş mi, yoksa 5m retest mi? Bu zincir tamamlanmadan LONG/SHORT veya UYGUN dal üretme. Eksik cevabı uydurma.\n");
'''
    a = a.replace(anchor, anchor + rules, 1)

ANALYSIS.write_text(a)

# Version bump only. Existing SharedPreferences plan rows are intentionally not
# touched; v9.5.54 affects future analysis packages/prompts and visible version.
for p in (MAIN, MON, ANALYSIS, RADAR, ENGINE):
    z = p.read_text()
    z = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.54', z)
    z = z.replace('v9.5.53', 'v9.5.54')
    p.write_text(z)

bf = BUILD.read_text()
bf = re.sub(r'versionCode\s+\d+', 'versionCode 26091402', bf, count=1)
bf = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.54'", bf, count=1)
BUILD.write_text(bf)

print('v9.5.54 patch applied: location-before-direction, entry-to-target path check, extension-aware execution, structural STOP->RR ordering and mandatory final plan self-audit. Existing pasted plans unchanged.')