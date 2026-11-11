'use strict';
// R2544.148 KEŞİF (kullanıcı 11.11: "modellerin bir sonraki hamleyi bilmesi ... sen temeli doğru at, sonra arkandaki orduya nereye
// saldıracağını öğret ... sadece lider yok"; "geçmiş verilere bakma, biz geleceğe bakacağız"; "tek düze bir fikre saplanıyorsun").
// Until now the models only voted TAKE / SKIP on a plan a fixed rule had already made. Here NOBODY hands them a setup: every model reads
// the same screen and writes its OWN forecast of the next move (direction, where it is wrong, where price goes first, by when).
// The forecast is written BEFORE the outcome; the code then follows the real 5m candles and scores it (target first / stop first / horizon).
// The karne (scorecard) per model is the "leader": it shows who really sees the next move, forward in time, with no historical data.
// GÖLGE: this module never opens, blocks or changes a trade. Giving a proven forecaster the word on real lots is a later, user-approved step.
const KESIF_VERSION = 'R2544.148-KESIF';
const TB = require('./trader-brain');
const M5 = 300000, HOUR = 3600000;
const STOP_MIN = 1.2, STOP_MAX = 8;        // % - the same band the lanes use (leverage >= 10x: the stop sits before the liquidation)
const HORIZON_MIN = 1, HORIZON_MAX = 24;   // hours
const COST_PCT = 0.14;                     // round-trip commission + slippage, % of notional (the same cost the lanes are measured with)
const MIN_SAY = 8, MIN_WORD = 20;          // kullanıcı kuralı: en az 8 gerçek sonuç olmadan kimse aday değil; söz için 20
const finite = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 3) => v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d));
const med = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };

// The screen: five timeframes of CLOSED candles with the code-computed structure and chart reading, the day / week / month levels as a
// distance in % from the price now, the coin's own context and BTC. Price now = 100; the coin name and the date are hidden.
function packet({ k, t, context = null } = {}) {
  const m5 = TB.rows(k?.m5).filter(x => x.t + M5 <= t); if (m5.length < 12) return null;
  const px = m5[m5.length - 1].c, s = 100 / px, P = x => x === null || x === undefined || !Number.isFinite(x) ? null : +(x * s).toFixed(3);
  const tfs = {};
  for (const [name, cfg] of Object.entries(TB.TF)) {
    const kk = TB.rows(k[name]).filter(x => x.t + cfg.ms <= t); if (kk.length < 12) { tfs[name] = null; continue; }
    const vm = med(kk.slice(-20).map(x => x.v)) || 1;
    let reading = null; try { reading = TB.chartReading(k[name], cfg.frame, { t, P }); } catch {}
    tfs[name] = { structure:TB.structure(kk), chartReading:reading, candles:{ fields:'[open,high,low,close,volVsMedian20,takerBuyShare] price scaled: now = 100', rows:kk.slice(-cfg.n).map(x => [P(x.o), P(x.h), P(x.l), P(x.c), +(x.v / vm).toFixed(2), x.tb !== null && x.v > 0 ? +(x.tb / x.v).toFixed(2) : null]) } };
  }
  const lv = TB.htfLevels(TB.rows(k.d1), t), h24 = TB.rows(k.h1).filter(x => x.t + HOUR <= t).slice(-24);
  const level = (name, v) => v ? { name, price:P(v), distPct:round((v / px - 1) * 100, 2) } : null;
  const levels = [level('prevDayHigh', lv.prevDay?.high), level('prevDayLow', lv.prevDay?.low), level('prevWeekHigh', lv.prevWeek?.high), level('prevWeekLow', lv.prevWeek?.low),
    level('prevMonthHigh', lv.prevMonth?.high), level('prevMonthLow', lv.prevMonth?.low), level('high24h', h24.length ? Math.max(...h24.map(x => x.h)) : null), level('low24h', h24.length ? Math.min(...h24.map(x => x.l)) : null)].filter(Boolean);
  const b = TB.rows(k.btc1h).filter(x => x.t + HOUR <= t), bs = b.length >= 12 ? TB.structure(b) : null;
  const c = context || {};
  return { contract:KESIF_VERSION, task:'FORECAST', now:100, timeframes:tfs, levels,
    coin:{ change24hPct:finite(c.change24hPct), fundingPct:finite(c.fund) !== null ? round(finite(c.fund) * 100, 4) : null, premiumPct:finite(c.premium) !== null ? round(finite(c.premium) * 100, 3) : null, why:c.why || null },
    btc:bs ? { trend1h:bs.trend, change12hPct:bs.change12Pct, closeVsEma20Pct:bs.closeVsEma20 } : null,
    rules:{ stopPct:[STOP_MIN, STOP_MAX], horizonH:[HORIZON_MIN, HORIZON_MAX], costPct:COST_PCT } };
}
const SYSTEM = 'You are a senior discretionary crypto-futures trader on a professional desk. Nobody hands you a setup: YOU read the screen and forecast the NEXT MOVE of this coin. ' +
  'You see five timeframes (5m, 15m, 1h, 4h, 1d), each with a structure summary AND a chartReading computed by code from closed candles (market structure BOS/CHoCH, open fair value gaps, Fibonacci of the last leg, premium/discount, order blocks, patterns, equal highs/lows and liquidity sweeps, squeeze and displacement) and the recent candles; the day / week / month and 24h levels with their distance in % from the price now; the coin (24h change, funding / crowding); and BTC. ' +
  'Prices are scaled so that the price now = 100; the coin name and the date are hidden on purpose. If chart images are attached they show the same candles. ' +
  'Think like the trader who is NOT the liquidity: where are the stops resting, who is trapped right now, which side is crowded, where would a market maker push price next to fill orders, what does the larger trend allow - and where exactly is that idea wrong. ' +
  '`brain` is the desk\'s own probability matrix, built LIVE from its earlier rounds only (no backtest): for the formations on this screen, how often price went up first or down first and in how many hours; `desk` is who has been right so far. Use both as evidence - they can be thin, and you may disagree with them when the chart says so. ' +
  'Then commit. direction = LONG or SHORT, or NONE when there is honestly no readable move (NONE is respected; a forced guess is what the score punishes). ' +
  'stopPct = the distance in % from the price now at which your idea is wrong (' + STOP_MIN + ' to ' + STOP_MAX + '); targetPct = the distance in % price should travel in your direction BEFORE touching that stop (at least stopPct); horizonH = by when, in hours (' + HORIZON_MIN + ' to ' + HORIZON_MAX + '). ' +
  'Your forecast is written down now and scored automatically against what price really does: target first = +targetPct/stopPct R, stop first = -1R, neither by the horizon = the open result, each minus the trading cost. ' +
  'The traders with the best forward record get the final word on the desk\'s real trades, so do not answer by habit. ' +
  'Answer ONLY with JSON: {"direction":"LONG|SHORT|NONE","stopPct":number,"targetPct":number,"horizonH":number,"confidence":0-100,"reasonTr":"Türkçe 1-2 cümle: ne görüyorsun, sonraki hamle ne","wrongIfTr":"Türkçe kısa: fikir nerede bozulur"}';
const DIR_SYN = { BUY:'LONG', UP:'LONG', BULL:'LONG', BULLISH:'LONG', AL:'LONG', SELL:'SHORT', DOWN:'SHORT', BEAR:'SHORT', BEARISH:'SHORT', SAT:'SHORT',
  WAIT:'NONE', FLAT:'NONE', NEUTRAL:'NONE', NO_TRADE:'NONE', SKIP:'NONE', HOLD:'NONE', YOK:'NONE', BEKLE:'NONE' };
function parse(text) {
  try { const PD = require('./position-desk'), all = PD.jsonObjects(text); if (!all.length) return { ok:false, reason:'KESIF_JSON_INVALID' };
    const dir = o => { const w = PD.wordOf(o.direction); return ['LONG', 'SHORT', 'NONE'].includes(w) ? w : DIR_SYN[w] || null; };
    const j = [...all].reverse().find(o => dir(o)); if (!j) return { ok:false, reason:'KESIF_DIRECTION_INVALID' };
    const d = dir(j), conf = Math.max(0, Math.min(100, finite(j.confidence) ?? 50)), reasonTr = String(j.reasonTr || '').slice(0, 400), wrongIfTr = String(j.wrongIfTr || '').slice(0, 200);
    if (d === 'NONE') return { ok:true, direction:'NONE', confidence:conf, reasonTr, wrongIfTr };
    const s0 = finite(j.stopPct), g0 = finite(j.targetPct), h0 = finite(j.horizonH);
    if (!(s0 > 0) || !(g0 > 0)) return { ok:false, reason:'KESIF_NUMBERS_INVALID' };   // a direction without a stop and a target is not a forecast
    const stopPct = Math.max(STOP_MIN, Math.min(STOP_MAX, s0)), targetPct = Math.max(stopPct, Math.min(60, g0)), horizonH = Math.max(HORIZON_MIN, Math.min(HORIZON_MAX, h0 ?? 6));
    return { ok:true, direction:d, stopPct:round(stopPct, 2), targetPct:round(targetPct, 2), horizonH:round(horizonH, 1), confidence:conf, reasonTr, wrongIfTr, adjusted:stopPct !== s0 || targetPct !== g0 || horizonH !== (h0 ?? 6) };
  } catch { return { ok:false, reason:'KESIF_JSON_INVALID' }; }
}
const valid = text => parse(text).ok;

// one forecast record; `at` = the moment the answer arrived (the virtual entry is the OPEN of the first 5m candle that starts at or after it)
function open({ model, symbol, forecast, at, round:roundId = null, img = false } = {}) {
  if (!model || !symbol || !forecast?.ok || !Number.isFinite(at)) return null;
  const base = { id:`${roundId || at}:${model}`, round:roundId || null, model:String(model), symbol:String(symbol), at, side:forecast.direction, conf:forecast.confidence ?? null,
    why:String(forecast.reasonTr || '').slice(0, 240), wrongIf:String(forecast.wrongIfTr || '').slice(0, 160), ...(img ? { img:true } : {}) };
  if (forecast.direction === 'NONE') return { ...base, done:true, outcome:'NONE', R:null, closedAt:at };
  return { ...base, stopPct:forecast.stopPct, targetPct:forecast.targetPct, horizonH:forecast.horizonH, entryAt:Math.ceil(at / M5) * M5, done:false };
}
// the desk's own view of one round: when at least 60% of the answers (NONE included, >= 3 answers) point the same way, the median of
// their numbers is recorded as the member "ORTAK" - is the crowd of models better or worse than its best member?
function consensus(forecasts) {
  const ok = (forecasts || []).filter(f => f && f.ok); if (ok.length < 3) return null;
  for (const d of ['LONG', 'SHORT']) { const g = ok.filter(f => f.direction === d); if (g.length / ok.length >= 0.6)
    return { ok:true, direction:d, stopPct:round(med(g.map(f => f.stopPct)), 2), targetPct:round(med(g.map(f => f.targetPct)), 2), horizonH:round(med(g.map(f => f.horizonH)), 1), confidence:Math.round(g.length / ok.length * 100), reasonTr:`${g.length}/${ok.length} model ${d}`, wrongIfTr:'' }; }
  return null;
}
// follows the real closed 5m candles. Same candle touches both -> the stop counts. Returns null while the outcome is not known yet.
function resolve(rec, candles, now) {
  if (!rec || rec.done || rec.side === 'NONE') return null;
  const k = TB.rows(candles).filter(x => x.t >= rec.entryAt && x.t + M5 <= now).sort((a, b) => a.t - b.t); if (!k.length) return null;
  if (k[0].t !== rec.entryAt) { if (now - rec.entryAt > 3 * HOUR && k[0].t - rec.entryAt > HOUR) return { done:true, outcome:'NO_DATA', R:null, closedAt:now }; if (k[0].t > rec.entryAt + M5) return null; }
  const L = rec.side === 'LONG', e = k[0].o, s = rec.stopPct / 100, g = rec.targetPct / 100, stop = L ? e * (1 - s) : e * (1 + s), tgt = L ? e * (1 + g) : e * (1 - g), end = rec.entryAt + rec.horizonH * HOUR, cost = COST_PCT / rec.stopPct;
  let mfe = 0, mae = 0, last = null;
  for (const c of k) { if (c.t >= end) break; last = c;
    const fav = L ? (c.h - e) / e : (e - c.l) / e, adv = L ? (e - c.l) / e : (c.h - e) / e; mfe = Math.max(mfe, fav / s); mae = Math.max(mae, adv / s);
    if (L ? c.l <= stop : c.h >= stop) return { done:true, outcome:'STOP', entry:e, exit:stop, R:round(-1 - cost), mfeR:round(mfe, 2), maeR:round(Math.min(mae, 1), 2), closedAt:c.t + M5 };
    if (L ? c.h >= tgt : c.l <= tgt) return { done:true, outcome:'TARGET', entry:e, exit:tgt, R:round(g / s - cost), mfeR:round(g / s, 2), maeR:round(mae, 2), closedAt:c.t + M5 }; }
  if (now < end || !last) return null;
  const r = (L ? last.c - e : e - last.c) / e / s;
  return { done:true, outcome:'HORIZON', entry:e, exit:last.c, R:round(r - cost), mfeR:round(mfe, 2), maeR:round(mae, 2), closedAt:end };
}
// THE LEADER'S BOOK: one row per model from the forecasts whose outcome is known. Order: proven first (lower bound of the mean),
// then by average. Nobody is a candidate before MIN_SAY outcomes; nobody has the word before MIN_WORD and a lower bound above zero.
function karne(records, { now = Date.now() } = {}) {
  const by = new Map();
  for (const r of Array.isArray(records) ? records : []) { if (!r || !r.model || String(r.model).startsWith('_')) continue; const m = by.get(r.model) || { model:r.model, calls:0, none:0, open:0, noData:0, R:[], at:[], long:[], short:[], conf:[] }; by.set(r.model, m);
    m.calls++; if (r.outcome === 'NONE') { m.none++; continue; } if (!r.done) { m.open++; continue; } if (!Number.isFinite(r.R)) { m.noData++; continue; }
    m.R.push(r.R); m.at.push(r.closedAt || r.at); (r.side === 'LONG' ? m.long : m.short).push(r.R); m.conf.push([finite(r.conf), r.R]); }
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const rows = [...by.values()].map(m => { const n = m.R.length, a = avg(m.R), sd = n > 1 ? Math.sqrt(m.R.reduce((s, x) => s + (x - a) ** 2, 0) / (n - 1)) : null, lb = n > 1 ? a - sd / Math.sqrt(n) : null;
    const best = n ? Math.max(...m.R) : null, ex = n > 1 ? (m.R.reduce((s, x) => s + x, 0) - best) / (n - 1) : null;
    const order = m.R.map((x, i) => [m.at[i], x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
    // does its own confidence mean anything? average R of its more confident half minus the less confident half
    const cf = m.conf.filter(x => x[0] !== null).sort((p, q) => p[0] - q[0]), h = Math.floor(cf.length / 2), confEdge = cf.length >= 8 ? round(avg(cf.slice(h).map(x => x[1])) - avg(cf.slice(0, h).map(x => x[1])), 2) : null;
    const state = n >= MIN_WORD && lb > 0 && ex > 0 ? 'SOZ_SAHIBI' : n >= MIN_SAY && a > 0 && ex > 0 ? 'ADAY' : n >= MIN_SAY ? 'KANITSIZ' : 'YENI';
    return { model:m.model, calls:m.calls, none:m.none, open:m.open, n, hitPct:n ? Math.round(m.R.filter(x => x > 0).length / n * 100) : null, avgR:round(a), medR:round(med(m.R)), sumR:round(n ? m.R.reduce((s, x) => s + x, 0) : null, 2),
      exBestAvgR:round(ex), lowerR:round(lb), last10R:round(avg(order.slice(-10))), long:{ n:m.long.length, avgR:round(avg(m.long)) }, short:{ n:m.short.length, avgR:round(avg(m.short)) }, confEdgeR:confEdge, state }; });
  const rank = { SOZ_SAHIBI:0, ADAY:1, KANITSIZ:2, YENI:3 };
  rows.sort((p, q) => (rank[p.state] - rank[q.state]) || ((q.lowerR ?? -9) - (p.lowerR ?? -9)) || ((q.avgR ?? -9) - (p.avgR ?? -9)) || (q.n - p.n));
  const all = rows.filter(r => r.model !== 'ORTAK').reduce((s, r) => ({ n:s.n + r.n, sum:s.sum + (r.sumR || 0) }), { n:0, sum:0 });
  return { version:KESIF_VERSION, at:now, minSay:MIN_SAY, minWord:MIN_WORD, rows, leaders:rows.filter(r => r.state === 'SOZ_SAHIBI').map(r => r.model), candidates:rows.filter(r => r.state === 'ADAY').map(r => r.model),
    army:{ n:all.n, avgR:all.n ? round(all.sum / all.n) : null } };
}
// which coin does the desk look at next? Not one idea: the list mixes the day's strongest, weakest and busiest coins; the one looked at
// longest ago goes first. tickers = /fapi/v1/ticker/24hr rows.
function candidates(tickers, { minQuote = 20e6, now = Date.now() } = {}) {
  const t = (Array.isArray(tickers) ? tickers : []).map(x => ({ symbol:String(x.symbol || ''), ch:finite(x.priceChangePercent), q:finite(x.quoteVolume), close:finite(x.closeTime) }))
    .filter(x => /^[A-Z0-9]+USDT$/.test(x.symbol) && x.ch !== null && x.q >= minQuote && (x.close === null || now - x.close < 15 * 60000));
  const pick = (arr, n, why) => arr.slice(0, n).map(x => ({ symbol:x.symbol, change24hPct:x.ch, why }));
  const up = [...t].sort((a, b) => b.ch - a.ch), down = [...t].sort((a, b) => a.ch - b.ch), busy = [...t].sort((a, b) => b.q - a.q);
  const out = [], seen = new Set();
  for (const c of [...pick(up, 5, 'günün en çok yükselenlerinden'), ...pick(down, 3, 'günün en çok düşenlerinden'), ...pick(busy, 4, 'en yüksek hacimlilerden')]) if (!seen.has(c.symbol)) { seen.add(c.symbol); out.push(c); }
  return out;
}
// ---------------------------------------------------------------------------------------------------------------------------------
// BEYNİN MATRİSİ (kullanıcı 11.11: "beyin o andaki grafiği, coinin verilerini, her şeyini alıp matrixte olasılıklarına bakacak; modeller
// ile birlikte hem modeller öğrenecek hem beyin; grafikteki her oluşumu görecek zaman dilimlerinde"). Built LIVE only, from this desk's
// own rounds: every round the code writes the formations on the screen (5 timeframes + coin + BTC) and a neutral label of what price did
// next (up first / down first by the band, within LABEL_H hours). The matrix = per formation: how often up first, down first, flat, and
// how many hours it took. Nothing from the past is loaded; the matrix starts empty and fills itself.
const LABEL_H = 6, BAND_MIN = 1.2, BAND_MAX = 8, MATRIX_MIN_N = 8, BRAIN_MIN_ROUNDS = 20, BRAIN_EDGE = 0.10;
const bucket = (v, cuts, names) => { if (!Number.isFinite(v)) return null; for (let i = 0; i < cuts.length; i++) if (v < cuts[i]) return names[i]; return names[cuts.length]; };
function formations(pk) {
  const out = new Set(), add = (...p) => { const k = p.filter(x => x !== null && x !== undefined && x !== '').join(':'); if (k && p.every(x => x !== null && x !== undefined && x !== '')) out.add(k.slice(0, 60)); };
  for (const [tf, x] of Object.entries(pk?.timeframes || {})) { if (!x) continue; const s = x.structure || {}, r = x.chartReading || null;
    add(tf, 'trend', s.trend); if (s.lastBreak && s.lastBreak !== 'NONE') add(tf, 'kirilim', s.lastBreak);
    add(tf, 'ema', bucket(s.closeVsEma20, [-1, 1], ['ALTINDA', 'YAKIN', 'USTUNDE'])); add(tf, 'aralik', bucket(s.rangePos20, [0.2, 0.8], ['DIP', 'ORTA', 'TEPE']));
    if (tf === 'm5' || tf === 'm15') { add(tf, 'hacim', bucket(s.volLast3VsMedian, [0.7, 2], ['DUSUK', 'NORMAL', 'YUKSEK'])); add(tf, 'alici', bucket(s.takerBuyShareLast3, [0.42, 0.58], ['SATICI', 'DENGE', 'ALICI'])); }
    if (!r) continue;
    if (r.swing?.state) add(tf, 'salinim', r.swing.state);
    for (const e of r.events || []) if (Number.isFinite(e.barsAgo) && e.barsAgo <= 3) add(tf, 'olay', `${e.kind}_${e.side}`);
    if (r.dealingRange?.zone) add(tf, 'bolge', r.dealingRange.zone);
    if (r.momentum?.squeeze) add(tf, 'sikisma', r.momentum.squeeze);
    if (r.momentum?.displacement && r.momentum.displacement.barsAgo <= 5) add(tf, 'itki', r.momentum.displacement.dir);
    if (r.momentum?.stretchZone) add(tf, 'gerilme', r.momentum.stretchZone);
    add(tf, 'rsi', bucket(r.momentum?.rsi14, [30, 45, 55, 70], ['ASIRI_SATIM', 'ZAYIF', 'NOTR', 'GUCLU', 'ASIRI_ALIM']));
    if (r.liquidity?.lastSweep?.side) add(tf, 'supurme', r.liquidity.lastSweep.side);
    for (const p of r.patterns || []) if (p?.type) add(tf, 'formasyon', `${p.type}_${p.side || ''}`);
    if (r.spike && r.spike.barsAgo <= 3) add(tf, 'igne', r.spike.dir);
    if ((r.openFvg || []).length) add(tf, 'fvg', r.openFvg[0].side); }
  add('coin', 'gun', bucket(pk?.coin?.change24hPct, [-15, -5, 5, 15, 40], ['COK_DUSTU', 'DUSTU', 'YATAY', 'YUKSELDI', 'COK_YUKSELDI', 'UCTU']));
  add('coin', 'fonlama', bucket(pk?.coin?.fundingPct, [-0.01, 0.02, 0.05], ['NEGATIF', 'NORMAL', 'YUKSEK', 'ASIRI']));
  add('btc', 'trend', pk?.btc?.trend1h); add('btc', '12s', bucket(pk?.btc?.change12hPct, [-1, 1], ['DUSUS', 'YATAY', 'YUKSELIS']));
  return [...out].sort();
}
// the label's band: 1,5 x the 1h ATR, inside the stop band (the same distance a trader would call "a real move" for this coin now)
function band(pk) { const a = Number(pk?.timeframes?.h1?.structure?.atrPct); return round(Math.max(BAND_MIN, Math.min(BAND_MAX, Number.isFinite(a) && a > 0 ? 1.5 * a : 2)), 2); }
function labelOf(rec) { return rec?.outcome === 'TARGET' ? 'UP' : rec?.outcome === 'STOP' ? 'DOWN' : rec?.outcome === 'HORIZON' ? 'FLAT' : null; }
function matrixAdd(m, feats, label, hours) {
  if (!m || !label) return m; const t = m._total || (m._total = { n:0, UP:0, DOWN:0, FLAT:0 }); t.n++; t[label]++;
  if (!m.f) m.f = {};
  for (const k of feats || []) { const x = m.f[k] || (m.f[k] = { n:0, UP:0, DOWN:0, FLAT:0, hUP:0, hDOWN:0 }); x.n++; x[label]++; if (label !== 'FLAT' && Number.isFinite(hours)) x['h' + label] += hours; }
  return m;
}
// the brain's call: start from the base rate of all labelled rounds, move by every formation on this screen that has >= MATRIX_MIN_N
// rounds behind it (log-odds, shrunk toward the base rate while it is thin). Below BRAIN_MIN_ROUNDS labelled rounds the brain says NONE.
function brainCall(m, feats) {
  const t = m?._total || { n:0, UP:0, DOWN:0 }, lo0 = Math.log((t.UP + 1) / (t.DOWN + 1));
  const used = []; let lo = lo0;
  for (const k of feats || []) { const x = m?.f?.[k]; if (!x || x.n < MATRIX_MIN_N) continue; const lf = Math.log((x.UP + 1) / (x.DOWN + 1)), w = x.n / (x.n + 20), d = (lf - lo0) * w; lo += d;
    used.push({ f:k, n:x.n, upPct:Math.round(x.UP / x.n * 100), downPct:Math.round(x.DOWN / x.n * 100), flatPct:Math.round(x.FLAT / x.n * 100), hUp:x.UP ? round(x.hUP / x.UP, 1) : null, hDown:x.DOWN ? round(x.hDOWN / x.DOWN, 1) : null, push:round(d, 3) }); }
  lo = Math.max(-3, Math.min(3, lo)); const pUp = 1 / (1 + Math.exp(-lo));
  used.sort((a, b) => Math.abs(b.push) - Math.abs(a.push));
  return { rounds:t.n, ready:t.n >= BRAIN_MIN_ROUNDS, pUp:round(pUp, 3), baseUpPct:t.n ? Math.round(t.UP / t.n * 100) : null, baseDownPct:t.n ? Math.round(t.DOWN / t.n * 100) : null, used:used.slice(0, 8) };
}
// the brain as a member of the desk (BEYIN): it forecasts only when its matrix leans clearly; scored exactly like a model
function brainForecast(call, b) {
  if (!call?.ready) return { ok:true, direction:'NONE', confidence:0, reasonTr:`matris öğreniyor (${call?.rounds || 0}/${BRAIN_MIN_ROUNDS} tur)`, wrongIfTr:'' };
  const p = call.pUp, top = (call.used || []).slice(0, 3).map(u => `${u.f} ↑%${u.upPct}/↓%${u.downPct} (n${u.n})`).join(', ');
  if (p >= 0.5 + BRAIN_EDGE || p <= 0.5 - BRAIN_EDGE) { const d = p >= 0.5 ? 'LONG' : 'SHORT';
    return { ok:true, direction:d, stopPct:b, targetPct:b, horizonH:LABEL_H, confidence:Math.round(Math.max(p, 1 - p) * 100), reasonTr:`matris ${d === 'LONG' ? 'yukarı' : 'aşağı'} %${Math.round(Math.max(p, 1 - p) * 100)}: ${top}`.slice(0, 400), wrongIfTr:`fiyat %${b} ters giderse` }; }
  return { ok:true, direction:'NONE', confidence:Math.round(Math.max(p, 1 - p) * 100), reasonTr:`matris kararsız (yukarı %${Math.round(p * 100)})${top ? ': ' + top : ''}`.slice(0, 400), wrongIfTr:'' };
}
// what the models are told before they forecast: the brain's matrix on THIS screen and who has been right so far (they learn from both)
function brief(m, feats, call, k) {
  const rows = (k?.rows || []).filter(r => r.n >= 1).slice(0, 6).map(r => ({ trader:r.model === 'ORTAK' ? 'crowd of models' : r.model === 'BEYIN' ? 'brain matrix' : 'a model', n:r.n, hitPct:r.hitPct, avgR:r.avgR, state:r.state }));
  return { brain:{ labelledRounds:call.rounds, ready:call.ready, upFirstProbability:call.ready ? call.pUp : null, baseRate:call.rounds ? { upFirstPct:call.baseUpPct, downFirstPct:call.baseDownPct } : null,
      labelRule:`up first / down first by ${'±'}band % within ${LABEL_H} h; band = 1.5 x 1h ATR`, formationsOnThisScreen:(feats || []).length, strongest:call.used },
    desk:{ rows, note:'forward record of this desk only (no backtest); a small n proves nothing' } };
}
function matrixView(m, { minN = 3, top = 30 } = {}) {
  const rows = Object.entries(m?.f || {}).filter(([, x]) => x.n >= minN).map(([f, x]) => ({ f, n:x.n, upPct:Math.round(x.UP / x.n * 100), downPct:Math.round(x.DOWN / x.n * 100), flatPct:Math.round(x.FLAT / x.n * 100),
    hUp:x.UP ? round(x.hUP / x.UP, 1) : null, hDown:x.DOWN ? round(x.hDOWN / x.DOWN, 1) : null, ready:x.n >= MATRIX_MIN_N })).sort((a, b) => (b.ready - a.ready) || (Math.abs(b.upPct - b.downPct) - Math.abs(a.upPct - a.downPct)) || (b.n - a.n));
  const t = m?._total || { n:0, UP:0, DOWN:0, FLAT:0 };
  return { total:{ ...t }, formations:Object.keys(m?.f || {}).length, minN:MATRIX_MIN_N, minRounds:BRAIN_MIN_ROUNDS, rows:rows.slice(0, top) };
}
function nextCoin(list, surveyed = {}, { now = Date.now(), restMs = 60 * 60000 } = {}) {
  const c = (list || []).map(x => ({ ...x, last:Number(surveyed[x.symbol]) || 0 })).filter(x => now - x.last >= restMs).sort((a, b) => a.last - b.last);
  return c[0] || null;
}
module.exports = { KESIF_VERSION, STOP_MIN, STOP_MAX, HORIZON_MIN, HORIZON_MAX, COST_PCT, MIN_SAY, MIN_WORD, LABEL_H, MATRIX_MIN_N, BRAIN_MIN_ROUNDS, SYSTEM, packet, parse, valid, open, consensus, resolve, karne, candidates, nextCoin,
  formations, band, labelOf, matrixAdd, brainCall, brainForecast, brief, matrixView };
