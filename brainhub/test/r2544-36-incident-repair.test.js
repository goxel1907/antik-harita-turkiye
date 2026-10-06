'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createReviewScheduler}=require('../review-scheduler');
const {profitGiveback}=require('../outcome-metrics');
const {learningQuality}=require('../learning-quality');
const {lessonCard}=require('../trade-lessons');
const {openStore}=require('../store');
const {performanceReport}=require('../office-performance');
const {createProfitBudget}=require('../profit-budget');
const {BinanceLiveTransport}=require('../binance-live-transport');
const {BurstScalpManager,burstEvidence}=require('../burst-scalp');
const {buildPreEntryAdverseSelection}=require('../preentry-microstructure');

test('R36 urgent review bypasses background silence and retries a busy pipeline without overlapping',async()=>{
 let now=1000,calls=0,release;const s=createReviewScheduler({clock:()=>now});
 const review=async o=>{calls++;assert.equal(o.urgentOnly,true);if(calls===1)return {ok:true,skipped:true,reason:'VISION_PIPELINE_BUSY'};await new Promise(r=>release=r);return {ok:true};};
 await s.tick({pending:true,backgroundReady:false,review});
 now+=1000;await s.tick({pending:true,review});assert.equal(calls,1);
 now+=4000;const running=s.tick({pending:true,review});
 now+=6000;assert.equal((await s.tick({pending:true,review})).reason,'POSITION_REVIEW_SCHEDULER_BUSY');
 release();await running;assert.equal(calls,2);
});
test('R36 normal review retains one-minute scheduler cadence and background requirement',async()=>{
 let now=1000,calls=0;const s=createReviewScheduler({clock:()=>now}),review=async o=>{assert.equal(o.urgentOnly,false);calls++;return {ok:true};};
 await s.tick({review,backgroundReady:false});assert.equal(calls,0);
 await s.tick({review,backgroundReady:true});now+=59000;await s.tick({review,backgroundReady:true});assert.equal(calls,1);
 now+=1000;await s.tick({review,backgroundReady:true});assert.equal(calls,2);
});
test('R36 STRK negative observed MFE is not profit giveback and legacy interpretation leaves raw history intact',()=>{
 const raw={symbol:'STRKUSDT',side:'LONG',netPnl:-2.77724809,rMultiple:-1.535567,riskQuote:1.808614,initialQuantity:6236.6,riskBasis:'LIFECYCLE_PLANNED_RISK',holdMinutes:2,outcomePath:{mfeR:-.0667,maeR:-.9844,mfeGivebackR:1.4689}};
 const before=JSON.stringify(raw),p=learningQuality(raw),card=lessonCard(p);
 assert.equal(p.outcomePath.mfeGivebackR,0);assert.equal(card.outcome.mfeGivebackR,0);assert.ok(!card.tags.includes('MFE_GIVEBACK_GE_1R'));assert.equal(JSON.stringify(raw),before);
 assert.equal(profitGiveback(null,-1),null);assert.equal(profitGiveback(0,-1),0);assert.equal(profitGiveback(1.5,.5),1);
});
test('R36 enriched journal and soft learner exclude the same remaining-quantity backfill',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r36-close-')),s=openStore(root);t.after(()=>s.db.close());
 const at=Date.parse('2026-10-04T12:00:00Z'),close={symbol:'ABCUSDT',side:'LONG',openedAt:new Date(at).toISOString(),closedAt:new Date(at+60000).toISOString(),entryPrice:100,stopPrice:99,quantity:0,netPnl:10,rMultiple:0,outcomePct:.1};
 s.db.prepare('INSERT INTO journal(id,ts,kind,symbol,payload) VALUES(?,?,?,?,?)').run('entry',at,'LIVE_EXECUTION','ABCUSDT',JSON.stringify({eventId:'e1',plan:{stopPrice:99},result:{orderPlaced:true,side:'LONG',executedQty:10}}));
 s.journal('POSITION_CLOSED','ABCUSDT',{...close,eventId:'e1'},'c1');s.journal('POSITION_CLOSED','ABCUSDT',{...close,quantity:10,backfilled:true},'c2');
 s.recordLearning('POSITION_CLOSED','ABCUSDT',{...close,eventId:'e1'});s.recordLearning('POSITION_CLOSED','ABCUSDT',{...close,quantity:10,backfilled:true});
 const records=s.db.prepare('SELECT id,ts,kind,symbol,payload FROM journal').all().map(x=>({...x,payload:JSON.parse(x.payload)}));
 assert.equal(performanceReport(records).total.closed,1);assert.equal(s.tradeLessons().total,1);
 const l=s.learningContext();assert.equal(l.measuredSampleCount,1);assert.equal(l.excludedDuplicateCloses,1);
});
test('R36 full exit cancels TP reservations but keeps original stop installed; cancellation uncertainty blocks transmission',async()=>{
 for(const cancelOk of [true,false]){
  const calls=[],row={symbol:'ABCUSDT',side:'LONG',tpAlgoIds:[11,12],originalStopAlgoId:10};
  const p=createProfitBudget({transport:{cancelAlgoOrder:async x=>{calls.push(['cancel',x.algoId]);return {ok:cancelOk};},reducePositionMarket:async x=>{calls.push(['market',x.fraction]);return {ok:true};}}});
  const r=await p.close({row,reason:'GUARD_FAST_FAIL'});assert.equal(r.ok,cancelOk);assert.ok(!calls.some(x=>x[1]===10));assert.equal(calls.filter(x=>x[0]==='market').length,cancelOk?1:0);
 }
});
function reducingTransport({flat=false,unknown=false,code=-2022}={}){
 let riskReads=0,posts=0;const t=new BinanceLiveTransport({registry:{consume(){throw Error('entry forbidden');}},fetchImpl:async()=>{throw Error('network forbidden');}});
 t._syncServerTime=async()=>{};
 t._fetchJson=async(method,url)=>{
  if(url.endsWith('/dual'))return {dualSidePosition:false};
  if(url.endsWith('/positionRisk')){riskReads++;return unknown&&riskReads>1?[]:[{symbol:'ABCUSDT',positionSide:'BOTH',positionAmt:flat&&riskReads>1?'0':'10'}];}
  if(url.endsWith('/exchangeInfo'))return {symbols:[{symbol:'ABCUSDT',filters:[{filterType:'MARKET_LOT_SIZE',stepSize:'1',minQty:'1'}]}]};
  if(method==='POST'){posts++;throw Object.assign(Error('BINANCE_HTTP_400'),{body:{code,msg:'ReduceOnly Order is rejected.'}});}
  throw Error('unexpected route');
 };return {t,posts:()=>posts};
}
test('R36 rejected reduce-only order only reports flat after actual positionRisk confirmation and never claims its own fill',async()=>{
 for(const opts of [{flat:true},{flat:false},{flat:true,unknown:true},{flat:true,code:-1003}]){
  const {t,posts}=reducingTransport(opts),r=await t.reducePositionMarket({symbol:'ABCUSDT',side:'LONG',credentials:{apiKey:'fake',apiSecret:'fake'}});
  assert.equal(r.orderPlaced,false);assert.equal(r.ok,false);assert.equal(r.fullyClosed===true,opts.flat===true&&!opts.unknown&&opts.code!==-1003);assert.equal(posts(),1);assert.equal(r.exchangeError.code,opts.code??-2022);
 }
});
function burstSnap(){return {available:true,ageMs:100,spreadBps:1,orderFlow:{windows:{'1s':{buyRatio:.78,sellRatio:.22,buyQuote:8000,sellQuote:2000,priceMoveBps:5},'3s':{buyRatio:.72,sellRatio:.28,buyQuote:18000,sellQuote:7000,priceMoveBps:10},'5s':{buyRatio:.68,sellRatio:.32}}},level1Ofi:{windows:{'1s':{normalizedOfi:.65,queueImbalanceCurrent:.4,micropriceBps:.8},'3s':{normalizedOfi:.55}}},localL2:{available:true,sequenceHealthy:true,confidence:.9,multiLevelOfi:.5,depthImbalance:.45}};}
test('R36 JEV .82 conditional trigger is honored without hidden .90 floor, freshness/L2 protection still applies',()=>{
 const snap=burstSnap(),m=new BurstScalpManager({now:()=>1000,marketStream:{ensureSymbol(){},ensureLocalL2(){},snapshot:()=>snap}});
 m.arm({symbol:'ABCUSDT',side:'LONG',triggerThreshold:.82,preMove:{state:'PRE_MOVE',direction:'LONG'}});
 const e=burstEvidence(snap,'LONG',{preMove:{state:'PRE_MOVE',direction:'LONG'}});assert.ok(e.score>=.82&&e.score<.9,e.score);
 assert.equal(m.evaluateArmed('ABCUSDT').trigger,true);snap.localL2.sequenceHealthy=false;assert.equal(m.evaluateArmed('ABCUSDT').trigger,false);
});
test('R36 directional mass is preserved when weak adverse signals outweigh a small strong supportive component',()=>{
 const w={trades:100,coverageMs:60000,buyRatio:.3,sellRatio:.7,buyQuote:300,sellQuote:700,priceMoveBps:-3};
 const x=buildPreEntryAdverseSelection({streaming:{available:true,ageMs:100,cvdCoverageMs:120000,cvdTrades120s:100,depthSoftContext:{micropriceBps:4},orderFlow:{windows:{'5s':w,'15s':w,'30s':w,'60s':w,'120s':w}}}});
 assert.ok(x.long.supportIndex+x.long.trapRiskIndex<=1.001);assert.ok(x.long.riskWeightShare>x.long.supportWeightShare);assert.notEqual(x.long.state,'CONTINUATION_SUPPORT_STRONG');
});

test('R36 urgent controller review refreshes the position after collection, preserves a newer request, and retries failed JEV calls',async()=>{
 const {createLiveController}=require('../live-controller');
 for(const judgeOk of [true,false]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r36-review-')),state={now:1000000,reads:0},events=[];
  const reply=x=>({ok:true,status:200,text:async()=>JSON.stringify(x)});
  const controller=createLiveController({root,clock:()=>state.now,credentials:{apiKey:'test-api-key',apiSecret:'test-api-secret'},
   store:{journal:(k,s,p)=>events.push({k,s,p})},scanner:{scan:async()=>({})},committee:async()=>({}),
   fetchImpl:async url=>{const u=new URL(url);if(u.pathname==='/fapi/v1/time')return reply({serverTime:state.now});if(u.pathname.endsWith('/positionRisk')){state.reads++;return reply([{symbol:'ABCUSDT',positionSide:'BOTH',positionAmt:'10',entryPrice:'100',markPrice:state.reads===1?'99':'98',liquidationPrice:'80'}]);}throw Error('unexpected '+u.pathname);},
   pipeline:{run:async()=>{state.now+=2000;controller._testState().runnerState.bySymbol.ABCUSDT.urgentReviewRequestedAt=state.now;return {plan:{},unifiedContext:{frames:{}}};}},
   exitJudge:async({position})=>{assert.equal(position.markPrice,98,'fresh account mark supplied');return {ok:judgeOk,called:true,finalAuthority:true,action:'HOLD'};}});
  const row={symbol:'ABCUSDT',side:'LONG',phase:'INITIAL',entryPrice:100,originalStopPrice:98,initialQty:10,urgentReviewRequestedAt:999000,urgentReviewConsumedAt:0};
  controller._testState().runnerState.bySymbol.ABCUSDT=row;
  const result=await controller.activePositionReviewTick({urgentOnly:true});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(state.reads,2);
  assert.equal(row.urgentReviewConsumedAt,judgeOk?999000:0);assert.equal(controller.hasPendingUrgentReview(),true,'newer or failed request remains pending');
  assert.ok(events.some(e=>e.k==='POSITION_REVIEW'));
 }
});

test('R36 burst candidates subscribe before JEV review and preserve refusal evidence as soft context, never PnL',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r36-burst-')),calls=[],rows=[],lessons=[];
 fs.mkdirSync(path.join(root,'config'),{recursive:true});
 fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:true,marginQuote:35,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true,burstLiveEnabled:true}));
 const stream={ensureSymbol:s=>calls.push('symbol'),ensureLocalL2:s=>calls.push('l2'),snapshot:s=>{assert.deepEqual(calls.slice(0,2),['symbol','l2']);calls.push('snapshot');return burstSnap();}};
 const {createLiveController}=require('../live-controller');
 const c=createLiveController({root,credentials:{apiKey:'test-api-key',apiSecret:'test-api-secret'},fetchImpl:async()=>{throw Error('network forbidden');},clock:()=>1000000,
  store:{journal:(kind,symbol,payload)=>rows.push({kind,symbol,payload}),recordLearning:(k,s,p)=>lessons.push(p),recentJournal:()=>rows,learningContext:()=>({})},
  scanner:{scan:async()=>({nearExplosionCandidates:[{symbol:'ABCUSDT',preMove:{state:'PRE_MOVE',direction:'LONG'}}]})},pipeline:{run:async()=>{throw Error('unused');}},committee:async()=>({}),
  market:{marketStream:stream,cachedChartContext:()=>({available:true,asOf:999900,ageMs:100})},
  burstJudge:async()=>{assert.deepEqual(calls,['symbol','l2','snapshot','snapshot']);return {ok:true,called:true,decision:'DO_NOT_ARM',reason:'LOCATION_ADVERSE'};}});
 const r=await c.burstArmTick();assert.equal(r.checked,1,JSON.stringify(r));assert.equal(rows[0].payload.l2Ready,true);
 assert.equal(lessons[0].measurement,'DECISION_TRACE_NOT_TRADE_OUTCOME');assert.equal(lessons[0].netPnl,undefined);
 const status=c.burstStatus();assert.equal(status.diagnostics.called,1);assert.equal(status.diagnostics.authorized,0);assert.equal(status.diagnostics.reasons.LOCATION_ADVERSE,1);assert.equal(status.separateOtherSymbolSlot,true);
});
