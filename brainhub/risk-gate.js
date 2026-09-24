'use strict';

const FRAME_ORDER = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function preflightRiskGate({ plan, unified } = {}) {
  const reasons = [];
  const side = String(plan?.side || '').toUpperCase();
  const originTF = String(plan?.originTF || '').toLowerCase();
  const ownerTF = String(plan?.ownerTF || '').toLowerCase();

  if (!plan?.valid) reasons.push('PLAN_INVALID');
  if (plan?.status !== 'QUALIFIED') reasons.push('PLAN_NOT_QUALIFIED');
  if (!['LONG','SHORT'].includes(side)) reasons.push('SIDE_INVALID');
  if (!FRAME_ORDER.includes(originTF)) reasons.push('ORIGIN_TF_INVALID');
  if (!FRAME_ORDER.includes(ownerTF)) reasons.push('OWNER_TF_INVALID');
  if (!unified?.dataQuality?.advisoryUsable) reasons.push('CONTEXT_NOT_USABLE');
  if (finite(unified?.livePrice) === null) reasons.push('LIVE_PRICE_UNAVAILABLE');

  const origin = FRAME_ORDER.includes(originTF) ? unified?.frames?.[originTF] : null;
  const owner = FRAME_ORDER.includes(ownerTF) ? unified?.frames?.[ownerTF] : null;
  if (!origin?.available) reasons.push('ORIGIN_TF_UNAVAILABLE');
  else if (!origin.fresh) reasons.push('ORIGIN_TF_STALE');
  if (!owner?.available) reasons.push('OWNER_TF_UNAVAILABLE');
  else if (!owner.fresh) reasons.push('OWNER_TF_STALE');

  if (FRAME_ORDER.includes(originTF) && FRAME_ORDER.includes(ownerTF) && FRAME_ORDER.indexOf(ownerTF) < FRAME_ORDER.indexOf(originTF)) {
    reasons.push('OWNER_TF_BELOW_ORIGIN');
  }

  // R2.5.3.2 JEV SOVEREIGN: once JEV has made the final strategic choice, this
  // gate checks integrity/freshness only. Opportunity scores, continuity,
  // failed-breakout labels and timeframe alignment are evidence for JEV, not a
  // second strategic vote after JEV.
  if (plan?.jevSovereign === true) {
    const uniqueReasons = [...new Set(reasons)];
    return {
      ok: uniqueReasons.length === 0,
      eligibleForDryRun: uniqueReasons.length === 0,
      liveAllowed: false,
      execution: 'ADVISORY_ONLY',
      finalStrategicAuthority:'JEV',
      strategicRevote:false,
      side: ['LONG','SHORT'].includes(side) ? side : null,
      originTF: FRAME_ORDER.includes(originTF) ? originTF : null,
      ownerTF: FRAME_ORDER.includes(ownerTF) ? ownerTF : null,
      reasons: uniqueReasons,
      remainingMandatoryControls: [
        'ACCOUNT_RISK_CAPS',
        'STRUCTURAL_STOP_AND_NO_WIDEN',
        'LEASE_AND_LINEAGE_CLAIM',
        'KILL_SWITCH',
        'BINANCE_DRY_RUN_EXECUTOR'
      ]
    };
  }

  const path = ['LONG','SHORT'].includes(side) ? unified?.opportunityPaths?.[side] : null;
  const continuity = Array.isArray(path?.continuity) ? path.continuity : [];
  const originPath = continuity.find(x => x?.frame === originTF);
  const ownerPath = continuity.find(x => x?.frame === ownerTF);
  if (!path) reasons.push('SIDE_PATH_MISSING');
  if (FRAME_ORDER.includes(originTF) && !originPath) reasons.push('ORIGIN_NOT_IN_SIDE_PATH');
  else if (originPath && originPath.immediateEligible !== true) reasons.push('ORIGIN_NOT_IMMEDIATELY_ELIGIBLE');
  if (FRAME_ORDER.includes(ownerTF) && !ownerPath) reasons.push('OWNER_NOT_IN_SIDE_PATH');

  const breakoutStatus = origin?.breakoutExecution?.status || null;
  if (breakoutStatus === 'FAILED_BREAKOUT') reasons.push('FAILED_BREAKOUT_REQUIRES_RECLAIM');

  const uniqueReasons = [...new Set(reasons)];
  return {
    ok: uniqueReasons.length === 0,
    eligibleForDryRun: uniqueReasons.length === 0,
    liveAllowed: false,
    execution: 'ADVISORY_ONLY',
    side: ['LONG','SHORT'].includes(side) ? side : null,
    originTF: FRAME_ORDER.includes(originTF) ? originTF : null,
    ownerTF: FRAME_ORDER.includes(ownerTF) ? ownerTF : null,
    reasons: uniqueReasons,
    remainingMandatoryControls: [
      'ACCOUNT_RISK_CAPS',
      'STRUCTURAL_STOP_AND_NO_WIDEN',
      'LEASE_AND_LINEAGE_CLAIM',
      'KILL_SWITCH',
      'BINANCE_DRY_RUN_EXECUTOR'
    ]
  };
}

function accountRiskCaps({ account, intent, limits } = {}) {
  const reasons = [];
  const equity = finite(account?.equity);
  const dailyRealizedPnl = finite(account?.dailyRealizedPnl);
  const openPositions = finite(account?.openPositions);
  const riskQuote = finite(intent?.riskQuote);
  const notionalQuote = finite(intent?.notionalQuote);
  const familyExposureAfterQuote = finite(intent?.familyExposureAfterQuote);
  const family = String(intent?.family || '').trim();

  const maxRiskPctPerTrade = finite(limits?.maxRiskPctPerTrade);
  const maxNotionalPctPerTrade = finite(limits?.maxNotionalPctPerTrade);
  const maxDailyLossPct = finite(limits?.maxDailyLossPct);
  const maxOpenPositions = finite(limits?.maxOpenPositions);
  const maxFamilyExposurePct = finite(limits?.maxFamilyExposurePct);

  if (account?.available !== true) reasons.push('ACCOUNT_UNAVAILABLE');
  if (equity === null || equity <= 0) reasons.push('ACCOUNT_EQUITY_INVALID');
  if (dailyRealizedPnl === null) reasons.push('DAILY_PNL_UNAVAILABLE');
  if (openPositions === null || openPositions < 0 || !Number.isInteger(openPositions)) reasons.push('OPEN_POSITION_COUNT_INVALID');

  if (riskQuote === null || riskQuote <= 0) reasons.push('TRADE_RISK_INVALID');
  if (notionalQuote === null || notionalQuote <= 0) reasons.push('TRADE_NOTIONAL_INVALID');
  if (!family) reasons.push('POSITION_FAMILY_MISSING');
  if (familyExposureAfterQuote === null || familyExposureAfterQuote < 0) reasons.push('FAMILY_EXPOSURE_UNAVAILABLE');

  if (maxRiskPctPerTrade === null || maxRiskPctPerTrade <= 0) reasons.push('MAX_RISK_LIMIT_MISSING');
  if (maxNotionalPctPerTrade === null || maxNotionalPctPerTrade <= 0) reasons.push('MAX_NOTIONAL_LIMIT_MISSING');
  if (maxDailyLossPct === null || maxDailyLossPct <= 0) reasons.push('MAX_DAILY_LOSS_LIMIT_MISSING');
  if (maxOpenPositions === null || maxOpenPositions < 1 || !Number.isInteger(maxOpenPositions)) reasons.push('MAX_OPEN_POSITIONS_LIMIT_MISSING');
  if (maxFamilyExposurePct === null || maxFamilyExposurePct <= 0) reasons.push('MAX_FAMILY_EXPOSURE_LIMIT_MISSING');

  const limitsUsable = equity !== null && equity > 0 &&
    maxRiskPctPerTrade !== null && maxRiskPctPerTrade > 0 &&
    maxNotionalPctPerTrade !== null && maxNotionalPctPerTrade > 0 &&
    maxDailyLossPct !== null && maxDailyLossPct > 0 &&
    maxOpenPositions !== null && maxOpenPositions >= 1 && Number.isInteger(maxOpenPositions) &&
    maxFamilyExposurePct !== null && maxFamilyExposurePct > 0;

  const caps = limitsUsable ? {
    riskQuote: equity * maxRiskPctPerTrade / 100,
    notionalQuote: equity * maxNotionalPctPerTrade / 100,
    dailyLossQuote: equity * maxDailyLossPct / 100,
    openPositions: maxOpenPositions,
    familyExposureQuote: equity * maxFamilyExposurePct / 100
  } : null;

  if (caps) {
    if (riskQuote !== null && riskQuote > caps.riskQuote) reasons.push('TRADE_RISK_CAP_EXCEEDED');
    if (notionalQuote !== null && notionalQuote > caps.notionalQuote) reasons.push('TRADE_NOTIONAL_CAP_EXCEEDED');
    if (dailyRealizedPnl !== null && Math.max(0, -dailyRealizedPnl) >= caps.dailyLossQuote) reasons.push('DAILY_LOSS_CAP_REACHED');
    if (openPositions !== null && openPositions >= caps.openPositions) reasons.push('OPEN_POSITION_CAP_REACHED');
    if (familyExposureAfterQuote !== null && familyExposureAfterQuote > caps.familyExposureQuote) reasons.push('FAMILY_EXPOSURE_CAP_EXCEEDED');
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    ok: uniqueReasons.length === 0,
    eligibleForDryRun: uniqueReasons.length === 0,
    liveAllowed: false,
    execution: 'ADVISORY_ONLY',
    family: family || null,
    metrics: {
      equity,
      dailyRealizedPnl,
      openPositions,
      riskQuote,
      notionalQuote,
      familyExposureAfterQuote
    },
    limits: {
      maxRiskPctPerTrade,
      maxNotionalPctPerTrade,
      maxDailyLossPct,
      maxOpenPositions,
      maxFamilyExposurePct
    },
    caps,
    reasons: uniqueReasons
  };
}

function structuralStopGate({
  side,
  entryPrice,
  stopPrice,
  structuralInvalidationPrice,
  bufferQuote = 0,
  initialStopPrice = null
} = {}) {
  const reasons = [];
  const normalizedSide = String(side || '').toUpperCase();
  const entry = finite(entryPrice);
  const stop = finite(stopPrice);
  const invalidation = finite(structuralInvalidationPrice);
  const buffer = finite(bufferQuote);
  const initialProvided = initialStopPrice !== null && initialStopPrice !== undefined;
  const initialStop = initialProvided ? finite(initialStopPrice) : null;

  if (!['LONG','SHORT'].includes(normalizedSide)) reasons.push('SIDE_INVALID');
  if (entry === null || entry <= 0) reasons.push('ENTRY_PRICE_INVALID');
  if (stop === null || stop <= 0) reasons.push('STOP_PRICE_INVALID');
  if (invalidation === null || invalidation <= 0) reasons.push('STRUCTURAL_INVALIDATION_INVALID');
  if (buffer === null || buffer < 0) reasons.push('STOP_BUFFER_INVALID');
  if (initialProvided && (initialStop === null || initialStop <= 0)) reasons.push('INITIAL_STOP_INVALID');

  let structuralBoundary = null;
  if (normalizedSide === 'LONG' && entry !== null && invalidation !== null && buffer !== null) {
    structuralBoundary = invalidation - buffer;
    if (invalidation >= entry) reasons.push('INVALIDATION_NOT_BELOW_ENTRY');
    if (stop !== null && stop >= entry) reasons.push('STOP_NOT_BELOW_ENTRY');
    if (stop !== null && stop > structuralBoundary) reasons.push('STOP_INSIDE_STRUCTURAL_INVALIDATION');
    if (initialStop !== null && stop !== null && stop < initialStop) reasons.push('STOP_WOULD_WIDEN_RISK');
  }
  if (normalizedSide === 'SHORT' && entry !== null && invalidation !== null && buffer !== null) {
    structuralBoundary = invalidation + buffer;
    if (invalidation <= entry) reasons.push('INVALIDATION_NOT_ABOVE_ENTRY');
    if (stop !== null && stop <= entry) reasons.push('STOP_NOT_ABOVE_ENTRY');
    if (stop !== null && stop < structuralBoundary) reasons.push('STOP_INSIDE_STRUCTURAL_INVALIDATION');
    if (initialStop !== null && stop !== null && stop > initialStop) reasons.push('STOP_WOULD_WIDEN_RISK');
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    ok: uniqueReasons.length === 0,
    eligibleForDryRun: uniqueReasons.length === 0,
    liveAllowed: false,
    execution: 'ADVISORY_ONLY',
    mode: initialProvided ? 'HANDOFF' : 'INITIAL',
    side: ['LONG','SHORT'].includes(normalizedSide) ? normalizedSide : null,
    entryPrice: entry,
    stopPrice: stop,
    structuralInvalidationPrice: invalidation,
    bufferQuote: buffer,
    structuralBoundary,
    initialStopPrice: initialStop,
    riskDistanceQuote: entry !== null && stop !== null ? Math.abs(entry - stop) : null,
    reasons: uniqueReasons
  };
}

function killSwitchGate({ control } = {}) {
  const reasons = [];
  const available = control?.available === true;
  const tripped = typeof control?.tripped === 'boolean' ? control.tripped : null;
  const dryRunEnabled = typeof control?.dryRunEnabled === 'boolean' ? control.dryRunEnabled : null;

  if (!available) reasons.push('KILL_SWITCH_UNAVAILABLE');
  if (tripped === null) reasons.push('KILL_SWITCH_STATE_UNKNOWN');
  else if (tripped) reasons.push('KILL_SWITCH_TRIPPED');
  if (dryRunEnabled === null) reasons.push('DRY_RUN_SWITCH_STATE_UNKNOWN');
  else if (!dryRunEnabled) reasons.push('DRY_RUN_DISABLED');

  const uniqueReasons = [...new Set(reasons)];
  return {
    ok: uniqueReasons.length === 0,
    eligibleForDryRun: uniqueReasons.length === 0,
    liveAllowed: false,
    execution: 'ADVISORY_ONLY',
    state: {
      available,
      tripped,
      dryRunEnabled
    },
    reasons: uniqueReasons
  };
}

function executionClaimGate({ claim } = {}) {
  const reasons = [];
  const claimKnown = typeof claim?.claimed === 'boolean';
  const claimed = claimKnown ? claim.claimed : null;
  const lineageId = typeof claim?.lineageId === 'string' && claim.lineageId.trim() ? claim.lineageId.trim() : null;
  const rejectReason = typeof claim?.reason === 'string' ? claim.reason : null;

  if (!claimKnown) {
    reasons.push('EXECUTION_CLAIM_STATE_UNKNOWN');
  } else if (!claimed) {
    if (rejectReason === 'NO_VALID_LEASE') reasons.push('NO_VALID_LEASE');
    else if (rejectReason === 'DUPLICATE') reasons.push('DUPLICATE_EVENT_CLAIM');
    else if (rejectReason === 'DUPLICATE_LINEAGE') reasons.push('DUPLICATE_LINEAGE_CLAIM');
    else reasons.push('EXECUTION_CLAIM_REJECTED');
  }
  if (claimed && !lineageId) reasons.push('LINEAGE_ID_MISSING');

  const uniqueReasons = [...new Set(reasons)];
  return {
    ok: uniqueReasons.length === 0,
    eligibleForDryRun: uniqueReasons.length === 0,
    liveAllowed: false,
    execution: 'ADVISORY_ONLY',
    claimed,
    lineageId,
    rejectReason,
    reasons: uniqueReasons
  };
}

module.exports = { FRAME_ORDER, preflightRiskGate, accountRiskCaps, structuralStopGate, killSwitchGate, executionClaimGate };
