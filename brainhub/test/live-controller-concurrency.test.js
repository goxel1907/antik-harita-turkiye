'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createLiveController}=require('../live-controller');
const reply=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture(t, hook=async()=>{}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-concurrency-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({
    armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,
    limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:2,maxOpenPositions:3,maxFamilyExposurePct:40},
    apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}
  }));
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url);calls.push({path:u.pathname,method:options.method||'GET'});
    assert.equal(options.method||'GET','GET','fixture must never send exchange writes');
    await hook(u.pathname);
    if(u.pathname==='/fapi/v1/time')return reply({serverTime:Date.now()});
    if(u.pathname==='/fapi/v3/account')return reply({totalWalletBalance:'100',totalMarginBalance:'100',availableBalance:'100',positions:[]});
    if(u.pathname==='/fapi/v1/positionSide/dual')return reply({dualSidePosition:false});
    throw new Error('MOCK_STOP_BEFORE_ORDER');
  };
  return {calls,controller:createLiveController({root,credentials:{apiKey:'test-api-key',apiSecret:'test-api-secret'},fetchImpl,
    store:{journal(){}},scanner:{async scan(){throw new Error('unused');}},pipeline:{async run(){throw new Error('unused');}},committee:async()=>({})})};
}
test('emergency disarm cancels an in-flight arm credential probe',async t=>{
  const entered=deferred(),release=deferred();
  const {controller}=fixture(t,async p=>{if(p==='/fapi/v3/account'){entered.resolve();await release.promise;}});
  const pending=controller.arm({confirmed:true});
  await entered.promise;
  controller.disarm('TEST_EMERGENCY');release.resolve();
  const result=await pending;
  assert.equal(result.armed,false);assert.ok(result.reasons.includes('LIVE_ARM_CANCELLED'));
  assert.equal(controller.status().armed,false);
});
test('mobile and AUTO intents cannot overlap account-risk evaluation; gate releases on failure',async t=>{
  let pause=false;const entered=deferred(),release=deferred();
  const {controller,calls}=fixture(t,async p=>{if(pause&&p==='/fapi/v3/account'){entered.resolve();await release.promise;}});
  assert.equal((await controller.arm({confirmed:true})).armed,true);
  pause=true;
  const intent={eventId:'event-concurrency-1',order:{lineageId:'lineage-concurrency-1',symbol:'BTCUSDT',side:'LONG'}};
  const first=controller.execute(intent);await entered.promise;
  const count=calls.length;
  const second=await controller.execute({...intent,eventId:'event-concurrency-2'});
  assert.ok(second.reasons.includes('LIVE_EXECUTOR_BUSY'));assert.equal(calls.length,count);
  release.resolve();await first;
  pause=false;
  const third=await controller.execute({...intent,eventId:'event-concurrency-3'});
  assert.equal(third.reasons.includes('LIVE_EXECUTOR_BUSY'),false);
  assert.equal(third.orderPlaced,false);
});
