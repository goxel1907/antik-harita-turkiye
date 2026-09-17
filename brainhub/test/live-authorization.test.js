'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveAuthorizationRegistry } = require('../live-authorization');

function order(overrides = {}) {
  return {
    action:'OPEN',
    symbol:'BTCUSDT',
    side:'LONG',
    orderType:'MARKET',
    quantity:0.01,
    entryPrice:100.05,
    stopPrice:98.8,
    limitPrice:null,
    clientOrderId:'live-grant-regression-001',
    lineageId:'lineage-live-regression-001',
    ...overrides
  };
}

function ready(o = order()) {
  return {
    ok:true,
    eligibleForDryRun:true,
    liveAllowed:false,
    execution:'ADVISORY_ONLY',
    dryRunExecutor:{
      ok:true,
      simulated:true,
      submitted:false,
      liveAllowed:false,
      order:o,
      transport:{ attempted:false, requestSent:false }
    }
  };
}

function apiPolicy(overrides = {}) {
  return {
    ok:true,
    futureLiveSetupEligible:true,
    withdrawalsEnabled:false,
    ipRestricted:true,
    ...overrides
  };
}

test('live grant is never issued without explicit user approval and permission policy', () => {
  const registry = new LiveAuthorizationRegistry();
  const noApproval = registry.issue({
    executionReadiness:ready(),
    apiPolicy:apiPolicy(),
    userApproved:false,
    order:order(),
    now:1000
  });
  assert.equal(noApproval.ok, false);
  assert.equal(noApproval.liveAllowed, false);
  assert.ok(noApproval.reasons.includes('LIVE_USER_APPROVAL_REQUIRED'));

  const badPermissions = registry.issue({
    executionReadiness:ready(),
    apiPolicy:apiPolicy({ ok:false, futureLiveSetupEligible:false, withdrawalsEnabled:true, ipRestricted:false }),
    userApproved:true,
    order:order(),
    now:1000
  });
  assert.equal(badPermissions.ok, false);
  assert.equal(badPermissions.liveAllowed, false);
  assert.ok(badPermissions.reasons.includes('API_PERMISSION_POLICY_REQUIRED'));
  assert.ok(badPermissions.reasons.includes('WITHDRAWALS_MUST_BE_DISABLED'));
  assert.ok(badPermissions.reasons.includes('IP_RESTRICTION_REQUIRED'));
});

test('live grant binds exactly to the dry-run order fingerprint', () => {
  const registry = new LiveAuthorizationRegistry();
  const changed = order({ quantity:0.02 });
  const issued = registry.issue({
    executionReadiness:ready(order()),
    apiPolicy:apiPolicy(),
    userApproved:true,
    order:changed,
    now:2000
  });
  assert.equal(issued.ok, false);
  assert.equal(issued.grantIssued, false);
  assert.ok(issued.reasons.includes('LIVE_ORDER_DIFFERS_FROM_DRY_RUN'));
});

test('live grant is short-lived and single-use', () => {
  const registry = new LiveAuthorizationRegistry({ ttlMs:30000 });
  const o = order();
  const issued = registry.issue({
    executionReadiness:ready(o),
    apiPolicy:apiPolicy(),
    userApproved:true,
    order:o,
    now:10000
  });
  assert.equal(issued.ok, true);
  assert.equal(issued.grantIssued, true);
  assert.equal(issued.liveAllowed, false);
  assert.equal(issued.grant.expiresAt, 40000);

  const consumed = registry.consume({ grantId:issued.grant.grantId, order:o, now:20000 });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.consumed, true);
  assert.equal(consumed.liveAllowed, true);
  assert.equal(consumed.execution, 'LIVE_AUTHORIZED_ONCE');
  assert.equal(consumed.lineageId, o.lineageId);

  const replay = registry.consume({ grantId:issued.grant.grantId, order:o, now:21000 });
  assert.equal(replay.ok, false);
  assert.equal(replay.liveAllowed, false);
  assert.ok(replay.reasons.includes('LIVE_GRANT_UNKNOWN_OR_CONSUMED'));
});

test('expired grant is consumed fail-closed and cannot be replayed', () => {
  const registry = new LiveAuthorizationRegistry({ ttlMs:30000 });
  const o = order();
  const issued = registry.issue({
    executionReadiness:ready(o),
    apiPolicy:apiPolicy(),
    userApproved:true,
    order:o,
    now:50000
  });
  assert.equal(issued.ok, true);

  const expired = registry.consume({ grantId:issued.grant.grantId, order:o, now:80001 });
  assert.equal(expired.ok, false);
  assert.equal(expired.liveAllowed, false);
  assert.ok(expired.reasons.includes('LIVE_GRANT_EXPIRED'));

  const replay = registry.consume({ grantId:issued.grant.grantId, order:o, now:80002 });
  assert.equal(replay.ok, false);
  assert.ok(replay.reasons.includes('LIVE_GRANT_UNKNOWN_OR_CONSUMED'));
});

test('order mutation invalidates and burns the one-shot grant', () => {
  const registry = new LiveAuthorizationRegistry();
  const o = order();
  const issued = registry.issue({
    executionReadiness:ready(o),
    apiPolicy:apiPolicy(),
    userApproved:true,
    order:o,
    now:90000
  });
  assert.equal(issued.ok, true);

  const mismatch = registry.consume({
    grantId:issued.grant.grantId,
    order:order({ stopPrice:98.7 }),
    now:90001
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.liveAllowed, false);
  assert.ok(mismatch.reasons.includes('LIVE_GRANT_ORDER_MISMATCH'));

  const replayOriginal = registry.consume({ grantId:issued.grant.grantId, order:o, now:90002 });
  assert.equal(replayOriginal.ok, false);
  assert.ok(replayOriginal.reasons.includes('LIVE_GRANT_UNKNOWN_OR_CONSUMED'));
});
