'use strict';
const {profitGiveback}=require('./outcome-metrics');
// R2544.21 CASE MEMORY + SPARSE-FLOW CONFIDENCE
// Deterministic, read-only trade case memory. It never places orders, changes risk, or mutates strategy rules.
// The purpose is to freeze entry-time evidence, attach the realized path/outcome later, and retrieve comparable
// winners AND losers as soft context for JEV. No participant identity/intent is inferred.
const crypto=require('node:crypto');

const TFS=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clip(v,n=240){return typeof v==='string'?v.slice(0,n):v;}
function r4(v){const n=finite(v);return n===null?null:Number(n.toFixed(4));}
function clone(v){try{return JSON.parse(JSON.stringify(v));}catch{return null;}}
function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(v&&typeof v==='object')return Object.keys(v).sort().reduce((o,k)=>{o[k]=stable(v[k]);return o;},{});
  return v;
}
function hashObject(v){return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');}
function array(v,n=8){return Array.isArray(v)?v.slice(0,n):[];}

function readoutSummary(f){
  const ro=f?.readout||{}, st=ro?.stretch||{}, sq=ro?.squeeze||{}, dp=ro?.displacement||{}, ef=ro?.effort||{};
  return {
    stretch:{state:st.state||null,zone:st.zone||null,rangePositionPct:r4(st.rangePositionPct??st.windowPositionPct),ema20DistanceAtr:r4(st.ema20DistanceAtr),avwap:r4(st.anchoredVwap??st.avwap),priceVsAvwapAtr:r4(st.priceVsAvwapAtr),zScore:r4(st.zScore)},
    chaseRisk:{LONG:st?.chaseRisk?.LONG||null,SHORT:st?.chaseRisk?.SHORT||null},
    squeeze:{state:sq.state||null,bars:finite(sq.bars??sq.candles),releasedBarsAgo:finite(sq.releasedBarsAgo),momentum:sq.momentum||null},
    displacement:{dir:dp.dir||dp.direction||null,barsAgo:finite(dp.barsAgo),bodyAtr:r4(dp.bodyAtr),retracePct:r4(dp.retracePct),insideOte:dp.insideOte===true},
    effort:{state:ef.state||null,divergence:ef.divergence||null,waveVolumeRatio:r4(ef.waveVolumeRatio)}
  };
}
function patternSummary(p){
  if(!p)return null;
  if(typeof p==='string')return {type:p,status:null,side:null};
  return {type:p.type||p.id||p.name||null,status:p.status||null,side:p.side||null,neckline:finite(p.neckline),level:finite(p.level)};
}
function frameSnapshot(f){
  if(!f||typeof f!=='object')return {available:false};
  const smc=f.smcContext||{}, liq=f.liquidity||{}, sw=f.swingStructure||{};
  const gapSnapshot=x=>({side:x?.side||x?.direction||null,low:finite(x?.low??x?.bottom),high:finite(x?.high??x?.top),ce50:finite(x?.ce50??x?.mid),at:x?.at??null,status:x?.status||null,lifecycle:clone(x?.lifecycle||null)});
  const fvgs=array(f.recentFairValueGaps||liq.fairValueGaps,3).map(gapSnapshot);
  const ob=f.orderBlocks||smc.orderBlocks;
  const obs=(Array.isArray(ob)?ob:[...array(ob?.bullish,2),...array(ob?.bearish,2)]).slice(0,4).map(x=>({side:x?.side||x?.direction||null,low:finite(x?.low),high:finite(x?.high),scope:x?.scope||null,zoneMode:x?.zoneMode||null,impulse:x?.impulse||null,at:x?.at??null,confirmedAt:x?.confirmedAt??x?.displacementAt??null,state:x?.state||x?.status||null,mitigated:x?.mitigated??null,broken:x?.broken??null,breaker:x?.breaker??null}));
  return {
    available:f.available!==false,fresh:f.fresh===true,asOf:f.asOf||null,ageMs:finite(f.ageMs),source:f.source||null,synthetic:f.synthetic===true,
    close:finite(f.close),trend:f.trend||null,breakOfStructure:f.breakOfStructure||null,
    structure:{state:sw.state||sw.structure||null,lastEvent:sw.lastEvent||sw.event||null,hh:sw.hh??null,hl:sw.hl??null,lh:sw.lh??null,ll:sw.ll??null},
    rsi14:r4(f.rsi14),atrPct:r4(f.atrPct),ema20:finite(f.ema20),ema50:finite(f.ema50),
    prior20:{high:finite(f.prior20High),low:finite(f.prior20Low),equalHigh:finite(liq.equalHigh?.price??liq.equalHigh??f.equalHigh),equalLow:finite(liq.equalLow?.price??liq.equalLow??f.equalLow),sweep:clone(liq.sweep||liq.lastSweep||null)},
    candle:clone(f.candle||f.closedCandle||null),forming:clone(f.forming||null),
    patterns:array(f.patterns,4).map(patternSummary).filter(Boolean),
    fvg:fvgs,fvgHistory:array(f.fairValueGapHistory,2).map(gapSnapshot),orderBlocks:obs,priceAction:clone(f.priceAction||null),
    ote:{long:clone(smc?.oteReference?.longDiscountZone||f?.oteReference?.longDiscountZone||smc?.oteReference?.long||smc?.oteLong||f?.oteLong||null),short:clone(smc?.oteReference?.shortPremiumZone||f?.oteReference?.shortPremiumZone||smc?.oteReference?.short||smc?.oteShort||f?.oteShort||null)},
    fib:clone(smc?.fibLevels||f?.fibLevels||null),keyLevels:clone(f.keyLevels||null),
    readout:readoutSummary(f)
  };
}
function timestampMs(v){const n=Date.parse(v||'');return Number.isFinite(n)?n:null;}
function dataQuality(unified,{now=Date.now()}={}){
  const base=unified?.dataQuality&&typeof unified.dataQuality==='object'?clone(unified.dataQuality):{};
  const missing=[],stale=[],synthetic=[],times=[],gapFlags=[];
  for(const tf of TFS){
    const f=unified?.frames?.[tf];
    if(!f||f.available===false){missing.push(tf);continue;}
    if(f.synthetic===true)synthetic.push(tf);
    const t=timestampMs(f.asOf); if(t!==null)times.push(t);
    if(f.fresh===false)stale.push(tf);
    const gaps=finite(f.klineGapCount??f.gapCount??f.missingBars);
    if(gaps!==null&&gaps>0)gapFlags.push(`${tf}:${gaps}`);
  }
  const skewMs=times.length>1?Math.max(...times)-Math.min(...times):0;
  const flags=[];
  if(missing.length)flags.push('MISSING_TF:'+missing.join(','));
  if(stale.length)flags.push('STALE_TF:'+stale.join(','));
  if(gapFlags.length)flags.push('KLINE_GAPS:'+gapFlags.join(','));
  if(skewMs>20*60*1000)flags.push('TF_TIMESTAMP_SKEW_GT_20M');
  const streamAge=finite(unified?.microstructure?.streaming?.ageMs);
  if(streamAge!==null&&streamAge>15000)flags.push('MICROSTRUCTURE_STALE_GT_15S');
  if(unified?.microstructure?.available===false)flags.push('MICROSTRUCTURE_UNAVAILABLE');
  if(unified?.derivatives?.available===false)flags.push('DERIVATIVES_UNAVAILABLE');
  if(base?.advisoryUsable===false)flags.push('BASE_CONTEXT_NOT_ADVISORY_USABLE');
  const coreBad=['5m','15m'].some(tf=>missing.includes(tf)||stale.includes(tf));
  if(coreBad)flags.push('CORE_5M15M_DATA_QUALITY_DEGRADED');
  const advisoryUsable=base?.advisoryUsable!==false&&!coreBad;
  return {advisoryUsable,flags,missingFrames:missing,staleFrames:stale,syntheticFrames:synthetic,klineGapFlags:gapFlags,timestampSkewMs:skewMs,generatedAt:unified?.generatedAt||new Date(now).toISOString(),sourceDataQuality:base};
}
function flowSnapshot(unified){
  const mm=unified?.marketMakerEvidence||{}, ms=unified?.microstructure||{}, st=ms?.streaming||{}, of=mm?.orderFlow||st?.orderFlow||{};
  const d=unified?.derivatives||{}, l=unified?.liquidationContext||{};
  const book=mm?.bookBehavior||{};
  return {
    orderFlow:{available:of?.available===true||ms?.available===true,source:of?.source||ms?.sourceQuality||null,asOf:of?.asOf||st?.asOf||null,cvd120s:r4(of?.cvdQuote120s??of?.cvd120s??st?.cvdQuote120s??ms?.cvdSampleQuote),ofiProxyQuote:r4(ms?.ofiProxyQuote??st?.ofiProxyQuote),depthImbalance:r4(of?.depth20Imbalance??ms?.depth20Imbalance??st?.depth20Imbalance),spreadBps:r4(of?.spreadBps??ms?.spreadBps??st?.spreadBps),microprice:r4(ms?.depthSoftContext?.microprice??st?.depthSoftContext?.microprice??ms?.microprice??st?.microprice),ageMs:finite(of?.ageMs??st?.ageMs),localL2:st?.localL2?{available:st.localL2.available===true,state:st.localL2.state||null,confidence:r4(st.localL2.confidence),multiLevelOfi:r4(st.localL2.multiLevelOfi),depthImbalance:r4(st.localL2.depthImbalance),resyncCount5m:finite(st.localL2.resyncCount5m),canVeto:false}:null},
    bookBehavior:{available:book?.available===true,semantics:book?.semantics||null,possibleLiquidityPulls:array(book?.possibleLiquidityPulls,6).map(x=>({side:x?.side||null,price:r4(x?.price),removedQuote:r4(x?.removedQuote),remainingQuote:r4(x?.remainingQuote),nearbyTradedQuote:r4(x?.nearbyTradedQuote)})),replenishment:array(book?.replenishment,6).map(x=>({side:x?.side||null,price:r4(x?.price),currentQuote:r4(x?.currentQuote),persistence:r4(x?.persistence),confidence:r4(x?.confidence)})),absorption:book?.absorption&&typeof book.absorption==='object'?{available:book.absorption.available===true,type:book.absorption.type||null,side:book.absorption.side||null,confidence:r4(book.absorption.confidence),wallPrice:r4(book.absorption.wallPrice),wallQuote:r4(book.absorption.wallQuote)}:{available:false}},
    derivatives:{available:d?.available!==false,oiDelta5mPct:r4(d?.openInterest?.delta5mPct??d?.oiDelta5mPct),fundingRate:r4(d?.fundingRate??d?.funding?.lastFundingRate),takerBuySellRatio:r4(d?.takerBuySellRatio??d?.taker?.buySellRatio),topTraderLongShortRatio:r4(d?.topTraderLongShortRatio??d?.topTrader?.longShortRatio),globalLongShortRatio:r4(d?.globalLongShortRatio??d?.global?.longShortRatio),modeledLiquidation:d?.modeledLiquidation?{available:d.modeledLiquidation.available===true,authority:d.modeledLiquidation.authority||'SHADOW_EVIDENCE_ONLY',events:finite(d.modeledLiquidation.events),density:clone(d.modeledLiquidation.density||null),observed:false,estimated:true}:null},
    liquidations:{available:l?.available===true,count:finite(l?.count),buyQuote:r4(l?.buyQuote??l?.longLiquidatedQuote),sellQuote:r4(l?.sellQuote??l?.shortLiquidatedQuote),velocity:r4(l?.velocity),cascade:l?.cascade===true||l?.chainReaction===true,clusters:array(l?.clusters||l?.observedClusters,6).map(x=>({side:x?.side||x?.type||null,price:r4(x?.price),quote:r4(x?.quote??x?.notional),count:finite(x?.count)}))},
    preEntryAdverseSelection:clone(mm?.preEntryAdverseSelection||null)
  };
}
function eventPush(out,type,evidence,confidence='OBSERVED'){if(!out.some(x=>x.type===type))out.push({type,confidence,evidence:clip(evidence,220)});}
function microstructureEvents(unified,{side=null}={}){
  const out=[]; const f1=unified?.frames?.['1m']||{},f3=unified?.frames?.['3m']||{},f5=unified?.frames?.['5m']||{},f15=unified?.frames?.['15m']||{};
  const flow=flowSnapshot(unified), cvd=finite(flow.orderFlow.cvd120s), imb=finite(flow.orderFlow.depthImbalance), taker=finite(flow.derivatives.takerBuySellRatio);
  const book=flow.bookBehavior||{};
  const formingDir=String(f1?.forming?.direction||f3?.forming?.direction||f5?.forming?.direction||'').toUpperCase();
  const p5=array(f5?.patterns,8).map(x=>String(x?.type||x?.id||x||'').toUpperCase());
  const p3=array(f3?.patterns,8).map(x=>String(x?.type||x?.id||x||'').toUpperCase());
  const sweep=[f1,f3,f5,f15].map(x=>x?.liquidity?.sweep||x?.liquidity?.lastSweep).filter(Boolean).map(x=>JSON.stringify(x).toUpperCase()).join(' ');
  if(/BUY.*SWEEP|BUY_SIDE/.test(sweep)&&(/REJECT|RECLAIM/.test(sweep)||formingDir==='BEAR'))eventPush(out,'BUY_SIDE_SWEEP_REJECT','Observed buy-side sweep/rejection language or bearish response after the sweep.');
  if(/SELL.*SWEEP|SELL_SIDE/.test(sweep)&&(/RECLAIM|REJECT/.test(sweep)||formingDir==='BULL'))eventPush(out,'SELL_SIDE_SWEEP_RECLAIM','Observed sell-side sweep/reclaim language or bullish response after the sweep.');
  if([...p3,...p5].some(x=>/BREAKOUT_CLOSE|RESISTANCE_FLIP_ACCEPTANCE|SUPPORT_FLIP_ACCEPTANCE/.test(x)))eventPush(out,'BREAKOUT_ACCEPTED','Closed-candle pattern engine marked breakout/flip acceptance.');
  if([...p3,...p5].some(x=>/FAILED_BREAKOUT/.test(x)))eventPush(out,'FAILED_BREAKOUT','Closed-candle pattern engine marked a failed breakout.');
  if(book?.absorption?.available===true&&book.absorption.type==='BUY_AGGRESSION_ABSORBED_AT_ASK')eventPush(out,'BUY_AGGRESSION_ABSORBED',`Public L2/aggTrade absorption heuristic at ASK ${book.absorption.wallPrice??''}.`,'OBSERVED_HEURISTIC');
  else if((taker!==null&&taker>=1.18||cvd!==null&&cvd>0)&&(formingDir==='BEAR'||String(f5?.trend||'').toUpperCase()==='DOWN'))eventPush(out,'BUY_AGGRESSION_ABSORBED','Positive/aggressive buy flow did not translate into upward price response.','INFERRED_FROM_OBSERVED_FLOW');
  if(book?.absorption?.available===true&&book.absorption.type==='SELL_AGGRESSION_ABSORBED_AT_BID')eventPush(out,'SELL_AGGRESSION_ABSORBED',`Public L2/aggTrade absorption heuristic at BID ${book.absorption.wallPrice??''}.`,'OBSERVED_HEURISTIC');
  else if((taker!==null&&taker<=0.85||cvd!==null&&cvd<0)&&(formingDir==='BULL'||String(f5?.trend||'').toUpperCase()==='UP'))eventPush(out,'SELL_AGGRESSION_ABSORBED','Negative/aggressive sell flow did not translate into downward price response.','INFERRED_FROM_OBSERVED_FLOW');
  if(cvd!==null&&formingDir&&(cvd>0&&formingDir==='BEAR'||cvd<0&&formingDir==='BULL'))eventPush(out,'DELTA_PRICE_DIVERGENCE','CVD sign is opposite to the current forming price direction.','INFERRED_FROM_OBSERVED_FLOW');
  if(flow.liquidations.cascade===true&&((side==='LONG'&&flow.liquidations.sellQuote>flow.liquidations.buyQuote)||(side==='SHORT'&&flow.liquidations.buyQuote>flow.liquidations.sellQuote)))eventPush(out,'LIQUIDATION_CASCADE_CONTINUATION','Observed liquidation cascade is aligned with the trade direction.');
  if(flow.liquidations.cascade===true&&((side==='LONG'&&flow.liquidations.buyQuote>flow.liquidations.sellQuote)||(side==='SHORT'&&flow.liquidations.sellQuote>flow.liquidations.buyQuote)))eventPush(out,'LIQUIDATION_FLUSH_REVERSAL','Observed liquidation cascade is opposite the trade direction; reversal risk context only.');
  const ex=[f1,f3,f5].map(x=>String(x?.readout?.effort?.state||'').toUpperCase()).join(' ');
  if(/EXHAUST/.test(ex))eventPush(out,'AGGRESSOR_EXHAUSTION','Deterministic effort/result readout reports exhaustion on a timing frame.');
  if(array(book?.replenishment,6).length)eventPush(out,'RESTING_LIQUIDITY_HELD','Public partial-L2 heuristic observed persistent/replenishing resting liquidity.','OBSERVED_HEURISTIC');
  else if(imb!==null&&Math.abs(imb)>=0.35&&cvd!==null&&Math.sign(imb)!==Math.sign(cvd))eventPush(out,'RESTING_LIQUIDITY_HELD','Depth imbalance and aggressive-flow delta oppose each other, consistent with resting liquidity absorbing flow.','INFERRED_FROM_OBSERVED_FLOW');
  if(array(book?.possibleLiquidityPulls,6).length)eventPush(out,'RESTING_LIQUIDITY_PULLED','Public partial-L2 heuristic observed large displayed liquidity removed with limited nearby traded volume.','OBSERVED_HEURISTIC');
  const sd=String(side||'').toUpperCase();
  if(['LONG','SHORT'].includes(sd)){
    for(const [tf,f] of [['1m',f1],['3m',f3],['5m',f5],['15m',f15]]){
      const st=String(f?.readout?.stretch?.state||'').toUpperCase(), ch=String(f?.readout?.stretch?.chaseRisk?.[sd]||'').toUpperCase();
      if(['EXTENDED','EXTREME'].includes(st)&&['HIGH','EXTREME'].includes(ch)){eventPush(out,'CHASE_AFTER_EXPANSION',`${tf} ${sd} chase risk ${ch} while stretch=${st}.`);break;}
    }
  }
  return out.slice(0,12);
}
function attentionSnapshot(candidate){
  if(!candidate||typeof candidate!=='object')return null;
  return {rank:finite(candidate.gainerRank??candidate.gainerRank24),change24hPct:r4(candidate.priceChange24hPct??candidate.change24hPct),rankVelocity:r4(candidate.gainerRankVelocity),shortWindowPct:r4(candidate.shortWindowPct??candidate.shortChangePct),deepScanReason:candidate.deepScanReason||null,attentionSource:candidate.attentionSource||null,targetSources:array(candidate.targetSources,8),ladderTier:candidate.ladderTier||null};
}
function buildCurrentCase({unified,candidate,side=null,now=Date.now()}={}){
  const frames={};for(const tf of TFS)frames[tf]=frameSnapshot(unified?.frames?.[tf]);
  const flow=flowSnapshot(unified||{}); const dq=dataQuality(unified||{},{now});
  return {version:'R2544.21',capturedAt:new Date(now).toISOString(),symbol:unified?.symbol||candidate?.symbol||null,side:side||null,livePrice:finite(unified?.livePrice),frames,flow,dataQuality:dq,attention:attentionSnapshot(candidate),microstructureEvents:microstructureEvents(unified||{},{side})};
}
function buildEntryCase({unified,candidate,plan,jevDecision,sizing,entryPrice,stopPrice,takeProfit1,now=Date.now()}={}){
  const side=String(plan?.side||jevDecision?.side||'').toUpperCase()||null;
  const c=buildCurrentCase({unified,candidate,side,now});
  c.decision={side,setupFamily:plan?.setupFamily||jevDecision?.setupFamily||null,entryTiming:plan?.entryTiming||jevDecision?.entryTiming||null,edgeBasis:plan?.edgeBasis||jevDecision?.edgeBasis||null,preEntryFlowAssessment:jevDecision?.preEntryFlowAssessment||plan?.preEntryFlowAssessment||null,lane:(plan?.tradeLane&&typeof plan.tradeLane==='object'?plan.tradeLane.name:plan?.tradeLane)||plan?.lane||null,originTF:plan?.originTF||null,ownerTF:plan?.ownerTF||null,why:clip(plan?.why||jevDecision?.reasoning||'',500),jevSummary:clip(jevDecision?.summaryTr||'',240)};
  c.risk={entryPrice:finite(entryPrice??plan?.entryPrice??unified?.livePrice),stopPrice:finite(stopPrice??plan?.stopPrice),takeProfit1:finite(takeProfit1??plan?.takeProfit1),riskPctOfEquity:r4(sizing?.riskPctOfEquity),stopDistancePct:(finite(entryPrice??plan?.entryPrice)&&finite(stopPrice??plan?.stopPrice))?r4(Math.abs((finite(entryPrice??plan?.entryPrice)-finite(stopPrice??plan?.stopPrice))/finite(entryPrice??plan?.entryPrice)*100)):null};
  const gapCount=array(c?.dataQuality?.klineGapFlags,32).reduce((sum,x)=>{const m=String(x||'').match(/:(\d+)$/);return sum+(m?Number(m[1]):0);},0);
  c.auditProvenance={version:'R2544.26',marketSnapshotHash:hashObject({frames:c.frames,flow:c.flow}),entryEvidenceHash:hashObject({decision:c.decision,risk:c.risk,microstructureEvents:c.microstructureEvents}),dataGapCount:gapCount,timestampSkewMs:c?.dataQuality?.timestampSkewMs??null,semantics:'AUDIT_ONLY_NOT_PROMPT_AUTHORITY'};
  c.snapshotHash=hashObject({...c,snapshotHash:undefined});
  c.immutable=true;c.executionAuthority=false;c.selfModify=false;
  return c;
}
function buildOutcomePath({row,runner,closedAt,netPnl,rMultiple,exitType,income=null}={}){
  const events=array(runner?.events,40).map(e=>({at:e?.at||null,kind:e?.kind||null,to:e?.to??null,from:e?.from??null,basis:e?.basis||null,fraction:r4(e?.fraction),executedQty:r4(e?.executedQty),remainingQty:r4(e?.remainingQty),progressR:r4(e?.metrics?.progressR??e?.progressR),reason:e?.reason||null}));
  const opened=timestampMs(row?.activeAt?new Date(Number(row.activeAt)).toISOString():row?.openedAt);
  // Excursions are measured by the runner, not the leader lifecycle row.
  const mfeAt=finite(runner?.guardMfeAt??row?.guardMfeAt),maeAt=finite(runner?.guardMaeAt??row?.guardMaeAt);
  const mfe=r4(runner?.guardMfeR??row?.guardMfeR), rr=r4(rMultiple);
  const captureEfficiency=mfe!==null&&mfe>0&&rr!==null&&rr>0?r4(Math.max(0,Math.min(2,rr/mfe))):null;
  const mfeGivebackR=r4(profitGiveback(mfe,rr));
  return {version:'R2544.35',netPnl:r4(netPnl),rMultiple:rr,exitType:exitType||null,mfeR:mfe,maeR:r4(runner?.guardMaeR??row?.guardMaeR),excursionSource:runner?.guardMfeR!=null?'RUNNER_OBSERVED_MARKS':row?.guardMfeR!=null?'LIFECYCLE_OBSERVED_MARKS':null,captureEfficiency,mfeGivebackR,timeToMfeMin:opened!==null&&mfeAt!==null?r4((mfeAt-opened)/60000):null,timeToMaeMin:opened!==null&&maeAt!==null?r4((maeAt-opened)/60000):null,partialAndProtectionEvents:events,closedAt:closedAt?new Date(Number(closedAt)).toISOString():null,commission:r4(income?.commission),funding:r4(income?.funding),realizedPnl:r4(income?.realized),slippage:null,executionAuthority:false};
}
function sideOf(t){return String(t?.side||t?.entryContext?.entryCase?.side||'').toUpperCase();}
function caseOf(t){return t?.entryContext?.entryCase||null;}
function legacyVector(t){
  const s=t?.entryContext?.marketSignature||{};
  return {side:sideOf(t),family:t?.entryContext?.setupFamily||null,lane:t?.tradeLane||t?.entryContext?.lane||null,trend5:s?.regime5m?.trend||null,trend15:s?.regime15m?.trend||null,stretch5:s?.regime5m?.readout?.stretchState||null,stretch15:s?.regime15m?.readout?.stretchState||null,chase5:sideOf(t)==='LONG'?s?.regime5m?.readout?.chaseLong:s?.regime5m?.readout?.chaseShort,cvd:r4(s?.orderFlow?.cvd120s),imb:r4(s?.depth?.imbalance),oi:r4(s?.derivatives?.oiDeltaPct),funding:r4(s?.derivatives?.fundingRate),taker:r4(s?.derivatives?.takerBuySellRatio)};
}
function vector(c,t=null){
  if(!c)return legacyVector(t||{});
  const sd=String(c.side||c?.decision?.side||sideOf(t)||'').toUpperCase();
  return {side:sd,family:c?.decision?.setupFamily||t?.entryContext?.setupFamily||null,lane:c?.decision?.lane||t?.tradeLane||null,
    trend1:c?.frames?.['1m']?.trend||null,trend3:c?.frames?.['3m']?.trend||null,trend5:c?.frames?.['5m']?.trend||null,trend15:c?.frames?.['15m']?.trend||null,trend1h:c?.frames?.['1h']?.trend||null,
    structure5:c?.frames?.['5m']?.structure?.state||null,structure15:c?.frames?.['15m']?.structure?.state||null,
    stretch3:c?.frames?.['3m']?.readout?.stretch?.state||null,stretch5:c?.frames?.['5m']?.readout?.stretch?.state||null,stretch15:c?.frames?.['15m']?.readout?.stretch?.state||null,
    chase5:c?.frames?.['5m']?.readout?.chaseRisk?.[sd]||null,chase15:c?.frames?.['15m']?.readout?.chaseRisk?.[sd]||null,
    range5:r4(c?.frames?.['5m']?.readout?.stretch?.rangePositionPct),range15:r4(c?.frames?.['15m']?.readout?.stretch?.rangePositionPct),rsi5:r4(c?.frames?.['5m']?.rsi14),rsi15:r4(c?.frames?.['15m']?.rsi14),atr5:r4(c?.frames?.['5m']?.atrPct),atr15:r4(c?.frames?.['15m']?.atrPct),
    cvd:r4(c?.flow?.orderFlow?.cvd120s),imb:r4(c?.flow?.orderFlow?.depthImbalance),spread:r4(c?.flow?.orderFlow?.spreadBps),oi:r4(c?.flow?.derivatives?.oiDelta5mPct),funding:r4(c?.flow?.derivatives?.fundingRate),taker:r4(c?.flow?.derivatives?.takerBuySellRatio),rank:r4(c?.attention?.rank),change24:r4(c?.attention?.change24hPct),events:array(c?.microstructureEvents,12).map(x=>x.type),
    trapRisk:r4(c?.flow?.preEntryAdverseSelection?.[sd==='SHORT'?'short':'long']?.trapRiskIndex),continuation:r4(c?.flow?.preEntryAdverseSelection?.[sd==='SHORT'?'short':'long']?.supportIndex),microReliability:r4(c?.flow?.preEntryAdverseSelection?.reliability?.score),toxicity:r4(c?.flow?.preEntryAdverseSelection?.toxicityProxy)};
}
const CAT=['side','family','lane','trend1','trend3','trend5','trend15','trend1h','structure5','structure15','stretch3','stretch5','stretch15','chase5','chase15'];
const NUM={range5:100,range15:100,rsi5:50,rsi15:50,atr5:5,atr15:8,cvd:5000,imb:1,spread:20,oi:1,funding:0.001,taker:2,rank:24,change24:50,trapRisk:1,continuation:1,microReliability:1,toxicity:1};
function similarity(a,b,legacyTrade=null){
  const x=vector(a),y=vector(b,legacyTrade);let score=0,weight=0;
  for(const k of CAT){if(x[k]==null||y[k]==null)continue;const w=['side','family','lane'].includes(k)?2:1;weight+=w;if(String(x[k])===String(y[k]))score+=w;}
  for(const [k,scale] of Object.entries(NUM)){const p=finite(x[k]),q=finite(y[k]);if(p===null||q===null)continue;weight+=1;score+=Math.max(0,1-Math.abs(p-q)/scale);}
  const ax=new Set(x.events||[]),by=new Set(y.events||[]);if(ax.size||by.size){const inter=[...ax].filter(z=>by.has(z)).length,uni=new Set([...ax,...by]).size;weight+=2;score+=2*(uni?inter/uni:0);}
  return weight?score/weight:0;
}
function priceActionMemory(c){return Object.fromEntries(['5m','15m'].map(tf=>{const f=c?.frames?.[tf];return [tf,f?.priceAction?.available?{version:f.priceAction.version,asOf:f.asOf,orderBlocks:array(f.orderBlocks,4),fvg:array(f.fvg,3),events:array(f.priceAction.events,4)}:null];}));}
function summarizeTrade(t,sim){const ec=t?.entryContext?.entryCase,exact=!!ec;const ev=ec?.flow?.preEntryAdverseSelection,sd=sideOf(t);return {eventId:t?.eventId||null,symbol:t?.symbol||null,side:sd,family:t?.entryContext?.setupFamily||null,lane:t?.tradeLane||t?.entryContext?.lane||null,openedAt:t?.openedAt||null,closedAt:t?.closedAt||null,netPnl:r4(t?.netPnl),rMultiple:r4(t?.rMultiple),exitType:t?.exitType||null,similarity:r4(sim),fidelity:exact?(ec?.version==='R2544.21'?'IMMUTABLE_R2544_21':ec?.version==='R2544.20'?'IMMUTABLE_R2544_20':'IMMUTABLE_R2544_19'):'LEGACY_PARTIAL_SIGNATURE',entryHash:ec?.snapshotHash||null,priceActionAtEntry:priceActionMemory(ec),microstructureEvents:array(ec?.microstructureEvents,5).map(x=>x.type),preEntry:ev?{quality:ev?.reliability?.quality||null,actionHint:ev?.actionHint||null,trapRisk:r4(ev?.[sd==='SHORT'?'short':'long']?.trapRiskIndex),support:r4(ev?.[sd==='SHORT'?'short':'long']?.supportIndex)}:null,outcome:t?.outcomePath?{mfeR:r4(t.outcomePath.mfeR),maeR:r4(t.outcomePath.maeR),timeToMfeMin:r4(t.outcomePath.timeToMfeMin),timeToMaeMin:r4(t.outcomePath.timeToMaeMin),mfeGivebackR:r4(profitGiveback(t.outcomePath.mfeR,t.rMultiple)),captureEfficiency:r4(t.outcomePath.captureEfficiency)}:null,exitAuthority:t?.lessonCard?.exitAuthority||null,lesson:t?.lessonCard?.lesson||null};}
function analogDigest(trades,{currentCase,limit=5,minSimilarity=0.28}={}){
  if(!currentCase)return {version:'R2544.21',available:false,reason:'CURRENT_CASE_UNAVAILABLE',analogs:[],winners:[],losers:[],executionAuthority:false};
  const scored=(Array.isArray(trades)?trades:[]).filter(t=>finite(t?.netPnl)!==null&&(caseOf(t)||t?.entryContext?.marketSignature)).map(t=>{const exact=caseOf(t);const raw=similarity(currentCase,exact,exact?null:t);return {t,sim:exact?raw:raw*0.82};}).filter(x=>x.sim>=minSimilarity).sort((a,b)=>b.sim-a.sim).slice(0,Math.max(2,Math.min(10,Number(limit)||5)));
  const analogs=scored.map(x=>summarizeTrade(x.t,x.sim));
  const winners=analogs.filter(x=>x.netPnl>0).slice(0,3),losers=analogs.filter(x=>x.netPnl<0).slice(0,3);
  const meanR=analogs.map(x=>x.rMultiple).filter(Number.isFinite); const net=analogs.reduce((a,x)=>a+(x.netPnl||0),0);
  return {version:'R2544.21',available:analogs.length>0,samples:analogs.length,analogs,winners,losers,fidelity:{immutable:analogs.filter(x=>String(x.fidelity||'').startsWith('IMMUTABLE_')).length,immutableR254421:analogs.filter(x=>x.fidelity==='IMMUTABLE_R2544_21').length,immutableR254420:analogs.filter(x=>x.fidelity==='IMMUTABLE_R2544_20').length,legacyPartial:analogs.filter(x=>x.fidelity==='LEGACY_PARTIAL_SIGNATURE').length,note:'Legacy signatures are partial and similarity-discounted; they never replace an immutable entry snapshot. R2544.21 preserves pre-entry adverse-selection state and adds per-window sampling confidence when available.'},counterexamples:{winnerCount:winners.length,loserCount:losers.length,note:'Winners and losers are both shown. A single outcome never becomes a rule.'},summary:{netPnl:r4(net),avgR:meanR.length?r4(meanR.reduce((a,b)=>a+b,0)/meanR.length):null},softContextOnly:true,selfModify:false,autoPromotionToRules:false,executionAuthority:false};
}

function compactPreEntry(pe){
  if(!pe||typeof pe!=='object')return null;
  const side=x=>x&&typeof x==='object'?{supportIndex:x.supportIndex??null,trapRiskIndex:x.trapRiskIndex??null,netEvidence:x.netEvidence??null,state:x.state||null,components:array(x.components,4).map(c=>({id:c?.id||null,value:c?.value??null,weight:c?.weight??null,baseWeight:c?.baseWeight??null,confidence:c?.confidence??null}))}:null;
  const ofi30=pe?.level1Ofi?.['30s'];
  return {version:pe.version,authority:pe.authority,reliability:pe.reliability?{score:pe.reliability.score,quality:pe.reliability.quality,usable:pe.reliability.usable,tradeCoverageSec:pe.reliability.tradeCoverageSec,trades120s:pe.reliability.trades120s,depthSamples:pe.reliability.depthSamples,l1OfiTransitions30s:pe.reliability.l1OfiTransitions30s,reasons:array(pe.reliability.reasons,6)}:null,samplingConfidence:pe.samplingConfidence?{shortWindow:pe.samplingConfidence.shortWindow,overall:pe.samplingConfidence.overall,sparseWindows:array(pe.samplingConfidence.sparseWindows,8)}:null,toxicityProxy:pe.toxicityProxy,flowPersistence:pe.flowPersistence?{score:pe.flowPersistence.score,sign:pe.flowPersistence.sign,consistency:pe.flowPersistence.consistency,confidence:pe.flowPersistence.confidence,quality:pe.flowPersistence.quality}:null,level1Ofi30s:ofi30?{available:ofi30.available===true,transitions:ofi30.transitions??null,normalizedOfi:ofi30.normalizedOfi??null,priceMoveBps:ofi30.priceMoveBps??null,queueImbalanceCurrent:ofi30.queueImbalanceCurrent??null,queueImbalanceDelta:ofi30.queueImbalanceDelta??null,micropriceBps:ofi30.micropriceBps??null}:null,long:side(pe.long),short:side(pe.short),entryTimingGuidance:pe.entryTimingGuidance||null,preferredEvidenceSide:pe.preferredEvidenceSide||null,asymmetryIndex:pe.asymmetryIndex??null,actionHint:pe.actionHint||null,notProbability:true,executionAuthority:false};
}
function compactCaseFlow(flow){
  if(!flow||typeof flow!=='object')return null;
  return {orderFlow:flow.orderFlow||null,derivatives:flow.derivatives||null,liquidations:flow.liquidations||null,bookBehavior:flow.bookBehavior?{available:flow.bookBehavior.available,semantics:flow.bookBehavior.semantics,absorption:flow.bookBehavior.absorption,possibleLiquidityPulls:array(flow.bookBehavior.possibleLiquidityPulls,3),replenishment:array(flow.bookBehavior.replenishment,3)}:null,preEntryAdverseSelection:compactPreEntry(flow.preEntryAdverseSelection)};
}

function compactEntryCase(c){
  if(!c||typeof c!=='object')return null;
  const pick=tf=>{const f=c?.frames?.[tf]||{};return {fresh:f.fresh??null,asOf:f.asOf||null,trend:f.trend||null,structure:f?.structure?.state||null,rsi14:f.rsi14??null,atrPct:f.atrPct??null,stretch:f?.readout?.stretch?.state||null,zone:f?.readout?.stretch?.zone||null,chaseRisk:f?.readout?.chaseRisk||null,orderBlocks:array(f.orderBlocks,4),fvg:array(f.fvg,3),fvgHistory:array(f.fvgHistory,2),priceAction:f.priceAction||null,patterns:array(f.patterns,3).map(x=>x?.type||x).filter(Boolean)};};
  return {version:c.version,capturedAt:c.capturedAt,symbol:c.symbol,side:c.side,snapshotHash:c.snapshotHash,immutable:c.immutable===true,decision:c.decision||null,risk:c.risk||null,dataQuality:{advisoryUsable:c?.dataQuality?.advisoryUsable!==false,flags:array(c?.dataQuality?.flags,12),timestampSkewMs:c?.dataQuality?.timestampSkewMs??null},frames:{'1m':pick('1m'),'3m':pick('3m'),'5m':pick('5m'),'15m':pick('15m'),'1h':pick('1h'),'4h':pick('4h')},flow:compactCaseFlow(c.flow),microstructureEvents:array(c.microstructureEvents,8),attention:c.attention||null,executionAuthority:false};
}

function compactAnalogDigest(d,maxChars=4200){
  if(!d||typeof d!=='object')return null;
  const out={version:d.version,available:d.available,samples:d.samples,summary:d.summary,fidelity:d.fidelity,counterexamples:d.counterexamples,analogs:array(d.analogs,5).map(x=>({symbol:x.symbol,side:x.side,family:x.family,lane:x.lane,netPnl:x.netPnl,rMultiple:x.rMultiple,exitType:x.exitType,exitAuthority:x.exitAuthority||null,priceActionAtEntry:x.priceActionAtEntry||null,similarity:x.similarity,fidelity:x.fidelity,microstructureEvents:array(x.microstructureEvents,4),preEntry:x.preEntry||null,outcome:x.outcome||null})),softContextOnly:true,executionAuthority:false};
  let raw=JSON.stringify(out);if(raw.length>maxChars)out.analogs=out.analogs.slice(0,3);return out;
}
module.exports={TFS,hashObject,frameSnapshot,dataQuality,flowSnapshot,microstructureEvents,buildCurrentCase,buildEntryCase,buildOutcomePath,compactEntryCase,compactPreEntry,analogDigest,compactAnalogDigest,similarity};
