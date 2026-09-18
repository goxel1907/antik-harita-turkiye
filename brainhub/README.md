# PC Brain Hub

Node.js 22+ gerekir. Bu servis yalnız piyasa analizi, günlük ve tek yürütücü kilidi sağlar; Binance emir API'si veya borsa anahtarı içermez. Android v9.5.77 otomatik canlı emir tetikleyicisi kilitlidir ve sinyalleri dry-run olarak kaydeder.

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

Vision isteklerinde ücretsiz OpenCode modelleri önce denenir. Görsel girişi desteklemeyen ücretsiz modeller Vision cooldown'a alınır; metin istekleri için ayrıca kullanılabilir kalırlar. Kiro Vision fallback **varsayılan olarak kapalıdır**; ücretli/kredili modele sessiz geçiş yapılmaz. Kullanıcı bunu bilerek açmak isterse `config/committee.json` içine `"allowKiroVisionFallback": true` koyabilir. Bu durumda önce sınırlı ücretsiz Vision denemeleri yapılır, yalnız başarısız olurlarsa Kiro denenir. Metin-only SCALP/FAST rotası her durumda free-first davranışını korur ve Kiro'yu normal analist havuzuna taşımaz.

OpenCode sağlayıcısı ücretsiz katmanı 9Router REST proxy üzerinden `403 FreeTierError` ile reddederse BrainHub aynı `oc/*` modeli resmi OpenCode CLI üzerinden tekrar dener. Bu fallback yalnız `oc/*` ücretsiz modelleri içindir; Kiro/ücretli modele geçiş yapmaz. CLI çağrısı geçici bir klasörde, `--pure` modunda ve tüm araç izinleri kapalı özel `brainhub` ajanıyla çalışır; grafikler dosya eki olarak verilir. Windows'ta resmi CLI yoksa `npm install -g @opencode/cli` ile kurulabilir; `opencode --version` ve `opencode run --model opencode/muse-spark-1.3-contributor-free "Sadece OK yaz"` ile ayrı doğrulanmalıdır.

Gerçek uçtan uca test için:

```powershell
& 'C:\\BrainHub\\TEST.ps1' -Deep
```

Bu test `/vision/probe?symbol=BTCUSDT` üzerinden 9/9 grafiğin hazırlanmasını ve en az bir modelin görselleri gerçekten almasını doğrular. `9TF Vision model okuma testi gecmedi` hatası alınırsa APK/Android tarafını değil, PC 9Router/model Vision rotasını inceleyin. `/models/healthy` çıktısındaki `visionStatus` ve `visionError` alanları hangi modelin görsel girişini kabul/reddettiğini gösterir.

## Android bağlantısı

`& 'C:\BrainHub\PAIR.ps1'` Tailscale üzerinde ayrı bir HTTPS `:8787` uç noktası açar. 9Router'ın mevcut `:443` yönlendirmesi korunur. Erişim tokenı Windows kullanıcı şifrelemesiyle saklanır ve eşleştirme sırasında PC panosuna konur. Android uygulamasında Trade Ajanı → Ayar içinde HTTPS adresi ve token girilir. Brain Hub erişilemezse uygulama kendi BrainCore taramasına döner. `& 'C:\BrainHub\UNPAIR.ps1'` yalnız Brain Hub yönlendirmesini kapatır.

## API ve veri sınırları

- `/context/global`: BTC, ETH ve ETHBTC kapanmış mumları; CoinGecko `/global` üzerinden USDT baskınlığı ve **türetilmiş** TOTAL2/TOTAL3 piyasa değeri yaklaşık değerleri. TradingView endeksleriyle birebir eşit oldukları iddia edilmez.
- `/context/symbol?symbol=BTCUSDT`: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d; EMA, RSI, ATR, swing ve FVG bağlamı.
- L2 dengesizliği REST derinlik anlık görüntüsüdür. OFI alanı iki anlık görüntüden türetilmiş bir yaklaşık değerdir. CVD yalnız dönen son aggTrades örneğidir; seansın eksiksiz CVD'si değildir.
- `/leader/plan`: yalnız `EARLY_TOP5` adayı için komiteye gider. Eksik/bayat veri veya yetersiz model yanıtı `REVIEW_REQUIRED` üretir; emir vermez.
- `/journal`, `/learning`: SQLite günlük ve yalnız açıkça etiketlenmiş sonuç istatistikleri. Öğrenim sert risk kurallarını otomatik değiştirmez.
- `/lease`, `/execution/claim`: atomik sahiplik ve tekrar işlem kimliği kaydı. Bu sürümde PC ve Android'in gerçek emir yolu bu API'ye bağlanmadığı için canlı otomatik işlem kapalıdır.

Kaynak API'ler: [Binance USDT-M market data](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api), [CoinGecko global data](https://docs.coingecko.com/reference/crypto-global).
