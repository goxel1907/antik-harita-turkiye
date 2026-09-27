const test=require('node:test');
const assert=require('node:assert/strict');
const {applyDecisionJudgeResult}=require('../pipeline');

function qualified(){return {valid:true,status:'QUALIFIED',side:'LONG',confidence:84,execution:'ADVISORY_ONLY'};}

test('Jev advisory gate can only downgrade a QUALIFIED plan',()=>{
  const p=applyDecisionJudgeResult(qualified(),{ok:true,required:true,called:true,veto:true,vetoReasons:['JEV_STRUCTURAL_VETO']});
  assert.equal(p.status,'WATCH');
  assert.equal(p.previousStatus,'QUALIFIED');
  assert.equal(p.reason,'JEV_STRUCTURAL_VETO');
  assert.ok(p.confidence<=49);
  assert.equal(p.execution,'ADVISORY_ONLY');
});

test('Jev advisory gate never upgrades WATCH and preserves QUALIFIED on clean judge',()=>{
  const w=applyDecisionJudgeResult({valid:true,status:'WATCH',side:'LONG',confidence:40},{ok:true,required:true,veto:false});
  assert.equal(w.status,'WATCH');
  const q=applyDecisionJudgeResult(qualified(),{ok:true,required:true,called:true,veto:false});
  assert.equal(q.status,'QUALIFIED');
});

test('Configured Jev failure downgrades QUALIFIED fail-closed',()=>{
  const p=applyDecisionJudgeResult(qualified(),{ok:false,required:true,called:true,veto:true,reason:'JEV_HTTP_ERROR'});
  assert.equal(p.status,'WATCH');
  assert.equal(p.reason,'JEV_HTTP_ERROR');
});
