# CLAUDE_V112 — BrainHub v9.5.112-CLAUDE (Claude, Anthropic • Cowork • 22 Eylül 2026)

> ChatGPT ve diğer ajanlar için: bu sürümü **Claude** yaptı. Temel: `futures15m-alarm-public-build@3f45bcd`
> (ChatGPT "JEV FINAL AUTHORITY" ← Claude v9.5.111 `418f6c4`). Her değişiklik `CLAUDE_V112` etiketlidir.
> PC kimliği `9.5.112-CLAUDE-VISION`; Android görünür kimliği değişmedi (9.5.111 / 26092106).

## 0. En kritik bulgu — sistem neden hiç emir açamıyordu
PC journal (21 Eyl 19:20–22:14Z, v111 kurulumundan sonra):

| Saat (UTC) | Coin | Yol | Jev | Sonuç |
|---|---|---|---|---|
| 19:55 | AKEUSDT LONG | v111 kod-tetik 3m scalp | JEV_REQUEST_ERROR | WATCH (Jev'e ulaşılamadı) |
| 20:11 | TAOUSDT LONG | kod-tetik 15m ana | veto (yapı, TF çelişkisi) | — |
| 20:20 | GRASSUSDT LONG | kod-tetik 1m scalp | **onay** | LIVE kapalıydı → emir yok |
| 20:28 | ETHUSDT LONG | kod-tetik 1m scalp | **onay** | LIVE kapalıydı → emir yok |
| 21:55 | XLMUSDT LONG | kod-tetik 1m scalp | veto (yapı, TF, bekleme) | — |
| 22:12 | ONEUSDT LONG | kod-tetik 1m scalp | **onay** → JEV_FINAL HARD_SAFETY_READY | **Binance transport: `POSITION_RISK_REQUIRED`** |

**Kök neden (CLAUDE_V112_BINANCE_V3_POSITION_FIX):** `binance-live-transport.js` giriş öncesi
`GET /fapi/v3/positionRisk?symbol=X` okuyor; boş dizi gelirse `POSITION_RISK_REQUIRED` ile engelliyordu ve kaldıracı
bu satırların `leverage` alanından okuyordu. Binance belgesine göre v3 **yalnız pozisyonu veya açık emri olan
sembolleri döndürür** ve **leverage alanı içermez**. Yani pozisyonu olmayan her yeni coinde giriş %100 engelleniyordu;
boş olmasaydı bile kaldıraç doğrulaması hep `BINANCE_LEVERAGE_MISMATCH` verecekti. Bugüne kadar hiçbir plan transport'a
ulaşmadığı için görünmedi; ONEUSDT ilk gerçek girişti.
Düzeltme: boş liste = pozisyon yok; kaldıraç `GET /fapi/v1/symbolConfig?symbol=X` (weight 5) ile okunur, farklıysa
`POST /fapi/v1/leverage`, sonra symbolConfig ile yeniden doğrulanır; symbolConfig erişilemezse yalnız onay (ack)
kaldıracı beklenenle aynıysa geçer. Açık pozisyon varsa `SYMBOL_POSITION_ALREADY_OPEN` korunur.
Testler: `test/binance-live-transport.test.js` son 4 test (gerçek v3 davranışı).

## 1. Kullanıcı kuralı
15m ana işlem bölgesi; 1m/3m/5m tek başına karar vermez; momentum coinlerde (erken ilgi, top sıralama adayı, ivme,
volatil) 1m/3m/5m scalp fırsatları kaçırılmasın; 1m'de başlayan hareket momentum bozulana kadar taşınsın; LONG/SHORT;
Jev kararı ön planda. Kullanıcı: "sen nasıl uygun görüyorsan onu yap". Android arayüzü: dokunma.

## 2. Değişiklikler
| Etiket | Dosya | Ne / neden |
|---|---|---|
| CLAUDE_V112_BINANCE_V3_POSITION_FIX | binance-live-transport.js | Yukarıdaki kök neden. |
| CLAUDE_V112_SCALP_FAST_LANE | claude-v112.js, pipeline.js, live-controller.js `scalpFastLaneTick`, server.js (20 sn) | Vision'ı (ort. ~480 sn) beklemeden: momentum coin + v110 `scalpReady` (≥2/3 alt TF) + 15m sert karşı-veto yok + momentum tükenmemiş + destekleyen alt TF'de kapanmış-mum ACCEPTED kırılım + canlı fiyat tetik/invalidation ötesinde + kovalama sınırı içinde → deterministik 9TF özetli QUALIFIED plan → v110 `enforceQualification` → **Jev** → ChatGPT JEV-FINAL akışı (hard safety) → emir. Plan `PLAN_FAST` olarak saklanır (v111 yeniden doğrulamanın okuduğu `PLAN` kirlenmez). |
| CLAUDE_V112_CONCURRENT_REVALIDATION | live-controller.js, pipeline.js `revalidationOnly` | Worker'ın gördüğü sayısal tetik, tam Vision sürerken de yeniden doğrulanıp Jev'e gider. Hızlı yol asla tam Vision'a düşmez. |
| CLAUDE_V112_EXECUTION_LOCK_ONLY_AT_ORDER | live-controller.js | Önceden Leader AUTO, 8 dk'lık Vision boyunca emir kilidini tutuyordu. Artık analiz `leaderFlowBusy`, emir anı `executionBusy`. Emir kilidi doluysa Jev onaylı işlem 20 sn bekler (düşürülmez). Mobil emir, Leader analizi sürerken eskisi gibi reddedilir. |
| CLAUDE_V112_FAST_LANE_JEV_BUDGET | live-controller.js, claude-v111.js | Aynı kırılım (sembol+yön+TF+mum zamanı) bir kez; sembol başına 5 dk; Jev vetosundan sonra 30 dk; saatte en fazla 20 hızlı-hat Jev çağrısı. |
| CLAUDE_V112_WORKER_SCALP_EVERY_TICK | live-controller.js `planWorkerTick` | 1m/3m/5m sayısal tetikli planlar sıra beklemez (her 30 sn'de +3 kontrol, model çağrısı yok). |
| CLAUDE_V112_RUNNER_TWO_THIRDS | binance-live-transport.js, claude-v111.js, live-controller.js | `runnerShare: TWO_THIRDS` → yalnız TP1 (1/3, 1R) konur; kalan 2/3 TP1 dolar dolmaz iz sürer (taban başabaş, asla genişlemez). Anahtar yoksa ONE_THIRD (v111 davranışı). |
| CLAUDE_V112_VISION_BENCHMARK_21 | vision-benchmark.js, server.js `/vision/benchmark`, manage.ps1 `-Action VisionBenchmark`, VISION-BENCHMARK.ps1 | 7 sınıf (BOS_UP/DOWN, SWEEP_RECLAIM/REJECT, BULL/BEAR_FVG, RANGE) × 3 boyut (896×504, 640×360 ×2) = 21 sentetik vaka; sınıf ve boyut bazında doğruluk; sonuç journal `VISION_BENCHMARK`. |
| — | office-dashboard 1.4.0-CLAUDE-V112-JEV-FINAL | Hızlı hat ve benchmark olayları, v112 panel satırları. |

## 3. Bağımsız inceleme (ikinci Claude ajanı) ve düzeltmeler
| # | Bulgu | Durum |
|---|---|---|
| 1 yüksek | Jev kapalıysa hızlı hat Jev'siz emir açabilirdi | ChatGPT JEV-FINAL `JEV_FINAL_APPROVAL_REQUIRED` (Jev çağrıldı + veto yok) hızlı hat için de geçerli (aynı akış). |
| 2 | Varsayılan SHADOW'da eşzamanlı doğrulama Jev'e gidiyordu | Artık yalnız `scalpFastLane=BINDING`. |
| 3 | Hızlı hat ve Vision aynı coinde çift Jev | `leaderVisionSymbol` akış sonuna dek tutulur; `fastLaneSymbol` ana döngüde atlanır. |
| 4 | Jev $2/gün bütçesi | Bkz. FAST_LANE_JEV_BUDGET. |
| 5 | `fastLaneBusy` mobil emir / pozisyon incelemesini engelliyordu | Kaldırıldı. |
| 6 | Mevcut runner kullanıcıları sessizce 2/3'e geçiyordu | Anahtar yoksa ONE_THIRD. |
| 7 | `fastLaneBusy` takılı kalabilirdi | Tüm kurulum try/finally içinde. |
| 8 | BUSY sonrası onaylı işlem düşüyordu | 20 sn kilit bekleme. |
| 9 | Hızlı SCALP, Vision WATCH takibini eziyordu | Emir açılmadıkça yaşam döngüsü yazılmaz. |
| 10 | Pipeline sinyali farklı kovalama sınırıyla yeniden hesaplıyordu | Politika `maxEntryDeviationPct` iletilir. |

## 4. Açık not — JEV FINAL ve kovalama (kullanıcı kararı)
ChatGPT'nin `bca1b27` değişikliğiyle Jev onayından sonra kovalama kapısı yalnız uyarı. ONEUSDT'de emir anında
`CLAUDE_V109_PRICE_BACK_INSIDE_TRIGGER` uyarısı vardı: fiyat tetik seviyesinin altına dönmüştü (kırılım o an
başarısızdı). Transport hatası olmasaydı emir gidecekti. Kullanıcı isterse yalnız "fiyat tetik içine döndü"
durumu hard-safety'ye alınabilir (tek satır: live-controller chase bloğu). Bu sürüm kullanıcı kararı olmadan değiştirmedi.

## 5. Boyutlandırma (kullanıcı sorusu: panel değerleri kesilmeden mi?)
- Marj × kaldıraç = hedef notional; miktar lot adımına **aşağı** yuvarlanır (ör. 30 × 10 = 300 → 299,9x). Kaldıraç
  Binance'te panel değerine ayarlanır (symbolConfig/leverage). USER_PANEL_EXACT: eski yüzde tavanları küçültmez.
- **Küçültme yok; engel var:** bakiye < marj → `REQUESTED_MARGIN_EXCEEDS_AVAILABLE_BALANCE`; açık pozisyon ≥ panel max →
  `OPEN_POSITION_CAP_REACHED`; **günlük zarar ≥ `live-policy.json limits.maxDailyLossPct` (%2 → ~146 USDT'de ~2,9 USDT)**
  → o UTC günü yeni giriş yok (panel bunu değiştirmez); stop likidasyona çok yakın → `STOP_BEYOND_LIQUIDATION`;
  sembolün Binance kaldıraç sınırı panelden düşükse → `BINANCE_LEVERAGE_CHANGE_REJECTED`; max pozisyon 1–5 (uygulama ve PC).
- Örnek: 30 USDT × 10x, 1m scalp stop %2,6 (ONEUSDT) → olası zarar ≈ 7,9 USDT > günlük limit 2,9 USDT → ilk zararlı
  işlemden sonra gün kapanır.

## 6. Testler
**256/256** (`node --test brainhub/test/*.test.js`). Yeni: `test/claude-v112.test.js` (15), transport v3 (4).

## 7. Geri dönüş
- Hızlı hat: `config/claude-v111.json` → `"scalpFastLane": "SHADOW"` (veya OFF).
- Runner payı: `"runnerShare": "ONE_THIRD"`.
- Kod-tetik/yeniden doğrulama: `config/claude-v109.json` → `"deterministicTriggerMode": "SHADOW"`.
- Tam geri: `C:\BrainHubBackups` (RESTORE.ps1) veya GitHub `3f45bcd`.
