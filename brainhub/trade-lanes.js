'use strict';

const LOWER_TFS=['1m','3m','5m'];
const MAIN_TF='15m';
const CONTEXT_TFS=['30m','45m','1h','4h','1d'];
const FRAME_ORDER=[...LOWER_TFS,MAIN_TF,...CONTEXT_TFS];

function finite(v){
  if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function opposite(side){return side==='LONG'?'SHORT':side==='SHORT'?'LONG':null;}
function score(frame,side){
  return finite(side==='LONG'?frame?.opportunity?.longScore:frame?.opportunity?.shortScore)??0;
}
function pathRow(unified,side,tf){
  const rows=Array.isArray(unified?.opportunityPaths?.[side]?.continuity)
    ? unified.opportunityPaths[side].continuity : [];
  return rows.find(x=>String(x?.frame||'').toLowerCase()===tf)||null;
}
function support(unified,side,tf){
  const f=unified?.frames?.[tf];
  const p=pathRow(unified,side,tf);
  if(!f?.available||f?.fresh!==true||!p)return false;
  if(p.immediateEligible!==true)return false;
  return score(f,side)>=45;
}
function hardOpposite(unified,side,tf){
  const f=unified?.frames?.[tf];
  if(!f?.available||f?.fresh!==true)return false;
  const opp=opposite(side);
  const bos=String(f?.breakOfStructure||'').toUpperCase();
  const breakout=String(f?.breakoutExecution?.status||'').toUpperCase();
  const bosOpp=(opp==='LONG'&&bos==='UP')||(opp==='SHORT'&&bos==='DOWN');
  const oppScore=score(f,opp),ownScore=score(f,side);
  const preferred=String(f?.opportunity?.preferredSide||'').toUpperCase();
  return (bosOpp&&['ACCEPTED','RECLAIMED','CONFIRMED'].includes(breakout)) ||
    (preferred===opp&&oppScore>=65&&oppScore-ownScore>=15);
}
function prioritySource(candidate){
  const src=Array.isArray(candidate?.targetSources)?candidate.targetSources:[];
  return src.some(x=>[
    'APP_EARLY_ATTENTION','LIGHTWEIGHT_NEW_ACCELERATION','LIGHTWEIGHT_ACCELERATION',
    'BINANCE_TOP24_GAINER','ACCUMULATION_PROXY'
  ].includes(String(x||'').toUpperCase()));
}

function analyzeTradeLanes(unified, side, candidate=null){
  const s=String(side||candidate?.side||'').toUpperCase();
  if(!['LONG','SHORT'].includes(s))return {
    side:s||null,mainTf:MAIN_TF,scalpReady:false,main15Ready:false,stage:'NO_DIRECTION',
    lowerSupportTfs:[],contextSupportTfs:[],hard15mVeto:false,exhausted:false,priority:false
  };
  const lowerSupportTfs=LOWER_TFS.filter(tf=>support(unified,s,tf));
  const lowerOppositeTfs=LOWER_TFS.filter(tf=>hardOpposite(unified,s,tf));
  const main15Ready=support(unified,s,MAIN_TF);
  const hard15mVeto=hardOpposite(unified,s,MAIN_TF);
  const contextSupportTfs=CONTEXT_TFS.filter(tf=>support(unified,s,tf));
  const contextOppositeTfs=CONTEXT_TFS.filter(tf=>hardOpposite(unified,s,tf));
  const scalpReady=lowerSupportTfs.length>=2 && unified?.frames?.[MAIN_TF]?.fresh===true && !hard15mVeto;
  const scalpEarly=lowerSupportTfs.length>=1 && !scalpReady && !hard15mVeto;
  const exhausted=hard15mVeto || lowerOppositeTfs.length>=2;
  const ladder=FRAME_ORDER.filter(tf=>support(unified,s,tf));
  const highestSupportTf=ladder.length?ladder.at(-1):null;
  let stage='NO_ACTIVE_MOMENTUM';
  if(exhausted)stage='EXHAUSTING';
  else if(contextSupportTfs.length)stage='EXTENDED_'+contextSupportTfs.at(-1).toUpperCase();
  else if(main15Ready)stage='MAIN_15M';
  else if(scalpReady)stage='SCALP_READY';
  else if(scalpEarly)stage='SCALP_EARLY';
  return {
    side:s,
    mainTf:MAIN_TF,
    lowerSupportTfs,
    lowerOppositeTfs,
    lowerAlignedCount:lowerSupportTfs.length,
    scalpEarly,
    scalpReady,
    main15Ready,
    hard15mVeto,
    contextSupportTfs,
    contextOppositeTfs,
    momentumLadder:ladder,
    highestSupportTf,
    exhausted,
    priority:prioritySource(candidate||unified?.sourceCandidate),
    stage,
    rules:{
      lowerTfSoloDecision:false,
      scalpRequiresAlignedLowerTfs:2,
      scalpRequiresFresh15mContext:true,
      scalpBlockedByHard15mOpposition:true,
      mainTradeTf:'15m',
      higherTfsAreContextNotVotes:true
    }
  };
}

function laneForPlan(plan,unified,candidate=null){
  const side=String(plan?.side||candidate?.side||'').toUpperCase();
  const lane=analyzeTradeLanes(unified,side,candidate);
  const origin=String(plan?.originTF||'').toLowerCase();
  const owner=String(plan?.ownerTF||'').toLowerCase();
  let name='CONTEXT_WATCH';
  if(LOWER_TFS.includes(origin)||LOWER_TFS.includes(owner)){
    name='SCALP_MOMENTUM';
  }else if(origin===MAIN_TF||owner===MAIN_TF||lane.main15Ready){
    name='MAIN_15M';
  }
  return {...lane,name,originTF:origin||null,ownerTF:owner||null};
}

function enforceQualification(plan,unified,candidate=null){
  if(!plan||typeof plan!=='object')return plan;
  const lane=laneForPlan(plan,unified,candidate);
  const status=String(plan.status||'').toUpperCase();
  const reasons=[];
  if(status==='QUALIFIED'){
    if(lane.name==='SCALP_MOMENTUM'){
      if(!lane.scalpReady)reasons.push('SCALP_MULTI_TF_CONFIRMATION_REQUIRED');
      if(lane.hard15mVeto)reasons.push('SCALP_15M_HARD_OPPOSITION');
    }else if(lane.name==='MAIN_15M'){
      if(!lane.main15Ready)reasons.push('MAIN_15M_CONFIRMATION_REQUIRED');
    }else{
      reasons.push('TRADE_LANE_NOT_READY');
    }
  }
  if(reasons.length){
    return {
      ...plan,
      previousStatus:plan.status,
      status:'WATCH',
      waitFor:String(plan.waitFor||'').trim()&&String(plan.waitFor||'').trim().toUpperCase()!=='NONE'
        ? plan.waitFor
        : (lane.name==='SCALP_MOMENTUM'
          ? '1m/3m/5m hattında en az iki alt zaman dilimi aynı yönde olmalı ve 15m sert karşı-veto üretmemeli.'
          : '15m ana işlem hattında kapanmış mum/yapı teyidi bekleniyor.'),
      lanePolicyReasons:reasons,
      tradeLane:lane
    };
  }
  return {...plan,tradeLane:lane};
}

function scalpTriggerPreference(lane){
  const supportSet=new Set(lane?.lowerSupportTfs||[]);
  return LOWER_TFS.filter(tf=>supportSet.has(tf));
}

module.exports={
  LOWER_TFS,MAIN_TF,CONTEXT_TFS,FRAME_ORDER,
  analyzeTradeLanes,laneForPlan,enforceQualification,scalpTriggerPreference
};
