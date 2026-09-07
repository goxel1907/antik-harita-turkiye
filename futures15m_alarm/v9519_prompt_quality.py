from pathlib import Path
import re

APP = Path('/tmp/futures15m-build/Futures15mAlarm')
JAVA = APP / 'app/src/main/java/com/futuresalarm/app'
MAIN = JAVA / 'MainActivity.java'
ANALYSIS = JAVA / 'AnalysisPackActivity.java'
BUILD = APP / 'app/build.gradle'

for p in (MAIN, ANALYSIS, BUILD):
    if not p.exists():
        raise SystemExit('v9.5.19 required file missing: ' + str(p))

# ------------------------------------------------------------------
# Analysis prompt: remove duplicated/ambiguous rules and replace them with one
# authoritative decision protocol. Dynamic Binance data and the deterministic
# structure scan are kept intact below this block.
# ------------------------------------------------------------------
a = ANALYSIS.read_text()
a = re.sub(r'ChatGPT ANALİZ PAKETİ • v9\.5(?:\.\d+)*', 'ChatGPT ANALİZ PAKETİ • v9.5.19', a)
a = re.sub(r'Futures15mAlarmPRO/9\.5(?:\.\d+)*', 'Futures15mAlarmPRO/9.5.19', a)

start = a.find('        sb.append("15M FUTURES PRO MANUEL ANALİZ PROTOKOLÜ')
live = a.find('        sb.append("--- UYGULAMANIN OTOMATİK TOPLADIĞI CANLI VERİLER ---', start)
if start < 0 or live < 0 or live <= start:
    raise SystemExit('v9.5.19 master prompt boundaries not found')

protocol = r'''        // V9519_DECISION_QUALITY_PROTOCOL
        sb.append("15M FUTURES PRO MANUEL ANALİZ PROTOKOLÜ • KARAR KALİTESİ SÜRÜMÜ\n\n");
        sb.append("AKTARIM KURALI: PROMPT + GRAFİK modunda metin ve grafik birlikte ChatGPT'ye aktarılır. AYNI SOHBET modunda mevcut konuşma korunur; MASTER PROMPT panoya kopyalanır ve grafik gerektiğinde analiz paketinden ayrıca eklenir.\n\n");
        sb.append("GÜNCEL KAYNAK KURALI: Ana karar, yön, giriş, STOP ve hedefler yalnız EN SON gönderilen bu paket, ekli güncel grafik ve aşağıdaki verilerden üretilecek. Önceki analizler yalnız karşılaştırma içindir. Önceki coin veya eski seviyeleri güncelmiş gibi taşıma. Eksik veriyi uydurma.\n");
        sb.append("DİL KURALI: Kullanıcıya görünen tüm açıklamalar Türkçe olacak. Yalnız LONG/SHORT, BOS, CHoCH, FVG, OB, BSL/SSL, RSI, OI, CVD, TP, STOP, LP/LB/SR/SB ve META gibi standart teknik/kod kısaltmaları korunabilir.\n\n");

        sb.append("1) KARAR ÖNCELİĞİ\n");
        sb.append("Öncelik sırası: TAMAMLANMIŞ mumlardan piyasa yapısı ve swingler > güncel fiyatın destek/direnç, FVG/OB ve likidite konumu > 4H/1H yön bağlamı > TAMAMLANMIŞ 15m tetik > hacim > canlı akış verileri > RSI/momentum/volatilite. Tek bir yardımcı veri temiz fiyat yapısını tersine çeviremez. Çelişki varsa güven puanını düşür ve işlem zorlaması yapma.\n");
        sb.append("Rejimlerden birini seç: TREND UP / TREND DOWN / RANGE / HIGH VOLATILITY / TRANSITION. HH-HL, LH-LL, BOS/CHoCH, FVG, bullish/bearish OB, breaker/mitigation, EQH/EQL, BSL/SSL ve anlamlı Fibonacci impulsunu birlikte değerlendir.\n\n");

        sb.append("2) AÇIK MUM VE TEYİT KURALI\n");
        sb.append("Grafikte sağdaki mavi çerçeveli 15m/1h/4h/1D mumlar AÇIK/ANLIK mumdur. Momentum, fitil reddi, olası likidite süpürmesi ve hızlanma/yavaşlama bağlamında değerlendir; KAPANMIŞ kabul etme. Kritik giriş, breakout/breakdown ve yön teyidi yalnız TAMAMLANMIŞ 15m kapanışından gelebilir. Açık 1H/4H/1D mum kapanmadan HTF BOS/CHoCH teyidi verme.\n");
        sb.append("LONG geri çekilmede yalnız temas yetmez: bölge teması sonrası TAMAMLANMIŞ 15m mum pullHigh üzerinde kapanarak bölgeyi geri kazanmalı. SHORT direnç reddinde yalnız temas yetmez: bölge teması sonrası TAMAMLANMIŞ 15m mum resLow altında kapanmalı. Wick/temas tek başına sinyal değildir.\n\n");

        sb.append("3) SAYISAL YAPI TARAMASI KULLANIMI\n");
        sb.append("Uygulamanın SAYISAL YAPI TARAMASI kapanmış OHLC'den üretilen ADAY haritadır; nihai gerçek değildir. Grafikte doğrula. Sayısal aday ile görsel yapı çelişirse çelişkiyi açıkça belirt ve zorla teyit verme. INVALIDATED/FILLED olan veya güncel fiyat tarafından belirgin biçimde tüketilmiş/geçilmiş eski seviyeyi aktif destek, direnç, giriş ya da ileri hedef gibi kullanma.\n");
        sb.append("Fibonacci yalnız son anlamlı ve görsel olarak seçilebilir impuls bacağından üretilecek. Hangi impulsun esas olduğu belirsizse FIB=NONE kullan; seviye uydurma.\n\n");

        sb.append("4) CANLI VERİ KALİTESİ VE AĞIRLIK\n");
        sb.append("Anlık fiyat güncel konum içindir; mark fiyat yardımcı kontroldür; yapı ve kırılım teyidi kapanmış mumlarla yapılır. OI, CVD, taker, order book, funding ve hacim yardımcı teyittir; tek başına LONG/SHORT nedeni değildir.\n");
        sb.append("CVD için etikette yazan 5m/15m adına değil GERÇEK ÖRNEKLEM KAPSAMASINA bak. Kapsama <5 dk ise yalnız çok kısa akış örneklemi say ve düşük ağırlık ver; 5-12 dk ise kısmi örneklem say; >=12 dk ise 15m bağlamında yardımcı teyit olarak kullanılabilir. Eksik süreyi 15 dakikaya genelleme veya extrapole etme.\n");
        sb.append("Fiyat yükselirken OI düşmesi short kapanışı veya pozisyon boşalması OLABİLİR; fiyat düşerken OI düşmesi long kapanışı OLABİLİR. Bunu kesin pozisyon yönü veya market maker niyeti gibi yazma. Top20 order book anlık ve oynaktır; düşük ağırlık ver. Funding ve RSI tek başına ters yön işlemi gerekçesi değildir. Yardımcı veriler birbirine ters düşerse güveni düşür.\n");
        sb.append("Paket zamanı güncel zamandan 120 saniyeden fazla eskiyse canlı akışı taze kabul etme; mevcut piyasadan hemen giriş iddiası üretme ve WAIT alanına VERİ YENİLE yaz. Yapısal koşullu plan yine kurulabilir.\n\n");

        sb.append("5) GEÇ GİRİŞ / KOVALAMA / GEÇERSİZLİK FİLTRESİ\n");
        sb.append("Fiyat giriş bölgesinde değilse 'şimdi sinyal' verme. Fiyat STOP tarafına geçmişse ilgili senaryo GEÇERSİZDIR. Fiyat girişten sonra TP1'e ulaşmış veya TP1 yönünde belirgin biçimde ilerlemişse geçmişte kalmış girişi yeni sinyal gibi verme; yeni retest veya yeni yapı bekle. Giriş toleransını sonradan genişleterek eski setup'ı kurtarma.\n");
        sb.append("Çok sert impuls sonrası fiyat premium/üst likidite bölgesindeyse sırf trend güçlü diye LONG kovalama; discount/geri çekilme veya teyitli breakout-retest bekle. Aynı şekilde RSI aşırı yüksek diye otomatik SHORT, RSI aşırı düşük diye otomatik LONG verme.\n\n");

        sb.append("6) RİSK/ÖDÜL VE SEVİYE KALİTESİ\n");
        sb.append("Giriş, STOP ve TP seviyeleri mutlaka yapı dayanağına bağlanacak: swing, FVG, OB, likidite, Fibonacci veya teyitli kırılım/retest. STOP rastgele yakın/uzak konmayacak; yapısal geçersizlik tarafında olacak. Giriş aralığında R/R hesabını en kötü giriş fiyatından yap. TP1 en az 1.0R ve TP2 en az 1.5R sağlamıyorsa senaryoyu UYGUN sayma; BEKLE/GEÇERSİZ yap. Hedefi önündeki bariz karşı likidite/direnç-destek engelinin ötesine körlemesine koyma.\n\n");

        sb.append("7) GÜVEN PUANI KALİBRASYONU\n");
        sb.append("80-100 yalnız temiz çoklu zaman dilimi uyumu, geçerli 15m tetik ve yeterince taze/uyumlu yardımcı veri varsa kullanılacak; 80+ nadir olmalı. 65-79 güçlü fakat koşullu adaydır. 60-64 karışık/sınırda yapı; mevcut giriş için İŞLEM YOK tercih et. 60 altı veya kritik çelişki/veri eksikliği varsa İŞLEM YOK. Kısa/kısmi CVD, karşıt OI-taker-book veya belirsiz HTF yapı varken aşırı güven puanı verme.\n\n");

        sb.append("8) ÇIKTI DÜZENİ\n");
        sb.append("Önce şu sırayla kısa ve net cevap ver:\n");
        sb.append("ANA KARAR: LONG / SHORT / İŞLEM YOK\nGÜVEN: 0-100\nREJİM: ...\nKISA GEREKÇE: en fazla 4 madde\n");
        sb.append("Ardından 15M, 1H, 4H ve 1D için ayrı yapı envanteri ver. Sonra CANLI VERİ KALİTESİ bölümünde CVD kapsaması, OI, taker, order book, funding ve hacmin uyum/çelişki durumunu yaz.\n");
        sb.append("Sonra dört senaryoyu ayrı değerlendir: LONG GERİ ÇEKİLME, LONG YUKARI KIRILIM, SHORT DİRENÇ REDDİ, SHORT AŞAĞI KIRILIM. Her birine DURUM: UYGUN / BEKLE / GEÇERSİZ yaz; geçerliyse giriş bölgesi, STOP, TP1, TP2, TP3, geçersizlik ve dayandığı yapısal confluence'ı belirt.\n");
        sb.append("En sonda ŞU AN NE BEKLENİYOR? başlığıyla tek ve somut bir sonraki şartı yaz. ANA KARAR bir alarm değildir; gerçek sinyal yalnız tamamlanmış 15m senaryo teyidi + güncel giriş konumu + uygun canlı akış filtresi birlikte sağlandığında oluşur.\n\n");

        sb.append("9) UYGULAMA PLAN KODU\n");
        sb.append("SON SATIRDA uygulamaya yapıştırılacak TEK SATIR 14 ALANLI plan kodu üret; o satırda kod dışında açıklama yazma. Format: SYMBOL|pullLow|pullHigh|resLow|resHigh|breakout|breakdown|decimals|0.60|LP=stop;tp1;tp2;tp3|LB=girisAlt;girisUst;stop;tp1;tp2;tp3|SR=stop;tp1;tp2;tp3|SB=girisAlt;girisUst;stop;tp1;tp2;tp3|META=...\n");
        sb.append("LP=/LB=/SR=/SB= etiketlerini koru. META içinde | karakteri KULLANMA; yalnız ; ve = kullan. META biçimi: ANA_KARAR:<LONG/SHORT/ISLEM_YOK>;GUVEN:<0-100>;REGIME:;STRUCT:;BOS:;CHOCH:;FVG:;OB:;BREAKER:;FIB:;PD:;LIQ:;TF15:;TF1H:;TF4H:;TF1D:;CONFLUENCE:;WAIT:. WAIT mutlaka Türkçe ve gerçekleşmemiş bir sonraki şartı kısa yazsın.\n");
        sb.append("Likidite/stop-hunt yorumunda yalnız TAHMİNİ STOP/LIKIDITE AV BÖLGESİ ve güven puanı ver. Bireysel kaldıraç/girişler bilinmediği için kesin likidasyon seviyesi veya market maker niyeti uydurma.\n\n");
'''

a = a[:start] + protocol + a[live:]

# The structure engine appends a second instruction block near the end. Keep it
# compact and make it a verification checklist instead of repeating the master
# protocol word-for-word.
z = a.find('        sb.append("ZORUNLU ANALİZ SIRASI:', live)
ret = a.find('        return sb.toString();', z if z >= 0 else live)
if z >= 0 and ret > z:
    checklist = r'''        sb.append("SAYISAL TARAMA SONRASI SON KONTROL:\n");
        sb.append("1) Her zaman dilimindeki aday yapıyı grafik ve kapanmış mumlarla DOĞRULA / ADAY / GEÇERSİZ olarak sınıflandır.\n");
        sb.append("2) Güncel fiyatın hangi aktif yapı, premium/discount ve BSL/SSL tarafında olduğunu belirle; tüketilmiş eski seviyeleri ele.\n");
        sb.append("3) 4H/1H yön bağlamını 15M tetikle birleştir; açık mumları teyit sayma.\n");
        sb.append("4) Senaryo kurmadan önce geç giriş ve R/R filtresini uygula. Uygun yapı yoksa İŞLEM YOK.\n");
        sb.append("5) META/WAIT içinde yalnız bir sonraki gerçekleşmemiş somut şartı yaz.\n\n");
'''
    a = a[:z] + checklist + a[ret:]

# Make the CVD wording impossible to misread when the 1000-trade window covers
# much less than 5/15 minutes.
a = a.replace('CVD 5m (son agg trade örneklemi, quote notional): ',
              'CVD 5m ADAY/HAM ÖRNEKLEM (gerçek kapsama aşağıda): ')
a = a.replace('CVD 15m (son agg trade örneklemi, quote notional): ',
              'CVD 15m ADAY/HAM ÖRNEKLEM (yalnız gerçek kapsama yeterliyse 15m say): ')
a = a.replace('CVD örneklem kapsaması yaklaşık: ', 'CVD GERÇEK ÖRNEKLEM KAPSAMASI: ')
a = a.replace('CVD örneklem kapsaması:', 'CVD GERÇEK ÖRNEKLEM KAPSAMASI:')

# Make the completed-candle label visually explicit next to the open/current bar.
a = a.replace('"KAPANIŞ C " + price(last.close)', '"SON TAMAMLANMIŞ KAPANIŞ C " + price(last.close)')

ANALYSIS.write_text(a)

# Main/version bump.
m = MAIN.read_text()
m = re.sub(r'15m Futures Alarm PRO v9\.5(?:\.\d+)*', '15m Futures Alarm PRO v9.5.19', m)
m = re.sub(r'v9\.5(?:\.\d+)*\s*•\s*MANUEL PRO', 'v9.5.19  •  MANUEL PRO', m)
m = re.sub(r'v9\.5(?:\.\d+)* MANUEL PRO çalışma şekli:', 'v9.5.19 MANUEL PRO çalışma şekli:', m)
# Durable version marker so sanity checks are not dependent on one title string.
if 'V9519_VERSION_MARKER' not in m:
    p = m.rfind('}')
    if p < 0: raise SystemExit('v9.5.19 MainActivity closing brace missing')
    m = m[:p] + '\n    // V9519_VERSION_MARKER v9.5.19\n' + m[p:]
MAIN.write_text(m)

b = BUILD.read_text()
b = re.sub(r'versionCode\s+\d+', 'versionCode 33', b, count=1)
b = re.sub(r"versionName\s+'[^']+'", "versionName '9.5.19'", b, count=1)
BUILD.write_text(b)

ana = ANALYSIS.read_text(); main = MAIN.read_text(); bf = BUILD.read_text()
checks = [
    ('V9519_DECISION_QUALITY_PROTOCOL' in ana, 'decision protocol marker'),
    ('GERÇEK ÖRNEKLEM KAPSAMASI' in ana, 'CVD coverage wording'),
    ('Kapsama <5 dk' in ana and '5-12 dk' in ana and '>=12 dk' in ana, 'CVD weighting rule'),
    ('Fiyat STOP tarafına geçmişse ilgili senaryo GEÇERSİZDIR' in ana, 'late-entry invalidation'),
    ('TP1 en az 1.0R ve TP2 en az 1.5R' in ana, 'risk reward filter'),
    ('80-100 yalnız temiz çoklu zaman dilimi uyumu' in ana, 'confidence calibration'),
    ('SAYISAL TARAMA SONRASI SON KONTROL' in ana, 'compact final checklist'),
    ('SON TAMAMLANMIŞ KAPANIŞ C' in ana, 'closed candle chart label'),
    ('ChatGPT ANALİZ PAKETİ • v9.5.19' in ana, 'analysis version'),
    ('V9519_VERSION_MARKER v9.5.19' in main, 'main version marker'),
    ('versionCode 33' in bf and "versionName '9.5.19'" in bf, 'build version'),
]
for ok, msg in checks:
    if not ok:
        raise SystemExit('v9.5.19 check failed: ' + msg)

print('v9.5.19 OK: consolidated Turkish decision protocol + CVD coverage weighting + stale/late-entry guard + RR/confidence calibration + explicit completed-candle label.')
