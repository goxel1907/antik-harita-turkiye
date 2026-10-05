'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {matchFinalExit,readCloseExitEvidence,exitCorrectionFor}=require('../close-exit-evidence');
const {freshAttention,pickFreshAttention,coverageState}=require('../attention-priority');
const {enrichCloses,performanceReport}=require('../office-performance');
const {openStore}=require('../store');
const {exitAuthorityOf}=require('../trade-lessons');
const {derive}=require('../office-dashboard/office-server');
const start=Date.parse('2026-10-05T02:00:00Z'),end=start+60000;
const row={id:'C1',eventId:'E1',symbol:'ABCUSDT',side:'LONG',openedAt:new Date(start).toISOString(),closedAt:new Date(end).toISOString(),netPnl:7.87,exitType:'EXTERNAL_CLOSE'};
const fill={symbol:row.symbol,side:'SELL',positionSide:'BOTH',qty:'10',time:end-1000,orderId:123,id:7};
const order={symbol:row.symbol,side:'SELL',positionSide:'BOTH',status:'FILLED',type:'MARKET',orderId:123};
const algo={symbol:row.symbol,side:'SELL',positionSide:'BOTH',actualOrderId:'123',algoId:'901',orderType:'STOP_MARKET'};
function correction(evidence,changes={}){return {id:'X1',ts:end+1000,kind:'CLOSE_EXIT_EVIDENCE',symbol:row.symbol,payload:{closedId:row.id,eventId:row.eventId,openedAt:row.openedAt,closedAt:row.closedAt,evidence,...changes}};}
test('R40 final stop fill wins over a prior partial TP and profit never determines the exit type',()=>{
 const earlier={...fill,time:start+1000,orderId:100,id:1};
 const r=matchFinalExit(row,[earlier,fill],order,[{...algo,actualOrderId:100,orderType:'TAKE_PROFIT_MARKET'},algo]);
 assert.equal(r.exitType,'STOP_LOSS');assert.equal(r.confirmed,true);assert.equal(r.orderId,'123');assert.equal(r.algoId,'901');
 assert.equal(matchFinalExit({...row,netPnl:-999},[fill],order,[algo]).exitType,'STOP_LOSS');
});
test('R40 automatic TP, trailing and old standard conditional order types are distinguished',()=>{
 for(const [type,exit] of [['TAKE_PROFIT_MARKET','TAKE_PROFIT'],['TRAILING_STOP_MARKET','TRAILING_STOP'],['STOP','STOP_LOSS']])assert.equal(matchFinalExit(row,[fill],order,[{...algo,orderType:type}]).exitType,exit);
 assert.equal(matchFinalExit(row,[fill],{...order,origType:'STOP_MARKET'},[]).exitType,'STOP_LOSS');
 const short={...row,side:'SHORT'};
 assert.equal(matchFinalExit(short,[{...fill,side:'BUY',positionSide:'SHORT'}],{...order,side:'BUY',positionSide:'SHORT'},[{...algo,side:'BUY',positionSide:'SHORT'}]).confirmed,true);
});
test('R40 MARKET order alone cannot prove a manual user close',()=>{
 const r=matchFinalExit(row,[fill],order,[]);assert.equal(r.exitType,'UNKNOWN_CLOSE');assert.equal(r.confirmed,false);assert.equal(r.reason,'NON_CONDITIONAL_FINAL_ORDER');
});
test('R40 wrong hedge leg, symbol, order ID and unfilled ACK cannot become stop evidence',()=>{
 for(const patch of [{symbol:'OTHERUSDT'},{side:'BUY'},{orderId:999},{status:'NEW'},{positionSide:'SHORT'}])assert.equal(matchFinalExit(row,[fill],{...order,...patch},[algo]).confirmed,false);
 assert.equal(matchFinalExit(row,[{...fill,positionSide:'SHORT'}],order,[algo]).confirmed,false);
 for(const patch of [{symbol:'OTHERUSDT'},{side:'BUY'},{actualOrderId:999},{positionSide:'SHORT'}])assert.equal(matchFinalExit(row,[fill],order,[{...algo,...patch}]).confirmed,false);
});
test('R40 truncated or ambiguous history remains unknown instead of selecting a convenient order',()=>{
 assert.equal(matchFinalExit(row,Array(1000).fill(fill),order,[algo]).confirmed,false);
 assert.equal(matchFinalExit(row,[fill],order,Array(1000).fill(algo)).confirmed,false);
 assert.equal(matchFinalExit(row,[fill,{...fill,orderId:124,id:8}],order,[algo]).reason,'AMBIGUOUS_FINAL_FILL');
 assert.equal(matchFinalExit(row,[fill],order,[algo,{...algo,algoId:902}]).reason,'AMBIGUOUS_ALGO_LINK');
 assert.equal(matchFinalExit(row,[{...fill,time:end+1}],order,[algo]).confirmed,false);
});
test('R40 exchange reporting is bounded to three signed GET reads and yields between reads',async()=>{
 const calls=[],replies=[[fill],order,[algo]],t={_fetchJson:async(...args)=>{calls.push(args);return replies[calls.length-1];}};
 assert.equal((await readCloseExitEvidence(t,row,{})).confirmed,true);
 assert.deepEqual(calls.map(x=>x[0]),['GET','GET','GET']);assert.equal(calls[0][2].params.limit,1000);assert.ok(calls.every(x=>x[2].signed));
 calls.length=0;assert.equal((await readCloseExitEvidence(t,row,{},()=>calls.length<1)).reason,'REPORTING_DEFERRED');assert.equal(calls.length,1);
 const bad={_fetchJson:async()=>{throw Object.assign(Error('sensitive'),{code:'BINANCE_HTTP_429'});}};
 const r=await readCloseExitEvidence(bad,row,{});assert.equal(r.confirmed,false);assert.equal(r.errorCode,'BINANCE_HTTP_429');assert.equal(JSON.stringify(r).includes('sensitive'),false);
 calls.length=0;assert.equal((await readCloseExitEvidence(t,{...row,openedAt:new Date(end-7*86400000).toISOString()},{})).reason,'WINDOW_UNAVAILABLE');assert.equal(calls.length,0);
});
test('R40 evidence overlays preserve original closures and PnL without needing an entry journal',()=>{
 const raw=structuredClone(row),e=correction(matchFinalExit(row,[fill],order,[algo]));
 const [fixed]=enrichCloses([row],[e]);assert.equal(fixed.exitType,'STOP_LOSS');assert.equal(fixed.netPnl,7.87);assert.equal(fixed.rawExitType,'EXTERNAL_CLOSE');assert.deepEqual(row,raw);
 assert.equal(enrichCloses([row],[correction({confirmed:false,exitType:'UNKNOWN_CLOSE'})])[0].exitType,'UNKNOWN_CLOSE');
 assert.equal(enrichCloses([{...row,exitType:'USER_MANUAL'}],[e])[0].exitType,'USER_MANUAL');
 const records=[{id:row.id,ts:end,kind:'POSITION_CLOSED',symbol:row.symbol,payload:row},e];assert.equal(performanceReport(records,[],end).total.closed,1);assert.equal(performanceReport(records,[],end).total.netPnl,7.87);
});
test('R40 correction for an earlier same-symbol position cannot contaminate a subsequent close',()=>{
 const e=correction({confirmed:true,exitType:'STOP_LOSS'});
 assert.equal(exitCorrectionFor({...row,id:'C2',eventId:'E2'},[e]),null);
 assert.equal(exitCorrectionFor({...row,closedAt:new Date(end+1000).toISOString()},[e]),null);
 assert.equal(exitCorrectionFor({...row,symbol:'OTHERUSDT'},[e]),null);
});
test('R40 appended exchange evidence invalidates SQLite learning caches without rewriting history',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r40-learning-')),s=openStore(root);
 try{
  const cid=s.journal('POSITION_CLOSED',row.symbol,{...row,entryPrice:1,quantity:10,riskQuote:10});
  s.recordLearning('POSITION_CLOSED',row.symbol,{...row,entryPrice:1,quantity:10,riskQuote:10});
  const before=s.tradeLessons().cards;assert.equal(before.length,1);assert.equal(before[0].exitAuthority,'EXTERNAL');
  s.journal('CLOSE_EXIT_EVIDENCE',row.symbol,{closedId:cid,eventId:row.eventId,openedAt:row.openedAt,closedAt:row.closedAt,evidence:matchFinalExit(row,[fill],order,[algo])});
  const after=s.tradeLessons().cards;assert.equal(after.length,1);assert.equal(after[0].exitAuthority,'SYSTEM');
  assert.equal(s.learningContext().measuredOutcomes[0].exitType,'STOP_LOSS');
  const raw=s.officeRecords().find(x=>x.kind==='POSITION_CLOSED');assert.equal(raw.payload.exitType,'EXTERNAL_CLOSE');assert.equal(raw.payload.netPnl,7.87);
  assert.equal(exitAuthorityOf('UNKNOWN_CLOSE'),'UNKNOWN');assert.equal(exitAuthorityOf('TRAILING_STOP'),'SYSTEM');
 }finally{s.db.close();fs.rmSync(root,{recursive:true,force:true});}
});
const candidates=Array.from({length:24},(_,i)=>({symbol:'C'+i+'USDT'}));
test('R40 priority and fairness share analysis/failed-attempt cooldowns across 24 candidates',()=>{
 const now=10000000,attempts=new Map(),seen=new Map(),history={};let picks=[];
 for(let i=0;i<24;i++){const p=pickFreshAttention(candidates,{now,history,attempts,seen,cooldownMs:300000},i%3!==2);assert.ok(p.candidate);picks.push(p.candidate.symbol);attempts.set(p.candidate.symbol,now);}
 assert.equal(new Set(picks).size,24);assert.equal(pickFreshAttention(candidates,{now,attempts,cooldownMs:300000}).candidate,null);
 assert.equal(freshAttention(candidates,{now:now+60000,attempts,cooldownMs:60000}).length,24);
 seen.set('JEVATTN|C0USDT',now+60000);assert.equal(freshAttention(candidates,{now:now+60000,attempts,seen,cooldownMs:60000}).some(x=>x.candidate.symbol==='C0USDT'),false);
});
test('R40 radar order keeps two turns; every third turn chooses the least recently examined',()=>{
 const now=10000000,history={C0USDT:{lastAnalyzedAt:now-300001},C1USDT:{lastAnalyzedAt:now-900000}};
 const pool=candidates.slice(0,2);
 assert.equal(pickFreshAttention(pool,{now,history,cooldownMs:300000},true).candidate.symbol,'C0USDT');
 assert.equal(pickFreshAttention(pool,{now,history,cooldownMs:300000},false).candidate.symbol,'C1USDT');
 history.C1USDT.lastWorkerCheckAt=now;assert.equal(pickFreshAttention(pool,{now,history,cooldownMs:300000},false).candidate.symbol,'C1USDT');
});
test('R40 never-examined waiting candidates age from entering the shortlist; attempts and completion differ',()=>{
 const now=10000000,first=new Map(candidates.map(c=>[c.symbol,now-601000]));
 let c=coverageState(candidates,{},new Map(),now,first);assert.equal(c.targetCount,24);assert.equal(c.staleCount,24);assert.equal(c.oldestStaleMs,601000);
 c=coverageState(candidates,{},new Map(candidates.map(x=>[x.symbol,now])),now,first);assert.equal(c.staleCount,0);assert.equal(c.neverAnalyzed,24);assert.equal(c.neverAttempted,0);
});
test('R40 Office repeat ratio alone is informational; real shortlist delay remains a warning',()=>{
 const snap={status:{ok:true,data:{armed:true,featureVersion:'9.5.113-CLAUDE-VISION',leaderAuto:{enabled:true,health:{deepAnalyses:154,uniqueAnalyzedSymbols:58}}}}};
 let b=derive(snap).blockers;assert.equal(b.some(x=>x.code==='COVERAGE'),false);assert.equal(b.find(x=>x.code==='REANALYSIS').level,'info');
 snap.status.data.leaderAuto.health.coverage={targetCount:24,staleCount:2,oldestStaleMs:660000};
 b=derive(snap).blockers;assert.equal(b.find(x=>x.code==='COVERAGE').level,'warning');
});
test('R40 optional reporting route weights use 11 units for one full reconciliation',()=>{
 const {endpointWeight}=require('../binance-rate-limit');
 assert.equal(endpointWeight('/fapi/v1/userTrades'),5);assert.equal(endpointWeight('/fapi/v1/allAlgoOrders'),5);assert.equal(endpointWeight('/fapi/v1/order'),1);
});
test('R40 controller backfills at most one close per minute and skips reporting with open positions',async()=>{
 const {createLiveController}=require('../live-controller');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r40-ledger-')),calls=[],events=[];
 let now=end+10000,open=false;
 const store={journal:(kind,symbol,payload)=>{events.push({id:'X'+events.length,ts:now,kind,symbol,payload});},officeRecords:()=>[{id:row.id,ts:end,kind:'POSITION_CLOSED',symbol:row.symbol,payload:row},...events]};
 const fetchImpl=async(url,opts)=>{
  const u=new URL(url);calls.push({path:u.pathname,method:opts.method});
  const bodies={'/fapi/v1/time':{serverTime:now},'/fapi/v3/positionRisk':open?[{symbol:'OPENUSDT',positionAmt:'1',entryPrice:'1',markPrice:'1'}]:[],
    '/fapi/v1/userTrades':[fill],'/fapi/v1/order':order,'/fapi/v1/allAlgoOrders':[algo]};
  if(!(u.pathname in bodies))throw Error('UNEXPECTED_FIXTURE_ROUTE '+u.pathname);
  return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(bodies[u.pathname])};
 };
 try{
  const c=createLiveController({root,store,clock:()=>now,scanner:{},pipeline:{},market:{},committee:async()=>({}),credentials:{apiKey:'fixture-only-key',apiSecret:'fixture-only-secret'},fetchImpl});
  open=true;const a=await c.positionLedgerTick();assert.equal(a.ok,true,JSON.stringify(a));assert.equal(calls.some(x=>x.path==='/fapi/v1/userTrades'),false);
  open=false;const b=await c.positionLedgerTick();assert.equal(b.ok,true,JSON.stringify(b));assert.equal(events.filter(x=>x.kind==='CLOSE_EXIT_EVIDENCE').length,1);assert.equal(events.find(x=>x.kind==='CLOSE_EXIT_EVIDENCE').payload.evidence.exitType,'STOP_LOSS');
  now+=1000;await c.positionLedgerTick();assert.equal(events.filter(x=>x.kind==='CLOSE_EXIT_EVIDENCE').length,1);assert.equal(calls.filter(x=>x.path==='/fapi/v1/userTrades').length,1);
  assert.ok(calls.every(x=>x.method==='GET'));assert.equal(c.status().armed,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
