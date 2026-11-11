'use strict';
// R2544.149 İZ (kullanıcı 12.11: "binance botları ve market makerın izlerini takip et"). Piyasa yapıcının ve botların herkese açık
// veride bıraktığı izler: stop avı (süpürme), toplu tasfiye, açık pozisyon (OI) değişimi, büyük hesapların ve kalabalığın long/short
// oranı, agresif alım/satım akışı, emir defteri yığılması, fonlama. Bu dosya izleri OKUR; her iz kuralı bir "iz askeri" gibi kendi
// tahminini yazar ve KEŞİF karnesinde modellerle ve beyinle AYNI kuralla ileriye dönük puanlanır.
// ÖN-KAYIT: eşikler aşağıda sabittir ve sonuç görülmeden önce yazıldı (12.11). Geçmiş veriyle sınama YOK; karne canlıdan dolar.
// Kanıt değildir: aynı izleri başka botlar da izler. Büyük hesap oranı (Binance "top trader") piyasa yapıcıyı tanımlamaz.
// GÖLGE: hiçbir işlem açmaz, engellemez, emir/marj/kaldıraç değiştirmez.
const IZ_VERSION = 'R2544.149-IZ';
const TB = require('./trader-brain');
const M5 = 300000, M15 = 900000, HOUR = 3600000;
const STOP_MIN = 1.2, STOP_MAX = 8, HORIZON_H = 6, TARGET_X = 2;
const finite = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 3) => v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d));
const pct = (a, b) => a > 0 && b > 0 ? (b / a - 1) * 100 : null;
const med = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };

// ÖN-KAYIT eşikleri (değiştirmek = yeni sürüm + yeni karne)
const T = {
  sweep:{ refBars:24, lookBars:3, bufferPct:0.15, minDepthPct:0.1 },                  // 15m: önceki 6 saatin dibi/tepesi son 3 mumda en az %0,1 aşılıp geri kapanış
  tasfiye:{ minQuote:50000, dominance:3, priceMovePct:2, oiDropPct:2 },               // 1 sa: bir taraf ≥3 kat ve ≥50 bin $ tasfiye, fiyat ≥%2, OI ≥%2 boşaldı
  balina:{ whaleChgPct:5, crowdChgPct:2 },                                             // 1 sa: büyük hesaplar ≥%5 bir yöne, kalabalık ≥%2 ters
  kalabalik:{ fundingPct:0.05, crowdLong:2, crowdShort:1, stallPct:0.3 },              // fonlama ≥%0,05 + kalabalık long ≥2 + fiyat durdu (aynası)
  akis:{ priceMovePct:1.5, oiRisePct:3, takerLong:1.15, takerShort:0.87 },             // 1 sa: fiyat ≥%1,5 + OI ≥%3 + agresif akış aynı yönde
  duvar:{ imbalance:0.4, withinPct:2 }                                                 // defter: %2 içinde dengesizlik ≥0,4 + akış destekliyor
};

function series(rows, key) {
  return (Array.isArray(rows) ? rows : []).map(x => ({ t:finite(x?.timestamp), v:finite(x?.[key]) })).filter(x => x.t !== null && x.v !== null).sort((a, b) => a.t - b.t);
}
function changeOver(s, ms) {
  if (s.length < 2) return null; const last = s[s.length - 1];
  const ref = [...s].reverse().find(x => x.t <= last.t - ms + 1000); return ref ? pct(ref.v, last.v) : null;
}
// emir defteri: fiyatın %1 ve %3 içinde alış-satış dengesizliği, en büyük duvarlar (seviye notional / medyan seviye)
function book(depth, px) {
  const side = a => (Array.isArray(a) ? a : []).map(x => [finite(x?.[0]), finite(x?.[1])]).filter(x => x[0] > 0 && x[1] > 0).map(([p, q]) => ({ p, n:p * q, d:Math.abs(p / px - 1) * 100 }));
  const b = side(depth?.bids), a = side(depth?.asks); if (!b.length || !a.length || !(px > 0)) return null;
  const cover = Math.min(b[b.length - 1].d, a[a.length - 1].d);  // how far the fetched book reaches: a window it does not cover is not measured
  const imb = w => { if (cover < w) return null; const bn = b.filter(x => x.d <= w).reduce((s, x) => s + x.n, 0), an = a.filter(x => x.d <= w).reduce((s, x) => s + x.n, 0); return bn + an > 0 ? round((bn - an) / (bn + an), 3) : null; };
  const m = med([...b, ...a].filter(x => x.d <= 3).map(x => x.n)) || null;
  const wall = l => { const w = l.filter(x => x.d <= 3).sort((p, q) => q.n - p.n)[0]; return w && m ? { distPct:round(w.d, 2), xMedian:round(w.n / m, 1), usd:Math.round(w.n) } : null; };
  return { imb1:imb(1), imb2:imb(T.duvar.withinPct), imb3:imb(3), bidWall:wall(b), askWall:wall(a), depthPct:round(cover, 2) };
}
// stop avı: 15m kapanmış mumlar; son 3 mum önceki 6 saatin dibini (tepesini) aldı ve son kapanış geri içeride
function sweep(m15, now) {
  const k = TB.rows(m15).filter(x => x.t + M15 <= now); const R = T.sweep.refBars, L = T.sweep.lookBars;
  if (k.length < R + L) return null;
  const ref = k.slice(-(R + L), -L), last = k.slice(-L), c = k[k.length - 1].c;
  const hi = Math.max(...ref.map(x => x.h)), lo = Math.min(...ref.map(x => x.l)), minL = Math.min(...last.map(x => x.l)), maxH = Math.max(...last.map(x => x.h));
  const md = T.sweep.minDepthPct / 100, low = minL < lo * (1 - md) && c > lo, high = maxH > hi * (1 + md) && c < hi;  // a 0,03 % poke is noise, not a hunt
  if (low === high) return null;                                                        // ikisi birden ya da hiçbiri: okunur bir av yok
  return low ? { side:'LOW', level:lo, extreme:minL, depthPct:round((lo - minL) / lo * 100, 2) } : { side:'HIGH', level:hi, extreme:maxH, depthPct:round((maxH - hi) / hi * 100, 2) };
}
// bir coinin iz okuması (hepsi herkese açık Binance verisi). liq = { longQ, shortQ } son 1 saatin gözlenen tasfiyeleri (yoksa null)
function read({ m5, m15, h1, oi, whale, crowd, taker, depth, fundingRate = null, liq = null, now = Date.now() } = {}) {
  const k5 = TB.rows(m5).filter(x => x.t + M5 <= now); if (k5.length < 13) return null;
  const px = k5[k5.length - 1].c, at = (n) => k5.length > n ? k5[k5.length - 1 - n].c : null;
  const k1 = TB.rows(h1).filter(x => x.t + HOUR <= now), st = k1.length >= 12 ? TB.structure(k1) : null, atr = finite(st?.atrPct);
  const band = round(Math.max(STOP_MIN, Math.min(STOP_MAX, atr > 0 ? 1.5 * atr : 2)), 2);
  const oiS = series(oi, 'sumOpenInterest'), whS = series(whale, 'longShortRatio'), crS = series(crowd, 'longShortRatio');
  const tk = (Array.isArray(taker) ? taker : []).map(x => ({ t:finite(x?.timestamp), b:finite(x?.buyVol), s:finite(x?.sellVol) })).filter(x => x.t !== null && x.b !== null && x.s !== null).sort((a, b) => a.t - b.t).slice(-12);
  const tb = tk.reduce((s, x) => s + x.b, 0), ts = tk.reduce((s, x) => s + x.s, 0);
  const q1h = k5.slice(-12).reduce((s, x) => s + x.v * x.c, 0);
  const lq = liq && finite(liq.longQ) !== null && finite(liq.shortQ) !== null ? { longQ:Math.round(liq.longQ), shortQ:Math.round(liq.shortQ) } : null;
  return { v:IZ_VERSION, at:now, price:px, band,
    priceChg1hPct:round(pct(at(12), px), 2), priceChg4hPct:round(pct(at(48), px), 2),
    lastBar:{ up:k5[k5.length - 1].c > k5[k5.length - 1].o, newLow:k5.length > 1 && k5[k5.length - 1].l < k5[k5.length - 2].l, newHigh:k5.length > 1 && k5[k5.length - 1].h > k5[k5.length - 2].h },
    oiChg1hPct:round(changeOver(oiS, HOUR), 2), oiChg4hPct:round(changeOver(oiS, 4 * HOUR), 2),
    whaleLS:round(whS.length ? whS[whS.length - 1].v : null, 3), whaleChg1hPct:round(changeOver(whS, HOUR), 2),
    crowdLS:round(crS.length ? crS[crS.length - 1].v : null, 3), crowdChg1hPct:round(changeOver(crS, HOUR), 2),
    takerRatio1h:tk.length >= 6 && ts > 0 ? round(tb / ts, 3) : null,
    fundingPct:finite(fundingRate) !== null ? round(finite(fundingRate) * 100, 4) : null,
    book:book(depth, px), sweep:sweep(m15, now), liq1h:lq, quote1h:Math.round(q1h) };
}
const fc = (direction, stopPct, reasonTr, wrongIfTr) => {
  const s = round(Math.max(STOP_MIN, Math.min(STOP_MAX, stopPct)), 2);
  return { ok:true, direction, stopPct:s, targetPct:round(s * TARGET_X, 2), horizonH:HORIZON_H, confidence:null, reasonTr:String(reasonTr).slice(0, 240), wrongIfTr:String(wrongIfTr).slice(0, 160) };
};
const f2 = v => v === null || v === undefined ? '?' : (v > 0 ? '+' : '') + v;
// her iz askeri: kendi kuralı, kendi yönü; stop = iz bozulduğu yer (süpürmede iğnenin ucu) ya da 1,5 x 1 sa ATR; hedef = 2 x stop; 6 saat
const DETECTORS = [
  { name:'SUPURME', tr:'Stop avı: 6 saatlik dip/tepe iğneyle alındı, fiyat geri içeri kapandı → ters yön', run:r => {
    const w = r.sweep; if (!w) return null; const L = w.side === 'LOW';
    const stop = (L ? (r.price - w.extreme) / r.price : (w.extreme - r.price) / r.price) * 100 + T.sweep.bufferPct;
    if (!(stop > 0) || stop > STOP_MAX) return null;
    return fc(L ? 'LONG' : 'SHORT', stop, `15 dk: önceki 6 saatin ${L ? 'dibi' : 'tepesi'} %${w.depthPct} iğneyle alındı, fiyat geri içeride (stop avı)`, `iğnenin ucu (%${round(stop, 2)}) geçilirse`); } },
  { name:'TASFIYE', tr:'Toplu tasfiye bitti: bir taraf yandı, OI boşaldı, ilk ters mum → dönüş', run:r => {
    const q = r.liq1h, c = T.tasfiye; if (!q || r.priceChg1hPct === null || r.oiChg1hPct === null) return null;
    if (q.longQ >= c.minQuote && q.longQ >= c.dominance * Math.max(1, q.shortQ) && r.priceChg1hPct <= -c.priceMovePct && r.oiChg1hPct <= -c.oiDropPct && r.lastBar.up && !r.lastBar.newLow)
      return fc('LONG', r.band, `1 sa: ${q.longQ} $ long tasfiye (short ${q.shortQ} $), fiyat %${r.priceChg1hPct}, OI %${r.oiChg1hPct}; ilk yeşil mum`, `fiyat %${r.band} daha düşerse`);
    if (q.shortQ >= c.minQuote && q.shortQ >= c.dominance * Math.max(1, q.longQ) && r.priceChg1hPct >= c.priceMovePct && r.oiChg1hPct <= -c.oiDropPct && !r.lastBar.up && !r.lastBar.newHigh)
      return fc('SHORT', r.band, `1 sa: ${q.shortQ} $ short tasfiye (long ${q.longQ} $), fiyat %${f2(r.priceChg1hPct)}, OI %${r.oiChg1hPct}; ilk kırmızı mum`, `fiyat %${r.band} daha çıkarsa`);
    return null; } },
  { name:'BALINA', tr:'Büyük hesaplar bir yöne eklerken kalabalık tersine → büyüklerle', run:r => {
    const c = T.balina; if (r.whaleChg1hPct === null || r.crowdChg1hPct === null) return null;
    if (r.whaleChg1hPct >= c.whaleChgPct && r.crowdChg1hPct <= -c.crowdChgPct) return fc('LONG', r.band, `1 sa: büyük hesaplar long/short %${f2(r.whaleChg1hPct)}, kalabalık %${r.crowdChg1hPct}`, `fiyat %${r.band} düşerse`);
    if (r.whaleChg1hPct <= -c.whaleChgPct && r.crowdChg1hPct >= c.crowdChgPct) return fc('SHORT', r.band, `1 sa: büyük hesaplar long/short %${r.whaleChg1hPct}, kalabalık %${f2(r.crowdChg1hPct)}`, `fiyat %${r.band} çıkarsa`);
    return null; } },
  { name:'KALABALIK', tr:'Kalabalık tek tarafta + fonlama aşırı + fiyat durdu → kalabalığın tersi', run:r => {
    const c = T.kalabalik; if (r.fundingPct === null || r.crowdLS === null || r.priceChg1hPct === null) return null;
    if (r.fundingPct >= c.fundingPct && r.crowdLS >= c.crowdLong && r.priceChg1hPct <= c.stallPct) return fc('SHORT', r.band, `fonlama %${r.fundingPct}, kalabalık long/short ${r.crowdLS}, fiyat 1 sa %${f2(r.priceChg1hPct)} (durdu)`, `fiyat %${r.band} çıkarsa`);
    if (r.fundingPct <= -c.fundingPct && r.crowdLS <= c.crowdShort && r.priceChg1hPct >= -c.stallPct) return fc('LONG', r.band, `fonlama %${r.fundingPct}, kalabalık long/short ${r.crowdLS}, fiyat 1 sa %${f2(r.priceChg1hPct)} (durdu)`, `fiyat %${r.band} düşerse`);
    return null; } },
  { name:'AKIS', tr:'Fiyat + açık pozisyon + agresif akış aynı yönde → trendle', run:r => {
    const c = T.akis; if (r.priceChg1hPct === null || r.oiChg1hPct === null || r.takerRatio1h === null) return null;
    if (r.priceChg1hPct >= c.priceMovePct && r.oiChg1hPct >= c.oiRisePct && r.takerRatio1h >= c.takerLong) return fc('LONG', r.band, `1 sa: fiyat %${f2(r.priceChg1hPct)}, OI %${f2(r.oiChg1hPct)}, alıcı/satıcı ${r.takerRatio1h} (yeni long para)`, `fiyat %${r.band} düşerse`);
    if (r.priceChg1hPct <= -c.priceMovePct && r.oiChg1hPct >= c.oiRisePct && r.takerRatio1h <= c.takerShort) return fc('SHORT', r.band, `1 sa: fiyat %${r.priceChg1hPct}, OI %${f2(r.oiChg1hPct)}, alıcı/satıcı ${r.takerRatio1h} (yeni short para)`, `fiyat %${r.band} çıkarsa`);
    return null; } },
  { name:'DUVAR', tr:'Emir defteri bir tarafa yığılmış + akış destekliyor → duvar tarafı', run:r => {
    const c = T.duvar, i = r.book?.imb2; if (i === null || i === undefined || r.takerRatio1h === null) return null;
    if (i >= c.imbalance && r.takerRatio1h >= 1) return fc('LONG', r.band, `defter %${c.withinPct} içinde alış ağır (${i}), alıcı/satıcı ${r.takerRatio1h}`, `fiyat %${r.band} düşerse (duvar sahte çıkabilir)`);
    if (i <= -c.imbalance && r.takerRatio1h <= 1) return fc('SHORT', r.band, `defter %${c.withinPct} içinde satış ağır (${i}), alıcı/satıcı ${r.takerRatio1h}`, `fiyat %${r.band} çıkarsa (duvar sahte çıkabilir)`);
    return null; } }
];
function fire(r) { if (!r) return []; const out = []; for (const d of DETECTORS) { let f = null; try { f = d.run(r); } catch { f = null; } if (f && f.ok) out.push({ name:d.name, forecast:f }); } return out; }
const bucket = (v, cuts, names) => { if (!Number.isFinite(v)) return null; for (let i = 0; i < cuts.length; i++) if (v < cuts[i]) return names[i]; return names[cuts.length]; };
// beynin matrisine giden iz formasyonları (beyin hangi izin ardından fiyatın nereye gittiğini canlıdan öğrenir)
function feats(r, fired = null) {
  if (!r) return []; const out = new Set(), add = (a, b) => { if (a && b) out.add(`iz:${a}:${b}`); };
  add('oi1s', bucket(r.oiChg1hPct, [-3, -1, 1, 3], ['SERT_DUSUS', 'DUSUS', 'YATAY', 'ARTIS', 'SERT_ARTIS']));
  if (r.priceChg1hPct !== null && r.oiChg1hPct !== null && Math.abs(r.priceChg1hPct) >= 0.5 && Math.abs(r.oiChg1hPct) >= 1)
    add('fiyat_oi', (r.priceChg1hPct > 0 ? 'FIYAT_UP' : 'FIYAT_DOWN') + '_' + (r.oiChg1hPct > 0 ? 'OI_UP' : 'OI_DOWN'));
  add('balina', bucket(r.whaleChg1hPct, [-5, -2, 2, 5], ['SERT_SAT', 'SAT', 'YATAY', 'AL', 'SERT_AL']));
  add('kalabalik', bucket(r.crowdLS, [0.8, 1.5, 2.5], ['SHORTCU', 'DENGE', 'LONGCU', 'COK_LONGCU']));
  add('akis', bucket(r.takerRatio1h, [0.87, 0.95, 1.05, 1.15], ['SERT_SATIS', 'SATIS', 'DENGE', 'ALIS', 'SERT_ALIS']));
  add('defter', bucket(r.book?.imb2, [-0.4, -0.15, 0.15, 0.4], ['SATIS_AGIR', 'SATIS', 'DENGE', 'ALIS', 'ALIS_AGIR']));
  if (r.liq1h && r.liq1h.longQ + r.liq1h.shortQ >= 20000) add('tasfiye', r.liq1h.longQ >= 2 * r.liq1h.shortQ ? 'LONG_YANDI' : r.liq1h.shortQ >= 2 * r.liq1h.longQ ? 'SHORT_YANDI' : 'KARISIK');
  if (r.sweep) add('supurme', r.sweep.side);
  for (const f of fired || fire(r)) add('asker', `${f.name}_${f.forecast.direction}`);
  return [...out].sort();
}
// modellerin ekranına giden iz özeti (coin adı ve fiyat yok; yalnız oranlar)
function view(r, fired = null) {
  if (!r) return null; const f = fired || fire(r);
  return { what:'public Binance footprints of bots and market makers (heuristics, not identities)',
    priceChange1hPct:r.priceChg1hPct, priceChange4hPct:r.priceChg4hPct, openInterestChange1hPct:r.oiChg1hPct, openInterestChange4hPct:r.oiChg4hPct,
    bigAccountsLongShort:{ now:r.whaleLS, change1hPct:r.whaleChg1hPct }, crowdLongShort:{ now:r.crowdLS, change1hPct:r.crowdChg1hPct },
    takerBuySell1h:r.takerRatio1h, fundingPct:r.fundingPct, orderBook:r.book ? { imbalanceWithin1Pct:r.book.imb1, imbalanceWithin2Pct:r.book.imb2, imbalanceWithin3Pct:r.book.imb3, biggestBidWall:r.book.bidWall && { distPct:r.book.bidWall.distPct, xMedian:r.book.bidWall.xMedian }, biggestAskWall:r.book.askWall && { distPct:r.book.askWall.distPct, xMedian:r.book.askWall.xMedian } } : null,
    liquidations1hUsd:r.liq1h ? { longsLiquidated:r.liq1h.longQ, shortsLiquidated:r.liq1h.shortQ } : null, stopHunt15m:r.sweep ? { side:r.sweep.side === 'LOW' ? 'LOWS_SWEPT' : 'HIGHS_SWEPT', wickBeyondPct:r.sweep.depthPct } : null,
    traceRulesFiring:f.map(x => `${x.name} ${x.forecast.direction}`) };
}
module.exports = { IZ_VERSION, THRESHOLDS:T, STOP_MIN, STOP_MAX, HORIZON_H, TARGET_X, DETECTORS:DETECTORS.map(d => ({ name:d.name, tr:d.tr })), read, fire, feats, view, book, sweep };
