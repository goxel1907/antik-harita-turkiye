'use strict';

const { isNonConcreteWait } = require('./wait-condition');

const FRAMES=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
const STATES=new Set(['WAIT','TRIGGERED','REFRESH_REQUIRED']);

function finite(v){
  if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function clip(v,n=360){return String(v??'').replace(/\s+/g,' ').trim().slice(0,n);}
function validTf(tf){return FRAMES.includes(String(tf||'').toLowerCase());}

function parseWorkerDecision(text){
  const lines=new Map();
  for(const raw of String(text||'').split(/\r?\n/)){
    const line=raw.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/,'');
    const i=line.indexOf(':');if(i<1)continue;
    const k=line.slice(0,i).replace(/[\`*"']/g,'').trim().toUpperCase();
    const v=line.slice(i+1).trim();
    if(k&&!lines.has(k))lines.set(k,v);
  }
  const state=String(lines.get('WORKER_STATE')||'').toUpperCase();
  const confidence=Number(lines.get('CONFIDENCE'));
  const reason=clip(lines.get('REASON')||'',300);
  const rawTfs=String(lines.get('RECHECK_TFS')||'').trim();
  const recheckTFs=rawTfs.toUpperCase()==='NONE'?[]:rawTfs.split(',').map(x=>x.trim().toLowerCase()).filter(validTf);
  const ok=STATES.has(state)&&Number.isFinite(confidence)&&confidence>=0&&confidence<=100&&Boolean(reason);
  return {ok,state:ok?state:'REFRESH_REQUIRED',confidence:Number.isFinite(confidence)?confidence:null,reason:reason||'WORKER_OUTPUT_INVALID',recheckTFs:[...new Set(recheckTFs)],raw:clip(text,1200)};
}

function deterministicGuard({tracked,candidate,unified,now=Date.now(),maxPlanAgeMs=30*60*1000}={}){
  const reasons=[];
  const symbol=String(candidate?.symbol||tracked?.symbol||'').toUpperCase();
  const trackedSide=String(tracked?.side||'').toUpperCase();
  const candidateSide=String(candidate?.side||trackedSide).toUpperCase();
  const planAgeMs=Math.max(0,Number(now)-Number(tracked?.lastAnalyzedAt||0));
  if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol))reasons.push('WORKER_SYMBOL_INVALID');
  if(!['LONG','SHORT'].includes(trackedSide))reasons.push('WORKER_TRACKED_SIDE_INVALID');
  if(candidateSide&&trackedSide&&candidateSide!==trackedSide)reasons.push('WORKER_SCANNER_SIDE_CHANGED');
  if(isNonConcreteWait(tracked?.waitFor))reasons.push('WORKER_WAIT_CONDITION_MISSING');
  if(!unified?.dataQuality?.advisoryUsable)reasons.push('WORKER_CONTEXT_NOT_USABLE');
  if(planAgeMs>maxPlanAgeMs)reasons.push('WORKER_PLAN_TOO_OLD');

  const origin=String(tracked?.originTF||'').toLowerCase();
  const owner=String(tracked?.ownerTF||'').toLowerCase();
  for(const tf of [origin,owner].filter(validTf)){
    const f=unified?.frames?.[tf];
    if(!f?.available||f.fresh!==true)reasons.push('WORKER_'+tf.toUpperCase()+'_STALE');
  }
  const path=unified?.opportunityPaths?.[trackedSide];
  if(!Array.isArray(path?.continuity)||!path.continuity.length)reasons.push('WORKER_OPPORTUNITY_PATH_CHANGED');

  const spread=finite(candidate?.spreadBps??unified?.microstructure?.spreadBps);
  if(spread!==null&&spread>8){
    return {state:'WAIT',reason:'WORKER_SPREAD_ABOVE_8_BPS',recheckTFs:[origin,owner].filter(validTf),planAgeMs};
  }
  if(reasons.length){
    return {state:'REFRESH_REQUIRED',reason:reasons[0],reasons:[...new Set(reasons)],recheckTFs:[origin,owner].filter(validTf),planAgeMs};
  }
  return {state:'REVIEW',reason:null,reasons:[],recheckTFs:[origin,owner].filter(validTf),planAgeMs};
}

function compactFrame(f){
  if(!f?.available)return {available:false};
  return {
    available:true,fresh:f.fresh===true,asOf:f.asOf||null,close:f.close??null,trend:f.trend||null,
    breakOfStructure:f.breakOfStructure||null,
    opportunity:f.opportunity?{
      state:f.opportunity.state??null,preferredSide:f.opportunity.preferredSide??null,
      longScore:finite(f.opportunity.longScore),shortScore:finite(f.opportunity.shortScore),
      originEligible:f.opportunity.originEligible??null,ownerEligible:f.opportunity.ownerEligible??null
    }:null,
    breakoutExecution:f.breakoutExecution?{
      status:f.breakoutExecution.status??null,allowed:f.breakoutExecution.allowed??null
    }:null
  };
}

function compactWorkerContext({tracked,candidate,unified}={}){
  const frames={};
  const wanted=new Set([
    String(tracked?.originTF||'').toLowerCase(),
    String(tracked?.ownerTF||'').toLowerCase(),
    '1m','3m','5m','15m'
  ].filter(validTf));
  for(const tf of wanted)frames[tf]=compactFrame(unified?.frames?.[tf]);
  return {
    symbol:String(candidate?.symbol||tracked?.symbol||'').toUpperCase(),
    scanner:{
      side:String(candidate?.side||'').toUpperCase(),
      attackRank:finite(candidate?.attackRank),projectedRank:finite(candidate?.projectedRank),
      rankVelocity:finite(candidate?.rankVelocity),rankAcceleration:finite(candidate?.rankAcceleration),
      leaderState:candidate?.leaderState||null,movementPotential:finite(candidate?.movementPotential),
      expansionScore:finite(candidate?.expansionScore),tradeQuality:finite(candidate?.tradeQuality),
      directionSupport:finite(candidate?.directionSupport),spreadBps:finite(candidate?.spreadBps),
      oiDeltaPct:finite(candidate?.oiDeltaPct),volumeAcceleration:finite(candidate?.volumeAcceleration),
      rangeExpansion:finite(candidate?.rangeExpansion),takerBuyRatio:finite(candidate?.takerBuyRatio)
    },
    trackedPlan:{
      side:tracked?.side||null,status:tracked?.planStatus||null,originTF:tracked?.originTF||null,
      ownerTF:tracked?.ownerTF||null,setup:clip(tracked?.setup,120),waitFor:clip(tracked?.waitFor,260),
      why:clip(tracked?.why,320),riskNote:clip(tracked?.riskNote,240),confidence:finite(tracked?.confidence),
      lastAnalyzedAt:tracked?.lastAnalyzedAt||null
    },
    livePrice:unified?.livePrice??null,
    frames,
    opportunityPath:unified?.opportunityPaths?.[String(tracked?.side||'').toUpperCase()]||null,
    dataQuality:unified?.dataQuality||null,
    microstructure:unified?.microstructure?.available?{
      available:true,sourceQuality:unified.microstructure.sourceQuality||unified.microstructure.quality||null,
      spreadBps:finite(unified.microstructure.spreadBps),depth20Imbalance:finite(unified.microstructure.depth20Imbalance),
      cvdSampleQuote:finite(unified.microstructure.cvdSampleQuote),ofiProxyQuote:finite(unified.microstructure.ofiProxyQuote)
    }:{available:false},
    policy:{
      workerCannotQualify:true,workerCannotPlaceOrder:true,formingCandleIsContextOnly:true,
      full9TfRequiredAfterTrigger:true
    }
  };
}

function buildWorkerPrompt(args={}){
  const c=compactWorkerContext(args);
  return [
    'PLAN_WORKER_V107. Daha once 9TF Vision tarafindan uretilmis WATCH plani icin yalniz takip karari ver.',
    'Bu worker QUALIFIED veremez, emir veremez ve eski plani degistiremez.',
    'Yalniz mevcut deterministik verinin TRACKED_PLAN.waitFor kosuluna yaklasip yaklasmadigini kontrol et.',
    'TRIGGERED yalniz beklenen kosulun artik gerceklesmis olabilecegine dair somut kapali-mum/deterministik kanit varsa kullan; yine de tam 9TF yeniden dogrulama zorunludur.',
    'WAIT kosul henuz yoksa; REFRESH_REQUIRED plan eskidi, yon/yapi degisti, kritik veri eksik veya yorum guvenilir degilse.',
    'Forming mum teyit degildir. Gizli market-maker niyeti, haber veya veride olmayan seviye uydurma.',
    'Tam olarak dort satir dondur:',
    'WORKER_STATE: WAIT | TRIGGERED | REFRESH_REQUIRED',
    'CONFIDENCE: 0-100',
    'REASON: <=180 karakter somut gerekce',
    'RECHECK_TFS: virgullu 1m,3m,5m,15m,30m,45m,1h,4h,1d veya NONE',
    'WORKER_CONTEXT_JSON:',
    JSON.stringify(c)
  ].join('\n');
}

function combineWorkerReviews({deterministic,router,openRouter}={}){
  if(deterministic?.state==='WAIT')return {state:'WAIT',source:'DETERMINISTIC',reason:deterministic.reason,recheckTFs:deterministic.recheckTFs||[]};
  if(deterministic?.state==='REFRESH_REQUIRED')return {state:'REFRESH_REQUIRED',source:'DETERMINISTIC',reason:deterministic.reason,recheckTFs:deterministic.recheckTFs||[]};
  const r=router?.ok?router:null;
  const o=openRouter?.ok?openRouter:null;
  if(!r)return {state:'REFRESH_REQUIRED',source:'ROUTER_UNAVAILABLE',reason:'WORKER_9ROUTER_UNAVAILABLE',recheckTFs:[]};
  if(r.state==='WAIT')return {state:'WAIT',source:'9ROUTER',reason:r.reason,recheckTFs:r.recheckTFs||[],confidence:r.confidence};
  if(r.state==='REFRESH_REQUIRED')return {state:'REFRESH_REQUIRED',source:'9ROUTER',reason:r.reason,recheckTFs:r.recheckTFs||[],confidence:r.confidence};
  if(r.state==='TRIGGERED'){
    if(!o)return {state:'TRIGGERED',source:'9ROUTER',reason:r.reason,recheckTFs:r.recheckTFs||[],confidence:r.confidence};
    if(o.state==='TRIGGERED')return {
      state:'TRIGGERED',source:'9ROUTER+OPENROUTER_FREE',
      reason:r.reason+' | '+o.reason,recheckTFs:[...new Set([...(r.recheckTFs||[]),...(o.recheckTFs||[])])],
      confidence:Math.round(((r.confidence||0)+(o.confidence||0))/2)
    };
    return {
      state:'REFRESH_REQUIRED',source:'WORKER_DISAGREEMENT',
      reason:'9Router tetik gordu; OpenRouter free ajan farkli gorus bildirdi. Tam 9TF yeniden dogrulama gerekli.',
      recheckTFs:[...new Set([...(r.recheckTFs||[]),...(o.recheckTFs||[])])]
    };
  }
  return {state:'REFRESH_REQUIRED',source:'WORKER_INVALID',reason:'WORKER_DECISION_INVALID',recheckTFs:[]};
}

module.exports={FRAMES,parseWorkerDecision,deterministicGuard,compactWorkerContext,buildWorkerPrompt,combineWorkerReviews};
