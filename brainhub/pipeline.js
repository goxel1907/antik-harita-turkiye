'use strict';

const { pickCandidate, selectDeepCandidates, executionEligible } = require('./leader-committee');
const { symbolContext, globalContext, chartContext, renderChartPng } = require('./market');
const { buildMarketMakerEvidence } = require('./market-maker-evidence');
const { breakoutExecution, triggerLevelCandidates, resolveTriggerLevel, triggerSatisfied, invalidationBreached } = require('./engine');
const { isNonConcreteWait } = require('./wait-condition');
const claudeV109 = require('./claude-v109');
const claudeV111 = require('./claude-v111');
const claudeV112 = require('./claude-v112');
const tradeLanes = require('./trade-lanes');
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
  const trackingOnly = executionIntent?.analysisTracking === true;
  const requestedSide = String(executionIntent?.side || '').trim().toUpperCase();
  if (!requestedSymbol) {
    const candidate = pickCandidate(scan);
    return {
      candidate,
      requestedSymbol:null,
      targeted:false,
      trackingOnly:false,
      reason:candidate ? null : 'NO_QUALIFIED_EARLY_EXPANSION'
    };
  }

  const pool = selectDeepCandidates(scan, 16);
  const candidate = pool.find(x => String(x?.symbol || '').trim().toUpperCase() === requestedSymbol) || null;
  if (!candidate) {
    if (trackingOnly && ['LONG','SHORT'].includes(requestedSide)) {
      return {
        candidate:{
          symbol:requestedSymbol,
          side:requestedSide,
          leaderState:'TRACKED_SETUP',
          deepScanReason:'PERSISTENT_ANALYSIS_TRACK',
          trackedOutsideDeepScan:true
        },
        requestedSymbol,
        targeted:true,
        trackingOnly:true,
        reason:null
      };
    }
    return {
      candidate:null,
      requestedSymbol,
      targeted:true,
      trackingOnly:false,
      reason:'REQUESTED_SYMBOL_NOT_IN_DEEP_SCAN'
    };
  }
  if (!executionEligible(candidate)) {
    if (trackingOnly && ['LONG','SHORT'].includes(requestedSide)) {
      return {
        candidate:{ ...candidate, side:requestedSide, trackedOutsideExecutionEligibility:true },
        requestedSymbol,
        targeted:true,
        trackingOnly:true,
        reason:null
      };
    }
    return {
      candidate:null,
      requestedSymbol,
      targeted:true,
      trackingOnly:false,
      reason:'REQUESTED_SYMBOL_NOT_EXECUTION_ELIGIBLE'
    };
  }
  return { candidate, requestedSymbol, targeted:true, trackingOnly, reason:null };
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
    ema20:f.ema20 ?? null,
    ema50:f.ema50 ?? null,
    candle:f.candle || null,
    patterns:Array.isArray(f.patterns) ? f.patterns.slice(-6) : [],
    swingStructure:f.swingStructure || null,
    smcContext:f.smcContext || null,
    orderBlocks:f.orderBlocks || null,
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
    authority:'ATTENTION_ONLY',
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
  const derivatives=symbol?.derivatives||symbol?.microstructure?.derivatives||{available:false};
  const marketMakerEvidence=buildMarketMakerEvidence({streaming:symbol?.microstructure?.streaming||{},derivatives,microstructure:symbol?.microstructure||{}});
  const unified={
    version:'UNIFIED_BRAIN_CONTEXT_JEV_SOVEREIGN_EVIDENCE_V1',
    symbol:symbol?.symbol || candidate?.symbol || null,
    generatedAt:new Date(now).toISOString(),
    livePrice,
    sourceCandidate:compactCandidate(candidate),
    frames,
    opportunityPaths:{ LONG:sidePath(frames, 'LONG'), SHORT:sidePath(frames, 'SHORT') },
    tradeLanes:null,
    microstructure:symbol?.microstructure || { available:false, reason:'UNAVAILABLE' },
    derivatives,
    marketMakerEvidence,
    authority:{finalStrategicAuthority:'JEV',scannerAuthority:'ATTENTION_ONLY',workerAuthority:'EVIDENCE_ONLY'},
    visualPolicy:{tradingViewPrimaryWhenValidated:true,binanceInternalChartFallback:true,numericAuthority:'BINANCE_BRAINHUB',visualMayOverrideNumeric:false},
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
      marketMakerIntent:'NOT_ASSERTED',
      marketMakerIdentity:'NOT_IDENTIFIED',
      note:'BSL/SSL, equal highs/lows, wick sweeps, FVGs, order-flow heuristics and observed force orders are evidence context, not proof of a hidden market-maker identity or target.'
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
      mainTradeTimeframe:'15m',
      lowerTfSoloDecision:false,
      scalpMomentumRequiresAtLeastTwoOf:['1m','3m','5m'],
      scalpRequiresFresh15mContext:true,
      legacy15mStillRequiresCompleted15m:true,
      unifiedEngineDoesNotWaitFor15m:true,
      timeframesAreNotVotes:true,
      synthetic45mIsContextNotIndependentVote:true,
      observedLiquidationsAreContextNotIntent:true,
      marketMakerEvidenceOnly:true,
      finalStrategicAuthority:'JEV',
      workerAuthority:'EVIDENCE_ONLY',
      scannerAuthority:'ATTENTION_ONLY',
      visualCannotOverrideNumericTruth:true,
      trueOfiClaimed:false,
      microstructureSoftFamilySingleVote:true,
      missingAuxiliaryDataIsScoreless:true,
      execution:'ADVISORY_ONLY'
    }
  };
  unified.tradeLanes={
    LONG:tradeLanes.analyzeTradeLanes(unified,'LONG',candidate),
    SHORT:tradeLanes.analyzeTradeLanes(unified,'SHORT',candidate)
  };
  return unified;
}
// CLAUDE_V113: Fib seviyeleri yalnız Jev kaydına gider; Vision/komite istemleri (16k bağlamlı yerel model) büyümez.
function withoutFib(m) {
  if (!m || typeof m !== 'object') return m || null;
  const { fibLevels, ...rest } = m;
  return rest;
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
        candle:f.candle, patterns:f.patterns, liquidity:f.liquidity, swingStructure:f.swingStructure, smcContext:withoutFib(f.smcContext),
        opportunity:f.opportunity, breakoutExecution:f.breakoutExecution
      }];
    })),
    opportunityPaths:u.opportunityPaths,
    tradeLanes:u.tradeLanes||null,
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
      depthSoftContext:m.depthSoftContext ? {
        source:m.depthSoftContext.source || 'BINANCE_DEPTH20_PARTIAL_BOOK',
        normalizedEntropy:m.depthSoftContext.normalizedEntropy,
        concentration:m.depthSoftContext.concentration,
        bidEntropy:m.depthSoftContext.bidEntropy,
        askEntropy:m.depthSoftContext.askEntropy,
        bidWallShare:m.depthSoftContext.bidWallShare,
        askWallShare:m.depthSoftContext.askWallShare,
        wallPressure:m.depthSoftContext.wallPressure,
        microprice:m.depthSoftContext.microprice,
        micropriceBps:m.depthSoftContext.micropriceBps,
        semantics:m.depthSoftContext.semantics || 'SOFT_MICROSTRUCTURE_CONTEXT_ONLY',
        note:m.depthSoftContext.note || null
      } : { available:false },
      streaming:m.streaming ? {
        available:Boolean(m.streaming.available),
        connected:Boolean(m.streaming.connected),
        ageMs:m.streaming.ageMs,
        cvdQuote120s:m.streaming.cvdQuote120s,
        cvdTrades120s:m.streaming.cvdTrades120s,
        depth20Imbalance:m.streaming.depth20Imbalance,
        depthSoftContext:m.streaming.depthSoftContext || null
      } : { available:false }
    } : { available:false, reason:m?.reason },
    liquidationContext:u.liquidationContext,
    derivatives:u.derivatives||null,
    marketMakerEvidence:u.marketMakerEvidence||null,
    authority:u.authority||null,
    visualPolicy:u.visualPolicy||null,
    global:u.global,
    liquiditySemantics:u.liquiditySemantics,
    dataQuality:u.dataQuality,
    policy:u.policy,
    learning:u.learning||null
  };
}
function compactOutcomeLearningContext(learning) {
  const src=learning&&typeof learning==='object'?learning:{};
  const recent=Array.isArray(src.recent)?src.recent:[];
  const stats=Array.isArray(src.stats)?src.stats:[];
  const measured=v=>v!==null&&v!==undefined&&!(typeof v==='string'&&v.trim()==='')&&Number.isFinite(Number(v));
  const recentOutcomes=recent
    .filter(row=>measured(row?.outcomePct))
    .slice(0,8)
    .map(row=>({
      symbol:String(row?.symbol||'').slice(0,28)||null,
      side:['LONG','SHORT'].includes(String(row?.side||'').toUpperCase())?String(row.side).toUpperCase():null,
      setup:String(row?.setup||'').slice(0,80)||null,
      originTF:String(row?.originTF||'').slice(0,8)||null,
      ownerTF:String(row?.ownerTF||'').slice(0,8)||null,
      decision:String(row?.decision||'').slice(0,48)||null,
      outcomePct:Number(Number(row.outcomePct).toFixed(4))
    }));
  const outcomeStats=stats
    .filter(row=>Number(row?.samples)>0 && measured(row?.avgOutcomePct))
    .slice(0,8)
    .map(row=>({
      side:['LONG','SHORT'].includes(String(row?.side||'').toUpperCase())?String(row.side).toUpperCase():null,
      setup:String(row?.setup||'').slice(0,80)||null,
      originTF:String(row?.originTF||'').slice(0,8)||null,
      ownerTF:String(row?.ownerTF||'').slice(0,8)||null,
      samples:Math.max(0,Math.trunc(Number(row.samples)||0)),
      winRate:Number.isFinite(Number(row?.winRate))?Number(row.winRate):null,
      avgOutcomePct:Number(Number(row.avgOutcomePct).toFixed(4))
    }));
  const outcomeSamples=outcomeStats.reduce((sum,row)=>sum+Math.max(0,Number(row.samples)||0),0);
  return {
    available:recentOutcomes.length>0 || outcomeStats.length>0,
    outcomeSamples,
    recentOutcomes,
    stats:outcomeStats,
    semantics:'OUTCOME_BACKED_SOFT_CONTEXT_ONLY',
    note:'Yalnız sonucu ölçülmüş kapanmış işlemler kullanılır. Etiketsiz PLAN/WATCH geçmişi karar kanıtı değildir; öğrenme tek başına QUALIFIED/VETO üretemez ve hard risk kurallarını değiştiremez.'
  };
}

function compactLocalModelContext(u) {
  const frames=Object.fromEntries(FRAME_ORDER.map(tf=>{
    const f=u?.frames?.[tf];
    if(!f?.available)return [tf,{available:false,reason:f?.reason||'UNAVAILABLE'}];
    return [tf,{
      available:true,
      fresh:Boolean(f.fresh),
      close:f.close,
      trend:f.trend,
      rsi14:f.rsi14,
      atrPct:f.atrPct,
      breakOfStructure:f.breakOfStructure,
      prior20High:f.prior20High,
      prior20Low:f.prior20Low,
      candle:f.candle||null,
      patterns:Array.isArray(f.patterns)?f.patterns.slice(-4):[],
      swingStructure:f.swingStructure||null,
      liquidity:{
        buySide:f.liquidity?.buySide??null,
        sellSide:f.liquidity?.sellSide??null,
        equalHigh:f.liquidity?.equalHigh??null,
        equalLow:f.liquidity?.equalLow??null,
        lastSweep:f.liquidity?.lastSweep??null,
        fairValueGaps:Array.isArray(f.liquidity?.fairValueGaps)?f.liquidity.fairValueGaps.slice(-2):[]
      },
      smcContext:withoutFib(f.smcContext),
      opportunity:f.opportunity||null,
      breakoutExecution:f.breakoutExecution?{status:f.breakoutExecution.status,allowed:f.breakoutExecution.allowed}:null
    }];
  }));
  const m=u?.microstructure;
  return {
    symbol:u?.symbol||null,
    livePrice:u?.livePrice??null,
    sourceCandidate:u?.sourceCandidate||null,
    frames,
    opportunityPaths:u?.opportunityPaths||{},
    microstructure:m?.available?{
      available:true,
      quality:m.sourceQuality||u?.dataQuality?.microstructureQuality||null,
      spreadBps:m.spreadBps??null,
      depth20Imbalance:m.depth20Imbalance??null,
      cvdSampleQuote:m.cvdSampleQuote??null,
      cvdSampleTrades:m.cvdSampleTrades??null,
      ofiProxyQuote:m.ofiProxyQuote??null,
      depthSoftContext:m.depthSoftContext||null,
      streaming:m.streaming?{
        available:Boolean(m.streaming.available),
        connected:Boolean(m.streaming.connected),
        ageMs:m.streaming.ageMs??null,
        cvdQuote120s:m.streaming.cvdQuote120s??null,
        cvdTrades120s:m.streaming.cvdTrades120s??null,
        depth20Imbalance:m.streaming.depth20Imbalance??null
      }:{available:false}
    }:{available:false,reason:m?.reason||'UNAVAILABLE'},
    liquidationContext:u?.liquidationContext||null,
    global:u?.global||null,
    dataQuality:u?.dataQuality||null,
    policy:u?.policy||null,
    learning:u?.learning||null
  };
}

async function buildVisionCharts(symbol, requestedBars = 128, options = {}) {
  const requestedFrames=Array.isArray(options?.frames)&&options.frames.length
    ? [...new Set(options.frames.map(x=>String(x||'').toLowerCase()))].filter(x=>FRAME_ORDER.includes(x))
    : FRAME_ORDER.slice();
  const frames = {};
  const images = [];
  const failures = [];
  const probeCells={
    '1m':7,'3m':2,'5m':9,'15m':4,'30m':1,
    '45m':8,'1h':5,'4h':3,'1d':6
  };
  const visionProbe=options?.visionProbe === true;
  const rows = await Promise.all(requestedFrames.map(async frame => {
    try {
      const lowFrame=['1m','3m','5m'].includes(frame);
      const mainFrame=frame==='15m';
      const frameBars=lowFrame ? Math.max(100,Math.min(256,Number(requestedBars)||128)) : 64;
      // v110: 1m/3m/5m become more legible; 15m remains the highest-resolution
      // main trade chart. 30m+ stay readable but lighter because they are
      // structure/liquidity/formations context rather than independent votes.
      const outputWidth=mainFrame ? 896 : 640;
      const outputHeight=mainFrame ? 504 : 360;
      const chart = await chartContext(symbol, frame, frameBars);
      const visionProbeCell=visionProbe ? probeCells[frame] : null;
      const png = renderChartPng(chart, 'annotated', {
        ...(visionProbeCell?{visionProbeCell}:{}),
        outputWidth,
        outputHeight
      });
      const last=Array.isArray(chart?.candles)&&chart.candles.length?chart.candles[chart.candles.length-1]:null;
      const visualLastCandle=last
        ? (Number(last.close)>=Number(last.open)?'BULL':'BEAR')
        : null;
      return {
        ok:true,
        frame,
        bars:Number(chart?.bars || 0),
        closedBars:Number(chart?.closedBars || 0),
        formingBars:Number(chart?.formingBars || 0),
        generatedAt:chart?.generatedAt || null,
        requestedBars:frameBars,
        imageWidth:outputWidth,
        imageHeight:outputHeight,
        visualLastCandle,
        visionProbeCell,
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
      generatedAt:row.generatedAt,
      requestedBars:row.requestedBars,
      imageWidth:row.imageWidth,
      imageHeight:row.imageHeight,
      visualLastCandle:row.visualLastCandle,
      ...(visionProbe ? { visionProbeCell:row.visionProbeCell } : {})
    };
  }
  return {
    ok:images.length === requestedFrames.length,
    required:requestedFrames.length,
    attached:images.length,
    barsRequested:Math.max(100, Math.min(256, Number(requestedBars) || 128)),
    mode:'annotated',
    imageSize:{
      scalp:{width:640,height:360,bars:Math.max(100,Math.min(256,Number(requestedBars)||128))},
      main15m:{width:896,height:504,bars:64},
      context:{width:640,height:360,bars:64}
    },
    frames,
    failures,
    images
  };
}

function visionPixelProbePrompt() {
  return [
    'Görsel taşıma doğrulaması: dokuz grafiğin HER BİRİNİ gerçekten incele.',
    'Her grafiğin sol üstünde büyük beyaz çerçeveli 3x3 bir ızgara vardır. Yalnız bir hücre parlak MOR/MAGENTA, diğer sekiz hücre koyu renktir.',
    'Hücreleri soldan sağa, yukarıdan aşağı 1..9 numarala: üst sıra 1,2,3; orta sıra 4,5,6; alt sıra 7,8,9.',
    'Her grafik için yalnız parlak hücrenin numarasını oku. Bu ızgara diagnostiktir; piyasa sinyali değildir.',
    'Tam olarak aşağıdaki 9 satırı döndür; başka açıklama ekleme:',
    'PROBE_1M: N',
    'PROBE_3M: N',
    'PROBE_5M: N',
    'PROBE_15M: N',
    'PROBE_30M: N',
    'PROBE_45M: N',
    'PROBE_1H: N',
    'PROBE_4H: N',
    'PROBE_1D: N'
  ].join('\n');
}
// The caller owns the timeframe label; only the observed value comes from the model.
// Never recover values from malformed tags, explanations, or the hidden mapping.
function formatSingleVisionPixelReply(tf,text) {
  if(!FRAME_ORDER.includes(tf))throw new Error('PIXEL_TIMEFRAME_INVALID');
  const match=/^\s*([1-9])\s*$/.exec(String(text||''));
  if(!match)throw new Error('PIXEL_CELL_CONTRACT='+tf+' expected=single-digit');
  return 'PROBE_'+tf.toUpperCase()+': '+match[1];
}
function evaluateVisionPixelProbe(text, frames) {
  const tfKey={ '1M':'1m','3M':'3m','5M':'5m','15M':'15m','30M':'30m','45M':'45m','1H':'1h','4H':'4h','1D':'1d' };
  const reported={};
  const re=/^\s*PROBE_(1M|3M|5M|15M|30M|45M|1H|4H|1D)\s*:\s*([1-9])\s*$/gim;
  let m;
  while((m=re.exec(String(text||'')))) reported[tfKey[m[1].toUpperCase()]]=Number(m[2]);
  const details=FRAME_ORDER.map(tf=>{
    const expected=Number(frames?.[tf]?.visionProbeCell||0);
    const actual=Number(reported[tf]||0);
    return {tf,expected:expected||null,actual:actual||null,match:Boolean(expected&&actual&&expected===actual)};
  });
  const reportedCount=details.filter(x=>x.actual).length;
  const comparable=details.filter(x=>x.expected).length;
  const matched=details.filter(x=>x.match).length;
  return {
    ok:reportedCount===FRAME_ORDER.length && comparable===FRAME_ORDER.length && matched===FRAME_ORDER.length,
    required:FRAME_ORDER.length,
    reported:reportedCount,
    comparable,
    matched,
    threshold:FRAME_ORDER.length,
    details
  };
}

function triggerCandidatesForPlan(unified, side) {
  const s=String(side||'').toUpperCase();
  if(!['LONG','SHORT'].includes(s))return [];
  const out=[];
  for(const tf of FRAME_ORDER){
    const frame=unified?.frames?.[tf];
    for(const level of triggerLevelCandidates(frame,s)){
      out.push({tf,id:level.id,price:level.price,source:level.source,uses:level.uses});
    }
  }
  return out;
}

function resolveNumericTriggerPlan(plan, unified) {
  const side=String(plan?.side||'').toUpperCase();
  const tf=String(plan?.triggerTF||'').toLowerCase();
  const triggerId=String(plan?.triggerLevelId||'').toUpperCase();
  const invalidationId=String(plan?.invalidationLevelId||'').toUpperCase();
  const frame=FRAME_ORDER.includes(tf)?unified?.frames?.[tf]:null;
  const trigger=frame?resolveTriggerLevel(frame,side,triggerId,'TRIGGER'):null;
  const invalidation=frame?resolveTriggerLevel(frame,side,invalidationId,'INVALIDATION'):null;
  const closedPrice=finite(frame?.close);
  const valid=Boolean(frame?.available&&frame?.fresh===true&&trigger&&invalidation&&closedPrice!==null);
  return {
    valid,
    tf:FRAME_ORDER.includes(tf)?tf:null,
    triggerLevelId:trigger?.id||triggerId||null,
    triggerPrice:trigger?.price??null,
    invalidationLevelId:invalidation?.id||invalidationId||null,
    invalidationPrice:invalidation?.price??null,
    closedPrice,
    triggered:valid?triggerSatisfied({side,closedPrice,levelPrice:trigger.price}):false,
    invalidated:valid?invalidationBreached({side,closedPrice,levelPrice:invalidation.price}):false,
    source:trigger?.source||null,
    closedCandleOnly:true
  };
}

// CLAUDE_V109_TRIGGER_AUTOSELECT: modelin tetik ID'leri eksik/geçersizse kod prior-20 adayını seçer.
// WATCH planının WAIT_FOR metni somut değilse sayısal tetik metniyle değiştirilir (model metni saklanır).
function withTriggerSpec(plan, unified) {
  if (!plan || typeof plan !== 'object') return plan;
  let p = { ...plan, triggerSpec:resolveNumericTriggerPlan(plan, unified) };
  const st = String(p.status || '').toUpperCase();
  if (!['WATCH','QUALIFIED'].includes(st)) return p;
  if (p.triggerSpec?.valid !== true) {
    const lane=tradeLanes.laneForPlan(p,unified,unified?.sourceCandidate);
    let pick=null;
    if(lane.name==='SCALP_MOMENTUM'&&lane.scalpReady){
      const side=String(p.side||'').toUpperCase();
      const triggerId=side==='SHORT'?'PRIOR20_LOW':'PRIOR20_HIGH';
      const invalidationId=side==='SHORT'?'PRIOR20_HIGH':'PRIOR20_LOW';
      for(const tf of tradeLanes.scalpTriggerPreference(lane)){
        const frame=unified?.frames?.[tf];
        if(!frame?.available||frame?.fresh!==true)continue;
        if(!resolveTriggerLevel(frame,side,triggerId,'TRIGGER'))continue;
        if(!resolveTriggerLevel(frame,side,invalidationId,'INVALIDATION'))continue;
        pick={
          ok:true,triggerTF:tf,triggerLevelId:triggerId,invalidationLevelId:invalidationId,
          keptModelTrigger:false,keptModelInvalidation:false,
          reason:'V110_SCALP_TRIGGER_AUTOSELECT'
        };
        break;
      }
    }
    if(!pick)pick=claudeV109.autoSelectTrigger({ plan:p, unified });
    if (!pick.ok) return { ...p, claudeTriggerAutoSelect:{ ok:false, reason:pick.reason } };
    const next = {
      ...p,
      modelTriggerLevelId:p.triggerLevelId || null,
      modelTriggerTF:p.triggerTF || null,
      modelInvalidationLevelId:p.invalidationLevelId || null,
      triggerLevelId:pick.triggerLevelId,
      triggerTF:pick.triggerTF,
      invalidationLevelId:pick.invalidationLevelId
    };
    p = {
      ...next,
      triggerSpec:{ ...resolveNumericTriggerPlan(next, unified), autoSelected:true },
      claudeTriggerAutoSelect:pick,
      v110ScalpTriggerAutoSelected:pick.reason==='V110_SCALP_TRIGGER_AUTOSELECT'
    };
  }
  if (st === 'WATCH' && p.triggerSpec?.valid === true && isNonConcreteWait(p.waitFor)) {
    const dir = String(p.side || '').toUpperCase() === 'SHORT' ? 'altında' : 'üstünde';
    p = {
      ...p,
      modelWaitFor:p.waitFor || null,
      waitFor:`${p.triggerSpec.tf} kapanışı ${p.triggerSpec.triggerPrice} ${dir} (CLAUDE_V109 sayısal tetik ${p.triggerSpec.triggerLevelId})`,
      waitForRepairedBy:'CLAUDE_V109_NUMERIC_WAIT_FALLBACK'
    };
  }
  return p;
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
  const cleanValue = value => String(value || '')
    .trim()
    .replace(/^[\"'`*\s]+/, '')
    .replace(/[\"'`*,;\s]+$/, '')
    .trim()
    .slice(0, 700);
  const field = name => {
    const wanted=String(name || '').trim().toUpperCase();
    for(const rawLine of text.split(/\r?\n/)){
      let line=String(rawLine || '').trim();
      if(!line || /^```/.test(line))continue;
      line=line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/,'').trim();
      const colon=line.indexOf(':');
      if(colon<1)continue;
      const lhs=line.slice(0,colon).replace(/[\"'`*]/g,'').trim().toUpperCase();
      if(lhs!==wanted)continue;
      return cleanValue(line.slice(colon+1));
    }
    return null;
  };  const rawStatus = field('STATUS');
  const rawSide = field('SIDE');
  const status = String(rawStatus || '').toUpperCase();
  const side = String(rawSide || '').toUpperCase();
  const statusOk = ['WATCH','QUALIFIED','REJECT'].includes(status);
  const sideOk = ['LONG','SHORT'].includes(side);

  const tf = value => FRAME_ORDER.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : null;
  const tfTags = { '1m':'1M','3m':'3M','5m':'5M','15m':'15M','30m':'30M','45m':'45M','1h':'1H','4h':'4H','1d':'1D' };
  const roleValue = value => {
    const r=String(value || '').trim().toUpperCase();
    return ['SUPPORT','VETO','NEUTRAL'].includes(r) ? r : null;
  };
  const parseTfList = value => {
    if (value === null || value === undefined) return { declared:false, values:[], invalid:[] };
    const rawValue=String(value).trim();
    if (!rawValue) return { declared:true, values:[], invalid:['EMPTY'] };
    if (rawValue.toUpperCase() === 'NONE') return { declared:true, values:[], invalid:[] };
    const parts=rawValue.split(/[;,\s]+/).map(x=>x.trim().toLowerCase()).filter(Boolean);
    const values=[...new Set(parts.filter(x=>FRAME_ORDER.includes(x)))];
    const invalid=[...new Set(parts.filter(x=>!FRAME_ORDER.includes(x)))];
    return { declared:true, values, invalid };
  };

  const timeframeNotes={};
  const timeframeDiagnostics={};
  for (const frame of FRAME_ORDER) {
    const tag=tfTags[frame];
    timeframeNotes[frame]=field('TF_'+tag);
    timeframeDiagnostics[frame]={
      summary:timeframeNotes[frame],
      why:field('TF_'+tag+'_WHY'),
      waitFor:field('TF_'+tag+'_WAIT'),
      role:roleValue(field('TF_'+tag+'_ROLE')),
      formingContext:field('TF_'+tag+'_FORMING'),
      risk:field('TF_'+tag+'_RISK')
    };
  }

  const supportDecl=parseTfList(field('SUPPORT_TFS'));
  const vetoDecl=parseTfList(field('VETO_TFS'));
  const roleSupport=FRAME_ORDER.filter(tf=>timeframeDiagnostics?.[tf]?.role==='SUPPORT');
  const roleVeto=FRAME_ORDER.filter(tf=>timeframeDiagnostics?.[tf]?.role==='VETO');
  const sameTfSet=(a,b)=>a.length===b.length && a.every(x=>b.includes(x));
  const roleConsistencyWarnings=[];
  if (supportDecl.declared && !sameTfSet(roleSupport,supportDecl.values)) roleConsistencyWarnings.push('SUPPORT_TFS_ROLE_MISMATCH');
  if (vetoDecl.declared && !sameTfSet(roleVeto,vetoDecl.values)) roleConsistencyWarnings.push('VETO_TFS_ROLE_MISMATCH');

  return {
    valid:statusOk && sideOk,
    planCode:'LH_UNIFIED_9TF',
    status:statusOk ? status : 'REVIEW_REQUIRED',
    reason:statusOk && sideOk ? null : 'UNSTRUCTURED_COMMITTEE_OUTPUT',
    side:sideOk ? side : null,
    confidence:Math.max(0, Math.min(100, Number(field('CONFIDENCE')) || 0)),
    originTF:tf(field('ORIGIN_TF')),
    ownerTF:tf(field('OWNER_TF')),
    setup:field('SETUP'),
    execPath:field('EXEC_PATH'),
    triggerLevelId:String(field('TRIGGER_LEVEL_ID')||'').trim().toUpperCase()||null,
    triggerTF:tf(field('TRIGGER_TF')),
    invalidationLevelId:String(field('INVALIDATION_LEVEL_ID')||'').trim().toUpperCase()||null,
    why:field('WHY'),
    riskNote:field('RISK_NOTE'),
    waitFor:field('WAIT_FOR'),
    supportTFs:roleSupport,
    vetoTFs:roleVeto,
    declaredSupportTFs:supportDecl.values,
    declaredVetoTFs:vetoDecl.values,
    supportTFsDeclared:supportDecl.declared,
    vetoTFsDeclared:vetoDecl.declared,
    roleConsistencyWarnings,
    invalidSupportTFs:supportDecl.invalid,
    invalidVetoTFs:vetoDecl.invalid,
    formingContext:field('FORMING_CONTEXT'),
    timeframeNotes,
    timeframeDiagnostics,
    visionSummary:field('VISION_SUMMARY'),
    rawOutputSnippet:text.trim().slice(0,2000),
    rawOutputLength:text.length,
    execution:'ADVISORY_ONLY'
  };
}
function visionRepairLabels(missing = []) {
  const out=[];
  for (const raw of Array.isArray(missing)?missing:[]) {
    const name=String(raw || '').trim();
    if (!name) continue;
    if (name === 'STATUS_SIDE') { out.push('STATUS','SIDE'); continue; }
    if (name === 'SUPPORT_TFS_INVALID' || name === 'SUPPORT_TFS_ROLE_MISMATCH') { out.push('SUPPORT_TFS'); continue; }
    if (name === 'VETO_TFS_INVALID' || name === 'VETO_TFS_ROLE_MISMATCH') { out.push('VETO_TFS'); continue; }
    if (name === 'SUPPORT_VETO_OVERLAP') { out.push('SUPPORT_TFS','VETO_TFS'); continue; }
    out.push(name);
  }
  return [...new Set(out)];
}

function visionRepairPrompt(basePrompt, plan, missing = []) {
  const labels=visionRepairLabels(missing);
  const snapshot={
    status:plan?.status || null,
    side:plan?.side || null,
    originTF:plan?.originTF || null,
    ownerTF:plan?.ownerTF || null,
    setup:plan?.setup || null,
    execPath:plan?.execPath || null,
    supportTFs:Array.isArray(plan?.supportTFs)?plan.supportTFs:[],
    vetoTFs:Array.isArray(plan?.vetoTFs)?plan.vetoTFs:[]
  };
  return [
    basePrompt,
    '',
    'REPAIR_PASS:',
    'The previous Vision answer was structurally usable but omitted mandatory labels.',
    'Do NOT change the existing direction/status/setup unless the attached chart evidence makes the previous value impossible.',
    'Return ONLY the missing labels listed below, one exact LABEL: value line each. No Markdown, bullets, JSON, headings or extra prose.',
    'Every repaired value must be Turkish, coin-specific and evidence-based from the same attached charts and UNIFIED_CONTEXT_JSON. Do not invent missing market facts.',
    'MISSING_LABELS: '+labels.join(', '),
    'CURRENT_PARSED_PLAN: '+JSON.stringify(snapshot)
  ].join('\n');
}

function mergeVisionRepairText(baseText, repairText) {
  const repairMap=new Map();
  for(const rawLine of String(repairText||'').split(/\r?\n/)){
    let line=String(rawLine||'').trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/,'');
    const colon=line.indexOf(':');
    if(colon<1)continue;
    const label=line.slice(0,colon).replace(/["'\`*]/g,'').trim().toUpperCase();
    const value=line.slice(colon+1).trim();
    if(label&&value)repairMap.set(label,label+': '+value);
  }
  const out=[];
  const replaced=new Set();
  for(const rawLine of String(baseText||'').split(/\r?\n/)){
    let line=String(rawLine||'').trim();
    const clean=line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/,'');
    const colon=clean.indexOf(':');
    if(colon>0){
      const label=clean.slice(0,colon).replace(/["'\`*]/g,'').trim().toUpperCase();
      if(repairMap.has(label)){
        if(!replaced.has(label)){out.push(repairMap.get(label));replaced.add(label);}
        continue;
      }
    }
    if(line)out.push(line);
  }
  for(const [label,line] of repairMap.entries())if(!replaced.has(label))out.push(line);
  return out.join('\n');
}

function blockingVisionVetoTFs(plan) {
  const veto=new Set(Array.isArray(plan?.vetoTFs)?plan.vetoTFs.filter(x=>FRAME_ORDER.includes(x)):[]);
  const critical=[plan?.originTF,plan?.ownerTF].filter(x=>FRAME_ORDER.includes(x));
  return [...new Set(critical.filter(tf=>veto.has(tf)))];
}
function watchPlanNeedsSemanticResolution(plan) {
  if(!plan||String(plan.status||'').toUpperCase()!=='WATCH')return false;
  return isNonConcreteWait(plan.waitFor);
}
function reconcileVisionPlanSemantics(plan) {
  if (!plan || String(plan.status || '').toUpperCase() !== 'QUALIFIED') return plan;
  const reasons=[];
  const wait=String(plan.waitFor || '').trim();
  const vetoTFs=Array.isArray(plan.vetoTFs) ? plan.vetoTFs.filter(x=>FRAME_ORDER.includes(x)) : [];
  const blockingVetoTFs=blockingVisionVetoTFs(plan);
  const contextualVetoTFs=vetoTFs.filter(tf=>!blockingVetoTFs.includes(tf));
  if (wait.toUpperCase() !== 'NONE') reasons.push('QUALIFIED_WAIT_REQUIRED');
  if (blockingVetoTFs.length) reasons.push('QUALIFIED_ORIGIN_OWNER_VETO');
  if (!reasons.length) return {...plan,blockingVetoTFs,contextualVetoTFs,requiresJevTfReview:contextualVetoTFs.length>0};
  return {
    ...plan,
    previousStatus:'QUALIFIED',
    status:'WATCH',
    reason:reasons[0],
    semanticDowngradeReasons:reasons,
    blockingVetoTFs,
    contextualVetoTFs,
    confidence:Math.min(Number(plan.confidence) || 0, 49),
    execution:'ADVISORY_ONLY'
  };
}

function shouldAttemptVisionRepair(result, contract, plan) {
  const localDirect=Boolean(
    result?.localVisionTwoStage===true ||
    result?.localVisionDirect===true ||
    String(result?.model || '').startsWith('local/')
  );
  if (localDirect) return false;
  if (!contract || contract.ok) return false;
  if (!plan || plan.valid !== true) return false;
  if (!Array.isArray(contract.missing) || contract.missing.length < 1 || contract.missing.length > 24) return false;
  if (contract.missing.includes('QUALIFIED_WAIT_FOR_NOT_NONE')) return false;
  return true;
}

function visionPlanContract(plan) {
  const missing=[];
  if (!plan || plan.valid !== true) missing.push('STATUS_SIDE');
  if (!plan?.originTF) missing.push('ORIGIN_TF');
  if (!plan?.ownerTF) missing.push('OWNER_TF');
  if (!String(plan?.setup || '').trim()) missing.push('SETUP');
  if (!String(plan?.execPath || '').trim()) missing.push('EXEC_PATH');
  if (['WATCH','QUALIFIED'].includes(String(plan?.status||'').toUpperCase())) {
    if (!String(plan?.triggerLevelId||'').trim()) missing.push('TRIGGER_LEVEL_ID');
    if (!FRAME_ORDER.includes(String(plan?.triggerTF||'').toLowerCase())) missing.push('TRIGGER_TF');
    if (!String(plan?.invalidationLevelId||'').trim()) missing.push('INVALIDATION_LEVEL_ID');
    if (Object.prototype.hasOwnProperty.call(plan||{},'triggerSpec') && plan?.triggerSpec?.valid !== true) {
      missing.push('TRIGGER_LEVEL_SELECTION_INVALID');
    }
  }
  if (!String(plan?.why || '').trim()) missing.push('WHY');
  if (!String(plan?.riskNote || '').trim()) missing.push('RISK_NOTE');
  if (!String(plan?.waitFor || '').trim()) missing.push('WAIT_FOR');
  // CLAUDE_V109_QUALIFIED_NONE_PREFIX: "NONE — tetik oluştu" da NONE sayılır.
  if (String(plan?.status || '').toUpperCase() === 'QUALIFIED' &&
      !claudeV109.qualifiedWaitIsNone(plan?.waitFor)) {
    missing.push('QUALIFIED_WAIT_FOR_NOT_NONE');
  }
  if (String(plan?.status || '').toUpperCase() === 'WATCH' && plan?.triggerSpec?.valid !== true && isNonConcreteWait(plan?.waitFor)) {
    missing.push('WATCH_WAIT_FOR_NOT_CONCRETE');
  }
  if (!String(plan?.visionSummary || '').trim()) missing.push('VISION_SUMMARY');
  if (!String(plan?.formingContext || '').trim()) missing.push('FORMING_CONTEXT');
  if (plan?.supportTFsDeclared !== true) missing.push('SUPPORT_TFS');
  if (plan?.vetoTFsDeclared !== true) missing.push('VETO_TFS');
  if (Array.isArray(plan?.invalidSupportTFs) && plan.invalidSupportTFs.length) missing.push('SUPPORT_TFS_INVALID');
  if (Array.isArray(plan?.invalidVetoTFs) && plan.invalidVetoTFs.length) missing.push('VETO_TFS_INVALID');

  for (const frame of FRAME_ORDER) {
    const tag=frame.toUpperCase();
    const d=plan?.timeframeDiagnostics?.[frame] || {};
    if (!String(d.summary || '').trim()) missing.push('TF_'+tag);
    if (!String(d.why || '').trim()) missing.push('TF_'+tag+'_WHY');
    if (!String(d.waitFor || '').trim()) missing.push('TF_'+tag+'_WAIT');
    if (!['SUPPORT','VETO','NEUTRAL'].includes(String(d.role || ''))) missing.push('TF_'+tag+'_ROLE');
    if (!String(d.formingContext || '').trim()) missing.push('TF_'+tag+'_FORMING');
    if (!String(d.risk || '').trim()) missing.push('TF_'+tag+'_RISK');
  }

  const supportSet=new Set(Array.isArray(plan?.supportTFs)?plan.supportTFs:[]);
  const vetoSet=new Set(Array.isArray(plan?.vetoTFs)?plan.vetoTFs:[]);
  if ([...supportSet].some(tf=>vetoSet.has(tf))) missing.push('SUPPORT_VETO_OVERLAP');

  return {
    ok:missing.length===0,
    missing:[...new Set(missing)],
    warnings:[...new Set(Array.isArray(plan?.roleConsistencyWarnings)?plan.roleConsistencyWarnings:[])]
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
function applyDecisionJudgeResult(plan,decision){
  const status=String(plan?.status||'').toUpperCase();
  if(status!=='QUALIFIED')return {...plan,jevDecision:decision||null};
  if(!decision||decision.required!==true)return {...plan,jevDecision:decision||null};
  if(decision.ok===true&&decision.veto!==true)return {...plan,jevDecision:decision};
  const reasons=Array.isArray(decision?.vetoReasons)&&decision.vetoReasons.length?decision.vetoReasons:[String(decision?.reason||'JEV_REQUIRED_UNAVAILABLE')];
  return {
    ...plan,
    previousStatus:'QUALIFIED',
    status:'WATCH',
    reason:reasons[0],
    confidence:Math.min(Number(plan?.confidence)||0,49),
    jevDecision:{...decision,veto:true,vetoReasons:reasons},
    execution:'ADVISORY_ONLY'
  };
}


function resolveAttentionCandidate(scan,executionIntent=null){
  const requestedSymbol=String(executionIntent?.symbol||'').trim().toUpperCase();
  const requestedSide=String(executionIntent?.side||'').trim().toUpperCase();
  const pool=selectDeepCandidates(scan,24);
  if(requestedSymbol){
    const found=pool.find(x=>String(x?.symbol||'').trim().toUpperCase()===requestedSymbol);
    if(found)return {candidate:{...found,deepScanReason:found.deepScanReason||'DIRECT_JEV_ATTENTION'},requestedSymbol,targeted:true,reason:null};
    if(/^[A-Z0-9]{1,28}USDT$/.test(requestedSymbol)){
      return {candidate:{symbol:requestedSymbol,side:['LONG','SHORT'].includes(requestedSide)?requestedSide:null,deepScanReason:'DIRECT_JEV_ATTENTION',targetSources:['DIRECT_JEV_ATTENTION']},requestedSymbol,targeted:true,reason:null};
    }
    return {candidate:null,requestedSymbol,targeted:true,reason:'REQUESTED_SYMBOL_INVALID'};
  }
  const candidate=pool[0]||null;
  return {candidate,requestedSymbol:null,targeted:false,reason:candidate?null:'NO_ATTENTION_CANDIDATE'};
}
function structuralInvalidation(frame,side,livePrice){
  const values=side==='LONG'
    ? [frame?.swingStructure?.lastConfirmedSwingLow?.price,frame?.prior20Low,frame?.liquidity?.sellSide]
    : [frame?.swingStructure?.lastConfirmedSwingHigh?.price,frame?.prior20High,frame?.liquidity?.buySide];
  const clean=values.map(finite).filter(x=>x!==null&&x>0&&(side==='LONG'?x<livePrice:x>livePrice));
  if(!clean.length)return null;
  return side==='LONG'?Math.max(...clean):Math.min(...clean);
}
function buildSovereignPlanOptions(unified){
  const live=finite(unified?.livePrice);
  if(live===null||live<=0)return [];
  const out=[];
  for(const tf of ['5m','15m']){
    const frame=unified?.frames?.[tf];
    if(!frame?.available||frame?.fresh!==true)continue;
    for(const side of ['LONG','SHORT']){
      const invalidation=structuralInvalidation(frame,side,live);
      if(invalidation===null)continue;
      const atrPct=Math.max(0,finite(frame?.atrPct)??0);
      const buffer=Math.max(live*0.0002,live*(atrPct/100)*0.05);
      const stop=side==='LONG'?invalidation-buffer:invalidation+buffer;
      const risk=Math.abs(live-stop);
      if(!(risk>0))continue;
      const sign=side==='LONG'?1:-1;
      const tp1=live+sign*risk;
      const tp2=live+sign*risk*2;
      const tp3=live+sign*risk*3;
      if(tp3<=0)continue;
      const lane=tf==='5m'?'5M_SCALP':'15M_TRADE';
      out.push({
        id:side+'_'+lane,
        side,lane,originTF:tf,ownerTF:tf,entryMode:'MARKET_NOW',
        entryPrice:live,invalidationPrice:invalidation,stopPrice:stop,
        takeProfit1:tp1,takeProfit2:tp2,takeProfit3:tp3,
        basis:'CLOSED_'+tf.toUpperCase()+'_STRUCTURE',
        management:'JEV_SELECTED_AFTER_ENTRY'
      });
    }
  }
  return out;
}
function sovereignRequestedFrames(pass1){
  const requested=new Set(Array.isArray(pass1?.requestedEvidence)?pass1.requestedEvidence:[]);
  const frames=[];
  if(requested.has('TRADINGVIEW_5M'))frames.push('5m');
  if(requested.has('TRADINGVIEW_15M'))frames.push('15m');
  if(requested.has('TIMING_1M'))frames.push('1m');
  if(requested.has('TIMING_3M'))frames.push('3m');
  if(requested.has('HIGHER_TF_CONTEXT'))frames.push('30m','1h','4h','1d');
  return [...new Set(frames)];
}
function compactEvidenceFrame(f){
  if(!f?.available)return {available:false,reason:f?.reason||'UNAVAILABLE'};
  return {
    available:true,fresh:f.fresh===true,asOf:f.asOf||null,close:f.close??null,trend:f.trend||null,
    rsi14:f.rsi14??null,atrPct:f.atrPct??null,breakOfStructure:f.breakOfStructure||null,
    prior20High:f.prior20High??null,prior20Low:f.prior20Low??null,
    candle:f.candle||null,patterns:Array.isArray(f.patterns)?f.patterns.slice(-4):[],
    swingStructure:f.swingStructure||null,liquidity:f.liquidity||null,smcContext:withoutFib(f.smcContext)
  };
}
async function buildSovereignEvidence({candidate,unified,pass1,committee}){
  const requested=new Set(Array.isArray(pass1?.requestedEvidence)?pass1.requestedEvidence:[]);
  const evidence={requested:[...requested],missing:[],visual:null};
  if(requested.has('TIMING_1M'))evidence.timing1m=compactEvidenceFrame(unified?.frames?.['1m']);
  if(requested.has('TIMING_3M'))evidence.timing3m=compactEvidenceFrame(unified?.frames?.['3m']);
  if(requested.has('HIGHER_TF_CONTEXT')){
    evidence.higherTf=Object.fromEntries(['30m','1h','4h','1d'].map(tf=>[tf,compactEvidenceFrame(unified?.frames?.[tf])]));
  }
  if(requested.has('ORDER_FLOW_CVD')){
    evidence.orderFlow=unified?.marketMakerEvidence?.orderFlow||unified?.microstructure?.streaming?.orderFlow||{available:false,reason:'ORDER_FLOW_UNAVAILABLE'};
  }
  if(requested.has('DEPTH_L2')){
    evidence.depth={
      sourceQuality:unified?.dataQuality?.microstructureQuality||null,
      depth20Imbalance:unified?.microstructure?.depth20Imbalance??unified?.microstructure?.streaming?.depth20Imbalance??null,
      spreadBps:unified?.microstructure?.spreadBps??null,
      bookBehavior:unified?.marketMakerEvidence?.bookBehavior||null,
      participantIdentity:unified?.marketMakerEvidence?.participantIdentity||'NOT_IDENTIFIED',
      participantIntent:unified?.marketMakerEvidence?.participantIntent||'NOT_ASSERTED'
    };
  }
  if(requested.has('DERIVATIVES'))evidence.derivatives=unified?.derivatives||{available:false};
  if(requested.has('OBSERVED_LIQUIDATIONS'))evidence.observedLiquidations=unified?.liquidationContext||{available:false};
  if(requested.has('HISTORY_OUTCOME'))evidence.historyOutcome=compactOutcomeLearningContext(unified?.learning||null);
  const visualFrames=sovereignRequestedFrames(pass1).filter(tf=>
    (tf==='5m'&&requested.has('TRADINGVIEW_5M'))||
    (tf==='15m'&&requested.has('TRADINGVIEW_15M'))||
    (tf==='1m'&&requested.has('TIMING_1M'))||
    (tf==='3m'&&requested.has('TIMING_3M'))||
    (['30m','1h','4h','1d'].includes(tf)&&requested.has('HIGHER_TF_CONTEXT'))
  );
  if(visualFrames.length){
    const vision=await buildVisionCharts(candidate.symbol,128,{frames:visualFrames});
    if(vision.attached>0){
      try{
        const labels=visualFrames.map(tf=>'OBS_'+tf.toUpperCase()+': concise factual visual observations only').join('\n');
        const vr=await committee({
          role:'STRUCTURE',
          system:'You are a Vision EVIDENCE_ONLY worker for JEV. Read only the requested chart images. Report factual structure, candle, liquidity, OB/FVG/sweep observations. Do not choose LONG/SHORT, do not score, do not QUALIFY/VETO, and do not propose an order. Forming candles are context only. Binance/BrainHub numeric truth outranks visual interpretation.',
          prompt:'Requested symbol: '+candidate.symbol+'\nRequested frames: '+visualFrames.join(',')+'\nReturn only evidence observations, one line per requested timeframe.\n'+labels,
          images:vision.images,
          localContext:{symbol:unified.symbol,frames:Object.fromEntries(visualFrames.map(tf=>[tf,compactEvidenceFrame(unified?.frames?.[tf])]))}
        });
        evidence.visual={
          authority:'EVIDENCE_ONLY',requestedFrames:visualFrames,attached:vision.attached,required:vision.required,
          source:vr?.vision?.source||vision.mode||'VISION_EVIDENCE',text:String(vr?.text||'').slice(0,6000),
          frames:vision.frames,failures:vision.failures
        };
      }catch(e){
        evidence.visual={authority:'EVIDENCE_ONLY',requestedFrames:visualFrames,attached:vision.attached,required:vision.required,error:String(e?.message||e).slice(0,300),frames:vision.frames,failures:vision.failures};
      }
    }else{
      evidence.visual={authority:'EVIDENCE_ONLY',requestedFrames:visualFrames,attached:0,required:vision.required,failures:vision.failures};
    }
  }
  return evidence;
}
function sovereignJournalPayload({candidate,plan,pass1,final,vision,riskGate,executionReadiness}){
  return {
    contract:'R2.5.3.2_JEV_SOVEREIGN_5M_15M',
    candidate:{symbol:candidate?.symbol||null,attentionSource:candidate?.deepScanReason||null,targetSources:Array.isArray(candidate?.targetSources)?candidate.targetSources.slice(0,8):[]},
    plan:plan?{
      valid:plan.valid,status:plan.status,side:plan.side||null,originTF:plan.originTF||null,ownerTF:plan.ownerTF||null,
      lane:plan.lane||null,entryPrice:plan.entryPrice??null,invalidationPrice:plan.invalidationPrice??null,stopPrice:plan.stopPrice??null,
      takeProfit1:plan.takeProfit1??null,takeProfit2:plan.takeProfit2??null,takeProfit3:plan.takeProfit3??null,
      managementStyle:plan.managementStyle||null,waitFor:plan.waitFor||null,jevSovereign:plan.jevSovereign===true
    }:null,
    jevPass1:pass1?{laneFocus:pass1.laneFocus,directionFocus:pass1.directionFocus,requestedEvidence:pass1.requestedEvidence||[],costUsd:pass1.costUsd??null}:null,
    jevFinal:final?{action:final.action,selectedPlanId:final.selectedPlanId,managementStyle:final.managementStyle,costUsd:final.costUsd??null}:null,
    vision:vision?{requestedFrames:vision.requestedFrames||[],attached:vision.attached??0,required:vision.required??0,source:vision.source||null,error:vision.error||null}:null,
    riskGate:riskGate?{ok:riskGate.ok,reasons:riskGate.reasons||[]}:null,
    executionReadiness:executionReadiness?{ok:executionReadiness.ok,reasons:executionReadiness.reasons||[]}:null
  };
}
async function runSovereignFlow({scan,committee,store,accountRisk=null,stopRisk=null,killSwitch=null,executionClaim=null,executionIntent=null,decisionPass1,decisionFinal}){
  const selection=resolveAttentionCandidate(scan,executionIntent);
  const candidate=selection.candidate;
  if(!candidate)return {ok:true,candidateFound:false,reason:selection.reason||'NO_ATTENTION_CANDIDATE',execution:'ADVISORY_ONLY',orderPlaced:false,jevSovereign:true};
  const [symbol,global]=await Promise.all([symbolContext(candidate.symbol),globalContext()]);
  const unified=buildUnifiedContext({symbol,global,candidate});
  if(typeof store?.learningContext==='function'){
    try{unified.learning=store.learningContext({symbol:candidate.symbol});}catch{unified.learning=null;}
  }
  if(!unified?.dataQuality?.advisoryUsable||finite(unified?.livePrice)===null){
    return {ok:true,candidateFound:true,symbol:candidate.symbol,status:'REVIEW_REQUIRED',reason:'SOVEREIGN_BASE_CONTEXT_UNUSABLE',execution:'ADVISORY_ONLY',orderPlaced:false,jevSovereign:true};
  }
  const pass1=await decisionPass1({candidate,unified});
  if(!pass1?.ok){
    return {ok:true,candidateFound:true,symbol:candidate.symbol,status:'REVIEW_REQUIRED',reason:pass1?.reason||'JEV_SOVEREIGN_PASS1_UNAVAILABLE',jevPass1:pass1||null,execution:'ADVISORY_ONLY',orderPlaced:false,jevSovereign:true};
  }
  const evidence=await buildSovereignEvidence({candidate,unified,pass1,committee});
  const planOptions=buildSovereignPlanOptions(unified);
  const final=await decisionFinal({candidate,unified,evidence,planOptions});
  if(!final?.ok){
    return {ok:true,candidateFound:true,symbol:candidate.symbol,status:'REVIEW_REQUIRED',reason:final?.reason||'JEV_SOVEREIGN_FINAL_UNAVAILABLE',jevPass1:pass1,jevDecision:final||null,evidence,execution:'ADVISORY_ONLY',orderPlaced:false,jevSovereign:true};
  }
  const chosen=final.selectedPlan;
  const plan=chosen?{
    valid:true,status:'QUALIFIED',side:chosen.side,originTF:chosen.originTF,ownerTF:chosen.ownerTF,
    lane:chosen.lane,setup:'JEV_SOVEREIGN_'+chosen.lane,execPath:'JEV_FINAL_MARKET_NOW',
    entryMode:chosen.entryMode,entryPrice:chosen.entryPrice,invalidationPrice:chosen.invalidationPrice,
    stopPrice:chosen.stopPrice,takeProfit1:chosen.takeProfit1,takeProfit2:chosen.takeProfit2,takeProfit3:chosen.takeProfit3,
    managementStyle:final.managementStyle,waitFor:'NONE',formingContext:'CONTEXT_ONLY',
    why:'JEV FINAL selected '+chosen.id+' after directing evidence collection.',
    riskNote:'Post-JEV code may block only hard execution/integrity safety; it must not re-vote strategy.',
    jevSovereign:true,jevDecision:final,evidenceRequest:pass1.requestedEvidence||[],execution:'ADVISORY_ONLY'
  }:{
    valid:true,status:'WATCH',side:null,originTF:null,ownerTF:null,lane:null,setup:'JEV_SOVEREIGN_WAIT',
    execPath:'WAIT',waitFor:'JEV will reconsider on a new radar event or materially changed evidence.',
    why:'JEV FINAL chose WAIT.',riskNote:'No order is authorized.',jevSovereign:true,jevDecision:final,
    evidenceRequest:pass1.requestedEvidence||[],execution:'ADVISORY_ONLY'
  };
  const riskGate=preflightRiskGate({plan,unified});
  const dryRunExecutor=buildDryRunOrder({
    intent:{mode:'DRY_RUN',live:false,symbol:candidate.symbol,side:plan.side},
    riskGate
  });
  const executionReadiness=combineExecutionReadiness(riskGate,dryRunExecutor);
  const visionMeta=evidence?.visual||null;
  const out={
    ok:true,candidateFound:true,committeeCalled:Boolean(visionMeta),candidate,targetedExecution:selection.targeted,
    unifiedContext:unified,vision:visionMeta||{authority:'EVIDENCE_ONLY',requestedFrames:[],attached:0,required:0},
    committee:{mode:'JEV_DIRECTED_EVIDENCE_ONLY',available:true},plan,preJevPlan:null,
    jevPass1:pass1,jevDecision:final,evidence,riskGate,dryRunExecutor,executionReadiness,
    execution:'ADVISORY_ONLY',orderPlaced:false,jevSovereign:true
  };
  try{
    out.journalId=store.journal('PLAN',candidate.symbol,sovereignJournalPayload({candidate,plan,pass1,final,vision:visionMeta,riskGate,executionReadiness}));
  }catch(e){
    out.journalWarning=String(e?.message||e).slice(0,160);
  }
  if(typeof store?.recordLearning==='function'){
    try{store.recordLearning('PLAN_DECISION',candidate.symbol,{side:plan.side,setup:plan.setup,originTF:plan.originTF,ownerTF:plan.ownerTF,decision:plan.status,confidence:null,jevDecision:{action:final.action,selectedPlanId:final.selectedPlanId,managementStyle:final.managementStyle},contextVersion:unified.version});}catch{}
  }
  return out;
}


async function run({ scan, committee, store, accountRisk = null, stopRisk = null, killSwitch = null, executionClaim = null, executionIntent = null, decisionJudge = null, decisionPass1 = null, decisionFinal = null }) {
  if(typeof decisionPass1==='function'&&typeof decisionFinal==='function'){
    return runSovereignFlow({scan,committee,store,accountRisk,stopRisk,killSwitch,executionClaim,executionIntent,decisionPass1,decisionFinal});
  }
  const selection = resolveExecutionCandidate(scan, executionIntent);
  const candidate = selection.candidate;
  if (!candidate) return {
    ok:true,
    candidateFound:false,
    requestedSymbol:selection.requestedSymbol,
    targetedExecution:selection.targeted,
    trackingOnly:selection.trackingOnly === true,
    reason:selection.reason || 'NO_QUALIFIED_EARLY_EXPANSION',
    committeeCalled:false,
    execution:'ADVISORY_ONLY',
    orderPlaced:false
  };
  const [symbol, global] = await Promise.all([symbolContext(candidate.symbol), globalContext()]);
  const unified = buildUnifiedContext({ symbol, global, candidate });
  if(typeof store?.learningContext==='function'){
    try{unified.learning=store.learningContext({symbol:candidate.symbol});}catch{unified.learning=null;}
  }
  if (!unified.dataQuality.advisoryUsable) {
    const out = { ok:true, candidateFound:true, symbol:candidate.symbol, status:'REVIEW_REQUIRED', reason:'NO_FRESH_TIMEFRAME_CONTEXT', committeeCalled:false, execution:'ADVISORY_ONLY', orderPlaced:false };
    out.journalId = store.journal('PLAN_REJECT', candidate.symbol, out);
    return out;
  }
  // CLAUDE_V111_TRIGGER_REVALIDATION: worker kapanmış-mum sayısal tetiği gördüyse saklanan 9TF planı
  // taze veriyle yeniden doğrulanır (Vision ~8 dk atlanır). Geçmezse aşağıdaki tam 9TF yolu aynen çalışır.
  let vision = null;
  let result;
  let plan;
  let revalidation = null;
  const revalIntent = executionIntent?.triggerRevalidation && typeof executionIntent.triggerRevalidation === 'object' && executionIntent?.positionReviewOnly !== true
    ? executionIntent.triggerRevalidation : null;
  const v109Mode = claudeV109.readConfig().deterministicTriggerMode;
  if (revalIntent) {
    let stored = null;
    try { stored = typeof store?.latestJournal === 'function' ? store.latestJournal('PLAN', candidate.symbol) : null; } catch { stored = null; }
    revalidation = claudeV111.revalidateTrigger({ stored, intent:revalIntent, candidate, unified, now:Date.now() });
    const applied = revalidation.ok === true && v109Mode === 'BINDING';
    try {
      store.journal('CLAUDE_V111_REVALIDATION', candidate.symbol, {
        ok:revalidation.ok === true, applied, mode:v109Mode, reasons:revalidation.reasons || [],
        side:revalIntent.side, triggerTF:revalIntent.triggerTF, triggerPrice:revalIntent.triggerPrice,
        info:revalidation.info || null, lane:revalidation.lane || revalidation.info?.lane || null,
        storedPlanJournalId:stored?.id || null
      });
    } catch {}
    if (applied) {
      const sv = stored?.payload?.vision && typeof stored.payload.vision === 'object' ? stored.payload.vision : {};
      vision = {
        ok:true, required:Number(sv.required || FRAME_ORDER.length), attached:Number(sv.attached || FRAME_ORDER.length),
        barsRequested:sv.barsRequested || null, mode:'CLAUDE_V111_STORED_9TF_PLAN', frames:Array.isArray(sv.frames) ? sv.frames : [],
        failures:[], reusedFromJournalId:stored?.id || null
      };
      result = {
        ok:true, available:true, degraded:false, mode:'claude_v111_trigger_revalidation', model:'',
        source:'STORED_9TF_VISION_PLAN_REVALIDATED', text:null,
        vision:{ attached:vision.attached, timeframes:FRAME_ORDER.slice(), modes:['STORED'] },
        storedPlanAt:revalidation.info?.storedPlanAt || null
      };
      plan = revalidation.plan;
    }
  }
  // CLAUDE_V112_SCALP_FAST_LANE: momentum scalp sinyali taze veriyle yeniden hesaplanır; Vision çağrılmaz.
  const fastIntent = executionIntent?.scalpFastLane && typeof executionIntent.scalpFastLane === 'object' && executionIntent?.positionReviewOnly !== true
    ? executionIntent.scalpFastLane : null;
  let fastLane = null;
  if (!plan && fastIntent) {
    fastLane = claudeV112.scalpFastLaneSignal({ candidate, unified, maxEntryDeviationPct:finite(fastIntent.maxEntryDeviationPct) ?? 0.5 });
    const sameSetup = fastLane.ok === true && fastLane.side === String(fastIntent.side || fastLane.side).toUpperCase();
    vision = { ok:false, required:0, attached:0, barsRequested:null, mode:'CLAUDE_V112_FAST_LANE_NO_VISION', frames:[], failures:[] };
    result = { ok:true, available:true, degraded:false, mode:'claude_v112_scalp_fast_lane', model:'', source:'DETERMINISTIC_CLOSED_CANDLE', text:null, vision:{ attached:0, timeframes:[], modes:[] } };
    plan = sameSetup
      ? claudeV112.fastLanePlan({ signal:fastLane, unified, candidate })
      : { valid:false, status:'REVIEW_REQUIRED', reason:'CLAUDE_V112_FAST_LANE_SIGNAL_GONE', side:String(candidate?.side || '').toUpperCase(), fastLaneReasons:fastLane.reasons || [], fastLaneMisses:fastLane.misses || [], claudeFastLane:{ ok:false, applied:false, reasons:fastLane.reasons || [] }, confidence:0, execution:'ADVISORY_ONLY' };
    if (plan && plan.status === 'QUALIFIED') plan = { ...plan, triggerSpec:resolveNumericTriggerPlan(plan, unified) };
    // CLAUDE_V113_JEV_FULL_EVIDENCE: aynı coinin son tam 9TF görsel analizi (≤120 dk) Jev kaydına eklenir —
    // hızlı hatta da Jev grafik okumasını (Vision yorumu, TF başına özet/bekleme/risk) görür.
    try {
      const last = typeof store?.latestJournal === 'function' ? store.latestJournal('PLAN', candidate.symbol) : null;
      const lp = last?.payload?.plan || null;
      if (lp && Date.now() - Number(last.ts || 0) <= 120 * 60000) {
        unified.lastVisionAnalysis = {
          ageMin:Math.round((Date.now() - Number(last.ts)) / 60000), status:lp.status || null, side:lp.side || null,
          setup:String(lp.setup || '').slice(0,160), why:String(lp.why || '').slice(0,500), waitFor:String(lp.waitFor || '').slice(0,240),
          visionSummary:String(lp.visionSummary || '').slice(0,700),
          frames:Object.fromEntries(Object.entries(lp.timeframeDiagnostics || {}).slice(0,9).map(([tf, d]) => [tf, {
            summary:String(d?.summary || '').slice(0,200), role:d?.role || null, waitFor:String(d?.waitFor || '').slice(0,140), risk:String(d?.risk || '').slice(0,140)
          }]))
        };
      }
    } catch {}
  }
  // CLAUDE_V112_CONCURRENT_REVALIDATION: hızlı hat, yeniden doğrulama geçmezse tam Vision'a DÜŞMEZ
  // (ana Leader AUTO döngüsü o coini daha sonra tam 9TF ile yeniler).
  if (!plan && executionIntent?.revalidationOnly === true) {
    const out = { ok:true, candidateFound:true, symbol:candidate.symbol, status:'REVIEW_REQUIRED', reason:'CLAUDE_V112_REVALIDATION_NOT_APPLIED', revalidation:revalidation ? { ok:revalidation.ok === true, reasons:revalidation.reasons || [] } : null, committeeCalled:false, execution:'ADVISORY_ONLY', orderPlaced:false };
    return out;
  }
  if (!plan) {
  vision = await buildVisionCharts(candidate.symbol, 128);
  if (!vision.ok) {
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
  const tfPromptTags={ '1m':'1M','3m':'3M','5m':'5M','15m':'15M','30m':'30M','45m':'45M','1h':'1H','4h':'4H','1d':'1D' };
  const tfPromptLines=FRAME_ORDER.flatMap(frame => {
    const tag=tfPromptTags[frame];
    const synthetic=frame==='45m' ? ' Sentetik 45m olduğu açıkça yazılsın; bağımsız oy gibi sayılmasın.' : '';
    return [
      'TF_'+tag+': Türkçe kısa grafik/veri özeti ve LONG/SHORT etkisi.'+synthetic,
      'TF_'+tag+'_WHY: Türkçe; bu TF’de sinyal/kurulum neden oluştu veya neden oluşmadı, somut görsel + deterministik kanıtla',
      'TF_'+tag+'_WAIT: Türkçe; bu TF için beklenen tam koşul; ek koşul yoksa NONE',
      'TF_'+tag+'_ROLE: SUPPORT | VETO | NEUTRAL',
      'TF_'+tag+'_FORMING: Türkçe; mevcut forming mumun ne anlattığı ve bunun kapanmış mum teyidi olmadığı açıkça belirtilsin',
      'TF_'+tag+'_RISK: Türkçe; bu TF özelindeki ana bozulma/yanlış okuma riski'
    ];
  });
  const prompt = [
    'PLAN_CODE: LH_UNIFIED_9TF',
    'Return exactly these lines as plain text. Do NOT use Markdown bullets, bold, tables, JSON, code fences, headings or commentary before/after the schema:',
    'STATUS: WATCH | QUALIFIED | REJECT',
    'SIDE: LONG | SHORT',
    'CONFIDENCE: 0-100',
    'ORIGIN_TF: 1m | 3m | 5m | 15m | 30m | 45m | 1h | 4h | 1d',
    'OWNER_TF: 1m | 3m | 5m | 15m | 30m | 45m | 1h | 4h | 1d',
    'SETUP: short setup name',
    'EXEC_PATH: short path name',
    'TRIGGER_LEVEL_ID: aşağıdaki TRIGGER_LEVEL_CANDIDATES_JSON içinden seç; fiyat yazma',
    'TRIGGER_TF: trigger seviyesinin zaman dilimi',
    'INVALIDATION_LEVEL_ID: aynı TRIGGER_TF içinde seçilen yön için izinli invalidation ID; fiyat yazma',
    'WHY: Türkçe, net ve somut gerekçe; grafik + veri birlikte değerlendirilsin',
    'RISK_NOTE: Türkçe, işlemi bozabilecek ana risk',
    'WAIT_FOR: Türkçe, sinyal için tam olarak ne beklendiği; QUALIFIED ise değer TAM OLARAK NONE olmalı',
    'QUALIFIED güvenlik kuralı: ORIGIN_TF veya OWNER_TF kendi TF_*_ROLE alanında VETO ise ya da seçilen execution path üzerinde çözülmemiş teyit/reclaim/closed-candle koşulu varsa STATUS QUALIFIED olamaz. Diğer TF VETO rolleri bağlamsal çelişkidir; otomatik çoğunluk veto değildir ve Jev final TF-conflict denetimine taşınır.',
    'SUPPORT_TFS: TF_... değil, yalnız virgülle 1m,3m,5m,15m,30m,45m,1h,4h,1d değerleri; destek yoksa NONE',
    'VETO_TFS: TF_... değil, yalnız virgülle 1m,3m,5m,15m,30m,45m,1h,4h,1d değerleri; veto yoksa NONE',
    'FORMING_CONTEXT: Türkçe; 9TF forming mum bağlamının özeti ve kapanmış mum teyidi yerine geçmediği açıkça yazılsın',
    ...tfPromptLines,
    'VISION_SUMMARY: Türkçe, 9 grafikte görülen ortak yapı, destek/veto ilişkisi, çelişkiler ve origin→owner devamlılığı',
    'EXECUTION: ADVISORY_ONLY',
    '',
    'VISION_INPUT: 1m/3m/5m annotated charts are 640x360 with '+vision.barsRequested+' recent candles; 15m main chart is 896x504/64 candles; 30m/45m/1h/4h/1d context charts are 640x360/64 candles. Current forming candle is visual context only.',
    'Vision rule: read every attached chart image together with UNIFIED_CONTEXT_JSON. The current forming candle may shape a WATCH idea but MUST NOT be used as closed-candle confirmation. Do not ignore a visible structural conflict merely because numeric scores are high.',
    'Explanation rule: WHY, RISK_NOTE, WAIT_FOR, FORMING_CONTEXT, TF_* and VISION_SUMMARY must be in Turkish, coin-specific and evidence-based. Every TF must separately state WHY, WAIT, ROLE, FORMING and RISK. SUPPORT_TFS/VETO_TFS are summary fields and should copy exactly the timeframes marked SUPPORT/VETO in TF_*_ROLE; never list a NEUTRAL timeframe. State what supports the setup, what blocks it, and the exact condition that would change WATCH/REJECT into QUALIFIED. Avoid generic filler.',
    'Trade-lane rule: 15m is the MAIN trade lane. 1m/3m/5m are a SCALP_MOMENTUM detection/timing lane: a single lower timeframe can start tracking but can NEVER qualify a trade by itself. SCALP_MOMENTUM requires at least two of 1m/3m/5m aligned on the same side, fresh 15m context, and no hard 15m opposite structure. Do not force full 15m entry confirmation for a valid scalp lane; use 15m as context/veto. 30m/45m/1h/4h/1d are primarily structure, liquidity, formation and exhaustion context rather than votes.',
    'Deterministic timeframe fields are calculated from CLOSED candles. NO_ACTIVE_BREAKOUT only means the latest closed candle did not close beyond its prior-20 boundary; it is not a generic missing-confirmation flag. TF_*_FORMING is context only, never a global wait requirement.',
    'Timeframes are context, not votes. Only origin/owner unresolved execution conditions may keep a setup in WATCH; a non-origin/non-owner contextual WAIT/VETO must not automatically kill an otherwise valid earliest opportunity. Preserve material conflicts for Jev review. Synthetic 45m is derived from closed 15m candles and is not an independent vote.',
    'A FAILED_BREAKOUT timeframe is not an immediate breakout entry; require reclaim or another valid execution path.',
    'Observed forceOrder liquidation prints may inform liquidity context, but they are not a complete heatmap, future cluster map, or market-maker intent.',
    'Partial depth20 streaming is not true OFI. Respect the supplied quality labels and do not multiply correlated flow evidence into fake confirmations.',
    'OPEN_SOURCE_REFERENCE_MICRO: depth entropy, wall concentration, wall pressure and microprice are independent local calculations inspired by reviewed MIT research patterns; treat them as ONE correlated soft microstructure family only.',
    'Entropy/concentration/microprice cannot create a hard veto, cannot independently qualify a trade, and cannot prove spoofing, hidden liquidity or market-maker intent. Missing/stale auxiliary micro data is PUANSIZ, not bearish/bullish evidence.',
    'OPEN_SOURCE_REFERENCE_SMC: swingStructure, CHOCH/BOS, premium-discount dealing range, equilibrium, OTE reference zones and FVG CE50 are independent closed-candle calculations inspired by reviewed MIT SMC semantics. Use them as structural context, not as standalone entry signals.',
    'SMC context must not invent order blocks, breakers, mitigation, hidden liquidity or market-maker intent when those fields are not supplied.',
    'Do not invent news, levels, missing flow, liquidation maps, or hidden intent. Do not place an order.',
    '',
    'TRADE_LANE_CONTEXT_JSON:',
    JSON.stringify(unified.tradeLanes?.[String(candidate?.side||'').toUpperCase()]||null),
    'TRIGGER_LEVEL_CANDIDATES_JSON:',
    JSON.stringify(triggerCandidatesForPlan(unified,String(candidate?.side||'').toUpperCase())),
    'UNIFIED_CONTEXT_JSON:',
    JSON.stringify(compactUnifiedContext(unified))
  ].join('\n');
  try {
    result = await committee({
      role:'STRUCTURE',
      system:'You are the Brain Hub multi-timeframe futures structure analyst. Analyze the attached 9-timeframe charts and supplied market data together. Use two explicit lanes: MAIN_15M for the primary 15m trade process, and SCALP_MOMENTUM where 1m/3m/5m may start early but no single lower timeframe can qualify alone; at least two lower timeframes must align and 15m must not be a hard opposite veto. The forming candle is visual context only and cannot confirm a setup. Respect failed-breakout protection, structural invalidation, liquidity semantics, observed-liquidation limits and data-quality labels. Produce detailed coin-specific Turkish diagnostic explanations for every timeframe and the exact missing trigger when not qualified. Output must follow the requested labels exactly as plain text: no Markdown, bullets, tables, JSON, code fences, headings or extra prose. This endpoint is advisory only.',
      prompt,
      images:vision.images,
      localContext:compactLocalModelContext(unified)
    });
    plan = planFields(result.text);
    plan = withTriggerSpec(plan,unified);
    plan = reconcileVisionPlanSemantics(plan);
    plan = tradeLanes.enforceQualification(plan,unified,candidate);
    plan = {...plan,watchNeedsSemanticResolution:watchPlanNeedsSemanticResolution(plan)};
    if (Number(result?.vision?.attached || 0) !== FRAME_ORDER.length) {
      plan = {
        ...plan,
        valid:false,
        status:'REVIEW_REQUIRED',
        reason:'VISION_COMMITTEE_INPUT_INCOMPLETE',
        side:plan?.side || null,
        confidence:0,
        execution:'ADVISORY_ONLY'
      };
    } else {
      let contract=visionPlanContract(plan);
      let repairMeta=null;

      // Non-local multimodal routes may still make one schema repair pass.
      // Local Qwen already performs TF/core/narrative text-only repairs inside
      // runLocalVisionCommittee; re-sending all 9 images here would duplicate
      // the expensive Vision pass. Missing local fields therefore fail closed.
      if (shouldAttemptVisionRepair(result,contract,plan)) {
        try {
          const repair=await committee({
            role:'STRUCTURE',
            system:'You are repairing an incomplete Brain Hub 9TF Vision schema. Use the attached charts and supplied market context. Return only the requested missing LABEL: value lines. Do not place an order and do not invent facts.',
            prompt:visionRepairPrompt(prompt,plan,contract.missing),
            images:vision.images,
            localContext:compactLocalModelContext(unified)
          });
          const mergedText=mergeVisionRepairText(result.text,repair?.text);
          let repairedPlan=planFields(mergedText);
          repairedPlan=withTriggerSpec(repairedPlan,unified);
          repairedPlan=reconcileVisionPlanSemantics(repairedPlan);
          repairedPlan=tradeLanes.enforceQualification(repairedPlan,unified,candidate);
          const repairedContract=visionPlanContract(repairedPlan);
          repairMeta={
            attempted:true,
            model:String(repair?.model || ''),
            missingBefore:contract.missing.slice(0,32),
            missingAfter:repairedContract.missing.slice(0,32),
            ok:repairedContract.ok
          };
          result={
            ...result,
            text:mergedText,
            visionRepair:repairMeta
          };
          plan=repairedPlan;
          contract=repairedContract;
        } catch (repairError) {
          repairMeta={
            attempted:true,
            ok:false,
            error:String(repairError?.message || repairError).slice(0,400),
            missingBefore:contract.missing.slice(0,32)
          };
        }
      }

      plan = {
        ...plan,
        visionContractWarnings:Array.isArray(contract.warnings)?contract.warnings:[],
        visionRepair:repairMeta,
        execution:'ADVISORY_ONLY'
      };
      if (!contract.ok) {
        plan = {
          ...plan,
          valid:false,
          status:'REVIEW_REQUIRED',
          reason:'VISION_COMMITTEE_OUTPUT_INCOMPLETE',
          confidence:0,
          missingVisionFields:contract.missing,
          execution:'ADVISORY_ONLY'
        };
      }
    }
  } catch (e) {
    const detail = String(e.message || e).slice(0,1200);
    const failureMeta=e&&e.committee&&typeof e.committee==='object'?e.committee:null;
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
      available:false,
      degraded:false,
      mode:'unavailable',
      model:'',
      source:selection.targeted ? 'VISION_REQUIRED_FAIL_CLOSED' : 'DETERMINISTIC_FALLBACK',
      error:'COMMITTEE_UNAVAILABLE',
      detail,
      requiredAnalystReplies:Number(failureMeta?.required || 0),
      receivedAnalystReplies:Number(failureMeta?.received || 0),
      failed:Array.isArray(failureMeta?.failures)?failureMeta.failures.slice(0,12):[],
      attemptedModels:Array.isArray(failureMeta?.attemptedModels)?failureMeta.attemptedModels.slice(0,12):[],
      vision:failureMeta?.vision || {attached:vision.attached,timeframes:vision.frames?.map?.(x=>x.tf)||[],modes:[]},
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
  } // CLAUDE_V111: tam 9TF Vision yolu sonu (yeniden doğrulama uygulanmadıysa çalıştı)
  if (revalidation && plan && typeof plan === 'object' && plan.claudeTriggerRevalidation?.applied !== true) {
    // Uygulanmayan (SHADOW/red) doğrulama ayrı alanda tutulur: sonraki gerçek doğrulamayı ve kod-tetik gölgesini engellemez.
    plan = { ...plan, claudeTriggerRevalidationShadow:{ ok:revalidation.ok === true, applied:false, mode:v109Mode, reasons:revalidation.reasons || [] } };
  }
  // CLAUDE_V109_DETERMINISTIC_TRIGGER_SHADOW → CLAUDE_V111_MOMENTUM_SCALP_TRIGGER: model WATCH dediğinde
  // v110 işlem hattına uygun kapanmış-mum kırılımı var mı? Momentum coin + 2/3 alt TF → 1m/3m/5m; aksi 15m.
  // SHADOW: yalnız kayıt. BINDING: WATCH→QUALIFIED, ardından v110 hat kuralı yeniden uygulanır; Jev, risk,
  // likidasyon ve LIVE kapıları aynen çalışır.
  if(plan&&typeof plan==='object'&&executionIntent?.positionReviewOnly!==true&&plan.claudeTriggerRevalidation?.applied!==true&&!plan.claudeFastLane&&['WATCH','QUALIFIED'].includes(String(plan.status||'').toUpperCase())){
    const v109cfg=claudeV109.readConfig();
    const dt=claudeV111.laneAwareTrigger({plan,candidate,unified});
    const wouldQualify=dt.ok===true&&String(plan.status||'').toUpperCase()==='WATCH';
    if(wouldQualify&&v109cfg.deterministicTriggerMode==='BINDING'){
      plan=claudeV111.applyLaneTrigger(plan,dt);
      plan={...plan,triggerSpec:resolveNumericTriggerPlan(plan,unified)};
    }else{
      plan={...plan,claudeDeterministicTrigger:{...dt,wouldQualify,applied:false,mode:v109cfg.deterministicTriggerMode,version:'CLAUDE_V111'}};
    }
    if(wouldQualify){try{store.journal('CLAUDE_V109_DT',candidate.symbol,{side:plan.side,mode:v109cfg.deterministicTriggerMode,tf:dt.tf,level:dt.level,livePrice:dt.livePrice,laneName:dt.laneName,momentumTags:dt.momentum?.tags||[],applied:v109cfg.deterministicTriggerMode==='BINDING',version:'CLAUDE_V111'});}catch{}}
  }
  // CLAUDE_V111_LANE_ENFORCED_AFTER_DT: kod-tetik veya yeniden doğrulama ile QUALIFIED olan plan da
  // v110 hat kuralından geçer (1m/3m/5m tek başına karar vermez; 15m ana hat).
  if(plan&&typeof plan==='object'&&String(plan.status||'').toUpperCase()==='QUALIFIED'&&(plan.claudeDeterministicTrigger?.applied===true||plan.claudeTriggerRevalidation?.applied===true||plan.claudeFastLane?.applied===true)){
    plan=tradeLanes.enforceQualification(plan,unified,candidate);
  }
  const preJevPlan=plan&&typeof plan==='object'?{...plan}:null;
  let jevDecision=null;
  let jevShadowDecision=null;
  const currentPlanStatus=String(plan?.status||'').toUpperCase();
  if(typeof decisionJudge==='function'&&executionIntent?.positionReviewOnly!==true&&currentPlanStatus==='QUALIFIED'){
    try{
      jevDecision=await decisionJudge({candidate,plan,unified});
    }catch(e){
      jevDecision={ok:false,configured:true,required:true,called:true,veto:true,reason:'JEV_JUDGE_EXCEPTION',detail:String(e?.message||e).slice(0,300)};
    }
    // CLAUDE_V109_JEV_ROLE_WEIGHTED_SHADOW: iki kural da hesaplanır; bağlayıcı olan config'e göre.
    jevDecision=claudeV109.annotateJevDecision(jevDecision,plan);
    plan=applyDecisionJudgeResult(plan,jevDecision);
  }else if(typeof decisionJudge==='function'&&executionIntent?.positionReviewOnly!==true&&currentPlanStatus==='WATCH'){
    try{
      jevShadowDecision=await decisionJudge({candidate,plan,unified,shadow:true});
    }catch(e){
      jevShadowDecision={ok:false,configured:true,required:false,called:true,shadow:true,veto:null,reason:'JEV_SHADOW_EXCEPTION',detail:String(e?.message||e).slice(0,300)};
    }
    jevShadowDecision=claudeV109.annotateJevDecision(jevShadowDecision,plan,'V108_ANY_065');
    plan={...plan,jevShadowDecision,jevDecision:{ok:true,configured:null,required:false,called:false,veto:false,reason:'JEV_SHADOW_ONLY_FOR_WATCH'}};
    try{store.journal('JEV_SHADOW',candidate.symbol,{side:plan.side,status:'WATCH',decision:jevShadowDecision});}catch{}
  }else if(typeof decisionJudge==='function'){
    jevDecision={ok:true,configured:null,required:false,called:false,veto:false,reason:'JEV_NOT_NEEDED_FOR_NON_QUALIFIED'};
    plan={...plan,jevDecision};
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
      ...(executionIntent ? (({ triggerRevalidation, scalpFastLane, revalidationOnly, ...rest }) => rest)(executionIntent) : {}),
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
    committeeCalled:true,
    candidate,
    targetedExecution:selection.targeted,
    trackingOnly:selection.trackingOnly === true,
    unifiedContext:unified,
    vision:{ ok:vision.ok, required:vision.required, attached:vision.attached, barsRequested:vision.barsRequested, mode:vision.mode, frames:vision.frames, failures:vision.failures },
    committee:result,
    plan,
    preJevPlan,
    jevDecision:plan?.jevDecision||jevDecision,
    jevShadowDecision:plan?.jevShadowDecision||jevShadowDecision,
    riskGate,
    dryRunExecutor,
    executionReadiness,
    execution:'ADVISORY_ONLY',
    orderPlaced:false
  };
  // CLAUDE_V112: Vision'sız hızlı hat planları ayrı türde saklanır (yeniden doğrulama yalnız 9TF Vision planlarını kullanır).
  out.journalId = store.journal(plan?.claudeFastLane ? 'PLAN_FAST' : 'PLAN', candidate.symbol, { candidate, plan, vision:{ ok:vision.ok, required:vision.required, attached:vision.attached, barsRequested:vision.barsRequested, mode:vision.mode, frames:vision.frames, failures:vision.failures }, riskGate, dryRunExecutor, executionReadiness, contextVersion:unified.version, marketAsOf:symbol.generatedAt });
  if(typeof store?.recordLearning==='function'){
    try{store.recordLearning('PLAN_DECISION',candidate.symbol,{side:plan.side,setup:plan.setup,originTF:plan.originTF,ownerTF:plan.ownerTF,decision:plan.status,confidence:plan.confidence,jevDecision:plan.jevDecision||null,contextVersion:unified.version});}catch{}
  }
  return out;
}

module.exports = { FRAME_ORDER, formatSingleVisionPixelReply, buildUnifiedContext, compactUnifiedContext, compactOutcomeLearningContext, liquidationContext, buildVisionCharts, visionPixelProbePrompt, evaluateVisionPixelProbe, triggerCandidatesForPlan, resolveNumericTriggerPlan, withTriggerSpec, tradeLanes, combineRiskGate, enforceExecutionLineage, combineExecutionReadiness, resolveExecutionCandidate, resolveAttentionCandidate, buildSovereignPlanOptions, buildSovereignEvidence, runSovereignFlow, applyDecisionJudgeResult, blockingVisionVetoTFs, watchPlanNeedsSemanticResolution, reconcileVisionPlanSemantics, shouldAttemptVisionRepair, run, planFields, visionPlanContract, visionRepairLabels, visionRepairPrompt, mergeVisionRepairText, deterministicFallbackPlan };
