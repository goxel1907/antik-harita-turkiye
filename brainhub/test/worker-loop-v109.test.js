'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const workers=require('../plan-workers');

test('invalid worker output stays WAIT instead of blind 9TF refresh',()=>{
  const p=workers.parseWorkerDecision('nonsense');
  assert.equal(p.ok,false);
  assert.equal(p.state,'WAIT');
  const c=workers.combineWorkerReviews({deterministic:{state:'REVIEW',recheckTFs:['1m']},router:p});
  assert.equal(c.state,'WAIT');
  assert.equal(c.reason,'WORKER_9ROUTER_UNAVAILABLE');
});

test('valid explicit refresh may still request structural re-analysis',()=>{
  const c=workers.combineWorkerReviews({
    deterministic:{state:'REVIEW',recheckTFs:['1m','5m']},
    router:{ok:true,state:'REFRESH_REQUIRED',reason:'structure changed',confidence:80,recheckTFs:['5m']}
  });
  assert.equal(c.state,'REFRESH_REQUIRED');
  assert.equal(c.source,'9ROUTER');
});
