'use strict';
// R2544.46 (user rule 05.10.2026): vur-kaç ince coinlerde de işlem açabilmeli; kaldıraç en fazla 25x;
// JEV'e gereksiz istek gitmemeli. Sabit 1s/3s pencere yerine işlem saati, coin'e göre ölçek, eksik veri nötr.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {StreamingMarket,flowTradeClockStats,tradeClockNoiseBps,bookTickerEventClockStats}=require('../market');
const {burstEvidence,BurstScalpManager,BURST_STRICTNESS,BURST_TTL_MS,BURST_PAUSE_EXCEPTION_MIN}=require('../burst-scalp');
const {burstPreparationReadiness}=require('../burst-preparation');
const {createJevClient}=require('../jev-decision');

const T0=2_000_000_000_000;
const trade=(at,price,sign,quote=50)=>({at,price,qty:quote/price,quote,sign});

test('R46 trade clock: a thin coin still yields a complete 20-trade window; a busy coin keeps the 1 s window',()=>{
  const thin=[];for(let i=0;i<40;i++)thin.push(trade(T0-20000+i*500,100+i*0.01,1));
  const f=flowTradeClockStats(thin,T0,{minTrades:20,minMs:1000,maxMs:15000});
  assert.equal(f.trades,20);assert.equal(f.complete,true);assert.ok(f.spanMs>=9000&&f.spanMs<=10500,String(f.spanMs));
  assert.equal(f.buyRatio,1);
  const busy=[];for(let i=0;i<300;i++)busy.push(trade(T0-3000+i*10,100,i%2?1:-1));
  const b=flowTradeClockStats(busy,T0,{minTrades:20,minMs:1000,maxMs:15000});
  assert.ok(b.trades>=95&&b.trades<=101,String(b.trades));assert.equal(b.windowMs,1000);
  assert.equal(flowTradeClockStats([trade(T0-20000,100,1)],T0).trades,0,'nothing older than maxMs');
});

test('R46 noise is the median 20-trade move and needs at least 4 blocks',()=>{
  const rows=[];let p=100;for(let i=0;i<101;i++){rows.push(trade(T0-100000+i*900,p,1));p+=i%20<10?0.01:-0.01;}
  const n=tradeClockNoiseBps(rows,T0,{blockTrades:20});assert.ok(n>0&&n<20,String(n));
  assert.equal(tradeClockNoiseBps(rows.slice(-60),T0,{blockTrades:20}),null);
  const ofi=bookTickerEventClockStats([{at:T0-9000,bid:1,ask:1.01,bidQty:5,askQty:5},{at:T0-4000,bid:1.001,ask:1.011,bidQty:9,askQty:3}],T0,{minSamples:10});
  assert.equal(ofi.clock,'EVENTS');assert.equal(ofi.available,true);
});

function tcSnap({side='LONG',fastRatio=0.82,slowRatio=0.74,fastMove=6,slowMove=10,noise=2,fastTrades=20,slowTrades=60,intensity=3,ofi=null}={}){
  const s=side==='LONG'?1:-1,w=(r,m,n)=>({trades:n,buyRatio:side==='LONG'?r:1-r,sellRatio:side==='LONG'?1-r:r,priceMoveBps:m*s,buyQuote:1000,sellQuote:500});
  return {available:true,ageMs:200,spreadBps:3,bid:1,ask:1.0003,
    orderFlow:{windows:{},tradeClock:{fast:w(fastRatio,fastMove,fastTrades),slow:w(slowRatio,slowMove,slowTrades),noiseBps20:noise,baselineTradesPerSec:0.5,intensityRatio:intensity}},
    level1Ofi:{windows:{},eventClock:ofi===null?{fast:{available:false},slow:{available:false}}:{fast:{available:true,normalizedOfi:ofi*s},slow:{available:true,normalizedOfi:ofi*s}}},
    localL2:{available:true,sequenceHealthy:true,confidence:0.9}};
}

test('R46 a genuine thin-coin burst reaches the standard trigger with OFI missing (neutral, not veto), both sides',()=>{
  for(const side of ['LONG','SHORT']){
    const e=burstEvidence(tcSnap({side}),side,{preMove:{state:'PRE_MOVE',direction:side}});
    assert.deepEqual(e.contradictions,[],side);assert.equal(e.clock,'TRADES');
    assert.ok(e.score>=BURST_STRICTNESS.TRIGGER_STANDARD,side+' '+e.score);
    assert.equal(e.parts.ofiFast,null);
  }
  // Calm coin: same trade clock but no direction/move -> stays far below the trigger.
  const calm=burstEvidence(tcSnap({fastRatio:0.52,slowRatio:0.5,fastMove:0.5,slowMove:0.5,intensity:1}),'LONG',{preMove:{state:'PRE_MOVE',direction:'LONG'}});
  assert.ok(calm.score<0.5,String(calm.score));
});

test('R46 moves are read in the coin\'s own units: the same 6 bps is strong on a quiet coin, weak on a noisy one',()=>{
  const quiet=burstEvidence(tcSnap({noise:2}),'LONG'),noisy=burstEvidence(tcSnap({noise:20}),'LONG');
  assert.ok(quiet.parts.zFast>noisy.parts.zFast);assert.ok(quiet.score>noisy.score);
  assert.ok(burstEvidence(tcSnap({slowMove:-8,noise:2}),'LONG').contradictions.includes('3S_PRICE_AGAINST_SIDE'));
});

test('R46 only genuinely thin flow is TRIGGER_WINDOW_INCOMPLETE',()=>{
  assert.ok(burstEvidence(tcSnap({fastTrades:7}),'LONG').contradictions.includes('TRIGGER_WINDOW_INCOMPLETE'));
  assert.ok(burstEvidence(tcSnap({slowTrades:11}),'LONG').contradictions.includes('TRIGGER_WINDOW_INCOMPLETE'));
  assert.ok(!burstEvidence(tcSnap({fastTrades:8,slowTrades:12}),'LONG').contradictions.includes('TRIGGER_WINDOW_INCOMPLETE'));
});

test('R46 live StreamingMarket: 2 trades/s on a thin coin no longer empties the trigger (old 1s window did)',()=>{
  const m=new StreamingMarket({WebSocketImpl:null});m.ensureSymbol('ABCUSDT');let n=0;
  for(let t=T0-60000;t<=T0;t+=500){n++;m.now=()=>t;
    m.ingest({e:'bookTicker',s:'ABCUSDT',E:t,T:t,u:n,b:String(100+n*0.002),B:String(40+n%7),a:String(100.02+n*0.002),A:'30'});
    if(n%1===0)m.ingest({e:'aggTrade',s:'ABCUSDT',E:t,T:t,p:String(100.01+n*0.002),q:'1',m:n%5===0});}
  m.now=()=>T0+400;const snap=m.snapshot('ABCUSDT',T0+400);
  assert.ok(snap.orderFlow.tradeClock.fast.complete,'fast trade clock complete');assert.ok(snap.orderFlow.tradeClock.slow.trades>=60);
  assert.ok(snap.orderFlow.windows['1s'].trades<=2,'old 1s window is nearly empty');
  const e=burstEvidence({...snap,localL2:{available:true,sequenceHealthy:true,confidence:0.9}},'LONG',{preMove:{state:'IGNITION',direction:'LONG'}});
  assert.ok(!e.contradictions.includes('TRIGGER_WINDOW_INCOMPLETE'),JSON.stringify(e.contradictions));
  assert.equal(burstPreparationReadiness({...snap,localL2:{available:true,sequenceHealthy:true,confidence:0.9}}).ready,true);
});

test('R46 manager: TTL is 120-180 s and the threshold floor is the standard trigger',()=>{
  let now=1000;const m=new BurstScalpManager({now:()=>now,marketStream:{ensureSymbol(){},ensureLocalL2(){},snapshot:()=>tcSnap()}});
  m.arm({symbol:'ABCUSDT',side:'LONG',ttlMs:30000,triggerThreshold:0.5,preMove:{state:'PRE_MOVE',direction:'LONG'}});
  const a=m.status().armed[0];assert.equal(a.expiresAt-a.armedAt,BURST_TTL_MS.TTL_120S);assert.equal(a.triggerThreshold,BURST_STRICTNESS.TRIGGER_STANDARD);
  assert.equal(m.evaluateArmed('ABCUSDT').trigger,true);
  m.arm({symbol:'XYZUSDT',side:'LONG',ttlMs:999999});const b=m.status().armed.find(x=>x.symbol==='XYZUSDT');assert.equal(b.expiresAt-b.armedAt,BURST_TTL_MS.TTL_180S);
  assert.ok(BURST_PAUSE_EXCEPTION_MIN>BURST_STRICTNESS.TRIGGER_VERY_STRICT);
});

test('R46 JEV burst schema: old 30 s TTL is rejected, 180 s maps exactly, flow is sent on the trade clock',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r46-burst-'));fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  let seen=null,answer={ttl:'TTL_180S',strict:'TRIGGER_VERY_STRICT'};
  const c=createJevClient({root,apiKey:'sk-or-v1-fake',fetchImpl:async(_,o)=>{seen=JSON.parse(o.body);return {ok:true,status:200,text:async()=>JSON.stringify({answers:{burst_decision:{choice:'ARM_LONG'},burst_reason:{choice:'EARLY_EXPANSION'},burst_data_gap:{choice:'NO_GAP'},ttl:{choice:answer.ttl},trigger_strictness:{choice:answer.strict},leverage_mode:{choice:'MAX_SAFE'},pause_exception:{choice:'NO_PAUSE_EXCEPTION'}},usage:{cost:0}})};}});
  const chartContext={symbol:'ABCUSDT',available:true,packet:{symbol:'ABCUSDT',coreFrames:{}},asOf:Date.now(),ageMs:0,source:'TEST'};
  const args={candidate:{symbol:'ABCUSDT'},preMove:{state:'PRE_MOVE',direction:'LONG'},stream:tcSnap(),chartContext};
  const ok=await c.sovereignBurstArm(args);assert.equal(ok.ok,true,JSON.stringify(ok));assert.equal(ok.ttlMs,180000);assert.equal(ok.triggerThreshold,BURST_STRICTNESS.TRIGGER_VERY_STRICT);
  assert.equal(seen.state.record.stream.orderFlow.clock,'TRADES');assert.equal(seen.state.record.stream.orderFlow.fast.trades,20);
  assert.deepEqual(Object.keys(seen.questions.ttl.criteria),['TTL_120S','TTL_180S']);assert.match(seen.questions.leverage_mode.instructions,/25x/);
  answer={ttl:'TTL_30S',strict:'TRIGGER_STRICT'};assert.equal((await c.sovereignBurstArm(args)).reason,'JEV_BURST_SCHEMA_MISMATCH');
});

test('R46 a strong opposite trade-clock burst asks JEV to review an open burst (review only, no exit)',()=>{
  const {exitEvidence}=require('../burst-scalp');
  const rev=tcSnap({side:'SHORT',fastRatio:0.95,slowRatio:0.9,fastMove:9,slowMove:14,ofi:0.7,intensity:4});
  const x=exitEvidence({...rev,bid:100.05,ask:100.06},{side:'LONG',entryPrice:100,stopPrice:99.62,openedAt:T0,mfeR:0,maeR:0},T0+5000);
  assert.equal(x.reviewReason,'BURST_FLOW_REVERSAL');assert.equal(x.exit,false);
  assert.equal(exitEvidence({...tcSnap({side:'LONG'}),bid:100.05,ask:100.06},{side:'LONG',entryPrice:100,stopPrice:99.62,openedAt:T0},T0+5000).reviewReason,null);
});

test('R46 source contract: 25x burst leverage ceiling and 5 min no-re-ask after JEV DO_NOT_ARM',()=>{
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(live,/const BURST_LEVERAGE_CEILING=25;/);
  assert.match(live,/Math\.min\(BURST_LEVERAGE_CEILING,Math\.floor\(finite\(la\.config\.burstMaxLeverage\)\?\?BURST_LEVERAGE_CEILING\)\)/);
  assert.match(live,/leverage=Math\.max\(1,Math\.min\(125,userCap,exchangeMax,safeMax,leverage\)\)/,'userCap bounds the chosen leverage');
  assert.match(live,/const burstReviewCooldownMs=prior=>prior\?\.armed===true\?120000:300000;/);
  assert.match(live,/reviewRow\.armed=a\.ok===true;/);
  assert.match(live,/score>=Math\.max\(BURST_PAUSE_EXCEPTION_MIN,auth\.triggerThreshold\)/);
});
