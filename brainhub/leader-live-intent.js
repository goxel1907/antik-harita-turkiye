'use strict';

function finite(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function floorStep(value, step) {
  const v = finite(value), s = finite(step);
  if (v === null || s === null || s <= 0) return null;
  return Number((Math.floor((v / s) + 1e-10) * s).toPrecision(15));
}

function ceilStep(value, step) {
  const v = finite(value), s = finite(step);
  if (v === null || s === null || s <= 0) return null;
  return Number((Math.ceil((v / s) - 1e-10) * s).toPrecision(15));
}

function buildLeaderLiveIntent({
  candidate,
  unified,
  plan,
  marginQuote,
  leverage,
  filters,
  takerCommissionRate = null,
  bufferAtrFraction = 0.05,
  bufferBps = 2,
  slippageFloorBpsPerSide = 0.5,
  minimumScalpEdgeMultiple = 1.5
} = {}) {
  const reasons = [];
  const symbol = String(candidate?.symbol || unified?.symbol || '').trim().toUpperCase();
  const candidateSide = String(candidate?.side || '').trim().toUpperCase();
  const side = String(plan?.side || '').trim().toUpperCase();
  const status = String(plan?.status || '').trim().toUpperCase();
  const originTF = String(plan?.originTF || '').trim().toLowerCase();

  if (!/^[A-Z0-9]{1,24}USDT$/.test(symbol)) reasons.push('INTENT_SYMBOL_INVALID');
  if (!['LONG','SHORT'].includes(side)) reasons.push('INTENT_SIDE_INVALID');
  if (candidateSide && candidateSide !== side) reasons.push('CANDIDATE_PLAN_SIDE_MISMATCH');
  if (status !== 'QUALIFIED') reasons.push('PLAN_NOT_QUALIFIED');
  if (!originTF) reasons.push('ORIGIN_TF_REQUIRED');

  const frame = unified?.frames?.[originTF] || null;
  if (!frame?.available || frame?.fresh !== true) reasons.push('ORIGIN_FRAME_NOT_FRESH');

  const scalpCostGate = ['1m','3m','5m'].includes(originTF);
  const takerRate = finite(takerCommissionRate);
  const spreadBps = finite(unified?.microstructure?.spreadBps);
  const micropriceBps = finite(
    unified?.microstructure?.depthSoftContext?.micropriceBps ??
    unified?.microstructure?.streaming?.depthSoftContext?.micropriceBps
  );
  if (scalpCostGate && (takerRate === null || takerRate < 0)) reasons.push('SCALP_COMMISSION_RATE_REQUIRED');
  if (scalpCostGate && (spreadBps === null || spreadBps < 0)) reasons.push('SCALP_SPREAD_COST_REQUIRED');

  const entryPrice = finite(unified?.livePrice);
  if (entryPrice === null || entryPrice <= 0) reasons.push('LIVE_ENTRY_PRICE_INVALID');

  const tickSize = finite(filters?.tickSize);
  const lotStep = finite(filters?.lotStep);
  const minQty = finite(filters?.minQty);
  const maxQty = finite(filters?.maxQty);
  const minNotional = finite(filters?.minNotional);
  if (tickSize === null || tickSize <= 0) reasons.push('TICK_SIZE_REQUIRED');
  if (lotStep === null || lotStep <= 0) reasons.push('LOT_STEP_REQUIRED');
  if (minQty === null || minQty < 0) reasons.push('MIN_QTY_REQUIRED');
  if (maxQty === null || maxQty <= 0) reasons.push('MAX_QTY_REQUIRED');

  const margin = finite(marginQuote);
  const lev = finite(leverage);
  if (margin === null || margin <= 0) reasons.push('MARGIN_QUOTE_INVALID');
  if (lev === null || !Number.isInteger(lev) || lev < 1 || lev > 125) reasons.push('LEVERAGE_INVALID');

  const atrPct = finite(frame?.atrPct);
  const structuralInvalidationPrice = side === 'LONG'
    ? finite(frame?.prior20Low)
    : side === 'SHORT'
      ? finite(frame?.prior20High)
      : null;

  if (structuralInvalidationPrice === null || structuralInvalidationPrice <= 0) {
    reasons.push('STRUCTURAL_INVALIDATION_REQUIRED');
  } else if (entryPrice !== null) {
    if (side === 'LONG' && structuralInvalidationPrice >= entryPrice) reasons.push('LONG_INVALIDATION_NOT_BELOW_ENTRY');
    if (side === 'SHORT' && structuralInvalidationPrice <= entryPrice) reasons.push('SHORT_INVALIDATION_NOT_ABOVE_ENTRY');
  }

  let buffer = null;
  if (entryPrice !== null && tickSize !== null) {
    const atrBuffer = atrPct !== null && atrPct > 0
      ? entryPrice * (atrPct / 100) * Math.max(0, Number(bufferAtrFraction) || 0)
      : 0;
    const bpsBuffer = entryPrice * Math.max(0, Number(bufferBps) || 0) / 10000;
    buffer = Math.max(tickSize, atrBuffer, bpsBuffer);
  }
  if (buffer === null || buffer < 0) reasons.push('STOP_BUFFER_INVALID');

  if (reasons.length) return { ok:false, reasons:[...new Set(reasons)] };

  const structuralBoundary = side === 'LONG'
    ? structuralInvalidationPrice - buffer
    : structuralInvalidationPrice + buffer;

  const stopPrice = side === 'LONG'
    ? floorStep(structuralBoundary, tickSize)
    : ceilStep(structuralBoundary, tickSize);

  if (stopPrice === null || stopPrice <= 0) reasons.push('STOP_PRICE_INVALID');
  if (side === 'LONG' && !(stopPrice < entryPrice && stopPrice <= structuralBoundary)) reasons.push('LONG_STOP_GEOMETRY_INVALID');
  if (side === 'SHORT' && !(stopPrice > entryPrice && stopPrice >= structuralBoundary)) reasons.push('SHORT_STOP_GEOMETRY_INVALID');

  const riskDistance = stopPrice === null ? null : Math.abs(entryPrice - stopPrice);
  if (riskDistance === null || riskDistance <= 0) reasons.push('RISK_DISTANCE_INVALID');

  let takeProfit1 = null, takeProfit2 = null, takeProfit3 = null;
  if (riskDistance !== null && riskDistance > 0) {
    if (side === 'LONG') {
      takeProfit1 = floorStep(entryPrice + riskDistance, tickSize);
      takeProfit2 = floorStep(entryPrice + riskDistance * 2, tickSize);
      takeProfit3 = floorStep(entryPrice + riskDistance * 3, tickSize);
    } else {
      takeProfit1 = ceilStep(entryPrice - riskDistance, tickSize);
      takeProfit2 = ceilStep(entryPrice - riskDistance * 2, tickSize);
      takeProfit3 = ceilStep(entryPrice - riskDistance * 3, tickSize);
    }
  }

  if (side === 'LONG' && !(entryPrice < takeProfit1 && takeProfit1 < takeProfit2 && takeProfit2 < takeProfit3)) {
    reasons.push('LONG_TP_GEOMETRY_INVALID');
  }
  if (side === 'SHORT' && !(entryPrice > takeProfit1 && takeProfit1 > takeProfit2 && takeProfit2 > takeProfit3 && takeProfit3 > 0)) {
    reasons.push('SHORT_TP_GEOMETRY_INVALID');
  }

  const requestedNotional = margin * lev;
  const quantity = floorStep(requestedNotional / entryPrice, lotStep);
  if (quantity === null || quantity <= 0) reasons.push('QUANTITY_INVALID');
  if (quantity !== null && minQty !== null && quantity < minQty) reasons.push('QUANTITY_BELOW_MIN');
  if (quantity !== null && maxQty !== null && quantity > maxQty) reasons.push('QUANTITY_ABOVE_MAX');

  const notionalQuote = quantity === null ? null : quantity * entryPrice;
  if (minNotional !== null && minNotional > 0 && notionalQuote !== null && notionalQuote < minNotional) {
    reasons.push('NOTIONAL_BELOW_MIN');
  }
  const riskQuote = quantity === null || riskDistance === null ? null : quantity * riskDistance;

  const feeBpsPerSide = takerRate !== null && takerRate >= 0 ? takerRate * 10000 : null;
  const feeRoundTripBps = feeBpsPerSide === null ? null : feeBpsPerSide * 2;
  const spreadRoundTripBps = spreadBps !== null && spreadBps >= 0 ? spreadBps : null;
  const slippagePerSideBps = Math.max(
    0,
    Number(slippageFloorBpsPerSide) || 0,
    micropriceBps === null ? 0 : Math.abs(micropriceBps)
  );
  const slippageRoundTripBps = slippagePerSideBps * 2;
  const tp1DistanceBps = takeProfit1 !== null && entryPrice > 0
    ? Math.abs(takeProfit1 - entryPrice) / entryPrice * 10000
    : null;
  const estimatedRoundTripCostBps = feeRoundTripBps !== null && spreadRoundTripBps !== null
    ? feeRoundTripBps + spreadRoundTripBps + slippageRoundTripBps
    : null;
  const costEdgeMultiple = estimatedRoundTripCostBps !== null && estimatedRoundTripCostBps > 0 && tp1DistanceBps !== null
    ? tp1DistanceBps / estimatedRoundTripCostBps
    : null;
  const requiredEdgeMultiple = Math.max(1, Number(minimumScalpEdgeMultiple) || 1.5);
  if (scalpCostGate && estimatedRoundTripCostBps !== null && costEdgeMultiple !== null && costEdgeMultiple < requiredEdgeMultiple) {
    reasons.push('SCALP_COST_EDGE_NOT_VIABLE');
  }
  const costModel = {
    source:'LIVE_USER_COMMISSION_PLUS_CURRENT_MICROSTRUCTURE',
    scalpGateApplied:scalpCostGate,
    takerCommissionRate:takerRate,
    feeBpsPerSide,
    feeRoundTripBps,
    spreadRoundTripBps,
    micropriceBps,
    slippageFloorBpsPerSide:Math.max(0,Number(slippageFloorBpsPerSide)||0),
    estimatedSlippageBpsPerSide:slippagePerSideBps,
    slippageRoundTripBps,
    estimatedRoundTripCostBps,
    tp1DistanceBps,
    costEdgeMultiple,
    minimumScalpEdgeMultiple:requiredEdgeMultiple,
    semantics:'CONSERVATIVE_EXECUTION_COST_VIABILITY'
  };

  if (reasons.length) return {
    ok:false,
    symbol,
    side,
    originTF,
    entryPrice,
    structuralInvalidationPrice,
    buffer,
    stopPrice,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    quantity,
    notionalQuote,
    riskQuote,
    costModel,
    reasons:[...new Set(reasons)]
  };

  return {
    ok:true,
    symbol,
    side,
    originTF,
    entryPrice,
    structuralInvalidationPrice,
    buffer,
    stopPrice,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    quantity,
    requestedMarginQuote:margin,
    requestedLeverage:lev,
    notionalQuote,
    riskQuote,
    costModel,
    reasons:[]
  };
}

module.exports = { finite, floorStep, ceilStep, buildLeaderLiveIntent };
