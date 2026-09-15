# v9.5.60 — Order-flow / liquidity provenance hardening

Bu sürüm yeni bir trade filtresi eklemek yerine mevcut verinin **ne anlama geldiğini ve ne anlama gelmediğini** kod seviyesinde netleştirir.

## mamonet/orderbook-heatmap düzeltmesi

`mamonet/orderbook-heatmap` içindeki "persistent horizontal bands" ifadesi heatmap'in mutlak fiyat ekseninde görsel yorumudur. Repo README'sinde ayrı bir wall-age/persistence süresi, çekilme süresi veya kalıcılık skoru tanımlanmıyor. Bu nedenle uygulamada bu repodan gelmiş gibi bir `wall persistence` metriği üretmiyoruz.

Repodaki somut ve bize yakın metrikler top-N order-book imbalance, rolling/cumulative delta ve basit absorption bağlamıdır. Bunlar mevcut uygulamadaki BOOK/CVD/absorpsiyon ailesiyle örtüştüğü için **yeni bağımsız oy olarak eklenmez**.

Kaynak: https://github.com/mamonet/orderbook-heatmap

## QuantFlowLab/crypto-orderflow-research sınırı

Bu çalışma individual order placement/cancel/update/execution olaylarını Kraken Futures'ın order-level tarihçesinden yeniden kuruyor. Passive-add/cancel, replenishment ve repricing/retreat gibi ayrımların değeri yüksek; fakat mevcut uygulamanın Binance `/fapi/v1/depth` anlık snapshot'ı aynı veri çözünürlüğünü sağlamıyor.

Bu nedenle v9.5.60:

- snapshot değişiminden sahte `cancel`, `fill`, `spoof`, `replenishment`, `passive retreat/protection` etiketi üretmez;
- bu order-lifecycle alanlarını ölçülmedikçe **PUANSIZ** bırakır;
- gelecekte yeterli event-level collector + coverage/QA eklenirse bu özelliklerin yalnız soft execution context olarak eklenmesine izin verir.

Kaynak: https://github.com/QuantFlowLab/crypto-orderflow-research

## BOOK_MICRO isim düzeltmesi

Mevcut `bidWall` / `askWall` gösterimi zaman kalıcılığı ölçmüyordu; top-20 içindeki yoğunlaşmayı temsil ediyordu. Kullanıcı/ChatGPT tarafında yanlış anlamayı önlemek için insan-okur etiketi:

- `bidTop20Concentration`
- `askTop20Concentration`

olarak değiştirilir. Hesaplama ve karar ağırlığı değişmez.

## Likidite provenance ayrımı

Üç veri sınıfı birbirinden kesin ayrılır:

- `BSL/SSL/LIQ_DRAW`: yapısal / tahmini hedef havuzu.
- `LIQ_DENS`: modellenmiş tahmini yoğunluk; bireysel liquidation price değildir.
- `OBS_LIQ`: Binance `forceOrder` ile uygulamanın gerçekten gözlediği geçmiş snapshot olayları; tam piyasa liquidation tape değildir.

Bunlar birbirinin kanıtı sayılmaz ve aynı leverage/flow olayı birden fazla oy olarak şişirilmez. Market-maker niyeti veya bireysel likidasyon seviyesi uydurulmaz.

## hftbacktest

`nkaz001/hftbacktest` queue position, feed/order latency ve fill realism açısından güçlü bir **offline doğrulama** referansıdır. Android runtime'a sinyal skoru, LONG/SHORT sebebi veya hard veto olarak eklenmez.

Kaynak: https://github.com/nkaz001/hftbacktest

## Karar motoruna etkisi

- Yeni hard gate: **yok**
- Yeni veto: **yok**
- Yeni order-book puanı: **yok**
- Mamonet metriğini çift sayma: **yok**
- Snapshot'tan order lifecycle uydurma: **yok**
- Amaç: veri kaynağı / anlam sınırlarını açık hale getirerek sessiz yanlış çıkarımları önlemek.
