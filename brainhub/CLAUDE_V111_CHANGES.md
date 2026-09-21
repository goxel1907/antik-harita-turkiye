# CLAUDE_V111 — BrainHub v9.5.111-CLAUDE (Claude, Anthropic • Cowork • 21 Eylül 2026)

> ChatGPT ve diğer ajanlar için: bu sürümü **Claude** yaptı. Temel: ChatGPT'nin v9.5.110 multilane sürümü
> (`futures15m-alarm-public-build@0bbabcf`). Her değişiklik `CLAUDE_V111` etiketiyle işaretlidir.
> Android arayüzü **değişmedi** (kullanıcı: "şimdilik dokunma"); APK kimliği 9.5.110 / 26092105 olarak kalır.
> PC kimliği: `featureVersion = 9.5.111-CLAUDE-VISION`, `/health.claudeV111Marker = CLAUDE_V111`.

## Kullanıcının kuralı (21 Eylül, kelimesi kelimesine özet)
- 15m ana işlem bölgesi. Diğer zaman dilimleri likidite / formasyon bağlamı.
- 1m/3m/5m tek başına karar vermez **doğru**; ama volatil, erken ilgi gören, çok konuşulan, top sıralamaya aday
  coinlerde 1m/3m/5m scalp fırsatlarını ajanlar/modeller/worker'lar değerlendirmeli; 1m'de yakalanan işlem
  momentuma göre tükenene kadar zaman dilimleri boyunca devam edebilmeli. LONG ve SHORT.
- "Grafik modelleme çözünürlüğü analist yorumlayamaz ise JEV hiç karar veremez; şimdiye kadar ajanlar/workerlar
  Jev'e bir karar götürmedi."
- AskUserQuestion cevapları: kod-tetik → "benim sana söylediğim gibi yap" (kararlar Jev'e ulaşsın);
  scalp → momentum coinleri; çıkış → TP3 yerine iz süren stop; Android arayüzü → şimdilik dokunma.

## Canlı teşhis (PC journal, 21 Eylül)
| Ölçüm | Değer |
|---|---|
| v109 dağıtımından (12:22Z) 13:39Z'e kadar | 9 PLAN, 9 JEV_SHADOW, **0 bağlayıcı Jev çağrısı**, 134 worker incelemesi, 2 kod-tetik "olurdu" |
| 13:39Z sonrası | journal'a hiç kayıt yok (13:41 / 13:52 yeniden başlatma = ChatGPT v110 kurulumu) |
| `config/leader-auto.json` | `enabled:false` (14:51Z'den beri) → **şu an hiç analiz çalışmıyor** |
| LIVE | kapalı (kullanıcı beyanı) |

Kök neden (neden Jev'e hiç karar gitmedi): Jev yalnız QUALIFIED planı bağlayıcı inceler. QUALIFIED'ı yalnız 4B yerel
Vision modeli üretebiliyordu; worker kapanmış-mum tetiğini görse bile (v109 H8 / v110 V110_NUMERIC_TRIGGER_H8) yapılan şey
**yeni bir ~8 dk'lık tam Vision analizi** idi ve model yine WATCH diyordu. Kod-tetik ise SHADOW'daydı. v110
`enforceQualification` ek olarak 30m+/bağlam kökenli QUALIFIED'ları WATCH'a indiriyor. Sonuç: QUALIFIED=0 → Jev=0.

## Değişiklikler
| Etiket | Dosya | Ne / neden |
|---|---|---|
| CLAUDE_V111_MOMENTUM_SCALP_TRIGGER | claude-v111.js `laneAwareTrigger`, pipeline.js | v109 kod-tetiği v110 hatlarına bağlandı. Momentum coin (TOP3/TOP10/EARLY_TOP5/EARLY_EXPANSION/RISING, APP_EARLY_ATTENTION, NEW/LIGHTWEIGHT_ACCELERATION, TOP24_GAINER, 24s aralık ≥%12 veya 1m ort. mum ≥%0,35; spread ≤8 bps, yön desteği ≥2) **ve** 2/3 alt TF hizalı **ve** 15m sert karşı-veto yok → 1m/3m/5m kapanmış-mum kırılımı tetik olur. Momentum değilse yalnız 15m ana hat. 30m+ tetik olamaz (bağlam). |
| CLAUDE_V111_LANE_ENFORCED_AFTER_DT | pipeline.js | Kod-tetik veya yeniden doğrulamayla QUALIFIED olan plan da v110 `enforceQualification`'dan geçer (ChatGPT kuralı korunur). |
| CLAUDE_V111_TRIGGER_REVALIDATION | claude-v111.js `revalidateTrigger`, pipeline.js, live-controller.js, store.js `latestJournal` | Worker `DETERMINISTIC_NUMERIC_TRIGGER` verdiğinde Leader AUTO o coine öncelik verir (5 dk soğuma yok) ve pipeline **saklanan 9TF Vision planını** taze kapanmış mumla yeniden doğrular: plan WATCH + sözleşme geçerli, yaş ≤20 dk (scalp) / ≤120 dk (ana), tetik TF'sinin kapanışı tetik ötesinde, invalidation bozulmamış, FAILED_BREAKOUT yok, canlı fiyat hâlâ tetik ötesinde, model vetosu origin/owner/tetik TF'sinde yok, hat hazır (scalp: momentum + 2/3; ana: 15m), 15m sert karşı-veto yok, momentum tükenmemiş. Geçerse plan QUALIFIED olur (`waitFor = "NONE — Claude v111 yeniden doğrulama …"`, saklanan sayısal tetik korunur) ve **Jev'e gider**; Jev, risk, likidasyon, kovalama, lease/lineage, LIVE kapıları aynen. Vision ~8 dk atlanır. Geçmezse eski tam 9TF yolu çalışır. Aynı plan ikinci kez hızlı yoldan geçemez (`REVAL_ALREADY_REVALIDATED_REQUIRES_FULL_9TF`) → Jev vetosundan sonra yeni tam Vision gerekir. Uygulama `config/claude-v109.json deterministicTriggerMode`'a bağlıdır (SHADOW = yalnız kayıt). |
| CLAUDE_V111_TRAILING_RUNNER | binance-live-transport.js, live-controller.js `runnerTick`, server.js zamanlayıcı | `config/claude-v111.json runnerMode=BINDING` iken Leader AUTO girişinde TP3 konmaz; son 1/3 "runner". TP1 dolunca stop başabaşa (+%0,12 ücret payı); TP2 dolunca runner, momentum merdiveninin en yüksek destekleyen TF'sindeki onaylı swing ile izlenir (scalp en fazla 15m, ana hat en fazla 1h; momentum tükenirse 1m swing'e sıkılaşır). 30 sn döngü, 45 sn değiştirme soğuması. Mobil manuel emirler TP3'lü kalır. |
| CLAUDE_V111_RUNNER_NEVER_WIDEN | claude-v111.js `desiredRunnerStop` | Yeni stop yalnız sıkılaşır (min %0,08 iyileşme); mark fiyatına %0,05'ten yakın stop konmaz. Orijinal closePosition stop hiç iptal edilmez (yedek); yeni stoplar reduce-only miktarlı `STOP_MARKET` (pozisyon açamaz). |
| CLAUDE_V111_RUNNER_TP3_FALLBACK | live-controller.js | Stop taşıma 3 kez borsa hatası verirse sabit TP3 yeniden konur. Pozisyon kapanınca bu işleme ait artık koşullu emirler (runner stop, TP'ler, orijinal stop) iptal edilir ki sonraki pozisyonu etkilemesin. SHADOW modunda Binance'e hiçbir yazma isteği gitmez. |
| — | live-controller.js `ruleTr`, office.html | "1m/3m/5m tek başına çıkış kararı vermez" metni **çıkış** kuralı olarak netleştirildi; giriş/scalp kuralı ayrıca yazıldı. |
| — | office-dashboard (v1.2.0-CLAUDE-V111) | Yeniden doğrulama ve runner journal olayları, "Kod-tetik → Jev" paneli; `num(null)` artık "—" (eskiden 0.00%). |
| CLAUDE_V111_UPDATER_FILESET | manage.ps1, UPDATE.ps1, codemagic.yaml | `claude-v111.js` + `claude-v111.example.json` dağıtımı, sağlık testi 9.5.111-CLAUDE-VISION, Codemagic `CLAUDE_V111_PC_OK`. |

## Bilinen sınırlar (dürüst not)
- Leader AUTO tek işlem akışıdır: o an çalışan bir tam Vision analizi (ort. 4–8 dk) bitmeden yeniden doğrulama başlamaz. Karar gecikmesi ≈ kalan Vision süresi + birkaç saniye. Paralel hızlı hat, emir yürütme eşzamanlılığı nedeniyle bilerek eklenmedi.
- Runner'ın borsa uçları (`DELETE /fapi/v1/algoOrder`, miktarlı reduce-only `STOP_MARKET`) birim testlerde taklit edildi; gerçek hesapta henüz çalışmadı. Hata durumunda orijinal stop yerinde kalır ve TP3 geri konur.
- Momentum sınıflandırması tarayıcı alanlarına dayanır; tarayıcı listesinden düşen takip coinleri (aday bilgisi yok) momentum sayılmaz → yalnız 15m ana hat.

## Testler
226 → **227/227** (`node --test brainhub/test/*.test.js`; v110 211 + Claude v111 16). Yeni: `test/claude-v111.test.js`
(momentum tanımı, hat-farkında tetik LONG/SHORT, 15m sert karşı-veto, yeniden doğrulama kabul/ret, pipeline.run uçtan uca:
BINDING'de Vision çağrılmadan QUALIFIED + Jev çağrısı / SHADOW'da yalnız kayıt, Leader AUTO önceliği, runner faz/stop
hesapları, transport TP3'süz giriş, runner BINDING/SHADOW döngüsü Binance taklidiyle).

## Geri dönüş
- Kod-tetik + yeniden doğrulamayı gölgeye al: `C:\BrainHub\config\claude-v109.json` → `"deterministicTriggerMode": "SHADOW"` (30 sn içinde etkin).
- Runner'ı kapat: `C:\BrainHub\config\claude-v111.json` → `"runnerMode": "SHADOW"` veya `"OFF"` (yeni girişler TP3'lü olur).
- Tam geri alma: `C:\BrainHubBackups` içindeki son yedek (`RESTORE.ps1`) veya GitHub `0bbabcf` (ChatGPT v9.5.110).
