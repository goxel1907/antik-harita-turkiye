'use strict';
// R2544.154 GOXEL: the trader who watches five screens and takes his money when two of them turn against him (shadow, nothing traded)
const test = require('node:test'), assert = require('node:assert');
const K = require('../kesif');
const M5 = 300000, H = 3600000, T0 = Math.floor(1794400000000 / M5) * M5;
const bar = (i, o, h, l, c) => [T0 + i * M5, o, h, l, c, 1000, T0 + (i + 1) * M5 - 1, 100000, 10, 500, 50000, 0];
const mk = (side, s = 2, g = 6, h = 6) => K.open({ model:'m', symbol:'X', forecast:{ ok:true, direction:side, stopPct:s, targetPct:g, horizonH:h, confidence:50 }, at:T0 + 1000, round:'r' });
const cost = K.COST_PCT / 2;
// LONG entry 100, stop 2 %: up to +0,8R, the last candle makes the top and closes far below it (rejection wick), +0,5R now
const up = [bar(1, 100, 100.5, 99.9, 100.4), bar(2, 100.4, 101.6, 100.3, 101.5), bar(3, 101.5, 101.6, 100.9, 101)];

test('R2544.154 Goxel takes his money when two screens turn against him while the trade pays', () => {
  const v = K.goxelLook(mk('LONG'), up, { taker:0.8, imb1:0, oiChgPct:0 }, T0 + 4 * M5);
  assert.deepStrictEqual([v.curR, v.peakR], [0.5, 0.8]);
  const by = Object.fromEntries(v.screens.map(x => [x.key, x.against]));
  assert.deepStrictEqual(by, { GRAFIK:true, KAR:false, AKIS:true, DEFTER:false, TUREV:false });
  assert.strictEqual(v.against, 2); assert.strictEqual(v.close, true); assert.strictEqual(v.R, +(0.5 - cost).toFixed(3));
  assert.match(v.why, /iğne/); assert.match(v.why, /alıcılar çekildi/);
});

test('R2544.154 one screen against = he stays; screens unknown are not counted against; no profit = he does not act', () => {
  let v = K.goxelLook(mk('LONG'), up, { taker:1.0, imb1:0.1, oiChgPct:0.5 }, T0 + 4 * M5);
  assert.deepStrictEqual([v.against, v.close, v.R], [1, false, null]);
  v = K.goxelLook(mk('LONG'), up, null, T0 + 4 * M5);
  assert.deepStrictEqual([v.against, v.close], [1, false], 'without the screens only the chart and the profit can speak');
  // in loss: every screen against, still no exit (he manages profit, the plan's stop handles the loss)
  const down = [bar(1, 100, 100.2, 99.5, 99.6), bar(2, 99.6, 99.7, 99.1, 99.2), bar(3, 99.2, 99.3, 98.9, 99)];
  v = K.goxelLook(mk('LONG'), down, { taker:0.5, imb1:-0.8, oiChgPct:-3 }, T0 + 4 * M5);
  assert.strictEqual(v.close, false); assert.ok(v.netR < 0);
});

test('R2544.154 SHORT mirror, melting profit and the derivatives screen', () => {
  // SHORT entry 100, stop 2 %: down to -1,6 % (+0,8R), back to -0,8 % (+0,4R): profit melted by half
  const k = [bar(1, 100, 100.1, 99.5, 99.6), bar(2, 99.6, 99.7, 98.4, 98.6), bar(3, 98.6, 99.25, 98.6, 99.2)];
  const v = K.goxelLook(mk('SHORT'), k, { taker:1.0, imb1:0, oiChgPct:-1.5 }, T0 + 4 * M5);
  const by = Object.fromEntries(v.screens.map(x => [x.key, x.against]));
  assert.strictEqual(by.KAR, true, 'peak +0,8R, now +0,4R'); assert.strictEqual(by.TUREV, true, 'price on our side, OI leaving');
  assert.strictEqual(v.close, true); assert.strictEqual(v.R, +(0.4 - cost).toFixed(3));
  assert.strictEqual(K.goxelLook(mk('SHORT'), k, { taker:1.2 }, T0 + 4 * M5).screens.find(x => x.key === 'AKIS').against, true, 'sellers stepped back');
});

test('R2544.154 Goxel does not look before two candles, after the horizon, or at a closed forecast', () => {
  assert.strictEqual(K.goxelLook(mk('LONG'), up.slice(0, 1), {}, T0 + 2 * M5), null);
  assert.strictEqual(K.goxelLook(mk('LONG', 2, 6, 0.25), up, {}, T0 + 4 * M5), null, 'past the horizon');
  assert.strictEqual(K.goxelLook({ ...mk('LONG'), done:true }, up, {}, T0 + 4 * M5), null);
});

test('R2544.154 the book: Goxel against the plan on the same forecasts since he started; what he saved and what he cut', () => {
  const r = (i, R, gx, model = 'm') => ({ model, symbol:'X', side:'LONG', at:T0 + i * H, R, gx });
  const l = [r(1, -1.07, { closed:true, by:'GOXEL', R:0.43, at:T0, why:'a' }), r(2, 2.93, { closed:true, by:'GOXEL', R:0.6, at:T0, why:'b' }),
    r(3, -1.07, { closed:true, by:'PLAN', R:-1.07 }), r(4, 1, { closed:true, by:'GOXEL', R:5 }, 'PUSU:m'), r(0, -1, { closed:true, by:'PLAN', R:-1 }), r(5, -1, null)];
  const b = K.goxelBook(l, T0 + H);
  assert.deepStrictEqual([b.n, b.took, b.saved, b.cutWinner], [3, 2, 1, 1]);
  assert.deepStrictEqual(b.rows.map(x => x.key), ['PLAN', 'GOXEL']);
  assert.strictEqual(b.rows[0].avgR, 0.263); assert.strictEqual(b.rows[1].avgR, -0.013);
  assert.deepStrictEqual(b.recent.map(x => [x.R, x.planR]), [[0.6, 2.93], [0.43, -1.07]]);
  assert.strictEqual(K.goxelBook([]).n, 0);
  assert.strictEqual(K.humanBook([{ model:'m', at:1, R:-1, hx:{ AL05:0.4, BASABAS:0, YARIM:0.2 } }]).rows.length, 4, 'humanBook still works on the shared rows');
});
