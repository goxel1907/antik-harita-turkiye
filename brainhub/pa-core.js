'use strict';
// R2544.70 PRICE ACTION ÇEKİRDEĞİ - tek kaynak (kullanıcı 21.10: "price action stratejilerini bir yerde topla ... grafikteki fitil dahil
// tüm yapıları görmesi gerekiyor"; kullanıcının PDF'leri: RektProof "Price Action Dinamikleri" + "Price Action Kursu"; web: SFP tanımı).
// Yalnız KAPANMIŞ mumlar, geleceği görmez: bir salınım noktası ancak sağındaki n mum kapanınca bilinir.
//  - swings: fitil dahil salınım tepe/dipleri (fraktal, her iki yanda n mum)
//  - liquidityPools: henüz ALINMAMIŞ salınım dip/tepeleri; birbirine %tol yakın olanlar tek havuz (eşit dipler / eşit tepeler)
//  - nextLiquidity: girişten sonra fiyatın gideceği ilk karşı likidite (PDF: "bir sonraki likidite cebine"; hedef bunun hemen önü)
//  - dealingRange: aralık ve EQ (0,5) - EQ üstü pahalı (SHORT bölgesi), altı ucuz (LONG bölgesi)
//  - sweeps: SFP - mum bir salınım ucunun ötesine FİTİL atar ve geri İÇERİ kapanır (ötede kapanırsa kırılım, SFP değil)
// Mum biçimi: {openTime, open, high, low, close} (sayı), eskiden yeniye.
const VERSION = 'R2544.70-PA-CORE';
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Fraktal salınımlar: i, iki yanındaki n mumdan yüksek (tepe) / alçak (dip); eşitlikte soldaki sayılır (çift saymaz).
// confirmedAt = i + n: bu indeksteki mum kapanmadan salınım bilinmez.
function swings(c, n = 3, upto = c.length - 1) {
  const out = [];
  for (let i = n; i <= upto - n; i++) {
    const h = c[i].high, l = c[i].low; let isH = true, isL = true;
    for (let k = 1; k <= n; k++) {
      if (!(h > c[i - k].high && h >= c[i + k].high)) isH = false;
      if (!(l < c[i - k].low && l <= c[i + k].low)) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) out.push({ i, kind:'H', price:h, confirmedAt:i + n });
    if (isL) out.push({ i, kind:'L', price:l, confirmedAt:i + n });
  }
  return out;
}

// idx anında bilinen ve o ana kadar fiyatın İÇİNDEN geçmediği salınımlar = duran likidite.
// LOW havuzu: dip, sonraki hiçbir mumun fitili altına inmemişse alınmamıştır (stoplar orada). HIGH havuzu aynası.
function liquidityPools(c, idx, { n = 3, lookback = 288, tol = 0.0015 } = {}) {
  const from = Math.max(0, idx - lookback), sw = swings(c.slice(from, idx + 1), n).map(s => ({ ...s, i:s.i + from, confirmedAt:s.confirmedAt + from }));
  const live = [];
  for (const s of sw) {
    if (s.confirmedAt > idx) continue;
    let taken = false;
    for (let k = s.i + 1; k <= idx; k++) { if (s.kind === 'L' ? c[k].low < s.price : c[k].high > s.price) { taken = true; break; } }
    if (!taken) live.push(s);
  }
  // eşit dip/tepe kümeleri: aynı türden, fiyatı %tol içinde olanlar tek havuz (en uç fiyat havuzun seviyesi)
  const pools = [];
  for (const kind of ['L', 'H']) {
    const xs = live.filter(s => s.kind === kind).sort((a, b) => a.price - b.price);
    for (const s of xs) {
      const p = pools.find(q => q.kind === kind && Math.abs(q.price - s.price) / s.price <= tol);
      if (p) { p.touches++; p.price = kind === 'L' ? Math.min(p.price, s.price) : Math.max(p.price, s.price); p.lastI = Math.max(p.lastI, s.i); }
      else pools.push({ kind, price:s.price, touches:1, firstI:s.i, lastI:s.i });
    }
  }
  return pools;
}
// Girişten sonra fiyatın karşılaşacağı İLK karşı likidite: SHORT için girişin altındaki en yakın alınmamış dip havuzu, LONG için
// üstteki en yakın tepe havuzu. minDist: girişe bu kadar yakın havuzlar (gürültü) sayılmaz.
function nextLiquidity(c, idx, side, entry, opt = {}) {
  const minDist = opt.minDist ?? 0.002;
  const pools = liquidityPools(c, idx, opt).filter(p => side === 'SHORT' ? p.kind === 'L' && p.price < entry * (1 - minDist) : p.kind === 'H' && p.price > entry * (1 + minDist));
  pools.sort((a, b) => side === 'SHORT' ? b.price - a.price : a.price - b.price);
  return pools[0] || null;
}
// Hedef: likidite havuzunun hemen ÖNÜ (fiyat havuza varmadan dolsun): SHORT için havuzun %front üstü, LONG için altı.
function targetBeforePool(pool, side, front = 0.001) {
  if (!pool) return null;
  return side === 'SHORT' ? pool.price * (1 + front) : pool.price * (1 - front);
}
// Aralık: son lookback mumun en yükseği/en düşüğü (fitil dahil); EQ = orta; pos = fiyatın aralıktaki yeri (0 dip, 1 tepe).
function dealingRange(c, idx, lookback = 96, price = null) {
  const from = Math.max(0, idx - lookback + 1); let hi = -Infinity, lo = Infinity;
  for (let k = from; k <= idx; k++) { if (c[k].high > hi) hi = c[k].high; if (c[k].low < lo) lo = c[k].low; }
  const p = price ?? c[idx].close, w = hi - lo;
  return { high:hi, low:lo, eq:(hi + lo) / 2, pos:w > 0 ? (p - lo) / w : 0.5, bars:idx - from + 1 };
}
// Yer kuralı (PDF "uçlardan gir", EQ): SHORT pahalı yarıda (pos >= minPos), LONG ucuz yarıda (pos <= 1 - minPos).
function locationOk(c, idx, side, price, { lookback = 96, minPos = 0.5 } = {}) {
  const r = dealingRange(c, idx, lookback, price);
  return { ok:side === 'SHORT' ? r.pos >= minPos : r.pos <= 1 - minPos, range:r };
}
// SFP / süpürme: [idx-within, idx] içinde bir mum, o anda bilinen bir salınım ucunun ötesine FİTİL attı ve geri içeri KAPANDI.
// side='SHORT' -> tepe süpürmesi (satıcı kurulumu), 'LONG' -> dip süpürmesi.
function sweeps(c, idx, side, { n = 3, within = 24, lookback = 288 } = {}) {
  const out = [], from = Math.max(0, idx - lookback);
  const sw = swings(c.slice(from, idx + 1), n).map(s => ({ ...s, i:s.i + from, confirmedAt:s.confirmedAt + from })).filter(s => s.kind === (side === 'SHORT' ? 'H' : 'L'));
  for (let k = Math.max(0, idx - within + 1); k <= idx; k++) {
    for (const s of sw) {
      if (s.confirmedAt >= k) continue;                                            // the swing must be known before the sweep candle
      let alive = true; for (let j = s.i + 1; j < k; j++) if (side === 'SHORT' ? c[j].high > s.price : c[j].low < s.price) { alive = false; break; }
      if (!alive) continue;
      const x = c[k];
      if (side === 'SHORT' ? (x.high > s.price && x.close < s.price) : (x.low < s.price && x.close > s.price)) out.push({ at:k, swingI:s.i, level:s.price, extreme:side === 'SHORT' ? x.high : x.low });
    }
  }
  return out;
}
// JEV / Office özeti (tek kaynak): o anda bilinen süpürmeler (her iki yön, son `within` mum), fiyatın üstündeki ve altındaki en yakın
// alınmamış likidite havuzu (eşit tepe/dip sayısıyla) ve aralıktaki yer. Sayılar 7 haneye yuvarlanır.
function context(c, idx, price = null, { n = 3, lookback = 96, within = 24, tol = 0.0015 } = {}) {
  const p = price ?? c[idx].close, sig = v => v === null || v === undefined ? null : Number(Number(v).toPrecision(7));
  const t = k => num(c[k]?.closeTime) ?? (num(c[k]?.openTime));   // close time when known (Binance klines); else the candle's open time
  const sw = side => sweeps(c, idx, side, { n, within, lookback }).slice(-2).map(x => ({ at:t(x.at), level:sig(x.level), wick:sig(x.extreme), barsAgo:idx - x.at }));
  const pools = liquidityPools(c, idx, { n, lookback, tol });
  const near = kind => { const xs = pools.filter(q => kind === 'H' ? q.kind === 'H' && q.price > p : q.kind === 'L' && q.price < p).sort((a, b) => kind === 'H' ? a.price - b.price : b.price - a.price);
    return xs.slice(0, 2).map(q => ({ price:sig(q.price), touches:q.touches, distPct:Number(((q.price / p - 1) * 100).toFixed(2)) })); };
  const r = dealingRange(c, idx, lookback, p);
  return { version:VERSION, swingN:n, lookbackBars:lookback, sweepsOfHighs:sw('SHORT'), sweepsOfLows:sw('LONG'), liquidityAbove:near('H'), liquidityBelow:near('L'),
    range:{ high:sig(r.high), low:sig(r.low), eq:sig(r.eq), posPct:Math.round(r.pos * 100) } };
}
// klines rows [t,o,h,l,c,...] or objects -> candle objects
function toCandles(rows, frameMs = null) {
  // closeTime kept when present (Binance kline index 6): event times (sweeps) are the CLOSE of the candle - when they became known
  return (Array.isArray(rows) ? rows : []).map(r => Array.isArray(r) ? { openTime:num(r[0]), open:num(r[1]), high:num(r[2]), low:num(r[3]), close:num(r[4]), closeTime:r.length > 6 ? num(r[6]) : frameMs ? num(r[0]) + frameMs - 1 : null }
    : { openTime:num(r.openTime), open:num(r.open), high:num(r.high), low:num(r.low), close:num(r.close), closeTime:num(r.closeTime) });
}
module.exports = { VERSION, swings, liquidityPools, nextLiquidity, targetBeforePool, dealingRange, locationOk, sweeps, context, toCandles };
