'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const pipeline=require('../pipeline');

test('v108 WATCH requires a concrete wait condition',()=>{
  assert.equal(pipeline.watchPlanNeedsSemanticResolution({status:'WATCH',waitFor:'NONE'}),true);
  assert.equal(pipeline.watchPlanNeedsSemanticResolution({
    status:'WATCH',
    waitFor:'Model somut bekleme koşulu üretmedi; sonraki taze veride yeniden değerlendir.'
  }),true);
  assert.equal(pipeline.watchPlanNeedsSemanticResolution({
    status:'WATCH',
    waitFor:'Yok — yeniden inceleme gerekli'
  }),true);
  assert.equal(pipeline.watchPlanNeedsSemanticResolution({
    status:'WATCH',
    waitFor:'1m kapanışı 0.245 altında ve 5m reclaim oluşmadan'
  }),false);
  assert.equal(pipeline.watchPlanNeedsSemanticResolution({status:'QUALIFIED',waitFor:'NONE'}),false);
});

test('v108 Vision contract rejects generic WATCH placeholders',()=>{
  const plan={
    valid:true,status:'WATCH',side:'SHORT',originTF:'1m',ownerTF:'5m',
    setup:'breakout',execPath:'closed candle',why:'x',riskNote:'y',
    waitFor:'Model somut bekleme koşulu üretmedi; sonraki taze veride yeniden değerlendir.',
    visionSummary:'summary',formingContext:'forming teyit değildir',
    supportTFsDeclared:true,vetoTFsDeclared:true,
    supportTFs:[],vetoTFs:[],invalidSupportTFs:[],invalidVetoTFs:[],
    timeframeDiagnostics:Object.fromEntries(
      pipeline.FRAME_ORDER.map(tf=>[tf,{summary:'s',why:'w',waitFor:'NONE',role:'NEUTRAL',formingContext:'f',risk:'r'}])
    )
  };
  const c=pipeline.visionPlanContract(plan);
  assert.equal(c.ok,false);
  assert.ok(c.missing.includes('WATCH_WAIT_FOR_NOT_CONCRETE'));
});
