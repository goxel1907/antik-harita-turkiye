'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {narrateChart,FRAMES}=require('../chart-narrator');
const {marketPacket,mirrorDigest}=require('../jev-market-packet');
const {buildSovereignEvidence,buildUnifiedContext}=require('../pipeline');
const {prepareDecisionRequest}=require('../jev-decision');
const {selectDeterministicCandidates,pickPriorityCandidate}=require('../attention-priority');
const {executionTelemetry}=require('../execution-telemetry');
const {decisions,performanceReport}=require('../office-performance');
const {derive}=require('../office-dashboard/office-server');
const {structure,aggregate45m}=require('../engine');
function frame(){return {available:true,fresh:true,asOf:2700000,ageMs:0,close:100,trend:'UP',ema20:99,ema50:98,rsi14:55,atrPct:1,
 closedCandle:{open:99,high:101,low:98,close:100},patterns:[{type:'TRIANGLE',status:'FORMING'}],
 smcContext:{available:true,dealingRange:{low:90,high:110},fibLevels:{retracement:{'0.236':105.28,'0.382':102.36,'0.5':100,'0.618':97.64,'0.705':95.9,'0.786':94.28},extension:{'1.272':115.44,'1.618':122.36}},oteReference:{longDiscountZone:{low:94.28,high:97.64},shortPremiumZone:{low:102.36,high:105.72}}},
 orderBlocks:{bullish:[{side:'BULL',low:97,high:98}],bearish:[]},recentFairValueGaps:[{side:'BULL',low:98,high:99,ce50:98.5}]};}
function unified(){return {symbol:'BTCUSDT',livePrice:100,frames:Object.fromEntries(FRAMES.map(tf=>[tf,{...frame(),synthetic:tf==='45m',source:tf==='45m'?'BINANCE_15M_AGGREGATED_45M':'BINANCE_CLOSED_KLINES'}]))};}

test('PASS-1 and PASS-2 wire payloads preserve numeric truth and final mirror is the sent snapshot',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2543-wire-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/jev.json'),JSON.stringify({enabled:true,dailyCapUsd:100}));
 const u=unified();u.derivatives={available:true,source:'EXCHANGE',fundingRate:0.001};
 u.liquidationContext={available:true,source:'FORCE_ORDER',count:2,longLiquidatedQuote:42};
 u.marketMakerEvidence={orderFlow:{available:false,reason:'NO_TRADE_SAMPLE',sampleTrades:0,cvd120s:0}};
 const captured=[];
 const client=require('../jev-decision').createJevClient({root,apiKey:'sk-or-v1-'+'x'.repeat(40),fetchImpl:async(url,opt)=>{
  assert.ok(Buffer.byteLength(opt.body)<=52000);
  const body=JSON.parse(opt.body);captured.push(body);
  const packet=body.state.coreMarketPacket;
  assert.deepEqual(packet.chartNarrative,narrateChart(u));
  assert.equal(packet.microstructure.cvdQuote120s,null);assert.equal(packet.microstructure.orderFlowAvailable,false);
  assert.equal(packet.derivatives.fundingRate,0.001);assert.equal(packet.observedLiquidations.longLiquidatedQuote,42);
  for(const group of ['coreFrames','timingFrames','higherContext'])for(const [tf,f] of Object.entries(packet[group])){
   assert.deepEqual(f.closedCandle,u.frames[tf].closedCandle);assert.ok(f.fibLevels);assert.ok(f.oteReference);
  }
  const choices={lane_focus:'5M_SCALP',direction_focus:'BOTH',trade_plan:'WAIT',entry_timing:'WAIT_NEW_EVIDENCE',management_style:'BALANCED',target_profile:'BALANCED',partial_profile:'THIRDS',breakeven_rule:'AFTER_TP1',trail_rule:'JEV_DYNAMIC'};
  const answers=Object.fromEntries(Object.entries(body.questions).map(([k,q])=>[k,{type:'choice',choice:choices[k]||Object.keys(q.criteria)[0]}]));
  return {ok:true,status:200,text:async()=>JSON.stringify({answers,usage:{cost:0}})};
 }});
 const p1=await client.sovereignPass1({candidate:{symbol:u.symbol},unified:u});assert.equal(p1.ok,true);
 const result=await client.sovereignFinal({candidate:{symbol:u.symbol},unified:u,evidence:{missing:['ORDER_FLOW_CVD:NO_TRADE_SAMPLE']},planOptions:[]});
 assert.equal(result.ok,true);assert.equal(result.action,'WAIT');assert.equal(captured.length,2);
 assert.deepEqual(result.jevSeen,mirrorDigest(captured[1].state.coreMarketPacket));
});
test('same 9TF numeric input yields identical narrative hash 100 times and exact Office mirror',()=>{
 const u=unified(),p=marketPacket(u),n=p.chartNarrative;
 assert.match(n.hash,/^[a-f0-9]{64}$/);
 for(let i=0;i<100;i++)assert.deepEqual(narrateChart(u),n);
 assert.equal(Object.keys(n.frames).length,9);assert.equal(p.higherContext['45m'].synthetic,true);
 assert.ok(!n.alignment.up.includes('45m'));
 const mirror=mirrorDigest(p);assert.deepEqual(mirror.chartNarrative,n);
 for(const key of ['coreFrames','timingFrames','higherContext'])for(const tf of Object.keys(p[key])){
  for(const field of ['close','ema20','ema50','closedCandle','fibLevels','oteReference','orderBlocks','synthetic','asOf','ageMs'])assert.deepEqual(mirror[key][tf][field],p[key][tf][field],tf+':'+field);
 }
 const prepared=prepareDecisionRequest({model:'test',state:{coreMarketPacket:p,professionalTraderCortex:{reference:'x'.repeat(60000)}},questions:{trade_plan:{type:'choice'}}});
 assert.equal(prepared.ok,true);assert.ok(prepared.diagnostics.bytes<=52000);
 assert.deepEqual(prepared.body.state.coreMarketPacket.chartNarrative,n);
 assert.deepEqual(prepared.body.state.coreMarketPacket.higherContext['45m'].fibLevels,p.higherContext['45m'].fibLevels);
});
test('normal sovereign chart requests finish with GPU and free model unavailable',async()=>{
 let calls=0;
 const e=await buildSovereignEvidence({candidate:{symbol:'BTCUSDT'},unified:unified(),pass1:{requestedEvidence:['TRADINGVIEW_5M','TRADINGVIEW_15M','TIMING_1M','TIMING_3M','HIGHER_TF_CONTEXT']},committee:async()=>{calls++;throw new Error('GPU_OFF_FREE_429');}});
 assert.equal(calls,0);assert.equal(e.visual.source,'DETERMINISTIC_CHART_NARRATIVE_NO_GPU');assert.equal(e.visual.mode,'MAINLINE_CPU_DETERMINISTIC');assert.equal(e.visual.modelUsed,false);assert.equal(e.visual.attached,0);
 assert.ok(e.visual.requestedFrames.includes('45m'));assert.equal(e.higherTf['45m'].available,true);
 const missing=await buildSovereignEvidence({candidate:{symbol:'BTCUSDT'},unified:{frames:{}},pass1:{requestedEvidence:['TRADINGVIEW_5M']},committee:async()=>{throw new Error('must not call');}});
 assert.ok(missing.missing.includes('5m:UNAVAILABLE'));assert.match(missing.visual.text,/no usable candles/);
});
test('priority preserves both directions, approaching and early pools; coverage cannot starve',()=>{
 const leaders=Array.from({length:24},(_,i)=>({symbol:'C'+i+'USDT',attackRank:i+1,side:i%2?'SHORT':'LONG'}));
 const scan={leaders,top3Approach:[{symbol:'APPUSDT',side:'SHORT'}],acceleratingCandidates:[{symbol:'EARLYUSDT',side:'LONG'}]};
 const pool=selectDeterministicCandidates(scan,24);
 assert.equal(pool[0].symbol,'APPUSDT','approach comes before current leaders');
 assert.equal(pool[1].attackRank,4,'ranks 4-10 are next');
 assert.ok(pool.some(x=>x.symbol==='EARLYUSDT'));assert.equal(pool.length,24);
 const top3Indexes=leaders.slice(0,3).map(x=>pool.findIndex(p=>p.symbol===x.symbol));
 assert.ok(top3Indexes.every(i=>i>=0));
 assert.ok(Math.min(...top3Indexes)>pool.findIndex(x=>x.attackRank===11),'Top3 is scheduled after 11-24 discovery');
 const history={},seen=new Set();
 for(let i=0;i<200;i++){const p=pickPriorityCandidate(pool,history,i);assert.ok(p.candidate);seen.add(p.candidate.symbol);history[p.candidate.symbol]={lastAnalyzedAt:i+1};}
 assert.equal(seen.size,pool.length);assert.ok(pool.some(x=>x.side==='SHORT'));
});
test('risk rejection is linked to its approval and remains visible after unrelated WAIT',()=>{
 const ev=[{kind:'JEV_FINAL_AUTHORITY',stage:'APPROVED',decisionId:'a',symbol:'BTCUSDT',at:1000},{kind:'JEV_FINAL_AUTHORITY',stage:'HARD_BLOCK',decisionId:'a',symbol:'BTCUSDT',at:2000,reasons:['TRADE_RISK_CAP_EXCEEDED']},{kind:'TICK_RESULT',decisionId:'b',symbol:'ETHUSDT',at:3000,execution:'LEADER_AUTO_WAIT',reasons:['LEADER_PLAN_NOT_QUALIFIED']}];
 const telemetry=executionTelemetry(ev);assert.equal(telemetry.lastBlock.decisionId,'a');assert.equal(telemetry.reasonCounts.TRADE_RISK_CAP_EXCEEDED,1);
 const perf=decisions(ev);assert.equal(perf.approved,1);assert.equal(perf.hardBlocked,1);assert.equal(perf.intentBuilt,0);assert.equal(perf.safetyPassed,0);
 const d=derive({status:{ok:true,data:{armed:true,jevSovereign:{enabled:true},leaderAuto:{enabled:true,health:{}}}},health:{data:{featureVersion:'9.5.113-CLAUDE-VISION'}},positions:{data:{performance:{funnel:perf}}}});
 assert.ok(d.blockers.some(x=>x.code==='EXECUTION_HARD_BLOCK'&&x.detail.includes('TRADE_RISK_CAP_EXCEEDED')));
 assert.equal(d.funnel.find(x=>x.key==='hardBlocked').value,1);
 ev.push({kind:'JEV_FINAL_AUTHORITY',stage:'INTENT_BUILT',decisionId:'c',symbol:'BTCUSDT',at:4000});assert.equal(executionTelemetry(ev).lastBlock,null);
});
test('closed-candle CPU calculations match analytic EMA, RSI, ATR and 45m OHLC fixtures',()=>{
 const candles=Array.from({length:180},(_,i)=>({openTime:i*900000,closeTime:(i+1)*900000-1,open:100+i,high:102+i,low:100+i,close:101+i,volume:1,quoteVolume:100,takerBuyQuote:50}));
 const f=structure(candles.slice(0,100),'15m');
 for(const period of [20,50]){const q=1-2/(period+1);const expected=101+99-q/(1-q)*(1-q**99);assert.ok(Math.abs(f['ema'+period]-expected)<0.000001);}
 assert.equal(f.rsi14,100);assert.equal(f.atr14,2);assert.deepEqual(f.closedCandle,{open:199,high:201,low:199,close:200,openTime:89100000,closeTime:89999999});
 const a=aggregate45m(candles,162000001);assert.equal(a.length,60);assert.equal(a[0].open,100);assert.equal(a[0].high,104);assert.equal(a[0].low,100);assert.equal(a[0].close,103);
 const u=buildUnifiedContext({symbol:{symbol:'BTCUSDT',price:200,timeframes:{'45m':structure(a,'45m')}},now:162000001});assert.equal(u.frames['45m'].available,true);assert.equal(u.frames['45m'].synthetic,true);assert.equal(u.frames['45m'].source,'BINANCE_15M_AGGREGATED_45M');
});

test('durable journal projection separates execution stages without changing scanner health',()=>{
 const stages=['APPROVED','INTENT_BUILT','HARD_SAFETY_READY','ORDER_PLACED','HARD_BLOCK'];
 const records=stages.map((stage,i)=>({kind:'R2542_OFFICE_EVENT',id:String(i),ts:1000+i,payload:{kind:'JEV_FINAL_AUTHORITY',decisionId:i===4?'blocked':'filled',symbol:i===4?'ETHUSDT':'BTCUSDT',stage,reasons:i===4?['TRADE_RISK_CAP_EXCEEDED']:[]}}));
 const pf=performanceReport(records,[],2000).funnel;
 assert.equal(pf.execution.lastBlock.decisionId,'blocked');
 assert.equal(pf.execution.reasonCounts.TRADE_RISK_CAP_EXCEEDED,1);
 const health={scanRuns:77,deepAnalyses:99,claudeV111:{finalAuthorityApproved:90,finalAuthorityIntentBuilt:80,finalAuthorityHardSafetyReady:70,otherCounter:6}};
 const snap={status:{ok:true,data:{armed:true,jevSovereign:{enabled:true},leaderAuto:{enabled:true,health,activeBlocker:{reason:'LOWER_PRIORITY'}}}},positions:{data:{performance:{funnel:pf}}}};
 const before=structuredClone(snap),d=derive(snap);
 assert.deepEqual(snap,before);assert.equal(d.scanner.scanRuns,77);assert.equal(d.scanner.deepAnalyses,99);
 for(const key of ['approved','intentBuilt','hardBlocked','safety','orders'])assert.equal(d.funnel.find(x=>x.key===key).value,1,key);
 assert.equal(d.funnel.some(x=>x.key==='intent'),false);
 for(const key of ['qualified','intentBuilt','safetyReady','intentReady','ordersPlaced'])assert.equal(d.decisionHealth[key],1,key);
 const display={...health,...d.decisionHealth};assert.equal(display.claudeV111.finalAuthorityApproved,1);assert.equal(display.claudeV111.finalAuthorityIntentBuilt,1);assert.equal(display.claudeV111.finalAuthorityHardSafetyReady,1);assert.equal(display.claudeV111.otherCounter,6);
 assert.match(d.blockers.find(x=>x.code==='EXECUTION_HARD_BLOCK').detail,/TRADE_RISK_CAP_EXCEEDED/);
});

test('Office hard-block fallback handles absent, array and single reasons',()=>{
 assert.equal(derive({}).execution.lastBlock,null);
 for(const block of [null,{reason:'RISK'},{reasons:'RISK'},{reasons:['RISK']},{reasons:null}]){
  const d=derive({status:{data:{leaderAuto:{activeBlocker:block}}},positions:{data:{performance:{funnel:{blockedReasons:{RISK:2}}}}}});
  assert.deepEqual(d.execution,{chains:[],reasonCounts:{RISK:2},lastBlock:null});
  const b=d.blockers.find(x=>x.code==='EXECUTION_HARD_BLOCK');
  if(!block)assert.equal(b,undefined);else assert.match(b.detail,block.reasons===null?/Neden bildirilmedi/:/RISK/);
 }
});
