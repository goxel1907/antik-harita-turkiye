'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function flowFixture(t){
 const market=require('../market'),original={...market},now=Date.now();
 const frame={available:true,asOf:now,close:100,trend:'UP',rsi14:55,atrPct:1,prior20High:102,prior20Low:98,candle:{},patterns:[],swingStructure:{state:'BULLISH'},liquidity:{},smcContext:{}};
 market.symbolContext=async()=>({symbol:'TESTUSDT',timeframes:Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf=>[tf,frame])),microstructure:{available:true,bid:99.99,ask:100.01},generatedAt:new Date(now).toISOString()});
 market.globalContext=async()=>({});
 const mp=require.resolve('../pipeline'),previous=require.cache[mp];delete require.cache[mp];const {runSovereignFlow}=require('../pipeline');
 t.after(()=>{Object.assign(market,original);if(previous)require.cache[mp]=previous;else delete require.cache[mp];});
 return {run:runSovereignFlow,args:{scan:{leaders:[{symbol:'TESTUSDT',side:'LONG'}]},executionIntent:{symbol:'TESTUSDT',side:'LONG',positionReviewOnly:true},store:{journal(){},learningContext:()=>({measurement:'WINNERS_AND_LOSERS'})},committee:async()=>{throw Error('optional worker must not run');},decisionPass1:async()=>({ok:false,called:true,reason:'JEV_SOVEREIGN_PASS1_SCHEMA_MISMATCH'}),decisionFinal:async()=>{throw Error('must never authorize new entry');}}};
}
test('R41 routing failure keeps fresh market and learning context for the independent exit judge, without entry authority',async t=>{
 const {run,args}=flowFixture(t),r=await run(args);assert.equal(r.unifiedContext.livePrice,100);assert.equal(r.unifiedContext.dataQuality.advisoryUsable,true);assert.equal(r.unifiedContext.learning.measurement,'WINNERS_AND_LOSERS');assert.equal(r.evidence.routingAvailable,false);assert.match(r.evidence.missing[0],/SCHEMA_MISMATCH/);assert.equal(r.orderPlaced,false);assert.equal(r.plan,undefined);assert.equal(r.jevDecision,undefined);
});
test('R41 new-entry routing failure still fails closed and does not expose the management fallback',async t=>{
 const {run,args}=flowFixture(t);args.executionIntent.positionReviewOnly=false;const r=await run(args);assert.equal(r.unifiedContext,undefined);assert.equal(r.orderPlaced,false);assert.equal(r.status,'REVIEW_REQUIRED');
});
test('R41 stale/unusable market data cannot enable the exit-context fallback',async t=>{
 const {run,args}=flowFixture(t);require('../market').symbolContext=async()=>({symbol:'TESTUSDT',timeframes:{},microstructure:{available:false}});
 // pipeline captured the original fixture function; reload after swapping it.
 const mp=require.resolve('../pipeline');delete require.cache[mp];const r=await require('../pipeline').runSovereignFlow(args);assert.equal(r.unifiedContext,undefined);assert.equal(r.reason,'SOVEREIGN_BASE_CONTEXT_UNUSABLE');assert.equal(r.orderPlaced,false);
});
test('R41 an entry WAIT dedupe does not swallow an existing-position management context',async t=>{
 const {run,args}=flowFixture(t);args.executionIntent.positionReviewOnly=false;args.decisionPass1=async()=>({ok:true,laneFocus:'15M_TRADE',directionFocus:'LONG',requestedEvidence:[]});args.decisionFinal=async()=>({ok:true,called:true,action:'WAIT',entryTiming:'WAIT_PULLBACK',waitReason:'LOCATION_POOR'});
 await run(args);args.executionIntent.positionReviewOnly=true;const r=await run(args);assert.equal(r.analysisSkipped,true);assert.equal(r.unifiedContext.livePrice,100);assert.equal(r.orderPlaced,false);
});
test('R41 chart preload never dims or replaces the visible image and decode failure preserves it',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8'),src=html.slice(html.indexOf('function loadMirrorImage('),html.indexOf('async function renderMirror('));
 const images=[];class MockImage {constructor(){images.push(this);}set src(v){this.url=v;}async decode(){if(this.fail)throw Error('decode failed');}}
 const context={Promise,Image:MockImage};vm.createContext(context);vm.runInContext(src,context);
 const img={src:'old-frame',style:{opacity:'1'}},p=context.loadMirrorImage(img,'new-frame',1);assert.equal(img.src,'old-frame');assert.equal(img.style.opacity,'1');await images[0].onload();assert.equal(await p,'new-frame');assert.equal(img.src,'old-frame');
 const failed=context.loadMirrorImage(img,'bad-frame',2);images[1].fail=true;await images[1].onload();await assert.rejects(failed,/decode failed/);assert.equal(img.src,'old-frame');assert.equal(img.style.opacity,'1');
});
test('R41 chart pair commits together, ignores superseded snapshots and retains the pair after a load error',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8'),source=html.slice(html.indexOf('function mirrorFmt('),html.indexOf('\nlet last=null;'));
 const nodes={},images=[];const node=id=>nodes[id]||(nodes[id]={style:{},src:'old',className:'',innerHTML:'',textContent:''});
 class MockImage {constructor(){images.push(this);}set src(v){this.url=v;}async decode(){}}
 let fetches=0;const c={mirrorTf:'15m',mirrorSeq:0,mirrorOpts:{htf:true,pos:true},Date,Promise,Image:MockImage,$:node,num:x=>x==null?null:Number(x),esc:String,trUi:String,syncMirrorSymbol:()=> 'TESTUSDT',mirrorQuery:x=>'?'+new URLSearchParams(x),renderPreEntryMicro(){},fetch:async()=>({ok:true,json:async()=>({ok:true,snapshotId:'snapshot-'+(++fetches),packet:{coreFrames:{'15m':{}}},parity:{ok:true}})})};
 vm.createContext(c);vm.runInContext(source,c);const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
 const first=c.renderMirror({});await settle();const second=c.renderMirror({});await settle();await images[2].onload();assert.equal(node('#mirrorClean').src,'old');await images[3].onload();await second;assert.match(node('#mirrorClean').src,/snapshot-2/);assert.match(node('#mirrorAnnotated').src,/snapshot-2/);
 await images[0].onload();await images[1].onload();await first;assert.match(node('#mirrorClean').src,/snapshot-2/);
 const third=c.renderMirror({});await settle();await images[4].onload();images[5].onerror();await third;assert.match(node('#mirrorClean').src,/snapshot-2/);assert.match(node('#mirrorAnnotated').src,/snapshot-2/);assert.match(node('#mirrorParity').textContent,/önceki grafik korunuyor/);
});
