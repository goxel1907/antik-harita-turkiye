'use strict';
// R2544.47: JEV vur-kaç çıkış kararına doğru ve kompakt veri; çıkış/giriş fiyatı ölçümü (05.10 21:18 ORCA olayı).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createJevClient}=require('../jev-decision');
const {createBurstReduction}=require('../burst-reduction');

function stream(){
  const w=(n)=>({trades:n,spanMs:5000,tradesPerSec:4,buyRatio:0.74,sellRatio:0.26,priceMoveBps:9,deltaQuote:3500,largeBuyCount:3,largeSellCount:1,possibleTwapLike:null,semantics:'X'.repeat(200)});
  const windows=Object.fromEntries(['1s','3s','5s','10s','15s','30s','60s','120s'].map(k=>[k,w(20)]));
  return {available:true,ageMs:300,bid:2.035,ask:2.036,spreadBps:4.9,
    orderFlow:{windows,tradeClock:{fast:w(20),slow:w(60),noiseBps20:4.2,baselineTradesPerSec:1.5,intensityRatio:2.6}},
    level1Ofi:{windows:Object.fromEntries(['1s','3s','5s','15s','30s','60s','120s'].map(k=>[k,{available:true,normalizedOfi:0.4,note:'Y'.repeat(150)}])),eventClock:{fast:{available:true,samples:12,normalizedOfi:0.5},slow:{available:true,samples:30,normalizedOfi:0.3}}},
    localL2:{available:true,sequenceHealthy:true,confidence:0.9,multiLevelOfi:0.2,depthImbalance:0.1,levels:new Array(40).fill({p:1,q:2})}};
}

test('R47 burst exit: JEV sees age, fee in R and the compact trade-clock flow; success is labelled called',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r47-exit-'));fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  const now=2_000_000_000_000;let seen=null;
  const c=createJevClient({root,apiKey:'sk-or-v1-fake',clock:()=>now,fetchImpl:async(_,o)=>{seen=JSON.parse(o.body);return {ok:true,status:200,text:async()=>JSON.stringify({answers:{burst_exit:{choice:'HOLD'}},usage:{cost:0}})};}});
  const active={burstId:'burst_x',symbol:'ORCAUSDT',side:'LONG',quantity:184.1,entryPrice:2.036,stopPrice:2.027,leverage:25,openedAt:now-1000,triggerScore:0.8493,mfeR:0,maeR:-0.05};
  const r=await c.sovereignBurstExit({active,stream:stream(),progress:{progressR:-0.05}});
  assert.equal(r.ok,true);assert.equal(r.called,true);assert.equal(r.action,'HOLD');
  const rec=seen.state.record;
  assert.equal(rec.position.ageSec,1);assert.equal(rec.position.entryTriggerScore,0.8493);
  assert.ok(Math.abs(rec.costs.stopDistancePct-0.442)<0.001,String(rec.costs.stopDistancePct));
  assert.ok(Math.abs(rec.costs.roundTripFeeR-0.226)<0.002,String(rec.costs.roundTripFeeR));
  assert.equal(rec.stream.orderFlow.clock,'TRADES');assert.equal(rec.stream.orderFlow.windows,undefined,'whole window map is not sent');
  assert.equal(rec.stream.level1Ofi.fast.normalizedOfi,0.5);assert.equal(rec.stream.localL2.levels,undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(rec))<2500,'record '+Buffer.byteLength(JSON.stringify(rec)));
  assert.match(seen.state.description,/ageSec is seconds since entry/);
});

function reducer({avgPrice,statusPx,statusOk=true}){
  const active={symbol:'ORCAUSDT',side:'LONG',quantity:20,syntheticAddon:false,coreQtyBefore:0,stopAlgoId:55,stopPrice:99};let statusCalls=0;
  const transport={positionSnapshot:async()=>({ok:true,qty:20,stepSize:1}),reducePositionMarket:async()=>({ok:true,status:'FILLED',executedQty:20,avgPrice}),
    reductionStatus:async x=>{statusCalls++;assert.match(x.clientOrderId,/^JX[a-f0-9]{30}$/);return statusOk?{ok:true,status:'FILLED',executedQty:20,avgPrice:statusPx}:{ok:false};}};
  return {active,reducer:createBurstReduction({transport}),calls:()=>statusCalls};
}

test('R47 a filled exit ACKed with avgPrice 0 is measured from the order query',async()=>{
  const a=reducer({avgPrice:0,statusPx:2.031});const r=await a.reducer.reduce(a.active,'JEV_BURST_EXIT',{});
  assert.equal(r.ok,true);assert.equal(r.avgPrice,2.031);assert.notEqual(a.active.exitPriceUnmeasured,true);assert.equal(a.calls(),1);
  const b=reducer({avgPrice:2.04,statusPx:9});const rb=await b.reducer.reduce(b.active,'JEV_BURST_EXIT',{});assert.equal(rb.avgPrice,2.04);assert.equal(b.calls(),0,'no extra query when the ACK has a price');
  const c=reducer({avgPrice:0,statusOk:false});const rc=await c.reducer.reduce(c.active,'JEV_BURST_EXIT',{});assert.equal(rc.ok,true,'close still completes');assert.equal(rc.avgPrice,null);assert.equal(c.active.exitPriceUnmeasured,true);
});

test('R47 burst entry never records a 0 average price',()=>{
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(live,/entryPrice=finite\(entry\?\.avgPrice\)>0\?finite\(entry\.avgPrice\):price;/);
  assert.doesNotMatch(live,/entryPrice=finite\(entry\?\.avgPrice\)\?\?price/);
});
