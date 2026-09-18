'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { LiveAuthorizationRegistry } = require('./live-authorization');
const { BinanceLiveTransport } = require('./binance-live-transport');
const { assessApiPermissionDeclaration, containsSecretLikeKey } = require('./binance-account-context');
const { selectDeepCandidates, executionEligibility, executionEligible } = require('./leader-committee');
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
  const commissionRateCache = new Map();
  let leaderAutoBusy = false;
  let lastLeaderAutoResult = null;
  let leaderAutoCandidateCursor = 0;
  let leaderAutoConsecutiveBlocked = 0;
  let leaderAutoLastTickAt = null;
  let leaderAutoLastHealthyAt = null;
  let leaderAutoLastDiagnostics = { universeCount:0, shortlistCount:0, eligibleCount:0, candidates:[] };
  const leaderAutoFile = path.join(root, 'config', 'leader-auto.json');
  const leaderAnalysisFile = path.join(root, 'data', 'leader-analysis-state.json');
  const LEADER_ANALYSIS_VERSION = 1;
  const LEADER_ANALYSIS_MAX_TRACKS = 24;
  const LEADER_ANALYSIS_RETENTION_MS = 24 * 60 * 60 * 1000;
  let leaderAnalysisState = readLeaderAnalysisState();

  function emptyLeaderAnalysisState() {
    return { version:LEADER_ANALYSIS_VERSION, updatedAt:0, cursor:0, bySymbol:{} };
  }

  function readLeaderAnalysisState() {
    try {
      if (!fs.existsSync(leaderAnalysisFile)) return emptyLeaderAnalysisState();
      const raw=JSON.parse(fs.readFileSync(leaderAnalysisFile,'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLeaderAnalysisState();
      const bySymbol=raw.bySymbol && typeof raw.bySymbol === 'object' && !Array.isArray(raw.bySymbol) ? raw.bySymbol : {};
      return {
        version:LEADER_ANALYSIS_VERSION,
        updatedAt:Number(raw.updatedAt || 0),
        cursor:Number.isInteger(raw.cursor) && raw.cursor >= 0 ? raw.cursor : 0,
        bySymbol
      };
    } catch {
      return emptyLeaderAnalysisState();
    }
  }

  function writeLeaderAnalysisState() {
    const now=clock();
    const rows=Object.entries(leaderAnalysisState.bySymbol || {})
      .filter(([symbol,row]) => /^[A-Z0-9]{1,28}USDT$/.test(symbol) && row && typeof row === 'object')
      .filter(([,row]) => {
        const last=Number(row.lastAnalyzedAt || row.detectedAt || 0);
        return !last || !Number.isFinite(now) || now-last <= LEADER_ANALYSIS_RETENTION_MS || row.state === 'ACTIVE';
      })
      .sort((a,b) => Number(b[1].lastAnalyzedAt || b[1].detectedAt || 0) - Number(a[1].lastAnalyzedAt || a[1].detectedAt || 0))
      .slice(0,LEADER_ANALYSIS_MAX_TRACKS);
    leaderAnalysisState.bySymbol=Object.fromEntries(rows);
    leaderAnalysisState.updatedAt=Number.isFinite(now) ? now : Date.now();
    fs.mkdirSync(path.dirname(leaderAnalysisFile),{recursive:true});
    const tmp=leaderAnalysisFile+'.'+process.pid+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(leaderAnalysisState,null,2),{encoding:'utf8',mode:0o600});
    fs.renameSync(tmp,leaderAnalysisFile);
  }

  function journalLeaderLifecycle(symbol, previousState, nextState, row, detail = null) {
    if (previousState === nextState && !detail) return;
    try {
      store.journal('LEADER_LIFECYCLE', symbol, {
        previousState:previousState || null,
        state:nextState,
        side:row?.side || null,
        setupId:row?.setupId || null,
        planStatus:row?.planStatus || null,
        originTF:row?.originTF || null,
        ownerTF:row?.ownerTF || null,
        rebaseCount:Number(row?.rebaseCount || 0),
        invalidationCount:Number(row?.invalidationCount || 0),
        detail:detail ? String(detail).slice(0,240) : null
      });
    } catch {}
  }

  function bestTrackedSide(unified, fallbackSide) {
    const score = side => {
      const p=unified?.opportunityPaths?.[side];
      const rows=Array.isArray(p?.continuity) ? p.continuity.filter(x => x?.immediateEligible === true) : [];
      return rows.reduce((sum,x) => sum + (finite(x?.score) || 0),0) + rows.length*100;
    };
    const l=score('LONG'), sh=score('SHORT');
    if (l > sh && l > 0) return 'LONG';
    if (sh > l && sh > 0) return 'SHORT';
    return ['LONG','SHORT'].includes(String(fallbackSide||'').toUpperCase()) ? String(fallbackSide).toUpperCase() : null;
  }

  function upsertLeaderLifecycle(candidate, advisory, forcedState = null, detail = null) {
    const symbol=String(candidate?.symbol || advisory?.symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{1,28}USDT$/.test(symbol)) return null;
    const now=clock();
    const old=leaderAnalysisState.bySymbol?.[symbol] || null;
    const oldState=String(old?.state || '');
    const plan=advisory?.plan || {};
    const planStatus=String(plan.status || '').toUpperCase();
    const requestedSide=String(plan.side || candidate?.side || old?.side || '').toUpperCase();
    const side=['LONG','SHORT'].includes(requestedSide) ? requestedSide : bestTrackedSide(advisory?.unifiedContext, old?.side);
    const stillOpportunity=Boolean(
      side && Array.isArray(advisory?.unifiedContext?.opportunityPaths?.[side]?.continuity) &&
      advisory.unifiedContext.opportunityPaths[side].continuity.length
    );
    let nextState=forcedState;
    if (!nextState) {
      if (!old) nextState='DETECTED';
      if (planStatus === 'QUALIFIED') nextState=oldState === 'INVALIDATED' ? 'REBASE' : 'ARMED';
      else if (planStatus === 'WATCH') nextState=oldState === 'INVALIDATED' ? 'REBASE' : 'WATCH';
      else if (planStatus === 'REJECT') nextState='INVALIDATED';
      else if (!nextState) nextState=oldState || 'DETECTED';
    }

    let rebaseCount=Number(old?.rebaseCount || 0);
    let invalidationCount=Number(old?.invalidationCount || 0);
    if (nextState === 'INVALIDATED' && oldState !== 'INVALIDATED') invalidationCount += 1;
    if (nextState === 'REBASE' && oldState !== 'REBASE') rebaseCount += 1;
    const setupChanged=nextState === 'REBASE' || !old?.setupId;
    const setupId=setupChanged
      ? 'LHSET:'+symbol+':'+(side || 'NONE')+':'+Math.floor((Number.isFinite(now)?now:Date.now())/60000).toString(36)
      : old.setupId;

    const row={
      symbol,
      side,
      state:nextState,
      setupId,
      detectedAt:Number(old?.detectedAt || (Number.isFinite(now)?now:Date.now())),
      lastAnalyzedAt:Number.isFinite(now)?now:Date.now(),
      lastStateChangeAt:nextState !== oldState ? (Number.isFinite(now)?now:Date.now()) : Number(old?.lastStateChangeAt || old?.detectedAt || 0),
      planStatus:planStatus || String(old?.planStatus || ''),
      originTF:String(plan.originTF || old?.originTF || ''),
      ownerTF:String(plan.ownerTF || old?.ownerTF || ''),
      setup:String(plan.setup || old?.setup || ''),
      waitFor:String(plan.waitFor || old?.waitFor || ''),
      why:String(plan.why || old?.why || ''),
      riskNote:String(plan.riskNote || old?.riskNote || ''),
      confidence:finite(plan.confidence) ?? finite(old?.confidence),
      visionAttached:Number(advisory?.vision?.attached || advisory?.committee?.vision?.attached || old?.visionAttached || 0),
      visionRequired:Number(advisory?.vision?.required || old?.visionRequired || 9),
      stillOpportunity,
      reanalysisEligible:nextState !== 'ACTIVE' && (nextState !== 'INVALIDATED' || stillOpportunity),
      rebaseCount,
      invalidationCount,
      lastDetail:detail ? String(detail).slice(0,240) : null
    };
    if (!leaderAnalysisState.bySymbol || typeof leaderAnalysisState.bySymbol !== 'object') leaderAnalysisState.bySymbol={};
    leaderAnalysisState.bySymbol[symbol]=row;
    writeLeaderAnalysisState();
    journalLeaderLifecycle(symbol,oldState,nextState,row,detail);
    return row;
  }

  function leaderLifecycleSummary() {
    const rows=Object.values(leaderAnalysisState.bySymbol || {})
      .filter(x => x && typeof x === 'object')
      .sort((a,b) => Number(b.lastAnalyzedAt || 0)-Number(a.lastAnalyzedAt || 0))
      .slice(0,LEADER_ANALYSIS_MAX_TRACKS);
    return {
      version:LEADER_ANALYSIS_VERSION,
      tracked:rows.length,
      activeTracking:rows.filter(x => x.reanalysisEligible === true).length,
      rows
    };
  }

  async function refreshOneTrackedAnalysis(scan, skipSymbol = '') {
    const skip=String(skipSymbol || '').toUpperCase();
    const rows=Object.values(leaderAnalysisState.bySymbol || {})
      .filter(x => x && x.reanalysisEligible === true && ['LONG','SHORT'].includes(String(x.side || '').toUpperCase()))
      .filter(x => String(x.symbol || '').toUpperCase() !== skip)
      .sort((a,b) => Number(a.lastAnalyzedAt || 0)-Number(b.lastAnalyzedAt || 0));
    if (!rows.length) return null;
    const idx=leaderAnalysisState.cursor % rows.length;
    const tracked=rows[idx];
    leaderAnalysisState.cursor=(idx+1)%rows.length;
    writeLeaderAnalysisState();
    try {
      const advisory=await pipeline.run({
        scan,
        store,
        committee,
        executionIntent:{ symbol:tracked.symbol, side:tracked.side, analysisTracking:true }
      });
      const planStatus=String(advisory?.plan?.status || '').toUpperCase();
      if (advisory?.candidateFound && advisory?.unifiedContext && advisory?.plan) {
        const before=String(tracked.state || '');
        const row=upsertLeaderLifecycle({symbol:tracked.symbol,side:tracked.side},advisory,null,'BACKGROUND_9TF_REANALYSIS');
        // A rejected structure that still has a deterministic opportunity path is
        // retained for a fresh rebase on the next analysis-only pass.
        if (planStatus === 'REJECT' && row?.stillOpportunity) {
          row.reanalysisEligible=true;
          leaderAnalysisState.bySymbol[tracked.symbol]=row;
          writeLeaderAnalysisState();
        }
        return { ok:true, symbol:tracked.symbol, previousState:before, state:row?.state || null, planStatus };
      }
      return { ok:false, symbol:tracked.symbol, reason:advisory?.reason || 'TRACK_ANALYSIS_NOT_READY' };
    } catch (e) {
      return { ok:false, symbol:tracked.symbol, reason:String(e?.message || e).slice(0,160) };
    }
  }

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
      diagnostics:leaderAutoLastDiagnostics,
      analysisLifecycle:leaderLifecycleSummary(),
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

  async function takerCommissionRateFor(symbol, creds) {
    const key=String(symbol || '').toUpperCase();
    const now=clock();
    const cached=commissionRateCache.get(key);
    if (cached && Number.isFinite(now) && now-cached.at >= 0 && now-cached.at <= 10*60*1000) {
      return { ok:true, rate:cached.rate, cached:true, stale:false };
    }
    try {
      await transport._syncServerTime();
      const body=await transport._fetchJson('GET','/fapi/v1/commissionRate',{
        params:{ symbol:key },
        credentials:creds,
        signed:true
      });
      const rate=finite(body?.takerCommissionRate);
      if (rate === null || rate < 0 || rate > 0.01) throw new Error('BINANCE_TAKER_COMMISSION_RATE_INVALID');
      commissionRateCache.set(key,{ at:now, rate });
      return { ok:true, rate, cached:false, stale:false };
    } catch (e) {
      if (cached && Number.isFinite(now) && now-cached.at >= 0 && now-cached.at <= 60*60*1000) {
        return { ok:true, rate:cached.rate, cached:true, stale:true };
      }
      return {
        ok:false,
        rate:null,
        cached:false,
        stale:false,
        reason:'BINANCE_COMMISSION_RATE_UNAVAILABLE',
        detail:String(e?.message || e).slice(0,160)
      };
    }
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

  const LEADER_REASON_TR = {
    SIDE_NOT_LONG_OR_SHORT:'LONG/SHORT yönü belirlenemedi',
    SPREAD_ABOVE_8_BPS:'alış-satış farkı 8 bps sınırının üzerinde',
    TRADE_QUALITY_BELOW_58:'işlem kalitesi 58 eşiğinin altında',
    DIRECTION_SUPPORT_MISSING:'seçilen yön için yeterli zaman dilimi desteği yok',
    LONG_EXPANSION_BELOW_35:'LONG genişleme gücü 35 eşiğinin altında',
    SHORT_EXPANSION_BELOW_35:'SHORT genişleme gücü 35 eşiğinin altında',
    LONG_DISABLED_BY_USER:'LONG otomatik işlem kullanıcı tarafından kapalı',
    SHORT_DISABLED_BY_USER:'SHORT otomatik işlem kullanıcı tarafından kapalı',
    DIRECTION_DISABLED:'bu yön otomatik işlem için kapalı',
    COMMITTEE_UNAVAILABLE:'9Router analiz komitesi/model erişimi hazır değil',
    LEADER_PLAN_NOT_READY:'9 zaman dilimli analiz planı henüz hazır değil',
    LEADER_PLAN_NOT_QUALIFIED:'9 zaman dilimli plan henüz işlem açma niteliğine ulaşmadı',
    NO_FRESH_TIMEFRAME_CONTEXT:'taze zaman dilimi verisi yetersiz',
    NO_ALLOWED_EXECUTION_ELIGIBLE_LEADER:'ön kontrolden geçen izinli aday yok',
    SCANNER_UNAVAILABLE:'evren tarayıcısına ulaşılamadı',
    BINANCE_EXCHANGE_INFO_UNAVAILABLE:'Binance sembol/filtre bilgisi alınamadı',
    BINANCE_SYMBOL_FILTERS_UNAVAILABLE:'coin için Binance işlem filtreleri bulunamadı',
    BINANCE_COMMISSION_RATE_UNAVAILABLE:'kullanıcıya özel Binance taker komisyon oranı alınamadı; scalp maliyet hesabı yapılamadı',
    SCALP_COMMISSION_RATE_REQUIRED:'1m/3m/5m işlem için gerçek taker komisyon oranı gerekli',
    SCALP_SPREAD_COST_REQUIRED:'1m/3m/5m işlem için güncel spread maliyeti gerekli',
    SCALP_COST_EDGE_NOT_VIABLE:'TP1 mesafesi ücret + spread + slippage tahminine göre yeterli net avantaj bırakmıyor',
    BINANCE_CREDENTIALS_REQUIRED:'Binance Futures API kimliği PC tarafında hazır değil',
    LIVE_NOT_ARMED:'PC LIVE yetkisi açık değil',
    LEADER_INTENT_NOT_READY:'giriş, stop veya miktar henüz güvenli emir niyetine dönüşmedi',
    EXECUTION_LINEAGE_MISMATCH:'sinyal ile emir soy zinciri eşleşmedi',
    DUPLICATE_EVENT:'aynı sinyal olayı daha önce işlendi',
    DUPLICATE_LINEAGE:'aynı işlem fikri daha önce işlendi',
    VISION_9TF_INCOMPLETE:'9 zaman diliminin grafik paketi eksik; grafik görmeden canlı karar verilmedi',
    VISION_COMMITTEE_INPUT_INCOMPLETE:'9Router komitesi 9 grafiğin tamamını alamadı; canlı karar bloke edildi',
    VISION_COMMITTEE_OUTPUT_INCOMPLETE:'Vision modeli 9TF analiz sözleşmesindeki zorunlu Türkçe alanların tamamını üretmedi; canlı karar bloke edildi',
    VISION_COMMITTEE_UNAVAILABLE:'Vision/9Router analiz komitesi erişilemiyor; grafik analizi tamamlanmadı',
    UNSTRUCTURED_COMMITTEE_OUTPUT:'model çıktısı beklenen plan şemasına uymadı',
    NO_FRESH_TIMEFRAME_CONTEXT:'taze zaman dilimi bağlamı yetersiz'
  };

  const LEADER_STAGE_TR = {
    PREFILTER:'Ön tarama',
    PIPELINE_SELECTED:'Derin 9TF analiz için seçildi',
    PIPELINE_ERROR:'Derin analiz hattında hata',
    PLAN_NOT_READY:'9TF planı hazırlanamadı',
    PLAN_NOT_QUALIFIED:'9TF planı henüz işlem için yeterli değil',
    PLAN_QUALIFIED:'9TF planı işlem adayı olarak nitelikli',
    INTENT_NOT_READY:'Emir niyeti henüz hazır değil',
    INTENT_READY:'Emir niyeti deterministik kontroller için hazır',
    ORDER_PLACED:'Canlı emir gönderildi',
    EXECUTION_RESULT:'Canlı yürütme sonucu alındı'
  };

  function leaderReasonTr(reason) {
    const key=String(reason || '').trim();
    if (!key) return '';
    if (LEADER_REASON_TR[key]) return LEADER_REASON_TR[key];
    if (/committee/i.test(key)) return '9Router analiz komitesi/model erişimi hazır değil';
    if (/spread/i.test(key)) return 'alış-satış farkı izin verilen sınırı aşıyor';
    if (/quality/i.test(key)) return 'işlem kalitesi gerekli eşiğe ulaşmadı';
    if (/expansion/i.test(key)) return 'seçilen yöndeki genişleme/momentum gücü henüz yeterli değil';
    if (/invalid USDT perpetual symbol/i.test(key)) return 'sembol Binance USDT perpetual evreniyle eşleşmedi';
    return key;
  }

  const LEADER_DIAG_FRAMES=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];

  function shortPatternName(p) {
    if (!p) return '';
    if (typeof p === 'string') return p.slice(0,60);
    return String(p.name || p.type || p.pattern || p.state || '').slice(0,60);
  }

  function timeframeEvidence(unified) {
    const out={};
    for (const tf of LEADER_DIAG_FRAMES) {
      const f=unified?.frames?.[tf];
      if (!f?.available) {
        out[tf]={ available:false, summaryTr:'veri yok: '+String(f?.reason || 'UNAVAILABLE') };
        continue;
      }
      const opp=f.opportunity?.available === false ? null : f.opportunity;
      const patterns=(Array.isArray(f.patterns)?f.patterns:[]).map(shortPatternName).filter(Boolean).slice(-3);
      const smc=f.smcContext?.available === true ? f.smcContext : null;
      const dealing=smc?.dealingRange || null;
      const latestFvg=Array.isArray(f.liquidity?.fairValueGaps) && f.liquidity.fairValueGaps.length
        ? f.liquidity.fairValueGaps.at(-1) : null;
      const sweep=f.liquidity?.lastSweep;
      const sweepText=sweep
        ? String(sweep.side || sweep.type || sweep.state || sweep.direction || 'sweep')
        : '';
      const parts=[
        f.fresh ? 'taze' : 'eski',
        f.trend ? 'trend '+f.trend : '',
        finite(f.rsi14)!==null ? 'RSI '+finite(f.rsi14).toFixed(1) : '',
        f.breakOfStructure ? 'BOS '+f.breakOfStructure : '',
        smc?.swingEvent ? 'swing '+smc.swingEvent : '',
        dealing?.zone ? 'SMC '+dealing.zone+(finite(dealing.positionPct)!==null?' %'+finite(dealing.positionPct).toFixed(1):'') : '',
        latestFvg && finite(latestFvg.ce50)!==null ? 'FVG CE50 '+finite(latestFvg.ce50) : '',
        opp?.preferredSide ? 'fırsat '+opp.preferredSide : '',
        opp && finite(opp.longScore)!==null ? 'L '+finite(opp.longScore).toFixed(0) : '',
        opp && finite(opp.shortScore)!==null ? 'S '+finite(opp.shortScore).toFixed(0) : '',
        f.breakoutExecution?.status ? 'breakout '+f.breakoutExecution.status : '',
        sweepText ? 'sweep '+sweepText : '',
        patterns.length ? 'pattern '+patterns.join('/') : ''
      ].filter(Boolean);
      out[tf]={
        available:true,
        fresh:f.fresh === true,
        asOf:f.asOf || null,
        trend:f.trend || null,
        rsi14:finite(f.rsi14),
        breakOfStructure:f.breakOfStructure || null,
        longScore:opp ? finite(opp.longScore) : null,
        shortScore:opp ? finite(opp.shortScore) : null,
        preferredSide:opp?.preferredSide || null,
        breakoutStatus:f.breakoutExecution?.status || null,
        patterns,
        smc:smc ? {
          swingEvent:smc.swingEvent || null,
          swingState:smc.swingState || null,
          dealingRange:smc.dealingRange || null,
          oteReference:smc.oteReference || null,
          semantics:smc.semantics || 'SOFT_STRUCTURAL_CONTEXT_ONLY'
        } : { available:false },
        liquidity:{
          buySide:f.liquidity?.buySide || null,
          sellSide:f.liquidity?.sellSide || null,
          lastSweep:sweep || null,
          fairValueGaps:Array.isArray(f.liquidity?.fairValueGaps) ? f.liquidity.fairValueGaps.slice(-2) : []
        },
        summaryTr:parts.join(' • ')
      };
    }
    return out;
  }

  function visionDiagnosticExtras(advisory) {
    const plan=advisory?.plan || {};
    const vision=advisory?.vision || {};
    return {
      planStatus:String(plan.status || ''),
      confidence:finite(plan.confidence),
      originTF:String(plan.originTF || ''),
      ownerTF:String(plan.ownerTF || ''),
      setup:String(plan.setup || ''),
      execPath:String(plan.execPath || ''),
      planWhy:String(plan.why || ''),
      planRisk:String(plan.riskNote || ''),
      waitFor:String(plan.waitFor || ''),
      supportTFs:Array.isArray(plan.supportTFs) ? plan.supportTFs.slice(0,9) : [],
      vetoTFs:Array.isArray(plan.vetoTFs) ? plan.vetoTFs.slice(0,9) : [],
      formingContext:String(plan.formingContext || ''),
      visionSummary:String(plan.visionSummary || ''),
      missingVisionFields:Array.isArray(plan.missingVisionFields) ? plan.missingVisionFields.slice(0,64) : [],
      timeframeNotes:plan.timeframeNotes && typeof plan.timeframeNotes === 'object' ? plan.timeframeNotes : {},
      timeframeDiagnostics:plan.timeframeDiagnostics && typeof plan.timeframeDiagnostics === 'object' ? plan.timeframeDiagnostics : {},
      timeframeEvidence:timeframeEvidence(advisory?.unifiedContext),
      vision:{
        ok:vision?.ok === true,
        attached:Number(vision?.attached || advisory?.committee?.vision?.attached || 0),
        required:Number(vision?.required || 9),
        barsRequested:Number(vision?.barsRequested || 128),
        mode:String(vision?.mode || 'annotated'),
        failures:Array.isArray(vision?.failures) ? vision.failures.slice(0,9) : []
      },
      committee:{
        ok:advisory?.committee?.ok === true,
        available:advisory?.committee?.available !== false && advisory?.committee?.mode !== 'unavailable',
        model:String(advisory?.committee?.model || ''),
        mode:String(advisory?.committee?.mode || ''),
        degraded:advisory?.committee?.degraded === true,
        error:String(advisory?.committee?.error || ''),
        detail:String(advisory?.committee?.detail || '').slice(0,1200),
        requiredAnalystReplies:Number(advisory?.committee?.requiredAnalystReplies || 0),
        receivedAnalystReplies:Number(advisory?.committee?.receivedAnalystReplies || 0),
        attemptedModels:Array.isArray(advisory?.committee?.attemptedModels) ? advisory.committee.attemptedModels.slice(0,12) : [],
        failed:Array.isArray(advisory?.committee?.failed) ? advisory.committee.failed.slice(0,8).map(x=>({model:String(x?.model||''),error:String(x?.error||'').slice(0,400)})) : []
      }
    };
  }

  function leaderCandidateExplanationTr(row) {
    const side=row?.side === 'LONG' ? 'LONG' : row?.side === 'SHORT' ? 'SHORT' : 'YÖNSÜZ';
    const rank=finite(row?.attackRank), projected=finite(row?.projectedRank);
    const quality=finite(row?.tradeQuality), spread=finite(row?.spreadBps);
    const support=finite(row?.directionSupport), expansion=finite(row?.directionalExpansion);
    const parts=[];
    parts.push(`${row?.symbol || 'COIN'} ${side}: ${LEADER_STAGE_TR[row?.stage] || row?.stage || 'Tarama'}.`);
    const metrics=[];
    if(rank!==null) metrics.push(`iç saldırı sırası ${rank}`);
    if(projected!==null) metrics.push(`projeksiyon ${projected}`);
    if(quality!==null) metrics.push(`kalite ${quality}`);
    if(expansion!==null) metrics.push(`${side} genişleme ${expansion}`);
    if(support!==null) metrics.push(`yön desteği ${support}`);
    if(spread!==null) metrics.push(`spread ${spread} bps`);
    if(metrics.length) parts.push('Ölçümler: '+metrics.join(', ')+'.');
    if(row?.leaderState) parts.push(`Erken fırsat durumu: ${row.leaderState}.`);
    if(row?.deepScanReason) parts.push(`Derin tarama nedeni: ${row.deepScanReason}.`);
    const activeReasons=[
      ...(Array.isArray(row?.lastReasons) ? row.lastReasons : []),
      ...(Array.isArray(row?.reasons) ? row.reasons : [])
    ].filter(Boolean);
    const warnings=Array.isArray(row?.warnings) ? row.warnings : [];
    const reasonText=[...new Set(activeReasons)].map(leaderReasonTr).filter(Boolean);
    const warningText=[...new Set(warnings)].map(leaderReasonTr).filter(Boolean);
    if(reasonText.length) parts.push('İşlem açmama nedeni: '+reasonText.join('; ')+'.');
    else if(row?.eligible) parts.push('Ön yürütme filtresi geçti; grafik, 9TF plan, risk ve canlı emir kontrolleri ayrıca geçmek zorunda.');
    if(warningText.length) parts.push('Uyarı: '+warningText.join('; ')+'.');
    if(row?.originTF || row?.ownerTF) parts.push(`Plan zaman dilimi: başlangıç ${row.originTF || '-'}, sahip ${row.ownerTF || '-'}.`);
    if(finite(row?.confidence)!==null) parts.push(`Model güveni: ${finite(row.confidence)}/100.`);
    if(row?.setup) parts.push(`Kurulum: ${row.setup}.`);
    if(row?.planWhy) parts.push(`Plan gerekçesi: ${row.planWhy}`);
    if(row?.waitFor && String(row.waitFor).toUpperCase()!=='NONE') parts.push(`Sinyal için beklenen: ${row.waitFor}`);
    if(Array.isArray(row?.supportTFs)) parts.push(`Destek TF: ${row.supportTFs.length?row.supportTFs.join(', '):'NONE'}.`);
    if(Array.isArray(row?.vetoTFs)) parts.push(`Veto TF: ${row.vetoTFs.length?row.vetoTFs.join(', '):'NONE'}.`);
    if(row?.formingContext) parts.push(`Forming bağlamı: ${row.formingContext}`);
    if(row?.visionSummary) parts.push(`9TF grafik özeti: ${row.visionSummary}`);
    if(row?.vision) parts.push(`Vision: ${Number(row.vision.attached||0)}/${Number(row.vision.required||9)} grafik, ${Number(row.vision.barsRequested||128)} mum, ${row.vision.mode||'annotated'}.`);
    if(row?.planRisk) parts.push(`Risk notu: ${row.planRisk}`);
    if(row?.orderPlaced === true) parts.push('Sonuç: Binance Futures canlı emri gönderildi; koruma ve yürütme sonucu ayrıca izleniyor.');
    return parts.join(' ');
  }

  function setLeaderAutoDiagnostics(scan, rawCandidates, allowLong, allowShort) {
    const rows = (Array.isArray(rawCandidates) ? rawCandidates : []).map(c => {
      const e = executionEligibility(c);
      const side = String(c?.side || '').toUpperCase();
      const directionAllowed = (side === 'LONG' && allowLong) || (side === 'SHORT' && allowShort);
      const reasons = [...(e.reasons || [])];
      if (!directionAllowed) reasons.push(side === 'LONG' ? 'LONG_DISABLED_BY_USER' : side === 'SHORT' ? 'SHORT_DISABLED_BY_USER' : 'DIRECTION_DISABLED');
      const row = {
        symbol:String(c?.symbol || ''),
        side:side || 'NONE',
        attackRank:finite(c?.attackRank),
        projectedRank:finite(c?.projectedRank),
        leaderState:String(c?.leaderState || ''),
        deepScanReason:String(c?.deepScanReason || ''),
        eligible:e.eligible && directionAllowed,
        reasons:[...new Set(reasons)],
        warnings:[...(e.warnings || [])],
        reasonsTr:[...new Set(reasons)].map(leaderReasonTr),
        warningsTr:[...(e.warnings || [])].map(leaderReasonTr),
        tradeQuality:e.tradeQuality,
        directionSupport:e.directionSupport,
        spreadBps:e.spreadBps,
        directionalExpansion:e.directionalExpansion,
        selected:false,
        stage:'PREFILTER',
        stageTr:LEADER_STAGE_TR.PREFILTER
      };
      row.explanationTr=leaderCandidateExplanationTr(row);
      return row;
    });
    leaderAutoLastDiagnostics = {
      universeCount:Number(scan?.universeCount || 0),
      shortlistCount:rows.length,
      eligibleCount:rows.filter(x => x.eligible).length,
      candidates:rows.slice(0,16)
    };
    return leaderAutoLastDiagnostics;
  }

  function annotateLeaderDiagnostic(symbol, stage, reasons = [], extra = {}) {
    const target = leaderAutoLastDiagnostics?.candidates?.find(x => x.symbol === String(symbol || '').toUpperCase());
    if (!target) return;
    target.selected = true;
    target.stage = String(stage || target.stage || '');
    target.stageTr = LEADER_STAGE_TR[target.stage] || target.stage;
    target.lastReasons = Array.isArray(reasons) ? reasons.slice(0,8) : [];
    target.lastReasonsTr = target.lastReasons.map(leaderReasonTr);
    Object.assign(target, extra || {});
    target.explanationTr=leaderCandidateExplanationTr(target);
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

    const rawCandidates = selectDeepCandidates(scan, 16);
    setLeaderAutoDiagnostics(scan, rawCandidates, allowLong, allowShort);

    const candidates = rawCandidates
      .filter(executionEligible)
      .filter(x => {
        const side = String(x?.side || '').toUpperCase();
        return (side === 'LONG' && allowLong) || (side === 'SHORT' && allowShort);
      });
    if (!candidates.length) {
      leaderAutoCandidateCursor = 0;
      // Even when there is no fresh execution candidate, keep one existing setup
      // alive with a fresh analysis-only 9TF/Vision pass.
      const trackedRefresh = await refreshOneTrackedAnalysis(scan);
      if (trackedRefresh) leaderAutoLastDiagnostics.trackedRefresh=trackedRefresh;
      return { ok:true, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_WAIT', reasons:['NO_ALLOWED_EXECUTION_ELIGIBLE_LEADER'], trackedRefresh };
    }
    const selectedIndex = leaderAutoCandidateCursor % candidates.length;
    const candidate = candidates[selectedIndex];
    leaderAutoCandidateCursor = (selectedIndex + 1) % candidates.length;

    // Follow one other existing setup every tick in analysis-only mode. Skip the
    // primary symbol so the same 9TF chart package is never sent twice in one tick.
    const trackedRefresh = await refreshOneTrackedAnalysis(scan, candidate.symbol);
    if (trackedRefresh) leaderAutoLastDiagnostics.trackedRefresh=trackedRefresh;
    const existingLifecycle=leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null;
    if (!existingLifecycle) upsertLeaderLifecycle(candidate,null,'DETECTED','FRESH_SCANNER_SELECTION');
    annotateLeaderDiagnostic(candidate.symbol, 'PIPELINE_SELECTED', [], { selectedIndex, lifecycle:existingLifecycle || leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null });

    let advisory;
    try {
      advisory = await pipeline.run({
        scan,
        store,
        committee,
        executionIntent:{ symbol:candidate.symbol }
      });
    } catch (e) {
      const rs=[String(e?.message || 'LEADER_PLAN_FAILED').slice(0,160)];
      annotateLeaderDiagnostic(candidate.symbol, 'PIPELINE_ERROR', rs);
      return {
        ok:false,
        orderPlaced:false,
        liveAllowed:false,
        retryable:true,
        execution:'LEADER_AUTO_BLOCKED',
        symbol:candidate.symbol,
        reasons:rs
      };
    }

    if (!advisory?.candidateFound || !advisory?.plan || !advisory?.unifiedContext) {
      const rs=[advisory?.reason || 'LEADER_PLAN_NOT_READY'];
      annotateLeaderDiagnostic(candidate.symbol, 'PLAN_NOT_READY', rs, visionDiagnosticExtras(advisory));
      const existingTrack=leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()];
      if (existingTrack) {
        existingTrack.lastAnalyzedAt=clock();
        existingTrack.lastDetail=String(rs[0] || 'PLAN_NOT_READY').slice(0,240);
        leaderAnalysisState.bySymbol[String(candidate.symbol || '').toUpperCase()]=existingTrack;
        writeLeaderAnalysisState();
      }
      return {
        ok:true,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LEADER_AUTO_WAIT',
        symbol:candidate.symbol,
        reasons:rs
      };
    }

    if (String(advisory.plan.status || '').toUpperCase() !== 'QUALIFIED') {
      const rs=[...new Set(['LEADER_PLAN_NOT_QUALIFIED', advisory.plan.reason].filter(Boolean))];
      annotateLeaderDiagnostic(candidate.symbol, 'PLAN_NOT_QUALIFIED', rs, visionDiagnosticExtras(advisory));
      const lifecycle=upsertLeaderLifecycle(candidate,advisory,null,'PLAN_'+String(advisory.plan.status || 'REVIEW_REQUIRED').toUpperCase());
      annotateLeaderDiagnostic(candidate.symbol, 'PLAN_NOT_QUALIFIED', rs, { ...visionDiagnosticExtras(advisory), lifecycle });
      return {
        ok:true,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LEADER_AUTO_WAIT',
        symbol:candidate.symbol,
        plan:advisory.plan,
        reasons:rs
      };
    }
    const qualifiedLifecycle=upsertLeaderLifecycle(candidate,advisory,'ARMED','PLAN_QUALIFIED');
    annotateLeaderDiagnostic(candidate.symbol, 'PLAN_QUALIFIED', [], { ...visionDiagnosticExtras(advisory), lifecycle:qualifiedLifecycle });

    const creds = currentCredentials();
    if (!credentialsReady(creds)) {
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:['BINANCE_CREDENTIALS_REQUIRED'] };
    }

    const scalpCostGate=['1m','3m','5m'].includes(String(advisory.plan.originTF || '').toLowerCase());
    let commissionRate=null;
    let commissionMeta=null;
    if (scalpCostGate) {
      commissionMeta=await takerCommissionRateFor(candidate.symbol,creds);
      if (!commissionMeta.ok) {
        const rs=[commissionMeta.reason || 'BINANCE_COMMISSION_RATE_UNAVAILABLE'];
        annotateLeaderDiagnostic(candidate.symbol,'INTENT_NOT_READY',rs,{ commission:commissionMeta });
        return {
          ok:true,
          orderPlaced:false,
          liveAllowed:false,
          retryable:true,
          execution:'LEADER_AUTO_WAIT',
          symbol:candidate.symbol,
          plan:advisory.plan,
          reasons:rs,
          commission:commissionMeta
        };
      }
      commissionRate=commissionMeta.rate;
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
      filters:exchangeFiltersFor(symbolInfo),
      takerCommissionRate:commissionRate
    });
    if (!intent.ok) {
      const rs=intent.reasons || ['LEADER_INTENT_NOT_READY'];
      annotateLeaderDiagnostic(candidate.symbol, 'INTENT_NOT_READY', rs, {
        costModel:intent.costModel || null,
        commission:commissionMeta
      });
      return {
        ok:true,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LEADER_AUTO_WAIT',
        symbol:candidate.symbol,
        plan:advisory.plan,
        intent,
        reasons:rs
      };
    }
    const enterableLifecycle=upsertLeaderLifecycle(candidate,advisory,'ENTERABLE','LIVE_INTENT_READY');
    annotateLeaderDiagnostic(candidate.symbol, 'INTENT_READY', [], {
      lifecycle:enterableLifecycle,
      costModel:intent.costModel || null,
      commission:commissionMeta
    });

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

    const executionLifecycle=result?.orderPlaced === true
      ? upsertLeaderLifecycle(candidate,advisory,'ACTIVE','LIVE_ORDER_PLACED')
      : upsertLeaderLifecycle(candidate,advisory,'ENTERABLE','LIVE_EXECUTION_NO_ORDER:'+String(result?.execution || ''));
    annotateLeaderDiagnostic(candidate.symbol, result?.orderPlaced === true ? 'ORDER_PLACED' : 'EXECUTION_RESULT', result?.reasons || [], {
      execution:String(result?.execution || ''),
      orderPlaced:result?.orderPlaced === true,
      lifecycle:executionLifecycle
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
          notionalQuote:intent.notionalQuote,
          costModel:intent.costModel || null
        },
        commission:commissionMeta,
        result
      });
    } catch {}

    return {
      ...result,
      leaderAuto:true,
      leaderCandidate:candidate,
      leaderPlan:advisory.plan,
      leaderIntent:intent,
      trackedRefresh,
      analysisLifecycle:leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null
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
