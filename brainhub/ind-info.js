'use strict';
// R2544.79 (kullanıcı 26.10: "önerilerini yap"): kullanıcının paylaştığı 4 BigBeluga indikatörünün (CC BY-NC-SA 4.0, kişisel kullanım)
// fikirleri, bir girişin SON KAPANMIŞ mumunda, YALNIZ BİLGİ olarak (kural değil; hiçbir girişi engellemez/açmaz):
//   VDPM  Volume Delta Pivot Matrix: pivot 5/5, 11 mumluk ağırlıklı hacim deltası, kırılmamış seviyeler, en yeni 10, >= %20
//         -> giriş ile 2R arasında karşı seviye var mı (6 ay ölçüm: ZİRVE-5 yok +0,17R / var -0,27R; İlk 3 ERKEN LONG +0,08 / -0,23;
//            ama canlı kuralın 1 ayında ters: var +0,91R -> kural yapılmadı, beyin kendi sonuçlarıyla öğrenecek)
//   VWOB  Volume-Weighted Order Block: pivot 10/10 + 4xATR(100) itme, OB bölgeleri, B/S geri test etiketi, 2R öncesi karşı OB
//   LTH   Liquidity Trend Heatmap: EMA(SMA(kapanış,50),50) ± ATR(100) trendi; 500 mum (eldeki kadar) hacim profili POC'u
//   LRVP  HTF Log-Regression VP: oturum (15 dk grafik 2 gün, 5 dk grafik 12 sa) log-regresyon eğimi ve alış/satış deltası
// Hacim: Pine `volume` baz coin hacmidir -> kote hacim / ortalama fiyat. Ölçüm kodu: Claud-Work/gelistirme/harness/indikator.
const IND_VERSION = 'R2544.79-IND-INFO';
const finite = v => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };
// candles: [{openTime, open, high, low, close, quoteVolume}] or kline arrays [t, o, h, l, c, quoteVolume]
function norm(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = Array.isArray(r) ? { openTime:+r[0], open:+r[1], high:+r[2], low:+r[3], close:+r[4], quoteVolume:+r[5] } : { openTime:+r.openTime, open:+r.open, high:+r.high, low:+r.low, close:+r.close, quoteVolume:+r.quoteVolume };
    if (![x.openTime, x.open, x.high, x.low, x.close].every(Number.isFinite) || !(x.high >= x.low)) continue;
    x.vol = Number.isFinite(x.quoteVolume) && x.quoteVolume > 0 ? x.quoteVolume / Math.max(1e-12, (x.high + x.low) / 2) : 0;
    if (!out.length || x.openTime > out[out.length - 1].openTime) out.push(x);
  }
  return out;
}
const sma = (a, n) => { const o = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const ema = (a, n) => { const o = new Array(a.length).fill(NaN), k = 2 / (n + 1); let v = NaN; for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i])) continue; v = Number.isFinite(v) ? a[i] * k + v * (1 - k) : a[i]; o[i] = v; } return o; };
function atrRma(c, n) { const o = new Array(c.length).fill(NaN); let v = NaN, s = 0;
  for (let i = 0; i < c.length; i++) { const tr = i ? Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)) : c[i].high - c[i].low;
    if (i < n) { s += tr; if (i === n - 1) { v = s / n; o[i] = v; } } else { v = (v * (n - 1) + tr) / n; o[i] = v; } } return o; }
const isPH = (c, p, L, R) => { for (let j = p - L; j <= p + R; j++) if (j !== p && (j < 0 || j >= c.length || c[j].high > c[p].high || (j < p && c[j].high === c[p].high))) return false; return true; };
const isPL = (c, p, L, R) => { for (let j = p - L; j <= p + R; j++) if (j !== p && (j < 0 || j >= c.length || c[j].low < c[p].low || (j < p && c[j].low === c[p].low))) return false; return true; };

function vdpmLevels(c, q, P = 5) {
  const lv = [];
  for (let p = P; p + P <= q; p++) {
    const ph = isPH(c, p, P, P), pl = isPL(c, p, P, P); if (!ph && !pl) continue;
    const cf = p + P; let dl = 0;
    for (let i = cf; i >= Math.max(0, cf - 2 * P); i--) { const r = c[i].high - c[i].low; dl += r > 0 ? c[i].vol * (((c[i].close - c[i].low) / r) * 2 - 1) : (c[i].close >= c[i].open ? c[i].vol : -c[i].vol); }
    for (const supp of [pl ? true : null, ph ? false : null].filter(x => x !== null)) {
      const lvl = supp ? c[p].low : c[p].high; let broken = false;
      for (let i = cf; i <= q; i++) if (supp ? c[i].close <= lvl : c[i].close >= lvl) { broken = true; break; }
      if (!broken) lv.push({ lvl, dl, supp, cf });
    }
  }
  const act = lv.sort((a, b) => a.cf - b.cf).slice(-10), mx = Math.max(1e-12, ...act.map(l => Math.abs(l.dl)));
  return act.map(l => ({ ...l, pct:Math.abs(l.dl) / mx * 100 })).filter(l => l.pct >= 20);
}
function vwob(c, atr, q) {
  let obs = [], bull = { lvl:NaN, trig:true }, bear = { lvl:NaN, trig:true }, lastB = -99, lastS = -99; const bSig = [], sSig = [];
  const add = (top, bot, isBull) => { obs = obs.filter(o => !(o.bull === isBull && top >= o.bot && bot <= o.top)); obs.push({ top, bot, bull:isBull }); if (obs.length > 10) obs.shift(); };
  for (let i = 0; i <= q; i++) {
    const a = atr[i], p = i - 10;
    if (p >= 10 && Number.isFinite(a)) {
      let hh = -Infinity, ll = Infinity; for (let j = i - 9; j <= i; j++) { hh = Math.max(hh, c[j].high); ll = Math.min(ll, c[j].low); }
      if (isPL(c, p, 10, 10)) { const top = c[p].high, bot = c[p].low, lvl = bot + 4 * a; bull = { top, bot, lvl, trig:hh >= lvl };
        if (bull.trig) { let off = 0; for (let o = 9; o >= 0; o--) if (c[i - o].close >= lvl || c[i - o].high >= lvl) { off = o; break; } let mit = false; for (let o = off; o >= 0; o--) if (c[i - o].low < bot) { mit = true; break; } if (!mit) add(top, bot, true); } }
      if (isPH(c, p, 10, 10)) { const top = c[p].high, bot = c[p].low, lvl = top - 4 * a; bear = { top, bot, lvl, trig:ll <= lvl };
        if (bear.trig) { let off = 0; for (let o = 9; o >= 0; o--) if (c[i - o].close <= lvl || c[i - o].low <= lvl) { off = o; break; } let mit = false; for (let o = off; o >= 0; o--) if (c[i - o].high > top) { mit = true; break; } if (!mit) add(top, bot, false); } }
    }
    obs = obs.filter(o => !(o.bull ? c[i].low < o.bot : c[i].high > o.top));
    if (i > 0) for (const o of obs) {
      if (o.bull && ((c[i - 1].low <= o.top && c[i].low > o.top) || (c[i - 1].close <= o.top && c[i].close > o.top)) && i - lastB > 5) { bSig[i] = 1; lastB = i; }
      if (!o.bull && ((c[i - 1].high >= o.bot && c[i].high < o.bot) || (c[i - 1].close >= o.bot && c[i].close < o.bot)) && i - lastS > 5) { sSig[i] = 1; lastS = i; }
    }
    if (i > 0 && !bull.trig && Number.isFinite(bull.lvl) && c[i].close > bull.lvl && c[i - 1].close <= bull.lvl) { bull.trig = true; add(bull.top, bull.bot, true); }
    if (i > 0 && !bear.trig && Number.isFinite(bear.lvl) && c[i].close < bear.lvl && c[i - 1].close >= bear.lvl) { bear.trig = true; add(bear.top, bear.bot, false); }
  }
  return { obs, bSig, sSig };
}
// side LONG|SHORT, entry price, stop price; session ms (15 dk: 2 gün, 5 dk: 12 sa)
function infoAt(rows, side, entry, stop, { session = 2 * 86400000 } = {}) {
  const c = norm(rows), q = c.length - 1, L = side === 'LONG', e = finite(entry), st = finite(stop);
  const base = { version:IND_VERSION, informationOnly:true, bars:c.length };
  if (q < 40 || e === null || st === null || !(L ? st < e : st > e)) return { ...base, ok:false, reason:'IND_INPUT' };
  const risk = Math.abs(e - st), R2 = L ? e + 2 * risk : e - 2 * risk, rr = x => Number(x.toFixed(2));
  const out = { ...base, ok:true };
  // VDPM
  const lv = vdpmLevels(c, q), opp = lv.filter(l => L ? (!l.supp && l.lvl > e) : (l.supp && l.lvl < e));
  const near = opp.length ? Math.min(...opp.map(l => Math.abs(l.lvl - e) / risk)) : null;
  out.vdpm = { obstacle2R:near !== null && near <= 2, strongObstacle2R:opp.some(l => l.pct >= 50 && Math.abs(l.lvl - e) / risk <= 2), nearestR:near === null ? null : rr(near),
    backing:lv.some(l => l.pct >= 50 && (L ? l.supp && l.lvl < e && l.lvl > st : !l.supp && l.lvl > e && l.lvl < st)), levels:lv.length };
  // VWOB
  const atr = atrRma(c, 100), w = vwob(c, atr, q);
  let rt = false; for (let j = Math.max(0, q - 3); j <= q; j++) if (L ? w.bSig[j] : w.sSig[j]) rt = true;
  out.vwob = { retest:rt, oppIn2R:w.obs.some(o => L ? (!o.bull && o.bot > e && o.bot < R2) : (o.bull && o.top < e && o.top > R2)),
    behind:w.obs.some(o => L ? (o.bull && o.top <= e && o.top >= st) : (!o.bull && o.bot >= e && o.bot <= st)), active:w.obs.length };
  // LTH
  const a = atr[q], mid = ema(sma(c.map(x => x.close), 50), 50)[q];
  if (Number.isFinite(a) && Number.isFinite(mid)) {
    const s = c[q].close > mid + a ? 'UP' : c[q].close < mid - a ? 'DOWN' : 'FLAT';
    const lb = Math.min(500, q); let up = -Infinity, lo = Infinity;
    for (let j = q - lb + 1; j <= q; j++) { const aj = Number.isFinite(atr[j]) ? atr[j] : a; up = Math.max(up, c[j].high + aj); lo = Math.min(lo, c[j].low - aj); }
    const step = Math.max(up - lo, 1e-12) / 26, bins = new Array(26).fill(0);
    for (let k = 0; k < 26; k++) { const lvp = lo + step * k; for (let j = Math.max(0, q - lb); j <= q; j++) if (Math.abs((c[j].high + c[j].low) / 2 - lvp) <= step / 2) bins[k] += c[j].vol; }
    let pk = 0; for (let k = 1; k < 26; k++) if (bins[k] > bins[pk]) pk = k; const poc = lo + step * pk;
    out.lth = { trend:s === 'FLAT' ? 'FLAT' : (L ? s === 'UP' : s === 'DOWN') ? 'WITH' : 'AGAINST', poc:Number(poc.toPrecision(8)), pocInPath2R:L ? poc > e && poc < R2 : poc < e && poc > R2, lookbackBars:lb + 1 };
  } else out.lth = null;
  // LRVP
  const t0 = Math.floor(c[q].openTime / session) * session; let s0 = q; while (s0 > 0 && c[s0 - 1].openTime >= t0) s0--;
  const len = q - s0 + 1;
  if (len >= 8) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < len; i++) { const v = Math.log(c[q - i].close), x = i + 1; sx += x; sy += v; sxx += x * x; sxy += v * x; }
    const slope = (len * sxy - sx * sy) / (len * sxx - sx * sx), icpt = (sy - slope * sx) / len, rising = Math.exp(icpt) > Math.exp(icpt + slope * len);
    let b = 0, sl = 0; for (let i = s0; i <= q; i++) { if (c[i].close > c[i].open) b += c[i].vol; else if (c[i].close < c[i].open) sl += c[i].vol; }
    const dp = b + sl > 0 ? (b - sl) / (b + sl) : 0;
    out.lrvp = { trendWith:L ? rising : !rising, deltaWith:L ? dp > 0 : dp < 0, deltaPct:rr(dp * 100), sessionBars:len };
  } else out.lrvp = null;
  return out;
}
// short Turkish line for Office / lessons
function infoText(x) {
  if (!x || x.ok !== true) return 'indikatör bilgisi yok';
  const p = [];
  p.push(x.vdpm.obstacle2R ? `2R öncesi karşı hacim seviyesi VAR (${String(x.vdpm.nearestR).replace('.', ',')}R)` : '2R öncesi karşı hacim seviyesi yok');
  if (x.vwob.oppIn2R) p.push('2R öncesi karşı order block');
  if (x.lth) p.push('trend ' + (x.lth.trend === 'WITH' ? 'yönde' : x.lth.trend === 'AGAINST' ? 'TERS' : 'yatay'));
  if (x.lrvp) p.push('oturum ' + (x.lrvp.trendWith ? 'yönde' : 'ters') + ' / delta ' + (x.lrvp.deltaWith ? 'yönde' : 'ters'));
  return p.join(' • ');
}
module.exports = { IND_VERSION, infoAt, infoText, norm };
