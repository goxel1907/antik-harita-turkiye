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
const { isNonConcreteWait } = require('./wait-condition');
const claudeV109 = require('./claude-v109');
const claudeV111 = require('./claude-v111');
const claudeV112 = require('./claude-v112');
const tradeLanesV111 = require('./trade-lanes');

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

  // CLAUDE_V109_RISK_AUTHORITY_SWITCH: USER_PANEL_EXACT (varsayılan, v108 davranışı) panelde seçilen
  // marj×kaldıraç'ı risk otoritesi sayar; likidasyon kapısı zarar tavanını sınırlar.
  // STRICT_POLICY_CAP: ChatGPT v109 davranışı; maxRiskPctPerTrade sert tavan olarak uygulanır.
  const riskAuthority = String(raw?.riskAuthority || 'USER_PANEL_EXACT').toUpperCase() === 'STRICT_POLICY_CAP'
    ? 'STRICT_POLICY_CAP'
    : 'USER_PANEL_EXACT';

  return {
    ok:reasons.length === 0,
    armMinutes,
    expectedLeverage,
    maxEntryDeviationPct,
    limits,
    riskAuthority,
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
    riskAuthority:policy.riskAuthority || 'USER_PANEL_EXACT',
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
    // CLAUDE_V109_RISK_AUTHORITY_SWITCH: ChatGPT v109 bu tavanı sert yaptı. Kullanıcının gerçek
    // ayarında (≈80 USDT bakiye, 25 USDT × 10x, maxRiskPctPerTrade=1) bu, yapısal stoplu hiçbir
    // işlemin açılamaması demekti (0,8 USDT risk → %0,32 stop). Varsayılan v108 panel otoritesine
    // döndü; artık likidasyon kapısı (STOP_BEYOND_LIQUIDATION) zarar tavanını sınırlıyor.
    // live-policy.json "riskAuthority":"STRICT_POLICY_CAP" ile sert tavan seçilebilir.
    maxRiskPctPerTrade:(policy.riskAuthority==='STRICT_POLICY_CAP'||riskPct===null)
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
      riskAuthority:policy.riskAuthority==='STRICT_POLICY_CAP'?'STRICT_POLICY_CAP':'USER_PANEL_EXACT',
      riskPctOfEquity:riskPct===null?null:Number(riskPct.toFixed(4)),
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

function jevFinalAuthorityPreflight({ plan, unified } = {}) {
  const reasons=[];
  const side=String(plan?.side||'').toUpperCase();
  if (plan?.valid!==true) reasons.push('JEV_FINAL_PLAN_INVALID');
  if (String(plan?.status||'').toUpperCase()!=='QUALIFIED') reasons.push('JEV_FINAL_PLAN_NOT_QUALIFIED');
  if (!['LONG','SHORT'].includes(side)) reasons.push('JEV_FINAL_SIDE_INVALID');
  if (!unified?.dataQuality?.advisoryUsable) reasons.push('JEV_FINAL_CONTEXT_NOT_USABLE');
  if (finite(unified?.livePrice)===null) reasons.push('JEV_FINAL_LIVE_PRICE_UNAVAILABLE');
  const unique=[...new Set(reasons)];
  return {
    ok:unique.length===0,
    eligibleForDryRun:unique.length===0,
    liveAllowed:false,
    execution:'ADVISORY_ONLY',
    finalAuthority:true,
    reasons:unique,
    remainingMandatoryControls:[
      'ACCOUNT_RISK_CAPS',
      'STRUCTURAL_STOP_AND_NO_WIDEN',
      'LEASE_AND_LINEAGE_CLAIM',
      'KILL_SWITCH',
      'BINANCE_DRY_RUN_EXECUTOR'
    ]
  };
}

function createLiveController({ root, store, scanner, pipeline, committee, market = null, freeWorker = null, exitJudge = null, lessonJudge = null, credentials = {}, fetchImpl = globalThis.fetch, clock = () => Date.now() } = {}) {
  if (!root || !store || !scanner || !pipeline || typeof committee !== 'function') throw new Error('live controller dependencies required');
  const registry = new LiveAuthorizationRegistry();
  const transport = new BinanceLiveTransport({ registry, fetchImpl, clock });
  const leaseToken = crypto.randomBytes(32).toString('base64url');
  let armState = { armed:false, armedAt:null, expiresAt:null };
  let armGeneration = 0;
  let executionBusy = false;
  // CLAUDE_V112_EXECUTION_LOCK_ONLY_AT_ORDER: Leader AUTO analiz akışı (Vision ~8 dk) artık emir kilidini
  // tutmaz; kendi bayrağını tutar. Emir anı (executeExclusive) yine tek kilitte (executionBusy).
  let leaderFlowBusy = false;
  let fastLaneBusy = false;
  let leaderVisionSymbol = null;
  let fastLaneSymbol = null;
  let fastLaneJevCalls = [];
  const fastLaneSeen = new Map();
  let fastLaneState = { lastTickAt:null, lastSignal:null, lastResult:null, history:[] };
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
  const WORKER_ESCALATION_COOLDOWN_MS = 15 * 60 * 1000;
  const leaderAutoHealthStartedAt = Number.isFinite(clock()) ? clock() : Date.now();
  let leaderAutoHealthEvents = [];
  let planWorkerState = { lastReview:null, history:[] };
  let planWorkerBusy = false;
  let planWorkerCursor = 0;

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
    const finalAuthorityEvents = ev.filter(x => x.kind === 'JEV_FINAL_AUTHORITY');
    // CLAUDE_V111: saniyelik yeniden doğrulamalar Vision süresi ortalamasını bozmasın.
    const durations = analyses.filter(x => x.claudeRevalidated !== true && !x.claudeFastLane).map(x => Number(x.durationMs)).filter(Number.isFinite);
    const reasonCounts = new Map();
    for (const x of [...analyses,...ticks]) {
      const perEvent=new Set([
        ...(Array.isArray(x.reasons)?x.reasons:[]),
        x.reason
      ].map(r=>String(r||'').trim()).filter(Boolean));
      for(const key of perEvent)reasonCounts.set(key,(reasonCounts.get(key)||0)+1);
    }
    const topReasons=[...reasonCounts.entries()]
      .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
      .slice(0,6)
      .map(([reason,count])=>({reason,count}));
    const statusCount = status => analyses.filter(x => String(x.planStatus || '').toUpperCase() === status).length;
    const uniqueAnalyzedSymbols=[...new Set(analyses.map(x=>String(x.symbol||'')).filter(Boolean))];
    const latestScan=scans.at(-1) || null;
    const sovereignAnalyses=analyses.filter(x=>x.jevSovereign===true);
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
      sovereignPass1Calls:sovereignAnalyses.filter(x=>x.jevPass1Called===true).length,
      sovereignFinalCalls:sovereignAnalyses.filter(x=>x.jevCalled===true).length,
      sovereignLong:sovereignAnalyses.filter(x=>String(x.jevFinalAction||'').toUpperCase()==='LONG').length,
      sovereignShort:sovereignAnalyses.filter(x=>String(x.jevFinalAction||'').toUpperCase()==='SHORT').length,
      sovereignWait:sovereignAnalyses.filter(x=>String(x.jevFinalAction||'').toUpperCase()==='WAIT').length,
      sovereignMarketNow:sovereignAnalyses.filter(x=>String(x.jevEntryTiming||'').toUpperCase()==='MARKET_NOW').length,
      sovereignTimingWait:sovereignAnalyses.filter(x=>String(x.jevEntryTiming||'').toUpperCase().startsWith('WAIT_')).length,
      sovereignEntryTimingCounts:(()=>{
        const m=new Map();
        for(const x of sovereignAnalyses){const k=String(x.jevEntryTiming||'UNSPECIFIED').toUpperCase();m.set(k,(m.get(k)||0)+1);}
        return [...m.entries()].sort((a,b)=>b[1]-a[1]).map(([entryTiming,count])=>({entryTiming,count}));
      })(),
      sovereignWaitReasonCounts:(()=>{
        const m=new Map();
        for(const x of sovereignAnalyses){const k=String(x.jevWaitReason||'UNSPECIFIED').toUpperCase();m.set(k,(m.get(k)||0)+1);}
        return [...m.entries()].sort((a,b)=>b[1]-a[1]).map(([waitReason,count])=>({waitReason,count}));
      })(),
      sovereignEvidenceRequests:sovereignAnalyses.reduce((sum,x)=>sum+Math.max(0,Number(x.jevRequestedEvidenceCount)||0),0),
      sovereignFinalTotal:sovereignAnalyses.filter(x=>x.jevCalled===true).length,
      sovereignWaitRatePct:(()=>{
        const finals=sovereignAnalyses.filter(x=>x.jevCalled===true).length;
        const waits=sovereignAnalyses.filter(x=>String(x.jevFinalAction||'').toUpperCase()==='WAIT').length;
        return finals?Number((100*waits/finals).toFixed(1)):null;
      })(),
      sovereignTimingWaitRatePct:(()=>{
        const finals=sovereignAnalyses.filter(x=>x.jevCalled===true).length;
        const waits=sovereignAnalyses.filter(x=>String(x.jevEntryTiming||'').toUpperCase().startsWith('WAIT_')).length;
        return finals?Number((100*waits/finals).toFixed(1)):null;
      })(),
      sovereignSelectivityDiagnostic:(()=>{
        const finals=sovereignAnalyses.filter(x=>x.jevCalled===true).length;
        const waits=sovereignAnalyses.filter(x=>String(x.jevFinalAction||'').toUpperCase()==='WAIT').length;
        return finals>=5&&waits===0
          ? {code:'NO_WAIT_OBSERVED_INFO_ONLY',blocking:false,note:'Recent JEV finals contain no WAIT decisions. This is a selectivity diagnostic only and never blocks or scores JEV.'}
          : {code:'NORMAL',blocking:false};
      })(),
      jevCalled:analyses.filter(x=>x.jevCalled===true).length,
      jevVetoed:analyses.filter(x=>x.jevVeto===true).length,
      jevShadowCalled:analyses.filter(x=>x.jevShadowCalled===true).length,
      laneMain15Plans:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>x?.tradeLaneName==='MAIN_15M').length,
      laneScalpPlans:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>x?.tradeLaneName==='SCALP_MOMENTUM').length,
      laneScalpReady:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>x?.tradeLaneName==='SCALP_MOMENTUM'&&x?.scalpReady===true).length,
      laneMain15Ready:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>x?.main15Ready===true).length,
      momentumStages:(()=>{
        const m=new Map();
        for(const x of Object.values(leaderAnalysisState.bySymbol||{})){
          const k=String(x?.momentumStage||'').trim();if(k)m.set(k,(m.get(k)||0)+1);
        }
        return [...m.entries()].sort((a,b)=>b[1]-a[1]).map(([stage,count])=>({stage,count}));
      })(),
      // CLAUDE_V109 gölge ölçümleri (Office ekranı ve PDF raporu bunları okur)
      claudeV109:{
        config:claudeV109.readConfig(),
        dtWouldQualify:analyses.filter(x=>x.claudeDtWouldQualify===true).length,
        dtApplied:analyses.filter(x=>x.claudeDtApplied===true).length,
        triggerAutoSelected:analyses.filter(x=>x.claudeTriggerAutoSelected===true).length,
        numericWaitFallback:analyses.filter(x=>x.claudeNumericWait===true).length,
        jevV108Veto:analyses.filter(x=>x.jevVeto===true).length,
        jevRoleWeightedVeto:analyses.filter(x=>x.jevRoleWeightedVeto===true).length,
        jevShadowV108WouldVeto:analyses.filter(x=>x.jevShadowWouldVeto===true).length,
        jevShadowRoleWeightedWouldVeto:analyses.filter(x=>x.jevShadowRoleWeightedVeto===true).length,
        chaseBlocked:executionStages.filter(x=>x.stage==='CHASE_BLOCKED').length
      },
      // CLAUDE_V111: sayısal tetik → yeniden doğrulama → Jev; momentum scalp; runner.
      claudeV111:{
        marker:claudeV111.marker,
        config:claudeV111.readConfig(),
        dtMode:claudeV109.readConfig().deterministicTriggerMode,
        revalidationAttempts:analyses.filter(x=>x.claudeRevalidationAttempted===true).length,
        revalidated:analyses.filter(x=>x.claudeRevalidated===true).length,
        revalidationFailed:analyses.filter(x=>x.claudeRevalidationAttempted===true&&x.claudeRevalidated!==true).length,
        revalidationReasonCounts:(()=>{
          const m=new Map();
          for(const x of analyses)for(const r of Array.isArray(x.claudeRevalidationReasons)?x.claudeRevalidationReasons:[]){const k=String(r||'').split(':')[0];if(k)m.set(k,(m.get(k)||0)+1);}
          return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([reason,count])=>({reason,count}));
        })(),
        jevCalledAfterCode:analyses.filter(x=>x.jevCalled===true&&(x.claudeRevalidated===true||x.claudeDtApplied===true)).length,
        jevApprovedAfterCode:analyses.filter(x=>x.jevCalled===true&&x.jevVeto!==true&&(x.claudeRevalidated===true||x.claudeDtApplied===true)).length,
        momentumScalpTriggers:analyses.filter(x=>x.claudeDtLane==='SCALP_MOMENTUM').length,
        finalAuthorityApproved:finalAuthorityEvents.filter(x=>x.stage==='APPROVED').length,
        finalAuthoritySoftWarnings:finalAuthorityEvents.filter(x=>x.stage==='SOFT_WARNING').length,
        finalAuthorityHardBlocks:finalAuthorityEvents.filter(x=>x.stage==='HARD_BLOCK').length,
        finalAuthorityIntentBuilt:finalAuthorityEvents.filter(x=>x.stage==='INTENT_BUILT').length,
        finalAuthorityHardSafetyReady:finalAuthorityEvents.filter(x=>x.stage==='HARD_SAFETY_READY').length,
        runner:runnerSummary()
      },
      claudeV112:{
        marker:claudeV112.marker,
        fastLaneMode:claudeV111.readConfig().scalpFastLane,
        fastLaneSignals:ev.filter(x=>x.kind==='FAST_LANE'&&x.fastKind==='SCALP_SIGNAL').length,
        fastLaneRevalidationTriggers:ev.filter(x=>x.kind==='FAST_LANE'&&x.fastKind==='REVALIDATION').length,
        fastLaneAnalyses:analyses.filter(x=>x.claudeFastLane==='SCALP').length,
        fastLaneQualified:analyses.filter(x=>x.claudeFastLane==='SCALP'&&x.claudeFastLaneQualified===true).length,
        fastLaneJevCalled:analyses.filter(x=>x.claudeFastLane&&x.jevCalled===true).length,
        fastLaneJevApproved:analyses.filter(x=>x.claudeFastLane&&x.jevCalled===true&&x.jevVeto!==true).length,
        concurrentRevalidations:analyses.filter(x=>x.claudeFastLane==='REVALIDATION').length,
        fastLane:fastLaneSummary(),
        positionRest:positionRestStatus()
      },
      jevShadowWouldVeto:analyses.filter(x=>x.jevShadowWouldVeto===true).length,
      jevShadowReasonCounts:(()=>{
        const m=new Map();
        for(const x of analyses)for(const r of Array.isArray(x.jevShadowReasons)?x.jevShadowReasons:[]){
          const k=String(r||'').trim();if(k)m.set(k,(m.get(k)||0)+1);
        }
        return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([reason,count])=>({reason,count}));
      })(),
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
      workerReasonCounts:(()=>{
        const m=new Map();
        for(const x of workerReviews){
          const k=String(x.reason||'').trim()||'UNKNOWN';
          m.set(k,(m.get(k)||0)+1);
        }
        return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([reason,count])=>({reason,count}));
      })(),
      workerEscalationCooldownMinutes:WORKER_ESCALATION_COOLDOWN_MS/60000,
      fullVisionAvoided:workerReviews.filter(x=>x.visionAvoided===true).length,
      workerEscalationPending:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>
        ['TRIGGERED','REFRESH_REQUIRED'].includes(String(x?.workerState||'').toUpperCase()) &&
        Number(x?.workerEscalatedAt||0)>=Number(x?.lastAnalyzedAt||0)).length,
      visionFreeQuotaFallbacks:analyses.filter(x=>x.visionFreeQuotaFallback===true).length,
      shadowPlans:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>x?.triggerValid===true).length,
      shadowTriggers:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>Number(x?.shadowTriggeredAt||0)>0).length,
      shadow15mMeasured:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>finite(x?.shadowOutcome15mPct)!==null).length,
      shadow60mMeasured:Object.values(leaderAnalysisState.bySymbol||{}).filter(x=>finite(x?.shadowOutcome60mPct)!==null).length,
      shadowAvg15mPct:(()=>{
        const xs=Object.values(leaderAnalysisState.bySymbol||{}).map(x=>finite(x?.shadowOutcome15mPct)).filter(x=>x!==null);
        return xs.length?Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(4)):null;
      })(),
      shadowAvg60mPct:(()=>{
        const xs=Object.values(leaderAnalysisState.bySymbol||{}).map(x=>finite(x?.shadowOutcome60mPct)).filter(x=>x!==null);
        return xs.length?Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(4)):null;
      })(),
      shadowEvidenceHours:(()=>{
        const xs=Object.values(leaderAnalysisState.bySymbol||{}).map(x=>Number(x?.shadowPlanAt||0)).filter(x=>x>0);
        return xs.length?Number(((now-Math.min(...xs))/3600000).toFixed(2)):0;
      })(),
      shadowReady24h:(()=>{
        const xs=Object.values(leaderAnalysisState.bySymbol||{}).map(x=>Number(x?.shadowPlanAt||0)).filter(x=>x>0);
        const hours=xs.length?(now-Math.min(...xs))/3600000:0;
        return hours>=24&&Object.values(leaderAnalysisState.bySymbol||{}).some(x=>finite(x?.shadowOutcome60mPct)!==null);
      })(),
      avgVisionBatchSize:(()=>{
        const xs=analyses.map(x=>Number(x.visionBatchSize)).filter(x=>Number.isFinite(x)&&x>0);
        return xs.length?Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(2)):null;
      })(),
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
    // A cheap worker may detect that an existing WATCH plan has triggered or
    // needs structural refresh while local Vision is busy on another symbol.
    // That escalation gets the next full-9TF slot; workers themselves never qualify.
    let index=candidates.findIndex(c=>{
      const row=leaderAnalysisState.bySymbol?.[String(c?.symbol || '').toUpperCase()];
      const lastAnalyzed=Number(row?.lastAnalyzedAt||0);
      const pending=['TRIGGERED','REFRESH_REQUIRED'].includes(String(row?.workerState || '').toUpperCase()) &&
        Number(row?.workerEscalatedAt||0)>=lastAnalyzed;
      // CLAUDE_V109_ESCALATION_ATTEMPT_COOLDOWN: tam 9TF analizi hata verirse lastAnalyzedAt
      // güncellenmiyor; ChatGPT v109'da aynı sembol her tick önceliği yeniden alıyordu.
      const attemptAt=Number(row?.workerEscalationAttemptAt||0);
      const recentFailedAttempt=attemptAt>0&&attemptAt>=Number(row?.workerEscalatedAt||0)&&now-attemptAt<LEADER_AUTO_REANALYSIS_COOLDOWN_MS;
      // CLAUDE_V111: hızlı yeniden doğrulama Vision harcamaz → 5 dk yeniden analiz soğuması gerekmez.
      // Yalnız BINDING modda ve saklanan plan ön kontrolü geçerse (inceleme bulgusu #2).
      let cheapReval=false;
      if(pending&&claudeV109.readConfig().deterministicTriggerMode==='BINDING'){
        const ri=claudeV111.revalidationIntent(row,{now});
        if(ri){
          let stored=null;
          try{stored=typeof store?.latestJournal==='function'?store.latestJournal('PLAN',String(c?.symbol||'').toUpperCase()):null;}catch{stored=null;}
          cheapReval=claudeV111.revalidationPrecheck({stored,intent:ri,now}).ok===true;
        }
      }
      return pending && !recentFailedAttempt && (cheapReval || !lastAnalyzed || now-lastAnalyzed>=LEADER_AUTO_REANALYSIS_COOLDOWN_MS);
    });
    if(index>=0){
      const candidate=candidates[index];
      const escRow=leaderAnalysisState.bySymbol?.[String(candidate?.symbol || '').toUpperCase()];
      if(escRow){
        escRow.workerEscalationAttemptAt=now;
        escRow.workerEscalationAttempts=Number(escRow.workerEscalationAttempts||0)+1;
      }
      leaderAutoCandidateCursor=(index+1)%candidates.length;
      return {candidate,index,reason:'WORKER_ESCALATION_PRIORITY'};
    }
    // Coverage-first within the existing scanner priority order: a never-analyzed
    // or stale candidate is selected before repeating a recently analyzed one.
    // This avoids repeatedly spending 9TF Vision time on the same symbol while
    // keeping scanner ordering authoritative.
    index=candidates.findIndex(c=>{
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
      // CLAUDE_V113: açık (ACTIVE) pozisyon satırları kapasite sınırında asla düşmez (sonuç defteri).
      .sort((a,b) => (Number(b[1].state === 'ACTIVE') - Number(a[1].state === 'ACTIVE')) ||
        (Number(b[1].lastAnalyzedAt || b[1].detectedAt || 0) - Number(a[1].lastAnalyzedAt || a[1].detectedAt || 0)))
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
      const sovereignFlow=pipeline?.sovereignFlow===true;
      const eligibleNow=sovereignFlow
        ? Boolean(c && /^[A-Z0-9]{1,28}USDT$/.test(String(c?.symbol||'').toUpperCase()))
        : Boolean(c && e?.eligible === true && directionAllowed);
      if (!eligibleNow) {
        row.executionEligibleNow=false;
        row.lastEligibilityCheckAt=now;
        row.eligibilityReason=c
          ? (sovereignFlow ? 'INVALID_ATTENTION_SYMBOL' : (directionAllowed ? ((e?.reasons || [])[0] || 'NOT_EXECUTION_ELIGIBLE_NOW') : 'DIRECTION_DISABLED'))
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
        tradeLaneName:row?.tradeLaneName || null,
        momentumStage:row?.momentumStage || null,
        momentumLadder:Array.isArray(row?.momentumLadder)?row.momentumLadder:[],
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
    const nextTriggerId=String(plan.triggerSpec?.triggerLevelId || plan.triggerLevelId || old?.triggerLevelId || '');
    const nextTriggerTf=String(plan.triggerSpec?.tf || plan.triggerTF || old?.triggerTF || '');
    const triggerChanged=Boolean(old && (
      (old.triggerLevelId&&nextTriggerId&&String(old.triggerLevelId)!==nextTriggerId) ||
      (old.triggerTF&&nextTriggerTf&&String(old.triggerTF)!==nextTriggerTf)
    ));
    const resetShadow=setupChanged||triggerChanged;
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
      jevSovereign:plan?.jevSovereign===true || old?.jevSovereign===true,
      tradeLaneName:String(plan?.jevSovereign===true ? (plan?.lane||'') : (plan?.tradeLane?.name || old?.tradeLaneName || '')),
      momentumStage:String(plan?.jevSovereign===true ? 'JEV_FINAL' : (plan?.tradeLane?.stage || old?.momentumStage || '')),
      momentumLadder:plan?.jevSovereign===true?[]:(Array.isArray(plan?.tradeLane?.momentumLadder)?plan.tradeLane.momentumLadder.slice(0,9):(Array.isArray(old?.momentumLadder)?old.momentumLadder.slice(0,9):[])),
      scalpAlignedCount:plan?.jevSovereign===true?0:Number(plan?.tradeLane?.lowerAlignedCount ?? old?.scalpAlignedCount ?? 0),
      scalpReady:plan?.jevSovereign===true?(planStatus==='QUALIFIED'&&plan?.lane==='5M_SCALP'):(plan?.tradeLane?.scalpReady===true || (advisory==null&&old?.scalpReady===true)),
      main15Ready:plan?.jevSovereign===true?(planStatus==='QUALIFIED'&&plan?.lane==='15M_TRADE'):(plan?.tradeLane?.main15Ready===true || (advisory==null&&old?.main15Ready===true)),
      hard15mVeto:plan?.jevSovereign===true?false:plan?.tradeLane?.hard15mVeto===true,
      setup:String(plan.setup || old?.setup || ''),
      waitFor:String(plan.waitFor || old?.waitFor || ''),
      triggerLevelId:String(plan.triggerSpec?.triggerLevelId || plan.triggerLevelId || old?.triggerLevelId || ''),
      triggerTF:String(plan.triggerSpec?.tf || plan.triggerTF || old?.triggerTF || ''),
      triggerPrice:finite(plan.triggerSpec?.triggerPrice ?? old?.triggerPrice),
      invalidationLevelId:String(plan.triggerSpec?.invalidationLevelId || plan.invalidationLevelId || old?.invalidationLevelId || ''),
      invalidationPrice:finite(plan.triggerSpec?.invalidationPrice ?? old?.invalidationPrice),
      triggerValid:plan.triggerSpec?.valid===true || (advisory==null&&old?.triggerValid===true),
      triggerClosedPrice:finite(plan.triggerSpec?.closedPrice ?? old?.triggerClosedPrice),
      triggerWasSatisfied:plan.triggerSpec?.triggered===true,
      shadowPlanAt:(plan.triggerSpec?.valid===true)
        ? (resetShadow ? now : Number(old?.shadowPlanAt||now))
        : Number(old?.shadowPlanAt||0)||null,
      shadowTriggeredAt:resetShadow?null:(Number(old?.shadowTriggeredAt||0)||null),
      shadowEntryPrice:resetShadow?null:finite(old?.shadowEntryPrice),
      shadowOutcome15mPct:resetShadow?null:finite(old?.shadowOutcome15mPct),
      shadowOutcome15mAt:resetShadow?null:(Number(old?.shadowOutcome15mAt||0)||null),
      shadowOutcome60mPct:resetShadow?null:finite(old?.shadowOutcome60mPct),
      shadowOutcome60mAt:resetShadow?null:(Number(old?.shadowOutcome60mAt||0)||null),
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
    // CLAUDE_V113_OUTCOME_LEDGER: açık pozisyonun yürütme alanları yeniden analizde silinmez (sonuç/R hesabı).
    if (oldState === 'ACTIVE' && old) {
      for (const k of ['entryPrice','quantity','stopPrice','takeProfit1','takeProfit2','takeProfit3','activeAt','entryOrderAt','entryContext','lastPositionReview','closeMissCount','closeDetectedAt'])
        if (old[k] !== undefined && row[k] === undefined) row[k]=old[k];
    }
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
    const workerState=String(row.workerState||'').toUpperCase();
    const escalatedAt=Number(row.workerEscalatedAt||0);
    const analyzedAt=Number(row.lastAnalyzedAt||0);
    // V108_WORKER_ESCALATION_LATCH: once a cheap worker requests a full 9TF
    // refresh/trigger, do not re-run that same worker every 30 seconds. The latch
    // clears only after a newer full 9TF analysis registers a fresh WATCH plan.
    const unresolvedEscalation=['TRIGGERED','REFRESH_REQUIRED'].includes(workerState) &&
      escalatedAt>0 && escalatedAt>=analyzedAt;
    return !unresolvedEscalation &&
      row.reanalysisEligible===true &&
      state!=='ACTIVE' &&
      ['WATCH','REBASE','DETECTED'].includes(state) &&
      planStatus==='WATCH' &&
      (row.triggerValid===true || !isNonConcreteWait(wait)) &&
      ['LONG','SHORT'].includes(String(row.side||'').toUpperCase());
  }

  function activatePlanWorker(symbol, detail='VISION_WATCH_REGISTERED') {
    const key=String(symbol||'').trim().toUpperCase();
    const row=leaderAnalysisState.bySymbol?.[key];
    if(!workerEligible(row))return row||null;
    row.workerState='WAIT';
    row.workerPlanAt=clock();
    row.workerEscalatedAt=null;
    row.lastWorkerCheckAt=Number(row.lastWorkerCheckAt||0)||null;
    row.workerChecks=Number(row.workerChecks||0);
    row.workerVisionAvoided=Number(row.workerVisionAvoided||0);
    row.workerReason=detail;
    row.workerSource=row.tradeLaneName==='SCALP_MOMENTUM'?'SCALP_MOMENTUM_PLAN':'VISION_PLAN';
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
    row.workerEscalatedAt=null;
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
          freeOnly:true,
          system:'V107 PLAN WORKER. Text-only advisory watcher. Never QUALIFY, never place orders, never invent missing market facts. Return exactly the requested WORKER_* schema.',
          prompt
        });
        router=planWorkers.parseWorkerDecision(out?.text||out?.analysts?.[0]?.text||'');
        router.model=String(out?.model||'');
        router.mode=String(out?.mode||'');
      }catch(e){
        router={ok:false,state:'WAIT',reason:'WORKER_9ROUTER_UNAVAILABLE',detail:String(e?.message||e).slice(0,180),recheckTFs:[]};
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
            openRouter={ok:false,state:'WAIT',reason:String(out?.reason||'OPENROUTER_FREE_WORKER_UNAVAILABLE'),recheckTFs:[]};
          }
        }catch(e){
          openRouter={ok:false,state:'WAIT',reason:'OPENROUTER_FREE_WORKER_UNAVAILABLE',detail:String(e?.message||e).slice(0,180),recheckTFs:[]};
        }
      }
    }

    let decision=planWorkers.combineWorkerReviews({deterministic,router,openRouter});
    const now=clock();
    const lastEscalatedAt=Number(tracked.workerLastEscalationAt||0);
    if(['TRIGGERED','REFRESH_REQUIRED'].includes(String(decision?.state||'').toUpperCase()) &&
       lastEscalatedAt>0 && now-lastEscalatedAt<WORKER_ESCALATION_COOLDOWN_MS){
      decision={
        state:'WAIT',
        source:'ESCALATION_COOLDOWN',
        reason:'WORKER_ESCALATION_COOLDOWN',
        recheckTFs:Array.isArray(decision?.recheckTFs)?decision.recheckTFs:[],
        confidence:decision?.confidence??null
      };
    }
    tracked.lastWorkerCheckAt=now;
    tracked.workerChecks=Number(tracked.workerChecks||0)+1;
    tracked.workerState=decision.state;
    tracked.workerReason=String(decision.reason||'').slice(0,360);
    tracked.workerSource=decision.source||null;
    tracked.workerConfidence=finite(decision.confidence);
    tracked.workerRecheckTFs=Array.isArray(decision.recheckTFs)?decision.recheckTFs.slice(0,9):[];
    tracked.workerRouterModel=router?.model||null;
    tracked.workerOpenRouterModel=openRouter?.model||null;
    if(decision.state==='WAIT'){
      tracked.workerVisionAvoided=Number(tracked.workerVisionAvoided||0)+1;
      tracked.workerEscalatedAt=null;
    }else if(['TRIGGERED','REFRESH_REQUIRED'].includes(decision.state)){
      tracked.workerEscalatedAt=now;
      tracked.workerLastEscalationAt=now;
    }
    if(decision.state==='TRIGGERED'&&deterministic?.numericTrigger===true&&!Number(tracked.shadowTriggeredAt||0)){
      tracked.shadowTriggeredAt=now;
      tracked.shadowEntryPrice=finite(deterministic.closedPrice)??finite(tracked.triggerPrice);
      tracked.shadowTriggerReason=String(decision.reason||'WORKER_NUMERIC_TRIGGER_CLOSED');
      try{store.journal('SHADOW_TRIGGER',key,{side:tracked.side,triggerTF:tracked.triggerTF,triggerLevelId:tracked.triggerLevelId,triggerPrice:tracked.triggerPrice,entryPrice:tracked.shadowEntryPrice,triggeredAt:now,execution:'ADVISORY_ONLY'});}catch{}
      leaderHealthEvent('SHADOW_TRIGGER',{symbol:key,side:tracked.side,triggerTF:tracked.triggerTF,entryPrice:tracked.shadowEntryPrice});
    }
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
      numericTrigger:deterministic?.numericTrigger===true,
      tradeLaneName:tracked.tradeLaneName||deterministic?.tradeLane?.name||null,
      momentumStage:deterministic?.tradeLane?.stage||tracked.momentumStage||null,
      scalpAlignedCount:Number(deterministic?.tradeLane?.lowerAlignedCount??tracked.scalpAlignedCount??0),
      scalpReady:deterministic?.tradeLane?.scalpReady===true||tracked.scalpReady===true,
      main15Ready:deterministic?.tradeLane?.main15Ready===true||tracked.main15Ready===true,
      triggerTF:tracked.triggerTF||null,
      triggerLevelId:tracked.triggerLevelId||null,
      triggerPrice:finite(tracked.triggerPrice),
      triggerClosedPrice:finite(deterministic?.closedPrice),
      invalidationLevelId:tracked.invalidationLevelId||null,
      invalidationPrice:finite(tracked.invalidationPrice),
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

  function workerCandidateFromScan(scan, tracked) {
    const symbol=String(tracked?.symbol||'').toUpperCase();
    const pools=[
      scan?.leaders,scan?.leaderHunters,scan?.top3Approach,scan?.top10Approach,
      scan?.earlyTop5,scan?.earlyExpansion,scan?.gainerCandidates,
      scan?.accumulationCandidates,scan?.attentionCandidates
    ];
    for(const pool of pools){
      const hit=Array.isArray(pool)?pool.find(x=>String(x?.symbol||'').toUpperCase()===symbol):null;
      if(hit)return hit;
    }
    return {symbol,side:tracked?.side||null,deepScanReason:'TRACKED_PLAN_WORKER'};
  }

  async function planWorkerTick() {
    // R2.5.3.2 JEV SOVEREIGN: legacy autonomous plan workers are disabled.
    // Workers run only when JEV PASS-1 explicitly requests evidence.
    if(pipeline?.sovereignFlow===true)return {ok:true,skipped:true,reason:'JEV_SOVEREIGN_WORKERS_ON_DEMAND'};
    if(planWorkerBusy)return {ok:true,skipped:true,reason:'PLAN_WORKER_BUSY'};
    const cfg=readLeaderAutoConfig();
    if(!cfg.ok||cfg.config?.enabled!==true)return {ok:true,skipped:true,reason:'PLAN_WORKER_AUTO_DISABLED'};
    if(await positionSlotsFull(cfg.config.maxOpenPositions))return {ok:true,skipped:true,reason:'PLAN_WORKER_REST_POSITIONS_FULL'};
    const rows=Object.values(leaderAnalysisState.bySymbol||{})
      .filter(workerEligible)
      .sort((a,b)=>Number(a.lastWorkerCheckAt||0)-Number(b.lastWorkerCheckAt||0));
    if(!rows.length)return {ok:true,skipped:true,reason:'PLAN_WORKER_NO_WATCH_PLAN'};
    const now=clock();
    const eligible=rows.filter(x=>!Number(x.lastWorkerCheckAt||0)||now-Number(x.lastWorkerCheckAt||0)>=25000);
    if(!eligible.length)return {ok:true,skipped:true,reason:'PLAN_WORKER_COOLDOWN'};
    const idx=planWorkerCursor%eligible.length;
    const tracked=eligible[idx];
    planWorkerCursor=(idx+1)%Math.max(1,eligible.length);
    planWorkerBusy=true;
    try{
      let scan;
      try{scan=await scanner.scan();}
      catch{return {ok:false,skipped:false,reason:'SCANNER_UNAVAILABLE'};}
      const candidate=workerCandidateFromScan(scan,tracked);
      const out=await reviewTrackedPlan(candidate,scan);
      // CLAUDE_V112_WORKER_SCALP_EVERY_TICK: 1m/3m/5m sayısal tetikli planlar sıra beklemez; her turda
      // (en fazla workerScalpPerTick) kontrol edilir. Sayısal kontrol model/9Router çağırmaz.
      const extraBudget=claudeV111.readConfig().workerScalpPerTick;
      const extras=[];
      if(extraBudget>0){
        const lowerRows=eligible
          .filter(x=>x!==tracked&&x.triggerValid===true&&finite(x.triggerPrice)!==null&&['1m','3m','5m'].includes(String(x.triggerTF||'').toLowerCase()))
          .slice(0,extraBudget);
        for(const row of lowerRows){
          if(!workerEligible(row))continue;
          try{
            const r=await reviewTrackedPlan(workerCandidateFromScan(scan,row),scan);
            extras.push({symbol:row.symbol,state:r?.state||null,reason:r?.reason||null});
          }catch(e){extras.push({symbol:row.symbol,state:'ERROR',reason:String(e?.message||e).slice(0,120)});}
        }
      }
      return {ok:true,...out,extraScalpChecks:extras};
    }catch(e){
      return {ok:false,skipped:false,reason:String(e?.message||e).slice(0,180)};
    }finally{
      planWorkerBusy=false;
    }
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
      .sort((a,b) => {
        const ae=['TRIGGERED','REFRESH_REQUIRED'].includes(String(a.workerState||'').toUpperCase()) &&
          Number(a.workerEscalatedAt||0)>=Number(a.lastAnalyzedAt||0);
        const be=['TRIGGERED','REFRESH_REQUIRED'].includes(String(b.workerState||'').toUpperCase()) &&
          Number(b.workerEscalatedAt||0)>=Number(b.lastAnalyzedAt||0);
        if(ae!==be)return ae?-1:1;
        return Math.max(Number(a.lastAnalyzedAt || 0),Number(a.lastWorkerCheckAt || 0)) -
          Math.max(Number(b.lastAnalyzedAt || 0),Number(b.lastWorkerCheckAt || 0));
      });
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
      // CLAUDE_V112: hızlı hat bu coini tam Vision sürerken ayrıca işlemesin.
      leaderVisionSymbol=String(tracked.symbol||'').toUpperCase();
      let advisory;
      try{
        advisory=await pipeline.run({
          scan,
          store,
          committee,
          executionIntent:{ symbol:tracked.symbol, side:tracked.side, analysisTracking:true }
        });
      }finally{leaderVisionSymbol=null;}
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
    const snapshotStartedAt=clock();
    const valid=x=>x&&/^[A-Z0-9]{1,28}USDT$/.test(x.symbol);
    try{
      await transport._syncServerTime();
      // CLAUDE_V113: /fapi/v3/account pozisyonlarında giriş/mark/likidasyon fiyatı YOK; /fapi/v3/positionRisk
      // (sembolsüz) açık pozisyonları bu alanlarla döndürür. Hata olursa hesap uç noktasına düşülür.
      let rows=null, source='POSITION_RISK_V3';
      try{rows=await transport._fetchJson('GET','/fapi/v3/positionRisk',{credentials:creds,signed:true});}catch{rows=null;}
      if(!Array.isArray(rows)){
        const account=await transport._fetchJson('GET','/fapi/v3/account',{credentials:creds,signed:true});
        if(!Array.isArray(account?.positions))return {ok:false,positions:[],reason:'BINANCE_POSITIONS_FIELD_MISSING',snapshotStartedAt};
        rows=account.positions; source='ACCOUNT_V3';
      }
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
          unrealizedPnl:finite(x?.unRealizedProfit??x?.unrealizedProfit)??0,
          leverage:finite(x?.leverage),
          notional:finite(x?.notional),
          liquidationPrice:finite(x?.liquidationPrice)
        };
      }).filter(valid);
      return {ok:true,positions,source,snapshotStartedAt};
    }catch(e){
      return {ok:false,positions:[],reason:'BINANCE_ACTIVE_POSITIONS_UNAVAILABLE',detail:String(e?.message||e).slice(0,180),snapshotStartedAt};
    }
  }

  // CLAUDE_V113_OUTCOME_LEDGER: kapanan her işlemin gerçek sonucu (Binance income: REALIZED_PNL +
  // COMMISSION + FUNDING_FEE), R çarpanı, çıkış türü ve GİRİŞ NEDENİ beyne (learning_events) ve
  // journal POSITION_CLOSED'a yazılır. Önceden bu adım yalnız Vision boştayken çalışan pozisyon
  // incelemesinin içindeydi ve Vision neredeyse hiç boş olmadığı için hiç çalışmıyordu (12 işlem, 0 sonuç).
  // Tek sahip: positionLedgerTick (tek uçuş). Kapanış = sembol ardışık 2 anlıkta yok; gelir okunamazsa
  // satır ACTIVE kalır ve ≤10 dk yeniden denenir.
  function runnerForRow(row,symbol){
    const r=runnerState.bySymbol?.[symbol]||null;
    if(!r)return null;
    const a=Number(row?.activeAt||0), c=Number(r.createdAt||0);
    return a>0&&c>0&&Math.abs(c-a)<=180000?r:null;
  }
  function classifyExit({ runner, netPnl, riskQuote }) {
    const events = Array.isArray(runner?.events) ? runner.events : [];
    const tp1Reached = Number(runner?.tp1ReachedAt||0)>0 || events.some(e => e?.kind === 'PHASE' && ['TRAILING','BREAKEVEN'].includes(String(e?.to || '').toUpperCase()));
    const trailMoves = Math.max(Number(runner?.stopMoveCount||0), events.filter(e => e?.kind === 'STOP_MOVED').length);
    if (tp1Reached) return netPnl !== null && netPnl > 0 ? (trailMoves > 1 ? 'TP1_RUNNER_TRAIL' : 'TP1_BREAKEVEN') : 'TP1_THEN_STOP';
    if (netPnl !== null && riskQuote && riskQuote > 0 && netPnl <= -0.7 * riskQuote) return 'STOP_LOSS';
    if (netPnl !== null && riskQuote && riskQuote > 0 && netPnl >= 0.9 * riskQuote) return 'TAKE_PROFIT';
    return 'OTHER_CLOSE';
  }
  async function positionIncome(symbol, startTime, endTime, creds) {
    try {
      await transport._syncServerTime();
      const income = await transport._fetchJson('GET', '/fapi/v1/income', {
        params:{ symbol, startTime:Math.max(0, Math.floor(Number(startTime) || 0)), endTime:Math.floor(Number(endTime) || clock()), limit:1000 }, credentials:creds, signed:true
      });
      if (!Array.isArray(income) || income.length >= 1000) return null;
      const sum = t => income.filter(x => String(x?.incomeType || '') === t).reduce((a, x) => a + (finite(x?.income) || 0), 0);
      const realized = sum('REALIZED_PNL'), commission = sum('COMMISSION'), funding = sum('FUNDING_FEE');
      const pnlTimes = income.filter(x => String(x?.incomeType || '') === 'REALIZED_PNL').map(x => Number(x?.time)).filter(Number.isFinite);
      return { realized, commission, funding, net:realized + commission + funding, rows:income.length, lastPnlAt:pnlTimes.length ? Math.max(...pnlTimes) : null, pnlRows:pnlTimes.length };
    } catch { return null; }
  }
  async function recordJevShadowLesson(symbol,record){
    if(typeof lessonJudge!=='function')return null;
    try{
      const lesson=await lessonJudge({symbol,outcome:record});
      if(!lesson?.ok)return lesson||null;
      const payload={
        side:record?.side||null,setup:record?.setup||null,originTF:record?.originTF||null,ownerTF:record?.ownerTF||null,
        setupFamily:record?.entryContext?.setupFamily||null,entryTiming:record?.entryContext?.entryTiming||null,
        edgeBasis:record?.entryContext?.edgeBasis||null,contractVersion:record?.entryContext?.contractVersion||null,
        outcomePct:record?.outcomePct??null,rMultiple:record?.rMultiple??null,
        decision:'SHADOW_LESSON',
        teacher:'JEV',application:'SHADOW_ONLY',selfModify:false,autoPromotion:false,
        lessonFocus:lesson.lessonFocus,evidenceFocus:lesson.evidenceFocus,lessonAction:lesson.lessonAction,scope:lesson.scope
      };
      try{store.recordLearning?.('JEV_LESSON',symbol,payload);}catch{}
      try{store.journal('JEV_LESSON',symbol,payload);}catch{}
      leaderHealthEvent('JEV_LESSON',{symbol,lessonFocus:lesson.lessonFocus,evidenceFocus:lesson.evidenceFocus,lessonAction:lesson.lessonAction,scope:lesson.scope});
      return lesson;
    }catch(e){
      leaderHealthEvent('JEV_LESSON_ERROR',{symbol,reason:String(e?.message||e).slice(0,160)});
      return {ok:false,reason:'JEV_LESSON_ERROR'};
    }
  }

  async function finalizeClosedActiveRows(openPositions, { snapshotStartedAt = clock() } = {}) {
    const openSet=new Set((openPositions||[]).map(x=>x.symbol));
    const creds=currentCredentials();
    if(!credentialsReady(creds))return [];
    const finalized=[];
    for(const [symbol,row] of Object.entries(leaderAnalysisState.bySymbol||{})){
      if(!row||String(row.state||'').toUpperCase()!=='ACTIVE')continue;
      if(openSet.has(symbol)){ if(row.closeMissCount){row.closeMissCount=0;row.closeDetectedAt=null;} continue; }
      // Anlık görüntü alındıktan sonra/çok yakın açılan pozisyon "kapandı" sayılmaz.
      if(Number(row.activeAt||0)>=Number(snapshotStartedAt)-5000)continue;
      row.closeMissCount=Number(row.closeMissCount||0)+1;
      if(!row.closeDetectedAt)row.closeDetectedAt=clock();
      if(row.closeMissCount<2)continue;
      const activeAt=Number(row.activeAt||0);
      const entryAt=Number(row.entryOrderAt||0)||activeAt;
      const startTs=Math.max(0,entryAt>0?entryAt-(row.entryOrderAt?2000:60000):Number(row.lastStateChangeAt||row.detectedAt||0));
      const inc=await positionIncome(symbol,startTs,clock(),creds);
      // Bekleme sırasında satır değişti mi (yeniden giriş / başka tur)? Değiştiyse bu turda dokunma.
      if(leaderAnalysisState.bySymbol?.[symbol]!==row||String(row.state||'').toUpperCase()!=='ACTIVE'||Number(row.activeAt||0)!==activeAt)continue;
      if(!inc&&clock()-Number(row.closeDetectedAt||clock())<10*60000)continue; // gelir okunamadı: 10 dk'ya kadar yeniden dene
      const realizedPnl=inc?inc.realized:null;
      const netPnl=inc?inc.net:null;
      const entry=finite(row.entryPrice),qty=finite(row.quantity),stop=finite(row.stopPrice);
      const base=entry!==null&&qty!==null?Math.abs(entry*qty):null;
      const riskQuote=entry!==null&&qty!==null&&stop!==null?Math.abs(entry-stop)*Math.abs(qty):null;
      const outcomePct=netPnl!==null&&base&&base>0?netPnl/base*100:null;
      const rMultiple=netPnl!==null&&riskQuote&&riskQuote>0?netPnl/riskQuote:null;
      const runner=runnerForRow(row,symbol);
      const exitType=classifyExit({runner,netPnl,riskQuote});
      const closedAt=clock();
      const holdMinutes=activeAt>0?Math.round((closedAt-activeAt)/60000):null;
      const prev=row.state;
      row.state='CLOSED';
      row.reanalysisEligible=false;
      row.executionEligibleNow=false;
      row.closedAt=closedAt;
      row.realizedPnl=realizedPnl;
      row.netPnl=netPnl;
      row.outcomePct=outcomePct;
      row.rMultiple=rMultiple;
      row.exitType=exitType;
      row.lastDetail='BINANCE_POSITION_CLOSED';
      leaderAnalysisState.bySymbol[symbol]=row;
      writeLeaderAnalysisState();
      journalLeaderLifecycle(symbol,prev,'CLOSED',row,'BINANCE_POSITION_CLOSED');
      const record={
        side:row.side,setup:row.setup,originTF:row.originTF,ownerTF:row.ownerTF,tradeLane:row.tradeLaneName||row.entryContext?.lane||null,
        entryPrice:entry,stopPrice:stop,takeProfit1:finite(row.takeProfit1),quantity:qty,notional:base,riskQuote,
        realizedPnl,commission:inc?inc.commission:null,funding:inc?inc.funding:null,netPnl,outcomePct,rMultiple,exitType,
        openedAt:activeAt>0?new Date(activeAt).toISOString():null,closedAt:new Date(closedAt).toISOString(),holdMinutes,
        runner:runner?{phase:runner.phase,tpPlaced:runner.tpPlaced,stopMoves:Math.max(Number(runner.stopMoveCount||0),(runner.events||[]).filter(e=>e?.kind==='STOP_MOVED').length)}:null,
        entryContext:row.entryContext||null,
        eventId:row.eventId||null,
        incomeAvailable:inc!==null
      };
      try{store.journal('POSITION_CLOSED',symbol,record);}catch{}
      try{store.recordLearning?.('POSITION_CLOSED',symbol,{...record,decision:'CLOSED_'+exitType});}catch{}
      await recordJevShadowLesson(symbol,record);
      // Stop olan coine hızlı hat hemen geri girmesin (intikam işlemi yok): veto soğuması kadar.
      if(exitType==='STOP_LOSS'||exitType==='TP1_THEN_STOP'){
        try{fastLaneSeen.set('VETO|'+symbol,closedAt+claudeV111.readConfig().fastLaneVetoCooldownMin*60000);}catch{}
      }
      leaderHealthEvent('POSITION_CLOSED',{symbol,side:row.side,netPnl,rMultiple,exitType});
      finalized.push({symbol,...record});
    }
    return finalized;
  }

  // CLAUDE_V113_POSITION_LEDGER: Vision/Leader meşguliyetinden BAĞIMSIZ, 30 sn'de bir: Binance açık
  // pozisyonları (Office/uygulama için) + kapananların sonuç kaydı. Emir göndermez.
  let ledgerBusy=false;
  let ledgerState={at:null,ok:false,error:null,open:[],lastFinalized:[],source:null};
  async function positionLedgerTick(){
    if(ledgerBusy)return {ok:true,skipped:true,reason:'LEDGER_BUSY'};
    ledgerBusy=true;
    try{
      const open=await exchangeOpenPositions();
      const at=new Date(clock()).toISOString();
      if(!open.ok){ledgerState={...ledgerState,at,ok:false,error:open.reason};return {ok:false,reason:open.reason};}
      const finalized=await finalizeClosedActiveRows(open.positions,{snapshotStartedAt:open.snapshotStartedAt});
      ledgerState={at,ok:true,error:null,open:open.positions,source:open.source||null,lastFinalized:finalized.length?finalized:ledgerState.lastFinalized};
      return {ok:true,open:open.positions.length,finalized:finalized.length};
    }catch(e){
      ledgerState={...ledgerState,ok:false,error:String(e?.message||e).slice(0,160)};
      return {ok:false,reason:ledgerState.error};
    }finally{ledgerBusy=false;}
  }
  // CLAUDE_V113_OUTCOME_BACKFILL: v9.5.113 öncesi açılıp kapanan işlemler (LIVE_EXECUTION journal) için
  // gerçek sonuç Binance income'dan bir kez hesaplanıp beyne yazılır. Aynı eventId iki kez yazılmaz.
  function marketSignatureFromAdvisory(advisory){
    const u=advisory?.unifiedContext||{};
    const f5=u?.frames?.['5m']||{}, f15=u?.frames?.['15m']||{};
    const flow=u?.marketMakerEvidence?.orderFlow||u?.microstructure?.streaming?.orderFlow||{};
    const depth=u?.microstructure||{};
    const d=u?.derivatives||{};
    const liq=u?.liquidationContext||{};
    const pickFrame=f=>({
      trend:f?.trend||null,breakOfStructure:f?.breakOfStructure||null,rsi14:finite(f?.rsi14),atrPct:finite(f?.atrPct),
      swingState:f?.swingStructure?.state||null,patterns:Array.isArray(f?.patterns)?f.patterns.slice(-3):[],
      sweep:f?.liquidity?.sweep||f?.liquidity?.lastSweep||null
    });
    return {
      regime5m:pickFrame(f5),regime15m:pickFrame(f15),
      orderFlow:{available:flow?.available===true,source:flow?.source||null,cvd120s:finite(flow?.cvdQuote120s??flow?.cvd120s??depth?.streaming?.cvdQuote120s)},
      depth:{imbalance:finite(depth?.depth20Imbalance??depth?.streaming?.depth20Imbalance),spreadBps:finite(depth?.spreadBps)},
      derivatives:{oiDeltaPct:finite(d?.openInterest?.delta5mPct??d?.oiDelta5mPct),fundingRate:finite(d?.fundingRate),takerBuySellRatio:finite(d?.takerBuySellRatio)},
      observedLiquidations:{available:liq?.available===true,count:finite(liq?.count),source:liq?.source||null}
    };
  }

  function entryContextFromPlan(plan, jd, sizing){
    const pl=plan||{}; const fl=pl.claudeFastLane||null;
    return {
      why:String(pl.why||'').slice(0,400),waitFor:String(pl.waitFor||'').slice(0,200),setup:pl.setup||null,
      setupFamily:pl.setupFamily||jd?.setupFamily||null,entryTiming:pl.entryTiming||jd?.entryTiming||null,edgeBasis:pl.edgeBasis||jd?.edgeBasis||null,
      contractVersion:pl.contractVersion||null,
      strategyVersion:claudeV112.featureVersion||null,
      releaseContract:'R2541_ATOMIC_TURKISH_SAFE',
      mirrorContract:'R2541_ATOMIC_TURKISH_MIRROR',
      lane:(pl.tradeLane&&typeof pl.tradeLane==='object'?pl.tradeLane.name:pl.tradeLane)||pl.lane||null,
      originTF:pl.originTF||null,ownerTF:pl.ownerTF||null,supportTFs:Array.isArray(pl.supportTFs)?pl.supportTFs.slice(0,9):[],
      source:fl?'FAST_LANE':'VISION_9TF',momentum:Array.isArray(fl?.momentum?.tags)?fl.momentum.tags.slice(0,8):null,
      extension:fl?.extension||null,riskGeometry:fl?.riskGeometry||null,
      jev:jd?{veto:jd.veto===true,summaryTr:String(jd.summaryTr||'').slice(0,200),probabilities:jd.probabilities||null}:null,
      riskPctOfEquity:finite(sizing?.riskPctOfEquity)
    };
  }
  let backfillBusy=false;
  async function backfillClosedOutcomes({ sinceTs = 0, limit = 200 } = {}){
    if(backfillBusy)return {ok:true,skipped:true,reason:'BACKFILL_BUSY'};
    if(typeof store?.recentJournal!=='function')return {ok:false,reason:'STORE_RECENT_JOURNAL_UNAVAILABLE'};
    const creds=currentCredentials();
    if(!credentialsReady(creds))return {ok:false,reason:'BINANCE_CREDENTIALS_REQUIRED'};
    backfillBusy=true;
    const marker=path.join(root,'data','claude-v113-backfill.json');
    let done={};
    try{done=JSON.parse(fs.readFileSync(marker,'utf8'))||{};}catch{done={};}
    const written=[];
    try{
      const open=await exchangeOpenPositions();
      if(!open.ok)return {ok:false,reason:open.reason};
      const openSet=new Set(open.positions.map(p=>p.symbol));
      const execs=store.recentJournal('LIVE_EXECUTION',{limit,sinceTs})
        .filter(x=>x.payload?.result?.orderPlaced===true&&x.symbol).sort((a,b)=>a.ts-b.ts);
      const closedIds=new Set(store.recentJournal('POSITION_CLOSED',{limit:500,sinceTs}).map(x=>x.payload?.eventId).filter(Boolean));
      const runnerRows=store.recentJournal('CLAUDE_V111_RUNNER',{limit:500,sinceTs});
      for(let i=0;i<execs.length;i++){
        const e=execs[i], p=e.payload||{}, r=p.result||{}, sym=e.symbol;
        const eventId=String(p.eventId||r.authorization?.clientOrderId||e.id);
        if(done[eventId]||closedIds.has(eventId))continue;
        const next=execs.slice(i+1).find(x=>x.symbol===sym);
        if(!next&&openSet.has(sym))continue; // hâlâ açık: defter kapanışta yazar
        const endTs=next?next.ts-1000:clock();
        const inc=await positionIncome(sym,e.ts-2000,endTs,creds);
        if(!inc||!inc.pnlRows)continue; // kapanış geliri yok/okunamadı: sonra tekrar denenir
        const ss=p.riskGate?.structuralStop||{};
        const side=String(r.side||p.plan?.side||'').toUpperCase();
        const qty=finite(r.executedQty), entry=finite(ss.entryPrice)??finite(r.livePrice), stop=finite(ss.stopPrice);
        const base=entry!==null&&qty!==null?Math.abs(entry*qty):null;
        const riskQuote=entry!==null&&qty!==null&&stop!==null?Math.abs(entry-stop)*Math.abs(qty):null;
        const netPnl=inc.net;
        const rMultiple=riskQuote&&riskQuote>0?netPnl/riskQuote:null;
        const ev=runnerRows.filter(x=>x.symbol===sym&&x.ts>=e.ts&&x.ts<=endTs).map(x=>({kind:x.payload?.kind,to:x.payload?.to}));
        const exitType=classifyExit({runner:{events:ev},netPnl,riskQuote});
        const closedAt=inc.lastPnlAt||endTs;
        const record={
          side,setup:p.plan?.setup||null,originTF:p.plan?.originTF||null,ownerTF:p.plan?.ownerTF||null,
          tradeLane:(p.plan?.tradeLane&&typeof p.plan.tradeLane==='object'?p.plan.tradeLane.name:p.plan?.tradeLane)||null,
          entryPrice:entry,stopPrice:stop,takeProfit1:null,quantity:qty,notional:base,riskQuote,
          realizedPnl:inc.realized,commission:inc.commission,funding:inc.funding,netPnl,
          outcomePct:base&&base>0?netPnl/base*100:null,rMultiple,exitType,
          openedAt:new Date(e.ts).toISOString(),closedAt:new Date(closedAt).toISOString(),holdMinutes:Math.round((closedAt-e.ts)/60000),
          runner:ev.length?{events:ev.length}:null,
          entryContext:entryContextFromPlan(p.plan,p.plan?.jevDecision,p.sizing),
          eventId,backfilled:true,incomeAvailable:true
        };
        try{store.journal('POSITION_CLOSED',sym,record);}catch{}
        try{store.recordLearning?.('POSITION_CLOSED',sym,{...record,decision:'CLOSED_'+exitType});}catch{}
        await recordJevShadowLesson(sym,record);
        done[eventId]=new Date(clock()).toISOString();
        written.push({symbol:sym,netPnl,rMultiple,exitType});
      }
      try{fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,JSON.stringify(done,null,2));}catch{}
      return {ok:true,written:written.length,rows:written};
    }catch(e){
      return {ok:false,reason:String(e?.message||e).slice(0,160)};
    }finally{backfillBusy=false;}
  }
  function positionsStatus({ closedLimit = 40 } = {}){
    const lifecycle=leaderAnalysisState.bySymbol||{};
    const open=(ledgerState.open||[]).map(p=>{
      const row=lifecycle[p.symbol]||{};
      const rr=runnerState.bySymbol?.[p.symbol]||null;
      const entry=finite(p.entryPrice),mark=finite(p.markPrice),qty=finite(p.quantity);
      const stop=finite(rr&&rr.phase!=='CLOSED'?rr.currentStop:null)??finite(row.stopPrice);
      const firstStop=finite(row.stopPrice)??stop;
      const riskQuote=entry!==null&&firstStop!==null&&qty!==null?Math.abs(entry-firstStop)*qty:null;
      const own=String(row.state||'').toUpperCase()==='ACTIVE';
      return {
        symbol:p.symbol,side:p.side,quantity:qty,entryPrice:entry,markPrice:mark,unrealizedPnl:finite(p.unrealizedPnl),
        unrealizedR:riskQuote&&riskQuote>0&&finite(p.unrealizedPnl)!==null?Number((p.unrealizedPnl/riskQuote).toFixed(2)):null,
        leverage:finite(p.leverage),notional:finite(p.notional),liquidationPrice:finite(p.liquidationPrice),
        stopPrice:stop,originalStopPrice:finite(row.stopPrice),takeProfit1:finite(row.takeProfit1),
        runnerPhase:rr&&rr.phase!=='CLOSED'?rr.phase:null,trailTf:rr?.lastDesired?.trail?.tf||null,
        openedBy:own?'BRAINHUB_AUTO':'EXTERNAL',openedAt:Number(row.activeAt)>0&&own?new Date(Number(row.activeAt)).toISOString():null,
        lane:row.tradeLaneName||row.entryContext?.lane||null,originTF:row.originTF||null,setup:row.setup||null,
        strategyVersion:row.entryContext?.strategyVersion||null,
        releaseContract:row.entryContext?.releaseContract||null,
        mirrorContract:row.entryContext?.mirrorContract||null,
        entryReason:row.entryContext?.why||null
      };
    });
    let closed=[];
    try{closed=typeof store?.recentJournal==='function'?store.recentJournal('POSITION_CLOSED',{limit:closedLimit}):[];}catch{closed=[];}
    const rows=closed.map(x=>({symbol:x.symbol,ts:new Date(x.ts).toISOString(),...x.payload}))
      .filter(x=>x.incomeAvailable!==undefined||Number.isFinite(Number(x.netPnl)))
      .sort((a,b)=>Date.parse(b.closedAt||b.ts)-Date.parse(a.closedAt||a.ts));
    const measured=rows.filter(x=>Number.isFinite(Number(x.netPnl)));
    const wins=measured.filter(x=>Number(x.netPnl)>0).length;
    const net=measured.reduce((a,x)=>a+Number(x.netPnl),0);
    const rs=measured.filter(x=>Number.isFinite(Number(x.rMultiple))).map(x=>Number(x.rMultiple));
    return {
      ok:true,asOf:ledgerState.at,ledgerOk:ledgerState.ok,ledgerError:ledgerState.error,
      open,openCount:open.length,openUnrealizedPnl:Number(open.reduce((a,x)=>a+(Number(x.unrealizedPnl)||0),0).toFixed(4)),
      closed:rows,
      summary:{closed:measured.length,wins,losses:measured.length-wins,winRatePct:measured.length?Number((100*wins/measured.length).toFixed(1)):null,
        netPnl:Number(net.toFixed(4)),avgR:rs.length?Number((rs.reduce((a,b)=>a+b,0)/rs.length).toFixed(2)):null},
      execution:'READ_ONLY'
    };
  }

  function positionManagerStatus() {
    return {
      ok:true,
      busy:positionReviewBusy,
      cadenceMinutes:5,
      execution:'JEV_POSITION_REDUCE_BINDING_WHEN_LIVE_ARMED',
      bindingActions:['EXIT_NOW','PARTIAL_TAKE_PROFIT'],
      advisoryActions:['HOLD','PROTECT_PROFIT'],
      // CLAUDE_V111: bu kural AÇIK POZİSYONDAN ÇIKIŞ içindir; giriş/scalp fırsatlarını engellemez.
      ruleTr:'JEV SOVEREIGN: açık pozisyonda HOLD / kârı koru / kısmi al / EXIT kararını JEV verir. 5m, 15m, 1m/3m timing, akış, likidite ve derivatives kanıttır; sabit 2/3 veya 15m stratejik veto kuralı yoktur. Kod yalnız execution integrity ve hard safety uygular.',
      lastTickAt:positionManagerState.lastTickAt,
      lastError:positionManagerState.lastError,
      lastReview:(ledgerState.ok&&ledgerState.open.length&&(!positionManagerState.lastReview||String(positionManagerState.lastReview?.actionTr||'').includes('YOK')))
        ? {action:'HOLD',actionTr:`AÇIK POZİSYON ${ledgerState.open.length} (defter ${String(ledgerState.at||'').slice(11,19)})`,checkedAt:ledgerState.at}
        : positionManagerState.lastReview,
      history:positionManagerState.history.slice(0,6),
      // CLAUDE_V113_POSITION_LEDGER: Vision'dan bağımsız 30 sn'lik defter.
      ledger:{at:ledgerState.at,ok:ledgerState.ok,error:ledgerState.error,openCount:(ledgerState.open||[]).length,
        open:(ledgerState.open||[]).map(p=>({symbol:p.symbol,side:p.side,quantity:p.quantity,entryPrice:p.entryPrice,markPrice:p.markPrice,unrealizedPnl:p.unrealizedPnl}))}
    };
  }

  async function activePositionReviewTick() {
    if(positionReviewBusy||leaderAutoBusy||executionBusy||leaderFlowBusy)return {ok:true,skipped:true,reason:positionReviewBusy?'POSITION_REVIEW_BUSY':'VISION_PIPELINE_BUSY'};
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
      // CLAUDE_V113: kapanış sonucu artık yalnız positionLedgerTick'te (çift kayıt yok).
      if(!open.positions.length){
        positionManagerState.lastReview={action:'HOLD',actionTr:'AÇIK POZİSYON YOK',checkedAt:new Date(clock()).toISOString()};
        return {ok:true,skipped:true,reason:'NO_OPEN_POSITION'};
      }
      const position=open.positions[positionReviewCursor%open.positions.length];
      positionReviewCursor=(positionReviewCursor+1)%Math.max(1,open.positions.length);
      const reviewArmGeneration=armGeneration;
      const reviewLiveArmedAtStart=armedNow();
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
        try{jevExit=await exitJudge({position,lifecycle,currentPlan:advisory.plan,unified:advisory.unifiedContext,evidence:advisory?.evidence||null});}
        catch(e){jevExit={ok:false,called:true,action:'HOLD_REVIEW',actionTr:'TUT • VERİYİ YENİDEN KONTROL ET',summaryTr:'Jev pozisyon hakemi hata verdi; agresif çıkış kararı uygulanmadı.',reason:'JEV_EXIT_EXCEPTION'};}
      }
      const requestedAction=String(jevExit?.action||'HOLD_REVIEW');
      const action=jevExit?.finalAuthority===true
        ? (['HOLD','PROTECT_PROFIT','PARTIAL_TAKE_PROFIT','EXIT_NOW'].includes(requestedAction)?requestedAction:'HOLD_REVIEW')
        : positionManager.capJevExitAction(requestedAction,assessment);
      const actionTr=positionManager.actionTurkish(action);
      let reasonTr='Büyük resim ve owner yapı korunuyor; pozisyon izleniyor.';
      if(assessment.lowTfNoiseOnly)reasonTr='1m/3m/5m tersliği büyük resim tarafından doğrulanmadı; gürültü/erken uyarı olarak izlendi.';
      if(action==='PROTECT_PROFIT')reasonTr='Pozisyon kârda; düşük/orta zaman dilimi zayıflığı nedeniyle kârı koruma adayı, fakat yapısal çıkış teyidi yok.';
      if(action==='PARTIAL_TAKE_PROFIT')reasonTr='JEV açık pozisyonun bir bölümünü azaltmayı seçti; LIVE açıksa BrainHub-owned pozisyon seçilen oranla reduce-only MARKET azaltılır.';
      if(action==='EXIT_NOW')reasonTr='JEV tezi/invalidation artık pozisyonu taşımayı haklı çıkarmıyor; LIVE açıksa BrainHub-owned pozisyon reduce-only MARKET ile kapatılır.';
      if(action==='HOLD_REVIEW')reasonTr='Veri/kanıt yeterli değil; agresif çıkış uygulanmadı, yeniden analiz bekleniyor.';

      let managementExecution={ok:true,attempted:false,orderPlaced:false,execution:'ADVISORY_ONLY',reason:null};
      const brainOwned=String(existing?.state||'').toUpperCase()==='ACTIVE';
      const bindingReduceAction=jevExit?.finalAuthority===true&&['EXIT_NOW','PARTIAL_TAKE_PROFIT'].includes(action);
      if(bindingReduceAction){
        if(!brainOwned){
          managementExecution={ok:true,attempted:false,orderPlaced:false,execution:'JEV_POSITION_EXTERNAL_ADVISORY_ONLY',reason:'POSITION_NOT_BRAINHUB_OWNED'};
        }else if(!reviewLiveArmedAtStart||!armedNow()){
          managementExecution={ok:true,attempted:false,orderPlaced:false,execution:'JEV_POSITION_WAIT_LIVE_ARM',reason:'LIVE_NOT_ARMED_FOR_POSITION_MANAGEMENT'};
        }else{
          const creds=currentCredentials();
          if(!credentialsReady(creds)){
            managementExecution={ok:false,attempted:false,orderPlaced:false,execution:'JEV_POSITION_REDUCE_BLOCKED',reason:'BINANCE_CREDENTIALS_REQUIRED'};
          }else if(reviewArmGeneration!==armGeneration||!armedNow()){
            managementExecution={ok:false,attempted:false,orderPlaced:false,execution:'JEV_POSITION_REDUCE_BLOCKED',reason:'LIVE_DISARMED_DURING_POSITION_REVIEW'};
          }else{
            const fraction=action==='EXIT_NOW'?1:Math.max(0.01,Math.min(0.99,finite(jevExit?.partialFraction)??(1/3)));
            executionBusy=true;
            try{
              const result=await transport.reducePositionMarket({
                symbol:position.symbol,side:position.side,fraction,credentials:creds,
                reason:action==='EXIT_NOW'?'JEV_EXIT_NOW':'JEV_PARTIAL_TAKE_PROFIT'
              });
              managementExecution={...result,attempted:true,requestedFraction:fraction};
              if(result?.ok===true&&result?.orderPlaced===true){
                if(Number.isFinite(Number(result?.remainingQty)))existing.quantity=Number(result.remainingQty);
                if(result?.fullyClosed===true){
                  const rr=runnerState.bySymbol?.[position.symbol]||null;
                  if(rr){
                    const cleanup=[];
                    for(const ref of runnerOrderRefs(rr)){
                      try{cleanup.push(await transport.cancelAlgoOrder({...ref,credentials:creds}));}catch{}
                    }
                    rr.phase='CLOSED';rr.runnerOrdersLive=false;rr.closedBy=action;rr.closedAt=clock();
                    runnerState.bySymbol[position.symbol]=rr;writeRunnerState();
                    managementExecution.cleanup=cleanup;
                  }
                }
              }
              try{store.journal('JEV_POSITION_EXECUTION',position.symbol,{action,brainOwned,requestedJevAction:requestedAction,fraction,result:managementExecution});}catch{}
            }finally{executionBusy=false;}
          }
        }
      }
      const review={
        symbol:position.symbol,side:position.side,checkedAt:new Date(clock()).toISOString(),
        entryPrice:position.entryPrice,markPrice:position.markPrice,unrealizedPnl:position.unrealizedPnl,
        pnlPct:assessment.pnlPct,originTF:lifecycle.originTF,ownerTF:lifecycle.ownerTF,
        action,actionTr,reasonTr,requestedJevAction:requestedAction,
        jevSummaryTr:String(jevExit?.summaryTr||'').slice(0,360),
        assessment,jev:{called:jevExit?.called===true,ok:jevExit?.ok===true,finalAuthority:jevExit?.finalAuthority===true,model:jevExit?.model||null,mode:jevExit?.mode||null},
        brainOwned,
        execution:managementExecution.execution||'ADVISORY_ONLY',
        orderPlaced:managementExecution.orderPlaced===true,
        managementExecution
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

  // =====================================================================
  // CLAUDE_V111_TRAILING_RUNNER — TP3 yerine iz süren stop.
  // TP1 dolunca stop başabaşa (+ücret), TP2 dolunca kalan runner momentum merdiveninin en yüksek
  // destekleyen TF swing'iyle izlenir; momentum tükenirse 1m swing'e sıkılaşır. Stop asla genişlemez.
  // Orijinal closePosition stop pozisyon açıkken hiç iptal edilmez; yeni stoplar reduce-only'dir.
  // Borsa hatası tekrarlanırsa sabit TP3 yeniden konur (CLAUDE_V111_RUNNER_TP3_FALLBACK).
  // Her kayıt GİRİŞ anındaki moduna göre yönetilir: sonradan config SHADOW/OFF yapılsa da BINDING ile
  // açılmış (TP3'süz) pozisyon korunmaya ve kapanışta temizlenmeye devam eder.
  // =====================================================================
  const runnerFile=path.join(root,'data','claude-v111-runner-state.json');
  let runnerState=(()=>{try{const x=JSON.parse(fs.readFileSync(runnerFile,'utf8'));return x&&typeof x==='object'&&x.bySymbol&&typeof x.bySymbol==='object'?{orphans:[],...x}:{bySymbol:{},orphans:[]};}catch{return {bySymbol:{},orphans:[]};}})();
  let runnerBusy=false;
  let runnerLast=null;
  function writeRunnerState(){
    try{
      fs.mkdirSync(path.dirname(runnerFile),{recursive:true});
      const tmp=runnerFile+'.tmp';
      fs.writeFileSync(tmp,JSON.stringify(runnerState,null,2),'utf8');
      fs.renameSync(tmp,runnerFile);
    }catch{}
  }
  function runnerEvent(row,kind,data={}){
    const ev={at:new Date(clock()).toISOString(),kind,...data};
    // CLAUDE_V113: kalıcı sayaçlar (olay listesi 20 ile sınırlı; uzun iz sürmede PHASE kaybolmasın).
    if(kind==='PHASE'&&['TRAILING','BREAKEVEN'].includes(String(data?.to||'').toUpperCase())&&!row.tp1ReachedAt)row.tp1ReachedAt=clock();
    if(kind==='STOP_MOVED')row.stopMoveCount=Number(row.stopMoveCount||0)+1;
    row.events=[...(Array.isArray(row.events)?row.events:[]),ev].slice(-20);
    try{store.journal('CLAUDE_V111_RUNNER',row.symbol,{kind,mode:row.mode,phase:row.phase,side:row.side,...data});}catch{}
  }
  function runnerBinding(row){return row?.mode==='BINDING'&&row?.runnerOrdersLive===true;}
  function runnerOrderRefs(row){
    // Bu işleme ait (bilinen) tüm koşullu emirler: algoId veya clientAlgoId.
    const refs=[];
    for(const id of [...(row.runnerAlgoIds||[]),...(row.pendingCancel||[]),...(row.tpAlgoIds||[]),row.tp3FallbackAlgoId,row.originalStopAlgoId]){
      if(id!==null&&id!==undefined&&id!=='')refs.push({algoId:String(id)});
    }
    for(const cid of row.unknownClientAlgoIds||[])if(cid)refs.push({clientAlgoId:String(cid)});
    return refs;
  }
  function registerRunner({intent,result,mode}){
    const symbol=String(result?.symbol||intent?.symbol||'').toUpperCase();
    if(!/^[A-Z0-9]{2,28}$/.test(symbol))return null;
    const prev=runnerState.bySymbol?.[symbol];
    if(prev&&prev.phase!=='CLOSED'&&runnerBinding(prev)){
      // Aynı sembolde yeni giriş = eski pozisyon kapanmış; eski emirler artık (inceleme bulgusu #4c).
      runnerState.orphans=[...(Array.isArray(runnerState.orphans)?runnerState.orphans:[]),...runnerOrderRefs(prev).map(r=>({...r,symbol}))].slice(-60);
    }
    const row={
      symbol,
      side:String(result?.side||intent?.side||'').toUpperCase(),
      mode,
      runnerOrdersLive:result?.runner?.enabled===true,
      entryPrice:finite(intent?.entryPrice),
      initialQty:finite(result?.executedQty),
      tpQty:Array.isArray(result?.tpQuantities)?result.tpQuantities.map(finite):null,
      originalStopPrice:finite(intent?.stopPrice),
      originalStopAlgoId:result?.stopAlgoId??null,
      tpAlgoIds:Array.isArray(result?.tpAlgoIds)?result.tpAlgoIds.slice(0,3):[],
      tpPlaced:Number(result?.runner?.tpPlaced||(Array.isArray(result?.tpAlgoIds)?result.tpAlgoIds.length:2))||2,
      takeProfit3:finite(intent?.takeProfit3),
      originTF:String(intent?.originTF||'').toLowerCase(),
      currentStop:finite(intent?.stopPrice),
      shadowStop:null,
      runnerAlgoIds:[],
      runnerStopQty:null,
      pendingCancel:[],
      unknownClientAlgoIds:[],
      phase:'INITIAL',
      failures:0,
      tp3FallbackPlaced:false,
      createdAt:clock(),
      lastActionAt:0,
      events:[]
    };
    runnerState.bySymbol[symbol]=row;
    runnerEvent(row,'REGISTERED',{runnerOrdersLive:row.runnerOrdersLive,entryPrice:row.entryPrice,initialQty:row.initialQty,tpQty:row.tpQty,tpPlaced:row.tpPlaced,originTF:row.originTF});
    writeRunnerState();
    return row;
  }
  function runnerSummary(){
    const rows=Object.values(runnerState.bySymbol||{}).filter(x=>x&&typeof x==='object');
    return {
      mode:claudeV111.readConfig().runnerMode,
      open:rows.filter(x=>x.phase!=='CLOSED').length,
      orphansPending:Array.isArray(runnerState.orphans)?runnerState.orphans.length:0,
      rows:rows.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).slice(0,6).map(x=>({
        symbol:x.symbol,side:x.side,mode:x.mode,phase:x.phase,runnerOrdersLive:x.runnerOrdersLive===true,
        entryPrice:finite(x.entryPrice),currentStop:finite(x.currentStop),shadowStop:finite(x.shadowStop),
        trailTf:x.lastDesired?.trail?.tf||null,lastReason:x.lastDesired?.reason||x.lastDesired?.basis||null,
        failures:Number(x.failures||0),tp3FallbackPlaced:x.tp3FallbackPlaced===true
      })),
      last:runnerLast
    };
  }
  async function cancelRefs(refs,creds){
    const failed=[],done=[];
    for(const r of refs){
      const res=await transport.cancelAlgoOrder({algoId:r.algoId,clientAlgoId:r.clientAlgoId,credentials:creds});
      // -2011 (bilinmeyen/zaten kapanmış emir) de "yok" demektir; tekrar denenmez.
      const gone=res.ok===true||Number(res.exchangeError?.code)===-2011||Number(res.exchangeError?.code)===-2013;
      (gone?done:failed).push(r);
    }
    return {done,failed};
  }
  async function manageRunner(row,cfg,creds){
    const snap=await transport.positionSnapshot({symbol:row.symbol,side:row.side,credentials:creds});
    if(!snap.ok)return {symbol:row.symbol,ok:false,reason:snap.reason};
    const binding=runnerBinding(row);
    if(!(snap.qty>0)){
      row.phase='CLOSED';
      row.closedAt=clock();
      let cleanup=null;
      // Pozisyon kapandı: bu işleme ait artık koşullu emirler sonraki pozisyonu etkilemesin.
      if(binding){
        const c=await cancelRefs(runnerOrderRefs(row),creds);
        cleanup={cancelled:c.done.length,failed:c.failed.length};
        if(c.failed.length)runnerState.orphans=[...(runnerState.orphans||[]),...c.failed.map(r=>({...r,symbol:row.symbol}))].slice(-60);
      }
      runnerEvent(row,'CLOSED',{cleanup});
      return {symbol:row.symbol,ok:true,phase:'CLOSED',action:'CLOSED',cleanup};
    }
    const phase=claudeV111.runnerPhase({initialQty:row.initialQty,tpQty:row.tpQty,remainingQty:snap.qty,stepSize:snap.stepSize,tpPlaced:row.tpPlaced||2});
    if(phase!==row.phase){runnerEvent(row,'PHASE',{from:row.phase,to:phase,remainingQty:snap.qty});row.phase=phase;}
    if(binding&&Array.isArray(row.pendingCancel)&&row.pendingCancel.length){
      const c=await cancelRefs(row.pendingCancel.map(id=>({algoId:id})),creds);
      row.pendingCancel=c.failed.map(r=>r.algoId);
    }
    if(!['BREAKEVEN','TRAILING'].includes(phase))return {symbol:row.symbol,ok:true,phase,action:'NONE'};
    let unified=null;
    if(phase==='TRAILING'){try{unified=await workerUnifiedContext({symbol:row.symbol,side:row.side});}catch{unified=null;}}
    const lane=unified?tradeLanesV111.analyzeTradeLanes(unified,row.side,null):null;
    const currentStop=binding?finite(row.currentStop):(finite(row.shadowStop)??finite(row.originalStopPrice));
    let desired=claudeV111.desiredRunnerStop({
      side:row.side,phase,entryPrice:finite(snap.entryPrice)??row.entryPrice,markPrice:snap.markPrice,
      currentStop,frames:unified?.frames||{},lane,originTF:row.originTF,tickSize:snap.tickSize,config:cfg
    });
    row.lastDesired={...desired,at:new Date(clock()).toISOString()};
    // TP dolunca runner stop miktarı pozisyondan büyük kalmasın (hedge modunda red riski; bulgu #8).
    const tolQty=(finite(snap.stepSize)||0)/2;
    const oversized=binding&&row.runnerAlgoIds?.length>0&&finite(row.runnerStopQty)!==null&&row.runnerStopQty>snap.qty+tolQty;
    if(!desired.ok&&oversized&&finite(row.currentStop)!==null)desired={ok:true,target:finite(row.currentStop),basis:'RESIZE_AFTER_TP_FILL',phase,trail:desired.trail||null};
    if(!desired.ok)return {symbol:row.symbol,ok:true,phase,action:'HOLD',reason:desired.reason};
    if(!binding){
      row.shadowStop=desired.target;
      runnerEvent(row,'SHADOW_STOP',{target:desired.target,basis:desired.basis,trailTf:desired.trail?.tf||null,markPrice:snap.markPrice});
      return {symbol:row.symbol,ok:true,phase,action:'SHADOW',target:desired.target};
    }
    const now=clock();
    if(!oversized&&now-Number(row.lastActionAt||0)<cfg.runnerReplaceCooldownSec*1000)return {symbol:row.symbol,ok:true,phase,action:'COOLDOWN'};
    row.lastActionAt=now;
    const clientAlgoId=('CR'+row.symbol.slice(0,10)+now.toString(36)).slice(0,36);
    const placed=await transport.placeRunnerStop({
      symbol:row.symbol,side:row.side,hedgeMode:snap.hedgeMode,quantity:snap.qty,triggerPrice:desired.target,
      clientAlgoId,credentials:creds
    });
    if(!placed.ok){
      row.failures=Number(row.failures||0)+1;
      // Zaman aşımı: istek gitmiş olabilir; clientAlgoId ile izlenir ve kapanışta iptal edilir (bulgu #4a).
      if(placed.requestSent!==false)row.unknownClientAlgoIds=[...(row.unknownClientAlgoIds||[]),clientAlgoId].slice(-10);
      runnerEvent(row,'STOP_MOVE_FAILED',{target:desired.target,reason:placed.reason,exchangeError:placed.exchangeError||null,failures:row.failures});
      if(row.failures>=cfg.runnerMaxFailuresBeforeTp3&&!row.tp3FallbackPlaced&&finite(row.takeProfit3)!==null){
        const q3=Array.isArray(row.tpQty)?finite(row.tpQty[2]):null;
        const tp=await transport.placeTakeProfit({
          symbol:row.symbol,side:row.side,hedgeMode:snap.hedgeMode,quantity:Number(row.tpPlaced)===1?snap.qty:Math.min(q3??snap.qty,snap.qty),triggerPrice:row.takeProfit3,
          clientAlgoId:('CT'+row.symbol.slice(0,10)+now.toString(36)).slice(0,36),credentials:creds
        });
        row.tp3FallbackPlaced=tp.ok===true;
        row.tp3FallbackAlgoId=tp.algoId??null;
        runnerEvent(row,'TP3_FALLBACK',{ok:tp.ok===true,reason:tp.reason||null});
      }
      return {symbol:row.symbol,ok:false,phase,action:'STOP_MOVE_FAILED',reason:placed.reason};
    }
    const previous=(row.runnerAlgoIds||[]).slice();
    row.runnerAlgoIds=[placed.algoId];
    row.runnerStopQty=snap.qty;
    const from=row.currentStop;
    row.currentStop=desired.target;
    row.failures=0;
    const c=await cancelRefs(previous.map(id=>({algoId:id})),creds);
    // İptal edilemeyen eski runner stop takipte kalır ve sonraki turda yeniden denenir (bulgu #4b).
    row.pendingCancel=[...(row.pendingCancel||[]),...c.failed.map(r=>r.algoId)].slice(-10);
    runnerEvent(row,'STOP_MOVED',{from,to:desired.target,basis:desired.basis,trailTf:desired.trail?.tf||null,algoId:placed.algoId,cancelled:c.done.length,cancelFailed:c.failed.length});
    return {symbol:row.symbol,ok:true,phase,action:'STOP_MOVED',target:desired.target};
  }
  async function runnerTick(){
    const cfg=claudeV111.readConfig();
    const rows=Object.values(runnerState.bySymbol||{}).filter(x=>x&&typeof x==='object'&&x.phase!=='CLOSED');
    const orphans=Array.isArray(runnerState.orphans)?runnerState.orphans:[];
    // OFF yalnız yeni izlemeyi durdurur; BINDING ile açılmış pozisyonlar korunmaya devam eder (bulgu #3).
    const active=cfg.runnerMode==='OFF'?rows.filter(runnerBinding):rows;
    if(!active.length&&!orphans.length)return {ok:true,skipped:true,reason:cfg.runnerMode==='OFF'?'RUNNER_OFF':'RUNNER_NO_POSITION'};
    if(runnerBusy)return {ok:true,skipped:true,reason:'RUNNER_BUSY'};
    const creds=currentCredentials();
    if(!credentialsReady(creds))return {ok:true,skipped:true,reason:'RUNNER_CREDENTIALS_REQUIRED'};
    runnerBusy=true;
    const results=[];
    try{
      if(orphans.length){
        const c=await cancelRefs(orphans.slice(0,10),creds);
        runnerState.orphans=[...c.failed,...orphans.slice(10)];
        results.push({symbol:'*',ok:true,action:'ORPHAN_CLEANUP',cancelled:c.done.length,failed:c.failed.length});
      }
      for(const row of active.slice(0,4)){
        try{results.push(await manageRunner(row,cfg,creds));}
        catch(e){row.lastError=String(e?.message||e).slice(0,200);results.push({symbol:row.symbol,ok:false,reason:row.lastError});}
      }
      // Kapanmış kayıtlar 24 saat sonra temizlenir.
      for(const [k,v] of Object.entries(runnerState.bySymbol||{})){
        if(v?.phase==='CLOSED'&&clock()-Number(v.closedAt||0)>86400000)delete runnerState.bySymbol[k];
      }
      writeRunnerState();
      runnerLast={at:new Date(clock()).toISOString(),results};
      return {ok:true,results};
    }finally{runnerBusy=false;}
  }

  // =====================================================================
  // CLAUDE_V112_SCALP_FAST_LANE + CLAUDE_V112_CONCURRENT_REVALIDATION (20 sn, Vision ile eşzamanlı)
  // 1) Worker'ın kapanmış-mum tetiği gördüğü planlar Vision bitmesini beklemeden yeniden doğrulanır → Jev.
  // 2) Legacy modda momentum fast-lane korunur. JEV SOVEREIGN modda ise bu timer yalnız
  //    radar attention hızlandırıcısıdır; 2/3 TF, hard-15m veto veya scanner yönü stratejik kapı değildir.
  //    JEV PASS-1 kanıtı seçer, PASS-2 LONG/SHORT/WAIT kararını verir.
  // =====================================================================
  function fastLaneRecord(kind,data){
    const ev={at:new Date(clock()).toISOString(),kind,...data};
    fastLaneState.history=[ev,...fastLaneState.history].slice(0,20);
    return ev;
  }
  function fastLaneSummary(){
    const cfg=claudeV111.readConfig();
    return {
      mode:cfg.scalpFastLane,
      busy:fastLaneBusy,
      lastTickAt:fastLaneState.lastTickAt,
      lastSignal:fastLaneState.lastSignal,
      lastResult:fastLaneState.lastResult,
      history:fastLaneState.history.slice(0,8)
    };
  }
  // CLAUDE_V112_POSITION_SLOTS_REST (kullanıcı kuralı): açık pozisyon sayısı panel max'a ulaştıysa
  // yeni giriş analizi yapılmaz — Vision, hızlı hat/Jev ve plan worker'lar dinlenir. Açık pozisyon
  // yönetimi (runner, pozisyon incelemesi, çıkış) sürer. Yer açılınca bir sonraki turda kendiliğinden
  // devam eder. Emir tarafı zaten risk kapısında OPEN_POSITION_CAP_REACHED ile kapalıdır; bu kapı boşa
  // Jev/Vision harcamasını ve dar boğaz gürültüsünü önler. Hesap okunamazsa dinlenmez (analiz sürer,
  // risk kapısı emirde yine korur).
  let slotRest={active:false,since:null,openPositions:null,maxOpenPositions:null,checkedAt:null,skips:0};
  function endRest(reason){
    if(!slotRest.active)return;
    leaderHealthEvent('POSITION_REST',{stage:'END',reason,openPositions:slotRest.openPositions,maxOpenPositions:slotRest.maxOpenPositions});
    try{store.journal('CLAUDE_V112_POSITION_REST',null,{stage:'END',reason,openPositions:slotRest.openPositions,maxOpenPositions:slotRest.maxOpenPositions,since:slotRest.since,skips:slotRest.skips});}catch{}
    slotRest={active:false,since:null,openPositions:slotRest.openPositions,maxOpenPositions:slotRest.maxOpenPositions,checkedAt:new Date(clock()).toISOString(),skips:0};
  }
  async function positionSlotsFull(maxOpenPositions){
    if(claudeV111.readConfig().restWhenPositionsFull!==true){endRest('RULE_OFF');return false;}
    const max=Number(maxOpenPositions);
    if(!Number.isInteger(max)||max<1){endRest('MAX_INVALID');return false;}
    // Ek Binance isteği yok: 30 sn'lik pozisyon defteri (CLAUDE_V113_POSITION_LEDGER) kullanılır; defter
    // 90 sn'den eskiyse dinlenilmez (analiz sürer; emirde risk kapısı yine korur).
    const ledgerAge=ledgerState.at?clock()-Date.parse(ledgerState.at):Infinity;
    if(!ledgerState.ok||!(ledgerAge>=0&&ledgerAge<=90000)){endRest('LEDGER_STALE');return false;}
    const open=(ledgerState.open||[]).length;
    const at=new Date(clock()).toISOString();
    const full=open>=max;
    if(full&&!slotRest.active){
      slotRest={active:true,since:at,openPositions:open,maxOpenPositions:max,checkedAt:at,skips:0};
      leaderHealthEvent('POSITION_REST',{stage:'START',openPositions:open,maxOpenPositions:max});
      try{store.journal('CLAUDE_V112_POSITION_REST',null,{stage:'START',openPositions:open,maxOpenPositions:max});}catch{}
    }else if(!full&&slotRest.active){
      leaderHealthEvent('POSITION_REST',{stage:'END',openPositions:open,maxOpenPositions:max});
      try{store.journal('CLAUDE_V112_POSITION_REST',null,{stage:'END',openPositions:open,maxOpenPositions:max,since:slotRest.since,skips:slotRest.skips});}catch{}
      slotRest={active:false,since:null,openPositions:open,maxOpenPositions:max,checkedAt:at,skips:0};
    }else{
      slotRest={...slotRest,openPositions:open,maxOpenPositions:max,checkedAt:at};
    }
    if(full)slotRest.skips++;
    return full;
  }
  function positionRestStatus(){
    return {enabled:claudeV111.readConfig().restWhenPositionsFull===true,...slotRest};
  }
  async function scalpFastLaneTick(){
    const cfg=claudeV111.readConfig();
    // SHADOW/OFF: Jev çağrılmaz, emir yok. BINDING: Vision'ı beklemeden Jev'e.
    if(cfg.scalpFastLane==='OFF')return {ok:true,skipped:true,reason:'FAST_LANE_OFF'};
    if(fastLaneBusy)return {ok:true,skipped:true,reason:'FAST_LANE_BUSY'};
    fastLaneBusy=true;
    try{
      const la=readLeaderAutoConfig();
      if(!la.ok||la.config?.enabled!==true)return {ok:true,skipped:true,reason:'LEADER_AUTO_DISABLED'};
      if(await positionSlotsFull(la.config.maxOpenPositions))return {ok:true,skipped:true,reason:'FAST_LANE_REST_POSITIONS_FULL',openPositions:slotRest.openPositions,maxOpenPositions:slotRest.maxOpenPositions};
      const generation=armGeneration;
      const now=clock();
      fastLaneState.lastTickAt=Number.isFinite(now)?new Date(now).toISOString():null;
      for(const [k,v] of fastLaneSeen)if(now-Number(v||0)>6*3600000)fastLaneSeen.delete(k);
      fastLaneJevCalls=fastLaneJevCalls.filter(t=>now-t<3600000);
      const binding=cfg.scalpFastLane==='BINDING';
      const jevBudgetOk=fastLaneJevCalls.length<cfg.fastLaneMaxJevPerHour;
      const body={
        requestedMarginQuote:la.config.marginQuote,
        requestedLeverage:la.config.leverage,
        requestedMaxOpenPositions:la.config.maxOpenPositions,
        allowLong:la.config.allowLong,
        allowShort:la.config.allowShort,
        analysisOnly:!armedNow()
      };
      const sideAllowed=side=>(side==='LONG'&&la.config.allowLong)||(side==='SHORT'&&la.config.allowShort);
      const run=async(kind,sym,side,extra)=>{
        fastLaneSymbol=sym;
        fastLaneJevCalls.push(now);
        try{return await executeLeaderExclusive({...body,claudeFastLane:{kind,symbol:sym,side,...extra}},generation);}
        finally{fastLaneSymbol=null;}
      };
      if(pipeline?.sovereignFlow===true){
        // JEV SOVEREIGN fast attention: no 2/3 TF gate, no 15m strategic veto,
        // no scanner-side qualification. Radar only selects which symbol reaches
        // JEV sooner; JEV PASS-1 decides which evidence workers fetch.
        if(!jevBudgetOk)return {ok:true,skipped:true,reason:'JEV_SOVEREIGN_FAST_ATTENTION_HOURLY_CAP'};
        let scan;
        try{scan=await scanner.scan();}catch{return {ok:false,reason:'SCANNER_UNAVAILABLE'};}
        const candidates=selectDeepCandidates(scan,24)
          .filter(c=>/^[A-Z0-9]{1,28}USDT$/.test(String(c?.symbol||'').toUpperCase()))
          .filter(c=>String(leaderAnalysisState.bySymbol?.[String(c?.symbol||'').toUpperCase()]?.state||'').toUpperCase()!=='ACTIVE');
        const cooldownMs=60000;
        const chosen=candidates.find(c=>{
          const sym=String(c?.symbol||'').toUpperCase();
          if(!sym||sym===leaderVisionSymbol)return false;
          const last=Number(fastLaneSeen.get('JEVATTN|'+sym)||0);
          return !last||now-last>=cooldownMs;
        });
        if(!chosen)return {ok:true,skipped:true,reason:'JEV_SOVEREIGN_FAST_ATTENTION_NO_SYMBOL',checked:candidates.length};
        const sym=String(chosen.symbol||'').toUpperCase();
        fastLaneSeen.set('JEVATTN|'+sym,now);
        fastLaneState.lastSignal=fastLaneRecord('JEV_ATTENTION',{symbol:sym,source:chosen.deepScanReason||null,targetSources:Array.isArray(chosen.targetSources)?chosen.targetSources.slice(0,8):[]});
        leaderHealthEvent('FAST_LANE',{fastKind:'JEV_ATTENTION',symbol:sym,applied:true});
        const out=await run('JEV_ATTENTION',sym,null,{});
        fastLaneState.lastResult=fastLaneRecord('RESULT',{symbol:sym,kind:'JEV_ATTENTION',execution:out?.execution||null,orderPlaced:out?.orderPlaced===true,planStatus:out?.plan?.status||null,jevAction:out?.jevDecision?.action||null,reasons:(out?.reasons||[]).slice(0,4)});
        return {ok:true,kind:'JEV_ATTENTION',symbol:sym,result:out};
      }
      const vetoed=out=>String(out?.plan?.reason||'').startsWith('JEV_')||(Array.isArray(out?.reasons)&&out.reasons.some(r=>String(r).startsWith('JEV_')));
      // (1) Tetiği görülmüş Vision planları: Vision'ı beklemeden Jev'e (yalnız BINDING).
      if(binding&&jevBudgetOk&&claudeV109.readConfig().deterministicTriggerMode==='BINDING'){
        for(const row of Object.values(leaderAnalysisState.bySymbol||{})){
          const sym=String(row?.symbol||'').toUpperCase();
          if(!sym||sym===leaderVisionSymbol||!sideAllowed(String(row?.side||'').toUpperCase()))continue;
          const ri=claudeV111.revalidationIntent(row,{now});
          if(!ri)continue;
          const key='REVAL|'+sym+'|'+String(row.workerEscalatedAt||'');
          if(fastLaneSeen.has(key))continue;
          let stored=null;
          try{stored=typeof store?.latestJournal==='function'?store.latestJournal('PLAN',sym):null;}catch{stored=null;}
          if(claudeV111.revalidationPrecheck({stored,intent:ri,now}).ok!==true)continue;
          fastLaneSeen.set(key,now);
          fastLaneState.lastSignal=fastLaneRecord('REVALIDATION',{symbol:sym,side:ri.side,triggerTF:ri.triggerTF,triggerPrice:ri.triggerPrice});
          leaderHealthEvent('FAST_LANE',{fastKind:'REVALIDATION',symbol:sym,side:ri.side,tf:ri.triggerTF});
          const out=await run('REVALIDATION',sym,ri.side,{revalIntent:ri});
          fastLaneState.lastResult=fastLaneRecord('RESULT',{symbol:sym,kind:'REVALIDATION',execution:out?.execution||null,orderPlaced:out?.orderPlaced===true,planStatus:out?.plan?.status||null,reasons:(out?.reasons||[]).slice(0,4)});
          return {ok:true,kind:'REVALIDATION',symbol:sym,result:out};
        }
      }
      // (2) Momentum scalp sinyali.
      let scan;
      try{scan=await scanner.scan();}catch{return {ok:false,reason:'SCANNER_UNAVAILABLE'};}
      const candidates=selectDeepCandidates(scan,16)
        .filter(executionEligible)
        .filter(c=>sideAllowed(String(c?.side||'').toUpperCase()))
        .filter(c=>claudeV111.isMomentumCandidate(c).momentum);
      let checked=0;
      const maxDev=readPolicy(root)?.maxEntryDeviationPct??0.5;
      for(const c of candidates){
        if(checked>=cfg.fastLaneMaxSymbolsPerTick)break;
        const sym=String(c?.symbol||'').toUpperCase();
        if(!sym||sym===leaderVisionSymbol)continue;
        const lastSym=Number(fastLaneSeen.get('SYM|'+sym)||0);
        if(lastSym&&now-lastSym<cfg.fastLaneSymbolCooldownMin*60000)continue;
        const vetoUntil=Number(fastLaneSeen.get('VETO|'+sym)||0);
        if(vetoUntil&&now<vetoUntil)continue;
        if(String(leaderAnalysisState.bySymbol?.[sym]?.state||'').toUpperCase()==='ACTIVE')continue;
        checked++;
        let unified=null;
        try{unified=await workerUnifiedContext(c);}catch{unified=null;}
        if(!unified)continue;
        const sig=claudeV112.scalpFastLaneSignal({candidate:c,unified,maxEntryDeviationPct:maxDev});
        if(!sig.ok)continue;
        // Aynı kırılım (sembol+yön+TF+kapanmış mum) bir kez işlenir; seviye her mumda değiştiği için anahtar mum zamanıdır.
        const key='SIG|'+sym+'|'+sig.side+'|'+sig.tf+'|'+String(sig.asOf||'');
        if(fastLaneSeen.has(key))continue;
        fastLaneSeen.set(key,now);
        fastLaneSeen.set('SYM|'+sym,now);
        const apply=binding&&jevBudgetOk;
        fastLaneState.lastSignal=fastLaneRecord('SCALP_SIGNAL',{symbol:sym,side:sig.side,tf:sig.tf,level:sig.level,livePrice:sig.livePrice,lane:sig.lane?.stage||null,momentum:sig.momentum?.tags||[],mode:cfg.scalpFastLane,jevBudgetOk});
        try{store.journal('CLAUDE_V112_FAST_LANE_SIGNAL',sym,{mode:cfg.scalpFastLane,applied:apply,jevBudgetOk,side:sig.side,tf:sig.tf,ownerTF:sig.ownerTF,level:sig.level,invalidation:sig.invalidation,livePrice:sig.livePrice,closedClose:sig.closedClose,lane:sig.lane,momentum:sig.momentum?.tags||[],chase:sig.chase||null});}catch{}
        leaderHealthEvent('FAST_LANE',{fastKind:'SCALP_SIGNAL',symbol:sym,side:sig.side,tf:sig.tf,applied:apply});
        if(!apply)return {ok:true,kind:'SCALP_SIGNAL',symbol:sym,applied:false,signal:sig,reason:binding?'FAST_LANE_JEV_HOURLY_CAP':'FAST_LANE_SHADOW'};
        const out=await run('SCALP',sym,sig.side,{signal:{...sig,maxEntryDeviationPct:maxDev}});
        if(vetoed(out))fastLaneSeen.set('VETO|'+sym,now+cfg.fastLaneVetoCooldownMin*60000);
        fastLaneState.lastResult=fastLaneRecord('RESULT',{symbol:sym,kind:'SCALP',execution:out?.execution||null,orderPlaced:out?.orderPlaced===true,planStatus:out?.plan?.status||null,reasons:(out?.reasons||[]).slice(0,4)});
        return {ok:true,kind:'SCALP',symbol:sym,result:out};
      }
      return {ok:true,skipped:true,reason:'FAST_LANE_NO_SIGNAL',checked};
    }catch(e){
      fastLaneState.lastResult=fastLaneRecord('ERROR',{reason:String(e?.message||e).slice(0,160)});
      return {ok:false,reason:String(e?.message||e).slice(0,160)};
    }finally{fastLaneBusy=false;}
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
        busy:planWorkerBusy,
        cadenceSec:30,
        parallelWithVision:true,
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

  async function shadowOutcomeTick() {
    const now=clock();
    const rows=Object.values(leaderAnalysisState.bySymbol||{})
      .filter(x=>x&&Number(x.shadowTriggeredAt||0)>0&&finite(x.shadowEntryPrice)!==null)
      .filter(x=>{
        const age=now-Number(x.shadowTriggeredAt||0);
        return (age>=15*60*1000&&finite(x.shadowOutcome15mPct)===null) ||
          (age>=60*60*1000&&finite(x.shadowOutcome60mPct)===null);
      })
      .sort((a,b)=>Number(a.shadowTriggeredAt||0)-Number(b.shadowTriggeredAt||0));
    if(!rows.length)return {ok:true,skipped:true,reason:'NO_SHADOW_OUTCOME_DUE'};
    const row=rows[0];
    try{
      const ticker=await transport._fetchJson('GET','/fapi/v1/ticker/price',{params:{symbol:row.symbol}});
      const price=finite(ticker?.price),entry=finite(row.shadowEntryPrice);
      if(price===null||entry===null||entry<=0)return {ok:false,reason:'SHADOW_PRICE_UNAVAILABLE'};
      const side=String(row.side||'').toUpperCase();
      const outcomePct=(side==='SHORT'?(entry-price)/entry:(price-entry)/entry)*100;
      const age=now-Number(row.shadowTriggeredAt||0);
      let changed=false;
      if(age>=15*60*1000&&finite(row.shadowOutcome15mPct)===null){
        row.shadowOutcome15mPct=Number(outcomePct.toFixed(4));row.shadowOutcome15mAt=now;changed=true;
        try{store.journal('SHADOW_OUTCOME_15M',row.symbol,{side,entryPrice:entry,markPrice:price,outcomePct:row.shadowOutcome15mPct,triggerTF:row.triggerTF,triggerLevelId:row.triggerLevelId});}catch{}
      }
      if(age>=60*60*1000&&finite(row.shadowOutcome60mPct)===null){
        row.shadowOutcome60mPct=Number(outcomePct.toFixed(4));row.shadowOutcome60mAt=now;changed=true;
        try{store.journal('SHADOW_OUTCOME_60M',row.symbol,{side,entryPrice:entry,markPrice:price,outcomePct:row.shadowOutcome60mPct,triggerTF:row.triggerTF,triggerLevelId:row.triggerLevelId});}catch{}
      }
      if(changed){
        leaderAnalysisState.bySymbol[row.symbol]=row;writeLeaderAnalysisState();
        leaderHealthEvent('SHADOW_OUTCOME',{symbol:row.symbol,outcome15mPct:row.shadowOutcome15mPct,outcome60mPct:row.shadowOutcome60mPct});
      }
      return {ok:true,symbol:row.symbol,changed,outcome15mPct:row.shadowOutcome15mPct,outcome60mPct:row.shadowOutcome60mPct};
    }catch(e){
      return {ok:false,reason:'SHADOW_PRICE_UNAVAILABLE',detail:String(e?.message||e).slice(0,160)};
    }
  }

  async function leaderAutoTick() {
    if (leaderAutoBusy) { leaderHealthEvent('SKIP',{reason:'LEADER_AUTO_BUSY'}); return { ok:true, skipped:true, execution:'LEADER_AUTO_BUSY', orderPlaced:false }; }
    if (positionReviewBusy) { leaderHealthEvent('SKIP',{reason:'LEADER_AUTO_BACKGROUND_BUSY'}); return { ok:true, skipped:true, execution:'LEADER_AUTO_BACKGROUND_BUSY', orderPlaced:false }; }
    if (typeof pipeline?.isBusy==='function' && pipeline.isBusy()) { leaderHealthEvent('SKIP',{reason:'LEADER_AUTO_PIPELINE_BUSY'}); return { ok:true, skipped:true, execution:'LEADER_AUTO_PIPELINE_BUSY', orderPlaced:false }; }
    const cfg = readLeaderAutoConfig();
    if (!cfg.ok) return recordLeaderAutoResult({ ok:false, skipped:true, execution:'LEADER_AUTO_CONFIG_INVALID', orderPlaced:false, reasons:cfg.reasons });
    if (!cfg.config.enabled) return recordLeaderAutoResult({ ok:true, skipped:true, execution:'LEADER_AUTO_DISABLED', orderPlaced:false });
    try{await shadowOutcomeTick();}catch{}
    if (await positionSlotsFull(cfg.config.maxOpenPositions)) {
      return recordLeaderAutoResult({ ok:true, skipped:true, execution:'LEADER_AUTO_REST_POSITIONS_FULL', orderPlaced:false, liveAllowed:false,
        reasons:['CLAUDE_V112_POSITION_SLOTS_FULL'], openPositions:slotRest.openPositions, maxOpenPositions:slotRest.maxOpenPositions });
    }
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
      entryReferencePrice:intent.entryReferencePrice,
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

  async function maintenanceMarginRateFor(symbol,notionalQuote,creds) {
    const n=finite(notionalQuote);
    if(n===null||n<=0)return {ok:false,reason:'TRADE_NOTIONAL_INVALID'};
    try{
      await transport._syncServerTime();
      const body=await transport._fetchJson('GET','/fapi/v1/leverageBracket',{
        params:{symbol:String(symbol||'').toUpperCase()},
        credentials:creds,
        signed:true
      });
      const row=Array.isArray(body)?body.find(x=>String(x?.symbol||'').toUpperCase()===String(symbol||'').toUpperCase()):body;
      const brackets=Array.isArray(row?.brackets)?row.brackets:[];
      const bracket=brackets.find(x=>{
        const floor=finite(x?.notionalFloor)??0;
        const cap=finite(x?.notionalCap);
        return n>=floor&&(cap===null||n<=cap);
      }) || brackets.at(-1) || null;
      const rate=finite(bracket?.maintMarginRatio);
      if(rate===null||rate<0||rate>=1)throw new Error('BINANCE_MAINT_MARGIN_RATE_INVALID');
      return {
        ok:true,
        rate,
        bracket:Number(bracket?.bracket)||null,
        notionalFloor:finite(bracket?.notionalFloor),
        notionalCap:finite(bracket?.notionalCap)
      };
    }catch(e){
      return {ok:false,reason:'BINANCE_MAINT_MARGIN_UNAVAILABLE',detail:String(e?.message||e).slice(0,180)};
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
    LIVE_ENTRY_PRICE_REFRESH_FAILED:'emir niyetinden hemen önce canlı fiyat yenilenemedi',
    BINANCE_MAINT_MARGIN_UNAVAILABLE:'Binance bakım marjı kademesi doğrulanamadı; likidasyon güvenliği hesaplanamadı',
    MAINTENANCE_MARGIN_RATE_REQUIRED:'bakım marjı oranı olmadan likidasyon güvenliği doğrulanamaz',
    STOP_BEYOND_LIQUIDATION:'yapısal stop tahmini likidasyon mesafesinin dışında; panel boyutu değiştirilmeden işlem reddedildi',
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
    WORKER_9ROUTER_UNAVAILABLE:'9Router worker ajanları yanıt vermedi; plan güvenli WAIT durumunda tutuluyor',
    WORKER_OUTPUT_INVALID:'worker yanıt şeması geçersiz; kör 9TF yükseltme yapılmıyor',
    WORKER_DECISION_INVALID:'worker kararı geçersiz; plan WAIT durumunda tutuluyor',
    WORKER_ESCALATION_COOLDOWN:'aynı sembol için 15 dakikalık 9TF yükseltme bekleme süresi aktif',
    CLAUDE_V109_TRIGGER_CHASE_TOO_FAR:'fiyat tetik seviyesinden ATR ölçekli kovalama sınırından fazla uzaklaştı; geç giriş yapılmıyor',
    CLAUDE_V109_PRICE_BACK_INSIDE_TRIGGER:'fiyat tetik seviyesinin içine geri döndü; kırılım geçersiz',
    CLAUDE_V109_PRICE_RAN_AWAY_SINCE_ANALYSIS:'analizden bu yana fiyat giriş yönünde çok uzaklaştı; kovalama yapılmıyor',
    CLAUDE_V109_PRICE_MOVED_AGAINST_SINCE_ANALYSIS:'analizden bu yana fiyat ters yönde anlamlı hareket etti; plan yenilenmeli',
    CLAUDE_V109_CHASE_INPUT_INVALID:'kovalama kapısı için fiyat/tetik verisi eksik',
    CLAUDE_V109_DETERMINISTIC_TRIGGER:'kapanmış mumda kabul edilmiş kırılım (Claude v109 deterministik tetik, BINDING modu)',
    WORKER_NUMERIC_TRIGGER_WAIT:'sayısal kapanış tetiği henüz gerçekleşmedi; pahalı 9TF yeniden çalıştırılmıyor',
    WORKER_NUMERIC_TRIGGER_CLOSED:'sayısal kapanış tetiği gerçekleşti; gölge hızlı doğrulama ve sonraki 9TF slotu bekleniyor',
    WORKER_NUMERIC_TRIGGER_FRAME_NOT_FRESH:'sayısal tetik zaman dilimi taze değil; tetik uygulanmadı',
    WORKER_NUMERIC_INVALIDATION_BREACHED:'sayısal invalidation seviyesi kapanışla bozuldu; plan yenilenmeli',
    WORKER_SCALP_SECOND_CONFIRMATION_WAIT:'scalp hattında ikinci alt zaman dilimi teyidi veya 15m karşı-veto temizliği bekleniyor',
    WORKER_SCALP_MOMENTUM_EXHAUSTED:'scalp momentumu alt zaman dilimlerinde tükendi veya 15m sert karşı-yapı oluştu',
    SCALP_MULTI_TF_CONFIRMATION_REQUIRED:'1m/3m/5m tek başına final karar vermez; en az iki alt TF aynı yönde gerekli',
    SCALP_15M_HARD_OPPOSITION:'15m ana bağlamı scalp yönüne sert karşı-veto veriyor',
    MAIN_15M_CONFIRMATION_REQUIRED:'15m ana işlem hattı henüz kapanmış-mum/yapı teyidi üretmedi',
    TRADE_LANE_NOT_READY:'ana 15m veya çoklu-TF scalp hattı henüz hazır değil',
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
      triggerLevelId:String(plan.triggerLevelId || ''),
      triggerTF:String(plan.triggerTF || ''),
      invalidationLevelId:String(plan.invalidationLevelId || ''),
      triggerSpec:plan.triggerSpec || null,
      tradeLane:plan.tradeLane || null,
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
    const sovereignFlow=pipeline?.sovereignFlow===true;
    const rows = (Array.isArray(rawCandidates) ? rawCandidates : []).map(c => {
      const e = executionEligibility(c);
      const side = String(c?.side || '').toUpperCase();
      const directionAllowed = (side === 'LONG' && allowLong) || (side === 'SHORT' && allowShort);
      const symbolValid=/^[A-Z0-9]{1,28}USDT$/.test(String(c?.symbol||'').toUpperCase());
      const reasons = sovereignFlow ? (symbolValid?[]:['INVALID_USDT_PERPETUAL_SYMBOL']) : [...(e.reasons || [])];
      if (!sovereignFlow && !directionAllowed) reasons.push(side === 'LONG' ? 'LONG_DISABLED_BY_USER' : side === 'SHORT' ? 'SHORT_DISABLED_BY_USER' : 'DIRECTION_DISABLED');
      const row = {
        symbol:String(c?.symbol || ''),
        side:side || 'NONE',
        attackRank:finite(c?.attackRank),
        projectedRank:finite(c?.projectedRank),
        leaderState:String(c?.leaderState || ''),
        deepScanReason:String(c?.deepScanReason || ''),
        eligible:sovereignFlow ? symbolValid : (e.eligible && directionAllowed),
        reasons:[...new Set(reasons)],
        warnings:sovereignFlow ? ['SCANNER_ATTENTION_ONLY_JEV_DECIDES'] : [...(e.warnings || [])],
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
    if (executionBusy || leaderFlowBusy) {
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LEADER_AUTO_BUSY', reasons:['LIVE_EXECUTOR_BUSY'] };
    }
    leaderFlowBusy = true;
    const generation = armGeneration;
    try { return await executeLeaderExclusive(body, generation); }
    finally { leaderFlowBusy = false; leaderVisionSymbol = null; }
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

    // CLAUDE_V112_SCALP_FAST_LANE / CONCURRENT_REVALIDATION: hızlı hat aynı akışı kullanır, ama
    // aday seçimi/worker/teşhis sayaçlarına dokunmaz ve tam Vision'a düşmez.
    const fastMode = body?.claudeFastLane && typeof body.claudeFastLane === 'object' ? body.claudeFastLane : null;
    const sovereignFlow=pipeline?.sovereignFlow===true;
    const rawCandidates = selectDeepCandidates(scan, sovereignFlow?24:16);
    if (!fastMode) setLeaderAutoDiagnostics(scan, rawCandidates, allowLong, allowShort);
    reconcileLeaderEligibility(rawCandidates, allowLong, allowShort);

    const candidates = rawCandidates
      .filter(x=>sovereignFlow
        ? /^[A-Z0-9]{1,28}USDT$/.test(String(x?.symbol||'').toUpperCase())
        : executionEligible(x))
      .filter(x => {
        if(sovereignFlow)return true; // scanner side is attention only; JEV may choose LONG or SHORT.
        const side = String(x?.side || '').toUpperCase();
        return (side === 'LONG' && allowLong) || (side === 'SHORT' && allowShort);
      })
      .filter(x => fastMode || String(x?.symbol || '').toUpperCase() !== fastLaneSymbol);
    if (fastMode && !candidates.some(c => String(c?.symbol || '').toUpperCase() === String(fastMode.symbol || '').toUpperCase() && (sovereignFlow || String(c?.side || '').toUpperCase() === String(fastMode.side || '').toUpperCase()))) {
      return { ok:true, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_WAIT', symbol:fastMode.symbol, reasons:[sovereignFlow?'JEV_ATTENTION_SYMBOL_NOT_FOUND':'CLAUDE_V112_FAST_LANE_CANDIDATE_NOT_ELIGIBLE'], fastLane:fastMode.kind };
    }
    if (!candidates.length) {
      leaderAutoCandidateCursor = 0;
      if(sovereignFlow){
        return { ok:true, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_WAIT', reasons:['NO_JEV_ATTENTION_CANDIDATE'], trackedRefresh:null };
      }
      const trackedRefresh = await refreshOneTrackedAnalysis(scan);
      if (trackedRefresh) leaderAutoLastDiagnostics.trackedRefresh=trackedRefresh;
      return { ok:true, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_WAIT', reasons:['NO_ALLOWED_EXECUTION_ELIGIBLE_LEADER'], trackedRefresh };
    }
    const pick = fastMode
      ? (() => { const i = candidates.findIndex(c => String(c?.symbol || '').toUpperCase() === String(fastMode.symbol || '').toUpperCase()); return { candidate:candidates[i], index:i, reason:'CLAUDE_V112_'+String(fastMode.kind || 'FAST') }; })()
      : pickLeaderCandidate(candidates);
    const selectedIndex = pick.index;
    const candidate = pick.candidate;
    if (!fastMode) leaderAutoLastDiagnostics.selectionReason=pick.reason;

    // Primary scanner candidate has priority. When fresh candidates exist this tick
    // performs exactly one deep 9TF analysis; tracked-only refreshes are reserved for
    // the no-fresh-candidate path so Vision throughput is spent on opportunity coverage.
    let trackedRefresh = null;
    const existingLifecycle=leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null;
    if (!existingLifecycle) upsertLeaderLifecycle(candidate,null,'DETECTED','FRESH_SCANNER_SELECTION');
    annotateLeaderDiagnostic(candidate.symbol, 'PIPELINE_SELECTED', [], { selectedIndex, lifecycle:existingLifecycle || leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null });

    const trackedBeforeVision=leaderAnalysisState.bySymbol?.[String(candidate.symbol || '').toUpperCase()] || null;
    if(!sovereignFlow&&!fastMode&&workerEligible(trackedBeforeVision)){
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
    // CLAUDE_V111_TRIGGER_REVALIDATION: worker sayısal kapanış tetiği gördüyse 8 dk'lık Vision yerine
    // saklanan planın hızlı yeniden doğrulaması denenir (geçmezse pipeline tam 9TF'ye döner).
    const revalIntent=fastMode
      ? (fastMode.kind==='REVALIDATION' ? fastMode.revalIntent : null)
      : claudeV111.revalidationIntent(leaderAnalysisState.bySymbol?.[String(candidate.symbol||'').toUpperCase()],{now:clock()});
    const fastIntent=fastMode?.kind==='SCALP'&&fastMode.signal?{...fastMode.signal,side:fastMode.side}:null;
    if(!fastMode)leaderVisionSymbol=String(candidate.symbol||'').toUpperCase();
    try {
      advisory = await pipeline.run({
        scan,
        store,
        committee,
        executionIntent:{
          symbol:candidate.symbol,
          ...(revalIntent?{triggerRevalidation:revalIntent}:{}),
          ...(fastIntent?{scalpFastLane:fastIntent}:{}),
          ...(fastMode?{revalidationOnly:true}:{})
        }
      });
      const analysisEndedAt=Number.isFinite(clock()) ? clock() : Date.now();
      const planStatus=String(advisory?.plan?.status || advisory?.status || 'REVIEW_REQUIRED').toUpperCase();
      const preJevStatus=String(advisory?.preJevPlan?.status || advisory?.plan?.previousStatus || planStatus).toUpperCase();
      const planReason=String(advisory?.plan?.reason || advisory?.reason || '');
      const jevDecision=advisory?.jevDecision || advisory?.plan?.jevDecision || null;
      const jevShadowDecision=advisory?.jevShadowDecision || advisory?.plan?.jevShadowDecision || null;
      const visionUnavailable=planReason==='VISION_COMMITTEE_UNAVAILABLE' || advisory?.committee?.available===false || advisory?.committee?.mode==='unavailable';
      leaderHealthEvent('ANALYSIS',{
        symbol:String(candidate.symbol || ''),
        preJevStatus,
        planStatus,
        tradeLaneName:String(advisory?.plan?.lane || advisory?.plan?.tradeLane?.name || advisory?.preJevPlan?.tradeLane?.name || ''),
        momentumStage:String(advisory?.plan?.tradeLane?.stage || advisory?.preJevPlan?.tradeLane?.stage || ''),
        scalpReady:advisory?.plan?.tradeLane?.scalpReady===true || advisory?.preJevPlan?.tradeLane?.scalpReady===true,
        main15Ready:advisory?.plan?.tradeLane?.main15Ready===true || advisory?.preJevPlan?.tradeLane?.main15Ready===true,
        jevSovereign:advisory?.jevSovereign===true,
        jevPass1Called:advisory?.jevPass1?.called===true,
        jevLaneFocus:advisory?.jevPass1?.laneFocus||null,
        jevDirectionFocus:advisory?.jevPass1?.directionFocus||null,
        jevRequestedEvidence:Array.isArray(advisory?.jevPass1?.requestedEvidence)?advisory.jevPass1.requestedEvidence.slice(0,16):[],
        jevRequestedEvidenceCount:Array.isArray(advisory?.jevPass1?.requestedEvidence)?advisory.jevPass1.requestedEvidence.length:0,
        jevFinalAction:advisory?.jevDecision?.action||null,
        jevEntryTiming:advisory?.jevDecision?.entryTiming||advisory?.plan?.entryTiming||null,
        jevWaitReason:advisory?.jevDecision?.waitReason||advisory?.plan?.waitReason||null,
        jevSetupFamily:advisory?.jevDecision?.setupFamily||advisory?.plan?.setupFamily||null,
        jevCalled:jevDecision?.called===true,
        jevVeto:jevDecision?.veto===true,
        jevReasons:Array.isArray(jevDecision?.vetoReasons)?jevDecision.vetoReasons.slice(0,8):[],
        jevShadowCalled:jevShadowDecision?.called===true,
        jevShadowWouldVeto:jevShadowDecision?.veto===true,
        jevRoleWeightedVeto:jevDecision?.claudeRoleWeighted?.veto===true,
        jevShadowRoleWeightedVeto:jevShadowDecision?.claudeRoleWeighted?.veto===true,
        jevShadowRoleWeightedCalled:Boolean(jevShadowDecision?.claudeRoleWeighted),
        claudeDtWouldQualify:advisory?.plan?.claudeDeterministicTrigger?.wouldQualify===true||advisory?.plan?.claudeDeterministicTrigger?.applied===true,
        claudeDtLane:advisory?.plan?.claudeDeterministicTrigger?.laneName||null,
        claudeRevalidationAttempted:Boolean(revalIntent),
        claudeFastLane:fastMode?String(fastMode.kind||'FAST'):null,
        claudeFastLaneQualified:Boolean(fastMode)&&preJevStatus==='QUALIFIED',
        claudeRevalidated:advisory?.plan?.claudeTriggerRevalidation?.ok===true&&advisory?.committee?.mode==='claude_v111_trigger_revalidation',
        claudeRevalidationReasons:(Array.isArray(advisory?.plan?.claudeTriggerRevalidation?.reasons)&&advisory.plan.claudeTriggerRevalidation.reasons.length?advisory.plan.claudeTriggerRevalidation.reasons:(Array.isArray(advisory?.plan?.claudeTriggerRevalidationShadow?.reasons)?advisory.plan.claudeTriggerRevalidationShadow.reasons:[])).slice(0,8),
        claudeDtApplied:advisory?.plan?.claudeDeterministicTrigger?.applied===true,
        claudeTriggerAutoSelected:advisory?.plan?.triggerSpec?.autoSelected===true,
        claudeNumericWait:advisory?.plan?.waitForRepairedBy==='CLAUDE_V109_NUMERIC_WAIT_FALLBACK',
        jevShadowReasons:Array.isArray(jevShadowDecision?.vetoReasons)?jevShadowDecision.vetoReasons.slice(0,8):[],
        reason:planReason,
        reasons:[...new Set([planReason,...(Array.isArray(jevDecision?.vetoReasons)?jevDecision.vetoReasons:[])].filter(Boolean))],
        durationMs:Math.max(0,analysisEndedAt-analysisStartedAt),
        visionAttached:Number(advisory?.vision?.attached || 0),
        visionRequired:Number(advisory?.vision?.required ?? (advisory?.jevSovereign===true?0:9)),
        visionBatchSize:Number(advisory?.committee?.localVisionBatchSize || 0) || null,
        visionFreeQuotaFallback:advisory?.committee?.mode==='kiro_free_quota_fallback' || advisory?.committee?.visionKiroFreeQuota===true&&advisory?.committee?.localVisionFailed===true,
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

    if (fastMode && (!advisory?.plan || String(advisory.plan.status || '').toUpperCase() !== 'QUALIFIED')) {
      // Hızlı hat: nitelikli değilse (sinyal kayboldu / Jev veto / hat kuralı) takip planı yazılmaz;
      // ana döngü coini normal 9TF akışıyla ele alır.
      const rs=[...new Set([fastMode.kind==='SCALP'?'CLAUDE_V112_FAST_LANE_NOT_QUALIFIED':'CLAUDE_V112_REVALIDATION_NOT_QUALIFIED', advisory?.plan?.reason || advisory?.reason].filter(Boolean))];
      annotateLeaderDiagnostic(candidate.symbol, 'FAST_LANE_NOT_QUALIFIED', rs, visionDiagnosticExtras(advisory));
      if (fastMode.kind==='REVALIDATION' && advisory?.plan && advisory?.unifiedContext) {
        // Jev vetosundan sonra aynı plan tekrar hızlı yola girmesin: yaşam döngüsü güncellenir (latch temizlenir).
        upsertLeaderLifecycle(candidate,advisory,null,'CLAUDE_V112_REVALIDATION_'+String(advisory.plan.status || 'REVIEW_REQUIRED').toUpperCase());
      }
      return { ok:true, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_WAIT', symbol:candidate.symbol, plan:advisory?.plan || null, reasons:rs, fastLane:fastMode.kind };
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
      // CLAUDE_V109_DETERMINISTIC_TRIGGER_SHADOW: kod "QUALIFIED olurdu" dediyse ChatGPT'nin gölge
      // sonuç altyapısına (15m/60m) aynı anda giriş fiyatıyla kaydedilir → 24 saatte isabet ölçülür.
      try{
        const dtShadow=advisory?.plan?.claudeDeterministicTrigger;
        const dtRow=leaderAnalysisState.bySymbol?.[String(candidate.symbol||'').toUpperCase()];
        if(dtShadow?.wouldQualify===true&&dtRow){
          dtRow.claudeDtWouldQualifyAt=clock();
          dtRow.claudeDtWouldQualifyCount=Number(dtRow.claudeDtWouldQualifyCount||0)+1;
          dtRow.claudeDtTf=dtShadow.tf||null;
          dtRow.claudeDtLevel=finite(dtShadow.level);
          if(!Number(dtRow.shadowTriggeredAt||0)&&finite(dtShadow.livePrice)!==null){
            dtRow.shadowTriggeredAt=clock();
            dtRow.shadowEntryPrice=finite(dtShadow.livePrice);
            dtRow.shadowTriggerReason='CLAUDE_V109_DT_WOULD_QUALIFY';
            dtRow.shadowPlanAt=Number(dtRow.shadowPlanAt||0)||clock();
          }
          leaderAnalysisState.bySymbol[String(candidate.symbol||'').toUpperCase()]=dtRow;
          writeLeaderAnalysisState();
          leaderHealthEvent('CLAUDE_DT_SHADOW',{symbol:candidate.symbol,side:advisory.plan.side,tf:dtShadow.tf,level:dtShadow.level});
        }
      }catch{}
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
    // CLAUDE_V112: hızlı scalp planı, emir açılmadıkça Vision'ın WATCH takibini ezmez.
    const fastScalp=fastMode?.kind==='SCALP';
    const qualifiedLifecycle=fastScalp?(leaderAnalysisState.bySymbol?.[String(candidate.symbol||'').toUpperCase()]||null):upsertLeaderLifecycle(candidate,advisory,'ARMED','PLAN_QUALIFIED');
    const completedWorkerLifecycle=(fastScalp?null:finishPlanWorker(candidate.symbol,'PLAN_QUALIFIED_AFTER_FULL_9TF')) || qualifiedLifecycle;
    annotateLeaderDiagnostic(candidate.symbol, 'PLAN_QUALIFIED', [], { ...visionDiagnosticExtras(advisory), lifecycle:completedWorkerLifecycle });
    const bindingJev=advisory?.jevDecision || advisory?.plan?.jevDecision || null;
    const jevFinalAuthority=bindingJev?.called===true && bindingJev?.veto!==true;
    if(jevFinalAuthority){
      leaderHealthEvent('JEV_FINAL_AUTHORITY',{stage:'APPROVED',symbol:candidate.symbol,side:advisory.plan.side});
    }

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

    // Hard safety takes precedence over strategic approval: a disarm/re-arm while
    // analysis is in flight invalidates that generation before any JEV-final handoff.
    if (!armedNow() || generation !== armGeneration) {
      const rs=['LIVE_DISARMED_DURING_PREFLIGHT'];
      annotateLeaderDiagnostic(candidate.symbol,'EXECUTION_RESULT',rs,{execution:'LEADER_AUTO_BLOCKED',orderPlaced:false});
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LEADER_AUTO_BLOCKED', symbol:candidate.symbol, plan:advisory.plan, reasons:rs };
    }

    if (!jevFinalAuthority) {
      const rs=['JEV_FINAL_APPROVAL_REQUIRED'];
      annotateLeaderDiagnostic(candidate.symbol,'INTENT_NOT_READY',rs,{jevDecision:bindingJev});
      return {ok:true,orderPlaced:false,liveAllowed:false,retryable:true,execution:'LEADER_AUTO_WAIT',symbol:candidate.symbol,plan:advisory.plan,reasons:rs};
    }
    const jevSide=String(advisory?.plan?.side||'').toUpperCase();
    if((jevSide==='LONG'&&!allowLong)||(jevSide==='SHORT'&&!allowShort)){
      const rs=[jevSide==='LONG'?'LONG_DISABLED_BY_USER':'SHORT_DISABLED_BY_USER'];
      annotateLeaderDiagnostic(candidate.symbol,'INTENT_NOT_READY',rs,{jevDecision:bindingJev});
      return {ok:true,orderPlaced:false,liveAllowed:false,retryable:false,execution:'LEADER_AUTO_WAIT',symbol:candidate.symbol,plan:advisory.plan,reasons:rs};
    }

    const creds = currentCredentials();
    if (!credentialsReady(creds)) {
      return { ok:false, orderPlaced:false, liveAllowed:false, execution:'LEADER_AUTO_BLOCKED', reasons:['BINANCE_CREDENTIALS_REQUIRED'] };
    }

    const scalpCostGate=['1m','3m','5m'].includes(String(advisory.plan.originTF || '').toLowerCase());
    const finalAuthoritySoftWarnings=[];
    let commissionRate=null;
    let commissionMeta=null;
    if (scalpCostGate) {
      commissionMeta=await takerCommissionRateFor(candidate.symbol,creds);
      if (!commissionMeta.ok) {
        const warning=commissionMeta.reason || 'BINANCE_COMMISSION_RATE_UNAVAILABLE';
        finalAuthoritySoftWarnings.push(warning);
        leaderHealthEvent('JEV_FINAL_AUTHORITY',{stage:'SOFT_WARNING',symbol:candidate.symbol,reason:warning});
      } else {
        commissionRate=commissionMeta.rate;
      }
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

    let freshEntryPrice=null;
    try{
      const ticker=await transport._fetchJson('GET','/fapi/v1/ticker/price',{params:{symbol:candidate.symbol}});
      freshEntryPrice=finite(ticker?.price);
    }catch{}
    if(freshEntryPrice===null||freshEntryPrice<=0){
      const rs=['LIVE_ENTRY_PRICE_REFRESH_FAILED'];
      annotateLeaderDiagnostic(candidate.symbol,'INTENT_NOT_READY',rs);
      return {ok:true,orderPlaced:false,liveAllowed:false,retryable:true,execution:'LEADER_AUTO_WAIT',symbol:candidate.symbol,plan:advisory.plan,reasons:rs};
    }
    // CLAUDE_V109_TRIGGER_CHASE_GATE + CLAUDE_V109_ENTRY_REFERENCE_FRESH:
    // ChatGPT v109 transport sapmasını tetik seviyesine göre %0,5 ile ölçüyordu; kırılım mumu çoğu
    // altcoinde tetikten >%0,5 uzakta kapandığı için bu, girişi sistematik olarak kilitliyordu.
    // Tetikten uzaklık ATR ölçekli ayrı kapıda ölçülür; transport sapması taze fiyata göre ölçülür
    // (intent → gönderim arası kayma koruması).
    const chasePlan=advisory?.plan||{};
    const chaseTf=String(chasePlan?.triggerSpec?.valid===true?chasePlan.triggerSpec.tf:chasePlan.originTF||'').toLowerCase();
    const chase=claudeV109.chaseGate({
      side:chasePlan.side,
      freshPrice:freshEntryPrice,
      analyzedPrice:finite(advisory?.unifiedContext?.livePrice),
      triggerPrice:chasePlan?.triggerSpec?.valid===true?finite(chasePlan.triggerSpec.triggerPrice):null,
      atrPct:finite(advisory?.unifiedContext?.frames?.[chaseTf]?.atrPct),
      maxEntryDeviationPct:policy.maxEntryDeviationPct
    });
    if(!chase.ok){
      const warning=chase.reason||'CLAUDE_V109_CHASE_INPUT_INVALID';
      finalAuthoritySoftWarnings.push(warning);
      leaderHealthEvent('JEV_FINAL_AUTHORITY',{stage:'SOFT_WARNING',symbol:candidate.symbol,reason:warning,chase});
    }
    const requestedNotional=Number(settings.marginQuote)*Number(settings.leverage);
    const maintenance=await maintenanceMarginRateFor(candidate.symbol,requestedNotional,creds);
    if(!maintenance.ok){
      const rs=[maintenance.reason||'BINANCE_MAINT_MARGIN_UNAVAILABLE'];
      annotateLeaderDiagnostic(candidate.symbol,'INTENT_NOT_READY',rs,{maintenanceMargin:maintenance});
      return {ok:true,orderPlaced:false,liveAllowed:false,retryable:true,execution:'LEADER_AUTO_WAIT',symbol:candidate.symbol,plan:advisory.plan,reasons:rs,maintenanceMargin:maintenance};
    }
    const freshUnified={...advisory.unifiedContext,livePrice:freshEntryPrice};
    const entryReferencePrice=freshEntryPrice;
    const intent = buildLeaderLiveIntent({
      candidate,
      unified:freshUnified,
      plan:advisory.plan,
      marginQuote:settings.marginQuote,
      leverage:settings.leverage,
      filters:exchangeFiltersFor(symbolInfo),
      takerCommissionRate:commissionRate,
      entryReferencePrice,
      maintenanceMarginRate:maintenance.rate,
      jevFinalAuthority:true
    });
    intent.analysisEntryPrice=finite(advisory?.unifiedContext?.livePrice);
    intent.freshEntryPrice=freshEntryPrice;
    intent.chase=chase;
    intent.maintenanceMargin=maintenance;
    intent.finalAuthoritySoftWarnings=[...new Set([...(intent.softWarnings||[]),...finalAuthoritySoftWarnings])];
    if (!intent.ok) {
      leaderHealthEvent('JEV_FINAL_AUTHORITY',{stage:'HARD_BLOCK',symbol:candidate.symbol,reasons:intent.reasons||[]});
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
    const enterableLifecycle=fastScalp?qualifiedLifecycle:upsertLeaderLifecycle(candidate,advisory,'ENTERABLE','LIVE_INTENT_READY');
    annotateLeaderDiagnostic(candidate.symbol, 'INTENT_READY', [], {
      lifecycle:enterableLifecycle,
      costModel:intent.costModel || null,
      riskQuote:intent.riskQuote,
      stopDistancePct:intent.stopDistancePct,
      estimatedLiquidationDistancePct:intent.estimatedLiquidationDistancePct,
      entryPrice:intent.entryPrice,
      entryReferencePrice:intent.entryReferencePrice,
      analysisEntryPrice:intent.analysisEntryPrice,
      commission:commissionMeta,
      jevFinalAuthority:true,
      finalAuthoritySoftWarnings:intent.finalAuthoritySoftWarnings
    });
    leaderHealthEvent('JEV_FINAL_AUTHORITY',{stage:'INTENT_BUILT',symbol:candidate.symbol,warnings:intent.finalAuthoritySoftWarnings});

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
    // CLAUDE_V111_TRAILING_RUNNER: giriş anındaki runner modu (BINDING → TP3 yerine iz süren stop).
    const runnerCfgAtEntry=claudeV111.readConfig();
    const runnerModeAtEntry=runnerCfgAtEntry.runnerMode;
    // CLAUDE_V112: emir kilidi kısa sürer (tek emir gönderimi); Jev onaylı işlem düşürülmez, 20 sn beklenir.
    for (let waited=0; executionBusy && waited<20000; waited+=250) await new Promise(r=>setTimeout(r,250));
    if (!armedNow() || generation !== armGeneration) {
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LEADER_AUTO_BLOCKED', symbol:candidate.symbol, plan:advisory.plan, reasons:['LIVE_DISARMED_DURING_PREFLIGHT'] };
    }
    if (executionBusy) {
      annotateLeaderDiagnostic(candidate.symbol,'EXECUTION_RESULT',['LIVE_EXECUTOR_BUSY'],{execution:'LEADER_AUTO_BUSY',orderPlaced:false});
      return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LEADER_AUTO_BUSY', symbol:candidate.symbol, plan:advisory.plan, reasons:['LIVE_EXECUTOR_BUSY'] };
    }
    executionBusy = true;
    let result;
    const entryOrderAt = clock();
    try {
    result = await executeExclusive({
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
        jevDecision:advisory.jevDecision || advisory.plan?.jevDecision || null,
        finalAuthority:true,
        softWarnings:intent.finalAuthoritySoftWarnings
      }
    }, generation, { claudeRunnerMode:runnerModeAtEntry, claudeRunnerShare:runnerCfgAtEntry.runnerShare });
    } finally { executionBusy = false; }
    leaderHealthEvent('EXECUTION_STAGE',{
      stage:result?.orderPlaced===true?'ORDER_PLACED':'EXECUTION_RESULT',
      symbol:intent.symbol,
      orderPlaced:result?.orderPlaced===true,
      reason:Array.isArray(result?.reasons)&&result.reasons.length?String(result.reasons[0]):null
    });
    leaderHealthEvent('JEV_FINAL_AUTHORITY',{
      stage:result?.orderPlaced===true?'ORDER_PLACED':'HARD_BLOCK',
      symbol:intent.symbol,
      reasons:Array.isArray(result?.reasons)?result.reasons:[]
    });

    const executionLifecycle=result?.orderPlaced === true
      ? upsertLeaderLifecycle(candidate,advisory,'ACTIVE','LIVE_ORDER_PLACED')
      : (fastScalp ? qualifiedLifecycle : upsertLeaderLifecycle(candidate,advisory,'ENTERABLE','LIVE_EXECUTION_NO_ORDER:'+String(result?.execution || '')));
    if(result?.orderPlaced===true&&executionLifecycle){
      executionLifecycle.entryPrice=intent.entryPrice;
      executionLifecycle.quantity=intent.quantity;
      executionLifecycle.stopPrice=intent.stopPrice;
      executionLifecycle.takeProfit1=intent.takeProfit1;
      executionLifecycle.takeProfit2=intent.takeProfit2;
      executionLifecycle.takeProfit3=intent.takeProfit3;
      executionLifecycle.activeAt=clock();
      executionLifecycle.entryOrderAt=entryOrderAt;
      executionLifecycle.eventId=eventId;
      executionLifecycle.closeMissCount=0;
      executionLifecycle.closeDetectedAt=null;
      // CLAUDE_V113_OUTCOME_LEDGER: neden girildi — kapanışta sonuçla birlikte beyne yazılır.
      try{
        const pl=advisory?.plan||{};
        const jd=advisory?.jevDecision||pl.jevDecision||null;
        const fl=pl.claudeFastLane||null;
        executionLifecycle.entryContext={
          why:String(pl.why||'').slice(0,400),waitFor:String(pl.waitFor||'').slice(0,200),setup:pl.setup||null,
          setupFamily:pl.setupFamily||jd?.setupFamily||null,entryTiming:pl.entryTiming||jd?.entryTiming||null,edgeBasis:pl.edgeBasis||jd?.edgeBasis||null,
          contractVersion:pl.contractVersion||null,
          strategyVersion:claudeV112.featureVersion||null,
          releaseContract:'R2541_ATOMIC_TURKISH_SAFE',
          mirrorContract:'R2541_ATOMIC_TURKISH_MIRROR',
          lane:(pl.tradeLane&&typeof pl.tradeLane==='object'?pl.tradeLane.name:pl.tradeLane)||pl.lane||null,
          originTF:pl.originTF||null,ownerTF:pl.ownerTF||null,supportTFs:Array.isArray(pl.supportTFs)?pl.supportTFs.slice(0,9):[],
          source:fl?'FAST_LANE':'VISION_9TF',
          momentum:Array.isArray(fl?.momentum?.tags)?fl.momentum.tags.slice(0,8):null,
          extension:fl?.extension||null,riskGeometry:fl?.riskGeometry||null,
          jev:jd?{veto:jd.veto===true,summaryTr:String(jd.summaryTr||'').slice(0,200),probabilities:jd.probabilities||null}:null,
          riskPctOfEquity:finite(result?.sizing?.riskPctOfEquity),
          marketSignature:marketSignatureFromAdvisory(advisory)
        };
      }catch{}
      leaderAnalysisState.bySymbol[String(candidate.symbol||'').toUpperCase()]=executionLifecycle;
      writeLeaderAnalysisState();
      if(result?.stopProtected===true&&runnerModeAtEntry!=='OFF'){
        try{registerRunner({intent,result,mode:runnerModeAtEntry});}catch{}
      }
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
    if (executionBusy || leaderFlowBusy) return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LIVE_BLOCKED', reasons:['LIVE_EXECUTOR_BUSY'] };
    executionBusy = true;
    const generation = armGeneration;
    try { return await executeExclusive(body, generation); }
    finally { executionBusy = false; }
  }

  async function executeExclusive(body = {}, generation, internal = {}) {
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

    const approved=body?.approvedAnalysis && typeof body.approvedAnalysis==='object' ? body.approvedAnalysis : null;
    let scan=null;
    let freshSelection=null;
    if (approved?.finalAuthority!==true) {
      try { scan = await scanner.scan(); }
      catch { return { ok:false, orderPlaced:false, liveAllowed:false, retryable:true, execution:'LIVE_BLOCKED', reasons:['SCANNER_UNAVAILABLE'] }; }
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
      const approvedJev=approved.jevDecision || approvedPlan?.jevDecision || null;
      if (approved?.finalAuthority===true && !(approvedJev?.called===true && approvedJev?.veto!==true)) reuseReasons.push('JEV_FINAL_APPROVAL_INVALID');
      if (approvedAt===null || approvalAgeMs>60000) reuseReasons.push('LEADER_APPROVAL_STALE');
      if (!approvedPlan || approvedPlan.valid!==true || String(approvedPlan.status||'').toUpperCase()!=='QUALIFIED') reuseReasons.push('LEADER_APPROVAL_NOT_QUALIFIED');
      if (!approvedUnified?.dataQuality?.advisoryUsable) reuseReasons.push('LEADER_APPROVAL_CONTEXT_NOT_USABLE');
      if (approvedSymbol!==orderSymbol || approvedSide!==orderSide || String(approvedPlan?.side||'').toUpperCase()!==orderSide) reuseReasons.push('LEADER_APPROVAL_ORDER_MISMATCH');
      if (approved?.finalAuthority!==true && freshSelection?.candidate) {
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

      const preflight=approved?.finalAuthority===true
        ? jevFinalAuthorityPreflight({plan:approvedPlan,unified:approvedUnified})
        : preflightRiskGate({plan:approvedPlan,unified:approvedUnified});
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
      if(approved?.finalAuthority===true){
        const hardReasons=[...new Set([...(riskGate?.reasons||[]),...(executionReadiness?.reasons||[])])];
        try{store.journal('JEV_FINAL_AUTHORITY',String(order?.symbol||'').toUpperCase(),{
          stage:executionReadiness?.ok===true?'HARD_SAFETY_READY':'HARD_BLOCK',
          side:String(order?.side||'').toUpperCase(),
          hardSafetyOnly:true,
          softWarnings:Array.isArray(approved?.softWarnings)?approved.softWarnings:[],
          reasons:hardReasons
        });}catch{}
        leaderHealthEvent('JEV_FINAL_AUTHORITY',{
          stage:executionReadiness?.ok===true?'HARD_SAFETY_READY':'HARD_BLOCK',
          symbol:String(order?.symbol||'').toUpperCase(),
          reasons:hardReasons
        });
      }
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
      livePolicy:{
        expectedLeverage:settings.leverage,
        maxEntryDeviationPct:policy.maxEntryDeviationPct,
        // CLAUDE_V111_TRAILING_RUNNER: yalnız Leader AUTO girişlerinde; mobil manuel emir TP3'lü kalır.
        // İç argüman: HTTP gövdesinden gelemez (inceleme bulgusu #9).
        runnerMode:body?.approvedAnalysis?.source==='LEADER_AUTO_9TF_JEV_APPROVED'?String(internal?.claudeRunnerMode||'OFF'):'OFF',
        runnerShare:String(internal?.claudeRunnerShare||'ONE_THIRD')
      }
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

  return { status, accountSummary, liveReadiness, arm, disarm, execute, executeLeader, configureLeaderAuto, leaderAutoStatus, leaderAutoTick, planWorkerTick, activePositionReviewTick, positionManagerStatus, runnerTick, runnerStatus:runnerSummary, _testRegisterRunner:registerRunner, scalpFastLaneTick, fastLaneStatus:fastLaneSummary, positionLedgerTick, positionsStatus, backfillClosedOutcomes, positionRestStatus, _testState:()=>({leaderAnalysisState,runnerState}), readPolicy:() => publicPolicy(readPolicy(root)) };
}

module.exports = { LIVE_RESOURCE, LIVE_OWNER, normalizePolicy, resolveCredentials, requestedExecutionSettings, applyDynamicSizingGuards, jevFinalAuthorityPreflight, createLiveController };
