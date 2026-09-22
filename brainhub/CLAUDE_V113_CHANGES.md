# CLAUDE_V113 — BrainHub v9.5.113-CLAUDE (Claude, Anthropic • Cowork • 22 Eylül 2026)

> ChatGPT ve diğer ajanlar için: bu sürümü **Claude** yaptı. Temel: `futures15m-alarm-public-build@d04a5c1` (v9.5.112).
> Her değişiklik `CLAUDE_V113` (bir kısmı `CLAUDE_V112_POSITION_SLOTS_REST`) etiketlidir.
> PC kimliği `9.5.113-CLAUDE-VISION`; Android `9.5.113` / versionCode `26092201`.

## 0. 22 Eylül canlı işlem incelemesi (02:17–09:33 TR, LIVE açık)
- 12 emir açıldı, hepsi hızlı scalp hattından (SCALP_MOMENTUM). Emir geometrisi doğruydu: 30 USDT × 10x = 300 notional, SL closePosition + TP1 + 2/3 runner.
- Kapanan ≈ −34 USDT (cüzdan 146,5 → 110,4). Kazananlar: FORM SHORT +26,5 (runner 2,4R), VVV SHORT +2,6.
  Kaybedenler: hareket zaten uzamışken girildi (COOKIE 4 saatte +8,7% / +7,8%, RUNE +5,3%, PTB −19%). Stoplar %2,5–5,5 uzaktaydı.
- Jev `ADVISORY_VETO_ONLY`: 208 hızlı hat kararının 162'si onay. Jev'e uzama, stop/R geometrisi ve geçmiş sonuç gitmiyordu.
- Kapanan işlemlerin sonucu **hiç kaydedilmedi**: sonuç yazan adım yalnız Vision boştayken çalışan pozisyon incelemesinin içindeydi, Vision hiç boş değildi. Office'te "açık pozisyon yok" aynı sebepten.
- Telefon 02:49'dan sonra PC'ye ulaşamadı (Tailscale). Uygulamadaki "PC LIVE: KAPALI" telefonun kendi ayarıydı, PC'nin gerçeği değil; Acil Durdur hataları yutuyordu.
- Hard safety 116 kez engelledi; hepsi pozisyonlar dolu / toplam maruziyet (kullanıcının max pozisyon kuralı).

## 1. Değişiklikler
| Etiket | Dosya | Ne |
|---|---|---|
| CLAUDE_V113_OUTCOME_LEDGER | live-controller.js | Kapanan işlem: Binance income (REALIZED_PNL+COMMISSION+FUNDING_FEE), R çarpanı, çıkış türü (STOP_LOSS / TP1_RUNNER_TRAIL / TP1_BREAKEVEN / TP1_THEN_STOP / TAKE_PROFIT / OTHER_CLOSE), süre, **giriş nedeni** (`entryContext`: why, hat, TF, Jev olasılıkları, uzama, risk geometrisi) → journal `POSITION_CLOSED` + learning_events (beyin). Tek sahip positionLedgerTick; kapanış = 2 ardışık anlıkta yok; gelir okunamazsa ≤10 dk yeniden dener; aynı sembole hızlı yeniden girişte gelir penceresi giriş emrinden başlar; stop sonrası o coine hızlı hat 30 dk girmez. ACTIVE satırların yürütme alanları yeniden analizde silinmez, 24 satır sınırında düşmez. |
| CLAUDE_V113_POSITION_LEDGER | live-controller.js, server.js (30 sn), store.js | Vision/Leader meşguliyetinden bağımsız defter: `/fapi/v3/positionRisk` (giriş/mark/likidasyon) → GET `/live/positions` (açık + kapanan + özet). |
| CLAUDE_V112_POSITION_SLOTS_REST | live-controller.js | Açık pozisyon ≥ panel max → Vision, hızlı hat/Jev, plan worker dinlenir; runner/pozisyon yönetimi sürer; yer açılınca devam. Emir zaten risk kapısında engelli. |
| CLAUDE_V113_JEV_FULL_EVIDENCE | engine.js, pipeline.js, jev-decision.js | Jev kaydına TF başına: close/EMA20/EMA50/RSI/ATR/getiri, swing (HH/HL/LH/LL, BOS/CHoCH), **Fibonacci** (0.382/0.5/0.618/0.786, 1.272/1.618), **order block** (bozulmamış, mitigated), FVG + likidite (eşit tepe/dip, sweep), formasyonlar; hızlı hat uzama + stop/R geometrisi; aynı coinin son (≤120 dk) Vision okuması. 3 yeni Jev sorusu: extended_entry, poor_risk_geometry, negative_track_record (≥5 ölçülmüş örnek varsa bağlayıcı). Kayıt ≈40k karakter; 48k aşılırsa veto yerine kademeli kısaltma. Vision/komite istemleri büyümedi (Fib yalnız Jev'e). |
| CLAUDE_V113_FAST_LANE_EXTENSION | claude-v112.js, claude-v111.js | İşlem yönünde son ~5 saatlik (1h×5 mum) getiri > `fastLaneMaxExtensionPct` (vars. 4) → `FL_EXTENDED_CHASE_1H`, giriş yok. 22 Eyl verisinde bu kural 5 kaybeden işlemi (≈ −50 USDT) eler, kazananları elemezdi (küçük örnek). |
| — | office-dashboard 1.5.0-CLAUDE-V113-LEDGER | Açık pozisyonlar tablosu (giriş, anlık, PnL, R, stop/runner, TP1, giriş nedeni) + kapanan işlemler tablosu (net PnL, R, çıkış, süre, uzama, stop %, Jev, neden) + özet; olaylar: işlem kapandı, dinlenme. |
| CLAUDE_V113_ANDROID_LIVE_TRUTH | futures15m_alarm/v95113_claude_live_truth.py, V95113PcTruth.java, BrainHubClient.java | "PC LIVE" yalnız PC'nin ≤90 sn içinde onayladığı durumdan; ulaşılamazsa kırmızı "BİLİNMİYOR — son bağlantı HH:MM". Acil Durdur ve OTO kapatma: PC `armed=false` onaylayana kadar 5 deneme; başarısızsa kalıcı kırmızı uyarı. PC pozisyonları ve kapanan özet salt-okunur. |
| — | manage.ps1 | Test-Brain 9.5.113 + v113 özellikleri; OpenRouterSetup `maxPayloadChars` 24000 → 48000. |

## 2. Config (config/claude-v111.json)
- `fastLaneMaxExtensionPct` (vars. 4; 0 = kapalı), `restWhenPositionsFull` (vars. true), `fastLaneMaxJevPerHour` (PC'de 60).
- `live-policy.json limits.maxDailyLossPct` = 100 (kullanıcı isteğiyle günlük zarar limiti fiilen kapalı).

## 3. Testler
261/261 (`node --test brainhub/test/*.test.js`). Yeni: `test/claude-v113.test.js` (4) + dinlenme testi (claude-v112.test.js). Android kaynak zinciri `tools/run_futures_source_chain.py` → `SOURCE_CHAIN_OK`.

## 4. Geri dönüş
- Uzama filtresi: `"fastLaneMaxExtensionPct": 0`. Dinlenme: `"restWhenPositionsFull": false`.
- Tam geri: `C:\BrainHubBackups` (RESTORE.ps1) veya GitHub `d04a5c1`.
