'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { LiveAuthorizationRegistry } = require('./live-authorization');
const { BinanceLiveTransport } = require('./binance-live-transport');
const { assessApiPermissionDeclaration, containsSecretLikeKey } = require('./binance-account-context');
const { selectDeepCandidates, executionEligible } = require('./leader-committee');
const { buildLeaderLiveIntent } = require('./leader-live-intent');

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
  let leaderAutoBusy = false;
  let lastLeaderAutoResult = null;
  let leaderAutoCandidateCursor = 0;
  let leaderAutoConsecutiveBlocked = 0;
  let leaderAutoLastTickAt = null;
  let leaderAutoLastHealthyAt = null;
  const leaderAutoFile = path.join(root, 'config', 'leader-auto.json');

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

  function normalizeLeaderAuto(raw, policy) {
    const current = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const enabled = current.enabled === true;
    const marginQuote = finite(current.marginQuote);
    const leverage = finite(current.leverage);
    const maxOpenPositions = finite(current.maxOpenPositions);
    const allowLong = current.allowLong === true;
    const allowShort = current.allowShort === true;
    const reasons = [];
    if (enabled) {
      if (marginQuote === null || marginQuote <= 0) reasons.push('LEADER_AUTO_MARGIN_INVALID');
      if (leverage === null || !Number.isInteger(leverage) || leverage < 1 || leverage > 125) reasons.push('LEADER_AUTO_LEVERAGE_INVALID');
      if (maxOpenPositions === null || !Number.isInteger(maxOpenPositions) || maxOpenPositions < 1 || maxOpenPositions > 5) reasons.push('LEADER_AUTO_MAX_POSITIONS_INVALID');
      const pcMax = finite(policy?.limits?.maxOpenPositions);
      if (maxOpenPositions !== null && pcMax !== null && maxOpenPositions > pcMax) reasons.push('LEADER_AUTO_MAX_POSITIONS_EXCEEDS_PC_CAP');
      if (!allowLong && !allowShort) reasons.push('LEADER_AUTO_DIRECTION_DISABLED');
    }
    return {
      ok:reasons.length === 0,
      config:{
        enabled,
        marginQuote,
        leverage,
        maxOpenPositions,
        allowLong,
        allowShort,
        intervalSec:60
      },
      reasons:[...new Set(reasons)]
    };
  }

  function readLeaderAutoConfig() {
    let raw = {};
    try {
      if (fs.existsSync(leaderAutoFile)) raw = JSON.parse(fs.readFileSync(leaderAutoFile, 'utf8'));
    } catch {
      return { ok:false, config:{ enabled:false, marginQuote:null, leverage:null, maxOpenPositions:null, allowLong:false, allowShort:false, intervalSec:60 }, reasons:['LEADER_AUTO_CONFIG_INVALID'] };
    }
    return normalizeLeaderAuto(raw, readPolicy(root));
  }

  function writeLeaderAutoConfig(config) {
    fs.mkdirSync(path.dirname(leaderAutoFile), { recursive:true });
    const tmp = leaderAutoFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { encoding:'utf8', mode:0o600 });
    fs.renameSync(tmp, leaderAutoFile);
  }

  function configureLeaderAuto(body = {}) {
    const policy = readPolicy(root);
    if (!policy.ok) return { ok:false, reasons:policy.reasons || ['LIVE_POLICY_REQUIRED'] };
    const existing = readLeaderAutoConfig().config || {};
    const merged = {
      ...existing,
      ...(body && typeof body === 'object' ? body : {})
    };
    const normalized = normalizeLeaderAuto(merged, policy);
    if (!normalized.ok) return normalized;
    try { writeLeaderAutoConfig(normalized.config); }
    catch { return { ok:false, reasons:['LEADER_AUTO_CONFIG_WRITE_FAILED'] }; }
    return { ok:true, ...normalized.config };
  }

  function leaderAutoStatus() {
    const cfg = readLeaderAutoConfig();
    const c = cfg.config || {};
    return {
      ok:cfg.ok,
      configured:Boolean(c.marginQuote && c.leverage && c.maxOpenPositions),
      enabled:c.enabled === true,
      marginQuote:c.marginQuote,
      leverage:c.leverage,
      maxOpenPositions:c.maxOpenPositions,
      allowLong:c.allowLong === true,
      allowShort:c.allowShort === true,
      intervalSec:60,
      busy:leaderAutoBusy,
      lastExecution:lastLeaderAutoResult?.execution || null,
      lastSymbol:lastLeaderAutoResult?.symbol || lastLeaderAutoResult?.leaderIntent?.symbol || null,
      lastOrderPlaced:lastLeaderAutoResult?.orderPlaced === true,
      lastReasons:Array.isArray(lastLeaderAutoResult?.reasons) ? lastLeaderAutoResult.reasons.slice(0,8) : [],
      lastTickAt:leaderAutoLastTickAt,
      lastHealthyAt:leaderAutoLastHealthyAt,
      consecutiveBlocked:leaderAutoConsecutiveBlocked,
      candidateCursor:leaderAutoCandidateCursor,
      reasons:cfg.reasons || []
    };
  }

  function recordLeaderAutoResult(result) {
    const nowIso = new Date(clock()).toISOString();
    leaderAutoLastTickAt = nowIso;
    lastLeaderAutoResult = result;
    const execution = String(result?.execution || '');
    const blocked = execution === 'LEADER_AUTO_BLOCKED' || execution === 'LEADER_AUTO_TICK_FAILED' || execution === 'LEADER_AUTO_CONFIG_INVALID';
    if (blocked) leaderAutoConsecutiveBlocked += 1;
    else leaderAutoConsecutiveBlocked = 0;
    if (!blocked && execution !== 'LEADER_AUTO_BUSY' && execution !== 'LEADER_AUTO_DISABLED' && execution !== 'LEADER_AUTO_WAIT_ARM') {
      leaderAutoLastHealthyAt = nowIso;
    }
    return result;
  }

  async function leaderAutoTick() {
    if (leaderAutoBusy) return { ok:true, skipped:true, execution:'LEADER_AUTO_BUSY', orderPlaced:false };
    const cfg = readLeaderAutoConfig();
    if (!cfg.ok) return recordLeaderAutoResult({ ok:false, skipped:true, execution:'LEADER_AUTO_CONFIG_INVALID', orderPlaced:false, reasons:cfg.reasons });
    if (!cfg.config.enabled) return recordLeaderAutoResult({ ok:true, skipped:true, execution:'LEADER_AUTO_DISABLED', orderPlaced:false });
    if (!armedNow()) return recordLeaderAutoResult({ ok:true, skipped:true, execution:'LEADER_AUTO_WAIT_ARM', orderPlaced:false });
    leaderAutoBusy = true;
    try {
      const result = await executeLeader({
        requestedMarginQuote:cfg.config.marginQuote,
        requestedLeverage:cfg.config.leverage,
        requestedMaxOpenPositions:cfg.config.maxOpenPositions,
        allowLong:cfg.config.allowLong,
        allowShort:cfg.config.allowShort
      });
      return recordLeaderAutoResult(result);
    } catch (e) {
      const result = {
        ok:false,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LEADER_AUTO_TICK_FAILED',
        reasons:[String(e?.message || 'LEADER_AUTO_TICK_FAILED').slice(0,160)]
      };
      return recordLeaderAutoResult(result);
    } finally {
      leaderAutoBusy = false;
    }
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
      lastDisarmReason,
      leaderAuto:leaderAutoStatus()
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

  function exchangeFiltersFor(symbolInfo) {
    const filters = Array.isArray(symbolInfo?.filters) ? symbolInfo.filters : [];
    const byType = type => filters.find(x => x?.filterType === type) || null;
    const lot = byType('MARKET_LOT_SIZE') || byType('LOT_SIZE');
    const price = byType('PRICE_FILTER');
    const minNotionalFilter = byType('MIN_NOTIONAL') || byType('NOTIONAL');
    return {
      tickSize:finite(price?.tickSize),
      lotStep:finite(lot?.stepSize),
      minQty:finite(lot?.minQty),
      maxQty:finite(lot?.maxQty),
      minNotional:finite(minNotionalFilter?.notional ?? minNotionalFilter?.minNotional)
    };
  }

  async function executeLeader(body = {}) {
    const policy = readPolicy(root);
    if (!armedNow()) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:['LIVE_NOT_ARMED'] };
    if (!policy.ok) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:policy.reasons || ['LIVE_POLICY_REQUIRED'] };

    const settings = requestedExecutionSettings(body, policy);
    if (!settings.ok || !settings.dynamic) {
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:settings.reasons?.length ? settings.reasons : ['LEADER_AUTO_DYNAMIC_SETTINGS_REQUIRED'] };
    }

    const allowLong = body?.allowLong === true;
    const allowShort = body?.allowShort === true;
    if (!allowLong && !allowShort) {
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:['LEADER_AUTO_DIRECTION_DISABLED'] };
    }

    let scan;
    try { scan = await scanner.scan(); }
    catch (e) {
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LEADER_AUTO_BLOCKED', reasons:['SCANNER_UNAVAILABLE'] };
    }

    const candidates = selectDeepCandidates(scan, 16)
      .filter(executionEligible)
      .filter(x => {
        const side = String(x?.side || '').toUpperCase();
        return (side === 'LONG' && allowLong) || (side === 'SHORT' && allowShort);
      });
    if (!candidates.length) {
      leaderAutoCandidateCursor = 0;
      return { ok:true, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_WAIT', reasons:['NO_ALLOWED_EXECUTION_ELIGIBLE_LEADER'] };
    }
    const selectedIndex = leaderAutoCandidateCursor % candidates.length;
    const candidate = candidates[selectedIndex];
    leaderAutoCandidateCursor = (selectedIndex + 1) % candidates.length;

    let advisory;
    try {
      advisory = await pipeline.run({
        scan,
        store,
        committee,
        executionIntent:{ symbol:candidate.symbol }
      });
    } catch (e) {
      return {
        ok:false,
        orderPlaced:false,
        liveAllowed:false,
        retryable:true,
        execution:'LEADER_AUTO_BLOCKED',
        symbol:candidate.symbol,
        reasons:[String(e?.message || 'LEADER_PLAN_FAILED').slice(0,160)]
      };
    }

    if (!advisory?.candidateFound || !advisory?.plan || !advisory?.unifiedContext) {
      return {
        ok:true,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LEADER_AUTO_WAIT',
        symbol:candidate.symbol,
        reasons:[advisory?.reason || 'LEADER_PLAN_NOT_READY']
      };
    }

    if (String(advisory.plan.status || '').toUpperCase() !== 'QUALIFIED') {
      return {
        ok:true,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LEADER_AUTO_WAIT',
        symbol:candidate.symbol,
        plan:advisory.plan,
        reasons:['LEADER_PLAN_NOT_QUALIFIED']
      };
    }

    const creds = currentCredentials();
    if (!credentialsReady(creds)) {
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:['BINANCE_CREDENTIALS_REQUIRED'] };
    }

    let symbolInfo;
    try {
      const ex = await transport._fetchJson('GET', '/fapi/v1/exchangeInfo');
      symbolInfo = Array.isArray(ex?.symbols) ? ex.symbols.find(x => String(x?.symbol || '').toUpperCase() === String(candidate.symbol).toUpperCase()) : null;
    } catch (e) {
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LEADER_AUTO_BLOCKED', symbol:candidate.symbol, reasons:['BINANCE_EXCHANGE_INFO_UNAVAILABLE'] };
    }
    if (!symbolInfo) {
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', symbol:candidate.symbol, reasons:['BINANCE_SYMBOL_FILTERS_UNAVAILABLE'] };
    }

    const intent = buildLeaderLiveIntent({
      candidate,
      unified:advisory.unifiedContext,
      plan:advisory.plan,
      marginQuote:settings.marginQuote,
      leverage:settings.leverage,
      filters:exchangeFiltersFor(symbolInfo)
    });
    if (!intent.ok) {
      return {
        ok:true,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LEADER_AUTO_WAIT',
        symbol:candidate.symbol,
        plan:advisory.plan,
        intent,
        reasons:intent.reasons || ['LEADER_INTENT_NOT_READY']
      };
    }

    const now = clock();
    const eventBucket = Math.floor(now / 60000);
    const lineageBucket = Math.floor(now / (5 * 60000));
    const side = intent.side;
    const eventId = `LH:${intent.symbol}:${side}:${eventBucket}`;
    const lineageId = `LH:${intent.symbol}:${side}:${intent.originTF}:${lineageBucket}`;
    const clientOrderId = `LH${intent.symbol.slice(0,8)}${side[0]}${eventBucket.toString(36)}`.slice(0,36);
    const order = {
      action:'OPEN',
      symbol:intent.symbol,
      side,
      orderType:'MARKET',
      quantity:intent.quantity,
      entryPrice:intent.entryPrice,
      stopPrice:intent.stopPrice,
      takeProfit1:intent.takeProfit1,
      takeProfit2:intent.takeProfit2,
      takeProfit3:intent.takeProfit3,
      clientOrderId,
      lineageId
    };

    const result = await execute({
      eventId,
      order,
      structuralInvalidationPrice:intent.structuralInvalidationPrice,
      bufferQuote:intent.buffer,
      initialStopPrice:intent.stopPrice,
      requestedMarginQuote:settings.marginQuote,
      requestedLeverage:settings.leverage,
      requestedMaxOpenPositions:settings.maxOpenPositions
    });

    try {
      store.journal('LEADER_AUTO_ATTEMPT', intent.symbol, {
        eventId,
        lineageId,
        candidate,
        plan:advisory.plan,
        intent:{
          symbol:intent.symbol,
          side:intent.side,
          originTF:intent.originTF,
          entryPrice:intent.entryPrice,
          stopPrice:intent.stopPrice,
          takeProfit1:intent.takeProfit1,
          takeProfit2:intent.takeProfit2,
          takeProfit3:intent.takeProfit3,
          quantity:intent.quantity,
          riskQuote:intent.riskQuote,
          notionalQuote:intent.notionalQuote
        },
        result
      });
    } catch {}

    return {
      ...result,
      leaderAuto:true,
      leaderCandidate:candidate,
      leaderPlan:advisory.plan,
      leaderIntent:intent
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
    catch { return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LIVE_BLOCKED', reasons:['SCANNER_UNAVAILABLE'] }; }

    if (typeof pipeline.resolveExecutionCandidate === 'function') {
      const selection = pipeline.resolveExecutionCandidate(scan, order);
      if (!selection?.candidate) {
        return {
          ok:false,
          orderPlaced:false,
          liveAllowed:false,
          execution:'LIVE_PREFLIGHT_BLOCKED',
          retryable:true,
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
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:claimRelease?.released === true, execution:'LIVE_BLOCKED', claim, claimRelease, reasons:[String(e.message || 'PIPELINE_FAILED').slice(0,160)] };
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
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:claimRelease?.released === true, execution:'LIVE_BLOCKED', claim, claimRelease, reasons:['LIVE_EXECUTOR_LEASE_LOST'] };
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
        retryable:claimRelease?.released === true,
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
      retryable:claimRelease?.released === true && result?.orderPlaced !== true && !uncertainSubmit,
      claim,
      claimRelease,
      plan:planResult?.plan || null,
      riskGate:planResult?.riskGate || null,
      executionReadiness:planResult?.executionReadiness || null,
      sizing:sizingGuard.sizing || null
    };
  }

  return { status, accountSummary, arm, disarm, execute, executeLeader, configureLeaderAuto, leaderAutoStatus, leaderAutoTick, readPolicy:() => publicPolicy(readPolicy(root)) };
}

module.exports = { LIVE_RESOURCE, LIVE_OWNER, normalizePolicy, resolveCredentials, requestedExecutionSettings, applyDynamicSizingGuards, createLiveController };
