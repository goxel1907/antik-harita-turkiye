'use strict';
// R2544.21 PRE-ENTRY MICROSTRUCTURE ADVISOR
// Read-only, deterministic evidence for JEV immediately before entry selection.
// It estimates adverse-selection / trap risk from public Binance L2 + aggTrade behavior.
// It is NOT a participant-identity detector, NOT a probability model, NOT an execution gate,
// and it never creates/vetoes/places an order by itself.

function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo=0,hi=1){const n=finite(v);return n===null?null:Math.max(lo,Math.min(hi,n));}
function r(v,d=4){const n=finite(v);return n===null?null:Number(n.toFixed(d));}
function arr(v,n=12){return Array.isArray(v)?v.slice(0,n):[];}
function sum(xs){return xs.reduce((a,b)=>a+(finite(b)||0),0);}
function windowOf(streaming,key){return streaming?.orderFlow?.windows?.[key]||null;}
function ofiWindowOf(streaming,key){return streaming?.level1Ofi?.windows?.[key]||null;}
function signedRatio(w){
  const buy=finite(w?.buyRatio),sell=finite(w?.sellRatio);
  if(buy!==null&&sell!==null)return clamp(buy-sell,-1,1);
  const dq=finite(w?.deltaQuote),bq=finite(w?.buyQuote),sq=finite(w?.sellQuote),tot=(bq||0)+(sq||0);
  return dq!==null&&tot>0?clamp(dq/tot,-1,1):null;
}
function norm(v,scale){const n=finite(v);return n===null?null:clamp(n/scale,-1,1);}
function priceResponse(w,scaleBps=8){return norm(w?.priceMoveBps,scaleBps);}
const WINDOW_MS={'5s':5000,'15s':15000,'30s':30000,'60s':60000,'120s':120000};
const OFI_FULL_TRANSITIONS={'5s':12,'15s':24,'30s':40,'60s':70,'120s':120};
const FLOW_FULL_TRADES={'5s':8,'15s':16,'30s':24,'60s':36,'120s':60};
function confidenceQuality(score){const x=finite(score)||0;return x>=0.8?'FULL':x>=0.5?'MODERATE':x>=0.2?'SPARSE':x>0?'VERY_SPARSE':'UNAVAILABLE';}
function sampleConfidence(key,w,kind){
  const ms=WINDOW_MS[key]||finite(w?.windowMs)||0;
  const observed=kind==='OFI'?finite(w?.transitions):finite(w?.trades);
  const target=kind==='OFI'?(OFI_FULL_TRANSITIONS[key]||40):(FLOW_FULL_TRADES[key]||24);
  let coverage=finite(w?.coverageMs);
  if(coverage===null&&kind==='FLOW'&&observed!==null&&observed>0)coverage=ms; // legacy/synthetic fixtures without coverage metadata
  const coverageScore=ms>0&&coverage!==null?clamp(coverage/(ms*0.9),0,1):0;
  const sampleScore=observed!==null&&target>0?clamp(observed/target,0,1):0;
  const score=clamp(coverageScore*sampleScore,0,1)||0;
  return {kind,window:key,score:r(score,3),quality:confidenceQuality(score),coverageScore:r(coverageScore,3),sampleScore:r(sampleScore,3),coverageMs:coverage,samples:observed,targetSamples:target,usable:score>=0.2};
}
function samplingConfidence(streaming){
  const keys=['5s','15s','30s','60s'];
  const ofi={},flow={};
  for(const k of keys){ofi[k]=sampleConfidence(k,ofiWindowOf(streaming,k)||{},'OFI');flow[k]=sampleConfidence(k,windowOf(streaming,k)||{},'FLOW');}
  const weighted=(pairs)=>{let n=0,d=0;for(const [c,w] of pairs){if(c?.score===null||c?.score===undefined)continue;n+=Number(c.score||0)*w;d+=w;}return d?r(n/d,3):0;};
  const shortScore=weighted([[ofi['5s'],0.35],[ofi['15s'],0.65],[flow['5s'],0.35],[flow['15s'],0.65]]);
  const overallScore=weighted([[ofi['5s'],0.15],[ofi['15s'],0.25],[ofi['30s'],0.30],[ofi['60s'],0.30],[flow['5s'],0.10],[flow['15s'],0.20],[flow['30s'],0.30],[flow['60s'],0.40]]);
  const sparseWindows=[];for(const kind of ['ofi','flow'])for(const k of keys){const c=(kind==='ofi'?ofi:flow)[k];if(c.quality==='SPARSE'||c.quality==='VERY_SPARSE'||c.quality==='UNAVAILABLE')sparseWindows.push(`${kind.toUpperCase()}_${k}_${c.quality}`);}
  return {version:'R2544.21',shortWindow:{score:shortScore,quality:confidenceQuality(shortScore)},overall:{score:overallScore,quality:confidenceQuality(overallScore),usable:overallScore>=0.25},ofi,flow,sparseWindows,note:'Per-window confidence = coverage fraction × event/sample sufficiency. Sparse windows are down-weighted, not treated as equally reliable.'};
}
function component(id,weight,value,evidence,confidence=1){
  const v=clamp(value,-1,1),c=clamp(confidence,0,1);
  if(v===null||c===null||c<=0)return null;
  const eff=weight*c;
  return {id,weight:r(eff,3),baseWeight:r(weight,3),confidence:r(c,3),value:r(v,4),evidence:String(evidence||'').slice(0,220)};
}
function sideScore(components){
  const xs=components.filter(Boolean);let support=0,risk=0,ws=0,wr=0;
  for(const x of xs){const w=Math.max(0,finite(x.weight)||0),v=finite(x.value)||0;if(v>=0){support+=w*v;ws+=w;}else{risk+=w*(-v);wr+=w;}}
  const supportIdx=ws>0?support/ws:0,riskIdx=wr>0?risk/wr:0;
  const net=supportIdx-riskIdx;
  const state=riskIdx>=0.66&&riskIdx>=supportIdx+0.15?'TRAP_RISK_HIGH':
    riskIdx>=0.45&&riskIdx>=supportIdx+0.08?'TRAP_RISK_ELEVATED':
    supportIdx>=0.62&&supportIdx>=riskIdx+0.15?'CONTINUATION_SUPPORT_STRONG':
    supportIdx>=0.45&&supportIdx>=riskIdx+0.08?'CONTINUATION_SUPPORT':'MIXED_OR_NEUTRAL';
  const top=xs.slice().sort((a,b)=>Math.abs((finite(b.value)||0)*(finite(b.weight)||0))-Math.abs((finite(a.value)||0)*(finite(a.weight)||0))).slice(0,6);
  return {supportIndex:r(supportIdx,3),trapRiskIndex:r(riskIdx,3),netEvidence:r(net,3),state,components:top};
}
function flowPersistence(streaming){
  const keys=['5s','15s','30s','60s','120s'];
  const horizonWeight={'5s':0.6,'15s':0.9,'30s':1.1,'60s':1.2,'120s':0.8};
  const vals=keys.map(k=>{const w=windowOf(streaming,k),c=sampleConfidence(k,w||{},'FLOW');return {k,v:signedRatio(w),trades:finite(w?.trades),confidence:c.score,quality:c.quality,weight:(horizonWeight[k]||1)*(c.score||0)};}).filter(x=>x.v!==null&&x.trades!==null&&x.trades>0&&x.weight>0);
  if(!vals.length)return {available:false,score:null,sign:null,consistency:null,confidence:0,quality:'UNAVAILABLE',windows:[]};
  const usable=vals.filter(x=>x.confidence>=0.1);if(!usable.length)return {available:false,score:null,sign:null,consistency:null,confidence:0,quality:'UNAVAILABLE',windows:vals};
  const denom=usable.reduce((s,x)=>s+x.weight,0);const weighted=denom?usable.reduce((s,x)=>s+x.v*x.weight,0)/denom:0;
  const dominant=Math.sign(weighted);const signWeight=usable.reduce((s,x)=>s+x.weight,0);const alignedWeight=dominant?usable.filter(x=>Math.sign(x.v)===dominant).reduce((s,x)=>s+x.weight,0):0;
  const consistency=signWeight?alignedWeight/signWeight:0;const confidence=usable.reduce((s,x)=>s+x.confidence*x.weight,0)/(denom||1);
  return {available:true,score:r(weighted*consistency,4),sign:dominant>0?'BUY':dominant<0?'SELL':'NEUTRAL',consistency:r(consistency,3),confidence:r(confidence,3),quality:confidenceQuality(confidence),windows:usable.map(x=>({window:x.k,imbalance:r(x.v,4),trades:x.trades,confidence:r(x.confidence,3),quality:x.quality}))};
}
function reliability(streaming,microstructure){
  const age=finite(streaming?.ageMs),coverage=finite(streaming?.cvdCoverageMs),trades=finite(streaming?.cvdTrades120s);
  const dyn=streaming?.depthDynamics||{},samples=finite(dyn?.samples),microBps=finite(streaming?.depthSoftContext?.micropriceBps??microstructure?.depthSoftContext?.micropriceBps);
  let score=0;const reasons=[];
  if(streaming?.available===true&&age!==null&&age<=5000)score+=0.18;else reasons.push('STREAM_NOT_FRESH_LT5S');
  if(coverage!==null&&coverage>=60000&&trades!==null&&trades>=25)score+=0.18;else if(coverage!==null&&coverage>=30000&&trades!==null&&trades>=10)score+=0.11;else reasons.push('TRADE_WINDOW_WARM_OR_SPARSE');
  if(dyn?.available===true&&samples!==null&&samples>=30)score+=0.16;else if(dyn?.available===true&&samples!==null&&samples>=12)score+=0.09;else reasons.push('DEPTH_HISTORY_WARM_OR_SPARSE');
  const ofi30=ofiWindowOf(streaming,'30s');
  if(ofi30?.available===true&&(finite(ofi30?.transitions)||0)>=20)score+=0.14;else if(ofi30?.available===true&&(finite(ofi30?.transitions)||0)>=8)score+=0.08;else reasons.push('LEVEL1_OFI_WARM_OR_UNAVAILABLE');
  const bestMicro=finite(ofiWindowOf(streaming,'5s')?.micropriceBps??microBps);
  if(bestMicro!==null)score+=0.10;else reasons.push('MICROPRICE_UNAVAILABLE');
  const windows=['15s','30s','60s'].map(k=>windowOf(streaming,k)).filter(Boolean);
  if(windows.length===3&&windows.every(w=>(finite(w?.trades)||0)>=3))score+=0.10;else reasons.push('MULTIWINDOW_FLOW_INCOMPLETE');
  const spread=finite(streaming?.spreadBps??microstructure?.spreadBps);if(spread!==null&&spread<=12)score+=0.08;else reasons.push('SPREAD_WIDE_OR_UNKNOWN');
  const times=[finite(streaming?.asOf),finite(streaming?.cvdAsOf),finite(streaming?.depthAsOf)].filter(x=>x!==null);
  if(times.length>=2&&Math.max(...times)-Math.min(...times)<=10000)score+=0.06;else reasons.push('CROSS_CHANNEL_TIMESTAMP_SKEW_OR_UNKNOWN');
  score=Math.max(0,Math.min(1,score));
  return {score:r(score,3),quality:score>=0.8?'HIGH':score>=0.58?'MEDIUM':score>=0.38?'LOW':'INSUFFICIENT',usable:score>=0.38,ageMs:age,tradeCoverageSec:coverage===null?null:r(coverage/1000,1),trades120s:trades,depthSamples:samples,l1OfiTransitions30s:finite(ofi30?.transitions),reasons};
}
function buildSide(side,{streaming={},microstructure={},derivatives={},sampling=null}={}){
  const dir=side==='LONG'?1:-1,comps=[],sc=sampling||samplingConfidence(streaming);
  for(const [key,wgt] of [['5s',0.7],['15s',1.0],['30s',1.2],['60s',1.0]]){
    const w=windowOf(streaming,key),fr=signedRatio(w),pr=priceResponse(w);
    if(fr!==null&&pr!==null){
      const sameFlow=dir*fr;const samePrice=dir*pr;
      // Aggression in our direction with no matching price progress is adverse-selection risk.
      const response=sameFlow>0.18 ? clamp((samePrice-(sameFlow*0.45)),-1,1) : clamp((samePrice*0.45+sameFlow*0.55),-1,1);
      const cf=sc?.flow?.[key]?.score||0;
      comps.push(component(`FLOW_RESPONSE_${key}`,wgt,response,`${key}: flow=${r(fr,3)} priceMove=${r(w?.priceMoveBps,2)}bps trades=${finite(w?.trades)??0} conf=${r(cf,2)}`,cf));
    }
  }
  for(const [key,wgt] of [['5s',0.75],['15s',1.05],['30s',1.25],['60s',1.0]]){
    const w=ofiWindowOf(streaming,key);if(w?.available!==true)continue;
    const ofi=finite(w.normalizedOfi),pr=priceResponse(w);if(ofi===null)continue;
    const sameOfi=dir*ofi,samePrice=pr===null?0:dir*pr;
    // Directional L1 order-book pressure without matching price progress is the
    // classic adverse-selection/absorption shape we want JEV to see BEFORE entry.
    const response=sameOfi>0.15?clamp(samePrice-(sameOfi*0.50),-1,1):clamp(sameOfi*0.65+samePrice*0.35,-1,1);
    const cf=sc?.ofi?.[key]?.score||0;
    comps.push(component(`L1_OFI_RESPONSE_${key}`,wgt,response,`${key}: normOFI=${r(ofi,3)} priceMove=${r(w.priceMoveBps,2)}bps transitions=${finite(w.transitions)??0} conf=${r(cf,2)}`,cf));
  }
  const persist=flowPersistence(streaming);if(persist.available)comps.push(component('FLOW_PERSISTENCE',1.0,dir*(persist.score||0),`multi-window ${persist.sign} consistency=${persist.consistency} conf=${persist.confidence}`,persist.confidence||0));
  const ofi30=ofiWindowOf(streaming,'30s');
  const qCur=finite(ofi30?.queueImbalanceCurrent),qDelta=finite(ofi30?.queueImbalanceDelta);
  if(qCur!==null)comps.push(component('TOP_QUEUE_IMBALANCE',0.85,dir*clamp(qCur/0.6,-1,1),`bookTicker queue imbalance=${r(qCur,3)}`));
  if(qDelta!==null)comps.push(component('TOP_QUEUE_SHIFT',0.65,dir*clamp(qDelta/0.45,-1,1),`30s queue imbalance delta=${r(qDelta,3)} conf=${r(sc?.ofi?.['30s']?.score,2)}`,sc?.ofi?.['30s']?.score||0));
  const microBps=finite(ofiWindowOf(streaming,'5s')?.micropriceBps??streaming?.depthSoftContext?.micropriceBps??microstructure?.depthSoftContext?.micropriceBps);if(microBps!==null)comps.push(component('MICROPRICE_LEAD',1.15,dir*clamp(microBps/4,-1,1),`microprice lead ${r(microBps,3)} bps`));
  const imb=finite(streaming?.depth20Imbalance??microstructure?.depth20Imbalance);if(imb!==null)comps.push(component('DEPTH_IMBALANCE',0.85,dir*clamp(imb/0.45,-1,1),`depth20 imbalance ${r(imb,3)}`));
  const pd=streaming?.depthDynamics?.pressure||{};const p15=finite(pd?.['15s']?.delta),p30=finite(pd?.['30s']?.delta);if(p15!==null||p30!==null){const x=((p15||0)*0.6+(p30||0)*0.4);comps.push(component('PARTIAL_DEPTH_PRESSURE_ACCEL',0.75,dir*clamp(x/0.35,-1,1),`partial-L2 imbalance delta 15s=${r(p15,3)} 30s=${r(p30,3)}`));}
  const dyn=streaming?.depthDynamics||{};const abs=dyn?.absorption||{};
  if(abs?.available===true){
    const val=abs.type==='SELL_AGGRESSION_ABSORBED_AT_BID'?(side==='LONG'?0.95:-0.95):abs.type==='BUY_AGGRESSION_ABSORBED_AT_ASK'?(side==='SHORT'?0.95:-0.95):0;
    comps.push(component('ABSORPTION',1.45,val,`${abs.type} confidence=${r(abs.confidence,2)}`));
  }
  const pulls=arr(dyn?.possibleLiquidityPulls,12);const bidPull=sum(pulls.filter(x=>x?.side==='BID').map(x=>x?.removedQuote)),askPull=sum(pulls.filter(x=>x?.side==='ASK').map(x=>x?.removedQuote));
  if(bidPull+askPull>0){const pullBias=(askPull-bidPull)/(askPull+bidPull);comps.push(component('LIQUIDITY_PULL_BIAS',1.0,dir*clamp(pullBias,-1,1),`askPull=${r(askPull,0)} bidPull=${r(bidPull,0)}`));}
  const reps=arr(dyn?.replenishment,12);const bidRep=sum(reps.filter(x=>x?.side==='BID').map(x=>(finite(x?.currentQuote)||0)*(finite(x?.confidence)||0.5))),askRep=sum(reps.filter(x=>x?.side==='ASK').map(x=>(finite(x?.currentQuote)||0)*(finite(x?.confidence)||0.5)));
  if(bidRep+askRep>0){const repBias=(bidRep-askRep)/(bidRep+askRep);comps.push(component('REPLENISHMENT_BIAS',1.1,dir*clamp(repBias,-1,1),`bidRep=${r(bidRep,0)} askRep=${r(askRep,0)}`));}
  const spread=finite(streaming?.spreadBps??microstructure?.spreadBps),base=finite(dyn?.spread?.baselineBps),ratio=base&&spread!==null?spread/base:null;
  if(ratio!==null&&ratio>1.35)comps.push(component('SPREAD_EXPANSION',0.55,-clamp((ratio-1.35)/1.5,0,1),`spread ${r(spread,2)}bps / baseline ${r(base,2)}bps = ${r(ratio,2)}x`));
  const oi=finite(derivatives?.openInterest?.delta5mPct??derivatives?.oiDelta5mPct),taker=finite(derivatives?.takerBuySellRatio??derivatives?.taker?.buySellRatio);
  if(oi!==null&&taker!==null){const crowded=(side==='LONG'&&taker>1.25&&oi>0)||(side==='SHORT'&&taker<0.8&&oi>0);if(crowded)comps.push(component('CROWDING_WITH_OI',0.45,-clamp(Math.abs(Math.log(Math.max(0.01,taker)))/0.8,0,1),`OIΔ5m=${r(oi,3)}% takerRatio=${r(taker,3)}`));}
  return sideScore(comps);
}
function toxicityProxy(streaming,sampling=null){
  const sc=sampling||samplingConfidence(streaming),vals=[];
  for(const k of ['5s','15s','30s','60s']){
    const tw=windowOf(streaming,k),tr=signedRatio(tw),tc=sc?.flow?.[k]?.score||0;if(tr!==null&&tc>0)vals.push({v:Math.abs(tr),w:tc});
    const ow=ofiWindowOf(streaming,k),ov=finite(ow?.normalizedOfi),oc=sc?.ofi?.[k]?.score||0;if(ow?.available===true&&ov!==null&&oc>0)vals.push({v:Math.abs(ov),w:oc});
  }
  const den=vals.reduce((a,x)=>a+x.w,0);if(!den)return null;return r(vals.reduce((a,x)=>a+x.v*x.w,0)/den,3);
}
function guidanceForSide(score,rel,sampling){if(!rel?.usable||sampling?.overall?.usable===false)return 'DATA_INSUFFICIENT';if(['TRAP_RISK_HIGH','TRAP_RISK_ELEVATED'].includes(score?.state))return 'WAIT_FLOW_NORMALIZATION';if(['CONTINUATION_SUPPORT_STRONG','CONTINUATION_SUPPORT'].includes(score?.state))return 'FLOW_SUPPORTS_ENTRY';return 'FLOW_MIXED';}
function compactOfiWindow(w,conf){return w?.available===true?{available:true,transitions:finite(w.transitions),coverageMs:finite(w.coverageMs),normalizedOfi:r(w.normalizedOfi,4),priceMoveBps:r(w.priceMoveBps,3),queueImbalanceCurrent:r(w.queueImbalanceCurrent,4),queueImbalanceDelta:r(w.queueImbalanceDelta,4),micropriceBps:r(w.micropriceBps,4),confidence:conf?.score??null,confidenceQuality:conf?.quality||null}:{available:false,transitions:finite(w?.transitions),confidence:conf?.score??0,confidenceQuality:conf?.quality||'UNAVAILABLE',reason:w?.reason||'UNAVAILABLE'};}
function buildPreEntryAdverseSelection({streaming={},derivatives={},microstructure={}}={}){
  const rel=reliability(streaming,microstructure),sampling=samplingConfidence(streaming);const long=buildSide('LONG',{streaming,microstructure,derivatives,sampling});const short=buildSide('SHORT',{streaming,microstructure,derivatives,sampling});
  const tox=toxicityProxy(streaming,sampling);const winner=long.netEvidence>short.netEvidence?'LONG':short.netEvidence>long.netEvidence?'SHORT':'NEUTRAL';
  const asym=Math.abs((finite(long.netEvidence)||0)-(finite(short.netEvidence)||0));const signalUsable=rel.usable&&sampling.overall.usable;
  const actionHint=!signalUsable?'DATA_INSUFFICIENT':
    long.state==='TRAP_RISK_HIGH'?'LONG_WAIT_FLOW_NORMALIZATION':
    short.state==='TRAP_RISK_HIGH'?'SHORT_WAIT_FLOW_NORMALIZATION':
    winner==='LONG'&&long.netEvidence>=0.25?'FLOW_SUPPORTS_LONG':winner==='SHORT'&&short.netEvidence>=0.25?'FLOW_SUPPORTS_SHORT':'FLOW_MIXED';
  return {
    version:'R2544.21',authority:'EVIDENCE_ONLY_JEV_FINAL',source:'Binance public depth20/bookTicker/aggTrade + derivatives; deterministic BrainHub features',
    participantIdentity:'NOT_IDENTIFIED',participantIntent:'NOT_ASSERTED',notProbability:true,canQualify:false,canVeto:false,canSize:false,canExecute:false,executionAuthority:false,
    reliability:rel,samplingConfidence:sampling,signalUsable,toxicityProxy:tox,toxicityProxyMethod:'CONFIDENCE_WEIGHTED_MEAN_ABS_TRADE_IMBALANCE_PLUS_L1_OFI_NOT_TRUE_VPIN',flowPersistence:flowPersistence(streaming),
    level1Ofi:{'5s':compactOfiWindow(ofiWindowOf(streaming,'5s'),sampling.ofi['5s']),'15s':compactOfiWindow(ofiWindowOf(streaming,'15s'),sampling.ofi['15s']),'30s':compactOfiWindow(ofiWindowOf(streaming,'30s'),sampling.ofi['30s']),'60s':compactOfiWindow(ofiWindowOf(streaming,'60s'),sampling.ofi['60s'])},
    long,short,entryTimingGuidance:{LONG:guidanceForSide(long,rel,sampling),SHORT:guidanceForSide(short,rel,sampling)},preferredEvidenceSide:winner,asymmetryIndex:r(asym,3),actionHint,
    semantics:'ADVERSE_SELECTION_RISK_INDEX_NOT_RETURN_PROBABILITY',
    note:'High trap-risk means public flow/depth behavior is adverse to immediate entry. Sparse windows are confidence-downweighted. JEV remains final; this layer never infers hidden actors or future certainty.'
  };
}
module.exports={buildPreEntryAdverseSelection,reliability,flowPersistence,signedRatio,guidanceForSide,sampleConfidence,samplingConfidence,confidenceQuality};
