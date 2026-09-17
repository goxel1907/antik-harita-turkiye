'use strict';

const { pickCandidate } = require('./leader-committee');
const { symbolContext, globalContext } = require('./market');
const { breakoutExecution } = require('./engine');
const { preflightRiskGate } = require('./risk-gate');

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
async function run({ scan, committee, store }) {
  const candidate = pickCandidate(scan);
  if (!candidate) return { ok:true, candidateFound:false, reason:'NO_QUALIFIED_EARLY_EXPANSION', committeeCalled:false, execution:'ADVISORY_ONLY' };
  const [symbol, global] = await Promise.all([symbolContext(candidate.symbol), globalContext()]);
  const unified = buildUnifiedContext({ symbol, global, candidate });
  if (!unified.dataQuality.advisoryUsable) {
    const out = { ok:true, candidateFound:true, symbol:candidate.symbol, status:'REVIEW_REQUIRED', reason:'NO_FRESH_TIMEFRAME_CONTEXT', committeeCalled:false, execution:'ADVISORY_ONLY', orderPlaced:false };
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
  try {
    result = await committee({
      role:'STRUCTURE',
      system:'You are the Brain Hub multi-timeframe futures structure analyst. Find the earliest valid opportunity without forcing 15m confirmation on non-legacy setups. Respect failed-breakout protection, structural invalidation, liquidity semantics, observed-liquidation limits and data-quality labels. This endpoint is advisory only.',
      prompt
    });
  } catch (e) {
    const out = { ok:true, candidateFound:true, candidate, unifiedContext:unified, status:'REVIEW_REQUIRED', reason:'COMMITTEE_UNAVAILABLE', detail:String(e.message || e).slice(0,160), committeeCalled:true, execution:'ADVISORY_ONLY', orderPlaced:false };
    out.journalId = store.journal('PLAN_REJECT', candidate.symbol, { candidate, reason:out.reason, contextVersion:unified.version });
    return out;
  }
  const plan = planFields(result.text);
  const riskGate = preflightRiskGate({ plan, unified });
  const out = {
    ok:true,
    candidateFound:true,
    candidate,
    unifiedContext:unified,
    committee:result,
    plan,
    riskGate,
    execution:'ADVISORY_ONLY',
    orderPlaced:false
  };
  out.journalId = store.journal('PLAN', candidate.symbol, { candidate, plan, riskGate, contextVersion:unified.version, marketAsOf:symbol.generatedAt });
  return out;
}

module.exports = { FRAME_ORDER, buildUnifiedContext, compactUnifiedContext, liquidationContext, run, planFields };
