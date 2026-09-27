# CLAUDE_V109 — v9.5.109-CLAUDE değişiklik kaydı

> **İşaret (ChatGPT ve diğer ajanlar için):** Bu sürüm Claude (Anthropic, Cowork) tarafından 21 Eylül 2026'da
> ChatGPT'nin `brainhub-v95109-signal-flow-hardening` dalı (`50a2f4a`) üzerine tamamlandı.
> Koddaki her Claude değişikliği `CLAUDE_V109` etiketiyle işaretlidir.
>
> | Yer | İşaret |
> |---|---|
> | PC `/health` ve `/live/status` | `featureVersion: 9.5.109-CLAUDE-VISION`, `claudeMarker: CLAUDE_V109`, `builtBy`, `features: CLAUDE_V109_*` |
> | Android | `versionName '9.5.109-CLAUDE'`, `versionCode 26092104`, durum ekranında “Sürüm: v9.5.109-CLAUDE • CLAUDE_V109” |
> | Codemagic | iş akışı adı `Futures 15m Alarm PRO APK v9.5.109-CLAUDE (Claude)`, APK `Futures15mAlarm-PRO-v9.5.109-CLAUDE.apk`, log satırı `V95109_CLAUDE_OK` |
> | Kod | `brainhub/claude-v109.js`, `brainhub/test/claude-v109.test.js`, `brainhub/test/office-dashboard.test.js`, `brainhub/claude-v109.example.json`, `brainhub/office-dashboard/` |
> | Commit | `[Claude v9.5.109-CLAUDE] …` başlıklı commit(ler) |

## 1. ChatGPT v9.5.109 dalının doğrulanması

Test sonucu (Node 22, `cd brainhub && node --test test/*.test.js`):

| Dal | Test | Geçen | Kalan |
|---|---|---|---|
| `futures15m-alarm-public-build` (v9.5.108, `f00a6c6`) | 177 | 174 | 3 kırmızı |
| ChatGPT `brainhub-v95109-signal-flow-hardening` (`50a2f4a`) | 185 | 179 | **6 kırmızı** |
| **v9.5.109-CLAUDE (bu sürüm)** | **204** | **204** | 0 |

ChatGPT'nin 6 kırmızı testi: `leader-lifecycle` (yeniden fiyatlama sonrası beklenen neden), `mobile-risk-caps` ×2
(risk tavanı), `pipeline-context` ×2 (v109 şemasıyla eski fixture), `plan-workers` (bozuk şema artık WAIT).

ChatGPT'nin “yaptım” dediği maddeler:

| # | ChatGPT iddiası | Sonuç | Kanıt / not |
|---|---|---|---|
| 1 | Ayrı dal + `release-v9.5.108-backup`; ana dal ilerletilmedi | ✅ Doğru | Ana dal `f00a6c6`'da, yedek dal aynı commit |
| 2 | `NONE — …`, `YOK — …` ortak normalizasyon | ✅ Doğru | `wait-condition.js`; ama PC güncelleyici bu dosyayı kopyalamıyordu (bkz. H1) |
| 3 | Worker hatası/9Router yoksa kör 9TF yerine WAIT | ✅ Doğru | `plan-workers.js`; eski test güncellenmemişti |
| 4 | 15 dk yükseltme soğuması, 5 dk bypass yok | ⚠️ Kısmen | 9TF analizi hata verirse `lastAnalyzedAt` güncellenmiyor → aynı sembol her tur önceliği alıyor (H4) |
| 5 | Worker neden dağılımı telemetrisi | ✅ Doğru | `workerReasonCounts` |
| 6 | Çekirdeğe yalnız origin/owner WAIT/FORMING | ✅ Doğru | `localDecisionTfEvidence` |
| 7 | `NO_ACTIVE_BREAKOUT` anlamı prompt'ta | ✅ Doğru | |
| 8 | `TRIGGER_LEVEL_ID / TRIGGER_TF / INVALIDATION_LEVEL_ID` | ❌ Hatalı | Yerel Vision'a verilen aday listesi kırpılmış frame'lerden hesaplanıyordu → **her zaman boş** (H2); 3 yeni zorunlu alan eksikse plan REVIEW_REQUIRED (H3) |
| 9 | Seviyeler deterministik (prior-20, swing, FVG CE50, OTE) | ✅ Doğru | `engine.triggerLevelCandidates` |
| 10 | Worker kapanmış mumu sayısal tetikle kodla kontrol eder | ✅ Doğru | `deterministicGuard` |
| 11 | `SHADOW_TRIGGER`, `SHADOW_OUTCOME_15M/60M`, 24 saat sayaç | ✅ Doğru | `shadowOutcomeTick` + sağlık alanları |
| 12 | Jev WATCH planında gölge hakem | ✅ Doğru | Her WATCH planı ücretli bir Jev çağrısı yapar (~0,000016 $) |
| 13 | Kiro free Vision kurtarması istek başına opt-in | ✅ Doğru | Etki: yerel Vision düşünce Leader Auto analizi kurtarmasız biter (kullanıcı kararı) |
| 14 | Tarayıcı kendi ilk-10'una kapanmıyor, 8 yeni sembol slotu | ⚠️ Kısmen | “Yeni sembol” adayları derin analiz listesine hiç ulaşmıyordu (H6) |
| 15 | 523 sembol yalnız hafif snapshot | ✅ Doğru | |
| 16 | 15m+ grafik 896×504/64 mum, 1m-5m 448×252 | ✅ Doğru | Büyük görsel 4B modelde süreyi uzatabilir; ölçülmeli |
| 17 | `/vision/benchmark?run=1` sentetik doğruluk | ✅ Doğru | Yalnız 3 sentetik vaka; yüzde kaba |
| 18 | Emirden hemen önce ticker yenileme | ✅ Doğru | |
| 19 | Sapma tetik referansına göre | ❌ Zararlı | %0,5 sapma **tetik seviyesine** göre ölçülünce 15m kırılım girişlerinin çoğu `LIVE_PRICE_DEVIATION_TOO_HIGH` (H5). Not: bu öneri Claude'un ilk PDF'indeydi; ölçek hatası Claude'undur ve bu sürümde düzeltildi |
| 20 | `leverageBracket` + `STOP_BEYOND_LIQUIDATION` | ✅ Doğru | Claude'un kendi basit sürümü yerine ChatGPT'ninki tutuldu |
| 21 | riskQuote / stop / likidasyon telemetrisi | ✅ Doğru | |
| 22 | İşlem başı risk % şişirmesi kaldırıldı | ❌ İşlem açtırmıyor | Kullanıcının gerçek ayarı (80,54 USDT, 25 USDT × 10x, `maxRiskPctPerTrade=1`) → 0,8 USDT risk → en fazla %0,32 stop: yapısal stopla hiçbir işlem açılamaz; 2 test kırmızı (H7) |
| 23 | Sağlık çift sayımı düzeltildi | ✅ Doğru | |
| 24 | Gölge 15/60 dk performans sayaçları | ✅ Doğru | |
| 25 | “177/177 henüz yok” | ✅ Doğru | Ölçülen: 185'te 6 kırmızı |
| 26 | Android/Codemagic/updater 9.5.109 yapılmadı | ✅ Doğru | `featureVersion` hâlâ `9.5.108-VISION` idi; Claude tamamladı |

## 2. Claude'un bulduğu ek hatalar ve düzeltmeler

| Kod | Sorun | Düzeltme | Dosya |
|---|---|---|---|
| H1 | `manage.ps1 $files` listesinde `wait-condition.js`, `vision-benchmark.js` yok → PC'de `MODULE_NOT_FOUND`, güncelleme geri alınır | Listeye eklendi + `claude-v109.js`; testi: sunucunun require grafiği listeyle karşılaştırılır | `manage.ps1`, `test/claude-v109.test.js` |
| H2 | `compactLocalFinalizeContext` tetik adaylarını prior20/swing/FVG/OTE alanı olmayan kırpılmış frame'lerden üretiyordu → liste hep boş | Adaylar tam yerel bağlamdan; finalize frame'lerine `prior20High/Low` eklendi | `server.js` |
| H3 | Model 3 tetik alanını eksik/yanlış yazarsa plan REVIEW_REQUIRED | `CLAUDE_V109_TRIGGER_AUTOSELECT`: kod prior-20 adayını seçer (fiyat yine modelden alınmaz), `autoSelected` işaretlenir; WATCH'ın somut olmayan WAIT metni sayısal metne çevrilir | `pipeline.js`, `claude-v109.js` |
| H3b | Semantik onarım başarısızsa `throw` → 9 grafiklik Vision sonucu çöpe | `CLAUDE_V109_NUMERIC_WAIT_FALLBACK`: modelin seçtiği tetikten (yoksa prior-20) sayısal bekleme | `server.js` |
| H3c | QUALIFIED planında “NONE — …” sözleşmeyi bozuyordu | `CLAUDE_V109_QUALIFIED_NONE_PREFIX` | `pipeline.js` |
| H4 | Hata veren 9TF yükseltmesi her tur önceliği tekrar alıyor | `CLAUDE_V109_ESCALATION_ATTEMPT_COOLDOWN` (5 dk) | `live-controller.js` |
| H5 | Tetiğe göre %0,5 sapma → kırılım girişleri kilitli | `CLAUDE_V109_TRIGGER_CHASE_GATE`: tetikten lehte uzaklık ≤ max(maxEntryDeviationPct, ATR%×1), üst sınır %3; tetik içine dönüş → red. Transport sapması taze fiyata göre (`CLAUDE_V109_ENTRY_REFERENCE_FRESH`). İmzalı Binance çağrısından önce çalışır | `claude-v109.js`, `live-controller.js` |
| H6 | `LIGHTWEIGHT_NEW_ACCELERATION` adayları derin listeye ulaşmıyor | `acceleratingCandidates` her iki kaynağı da alır | `scanner.js` |
| H7 | Sert risk tavanı gerçek ayarlarla işlemi imkânsız kılıyor | `CLAUDE_V109_RISK_AUTHORITY_SWITCH`: varsayılan v108 panel otoritesi (likidasyon kapısı artık zararı sınırlıyor); `live-policy.json` → `"riskAuthority":"STRICT_POLICY_CAP"` ile sert tavan | `live-controller.js` |

## 3. Gölge (SHADOW) mekanizmaları — varsayılan KAPALI bağlayıcılık

`config/claude-v109.json` (ilk güncellemede `claude-v109.example.json`'dan oluşturulur):

```json
{ "deterministicTriggerMode": "SHADOW", "jevVetoPolicy": "V108_ANY_065", "chaseAtrMultiple": 1.0, "chaseCapPct": 3.0 }
```

- **Kod-tetik (`CLAUDE_V109_DETERMINISTIC_TRIGGER_SHADOW`)**: model WATCH dediğinde tercihli TF'de (15m, 30m, 5m, 1h, 45m, 3m)
  kapanmış mumda ACCEPTED/RECLAIMED kırılım + fiyat hâlâ seviyenin ötesinde + origin/owner vetosu yok + yön tarayıcıyla aynı ise
  “QUALIFIED olurdu” kaydı (`CLAUDE_V109_DT` journal) ve ChatGPT'nin 15/60 dk gölge sonuç altyapısına giriş fiyatıyla yazılır.
  `BINDING` yalnız kullanıcı isterse: WATCH→QUALIFIED; Jev, risk, likidasyon, kovalama ve LIVE kapıları yine uygulanır.
- **Jev rol-ağırlıklı kural (`CLAUDE_V109_JEV_ROLE_WEIGHTED_SHADOW`)**: her Jev yanıtında iki kural da hesaplanır.
  Sert: paket bütünlüğü / veri kalitesi ≥0,65, yapısal ≥0,75; origin/owner TF çelişkisi ≥0,65; yumuşak: en az ikisi ≥0,75 veya biri ≥0,90.
  Bağlayıcı kural `jevVetoPolicy` ile seçilir. Jev hata/şema sorunu her iki modda da veto (fail-closed).

**24 saat sonra karar ölçütü:** Office ekranındaki “Claude v9.5.109 • gölge ölçüm” kartında kod-tetik “olurdu” sayısı ≥ 5 ve
15/60 dk ortalama sonuç pozitifse `deterministicTriggerMode` BINDING'e alınabilir. Jev için: rol-ağırlıklı kural v108'e göre
hangi planları geçirirdi ve onların gölge sonucu ne oldu, ona bakılır.

## 4. Değişmeyen güvenlik kapıları

LIVE arm (kullanıcı açar; güncelleme/yeniden başlatma kapatır), tek seferlik grant, lease/lineage, stale veri, stop-no-widen,
`STOP_BEYOND_LIQUIDATION`, kill-switch, günlük zarar, aile/açık pozisyon limitleri, maliyet/edge kapısı. Claude hiçbir emir
göndermedi, LIVE açmadı, 9Router/OpenRouter hesap ayarlarına veya anahtarlarına dokunmadı.

## 5. Trade Office ekranı v1.1 (`brainhub/office-dashboard`)

Yürüyen trader'lar (her rotada kartla veri taşır, tıkalı kapıda bekler), beynin çevresinde setup taşıyan trader'lar,
Claude v109 gölge ölçüm kartı, tetik sütunu. `manage.ps1 -Action Update` klasörü `C:\BrainHub\office-dashboard` içine kopyalar;
başlatmak: `C:\BrainHub\office-dashboard\OFFICE.cmd`. Salt-okunur, yalnız GET.

## 6. ChatGPT için sonraki adımlar

1. PC güncellemesinden sonra `/health` → `featureVersion` `9.5.109-CLAUDE-VISION` ve `CLAUDE_V109_*` özelliklerini doğrula.
2. 24 saat gölge veri topla; `leaderAuto.health.claudeV109` + `shadow*` alanlarını raporla.
3. `/vision/benchmark?run=1` doğruluğunu 896×504 ve 448×252 için ayrı ölç; vaka sayısını ≥ 20'ye çıkar.
4. Karar sonrası: `config/claude-v109.json` modlarını kullanıcı onayıyla değiştir; kod değişikliği gerekmez.
