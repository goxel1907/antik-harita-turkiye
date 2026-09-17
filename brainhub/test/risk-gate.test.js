'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightRiskGate, accountRiskCaps } = require('../risk-gate');

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
