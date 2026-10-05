'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {select9RouterFreeModels,discoverOpenAIModels,is9RouterOpenCodeFreeId}=require('../free-model-registry');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');
const {compactWorkerContext,buildWorkerPrompt,parseWorkerDecision,combineWorkerReviews}=require('../plan-workers');
const {chartOverlayLevels,keyLevels}=require('../jev-market-packet');
const {PROFILES,roleInstruction}=require('../worker-expertise');
const reply=(status,payload)=>({ok:status===200,status,headers:{get:()=>null},text:async()=>JSON.stringify(payload)});
const schema='WORKER_STATE: WAIT\nCONFIDENCE: 80\nREASON: supplied condition absent\nRECHECK_TFS: NONE';
test('R33 successful empty 9Router catalog stops stale attempts, including after a transient failure',()=>{
 const config=['oc/mimo-v2.5-free'];
 assert.deepEqual(select9RouterFreeModels({lastSuccessAt:null,models:[]},config),config);
 assert.deepEqual(select9RouterFreeModels({lastSuccessAt:0,models:[],lastError:'timeout'},config),[]);
 // R43 (user decision 05.10.2026): Kiro and Gemini CLI free quotas serve text workers; lighter tier first.
 assert.deepEqual(select9RouterFreeModels({lastSuccessAt:123,models:['kr/glm-5','gc/gemini-2.5-flash']},config),['gc/gemini-2.5-flash','kr/glm-5']);
 assert.deepEqual(select9RouterFreeModels({lastSuccessAt:125,models:['grafik','kr/auto','kr/glm-5-thinking','kr/claude-haiku-4.5-agentic']},config),[]);
 assert.deepEqual(select9RouterFreeModels({lastSuccessAt:124,models:['oc/new-free','oc/new-paid']},config),['oc/new-free']);
 assert.equal(is9RouterOpenCodeFreeId('oc/paid-pro'),false);
});
test('R33 HTML/malformed model catalog cannot erase the last valid routing information',async()=>{
 for(const payload of ['<!DOCTYPE html>',{error:'login required'},{}]){
  const out=await discoverOpenAIModels({baseUrl:'http://test/v1',fetchImpl:async()=>reply(200,payload)});
  assert.equal(out.ok,false);assert.equal(out.error,'MODEL_CATALOG_SCHEMA_INVALID');
 }
 assert.equal((await discoverOpenAIModels({baseUrl:'http://test/v1',fetchImpl:async()=>reply(200,{data:[]})})).ok,true);
});
test('R33 a live zero-free catalog removes stale OpenRouter direct routes without enabling paid inference',async()=>{
 const bodies=[];
 const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',autoDiscovery:true,models:['removed/direct:free'],fetchImpl:async(url,opt)=>{
  if(url.endsWith('/models'))return reply(200,{data:[{id:'paid/new',pricing:{prompt:'1',completion:'1'}}]});
  if(url.endsWith('/key'))return reply(200,{data:{free_model_daily_requests:{limit:50,used:0}}});
  bodies.push(JSON.parse(opt.body));return reply(200,{choices:[{message:{content:schema}}]});
 }});
 const out=await w.review({role:'SCALP',validate:x=>parseWorkerDecision(x).ok});
 assert.equal(out.ok,true);assert.deepEqual(w.status().models,['openrouter/free']);assert.equal(bodies.length,1);
 assert.deepEqual(bodies[0].provider.max_price,{prompt:0,completion:0});assert.match(bodies[0].messages[0].content,/Role SCALP/);
 assert.equal(out.schemaValidated,true);assert.equal(out.factualAccuracyVerified,false);assert.equal(out.blocksJev,false);
});
test('R33 task-validated successful fallback is reused without repeated probing of unavailable models',async()=>{
 let at=1000;const calls=[];
 const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',models:['good/market:free'],clock:()=>at,fetchImpl:async(_,opt)=>{
  const b=JSON.parse(opt.body);calls.push(b.model);return b.model==='openrouter/free'?reply(503,{error:'overload'}):reply(200,{choices:[{message:{content:schema}}]});
 }});
 await w.review({role:'RISK',validate:x=>parseWorkerDecision(x).ok});at+=31000;
 const out=await w.review({role:'RISK',validate:x=>parseWorkerDecision(x).ok});
 assert.equal(out.ok,true);assert.deepEqual(calls,['openrouter/free','good/market:free','good/market:free']);
});
function frame(tf){return {available:true,fresh:true,source:'CLOSED_CANDLE_CACHE',synthetic:tf==='45m',asOf:1000,close:100,closedCandle:{open:99,high:101,low:98,close:100,closeTime:1000},smcContext:{dealingRange:{high:105,low:95},fibLevels:{retracement:{'0.5':100,'0.618':98.82}},oteReference:{longDiscountZone:{low:97,high:98},shortPremiumZone:{low:102,high:103}}},recentFairValueGaps:[{low:99,high:99.5,side:'BULL',filled:false}],orderBlocks:{bullish:[{low:98,high:99,broken:false}]},swingStructure:{trendLines:{support:{kind:'HL_SUPPORT',active:true,from:{price:95,at:100},to:{price:96,at:200},projected:{price:98,at:1000}}}},breakoutEvidence:{events:[{type:'WICK_SWEEP_REJECTION',side:'SHORT',barsAgo:1,stillInside:true,referencePrice:105}]}};}
test('R33 worker gets exact Office/JEV levels and causal trend/break states from cached 9TF without altering input',()=>{
 const frames=Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf=>[tf,frame(tf)]));
 frames['4h'].available=false;frames['15m'].fresh=false;
 const before=JSON.stringify(frames);const ctx=compactWorkerContext({tracked:{triggerTF:'1h'},unified:{frames}});
 assert.deepEqual(ctx.chartOverlayLevels,chartOverlayLevels(frames));assert.deepEqual(ctx.frames['1h'].keyLevels,keyLevels(frames['1h']));
 assert.deepEqual(ctx.frames['1h'].keyLevels.oteLong,[97,98]);assert.equal(ctx.chartOverlayLevels['15m'].breakoutEvidence.events[0].stillInside,true);
 assert.equal(ctx.frames['15m'].fresh,false);assert.equal(ctx.chartOverlayLevels['4h'].available,false);assert.equal(JSON.stringify(frames),before);
 assert.equal(ctx.chartOverlayProvenance['15m'].fresh,false);assert.equal(ctx.chartOverlayProvenance['45m'].synthetic,true);assert.equal(ctx.chartOverlayProvenance['4h'].available,false);
 assert.ok(Buffer.byteLength(JSON.stringify(ctx))<16000);assert.equal(ctx.policy.workerCannotQualify,true);
});
test('R33 ambiguous worker schema never counts as valid trigger evidence',()=>{
 for(const text of [schema.replace('80',''),schema.replace('NONE','banana'),schema.replace('RECHECK_TFS: NONE',''),schema+'\nWORKER_STATE: TRIGGERED'])assert.equal(parseWorkerDecision(text).ok,false);
 assert.equal(parseWorkerDecision(schema).ok,true);
});
test('R33 specialist instructions do not add voters, mandatory TF alignment or override deterministic/JEV authority',()=>{
 for(const role of Object.keys(PROFILES)){const prompt=buildWorkerPrompt({role});assert.match(prompt,/EVIDENCE_ONLY/);assert.match(prompt,/worker QUALIFIED veremez/i);assert.match(prompt,/Numeric supplied evidence outranks/);assert.match(prompt,/synthetic 45m is not independent/);}
 assert.match(roleInstruction('FINANCE'),/No current news/);assert.doesNotMatch(buildWorkerPrompt({}),/PLAN_WORKER_V110/);
 const result=combineWorkerReviews({deterministic:{state:'WAIT',reason:'missing closed candle'},router:{ok:true,state:'TRIGGERED'}});
 assert.equal(result.state,'WAIT');assert.equal(result.source,'DETERMINISTIC');
});
