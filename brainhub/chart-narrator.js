'use strict';
// CLAUDE_R2543_CHART_NARRATOR
// Grafik okuma beyni — DETERMINISTIK.
//
// Neden model yok: ölçülen gerçek, 4B yerel VLM'in aynı grafiği üç kez aynı cümleyle "okuduğu"
// (bkz. logs/claude-vision-e2e.log) ve bağımsız çalışmalarda VLM'lerin mum grafiğinde ~%51 yön
// doğruluğu gösterdiğidir. Bu modül grafiğin PİKSELİNİ değil, grafiği çizen KAPANMIŞ MUM
// sayılarını okur ve her turda aynı girdi için birebir aynı cümleyi üretir.
//
// Sözleşme:
//  * Bir cümle parçası yalnızca dayandığı sayısal alan gerçekten varsa yazılır. Eksik alan
//    atlanır; asla tahmin/uydurma yapılmaz, asla sıfırla doldurulmaz.
//  * Çıktı saf fonksiyondur: saat, rastgelelik, ağ, model yoktur. Aynı girdi -> aynı çıktı.
//  * Yorum katmanıdır, otorite değildir. Sayısal paket yine tek gerçektir; JEV nihai karar sahibidir.

const FRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

function finite(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function px(n) {
  if (n === null) return null;
  const a = Math.abs(n);
  if (a === 0) return '0';
  const digits = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : a >= 0.0001 ? 7 : 9;
  return Number(n.toFixed(digits)).toString();
}
function pct(n, d = 1) { return n === null ? null : Number(n.toFixed(d)).toString(); }

function rsiState(v) {
  if (v === null) return null;
  if (v < 30) return 'OVERSOLD';
  if (v < 45) return 'WEAK';
  if (v <= 55) return 'NEUTRAL';
  if (v <= 70) return 'STRONG';
  return 'OVERBOUGHT';
}
function volState(atrPct) {
  if (atrPct === null) return null;
  if (atrPct < 0.3) return 'VERY_LOW_VOLATILITY';
  if (atrPct < 0.8) return 'LOW_VOLATILITY';
  if (atrPct < 2) return 'NORMAL_VOLATILITY';
  if (atrPct < 5) return 'HIGH_VOLATILITY';
  return 'VERY_HIGH_VOLATILITY';
}
function emaStack(close, ema20, ema50) {
  if (close === null || ema20 === null || ema50 === null) return null;
  if (close > ema20 && ema20 > ema50) return 'PRICE_ABOVE_EMA20_ABOVE_EMA50';
  if (close < ema20 && ema20 < ema50) return 'PRICE_BELOW_EMA20_BELOW_EMA50';
  if (close > ema20 && ema20 <= ema50) return 'PRICE_ABOVE_EMA20_BUT_EMA20_BELOW_EMA50';
  if (close < ema20 && ema20 >= ema50) return 'PRICE_BELOW_EMA20_BUT_EMA20_ABOVE_EMA50';
  return 'PRICE_AT_EMA20';
}
function candleShape(c) {
  if (!c || typeof c !== 'object') return null;
  const body = finite(c.bodyPct), up = finite(c.upperWickPct), low = finite(c.lowerWickPct);
  const parts = [];
  if (body !== null) {
    if (body < 15) parts.push('DOJI_INDECISION');
    else if (body >= 70) parts.push('STRONG_BODY');
    else parts.push('MIXED_BODY');
  }
  if (up !== null && up >= 45) parts.push('LONG_UPPER_WICK_SELLERS_REJECTED_HIGHS');
  if (low !== null && low >= 45) parts.push('LONG_LOWER_WICK_BUYERS_REJECTED_LOWS');
  return parts.length ? parts.join(' + ') : null;
}
function candleSize(c) {
  const ra = finite(c && c.rangeAtr);
  if (ra === null) return null;
  if (ra >= 1.5) return 'WIDE_RANGE_vs_ATR';
  if (ra <= 0.5) return 'NARROW_RANGE_vs_ATR';
  return 'AVERAGE_RANGE_vs_ATR';
}
function distPct(from, to) {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}
function sideOf(price, low, high) {
  if (price === null || low === null || high === null) return null;
  if (price >= low && price <= high) return 'PRICE_INSIDE';
  return price < low ? 'ABOVE_PRICE' : 'BELOW_PRICE';
}
function nearestZone(list, price, kind) {
  if (!Array.isArray(list) || price === null) return null;
  let best = null;
  for (const z of list) {
    if (!z || typeof z !== 'object') continue;
    const low = finite(z.low), high = finite(z.high);
    if (low === null || high === null) continue;
    const mid = (low + high) / 2;
    const d = Math.abs(distPct(price, mid));
    if (d === null) continue;
    if (!best || d < best.distance) {
      best = {
        kind, side: z.side || null, low, high, ce50: finite(z.ce50),
        distance: d, where: sideOf(price, low, high),
        mitigated: z.mitigated === true, broken: z.broken === true
      };
    }
  }
  return best;
}
function zoneText(z) {
  if (!z) return null;
  const bits = [String(z.side || '?') + ' ' + z.kind, px(z.low) + '-' + px(z.high)];
  if (z.ce50 !== null && z.ce50 !== undefined) bits.push('CE50 ' + px(z.ce50));
  if (z.where) bits.push(z.where);
  bits.push(pct(z.distance, 2) + '% away');
  if (z.kind === 'OB') bits.push(z.broken ? 'broken' : (z.mitigated ? 'mitigated' : 'unmitigated'));
  return bits.join(' ');
}
function oteText(smc, price) {
  const ref = smc && smc.oteReference;
  if (!ref || price === null) return null;
  const l = ref.longDiscountZone, s = ref.shortPremiumZone;
  const lin = l && price >= finite(l.low) && price <= finite(l.high);
  const sin = s && price >= finite(s.low) && price <= finite(s.high);
  if (lin) return 'PRICE_INSIDE_LONG_DISCOUNT_OTE';
  if (sin) return 'PRICE_INSIDE_SHORT_PREMIUM_OTE';
  return 'PRICE_OUTSIDE_BOTH_OTE_ZONES';
}
function fibRead(smc, price) {
  const fl = smc && smc.fibLevels;
  if (!fl || price === null) return null;
  const ret = fl.retracement && typeof fl.retracement === 'object' ? fl.retracement : null;
  const ext = fl.extension && typeof fl.extension === 'object' ? fl.extension : null;
  let nearest = null;
  if (ret) {
    for (const [name, raw] of Object.entries(ret)) {
      const v = finite(raw);
      if (v === null) continue;
      const d = Math.abs(distPct(price, v));
      if (d === null) continue;
      if (!nearest || d < nearest.distance) nearest = { name, value: v, distance: d, where: price < v ? 'ABOVE_PRICE' : 'BELOW_PRICE' };
    }
  }
  const g618 = ret ? finite(ret['0.618']) : null;
  const g786 = ret ? finite(ret['0.786']) : null;
  let golden = null;
  if (g618 !== null && g786 !== null) {
    const lo = Math.min(g618, g786), hi = Math.max(g618, g786);
    golden = price >= lo && price <= hi ? 'PRICE_INSIDE_0.618-0.786_BAND' : 'PRICE_OUTSIDE_0.618-0.786_BAND';
  }
  return {
    leg: fl.leg || null, nearest, golden,
    positionPct: finite(fl.pricePositionPct),
    ext1272: ext ? finite(ext['1.272']) : null,
    ext1618: ext ? finite(ext['1.618']) : null
  };
}
function fibText(fr, { full }) {
  if (!fr) return null;
  const bits = [];
  if (fr.leg) bits.push(fr.leg);
  if (fr.nearest) bits.push('nearest level ' + fr.nearest.name + ' at ' + px(fr.nearest.value) + ' ' + fr.nearest.where + ' ' + pct(fr.nearest.distance, 2) + '% away');
  if (fr.golden) bits.push(fr.golden);
  if (full) {
    if (fr.positionPct !== null) bits.push('retracement position ' + pct(fr.positionPct) + '%');
    if (fr.ext1272 !== null) bits.push('extensions 1.272 ' + px(fr.ext1272) + (fr.ext1618 !== null ? ' / 1.618 ' + px(fr.ext1618) : ''));
  }
  return bits.length ? bits.join(', ') : null;
}
function patternText(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.slice(-3).map(p => {
    if (!p || typeof p !== 'object') return null;
    const t = p.type ? String(p.type) : null;
    if (!t) return null;
    const extra = [p.side, p.status].filter(Boolean).join('/');
    return extra ? t + '(' + extra + ')' : t;
  }).filter(Boolean).join(', ') || null;
}

function narrateFrame(tf, f, livePrice, opts) {
  const full = !opts || opts.full !== false;
  if (!f || f.available !== true) {
    return { tf, available: false, reason: (f && f.reason) || 'UNAVAILABLE', line: tf + ': no usable candles, nothing is read from this timeframe.' };
  }
  const close = finite(f.close);
  const price = livePrice !== null && livePrice !== undefined ? finite(livePrice) : close;
  const sw = f.swingStructure || {};
  const smc = f.smcContext || {};
  const dr = smc.dealingRange || null;
  const liq = f.liquidity || {};
  const c = f.candle || null;

  const flags = {
    fresh: f.fresh === true,
    trend: f.trend || null,
    swingState: sw.state || null,
    swingSeq: (sw.highSequence && sw.lowSequence) ? sw.highSequence + '/' + sw.lowSequence : null,
    event: sw.event || smc.swingEvent || f.breakOfStructure || null,
    zone: dr ? (dr.zone || null) : null,
    positionPct: dr ? finite(dr.positionPct) : null,
    rsiState: rsiState(finite(f.rsi14)),
    volState: volState(finite(f.atrPct)),
    emaStack: emaStack(close, finite(f.ema20), finite(f.ema50)),
    candleShape: candleShape(c),
    candleSize: candleSize(c),
    ote: oteText(smc, price)
  };


  const fvgSourceAll = Array.isArray(f.recentFairValueGaps) && f.recentFairValueGaps.length
    ? f.recentFairValueGaps : (liq.fairValueGaps || (smc && smc.fairValueGaps));
  const obsAll = [].concat(
    Array.isArray(f.orderBlocks && f.orderBlocks.bullish) ? f.orderBlocks.bullish : [],
    Array.isArray(f.orderBlocks && f.orderBlocks.bearish) ? f.orderBlocks.bearish : []
  );
  const cFvg = nearestZone(fvgSourceAll, price, 'FVG');
  const cOb = nearestZone(obsAll, price, 'OB');

  if (!full) {
    // Yan zaman dilimleri: tek satir, ayni deterministik sozlukle, fiyat tekrari olmadan.
    const bits = [];
    if (flags.trend) bits.push('trend ' + flags.trend + (flags.fresh ? '' : ' (STALE)'));
    if (flags.swingState) bits.push('structure ' + flags.swingState + (flags.swingSeq ? ' (' + flags.swingSeq + ')' : ''));
    if (flags.event) bits.push('last event ' + flags.event);
    if (flags.zone) bits.push('price ' + flags.zone + (flags.positionPct !== null ? ' ' + pct(flags.positionPct) + '% of range' : ''));
    if (flags.rsiState) bits.push('RSI ' + pct(finite(f.rsi14)) + ' ' + flags.rsiState);
    if (flags.volState) bits.push('ATR ' + pct(finite(f.atrPct), 2) + '% ' + flags.volState);
    if (c && flags.candleShape) bits.push('last candle ' + (c.direction || '?') + ' ' + flags.candleShape);
    if (flags.emaStack) bits.push(flags.emaStack);
    // Bu zaman dilimi ikincil diye FVG/OB/OTE/Fib gizlenmez; yalnizca daha kisa yazilir.
    if (cFvg) bits.push('nearest FVG ' + zoneText(cFvg));
    if (cOb) bits.push('nearest OB ' + zoneText(cOb));
    if (flags.ote) bits.push(flags.ote);
    const cFib = fibText(fibRead(smc, price), { full: false });
    if (cFib) bits.push('fib ' + cFib);
    const cPat = patternText(f.patterns);
    if (cPat) bits.push('patterns ' + cPat);
    return {
      tf, available: true, detail: 'COMPACT',
      flags: { fresh: flags.fresh, trend: flags.trend, zone: flags.zone, event: flags.event },
      line: tf + ': ' + (bits.join(', ') || 'no readable structure') + '.'
    };
  }

  const s = [];
  s.push(tf + ':');
  if (flags.trend) s.push('trend ' + flags.trend + (flags.fresh ? '' : ' (STALE CANDLE)') + '.');
  if (flags.swingState) {
    s.push('structure ' + flags.swingState + (flags.swingSeq ? ' (' + flags.swingSeq + ')' : '') +
      (flags.event ? ', last confirmed event ' + flags.event : ', no confirmed break yet') + '.');
  }
  if (flags.zone) {
    const inside = dr && dr.insideRange !== false;
    s.push((inside ? 'price sits in the ' + flags.zone + ' half of the confirmed range'
                   : 'price is OUTSIDE the confirmed range (' + flags.zone + ')') +
      (flags.positionPct !== null ? ' at ' + pct(flags.positionPct) + '% of range' : '') +
      (dr && finite(dr.low) !== null && finite(dr.high) !== null ? ' (' + px(finite(dr.low)) + '-' + px(finite(dr.high)) + ')' : '') + '.');
  }
  if (flags.emaStack) s.push('moving averages: ' + flags.emaStack + '.');
  if (flags.rsiState || flags.volState) {
    s.push('momentum ' + [
      flags.rsiState ? 'RSI ' + pct(finite(f.rsi14)) + ' ' + flags.rsiState : null,
      flags.volState ? 'ATR ' + pct(finite(f.atrPct), 2) + '% ' + flags.volState : null
    ].filter(Boolean).join(', ') + '.');
  }
  if (c && (flags.candleShape || flags.candleSize)) {
    s.push('last closed candle ' + (c.direction || '?') + ' ' +
      [flags.candleShape, flags.candleSize].filter(Boolean).join(' + ') +
      (finite(c.bodyPct) !== null ? ' (body ' + pct(finite(c.bodyPct)) + '%, upper wick ' + pct(finite(c.upperWickPct)) + '%, lower wick ' + pct(finite(c.lowerWickPct)) + '%)' : '') + '.');
  }
  const toBuy = distPct(price, finite(liq.buySide));
  const toSell = distPct(price, finite(liq.sellSide));
  if (toBuy !== null || toSell !== null) {
    s.push('liquidity ' + [
      toBuy !== null ? 'buy-side ' + px(finite(liq.buySide)) + ' ' + pct(toBuy, 2) + '% away' : null,
      toSell !== null ? 'sell-side ' + px(finite(liq.sellSide)) + ' ' + pct(toSell, 2) + '% away' : null,
      liq.equalHigh ? 'equal highs present' : null,
      liq.equalLow ? 'equal lows present' : null,
      liq.lastSweep ? 'last sweep ' + String(liq.lastSweep) : null
    ].filter(Boolean).join(', ') + '.');
  }
  const fvgT = zoneText(cFvg); if (fvgT) s.push('nearest FVG ' + fvgT + '.');
  const obT = zoneText(cOb); if (obT) s.push('nearest OB ' + obT + '.');
  if (flags.ote) s.push(flags.ote + '.');
  const fFib = fibText(fibRead(smc, price), { full: true });
  if (fFib) s.push('fib ' + fFib + '.');
  const pt = patternText(f.patterns); if (pt) s.push('closed-candle patterns: ' + pt + '.');

  return {
    tf, available: true, detail: 'FULL',
    flags: { fresh: flags.fresh, trend: flags.trend, zone: flags.zone, event: flags.event },
    line: s.join(' ')
  };
}

function narrateChart(u) {
  const price = finite(u && u.livePrice);
  const frames = {};
  // 5m ve 15m iki islem hattidir: tam okuma. Digerleri baglamdir: tek satir kompakt okuma.
  // Amac 52 kB butcesini korumak; hicbir zaman dilimi paketten DUSURULMEZ.
  const FULL_TFS = new Set(['5m', '15m']);
  for (const tf of FRAMES) {
    frames[tf] = narrateFrame(tf, u && u.frames ? u.frames[tf] : null, price, { full: FULL_TFS.has(tf) });
  }

  const up = [], down = [], mixed = [], unusable = [], stale = [];
  for (const tf of FRAMES) {
    const r = frames[tf];
    if (!r.available) { unusable.push(tf); continue; }
    if (r.flags.fresh !== true) stale.push(tf);
    const t = String(r.flags.trend || '').toUpperCase();
    if (t === 'UP') up.push(tf); else if (t === 'DOWN') down.push(tf); else mixed.push(tf);
  }
  const usable = up.length + down.length + mixed.length;
  const dominant = up.length === down.length ? 'SPLIT' : (up.length > down.length ? 'UP' : 'DOWN');
  const agreementPct = usable ? Number(((Math.max(up.length, down.length) / usable) * 100).toFixed(1)) : null;
  const alignment = {
    up, down, mixed, unusable, stale, dominant, agreementPct,
    line: 'Timeframe alignment: UP [' + (up.join(',') || '-') + '], DOWN [' + (down.join(',') || '-') +
      '], MIXED [' + (mixed.join(',') || '-') + ']' +
      (unusable.length ? ', UNUSABLE [' + unusable.join(',') + ']' : '') +
      (stale.length ? ', STALE [' + stale.join(',') + ']' : '') +
      '. Dominant direction ' + dominant +
      (agreementPct !== null ? ', agreement ' + agreementPct + '% of usable timeframes' : '') +
      '. Disagreement across timeframes is normal and is not by itself a reason to wait.'
  };

  return {
    contract: 'R2543_CHART_NARRATOR_DETERMINISTIC_V1',
    source: 'CLOSED_CANDLE_NUMERIC_TRUTH',
    semantics: 'Deterministic reading of the same closed candles the chart is drawn from. No model and no image are involved, so it cannot hallucinate: a clause appears only when its numeric field exists. 5m and 15m are read in full, the other timeframes in one compact line. Interpretation layer only — the numeric packet stays the single truth and JEV owns the decision.',
    frames,
    alignment
  };
}

module.exports = { narrateChart, narrateFrame, FRAMES, _internals: { rsiState, volState, emaStack, candleShape, candleSize, nearestZone, px } };
