'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { LiveAuthorizationRegistry } = require('./live-authorization');
const { BinanceLiveTransport } = require('./binance-live-transport');
const { assessApiPermissionDeclaration, containsSecretLikeKey } = require('./binance-account-context');

const LIVE_RESOURCE = 'BINANCE_LIVE_EXECUTOR';
const LIVE_OWNER = 'BRAINHUB_PC';
const ID_RE = /^[A-Za-z0-9:_-]{8,128}$/;
const DAILY_INCOME_TYPES = new Set(['REALIZED_PNL','COMMISSION','FUNDING_FEE','INSURANCE_CLEAR','COMMISSION_REBATE']);

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function credentialsReady(credentials) {
  const key = typeof credentials?.apiKey === 'string' ? credentials.apiKey.trim() : '';
  const secret = typeof credentials?.apiSecret === 'string' ? credentials.apiSecret.trim() : '';
  return key.length >= 8 && secret.length >= 8;
}

function normalizePolicy(raw) {
  const reasons = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reasons.push('LIVE_POLICY_REQUIRED');
  if (containsSecretLikeKey(raw)) reasons.push('LIVE_POLICY_MUST_NOT_CONTAIN_SECRETS');

  const armMinutes = finite(raw?.armMinutes);
  const expectedLeverage = finite(raw?.expectedLeverage);
  const maxEntryDeviationPct = finite(raw?.maxEntryDeviationPct);
  const limits = {
    maxRiskPctPerTrade:finite(raw?.limits?.maxRiskPctPerTrade),
    maxNotionalPctPerTrade:finite(raw?.limits?.maxNotionalPctPerTrade),
    maxDailyLossPct:finite(raw?.limits?.maxDailyLossPct),
    maxOpenPositions:finite(raw?.limits?.maxOpenPositions),
    maxFamilyExposurePct:finite(raw?.limits?.maxFamilyExposurePct)
  };

  if (armMinutes === null || !Number.isInteger(armMinutes) || armMinutes < 5 || armMinutes > 1440) reasons.push('LIVE_ARM_MINUTES_INVALID');
  if (expectedLeverage === null || !Number.isInteger(expectedLeverage) || expectedLeverage < 1 || expectedLeverage > 125) reasons.push('EXPECTED_LEVERAGE_INVALID');
  if (maxEntryDeviationPct === null || maxEntryDeviationPct <= 0 || maxEntryDeviationPct > 5) reasons.push('MAX_ENTRY_DEVIATION_INVALID');
  if (limits.maxRiskPctPerTrade === null || limits.maxRiskPctPerTrade <= 0) reasons.push('MAX_RISK_LIMIT_MISSING');
  if (limits.maxNotionalPctPerTrade === null || limits.maxNotionalPctPerTrade <= 0) reasons.push('MAX_NOTIONAL_LIMIT_MISSING');
  if (limits.maxDailyLossPct === null || limits.maxDailyLossPct <= 0) reasons.push('MAX_DAILY_LOSS_LIMIT_MISSING');
  if (limits.maxOpenPositions === null || !Number.isInteger(limits.maxOpenPositions) || limits.maxOpenPositions < 1) reasons.push('MAX_OPEN_POSITIONS_LIMIT_MISSING');
  if (limits.maxFamilyExposurePct === null || limits.maxFamilyExposurePct <= 0) reasons.push('MAX_FAMILY_EXPOSURE_LIMIT_MISSING');

  const apiPolicy = assessApiPermissionDeclaration(raw?.apiPermissions || {});
  if (!apiPolicy.ok) reasons.push(...apiPolicy.reasons);

  return {
    ok:reasons.length === 0,
    armMinutes,
    expectedLeverage,
    maxEntryDeviationPct,
    limits,
    apiPolicy,
    reasons:[...new Set(reasons)]
  };
}

function readPolicy(root) {
  const file = path.join(root, 'config', 'live-policy.json');
  if (!fs.existsSync(file)) return { ok:false, reasons:['LIVE_POLICY_FILE_MISSING'], file };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return { ...normalizePolicy(raw), file };
  } catch (e) {
    return { ok:false, reasons:['LIVE_POLICY_JSON_INVALID'], detail:String(e.message || e).slice(0,160), file };
  }
}

function publicPolicy(policy) {
  if (!policy) return null;
  return {
    ok:policy.ok === true,
    armMinutes:policy.armMinutes ?? null,
    expectedLeverage:policy.expectedLeverage ?? null,
    maxEntryDeviationPct:policy.maxEntryDeviationPct ?? null,
    limits:policy.limits || null,
    apiPolicy:policy.apiPolicy || null,
    reasons:Array.isArray(policy.reasons) ? policy.reasons : []
  };
}

function utcDayStart(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function createLiveController({ root, store, scanner, pipeline, committee, credentials, fetchImpl = globalThis.fetch, clock = () => Date.now() } = {}) {
  if (!root || !store || !scanner || !pipeline || typeof committee !== 'function') throw new Error('live controller dependencies required');
  const registry = new LiveAuthorizationRegistry();
  const transport = new BinanceLiveTransport({ registry, fetchImpl, clock });
  const leaseToken = crypto.randomBytes(32).toString('base64url');
  let armState = { armed:false, armedAt:null, expiresAt:null };

  function armedNow() {
    if (!armState.armed) return false;
    const now = clock();
    if (!Number.isFinite(now) || now >= armState.expiresAt) {
      registry.revokeAll();
      armState = { armed:false, armedAt:null, expiresAt:null };
      return false;
    }
    return true;
  }

  function status() {
    const policy = readPolicy(root);
    const armed = armedNow();
    return {
      ok:true,
      liveConfigured:credentialsReady(credentials) && policy.ok === true,
      credentialsConfigured:credentialsReady(credentials),
      policy:publicPolicy(policy),
      armed,
      armedAt:armed ? armState.armedAt : null,
      expiresAt:armed ? armState.expiresAt : null,
      liveAllowed:false,
      execution:armed ? 'LIVE_ARMED_PER_ORDER_GRANT_REQUIRED' : 'LIVE_DISARMED'
    };
  }

  async function arm({ confirmed = false } = {}) {
    const policy = readPolicy(root);
    const reasons = [];
    if (confirmed !== true) reasons.push('LIVE_USER_APPROVAL_REQUIRED');
    if (!credentialsReady(credentials)) reasons.push('BINANCE_CREDENTIALS_REQUIRED');
    if (!policy.ok) reasons.push(...(policy.reasons || ['LIVE_POLICY_REQUIRED']));
    if (reasons.length) return { ok:false, armed:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:[...new Set(reasons)] };

    try {
      await transport._syncServerTime();
      const account = await transport._fetchJson('GET', '/fapi/v2/account', { credentials, signed:true });
      if (!account || typeof account !== 'object') throw new Error('BINANCE_ACCOUNT_PREFLIGHT_INVALID');
    } catch (e) {
      return {
        ok:false,
        armed:false,
        liveAllowed:false,
        execution:'LIVE_BLOCKED',
        reasons:[String(e.message || 'BINANCE_ACCOUNT_PREFLIGHT_FAILED')]
      };
    }

    const now = clock();
    armState = { armed:true, armedAt:now, expiresAt:now + policy.armMinutes * 60000 };
    registry.revokeAll();
    return { ok:true, armed:true, liveAllowed:false, execution:'LIVE_ARMED_PER_ORDER_GRANT_REQUIRED', armedAt:now, expiresAt:armState.expiresAt, policy:publicPolicy(policy), reasons:[] };
  }

  function disarm(reason = 'USER_DISARM') {
    const revoked = registry.revokeAll();
    armState = { armed:false, armedAt:null, expiresAt:null };
    return { ok:true, armed:false, liveAllowed:false, execution:'LIVE_DISARMED', revokedGrants:revoked, reason };
  }

  async function accountRiskFor(order, policy) {
    await transport._syncServerTime();
    const account = await transport._fetchJson('GET', '/fapi/v2/account', { credentials, signed:true });
    const income = await transport._fetchJson('GET', '/fapi/v1/income', {
      params:{ startTime:utcDayStart(clock()), limit:1000 },
      credentials,
      signed:true
    });
    if (!Array.isArray(income)) throw new Error('BINANCE_DAILY_INCOME_UNAVAILABLE');
    if (income.length >= 1000) throw new Error('BINANCE_DAILY_INCOME_WINDOW_INCOMPLETE');

    const equity = finite(account?.totalMarginBalance);
    const availableBalance = finite(account?.availableBalance);
    const positions = Array.isArray(account?.positions) ? account.positions : [];
    const active = positions.filter(x => Math.abs(finite(x?.positionAmt) || 0) > 0);
    const currentExposure = active.reduce((sum, x) => {
      const direct = finite(x?.notional);
      if (direct !== null) return sum + Math.abs(direct);
      const amt = finite(x?.positionAmt), mark = finite(x?.markPrice);
      return sum + (amt !== null && mark !== null ? Math.abs(amt * mark) : 0);
    }, 0);
    const dailyRealizedPnl = income.reduce((sum, x) => {
      if (!DAILY_INCOME_TYPES.has(String(x?.incomeType || '').toUpperCase())) return sum;
      const value = finite(x?.income);
      return sum + (value === null ? 0 : value);
    }, 0);
    const quantity = finite(order?.quantity), entryPrice = finite(order?.entryPrice), stopPrice = finite(order?.stopPrice);
    const notionalQuote = quantity !== null && entryPrice !== null ? quantity * entryPrice : null;
    const riskQuote = quantity !== null && entryPrice !== null && stopPrice !== null ? quantity * Math.abs(entryPrice - stopPrice) : null;

    return {
      account:{
        available:equity !== null && equity > 0 && availableBalance !== null && availableBalance >= 0,
        equity,
        availableBalance,
        dailyRealizedPnl,
        openPositions:active.length
      },
      intent:{
        riskQuote,
        notionalQuote,
        family:'ALL_USDT_PERP',
        familyExposureAfterQuote:notionalQuote === null ? null : currentExposure + notionalQuote
      },
      limits:policy.limits
    };
  }

  async function execute(body = {}) {
    const policy = readPolicy(root);
    if (!armedNow()) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_NOT_ARMED'] };
    if (!policy.ok) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:policy.reasons || ['LIVE_POLICY_REQUIRED'] };
    if (!credentialsReady(credentials)) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['BINANCE_CREDENTIALS_REQUIRED'] };

    const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
    const order = body?.order || {};
    const lineageId = typeof order?.lineageId === 'string' ? order.lineageId.trim() : '';
    if (!ID_RE.test(eventId) || !ID_RE.test(lineageId)) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['EVENT_OR_LINEAGE_INVALID'] };

    let accountRisk;
    try { accountRisk = await accountRiskFor(order, policy); }
    catch (e) { return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_PREFLIGHT_BLOCKED', reasons:[String(e.message || e)] }; }

    let lease;
    try { lease = store.lease('acquire', LIVE_RESOURCE, LIVE_OWNER, leaseToken, 60000); }
    catch (e) { return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:[String(e.message || e)] }; }
    if (!lease?.acquired) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_EXECUTOR_LEASE_UNAVAILABLE'] };

    let claim;
    try { claim = store.claim(eventId, LIVE_OWNER, LIVE_RESOURCE, leaseToken, lineageId); }
    catch (e) { return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:[String(e.message || e)] }; }
    if (!claim?.claimed) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', claim, reasons:[claim?.reason || 'EXECUTION_CLAIM_REJECTED'] };

    const stopRisk = {
      entryPrice:order?.entryPrice,
      stopPrice:order?.stopPrice,
      structuralInvalidationPrice:body?.structuralInvalidationPrice,
      bufferQuote:body?.bufferQuote,
      initialStopPrice:body?.initialStopPrice
    };
    const killSwitch = { control:{ available:true, tripped:!armedNow(), dryRunEnabled:true } };

    let scan;
    try { scan = await scanner.scan(); }
    catch (e) { return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', claim, reasons:['SCANNER_UNAVAILABLE'] }; }

    let planResult;
    try {
      planResult = await pipeline.run({
        scan,
        store,
        committee,
        accountRisk,
        stopRisk,
        killSwitch,
        executionClaim:claim,
        executionIntent:order
      });
    } catch (e) {
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', claim, reasons:[String(e.message || 'PIPELINE_FAILED').slice(0,160)] };
    }

    if (!armedNow()) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', claim, plan:planResult?.plan || null, reasons:['LIVE_DISARMED_DURING_PREFLIGHT'] };

    const grant = registry.issue({
      executionReadiness:planResult?.executionReadiness,
      apiPolicy:policy.apiPolicy,
      userApproved:true,
      order
    });
    if (!grant.ok) {
      return {
        ok:false,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LIVE_BLOCKED',
        claim,
        plan:planResult?.plan || null,
        riskGate:planResult?.riskGate || null,
        executionReadiness:planResult?.executionReadiness || null,
        reasons:grant.reasons || ['LIVE_GRANT_REJECTED']
      };
    }

    const result = await transport.submit({
      grantId:grant.grant.grantId,
      order,
      credentials,
      livePolicy:{ expectedLeverage:policy.expectedLeverage, maxEntryDeviationPct:policy.maxEntryDeviationPct }
    });

    try {
      store.journal('LIVE_EXECUTION', String(order?.symbol || '').toUpperCase(), {
        eventId,
        lineageId,
        plan:planResult?.plan || null,
        riskGate:planResult?.riskGate || null,
        result
      });
    } catch {}

    return {
      ...result,
      claim,
      plan:planResult?.plan || null,
      riskGate:planResult?.riskGate || null,
      executionReadiness:planResult?.executionReadiness || null
    };
  }

  return { status, arm, disarm, execute, readPolicy:() => publicPolicy(readPolicy(root)) };
}

module.exports = { LIVE_RESOURCE, LIVE_OWNER, normalizePolicy, createLiveController };
