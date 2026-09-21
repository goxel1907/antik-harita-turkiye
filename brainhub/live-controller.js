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
const { buildDryRunOrder } = require('./binance-dry-run-executor');
const { preflightRiskGate, accountRiskCaps, structuralStopGate, killSwitchGate, executionClaimGate } = require('./risk-gate');
const { combineRiskGate:combineReadinessRiskGate, enforceExecutionLineage:enforceReadinessLineage, combineExecutionReadiness:combineReadiness } = require('./pipeline');
const positionManager = require('./position-manager');
const planWorkers = require('./plan-workers');

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
      requestedLeverage:null,
      requestedMaxOpenPositions:null,
      sizingAuthority:'PC_DEFAULT',
      adjustments:[],
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

  return {
    ok:reasons.length === 0,
    dynamic:true,
    marginQuote,
    leverage,
    maxOpenPositions,
    requestedLeverage:leverage,
    requestedMaxOpenPositions:maxOpenPositions,
    sizingAuthority:'USER_PANEL_EXACT',
    adjustments:[],
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
  if (familyExposureAfterQuote === null || familyExposureAfterQuote < 0) reasons.push('FAMILY_EXPOSURE_INVALID');
  if (Number.isFinite(expectedNotional) && expectedNotional > 0 && notionalQuote !== null && notionalQuote > expectedNotional * 1.02) {
    reasons.push('ORDER_NOTIONAL_EXCEEDS_REQUESTED_MARGIN_LEVERAGE');
  }
  if (equity === null || equity <= 0) reasons.push('ACCOUNT_EQUITY_INVALID');
  if (reasons.length) return { ok:false, accountRisk, reasons:[...new Set(reasons)] };

  // USER_PANEL_EXACT: panelde seçilen boyutlandırma yürütme otoritesidir.
  // Eski PC yüzde varsayımları seçilen boyutu küçültmez/veto etmez. Account risk
  // kapısı yine seçilenden daha büyük emir oluşmasını ve portföy/günlük limitleri denetler.
  const riskPct = equity > 0 && finite(accountRisk?.intent?.riskQuote)!==null
    ? (Math.max(0,finite(accountRisk.intent.riskQuote)) / equity) * 100
    : null;
  const notionalPct = equity > 0 && notionalQuote!==null
    ? (Math.max(0,notionalQuote) / equity) * 100
    : null;
  const requestedFamilyExposureQuote = Number.isFinite(expectedNotional) && expectedNotional > 0
    ? expectedNotional * settings.maxOpenPositions
    : null;
  const requestedFamilyExposurePct = equity > 0 && requestedFamilyExposureQuote!==null
    ? (requestedFamilyExposureQuote / equity) * 100
    : null;
  const effectiveLimits = {
    ...policy.limits,
    maxRiskPctPerTrade:riskPct===null
      ? policy.limits.maxRiskPctPerTrade
      : Math.max(Number(policy.limits.maxRiskPctPerTrade)||0,riskPct*1.001),
    maxNotionalPctPerTrade:notionalPct===null
      ? policy.limits.maxNotionalPctPerTrade
      : Math.max(Number(policy.limits.maxNotionalPctPerTrade)||0,notionalPct*1.001),
    // USER_PANEL_EXACT_TOTAL_EXPOSURE: derive the total family envelope from
    // the user's own margin × leverage × max-position contract instead of the
    // legacy PC percentage, so exact sizing cannot be silently made impossible.
    maxFamilyExposurePct:requestedFamilyExposurePct===null
      ? policy.limits.maxFamilyExposurePct
      : Math.max(Number(policy.limits.maxFamilyExposurePct)||0,requestedFamilyExposurePct*1.001),
    maxOpenPositions:settings.maxOpenPositions
  };
  return {
    ok:true,
    reasons:[],
    accountRisk:{ ...accountRisk, limits:effectiveLimits },
    sizing:{
      sizingAuthority:'USER_PANEL_EXACT',
      requestedMarginQuote:settings.marginQuote,
      appliedMarginQuote:settings.marginQuote,
      requestedLeverage:settings.leverage,
      appliedLeverage:settings.leverage,
      requestedMaxOpenPositions:settings.maxOpenPositions,
      appliedMaxOpenPositions:settings.maxOpenPositions,
      adjustments:[],
      expectedNotionalQuote:expectedNotional,
      requestedFamilyExposureQuote,
      requestedFamilyExposurePct,
      effectiveLimits
    }
  };
}

function createLiveController({ root, store, scanner, pipeline, committee, market = null, freeWorker = null, exitJudge = null, credentials = {}, fetchImpl = globalThis.fetch, clock = () => Date.now() } = {}) {
  if (!root || !store || !scanner || !pipeline || typeof committee !== 'function') throw new Error('live controller dependencies required');
  const registry = new LiveAuthorizationRegistry();
  const transport = new BinanceLiveTransport({ registry, fetchImpl, clock });
  const leaseToken = crypto.randomBytes(32).toString('base64url');
  let armState = { armed:false, armedAt:null, expiresAt:null };
  let armGeneration = 0;
  let executionBusy = false;
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
  const LEADER_AUTO_HEALTH_WINDOW_MS = 60 * 60 * 1000;
  const LEADER_AUTO_REANALYSIS_COOLDOWN_MS = 5 * 60 * 1000;
  const leaderAutoHealthStartedAt = Number.isFinite(clock()) ? clock() : Date.now();
  let leaderAutoHealthEvents = [];
  let planWorkerState = { lastReview:null, history:[] };

  function trimLeaderAutoHealth(now = clock()) {
    const ts = Number.isFinite(now) ? now : Date.now();
    const cutoff = ts - LEADER_AUTO_HEALTH_WINDOW_MS;
    leaderAutoHealthEvents = leaderAutoHealthEvents.filter(x => Number(x?.at || 0) >= cutoff).slice(-720);
    return ts;
  }

  function leaderHealthEvent(kind, data = {}) {
    const at = trimLeaderAutoHealth();
    leaderAutoHealthEvents.push({ at, kind:String(kind || 'EVENT'), ...(data || {}) });
    if (leaderAutoHealthEvents.length > 720) leaderAutoHealthEvents = leaderAutoHealthEvents.slice(-720);
  }

  function leaderAutoHealthSnapshot() {
    const now = trimLeaderAutoHealth();
    const ev = leaderAutoHealthEvents;
    const analyses = ev.filter(x => x.kind === 'ANALYSIS');
    const scans = ev.filter(x => x.kind === 'SCAN');
    const skips = ev.filter(x => x.kind === 'SKIP');
    const ticks = ev.filter(x => x.kind === 'TICK_RESULT');
    const executionStages = ev.filter(x => x.kind === 'EXECUTION_STAGE');
    const workerReviews = ev.filter(x => x.kind === 'WORKER_REVIEW');
    const durations = analyses.map(x => Number(x.durationMs)).filter(Number.isFinite);
    const reasonCounts = new Map();
    for (const x of [...analyses,...ticks]) {
      for (const r of Array.isArray(x.reasons) ? x.reasons : []) {
        const key=String(r || '').trim();
        if (key) reasonCounts.set(key,(reasonCounts.get(key)||0)+1);
      }
      const one=String(x.reason || '').trim();
      if (one) reasonCounts.set(one,(reasonCounts.get(one)||0)+1);
    }
    const topReasons=[...reasonCounts.entries()]
      .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
      .slice(0,6)
      .map(([reason,count])=>({reason,count}));
    const statusCount = status => analyses.filter(x => String(x.planStatus || '').toUpperCase() === status).length;
    const uniqueAnalyzedSymbols=[...new Set(analyses.map(x=>String(x.symbol||'')).filter(Boolean))];
    const latestScan=scans.at(-1) || null;
    const windowStart=Math.max(leaderAutoHealthStartedAt,now-LEADER_AUTO_HEALTH_WINDOW_MS);
    return {
      windowMinutes:60,
      observedMinutes:Math.max(0,Math.round((now-windowStart)/6000)/10),
      scanRuns:scans.length,
      tickResults:ticks.length,
      skippedBusy:skips.length,
      skippedPipelineBusy:skips.filter(x=>x.reason==='LEADER_AUTO_PIPELINE_BUSY').length,
      skippedExecutorBusy:skips.filter(x=>x.reason==='LEADER_AUTO_BUSY').length,
      skippedPositionReviewBusy:skips.filter(x=>x.reason==='LEADER_AUTO_BACKGROUND_BUSY').length,
      deepAnalyses:analyses.length,
      uniqueAnalyzedSymbols:uniqueAnalyzedSymbols.length,
      preJevQualified:analyses.filter(x=>String(x.preJevStatus||'').toUpperCase()==='QUALIFIED').length,
      jevCalled:analyses.filter(x=>x.jevCalled===true).length,
      jevVetoed:analyses.filter(x=>x.jevVeto===true).length,
      qualified:statusCount('QUALIFIED'),
      watch:statusCount('WATCH'),
      reviewRequired:statusCount('REVIEW_REQUIRED'),
      reject:statusCount('REJECT'),
      visionUnavailable:analyses.filter(x=>x.visionUnavailable===true).length,
      intentReady:executionStages.filter(x=>x.stage==='INTENT_READY').length,
      executionResults:executionStages.filter(x=>x.stage==='EXECUTION_RESULT').length,
      ordersPlaced:executionStages.filter(x=>x.stage==='ORDER_PLACED').length,
      workerReviews:workerReviews.length,
      workerWaits:workerReviews.filter(x=>x.state==='WAIT').length,
      workerTriggers:workerReviews.filter(x=>x.state==='TRIGGERED').length,
      workerRefreshes:workerReviews.filter(x=>x.state==='REFRESH_REQUIRED').length,
      fullVisionAvoided:workerReviews.filter(x=>x.visionAvoided===true).length,
      avgAnalysisMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null,
      lastAnalysisAt:analyses.length?new Date(analyses.at(-1).at).toISOString():null,
      lastQualifiedAt:(analyses.filter(x=>String(x.planStatus||'').toUpperCase()==='QUALIFIED').at(-1)?.at)
        ? new Date(analyses.filter(x=>String(x.planStatus||'').toUpperCase()==='QUALIFIED').at(-1).at).toISOString()
        : null,
      latestUniverseCount:latestScan?.universeCount ?? leaderAutoLastDiagnostics.universeCount ?? 0,
      latestLightweightUniverseCount:leaderAutoLastDiagnostics.lightweightUniverseCount ?? 0,
      latestShortlistCount:latestScan?.shortlistCount ?? leaderAutoLastDiagnostics.shortlistCount ?? 0,
      latestEligibleCount:latestScan?.eligibleCount ?? leaderAutoLastDiagnostics.eligibleCount ?? 0,
      topReasons
    };
  }

  function pickLeaderCandidate(candidates) {
    if (!Array.isArray(candidates) || !candidates.length) return {candidate:null,index:-1,reason:'NO_CANDIDATE'};
    const now=Number.isFinite(clock()) ? clock() : Date.now();
    // Coverage-first within the existing scanner priority order: a never-analyzed
    // or stale candidate is selected before repeating a recently analyzed one.
    // This avoids repeatedly spending 9TF Vision time on the same symbol while
    // keeping scanner ordering authoritative.
    let index=candidates.findIndex(c=>{
      const row=leaderAnalysisState.bySymbol?.[String(c?.symbol || '').toUpperCase()];
      const last=Math.max(Number(row?.lastAnalyzedAt || 0),Number(row?.lastWorkerCheckAt || 0));
      return !last || now-last >= LEADER_AUTO_REANALYSIS_COOLDOWN_MS;
    });
    let reason='COVERAGE_STALE_OR_NEW';
    if (index < 0) {
      index=leaderAutoCandidateCursor % candidates.length;
      reason='ROUND_ROBIN_RECENT_SET';
    }
    const candidate=candidates[index];
    leaderAutoCandidateCursor=(index+1)%candidates.length;
    return {candidate,index,reason};
  }
  let positionReviewBusy = false;
  let positionReviewCursor = 0;
  let positionManagerState = { lastReview:null, history:[], lastTickAt:null, lastError:null };
  const leaderAutoFile = path.join(root, 'config', 'leader-auto.json');
  const leaderAnalysisFile = path.join(root, 'data', 'leader-analysis-state.json');
  const LEADER_ANALYSIS_VERSION = 1;
  const LEADER_ANALYSIS_MAX_TRACKS = 24;
  const LEADER_ANALYSIS_RETENTION_MS = 24 * 60 * 60 * 1000;
  let lifecycleMigrationNeeded = false;
  let leaderAnalysisState = readLeaderAnalysisState();
  if (lifecycleMigrationNeeded) writeLeaderAnalysisState();

  function newLeaderSetupId(symbol, side) {
    return 'LHSET:'+symbol+':'+(side || 'NONE')+':'+clock().toString(36)+':'+crypto.randomBytes(6).toString('hex');
  }

  function lineageMismatch(row, symbol, side) {
    const parts=String(row?.setupId || '').split(':');
    return parts[0] !== 'LHSET' || parts[1] !== symbol || parts[2] !== side;
  }

  function emptyLeaderAnalysisState() {
    return { version:LEADER_ANALYSIS_VERSION, updatedAt:0, cursor:0, bySymbol:{} };
  }

  function readLeaderAnalysisState() {
    try {
      if (!fs.existsSync(leaderAnalysisFile)) return emptyLeaderAnalysisState();
      const raw=JSON.parse(fs.readFileSync(leaderAnalysisFile,'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLeaderAnalysisState();
      const bySymbol=raw.bySymbol && typeof raw.bySymbol === 'object' && !Array.isArray(raw.bySymbol) ? raw.bySymbol : {};
      for (const [symbol,row] of Object.entries(bySymbol)) {
        if (!row || row.state === 'ACTIVE' || !['LONG','SHORT'].includes(row.side) || !lineageMismatch(row,symbol,row.side)) continue;
        row.previousSetupId=row.setupId || null;
        row.setupId=newLeaderSetupId(symbol,row.side);
        row.state=row.state === 'INVALIDATED' ? 'INVALIDATED' : 'WATCH';
        row.planStatus='REVIEW_REQUIRED';
        row.planReason='LINEAGE_MIGRATION_REQUIRES_REANALYSIS';
        row.executionEligibleNow=false;
        row.eligibilityReason='LINEAGE_MIGRATION_REQUIRES_REANALYSIS';
        row.lineageSideChanged=true;
        lifecycleMigrationNeeded=true;
      }
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

  function markLeaderEligibility(symbol, eligible, detail = '') {
    const key=String(symbol || '').trim().toUpperCase();
    const row=leaderAnalysisState.bySymbol?.[key];
    if (!row || typeof row !== 'object') return null;
    row.executionEligibleNow=eligible === true;
    row.lastEligibilityCheckAt=clock();
    row.eligibilityReason=eligible === true ? null : String(detail || 'NOT_EXECUTION_ELIGIBLE_NOW').slice(0,160);
    leaderAnalysisState.bySymbol[key]=row;
    writeLeaderAnalysisState();
    return row;
  }

  function reconcileLeaderEligibility(rawCandidates, allowLong, allowShort) {
    const current=new Map();
    for (const c of Array.isArray(rawCandidates) ? rawCandidates : []) {
      const symbol=String(c?.symbol || '').trim().toUpperCase();
      if (symbol) current.set(symbol,c);
    }
    let changed=false;
    const now=clock();
    for (const [symbol,row] of Object.entries(leaderAnalysisState.bySymbol || {})) {
      if (!row || typeof row !== 'object') continue;
      const c=current.get(symbol);
      const e=c ? executionEligibility(c) : null;
      const side=String(c?.side || row?.side || '').toUpperCase();
      const directionAllowed=(side === 'LONG' && allowLong) || (side === 'SHORT' && allowShort);
      const eligibleNow=Boolean(c && e?.eligible === true && directionAllowed);
      if (!eligibleNow) {
        row.executionEligibleNow=false;
        row.lastEligibilityCheckAt=now;
        row.eligibilityReason=c
          ? (directionAllowed ? ((e?.reasons || [])[0] || 'NOT_EXECUTION_ELIGIBLE_NOW') : 'DIRECTION_DISABLED')
          : 'NOT_IN_CURRENT_DEEP_SHORTLIST';
        changed=true;
      } else {
        if (row.executionEligibleNow !== true || row.eligibilityReason) changed=true;
        row.executionEligibleNow=true;
        row.lastEligibilityCheckAt=now;
        row.eligibilityReason=null;
      }
      leaderAnalysisState.bySymbol[symbol]=row;
    }
    if (changed) writeLeaderAnalysisState();
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
    const oldSide=String(old?.side || '').toUpperCase();
    const plan=advisory?.plan || {};
    const planStatus=String(plan.status || '').toUpperCase();
    const requestedSide=String(plan.side || candidate?.side || old?.side || '').toUpperCase();
    const proposedSide=['LONG','SHORT'].includes(requestedSide) ? requestedSide : bestTrackedSide(advisory?.unifiedContext, old?.side);
    // ACTIVE tracks the exchange-authoritative position direction. Analysis must
    // never silently flip its lineage side. Non-active tracked ideas may change
    // direction, but that direction change must start a new setupId.
    const side=oldState === 'ACTIVE' && ['LONG','SHORT'].includes(oldSide) ? oldSide : proposedSide;
    const sideChanged=Boolean(old && ['LONG','SHORT'].includes(oldSide) && ['LONG','SHORT'].includes(side) && oldSide !== side);
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
      else if (planStatus === 'REVIEW_REQUIRED') {
        // A fresh fail-closed review must never leave an old ARMED/ENTERABLE badge visible.
        // ACTIVE remains exchange-authoritative and INVALIDATED is terminal until a real
        // opportunity rebase occurs.
        if (oldState === 'ACTIVE') nextState='ACTIVE';
        else if (oldState === 'INVALIDATED') nextState='INVALIDATED';
        else nextState='WATCH';
      } else if (!nextState) nextState=oldState || 'DETECTED';
    }

    if (oldState === 'ACTIVE') nextState='ACTIVE';
    let rebaseCount=Number(old?.rebaseCount || 0);
    let invalidationCount=Number(old?.invalidationCount || 0);
    if (nextState === 'INVALIDATED' && oldState !== 'INVALIDATED') invalidationCount += 1;
    if (nextState === 'REBASE' && oldState !== 'REBASE') rebaseCount += 1;
    const setupChanged=oldState !== 'ACTIVE' && (sideChanged || nextState === 'REBASE' || lineageMismatch(old,symbol,side));
    const setupId=setupChanged
      ? newLeaderSetupId(symbol,side)
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
      planReason:String(advisory ? (plan.reason || '') : (old?.planReason || '')),
      confidence:advisory ? finite(plan.confidence) : finite(old?.confidence),
      visionAttached:Number(advisory ? (advisory.vision?.attached ?? advisory.committee?.vision?.attached ?? 0) : (old?.visionAttached || 0)),
      visionRequired:Number(advisory?.vision?.required || old?.visionRequired || 9),
      executionEligibleNow:typeof old?.executionEligibleNow === 'boolean' ? old.executionEligibleNow : undefined,
      lastEligibilityCheckAt:Number(old?.lastEligibilityCheckAt || 0) || null,
      eligibilityReason:old?.eligibilityReason || null,
      stillOpportunity,
      reanalysisEligible:nextState !== 'ACTIVE' && (nextState !== 'INVALIDATED' || stillOpportunity),
      rebaseCount,
      invalidationCount,
      lineageSideChanged:sideChanged,
      previousSetupId:sideChanged && old?.setupId ? old.setupId : (old?.previousSetupId || null),
      lastDetail:detail ? String(detail).slice(0,240) : null
    };
    if (!leaderAnalysisState.bySymbol || typeof leaderAnalysisState.bySymbol !== 'object') leaderAnalysisState.bySymbol={};
    leaderAnalysisState.bySymbol[symbol]=row;
    writeLeaderAnalysisState();
    journalLeaderLifecycle(symbol,oldState,nextState,row,detail);
    return row;
  }

  function workerEligible(row) {
    if(!row||typeof row!=='object')return false;
    const state=String(row.state||'').toUpperCase();
    const planStatus=String(row.planStatus||'').toUpperCase();
    const wait=String(row.waitFor||'').trim().toUpperCase();
    return row.reanalysisEligible===true &&
      state!=='ACTIVE' &&
      ['WATCH','REBASE','DETECTED'].includes(state) &&
      planStatus==='WATCH' &&
      Boolean(wait)&&wait!=='NONE' &&
      ['LONG','SHORT'].includes(String(row.side||'').toUpperCase());
  }

  function activatePlanWorker(symbol, detail='VISION_WATCH_REGISTERED') {
    const key=String(symbol||'').trim().toUpperCase();
    const row=leaderAnalysisState.bySymbol?.[key];
    if(!workerEligible(row))return row||null;
    row.workerState='WAIT';
    row.workerPlanAt=clock();
    row.lastWorkerCheckAt=Number(row.lastWorkerCheckAt||0)||null;
    row.workerChecks=Number(row.workerChecks||0);
    row.workerVisionAvoided=Number(row.workerVisionAvoided||0);
    row.workerReason=detail;
    row.workerSource='9TF_VISION_PLAN';
    row.workerRecheckTFs=[...new Set([row.originTF,row.ownerTF].map(x=>String(x||'').toLowerCase()).filter(x=>planWorkers.FRAMES.includes(x)))];
    leaderAnalysisState.bySymbol[key]=row;
    writeLeaderAnalysisState();
    return row;
  }

  function finishPlanWorker(symbol, detail='FULL_9TF_COMPLETED') {
    const key=String(symbol||'').trim().toUpperCase();
    const row=leaderAnalysisState.bySymbol?.[key];
    if(!row)return null;
    row.workerState='DONE';
    row.workerReason=detail;
    row.workerSource='FULL_9TF';
    row.lastWorkerCheckAt=clock();
    leaderAnalysisState.bySymbol[key]=row;
    writeLeaderAnalysisState();
    return row;
  }

  async function workerUnifiedContext(candidate) {
    if(!market||typeof market.symbolContext!=='function'||typeof market.globalContext!=='function'||typeof pipeline?.buildUnifiedContext!=='function')return null;
    const symbol=String(candidate?.symbol||'').toUpperCase();
    if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol))return null;
    const [sym,global]=await Promise.all([market.symbolContext(symbol),market.globalContext()]);
    return pipeline.buildUnifiedContext({symbol:sym,global,candidate,now:clock()});
  }

  async function reviewTrackedPlan(candidate, scan) {
    const key=String(candidate?.symbol||'').trim().toUpperCase();
    const tracked=leaderAnalysisState.bySymbol?.[key];
    if(!workerEligible(tracked))return {handled:false,state:'NOT_ELIGIBLE'};
    let unified=null;
    try{unified=await workerUnifiedContext(candidate);}catch{}
    const deterministic=planWorkers.deterministicGuard({tracked,candidate,unified,now:clock()});
    let router=null,openRouter=null;

    if(deterministic.state==='REVIEW'){
      const prompt=planWorkers.buildWorkerPrompt({tracked,candidate,unified});
      try{
        const out=await committee({
          role:'FAST',
          system:'V107 PLAN WORKER. Text-only advisory watcher. Never QUALIFY, never place orders, never invent missing market facts. Return exactly the requested WORKER_* schema.',
          prompt
        });
        router=planWorkers.parseWorkerDecision(out?.text||out?.analysts?.[0]?.text||'');
        router.model=String(out?.model||'');
        router.mode=String(out?.mode||'');
      }catch(e){
        router={ok:false,state:'REFRESH_REQUIRED',reason:'WORKER_9ROUTER_UNAVAILABLE',detail:String(e?.message||e).slice(0,180),recheckTFs:[]};
      }

      // Routine WAIT checks stay on free 9Router. OpenRouter's free router is
      // summoned only when 9Router sees a trigger/refresh, reducing rate-limit load.
      if(router?.ok&&router.state==='TRIGGERED'&&freeWorker&&typeof freeWorker.review==='function'){
        try{
          const out=await freeWorker.review({
            system:'You are a free second-opinion plan watcher. You cannot qualify or place an order. Return only WORKER_STATE, CONFIDENCE, REASON, RECHECK_TFS.',
            prompt
          });
          if(out?.ok){
            openRouter=planWorkers.parseWorkerDecision(out.text);
            openRouter.model=String(out.model||'openrouter/free');
          }else{
            openRouter={ok:false,state:'REFRESH_REQUIRED',reason:String(out?.reason||'OPENROUTER_FREE_WORKER_UNAVAILABLE'),recheckTFs:[]};
          }
        }catch(e){
          openRouter={ok:false,state:'REFRESH_REQUIRED',reason:'OPENROUTER_FREE_WORKER_UNAVAILABLE',detail:String(e?.message||e).slice(0,180),recheckTFs:[]};
        }
      }
    }

    const decision=planWorkers.combineWorkerReviews({deterministic,router,openRouter});
    const now=clock();
    tracked.lastWorkerCheckAt=now;
    tracked.workerChecks=Number(tracked.workerChecks||0)+1;
    tracked.workerState=decision.state;
    tracked.workerReason=String(decision.reason||'').slice(0,360);
    tracked.workerSource=decision.source||null;
    tracked.workerConfidence=finite(decision.confidence);
    tracked.workerRecheckTFs=Array.isArray(decision.recheckTFs)?decision.recheckTFs.slice(0,9):[];
    tracked.workerRouterModel=router?.model||null;
    tracked.workerOpenRouterModel=openRouter?.model||null;
    if(decision.state==='WAIT')tracked.workerVisionAvoided=Number(tracked.workerVisionAvoided||0)+1;
    leaderAnalysisState.bySymbol[key]=tracked;
    writeLeaderAnalysisState();

    const review={
      symbol:key,
      side:tracked.side,
      checkedAt:new Date(now).toISOString(),
      state:decision.state,
      source:decision.source||null,
      reason:tracked.workerReason,
      confidence:tracked.workerConfidence,
      recheckTFs:tracked.workerRecheckTFs,
      router:{ok:router?.ok===true,model:router?.model||null,state:router?.state||null},
      openRouter:{called:Boolean(openRouter),ok:openRouter?.ok===true,model:openRouter?.model||null,state:openRouter?.state||null},
      full9TfRequired:decision.state!=='WAIT',
      visionAvoided:decision.state==='WAIT',
      execution:'ADVISORY_ONLY',
      orderPlaced:false
    };
    planWorkerState.lastReview=review;
    planWorkerState.history=[review,...planWorkerState.history].slice(0,12);
    leaderHealthEvent('WORKER_REVIEW',{
      symbol:key,state:decision.state,source:decision.source||null,
      visionAvoided:decision.state==='WAIT',reason:tracked.workerReason
    });
    try{store.journal('PLAN_WORKER_REVIEW',key,review);}catch{}
    return {handled:true,...review,unified};
  }

  function leaderLifecycleSummary() {
    const rawRows=Object.values(leaderAnalysisState.bySymbol || {})
      .filter(x => x && typeof x === 'object')
      .sort((a,b) => Number(b.lastAnalyzedAt || 0)-Number(a.lastAnalyzedAt || 0))
      .slice(0,LEADER_ANALYSIS_MAX_TRACKS);
    const rows=rawRows.map(row => {
      const state=String(row.state || '').toUpperCase();
      const planStatus=String(row.planStatus || '').toUpperCase();
      if (['ARMED','ENTERABLE'].includes(state) &&
          (row.executionEligibleNow === false || planStatus !== 'QUALIFIED')) {
        return {
          ...row,
          persistedState:row.state,
          persistedPlanStatus:row.planStatus,
          state:'WATCH',
          planStatus:'REVIEW_REQUIRED',
          statusReason:row.eligibilityReason || row.planReason || 'PLAN_NOT_CURRENTLY_QUALIFIED'
        };
      }
      return { ...row };
    });
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
      .sort((a,b) =>
        Math.max(Number(a.lastAnalyzedAt || 0),Number(a.lastWorkerCheckAt || 0)) -
        Math.max(Number(b.lastAnalyzedAt || 0),Number(b.lastWorkerCheckAt || 0)));
    if (!rows.length) return null;
    const idx=leaderAnalysisState.cursor % rows.length;
    const tracked=rows[idx];
    leaderAnalysisState.cursor=(idx+1)%rows.length;
    writeLeaderAnalysisState();
    try {
      if(workerEligible(tracked)){
        const worker=await reviewTrackedPlan({symbol:tracked.symbol,side:tracked.side},scan);
        if(worker?.handled&&worker.state==='WAIT'){
          return {ok:true,symbol:tracked.symbol,worker:true,state:tracked.state,planStatus:tracked.planStatus,workerState:'WAIT',visionAvoided:true};
        }
      }
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

  async function exchangeOpenPositions() {
    const creds=currentCredentials();
    if(!credentialsReady(creds))return {ok:false,positions:[],reason:'BINANCE_CREDENTIALS_REQUIRED'};
    try{
      await transport._syncServerTime();
      const account=await transport._fetchJson('GET','/fapi/v3/account',{credentials:creds,signed:true});
      const rows=Array.isArray(account?.positions)?account.positions:[];
      const positions=rows.map(x=>{
        const amt=finite(x?.positionAmt);
        if(amt===null||Math.abs(amt)<=0)return null;
        return {
          symbol:String(x?.symbol||'').toUpperCase(),
          side:amt>0?'LONG':'SHORT',
          quantity:Math.abs(amt),
          signedQuantity:amt,
          entryPrice:finite(x?.entryPrice),
          markPrice:finite(x?.markPrice),
          unrealizedPnl:finite(x?.unrealizedProfit)??0,
          leverage:finite(x?.leverage),
          notional:finite(x?.notional),
          liquidationPrice:finite(x?.liquidationPrice)
        };
      }).filter(x=>x&&/^[A-Z0-9]{1,28}USDT$/.test(x.symbol));
      return {ok:true,positions};
    }catch(e){
      return {ok:false,positions:[],reason:'BINANCE_ACTIVE_POSITIONS_UNAVAILABLE',detail:String(e?.message||e).slice(0,180)};
    }
  }

  async function finalizeClosedActiveRows(openPositions) {
    const openSet=new Set((openPositions||[]).map(x=>x.symbol));
    const creds=currentCredentials();
    if(!credentialsReady(creds))return;
    for(const [symbol,row] of Object.entries(leaderAnalysisState.bySymbol||{})){
      if(!row||String(row.state||'').toUpperCase()!=='ACTIVE'||openSet.has(symbol))continue;
      let realizedPnl=null;
      try{
        await transport._syncServerTime();
        const income=await transport._fetchJson('GET','/fapi/v1/income',{
          params:{symbol,incomeType:'REALIZED_PNL',startTime:Math.max(0,Number(row.lastStateChangeAt||row.detectedAt||0)),limit:1000},
          credentials:creds,signed:true
        });
        if(Array.isArray(income)&&income.length<1000)realizedPnl=income.reduce((sum,x)=>sum+(finite(x?.income)||0),0);
      }catch{}
      const entry=finite(row.entryPrice),qty=finite(row.quantity);
      const base=entry!==null&&qty!==null?Math.abs(entry*qty):null;
      const outcomePct=realizedPnl!==null&&base&&base>0?realizedPnl/base*100:null;
      const prev=row.state;
      row.state='CLOSED';
      row.reanalysisEligible=false;
      row.executionEligibleNow=false;
      row.closedAt=clock();
      row.realizedPnl=realizedPnl;
      row.outcomePct=outcomePct;
      row.lastDetail='BINANCE_POSITION_CLOSED';
      leaderAnalysisState.bySymbol[symbol]=row;
      writeLeaderAnalysisState();
      journalLeaderLifecycle(symbol,prev,'CLOSED',row,'BINANCE_POSITION_CLOSED');
      try{store.journal('POSITION_CLOSED',symbol,{side:row.side,setup:row.setup,originTF:row.originTF,ownerTF:row.ownerTF,entryPrice:row.entryPrice,quantity:row.quantity,realizedPnl,outcomePct});}catch{}
      try{store.recordLearning?.('POSITION_CLOSED',symbol,{side:row.side,setup:row.setup,originTF:row.originTF,ownerTF:row.ownerTF,decision:'CLOSED',outcomePct,realizedPnl});}catch{}
    }
  }

  function positionManagerStatus() {
    return {
      ok:true,
      busy:positionReviewBusy,
      cadenceMinutes:5,
      execution:'ADVISORY_ONLY',
      ruleTr:'1m/3m/5m tek başına çıkış kararı vermez; owner zaman dilimi ve büyük resim doğrulaması gerekir.',
      lastTickAt:positionManagerState.lastTickAt,
      lastError:positionManagerState.lastError,
      lastReview:positionManagerState.lastReview,
      history:positionManagerState.history.slice(0,6)
    };
  }

  async function activePositionReviewTick() {
    if(positionReviewBusy||leaderAutoBusy||executionBusy)return {ok:true,skipped:true,reason:positionReviewBusy?'POSITION_REVIEW_BUSY':'VISION_PIPELINE_BUSY'};
    if(typeof pipeline?.isBusy==='function'&&pipeline.isBusy())return {ok:true,skipped:true,reason:'VISION_PIPELINE_BUSY'};
    positionReviewBusy=true;
    positionManagerState.lastTickAt=new Date(clock()).toISOString();
    positionManagerState.lastError=null;
    try{
      const open=await exchangeOpenPositions();
      if(!open.ok){
        positionManagerState.lastError=open.reason;
        return {ok:false,skipped:true,reason:open.reason};
      }
      await finalizeClosedActiveRows(open.positions);
      if(!open.positions.length){
        positionManagerState.lastReview={action:'HOLD',actionTr:'AÇIK POZİSYON YOK',checkedAt:new Date(clock()).toISOString()};
        return {ok:true,skipped:true,reason:'NO_OPEN_POSITION'};
      }
      const position=open.positions[positionReviewCursor%open.positions.length];
      positionReviewCursor=(positionReviewCursor+1)%Math.max(1,open.positions.length);
      let scan;
      try{scan=await scanner.scan();}catch(e){throw new Error('SCANNER_UNAVAILABLE');}
      const existing=leaderAnalysisState.bySymbol?.[position.symbol]||{};
      const advisory=await pipeline.run({
        scan,store,committee,
        executionIntent:{symbol:position.symbol,side:position.side,analysisTracking:true,positionReviewOnly:true}
      });
      const lifecycle={
        ...existing,
        side:position.side,
        originTF:existing.originTF||advisory?.plan?.originTF||null,
        ownerTF:existing.ownerTF||advisory?.plan?.ownerTF||null,
        setup:existing.setup||advisory?.plan?.setup||null
      };
      const assessment=positionManager.assessPosition({position,lifecycle,unified:advisory?.unifiedContext||{}});
      let jevExit={ok:false,called:false,action:'HOLD_REVIEW',actionTr:'TUT • VERİYİ YENİDEN KONTROL ET',summaryTr:'Jev pozisyon hakemi kullanılamadı.'};
      if(typeof exitJudge==='function'&&advisory?.unifiedContext){
        try{jevExit=await exitJudge({position,lifecycle,currentPlan:advisory.plan,unified:advisory.unifiedContext});}
        catch(e){jevExit={ok:false,called:true,action:'HOLD_REVIEW',actionTr:'TUT • VERİYİ YENİDEN KONTROL ET',summaryTr:'Jev pozisyon hakemi hata verdi; agresif çıkış kararı uygulanmadı.',reason:'JEV_EXIT_EXCEPTION'};}
      }
      const requestedAction=String(jevExit?.action||'HOLD_REVIEW');
      const action=positionManager.capJevExitAction(requestedAction,assessment);
      const actionTr=positionManager.actionTurkish(action);
      let reasonTr='Büyük resim ve owner yapı korunuyor; pozisyon izleniyor.';
      if(assessment.lowTfNoiseOnly)reasonTr='1m/3m/5m tersliği büyük resim tarafından doğrulanmadı; gürültü/erken uyarı olarak izlendi.';
      if(action==='PROTECT_PROFIT')reasonTr='Pozisyon kârda; düşük/orta zaman dilimi zayıflığı nedeniyle kârı koruma adayı, fakat yapısal çıkış teyidi yok.';
      if(action==='PARTIAL_TAKE_PROFIT')reasonTr='Açık kâr risk altında ve owner/büyük resimde ek zayıflık var; kısmi kâr alma değerlendirmesi.';
      if(action==='EXIT_NOW')reasonTr='Owner zaman dilimi ile büyük resimde yapısal bozulma birlikte doğrulandı; çıkış değerlendirmesi.';
      if(action==='HOLD_REVIEW')reasonTr='Veri/kanıt yeterli değil; agresif çıkış uygulanmadı, yeniden analiz bekleniyor.';
      const review={
        symbol:position.symbol,side:position.side,checkedAt:new Date(clock()).toISOString(),
        entryPrice:position.entryPrice,markPrice:position.markPrice,unrealizedPnl:position.unrealizedPnl,
        pnlPct:assessment.pnlPct,originTF:lifecycle.originTF,ownerTF:lifecycle.ownerTF,
        action,actionTr,reasonTr,requestedJevAction:requestedAction,
        jevSummaryTr:String(jevExit?.summaryTr||'').slice(0,360),
        assessment,jev:{called:jevExit?.called===true,ok:jevExit?.ok===true,model:jevExit?.model||null,probabilities:jevExit?.probabilities||null},
        execution:'ADVISORY_ONLY',orderPlaced:false
      };
      positionManagerState.lastReview=review;
      positionManagerState.history=[review,...positionManagerState.history].slice(0,20);
      if(existing&&String(existing.state||'').toUpperCase()==='ACTIVE'){
        existing.lastPositionReview=review;
        existing.entryPrice=existing.entryPrice??position.entryPrice;
        existing.quantity=existing.quantity??position.quantity;
        leaderAnalysisState.bySymbol[position.symbol]=existing;
        writeLeaderAnalysisState();
      }
      try{store.journal('POSITION_REVIEW',position.symbol,review);}catch{}
      try{store.recordLearning?.('POSITION_REVIEW',position.symbol,{side:position.side,setup:lifecycle.setup,originTF:lifecycle.originTF,ownerTF:lifecycle.ownerTF,decision:action,confidence:advisory?.plan?.confidence,review});}catch{}
      return {ok:true,...review};
    }catch(e){
      const reason=String(e?.message||e).slice(0,180);
      positionManagerState.lastError=reason;
      return {ok:false,skipped:false,reason};
    }finally{positionReviewBusy=false;}
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
        intervalSec:30
      },
      reasons:[...new Set(reasons)]
    };
  }

  function readLeaderAutoConfig() {
    let raw = {};
    try {
      if (fs.existsSync(leaderAutoFile)) raw = JSON.parse(fs.readFileSync(leaderAutoFile, 'utf8'));
    } catch {
      return { ok:false, config:{ enabled:false, marginQuote:null, leverage:null, maxOpenPositions:null, allowLong:false, allowShort:false, intervalSec:30 }, reasons:['LEADER_AUTO_CONFIG_INVALID'] };
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
    const policy=readPolicy(root);
    const effective=(cfg.ok&&policy.ok&&c.marginQuote&&c.leverage&&c.maxOpenPositions)
      ? requestedExecutionSettings({
          requestedMarginQuote:c.marginQuote,
          requestedLeverage:c.leverage,
          requestedMaxOpenPositions:c.maxOpenPositions
        },policy)
      : null;
    const lastExecutionRaw=String(lastLeaderAutoResult?.execution || '');
    // LEADER_STATUS_STALE_SUPPRESSION: Android may re-enable Leader AUTO immediately
    // after a PC restart. Do not present the pre-sync DISABLED tick as the current state.
    const suppressStaleDisabled=c.enabled === true && lastExecutionRaw === 'LEADER_AUTO_DISABLED';
    return {
      ok:cfg.ok,
      configured:Boolean(c.marginQuote && c.leverage && c.maxOpenPositions),
      enabled:c.enabled === true,
      marginQuote:c.marginQuote,
      leverage:c.leverage,
      maxOpenPositions:c.maxOpenPositions,
      effectiveLeverage:effective?.leverage ?? c.leverage ?? null,
      effectiveMaxOpenPositions:effective?.maxOpenPositions ?? c.maxOpenPositions ?? null,
      sizingAuthority:effective?.sizingAuthority || 'USER_PANEL_EXACT',
      sizingAdjustments:[],
      allowLong:c.allowLong === true,
      allowShort:c.allowShort === true,
      intervalSec:30,
      busy:leaderAutoBusy,
      lastExecution:suppressStaleDisabled ? null : (lastExecutionRaw || null),
      lastSymbol:lastLeaderAutoResult?.symbol || lastLeaderAutoResult?.leaderIntent?.symbol || null,
      lastOrderPlaced:lastLeaderAutoResult?.orderPlaced === true,
      lastReasons:suppressStaleDisabled ? [] : (Array.isArray(lastLeaderAutoResult?.reasons) ? lastLeaderAutoResult.reasons.slice(0,8) : []),
      lastTickAt:suppressStaleDisabled ? null : leaderAutoLastTickAt,
      lastHealthyAt:leaderAutoLastHealthyAt,
      consecutiveBlocked:suppressStaleDisabled ? 0 : leaderAutoConsecutiveBlocked,
      candidateCursor:leaderAutoCandidateCursor,
      diagnostics:leaderAutoLastDiagnostics,
      analysisLifecycle:leaderLifecycleSummary(),
      health:leaderAutoHealthSnapshot(),
      planWorkers:{
        enabled:Boolean(market&&typeof pipeline?.buildUnifiedContext==='function'),
        routineRouter:'9ROUTER_FREE_TEXT',
        secondOpinion:freeWorker&&typeof freeWorker.status==='function'?freeWorker.status():{configured:false,model:'openrouter/free',freeOnly:true},
        lastReview:planWorkerState.lastReview,
        history:planWorkerState.history.slice(0,6)
      },
      reasons:cfg.reasons || []
    };
  }

  function recordLeaderAutoResult(result) {
    const nowIso = new Date(clock()).toISOString();
    leaderAutoLastTickAt = nowIso;
    lastLeaderAutoResult = result;
    leaderHealthEvent('TICK_RESULT',{
      execution:String(result?.execution || ''),
      symbol:String(result?.symbol || result?.leaderIntent?.symbol || ''),
      orderPlaced:result?.orderPlaced === true,
      reasons:Array.isArray(result?.reasons)?result.reasons.slice(0,8):[]
    });
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
    if (leaderAutoBusy) { leaderHealthEvent('SKIP',{reason:'LEADER_AUTO_BUSY'}); return { ok:true, skipped:true, execution:'LEADER_AUTO_BUSY', orderPlaced:false }; }
    if (positionReviewBusy) { leaderHealthEvent('SKIP',{reason:'LEADER_AUTO_BACKGROUND_BUSY'}); return { ok:true, skipped:true, execution:'LEADER_AUTO_BACKGROUND_BUSY', orderPlaced:false }; }
    if (typeof pipeline?.isBusy==='function' && pipeline.isBusy()) { leaderHealthEvent('SKIP',{reason:'LEADER_AUTO_PIPELINE_BUSY'}); return { ok:true, skipped:true, execution:'LEADER_AUTO_PIPELINE_BUSY', orderPlaced:false }; }
    const cfg = readLeaderAutoConfig();
    if (!cfg.ok) return recordLeaderAutoResult({ ok:false, skipped:true, execution:'LEADER_AUTO_CONFIG_INVALID', orderPlaced:false, reasons:cfg.reasons });
    if (!cfg.config.enabled) return recordLeaderAutoResult({ ok:true, skipped:true, execution:'LEADER_AUTO_DISABLED', orderPlaced:false });
    const analysisOnly = !armedNow();
    leaderAutoBusy = true;
    try {
      const result = await executeLeader({
        requestedMarginQuote:cfg.config.marginQuote,
        requestedLeverage:cfg.config.leverage,
        requestedMaxOpenPositions:cfg.config.maxOpenPositions,
        allowLong:cfg.config.allowLong,
        allowShort:cfg.config.allowShort,
        analysisOnly
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
      leaderAuto:leaderAutoStatus(),
      positionManager:positionManagerStatus(),
      learning:typeof store?.learningContext==='function'?store.learningContext({}):null
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

  async function liveReadiness({ symbol = '' } = {}) {
    const policy = readPolicy(root);
    const creds = currentCredentials();
    const armed = armedNow();
    const base = {
      ok:false,
      readyForUserArm:false,
      armed,
      liveAllowed:false,
      orderPlaced:false,
      orderRequestSent:false,
      execution:'LIVE_READINESS_CHECK',
      reasons:[]
    };

    // Readiness is intentionally evaluated only while disarmed. This endpoint
    // never arms LIVE, never acquires the live lease/claim and never submits an order.
    if (armed) return { ...base, reasons:['READINESS_REQUIRES_LIVE_DISARMED'] };
    if (!policy.ok) return { ...base, reasons:policy.reasons || ['LIVE_POLICY_REQUIRED'], policy:publicPolicy(policy) };
    if (!credentialsReady(creds)) return { ...base, reasons:['BINANCE_CREDENTIALS_REQUIRED'], policy:publicPolicy(policy) };

    const cfg = readLeaderAutoConfig();
    if (!cfg.ok) return { ...base, reasons:cfg.reasons || ['LEADER_AUTO_CONFIG_INVALID'], policy:publicPolicy(policy) };
    if (!cfg.config.enabled) return { ...base, reasons:['LEADER_AUTO_DISABLED'], policy:publicPolicy(policy) };

    const settings = requestedExecutionSettings({
      requestedMarginQuote:cfg.config.marginQuote,
      requestedLeverage:cfg.config.leverage,
      requestedMaxOpenPositions:cfg.config.maxOpenPositions
    }, policy);
    if (!settings.ok || !settings.dynamic) {
      return { ...base, reasons:settings.reasons?.length ? settings.reasons : ['LEADER_AUTO_DYNAMIC_SETTINGS_REQUIRED'], policy:publicPolicy(policy) };
    }

    let scan;
    try { scan = await scanner.scan(); }
    catch {
      return { ...base, reasons:['SCANNER_UNAVAILABLE'], policy:publicPolicy(policy) };
    }

    const rawCandidates = selectDeepCandidates(scan,16);
    const candidates = rawCandidates
      .filter(executionEligible)
      .filter(x => {
        const side=String(x?.side || '').toUpperCase();
        return (side === 'LONG' && cfg.config.allowLong) || (side === 'SHORT' && cfg.config.allowShort);
      });
    if (!candidates.length) {
      return {
        ...base,
        reasons:['NO_ALLOWED_EXECUTION_ELIGIBLE_LEADER'],
        policy:publicPolicy(policy),
        universeCount:Number(scan?.targetUniverseCount || scan?.universeCount || 0),
          lightweightUniverseCount:Number(scan?.lightweightUniverseCount || scan?.universeCount || 0),
        shortlistCount:rawCandidates.length
      };
    }

    const requestedSymbol=String(symbol || '').trim().toUpperCase();
    if (requestedSymbol && !/^[A-Z0-9]{1,28}USDT$/.test(requestedSymbol)) {
      return { ...base, reasons:['READINESS_SYMBOL_INVALID'], requestedSymbol, policy:publicPolicy(policy) };
    }

    let candidate=null;
    if (requestedSymbol) {
      candidate=candidates.find(x=>String(x?.symbol || '').toUpperCase()===requestedSymbol) || null;
      if (!candidate) {
        markLeaderEligibility(requestedSymbol,false,'READINESS_SYMBOL_NOT_EXECUTION_ELIGIBLE');
        return {
          ...base,
          symbol:requestedSymbol,
          requestedSymbol,
          planStatus:'REVIEW_REQUIRED',
          reasons:['READINESS_SYMBOL_NOT_EXECUTION_ELIGIBLE'],
          policy:publicPolicy(policy),
          universeCount:Number(scan?.targetUniverseCount || scan?.universeCount || 0),
          lightweightUniverseCount:Number(scan?.lightweightUniverseCount || scan?.universeCount || 0),
          shortlistCount:rawCandidates.length
        };
      }
    } else {
      // Prefer a currently tracked plan that has already reached ARMED/ENTERABLE,
      // but always re-run fresh 9TF analysis before declaring readiness.
      candidate=candidates.find(x=>{
        const row=leaderAnalysisState.bySymbol?.[String(x?.symbol || '').toUpperCase()];
        return row && ['ARMED','ENTERABLE'].includes(String(row.state || '').toUpperCase()) &&
          String(row.planStatus || '').toUpperCase()==='QUALIFIED';
      }) || candidates[0];
    }
    let advisory;
    try {
      advisory=await pipeline.run({
        scan,
        store,
        committee,
        executionIntent:{ symbol:candidate.symbol, side:candidate.side, analysisTracking:true }
      });
    } catch (e) {
      return { ...base, symbol:candidate.symbol, reasons:[String(e?.message || 'LEADER_PLAN_FAILED').slice(0,160)], policy:publicPolicy(policy) };
    }

    const plan=advisory?.plan || null;
    if (!advisory?.candidateFound || !plan || !advisory?.unifiedContext) {
      markLeaderEligibility(candidate.symbol,false,advisory?.reason || 'LEADER_PLAN_NOT_READY');
      return { ...base, symbol:candidate.symbol, reasons:[advisory?.reason || 'LEADER_PLAN_NOT_READY'], policy:publicPolicy(policy) };
    }
    markLeaderEligibility(candidate.symbol,true,'FRESH_READINESS_ANALYSIS');
    const readinessStatus=String(plan.status || 'REVIEW_REQUIRED').toUpperCase();
    const readinessDetail='READINESS_'+readinessStatus+(plan.reason?':'+String(plan.reason).slice(0,120):'');
    upsertLeaderLifecycle(candidate,advisory,readinessStatus==='QUALIFIED'?'ARMED':null,readinessDetail);
    if (plan.valid !== true || String(plan.status || '').toUpperCase() !== 'QUALIFIED') {
      return {
        ...base,
        symbol:candidate.symbol,
        planStatus:String(plan.status || 'REVIEW_REQUIRED'),
        reasons:[...new Set(['LEADER_PLAN_NOT_QUALIFIED', plan.reason].filter(Boolean))],
        vision:{ attached:Number(advisory?.vision?.attached || 0), required:Number(advisory?.vision?.required || 9) },
        policy:publicPolicy(policy)
      };
    }
    if (Number(advisory?.vision?.attached || 0) < 9) {
      return { ...base, symbol:candidate.symbol, planStatus:'QUALIFIED', reasons:['VISION_9TF_INCOMPLETE'], policy:publicPolicy(policy) };
    }

    let commissionRate=null;
    let commissionMeta=null;
    if (['1m','3m','5m'].includes(String(plan.originTF || '').toLowerCase())) {
      commissionMeta=await takerCommissionRateFor(candidate.symbol,creds);
      if (!commissionMeta.ok) {
        return { ...base, symbol:candidate.symbol, planStatus:'QUALIFIED', reasons:[commissionMeta.reason || 'BINANCE_COMMISSION_RATE_UNAVAILABLE'], commission:commissionMeta, policy:publicPolicy(policy) };
      }
      commissionRate=commissionMeta.rate;
    }

    let exchangeInfo;
    let symbolInfo;
    let positionMode;
    try {
      await transport._syncServerTime();
      exchangeInfo=await transport._fetchJson('GET','/fapi/v1/exchangeInfo');
      symbolInfo=Array.isArray(exchangeInfo?.symbols)
        ? exchangeInfo.symbols.find(x=>String(x?.symbol || '').toUpperCase()===String(candidate.symbol).toUpperCase())
        : null;
      positionMode=await transport._fetchJson('GET','/fapi/v1/positionSide/dual',{ credentials:creds, signed:true });
    } catch (e) {
      return {
        ...base,
        symbol:candidate.symbol,
        planStatus:'QUALIFIED',
        reasons:['BINANCE_READONLY_PREFLIGHT_FAILED',String(e?.message || e).slice(0,160)],
        exchangeError:e?.body || null,
        policy:publicPolicy(policy)
      };
    }
    if (!symbolInfo) {
      return { ...base, symbol:candidate.symbol, planStatus:'QUALIFIED', reasons:['BINANCE_SYMBOL_FILTERS_UNAVAILABLE'], policy:publicPolicy(policy) };
    }

    const intent=buildLeaderLiveIntent({
      candidate,
      unified:advisory.unifiedContext,
      plan,
      marginQuote:settings.marginQuote,
      leverage:settings.leverage,
      filters:exchangeFiltersFor(symbolInfo),
      takerCommissionRate:commissionRate
    });
    if (!intent.ok) {
      return {
        ...base,
        symbol:candidate.symbol,
        planStatus:'QUALIFIED',
        reasons:intent.reasons || ['LEADER_INTENT_NOT_READY'],
        intent,
        policy:publicPolicy(policy)
      };
    }

    const now=clock();
    const bucket=Math.floor(now/60000);
    const lineageId=`READINESS:${intent.symbol}:${intent.side}:${bucket.toString(36)}`;
    const clientOrderId=`RD${intent.symbol.slice(0,8)}${intent.side[0]}${bucket.toString(36)}`.slice(0,36);
    const order={
      action:'OPEN',
      symbol:intent.symbol,
      side:intent.side,
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

    let accountRisk;
    try { accountRisk=await accountRiskFor(order,policy,creds); }
    catch (e) {
      return {
        ...base,
        symbol:candidate.symbol,
        planStatus:'QUALIFIED',
        order,
        reasons:['BINANCE_ACCOUNT_PREFLIGHT_FAILED',String(e?.message || e).slice(0,160)],
        exchangeError:e?.body || null,
        policy:publicPolicy(policy)
      };
    }

    const sizing=applyDynamicSizingGuards(accountRisk,settings,policy);
    if (!sizing.ok) {
      return { ...base, symbol:candidate.symbol, planStatus:'QUALIFIED', order, reasons:sizing.reasons || ['DYNAMIC_SIZING_GUARD_FAILED'], sizing:sizing.sizing || null, policy:publicPolicy(policy) };
    }
    accountRisk=sizing.accountRisk;

    const preflight=preflightRiskGate({ plan, unified:advisory.unifiedContext });
    const accountCaps=accountRiskCaps(accountRisk);
    const stopGate=structuralStopGate({
      side:intent.side,
      entryPrice:intent.entryPrice,
      stopPrice:intent.stopPrice,
      structuralInvalidationPrice:intent.structuralInvalidationPrice,
      bufferQuote:intent.buffer,
      initialStopPrice:intent.stopPrice
    });

    // The real lease/claim and kill switch are runtime controls after explicit arm.
    // For readiness we validate the same gate geometry with a synthetic non-persistent
    // claim. No store claim/lease is acquired here.
    const killGate=killSwitchGate({ control:{ available:true, tripped:false, dryRunEnabled:true } });
    const claimGate=executionClaimGate({ claim:{ claimed:true, lineageId } });
    let riskGate=combineReadinessRiskGate(preflight,accountCaps,stopGate,killGate,claimGate);
    riskGate=enforceReadinessLineage(riskGate,claimGate,order);

    const dryRun=buildDryRunOrder({
      intent:{ ...order, mode:'DRY_RUN', live:false },
      riskGate
    });
    const executionReadiness=combineReadiness(riskGate,dryRun);

    let livePrice=null;
    let transportRuleReasons=[];
    try {
      const ticker=await transport._fetchJson('GET','/fapi/v1/ticker/price',{ params:{ symbol:order.symbol } });
      livePrice=finite(ticker?.price);
      transportRuleReasons=transport._validateRules(order,symbolInfo,livePrice,{
        expectedLeverage:settings.leverage,
        maxEntryDeviationPct:policy.maxEntryDeviationPct
      });
    } catch (e) {
      transportRuleReasons=['BINANCE_LIVE_RULE_PREFLIGHT_FAILED',String(e?.message || e).slice(0,160)];
    }

    // Exercise the exact one-shot authorization/fingerprint logic in an isolated
    // temporary registry. The simulated grant can never reach Binance transport.
    const simulationRegistry=new LiveAuthorizationRegistry();
    const simulatedIssue=simulationRegistry.issue({
      executionReadiness,
      apiPolicy:policy.apiPolicy,
      userApproved:true,
      order,
      now
    });
    let simulatedConsume={ ok:false };
    let simulatedReplay={ ok:false };
    if (simulatedIssue.ok) {
      simulatedConsume=simulationRegistry.consume({ grantId:simulatedIssue.grant.grantId, order, now });
      simulatedReplay=simulationRegistry.consume({ grantId:simulatedIssue.grant.grantId, order, now });
    }
    const authorizationSimulationOk=simulatedIssue.ok === true &&
      simulatedConsume.ok === true &&
      simulatedReplay.ok === false;

    const reasons=[
      ...(executionReadiness?.reasons || []),
      ...transportRuleReasons,
      ...(authorizationSimulationOk?[]:['ONE_SHOT_AUTHORIZATION_SIMULATION_FAILED'])
    ];
    const uniqueReasons=[...new Set(reasons.filter(Boolean))];
    const ready=executionReadiness?.ok === true && transportRuleReasons.length===0 && authorizationSimulationOk;

    return {
      ok:true,
      readyForUserArm:ready,
      armed:false,
      liveAllowed:false,
      orderPlaced:false,
      orderRequestSent:false,
      execution:ready?'LIVE_READINESS_OK':'LIVE_READINESS_WAIT',
      symbol:order.symbol,
      side:order.side,
      jevDecision:plan.jevDecision||null,
      planStatus:String(plan.status || ''),
      originTF:String(plan.originTF || ''),
      ownerTF:String(plan.ownerTF || ''),
      vision:{ attached:Number(advisory?.vision?.attached || 0), required:Number(advisory?.vision?.required || 9) },
      settings:{
        marginQuote:settings.marginQuote,
        leverage:settings.leverage,
        maxOpenPositions:settings.maxOpenPositions
      },
      account:{
        equity:finite(accountRisk?.account?.equity),
        availableBalance:finite(accountRisk?.account?.availableBalance),
        dailyRealizedPnl:finite(accountRisk?.account?.dailyRealizedPnl),
        openPositions:finite(accountRisk?.account?.openPositions)
      },
      intent:{
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
      dryRun:{
        ok:dryRun?.ok === true,
        simulated:dryRun?.simulated === true,
        submitted:dryRun?.submitted === true,
        requestSent:dryRun?.transport?.requestSent === true
      },
      exchangeRules:{
        ok:transportRuleReasons.length===0,
        livePrice,
        reasons:transportRuleReasons
      },
      authorizationSimulation:{
        issueOk:simulatedIssue.ok === true,
        consumeOnceOk:simulatedConsume.ok === true,
        replayBlocked:simulatedReplay.ok === false
      },
      apiPolicy:policy.apiPolicy,
      positionModeDual:positionMode?.dualSidePosition === true,
      remainingRuntimeControls:['EXPLICIT_USER_LIVE_ARM','REAL_LEASE_AND_LINEAGE_CLAIM','ONE_SHOT_GRANT_AT_EXECUTION'],
      reasons:uniqueReasons,
      policy:publicPolicy(policy)
    };
  }

  async function arm({ confirmed = false } = {}) {
    const generation = ++armGeneration;
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

    if (generation !== armGeneration) return { ok:false, armed:false, liveAllowed:false, execution:'LIVE_BLOCKED', reasons:['LIVE_ARM_CANCELLED'] };
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
    armGeneration++;
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
    PLAN_WORKER_WAIT:'Plan worker bekleme koşulunu henüz tamamlanmış görmüyor',
    PLAN_WORKER_TRIGGERED:'Plan worker bekleme koşulunun tetiklenmiş olabileceğini gördü; tam 9TF yeniden doğrulama gerekli',
    PLAN_WORKER_REFRESH_REQUIRED:'Plan worker yapı/yön/veri değişimi nedeniyle tam 9TF yenileme istiyor',
    WORKER_9ROUTER_UNAVAILABLE:'9Router worker ajanları yanıt vermedi; tam 9TF fail-safe yenileme gerekli',
    WORKER_SPREAD_ABOVE_8_BPS:'spread 8 bps üstünde; worker işlem tetiklemiyor',
    UNSTRUCTURED_COMMITTEE_OUTPUT:'model çıktısı beklenen plan şemasına uymadı',
    NO_FRESH_TIMEFRAME_CONTEXT:'taze zaman dilimi bağlamı yetersiz'
  };

  const LEADER_STAGE_TR = {
    PREFILTER:'Ön tarama',
    PIPELINE_SELECTED:'Derin 9TF analiz için seçildi',
    PIPELINE_ERROR:'Derin analiz hattında hata',
    WORKER_WAIT:'Plan worker izliyor; 9TF yeniden çalıştırılmadı',
    WORKER_TRIGGER:'Plan worker tetik gördü; tam 9TF doğrulamaya yükseltildi',
    WORKER_REFRESH:'Plan worker plan yenilemesi istedi; tam 9TF doğrulamaya yükseltildi',
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
      jevDecision:plan.jevDecision || null,
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
      declaredSupportTFs:Array.isArray(plan.declaredSupportTFs) ? plan.declaredSupportTFs.slice(0,9) : [],
      declaredVetoTFs:Array.isArray(plan.declaredVetoTFs) ? plan.declaredVetoTFs.slice(0,9) : [],
      visionContractWarnings:Array.isArray(plan.visionContractWarnings) ? plan.visionContractWarnings.slice(0,12) : [],
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
    if(row?.jevDecision?.summaryTr) parts.push(row.jevDecision.summaryTr);
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
      generatedAt:new Date(clock()).toISOString(),
      universeCount:Number(scan?.targetUniverseCount || scan?.universeCount || 0),
          lightweightUniverseCount:Number(scan?.lightweightUniverseCount || scan?.universeCount || 0),
      shortlistCount:rows.length,
      eligibleCount:rows.filter(x => x.eligible).length,
      priorityBuckets:scan?.priorityBuckets || null,
      attentionStatus:scan?.attentionStatus || null,
      candidates:rows.slice(0,16)
    };
    leaderHealthEvent('SCAN',{
      universeCount:leaderAutoLastDiagnostics.universeCount,
      shortlistCount:leaderAutoLastDiagnostics.shortlistCount,
      eligibleCount:leaderAutoLastDiagnostics.eligibleCount
    });
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
    if (executionBusy) {
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LEADER_AUTO_BUSY', reasons:['LIVE_EXECUTOR_BUSY'] };
    }
    executionBusy = true;
    const generation = armGeneration;
    try { return await executeLeaderExclusive(body, generation); }
    finally { executionBusy = false; }
  }

  async function executeLeaderExclusive(body = {}, generation) {
    const policy = readPolicy(root);
    const analysisOnly = body?.analysisOnly === true;
    if (!analysisOnly && !armedNow()) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:['LIVE_NOT_ARMED'] };
    if (!analysisOnly && !policy.ok) return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:policy.reasons || ['LIVE_POLICY_REQUIRED'] };

    const settings = analysisOnly
      ? { ok:true, dynamic:true, marginQuote:null, leverage:null, maxOpenPositions:null }
      : requestedExecutionSettings(body, policy);
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
    reconcileLeaderEligibility(rawCandidates, allowLong, allowShort);

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
    const pick = pickLeaderCandidate(candidates);
    const selectedIndex = pick.index;
    const candidate = pick.candidate;
    leaderAutoLastDiagnostics.selectionReason=pick.reason;

    // Primary scanner candidate has priority. When fresh candidates exist this tick
    // performs exactly one deep 9TF analysis; tracked-only refreshes are reserved for
    // the no-fresh-candidate path so Vision throughput is spent on opportunity coverage.
    let trackedRefresh = null;
    const existingLifecycle=leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null;
    if (!existingLifecycle) upsertLeaderLifecycle(candidate,null,'DETECTED','FRESH_SCANNER_SELECTION');
    annotateLeaderDiagnostic(candidate.symbol, 'PIPELINE_SELECTED', [], { selectedIndex, lifecycle:existingLifecycle || leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null });

    const trackedBeforeVision=leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null;
    if(workerEligible(trackedBeforeVision)){
      const worker=await reviewTrackedPlan(candidate,scan);
      if(worker?.handled&&worker.state==='WAIT'){
        annotateLeaderDiagnostic(candidate.symbol,'WORKER_WAIT',['PLAN_WORKER_WAIT'],{
          workerState:worker.state,workerSource:worker.source,workerReason:worker.reason,
          workerRecheckTFs:worker.recheckTFs,workerVisionAvoided:true
        });
        return {
          ok:true,orderPlaced:false,liveAllowed:false,execution:'LEADER_AUTO_WAIT',
          symbol:candidate.symbol,reasons:['PLAN_WORKER_WAIT'],worker,visionAvoided:true
        };
      }
      if(worker?.handled){
        const stage=worker.state==='TRIGGERED'?'WORKER_TRIGGER':'WORKER_REFRESH';
        const reason=worker.state==='TRIGGERED'?'PLAN_WORKER_TRIGGERED':'PLAN_WORKER_REFRESH_REQUIRED';
        annotateLeaderDiagnostic(candidate.symbol,stage,[reason],{
          workerState:worker.state,workerSource:worker.source,workerReason:worker.reason,
          workerRecheckTFs:worker.recheckTFs
        });
      }
    }

    let advisory;
    const analysisStartedAt=Number.isFinite(clock()) ? clock() : Date.now();
    try {
      advisory = await pipeline.run({
        scan,
        store,
        committee,
        executionIntent:{ symbol:candidate.symbol }
      });
      const analysisEndedAt=Number.isFinite(clock()) ? clock() : Date.now();
      const planStatus=String(advisory?.plan?.status || advisory?.status || 'REVIEW_REQUIRED').toUpperCase();
      const preJevStatus=String(advisory?.preJevPlan?.status || advisory?.plan?.previousStatus || planStatus).toUpperCase();
      const planReason=String(advisory?.plan?.reason || advisory?.reason || '');
      const jevDecision=advisory?.jevDecision || advisory?.plan?.jevDecision || null;
      const visionUnavailable=planReason==='VISION_COMMITTEE_UNAVAILABLE' || advisory?.committee?.available===false || advisory?.committee?.mode==='unavailable';
      leaderHealthEvent('ANALYSIS',{
        symbol:String(candidate.symbol || ''),
        preJevStatus,
        planStatus,
        jevCalled:jevDecision?.called===true,
        jevVeto:jevDecision?.veto===true,
        jevReasons:Array.isArray(jevDecision?.vetoReasons)?jevDecision.vetoReasons.slice(0,8):[],
        reason:planReason,
        reasons:[...new Set([planReason,...(Array.isArray(jevDecision?.vetoReasons)?jevDecision.vetoReasons:[])].filter(Boolean))],
        durationMs:Math.max(0,analysisEndedAt-analysisStartedAt),
        visionAttached:Number(advisory?.vision?.attached || 0),
        visionRequired:Number(advisory?.vision?.required || 9),
        visionUnavailable
      });
    } catch (e) {
      const analysisEndedAt=Number.isFinite(clock()) ? clock() : Date.now();
      const rs=[String(e?.message || 'LEADER_PLAN_FAILED').slice(0,160)];
      leaderHealthEvent('ANALYSIS',{
        symbol:String(candidate.symbol || ''),
        planStatus:'ERROR',
        reason:rs[0],
        reasons:rs,
        durationMs:Math.max(0,analysisEndedAt-analysisStartedAt),
        visionUnavailable:/VISION|COMMITTEE|MODEL/i.test(rs[0])
      });
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
      markLeaderEligibility(candidate.symbol,false,advisory?.reason || 'LEADER_PLAN_NOT_READY');
      const rs=[advisory?.reason || 'LEADER_PLAN_NOT_READY'];
      annotateLeaderDiagnostic(candidate.symbol, 'PLAN_NOT_READY', rs, visionDiagnosticExtras(advisory));
      const existingTrack=leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()];
      if (existingTrack) {
        existingTrack.lastAnalyzedAt=clock();
        existingTrack.lastDetail=String(rs[0] || 'PLAN_NOT_READY').slice(0,240);
        leaderAnalysisState.bySymbol[String(candidate.symbol || '').toUpperCase()]=existingTrack;
        writeLeaderAnalysisState();
      }
      // A fresh eligible scanner candidate already consumed the 9TF slot for this tick.
      // Do not immediately launch a second tracked-refresh analysis: it reduces coverage
      // and can starve other fresh candidates. Tracked setups are refreshed when no fresh
      // execution candidate is available, or when they rotate back through the scanner.
      return {
        ok:true,
        orderPlaced:false,
        liveAllowed:false,
        execution:'LEADER_AUTO_WAIT',
        symbol:candidate.symbol,
        reasons:rs
      };
    }

    markLeaderEligibility(candidate.symbol,true,'FRESH_PIPELINE_ANALYSIS');

    if (String(advisory.plan.status || '').toUpperCase() !== 'QUALIFIED') {
      const rs=[...new Set(['LEADER_PLAN_NOT_QUALIFIED', advisory.plan.reason].filter(Boolean))];
      annotateLeaderDiagnostic(candidate.symbol, 'PLAN_NOT_QUALIFIED', rs, visionDiagnosticExtras(advisory));
      const lifecycle=upsertLeaderLifecycle(candidate,advisory,null,'PLAN_'+String(advisory.plan.status || 'REVIEW_REQUIRED').toUpperCase());
      const workerLifecycle=String(advisory.plan.status||'').toUpperCase()==='WATCH'
        ? activatePlanWorker(candidate.symbol,'VISION_WATCH_REGISTERED')
        : lifecycle;
      annotateLeaderDiagnostic(candidate.symbol, 'PLAN_NOT_QUALIFIED', rs, { ...visionDiagnosticExtras(advisory), lifecycle:workerLifecycle });
      // Coverage-first: one deep 9TF analysis per Leader Auto tick when fresh candidates
      // exist. Persistent tracked setups are refreshed by the no-candidate path instead.
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
    const completedWorkerLifecycle=finishPlanWorker(candidate.symbol,'PLAN_QUALIFIED_AFTER_FULL_9TF') || qualifiedLifecycle;
    annotateLeaderDiagnostic(candidate.symbol, 'PLAN_QUALIFIED', [], { ...visionDiagnosticExtras(advisory), lifecycle:completedWorkerLifecycle });

    if (analysisOnly) {
      // Analysis-only mode must not double-consume Vision on the same tick. The qualified
      // candidate is already fully analyzed; tracked refresh waits for a later idle/no-candidate turn.
      return {
        ok:true,
        orderPlaced:false,
        liveAllowed:false,
        analysisOnly:true,
        execution:'LEADER_AUTO_WAIT_ARM',
        symbol:candidate.symbol,
        plan:advisory.plan,
        reasons:['LIVE_NOT_ARMED'],
        trackedRefresh:null,
        analysisLifecycle:leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null
      };
    }

    if (!armedNow() || generation !== armGeneration) {
      const rs=['LIVE_DISARMED_DURING_PREFLIGHT'];
      annotateLeaderDiagnostic(candidate.symbol,'EXECUTION_RESULT',rs,{execution:'LEADER_AUTO_BLOCKED',orderPlaced:false});
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LEADER_AUTO_BLOCKED', symbol:candidate.symbol, plan:advisory.plan, reasons:rs };
    }

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

    leaderHealthEvent('EXECUTION_STAGE',{
      stage:'INTENT_READY',
      symbol:intent.symbol,
      reason:null
    });
    const result = await executeExclusive({
      eventId,
      order,
      structuralInvalidationPrice:intent.structuralInvalidationPrice,
      bufferQuote:intent.buffer,
      initialStopPrice:intent.stopPrice,
      requestedMarginQuote:settings.marginQuote,
      requestedLeverage:settings.leverage,
      requestedMaxOpenPositions:settings.maxOpenPositions,
      approvedAnalysis:{
        source:'LEADER_AUTO_9TF_JEV_APPROVED',
        approvedAt:clock(),
        symbol:intent.symbol,
        side:intent.side,
        plan:advisory.plan,
        unifiedContext:advisory.unifiedContext,
        jevDecision:advisory.jevDecision || advisory.plan?.jevDecision || null
      }
    }, generation);
    leaderHealthEvent('EXECUTION_STAGE',{
      stage:result?.orderPlaced===true?'ORDER_PLACED':'EXECUTION_RESULT',
      symbol:intent.symbol,
      orderPlaced:result?.orderPlaced===true,
      reason:Array.isArray(result?.reasons)&&result.reasons.length?String(result.reasons[0]):null
    });

    const executionLifecycle=result?.orderPlaced === true
      ? upsertLeaderLifecycle(candidate,advisory,'ACTIVE','LIVE_ORDER_PLACED')
      : upsertLeaderLifecycle(candidate,advisory,'ENTERABLE','LIVE_EXECUTION_NO_ORDER:'+String(result?.execution || ''));
    if(result?.orderPlaced===true&&executionLifecycle){
      executionLifecycle.entryPrice=intent.entryPrice;
      executionLifecycle.quantity=intent.quantity;
      executionLifecycle.stopPrice=intent.stopPrice;
      executionLifecycle.takeProfit1=intent.takeProfit1;
      executionLifecycle.takeProfit2=intent.takeProfit2;
      executionLifecycle.takeProfit3=intent.takeProfit3;
      executionLifecycle.activeAt=clock();
      leaderAnalysisState.bySymbol[String(candidate.symbol||'').toUpperCase()]=executionLifecycle;
      writeLeaderAnalysisState();
      try{store.recordLearning?.('POSITION_OPENED',intent.symbol,{side:intent.side,setup:advisory?.plan?.setup,originTF:intent.originTF,ownerTF:advisory?.plan?.ownerTF,decision:'ACTIVE',entryPrice:intent.entryPrice,quantity:intent.quantity});}catch{}
    }
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
    // Mobile and Leader AUTO share this gate. Reject concurrent requests rather
    // than queueing stale market intents behind a potentially slow Vision call.
    if (executionBusy) return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LIVE_BLOCKED', reasons:['LIVE_EXECUTOR_BUSY'] };
    executionBusy = true;
    const generation = armGeneration;
    try { return await executeExclusive(body, generation); }
    finally { executionBusy = false; }
  }

  async function executeExclusive(body = {}, generation) {
    if (generation !== armGeneration) {
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LIVE_BLOCKED', reasons:['LIVE_ARM_GENERATION_CHANGED'] };
    }
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

    let freshSelection=null;
    if (typeof pipeline.resolveExecutionCandidate === 'function') {
      freshSelection = pipeline.resolveExecutionCandidate(scan, order);
      if (!freshSelection?.candidate) {
        return {
          ok:false,
          orderPlaced:false,
          liveAllowed:false,
          execution:'LIVE_PREFLIGHT_BLOCKED',
          retryable:true,
          requestedSymbol:freshSelection?.requestedSymbol || String(order?.symbol || '').toUpperCase(),
          reasons:[freshSelection?.reason || 'REQUESTED_SYMBOL_NOT_EXECUTION_ELIGIBLE']
        };
      }
      const currentSide=String(freshSelection.candidate?.side || '').toUpperCase();
      const requestedSide=String(order?.side || '').toUpperCase();
      if (currentSide && requestedSide && currentSide!==requestedSide) {
        return {
          ok:false,
          orderPlaced:false,
          liveAllowed:false,
          execution:'LIVE_PREFLIGHT_BLOCKED',
          retryable:true,
          requestedSymbol:freshSelection?.requestedSymbol || String(order?.symbol || '').toUpperCase(),
          reasons:['REQUESTED_SIDE_NO_LONGER_EXECUTION_ELIGIBLE']
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
    const approved=body?.approvedAnalysis && typeof body.approvedAnalysis==='object' ? body.approvedAnalysis : null;
    if (approved) {
      const approvedAt=finite(approved.approvedAt);
      const approvalAgeMs=approvedAt===null ? null : Math.max(0,clock()-approvedAt);
      const approvedPlan=approved.plan || null;
      const approvedUnified=approved.unifiedContext || null;
      const approvedSymbol=String(approved.symbol || '').toUpperCase();
      const approvedSide=String(approved.side || '').toUpperCase();
      const orderSymbol=String(order?.symbol || '').toUpperCase();
      const orderSide=String(order?.side || '').toUpperCase();
      const reuseReasons=[];
      if (approved.source!=='LEADER_AUTO_9TF_JEV_APPROVED') reuseReasons.push('LEADER_APPROVAL_SOURCE_INVALID');
      if (approvedAt===null || approvalAgeMs>60000) reuseReasons.push('LEADER_APPROVAL_STALE');
      if (!approvedPlan || approvedPlan.valid!==true || String(approvedPlan.status||'').toUpperCase()!=='QUALIFIED') reuseReasons.push('LEADER_APPROVAL_NOT_QUALIFIED');
      if (!approvedUnified?.dataQuality?.advisoryUsable) reuseReasons.push('LEADER_APPROVAL_CONTEXT_NOT_USABLE');
      if (approvedSymbol!==orderSymbol || approvedSide!==orderSide || String(approvedPlan?.side||'').toUpperCase()!==orderSide) reuseReasons.push('LEADER_APPROVAL_ORDER_MISMATCH');
      if (freshSelection?.candidate) {
        const currentSymbol=String(freshSelection.candidate.symbol || '').toUpperCase();
        const currentSide=String(freshSelection.candidate.side || '').toUpperCase();
        if (currentSymbol!==orderSymbol || currentSide!==orderSide) reuseReasons.push('LEADER_APPROVAL_FRESH_SCAN_MISMATCH');
      }
      if (reuseReasons.length) {
        const claimRelease=releaseClaim();
        return {
          ok:false,
          orderPlaced:false,
          liveAllowed:false,
          retryable:claimRelease?.released===true,
          execution:'LIVE_PREFLIGHT_BLOCKED',
          claim,
          claimRelease,
          reasons:[...new Set(reuseReasons)],
          approvalAgeMs
        };
      }

      const preflight=preflightRiskGate({plan:approvedPlan,unified:approvedUnified});
      const accountCaps=accountRiskCaps(accountRisk || {});
      const structuralStop=structuralStopGate({...(stopRisk || {}),side:approvedPlan.side});
      const killSwitchState=killSwitchGate(killSwitch || {});
      const executionClaimState=executionClaimGate({claim});
      const riskGateBase=combineReadinessRiskGate(preflight,accountCaps,structuralStop,killSwitchState,executionClaimState);
      const riskGate=enforceReadinessLineage(riskGateBase,executionClaimState,order);
      const dryRunExecutor=buildDryRunOrder({
        intent:{...order,mode:'DRY_RUN',live:false,side:approvedPlan.side},
        riskGate
      });
      const executionReadiness=combineReadiness(riskGate,dryRunExecutor);
      planResult={
        ok:true,
        candidateFound:true,
        reusedApprovedLeaderAnalysis:true,
        approvalAgeMs,
        plan:approvedPlan,
        unifiedContext:approvedUnified,
        jevDecision:approved.jevDecision || approvedPlan.jevDecision || null,
        riskGate,
        dryRunExecutor,
        executionReadiness,
        execution:'ADVISORY_ONLY',
        orderPlaced:false
      };
    } else {
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
    }

    if (!armedNow() || generation !== armGeneration) {
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
      order,
      // Use the controller clock consistently. The registry defaults to Date.now(),
      // but tests and controlled runtimes may inject a clock; mixing the two can
      // make a freshly issued one-shot grant appear to be from the future/expired.
      now:clock()
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

  return { status, accountSummary, liveReadiness, arm, disarm, execute, executeLeader, configureLeaderAuto, leaderAutoStatus, leaderAutoTick, activePositionReviewTick, positionManagerStatus, readPolicy:() => publicPolicy(readPolicy(root)) };
}

module.exports = { LIVE_RESOURCE, LIVE_OWNER, normalizePolicy, resolveCredentials, requestedExecutionSettings, applyDynamicSizingGuards, createLiveController };
