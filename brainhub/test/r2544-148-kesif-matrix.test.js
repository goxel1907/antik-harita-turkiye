'use strict';
// R2544.148 BEYNİN MATRİSİ: the formations on the screen + a neutral forward label -> per-formation probabilities, built live only
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const K = require('../kesif');
const pk = (over = {}) => ({ timeframes:{
  m5:{ structure:{ trend:'UP', lastBreak:'BROKE_SWING_HIGH', closeVsEma20:1.6, rangePos20:0.9, volLast3VsMedian:2.4, takerBuyShareLast3:0.64, atrPct:0.4 }, chartReading:{ swing:{ state:'BULLISH' }, events:[{ kind:'BOS', side:'BULL', barsAgo:1 }, { kind:'CHOCH', side:'BEAR', barsAgo:9 }], momentum:{ rsi14:72, squeeze:'RELEASED', displacement:{ dir:'UP', barsAgo:2 } }, liquidity:{ lastSweep:{ side:'SELL_SIDE' } }, patterns:[{ type:'BULL_FLAG', side:'LONG' }], openFvg:[{ side:'BULL' }], dealingRange:{ zone:'PREMIUM' } } },
  h1:{ structure:{ trend:'DOWN', lastBreak:'NONE', closeVsEma20:-0.2, rangePos20:0.5, atrPct:1.4 }, chartReading:null }, ...(over.timeframes || {}) },
  coin:{ change24hPct:42, fundingPct:0.06 }, btc:{ trend1h:'RANGE', change12hPct:0.3 }, ...over });

test('R2544.148 formations: every timeframe fact becomes a key; old events (> 3 candles) are not "now"; coin and BTC are part of the picture', () => {
  const f = K.formations(pk());
  for (const k of ['m5:trend:UP', 'm5:kirilim:BROKE_SWING_HIGH', 'm5:olay:BOS_BULL', 'm5:itki:UP', 'm5:rsi:ASIRI_ALIM', 'm5:hacim:YUKSEK', 'm5:alici:ALICI', 'm5:supurme:SELL_SIDE', 'm5:formasyon:BULL_FLAG_LONG', 'm5:bolge:PREMIUM', 'm5:sikisma:RELEASED', 'h1:trend:DOWN', 'coin:gun:UCTU', 'coin:fonlama:ASIRI', 'btc:trend:RANGE', 'btc:12s:YATAY'])
    assert.ok(f.includes(k), k);
  assert.ok(!f.includes('m5:olay:CHOCH_BEAR'), 'an event 9 candles ago is not the screen now'); assert.ok(!f.some(k => /^h1:kirilim/.test(k)), 'NONE is not a formation');
  assert.deepStrictEqual(K.formations(pk()), f, 'stable order');
  assert.strictEqual(K.band(pk()), 2.1, '1,5 x the 1h ATR'); assert.strictEqual(K.band({ timeframes:{ h1:{ structure:{ atrPct:0.2 } } } }), 1.2); assert.strictEqual(K.band({ timeframes:{ h1:{ structure:{ atrPct:9 } } } }), 8);
});

test('R2544.148 the matrix learns from labels; the brain stays silent until 20 labelled rounds, then follows formations with >= 8 rounds behind them', () => {
  let m = {};
  const up = ['m5:itki:UP', 'h1:trend:UP'], dn = ['m5:itki:DOWN', 'h1:trend:DOWN'];
  for (let i = 0; i < 12; i++) m = K.matrixAdd(m, up, i < 10 ? 'UP' : 'DOWN', 2);
  assert.strictEqual(K.brainCall(m, up).ready, false); assert.strictEqual(K.brainForecast(K.brainCall(m, up), 2).direction, 'NONE');
  assert.match(K.brainForecast(K.brainCall(m, up), 2).reasonTr, /öğreniyor \(12\/20/);
  for (let i = 0; i < 12; i++) m = K.matrixAdd(m, dn, i < 10 ? 'DOWN' : 'FLAT', 3);
  const cu = K.brainCall(m, up), cd = K.brainCall(m, dn), cx = K.brainCall(m, ['m5:yeni:X']);
  assert.strictEqual(cu.ready, true); assert.ok(cu.pUp > 0.6, 'up formations: up'); assert.ok(cd.pUp < 0.4, 'down formations: down'); assert.ok(Math.abs(cx.pUp - 0.5) < 0.1, 'unknown formation: the base rate');
  const fu = K.brainForecast(cu, 2.1); assert.deepStrictEqual([fu.direction, fu.stopPct, fu.targetPct, fu.horizonH], ['LONG', 2.1, 2.1, K.LABEL_H]); assert.match(fu.reasonTr, /matris yukarı/);
  assert.strictEqual(K.brainForecast(cd, 2.1).direction, 'SHORT'); assert.strictEqual(K.brainForecast(cx, 2.1).direction, 'NONE');
  const u = cu.used.find(x => x.f === 'm5:itki:UP'); assert.deepStrictEqual([u.n, u.upPct, u.downPct, u.hUp], [12, 83, 17, 2]);
  // thin formations (< 8) never move the call
  m = K.matrixAdd(m, ['m5:nadir:Y'], 'UP', 1); assert.strictEqual(K.brainCall(m, ['m5:nadir:Y']).used.length, 0);
  const v = K.matrixView(m, { minN:3 }); assert.strictEqual(v.total.n, 25); assert.ok(v.rows[0].ready); assert.ok(!v.rows.some(r => r.f === 'm5:nadir:Y'), 'n < 3 not shown');
  assert.strictEqual(K.labelOf({ outcome:'TARGET' }), 'UP'); assert.strictEqual(K.labelOf({ outcome:'STOP' }), 'DOWN'); assert.strictEqual(K.labelOf({ outcome:'HORIZON' }), 'FLAT'); assert.strictEqual(K.labelOf({ outcome:'NO_DATA' }), null);
});

test('R2544.148 the models are told the brain\'s matrix and the desk record (anonymous), and the hidden label never enters the karne', () => {
  let m = {}; for (let i = 0; i < 21; i++) m = K.matrixAdd(m, ['m5:itki:UP'], i % 3 ? 'UP' : 'DOWN', 2);
  const call = K.brainCall(m, ['m5:itki:UP']), b = K.brief(m, ['m5:itki:UP'], call, { rows:[{ model:'nvidia/x', n:9, hitPct:56, avgR:0.2, state:'ADAY' }, { model:'BEYIN', n:4, hitPct:50, avgR:0, state:'YENI' }] });
  assert.strictEqual(b.brain.labelledRounds, 21); assert.ok(b.brain.upFirstProbability > 0.5); assert.strictEqual(b.brain.strongest[0].f, 'm5:itki:UP');
  assert.deepStrictEqual(b.desk.rows.map(r => r.trader), ['a model', 'brain matrix']); assert.ok(!JSON.stringify(b).includes('nvidia'), 'no model names to the models');
  assert.match(K.SYSTEM, /`brain` is the desk's own probability matrix, built LIVE/);
  const k = K.karne([{ model:'_ETIKET', done:true, outcome:'TARGET', R:1, side:'LONG', at:1, closedAt:2 }, { model:'BEYIN', done:true, outcome:'STOP', R:-1.07, side:'LONG', at:1, closedAt:2 }]);
  assert.deepStrictEqual(k.rows.map(r => r.model), ['BEYIN']);
});
