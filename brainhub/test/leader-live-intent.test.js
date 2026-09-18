'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLeaderLiveIntent } = require('../leader-live-intent');

function base({ side='LONG', livePrice=100, low=98, high=102, atrPct=1 } = {}) {
  return {
    candidate:{ symbol:'AAAUSDT', side },
    unified:{
      symbol:'AAAUSDT',
      livePrice,
      frames:{
        '1m':{
          available:true,
          fresh:true,
          prior20Low:low,
          prior20High:high,
          atrPct
        }
      }
    },
    plan:{ status:'QUALIFIED', side, originTF:'1m' },
    marginQuote:20,
    leverage:10,
    filters:{
      tickSize:0.1,
      lotStep:0.01,
      minQty:0.01,
      maxQty:1000,
      minNotional:5
    }
  };
}

test('LONG intent uses structural prior low plus buffer and tick-safe 1R/2R/3R targets', () => {
  const out = buildLeaderLiveIntent(base({ side:'LONG', livePrice:100, low:98, high:103, atrPct:1 }));
  assert.equal(out.ok, true);
  assert.equal(out.symbol, 'AAAUSDT');
  assert.equal(out.side, 'LONG');
  assert.equal(out.originTF, '1m');
  assert.ok(out.stopPrice <= out.structuralInvalidationPrice - out.buffer + 1e-9);
  assert.ok(out.stopPrice < out.entryPrice);
  assert.ok(out.entryPrice < out.takeProfit1);
  assert.ok(out.takeProfit1 < out.takeProfit2);
  assert.ok(out.takeProfit2 < out.takeProfit3);
  assert.equal(out.quantity, 2);
  assert.equal(out.notionalQuote, 200);
  assert.ok(out.riskQuote > 0);
});

test('SHORT intent uses structural prior high plus buffer and valid descending targets', () => {
  const out = buildLeaderLiveIntent(base({ side:'SHORT', livePrice:100, low:97, high:102, atrPct:1 }));
  assert.equal(out.ok, true);
  assert.ok(out.stopPrice >= out.structuralInvalidationPrice + out.buffer - 1e-9);
  assert.ok(out.stopPrice > out.entryPrice);
  assert.ok(out.entryPrice > out.takeProfit1);
  assert.ok(out.takeProfit1 > out.takeProfit2);
  assert.ok(out.takeProfit2 > out.takeProfit3);
  assert.ok(out.takeProfit3 > 0);
});

test('candidate and qualified plan must agree on side', () => {
  const x = base({ side:'LONG' });
  x.plan.side = 'SHORT';
  const out = buildLeaderLiveIntent(x);
  assert.equal(out.ok, false);
  assert.ok(out.reasons.includes('CANDIDATE_PLAN_SIDE_MISMATCH'));
});

test('WATCH plan cannot create a LIVE intent', () => {
  const x = base({ side:'LONG' });
  x.plan.status = 'WATCH';
  const out = buildLeaderLiveIntent(x);
  assert.equal(out.ok, false);
  assert.ok(out.reasons.includes('PLAN_NOT_QUALIFIED'));
});

test('stale origin frame cannot create a LIVE intent', () => {
  const x = base({ side:'LONG' });
  x.unified.frames['1m'].fresh = false;
  const out = buildLeaderLiveIntent(x);
  assert.equal(out.ok, false);
  assert.ok(out.reasons.includes('ORIGIN_FRAME_NOT_FRESH'));
});

test('quantity is floored to lot step without exceeding requested notional', () => {
  const x = base({ side:'LONG', livePrice:123.45, low:121.1, high:126, atrPct:0.8 });
  x.filters.lotStep = 0.1;
  const out = buildLeaderLiveIntent(x);
  assert.equal(out.ok, true);
  assert.equal(out.quantity, 1.6);
  assert.ok(out.notionalQuote <= 200 + 1e-9);
});
