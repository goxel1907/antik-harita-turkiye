'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const J=require('../jev-decision');
const {mobilePositions}=require('../mobile-positions');
const {BurstScalpManager}=require('../burst-scalp');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');
const {createLiveController}=require('../live-controller');
const os=require('node:os');
const memory=()=>({measuredSampleCount:177,lifetime:{samples:177,netPnl:-10,narrative:'memory '.repeat(1400)},tradeLessons:{samples:177,current:{LONG:[4,50,-2],SHORT:[3,33,-4]}},caseMemory:{available:true,counterexamples:{winnerCount:2,loserCount:2},analogs:[{netPnl:1,eventId:'winner'},{netPnl:-1,eventId:'loser'}]},caseMemoryByLane:Object.fromEntries(['LONG_5M_SCALP','SHORT_5M_SCALP','LONG_15M_TRADE','SHORT_15M_TRADE'].map(k=>[k,{samples:3,summary:{netPnl:1}}]))});
test('R2544.30 PASS1 near-40k protected packet keeps four lane outcomes under hard ceiling',()=>{
 const core={symbol:'TESTUSDT',coreFrames:{},microstructure:{immutable:'X'.repeat(39500)}};
 const input={model:'test',state:{coreMarketPacket:core,experienceMemory:memory(),professionalTraderCortex:{reference:'## Decision doctrine\n'+('Measured soft context. '.repeat(240))}},questions:{lane_focus:{type:'choice',criteria:{BOTH:'Evidence routing, no order authority.'}}}};
 const before=JSON.stringify(input),out=J.prepareDecisionRequest(input);
 assert.ok(out.diagnostics.beforeBytes>48000);assert.equal(out.ok,true,JSON.stringify(out.diagnostics));assert.ok(out.diagnostics.bytes<=48000);
 assert.deepEqual(J.protectedCoreTruth(out.body),J.protectedCoreTruth(input));assert.equal(JSON.stringify(input),before);
 assert.deepEqual(out.body.state.experienceMemory.tradeLessons.current,input.state.experienceMemory.tradeLessons.current);
 assert.equal(Object.keys(out.body.state.experienceMemory.caseMemoryByLane).length,4);
});
test('R2544.30 position management keeps questions, price, quantity, lifecycle and partial contract',()=>{
 const record={contract:'R2.5.3.2_JEV_SOVEREIGN_POSITION_MANAGEMENT',position:{symbol:'TESTUSDT',side:'SHORT',quantity:1234,entryPrice:100,markPrice:99},lifecycle:{stop:102,tp1:98},managementContract:{minimumProgressR:1,maxReviewPartials:2},frames:{'5m':{close:.00259},'15m':{close:.00258}},orderFlow:{immutable:'X'.repeat(32000)},performanceState:{priceProgressR:-.4,remainingFraction:1},entryThesis:{why:'Original thesis'}};
 const input={model:'test',state:{record,description:'Position authority. '.repeat(135),experienceMemory:memory(),professionalTraderCortex:{reference:'## Risk and position management\n'+('Risk reference. '.repeat(450))}},questions:{position_action:{type:'choice',instructions:'Full management semantics. '.repeat(190),criteria:{HOLD:'Hold',EXIT_NOW:'Exit',REDUCE_RISK:'Reduce adverse exposure'}}}};
 const out=J.prepareDecisionRequest(input);assert.ok(out.diagnostics.beforeBytes>48000);assert.equal(out.ok,true,JSON.stringify(out.diagnostics));
 assert.deepEqual(out.body.state.record,record);assert.deepEqual(out.body.questions,input.questions);assert.deepEqual(J.protectedCoreTruth(out.body),J.protectedCoreTruth(input));
 assert.ok(out.diagnostics.trimStepsApplied.includes('ROUTING_MANAGEMENT_RESIDUAL_OPTIONAL'));
});
test('R2544.30 oversize protected market still blocks instead of sending partial truth',()=>{
 const out=J.prepareDecisionRequest({state:{coreMarketPacket:{symbol:'TESTUSDT',microstructure:{immutable:'X'.repeat(60000)}}},questions:{lane_focus:{criteria:{BOTH:'route'}}}});
 assert.equal(out.ok,false);assert.equal(out.diagnostics.blockReason,'JEV_CORE_CONTEXT_TOO_LARGE');
});
test('R2544.30 compact mobile positions preserve ledger failure, open quantity and all-trade summary',()=>{
 const report={ok:true,ledgerOk:false,ledgerError:'STALE',asOf:'2026-10-03',open:[{symbol:'TESTUSDT',side:'SHORT',quantity:1234,entryPrice:100,entryCase:{huge:'X'.repeat(1500000)}}],closed:Array.from({length:40},()=>({symbol:'XUSDT',netPnl:2,entryContext:{huge:'X'.repeat(60000)}})),summary:{closed:90,wins:30,losses:60,netPnl:-1},deskSummary:[{desk:'5M_SCALP',closed:30}],performance:{huge:'X'.repeat(200000)}};
 const out=mobilePositions(report);assert.equal(out.ledgerOk,false);assert.equal(out.ledgerError,'STALE');assert.equal(out.open[0].quantity,1234);assert.deepEqual(out.summary,report.summary);assert.equal(out.closed.length,5);assert.ok(Buffer.byteLength(JSON.stringify(out))<65536);assert.equal(report.closed.length,40);
});
test('R2544.30 five history rows do not truncate durable totals or desk statistics',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r254430-'));
 const rows=Array.from({length:12},(_,i)=>({kind:'POSITION_CLOSED',id:i+1,symbol:`TEST${i}USDT`,ts:100000+i*1000,payload:{side:'LONG',closedAt:new Date(100000+i*1000).toISOString(),openedAt:new Date(90000+i*1000).toISOString(),netPnl:2,rMultiple:1,tradeLane:'5M_SCALP'}}));
 const live=createLiveController({root,store:{officeRecords:()=>rows,recentJournal:()=>rows},scanner:{},pipeline:{},committee:async()=>({}),fetchImpl:async()=>{throw new Error('No network allowed');}});
 const result=live.positionsStatus({closedLimit:5});
 assert.equal(result.closed.length,5);assert.equal(result.summary.closed,12);assert.equal(result.summary.netPnl,24);assert.equal(result.deskSummary.find(x=>x.desk==='5M_SCALP').closed,12);assert.equal(mobilePositions(result).summaryScope,'ALL_RECONCILED_CLOSED_TRADES');
});
test('R2544.30 BURST telemetry distinguishes no selection and expired/stale authorization without order calls',()=>{
 let now=1000,calls=0;const m=new BurstScalpManager({now:()=>now,marketStream:{ensureSymbol(){},ensureLocalL2(){},snapshot(){calls++;return {available:false,ageMs:3000};}}});
 assert.equal(m.status().armed.length,0);m.arm({symbol:'TESTUSDT',side:'SHORT',ttlMs:30000});const s=m.status();assert.equal(s.armed[0].telemetry.state,'DATA_NOT_READY');assert.equal(s.armed[0].side,'SHORT');assert.ok(calls>0);assert.equal(s.active.length,0);now=32000;assert.equal(m.status().armed.length,0);
});
test('R2544.30 Office shows separate read-only BURST selection, trigger state and missing telemetry',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8'),el={innerHTML:''};
 const context={document:{getElementById:()=>el},esc:x=>String(x??'').replace(/</g,'&lt;'),trUi:x=>x};vm.createContext(context);
 vm.runInContext(html.slice(html.indexOf('function renderBurst('),html.indexOf('function renderKpis(')),context);
 context.renderBurst({burst:{ok:true,armed:[],active:[]}});assert.match(el.innerHTML,/ön-yetki verdiği coin yok/);
 context.renderBurst({burst:{ok:true,armed:[{symbol:'TESTUSDT',side:'SHORT',remainingMs:25000,telemetry:{state:'TRIGGER_READY',score:.95},jevReason:'<script>'}],active:[]}});assert.match(el.innerHTML,/TESTUSDT/);assert.match(el.innerHTML,/JEV SEÇTİ/);assert.match(el.innerHTML,/Tetik hazır/);assert.doesNotMatch(el.innerHTML,/<script>/);
 context.renderBurst({});assert.match(el.innerHTML,/doğrulanamıyor/);
});
test('R2544.30 free worker decodes content blocks and keeps empty reasoning response unavailable',async()=>{
 let body;const worker=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',maxAttempts:1,fetchImpl:async(_,o)=>{body=JSON.parse(o.body);return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:[{type:'text',text:'WORKER_STATE: WAIT'}]}}]})};}});
 const out=await worker.review({});assert.equal(out.ok,true);assert.equal(out.text,'WORKER_STATE: WAIT');assert.equal(body.max_tokens,1536);assert.deepEqual(body.reasoning,{effort:'low',exclude:true});/* R43: free reasoning models were truncated at 768 */assert.equal(out.blocksJev,false);
 const empty=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',maxAttempts:1,fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:null,reasoning:'private reasoning'}}]})})});
 assert.equal((await empty.review({})).ok,false);
});
