# PC Brain Hub

## 9.5.97 - OTO adayını mevcut manuel sohbet akışında inceleme

Android OTO durum kartındaki **OTO ADAYI • EK ANALİZ PAKETİ**, son PC kısa listesinden ve takip edilen kurulumlardan 1-8 coin seçtirir. Var olan manuel AnalysisPackActivity, kaynak/SMC/mikro yapı kuralları ve plan-kodu aktarım akışı yeniden kullanılır. Ek incelemede PC'den 128 mumlu dokuz annotated grafik alınır: 1D/4h/1h, 45m/30m/15m, 5m/3m/1m. 45m sentetiktir. Grafik eksikse paket başarıyla hazırlanmış sayılmaz.

Paket güncel piyasa bağlamını ve önceki PC yorumunun zamanını taşır; önceki yorum bağımsız teyit değildir. Hesap bakiyesi ve API/token bilgileri eklenmez. Mevcut sohbet düğmesi promptu panoya, grafik görüntüsünü Galeri'ye hazırlar; kullanıcı gönderir. ChatGPT sohbeti otomatik yürütücü veya sürekli açık model API'si gibi kullanılmaz. Gelen plan mevcut kullanıcı incelemesi ve risk kontrollerine tabidir. Android aktarımı BrainHub `/context/symbol.timeframes` sözleşmesini kullanır; EMA20/EMA50, ATR/ATR%, swingStructure, SMC, liquidity ve opportunity alanları ek analiz bağlamına dahil edilir.

PC tarafında mobil ve Leader AUTO istekleri aynı yürütücü kilidini tüm analiz→risk→emir yaşam döngüsü boyunca paylaşır. Başka istek sürerken yeni istek `LIVE_EXECUTOR_BUSY` ile reddedilir; bayat istekler sıraya konmaz. Leader AUTO başladığı arm generation'a bağlanır; arada disarm/re-arm olursa eski plan yeni arm oturumunda yürütülemez. Acil durdurma, devam eden arm ön kontrolünün sonradan canlı modu tekrar açmasını da engeller.

Node.js 24 önerilir. v9.5.96 PC Brain Hub; 9TF piyasa/grafik analizi, SQLite günlük, kalıcı aday takibi ve kullanıcı tarafından yönetilen Binance yürütücüsünü içerir. PC yeniden başladığında LIVE kapalıdır. Bir APK derlemesinin geçmesi canlı işlem hazırlığının geçtiği anlamına gelmez.

v9.5.96 düzeltmeleri: mobil marj/kaldıraç ayarları PC risk tavanlarını yükseltemez; eski yön/setup kimliği uyuşmazlıkları yeni analiz gerektirecek şekilde onarılır; başarısız yeni Vision sonucu eski 9/9 bilgisini taşımaz. Android model erişim/kota durumunu gösterir. Yayın APK'si yalnız mevcut `futures15m_stable` imzasıyla üretilir.

## Bu PC'de tek komutlar

PowerShell içinde:

```powershell
& 'C:\BrainHub\UPDATE.ps1'
& 'C:\BrainHub\TEST.ps1' -Deep
& 'C:\BrainHub\START.ps1'
& 'C:\BrainHub\BACKUP.ps1'
```

`UPDATE` yalnız `C:\BrainHub\server\server.js` sürecini durdurur; 9Router'ın `20128` sürecine dokunmaz. Önce yedek alır, yeni dosyaları yükler, sonra `/health`, scanner, BTC 15m, global BTC/ETH ve SQLite testlerini çalıştırır. Hata olursa önceki dosyaları geri koymaya çalışır. `-Deep` yalnız ayrıca Leader Hunter → komite zincirini çağırır. Ücretsiz modeller yanıt vermezse sonuç `REVIEW_REQUIRED` olur.

9Router `BrainHub-PC` anahtarı 9Router'ın yerel veritabanından veya panodan bir kez okunur, HTTP ile doğrulanır ve geçerli Windows kullanıcısına bağlı DPAPI dosyasında saklanır. Depoya ya da loga yazılmaz. Yeni PC'de 9Router ve Node kurulu olmalıdır.

Yeni PC'de repo klonlandıysa `& .\brainhub\INSTALL.ps1 -Source (Get-Location).Path` çalıştırılabilir. Repo yoksa aşağıdaki tek PowerShell satırı scripti indirip çalıştırır:

```powershell
$f=Join-Path $env:TEMP 'brainhub-manage.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/goxel1907/antik-harita-turkiye/futures15m-alarm-public-build/brainhub/manage.ps1' -OutFile $f; & $f -Action Install
```

## 9TF Vision doğrulaması

Leader AUTO için 1m, 3m, 5m, 15m, 30m, sentetik 45m, 1h, 4h ve 1D grafik paketinin üretilmesi tek başına "grafik okundu" sayılmaz. Targeted/analysis-tracking akışında dokuz grafik `/committee` üzerinden gerçek multimodal modele ulaşmalı; model ayrıca `WHY`, `RISK_NOTE`, `WAIT_FOR`, `VISION_SUMMARY` ve dokuz `TF_*` alanının tamamını üretmelidir. Eksik görsel girişi, model erişim hatası veya eksik sözleşme çıktısı `REVIEW_REQUIRED` ile fail-closed kalır.

KKK ayrıntı sözleşmesinde her model planı ayrıca `SUPPORT_TFS`, `VETO_TFS` ve `FORMING_CONTEXT` döndürür. Her TF için ayrı `TF_*_WHY`, `TF_*_WAIT`, `TF_*_ROLE`, `TF_*_FORMING` ve `TF_*_RISK` alanları zorunludur; `ROLE` yalnız `SUPPORT`, `VETO` veya `NEUTRAL` olabilir ve global destek/veto listeleri bu rollerle birebir tutarlı olmalıdır. Android kartında model yorumu ile deterministik RSI/BOS/FVG/SMC kanıtı ayrı etiketlenir. Eksik veya çelişkili model çıktısı `VISION_COMMITTEE_OUTPUT_INCOMPLETE` ile canlı kararı bloke eder.

Vision isteklerinde ücretsiz OpenCode rotaları önce denenebilir; provider-restricted/başarısız olanlar Vision cooldown'a alınır ve aynı turda tekrar zorlanmaz. Kiro'nun bağlı hesaptaki **ücretsiz kotasını** Vision için kullanmak ayrı ve açık bir yerel onaydır; varsayılan kapalıdır. Güncellemeden sonra `& 'C:\BrainHub\manage.ps1' -Action VisionFreeSetup` çalıştırılır ve ekranda yalnız `KIRO_FREE` onayı verildiğinde `allowKiroFreeQuotaVision=true` olur. Bu yalnız allowlist içindeki `kr/claude-sonnet-4.5` ve `kr/claude-haiku-4.5` Vision rotalarını açar; legacy `allowKiroVisionFallback` kapalı tutulur ve ayrı ücretli API/provider fallback'i etkinleştirilmez. Metin-only SCALP/FAST rotası free-first davranışını korur.

Gerçek uçtan uca test için:

```powershell
& 'C:\\BrainHub\\TEST.ps1' -Deep
```

Bu test `/vision/probe?symbol=BTCUSDT` üzerinden 9/9 grafiğin hazırlanmasını, modelin dokuz TF'nin tamamını gerçekten görmesini ve yalnız diagnostik probe görüntülerine çizilen gizli büyük 3x3 ızgarada yalnız bir parlak hücrenin konumunu okumasını doğrular. Ayrıca o anda gerçek Leader adayı varsa `/leader/plan` çıktısında 9TF model detay sözleşmesini de denetler ve başarıda `LEADER_9TF_DETAIL ... detailed=9/9` yazar. Beklenen hücreler modele verilmez; her TF için farklı, bariz olmayan eşleme sunucu tarafında bilinir ve 9/9 tam eşleşme gerekir. Marker yalnız probe görüntülerine eklenir, normal Leader/Trade grafiklerine eklenmez ve piyasa kanıtı değildir. Böylece küçük/doji/forming son mumun görsel yorum belirsizliği transport testini yanlış negatif yapmaz. `9TF Vision model okuma testi gecmedi` veya pixel doğrulama hatası alınırsa APK/Android tarafını değil, PC 9Router/model Vision rotasını inceleyin. `/models/healthy` çıktısındaki `visionStatus` ve `visionError` alanları hangi modelin görsel girişini kabul/reddettiğini gösterir.

## Android bağlantısı

`& 'C:\BrainHub\PAIR.ps1'` Tailscale üzerinde ayrı bir HTTPS `:8787` uç noktası açar. 9Router'ın mevcut `:443` yönlendirmesi korunur. Erişim tokenı Windows kullanıcı şifrelemesiyle saklanır ve eşleştirme sırasında PC panosuna konur. Android uygulamasında Trade Ajanı → Ayar içinde HTTPS adresi ve token girilir. Brain Hub erişilemezse uygulama kendi BrainCore taramasına döner. `& 'C:\BrainHub\UNPAIR.ps1'` yalnız Brain Hub yönlendirmesini kapatır.

## API ve veri sınırları

- `/context/global`: BTC, ETH ve ETHBTC kapanmış mumları; CoinGecko `/global` üzerinden USDT baskınlığı ve **türetilmiş** TOTAL2/TOTAL3 piyasa değeri yaklaşık değerleri. TradingView endeksleriyle birebir eşit oldukları iddia edilmez.
- `/context/symbol?symbol=BTCUSDT`: 1m, 3m, 5m, 15m, 30m, sentetik 45m, 1h, 4h, 1d; EMA, RSI, ATR, swing ve FVG bağlamı.
- L2/CVD/OFI alanlarında REST örneği ve bağlantı sırasında gözlenen WebSocket akışı ayrı kalite etiketleri taşır; eksiksiz tarihçe veya gizli likidite olduğu iddia edilmez.
- `/leader/plan`: scanner kısa listesinden veya açık analiz hedefinden 9TF komiteye gider. Eksik/bayat veri veya yetersiz model yanıtı `REVIEW_REQUIRED` üretir; emir vermez.
- `/journal`, `/learning`: SQLite günlük ve yalnız açıkça etiketlenmiş sonuç istatistikleri. Öğrenim sert risk kurallarını otomatik değiştirmez.
- `/lease`, `/execution/claim`: atomik sahiplik ve tekrar işlem kimliği kaydı. Canlı yol ayrıca PC arm, tek kullanımlık yetki, taze veri ve bağımsız risk kontrolleri ister. API sırları DPAPI ile saklanır ve modele gönderilmez.
- `/live/status`: emir vermeden PC, aday takibi ve doğrulanmış görsel model erişim durumunu gösterir. Sağlayıcı kısıtı/kota hatası modelin kullanılabilir olduğu anlamına gelmez.

Kaynak API'ler: [Binance USDT-M market data](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api), [CoinGecko global data](https://docs.coingecko.com/reference/crypto-global).
