'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseKlines, structure, microstructure, handoff, FRAMES } = require('../engine');
const { openStore } = require('../store');
const { planFields } = require('../pipeline');

test('all requested timeframes and closed-candle structure', () => {
  assert.deepEqual(FRAMES, ['1m','3m','5m','15m','30m','1h','4h','1d']);
  const now = Date.now();
  const raw = Array.from({ length: 70 }, (_, i) => {
    const p = 100 + i * 0.1;
    return [now - (71 - i) * 60000, String(p), String(p + 1), String(p - 1), String(p + 0.4), '50', now - (70 - i) * 60000 - 1, '5000', 10, '20', '2500'];
  });
  raw.push([now - 60000, '110','111','109','110','50',now + 60000,'5000',10,'20','2500']);
  const c = parseKlines(raw, now);
  assert.equal(c.length, 70);
  const out = structure(c);
  assert.equal(out.available, true);
  assert.ok(out.ema20 > out.ema50);
  assert.equal(out.trend, 'UP');
  assert.ok(out.buySideLiquidity > out.sellSideLiquidity);
});

test('microstructure labels sampled metrics and handoff never widens risk', () => {
  const now = Date.now();
  const depth = { bids: [['100','5']], asks: [['100.1','4']] };
  const a = microstructure(depth, [{ p:'100', q:'2', m:false, T:now }], null, now);
  assert.equal(a.available, true);
  assert.equal(a.cvdSampleQuote, 200);
  assert.equal(a.ofiProxyQuote, null);
  const b = microstructure(depth, [], a.snapshot, now + 1000);
  assert.equal(b.ofiProxyQuote, 0);
  assert.equal(handoff(90, 80, 'LONG').allowed, false);
  assert.equal(handoff(110, 120, 'SHORT').allowed, false);
});

test('SQLite journal, outcome labels, exclusive lease and duplicate claim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brainhub-test-'));
  try {
    const store = openStore(root);
    const id = store.journal('PLAN', 'BTCUSDT', { status:'WATCH' });
    assert.equal(store.label(id, 'WIN'), true);
    assert.equal(store.getJournal()[0].outcome, 'WIN');
    assert.equal(store.learning().changesAppliedToTrading, false);
    const token1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const token2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    assert.equal(store.lease('acquire','EXECUTOR','PHONE',token1,30000).acquired, true);
    assert.equal(store.lease('acquire','EXECUTOR','PC',token2,30000).acquired, false);
    assert.equal(store.claim('signal-0001','PHONE','EXECUTOR',token1).claimed, true);
    assert.equal(store.claim('signal-0001','PHONE','EXECUTOR',token1).reason, 'DUPLICATE');
    assert.equal(store.claim('signal-0002','PC','EXECUTOR',token2).reason, 'NO_VALID_LEASE');
    assert.equal(store.lease('release','EXECUTOR','PHONE',token1).released, true);
    assert.equal(store.lease('acquire','EXECUTOR','PC',token2,30000).acquired, true);
    store.db.close();
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('committee output must be structured and remains advisory', () => {
  assert.equal(planFields('buy now').valid, false);
  assert.deepEqual(planFields('STATUS: QUALIFIED\nSIDE: LONG\nCONFIDENCE: 70\nWHY: test\nRISK_NOTE: risk').execution, 'ADVISORY_ONLY');
});
