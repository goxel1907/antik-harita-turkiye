'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { LiveAuthorizationRegistry } = require('./live-authorization');
const { BinanceLiveTransport } = require('./binance-live-transport');
const { assessApiPermissionDeclaration, containsSecretLikeKey } = require('./binance-account-context');

const LIVE_RESOURCE = 'BINANCE_LIVE_EXECUTOR';
const LIVE_OWNER = 'BRAINHUB_PC';
const ID_RE = /^[A-Za-z0-9:_-]{8,128}$/;

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function readDpapi(file) {
  if (process.platform !== 'win32' || !fs.existsSync(file)) return null;
  const script = [
    '$p=$args[0]',
    '$s=(Get-Content -LiteralPath $p -Raw).Trim() | ConvertTo-SecureString',
    '$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)',
    'try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}',
    'finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}'
  ].join(';');
  const out = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, file
  ], { encoding:'utf8', windowsHide:true, timeout:5000, maxBuffer:16384 });
  if (out.error || out.status !== 0) return null;
  return text(out.stdout);
}

function resolveCredentials(root, supplied = {}) {
  const apiKey = text(supplied?.apiKey) || readDpapi(path.join(root, 'config', 'binance-api-key.dpapi'));
  const apiSecret = text(supplied?.apiSecret) || readDpapi(path.join(root, 'config', 'binance-api-secret.dpapi'));
  return {
    apiKey:apiKey && apiKey.length >= 8 ? apiKey : null,
    apiSecret:apiSecret && apiSecret.length >= 8 ? apiSecret : null
  };
}

function credentialsReady(credentials) {
  return Boolean(text(credentials?.apiKey)?.length >= 8 && text(credentials?.apiSecret)?.length >= 8);
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

  const declared = raw?.apiPermissions || {};
  const apiPolicy = assessApiPermissionDeclaration({
    configured:declared.configured === true,
    futuresTradingEnabled:declared.futuresTradingEnabled === true || declared.futuresEnabled === true,
    withdrawalsEnabled:declared.withdrawalsEnabled,
    ipRestricted:declared.ipRestricted === true
  });
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

function requestedExecutionSettings(body, policy) {
  const supplied = body?.requestedMarginQuote !== undefined ||
    body?.requestedLeverage !== undefined ||
    body?.requestedMaxOpenPositions !== undefined;
  if (!supplied) {
    return {
      ok:true,
      dynamic:false,
      marginQuote:null,
      leverage:policy?.expectedLeverage ?? null,
      maxOpenPositions:policy?.limits?.maxOpenPositions ?? null,
      reasons:[]
    };
  }

  const reasons = [];
  const marginQuote = finite(body?.requestedMarginQuote);
  const leverage = finite(body?.requestedLeverage);
  const maxOpenPositions = finite(body?.requestedMaxOpenPositions);
  if (marginQuote === null || marginQuote <= 0) reasons.push('REQUESTED_MARGIN_INVALID');
  if (leverage === null || !Number.isInteger(leverage) || leverage < 1 || leverage > 125) reasons.push('REQUESTED_LEVERAGE_INVALID');
  if (maxOpenPositions === null || !Number.isInteger(maxOpenPositions) || maxOpenPositions < 1 || maxOpenPositions > 5) reasons.push('REQUESTED_MAX_OPEN_POSITIONS_INVALID');

  const pcMax = finite(policy?.limits?.maxOpenPositions);
  if (maxOpenPositions !== null && pcMax !== null && maxOpenPositions > pcMax) reasons.push('REQUESTED_MAX_OPEN_POSITIONS_EXCEEDS_PC_CAP');

  return {
    ok:reasons.length === 0,
    dynamic:true,
    marginQuote,
    leverage,
    maxOpenPositions,
    reasons:[...new Set(reasons)]
  };
}

function applyDynamicSizingGuards(accountRisk, settings, policy) {
  if (!settings?.dynamic) return { ok:true, accountRisk, reasons:[] };
  const reasons = [];
  const equity = finite(accountRisk?.account?.equity);
  const availableBalance = finite(accountRisk?.account?.availableBalance);
  const notionalQuote = finite(accountRisk?.intent?.notionalQuote);
  const familyExposureAfterQuote = finite(accountRisk?.intent?.familyExposureAfterQuote);
  const expectedNotional = settings.marginQuote * settings.leverage;

  if (availableBalance === null || availableBalance < settings.marginQuote) reasons.push('REQUESTED_MARGIN_EXCEEDS_AVAILABLE_BALANCE');
  if (notionalQuote === null || notionalQuote <= 0) reasons.push('TRADE_NOTIONAL_INVALID');
  if (Number.isFinite(expectedNotional) && expectedNotional > 0 && notionalQuote !== null && notionalQuote > expectedNotional * 1.02) {
    reasons.push('ORDER_NOTIONAL_EXCEEDS_REQUESTED_MARGIN_LEVERAGE');
  }
  if (equity === null || equity <= 0) reasons.push('ACCOUNT_EQUITY_INVALID');
  if (reasons.length) return { ok:false, accountRisk, reasons:[...new Set(reasons)] };

  // App-selected margin/leverage define position size. PC keeps independent stop-risk,
  // daily-loss and max-position guards; legacy notional/exposure percentages no longer
  // shrink an explicitly selected margin after those hard controls have passed.
  const notionalPct = notionalQuote / equity * 100;
  const familyPct = familyExposureAfterQuote / equity * 100;
  const effectiveLimits = {
    ...policy.limits,
    maxOpenPositions:settings.maxOpenPositions,
    maxNotionalPctPerTrade:Math.max(policy.limits.maxNotionalPctPerTrade, notionalPct + 1e-9),
    maxFamilyExposurePct:Math.max(policy.limits.maxFamilyExposurePct, familyPct + 1e-9)
  };
  return {
    ok:true,
    reasons:[],
    accountRisk:{ ...accountRisk, limits:effectiveLimits },
    sizing:{
      requestedMarginQuote:settings.marginQuote,
      requestedLeverage:settings.leverage,
      requestedMaxOpenPositions:settings.maxOpenPositions,
      expectedNotionalQuote:expectedNotional,
      effectiveLimits
    }
  };
}

function createLiveController({ root, store, scanner, pipeline, committee, credentials = {}, fetchImpl = globalThis.fetch, clock = () => Date.now() } = {}) {
  if (!root || !store || !scanner || !pipeline || typeof committee !== 'function') throw new Error('live controller dependencies required');
  const registry = new LiveAuthorizationRegistry();
  const transport = new BinanceLiveTransport({ registry, fetchImpl, clock });
  const leaseToken = crypto.randomBytes(32).toString('base64url');
  let armState = { armed:false, armedAt:null, expiresAt:null };
  let lastDisarmReason = 'STARTUP_FAIL_CLOSED';
  let accountSummaryCache = { at:0, value:null };

  function currentCredentials() {
    return resolveCredentials(root, credentials);
  }

  function armedNow() {
    if (!armState.armed) return false;
    const now = clock();
    if (!Number.isFinite(now) || now >= armState.expiresAt) {
      registry.revokeAll();
      armState = { armed:false, armedAt:null, expiresAt:null };
      lastDisarmReason = 'ARM_EXPIRED';
      return false;
    }
    return true;
  }

  function status() {
    const policy = readPolicy(root);
    const creds = currentCredentials();
    const armed = armedNow();
    return {
      ok:true,
      liveConfigured:credentialsReady(creds) && policy.ok === true,
      credentialsConfigured:credentialsReady(creds),
      policy:publicPolicy(policy),
      armed,
      armedAt:armed ? armState.armedAt : null,
      expiresAt:armed ? new Date(armState.expiresAt).toISOString() : null,
      liveAllowed:false,
      execution:armed ? 'LIVE_ARMED_PER_ORDER_GRANT_REQUIRED' : 'LIVE_DISARMED',
      lastDisarmReason
    };
  }

  async function accountSummary({ maxAgeMs = 5000 } = {}) {
    const now = clock();
    if (accountSummaryCache.value && Number.isFinite(now) && now - accountSummaryCache.at >= 0 && now - accountSummaryCache.at <= maxAgeMs) {
      return { ...accountSummaryCache.value, cached:true };
    }
    const policy = readPolicy(root);
    const creds = currentCredentials();
    if (!policy.ok) return { ok:false, configured:false, reasons:policy.reasons || ['LIVE_POLICY_REQUIRED'] };
    if (!credentialsReady(creds)) return { ok:false, configured:false, reasons:['BINANCE_CREDENTIALS_REQUIRED'] };
    try {
      await transport._syncServerTime();
      const account = await transport._fetchJson('GET', '/fapi/v3/account', { credentials:creds, signed:true });
      if (!account || typeof account !== 'object') throw new Error('BINANCE_ACCOUNT_SUMMARY_INVALID');
      const walletBalance = finite(account?.totalWalletBalance);
      const equity = finite(account?.totalMarginBalance);
      const availableBalance = finite(account?.availableBalance);
      const unrealizedPnl = finite(account?.totalUnrealizedProfit);
      const positions = Array.isArray(account?.positions) ? account.positions : [];
      const openPositions = positions.filter(x => Math.abs(finite(x?.positionAmt) || 0) > 0).length;
      if (walletBalance === null || equity === null || availableBalance === null) {
        throw new Error('BINANCE_ACCOUNT_BALANCE_FIELDS_MISSING');
      }
      const value = {
        ok:true,
        configured:true,
        walletBalance,
        equity,
        availableBalance,
        unrealizedPnl:unrealizedPnl ?? 0,
        openPositions,
        asOf:new Date(now).toISOString()
      };
      accountSummaryCache = { at:now, value };
      return { ...value, cached:false };
    } catch (e) {
      return {
        ok:false,
        configured:true,
        exchangeError:e?.body || null,
        reasons:[String(e?.message || 'BINANCE_ACCOUNT_SUMMARY_FAILED').slice(0,160)]
      };
    }
  }

  async function arm({ confirmed = false } = {}) {
    registry.revokeAll();
    armState = { armed:false, armedAt:null, expiresAt:null };
    const policy = readPolicy(root);
    const creds = currentCredentials();
    const reasons = [];
    if (confirmed !== true) reasons.push('LIVE_USER_APPROVAL_REQUIRED');
    if (!credentialsReady(creds)) reasons.push('BINANCE_CREDENTIALS_REQUIRED');
    if (!policy.ok) reasons.push(...(policy.reasons || ['LIVE_POLICY_REQUIRED']));
    if (reasons.length) return { ok:false, armed:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:[...new Set(reasons)] };

    try {
      await transport._syncServerTime();
      const account = await transport._fetchJson('GET', '/fapi/v3/account', { credentials:creds, signed:true });
      if (!account || typeof account !== 'object') throw new Error('BINANCE_ACCOUNT_PREFLIGHT_INVALID');
      await transport._fetchJson('GET', '/fapi/v1/positionSide/dual', { credentials:creds, signed:true });
    } catch (e) {
      return {
        ok:false,
        armed:false,
        liveAllowed:false,
        execution:'LIVE_BLOCKED',
        exchangeError:e?.body || null,
        reasons:['BINANCE_FUTURES_CREDENTIAL_PROBE_FAILED']
      };
    }

    const now = clock();
    armState = { armed:true, armedAt:now, expiresAt:now + policy.armMinutes * 60000 };
    lastDisarmReason = null;
    return {
      ok:true,
      armed:true,
      liveAllowed:false,
      execution:'LIVE_ARMED_PER_ORDER_GRANT_REQUIRED',
      armedAt:new Date(now).toISOString(),
      expiresAt:new Date(armState.expiresAt).toISOString(),
      policy:publicPolicy(policy),
      reasons:[]
    };
  }

  function disarm(reason = 'USER_DISARM') {
    const revoked = registry.revokeAll();
    armState = { armed:false, armedAt:null, expiresAt:null };
    lastDisarmReason = text(reason) || 'USER_DISARM';
    return { ok:true, armed:false, liveAllowed:false, execution:'LIVE_DISARMED', revokedGrants:revoked, reason:lastDisarmReason };
  }

  async function accountRiskFor(order, policy, creds) {
    await transport._syncServerTime();
    const account = await transport._fetchJson('GET', '/fapi/v3/account', { credentials:creds, signed:true });
    const income = await transport._fetchJson('GET', '/fapi/v1/income', {
      params:{ incomeType:'REALIZED_PNL', startTime:utcDayStart(clock()), limit:1000 },
      credentials:creds,
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
    const dailyRealizedPnl = income.reduce((sum, x) => sum + (finite(x?.income) || 0), 0);
    const quantity = finite(order?.quantity), entryPrice = finite(order?.entryPrice), stopPrice = finite(order?.stopPrice);
    const notionalQuote = quantity !== null && entryPrice !== null ? Math.abs(quantity * entryPrice) : null;
    const riskQuote = quantity !== null && entryPrice !== null && stopPrice !== null ? Math.abs(quantity * (entryPrice - stopPrice)) : null;

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
    const creds = currentCredentials();
    if (!armedNow()) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_NOT_ARMED'] };
    if (!policy.ok) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:policy.reasons || ['LIVE_POLICY_REQUIRED'] };
    if (!credentialsReady(creds)) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['BINANCE_CREDENTIALS_REQUIRED'] };

    const eventId = text(body?.eventId) || '';
    const order = body?.order || {};
    const lineageId = text(order?.lineageId) || '';
    if (!ID_RE.test(eventId) || !ID_RE.test(lineageId)) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['EVENT_OR_LINEAGE_INVALID'] };

    const settings = requestedExecutionSettings(body, policy);
    if (!settings.ok) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:settings.reasons };

    let accountRisk;
    try { accountRisk = await accountRiskFor(order, policy, creds); }
    catch (e) {
      return {
        ok:false,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LIVE_PREFLIGHT_BLOCKED',
        exchangeError:e?.body || null,
        reasons:[String(e.message || 'BINANCE_ACCOUNT_PREFLIGHT_FAILED').slice(0,160)]
      };
    }

    const sizingGuard = applyDynamicSizingGuards(accountRisk, settings, policy);
    if (!sizingGuard.ok) {
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_PREFLIGHT_BLOCKED', reasons:sizingGuard.reasons };
    }
    accountRisk = sizingGuard.accountRisk;

    let lease;
    try { lease = store.lease('acquire', LIVE_RESOURCE, LIVE_OWNER, leaseToken, 120000); }
    catch { return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_EXECUTOR_LEASE_FAILED'] }; }
    if (!lease?.acquired) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_EXECUTOR_LEASE_UNAVAILABLE'] };

    let scan;
    try { scan = await scanner.scan(); }
    catch { return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['SCANNER_UNAVAILABLE'] }; }

    if (typeof pipeline.resolveExecutionCandidate === 'function') {
      const selection = pipeline.resolveExecutionCandidate(scan, order);
      if (!selection?.candidate) {
        return {
          ok:false,
          orderPlaced:false,
          liveAllowed:false,
          execution:'LIVE_PREFLIGHT_BLOCKED',
          requestedSymbol:selection?.requestedSymbol || String(order?.symbol || '').toUpperCase(),
          reasons:[selection?.reason || 'REQUESTED_SYMBOL_NOT_EXECUTION_ELIGIBLE']
        };
      }
    }

    let claim;
    try { claim = store.claim(eventId, LIVE_OWNER, LIVE_RESOURCE, leaseToken, lineageId); }
    catch { return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['EXECUTION_CLAIM_FAILED'] }; }
    if (!claim?.claimed) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', claim, reasons:[claim?.reason || 'EXECUTION_CLAIM_REJECTED'] };

    const releaseClaim = () => {
      try { return store.releaseClaim?.(eventId, LIVE_OWNER, LIVE_RESOURCE, leaseToken, lineageId) || { released:false, reason:'RELEASE_UNAVAILABLE' }; }
      catch { return { released:false, reason:'RELEASE_FAILED' }; }
    };

    const stopRisk = {
      entryPrice:order?.entryPrice,
      stopPrice:order?.stopPrice,
      structuralInvalidationPrice:body?.structuralInvalidationPrice,
      bufferQuote:body?.bufferQuote,
      initialStopPrice:body?.initialStopPrice
    };
    const killSwitch = { control:{ available:true, tripped:!armedNow(), dryRunEnabled:true } };

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
      const claimRelease = releaseClaim();
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', claim, claimRelease, reasons:[String(e.message || 'PIPELINE_FAILED').slice(0,160)] };
    }

    if (!armedNow()) {
      const claimRelease = releaseClaim();
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', claim, claimRelease, plan:planResult?.plan || null, reasons:['LIVE_DISARMED_DURING_PREFLIGHT'] };
    }

    let renewed;
    try { renewed = store.lease('renew', LIVE_RESOURCE, LIVE_OWNER, leaseToken, 120000); }
    catch { renewed = { acquired:false, reason:'LEASE_RENEW_FAILED' }; }
    if (!renewed?.acquired) {
      const claimRelease = releaseClaim();
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LIVE_BLOCKED', claim, claimRelease, reasons:['LIVE_EXECUTOR_LEASE_LOST'] };
    }

    const grant = registry.issue({
      executionReadiness:planResult?.executionReadiness,
      apiPolicy:policy.apiPolicy,
      userApproved:true,
      order
    });
    if (!grant.ok) {
      const claimRelease = releaseClaim();
      return {
        ok:false,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LIVE_BLOCKED',
        claim,
        claimRelease,
        plan:planResult?.plan || null,
        riskGate:planResult?.riskGate || null,
        executionReadiness:planResult?.executionReadiness || null,
        reasons:grant.reasons || ['LIVE_GRANT_REJECTED']
      };
    }

    const result = await transport.submit({
      grantId:grant.grant.grantId,
      order,
      credentials:creds,
      livePolicy:{ expectedLeverage:settings.leverage, maxEntryDeviationPct:policy.maxEntryDeviationPct }
    });

    const uncertainSubmit = result?.manualReviewRequired === true ||
      result?.execution === 'LIVE_ENTRY_REVIEW_REQUIRED' ||
      result?.execution === 'LIVE_STOP_FAILED_MANUAL_INTERVENTION_REQUIRED';
    let claimRelease = null;
    if (result?.orderPlaced !== true && !uncertainSubmit) claimRelease = releaseClaim();

    try {
      store.journal('LIVE_EXECUTION', String(order?.symbol || '').toUpperCase(), {
        eventId,
        lineageId,
        plan:planResult?.plan || null,
        riskGate:planResult?.riskGate || null,
        sizing:sizingGuard.sizing || null,
        result
      });
    } catch {}

    return {
      ...result,
      claim,
      claimRelease,
      plan:planResult?.plan || null,
      riskGate:planResult?.riskGate || null,
      executionReadiness:planResult?.executionReadiness || null,
      sizing:sizingGuard.sizing || null
    };
  }

  return { status, accountSummary, arm, disarm, execute, readPolicy:() => publicPolicy(readPolicy(root)) };
}

module.exports = { LIVE_RESOURCE, LIVE_OWNER, normalizePolicy, resolveCredentials, requestedExecutionSettings, applyDynamicSizingGuards, createLiveController };
