'use strict';

const SYMBOL_RE = /^[A-Z0-9]{5,28}$/;
const ID_RE = /^[A-Za-z0-9:_-]{8,128}$/;
const ORDER_TYPES = new Set(['MARKET','LIMIT']);

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildDryRunOrder({ intent, riskGate } = {}) {
  const reasons = [];
  const mode = String(intent?.mode || '').toUpperCase();
  const action = String(intent?.action || '').toUpperCase();
  const symbol = String(intent?.symbol || '').toUpperCase();
  const side = String(intent?.side || '').toUpperCase();
  const orderType = String(intent?.orderType || '').toUpperCase();
  const quantity = finite(intent?.quantity);
  const entryPrice = finite(intent?.entryPrice);
  const stopPrice = finite(intent?.stopPrice);
  const limitPrice = finite(intent?.limitPrice);
  const clientOrderId = typeof intent?.clientOrderId === 'string' ? intent.clientOrderId.trim() : '';
  const lineageId = typeof intent?.lineageId === 'string' ? intent.lineageId.trim() : '';

  if (mode !== 'DRY_RUN') reasons.push('DRY_RUN_MODE_REQUIRED');
  if (intent?.live === true) reasons.push('LIVE_EXECUTION_DISABLED');
  if (action !== 'OPEN') reasons.push('OPEN_ACTION_REQUIRED');
  if (!SYMBOL_RE.test(symbol)) reasons.push('SYMBOL_INVALID');
  if (!['LONG','SHORT'].includes(side)) reasons.push('SIDE_INVALID');
  if (!ORDER_TYPES.has(orderType)) reasons.push('ORDER_TYPE_INVALID');
  if (quantity === null || quantity <= 0) reasons.push('QUANTITY_INVALID');
  if (entryPrice === null || entryPrice <= 0) reasons.push('ENTRY_PRICE_INVALID');
  if (stopPrice === null || stopPrice <= 0) reasons.push('STOP_PRICE_INVALID');
  if (orderType === 'LIMIT' && (limitPrice === null || limitPrice <= 0)) reasons.push('LIMIT_PRICE_INVALID');
  if (!ID_RE.test(clientOrderId)) reasons.push('CLIENT_ORDER_ID_INVALID');
  if (!ID_RE.test(lineageId)) reasons.push('LINEAGE_ID_INVALID');

  if (side === 'LONG' && entryPrice !== null && stopPrice !== null && stopPrice >= entryPrice) {
    reasons.push('LONG_STOP_NOT_BELOW_ENTRY');
  }
  if (side === 'SHORT' && entryPrice !== null && stopPrice !== null && stopPrice <= entryPrice) {
    reasons.push('SHORT_STOP_NOT_ABOVE_ENTRY');
  }

  if (riskGate?.ok !== true) reasons.push('RISK_GATE_NOT_PASSED');
  if (riskGate?.eligibleForDryRun !== true) reasons.push('DRY_RUN_NOT_ELIGIBLE');
  if (riskGate?.liveAllowed !== false) reasons.push('LIVE_FLAG_INVALID');

  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length) {
    return {
      ok:false,
      simulated:false,
      submitted:false,
      exchange:'BINANCE_FUTURES',
      mode:'DRY_RUN',
      liveAllowed:false,
      execution:'ADVISORY_ONLY',
      reasons:uniqueReasons
    };
  }

  return {
    ok:true,
    simulated:true,
    submitted:false,
    exchange:'BINANCE_FUTURES',
    mode:'DRY_RUN',
    liveAllowed:false,
    execution:'ADVISORY_ONLY',
    order:{
      action:'OPEN',
      symbol,
      side,
      exchangeSide:side === 'LONG' ? 'BUY' : 'SELL',
      positionSide:side,
      orderType,
      quantity,
      entryPrice,
      stopPrice,
      limitPrice:orderType === 'LIMIT' ? limitPrice : null,
      clientOrderId,
      lineageId
    },
    transport:{ attempted:false, requestSent:false },
    reasons:[]
  };
}

module.exports = { buildDryRunOrder };
