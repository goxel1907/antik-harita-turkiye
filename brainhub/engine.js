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
    if (high) highs.push({ index:i, price:c[i].high, at:c[i].closeTime });
    if (low) lows.push({ index:i, price:c[i].low, at:c[i].closeTime });
  }
  return { highs, lows };
}
function equalLevel(points, tolerance) {
  if (points.length < 2 || !(tolerance > 0)) return null;
  const a = points.at(-2), b = points.at(-1);
  if (Math.abs(a.price - b.price) > tolerance) return null;
  return { price:round((a.price + b.price) / 2), firstAt:a.at, secondAt:b.at };
}
function linearFit(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.index, 0) / n;
  const my = points.reduce((s, p) => s + p.price, 0) / n;
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.index - mx) * (p.price - my);
    den += (p.index - mx) ** 2;
  }
  if (!(den > 0)) return null;
  const slope = num / den;
  return { slope, intercept:my - slope * mx, at:x => slope * x + (my - slope * mx) };
}
function swingStructure(pv, tolerance, lastClose) {
  const h = pv.highs.slice(-3), l = pv.lows.slice(-3);
  const cmp = (a, b) => a > b + tolerance ? 1 : a < b - tolerance ? -1 : 0;
  const highSeq = h.length >= 2 ? cmp(h.at(-1).price, h.at(-2).price) : null;
  const lowSeq = l.length >= 2 ? cmp(l.at(-1).price, l.at(-2).price) : null;
  const state = highSeq === 1 && lowSeq === 1 ? 'BULLISH'
    : highSeq === -1 && lowSeq === -1 ? 'BEARISH'
      : 'MIXED';
  const lastHigh = h.at(-1) || null, lastLow = l.at(-1) || null;
  let event = null;
  if (lastHigh && lastClose > lastHigh.price + tolerance * 0.15) event = state === 'BEARISH' ? 'CHOCH_UP' : 'BOS_UP';
  if (lastLow && lastClose < lastLow.price - tolerance * 0.15) event = state === 'BULLISH' ? 'CHOCH_DOWN' : 'BOS_DOWN';
  return {
    state,
    highSequence:highSeq === 1 ? 'HH' : highSeq === -1 ? 'LH' : highSeq === 0 ? 'EH' : 'UNKNOWN',
    lowSequence:lowSeq === 1 ? 'HL' : lowSeq === -1 ? 'LL' : lowSeq === 0 ? 'EL' : 'UNKNOWN',
    lastConfirmedSwingHigh:lastHigh ? { price:round(lastHigh.price), at:lastHigh.at } : null,
    lastConfirmedSwingLow:lastLow ? { price:round(lastLow.price), at:lastLow.at } : null,
    event
  };
}
function smcContext(swings, lastClose, gaps = []) {
  const high=finite(swings?.lastConfirmedSwingHigh?.price);
  const low=finite(swings?.lastConfirmedSwingLow?.price);
  if (high === null || low === null || !(high > low) || !Number.isFinite(lastClose)) {
    return {
      available:false,
      reason:'CONFIRMED_DEALING_RANGE_UNAVAILABLE',
      semantics:'SOFT_STRUCTURAL_CONTEXT_ONLY'
    };
  }
  const range=high-low;
  const equilibrium=(high+low)/2;
  const position=(lastClose-low)/range;
  const zone=position < 0.45 ? 'DISCOUNT' : position > 0.55 ? 'PREMIUM' : 'EQUILIBRIUM';
  const longOteLow=low+range*0.21;
  const longOteHigh=low+range*0.38;
  const shortOteLow=low+range*0.62;
  const shortOteHigh=low+range*0.79;
  const withCe=(Array.isArray(gaps)?gaps:[]).slice(-3).map(g => ({
    side:g.side,
    low:round(g.low),
    high:round(g.high),
    ce50:round((Number(g.low)+Number(g.high))/2),
    at:g.at
  }));
  return {
    available:true,
    source:'CONFIRMED_SWING_RANGE_FROM_CLOSED_CANDLES',
    swingEvent:swings?.event || null,
    swingState:swings?.state || null,
    dealingRange:{
      low:round(low),
      high:round(high),
      equilibrium:round(equilibrium),
      positionPct:round(position*100,2),
      zone
    },
    oteReference:{
      longDiscountZone:{ low:round(longOteLow), high:round(longOteHigh) },
      shortPremiumZone:{ low:round(shortOteLow), high:round(shortOteHigh) },
      semantics:'REFERENCE_ZONE_NOT_ENTRY_SIGNAL'
    },
    fairValueGaps:withCe,
    semantics:'SOFT_STRUCTURAL_CONTEXT_ONLY',
    note:'Premium/discount, OTE reference and FVG CE50 are derived from confirmed closed-candle swings. They do not independently qualify or veto a trade.'
  };
}

function geometryPatterns(c, pv, a14, tolerance) {
  const out = [];
  if (c.length < 20 || pv.highs.length < 2 || pv.lows.length < 2) return out;
  const last = c.at(-1);
  const highs = pv.highs.slice(-4), lows = pv.lows.slice(-4);
  const hf = linearFit(highs), lf = linearFit(lows);
  const slopeTol = Math.max((a14 || 0) * 0.025, last.close * 0.00003);
  if (hf && lf) {
    const start = Math.max(Math.min(...highs.map(x => x.index)), Math.min(...lows.map(x => x.index)));
    const end = Math.min(Math.max(...highs.map(x => x.index)), Math.max(...lows.map(x => x.index)));
    const spreadStart = hf.at(start) - lf.at(start);
    const spreadEnd = hf.at(end) - lf.at(end);
    const converging = spreadStart > 0 && spreadEnd > 0 && spreadEnd <= spreadStart * 0.82;
    const highFlat = Math.abs(hf.slope) <= slopeTol;
    const lowFlat = Math.abs(lf.slope) <= slopeTol;
    if (highFlat && lf.slope > slopeTol && converging) out.push({ type:'ASCENDING_TRIANGLE', side:'LONG', status:'FORMING', at:last.closeTime });
    if (lowFlat && hf.slope < -slopeTol && converging) out.push({ type:'DESCENDING_TRIANGLE', side:'SHORT', status:'FORMING', at:last.closeTime });
    if (hf.slope < -slopeTol && lf.slope > slopeTol && converging) out.push({ type:'SYMMETRICAL_TRIANGLE', side:'NEUTRAL', status:'FORMING', at:last.closeTime });
    if (hf.slope > slopeTol && lf.slope > slopeTol && converging) out.push({ type:'RISING_WEDGE', side:'SHORT', status:'FORMING', at:last.closeTime });
    if (hf.slope < -slopeTol && lf.slope < -slopeTol && converging) out.push({ type:'FALLING_WEDGE', side:'LONG', status:'FORMING', at:last.closeTime });
    const parallel = Math.abs(hf.slope - lf.slope) <= slopeTol * 1.5 && !converging;
    if (parallel && hf.slope > slopeTol) out.push({ type:'RISING_CHANNEL', side:'LONG', status:'FORMING', at:last.closeTime });
    if (parallel && hf.slope < -slopeTol) out.push({ type:'FALLING_CHANNEL', side:'SHORT', status:'FORMING', at:last.closeTime });
    if (highFlat && lowFlat) out.push({ type:'RANGE', side:'NEUTRAL', status:'FORMING', at:last.closeTime });
  }
  const eqHigh = equalLevel(pv.highs, tolerance), eqLow = equalLevel(pv.lows, tolerance);
  if (eqHigh && pv.lows.length) {
    const neck = pv.lows.at(-1).price;
    out.push({ type:'DOUBLE_TOP', side:'SHORT', status:last.close < neck ? 'CONFIRMED' : 'FORMING', neckline:round(neck), at:last.closeTime });
  }
  if (eqLow && pv.highs.length) {
    const neck = pv.highs.at(-1).price;
    out.push({ type:'DOUBLE_BOTTOM', side:'LONG', status:last.close > neck ? 'CONFIRMED' : 'FORMING', neckline:round(neck), at:last.closeTime });
  }
  const h3 = pv.highs.slice(-3), l3 = pv.lows.slice(-3);
  if (h3.length === 3 && l3.length >= 2) {
    const [a,b,d] = h3;
    const shoulders = Math.abs(a.price - d.price) <= tolerance * 1.8;
    if (shoulders && b.price > Math.max(a.price, d.price) + tolerance) {
      const neck = (l3.at(-1).price + l3.at(-2).price) / 2;
      out.push({ type:'HEAD_AND_SHOULDERS', side:'SHORT', status:last.close < neck ? 'CONFIRMED' : 'FORMING', neckline:round(neck), at:last.closeTime });
    }
  }
  if (l3.length === 3 && h3.length >= 2) {
    const [a,b,d] = l3;
    const shoulders = Math.abs(a.price - d.price) <= tolerance * 1.8;
    if (shoulders && b.price < Math.min(a.price, d.price) - tolerance) {
      const neck = (h3.at(-1).price + h3.at(-2).price) / 2;
      out.push({ type:'INVERSE_HEAD_AND_SHOULDERS', side:'LONG', status:last.close > neck ? 'CONFIRMED' : 'FORMING', neckline:round(neck), at:last.closeTime });
    }
  }
  return out;
}
function continuationPatterns(c, a14) {
  if (c.length < 12 || !(a14 > 0)) return [];
  const out = [];
  const w = c.slice(-12);
  let impulseIndex = -1, impulseSide = null, impulseRange = 0;
  for (let i = 0; i < 8; i++) {
    const x = w[i], shape = candleShape(x, a14), range = x.high - x.low;
    if (range >= a14 * 1.5 && shape.bodyPct >= 65 && range > impulseRange) {
      impulseIndex = i; impulseSide = shape.direction; impulseRange = range;
    }
  }
  if (impulseIndex < 0 || !['BULL','BEAR'].includes(impulseSide)) return out;
  const rest = w.slice(impulseIndex + 1);
  if (rest.length < 3) return out;
  const hi = Math.max(...rest.map(x => x.high)), lo = Math.min(...rest.map(x => x.low));
  const consRange = hi - lo;
  const drift = rest.at(-1).close - rest[0].open;
  const compressed = consRange <= impulseRange * 0.80;
  if (!compressed) return out;
  if (impulseSide === 'BULL' && drift <= impulseRange * 0.35) out.push({ type:'BULL_FLAG_OR_PENNANT', side:'LONG', status:'FORMING', at:c.at(-1).closeTime });
  if (impulseSide === 'BEAR' && drift >= -impulseRange * 0.35) out.push({ type:'BEAR_FLAG_OR_PENNANT', side:'SHORT', status:'FORMING', at:c.at(-1).closeTime });
  return out;
}
function detectPatterns(c, a14, high = null, low = null, pv = null, tolerance = null) {
  if (c.length < 4) return [];
  const out = [];
  const last = c.at(-1), prev = c.at(-2), p2 = c.at(-3);
  const ls = candleShape(last, a14), ps = candleShape(prev, a14), p2s = candleShape(p2, a14);
  if (ls.bodyPct <= 10) out.push({ type:'DOJI', side:'NEUTRAL', status:'CONFIRMED', at:last.closeTime });
  if (ls.bodyPct >= 80 && ls.upperWickPct <= 12 && ls.lowerWickPct <= 12) out.push({ type:'MARUBOZU', side:ls.direction === 'BULL' ? 'LONG' : ls.direction === 'BEAR' ? 'SHORT' : 'NEUTRAL', status:'CONFIRMED', at:last.closeTime });
  const bullishEngulf = last.close > last.open && prev.close < prev.open && last.open <= prev.close && last.close >= prev.open;
  const bearishEngulf = last.close < last.open && prev.close > prev.open && last.open >= prev.close && last.close <= prev.open;
  if (bullishEngulf) out.push({ type:'BULLISH_ENGULFING', side:'LONG', status:'CONFIRMED', at:last.closeTime });
  if (bearishEngulf) out.push({ type:'BEARISH_ENGULFING', side:'SHORT', status:'CONFIRMED', at:last.closeTime });
  const bullishHarami = p2.close < p2.open && last.close > last.open && Math.max(last.open,last.close) < p2.open && Math.min(last.open,last.close) > p2.close;
  const bearishHarami = p2.close > p2.open && last.close < last.open && Math.max(last.open,last.close) < p2.close && Math.min(last.open,last.close) > p2.open;
  if (bullishHarami) out.push({ type:'BULLISH_HARAMI', side:'LONG', status:'CONFIRMED', at:last.closeTime });
  if (bearishHarami) out.push({ type:'BEARISH_HARAMI', side:'SHORT', status:'CONFIRMED', at:last.closeTime });
  if (ls.lowerWickPct >= 55 && ls.bodyPct <= 35 && last.close >= last.open) out.push({ type:'HAMMER_REJECTION', side:'LONG', status:'CONFIRMED', at:last.closeTime });
  if (ls.upperWickPct >= 55 && ls.bodyPct <= 35 && last.close <= last.open) out.push({ type:'SHOOTING_STAR_REJECTION', side:'SHORT', status:'CONFIRMED', at:last.closeTime });
  if (last.high < prev.high && last.low > prev.low) out.push({ type:'INSIDE_BAR', side:'NEUTRAL', status:'FORMING', at:last.closeTime });
  if (last.high > prev.high && last.low < prev.low) out.push({ type:'OUTSIDE_BAR', side:ls.direction === 'BULL' ? 'LONG' : ls.direction === 'BEAR' ? 'SHORT' : 'NEUTRAL', status:'CONFIRMED', at:last.closeTime });
  const midpoint2 = (p2.open + p2.close) / 2;
  if (p2s.direction === 'BEAR' && p2s.bodyPct >= 55 && ps.bodyPct <= 30 && ls.direction === 'BULL' && last.close > midpoint2) out.push({ type:'MORNING_STAR', side:'LONG', status:'CONFIRMED', at:last.closeTime });
  if (p2s.direction === 'BULL' && p2s.bodyPct >= 55 && ps.bodyPct <= 30 && ls.direction === 'BEAR' && last.close < midpoint2) out.push({ type:'EVENING_STAR', side:'SHORT', status:'CONFIRMED', at:last.closeTime });
  const last3 = c.slice(-3);
  if (last3.every(x => x.close > x.open) && last3[0].close < last3[1].close && last3[1].close < last3[2].close) out.push({ type:'THREE_WHITE_SOLDIERS', side:'LONG', status:'CONFIRMED', at:last.closeTime });
  if (last3.every(x => x.close < x.open) && last3[0].close > last3[1].close && last3[1].close > last3[2].close) out.push({ type:'THREE_BLACK_CROWS', side:'SHORT', status:'CONFIRMED', at:last.closeTime });
  const recent = c.slice(-8);
  const ranges = recent.map(x => x.high - x.low);
  const oldAvg = ranges.slice(0, 4).reduce((s, x) => s + x, 0) / 4;
  const newAvg = ranges.slice(-4).reduce((s, x) => s + x, 0) / 4;
  if (oldAvg > 0 && newAvg / oldAvg <= 0.65) out.push({ type:'VOLATILITY_COMPRESSION', side:'NEUTRAL', status:'FORMING', at:last.closeTime });
  if (a14 && (last.high - last.low) >= 1.5 * a14 && ls.bodyPct >= 65) out.push({ type:'DISPLACEMENT', side:ls.direction === 'BULL' ? 'LONG' : 'SHORT', status:'CONFIRMED', at:last.closeTime });
  if (Number.isFinite(high)) {
    if (last.high > high && last.close < high) out.push({ type:'BUY_SIDE_SWEEP_REJECT', side:'SHORT', status:'CONFIRMED', level:round(high), at:last.closeTime });
    if (last.close > high && last.low <= high + (tolerance || 0)) out.push({ type:'RESISTANCE_FLIP_ACCEPTANCE', side:'LONG', status:'CONFIRMED', level:round(high), at:last.closeTime });
  }
  if (Number.isFinite(low)) {
    if (last.low < low && last.close > low) out.push({ type:'SELL_SIDE_SWEEP_RECLAIM', side:'LONG', status:'CONFIRMED', level:round(low), at:last.closeTime });
    if (last.close < low && last.high >= low - (tolerance || 0)) out.push({ type:'SUPPORT_FLIP_ACCEPTANCE', side:'SHORT', status:'CONFIRMED', level:round(low), at:last.closeTime });
  }
  if (pv && tolerance) out.push(...geometryPatterns(c, pv, a14, tolerance));
  out.push(...continuationPatterns(c, a14));
  const unique = new Map();
  for (const p of out) unique.set(`${p.type}:${p.side}:${p.status}`, p);
  return [...unique.values()];
}
function opportunity(c, frame, a14, context) {
  if (c.length < 20 || !a14) return { available:false, reason:'INSUFFICIENT_CLOSED_CANDLES' };
  const last = c.at(-1);
  const patterns = context.patterns || [];
  let longScore = 0, shortScore = 0;
  if (context.trend === 'UP') longScore += 18;
  if (context.trend === 'DOWN') shortScore += 18;
  if (context.swingStructure?.state === 'BULLISH') longScore += 10;
  if (context.swingStructure?.state === 'BEARISH') shortScore += 10;
  if (['BOS_UP','CHOCH_UP'].includes(context.swingStructure?.event)) longScore += context.swingStructure.event === 'CHOCH_UP' ? 12 : 8;
  if (['BOS_DOWN','CHOCH_DOWN'].includes(context.swingStructure?.event)) shortScore += context.swingStructure.event === 'CHOCH_DOWN' ? 12 : 8;
  if (context.breakOfStructure === 'UP') longScore += 20;
  if (context.breakOfStructure === 'DOWN') shortScore += 20;
  for (const p of patterns) {
    let weight = p.status === 'CONFIRMED' ? 7 : 3;
    if (['DISPLACEMENT','SELL_SIDE_SWEEP_RECLAIM','BUY_SIDE_SWEEP_REJECT','RESISTANCE_FLIP_ACCEPTANCE','SUPPORT_FLIP_ACCEPTANCE'].includes(p.type)) weight += 5;
    if (['ASCENDING_TRIANGLE','DESCENDING_TRIANGLE','SYMMETRICAL_TRIANGLE','RISING_WEDGE','FALLING_WEDGE','BULL_FLAG_OR_PENNANT','BEAR_FLAG_OR_PENNANT','DOUBLE_TOP','DOUBLE_BOTTOM','HEAD_AND_SHOULDERS','INVERSE_HEAD_AND_SHOULDERS'].includes(p.type)) weight += p.status === 'CONFIRMED' ? 5 : 2;
    if (p.side === 'LONG') longScore += weight;
    if (p.side === 'SHORT') shortScore += weight;
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
    available:true, frame, originEligible:true, ownerEligible:true,
    preferredSide:preferred, state,
    longScore:long, shortScore:short,
    asOf:last.closeTime,
    note:'Opportunity scores are advisory context; execution remains deterministic and DRY-RUN until explicitly enabled.'
  };
}
function structure(c, frame = null) {
  if (c.length < 52) return { available:false, reason:'INSUFFICIENT_CLOSED_CANDLES', closedCandles:c.length };
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
    if (b.low > a.high) gaps.push({ side:'BULL', low:a.high, high:b.low, at:b.closeTime });
    if (b.high < a.low) gaps.push({ side:'BEAR', low:b.high, high:a.low, at:b.closeTime });
  }
  const window = c.slice(-40);
  const pv = pivots(window);
  const tolerance = Math.max((a14 || 0) * 0.15, last.close * 0.0005);
  const eqHigh = equalLevel(pv.highs, tolerance);
  const eqLow = equalLevel(pv.lows, tolerance);
  let lastSweep = null;
  if (eqLow && last.low < eqLow.price && last.close > eqLow.price) lastSweep = 'SELL_SIDE_RECLAIM';
  if (eqHigh && last.high > eqHigh.price && last.close < eqHigh.price) lastSweep = 'BUY_SIDE_REJECT';
  const swings = swingStructure(pv, tolerance, last.close);
  const patterns = detectPatterns(c, a14, high, low, pv, tolerance);
  const base = {
    available:true, frame, asOf:last.closeTime, closedCandles:c.length,
    close:round(last.close), ema20:round(e20), ema50:round(e50),
    rsi14:round(rsi(close), 2), atr14:round(a14), atrPct:round(a14 / last.close * 100, 3),
    trend:direction, prior20High:round(high), prior20Low:round(low),
    breakOfStructure:breaksHigh ? 'UP' : breaksLow ? 'DOWN' : null,
    buySideLiquidity:round(high), sellSideLiquidity:round(low),
    recentFairValueGaps:gaps.slice(-3).map(g => ({ ...g, low:round(g.low), high:round(g.high), ce50:round((g.low+g.high)/2) })),
    returnPct:round((last.close / c.at(-6).close - 1) * 100, 3),
    candle:candleShape(last, a14),
    patterns,
    swingStructure:swings,
    liquidity:{ equalHigh:eqHigh, equalLow:eqLow, lastSweep }
  };
  base.smcContext = smcContext(swings, last.close, gaps);
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
    } catch (e) { out[frame] = { available:false, reason:String(e.message || e) }; }
  }
  return out;
}
function breakoutExecution({ side, confirmedClose, trigger, livePrice, reclaimConfirmed = false }) {
  const cc = finite(confirmedClose), t = finite(trigger), lp = finite(livePrice);
  if (!['LONG','SHORT'].includes(side) || [cc,t,lp].some(x => x === null)) return { allowed:false, status:'INVALID_INPUT' };
  const confirmed = side === 'LONG' ? cc > t : cc < t;
  if (!confirmed) return { allowed:false, status:'WAIT_CONFIRMATION' };
  const lost = side === 'LONG' ? lp < t : lp > t;
  if (lost && !reclaimConfirmed) return { allowed:false, status:'FAILED_BREAKOUT', waitFor:'5M_RECLAIM_OR_VALID_ALTERNATE_PATH' };
  return { allowed:true, status:reclaimConfirmed ? 'RECLAIMED' : 'ACCEPTED' };
}
function microstructure(depth, trades, previousDepth = null, now = Date.now()) {
  const levels = side => Array.isArray(side) ? side.slice(0, 20).map(x => [finite(x[0]), finite(x[1])]).filter(x => x[0] > 0 && x[1] > 0) : [];
  const bids = levels(depth?.bids), asks = levels(depth?.asks);
  if (!bids.length || !asks.length) return { available:false, reason:'NO_DEPTH' };
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
    available:true, asOf:now, bid:round(bid), ask:round(ask),
    spreadBps:round((ask - bid) / mid * 10000, 3),
    depth20Imbalance:round(imbalance, 4),
    cvdSampleQuote:validTrades.length ? round(cvdSample, 2) : null,
    cvdSampleTrades:validTrades.length,
    cvdWindow:'returned recent aggTrades, at most 120s; not continuous CVD',
    ofiProxyQuote:ofiProxy === null ? null : round(ofiProxy, 2),
    ofiNote:'two REST snapshots with unchanged best prices; not sequenced order-flow imbalance',
    snapshot:{ at:now, bid, ask, bidNotional, askNotional }
  };
}
function handoff(initialStop, candidateStop, side) {
  if (!Number.isFinite(initialStop) || !Number.isFinite(candidateStop)) return { allowed:false, reason:'INVALID_STOP' };
  const safe = side === 'LONG' ? candidateStop >= initialStop : side === 'SHORT' ? candidateStop <= initialStop : false;
  return { allowed:safe, stop:safe ? candidateStop : initialStop, reason:safe ? 'RISK_NOT_WIDENED' : 'WOULD_WIDEN_RISK' };
}
module.exports = { FRAMES, NATIVE_FRAMES, parseKlines, aggregate45m, candleShape, pivots, swingStructure, smcContext, detectPatterns, structure, analyzeFrames, breakoutExecution, microstructure, handoff };
