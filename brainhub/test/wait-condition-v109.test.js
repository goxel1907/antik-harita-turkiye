'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isNonConcreteWait,normalizeWaitText}=require('../wait-condition');
const pipeline=require('../pipeline');
const workers=require('../plan-workers');

const realCases=[
  'NONE — tüm TFlerde teyit edilmemiş oluşan mumları ve yapısal dönüşüm teyit edilmediği belirtiliyor',
  'NONE (CORE_DECISION: WATCH → tüm TF_EVIDENCE içinde)',
  'NONE - teyit yok',
  'yok — tüm TFlerde NO_ACTIVE_BREAKOUT',
  'Model somut bekleme koşulu üretmedi; sonraki taze veride yeniden değerlendir.',
  'NONE'
];

test('v109 normalizes all real fake-WAIT forms from field report',()=>{
  for(const v of realCases){
    assert.equal(isNonConcreteWait(v),true,v);
    assert.equal(pipeline.watchPlanNeedsSemanticResolution({status:'WATCH',waitFor:v}),true,v);
  }
  assert.equal(isNonConcreteWait('1m kapanışı 0.245 üstünde ve owner 5m taze kalırsa'),false);
  assert.match(normalizeWaitText(' none — x '),/^NONE/);
});

test('plan worker rejects fake WAIT forms before model review',()=>{
  for(const waitFor of realCases){
    const out=workers.deterministicGuard({
      tracked:{symbol:'TESTUSDT',side:'LONG',waitFor,originTF:'1m',ownerTF:'5m',lastAnalyzedAt:Date.now()},
      candidate:{symbol:'TESTUSDT',side:'LONG',spreadBps:1},
      unified:{dataQuality:{advisoryUsable:true},frames:{'1m':{available:true,fresh:true},'5m':{available:true,fresh:true}},opportunityPaths:{LONG:{continuity:[{frame:'1m'}]}}},
      now:Date.now()
    });
    assert.equal(out.state,'REFRESH_REQUIRED');
    assert.ok((out.reasons||[out.reason]).includes('WORKER_WAIT_CONDITION_MISSING'));
  }
});
