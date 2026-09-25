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
function swingStructure(pv, tolerance, lastClose, lastIndex = null, lastAt = null) {
  const h = pv.highs.slice(-6), l = pv.lows.slice(-6);
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

  // R2541_CONFIRMED_SWING_TRENDLINES: trend çizgisi yalnız teyitli kapalı-mum pivotlarından gelir.
  // Yükseliş desteği = son iki teyitli higher-low; düşüş direnci = son iki teyitli lower-high.
  // Son kapanış çizgiyi yapısal toleransın ötesinde kırdıysa çizgi artık aktif değildir.
  const endIndex=Number.isInteger(lastIndex)?lastIndex:Math.max(
    lastHigh?.index??0,lastLow?.index??0,h.at(-1)?.index??0,l.at(-1)?.index??0
  );
  const makeTrendLine=(a,b,kind)=>{
    if(!a||!b||!(b.index>a.index))return null;
    const slope=(b.price-a.price)/(b.index-a.index);
    const projected=b.price+slope*Math.max(0,endIndex-b.index);
    const active=kind==='UP_SUPPORT'
      ? lastClose>=projected-tolerance*0.15
      : lastClose<=projected+tolerance*0.15;
    return {
      kind,active,
      source:'CONFIRMED_PIVOTS_CLOSED_CANDLES',
      from:{index:a.index,price:round(a.price),at:a.at},
      to:{index:b.index,price:round(b.price),at:b.at},
      projected:{index:endIndex,price:round(projected),at:lastAt||null},
      invalidatedByClose:active?null:round(lastClose)
    };
  };
  const lowA=l.at(-2),lowB=l.at(-1),highA=h.at(-2),highB=h.at(-1);
  const upSupport=lowA&&lowB&&lowB.price>lowA.price+tolerance ? makeTrendLine(lowA,lowB,'UP_SUPPORT') : null;
  const downResistance=highA&&highB&&highB.price<highA.price-tolerance ? makeTrendLine(highA,highB,'DOWN_RESISTANCE') : null;
  return {
    state,
    highSequence:highSeq === 1 ? 'HH' : highSeq === -1 ? 'LH' : highSeq === 0 ? 'EH' : 'UNKNOWN',
    lowSequence:lowSeq === 1 ? 'HL' : lowSeq === -1 ? 'LL' : lowSeq === 0 ? 'EL' : 'UNKNOWN',
    lastConfirmedSwingHigh:lastHigh ? { index:lastHigh.index, price:round(lastHigh.price), at:lastHigh.at } : null,
    lastConfirmedSwingLow:lastLow ? { index:lastLow.index, price:round(lastLow.price), at:lastLow.at } : null,
    confirmedPivots:{
      highs:h.map(x=>({index:x.index,price:round(x.price),at:x.at})),
      lows:l.map(x=>({index:x.index,price:round(x.price),at:x.at}))
    },
    trendLines:{upSupport,downResistance},
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
  const bandZone=position < 0.45 ? 'DISCOUNT' : position > 0.55 ? 'PREMIUM' : 'EQUILIBRIUM';
  const zone=position < 0 ? 'BELOW_RANGE_EXTENSION' : position > 1 ? 'ABOVE_RANGE_EXTENSION' : bandZone;
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
  // CLAUDE_V113_JEV_FULL_EVIDENCE: son onaylı swing bacağından Fibonacci düzeltme/uzatma seviyeleri.
  // Bacak yönü: hangi swing daha yeni ise (düşük→yüksek = yükseliş bacağı; düzeltme tepeden ölçülür).
  const highAt=Number(swings?.lastConfirmedSwingHigh?.at)||0, lowAt=Number(swings?.lastConfirmedSwingLow?.at)||0;
  const upLeg=highAt>=lowAt; // eşit/eksik zaman damgası → yükseliş bacağı varsayılır (leg etiketi belirtir)
  const lvl=r=>round(upLeg?high-range*r:low+range*r);
  const ext=r=>round(upLeg?low+range*r:high-range*r);
  const fibLevels={
    leg:upLeg?'UP_LEG_LOW_TO_HIGH':'DOWN_LEG_HIGH_TO_LOW',
    retracement:{ '0.236':lvl(0.236), '0.382':lvl(0.382), '0.5':lvl(0.5), '0.618':lvl(0.618), '0.705':lvl(0.705), '0.786':lvl(0.786) },
    extension:{ '1.272':ext(1.272), '1.618':ext(1.618) },
    pricePositionPct:round((upLeg?(high-lastClose):(lastClose-low))/range*100,2),
    semantics:'REFERENCE_LEVELS_FROM_CONFIRMED_SWINGS'
  };
  return {
    available:true,
    source:'CONFIRMED_SWING_RANGE_FROM_CLOSED_CANDLES',
    fibLevels,
    swingEvent:swings?.event || null,
    swingState:swings?.state || null,
    dealingRange:{
      low:round(low),
      high:round(high),
      equilibrium:round(equilibrium),
      positionPct:round(position*100,2),
      zone,
      bandZone,
      insideRange:position>=0&&position<=1
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
  const point=(index,price)=>({index,price:round(price),at:c[index]?.closeTime||null});
  const lineFromFit=(fit,start,end,role)=>({role,from:point(start,fit.at(start)),to:point(end,fit.at(end))});
  const fitGeometry=(start,end)=>({
    source:'CONFIRMED_PIVOT_GEOMETRY_CLOSED_CANDLES',
    lines:[lineFromFit(hf,start,end,'UPPER'),lineFromFit(lf,start,end,'LOWER')],
    pivots:[
      ...highs.map(x=>({role:'HIGH',index:x.index,price:round(x.price),at:x.at})),
      ...lows.map(x=>({role:'LOW',index:x.index,price:round(x.price),at:x.at}))
    ]
  });
  if (hf && lf) {
    const start = Math.max(Math.min(...highs.map(x => x.index)), Math.min(...lows.map(x => x.index)));
    const fitEnd = Math.min(Math.max(...highs.map(x => x.index)), Math.max(...lows.map(x => x.index)));
    const drawEnd = c.length - 1;
    const spreadStart = hf.at(start) - lf.at(start);
    const spreadEnd = hf.at(fitEnd) - lf.at(fitEnd);
    const converging = spreadStart > 0 && spreadEnd > 0 && spreadEnd <= spreadStart * 0.82;
    const highFlat = Math.abs(hf.slope) <= slopeTol;
    const lowFlat = Math.abs(lf.slope) <= slopeTol;
    const push=(type,side)=>out.push({type,side,status:'FORMING',at:last.closeTime,geometry:fitGeometry(start,drawEnd)});
    if (highFlat && lf.slope > slopeTol && converging) push('ASCENDING_TRIANGLE','LONG');
    if (lowFlat && hf.slope < -slopeTol && converging) push('DESCENDING_TRIANGLE','SHORT');
    if (hf.slope < -slopeTol && lf.slope > slopeTol && converging) push('SYMMETRICAL_TRIANGLE','NEUTRAL');
    if (hf.slope > slopeTol && lf.slope > slopeTol && converging) push('RISING_WEDGE','SHORT');
    if (hf.slope < -slopeTol && lf.slope < -slopeTol && converging) push('FALLING_WEDGE','LONG');
    const parallel = Math.abs(hf.slope - lf.slope) <= slopeTol * 1.5 && !converging;
    if (parallel && hf.slope > slopeTol) push('RISING_CHANNEL','LONG');
    if (parallel && hf.slope < -slopeTol) push('FALLING_CHANNEL','SHORT');
    if (highFlat && lowFlat) push('RANGE','NEUTRAL');
  }
  const eqHigh = equalLevel(pv.highs, tolerance), eqLow = equalLevel(pv.lows, tolerance);
  if (eqHigh && pv.lows.length) {
    const a=pv.highs.at(-2),b=pv.highs.at(-1),neckPv=pv.lows.at(-1),neck=neckPv.price;
    out.push({ type:'DOUBLE_TOP', side:'SHORT', status:last.close < neck ? 'CONFIRMED' : 'FORMING', neckline:round(neck), at:last.closeTime,
      geometry:{source:'CONFIRMED_PIVOT_GEOMETRY_CLOSED_CANDLES',pivots:[a,b,neckPv].filter(Boolean).map((x,i)=>({role:i<2?'TOP':'NECK',index:x.index,price:round(x.price),at:x.at})),lines:[]}
    });
  }
  if (eqLow && pv.highs.length) {
    const a=pv.lows.at(-2),b=pv.lows.at(-1),neckPv=pv.highs.at(-1),neck=neckPv.price;
    out.push({ type:'DOUBLE_BOTTOM', side:'LONG', status:last.close > neck ? 'CONFIRMED' : 'FORMING', neckline:round(neck), at:last.closeTime,
      geometry:{source:'CONFIRMED_PIVOT_GEOMETRY_CLOSED_CANDLES',pivots:[a,b,neckPv].filter(Boolean).map((x,i)=>({role:i<2?'BOTTOM':'NECK',index:x.index,price:round(x.price),at:x.at})),lines:[]}
    });
  }
  const h3 = pv.highs.slice(-3), l3 = pv.lows.slice(-3);
  if (h3.length === 3 && l3.length >= 2) {
    const [a,b,d] = h3;
    const shoulders = Math.abs(a.price - d.price) <= tolerance * 1.8;
    if (shoulders && b.price > Math.max(a.price, d.price) + tolerance) {
      const neckA=l3.at(-2),neckB=l3.at(-1),neck = (neckB.price + neckA.price) / 2;
      out.push({ type:'HEAD_AND_SHOULDERS', side:'SHORT', status:last.close < neck ? 'CONFIRMED' : 'FORMING', neckline:round(neck), at:last.closeTime,
        geometry:{source:'CONFIRMED_PIVOT_GEOMETRY_CLOSED_CANDLES',pivots:[a,b,d,neckA,neckB].map((x,i)=>({role:i<3?'TOP':'NECK',index:x.index,price:round(x.price),at:x.at})),lines:[]}
      });
    }
  }
  if (l3.length === 3 && h3.length >= 2) {
    const [a,b,d] = l3;
    const shoulders = Math.abs(a.price - d.price) <= tolerance * 1.8;
    if (shoulders && b.price < Math.min(a.price, d.price) - tolerance) {
      const neckA=h3.at(-2),neckB=h3.at(-1),neck = (neckB.price + neckA.price) / 2;
      out.push({ type:'INVERSE_HEAD_AND_SHOULDERS', side:'LONG', status:last.close > neck ? 'CONFIRMED' : 'FORMING', neckline:round(neck), at:last.closeTime,
        geometry:{source:'CONFIRMED_PIVOT_GEOMETRY_CLOSED_CANDLES',pivots:[a,b,d,neckA,neckB].map((x,i)=>({role:i<3?'BOTTOM':'NECK',index:x.index,price:round(x.price),at:x.at})),lines:[]}
      });
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
// CLAUDE_V113_JEV_FULL_EVIDENCE: deterministik order block. Kural: gövdesi ≥1,2 ATR olan ve önceki
// 10 mumun zirvesini/dibini kapanışla kıran yer değiştirme mumundan önceki (≤5 mum) son TERS renkli mum.
// Boğa OB = [low, open] (ayı mumu), ayı OB = [open, high] (boğa mumu). Mitigated = fiyat bölgeye döndü;
// broken = kapanış bölgenin ötesine geçti. Yalnız yumuşak bağlamdır.
function orderBlocks(c, a14) {
  const out = { bullish:[], bearish:[] };
  if (!Array.isArray(c) || c.length < 20 || !(a14 > 0)) return out;
  const last = c.at(-1);
  for (let i = c.length - 1; i >= Math.max(11, c.length - 80) && (out.bullish.length < 4 || out.bearish.length < 4); i--) {
    const k = c[i], body = k.close - k.open;
    const prev = c.slice(i - 10, i);
    const upBreak = body >= 1.2 * a14 && k.close > Math.max(...prev.map(x => x.high));
    const downBreak = -body >= 1.2 * a14 && k.close < Math.min(...prev.map(x => x.low));
    if (!upBreak && !downBreak) continue;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const o = c[j];
      if (upBreak && o.close < o.open && out.bullish.length < 4) {
        const zone = { low:o.low, high:o.open };
        const after = c.slice(i + 1);
        out.bullish.push({ side:'BULL', low:round(zone.low), high:round(zone.high), at:o.closeTime, displacementAt:k.closeTime,
          mitigated:after.some(x => x.low <= zone.high), broken:after.some(x => x.close < zone.low),
          distancePct:round((last.close - zone.high) / last.close * 100, 3) });
        break;
      }
      if (downBreak && o.close > o.open && out.bearish.length < 4) {
        const zone = { low:o.open, high:o.high };
        const after = c.slice(i + 1);
        out.bearish.push({ side:'BEAR', low:round(zone.low), high:round(zone.high), at:o.closeTime, displacementAt:k.closeTime,
          mitigated:after.some(x => x.high >= zone.low), broken:after.some(x => x.close > zone.high),
          distancePct:round((zone.low - last.close) / last.close * 100, 3) });
        break;
      }
    }
  }
  // Aynı mumdan çıkan tekrarlar atılır; bozulmamış bloklar önce.
  const tidy = list => [...new Map(list.map(o => [o.at, o])).values()].sort((a, b) => Number(a.broken) - Number(b.broken)).slice(0, 2);
  return { bullish:tidy(out.bullish), bearish:tidy(out.bearish) };
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
  // R2541_PIVOT_ABSOLUTE_INDEX: pivots() window-relative indeks üretir.
  // Renderer/time-axis ve trend projection için bunları tekrar tam candle dizisi indeksine taşı.
  const pivotOffset = c.length - window.length;
  const rawPv = pivots(window);
  const pv = {
    highs: rawPv.highs.map(x => ({ ...x, index:x.index + pivotOffset })),
    lows: rawPv.lows.map(x => ({ ...x, index:x.index + pivotOffset }))
  };
  const tolerance = Math.max((a14 || 0) * 0.15, last.close * 0.0005);
  const eqHigh = equalLevel(pv.highs, tolerance);
  const eqLow = equalLevel(pv.lows, tolerance);
  let lastSweep = null;
  if (eqLow && last.low < eqLow.price && last.close > eqLow.price) lastSweep = 'SELL_SIDE_RECLAIM';
  if (eqHigh && last.high > eqHigh.price && last.close < eqHigh.price) lastSweep = 'BUY_SIDE_REJECT';
  const swings = swingStructure(pv, tolerance, last.close, c.length-1, last.closeTime);
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
  base.orderBlocks = orderBlocks(c, a14);
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
function triggerLevelCandidates(frame, side) {
  const s=String(side||'').toUpperCase();
  if(!frame?.available||!['LONG','SHORT'].includes(s))return [];
  const out=[];
  const add=(id,price,source,uses=['TRIGGER','INVALIDATION'])=>{
    const p=finite(price);
    if(p===null||p<=0)return;
    if(out.some(x=>x.id===id))return;
    out.push({id,price:round(p),source,uses:[...uses]});
  };
  add('PRIOR20_HIGH',frame.prior20High,'PRIOR20',['LONG_TRIGGER','SHORT_INVALIDATION']);
  add('PRIOR20_LOW',frame.prior20Low,'PRIOR20',['SHORT_TRIGGER','LONG_INVALIDATION']);
  const dr=frame?.smcContext?.dealingRange;
  add('SWING_HIGH',dr?.high,'CONFIRMED_SWING_RANGE',['LONG_TRIGGER','SHORT_INVALIDATION']);
  add('SWING_LOW',dr?.low,'CONFIRMED_SWING_RANGE',['SHORT_TRIGGER','LONG_INVALIDATION']);
  const fvg=Array.isArray(frame?.liquidity?.fairValueGaps)?frame.liquidity.fairValueGaps:[];
  const bull=[...fvg].reverse().find(x=>String(x?.side||'').toUpperCase()==='BULL');
  const bear=[...fvg].reverse().find(x=>String(x?.side||'').toUpperCase()==='BEAR');
  add('FVG_CE50_BULL',bull?.ce50,'FVG_CE50',['LONG_TRIGGER','LONG_INVALIDATION']);
  add('FVG_CE50_BEAR',bear?.ce50,'FVG_CE50',['SHORT_TRIGGER','SHORT_INVALIDATION']);
  const ote=frame?.smcContext?.oteReference;
  add('OTE_LONG_HIGH',ote?.longDiscountZone?.high,'OTE_REFERENCE',['LONG_TRIGGER']);
  add('OTE_LONG_LOW',ote?.longDiscountZone?.low,'OTE_REFERENCE',['LONG_INVALIDATION']);
  add('OTE_SHORT_LOW',ote?.shortPremiumZone?.low,'OTE_REFERENCE',['SHORT_TRIGGER']);
  add('OTE_SHORT_HIGH',ote?.shortPremiumZone?.high,'OTE_REFERENCE',['SHORT_INVALIDATION']);
  return out.filter(x=>x.uses.includes(s+'_TRIGGER')||x.uses.includes(s+'_INVALIDATION'));
}

function resolveTriggerLevel(frame, side, id, use='TRIGGER') {
  const s=String(side||'').toUpperCase();
  const wanted=String(id||'').trim().toUpperCase();
  const tag=s+'_'+String(use||'TRIGGER').toUpperCase();
  return triggerLevelCandidates(frame,s).find(x=>x.id===wanted&&x.uses.includes(tag))||null;
}

function triggerSatisfied({side,closedPrice,levelPrice}={}) {
  const s=String(side||'').toUpperCase();
  const c=finite(closedPrice),l=finite(levelPrice);
  if(!['LONG','SHORT'].includes(s)||c===null||l===null||l<=0)return false;
  return s==='LONG'?c>l:c<l;
}

function invalidationBreached({side,closedPrice,levelPrice}={}) {
  const s=String(side||'').toUpperCase();
  const c=finite(closedPrice),l=finite(levelPrice);
  if(!['LONG','SHORT'].includes(s)||c===null||l===null||l<=0)return false;
  return s==='LONG'?c<l:c>l;
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
module.exports = { FRAMES, NATIVE_FRAMES, parseKlines, aggregate45m, candleShape, pivots, swingStructure, smcContext, orderBlocks, detectPatterns, structure, analyzeFrames, triggerLevelCandidates, resolveTriggerLevel, triggerSatisfied, invalidationBreached, breakoutExecution, microstructure, handoff };
