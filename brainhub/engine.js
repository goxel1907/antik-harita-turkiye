'use strict';

const FRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round(n, places = 6) {
  return n === null ? null : Number(n.toFixed(places));
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
function structure(c) {
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
  return {
    available: true, asOf: last.closeTime, closedCandles: c.length,
    close: round(last.close), ema20: round(e20), ema50: round(e50),
    rsi14: round(rsi(close), 2), atr14: round(a14), atrPct: round(a14 / last.close * 100, 3),
    trend: direction, prior20High: round(high), prior20Low: round(low),
    breakOfStructure: breaksHigh ? 'UP' : breaksLow ? 'DOWN' : null,
    buySideLiquidity: round(high), sellSideLiquidity: round(low),
    recentFairValueGaps: gaps.slice(-3).map(g => ({ ...g, low: round(g.low), high: round(g.high) })),
    returnPct: round((last.close / c.at(-6).close - 1) * 100, 3)
  };
}
function analyzeFrames(rawByFrame, now = Date.now()) {
  const out = {};
  for (const frame of FRAMES) {
    try { out[frame] = structure(parseKlines(rawByFrame[frame], now)); }
    catch (e) { out[frame] = { available: false, reason: String(e.message || e) }; }
  }
  return out;
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
module.exports = { FRAMES, parseKlines, structure, analyzeFrames, microstructure, handoff };
