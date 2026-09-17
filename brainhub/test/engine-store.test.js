'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseKlines, aggregate45m, structure, analyzeFrames, breakoutExecution, microstructure, handoff, FRAMES, NATIVE_FRAMES } = require('../engine');
const { openStore } = require('../store');
const { planFields } = require('../pipeline');

function rawBar(openTime, minutes, p, closeDelta = 0.4) {
  return [openTime, String(p), String(p + 1), String(p - 1), String(p + closeDelta), '10', openTime + minutes * 60000 - 1, '1000', 1, '1', '550'];
}

test('all requested timeframes and closed-candle structure', () => {
  assert.deepEqual(FRAMES, ['1m','3m','5m','15m','30m','45m','1h','4h','1d']);
  assert.equal(NATIVE_FRAMES.includes('45m'), false);
  const now = Date.now();
  const raw = Array.from({ length: 70 }, (_, i) => {
    const p = 100 + i * 0.1;
    return [now - (71 - i) * 60000, String(p), String(p + 1), String(p - 1), String(p + 0.4), '50', now - (70 - i) * 60000 - 1, '5000', 10, '20', '2500'];
  });
  raw.push([now - 60000, '110','111','109','110','50',now + 60000,'5000',10,'20','2500']);
  const c = parseKlines(raw, now);
  assert.equal(c.length, 70);
  const out = structure(c, '1m');
  assert.equal(out.available, true);
  assert.ok(out.ema20 > out.ema50);
  assert.equal(out.trend, 'UP');
  assert.ok(out.buySideLiquidity > out.sellSideLiquidity);
  assert.equal(out.opportunity.originEligible, true);
  assert.equal(out.opportunity.ownerEligible, true);
});

test('45m uses exactly three closed UTC-aligned 15m candles', () => {
  const bucket = Date.UTC(2026, 8, 17, 9, 0, 0);
  const now = bucket + 60 * 60000;
  const raw = [
    rawBar(bucket, 15, 100),
    rawBar(bucket + 15 * 60000, 15, 101),
    rawBar(bucket + 30 * 60000, 15, 102),
    rawBar(bucket + 45 * 60000, 15, 103)
  ];
  const out = aggregate45m(parseKlines(raw, now), now);
  assert.equal(out.length, 1);
  assert.equal(out[0].openTime, bucket);
  assert.equal(out[0].open, 100);
  assert.equal(out[0].high, 103);
  assert.equal(out[0].low, 99);
  assert.equal(out[0].close, 102.4);
  assert.equal(out[0].volume, 30);
});

test('all 9 timeframe analyses are returned and 45m is derived from 15m', () => {
  const end = Date.UTC(2026, 8, 17, 12, 0, 0);
  const rawByFrame = {};
  const start15 = end - 180 * 15 * 60000;
  rawByFrame['15m'] = Array.from({ length: 180 }, (_, i) => rawBar(start15 + i * 15 * 60000, 15, 100 + i * 0.1));
  for (const frame of NATIVE_FRAMES.filter(x => x !== '15m')) {
    const minutes = { '1m':1, '3m':3, '5m':5, '30m':30, '1h':60, '4h':240, '1d':1440 }[frame];
    const start = end - 70 * minutes * 60000;
    rawByFrame[frame] = Array.from({ length: 70 }, (_, i) => rawBar(start + i * minutes * 60000, minutes, 100 + i * 0.1));
  }
  const out = analyzeFrames(rawByFrame, end + 1);
  assert.deepEqual(Object.keys(out), FRAMES);
  assert.equal(out['45m'].available, true);
  assert.equal(out['1m'].opportunity.originEligible, true);
});

test('POWER regression rejects confirmed LONG breakout after live trigger loss until reclaim', () => {
  const failed = breakoutExecution({ side:'LONG', confirmedClose:0.13428, trigger:0.13299, livePrice:0.13261 });
  assert.equal(failed.allowed, false);
  assert.equal(failed.status, 'FAILED_BREAKOUT');
  assert.equal(failed.waitFor, '5M_RECLAIM_OR_VALID_ALTERNATE_PATH');
  const reclaimed = breakoutExecution({ side:'LONG', confirmedClose:0.13428, trigger:0.13299, livePrice:0.13261, reclaimConfirmed:true });
  assert.equal(reclaimed.allowed, true);
  assert.equal(reclaimed.status, 'RECLAIMED');
});

test('failed breakdown protection is symmetric for SHORT', () => {
  const failed = breakoutExecution({ side:'SHORT', confirmedClose:99, trigger:100, livePrice:100.2 });
  assert.equal(failed.allowed, false);
  assert.equal(failed.status, 'FAILED_BREAKOUT');
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
  assert.equal(handoff(90, 95, 'LONG').allowed, true);
  assert.equal(handoff(110, 120, 'SHORT').allowed, false);
  assert.equal(handoff(110, 105, 'SHORT').allowed, true);
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

    const lineageId = 'BTCUSDT:LONG:lineage-0001';
    const firstLineageClaim = store.claim('signal-0101','PHONE','EXECUTOR',token1,lineageId);
    assert.equal(firstLineageClaim.claimed, true);
    assert.equal(firstLineageClaim.lineageId, lineageId);
    const handoffDuplicate = store.claim('signal-0102','PHONE','EXECUTOR',token1,lineageId);
    assert.equal(handoffDuplicate.claimed, false);
    assert.equal(handoffDuplicate.reason, 'DUPLICATE_LINEAGE');
    assert.equal(handoffDuplicate.original.event_id, 'signal-0101');

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
