'use strict';
// R2544.162: Goxel PRO's look before a weak entry - the same rule as his exit ("would he leave now?")
const test = require('node:test'), assert = require('node:assert');
const K = require('../kesif');
const tfr = (trend, extra = {}) => ({ structure:{ trend:trend === 'MIXED' ? 'RANGE' : trend, atrPct:1 }, chartReading:{ trend, events:[], patterns:[], dealingRange:{ positionPct:50 }, liquidity:{}, fib:{}, trendLines:{}, openFvg:[], volumeProfile:{}, ...extra } });
const pk = (o = {}) => ({ levels:o.levels || [], timeframes:{ m5:{ structure:{ atrPct:1 } }, m15:o.m15 || tfr('MIXED'), h1:o.h1 || tfr('MIXED'), h4:o.h4 || tfr('MIXED'), d1:null } });

test('R2544.162 weak entry: Goxel says no when one big screen and three in all are against the trade', () => {
  assert.strictEqual(K.goxelEntry('LONG', { taker:1.0, imb1:0 }, pk()).ok, true, 'quiet screens: enter');
  const r = K.goxelEntry('LONG', { taker:0.7, imb1:-0.5 }, pk({ levels:[{ name:'prevDayHigh', price:100.2, distPct:0.2 }] }));
  assert.deepStrictEqual([r.ok, r.big, r.against], [false, 1, 3]); assert.match(r.why, /dirence geldi: önceki gün tepesi/);
  assert.strictEqual(K.goxelEntry('SHORT', { taker:0.7, imb1:-0.5 }, pk({ levels:[{ name:'prevDayHigh', price:100.2, distPct:0.2 }] })).ok, true, 'the same screens favour a SHORT');
  assert.deepStrictEqual(K.goxelEntry('LONG', { taker:0.7 }, null), { ok:true, checked:false, reason:'GOXEL_SCREENS_UNAVAILABLE' });
});

test('R2544.162 the best candidate takes the word only when nobody holds it; twins, labels and the brains never', () => {
  const k = rows => ({ rows });
  const A = (model, state, n, avgR, exBestAvgR, lowerR) => ({ model, state, n, avgR, exBestAvgR, lowerR });
  assert.strictEqual(K.bestCandidate(k([A('a', 'ADAY', 44, 0.19, 0.13, -0.01), A('ORTAK', 'ADAY', 45, 0.16, 0.12, -0.024), A('PUSU:x', 'ADAY', 30, 0.5, 0.4, 0.2), A('BEYIN2', 'ADAY', 30, 0.5, 0.4, 0.1)])), 'a');
  assert.strictEqual(K.bestCandidate(k([A('s', 'SOZ_SAHIBI', 40, 0.3, 0.2, 0.05), A('a', 'ADAY', 44, 0.19, 0.13, -0.01)])), null, 'a holder exists');
  assert.strictEqual(K.bestCandidate(k([A('a', 'ADAY', 15, 0.19, 0.13, -0.01)])), null, 'fewer than 20 outcomes');
  assert.strictEqual(K.bestCandidate(k([A('a', 'ADAY', 30, 0.19, -0.01, -0.1)])), null, 'mean without the best not above zero');
  const rec = { model:'a', symbol:'X', side:'LONG', stopPct:2, targetPct:4, horizonH:6 };
  assert.strictEqual(K.liveSignal(rec, k([A('a', 'ADAY', 44, 0.19, 0.13, -0.01)])).weak, true);
  assert.strictEqual(K.liveSignal({ ...rec, model:'b' }, k([A('a', 'ADAY', 44, 0.19, 0.13, -0.01), A('b', 'ADAY', 30, 0.1, 0.05, -0.2)])), null, 'only the best one');
  assert.strictEqual(K.liveSignal(rec, k([A('a', 'SOZ_SAHIBI', 44, 0.19, 0.13, 0.01)])).weak, false);
});
