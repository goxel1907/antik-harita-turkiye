'use strict';

const {narrateChart}=require('./chart-narrator');

function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function arr(v){return Array.isArray(v)?v:[];}
function clipArr(v,n){return arr(v).slice(-Math.max(0,n));}

function cvdUsable(stream){
  if(!stream||stream.cvdComplete===true)return true;
  const cov=finite(stream.cvdCoverageMs);
  return cov===null?true:cov>=60000; // eski runtime alanı yoksa önceki davranış
}
function formingDigest(x){
  if(!x||typeof x!=='object')return null;
  return {elapsedPct:finite(x.elapsedPct),direction:x.direction||null,changePct:finite(x.changePct),changeAtr:finite(x.changeAtr),
    rangeAtr:finite(x.rangeAtr),vsLastClosePct:finite(x.vsLastClosePct),last:finite(x.last),notClosed:true};
}
function rankPatterns(list,n){
  // CLAUDE_R2544_5_PATTERN_RANK: kırpmada son-N yerine önem sırası; iki yön de varsa karşı kanıt korunur.
  const STRUCT=new Set(['DISPLACEMENT','SELL_SIDE_SWEEP_RECLAIM','BUY_SIDE_SWEEP_REJECT','RESISTANCE_FLIP_ACCEPTANCE','SUPPORT_FLIP_ACCEPTANCE','BREAKOUT_CLOSE','BREAKDOWN_CLOSE',
    'ASCENDING_TRIANGLE','DESCENDING_TRIANGLE','SYMMETRICAL_TRIANGLE','RISING_WEDGE','FALLING_WEDGE','BULL_FLAG_OR_PENNANT','BEAR_FLAG_OR_PENNANT',
    'DOUBLE_TOP','DOUBLE_BOTTOM','HEAD_AND_SHOULDERS','INVERSE_HEAD_AND_SHOULDERS','RISING_CHANNEL','FALLING_CHANNEL']);
  const xs=arr(list).map((p,i)=>({p,i,score:(String(p?.status).toUpperCase()==='CONFIRMED'?4:0)+(STRUCT.has(String(p?.type))?2:0)+(['LONG','SHORT'].includes(String(p?.side))?1:0)+i*0.001}));
  xs.sort((a,b)=>b.score-a.score);
  const pick=[];
  for(const side of ['LONG','SHORT']){const top=xs.find(x=>String(x.p?.side)===side);if(top&&pick.length<n)pick.push(top);}
  for(const x of xs){if(pick.length>=n)break;if(!pick.includes(x))pick.push(x);}
  return pick.sort((a,b)=>a.i-b.i).map(x=>x.p);
}
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
      triggers:f.preMove.triggers,invalidation:f.preMove.invalidation,reasons:clipArr(f.preMove.reasons,6)}:null,
    // CLAUDE_R2544_5_FORMING_CANDLE: kapanmamış mum — yalnız bağlam (yapı/formasyon kapalı mumdan).
    forming:formingDigest(f.forming)
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
    // CLAUDE_R2544_9_HTF_KEY_LEVELS: üst zaman diliminin ANA seviyeleri tek küçük nesnede (≈200 bayt). 29.09 HYPE: paket 92 kB'dan
    // budanırken üst bağlamın sayısal Fib/OTE/FVG/OB'u tamamen düşmüştü; JEV yalnız anlatı satırını görüyordu. Bu nesne
    // "özet" budamasında da korunur.
    base.keyLevels=keyLevels(f);
  }
  return base;
}
function keyLevels(f){
  if(!f||f.available===false)return null;
  const r=v=>{const n=finite(v);return n===null?null:Number(n.toPrecision(7));};
  const close=finite(f.close),dr=f?.smcContext?.dealingRange||{},fib=f?.smcContext?.fibLevels?.retracement||{},ote=f?.smcContext?.oteReference||{};
  const dist=z=>Math.abs(((finite(z.low)||0)+(finite(z.high)||0))/2-(close||0));
  const gaps=(arr(f.recentFairValueGaps).length?arr(f.recentFairValueGaps):arr(f?.liquidity?.fairValueGaps)).filter(g=>g&&g.filled!==true&&finite(g.low)!==null&&finite(g.high)!==null).sort((a,b)=>dist(a)-dist(b));
  const obs=[...arr(f?.orderBlocks?.bullish).map(x=>({...x,side:'BULL'})),...arr(f?.orderBlocks?.bearish).map(x=>({...x,side:'BEAR'}))].filter(x=>x&&x.broken!==true&&finite(x.low)!==null&&finite(x.high)!==null).sort((a,b)=>dist(a)-dist(b));
  const z=x=>x?{side:x.side||null,low:r(x.low),high:r(x.high)}:null;
  const out={rangeHigh:r(dr.high),rangeLow:r(dr.low),rangeZone:dr.zone||null,fib50:r(fib['0.5']),fib618:r(fib['0.618']),
    oteLong:ote.longDiscountZone?[r(ote.longDiscountZone.low),r(ote.longDiscountZone.high)]:null,
    oteShort:ote.shortPremiumZone?[r(ote.shortPremiumZone.low),r(ote.shortPremiumZone.high)]:null,
    nearestFvg:z(gaps[0]),nearestOb:z(obs[0])};
  return Object.values(out).some(v=>v!==null)?out:null;
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
      // CLAUDE_R2544_6_CVD_COVERAGE: pencerenin gerçekte kaç saniyeyi kapsadığı açıkça yazılır; <60 sn kapsama "120 sn CVD" diye gönderilmez.
      cvdQuote120s:cvdUsable(stream)&&(finite(stream?.cvdTrades120s??flow?.sampleTrades)||0)>0?finite(stream?.cvdQuote120s??flow?.cvdQuote120s??flow?.cvd120s):null,
      cvdTrades120s:cvdUsable(stream)&&(finite(stream?.cvdTrades120s??flow?.sampleTrades)||0)>0?finite(stream?.cvdTrades120s??flow?.sampleTrades):null,
      cvdCoverageSec:finite(stream?.cvdCoverageMs)===null?null:Math.round(finite(stream.cvdCoverageMs)/1000),
      cvdComplete:stream?.cvdComplete===true,cvdSource:stream?.cvdSource||null,
      orderFlowReason:!cvdUsable(stream)?'CVD_WINDOW_INCOMPLETE_'+Math.round((finite(stream?.cvdCoverageMs)||0)/1000)+'S':(flow?.available===true?null:(flow?.reason||null)),
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
      oiValueDelta5mPct:finite(d?.openInterest?.valueDelta5mPct),oiDeltaBasis:d?.openInterest?.deltaBasis||null,
      takerBuySellRatio:finite(d?.takerBuySellRatio??d?.taker?.buySellRatio),
      topTraderLongShortRatio:finite(d?.topTraderLongShortRatio??d?.topTraderPosition?.longShortRatio),
      globalLongShortRatio:finite(d?.globalLongShortRatio??d?.globalAccount?.longShortRatio),
      // CLAUDE_R2544_6: 5 dk kova oranları Binance'te gecikmeli yayınlanır (29.09: PENDLE 0,789 = 12 dk önceki kova;
      // güncel kapalı kova 1,277). Kovanın yaşı açıkça verilir.
      bucketAgeMin:(()=>{const ts=finite(d?.taker?.timestamp),at=finite(d?.asOf);return ts!==null&&at!==null?Math.round((at-(ts+300000))/6000)/10:null;})()
    },
    observedLiquidations:{
      available:liq?.available===true,source:liq?.source||null,
      count:finite(liq?.count),
      observedForSec:finite(liq?.coverageMs??u?.microstructure?.observedLiquidations?.coverageMs)===null?null:Math.round(finite(liq?.coverageMs??u?.microstructure?.observedLiquidations?.coverageMs)/1000),
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
    smcContext:f.smcContext||null,
    // CLAUDE_R2544_5: denetim aynası JEV'e giden ön-hareket ve kapanmamış mum bilgisini de gösterir.
    preMove:f.preMove||null,forming:f.forming||null
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

module.exports={framePacket,marketPacket,mirrorDigest,rankPatterns,formingDigest};
