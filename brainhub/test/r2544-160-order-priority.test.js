'use strict';
// R2544.160: an order never waits behind public scans in the Binance queue; reads of the account come right after orders
const test = require('node:test'), assert = require('node:assert');
process.env.BINANCE_REST_MIN_GAP_MS = '0'; // the order under test, not the pacing (a timer race made it flaky under load)
const RL = require('../binance-rate-limit');

test('R2544.160 queue order: LIVE_WRITE first, then LIVE_READ, then PUBLIC (each kind first-come first-served)', async () => {
  RL.resetForTests();
  const busy = await Promise.all([0, 1, 2, 3].map(() => RL.acquire({ path:'/fapi/v1/ticker/price', kind:'PUBLIC', weight:1 })));
  const order = [], go = (kind, tag) => RL.acquire({ path:'/fapi/v1/x', kind, weight:1, maxWaitMs:5000 }).then(p => { order.push(tag); p.release(); });
  const all = [go('PUBLIC', 'p1'), go('PUBLIC', 'p2'), go('LIVE_READ', 'r1'), go('PUBLIC', 'p3'), go('LIVE_WRITE', 'w1'), go('LIVE_READ', 'r2'), go('LIVE_WRITE', 'w2')];
  assert.strictEqual(RL.status().queued, 7);
  busy.forEach(p => p.release());
  await Promise.all(all);
  assert.deepStrictEqual(order.slice(0, 4), ['w1', 'w2', 'r1', 'r2'], 'orders first, then account reads');
  assert.deepStrictEqual(order.slice(4), ['p1', 'p2', 'p3'], 'public reads keep their order at the back');
  RL.resetForTests();
});
