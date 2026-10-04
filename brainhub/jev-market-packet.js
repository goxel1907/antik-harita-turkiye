'use strict';

const {narrateChart}=require('./chart-narrator');
const {readoutDigest}=require('./chart-readout');
const {expandMarketPacket}=require('./jev-wire-market');

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
    ...(full?{priceAction:f.priceAction||null}:{}),
    // CLAUDE_R2544_PREMOVE: hareket başlamadan önceki deterministik imza (yalnız 1m/3m/5m; kanıt, karar değil).
    preMove:f.preMove&&f.preMove.available?{state:f.preMove.state,score:f.preMove.score,direction:f.preMove.direction,
      triggers:f.preMove.triggers,invalidation:f.preMove.invalidation,reasons:clipArr(f.preMove.reasons,6)}:null,
    // CLAUDE_R2544_5_FORMING_CANDLE: kapanmamış mum — yalnız bağlam (yapı/formasyon kapalı mumdan).
    forming:formingDigest(f.forming),
    // CLAUDE_R2544_11_INDICATORS: son ani hareket (gövde ≥2 ATR), fiyatın onun ortasına uzaklığı (ATR) ve 3×ATR iz. ≈120 bayt; bağlam.
    volatility:volDigest(f.volatility),
    // CLAUDE_R2544_16_CHART_READOUT: uzama/çapalı VWAP/konum, sıkışma, yer değiştirme+OTE, likidite havuzu durumu, çaba-sonuç/uyumsuzluk.
    readout:readoutDigest(f.readout)
  };
  if(full){
    const fvgSource=arr(f.recentFairValueGaps).length ? f.recentFairValueGaps : f?.liquidity?.fairValueGaps;
    base.recentFairValueGaps=clipArr(fvgSource,3);
    base.fairValueGapHistory=clipArr(f.fairValueGapHistory,2);
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
function volDigest(v){
  if(!v||typeof v!=='object')return null;
  const sp=v.spike&&typeof v.spike==='object'?{dir:v.spike.dir||null,barsAgo:finite(v.spike.barsAgo),bodyAtr:finite(v.spike.bodyAtr),pct:finite(v.spike.pct),mid:finite(v.spike.mid)}:null;
  const tr=v.trail&&typeof v.trail==='object'&&v.trail.state&&v.trail.state!=='NONE'?{state:v.trail.state,stop:finite(v.trail.stop),distAtr:finite(v.trail.distAtr),barsAgo:finite(v.trail.barsAgo)}:null;
  if(!sp&&!tr)return null;
  return {spike:sp,extAtr:finite(v.extAtr),trail:tr};
}
function keyLevels(f){
  if(!f||f.available===false)return null;
  const r=v=>v===null||v===undefined?null:finite(v);
  const close=finite(f.close),dr=f?.smcContext?.dealingRange||{},fib=f?.smcContext?.fibLevels?.retracement||{},ote=f?.smcContext?.oteReference||{};
  const dist=z=>Math.abs(((finite(z.low)||0)+(finite(z.high)||0))/2-(close||0));
  const gaps=(arr(f.recentFairValueGaps).length?arr(f.recentFairValueGaps):arr(f?.liquidity?.fairValueGaps)).filter(g=>g&&g.filled!==true&&finite(g.low)!==null&&finite(g.high)!==null).sort((a,b)=>dist(a)-dist(b));
  const obs=[...arr(f?.orderBlocks?.bullish).map(x=>({...x,side:'BULL'})),...arr(f?.orderBlocks?.bearish).map(x=>({...x,side:'BEAR'}))].filter(x=>x&&x.broken!==true&&finite(x.low)!==null&&finite(x.high)!==null).sort((a,b)=>dist(a)-dist(b));
  const brk=[...arr(f?.orderBlocks?.bullish).map(x=>({...x,side:'BULL_BREAKER_RESISTANCE'})),...arr(f?.orderBlocks?.bearish).map(x=>({...x,side:'BEAR_BREAKER_SUPPORT'}))].filter(x=>x&&x.broken===true&&x.breaker===true&&finite(x.low)!==null&&finite(x.high)!==null).sort((a,b)=>dist(a)-dist(b));
  const z=x=>x?{side:x.side||null,low:r(x.low),high:r(x.high),...(x.lifecycle?{lifecycle:{state:x.lifecycle.state,fillPct:x.lifecycle.fillPct,testCount:x.lifecycle.testCount,ce50Touched:x.lifecycle.ce50Touched}}:{}),...(x.scope?{scope:x.scope,zoneMode:x.zoneMode??null,confirmedAt:x.confirmedAt??null,state:x.state??null}:{}),...(finite(x.volRel)!==null?{volRel:finite(x.volRel)}:{})}:null;
  const out={rangeHigh:r(dr.high),rangeLow:r(dr.low),rangeZone:dr.zone||null,fib50:r(fib['0.5']),fib618:r(fib['0.618']),
    oteLong:ote.longDiscountZone?[r(ote.longDiscountZone.low),r(ote.longDiscountZone.high)]:null,
    oteShort:ote.shortPremiumZone?[r(ote.shortPremiumZone.low),r(ote.shortPremiumZone.high)]:null,
    nearestFvg:z(gaps[0]),nearestOb:z(obs[0]),
    // CLAUDE_R2544_11_BREAKER: kırılıp geri alınmamış blok yön değiştirir (boğa bloğu → direnç, ayı bloğu → destek).
    nearestBreaker:z(brk[0])};
  return Object.values(out).some(v=>v!==null)?out:null;
}

// CLAUDE_R2544_15_LEVEL_MAP: kullanıcı — "top 3/10/24, erken ilgi ve aday coinlerde geçmiş likidasyon noktaları, fibolar,
// OB'ler, FVG'ler her şey LONG ve SHORT için çok önemli". Tek, kırpılmayan bir harita: fiyatın üstündeki ve altındaki en yakın
// 7'şer seviye (15m–1d FVG/OB/breaker/fib .5-.618/OTE/aralık/önceki-20/eşit tepe-dip + 24 saatlik gözlenen likidasyon kümeleri).
function levelMap(u){
  const price=finite(u?.livePrice)??finite(u?.frames?.['5m']?.close)??finite(u?.frames?.['15m']?.close);
  if(!(price>0))return null;
  const sig=v=>{const n=finite(v);return n===null?null:Number(n.toPrecision(7));};
  const items=[];
  const add=(p,k)=>{const v=finite(p);if(v>0&&Math.abs(v-price)/price<=0.35)items.push({p:v,k});};
  const edge=z=>{const lo=finite(z?.low),hi=finite(z?.high);if(lo===null||hi===null)return null;return lo>price?lo:hi<price?hi:(lo+hi)/2;};
  for(const tf of ['5m','15m','30m','1h','4h','1d']){
    const f=u?.frames?.[tf];
    if(!f||f.available===false)continue;
    const smc=f.smcContext||{},dr=smc.dealingRange||{},fib=smc.fibLevels?.retracement||{},ote=smc.oteReference||{};
    add(dr.high,tf+':RANGE_H');add(dr.low,tf+':RANGE_L');
    add(fib['0.5'],tf+':FIB50');add(fib['0.618'],tf+':FIB618');
    if(ote.longDiscountZone)add(edge(ote.longDiscountZone),tf+':OTE_LONG');
    if(ote.shortPremiumZone)add(edge(ote.shortPremiumZone),tf+':OTE_SHORT');
    const gaps=arr(f.recentFairValueGaps).length?arr(f.recentFairValueGaps):arr(f?.liquidity?.fairValueGaps);
    for(const g of gaps)if(g&&g.filled!==true)add(edge(g),tf+':'+(String(g.side).toUpperCase()==='BULL'?'FVG_BULL':'FVG_BEAR'));
    for(const [side,list] of [['BULL',f?.orderBlocks?.bullish],['BEAR',f?.orderBlocks?.bearish]])for(const o of arr(list)){
      if(!o)continue;
      if(o.broken!==true)add(edge(o),tf+':OB_'+side+(o.scope==='INTERNAL'?'_INTERNAL':'')+(finite(o.volRel)!==null?'x'+Number(o.volRel).toFixed(1):''));
      else if(o.breaker===true)add(edge(o),tf+':BREAKER_'+(side==='BULL'?'RES':'SUP'));
    }
    add(f.prior20High,tf+':P20H');add(f.prior20Low,tf+':P20L');
    add(f?.liquidity?.equalHigh?.price,tf+':EQH');add(f?.liquidity?.equalLow?.price,tf+':EQL');
  }
  const lh=u?.microstructure?.liquidationHistory;
  for(const c of arr(lh?.clusters))add(c.price,'24h:'+(c.side==='LONG_LIQUIDATED'?'LIQ_LONGS':'LIQ_SHORTS')+'_'+Math.max(1,Math.round((finite(c.quote)||0)/1000))+'k');
  for(const z of arr(u?.liquidationContext?.zones||u?.microstructure?.observedLiquidations?.zones))add(z?.price,'15m:LIQ_'+String(z?.side||'').replace('_LIQUIDATED','S'));
  const merge=list=>{const out=[];for(const x of list){const last=out[out.length-1];
    if(last&&Math.abs(x.p-last.p)/price<0.001){if(!last.k.split('+').includes(x.k)&&last.k.length<70)last.k+='+'+x.k;}else out.push({p:x.p,k:x.k});}return out;};
  const fmt=x=>({p:sig(x.p),d:Number(((x.p-price)/price*100).toFixed(2)),k:x.k});
  const above=merge(items.filter(x=>x.p>price).sort((a,b)=>a.p-b.p)).slice(0,7).map(fmt);
  const below=merge(items.filter(x=>x.p<price).sort((a,b)=>b.p-a.p)).slice(0,7).map(fmt);
  if(!above.length&&!below.length)return null;
  return {price:sig(price),above,below,semantics:'NEAREST_LEVELS_5M_TO_1D_PLUS_24H_OBSERVED_LIQUIDATIONS_CONTEXT_ONLY'};
}
function liquidationHistoryDigest(lh){
  if(!lh||typeof lh!=='object'||lh.available!==true)return lh&&typeof lh==='object'?{available:false,count:finite(lh.count)||0,coverageH:finite(lh.coverageFromMs)!==null?Number((lh.coverageFromMs/3600000).toFixed(1)):null}:null;
  return {available:true,windowH:finite(lh.windowH),count:finite(lh.count),coverageH:finite(lh.coverageFromMs)!==null?Number((lh.coverageFromMs/3600000).toFixed(1)):null,
    longLiquidatedQuote:finite(lh.longLiquidatedQuote),shortLiquidatedQuote:finite(lh.shortLiquidatedQuote),
    clusters:arr(lh.clusters).slice(0,6).map(c=>({price:c.price,side:c.side,quote:c.quote,count:c.count,hoursAgo:c.hoursAgo,distPct:c.distPct})),
    note:'Binance all-market forceOrder sample (max one print per symbol per second); not a complete heatmap.'};
}

// Numeric overlays selected from the same frame objects used by Office; no REST/model call.
function trendLineDigest(line){
  if(!line)return null;
  const point=p=>p?{price:finite(p.price),at:p.at??null}:null;
  return {kind:line.kind??null,active:line.active===true,from:point(line.from),to:point(line.to),projected:point(line.projected),
    confirmedAt:line.confirmedAt??null,invalidatedAt:line.invalidatedAt??null,invalidatedByClose:finite(line.invalidatedByClose)};
}
function chartOverlayLevels(frames){
  const out={};
  for(const tf of ['1m','3m','5m','15m','30m','45m','1h','4h','1d']){
    const f=frames?.[tf];if(!f||f.available===false){out[tf]={available:false};continue;}
    if(f.officeOverlay){out[tf]=f.officeOverlay;continue;}
    const k=keyLevels(f);out[tf]={available:true,rangeHigh:k?.rangeHigh??null,rangeLow:k?.rangeLow??null,fib618:k?.fib618??null,nearestFvg:k?.nearestFvg??null,nearestOb:k?.nearestOb??null,
      trendLines:f.swingStructure?.trendLines?Object.fromEntries(Object.entries(f.swingStructure.trendLines).map(([k,v])=>[k,trendLineDigest(v)])):null,breakoutEvidence:f.breakoutEvidence??null};
  }
  return out;
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
    // CLAUDE_R2544_15: tek seviye haritası + 24 saatlik likidasyon kümeleri (kırpma adımları dokunmaz).
    levelMap:levelMap(u),
    chartOverlayLevels:chartOverlayLevels(u?.frames),
    liquidationHistory:liquidationHistoryDigest(u?.microstructure?.liquidationHistory),
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
      preEntryAdverseSelection:u?.marketMakerEvidence?.preEntryAdverseSelection||null,
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
      modeledLiquidation:d?.modeledLiquidation?{
        available:d.modeledLiquidation.available===true,
        authority:d.modeledLiquidation.authority||'SHADOW_EVIDENCE_ONLY',observed:false,estimated:true,
        events:finite(d.modeledLiquidation.events),baselineHours:finite(d.modeledLiquidation.baselineHours),
        density:d.modeledLiquidation.density||null,canVeto:false,executionAuthority:false
      }:null,
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
    fairValueGapHistory:clipArr(f.fairValueGapHistory,2),
    orderBlocks:{bullish:arr(f?.orderBlocks?.bullish).slice(-2),bearish:arr(f?.orderBlocks?.bearish).slice(-2)},
    smcContext:f.smcContext||null,priceAction:f.priceAction||null,
    // CLAUDE_R2544_5: denetim aynası JEV'e giden ön-hareket ve kapanmamış mum bilgisini de gösterir.
    preMove:f.preMove||null,forming:f.forming||null,keyLevels:f.keyLevels||null,volatility:f.volatility||null,readout:f.readout||null
  };
}
function mirrorDigest(packet){
  const p=packet&&typeof packet==='object'?expandMarketPacket(packet):{};
  return {
    contract:p.contract||null,symbol:p.symbol||null,livePrice:p.livePrice??null,
    levelMap:p.levelMap||null,chartOverlayLevels:p.chartOverlayLevels||null,liquidationHistory:p.liquidationHistory||null,global:p.global||null,
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

module.exports={chartOverlayLevels,levelMap,liquidationHistoryDigest,framePacket,marketPacket,mirrorDigest,rankPatterns,formingDigest,volDigest,readoutDigest,keyLevels};
