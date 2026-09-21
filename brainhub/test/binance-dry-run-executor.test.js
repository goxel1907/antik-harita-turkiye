'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDryRunOrder } = require('../binance-dry-run-executor');

function passingRiskGate() {
  return { ok:true, eligibleForDryRun:true, liveAllowed:false };
}

function baseIntent() {
  return {
    mode:'DRY_RUN',
    live:false,
    action:'OPEN',
    symbol:'BTCUSDT',
    side:'LONG',
    orderType:'MARKET',
    quantity:0.01,
    entryPrice:100,
    stopPrice:98,
    clientOrderId:'evt_12345678',
    lineageId:'lineage_12345678'
  };
}

test('valid MARKET intent is simulated without any exchange request', () => {
  const out = buildDryRunOrder({ intent:baseIntent(), riskGate:passingRiskGate() });
  assert.equal(out.ok, true);
  assert.equal(out.simulated, true);
  assert.equal(out.submitted, false);
  assert.equal(out.liveAllowed, false);
  assert.equal(out.execution, 'ADVISORY_ONLY');
  assert.equal(out.order.exchangeSide, 'BUY');
  assert.equal(out.order.positionSide, 'LONG');
  assert.equal(out.order.orderType, 'MARKET');
  assert.equal(out.order.limitPrice, null);
  assert.deepEqual(out.transport, { attempted:false, requestSent:false });
  assert.deepEqual(out.reasons, []);
});

test('valid LIMIT SHORT intent preserves limit price but remains dry-run only', () => {
  const intent = {
    ...baseIntent(),
    side:'SHORT',
    orderType:'LIMIT',
    entryPrice:100,
    stopPrice:102,
    limitPrice:99.5,
    clientOrderId:'evt_87654321',
    lineageId:'lineage_87654321'
  };
  const out = buildDryRunOrder({ intent, riskGate:passingRiskGate() });
  assert.equal(out.ok, true);
  assert.equal(out.simulated, true);
  assert.equal(out.submitted, false);
  assert.equal(out.order.exchangeSide, 'SELL');
  assert.equal(out.order.positionSide, 'SHORT');
  assert.equal(out.order.limitPrice, 99.5);
  assert.equal(out.transport.attempted, false);
  assert.equal(out.transport.requestSent, false);
});

test('LIVE request and non-dry-run mode are rejected before submission', () => {
  const intent = { ...baseIntent(), mode:'LIVE', live:true };
  const out = buildDryRunOrder({ intent, riskGate:passingRiskGate() });
  assert.equal(out.ok, false);
  assert.equal(out.simulated, false);
  assert.equal(out.submitted, false);
  assert.equal(out.liveAllowed, false);
  assert.ok(out.reasons.includes('DRY_RUN_MODE_REQUIRED'));
  assert.ok(out.reasons.includes('LIVE_EXECUTION_DISABLED'));
});

test('executor fails closed unless deterministic risk gate passed for dry-run only', () => {
  const blocked = buildDryRunOrder({
    intent:baseIntent(),
    riskGate:{ ok:false, eligibleForDryRun:false, liveAllowed:false }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.submitted, false);
  assert.ok(blocked.reasons.includes('RISK_GATE_NOT_PASSED'));
  assert.ok(blocked.reasons.includes('DRY_RUN_NOT_ELIGIBLE'));

  const unsafeLiveFlag = buildDryRunOrder({
    intent:baseIntent(),
    riskGate:{ ok:true, eligibleForDryRun:true, liveAllowed:true }
  });
  assert.equal(unsafeLiveFlag.ok, false);
  assert.ok(unsafeLiveFlag.reasons.includes('LIVE_FLAG_INVALID'));
});

test('invalid quantity, ids, limit price and structural stop direction fail closed', () => {
  const intent = {
    ...baseIntent(),
    orderType:'LIMIT',
    quantity:' ',
    stopPrice:101,
    limitPrice:'',
    clientOrderId:'bad',
    lineageId:''
  };
  const out = buildDryRunOrder({ intent, riskGate:passingRiskGate() });
  assert.equal(out.ok, false);
  assert.equal(out.simulated, false);
  assert.equal(out.submitted, false);
  assert.ok(out.reasons.includes('QUANTITY_INVALID'));
  assert.ok(out.reasons.includes('LIMIT_PRICE_INVALID'));
  assert.ok(out.reasons.includes('CLIENT_ORDER_ID_INVALID'));
  assert.ok(out.reasons.includes('LINEAGE_ID_INVALID'));
  assert.ok(out.reasons.includes('LONG_STOP_NOT_BELOW_ENTRY'));
});
