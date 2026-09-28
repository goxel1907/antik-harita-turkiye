'use strict';

const {narrateChart}=require('./chart-narrator');

function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function arr(v){return Array.isArray(v)?v:[];}
function clipArr(v,n){return arr(v).slice(-Math.max(0,n));}

function framePacket(f,{full=false}={}){
  if(!f?.available)return {available:false,source:f?.source||null,synthetic:f?.synthetic===true,asOf:f?.asOf??null,ageMs:finite(f?.ageMs),reason:f?.reason||'UNAVAILABLE'};
  const base={
    available:true,fresh:f.fresh===true,asOf:f.asOf||null,source:f.source||null,synthetic:f.synthetic===true,ageMs:finite(f.ageMs),closedCandle:f.closedCandle||null,
    close:finite(f.close),ema20:finite(f.ema20),ema50:finite(f.ema50),
    rsi14:finite(f.rsi14),atr14:finite(f.atr14),atrPct:finite(f.atrPct),returnPct:finite(f.returnPct),
    trend:f.trend||null,breakOfStructure:f.breakOfStructure||null,
    prior20High:finite(f.prior20High),prior20Low:finite(f.prior20Low),
    candle:f.candle||null,patterns:clipArr(f.patterns,6),
    // Canonical numeric levels survive request compaction; prose is not a numeric substitute.
    fibLevels:f.smcContext?.fibLevels||null,oteReference:f.smcContext?.oteReference||null,
    orderBlocks:{bullish:clipArr(f?.orderBlocks?.bullish,2),bearish:clipArr(f?.orderBlocks?.bearish,2)},
    swingStructure:f.swingStructure||null,liquidity:f.liquidity||null,
    // CLAUDE_R2544_PREMOVE: hareket başlamadan önceki deterministik imza (yalnız 1m/3m/5m; kanıt, karar değil).
    preMove:f.preMove&&f.preMove.available?{state:f.preMove.state,score:f.preMove.score,direction:f.preMove.direction,
      triggers:f.preMove.triggers,invalidation:f.preMove.invalidation,reasons:clipArr(f.preMove.reasons,6)}:null
  };
  if(full){
    const fvgSource=arr(f.recentFairValueGaps).length ? f.recentFairValueGaps : f?.liquidity?.fairValueGaps;
    base.recentFairValueGaps=clipArr(fvgSource,3);
    base.orderBlocks={
      bullish:clipArr(f?.orderBlocks?.bullish,2),
      bearish:clipArr(f?.orderBlocks?.bearish,2)
    };
    base.smcContext=f.smcContext||null; // includes dealing range, full Fib, OTE and FVG CE50
    base.opportunity=f.opportunity||null;
    base.breakoutExecution=f.breakoutExecution||null;
  }else{
    base.smcContext=f?.smcContext?{
      available:f.smcContext.available===true,
      swingEvent:f.smcContext.swingEvent||null,swingState:f.smcContext.swingState||null,
      dealingRange:f.smcContext.dealingRange||null
    }:null;
  }
  return base;
}

function marketPacket(u){
  const m=u?.microstructure||{};
  const stream=m?.streaming||{};
  const flow=u?.marketMakerEvidence?.orderFlow||stream?.orderFlow||{};
  const d=u?.derivatives||{};
  const liq=u?.liquidationContext||{};
  return {
    contract:'R2537_JEV_CONTEXT_COMPLETE_READ_ONLY',
    symbol:u?.symbol||null,livePrice:finite(u?.livePrice),
    // CLAUDE_R2543: grafigin ne anlattigi HER TURDA, deterministik olarak pakete girer.
    chartNarrative:narrateChart(u),
    coreFrames:{
      '5m':framePacket(u?.frames?.['5m'],{full:true}),
      '15m':framePacket(u?.frames?.['15m'],{full:true})
    },
    timingFrames:{
      '1m':framePacket(u?.frames?.['1m']),
      '3m':framePacket(u?.frames?.['3m'])
    },
    higherContext:Object.fromEntries(['30m','45m','1h','4h','1d'].map(tf=>[tf,framePacket(u?.frames?.[tf])])),
    microstructure:{
      available:m?.available===true||stream?.available===true,
      sourceQuality:m?.sourceQuality||u?.dataQuality?.microstructureQuality||null,
      bid:finite(m?.bid),ask:finite(m?.ask),
      spreadBps:finite(m?.spreadBps),
      depth20Imbalance:finite(m?.depth20Imbalance??stream?.depth20Imbalance),
      microprice:finite(m?.depthSoftContext?.microprice??stream?.depthSoftContext?.microprice),
      micropriceBps:finite(m?.depthSoftContext?.micropriceBps??stream?.depthSoftContext?.micropriceBps),
      // CLAUDE_R2543_CVD_NO_NULLING: gerçek sayısal CVD, availability bayrağına bağlı olarak SİLİNMEZ.
      // (Bayrak metadata'dır; veri varsa gönderilir, yoksa null — uydurma yok.)
      // Ölçüm YOKSA (örnek işlem sayısı 0) sayı gönderilmez: boş pencere "ölçülmüş 0 CVD" gibi görünemez.
      // Ölçüm VARSA, availability bayrağı false olsa bile (ör. bayat) değer gönderilir ve nedeni metadata'da belirtilir.
      cvdQuote120s:(finite(stream?.cvdTrades120s??flow?.sampleTrades)||0)>0?finite(stream?.cvdQuote120s??flow?.cvdQuote120s??flow?.cvd120s):null,
      cvdTrades120s:(finite(stream?.cvdTrades120s??flow?.sampleTrades)||0)>0?finite(stream?.cvdTrades120s??flow?.sampleTrades):null,
      orderFlowReason:flow?.available===true?null:(flow?.reason||null),
      orderFlowAsOf:flow?.asOf||null,orderFlowAgeMs:finite(flow?.ageMs),
      restTradeSample:{quote:finite(m?.cvdSampleQuote),trades:finite(m?.cvdSampleTrades),window:m?.cvdWindow||null,semantics:'SAMPLE_ONLY_NOT_CONTINUOUS_CVD'},
      orderFlowAvailable:flow?.available===true,
      orderFlowSource:flow?.source||null,
      bookBehavior:u?.marketMakerEvidence?.bookBehavior||null,
      participantIdentity:u?.marketMakerEvidence?.participantIdentity||'NOT_IDENTIFIED',
      participantIntent:u?.marketMakerEvidence?.participantIntent||'NOT_ASSERTED'
    },
    derivatives:{
      available:d?.available===true,
      asOf:d?.asOf||null,source:d?.source||null,
      fundingRate:finite(d?.fundingRate??d?.funding?.lastFundingRate),
      openInterest:d?.openInterest||null,
      oiDelta5mPct:finite(d?.openInterest?.delta5mPct??d?.oiDelta5mPct),
      takerBuySellRatio:finite(d?.takerBuySellRatio??d?.taker?.buySellRatio),
      topTraderLongShortRatio:finite(d?.topTraderLongShortRatio??d?.topTraderPosition?.longShortRatio),
      globalLongShortRatio:finite(d?.globalLongShortRatio??d?.globalAccount?.longShortRatio)
    },
    observedLiquidations:{
      available:liq?.available===true,source:liq?.source||null,
      count:finite(liq?.count),
      longLiquidatedQuote:finite(liq?.longLiquidatedQuote),
      shortLiquidatedQuote:finite(liq?.shortLiquidatedQuote),
      zones:arr(liq?.zones).slice(0,6),
      velocity:liq?.velocity||null,
      cascade:liq?.cascade||null,
      note:'Observed exchange force-order/liquidation evidence only; no synthetic heatmap.'
    },
    dataQuality:u?.dataQuality||null,
    global:u?.global?{
      btc:u.global.btc||null,marketBreadth:u.global.marketBreadth||null,riskState:u.global.riskState||null
    }:null
  };
}


function mirrorFrameDigest(f){
  if(!f||f.available===false)return f||{available:false};
  return {
    available:true,fresh:f.fresh===true,asOf:f.asOf||null,source:f.source||null,synthetic:f.synthetic===true,ageMs:finite(f.ageMs),closedCandle:f.closedCandle||null,close:f.close??null,
    // CLAUDE_R2543: EMA'lar pakette hep vardi ama aynada gorunmuyordu; ne gonderildigi denetlenebilsin.
    ema20:f.ema20??null,ema50:f.ema50??null,
    fibLevels:f.fibLevels||null,oteReference:f.oteReference||null,
    trend:f.trend||null,breakOfStructure:f.breakOfStructure||null,rsi14:f.rsi14??null,atrPct:f.atrPct??null,
    prior20High:f.prior20High??null,prior20Low:f.prior20Low??null,candle:f.candle||null,
    patterns:arr(f.patterns).slice(-6),swingStructure:f.swingStructure||null,liquidity:f.liquidity||null,
    recentFairValueGaps:clipArr(arr(f.recentFairValueGaps).length ? f.recentFairValueGaps : f?.liquidity?.fairValueGaps,3),
    orderBlocks:{bullish:arr(f?.orderBlocks?.bullish).slice(-2),bearish:arr(f?.orderBlocks?.bearish).slice(-2)},
    smcContext:f.smcContext||null
  };
}
function mirrorDigest(packet){
  const p=packet&&typeof packet==='object'?packet:{};
  return {
    contract:p.contract||null,symbol:p.symbol||null,livePrice:p.livePrice??null,
    coreFrames:{
      '5m':mirrorFrameDigest(p?.coreFrames?.['5m']),
      '15m':mirrorFrameDigest(p?.coreFrames?.['15m'])
    },
    timingFrames:{
      '1m':mirrorFrameDigest(p?.timingFrames?.['1m']),
      '3m':mirrorFrameDigest(p?.timingFrames?.['3m'])
    },
    higherContext:Object.fromEntries(['30m','45m','1h','4h','1d'].map(tf=>[tf,mirrorFrameDigest(p?.higherContext?.[tf])])),
    // CLAUDE_R2543: JEV'e giden grafik okumasi aynaya da girer; aksi halde ne gonderildigi denetlenemez.
    chartNarrative:p.chartNarrative||null,
    microstructure:p.microstructure||null,derivatives:p.derivatives||null,
    observedLiquidations:p.observedLiquidations||null,dataQuality:p.dataQuality||null
  };
}

module.exports={framePacket,marketPacket,mirrorDigest};
