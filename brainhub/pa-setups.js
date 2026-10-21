'use strict';
// R2544.69 FİYAT HAREKETİ KURULUMLARI, TEK KAYNAK (kullanıcı 21.10: "price action stratejilerini topla ... ZİRVE 5, İLK 3 VE NORMAL
// TRADE'DE DE BU STRATEJİLER TANIMLI OLMASI LAZIM"). Normal sistemin JEV paketine, ZİRVE-5 ve İlk 3'ün canlıda işlem açtığı
// fonksiyonların AYNISIYLA hesaplanan durumu koyar (yeni kural yok, kopya kural yok):
//  - ZİRVE-5 FiboBuLL alanı: zirve5.videoStates (15 dk kapanmış mumlar; canlı tarama ve 15 dk grafik de bunu kullanır)
//  - İlk 3 seviyeleri: top3-hunter.dailyLevels (önceki gün / 7 gün / 30 gün tepe ve dipleri; ERKEN LONG kırılım + geri test seviyesi)
// Salt okunur bağlam: emir/karar üretmez. Normal sistemde kararı JEV verir; bu bölüm JEV'in aynı haritayı görmesi içindir.
const z5Lib = require('./zirve5');
const top3Lib = require('./top3-hunter');
const PA = require('./pa-core');

const VERSION = 'R2544.69-PA-SETUPS';
const finite = v => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };
const sig = v => { const n = finite(v); return n === null ? null : Number(n.toPrecision(7)); };
// Binance kline rows [openTime, o, h, l, c, v, closeTime, quoteVolume, ...] -> closed candles only
function candlesFromKlines(raw, now, frameMs) {
  return (Array.isArray(raw) ? raw : []).map(r => ({ openTime:finite(r[0]), open:finite(r[1]), high:finite(r[2]), low:finite(r[3]), close:finite(r[4]),
    closeTime:finite(r[6]) ?? (finite(r[0]) + frameMs - 1), quoteVolume:finite(r[7]) }))
    .filter(c => c.openTime !== null && c.close > 0 && c.openTime + frameMs <= now);
}
const STATE_TR = { WAITING:'HACIMLI_MUM_BEKLENIYOR', CONFIRMED:'ONAY_MUMU_GELDI', BROKEN:'ALAN_KAYBEDILDI', EXPIRED:'SURE_DOLDU', INVALID:'GECERSIZ' };
function zirve5View(raw15, now, cfg = z5Lib.DEFAULT_CONFIG) {
  const c = candlesFromKlines(raw15, now, z5Lib.M15);
  if (c.length < 128) return { available:false, reason:'NEED_128_CLOSED_15M_CANDLES', have:c.length };   // < 128 candles: zones may differ from the live scan
  const vs = z5Lib.videoStates(c, cfg), last = c.at(-1);
  const zones = vs.zones.filter(z => z.video?.state !== 'INVALID').slice(-2).map(z => ({ side:z.side, top:sig(z.top), bottom:sig(z.bottom), equilibrium:sig(z.equilibrium),
    state:z.video.state, stateTr:STATE_TR[z.video.state] || z.video.state, liquidityTarget:sig(z.video.liquidity), stop:sig(z.video.stopPrice),
    bornAt:z.at, confirmAt:z.video.confirmAt ?? null, confirm:z.video.confirm || null, confirmedOnLastCandle:z.video.state === 'CONFIRMED' && z.video.confirmIndex === c.length - 1 }));
  return { available:true, tf:'15m', rule:'FIBOBULL_VIDEO', setups:{ LONG:z5Lib.SETUP_LONG, SHORT:z5Lib.SETUP_SHORT }, lastClosed:last.closeTime, zones,
    how:'top break -> LONG zone [dip that made the break, broken top]; dip break -> SHORT zone [broken dip, top that made the break]; entry only when a volume-backed (>= ' + cfg.volMult + 'x 24h median) strong (body >= ' + Math.round(cfg.bodyMin * 100) + ' %) candle closes inside the zone; stop 0.1 % beyond the zone; target the liquidity extreme (>= 1R)' };
}
function ilk3View(raw1d, now) {
  const kd = (Array.isArray(raw1d) ? raw1d : []).map(r => [finite(r[0]), finite(r[1]), finite(r[2]), finite(r[3]), finite(r[4])]);
  if (kd.length < 10) return { available:false, reason:'NEED_10_DAILY_CANDLES', have:kd.length };
  const lv = top3Lib.dailyLevels(kd, now);
  return { available:true, levels:{ prevDayHigh:sig(lv.pdh), prev7dHigh:sig(lv.pwh), prev30dHigh:sig(lv.pmh), prevDayLow:sig(lv.pdl), prev7dLow:sig(lv.pwl), prev30dLow:sig(lv.pml) },
    how:'İLK 3 ERKEN LONG: a 5m close breaks one of these highs with >= 3x volume, the first retest of the broken level is bought (no chasing); İLK 3 TEPE SHORT: a fresh 24h top that loses the last 6 candles\' low; these highs/lows are also short/long liquidation pools' };
}
function paSetups({ rawFrames = null, now = Date.now(), z5cfg = z5Lib.DEFAULT_CONFIG } = {}) {
  if (!rawFrames || typeof rawFrames !== 'object') return null;
  let zirve5 = null, ilk3 = null;
  try { zirve5 = zirve5View(rawFrames['15m'], now, z5cfg); } catch (e) { zirve5 = { available:false, reason:String(e?.message || e).slice(0, 80) }; }
  try { ilk3 = ilk3View(rawFrames['1d'], now); } catch (e) { ilk3 = { available:false, reason:String(e?.message || e).slice(0, 80) }; }
  // R2544.70: the price-action core (sweeps of highs/lows, nearest untaken liquidity, range position) on the same closed 15m candles
  let core15m = null;
  try { const c = candlesFromKlines(rawFrames['15m'], now, z5Lib.M15); core15m = c.length >= 100 ? PA.context(c, c.length - 1, c.at(-1).close, { n:3, lookback:96, within:24 }) : { available:false, reason:'NEED_100_CLOSED_15M_CANDLES', have:c.length }; }
  catch (e) { core15m = { available:false, reason:String(e?.message || e).slice(0, 80) }; }
  return { version:VERSION, readOnly:true, zirve5, ilk3, core15m };
}
// levelMap items (price, label) for the JEV level map: zone edges / liquidity target and the İlk 3 highs/lows
function levelItems(pa) {
  const out = [];
  for (const z of pa?.zirve5?.available ? pa.zirve5.zones : []) {
    if (!['WAITING', 'CONFIRMED'].includes(z.state)) continue;
    out.push([z.top, `15m:Z5_${z.side}_ZONE_TOP`], [z.bottom, `15m:Z5_${z.side}_ZONE_BOTTOM`], [z.liquidityTarget, `15m:Z5_${z.side}_LIQ_TARGET`]);
  }
  const l = pa?.ilk3?.available ? pa.ilk3.levels : null;
  if (l) out.push([l.prevDayHigh, '1d:PDH'], [l.prev7dHigh, '7d:PWH'], [l.prev30dHigh, '30d:PMH'], [l.prevDayLow, '1d:PDL'], [l.prev7dLow, '7d:PWL'], [l.prev30dLow, '30d:PML']);
  return out.filter(([p]) => finite(p) > 0);
}
module.exports = { VERSION, paSetups, zirve5View, ilk3View, levelItems, candlesFromKlines };
