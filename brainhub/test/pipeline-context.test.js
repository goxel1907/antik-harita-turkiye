'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUnifiedContext, liquidationContext, planFields, combineRiskGate } = require('../pipeline');
const { preflightRiskGate, accountRiskCaps, structuralStopGate, killSwitchGate, executionClaimGate } = require('../risk-gate');

function frame(asOf, longScore, shortScore) {
  return {
    available:true, asOf, close:100, trend:longScore > shortScore ? 'UP' : 'DOWN', rsi14:55, atrPct:1,
    prior20High:101, prior20Low:99, breakOfStructure:null, returnPct:0.5,
    candle:{ direction:'BULL' }, patterns:[], recentFairValueGaps:[], buySideLiquidity:101, sellSideLiquidity:99,
    liquidity:{ equalHigh:null, equalLow:null, lastSweep:null },
    opportunity:{ available:true, longScore, shortScore, state:'WATCH', preferredSide:longScore > shortScore ? 'LONG' : 'SHORT', originEligible:true, ownerEligible:true }
  };
}

function unifiedFixture() {
  const now = Date.UTC(2026, 8, 17, 10, 0, 0);
  const symbol = {
    symbol:'BTCUSDT',
    timeframes:{
      '1m':frame(now - 60000, 70, 10),
      '3m':frame(now - 180000, 62, 15),
      '5m':frame(now - 300000, 55, 20),
      '15m':frame(now - 15 * 60000, 20, 20)
    },
    microstructure:{
      available:true, bid:100, ask:100.1, sourceQuality:'STREAMING_PARTIAL_BOOK',
      streaming:{ available:true },
      observedLiquidations:{ available:true, count:1, asOf:now, longLiquidatedQuote:25000, shortLiquidatedQuote:0, zones:[{side:'LONG_LIQUIDATED',price:99.5,observedQuote:25000}] }
    },
    streamHealth:{ connected:true }
  };
  const global = { marketCap:{available:false}, btc:{available:false}, eth:{available:false}, ethbtc:{available:false} };
  return { now, unified:buildUnifiedContext({ symbol, global, now }) };
}

function qualifiedPlan() {
  return planFields([
    'STATUS: QUALIFIED',
    'SIDE: LONG',
    'CONFIDENCE: 78',
    'ORIGIN_TF: 1m',
    'OWNER_TF: 5m',
    'SETUP: continuation',
    'EXEC_PATH: reclaim-or-continuity',
    'WHY: deterministic regression fixture',
    'RISK_NOTE: preserve structural invalidation',
    'EXECUTION: ADVISORY_ONLY'
  ].join('\n'));
}

test('Unified Brain can originate at 1m without waiting for 15m and carries observed liquidations as context', () => {
  const { unified:u } = unifiedFixture();
  assert.equal(u.opportunityPaths.LONG.originTF, '1m');
  assert.equal(u.opportunityPaths.LONG.ownerTF, '5m');
  assert.equal(u.policy.unifiedEngineDoesNotWaitFor15m, true);
  assert.equal(u.liquidationContext.available, true);
  assert.equal(u.liquiditySemantics.marketMakerIntent, 'NOT_INFERRED');
  assert.equal(u.dataQuality.microstructureQuality, 'STREAMING_PARTIAL_BOOK');
});

test('pipeline risk gate can qualify dry-run context but never authorizes live execution', () => {
  const { unified } = unifiedFixture();
  const plan = qualifiedPlan();
  const riskGate = preflightRiskGate({ plan, unified });
  const pipelineLikeOutput = { plan, riskGate, execution:'ADVISORY_ONLY', orderPlaced:false };
  assert.equal(pipelineLikeOutput.riskGate.ok, true);
  assert.equal(pipelineLikeOutput.riskGate.eligibleForDryRun, true);
  assert.equal(pipelineLikeOutput.riskGate.liveAllowed, false);
  assert.equal(pipelineLikeOutput.execution, 'ADVISORY_ONLY');
  assert.equal(pipelineLikeOutput.orderPlaced, false);
});

test('combined pipeline gate is fail-closed until account caps, structural stop, kill-switch and execution claim all pass', () => {
  const { unified } = unifiedFixture();
  const preflight = preflightRiskGate({ plan:qualifiedPlan(), unified });
  assert.equal(preflight.ok, true);

  const passingStop = structuralStopGate({
    side:'LONG',
    entryPrice:100.05,
    stopPrice:98.8,
    structuralInvalidationPrice:99,
    bufferQuote:0.1
  });
  assert.equal(passingStop.ok, true);

  const passingKillSwitch = killSwitchGate({
    control:{ available:true, tripped:false, dryRunEnabled:true }
  });
  assert.equal(passingKillSwitch.ok, true);

  const passingClaim = executionClaimGate({
    claim:{ claimed:true, lineageId:'lineage-regression-001' }
  });
  assert.equal(passingClaim.ok, true);

  const missingAccount = accountRiskCaps({});
  const accountBlocked = combineRiskGate(preflight, missingAccount, passingStop, passingKillSwitch, passingClaim);
  assert.equal(accountBlocked.ok, false);
  assert.equal(accountBlocked.eligibleForDryRun, false);
  assert.equal(accountBlocked.liveAllowed, false);
  assert.ok(accountBlocked.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'));
  assert.equal(accountBlocked.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'), false);
  assert.equal(accountBlocked.remainingMandatoryControls.includes('KILL_SWITCH'), false);
  assert.equal(accountBlocked.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'), false);

  const passingAccount = accountRiskCaps({
    account:{ available:true, equity:10000, dailyRealizedPnl:-50, openPositions:1 },
    intent:{ riskQuote:50, notionalQuote:1000, family:'ALT', familyExposureAfterQuote:1500 },
    limits:{
      maxRiskPctPerTrade:1,
      maxNotionalPctPerTrade:20,
      maxDailyLossPct:3,
      maxOpenPositions:3,
      maxFamilyExposurePct:25
    }
  });
  assert.equal(passingAccount.ok, true);

  const missingStop = structuralStopGate({ side:'LONG' });
  const stopBlocked = combineRiskGate(preflight, passingAccount, missingStop, passingKillSwitch, passingClaim);
  assert.equal(stopBlocked.ok, false);
  assert.equal(stopBlocked.eligibleForDryRun, false);
  assert.equal(stopBlocked.liveAllowed, false);
  assert.ok(stopBlocked.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'));
  assert.equal(stopBlocked.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'), false);
  assert.equal(stopBlocked.remainingMandatoryControls.includes('KILL_SWITCH'), false);
  assert.equal(stopBlocked.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'), false);

  const missingKillSwitch = killSwitchGate({});
  const killSwitchBlocked = combineRiskGate(preflight, passingAccount, passingStop, missingKillSwitch, passingClaim);
  assert.equal(killSwitchBlocked.ok, false);
  assert.equal(killSwitchBlocked.eligibleForDryRun, false);
  assert.equal(killSwitchBlocked.liveAllowed, false);
  assert.ok(killSwitchBlocked.remainingMandatoryControls.includes('KILL_SWITCH'));
  assert.equal(killSwitchBlocked.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'), false);
  assert.equal(killSwitchBlocked.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'), false);
  assert.equal(killSwitchBlocked.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'), false);

  const missingClaim = executionClaimGate({});
  const claimBlocked = combineRiskGate(preflight, passingAccount, passingStop, passingKillSwitch, missingClaim);
  assert.equal(claimBlocked.ok, false);
  assert.equal(claimBlocked.eligibleForDryRun, false);
  assert.equal(claimBlocked.liveAllowed, false);
  assert.ok(claimBlocked.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'));
  assert.equal(claimBlocked.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'), false);
  assert.equal(claimBlocked.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'), false);
  assert.equal(claimBlocked.remainingMandatoryControls.includes('KILL_SWITCH'), false);

  const allowed = combineRiskGate(preflight, passingAccount, passingStop, passingKillSwitch, passingClaim);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.eligibleForDryRun, true);
  assert.equal(allowed.liveAllowed, false);
  assert.equal(allowed.execution, 'ADVISORY_ONLY');
  assert.equal(allowed.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'), false);
  assert.equal(allowed.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'), false);
  assert.equal(allowed.remainingMandatoryControls.includes('KILL_SWITCH'), false);
  assert.equal(allowed.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'), false);
});

test('missing force-order prints never become a fabricated liquidation map', () => {
  const x = liquidationContext({ observedLiquidations:{ available:false, count:0 } });
  assert.equal(x.available, false);
  assert.equal(x.reason, 'NO_RECENT_OBSERVED_FORCE_ORDER_PRINTS');
  assert.match(x.note, /Do not fabricate/);
});
