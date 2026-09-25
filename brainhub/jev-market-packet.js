'use strict';

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function arr(v){return Array.isArray(v)?v:[];}
function clipArr(v,n){return arr(v).slice(-Math.max(0,n));}

function framePacket(f,{full=false}={}){
  if(!f?.available)return {available:false,reason:f?.reason||'UNAVAILABLE'};
  const base={
    available:true,fresh:f.fresh===true,asOf:f.asOf||null,
    close:finite(f.close),ema20:finite(f.ema20),ema50:finite(f.ema50),
    rsi14:finite(f.rsi14),atr14:finite(f.atr14),atrPct:finite(f.atrPct),returnPct:finite(f.returnPct),
    trend:f.trend||null,breakOfStructure:f.breakOfStructure||null,
    prior20High:finite(f.prior20High),prior20Low:finite(f.prior20Low),
    candle:f.candle||null,patterns:clipArr(f.patterns,6),
    swingStructure:f.swingStructure||null,liquidity:f.liquidity||null
  };
  if(full){
    base.recentFairValueGaps=clipArr(f.recentFairValueGaps,3);
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
    coreFrames:{
      '5m':framePacket(u?.frames?.['5m'],{full:true}),
      '15m':framePacket(u?.frames?.['15m'],{full:true})
    },
    timingFrames:{
      '1m':framePacket(u?.frames?.['1m']),
      '3m':framePacket(u?.frames?.['3m'])
    },
    higherContext:Object.fromEntries(['30m','1h','4h','1d'].map(tf=>[tf,framePacket(u?.frames?.[tf])])),
    microstructure:{
      available:m?.available===true||stream?.available===true,
      sourceQuality:m?.sourceQuality||u?.dataQuality?.microstructureQuality||null,
      spreadBps:finite(m?.spreadBps),
      depth20Imbalance:finite(m?.depth20Imbalance??stream?.depth20Imbalance),
      microprice:finite(m?.depthSoftContext?.microprice??stream?.depthSoftContext?.microprice),
      micropriceBps:finite(m?.depthSoftContext?.micropriceBps??stream?.depthSoftContext?.micropriceBps),
      cvdQuote120s:finite(stream?.cvdQuote120s??flow?.cvdQuote120s??flow?.cvd120s),
      cvdTrades120s:finite(stream?.cvdTrades120s),
      orderFlowAvailable:flow?.available===true,
      orderFlowSource:flow?.source||null,
      bookBehavior:u?.marketMakerEvidence?.bookBehavior||null,
      participantIdentity:u?.marketMakerEvidence?.participantIdentity||'NOT_IDENTIFIED',
      participantIntent:u?.marketMakerEvidence?.participantIntent||'NOT_ASSERTED'
    },
    derivatives:{
      available:d?.available!==false,
      fundingRate:finite(d?.fundingRate),
      openInterest:d?.openInterest||null,
      oiDelta5mPct:finite(d?.openInterest?.delta5mPct??d?.oiDelta5mPct),
      takerBuySellRatio:finite(d?.takerBuySellRatio),
      topTraderLongShortRatio:finite(d?.topTraderLongShortRatio),
      globalLongShortRatio:finite(d?.globalLongShortRatio)
    },
    observedLiquidations:{
      available:liq?.available===true,source:liq?.source||null,
      count:finite(liq?.count),longNotional:finite(liq?.longNotional),shortNotional:finite(liq?.shortNotional),
      imbalance:finite(liq?.imbalance),clusters:arr(liq?.clusters).slice(0,6),
      note:'Observed exchange force-order/liquidation evidence only; no synthetic heatmap.'
    },
    dataQuality:u?.dataQuality||null,
    global:u?.global?{
      btc:u.global.btc||null,marketBreadth:u.global.marketBreadth||null,riskState:u.global.riskState||null
    }:null
  };
}

module.exports={framePacket,marketPacket};
