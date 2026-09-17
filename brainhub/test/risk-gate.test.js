'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightRiskGate } = require('../risk-gate');

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
