'use strict';
// CLAUDE_R2543_CHART_NARRATOR: grafiğin ne anlattığı her turda JEV'e gider.
// Model yok, ağ yok, görüntü yok: aynı girdi her zaman aynı cümleyi üretir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { narrateChart, narrateFrame, FRAMES } = require('../chart-narrator');
const { prepareDecisionRequest, MAX_DECISION_REQUEST_BYTES } = require('../jev-decision');
const { marketPacket, mirrorDigest } = require('../jev-market-packet');

function frame(over) {
  return Object.assign({
    available: true, fresh: true, asOf: 1790520000000,
    close: 0.01705, ema20: 0.01698, ema50: 0.01712,
    rsi14: 46, atr14: 0.00017, atrPct: 1.03, trend: 'MIXED', breakOfStructure: null,
    prior20High: 0.01712, prior20Low: 0.01613,
    candle: { direction: 'BULL', range: 0.00053, body: 0.00033, bodyPct: 62.3, upperWickPct: 32.1, lowerWickPct: 5.7, rangeAtr: 3.041 },
    patterns: [{ type: 'THREE_WHITE_SOLDIERS', side: 'LONG', status: 'CONFIRMED', at: 1790526599999 }],
    swingStructure: { state: 'MIXED', highSequence: 'HH', lowSequence: 'LL', event: null },
    liquidity: { buySide: 0.01712, sellSide: 0.01613, equalHigh: null, equalLow: null, lastSweep: null, fairValueGaps: [{ side: 'BEAR', low: 0.01675, high: 0.01695, at: 1, ce50: 0.01685 }] },
    recentFairValueGaps: [{ side: 'BEAR', low: 0.01675, high: 0.01695, at: 1, ce50: 0.01685 }],
    orderBlocks: { bullish: [], bearish: [{ side: 'BEAR', low: 0.01737, high: 0.01747, at: 1, mitigated: true, broken: false }] },
    smcContext: {
      available: true, swingEvent: null, swingState: 'MIXED',
      dealingRange: { low: 0.01613, high: 0.01712, equilibrium: 0.016625, positionPct: 75.76, zone: 'PREMIUM', insideRange: true },
      oteReference: { longDiscountZone: { low: 0.016338, high: 0.016506 }, shortPremiumZone: { low: 0.016744, high: 0.016912 } }
    }
  }, over || {});
}
function unified(over) {
  const frames = {};
  for (const tf of FRAMES) frames[tf] = frame();
  return Object.assign({ symbol: 'AZTECUSDT', livePrice: 0.01705, frames }, over || {});
}

test('the reading is deterministic: same candles always produce the same sentences', () => {
  const u = unified();
  const a = JSON.stringify(narrateChart(u));
  const b = JSON.stringify(narrateChart(u));
  const c = JSON.stringify(narrateChart(unified()));
  assert.equal(a, b);
  assert.equal(a, c);
});

test('every timeframe is read, and the two trading lanes are read in full', () => {
  const n = narrateChart(unified());
  assert.deepEqual(Object.keys(n.frames), FRAMES);
  assert.equal(n.frames['5m'].detail, 'FULL');
  assert.equal(n.frames['15m'].detail, 'FULL');
  for (const tf of ['1m', '3m', '30m', '1h', '4h', '1d']) assert.equal(n.frames[tf].detail, 'COMPACT');
  // Tam okuma gerçekten daha zengin, kompakt okuma yine de gerçek bir okuma.
  assert.ok(n.frames['15m'].line.length > n.frames['1h'].line.length);
  assert.match(n.frames['1h'].line, /trend MIXED/);
  assert.match(n.frames['1h'].line, /structure MIXED \(HH\/LL\)/);
});

test('a full lane reading names structure, location, momentum, candle, liquidity, FVG, OB and patterns', () => {
  const line = narrateChart(unified()).frames['15m'].line;
  assert.match(line, /structure MIXED \(HH\/LL\)/);
  assert.match(line, /PREMIUM half of the confirmed range at 75\.8% of range/);
  assert.match(line, /RSI 46 NEUTRAL/);
  assert.match(line, /ATR 1\.03% NORMAL_VOLATILITY/);
  assert.match(line, /PRICE_BELOW_EMA20_BUT_EMA20_ABOVE_EMA50|PRICE_ABOVE_EMA20/);
  assert.match(line, /last closed candle BULL/);
  assert.match(line, /liquidity buy-side/);
  assert.match(line, /nearest FVG BEAR FVG/);
  assert.match(line, /nearest OB BEAR OB .* mitigated/);
  assert.match(line, /THREE_WHITE_SOLDIERS\(LONG\/CONFIRMED\)/);
});

test('nothing is invented: absent fields produce no clause and unusable frames say so', () => {
  const bare = { available: true, fresh: true, close: 0.01705 };
  const r = narrateFrame('15m', bare, 0.01705);
  assert.doesNotMatch(r.line, /RSI/);
  assert.doesNotMatch(r.line, /ATR/);
  assert.doesNotMatch(r.line, /nearest FVG/);
  assert.doesNotMatch(r.line, /nearest OB/);
  assert.doesNotMatch(r.line, /structure/);
  assert.doesNotMatch(r.line, /\bnull\b|undefined|NaN/);
  const dead = narrateFrame('4h', { available: false, reason: 'NO_CANDLES' }, 0.01);
  assert.equal(dead.available, false);
  assert.match(dead.line, /no usable candles/);
  const n = narrateChart(unified({ frames: Object.assign(unified().frames, { '4h': { available: false, reason: 'NO_CANDLES' } }) }));
  assert.ok(n.alignment.unusable.includes('4h'));
});

test('price outside the confirmed range is not described as being inside it', () => {
  const f = frame({ smcContext: { available: true, dealingRange: { low: 0.01613, high: 0.01665, positionPct: 223.1, zone: 'ABOVE_RANGE_EXTENSION', insideRange: false } } });
  const line = narrateFrame('15m', f, 0.01705).line;
  assert.match(line, /price is OUTSIDE the confirmed range \(ABOVE_RANGE_EXTENSION\) at 223\.1% of range/);
  assert.doesNotMatch(line, /half of the confirmed range/);
});

test('timeframe alignment is counted, never asserted as a rule', () => {
  const fr = unified().frames;
  fr['1m'] = frame({ trend: 'UP' }); fr['3m'] = frame({ trend: 'UP' });
  fr['1h'] = frame({ trend: 'DOWN' });
  const n = narrateChart(unified({ frames: fr }));
  assert.deepEqual(n.alignment.up, ['1m', '3m']);
  assert.deepEqual(n.alignment.down, ['1h']);
  assert.equal(n.alignment.dominant, 'UP');
  assert.match(n.alignment.line, /Disagreement across timeframes is normal and is not by itself a reason to wait\./);
});

test('the reading stays small enough to travel inside the 52 kB request', () => {
  const bytes = Buffer.byteLength(JSON.stringify(narrateChart(unified())), 'utf8');
  assert.ok(bytes < 6000, 'chartNarrative ' + bytes + ' bayt, 6000 sınırının altında olmalı');
});

test('over budget the raw pivot arrays are dropped before market truth, and the structure summary survives', () => {
  const pivots = Array.from({ length: 420 }, (_, i) => ({ role: 'TOP', index: i, price: 0.0171 + i / 1e6, at: 1790500000000 + i }));
  const body = {
    model: 'typesafe/jev-1.13',
    state: {
      description: 'd',
      record: {
        symbol: 'AZTECUSDT', livePrice: 0.01705,
        coreFrames: {
          '15m': { available: true, close: 0.01705, swingStructure: { state: 'MIXED', highSequence: 'HH', lowSequence: 'LL', event: 'BOS_UP', confirmedPivots: { highs: pivots, lows: pivots }, trendLines: { upSupport: pivots } } }
        },
        chartNarrative: narrateChart(unified())
      }
    },
    questions: { q: { type: 'choice', criteria: { A: 'a' } } }
  };
  const before = Buffer.byteLength(JSON.stringify(body), 'utf8');
  assert.ok(before > MAX_DECISION_REQUEST_BYTES, 'kurgu gövde tavanı aşmalı');
  const out = prepareDecisionRequest(body);
  assert.equal(out.ok, true);
  assert.ok(out.diagnostics.bytes <= MAX_DECISION_REQUEST_BYTES);
  assert.equal(out.diagnostics.secondaryTrimApplied, true);
  const sw = out.body.state.record.coreFrames['15m'].swingStructure;
  assert.equal(sw.pivotsTrimmed, true);
  assert.equal(sw.confirmedPivots, undefined);
  assert.equal(sw.trendLines, undefined);
  assert.equal(sw.state, 'MIXED');
  assert.equal(sw.highSequence, 'HH');
  assert.equal(sw.event, 'BOS_UP');
  // Piyasa gerçeği ve grafik okuması korunur.
  assert.equal(out.body.state.record.livePrice, 0.01705);
  assert.equal(out.body.state.record.coreFrames['15m'].close, 0.01705);
  assert.ok(out.body.state.record.chartNarrative.frames['15m'].line.length > 50);
});

test('the packet and its audit mirror both carry the reading', () => {
  const p = marketPacket(unified());
  assert.equal(p.chartNarrative.contract, 'R2543_CHART_NARRATOR_DETERMINISTIC_V1');
  assert.ok(p.chartNarrative.frames['15m'].line.length > 50);
  // jevSeen bir whitelist aynasidir: okuma aynada da olmali, yoksa ne gonderildigi denetlenemez.
  const mirror = mirrorDigest(p);
  assert.equal(mirror.chartNarrative.contract, 'R2543_CHART_NARRATOR_DETERMINISTIC_V1');
  assert.equal(mirror.chartNarrative.frames['5m'].line, p.chartNarrative.frames['5m'].line);
  assert.equal(mirror.chartNarrative.alignment.line, p.chartNarrative.alignment.line);
  assert.equal(mirrorDigest({}).chartNarrative, null);
});
