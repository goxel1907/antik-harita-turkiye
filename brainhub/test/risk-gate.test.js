'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightRiskGate, accountRiskCaps, structuralStopGate, killSwitchGate, executionClaimGate } = require('../risk-gate');

function baseUnified() {
  return {
    livePrice:100.25,
    dataQuality:{ advisoryUsable:true },
    frames:{
      '1m':{ available:true, fresh:true, breakoutExecution:{ status:'CONFIRMED' } },
      '5m':{ available:true, fresh:true, breakoutExecution:{ status:'NO_ACTIVE_BREAKOUT' } }
    },
    opportunityPaths:{
      LONG:{
        continuity:[
          { frame:'1m', immediateEligible:true },
          { frame:'5m', immediateEligible:true }
        ]
      },
      SHORT:{ continuity:[] }
    }
  };
}

function accountCase() {
  return {
    account:{ available:true, equity:1000, dailyRealizedPnl:-20, openPositions:1 },
    intent:{ riskQuote:5, notionalQuote:100, family:'ALT_LONG', familyExposureAfterQuote:200 },
    limits:{
      maxRiskPctPerTrade:1,
      maxNotionalPctPerTrade:20,
      maxDailyLossPct:5,
      maxOpenPositions:3,
      maxFamilyExposurePct:30
    }
  };
}

test('qualified fresh continuity is eligible only for dry-run, never live', () => {
  const out = preflightRiskGate({
    plan:{ valid:true, status:'QUALIFIED', side:'LONG', originTF:'1m', ownerTF:'5m' },
    unified:baseUnified()
  });
  assert.equal(out.ok, true);
  assert.equal(out.eligibleForDryRun, true);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.execution, 'ADVISORY_ONLY');
  assert.deepEqual(out.reasons, []);
});

test('stale failed-breakout origin is blocked from dry-run', () => {
  const unified = baseUnified();
  unified.frames['1m'] = {
    available:true,
    fresh:false,
    breakoutExecution:{ status:'FAILED_BREAKOUT' }
  };
  unified.opportunityPaths.LONG.continuity[0] = { frame:'1m', immediateEligible:false };

  const out = preflightRiskGate({
    plan:{ valid:true, status:'QUALIFIED', side:'LONG', originTF:'1m', ownerTF:'5m' },
    unified
  });
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('ORIGIN_TF_STALE'));
  assert.ok(out.reasons.includes('ORIGIN_NOT_IMMEDIATELY_ELIGIBLE'));
  assert.ok(out.reasons.includes('FAILED_BREAKOUT_REQUIRES_RECLAIM'));
});

test('owner timeframe cannot move below the origin timeframe', () => {
  const unified = baseUnified();
  unified.frames['15m'] = { available:true, fresh:true, breakoutExecution:{ status:'NO_ACTIVE_BREAKOUT' } };
  unified.opportunityPaths.LONG.continuity.push({ frame:'15m', immediateEligible:true });

  const out = preflightRiskGate({
    plan:{ valid:true, status:'QUALIFIED', side:'LONG', originTF:'15m', ownerTF:'5m' },
    unified
  });
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('OWNER_TF_BELOW_ORIGIN'));
});

test('account caps allow an in-limit intent only for dry-run', () => {
  const out = accountRiskCaps(accountCase());
  assert.equal(out.ok, true);
  assert.equal(out.eligibleForDryRun, true);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.execution, 'ADVISORY_ONLY');
  assert.deepEqual(out.reasons, []);
  assert.equal(out.caps.riskQuote, 10);
  assert.equal(out.caps.notionalQuote, 200);
  assert.equal(out.caps.dailyLossQuote, 50);
  assert.equal(out.caps.openPositions, 3);
  assert.equal(out.caps.familyExposureQuote, 300);
});

test('account caps fail closed when any mandatory limit is missing', () => {
  const input = accountCase();
  delete input.limits.maxDailyLossPct;
  const out = accountRiskCaps(input);
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('MAX_DAILY_LOSS_LIMIT_MISSING'));
  assert.equal(out.caps, null);
});

test('null and blank mandatory account values fail closed instead of becoming zero', () => {
  const input = accountCase();
  input.account.dailyRealizedPnl = null;
  input.intent.familyExposureAfterQuote = '   ';
  const out = accountRiskCaps(input);
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('DAILY_PNL_UNAVAILABLE'));
  assert.ok(out.reasons.includes('FAMILY_EXPOSURE_UNAVAILABLE'));
  assert.equal(out.metrics.dailyRealizedPnl, null);
  assert.equal(out.metrics.familyExposureAfterQuote, null);
});

test('daily realized loss at the cap blocks dry-run', () => {
  const input = accountCase();
  input.account.dailyRealizedPnl = -50;
  const out = accountRiskCaps(input);
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.ok(out.reasons.includes('DAILY_LOSS_CAP_REACHED'));
});

test('open position count at the cap blocks dry-run', () => {
  const input = accountCase();
  input.account.openPositions = 3;
  const out = accountRiskCaps(input);
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.ok(out.reasons.includes('OPEN_POSITION_CAP_REACHED'));
});

test('trade risk and notional above their caps are blocked independently', () => {
  const input = accountCase();
  input.intent.riskQuote = 11;
  input.intent.notionalQuote = 201;
  const out = accountRiskCaps(input);
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.ok(out.reasons.includes('TRADE_RISK_CAP_EXCEEDED'));
  assert.ok(out.reasons.includes('TRADE_NOTIONAL_CAP_EXCEEDED'));
});

test('family exposure above its cap blocks dry-run', () => {
  const input = accountCase();
  input.intent.familyExposureAfterQuote = 301;
  const out = accountRiskCaps(input);
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.ok(out.reasons.includes('FAMILY_EXPOSURE_CAP_EXCEEDED'));
});

test('LONG structural stop stays beyond invalidation plus explicit buffer', () => {
  const out = structuralStopGate({
    side:'LONG',
    entryPrice:100,
    stopPrice:97.5,
    structuralInvalidationPrice:98,
    bufferQuote:0.5
  });
  assert.equal(out.ok, true);
  assert.equal(out.eligibleForDryRun, true);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.structuralBoundary, 97.5);
  assert.deepEqual(out.reasons, []);
});

test('SHORT structural stop stays beyond invalidation plus explicit buffer', () => {
  const out = structuralStopGate({
    side:'SHORT',
    entryPrice:100,
    stopPrice:102.5,
    structuralInvalidationPrice:102,
    bufferQuote:0.5
  });
  assert.equal(out.ok, true);
  assert.equal(out.eligibleForDryRun, true);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.structuralBoundary, 102.5);
  assert.deepEqual(out.reasons, []);
});

test('blank structural stop fields fail closed instead of becoming zero', () => {
  const out = structuralStopGate({
    side:'LONG',
    entryPrice:' ',
    stopPrice:'',
    structuralInvalidationPrice:'   ',
    bufferQuote:' '
  });
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('ENTRY_PRICE_INVALID'));
  assert.ok(out.reasons.includes('STOP_PRICE_INVALID'));
  assert.ok(out.reasons.includes('STRUCTURAL_INVALIDATION_INVALID'));
  assert.ok(out.reasons.includes('STOP_BUFFER_INVALID'));
  assert.equal(out.entryPrice, null);
  assert.equal(out.stopPrice, null);
  assert.equal(out.structuralInvalidationPrice, null);
  assert.equal(out.bufferQuote, null);
});

test('stop inside structural invalidation buffer is blocked on both sides', () => {
  const longOut = structuralStopGate({
    side:'LONG', entryPrice:100, stopPrice:97.8,
    structuralInvalidationPrice:98, bufferQuote:0.5
  });
  const shortOut = structuralStopGate({
    side:'SHORT', entryPrice:100, stopPrice:102.2,
    structuralInvalidationPrice:102, bufferQuote:0.5
  });
  assert.equal(longOut.ok, false);
  assert.equal(shortOut.ok, false);
  assert.ok(longOut.reasons.includes('STOP_INSIDE_STRUCTURAL_INVALIDATION'));
  assert.ok(shortOut.reasons.includes('STOP_INSIDE_STRUCTURAL_INVALIDATION'));
});

test('handoff stop may tighten but never widen original risk on LONG or SHORT', () => {
  const longTighten = structuralStopGate({
    side:'LONG', entryPrice:100, stopPrice:97.5,
    structuralInvalidationPrice:98, bufferQuote:0.5, initialStopPrice:97
  });
  const longWiden = structuralStopGate({
    side:'LONG', entryPrice:100, stopPrice:96.5,
    structuralInvalidationPrice:98, bufferQuote:0.5, initialStopPrice:97
  });
  const shortTighten = structuralStopGate({
    side:'SHORT', entryPrice:100, stopPrice:102.5,
    structuralInvalidationPrice:102, bufferQuote:0.5, initialStopPrice:103
  });
  const shortWiden = structuralStopGate({
    side:'SHORT', entryPrice:100, stopPrice:103.5,
    structuralInvalidationPrice:102, bufferQuote:0.5, initialStopPrice:103
  });
  assert.equal(longTighten.ok, true);
  assert.equal(shortTighten.ok, true);
  assert.equal(longWiden.ok, false);
  assert.equal(shortWiden.ok, false);
  assert.ok(longWiden.reasons.includes('STOP_WOULD_WIDEN_RISK'));
  assert.ok(shortWiden.reasons.includes('STOP_WOULD_WIDEN_RISK'));
  assert.equal(longWiden.liveAllowed, false);
  assert.equal(shortWiden.liveAllowed, false);
});

test('healthy kill switch permits dry-run only and never live', () => {
  const out = killSwitchGate({
    control:{ available:true, tripped:false, dryRunEnabled:true }
  });
  assert.equal(out.ok, true);
  assert.equal(out.eligibleForDryRun, true);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.execution, 'ADVISORY_ONLY');
  assert.deepEqual(out.reasons, []);
});

test('tripped kill switch blocks dry-run immediately', () => {
  const out = killSwitchGate({
    control:{ available:true, tripped:true, dryRunEnabled:true }
  });
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('KILL_SWITCH_TRIPPED'));
});

test('missing kill switch source or state fails closed', () => {
  const out = killSwitchGate({ control:{} });
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('KILL_SWITCH_UNAVAILABLE'));
  assert.ok(out.reasons.includes('KILL_SWITCH_STATE_UNKNOWN'));
  assert.ok(out.reasons.includes('DRY_RUN_SWITCH_STATE_UNKNOWN'));
});

test('disabled dry-run switch blocks execution even when kill switch is healthy', () => {
  const out = killSwitchGate({
    control:{ available:true, tripped:false, dryRunEnabled:false }
  });
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('DRY_RUN_DISABLED'));
});

test('successful execution claim permits dry-run only and never live', () => {
  const out = executionClaimGate({ claim:{ claimed:true, lineageId:'lineage:btc:001' } });
  assert.equal(out.ok, true);
  assert.equal(out.eligibleForDryRun, true);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.execution, 'ADVISORY_ONLY');
  assert.equal(out.claimed, true);
  assert.equal(out.lineageId, 'lineage:btc:001');
  assert.deepEqual(out.reasons, []);
});

test('unknown execution claim state fails closed', () => {
  const out = executionClaimGate({ claim:{} });
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('EXECUTION_CLAIM_STATE_UNKNOWN'));
});

test('claim rejection preserves lease and duplicate failure classes', () => {
  const noLease = executionClaimGate({ claim:{ claimed:false, reason:'NO_VALID_LEASE' } });
  const duplicateEvent = executionClaimGate({ claim:{ claimed:false, reason:'DUPLICATE' } });
  const duplicateLineage = executionClaimGate({ claim:{ claimed:false, reason:'DUPLICATE_LINEAGE' } });
  assert.ok(noLease.reasons.includes('NO_VALID_LEASE'));
  assert.ok(duplicateEvent.reasons.includes('DUPLICATE_EVENT_CLAIM'));
  assert.ok(duplicateLineage.reasons.includes('DUPLICATE_LINEAGE_CLAIM'));
  assert.equal(noLease.eligibleForDryRun, false);
  assert.equal(duplicateEvent.eligibleForDryRun, false);
  assert.equal(duplicateLineage.eligibleForDryRun, false);
});

test('claimed execution without lineage id fails closed', () => {
  const out = executionClaimGate({ claim:{ claimed:true } });
  assert.equal(out.ok, false);
  assert.equal(out.eligibleForDryRun, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('LINEAGE_ID_MISSING'));
});
