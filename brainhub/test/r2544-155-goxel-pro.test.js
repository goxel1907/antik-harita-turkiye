'use strict';
// R2544.155 GOXEL PRO: the same trader with the big screens (15m / 1h / 4h / 1d chart reading): 5m noise alone never moves him
const test = require('node:test'), assert = require('node:assert');
const K = require('../kesif');
const rec = side => ({ side, stopPct:2 });
const base = (n, netR = 0.5) => ({ netR, curR:netR + 0.07, peakR:0.9, screens:['GRAFIK', 'KAR', 'AKIS', 'DEFTER', 'TUREV'].map((key, i) => ({ key, tr:key, against:i < n, txt:key + (i < n ? ' aleyhe' : '') })) });
const tfr = (trend, extra = {}) => ({ structure:{ trend:trend === 'MIXED' ? 'RANGE' : trend, atrPct:1 }, chartReading:{ trend, events:[], patterns:[], dealingRange:{ positionPct:50 }, liquidity:{}, fib:{}, trendLines:{}, openFvg:[], volumeProfile:{}, ...extra } });
const pk = (o = {}) => ({ levels:o.levels || [], timeframes:{ m5:{ structure:{ atrPct:1 } }, m15:o.m15 || tfr('MIXED'), h1:o.h1 || tfr('MIXED'), h4:o.h4 || tfr('MIXED'), d1:null } });

test('R2544.155 the 5m screens alone never move Goxel PRO', () => {
  const v = K.goxelPro(rec('LONG'), base(3), pk());
  assert.deepStrictEqual([v.screens.length, v.big, v.against, v.close], [9, 0, 3, false]);
  assert.strictEqual(K.goxelLook && typeof K.goxelPro, 'function');
});

test('R2544.155 at a level a pro sells into: one big reason + three in all = he takes the money', () => {
  const v = K.goxelPro(rec('LONG'), base(2), pk({ levels:[{ name:'prevDayHigh', price:100.2, distPct:0.2 }, { name:'prevDayLow', price:95, distPct:-5 }] }));
  const lv = v.screens.find(x => x.key === 'SEVIYE');
  assert.strictEqual(lv.against, true); assert.match(lv.txt, /dirence geldi: önceki gün tepesi/);
  assert.deepStrictEqual([v.atLevel, v.big, v.against, v.close, v.R], [true, 1, 3, true, 0.5]);
  // the same level for a SHORT is behind him: not his
  assert.strictEqual(K.goxelPro(rec('SHORT'), base(2), pk({ levels:[{ name:'prevDayHigh', price:100.2, distPct:0.2 }] })).screens.find(x => x.key === 'SEVIYE').against, null);
  // a level far away does not count; 1h liquidity pool below a SHORT within reach does
  assert.strictEqual(K.goxelPro(rec('LONG'), base(2), pk({ levels:[{ name:'high24h', price:103, distPct:3 }] })).close, false);
  const s = K.goxelPro(rec('SHORT'), base(2), pk({ h1:tfr('MIXED', { liquidity:{ sellSide20:{ price:99.8 } } }) }));
  assert.match(s.screens.find(x => x.key === 'SEVIYE').txt, /desteğe geldi: 1 sa alt likidite/); assert.strictEqual(s.close, true);
});

test('R2544.155 patient with the big trend: 1h and 4h on his side and no level -> two big reasons needed', () => {
  const cp = tfr('UP', { patterns:[{ type:'BEARISH_ENGULFING', side:'SHORT', status:'CONFIRMED' }] });
  let v = K.goxelPro(rec('LONG'), base(3), pk({ m15:cp, h1:tfr('UP'), h4:tfr('UP') }));
  assert.deepStrictEqual([v.support, v.big, v.needBig, v.close], [true, 1, 2, false], 'one counter pattern is not enough while the trend carries him');
  v = K.goxelPro(rec('LONG'), base(3), pk({ m15:tfr('MIXED', { dealingRange:{ positionPct:92 }, patterns:[{ type:'BEARISH_ENGULFING', side:'SHORT', status:'CONFIRMED' }] }), h1:tfr('UP'), h4:tfr('UP') }));
  assert.deepStrictEqual([v.big, v.close], [2, true], 'counter pattern + range top');
  // without the trend one big reason is enough; a FORMING pattern is not a reason
  v = K.goxelPro(rec('LONG'), base(2), pk({ m15:cp }));
  assert.deepStrictEqual([v.support, v.big, v.close], [false, 1, true]);
  assert.strictEqual(K.goxelPro(rec('LONG'), base(2), pk({ m15:tfr('MIXED', { patterns:[{ type:'BEARISH_ENGULFING', side:'SHORT', status:'FORMING' }] }) })).close, false);
});

test('R2544.155 a fresh break against him on 15m / 1h counts; an old one and a price outside the range do not', () => {
  let v = K.goxelPro(rec('LONG'), base(2), pk({ h1:tfr('MIXED', { events:[{ side:'BEAR', kind:'CHOCH', barsAgo:1 }] }) }));
  assert.match(v.screens.find(x => x.key === 'TREND').txt, /1 sa karakter değişti aleyhe/); assert.strictEqual(v.close, true);
  v = K.goxelPro(rec('LONG'), base(2), pk({ h1:tfr('MIXED', { events:[{ side:'BEAR', kind:'BOS', barsAgo:9 }] }) }));
  assert.strictEqual(v.screens.find(x => x.key === 'TREND').against, false);
  v = K.goxelPro(rec('SHORT'), base(2), pk({ m15:tfr('MIXED', { dealingRange:{ positionPct:-8 } }) }));
  assert.strictEqual(v.screens.find(x => x.key === 'TESTERE').against, false, 'below the range = a breakdown, not the range floor');
  assert.strictEqual(K.goxelPro(rec('LONG'), base(5, 0.1), pk({ levels:[{ name:'high24h', price:100.1, distPct:0.1 }] })).close, false, 'not paying after commission: he does not act');
});

test('R2544.155 the book: PLAN, Goxel and Goxel PRO on the forecasts both watched', () => {
  const r = (R, gx, gp) => ({ model:'m', symbol:'X', side:'LONG', at:10, R, gx, gp });
  const b = K.goxelBook([r(-1.07, { closed:true, by:'GOXEL', R:0.3 }, { closed:true, by:'PRO', R:0.6, at:1, why:'w' }), r(2.9, { closed:true, by:'GOXEL', R:0.4 }, { closed:true, by:'PLAN', R:2.9 }), r(-1.07, { closed:true, by:'PLAN', R:-1.07 }, null)]);
  assert.strictEqual(b.n, 3); assert.deepStrictEqual([b.pro.n, b.pro.took, b.pro.saved, b.pro.cutWinner], [2, 1, 1, 0]);
  assert.deepStrictEqual(b.pro.rows.map(x => [x.key, x.avgR]), [['PLAN', 0.915], ['GOXEL', 0.35], ['PRO', 1.75]]);
  assert.strictEqual(K.goxelBook([r(-1, { closed:true, by:'PLAN', R:-1 }, null)]).pro, null);
});
