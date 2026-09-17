'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 30000;
const MAX_TTL_MS = 60000;

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function canonicalOrder(order = {}) {
  const side = String(order.side || '').toUpperCase();
  const orderType = String(order.orderType || '').toUpperCase();
  return {
    action:String(order.action || '').toUpperCase(),
    symbol:String(order.symbol || '').toUpperCase(),
    side,
    orderType,
    quantity:finite(order.quantity),
    entryPrice:finite(order.entryPrice),
    stopPrice:finite(order.stopPrice),
    limitPrice:orderType === 'LIMIT' ? finite(order.limitPrice) : null,
    clientOrderId:text(order.clientOrderId),
    lineageId:text(order.lineageId)
  };
}

function orderFingerprint(order) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalOrder(order))).digest('hex');
}

function sourceReady(executionReadiness, apiPolicy, userApproved) {
  const reasons = [];
  if (userApproved !== true) reasons.push('LIVE_USER_APPROVAL_REQUIRED');
  if (executionReadiness?.ok !== true) reasons.push('EXECUTION_READINESS_REQUIRED');
  if (executionReadiness?.eligibleForDryRun !== true) reasons.push('DRY_RUN_READINESS_REQUIRED');
  if (executionReadiness?.dryRunExecutor?.ok !== true || executionReadiness?.dryRunExecutor?.simulated !== true) reasons.push('DRY_RUN_EXECUTOR_REQUIRED');
  if (executionReadiness?.dryRunExecutor?.submitted !== false) reasons.push('DRY_RUN_SUBMISSION_STATE_INVALID');
  if (executionReadiness?.dryRunExecutor?.transport?.requestSent !== false) reasons.push('DRY_RUN_TRANSPORT_STATE_INVALID');
  if (apiPolicy?.ok !== true || apiPolicy?.futureLiveSetupEligible !== true) reasons.push('API_PERMISSION_POLICY_REQUIRED');
  if (apiPolicy?.withdrawalsEnabled !== false) reasons.push('WITHDRAWALS_MUST_BE_DISABLED');
  if (apiPolicy?.ipRestricted !== true) reasons.push('IP_RESTRICTION_REQUIRED');
  return [...new Set(reasons)];
}

class LiveAuthorizationRegistry {
  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    const ttl = Number(ttlMs);
    this.ttlMs = Number.isFinite(ttl) ? Math.max(1000, Math.min(MAX_TTL_MS, Math.round(ttl))) : DEFAULT_TTL_MS;
    this.grants = new Map();
  }

  issue({ executionReadiness, apiPolicy, userApproved = false, order, now = Date.now() } = {}) {
    const reasons = sourceReady(executionReadiness, apiPolicy, userApproved);
    const normalized = canonicalOrder(order);
    const executorOrder = canonicalOrder(executionReadiness?.dryRunExecutor?.order || {});
    const required = ['action','symbol','side','orderType','clientOrderId','lineageId'];
    for (const k of required) if (!normalized[k]) reasons.push(`LIVE_ORDER_${k.toUpperCase()}_REQUIRED`);
    if (normalized.quantity === null || normalized.quantity <= 0) reasons.push('LIVE_ORDER_QUANTITY_INVALID');
    if (normalized.entryPrice === null || normalized.entryPrice <= 0) reasons.push('LIVE_ORDER_ENTRY_PRICE_INVALID');
    if (normalized.stopPrice === null || normalized.stopPrice <= 0) reasons.push('LIVE_ORDER_STOP_PRICE_INVALID');
    if (normalized.orderType === 'LIMIT' && (normalized.limitPrice === null || normalized.limitPrice <= 0)) reasons.push('LIVE_ORDER_LIMIT_PRICE_INVALID');
    if (orderFingerprint(normalized) !== orderFingerprint(executorOrder)) reasons.push('LIVE_ORDER_DIFFERS_FROM_DRY_RUN');

    const uniqueReasons = [...new Set(reasons)];
    if (uniqueReasons.length) {
      return {
        ok:false,
        grantIssued:false,
        liveAllowed:false,
        execution:'LIVE_BLOCKED',
        reasons:uniqueReasons
      };
    }

    const issuedAt = Number(now);
    const grantId = crypto.randomUUID();
    const grant = {
      grantId,
      issuedAt,
      expiresAt:issuedAt + this.ttlMs,
      fingerprint:orderFingerprint(normalized),
      lineageId:normalized.lineageId,
      clientOrderId:normalized.clientOrderId,
      symbol:normalized.symbol,
      side:normalized.side
    };
    this.grants.set(grantId, grant);
    return {
      ok:true,
      grantIssued:true,
      liveAllowed:false,
      execution:'LIVE_GRANT_ISSUED_NOT_CONSUMED',
      grant:{ ...grant },
      reasons:[]
    };
  }

  consume({ grantId, order, now = Date.now() } = {}) {
    const id = text(grantId);
    if (!id || !this.grants.has(id)) {
      return { ok:false, consumed:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_GRANT_UNKNOWN_OR_CONSUMED'] };
    }

    const grant = this.grants.get(id);
    this.grants.delete(id);
    const ts = Number(now);
    if (!Number.isFinite(ts) || ts < grant.issuedAt || ts > grant.expiresAt) {
      return { ok:false, consumed:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_GRANT_EXPIRED'] };
    }

    if (orderFingerprint(order) !== grant.fingerprint) {
      return { ok:false, consumed:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_GRANT_ORDER_MISMATCH'] };
    }

    return {
      ok:true,
      consumed:true,
      liveAllowed:true,
      execution:'LIVE_AUTHORIZED_ONCE',
      grantId:id,
      lineageId:grant.lineageId,
      clientOrderId:grant.clientOrderId,
      symbol:grant.symbol,
      side:grant.side,
      reasons:[]
    };
  }

  revokeAll() {
    const count = this.grants.size;
    this.grants.clear();
    return count;
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  canonicalOrder,
  orderFingerprint,
  LiveAuthorizationRegistry
};
