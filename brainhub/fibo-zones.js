'use strict';
// R2544.63 FiboBuLL bölge çizimi (kullanıcı 20.10: "grafikte insan gözü hassasiyeti"). Yalnız KAPANMIŞ mumlar; emir/karar üretmez.
// Dip/tepe = nedensel ATR ZigZag (TradingView ZigZag mantığı, sapma eşiği % yerine k x ATR(14)): bacak yukarıyken en yüksek nokta
// izlenir, fiyat ondan k x ATR aşağı dönünce o nokta TEPE olarak onaylanır (dip aynası). Dip/tepe sırayla gelir, gürültü elenir.
// Bölge (videodaki tarif): kapanış son onaylı tepeyi yukarı kırınca ALT = o tepeden kırılıma kadarki en düşük dip, ÜST = kırılan
// tepe (LONG); dip kırılımı aynası (SHORT). DENGE = bölge ortası (premium/discount sınırı), OTE = kırılım bacağının .618-.786
// geri çekilmesi. Durum, laboratuvar testiyle aynı kuralla izlenir: denge limitine dokunuş = DOLDU (aynı mumda önce stop), bölge
// dışında kapanış = KIRILDI, 48 mum = SÜRE DOLDU; stop bölge dışı %0,1, hedef kırılım sonrası uç (likidite), hedef < 1R = ATLA.
const DEFAULTS = { k:1.5, atrLen:14, window:48, hold:96 };

function atrSeries(candles, n = 14) {
  const out = []; let v = null;
  for (let i = 0; i < candles.length; i++) {
    const h = Number(candles[i].high), l = Number(candles[i].low), pc = Number(candles[i > 0 ? i - 1 : 0].close);
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    v = v === null ? tr : v + (tr - v) / n; out.push(v);
  }
  return out;
}

function zigzag(candles, k = DEFAULTS.k, atrLen = DEFAULTS.atrLen) {
  const h = candles.map(x => Number(x.high)), l = candles.map(x => Number(x.low)), a = atrSeries(candles, atrLen);
  const piv = []; let d = 0, ei = 0, ev = null, minI = 0, maxI = 0;
  for (let i = 1; i < candles.length; i++) {
    if (d === 0) {
      if (l[i] < l[minI]) minI = i;
      if (h[i] > h[maxI]) maxI = i;
      if (h[i] - l[minI] > k * a[i] && minI < i) { piv.push({ confirmIndex:i, index:minI, kind:'L', price:l[minI] }); d = 1; ei = i; ev = h[i]; }
      else if (h[maxI] - l[i] > k * a[i] && maxI < i) { piv.push({ confirmIndex:i, index:maxI, kind:'H', price:h[maxI] }); d = -1; ei = i; ev = l[i]; }
      continue;
    }
    if (d === 1) {
      if (h[i] >= ev) { ei = i; ev = h[i]; }
      else if (ev - l[i] > k * a[i]) { piv.push({ confirmIndex:i, index:ei, kind:'H', price:ev }); d = -1; ei = i; ev = l[i]; }
    } else {
      if (l[i] <= ev) { ei = i; ev = l[i]; }
      else if (h[i] - ev > k * a[i]) { piv.push({ confirmIndex:i, index:ei, kind:'L', price:ev }); d = 1; ei = i; ev = h[i]; }
    }
  }
  return piv;
}

function trackZone(z, candles, opt) {
  const o = i => Number(candles[i].open), h = i => Number(candles[i].high), l = i => Number(candles[i].low), c = i => Number(candles[i].close);
  const n = candles.length, long = z.side === 'LONG', eq = z.equilibrium;
  let ext = long ? h(z.index) : l(z.index), fill = null, entry = null;
  for (let m = z.index + 1; m < Math.min(n, z.index + 1 + opt.window); m++) {
    if (long ? l(m) <= eq : h(m) >= eq) { fill = m; entry = long ? Math.min(o(m), eq) : Math.max(o(m), eq); break; }
    if (long ? c(m) < z.bottom : c(m) > z.top) return { ...z, liquidity:ext, state:'BROKEN', endIndex:m };
    ext = long ? Math.max(ext, h(m)) : Math.min(ext, l(m));
  }
  if (fill === null) return { ...z, liquidity:ext, state:z.index + opt.window < n - 1 ? 'EXPIRED' : 'WAITING', endIndex:Math.min(n - 1, z.index + opt.window) };
  const stop = long ? z.bottom * 0.999 : z.top * 1.001, risk = long ? (entry - stop) / entry : (stop - entry) / entry;
  const rr = risk > 0 ? (long ? (ext / entry - 1) : (1 - ext / entry)) / risk : 0;
  const base = { ...z, liquidity:ext, fillIndex:fill, entry, stop, target:ext, rr };
  if (!(risk >= 0.002 && risk <= 0.08) || rr < 1) return { ...base, state:'SKIP', endIndex:fill };
  for (let m = fill; m < Math.min(n, fill + opt.hold); m++) {
    if (long ? l(m) <= stop : h(m) >= stop) return { ...base, state:'STOPPED', endIndex:m };
    if (m > fill && (long ? h(m) >= ext : l(m) <= ext)) return { ...base, state:'TARGET', endIndex:m };
  }
  return { ...base, state:fill + opt.hold <= n - 1 ? 'TIMEOUT' : 'OPEN', endIndex:Math.min(n - 1, fill + opt.hold) };
}

function fiboZones(allCandles, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const candles = (Array.isArray(allCandles) ? allCandles : []).filter(x => x && x.forming !== true);
  if (candles.length < opt.atrLen + 4) return { pivots:[], zones:[], closedBars:candles.length };
  const h = candles.map(x => Number(x.high)), l = candles.map(x => Number(x.low)), c = candles.map(x => Number(x.close));
  const piv = zigzag(candles, opt.k, opt.atrLen), zones = [];
  let p = 0, lastH = null, lastL = null;
  for (let i = 1; i < candles.length; i++) {
    while (p < piv.length && piv[p].confirmIndex <= i) { if (piv[p].kind === 'H') lastH = piv[p]; else lastL = piv[p]; p++; }
    if (lastH && c[i] > lastH.price && lastH.price >= c[i - 1]) {
      let lo = lastH.index; for (let j = lastH.index; j <= i; j++) if (l[j] < l[lo]) lo = j;
      zones.push({ index:i, side:'LONG', top:lastH.price, bottom:l[lo], originIndex:Math.min(lastH.index, lo) }); lastH = null;
    } else if (lastL && c[i] < lastL.price && lastL.price <= c[i - 1]) {
      let hi = lastL.index; for (let j = lastL.index; j <= i; j++) if (h[j] > h[hi]) hi = j;
      zones.push({ index:i, side:'SHORT', top:h[hi], bottom:lastL.price, originIndex:Math.min(lastL.index, hi) }); lastL = null;
    }
  }
  const tracked = zones.filter(z => z.top > z.bottom).map(z => {
    const w = z.top - z.bottom, ext = z.side === 'LONG' ? h[z.index] : l[z.index];
    return trackZone({ ...z, equilibrium:(z.top + z.bottom) / 2,
      ote: z.side === 'LONG' ? { from:ext - 0.786 * (ext - z.bottom), to:ext - 0.618 * (ext - z.bottom) }
                             : { from:ext + 0.618 * (z.top - ext), to:ext + 0.786 * (z.top - ext) }, width:w }, candles, opt);
  });
  const t = i => Number(candles[i]?.closeTime);
  return {
    k:opt.k, closedBars:candles.length,
    pivots:piv.map(x => ({ ...x, at:t(x.index) })),
    zones:tracked.map(z => ({ ...z, at:t(z.index), originAt:t(z.originIndex), endAt:t(z.endIndex) }))
  };
}

module.exports = { DEFAULTS, atrSeries, zigzag, fiboZones };
