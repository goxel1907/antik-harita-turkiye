'use strict';

const { pickCandidate, selectDeepCandidates, executionEligible } = require('./leader-committee');
const { symbolContext, globalContext, chartContext, renderChartPng } = require('./market');
const { breakoutExecution } = require('./engine');
const { preflightRiskGate, accountRiskCaps, structuralStopGate, killSwitchGate, executionClaimGate } = require('./risk-gate');
const { buildDryRunOrder } = require('./binance-dry-run-executor');

const FRAME_ORDER = ['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
const FRAME_MS = {
  '1m': 60e3, '3m': 3 * 60e3, '5m': 5 * 60e3,
  '15m': 15 * 60e3, '30m': 30 * 60e3, '45m': 45 * 60e3,
  '1h': 60 * 60e3, '4h': 4 * 60 * 60e3, '1d': 24 * 60 * 60e3
};

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolveExecutionCandidate(scan, executionIntent = null) {
  const requestedSymbol = String(executionIntent?.symbol || '').trim().toUpperCase();
  if (!requestedSymbol) {
    const candidate = pickCandidate(scan);
    return {
      candidate,
      requestedSymbol:null,
      targeted:false,
      reason:candidate ? null : 'NO_QUALIFIED_EARLY_EXPANSION'
    };
  }

  const pool = selectDeepCandidates(scan, 16);
  const candidate = pool.find(x => String(x?.symbol || '').trim().toUpperCase() === requestedSymbol) || null;
  if (!candidate) {
    return {
      candidate:null,
      requestedSymbol,
      targeted:true,
      reason:'REQUESTED_SYMBOL_NOT_IN_DEEP_SCAN'
    };
  }
  if (!executionEligible(candidate)) {
    return {
      candidate:null,
      requestedSymbol,
      targeted:true,
      reason:'REQUESTED_SYMBOL_NOT_EXECUTION_ELIGIBLE'
    };
  }
  return { candidate, requestedSymbol, targeted:true, reason:null };
}
function frameFresh(frame, f, now) {
  if (!f?.available || !Number.isFinite(Number(f.asOf))) return false;
  const maxAge = Math.max(120000, Math.round((FRAME_MS[frame] || 15 * 60e3) * 2.2));
  return now >= Number(f.asOf) && now - Number(f.asOf) <= maxAge;
}
function breakoutState(f, livePrice) {
  if (!f?.available || !f.breakOfStructure) return { status:'NO_ACTIVE_BREAKOUT', allowed:null };
  if (!Number.isFinite(livePrice)) return { status:'LIVE_PRICE_UNAVAILABLE', allowed:false };
  if (f.breakOfStructure === 'UP') return breakoutExecution({ side:'LONG', confirmedClose:f.close, trigger:f.prior20High, livePrice });
  if (f.breakOfStructure === 'DOWN') return breakoutExecution({ side:'SHORT', confirmedClose:f.close, trigger:f.prior20Low, livePrice });
  return { status:'NO_ACTIVE_BREAKOUT', allowed:null };
}
function summarizeFrame(frame, f, now, livePrice) {
  if (!f?.available) return { available:false, reason:f?.reason || 'UNAVAILABLE' };
  const executionState = breakoutState(f, livePrice);
  return {
    available:true,
    frame,
    fresh:frameFresh(frame, f, now),
    asOf:f.asOf,
    close:f.close,
    trend:f.trend,
    rsi14:f.rsi14,
    atrPct:f.atrPct,
    breakOfStructure:f.breakOfStructure,
    prior20High:f.prior20High,
    prior20Low:f.prior20Low,
    returnPct:f.returnPct,
    candle:f.candle || null,
    patterns:Array.isArray(f.patterns) ? f.patterns.slice(-6) : [],
    liquidity:{
      buySide:f.buySideLiquidity,
      sellSide:f.sellSideLiquidity,
      equalHigh:f.liquidity?.equalHigh || null,
      equalLow:f.liquidity?.equalLow || null,
      lastSweep:f.liquidity?.lastSweep || null,
      fairValueGaps:Array.isArray(f.recentFairValueGaps) ? f.recentFairValueGaps.slice(-3) : []
    },
    opportunity:f.opportunity?.available ? {
      state:f.opportunity.state,
      preferredSide:f.opportunity.preferredSide,
      longScore:finite(f.opportunity.longScore) ?? 0,
      shortScore:finite(f.opportunity.shortScore) ?? 0,
      originEligible:f.opportunity.originEligible !== false,
      ownerEligible:f.opportunity.ownerEligible !== false
    } : { available:false, reason:f.opportunity?.reason || 'NO_OPPORTUNITY_CONTEXT' },
    breakoutExecution:executionState
  };
}
function sidePath(frames, side) {
  const scoreKey = side === 'LONG' ? 'longScore' : 'shortScore';
  const continuity = [];
  for (const frame of FRAME_ORDER) {
    const f = frames[frame];
    if (!f?.available || !f.fresh || f.opportunity?.available === false) continue;
    const score = finite(f.opportunity?.[scoreKey]) ?? 0;
    if (score < 45) continue;
    const failed = f.breakoutExecution?.status === 'FAILED_BREAKOUT' &&
      ((side === 'LONG' && f.breakOfStructure === 'UP') || (side === 'SHORT' && f.breakOfStructure === 'DOWN'));
    continuity.push({
      frame,
      score,
      state:failed ? 'WAIT_RECLAIM' : 'ACTIVE_CONTEXT',
      immediateEligible:!failed,
      breakoutStatus:f.breakoutExecution?.status || null
    });
  }
  const eligible = continuity.filter(x => x.immediateEligible);
  return {
    side,
    originTF:eligible[0]?.frame || null,
    ownerTF:eligible.at(-1)?.frame || null,
    continuity,
    handoffNote:'ownerTF is informational only; a live handoff must not widen the original structural risk.'
  };
}
function globalAsset(asset) {
  if (!asset?.available) return { available:false, reason:asset?.reason || 'UNAVAILABLE' };
  const out = { available:true };
  for (const tf of ['15m','1h','4h','1d']) {
    const f = asset.frames?.[tf];
    out[tf] = f?.available ? { trend:f.trend, returnPct:f.returnPct, rsi14:f.rsi14, asOf:f.asOf } : { available:false };
  }
  return out;
}
function compactCandidate(c) {
  if (!c) return null;
  return {
    symbol:c.symbol,
    side:c.side,
    leaderState:c.leaderState,
    attackRank:c.attackRank,
    rankVelocity:c.rankVelocity,
    rankAcceleration:c.rankAcceleration,
    leaderHunterScore:c.leaderHunterScore,
    attackScore:c.attackScore,
    movementPotential:c.movementPotential,
    longExpansionScore:c.longExpansionScore,
    shortExpansionScore:c.shortExpansionScore,
    expansionScore:c.expansionScore,
    tradeQuality:c.tradeQuality,
    spreadBps:c.spreadBps,
    oiDeltaPct:c.oiDeltaPct,
    takerBuyRatio:c.takerBuyRatio,
    fundingRate:c.fundingRate,
    directionSupport:c.directionSupport,
    volumeAcceleration:c.volumeAcceleration,
    rangeExpansion:c.rangeExpansion
  };
}
function liquidationContext(micro) {
  const obs = micro?.observedLiquidations;
  if (!obs?.available || !Number.isFinite(Number(obs.count)) || Number(obs.count) < 1) {
    return {
      available:false,
      reason:'NO_RECENT_OBSERVED_FORCE_ORDER_PRINTS',
      source:'BINANCE_FORCEORDER_PUBLIC_STREAM_WHEN_AVAILABLE',
      note:'Absence of observed prints is not evidence that no liquidation levels exist. Do not fabricate a heatmap.'
    };
  }
  return {
    available:true,
    source:'OBSERVED_BINANCE_FORCEORDER_15M',
    semantics:obs.semantics || 'OBSERVED_BINANCE_FORCE_ORDER_ONLY',
    count:Number(obs.count),
    asOf:obs.asOf || null,
    longLiquidatedQuote:finite(obs.longLiquidatedQuote) ?? 0,
    shortLiquidatedQuote:finite(obs.shortLiquidatedQuote) ?? 0,
    zones:Array.isArray(obs.zones) ? obs.zones.slice(0,6) : [],
    note:'Observed liquidation prints only; not a projected heatmap, hidden position map, or proof of market-maker intent.'
  };
}
function buildUnifiedContext({ symbol, global, candidate = null, now = Date.now() }) {
  const bid = finite(symbol?.microstructure?.bid), ask = finite(symbol?.microstructure?.ask);
  const livePrice = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  const frames = {};
  for (const frame of FRAME_ORDER) frames[frame] = summarizeFrame(frame, symbol?.timeframes?.[frame], now, livePrice);
  const freshFrames = FRAME_ORDER.filter(x => frames[x]?.available && frames[x].fresh);
  const staleFrames = FRAME_ORDER.filter(x => frames[x]?.available && !frames[x].fresh);
  const microQuality = symbol?.microstructure?.sourceQuality || (symbol?.microstructure?.available ? 'REST_SNAPSHOT_APPROX' : 'UNAVAILABLE');
  return {
    version:'UNIFIED_BRAIN_CONTEXT_V9578E',
    symbol:symbol?.symbol || candidate?.symbol || null,
    generatedAt:new Date(now).toISOString(),
    livePrice,
    sourceCandidate:compactCandidate(candidate),
    frames,
    opportunityPaths:{ LONG:sidePath(frames, 'LONG'), SHORT:sidePath(frames, 'SHORT') },
    microstructure:symbol?.microstructure || { available:false, reason:'UNAVAILABLE' },
    global:{
      btc:globalAsset(global?.btc),
      eth:globalAsset(global?.eth),
      ethbtc:globalAsset(global?.ethbtc),
      marketCap:global?.marketCap?.available ? {
        available:true,
        usdtDominancePct:global.marketCap.usdtDominancePct,
        total2ProxyUsd:global.marketCap.total2ProxyUsd,
        total3ProxyUsd:global.marketCap.total3ProxyUsd,
        source:global.marketCap.source
      } : { available:false, reason:global?.marketCap?.reason || 'UNAVAILABLE' }
    },
    liquiditySemantics:{
      marketMakerIntent:'NOT_INFERRED',
      note:'BSL/SSL, equal highs/lows, wick sweeps, FVGs and observed force orders are liquidity context, not proof of a hidden market-maker target.'
    },
    liquidationContext:liquidationContext(symbol?.microstructure),
    dataQuality:{
      freshFrames,
      staleFrames,
      microstructureAvailable:Boolean(symbol?.microstructure?.available),
      microstructureQuality:microQuality,
      streamingAvailable:Boolean(symbol?.microstructure?.streaming?.available),
      websocketConnected:Boolean(symbol?.streamHealth?.connected),
      advisoryUsable:freshFrames.length > 0,
      executionReady:false
    },
    policy:{
      everyTimeframeMayOriginate:true,
      legacy15mStillRequiresCompleted15m:true,
      unifiedEngineDoesNotWaitFor15m:true,
      timeframesAreNotVotes:true,
      synthetic45mIsContextNotIndependentVote:true,
      observedLiquidationsAreContextNotIntent:true,
      trueOfiClaimed:false,
      execution:'ADVISORY_ONLY'
    }
  };
}
function compactUnifiedContext(u) {
  const m = u.microstructure;
  return {
    version:u.version,
    symbol:u.symbol,
    livePrice:u.livePrice,
    sourceCandidate:u.sourceCandidate,
    frames:Object.fromEntries(FRAME_ORDER.map(tf => {
      const f = u.frames[tf];
      if (!f?.available) return [tf, { available:false, reason:f?.reason }];
      return [tf, {
        fresh:f.fresh, asOf:f.asOf, close:f.close, trend:f.trend, rsi14:f.rsi14, atrPct:f.atrPct,
        breakOfStructure:f.breakOfStructure, prior20High:f.prior20High, prior20Low:f.prior20Low,
        candle:f.candle, patterns:f.patterns, liquidity:f.liquidity,
        opportunity:f.opportunity, breakoutExecution:f.breakoutExecution
      }];
    })),
    opportunityPaths:u.opportunityPaths,
    microstructure:m?.available ? {
      available:true,
      quality:m.sourceQuality || u.dataQuality.microstructureQuality,
      spreadBps:m.spreadBps,
      depth20Imbalance:m.depth20Imbalance,
      cvdSampleQuote:m.cvdSampleQuote,
      cvdSampleTrades:m.cvdSampleTrades,
      cvdSource:m.cvdSource || 'REST_AGGTRADES_SAMPLE',
      ofiProxyQuote:m.ofiProxyQuote,
      ofiQuality:'REST_TWO_SNAPSHOT_PROXY_NOT_TRUE_OFI',
      streaming:m.streaming ? {
        available:Boolean(m.streaming.available),
        connected:Boolean(m.streaming.connected),
        ageMs:m.streaming.ageMs,
        cvdQuote120s:m.streaming.cvdQuote120s,
        cvdTrades120s:m.streaming.cvdTrades120s,
        depth20Imbalance:m.streaming.depth20Imbalance
      } : { available:false }
    } : { available:false, reason:m?.reason },
    liquidationContext:u.liquidationContext,
    global:u.global,
    liquiditySemantics:u.liquiditySemantics,
    dataQuality:u.dataQuality,
    policy:u.policy
  };
}
async function buildVisionCharts(symbol, requestedBars = 128) {
  const frames = {};
  const images = [];
  const failures = [];
  const rows = await Promise.all(FRAME_ORDER.map(async frame => {
    try {
      const chart = await chartContext(symbol, frame, requestedBars);
      const png = renderChartPng(chart, 'annotated');
      return {
        ok:true,
        frame,
        bars:Number(chart?.bars || 0),
        closedBars:Number(chart?.closedBars || 0),
        formingBars:Number(chart?.formingBars || 0),
        generatedAt:chart?.generatedAt || null,
        dataUrl:'data:image/png;base64,'+png.toString('base64')
      };
    } catch (e) {
      return { ok:false, frame, error:String(e?.message || e).slice(0,160) };
    }
  }));
  for (const row of rows) {
    if (!row.ok) {
      failures.push({ frame:row.frame, error:row.error });
      frames[row.frame] = { ok:false, error:row.error };
      continue;
    }
    images.push({ tf:row.frame, mode:'annotated', dataUrl:row.dataUrl });
    frames[row.frame] = {
      ok:true,
      bars:row.bars,
      closedBars:row.closedBars,
      formingBars:row.formingBars,
      generatedAt:row.generatedAt
    };
  }
  return {
    ok:images.length === FRAME_ORDER.length,
    required:FRAME_ORDER.length,
    attached:images.length,
    barsRequested:Math.max(100, Math.min(256, Number(requestedBars) || 128)),
    mode:'annotated',
    frames,
    failures,
    images
  };
}

function deterministicFallbackPlan(candidate, unified, detail = '') {
  const side = String(candidate?.side || '').toUpperCase();
  const path = ['LONG','SHORT'].includes(side) ? unified?.opportunityPaths?.[side] : null;
  const originTF = FRAME_ORDER.includes(String(path?.originTF || '').toLowerCase()) ? String(path.originTF).toLowerCase() : null;
  const ownerTF = FRAME_ORDER.includes(String(path?.ownerTF || '').toLowerCase()) ? String(path.ownerTF).toLowerCase() : null;
  const continuity = Array.isArray(path?.continuity) ? path.continuity : [];
  const origin = originTF ? continuity.find(x => x?.frame === originTF) : null;
  const owner = ownerTF ? continuity.find(x => x?.frame === ownerTF) : null;
  const qualified = Boolean(
    ['LONG','SHORT'].includes(side) &&
    originTF &&
    ownerTF &&
    origin?.immediateEligible === true &&
    owner
  );
  return {
    valid:qualified,
    planCode:'LH_UNIFIED_9TF_DETERMINISTIC_FALLBACK',
    status:qualified ? 'QUALIFIED' : 'WATCH',
    side:['LONG','SHORT'].includes(side) ? side : null,
    confidence:0,
    originTF,
    ownerTF,
    setup:'DETERMINISTIC_OPPORTUNITY_PATH',
    execPath:'COMMITTEE_OUTAGE_FALLBACK',
    why:qualified
      ? 'Committee unavailable; deterministic fresh opportunity path passed plan-shape requirements.'
      : 'Committee unavailable and no immediately eligible deterministic opportunity path exists.',
    riskNote:'Fallback never bypasses account, stop, kill-switch, lease/lineage, dry-run or one-shot LIVE grant gates.',
    committeeUnavailable:true,
    committeeDetail:String(detail || '').slice(0,160),
    execution:'ADVISORY_ONLY'
  };
}

function planFields(raw) {
  const text = String(raw || '');
  const field = name => {
    const match = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
    return match ? match[1].trim().slice(0, 500) : null;
  };
  const status = field('STATUS');
  const side = field('SIDE');
  if (!['WATCH','QUALIFIED','REJECT'].includes(status) || !['LONG','SHORT'].includes(side)) {
    return { valid:false, status:'REVIEW_REQUIRED', reason:'UNSTRUCTURED_COMMITTEE_OUTPUT' };
  }
  const tf = value => FRAME_ORDER.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : null;
  return {
    valid:true,
    planCode:'LH_UNIFIED_9TF',
    status,
    side,
    confidence:Math.max(0, Math.min(100, Number(field('CONFIDENCE')) || 0)),
    originTF:tf(field('ORIGIN_TF')),
    ownerTF:tf(field('OWNER_TF')),
    setup:field('SETUP'),
    execPath:field('EXEC_PATH'),
    why:field('WHY'),
    riskNote:field('RISK_NOTE'),
    execution:'ADVISORY_ONLY'
  };
}
function combineRiskGate(preflight, accountCaps, structuralStop, killSwitch, executionClaim) {
  const preflightReasons = Array.isArray(preflight?.reasons) ? preflight.reasons : [];
  const accountReasons = Array.isArray(accountCaps?.reasons) ? accountCaps.reasons : [];
  const stopReasons = Array.isArray(structuralStop?.reasons) ? structuralStop.reasons : [];
  const killSwitchReasons = Array.isArray(killSwitch?.reasons) ? killSwitch.reasons : [];
  const executionClaimReasons = Array.isArray(executionClaim?.reasons) ? executionClaim.reasons : [];
  const remaining = Array.isArray(preflight?.remainingMandatoryControls)
    ? preflight.remainingMandatoryControls.filter(x => !['ACCOUNT_RISK_CAPS','STRUCTURAL_STOP_AND_NO_WIDEN','KILL_SWITCH','LEASE_AND_LINEAGE_CLAIM'].includes(x))
    : [];
  if (!accountCaps?.ok) remaining.push('ACCOUNT_RISK_CAPS');
  if (!structuralStop?.ok) remaining.push('STRUCTURAL_STOP_AND_NO_WIDEN');
  if (!killSwitch?.ok) remaining.push('KILL_SWITCH');
  if (!executionClaim?.ok) remaining.push('LEASE_AND_LINEAGE_CLAIM');
  return {
    ...preflight,
    ok:Boolean(preflight?.ok && accountCaps?.ok && structuralStop?.ok && killSwitch?.ok && executionClaim?.ok),
    eligibleForDryRun:Boolean(preflight?.eligibleForDryRun && accountCaps?.eligibleForDryRun && structuralStop?.eligibleForDryRun && killSwitch?.eligibleForDryRun && executionClaim?.eligibleForDryRun),
    liveAllowed:false,
    execution:'ADVISORY_ONLY',
    preflight,
    accountCaps,
    structuralStop,
    killSwitch,
    executionClaim,
    reasons:[...new Set([...preflightReasons, ...accountReasons, ...stopReasons, ...killSwitchReasons, ...executionClaimReasons])],
    remainingMandatoryControls:[...new Set(remaining)]
  };
}
function normalizeLineage(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function enforceExecutionLineage(riskGate, executionClaim, executionIntent) {
  const claimedLineageId = normalizeLineage(executionClaim?.lineageId);
  const intentLineageId = normalizeLineage(executionIntent?.lineageId);
  const claimPassed = executionClaim?.ok === true;
  const aligned = Boolean(claimPassed && claimedLineageId && intentLineageId && claimedLineageId === intentLineageId);
  const lineageAlignment = { ok:aligned, claimedLineageId, intentLineageId };
  if (!claimPassed || aligned) return { ...riskGate, lineageAlignment };
  return {
    ...riskGate,
    ok:false,
    eligibleForDryRun:false,
    liveAllowed:false,
    execution:'ADVISORY_ONLY',
    lineageAlignment,
    reasons:[...new Set([...(riskGate?.reasons || []), 'EXECUTION_LINEAGE_MISMATCH'])],
    remainingMandatoryControls:[...new Set([...(riskGate?.remainingMandatoryControls || []), 'EXECUTION_LINEAGE_ALIGNMENT'])]
  };
}
function combineExecutionReadiness(riskGate, dryRunExecutor) {
  const riskReasons = Array.isArray(riskGate?.reasons) ? riskGate.reasons : [];
  const executorReasons = Array.isArray(dryRunExecutor?.reasons) ? dryRunExecutor.reasons : [];
  const remaining = Array.isArray(riskGate?.remainingMandatoryControls)
    ? riskGate.remainingMandatoryControls.filter(x => x !== 'BINANCE_DRY_RUN_EXECUTOR')
    : [];
  if (!dryRunExecutor?.ok) remaining.push('BINANCE_DRY_RUN_EXECUTOR');
  return {
    ok:Boolean(riskGate?.ok && dryRunExecutor?.ok),
    eligibleForDryRun:Boolean(riskGate?.eligibleForDryRun && dryRunExecutor?.ok),
    liveAllowed:false,
    execution:'ADVISORY_ONLY',
    riskGate,
    dryRunExecutor,
    reasons:[...new Set([...riskReasons, ...executorReasons])],
    remainingMandatoryControls:[...new Set(remaining)]
  };
}
async function run({ scan, committee, store, accountRisk = null, stopRisk = null, killSwitch = null, executionClaim = null, executionIntent = null }) {
  const selection = resolveExecutionCandidate(scan, executionIntent);
  const candidate = selection.candidate;
  if (!candidate) return {
    ok:true,
    candidateFound:false,
    requestedSymbol:selection.requestedSymbol,
    targetedExecution:selection.targeted,
    reason:selection.reason || 'NO_QUALIFIED_EARLY_EXPANSION',
    committeeCalled:false,
    execution:'ADVISORY_ONLY',
    orderPlaced:false
  };
  const [symbol, global] = await Promise.all([symbolContext(candidate.symbol), globalContext()]);
  const unified = buildUnifiedContext({ symbol, global, candidate });
  if (!unified.dataQuality.advisoryUsable) {
    const out = { ok:true, candidateFound:true, symbol:candidate.symbol, status:'REVIEW_REQUIRED', reason:'NO_FRESH_TIMEFRAME_CONTEXT', committeeCalled:false, execution:'ADVISORY_ONLY', orderPlaced:false };
    out.journalId = store.journal('PLAN_REJECT', candidate.symbol, out);
    return out;
  }
  const vision = await buildVisionCharts(candidate.symbol, 128);
  if (selection.targeted && !vision.ok) {
    const out = {
      ok:true,
      candidateFound:true,
      symbol:candidate.symbol,
      status:'REVIEW_REQUIRED',
      reason:'VISION_9TF_INCOMPLETE',
      vision:{ ok:false, required:vision.required, attached:vision.attached, barsRequested:vision.barsRequested, mode:vision.mode, frames:vision.frames, failures:vision.failures },
      committeeCalled:false,
      execution:'ADVISORY_ONLY',
      orderPlaced:false
    };
    out.journalId = store.journal('PLAN_REJECT', candidate.symbol, out);
    return out;
  }
  const prompt = [
    'PLAN_CODE: LH_UNIFIED_9TF',
    'Return exactly these lines:',
    'STATUS: WATCH | QUALIFIED | REJECT',
    'SIDE: LONG | SHORT',
    'CONFIDENCE: 0-100',
    'ORIGIN_TF: 1m | 3m | 5m | 15m | 30m | 45m | 1h | 4h | 1d',
    'OWNER_TF: 1m | 3m | 5m | 15m | 30m | 45m | 1h | 4h | 1d',
    'SETUP: short setup name',
    'EXEC_PATH: short path name',
    'WHY: one concise line',
    'RISK_NOTE: one concise line',
    'EXECUTION: ADVISORY_ONLY',
    '',
    'VISION_INPUT: 1m/3m/5m/15m/30m/45m/1h/4h/1d annotated charts are attached when available; each uses '+vision.barsRequested+' recent candles and includes the current forming candle for visual context.',
    'Vision rule: read the chart image together with UNIFIED_CONTEXT_JSON. The current forming candle may shape a WATCH idea but MUST NOT be used as closed-candle confirmation. Do not ignore a visible structural conflict merely because numeric scores are high.',
    'Rules: any fresh timeframe may originate an opportunity. A valid 1m/3m/5m opportunity must not wait for 15m merely because 15m is higher. The legacy 15m strategy still keeps its own completed-15m confirmation rule.',
    'Timeframes are context, not votes. Synthetic 45m is derived from closed 15m candles and is not an independent vote.',
    'A FAILED_BREAKOUT timeframe is not an immediate breakout entry; require reclaim or another valid execution path.',
    'Observed forceOrder liquidation prints may inform liquidity context, but they are not a complete heatmap, future cluster map, or market-maker intent.',
    'Partial depth20 streaming is not true OFI. Respect the supplied quality labels and do not multiply correlated flow evidence into fake confirmations.',
    'Do not invent news, levels, missing flow, liquidation maps, or hidden intent. Do not place an order.',
    '',
    'UNIFIED_CONTEXT_JSON:',
    JSON.stringify(compactUnifiedContext(unified))
  ].join('\n');
  let result;
  let plan;
  try {
    result = await committee({
      role:'STRUCTURE',
      system:'You are the Brain Hub multi-timeframe futures structure analyst. Analyze the attached 9-timeframe charts and supplied market data together. Find the earliest valid opportunity without forcing 15m confirmation on non-legacy setups. The forming candle is visual context only and cannot confirm a setup. Respect failed-breakout protection, structural invalidation, liquidity semantics, observed-liquidation limits and data-quality labels. This endpoint is advisory only.',
      prompt,
      images:vision.images
    });
    plan = planFields(result.text);
    if (selection.targeted && Number(result?.vision?.attached || 0) !== FRAME_ORDER.length) {
      plan = {
        valid:false,
        status:'REVIEW_REQUIRED',
        reason:'VISION_COMMITTEE_INPUT_INCOMPLETE',
        side:plan?.side || null,
        confidence:0,
        execution:'ADVISORY_ONLY'
      };
    }
  } catch (e) {
    const detail = String(e.message || e).slice(0,160);
    plan = selection.targeted
      ? {
          valid:false,
          status:'REVIEW_REQUIRED',
          reason:'VISION_COMMITTEE_UNAVAILABLE',
          side:String(candidate?.side || '').toUpperCase(),
          confidence:0,
          committeeUnavailable:true,
          committeeDetail:detail,
          execution:'ADVISORY_ONLY'
        }
      : deterministicFallbackPlan(candidate, unified, detail);
    result = {
      ok:false,
      degraded:true,
      source:selection.targeted ? 'VISION_REQUIRED_FAIL_CLOSED' : 'DETERMINISTIC_FALLBACK',
      error:'COMMITTEE_UNAVAILABLE',
      detail,
      text:null
    };
    try {
      store.journal('PLAN_COMMITTEE_FALLBACK', candidate.symbol, {
        candidate,
        plan,
        reason:'COMMITTEE_UNAVAILABLE',
        detail,
        contextVersion:unified.version
      });
    } catch {}
  }
  const preflight = preflightRiskGate({ plan, unified });
  const accountCaps = accountRiskCaps(accountRisk || {});
  const structuralStop = structuralStopGate({ ...(stopRisk || {}), side:plan.side });
  const killSwitchState = killSwitchGate(killSwitch || {});
  const executionClaimState = executionClaimGate({ claim:executionClaim || {} });
  const riskGateBase = combineRiskGate(preflight, accountCaps, structuralStop, killSwitchState, executionClaimState);
  const riskGate = enforceExecutionLineage(riskGateBase, executionClaimState, executionIntent);
  const dryRunExecutor = buildDryRunOrder({
    intent:{
      ...(executionIntent || {}),
      mode:'DRY_RUN',
      live:false,
      symbol:candidate.symbol,
      side:plan.side
    },
    riskGate
  });
  const executionReadiness = combineExecutionReadiness(riskGate, dryRunExecutor);
  const out = {
    ok:true,
    candidateFound:true,
    candidate,
    unifiedContext:unified,
    vision:{ ok:vision.ok, required:vision.required, attached:vision.attached, barsRequested:vision.barsRequested, mode:vision.mode, frames:vision.frames, failures:vision.failures },
    committee:result,
    plan,
    riskGate,
    dryRunExecutor,
    executionReadiness,
    execution:'ADVISORY_ONLY',
    orderPlaced:false
  };
  out.journalId = store.journal('PLAN', candidate.symbol, { candidate, plan, vision:{ ok:vision.ok, required:vision.required, attached:vision.attached, barsRequested:vision.barsRequested, mode:vision.mode, frames:vision.frames, failures:vision.failures }, riskGate, dryRunExecutor, executionReadiness, contextVersion:unified.version, marketAsOf:symbol.generatedAt });
  return out;
}

module.exports = { FRAME_ORDER, buildUnifiedContext, compactUnifiedContext, liquidationContext, buildVisionCharts, combineRiskGate, enforceExecutionLineage, combineExecutionReadiness, resolveExecutionCandidate, run, planFields, deterministicFallbackPlan };