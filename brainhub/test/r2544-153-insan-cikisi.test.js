'use strict';
// R2544.153 INSAN CIKISI: the same forecast, the same candles, three human exits scored next to the plan (shadow, nothing traded)
const test = require('node:test'), assert = require('node:assert');
const K = require('../kesif');
const M5 = 300000, T0 = Math.floor(1794400000000 / M5) * M5;
const bar = (i, o, h, l, c) => [T0 + i * M5, o, h, l, c, 1000, T0 + (i + 1) * M5 - 1, 100000, 10, 500, 50000, 0];
const mk = (side, s = 2, g = 4, h = 1) => K.open({ model:'m', symbol:'X', forecast:{ ok:true, direction:side, stopPct:s, targetPct:g, horizonH:h, confidence:50 }, at:T0 + 1000, round:'r' });
const cost = K.COST_PCT / 2;

test('R2544.153 went +0,75R then back to the stop: the plan loses 1R, the human exits keep money', () => {
  // LONG entry 100, stop 98 (2 %), target 104; candle 2 high 101.5 = +0,75R, candle 3 falls to 97.9 = stop
  const k = [bar(1, 100, 100.4, 99.8, 100.2), bar(2, 100.2, 101.5, 100.1, 101.2), bar(3, 101.2, 101.3, 97.9, 98)];
  const r = K.resolve(mk('LONG'), k, T0 + 4 * M5);
  assert.strictEqual(r.outcome, 'STOP'); assert.strictEqual(r.R, +(-1 - cost).toFixed(3));
  assert.strictEqual(r.hx.AL05, +(0.5 - cost).toFixed(3), 'take +0,5R when seen');
  assert.strictEqual(r.hx.BASABAS, +(0 - cost).toFixed(3), 'stop moved to the entry');
  assert.strictEqual(r.hx.YARIM, +(0.375 - cost).toFixed(3), 'half of the +0,75R peak locked');
});

test('R2544.153 conservative path: the level seen inside a candle moves the stop only from the next candle; stop + profit in one candle = stop', () => {
  // one candle goes to +0,75R and to the stop: every exit loses 1R (nobody knows which came first)
  let r = K.resolve(mk('LONG'), [bar(1, 100, 101.5, 97.9, 98)], T0 + 2 * M5);
  assert.deepStrictEqual([r.outcome, r.hx.AL05, r.hx.BASABAS, r.hx.YARIM], ['STOP', r.R, r.R, r.R]);
  // straight to the target: the plan wins +2R, the take-profit only +0,5R, the trailing exits ride with the plan
  r = K.resolve(mk('LONG'), [bar(1, 100, 100.5, 99.9, 100.4), bar(2, 100.4, 102.5, 100.3, 102.4), bar(3, 102.4, 104.2, 102.3, 104)], T0 + 4 * M5);
  assert.strictEqual(r.outcome, 'TARGET'); assert.strictEqual(r.hx.AL05, +(0.5 - cost).toFixed(3));
  assert.strictEqual(r.hx.BASABAS, r.R); assert.strictEqual(r.hx.YARIM, r.R);
  // SHORT mirror: +0,75R down, back up to the stop
  r = K.resolve(mk('SHORT'), [bar(1, 100, 100.2, 99.6, 99.8), bar(2, 99.8, 99.9, 98.5, 98.8), bar(3, 98.8, 102.1, 98.7, 102)], T0 + 4 * M5);
  assert.deepStrictEqual([r.outcome, r.hx.AL05, r.hx.BASABAS, r.hx.YARIM], ['STOP', +(0.5 - cost).toFixed(3), +(0 - cost).toFixed(3), +(0.375 - cost).toFixed(3)]);
});

test('R2544.153 the book compares the exits with the plan on the SAME forecasts; twins and labels left out', () => {
  const rec = (i, R, hx, model = 'm' + (i % 3)) => ({ model, at:T0 + i, R, hx, done:true });
  const l = [rec(1, -1.05, { AL05:0.45, BASABAS:-0.05, YARIM:0.3 }), rec(2, 1.95, { AL05:0.45, BASABAS:1.95, YARIM:1.95 }), rec(3, -1.05, { AL05:-1.05, BASABAS:-1.05, YARIM:-1.05 }),
    rec(4, -1.05, { AL05:0.45, BASABAS:-0.05, YARIM:0.2 }), rec(5, 1, { AL05:9, BASABAS:9, YARIM:9 }, 'PUSU:m1'), rec(6, 1, { AL05:9, BASABAS:9, YARIM:9 }, '_ETIKET'), { model:'old', at:T0, R:-1 }];
  const b = K.humanBook(l);
  assert.strictEqual(b.n, 4);
  assert.deepStrictEqual(b.rows.map(r => r.key), ['PLAN', 'AL05', 'BASABAS', 'YARIM']);
  const plan = b.rows[0], be = b.rows[2];
  assert.strictEqual(plan.avgR, -0.3); assert.strictEqual(be.avgR, 0.2); assert.strictEqual(be.vsPlanR, 0.5);
  assert.strictEqual(plan.vsPlanR, 0); assert.strictEqual(K.humanBook([]).n, 0);
});
