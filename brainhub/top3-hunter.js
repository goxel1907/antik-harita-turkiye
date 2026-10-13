'use strict';
// R2544.56 İLK 3 AVCISI (user 12.10.2026: "ilk 10'da işlem alacak ve ilk 3'e girecek coini erken yakalama; ilk 3'e girip
// tepe yapan coinler düşüşte çok kâr bırakıyor; 24 saat TEST, JEV'siz; JEV modu ve canlı düğmesi Office'te").
// Evidence (Claud-Work raporlar 2026-10-12-ilk3-erken-yakalama.md, 659 USDT perps, 6 months, hourly, rules fixed before
// the out-of-sample half):
//  LONG  "6/6": hourly volume >= 33.9x its 7-day hourly median, 24h >= +13.3%, already rank <= 7, was in the top 10 at
//        least once in the previous 7 days, 30-day hourly volatility >= 1.34%, BTC 24h <= +1.29%; on top of the base
//        ignition (1h >= +3%, volume >= 3x, close above the 7-day high). Train +7% / test +33% of margin per 10x trade
//        (stop -8%, target +30%, 24 h); 0.8-1.3 signals a day. Small samples: this lane is a measured experiment.
//  SHORT "S2": in the top 3 within 24 h, close >= 15% below the 24 h peak, red hour with volume >= 3x; stop 1% above the
//        last 3 hours' high (2%..8% away), target -10%, 24 h. +2.2% of margin per 10x trade, positive in both halves.
// This module is pure: features, rules, rank history and config. Orders, stops and bookkeeping live in live-controller.
const fs = require('fs');
const path = require('path');

const TOP3_VERSION = 'R2544.56_TOP3_HUNTER';
const DEFAULT_CONFIG = Object.freeze({
  enabled:false, jevMode:false, liveEnabled:false, leverage:10, marginQuote:null, maxActive:2,
  long:Object.freeze({ enabled:true, minR1:0.03, minVrBase:3, minVr1:33.9, minR24:0.133, maxRank:7, minTop10In7d:1, minVol30:0.0134, maxBtc24:0.0129, stopPct:0.08, tpPct:0.30, maxHoldH:24 }),
  short:Object.freeze({ enabled:true, top3WithinH:24, minDropFromPeak:0.15, minVr1:3, stopBufferPct:0.01, minStopPct:0.02, maxStopPct:0.08, tpPct:0.10, maxHoldH:24 })
});
const HOUR = 3600000;

const finite = v => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 6) => v === null || v === undefined ? null : Number(Number(v).toFixed(d));

function configFile(root) { return path.join(String(root || '.'), 'config', 'top3-hunter.json'); }
function readTop3Config(root) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  const c = { ...DEFAULT_CONFIG, long:{ ...DEFAULT_CONFIG.long }, short:{ ...DEFAULT_CONFIG.short } };
  for (const k of ['enabled', 'jevMode', 'liveEnabled']) if (typeof raw[k] === 'boolean') c[k] = raw[k];
  const lev = finite(raw.leverage); if (lev !== null && lev >= 1 && lev <= 20) c.leverage = Math.floor(lev);
  const mq = finite(raw.marginQuote); if (mq !== null && mq > 0) c.marginQuote = mq;
  const ma = finite(raw.maxActive); if (ma !== null && ma >= 1 && ma <= 4) c.maxActive = Math.floor(ma);
  for (const side of ['long', 'short']) {
    const src = raw[side] && typeof raw[side] === 'object' ? raw[side] : {};
    for (const [k, v] of Object.entries(DEFAULT_CONFIG[side])) {
      if (typeof v === 'boolean') { if (typeof src[k] === 'boolean') c[side][k] = src[k]; continue; }
      const n = finite(src[k]); if (n !== null && n >= 0) c[side][k] = n;
    }
  }
  return c;
}
// Only the three switches can be changed from Office/API; numeric rules stay in the file (user edits) or defaults.
function writeTop3Switches(root, patch = {}) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')) || {}; } catch {}
  for (const k of ['enabled', 'jevMode', 'liveEnabled']) if (typeof patch[k] === 'boolean') raw[k] = patch[k];
  raw.updatedAt = new Date().toISOString();
  const file = configFile(root); fs.mkdirSync(path.dirname(file), { recursive:true });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8'); fs.renameSync(tmp, file);
  return readTop3Config(root);
}

function median(a) { const s = a.filter(x => Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// k: closed 1h candles, oldest first, [openTime, open, high, low, close, volume]. Features at the LAST closed candle,
// computed exactly as in the research (Claud-Work gelistirme/harness/malzeme-lab/top3*.py).
function hourlyFeatures(k) {
  const rows = (Array.isArray(k) ? k : []).map(r => [finite(r[0]), finite(r[1]), finite(r[2]), finite(r[3]), finite(r[4]), finite(r[5])]).filter(r => r.every(x => x !== null));
  const n = rows.length;
  if (n < 200) return { ok:false, reason:'TOP3_HISTORY_TOO_SHORT', bars:n };
  const o = rows.map(r => r[1]), h = rows.map(r => r[2]), l = rows.map(r => r[3]), c = rows.map(r => r[4]), v = rows.map(r => r[5]);
  const last = n - 1, cl = c[last];
  if (!(cl > 0)) return { ok:false, reason:'TOP3_PRICE_INVALID' };
  const volWin = v.slice(Math.max(0, last - 24 - 167), last - 24 + 1);
  const vmed = volWin.length >= 72 ? median(volWin) : null;
  const vr = j => vmed > 0 ? v[j] / vmed : null;
  const hi7Win = h.slice(Math.max(0, last - 168), last);
  const hi7 = hi7Win.length >= 72 ? Math.max(...hi7Win) : null;
  const rets = []; for (let i = Math.max(1, n - 720); i < n; i++) rets.push(c[i] / c[i - 1] - 1);
  const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
  const vol30 = rets.length >= 200 ? Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1)) : null;
  const peak24 = Math.max(...h.slice(last - 23, last + 1));
  return {
    ok:true, openTime:rows[last][0], close:cl, open:o[last],
    r1:cl / c[last - 1] - 1, r3:cl / c[last - 3] - 1, r24:cl / c[last - 24] - 1,
    vr1:vr(last), vmed, breakout7d:hi7 !== null && cl > hi7, hi7, vol30,
    peak24, dropFromPeak:1 - cl / peak24, red:cl < o[last], high3:Math.max(h[last], h[last - 1], h[last - 2])
  };
}

function longSignal(f, ctx = {}, cfg = DEFAULT_CONFIG) {
  const L = cfg.long || DEFAULT_CONFIG.long, reasons = [];
  if (!L.enabled) return { ok:false, side:'LONG', reasons:['TOP3_LONG_DISABLED'] };
  if (!f?.ok) return { ok:false, side:'LONG', reasons:[f?.reason || 'TOP3_FEATURES_MISSING'] };
  if (!(f.r1 >= L.minR1)) reasons.push('R1_BELOW');
  if (!(f.vr1 >= L.minVrBase)) reasons.push('VOLUME_BASE_BELOW');
  if (!f.breakout7d) reasons.push('NO_7D_BREAKOUT');
  if (!(f.vr1 >= L.minVr1)) reasons.push('VOLUME_SURGE_BELOW');
  if (!(f.r24 >= L.minR24)) reasons.push('R24_BELOW');
  if (!(finite(ctx.rank) !== null && ctx.rank <= L.maxRank)) reasons.push('RANK_NOT_TOP');
  if (!(finite(ctx.top10In7d) !== null && ctx.top10In7d >= L.minTop10In7d)) reasons.push('NOT_A_REPEAT_GAINER');
  if (!(f.vol30 >= L.minVol30)) reasons.push('VOLATILITY_BELOW');
  if (!(finite(ctx.btc24) !== null && ctx.btc24 <= L.maxBtc24)) reasons.push('BTC_TOO_STRONG');
  return { ok:reasons.length === 0, side:'LONG', rule:'LONG_6OF6', reasons, stopPct:L.stopPct, tpPct:L.tpPct, maxHoldMs:L.maxHoldH * HOUR };
}

function shortSignal(f, ctx = {}, cfg = DEFAULT_CONFIG) {
  const S = cfg.short || DEFAULT_CONFIG.short, reasons = [];
  if (!S.enabled) return { ok:false, side:'SHORT', reasons:['TOP3_SHORT_DISABLED'] };
  if (!f?.ok) return { ok:false, side:'SHORT', reasons:[f?.reason || 'TOP3_FEATURES_MISSING'] };
  if (ctx.inTop3Within !== true) reasons.push('NOT_IN_TOP3_RECENTLY');
  if (!(f.dropFromPeak >= S.minDropFromPeak)) reasons.push('NOT_FAR_ENOUGH_FROM_PEAK');
  if (!f.red) reasons.push('HOUR_NOT_RED');
  if (!(f.vr1 >= S.minVr1)) reasons.push('VOLUME_BELOW');
  const stopRef = f.high3 * (1 + S.stopBufferPct);
  return { ok:reasons.length === 0, side:'SHORT', rule:'SHORT_TOP_FADE', reasons, stopRef, minStopPct:S.minStopPct, maxStopPct:S.maxStopPct, tpPct:S.tpPct, maxHoldMs:S.maxHoldH * HOUR };
}

// Entry geometry at the real fill price. LONG: fixed % stop/target. SHORT: structural stop above the last 3 hours' high,
// valid only 2%..8% away (fee and 10x liquidation safety); target fixed %.
function entryLevels(sig, price) {
  const p = finite(price); if (!(p > 0) || !sig?.ok) return { ok:false, reason:'TOP3_PRICE_INVALID' };
  if (sig.side === 'LONG') return { ok:true, stopPrice:p * (1 - sig.stopPct), tpPrice:p * (1 + sig.tpPct), stopPct:sig.stopPct };
  const d = finite(sig.stopRef) / p - 1;
  if (!(d >= sig.minStopPct && d <= sig.maxStopPct)) return { ok:false, reason:'TOP3_SHORT_STOP_OUT_OF_RANGE', stopPct:round(d, 4) };
  return { ok:true, stopPrice:sig.stopRef, tpPrice:p * (1 - sig.tpPct), stopPct:d };
}

// Research dedupe (top3*.py): per coin and rule, a hit counts only if no COUNTED hit of the same rule in the previous
// 24 h (first hit counts, then the next hit at least 24 h later, and so on). hitTimes: candle open times where the rule
// held. Live this keeps a lane that starts late (or after a restart) from entering a move the research entered hours ago.
function countedSignalAt(hitTimes, T, dedupeMs = 24 * HOUR) {
  const hits = [...new Set((hitTimes || []).map(Number).filter(Number.isFinite))].filter(h => h <= T).sort((a, b) => a - b);
  let last = -Infinity; const counted = [];
  for (const h of hits) if (h - last >= dedupeMs) { counted.push(h); last = h; }
  return { counted: counted.includes(Number(T)), countedTimes: counted, firstHit: hits.length ? hits[0] : null, lastCounted: counted.filter(h => h < T).at(-1) ?? null };
}

// Hourly 24h-change ranks of USDT perpetuals (1 = biggest gainer), persisted for the "top 10 in the last 7 days" and
// "top 3 in the last 24 hours" conditions.
class RankBook {
  constructor({ file = null, keepHours = 200 } = {}) { this.file = file; this.keepHours = keepHours; this.hours = {}; this._load(); }
  _load() { if (!this.file) return; try { const x = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (x && typeof x.hours === 'object') this.hours = x.hours; } catch {} }
  save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive:true }); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ version:TOP3_VERSION, hours:this.hours }), 'utf8'); fs.renameSync(tmp, this.file); } catch {}
  }
  record(hourTs, rankMap) {
    const t = Math.floor(Number(hourTs) / HOUR) * HOUR; if (!Number.isFinite(t)) return;
    const top = {}; for (const [s, r] of Object.entries(rankMap || {})) if (Number(r) <= 50) top[s] = Number(r);   // only the top 50 are ever needed
    this.hours[t] = top;
    const keys = Object.keys(this.hours).map(Number).sort((a, b) => a - b);
    while (keys.length > this.keepHours) delete this.hours[keys.shift()];
  }
  hoursCovered(now, span) { const lo = now - span; return Object.keys(this.hours).map(Number).filter(t => t >= lo && t < now).length; }
  countInTop(symbol, topN, fromTs, toTs) {
    let n = 0; for (const [t, m] of Object.entries(this.hours)) { const tt = Number(t); if (tt >= fromTs && tt < toTs && Number(m[symbol]) <= topN) n++; }
    return n;
  }
  symbolsInTop(topN, fromTs, toTs) {
    const out = new Set(); for (const [t, m] of Object.entries(this.hours)) { const tt = Number(t); if (tt < fromTs || tt >= toTs) continue; for (const [s, r] of Object.entries(m)) if (Number(r) <= topN) out.add(s); }
    return [...out];
  }
}

// Rank map from /fapi/v1/ticker/24hr rows (rolling 24 h change, as shown in the Binance gainers list).
function ranksFromTickers(rows, tradable = null) {
  const list = (Array.isArray(rows) ? rows : []).map(x => ({ s:String(x?.symbol || '').toUpperCase(), p:finite(x?.priceChangePercent) }))
    .filter(x => /USDT$/.test(x.s) && x.p !== null && (!tradable || tradable.has(x.s))).sort((a, b) => b.p - a.p);
  const out = {}; list.forEach((x, i) => { out[x.s] = i + 1; }); return out;
}

// ---------------------------------------------------------------------------------------------------------------
// R2544.56 İlk 3 hafızası (user 13.10.2026: "beyin öğreniyor, kesin öğrendiğine emin ol; hatalarını görsün"). Every
// closed lot becomes a deterministic lesson (no model): entry features, the best and worst price excursion while it was
// open (5m candles), result, exit. The lane's own memory aggregates them per rule and signal kind (FRESH = the research
// would count it, REPEAT = the rule had already fired on this coin within 24 h); JEV mode reads it on every decision.
// The rules themselves never change by themselves: a rule change is a measured, user-approved release.
// ---------------------------------------------------------------------------------------------------------------
// candles: [openTime, open, high, low, close, ...] while the lot was open. Signed in the trade's direction:
// mfePct > 0 is the best move in favour, maePct < 0 the worst move against.
function excursions(side, entry, candles) {
  const e = finite(entry);
  const rows = (Array.isArray(candles) ? candles : []).map(r => [finite(r[0]), finite(r[2]), finite(r[3])]).filter(r => r.every(x => x !== null));
  if (!(e > 0) || !rows.length) return null;
  let hi = -Infinity, lo = Infinity, hiAt = null, loAt = null;
  for (const [t, h, l] of rows) { if (h > hi) { hi = h; hiAt = t; } if (l < lo) { lo = l; loAt = t; } }
  return side === 'LONG'
    ? { mfePct: hi / e - 1, maePct: lo / e - 1, mfeAt: hiAt, maeAt: loAt, bars: rows.length }
    : { mfePct: 1 - lo / e, maePct: 1 - hi / e, mfeAt: loAt, maeAt: hiAt, bars: rows.length };
}
const pctTr = v => v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1).replace('.', ',') + '%';
const RULE_TR = { LONG_6OF6: 'LONG 6/6', SHORT_TOP_FADE: 'SHORT tepe sonrası' };
const EXIT_TR = { TOP3_TAKE_PROFIT: 'hedef', TOP3_STOP: 'stop', TOP3_TIME_EXIT: '24 saat doldu', TOP3_STOP_OR_EXTERNAL: 'stop / dış kapanış', TOP3_OTHER_EXIT: 'diğer' };
// lot: the closed lot (state record + exitPrice/closedAt); close: the POSITION_CLOSED record; path: excursions() or null.
function buildLesson(lot, close, path) {
  const side = lot.side, entry = finite(lot.entryPrice), exit = finite(lot.exitPrice) ?? null;
  const stopPct = finite(lot.stopPct), tp = finite(lot.tpPrice);
  const targetPct = entry > 0 && tp > 0 ? (side === 'LONG' ? tp / entry - 1 : 1 - tp / entry) : null;
  const resultPct = entry > 0 && exit > 0 ? (side === 'LONG' ? exit / entry - 1 : 1 - exit / entry) : null;
  const net = finite(close?.netPnl), r = finite(close?.rMultiple);
  const mfe = path ? path.mfePct : finite(lot.sampleMfePct), mae = path ? path.maePct : finite(lot.sampleMaePct);
  const exitType = close?.exitType || null;
  const tags = [];
  if (exitType === 'TOP3_TAKE_PROFIT') tags.push('TARGET_HIT');
  if (exitType === 'TOP3_STOP' || exitType === 'TOP3_STOP_OR_EXTERNAL') tags.push('STOPPED');
  if (exitType === 'TOP3_TIME_EXIT') tags.push('TIME_EXIT');
  if (tags.includes('STOPPED') && targetPct > 0 && mfe !== null && mfe >= targetPct / 2) tags.push('STOPPED_AFTER_HALF_TARGET');
  if (mfe !== null && mfe < 0.002) tags.push('NEVER_IN_PROFIT');
  if (lot.signalKind === 'REPEAT') tags.push('REPEAT_SIGNAL');
  const holdH = finite(lot.openedAt) && finite(lot.closedAt) ? (lot.closedAt - lot.openedAt) / HOUR : null;
  const verdict = net === null ? 'UNKNOWN' : net > 0 ? 'WIN' : net < 0 ? 'LOSS' : 'FLAT';
  const lessonTr = `${RULE_TR[lot.rule] || lot.rule}${lot.signalKind === 'REPEAT' ? ' (tekrar sinyal)' : ''}: ` +
    `${verdict === 'WIN' ? 'kazanç' : verdict === 'LOSS' ? 'kayıp' : verdict === 'FLAT' ? 'başabaş' : 'sonuç bilinmiyor'} ${pctTr(resultPct)}` +
    `${r !== null ? ' / ' + r.toFixed(2).replace('.', ',') + ' R' : ''}${holdH !== null ? ', ' + holdH.toFixed(1).replace('.', ',') + ' sa' : ''}; ` +
    `en iyi ${pctTr(mfe)}${targetPct > 0 && mfe !== null ? ' (hedefin %' + Math.round(Math.max(0, mfe) / targetPct * 100) + "'i)" : ''}, en kötü ${pctTr(mae)}; çıkış ${EXIT_TR[exitType] || exitType || '—'}.` +
    (tags.includes('STOPPED_AFTER_HALF_TARGET') ? ' Hedefin yarısını gördükten sonra stop oldu.' : '') +
    (tags.includes('NEVER_IN_PROFIT') ? ' Hiç kâra geçmedi.' : '');
  const round4 = v => v === null || v === undefined ? null : Number(Number(v).toFixed(4));
  return {
    // kind UNLABELED: a lot opened before the signal label existed (never counted as FRESH)
    v: 1, id: lot.id, symbol: lot.symbol, side, rule: lot.rule, kind: lot.signalKind || 'UNLABELED', mode: lot.mode || 'TEST',
    openedAt: finite(lot.openedAt), closedAt: finite(lot.closedAt), holdH: round4(holdH), entryPrice: entry, exitPrice: exit,
    stopPct: round4(stopPct), targetPct: round4(targetPct), resultPct: round4(resultPct), netPnl: net, rMultiple: round4(r), verdict, exitType,
    mfePct: round4(mfe), maePct: round4(mae), mfeR: stopPct > 0 && mfe !== null ? round4(mfe / stopPct) : null,
    pathSource: path ? '5m' : (mfe !== null ? 'SAMPLES_30S' : 'NONE'), features: lot.entryFeatures || null, jev: lot.jev?.decision || null, tags, lessonTr
  };
}
const BUCKETS = {
  SHORT_TOP_FADE: { feature: 'dropFromPeak', label: 'tepeden düşüş', edges: [0.15, 0.25, 0.40] },
  LONG_6OF6: { feature: 'r24', label: '24 saat yükseliş', edges: [0.133, 0.30, 0.60] }
};
function aggregate(xs) {
  const n = xs.length, num = k => xs.map(x => finite(x[k])).filter(v => v !== null);
  const avg = k => { const v = num(k); return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4)) : null; };
  const has = t => xs.filter(x => (x.tags || []).includes(t)).length;
  const wins = xs.filter(x => x.verdict === 'WIN').length, losses = xs.filter(x => x.verdict === 'LOSS').length;
  return { n, wins, losses, winRate: n ? Number((wins / n).toFixed(3)) : null, avgR: avg('rMultiple'), avgResultPct: avg('resultPct'), avgMfePct: avg('mfePct'), avgMaePct: avg('maePct'),
    targetHit: has('TARGET_HIT'), stopped: has('STOPPED'), timeExit: has('TIME_EXIT'), stoppedAfterHalfTarget: has('STOPPED_AFTER_HALF_TARGET'), neverInProfit: has('NEVER_IN_PROFIT'),
    netPnl: Number(num('netPnl').reduce((a, b) => a + b, 0).toFixed(4)) };
}
function bucketsFor(lessons, rule) {
  const b = BUCKETS[rule]; if (!b) return null;
  const xs = lessons.filter(l => l.rule === rule && finite(l.features?.[b.feature]) !== null);
  const rows = b.edges.map((lo, i) => {
    const hi = b.edges[i + 1] ?? Infinity;
    const g = xs.filter(l => l.features[b.feature] >= lo && l.features[b.feature] < hi);
    return { from: lo, to: Number.isFinite(hi) ? hi : null, ...aggregate(g) };
  });
  return { feature: b.feature, label: b.label, rows };
}
function experienceSummary(lessons, { mode = null, recent = 8 } = {}) {
  const xs = (Array.isArray(lessons) ? lessons : []).filter(l => !mode || l.mode === mode);
  const keys = [...new Set(xs.map(l => `${l.mode}|${l.rule}|${l.kind}`))].sort();
  const groups = keys.map(k => { const [m, rule, kind] = k.split('|'); return { mode: m, rule, kind, ...aggregate(xs.filter(l => `${l.mode}|${l.rule}|${l.kind}` === k)) }; });
  const rules = [...new Set(xs.map(l => l.rule))];
  return { lessons: xs.length, groups, buckets: Object.fromEntries(rules.map(r => [r, bucketsFor(xs, r)]).filter(([, v]) => v)),
    recent: xs.slice(-recent).reverse().map(l => ({ symbol: l.symbol, side: l.side, rule: l.rule, kind: l.kind, mode: l.mode, closedAt: l.closedAt, verdict: l.verdict, rMultiple: l.rMultiple, resultPct: l.resultPct, mfePct: l.mfePct, maePct: l.maePct, exitType: l.exitType, tags: l.tags, lessonTr: l.lessonTr })) };
}
// What JEV sees for one rule: this lane's measured history of that rule (both signal kinds, both modes), its feature
// buckets and the latest lessons with their entry features.
function experienceFor(lessons, rule, { recent = 6 } = {}) {
  const xs = (Array.isArray(lessons) ? lessons : []).filter(l => l.rule === rule);
  const s = experienceSummary(xs, { recent });
  return { rule, closedLots: xs.length, groups: s.groups, buckets: s.buckets[rule] || null,
    recent: xs.slice(-recent).reverse().map(l => ({ symbol: l.symbol, side: l.side, kind: l.kind, mode: l.mode, verdict: l.verdict, rMultiple: l.rMultiple, resultPct: l.resultPct, mfePct: l.mfePct, maePct: l.maePct, exitType: l.exitType, features: l.features, lessonTr: l.lessonTr })),
    note: xs.length < 10 ? 'FEW_SAMPLES_TREAT_AS_ANECDOTE' : 'MEASURED_HISTORY' };
}

module.exports = { excursions, buildLesson, experienceSummary, experienceFor, TOP3_VERSION, DEFAULT_CONFIG, HOUR, readTop3Config, writeTop3Switches, hourlyFeatures, longSignal, shortSignal, entryLevels, countedSignalAt, RankBook, ranksFromTickers, median };
