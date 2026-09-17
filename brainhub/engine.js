'use strict';

const FRAMES = ['1m', '3m', '5m', '15m', '30m', '45m', '1h', '4h', '1d'];
const NATIVE_FRAMES = FRAMES.filter(x => x !== '45m');
const FIFTEEN_MS = 15 * 60 * 1000;
const FORTYFIVE_MS = 45 * 60 * 1000;

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round(n, places = 6) {
  return n === null || !Number.isFinite(n) ? null : Number(n.toFixed(places));
}
function ema(values, period) {
  if (values.length < period) return null;
  const a = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i++) value = a * values[i] + (1 - a) * value;
  return value;
}
function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gains += Math.max(0, d);
    losses += Math.max(0, -d);
  }
  return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
}
function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  let total = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const x = candles[i], prev = candles[i - 1];
    total += Math.max(x.high - x.low, Math.abs(x.high - prev.close), Math.abs(x.low - prev.close));
  }
  return total / period;
}
function parseKlines(raw, now = Date.now()) {
  if (!Array.isArray(raw)) throw new Error('klines must be an array');
  return raw.map(k => ({
    openTime: finite(k[0]), open: finite(k[1]), high: finite(k[2]),
    low: finite(k[3]), close: finite(k[4]), volume: finite(k[5]),
    closeTime: finite(k[6]), quoteVolume: finite(k[7]), takerBuyQuote: finite(k[10])
  })).filter(k => Object.values(k).every(v => v !== null) && k.openTime < k.closeTime && k.closeTime < now && k.high >= k.low && k.high >= Math.max(k.open, k.close) && k.low <= Math.min(k.open, k.close));
}
function aggregate45m(candles15m, now = Date.now()) {
  if (!Array.isArray(candles15m)) throw new Error('candles15m must be an array');
  const byBucket = new Map();
  for (const c of candles15m) {
    if (!c || !Number.isFinite(c.openTime) || !Number.isFinite(c.closeTime) || c.closeTime >= now) continue;
    const bucket = Math.floor(c.openTime / FORTYFIVE_MS) * FORTYFIVE_MS;
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
    byBucket.get(bucket).set(c.openTime, c);
  }
  const out = [];
  for (const [bucket, rows] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    const expected = [bucket, bucket + FIFTEEN_MS, bucket + 2 * FIFTEEN_MS];
    if (!expected.every(t => rows.has(t))) continue;
    const group = expected.map(t => rows.get(t));
    const last = group[2];
    if (last.closeTime >= now) continue;
    out.push({
      openTime: bucket,
      open: group[0].open,
      high: Math.max(...group.map(x => x.high)),
      low: Math.min(...group.map(x => x.low)),
      close: last.close,
      volume: group.reduce((s, x) => s + x.volume, 0),
      closeTime: last.closeTime,
      quoteVolume: group.reduce((s, x) => s + x.quoteVolume, 0),
      takerBuyQuote: group.reduce((s, x) => s + x.takerBuyQuote, 0)
    });
  }
  return out;
}
function candleShape(x, a14 = null) {
  const range = Math.max(0, x.high - x.low);
  const body = Math.abs(x.close - x.open);
  const upperWick = x.high - Math.max(x.open, x.close);
  const lowerWick = Math.min(x.open, x.close) - x.low;
  return {
    direction: x.close > x.open ? 'BULL' : x.close < x.open ? 'BEAR' : 'DOJI',
    range: round(range), body: round(body),
    bodyPct: range > 0 ? round(body / range * 100, 1) : 0,
    upperWickPct: range > 0 ? round(upperWick / range * 100, 1) : 0,
    lowerWickPct: range > 0 ? round(lowerWick / range * 100, 1) : 0,
    rangeAtr: a14 && a14 > 0 ? round(range / a14, 3) : null
  };
}
function pivots(c, left = 2, right = 2) {
  const highs = [], lows = [];
  for (let i = left; i < c.length - right; i++) {
    let high = true, low = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (c[j].high >= c[i].high) high = false;
      if (c[j].low <= c[i].low) low = false;
    }
    if (high) highs.push({ index: i, price: c[i].high, at: c[i].closeTime });
    if (low) lows.push({ index: i, price: c[i].low, at: c[i].closeTime });
  }
  return { highs, lows };
}
function equalLevel(points, tolerance) {
  if (points.length < 2 || !(tolerance > 0)) return null;
  const a = points.at(-2), b = points.at(-1);
  if (Math.abs(a.price - b.price) > tolerance) return null;
  return { price: round((a.price + b.price) / 2), firstAt: a.at, secondAt: b.at };
}
function detectPatterns(c, a14) {
  if (c.length < 4) return [];
  const out = [];
  const last = c.at(-1), prev = c.at(-2);
  const ls = candleShape(last, a14);
  const bullishEngulf = last.close > last.open && prev.close < prev.open && last.open <= prev.close && last.close >= prev.open;
  const bearishEngulf = last.close < last.open && prev.close > prev.open && last.open >= prev.close && last.close <= prev.open;
  if (bullishEngulf) out.push({ type: 'BULLISH_ENGULFING', side: 'LONG', status: 'CONFIRMED', at: last.closeTime });
  if (bearishEngulf) out.push({ type: 'BEARISH_ENGULFING', side: 'SHORT', status: 'CONFIRMED', at: last.closeTime });
  if (ls.lowerWickPct >= 55 && ls.bodyPct <= 35 && last.close >= last.open) out.push({ type: 'HAMMER_REJECTION', side: 'LONG', status: 'CONFIRMED', at: last.closeTime });
  if (ls.upperWickPct >= 55 && ls.bodyPct <= 35 && last.close <= last.open) out.push({ type: 'SHOOTING_STAR_REJECTION', side: 'SHORT', status: 'CONFIRMED', at: last.closeTime });
  if (last.high < prev.high && last.low > prev.low) out.push({ type: 'INSIDE_BAR', side: 'NEUTRAL', status: 'FORMING', at: last.closeTime });
  if (last.high > prev.high && last.low < prev.low) out.push({ type: 'OUTSIDE_BAR', side: ls.direction === 'BULL' ? 'LONG' : ls.direction === 'BEAR' ? 'SHORT' : 'NEUTRAL', status: 'CONFIRMED', at: last.closeTime });
  const recent = c.slice(-8);
  const ranges = recent.map(x => x.high - x.low);
  const oldAvg = ranges.slice(0, 4).reduce((s, x) => s + x, 0) / 4;
  const newAvg = ranges.slice(-4).reduce((s, x) => s + x, 0) / 4;
  if (oldAvg > 0 && newAvg / oldAvg <= 0.65) out.push({ type: 'VOLATILITY_COMPRESSION', side: 'NEUTRAL', status: 'FORMING', at: last.closeTime });
  if (a14 && (last.high - last.low) >= 1.5 * a14 && ls.bodyPct >= 65) out.push({ type: 'DISPLACEMENT', side: ls.direction === 'BULL' ? 'LONG' : 'SHORT', status: 'CONFIRMED', at: last.closeTime });
  return out;
}
function opportunity(c, frame, a14, context) {
  if (c.length < 20 || !a14) return { available: false, reason: 'INSUFFICIENT_CLOSED_CANDLES' };
  const last = c.at(-1);
  const patterns = context.patterns || [];
  let longScore = 0, shortScore = 0;
  if (context.trend === 'UP') longScore += 18;
  if (context.trend === 'DOWN') shortScore += 18;
  if (context.breakOfStructure === 'UP') longScore += 20;
  if (context.breakOfStructure === 'DOWN') shortScore += 20;
  for (const p of patterns) {
    if (p.side === 'LONG') longScore += p.type === 'DISPLACEMENT' ? 12 : 7;
    if (p.side === 'SHORT') shortScore += p.type === 'DISPLACEMENT' ? 12 : 7;
  }
  if (context.liquidity?.lastSweep === 'SELL_SIDE_RECLAIM') longScore += 18;
  if (context.liquidity?.lastSweep === 'BUY_SIDE_REJECT') shortScore += 18;
  const r = rsi(c.map(x => x.close));
  if (r !== null && r >= 52 && r <= 78) longScore += 5;
  if (r !== null && r <= 48 && r >= 22) shortScore += 5;
  const recent = c.slice(-6);
  const quote = recent.reduce((s, x) => s + x.quoteVolume, 0);
  const taker = recent.reduce((s, x) => s + x.takerBuyQuote, 0);
  if (quote > 0) {
    const ratio = taker / quote;
    if (ratio >= 0.56) longScore += 8;
    if (ratio <= 0.44) shortScore += 8;
  }
  const cap = x => Math.max(0, Math.min(100, Math.round(x)));
  const long = cap(longScore), short = cap(shortScore);
  const preferred = long === short ? 'NEUTRAL' : long > short ? 'LONG' : 'SHORT';
  const state = Math.max(long, short) >= 45 ? 'WATCH' : 'SCAN';
  return {
    available: true, frame, originEligible: true, ownerEligible: true,
    preferredSide: preferred, state,
    longScore: long, shortScore: short,
    asOf: last.closeTime,
    note: 'Opportunity scores are advisory context; execution remains deterministic and DRY-RUN until explicitly enabled.'
  };
}
function structure(c, frame = null) {
  if (c.length < 52) return { available: false, reason: 'INSUFFICIENT_CLOSED_CANDLES', closedCandles: c.length };
  const close = c.map(x => x.close), last = c.at(-1);
  const e20 = ema(close, 20), e50 = ema(close, 50), a14 = atr(c);
  const recent = c.slice(-20, -1);
  const high = Math.max(...recent.map(x => x.high));
  const low = Math.min(...recent.map(x => x.low));
  const direction = e20 > e50 && last.close > e20 ? 'UP' : e20 < e50 && last.close < e20 ? 'DOWN' : 'MIXED';
  const breaksHigh = last.close > high, breaksLow = last.close < low;
  const gaps = [];
  for (let i = Math.max(2, c.length - 25); i < c.length; i++) {
    const a = c[i - 2], b = c[i];
    if (b.low > a.high) gaps.push({ side: 'BULL', low: a.high, high: b.low, at: b.closeTime });
    if (b.high < a.low) gaps.push({ side: 'BEAR', low: b.high, high: a.low, at: b.closeTime });
  }
  const pv = pivots(c.slice(-40));
  const tolerance = Math.max((a14 || 0) * 0.15, last.close * 0.0005);
  const eqHigh = equalLevel(pv.highs, tolerance);
  const eqLow = equalLevel(pv.lows, tolerance);
  let lastSweep = null;
  if (eqLow && last.low < eqLow.price && last.close > eqLow.price) lastSweep = 'SELL_SIDE_RECLAIM';
  if (eqHigh && last.high > eqHigh.price && last.close < eqHigh.price) lastSweep = 'BUY_SIDE_REJECT';
  const patterns = detectPatterns(c, a14);
  const base = {
    available: true, frame, asOf: last.closeTime, closedCandles: c.length,
    close: round(last.close), ema20: round(e20), ema50: round(e50),
    rsi14: round(rsi(close), 2), atr14: round(a14), atrPct: round(a14 / last.close * 100, 3),
    trend: direction, prior20High: round(high), prior20Low: round(low),
    breakOfStructure: breaksHigh ? 'UP' : breaksLow ? 'DOWN' : null,
    buySideLiquidity: round(high), sellSideLiquidity: round(low),
    recentFairValueGaps: gaps.slice(-3).map(g => ({ ...g, low: round(g.low), high: round(g.high) })),
    returnPct: round((last.close / c.at(-6).close - 1) * 100, 3),
    candle: candleShape(last, a14),
    patterns,
    liquidity: { equalHigh: eqHigh, equalLow: eqLow, lastSweep }
  };
  base.opportunity = opportunity(c, frame, a14, base);
  return base;
}
function analyzeFrames(rawByFrame, now = Date.now()) {
  const out = {};
  const parsed15 = parseKlines(rawByFrame['15m'] || [], now);
  for (const frame of FRAMES) {
    try {
      if (frame === '45m') out[frame] = structure(aggregate45m(parsed15, now), frame);
      else out[frame] = structure(parseKlines(rawByFrame[frame], now), frame);
    } catch (e) { out[frame] = { available: false, reason: String(e.message || e) }; }
  }
  return out;
}
function breakoutExecution({ side, confirmedClose, trigger, livePrice, reclaimConfirmed = false }) {
  const cc = finite(confirmedClose), t = finite(trigger), lp = finite(livePrice);
  if (!['LONG', 'SHORT'].includes(side) || [cc, t, lp].some(x => x === null)) return { allowed: false, status: 'INVALID_INPUT' };
  const confirmed = side === 'LONG' ? cc > t : cc < t;
  if (!confirmed) return { allowed: false, status: 'WAIT_CONFIRMATION' };
  const lost = side === 'LONG' ? lp < t : lp > t;
  if (lost && !reclaimConfirmed) return { allowed: false, status: 'FAILED_BREAKOUT', waitFor: '5M_RECLAIM_OR_VALID_ALTERNATE_PATH' };
  return { allowed: true, status: reclaimConfirmed ? 'RECLAIMED' : 'ACCEPTED' };
}
function microstructure(depth, trades, previousDepth = null, now = Date.now()) {
  const levels = side => Array.isArray(side) ? side.slice(0, 20).map(x => [finite(x[0]), finite(x[1])]).filter(x => x[0] > 0 && x[1] > 0) : [];
  const bids = levels(depth?.bids), asks = levels(depth?.asks);
  if (!bids.length || !asks.length) return { available: false, reason: 'NO_DEPTH' };
  const bid = bids[0][0], ask = asks[0][0], mid = (bid + ask) / 2;
  const bidNotional = bids.reduce((s, x) => s + x[0] * x[1], 0);
  const askNotional = asks.reduce((s, x) => s + x[0] * x[1], 0);
  const imbalance = (bidNotional - askNotional) / (bidNotional + askNotional);
  const validTrades = Array.isArray(trades) ? trades.filter(x => finite(x.T) !== null && now - Number(x.T) <= 120000 && now >= Number(x.T) && finite(x.p) > 0 && finite(x.q) > 0) : [];
  const cvdSample = validTrades.reduce((s, x) => s + (x.m ? -1 : 1) * Number(x.p) * Number(x.q), 0);
  let ofiProxy = null;
  if (previousDepth && now - previousDepth.at <= 15000 && previousDepth.bid === bid && previousDepth.ask === ask) {
    ofiProxy = (bidNotional - previousDepth.bidNotional) - (askNotional - previousDepth.askNotional);
  }
  return {
    available: true, asOf: now, bid: round(bid), ask: round(ask),
    spreadBps: round((ask - bid) / mid * 10000, 3),
    depth20Imbalance: round(imbalance, 4),
    cvdSampleQuote: validTrades.length ? round(cvdSample, 2) : null,
    cvdSampleTrades: validTrades.length,
    cvdWindow: 'returned recent aggTrades, at most 120s; not continuous CVD',
    ofiProxyQuote: ofiProxy === null ? null : round(ofiProxy, 2),
    ofiNote: 'two REST snapshots with unchanged best prices; not sequenced order-flow imbalance',
    snapshot: { at: now, bid, ask, bidNotional, askNotional }
  };
}
function handoff(initialStop, candidateStop, side) {
  if (!Number.isFinite(initialStop) || !Number.isFinite(candidateStop)) return { allowed: false, reason: 'INVALID_STOP' };
  const safe = side === 'LONG' ? candidateStop >= initialStop : side === 'SHORT' ? candidateStop <= initialStop : false;
  return { allowed: safe, stop: safe ? candidateStop : initialStop, reason: safe ? 'RISK_NOT_WIDENED' : 'WOULD_WIDEN_RISK' };
}
module.exports = { FRAMES, NATIVE_FRAMES, parseKlines, aggregate45m, structure, analyzeFrames, breakoutExecution, microstructure, handoff };
