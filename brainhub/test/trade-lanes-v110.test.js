'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const lanes=require('../trade-lanes');
const pipeline=require('../pipeline');
const workers=require('../plan-workers');
const positionManager=require('../position-manager');

function frame({side='LONG',score=70,oppScore=20,bos=null,breakout='NONE',fresh=true,prior20High=101,prior20Low=99,close=100}={}){
  return {
    available:true,fresh,close,prior20High,prior20Low,breakOfStructure:bos,
    opportunity:{
      available:true,preferredSide:side,
      longScore:side==='LONG'?score:oppScore,
      shortScore:side==='SHORT'?score:oppScore,
      originEligible:true,ownerEligible:true
    },
    breakoutExecution:{status:breakout,allowed:true},
    trend:side==='LONG'?'UP':'DOWN'
  };
}
function unified({side='LONG',supports=['1m','3m'],mainSide=null,hard15Opp=false}={}){
  const frames={};
  for(const tf of lanes.FRAME_ORDER)frames[tf]={available:true,fresh:true,close:100,prior20High:101,prior20Low:99,opportunity:{available:true,preferredSide:null,longScore:10,shortScore:10},breakoutExecution:{status:'NONE'}};
  for(const tf of supports)frames[tf]=frame({side});
  if(mainSide)frames['15m']=frame({side:mainSide});
  if(hard15Opp){
    const opp=side==='LONG'?'SHORT':'LONG';
    frames['15m']=frame({side:opp,score:80,oppScore:20,bos:opp==='LONG'?'UP':'DOWN',breakout:'ACCEPTED'});
  }
  const path=s=>{
    const scoreKey=s==='LONG'?'longScore':'shortScore';
    const rows=[];
    for(const tf of lanes.FRAME_ORDER){
      const f=frames[tf];
      const score=Number(f?.opportunity?.[scoreKey]||0);
      if(f?.available&&f?.fresh&&score>=45)rows.push({frame:tf,score,immediateEligible:true,state:'ACTIVE_CONTEXT'});
    }
    return {side:s,originTF:rows[0]?.frame||null,ownerTF:rows.at(-1)?.frame||null,continuity:rows};
  };
  return {
    frames,
    opportunityPaths:{LONG:path('LONG'),SHORT:path('SHORT')},
    dataQuality:{advisoryUsable:true},
    sourceCandidate:{symbol:'TESTUSDT',side,targetSources:['LIGHTWEIGHT_NEW_ACCELERATION']}
  };
}

test('one lower timeframe can start tracking but cannot qualify alone',()=>{
  const u=unified({side:'LONG',supports:['1m'],mainSide:null});
  const lane=lanes.analyzeTradeLanes(u,'LONG',u.sourceCandidate);
  assert.equal(lane.scalpEarly,true);
  assert.equal(lane.scalpReady,false);
  const out=lanes.enforceQualification({status:'QUALIFIED',side:'LONG',originTF:'1m',ownerTF:'1m',waitFor:'NONE'},u,u.sourceCandidate);
  assert.equal(out.status,'WATCH');
  assert.ok(out.lanePolicyReasons.includes('SCALP_MULTI_TF_CONFIRMATION_REQUIRED'));
});

test('two aligned lower timeframes plus fresh non-opposite 15m allow scalp lane',()=>{
  const u=unified({side:'LONG',supports:['1m','3m'],mainSide:null});
  const lane=lanes.analyzeTradeLanes(u,'LONG',u.sourceCandidate);
  assert.equal(lane.scalpReady,true);
  assert.deepEqual(lane.lowerSupportTfs,['1m','3m']);
  const out=lanes.enforceQualification({status:'QUALIFIED',side:'LONG',originTF:'1m',ownerTF:'3m',waitFor:'NONE'},u,u.sourceCandidate);
  assert.equal(out.status,'QUALIFIED');
  assert.equal(out.tradeLane.name,'SCALP_MOMENTUM');
});

test('hard opposite 15m veto blocks lower-TF scalp qualification',()=>{
  const u=unified({side:'LONG',supports:['1m','3m','5m'],hard15Opp:true});
  const lane=lanes.analyzeTradeLanes(u,'LONG',u.sourceCandidate);
  assert.equal(lane.hard15mVeto,true);
  assert.equal(lane.scalpReady,false);
});

test('15m is the main trade lane and 30m+ remain context',()=>{
  const u=unified({side:'SHORT',supports:[],mainSide:'SHORT'});
  const out=lanes.enforceQualification({status:'QUALIFIED',side:'SHORT',originTF:'15m',ownerTF:'15m',waitFor:'NONE'},u,u.sourceCandidate);
  assert.equal(out.status,'QUALIFIED');
  assert.equal(out.tradeLane.name,'MAIN_15M');
  assert.equal(out.tradeLane.main15Ready,true);
});

test('scalp trigger auto-select prefers earliest aligned lower timeframe',()=>{
  const u=unified({side:'LONG',supports:['1m','3m'],mainSide:null});
  u.frames['1m'].prior20High=100.5;u.frames['1m'].prior20Low=99.2;u.frames['1m'].close=100.2;
  const plan=pipeline.withTriggerSpec({
    status:'WATCH',side:'LONG',originTF:'1m',ownerTF:'3m',
    triggerLevelId:null,triggerTF:null,invalidationLevelId:null,waitFor:'NONE'
  },u);
  assert.equal(plan.triggerSpec.valid,true);
  assert.equal(plan.triggerTF,'1m');
  assert.equal(plan.triggerLevelId,'PRIOR20_HIGH');
  assert.equal(plan.v110ScalpTriggerAutoSelected,true);
});

test('deterministic numeric trigger bypasses unavailable router but still only escalates',()=>{
  const d={state:'TRIGGERED',reason:'WORKER_NUMERIC_TRIGGER_CLOSED',recheckTFs:['1m'],numericTrigger:true};
  const out=workers.combineWorkerReviews({deterministic:d,router:{ok:false,state:'WAIT'}});
  assert.equal(out.state,'TRIGGERED');
  assert.equal(out.source,'DETERMINISTIC_NUMERIC_TRIGGER');
  assert.equal(out.numericTrigger,true);
});

test('scalp position exit requires multi-TF exhaustion rather than one noisy lower timeframe',()=>{
  const u=unified({side:'LONG',supports:['1m','3m'],mainSide:null});
  // One low-TF opposite signal is noise.
  u.frames['1m']=frame({side:'SHORT',score:80,bos:'DOWN',breakout:'ACCEPTED'});
  const a=positionManager.assessPosition({
    position:{side:'LONG',entryPrice:100,markPrice:102},
    lifecycle:{originTF:'1m',ownerTF:'3m',tradeLaneName:'SCALP_MOMENTUM'},
    unified:u
  });
  assert.equal(a.bigPictureBroken,false);
  assert.equal(a.lowTfNoiseOnly,true);
});
