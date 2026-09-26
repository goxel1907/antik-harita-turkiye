'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {capacity}=require('../capacity-accounting');
const {StreamingMarket}=require('../market');
const {performanceReport,summary}=require('../office-performance');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');
test('R2542 position capacity uses distinct open and genuinely pending symbols',()=>{
 assert.equal(capacity({open:['BTCUSDT'],max:2}).blocked,false);
 assert.equal(capacity({open:['BTCUSDT'],pending:[{symbol:'ETHUSDT',state:'SUBMITTING'}],max:2}).full,true);
 assert.equal(capacity({open:['BTCUSDT','BTCUSDT'],pending:[{symbol:'BTCUSDT'},{symbol:'ETHUSDT'},{symbol:'ETHUSDT'}],max:2}).used,2);
 assert.equal(capacity({open:['BTCUSDT'],pending:[{symbol:'ETHUSDT',state:'RESERVED',expiresAt:10}],max:2,now:11}).blocked,false);
 assert.equal(capacity({open:['BTCUSDT'],pending:[{symbol:'ETHUSDT',state:'UNKNOWN',expiresAt:10}],max:2,now:11}).full,true);
 assert.equal(capacity({open:['BTCUSDT'],symbol:'BTCUSDT',max:2}).reason,'SYMBOL_POSITION_ALREADY_OPEN');
 assert.equal(capacity({pending:[{symbol:'UNKNOWN',unavailable:true}],max:2}).reason,'PENDING_STATE_UNAVAILABLE');
 console.log('R2542_CAPACITY_ACCOUNTING_OK');
});

test('ledger reconciles persisted reservations without any exchange writes, including while LIVE is OFF',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2542-pending-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'config'));
 const file=path.join(root,'data','r2542-pending-orders.json');
 fs.writeFileSync(file,JSON.stringify([{symbol:'BTCUSDT',state:'SUBMITTED',clientOrderId:'open'},{symbol:'ETHUSDT',state:'UNKNOWN',clientOrderId:'cancelled'},{symbol:'SOLUSDT',state:'RESERVED',expiresAt:1},{symbol:'BNBUSDT',state:'UNKNOWN',clientOrderId:'unknown'}]));
 const reply=x=>({ok:true,status:200,text:async()=>JSON.stringify(x)});
 const {createLiveController}=require('../live-controller');
 const c=createLiveController({root,credentials:{apiKey:'test-key',apiSecret:'test-secret'},store:{journal(){},recentJournal:()=>[],latestJournal:()=>null},scanner:{},pipeline:{},committee:async()=>({}),fetchImpl:async(url,opts)=>{
   assert.equal(opts.method||'GET','GET');const u=new URL(url);
   if(u.pathname==='/fapi/v1/time')return reply({serverTime:Date.now()});
   if(u.pathname==='/fapi/v3/account')return reply({positions:[{symbol:'BTCUSDT',positionAmt:'1',entryPrice:'100',markPrice:'101',unrealizedProfit:'1'}]});
   if(u.pathname==='/fapi/v1/order'){if(u.searchParams.get('origClientOrderId')==='cancelled')return reply({status:'CANCELED'});throw new Error('timeout');}
   throw new Error('unexpected '+u.pathname);
 }});
 assert.equal(c.status().armed,false);
 const tick=await c.positionLedgerTick();assert.equal(tick.ok,true,JSON.stringify(tick));
 assert.deepEqual(JSON.parse(fs.readFileSync(file)).map(x=>x.symbol),['BNBUSDT']);
 assert.equal(c.leaderAutoStatus().capacity.used,2);
});
test('R2542 80-symbol cache rotates, protects open positions, ignores late evicted packets',()=>{
 let now=0;const sent=[];const stream=new StreamingMarket({WebSocketImpl:null,now:()=>++now});stream.ws={readyState:1,send:x=>sent.push(JSON.parse(x))};
 stream.ensureSymbol('BTCUSDT');stream.protectedSymbols.add('BTCUSDT');
 for(let i=0;i<100;i++)stream.ensureSymbol('COIN'+i+'USDT');
 assert.equal(stream.states.size,80);assert.ok(stream.states.has('BTCUSDT'));assert.ok(stream.states.has('COIN99USDT'));
 assert.equal(stream.ingest({e:'aggTrade',s:'COIN0USDT',p:'1',q:'1'}),false);
 const before=sent.length;stream.ensureSymbol('COIN99USDT');assert.equal(sent.length,before);
 assert.equal(sent.filter(x=>x.method==='UNSUBSCRIBE').length,21);
 stream.shutdown();
});
test('R2542 all-history cohorts preserve legacy versions and unknown R; lane beats timeframe',()=>{
 const closed=Array.from({length:60},(_,i)=>({id:String(i),ts:100,kind:'POSITION_CLOSED',payload:{eventId:'trade'+i,netPnl:i%2?1:-1,rMultiple:i===0?2:null,tradeLane:'15M_TRADE',originTF:'5m',entryContext:{releaseContract:'R2541_ATOMIC_TURKISH_SAFE'}}}));
 const report=performanceReport([...closed,closed[0]],[],100);
 const cohort=report.desks.find(x=>x.desk==='15M_TRADE').cohorts.find(x=>x.version==='R2541_ATOMIC_TURKISH_SAFE');
 assert.equal(cohort.closed,60);assert.equal(cohort.rSamples,1);assert.equal(cohort.avgR,2);assert.equal(cohort.telemetryAvailable,false);
 assert.equal(report.desks[0].cohorts.find(x=>x.version==='R2541_ATOMIC_TURKISH_SAFE').closed,0);
 assert.equal(summary([{netPnl:0,rMultiple:null}]).losses,0);assert.equal(summary([{netPnl:null,rMultiple:null}]).closed,0);
 console.log('R2542_LANE_PERFORMANCE_OK');
});

test('legacy close and its later backfill count once, without relabeling or hiding a distinct entry',()=>{
 const original={id:'original',ts:2000,symbol:'BTCUSDT',kind:'POSITION_CLOSED',payload:{side:'LONG',openedAt:new Date(1000).toISOString(),entryPrice:100,quantity:2,netPnl:10,tradeLane:'5M_SCALP',entryContext:{releaseContract:'R2541_ATOMIC_TURKISH_SAFE'}}};
 const backfill={...original,id:'backfill',payload:{...original.payload,openedAt:new Date(995).toISOString(),entryContext:{},eventId:'old-entry',backfilled:true,netPnl:11}};
 const later={...original,id:'later',payload:{...original.payload,openedAt:new Date(3000).toISOString(),netPnl:-2}};
 const input=[backfill,original,later],before=JSON.stringify(input),r=performanceReport(input);
 assert.equal(r.total.closed,2);assert.equal(r.total.netPnl,8);assert.equal(r.reconciliation.excluded.length,1);
 assert.equal(r.reconciliation.excluded[0].canonicalId,'original');assert.equal(JSON.stringify(input),before);
 assert.equal(r.versions.find(x=>x.version==='R2541_ATOMIC_TURKISH_SAFE').closed,2);
});

test('backfill recognizes a legacy entry before reading income or writing a duplicate',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2542-backfill-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'config'));
 const at=Date.now()-10000;
 const old={kind:'POSITION_CLOSED',symbol:'BTCUSDT',payload:{side:'LONG',openedAt:new Date(at+5).toISOString(),entryPrice:100,quantity:2}};
 const execution={id:'execution',symbol:'BTCUSDT',ts:at,payload:{eventId:'original-entry',result:{orderPlaced:true,side:'LONG',executedQty:2,livePrice:100}}};
 const reply=x=>({ok:true,status:200,text:async()=>JSON.stringify(x)});let writes=0;
 const {createLiveController}=require('../live-controller');
 const c=createLiveController({root,credentials:{apiKey:'test-key',apiSecret:'test-secret'},store:{journal(){writes++},officeRecords:()=>[old],recentJournal:k=>k==='LIVE_EXECUTION'?[execution]:[]},scanner:{},pipeline:{},committee:async()=>({}),fetchImpl:async(url,opts)=>{
  assert.equal(opts.method||'GET','GET');const p=new URL(url).pathname;
  if(p==='/fapi/v1/time')return reply({serverTime:Date.now()});
  if(p==='/fapi/v3/account')return reply({positions:[]});
  throw new Error('unexpected income/order call '+p);
 }});
 const r=await c.backfillClosedOutcomes();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.written,0);assert.equal(writes,0);
});
test('R2542 funnel counts correlated stages once and never calls intent-built safety-passed',()=>{
 const event=(kind,stage)=>({id:kind+stage,ts:100,kind:'R2542_OFFICE_EVENT',payload:{kind,stage,decisionId:'one',tradeLaneName:'5M_SCALP',releaseContract:'R2542_JEV_TRADER_OFFICE'}});
 const rows=[event('JEV_FINAL_AUTHORITY','APPROVED'),event('EXECUTION_STAGE','INTENT_READY'),event('JEV_FINAL_AUTHORITY','HARD_SAFETY_READY'),event('EXECUTION_STAGE','ORDER_PLACED'),event('JEV_FINAL_AUTHORITY','ORDER_PLACED')];
 const f=performanceReport(rows,[],100).funnel;assert.equal(f.approved,1);assert.equal(f.safetyPassed,1);assert.equal(f.orders,1);assert.equal(f.decisionToOrderPct,100);
 assert.equal(performanceReport([event('EXECUTION_STAGE','INTENT_READY')],[],100).funnel.safetyPassed,0);
 console.log('R2542_TRADER_OFFICE_RECONCILIATION_OK');
});
test('optional free-worker circuit honors daily 429 reset, allows half-open, never paid fallback',async()=>{
 let now=100,calls=0;const worker=createOpenRouterFreeWorker({apiKey:'sk-or-v1-test',model:'paid/model',clock:()=>now,fetchImpl:async(url,opts)=>{calls++;assert.equal(JSON.parse(opts.body).model,'openrouter/free');return {ok:false,status:429,text:async()=>JSON.stringify({error:{metadata:{headers:{'X-RateLimit-Reset':'1000000'}}}})};}});
 const failed=await worker.review();assert.equal(failed.blocksJev,false);assert.equal(failed.ok,false);
 const skipped=await worker.review();assert.equal(skipped.called,false);assert.equal(calls,1);
 now=1000001;await worker.review();assert.equal(calls,2);
});

test('JEV WAIT plus MARKET_NOW is reconciled without fabricating a market reason',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {createJevClient}=require('../jev-decision');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2542-wait-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,mode:'SOVEREIGN_DIRECTOR_5M15M',dailyCapUsd:5}));
 const choices={trade_plan:'WAIT',setup_family:'NONE_WAIT',entry_timing:'MARKET_NOW',wait_reason:'NONE_MARKET_NOW',edge_basis:'PATTERN_PRICE_ACTION',management_style:'PARTIALS_RUNNER',target_profile:'BALANCED',partial_profile:'THIRDS',breakeven_rule:'AFTER_TP1',trail_rule:'JEV_DYNAMIC'};
 const client=createJevClient({root,apiKey:'sk-or-v1-test_key_12345678901234567890',fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({answers:Object.fromEntries(Object.entries(choices).map(([k,choice])=>[k,{choice}]))})})});
 const out=await client.sovereignFinal({candidate:{symbol:'BTCUSDT'},unified:{},evidence:{},planOptions:[]});
 assert.equal(out.ok,true);assert.equal(out.action,'WAIT');assert.equal(out.entryTiming,'WAIT_UNSPECIFIED');assert.equal(out.waitReason,'UNSPECIFIED');
});

test('SQLite office report survives reopen and never truncates to the latest forty closes',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {openStore}=require('../store');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2542-ledger-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let s=openStore(root);for(let i=0;i<65;i++)s.journal('POSITION_CLOSED','BTCUSDT',{eventId:String(i),netPnl:1,rMultiple:null,tradeLane:'5M_SCALP'});s.db.close();s=openStore(root);
 assert.equal(performanceReport(s.officeRecords()).total.closed,65);s.db.close();
});

test('optional evidence failure reaches the sovereign final decision; identical WAIT evidence is deduplicated',async t=>{
 const market=require('../market');const original={symbolContext:market.symbolContext,globalContext:market.globalContext,chartContext:market.chartContext,renderChartPng:market.renderChartPng};
 const now=Date.now(),frame={available:true,asOf:now,close:100,trend:'UP',rsi14:55,atrPct:1,prior20High:102,prior20Low:98,candle:{},patterns:[],swingStructure:{state:'BULLISH'},liquidity:{},smcContext:{}};
 market.symbolContext=async()=>({symbol:'TESTUSDT',timeframes:Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf=>[tf,frame])),microstructure:{available:true,bid:99.99,ask:100.01},generatedAt:new Date(now).toISOString()});
 market.globalContext=async()=>({});market.chartContext=async()=>({candles:[],bars:100});market.renderChartPng=()=>Buffer.from('test-only');
 const modulePath=require.resolve('../pipeline');const previous=require.cache[modulePath];delete require.cache[modulePath];const {runSovereignFlow}=require('../pipeline');
 t.after(()=>{Object.assign(market,original);if(previous)require.cache[modulePath]=previous;else delete require.cache[modulePath];});
 let finalCalls=0;const journals=[];
 const args={scan:{leaders:[{symbol:'TESTUSDT',side:'LONG'}]},executionIntent:{symbol:'TESTUSDT'},store:{journal:(...x)=>journals.push(x)},committee:async()=>{throw new Error('HTTP 429 optional evidence unavailable');},decisionPass1:async()=>({ok:true,called:true,laneFocus:'5M_SCALP',requestedEvidence:['TRADINGVIEW_5M']}),decisionFinal:async({evidence})=>{finalCalls++;assert.match(evidence.visual.error,/429/);return {ok:true,called:true,action:'WAIT',entryTiming:'WAIT_PULLBACK',waitReason:'LOCATION_POOR'};}};
 const first=await runSovereignFlow(args);assert.equal(first.jevDecision.action,'WAIT');assert.equal(finalCalls,1);assert.equal(first.orderPlaced,false);
 const second=await runSovereignFlow(args);assert.equal(second.analysisSkipped,true);assert.equal(finalCalls,1);
 frame.close=101;await runSovereignFlow(args);assert.equal(finalCalls,2);
});
