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


## OpenRouter / Jev decision provider

OpenRouter is optional and does not replace 9Router or local Ollama Vision. The API key is stored only as Windows-user DPAPI ciphertext in `config/openrouter-api-key.dpapi`; it is never written into JSON, logs, GitHub, Android packages, prompts, or backups in plaintext.

Initial Jev integration is deliberately staged:
- model is pinned to `typesafe/jev-1.13`;
- endpoint is OpenRouter alpha Decisions API;
- mode is `ADVISORY_VETO_ONLY`;
- OpenRouter is not a general paid fallback;
- the first rollout exposes status and a synthetic paid probe only; it does not authorize or place orders;
- local Jev budget uses a USD 0.25/day soft warning threshold and a USD 2.00/day hard safety ceiling; crossing the soft threshold does not disable Jev.

Setup from a fresh key already copied to the Windows clipboard:
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\BrainHub\OPENROUTER-SETUP.ps1`

The setup validates the key with OpenRouter, stores it with DPAPI, clears the clipboard, restarts BrainHub, and performs one tiny synthetic Jev Decisions probe.


### Jev advisory/veto gate

After the secure probe is verified, Jev is attached to the central pipeline only for plans that are already `QUALIFIED`. This keeps paid traffic low. It cannot upgrade WATCH/REJECT, cannot create trade parameters, cannot bypass deterministic risk controls, and cannot authorize orders.

If Jev reports structural veto, forming-candle confirmation dependency, insufficient data quality, or material directional conflict above the configured threshold, a QUALIFIED plan is downgraded to WATCH. If Jev is configured as the required final judge but the Decisions API fails, its schema is invalid, or the local daily budget is exhausted, QUALIFIED is also downgraded fail-closed.

The local Jev budget is persisted under `data/jev-usage.json`. Setup uses a USD 0.25/day soft warning threshold, a USD 2.00/day hard safety ceiling, and a conservative USD 0.002 reservation before each paid call, settling to reported usage cost afterward. Crossing the soft threshold does not disable Jev. If the hard ceiling is actually reached, Jev is never bypassed: QUALIFIED stays fail-closed until budget becomes available. Normal WATCH/REJECT plans do not call Jev.


### Jev detailed advisory review (20 September 2026)

The existing OpenRouter DPAPI key remains PC-only. Jev reviews QUALIFIED plans with 12 typed veto checks and nine per-timeframe contradiction probabilities. Evidence includes closed/forming candle semantics, synthetic 45m, SMC/liquidity, continuity, sampled microstructure and global context. Jev sees extracted text, not PNGs. No price, position size or order is produced by this review. WATCH plans incur no Jev request.

The selected AUTO row exposes `jevDecision` with probabilities and a Turkish summary; Android shows the daily local budget. This is an advisory model result, not proof of market truth. Invalid/missing probabilities, missing configured credentials, oversized evidence and unavailable Jev fail closed. Evidence is never truncated into invalid JSON. Reported charges above a reservation remain counted; old-day reservations never subtract from new-day spend.

Local Vision single-flight serialization from 88f8e4a is preserved. Do not launch overlapping deep tests. No actual exchange orders are sent by the regression tests. A passing APK build does not establish 24-hour shadow reliability or live readiness.


### OpenRouter account credit telemetry

BrainHub keeps Jev inference credentials and OpenRouter management credentials separate. The ordinary Jev API key exposes its own key usage/limit metadata. Exact account credit balance uses OpenRouter's management-only `GET /api/v1/credits` endpoint and is cached by BrainHub before being shown in Android. The management key is stored as Windows-user DPAPI ciphertext in `config/openrouter-management-key.dpapi`; it is never sent to Android or written to logs. Android shows account remaining credit when available, key-level remaining limit when supplied by OpenRouter, and a direct Credits / Auto Recharge link.

### Role-aware 9TF opportunity qualification

Every fresh timeframe may originate LONG or SHORT opportunity context. The engine computes both `opportunityPaths.LONG` and `opportunityPaths.SHORT`; non-legacy 1m/3m/5m paths do not wait for 15m merely because it is higher. Timeframes are roles, not votes. A VETO on the selected originTF or ownerTF remains a hard semantic block, while a VETO on another timeframe is retained as contextual conflict for Jev's typed timeframe-conflict review rather than automatically killing the opportunity. Unresolved execution-path waits, failed-breakout/reclaim requirements, stale data and deterministic risk gates remain fail-closed.


### ACTIVE pozisyon 9TF yönetimi ve Jev çıkış hakemi

Brain Hub açık pozisyonları beş dakikalık sırayla yeniden inceler. Bu inceleme emir göndermez; sonuç Android ve Brain Hub durumuna Türkçe olarak `TUT`, `KÂRI KORU`, `KISMİ KÂR AL`, `ÇIKIŞI DEĞERLENDİR` veya veri yetersizse yeniden kontrol tavsiyesi olarak yansır. 1m/3m/5m tersliği tek başına yapısal çıkış sayılmaz. Jev `EXIT_NOW` istese bile deterministic position-manager owner TF ve 15m/30m/1h/4h/1d büyük resim doğrulaması yoksa kararı otomatik olarak daha yumuşak seviyeye indirir. Jev hiçbir zaman doğrudan emir kapatamaz.

### Brain Hub ölçülebilir öğrenme hafızası

Her plan kararı, açılan pozisyon, aktif pozisyon incelemesi ve Binance üzerinde kapanan Brain Hub pozisyonunun gerçekleşen PnL sonucu SQLite öğrenme hafızasına eklenir. Sonraki analizlere benzer setup/origin-owner geçmişi soft bağlam olarak verilir. Bu katman hard stop, risk limiti, kill-switch, stale-data veya execution kurallarını değiştiremez ve otomatik gevşetemez.

### Türkçe kullanıcı karar metni

Android OTO karar kartı ham İngilizce karar/açıklama kodlarını kullanıcı açıklaması olarak göstermez. Plan, Jev nedeni, pozisyon yöneticisi, öğrenme özeti ve model hata durumları Türkçe ve kullanıcıya dönük metinlerle gösterilir. Model/provider kimliği ve zaman dilimi kısaltmaları teknik kimlik olarak korunabilir; ham provider hata ayrıntıları PC günlüğünde kalır.


### Arka-plan Vision çakışma koruması

Leader AUTO ve ACTIVE pozisyon yöneticisi, başka bir 9TF pipeline veya local Vision çalışırken yeni ağır semantik Vision işi başlatmaz. Arka-plan scheduler, son pipeline tamamlandıktan sonra 30 saniye bekler; bu pencere Deep/manual analizden hemen sonra çalışan pixel doğrulama gibi foreground işlemlerin önüne geçmesini engeller. Local Vision single-flight yine son emniyet katmanı olarak kalır.
