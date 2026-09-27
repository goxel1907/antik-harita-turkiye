'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {deterministicCoreLevelRepair}=require('../vision-contract-repair');

function contract(linesObj,missing){
  return {ok:false,missing:[...missing],lines:new Map(Object.entries(linesObj))};
}

test('R2536 repairs missing trigger/invalidation IDs from same-TF deterministic candidates without changing side/status',()=>{
  const c=contract({
    STATUS:'WATCH',SIDE:'SHORT',CONFIDENCE:'61',ORIGIN_TF:'5m',OWNER_TF:'15m',
    SETUP:'FAILED BREAKOUT',EXEC_PATH:'RECLAIM',TRIGGER_TF:'5m'
  },['TRIGGER_LEVEL_ID','INVALIDATION_LEVEL_ID']);
  const out=deterministicCoreLevelRepair(c,{
    sourceCandidate:{side:'LONG'},
    triggerCandidates:[
      {side:'LONG',tf:'5m',id:'PRIOR20_HIGH',price:10,uses:['LONG_TRIGGER','SHORT_INVALIDATION']},
      {side:'LONG',tf:'5m',id:'PRIOR20_LOW',price:8,uses:['SHORT_TRIGGER','LONG_INVALIDATION']},
      {side:'SHORT',tf:'5m',id:'PRIOR20_LOW',price:8,uses:['SHORT_TRIGGER','LONG_INVALIDATION']},
      {side:'SHORT',tf:'5m',id:'PRIOR20_HIGH',price:10,uses:['LONG_TRIGGER','SHORT_INVALIDATION']}
    ]
  });
  assert.equal(out.applied,true);
  assert.equal(out.contract.lines.get('STATUS'),'WATCH');
  assert.equal(out.contract.lines.get('SIDE'),'SHORT');
  assert.equal(out.contract.lines.get('TRIGGER_LEVEL_ID'),'PRIOR20_LOW');
  assert.equal(out.contract.lines.get('INVALIDATION_LEVEL_ID'),'PRIOR20_HIGH');
  assert.deepEqual(out.contract.missing,[]);
});

test('R2536 never fabricates a pair when deterministic same-TF candidates are unavailable',()=>{
  const c=contract({
    STATUS:'WATCH',SIDE:'LONG',CONFIDENCE:'50',ORIGIN_TF:'5m',OWNER_TF:'15m',
    SETUP:'TEST',EXEC_PATH:'WAIT',TRIGGER_TF:'5m'
  },['TRIGGER_LEVEL_ID','INVALIDATION_LEVEL_ID']);
  const out=deterministicCoreLevelRepair(c,{
    triggerCandidates:[{side:'LONG',tf:'5m',id:'PRIOR20_HIGH',price:10,uses:['LONG_TRIGGER']}]
  });
  assert.equal(out.applied,false);
  assert.equal(out.reason,'NO_SAME_TF_TRIGGER_INVALIDATION_PAIR');
  assert.deepEqual(out.contract.missing,['TRIGGER_LEVEL_ID','INVALIDATION_LEVEL_ID']);
});


test('R2536 does not cross timeframes when model already selected TRIGGER_TF',()=>{
  const c=contract({
    STATUS:'WATCH',SIDE:'LONG',CONFIDENCE:'58',ORIGIN_TF:'5m',OWNER_TF:'15m',
    SETUP:'TEST',EXEC_PATH:'WAIT',TRIGGER_TF:'5m'
  },['TRIGGER_LEVEL_ID','INVALIDATION_LEVEL_ID']);
  const out=deterministicCoreLevelRepair(c,{
    sourceCandidate:{side:'LONG'},
    triggerCandidates:[
      {side:'LONG',tf:'15m',id:'PRIOR20_HIGH',price:11,uses:['LONG_TRIGGER','SHORT_INVALIDATION']},
      {side:'LONG',tf:'15m',id:'PRIOR20_LOW',price:9,uses:['SHORT_TRIGGER','LONG_INVALIDATION']}
    ]
  });
  assert.equal(out.applied,false);
  assert.equal(out.reason,'NO_SAME_TF_TRIGGER_INVALIDATION_PAIR');
  assert.equal(out.contract.lines.get('TRIGGER_TF'),'5m');
  assert.deepEqual(out.contract.missing,['TRIGGER_LEVEL_ID','INVALIDATION_LEVEL_ID']);
});
