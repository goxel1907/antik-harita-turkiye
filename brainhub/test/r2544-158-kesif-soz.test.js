'use strict';
// R2544.158 KEŞİF-SÖZ: only the forecast of a member that holds the word becomes a real trade; its own plan from the real fill
const test = require('node:test'), assert = require('node:assert');
const K = require('../kesif');
const k = { rows:[{ model:'nvidia/u', state:'SOZ_SAHIBI', n:41, avgR:0.3, lowerR:0.1 }, { model:'ORTAK', state:'SOZ_SAHIBI', n:40, avgR:0.2, lowerR:0.02 }, { model:'gpt', state:'ADAY', n:44 }] };
const rec = o => ({ id:'r1:nvidia/u', model:'nvidia/u', symbol:'XUSDT', side:'SHORT', stopPct:2, targetPct:4.5, horizonH:6, done:false, why:'w', ...o });

test('R2544.158 only a word holder trades; candidates, twins, labels, the brains and NONE stay in the shadow', () => {
  const s = K.liveSignal(rec({}), k);
  assert.deepStrictEqual([s.model, s.side, s.stopPct, s.targetPct, s.horizonH, s.record.n], ['nvidia/u', 'SHORT', 2, 4.5, 6, 41]);
  assert.ok(K.liveSignal(rec({ model:'ORTAK' }), k), 'the crowd holds the word too');
  for (const o of [{ model:'gpt' }, { model:'PUSU:nvidia/u' }, { model:'_ETIKET' }, { model:'BEYIN2' }, { side:'NONE' }, { done:true }, { stopPct:0.5 }, { targetPct:1 }])
    assert.strictEqual(K.liveSignal(rec(o), k), null, JSON.stringify(o));
  assert.strictEqual(K.liveSignal(rec({}), { rows:[] }), null, 'no karne, no word');
});

test('R2544.158 the plan is the member\'s own stop / target in % from the price, held until its horizon', () => {
  let p = K.sozPlan(100, { side:'SHORT', stopPct:2, targetPct:4.5, horizonH:6 });
  assert.deepStrictEqual([p.ok, p.stopPrice, +p.tpPrice.toFixed(6), p.stopPct, p.targetR, p.maxHoldMs], [true, 102, 95.5, 0.02, 2.25, 6 * 3600000]);
  p = K.sozPlan(50, { side:'LONG', stopPct:1.5, targetPct:3, horizonH:2 });
  assert.deepStrictEqual([+p.stopPrice.toFixed(6), +p.tpPrice.toFixed(6), p.targetR], [49.25, 51.5, 2]);
  assert.strictEqual(K.sozPlan(0, { side:'LONG', stopPct:2, targetPct:4 }).ok, false);
  assert.strictEqual(K.SOZ.lane, 'KESIF'); assert.strictEqual(K.SOZ.maxActive, 2);
});
