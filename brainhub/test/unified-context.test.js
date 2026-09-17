'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUnifiedContext, planFields } = require('../pipeline');

const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);

function tf(frame, opts = {}) {
  return {
    available: true,
    frame,
    asOf: opts.asOf ?? NOW - 30000,
    close: opts.close ?? 100,
    trend: opts.trend ?? 'UP',
    rsi14: 58,
    atrPct: 1.2,
    breakOfStructure: opts.breakOfStructure ?? null,
    prior20High: opts.prior20High ?? 105,
    prior20Low: opts.prior20Low ?? 95,
    returnPct: 1.1,
    candle: { direction:'BULL', bodyPct:65, upperWickPct:15, lowerWickPct:20 },
    patterns: opts.patterns ?? [],
    buySideLiquidity: 105,
    sellSideLiquidity: 95,
    recentFairValueGaps: [],
    liquidity: { equalHigh:null, equalLow:null, lastSweep:null },
    opportunity: {
      available: true,
      state: 'WATCH',
      preferredSide: opts.preferredSide ?? 'LONG',
      longScore: opts.longScore ?? 65,
      shortScore: opts.shortScore ?? 10,
      originEligible: true,
      ownerEligible: true
    }
  };
}

function symbol(frames, bid = 99.9, ask = 100.1) {
  return {
    symbol: 'TESTUSDT',
    generatedAt: new Date(NOW).toISOString(),
    timeframes: frames,
    microstructure: {
      available:true,
      bid,
      ask,
      spreadBps:2,
      depth20Imbalance:0.12,
      cvdSampleQuote:1000,
      cvdSampleTrades:20,
      ofiProxyQuote:null
    }
  };
}

const global = {
  btc:{available:false,reason:'TEST'},
  eth:{available:false,reason:'TEST'},
  ethbtc:{available:false,reason:'TEST'},
  marketCap:{available:false,reason:'TEST'}
};

test('1m opportunity can originate without waiting for unavailable 15m', () => {
  const u = buildUnifiedContext({
    symbol: symbol({ '1m':tf('1m'), '15m':{available:false,reason:'TEST_UNAVAILABLE'} }),
    global,
    now: NOW
  });
  assert.equal(u.dataQuality.advisoryUsable, true);
  assert.equal(u.opportunityPaths.LONG.originTF, '1m');
  assert.equal(u.opportunityPaths.LONG.ownerTF, '1m');
  assert.equal(u.policy.unifiedEngineDoesNotWaitFor15m, true);
  assert.equal(u.policy.legacy15mStillRequiresCompleted15m, true);
  assert.equal(u.policy.execution, 'ADVISORY_ONLY');
});

test('3m LONG can originate while a fresh 15m context disagrees', () => {
  const u = buildUnifiedContext({
    symbol: symbol({
      '3m':tf('3m',{preferredSide:'LONG',longScore:74,shortScore:8,trend:'UP'}),
      '15m':tf('15m',{preferredSide:'SHORT',longScore:12,shortScore:72,trend:'DOWN',asOf:NOW-60000})
    }),
    global,
    now: NOW
  });
  assert.equal(u.opportunityPaths.LONG.originTF, '3m');
  assert.equal(u.opportunityPaths.LONG.ownerTF, '3m');
  assert.equal(u.opportunityPaths.SHORT.originTF, '15m');
  assert.equal(u.policy.timeframesAreNotVotes, true);
});

test('5m SHORT can originate without waiting for 15m LONG context', () => {
  const u = buildUnifiedContext({
    symbol: symbol({
      '5m':tf('5m',{preferredSide:'SHORT',longScore:9,shortScore:77,trend:'DOWN'}),
      '15m':tf('15m',{preferredSide:'LONG',longScore:69,shortScore:11,trend:'UP',asOf:NOW-60000})
    }),
    global,
    now: NOW
  });
  assert.equal(u.opportunityPaths.SHORT.originTF, '5m');
  assert.equal(u.opportunityPaths.SHORT.ownerTF, '5m');
  assert.equal(u.opportunityPaths.LONG.originTF, '15m');
  assert.equal(u.policy.unifiedEngineDoesNotWaitFor15m, true);
});

test('failed breakout blocks that timeframe until reclaim or alternate path', () => {
  const one = tf('1m', {
    close:101,
    prior20High:100,
    breakOfStructure:'UP',
    longScore:82
  });
  const u = buildUnifiedContext({ symbol:symbol({ '1m':one }, 99.4, 99.6), global, now:NOW });
  assert.equal(u.frames['1m'].breakoutExecution.status, 'FAILED_BREAKOUT');
  assert.equal(u.opportunityPaths.LONG.originTF, null);
  assert.equal(u.opportunityPaths.LONG.continuity[0].state, 'WAIT_RECLAIM');
  assert.equal(u.opportunityPaths.LONG.continuity[0].immediateEligible, false);
});

test('continuity can hand off informational ownership from 1m toward higher frames', () => {
  const u = buildUnifiedContext({
    symbol:symbol({
      '1m':tf('1m',{longScore:62}),
      '5m':tf('5m',{longScore:68,asOf:NOW-60000}),
      '1h':tf('1h',{longScore:71,asOf:NOW-5*60000})
    }),
    global,
    now:NOW
  });
  assert.equal(u.opportunityPaths.LONG.originTF, '1m');
  assert.equal(u.opportunityPaths.LONG.ownerTF, '1h');
  assert.deepEqual(u.opportunityPaths.LONG.continuity.map(x=>x.frame), ['1m','5m','1h']);
  assert.match(u.opportunityPaths.LONG.handoffNote, /must not widen/);
});

test('structured plan parser captures origin, owner and execution path while staying advisory', () => {
  const p = planFields([
    'STATUS: QUALIFIED',
    'SIDE: SHORT',
    'CONFIDENCE: 73',
    'ORIGIN_TF: 3m',
    'OWNER_TF: 15m',
    'SETUP: SWEEP_RECLAIM',
    'EXEC_PATH: MICRO_BOS',
    'WHY: test',
    'RISK_NOTE: structural stop'
  ].join('\n'));
  assert.equal(p.valid, true);
  assert.equal(p.originTF, '3m');
  assert.equal(p.ownerTF, '15m');
  assert.equal(p.execPath, 'MICRO_BOS');
  assert.equal(p.execution, 'ADVISORY_ONLY');
});
