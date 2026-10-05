'use strict';
// R2544.49 (user 06.10.2026: "trade it the way a scalper does"): impulse -> shallow pullback -> resume entry, structural
// stop, coin unit required, burst-only loss pause. R46/R47 bought the tip of the tape burst (5/6 live bursts lost).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PullbackEntry,PULLBACK_RULES}=require('../burst-scalp');
const {createLiveController}=require('../live-controller');

const snap=(mid,spreadBps=3)=>({bid:mid*(1-spreadBps/20000),ask:mid*(1+spreadBps/20000),spreadBps,available:true,ageMs:200});
// evidence as burstEvidence returns it (only the fields PullbackEntry reads)
const ev=({score=0.85,contr=[],noise=4,slowBps=20,side='LONG',fastSide=0.7,match=true}={})=>{
  const r=side==='LONG'?{buyRatio:fastSide,sellRatio:1-fastSide}:{buyRatio:1-fastSide,sellRatio:fastSide};
  return {score,contradictions:contr,preMove:{match},moveUnits:{noiseBps20:noise},flow:{oneSec:r,threeSec:{priceMoveBps:side==='LONG'?slowBps:-slowBps}}};
};
const T=0.78;

test('R49 LONG: the impulse is not an entry; entry comes on the resume after a shallow pullback, stop beyond the pullback low',()=>{
  const p=new PullbackEntry({side:'LONG'});let t=0;
  assert.equal(p.step({snapshot:snap(100.20),evidence:ev(),threshold:T,now:t}).state,'IMPULSE','tip of the burst = impulse only');
  assert.equal(p.step({snapshot:snap(100.40),evidence:ev(),threshold:T,now:t+=1000}).state,'IMPULSE','new high extends the leg');
  // leg = 100.40 - 100.20/1.002 (=100.0) = 0.40; 30% pullback -> 100.28
  let s=p.step({snapshot:snap(100.28),evidence:ev({score:0.3,fastSide:0.45}),threshold:T,now:t+=1000});
  assert.equal(s.state,'PULLBACK');assert.ok(s.retrace>=0.2&&s.retrace<=0.62,String(s.retrace));
  s=p.step({snapshot:snap(100.26),evidence:ev({score:0.3,fastSide:0.45}),threshold:T,now:t+=1000});
  assert.equal(s.state,'PULLBACK','still pulling back, no entry');
  s=p.step({snapshot:snap(100.31),evidence:ev({score:0.6,fastSide:0.66}),threshold:T,now:t+=1000});
  assert.equal(s.state,'ENTER');
  assert.ok(s.entry.stopPrice<100.26&&s.entry.stopPrice>100.20,'stop just below the pullback low: '+s.entry.stopPrice);
  assert.ok(s.entry.stopPct>=PULLBACK_RULES.minStopPct&&s.entry.stopPct<=PULLBACK_RULES.maxStopPct);
  assert.ok(s.entry.price<100.40,'entered below the impulse high (no chasing)');
});

test('R49 SHORT is symmetric',()=>{
  const p=new PullbackEntry({side:'SHORT'});let t=0;
  assert.equal(p.step({snapshot:snap(99.80),evidence:ev({side:'SHORT'}),threshold:T,now:t}).state,'IMPULSE');
  p.step({snapshot:snap(99.60),evidence:ev({side:'SHORT'}),threshold:T,now:t+=1000});
  assert.equal(p.step({snapshot:snap(99.73),evidence:ev({side:'SHORT',score:0.3,fastSide:0.45}),threshold:T,now:t+=1000}).state,'PULLBACK');
  const s=p.step({snapshot:snap(99.68),evidence:ev({side:'SHORT',score:0.6,fastSide:0.66}),threshold:T,now:t+=1000});
  assert.equal(s.state,'ENTER');assert.ok(s.entry.stopPrice>99.73,'stop above the pullback high');
});

test('R49 no pullback in time, a too-deep pullback, a too-wide structural stop: no trade',()=>{
  let p=new PullbackEntry({side:'LONG'});p.step({snapshot:snap(100.2),evidence:ev(),threshold:T,now:0});
  assert.equal(p.step({snapshot:snap(100.2),evidence:ev({score:0.5}),threshold:T,now:PULLBACK_RULES.impulseMaxWaitMs+1}).reason,'NO_PULLBACK_IN_TIME');
  p=new PullbackEntry({side:'LONG'});p.step({snapshot:snap(100.2),evidence:ev(),threshold:T,now:0});
  assert.equal(p.step({snapshot:snap(100.05),evidence:ev({score:0.2}),threshold:T,now:1000}).reason,'PULLBACK_TOO_DEEP');
  // leg 98.1 -> 103 (4.9), pullback to 101.5 (31%), resume at 102.3: stop below 101.5 is ~0.8% away (> 0.60%)
  p=new PullbackEntry({side:'LONG'});p.step({snapshot:snap(103.0),evidence:ev({slowBps:500}),threshold:T,now:0});
  assert.equal(p.step({snapshot:snap(101.5),evidence:ev({score:0.3,fastSide:0.45}),threshold:T,now:1000}).state,'PULLBACK');
  assert.equal(p.step({snapshot:snap(102.3),evidence:ev({score:0.6,fastSide:0.7}),threshold:T,now:2000}).reason,'STRUCTURAL_STOP_TOO_WIDE');
});

test('R49 waits while the opposite side is aggressive; needs the coin unit and an aligned pre-move to see an impulse',()=>{
  const p=new PullbackEntry({side:'LONG'});p.step({snapshot:snap(100.2),evidence:ev(),threshold:T,now:0});p.step({snapshot:snap(100.4),evidence:ev(),threshold:T,now:1000});
  p.step({snapshot:snap(100.28),evidence:ev({score:0.3,fastSide:0.45}),threshold:T,now:2000});
  const s=p.step({snapshot:snap(100.32),evidence:ev({score:0.4,fastSide:0.3}),threshold:T,now:3000});
  assert.equal(s.state,'PULLBACK');assert.equal(s.reason,'OPPOSITE_AGGRESSION');
  assert.equal(new PullbackEntry({side:'LONG'}).step({snapshot:snap(100),evidence:ev({noise:null}),threshold:T,now:0}).reason,'COIN_UNIT_NOT_READY');
  assert.equal(new PullbackEntry({side:'LONG'}).step({snapshot:snap(100),evidence:ev({match:false}),threshold:T,now:0}).reason,'PREMOVE_NOT_ALIGNED');
  assert.equal(new PullbackEntry({side:'LONG'}).step({snapshot:snap(100),evidence:ev({score:0.7}),threshold:T,now:0}).state,'WATCH');
});

test('R49 burst-only loss pause: two net losses in 30 min, or -3R net in an Istanbul day; fees count',()=>{
  const NOW=Date.UTC(2026,9,6,9,0,0);
  const row=(min,realizedR,stopPct=0.4)=>({kind:'BURST_CLOSED',symbol:'XUSDT',payload:{closedAt:NOW-min*60000,entryPrice:100,stopPrice:100*(1-stopPct/100),realizedR,mfeR:0}});
  const mk=rows=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'r49-pause-'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'data'));
    return createLiveController({root,store:{journal(){},latestJournal:()=>null,recentJournal:k=>rows.filter(x=>x.kind===k)},scanner:{},pipeline:{},committee:async()=>({}),clock:()=>NOW,fetchImpl:async()=>{throw new Error('offline');}});};
  assert.equal(mk([row(50,-0.3),row(10,-0.2)])._testBurstLossPause().reason,'BURST_TWO_LOSS_PAUSE');
  assert.equal(mk([row(50,-0.3),row(40,-0.2)])._testBurstLossPause(),null,'pause over after 30 min');
  assert.equal(mk([row(50,0.9),row(10,-0.2)])._testBurstLossPause(),null,'one loss only');
  assert.equal(mk([row(60,-0.3),row(20,0.1)])._testBurstLossPause().reason,'BURST_TWO_LOSS_PAUSE','+0.1R gross is a net loss after a 0.25R fee');
  const p=mk([row(300,-1),row(250,-1),row(200,0.6),row(150,-1)])._testBurstLossPause();
  assert.equal(p.reason,'BURST_DAILY_LOSS_CAP');assert.ok(p.dayR<=-3);
});

test('R49 source contract: armed loop enters only via PullbackEntry, burstOpen uses the structural stop, no pre-auth during the pause',()=>{
  const live=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  const tick=live.slice(live.indexOf('async function burstScalpTick'),live.indexOf('function burstStatus'));
  assert.match(tick,/const step=pb\.step\(\{snapshot:chk\.snapshot,evidence:chk\.evidence,threshold:auth\.triggerThreshold,now:clock\(\)\}\);/);
  assert.match(tick,/if\(step\.state!=='ENTER'\)continue;/);assert.match(tick,/burstOpen\(auth,chk\.evidence,step\.entry\)/);
  assert.doesNotMatch(tick,/if\(!chk\.ok\|\|!chk\.trigger\)continue;/,'the old tip entry is gone');
  assert.match(live,/BURST_STRUCTURAL_STOP_INVALID_AT_ORDER/);assert.match(live,/entryModel:plan\?'PULLBACK_RESUME':'IMPULSE_TIP'/);
  const arm=live.slice(live.indexOf('async function burstArmTick'),live.indexOf('async function burstLeverageAndSizing'));
  assert.match(arm,/const blp=burstLossPause\(\);if\(blp\)return skipped\(blp\.reason\);/);
});
