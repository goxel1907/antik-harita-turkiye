'use strict';

// R2536: deterministic schema repair for local Vision.
// This module NEVER chooses trade direction/status. It only fills missing
// trigger/invalidation identifiers from already-computed closed-candle candidates.

const FRAME_ORDER=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];

function normSide(v){
  const s=String(v||'').trim().toUpperCase();
  return ['LONG','SHORT'].includes(s)?s:null;
}
function normTf(v){
  const tf=String(v||'').trim().toLowerCase();
  return FRAME_ORDER.includes(tf)?tf:null;
}
function arr(v){return Array.isArray(v)?v:[];}
function useTag(side,use){return side+'_'+use;}
function candidateOk(x,side,use,tf){
  const declaredSide=normSide(x?.side);
  return x&&(!declaredSide||declaredSide===side)&&normTf(x.tf)===tf&&arr(x.uses).map(v=>String(v).toUpperCase()).includes(useTag(side,use))&&/^[A-Z0-9_]{3,64}$/.test(String(x.id||'').toUpperCase());
}
function pref(side,use,id){
  const z=String(id||'').toUpperCase();
  const wanted=use==='TRIGGER'
    ? (side==='LONG'?['PRIOR20_HIGH','SWING_HIGH','OTE_LONG_HIGH','FVG_CE50_BULL']:['PRIOR20_LOW','SWING_LOW','OTE_SHORT_LOW','FVG_CE50_BEAR'])
    : (side==='LONG'?['PRIOR20_LOW','SWING_LOW','OTE_LONG_LOW','FVG_CE50_BULL']:['PRIOR20_HIGH','SWING_HIGH','OTE_SHORT_HIGH','FVG_CE50_BEAR']);
  const i=wanted.indexOf(z);
  return i<0?999:i;
}
function best(xs,side,use,tf){
  return xs.filter(x=>candidateOk(x,side,use,tf))
    .map((x,index)=>({x,index,p:pref(side,use,x.id)}))
    .sort((a,b)=>a.p-b.p||a.index-b.index)[0]?.x||null;
}
function deterministicCoreLevelRepair(coreContract,context={}){
  const base=coreContract&&typeof coreContract==='object'?coreContract:{lines:new Map(),missing:[]};
  const lines=new Map(base.lines instanceof Map?base.lines:[]);
  const missing=new Set(Array.isArray(base.missing)?base.missing:[]);
  const needsTrigger=missing.has('TRIGGER_LEVEL_ID');
  const needsInvalidation=missing.has('INVALIDATION_LEVEL_ID');
  const needsTf=missing.has('TRIGGER_TF');
  if(!needsTrigger&&!needsInvalidation&&!needsTf){
    return {applied:false,reason:'NO_LEVEL_SCHEMA_GAP',contract:{...base,lines}};
  }
  const side=normSide(lines.get('SIDE'))||normSide(context?.sourceCandidate?.side);
  if(!side)return {applied:false,reason:'SIDE_UNAVAILABLE',contract:{...base,lines}};
  const candidates=arr(context?.triggerCandidates);
  const modelTf=normTf(lines.get('TRIGGER_TF'));
  const tfHints=(needsTf
    ? [
        modelTf,
        normTf(lines.get('ORIGIN_TF')),
        normTf(context?.opportunityPaths?.[side]?.originTF),
        normTf(context?.opportunityPaths?.[side]?.ownerTF)
      ]
    : [modelTf]
  ).filter((x,i,a)=>x&&a.indexOf(x)===i);
  if(needsTf){
    for(const x of candidates){
      const tf=normTf(x?.tf);
      if(tf&&!tfHints.includes(tf))tfHints.push(tf);
    }
  }
  for(const tf of tfHints){
    const trigger=best(candidates,side,'TRIGGER',tf);
    const invalidation=best(candidates,side,'INVALIDATION',tf);
    if(!trigger||!invalidation)continue;
    if(needsTf)lines.set('TRIGGER_TF',tf);
    if(needsTrigger)lines.set('TRIGGER_LEVEL_ID',String(trigger.id).toUpperCase());
    if(needsInvalidation)lines.set('INVALIDATION_LEVEL_ID',String(invalidation.id).toUpperCase());
    const repaired=['TRIGGER_TF','TRIGGER_LEVEL_ID','INVALIDATION_LEVEL_ID'].filter(k=>missing.has(k)&&String(lines.get(k)||'').trim());
    const remaining=[...missing].filter(k=>!repaired.includes(k));
    return {
      applied:true,reason:'DETERMINISTIC_CANDIDATE_PAIR',side,tf,
      triggerLevelId:String(trigger.id).toUpperCase(),
      invalidationLevelId:String(invalidation.id).toUpperCase(),
      repaired,
      contract:{...base,ok:remaining.length===0,missing:remaining,lines}
    };
  }
  return {applied:false,reason:'NO_SAME_TF_TRIGGER_INVALIDATION_PAIR',side,contract:{...base,lines}};
}

module.exports={FRAME_ORDER,deterministicCoreLevelRepair};
