'use strict';

const FRAME_ORDER = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];

function finite(v) {
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

module.exports = { FRAME_ORDER, preflightRiskGate };
