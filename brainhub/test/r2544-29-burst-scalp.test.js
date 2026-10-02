'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {burstEvidence,exitEvidence,BurstScalpManager}=require('../burst-scalp');
const {buildLoserLadder}=require('../scanner');

function snap(side='LONG'){
  const long=side==='LONG';
  return {available:true,ageMs:150,spreadBps:1.5,bid:100.02,ask:100.03,
    orderFlow:{windows:{'1s':{buyRatio:long?.78:.22,sellRatio:long?.22:.78,buyQuote:8000,sellQuote:2000,priceMoveBps:long?5:-5},'3s':{buyRatio:long?.72:.28,sellRatio:long?.28:.72,buyQuote:18000,sellQuote:7000,priceMoveBps:long?10:-10},'5s':{buyRatio:long?.68:.32,sellRatio:long?.32:.68,buyQuote:27000,sellQuote:12000,priceMoveBps:long?13:-13}}},
    level1Ofi:{windows:{'1s':{normalizedOfi:long?.65:-.65,queueImbalanceCurrent:long?.4:-.4,micropriceBps:long?.8:-.8},'3s':{normalizedOfi:long?.55:-.55,queueImbalanceCurrent:long?.35:-.35,micropriceBps:long?.6:-.6}}},
    localL2:{available:true,sequenceHealthy:true,confidence:.9,multiLevelOfi:long?.5:-.5,depthImbalance:long?.45:-.45}};
}

test('R2544.29 LONG/SHORT burst evidence is symmetric and ignition-capable',()=>{
  const l=burstEvidence(snap('LONG'),'LONG',{preMove:{state:'IGNITION',direction:'LONG'}});
  const s=burstEvidence(snap('SHORT'),'SHORT',{preMove:{state:'IGNITION',direction:'SHORT'}});
  assert.equal(l.ignition,true); assert.equal(s.ignition,true);
  assert.ok(l.score>=.90); assert.ok(s.score>=.90);
});

test('R2544.29 burst fails closed on unhealthy L2 or wide spread',()=>{
  const a=snap('LONG');a.localL2.sequenceHealthy=false;
  assert.equal(burstEvidence(a,'LONG',{preMove:{state:'IGNITION',direction:'LONG'}}).ignition,false);
  const b=snap('LONG');b.spreadBps=12;
  assert.equal(burstEvidence(b,'LONG',{preMove:{state:'IGNITION',direction:'LONG'}}).ignition,false);
});

test('R2544.29 burst exit supports fast fail, flow reversal and MFE giveback',()=>{
  const a=snap('SHORT');a.bid=99.4;a.ask=99.41;
  const ff=exitEvidence(a,{side:'LONG',entryPrice:100,stopPrice:99,openedAt:Date.now(),mfeR:0,maeR:0});
  assert.equal(ff.exit,true);assert.equal(ff.reason,'BURST_FAST_FAIL');
  const b=snap('LONG');b.bid=100.35;b.ask=100.36;
  const gb=exitEvidence(b,{side:'LONG',entryPrice:100,stopPrice:99,openedAt:Date.now(),mfeR:.8,maeR:0});
  assert.equal(gb.exit,true);assert.equal(gb.reason,'BURST_MFE_GIVEBACK');
});

test('R2544.29 manager enforces four armed, one active and one pause exception',()=>{
  const stream={ensureSymbol(){},ensureLocalL2(){},snapshot(){return snap('LONG')}};
  const m=new BurstScalpManager({marketStream:stream,now:()=>1000,maxArmed:4,maxActive:1});
  for(let i=0;i<5;i++)m.arm({symbol:`A${i}USDT`,side:'LONG',ttlMs:60000,preMove:{state:'IGNITION',direction:'LONG'}});
  assert.equal(m.status().armed.length,4);
  const a=m.status().armed[0];assert.equal(m.start({burstId:'b1',authorizationId:a.authorizationId,symbol:a.symbol,side:'LONG',quantity:1,entryPrice:100,stopPrice:99}).ok,true);
  assert.equal(m.start({burstId:'b2',symbol:'XUSDT',side:'LONG',quantity:1,entryPrice:100,stopPrice:99}).ok,false);
  assert.equal(m.pauseExceptionAvailable('p1'),true);assert.equal(m.consumePauseException('p1'),true);assert.equal(m.pauseExceptionAvailable('p1'),false);assert.equal(m.consumePauseException('p1'),false);
});

test('R2544.29 scanner has symmetric downside loser ladder',()=>{
  const u=[{symbol:'AUSDT',priceChangePercent:-12,quoteVolume:10,lastPrice:1},{symbol:'BUSDT',priceChangePercent:-8,quoteVolume:8,lastPrice:2},{symbol:'CUSDT',priceChangePercent:5,quoteVolume:20,lastPrice:3}];
  const l=buildLoserLadder(u,{},Date.now());
  assert.equal(l.top3[0].symbol,'AUSDT');assert.equal(l.top3[0].loserRank,1);assert.equal(l.rankedCount,2);
});

test('R2544.29 source contract keeps burst separate from normal slots and PC-only',()=>{
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(live,/maxActive:1/);
  assert.match(live,/BURST_OPPOSITE_POSITION_BLOCKED/);
  assert.match(live,/burstFreeMarginFraction/);
  assert.match(live,/availableBalance.*freeFraction/);
  assert.match(live,/pauseExceptionAllowed&&veryStrict/);
  assert.doesNotMatch(live.slice(live.indexOf('async function burstScalpTick'),live.indexOf('function burstStatus')),/positionSlotsFull\(/);
  assert.match(server,/\/live\/burst/);assert.match(server,/burstScalpTick\(\)/);assert.match(server,/1000\);/);
});

test('R2544.29 JEV owns burst preauthorization with LONG/SHORT radar parity and preMove direction consistency',()=>{
  const j=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(j,/sovereignBurstArm/);assert.match(j,/ARM_LONG/);assert.match(j,/ARM_SHORT/);assert.match(j,/DO_NOT_ARM/);
  assert.match(j,/loserRank/);assert.match(j,/projectedLoserRank/);assert.match(j,/gainerRank/);assert.match(j,/projectedGainerRank/);
  assert.match(j,/JEV_BURST_DIRECTION_CONTRADICTS_PREMOVE/);
});

test('R2544.29 burst has separate margin/user leverage cap and never changes core-symbol leverage for addon',()=>{
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(live,/burstMarginQuote/);
  assert.match(live,/burstFreeMarginFraction/);
  assert.match(live,/burstMaxLeverage/);
  assert.match(live,/sameSymbolCore/);
  assert.match(live,/BURST_CORE_LEVERAGE_EXCEEDS_SAFE_MAX/);
  assert.match(live,/if\(sz\.changeLeverage!==false\)/);
  assert.match(live,/userBurstMaxLeverage/);
});
