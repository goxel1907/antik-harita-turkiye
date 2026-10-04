'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freeCatalogModels}=require('../free-model-registry');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');
const {marketPacket,mirrorDigest,chartOverlayLevels}=require('../jev-market-packet');
const {buildUnifiedContext}=require('../pipeline');
const {chartContextFromSnapshot,cachedChartContext}=require('../market');
const {prepareDecisionRequest,protectedCoreTruth,createJevClient}=require('../jev-decision');
const reply=(status,payload,headers={})=>({ok:status>=200&&status<300,status,headers:{get:k=>headers[k]??null},text:async()=>JSON.stringify(payload)});
const now=Date.parse('2026-10-04T00:00:00Z');
function frames(){return Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf=>[tf,{available:true,asOf:now-1000,synthetic:tf==='45m',source:tf==='45m'?'BINANCE_15M_AGGREGATED_45M':'BINANCE',close:100,trend:'UP',closedCandle:{open:99,high:101,low:98,close:100,closeTime:now-1000},smcContext:{available:true,dealingRange:{high:104,low:94,equilibrium:99},fibLevels:{retracement:{'0.618':97.123456},extension:{}},oteReference:{longDiscountZone:{low:96,high:97}}},recentFairValueGaps:[{side:'BULL',low:99,high:99.5,filled:false},{side:'BEAR',low:110,high:111,filled:false},{side:'BULL',low:95,high:96,filled:false},{side:'BEAR',low:112,high:113,filled:false}],orderBlocks:{bullish:[{low:97,high:98,broken:false}],bearish:[{low:100.5,high:101,broken:false}]}}]));}
test('R31 catalog accepts new zero-priced text models and excludes paid, ambiguous or image-only entries',()=>{
 assert.deepEqual(freeCatalogModels({data:[{id:'new/a:free',pricing:{prompt:'0',completion:'0'},architecture:{output_modalities:['text']}},{id:'new/b:free',pricing:{prompt:'0',completion:'.1'}},{id:'paid/a',pricing:{prompt:'0',completion:'0'}},{id:'new/missing:free'},{id:'new/image:free',pricing:{prompt:'0'},architecture:{output_modalities:['image']}}]}),['new/a:free']);
});
test('R31 removed direct model stays unavailable after a restart; generic router never falls back to paid',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r31-'));let at=1000,calls=[];
 const options={apiKey:'sk-or-v1-fake',statePath:path.join(dir,'health.json'),models:['gone/model:free'],clock:()=>at,maxAttempts:2,fetchImpl:async(_,o)=>{const b=JSON.parse(o.body);calls.push(b);return reply(b.model==='openrouter/free'?503:404,{error:{message:'no endpoints found'}});}};
 await createOpenRouterFreeWorker(options).review({});at+=1800001;
 const worker=createOpenRouterFreeWorker(options);calls=[];await worker.review({});
 assert.equal(calls.some(x=>x.model==='gone/model:free'),false);assert.ok(calls.every(x=>x.provider.max_price.prompt===0&&x.provider.max_price.completion===0));
});
test('R31 latest failed response cannot inherit healthy from an old success',async()=>{
 let at=1000,ok=true;const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',models:[],maxAttempts:1,clock:()=>at,fetchImpl:async()=>ok?reply(200,{choices:[{message:{content:'valid evidence'}}]}):reply(503,{error:'overload'})});
 await w.review({});assert.equal(w.status().perModel[0].status,'healthy');ok=false;at+=1;await w.review({});at+=1800001;assert.equal(w.status().perModel[0].status,'failed');
});
test('R31 HTTP 200 truncation and invalid worker schema do not count as successful evidence',async()=>{
 for(const payload of [{choices:[{finish_reason:'length',message:{content:'WORKER_STATE: TRIGGERED'}}]},{choices:[{finish_reason:'length',message:{content:null}}]},{choices:[{message:{content:'invalid'}}]},{choices:[{message:{content:null}}]}]){
  const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',models:[],maxAttempts:1,fetchImpl:async()=>reply(200,payload)});assert.equal((await w.review({validate:()=>false})).ok,false);assert.equal(w.status().perModel[0].successes,0);
 }
});
test('R31 catalog refresh replaces stale fallback routes; account free quota prevents inference',async()=>{
 const calls=[];const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',autoDiscovery:true,fetchImpl:async(url)=>{calls.push(url);return url.endsWith('/models')?reply(200,{data:[{id:'new/a:free',pricing:{prompt:'0',completion:'0'}}]}):reply(200,{data:{free_model_daily_requests:{used:50,limit:50,remaining:0}}});}});
 const out=await w.review({});assert.equal(out.called,false);assert.equal(out.reason,'OPENROUTER_FREE_QUOTA_EXHAUSTED');assert.deepEqual(w.status().models,['openrouter/free','new/a:free']);assert.equal(calls.length,2);
});
test('R31 per-minute cap and daily budget include fallback attempts',async()=>{
 let calls=0;const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',models:[],minuteLimit:1,dailyLimit:2,fetchImpl:async()=>{calls++;return reply(200,{choices:[{message:{content:'evidence'}}]});}});
 await w.review({});assert.equal((await w.review({})).called,false);assert.equal(calls,1);assert.equal(w.status().quota.used,1);
});
test('R31 accepted evidence preserves multiline worker schema and complete research JSON',async()=>{
 const parse=require('../plan-workers').parseWorkerDecision;
 const text='WORKER_STATE: TRIGGERED\nCONFIDENCE: 80\nREASON: closed candle\nRECHECK_TFS: 5m';
 const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',models:[],fetchImpl:async()=>reply(200,{choices:[{message:{content:text}}]})});
 const result=await w.review({validate:x=>parse(x).ok});assert.equal(parse(result.text).ok,true);assert.equal(result.text,text);
 const json=JSON.stringify({summary:'s'.repeat(2200),keyPoints:['first'],sourceUrls:[]});
 const r=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',models:[],fetchImpl:async()=>reply(200,{choices:[{message:{content:json}}]})});
 assert.equal(JSON.parse((await r.review({validate:x=>!!JSON.parse(x).summary})).text).summary.length,2200);
});
test('R31 Office overlays retain the nearest full-source FVG even when ordinary frame list is shortened',()=>{
 const original=frames(),u=buildUnifiedContext({symbol:{symbol:'TESTUSDT',timeframes:original},now}),p=marketPacket(u);
 assert.equal(p.chartOverlayLevels['1h'].nearestFvg.low,99);assert.equal(p.chartOverlayLevels['1h'].fib618,97.123456);assert.deepEqual(p.chartOverlayLevels,chartOverlayLevels(original));
 const digest=mirrorDigest(p);assert.deepEqual(digest.chartOverlayLevels,p.chartOverlayLevels);assert.deepEqual(digest.levelMap,p.levelMap);assert.deepEqual(digest.higherContext['1h'].keyLevels,p.higherContext['1h'].keyLevels);
});
test('R31 large optional evidence cannot alter Office overlays, closed candle provenance or numeric core',()=>{
 const p=marketPacket(buildUnifiedContext({symbol:{symbol:'TESTUSDT',timeframes:frames()},now}));
 const input={state:{coreMarketPacket:p,professionalTraderCortex:{reference:'Optional prose '.repeat(7000)}},questions:{lane_focus:{type:'choice',criteria:{WAIT:'Wait'}}}};
 const out=prepareDecisionRequest(input);assert.equal(out.ok,true,JSON.stringify(out.diagnostics));assert.ok(out.diagnostics.bytes<=48000);assert.deepEqual(protectedCoreTruth(out.body),protectedCoreTruth(input));assert.deepEqual(out.body.state.coreMarketPacket.higherContext['1h'].closedCandle,p.higherContext['1h'].closedCandle);
});
test('R31 cached burst context performs no network work and exposes missing/stale/fresh states',()=>{
 assert.equal(cachedChartContext('NOTCACHEDUSDT',now).reason,'CHART_CACHE_MISSING');assert.equal(chartContextFromSnapshot('TESTUSDT',{asOf:now-61000,frames:frames()},now).reason,'CHART_CACHE_STALE');
 const c=chartContextFromSnapshot('TESTUSDT',{asOf:now-500,frames:frames()},now);assert.equal(c.available,true);assert.equal(c.packet.higherContext['45m'].synthetic,true);assert.equal(c.packet.coreFrames['5m'].closedCandle.high,101);
});
test('R31 burst sends bounded closed-candle chart context and fails closed without it',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r31-burst-'));let seen=null,calls=0;
 fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
 const c=createJevClient({root,apiKey:'sk-or-v1-fake',clock:()=>now,fetchImpl:async(_,opt)=>{seen=JSON.parse(opt.body);calls++;return reply(200,{answers:{burst_decision:{choice:'ARM_LONG'},ttl:{choice:'TTL_30S'},trigger_strictness:{choice:'STRICT_090'},leverage_mode:{choice:'MAX_SAFE'},pause_exception:{choice:'NO_PAUSE_EXCEPTION'}},usage:{cost:0.00001}});}});
 const args={candidate:{symbol:'TESTUSDT'},preMove:{state:'PRE_MOVE',direction:'LONG'}};
 assert.equal((await c.sovereignBurstArm(args)).reason,'BURST_CHART_CONTEXT_NOT_READY');assert.equal(calls,0);
 const chartContext=chartContextFromSnapshot('TESTUSDT',{asOf:now-500,frames:frames()},now);const out=await c.sovereignBurstArm({...args,chartContext});assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.side,'LONG');assert.deepEqual(seen.state.coreMarketPacket.chartOverlayLevels,chartContext.packet.chartOverlayLevels);assert.ok(Buffer.byteLength(JSON.stringify(seen))<=48000);
});
test('R31 unverified knowledge is not repeatedly requested across restarts',async()=>{
 const {createKnowledgeResearch}=require('../knowledge-research'),root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r31-research-'));let calls=0;
 const opts={root,clock:()=>now,retryDelaysMs:[0],routerResearch:async()=>{calls++;return {ok:false,reason:'CHANNEL_UNAVAILABLE'};},openRouterResearch:async()=>({ok:false}),fetchImpl:async()=>{throw new Error('No source requested');}};
 await createKnowledgeResearch(opts).research({topic:'UNKNOWN PATTERN'});assert.equal(calls,1);
 const again=await createKnowledgeResearch(opts).research({topic:'UNKNOWN PATTERN'});assert.equal(again.called,false);assert.equal(again.reason,'KNOWLEDGE_TOPIC_COOLDOWN');assert.equal(calls,1);
});
test('R31 GitHub/CME source 429 respects host Retry-After rather than retrying immediately',async()=>{
 const {createKnowledgeResearch}=require('../knowledge-research'),root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r31-source-'));let at=now,calls=0;
 const worker=async()=>({text:JSON.stringify({summary:'Trading concept',keyPoints:[],sourceUrls:['https://www.cmegroup.com/education/test.html']})});
 const desk=createKnowledgeResearch({root,clock:()=>at,retryDelaysMs:[0],routerResearch:worker,openRouterResearch:worker,fetchImpl:async()=>{calls++;return reply(429,{error:'rate limit'},{'retry-after':'600'});}});
 await desk.research({topic:'PATTERN A'});await desk.research({topic:'PATTERN B'});assert.equal(calls,1);assert.ok(desk.status().sourceLimits.hostCooldowns['www.cmegroup.com']>=now+600000);
});
