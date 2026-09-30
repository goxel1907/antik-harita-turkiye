'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const J=require('../jev-decision');
const {buildSovereignPlanOptions}=require('../pipeline');

function geometry(seed=1){return {source:'TEST_GEOMETRY',lines:Array.from({length:16},(_,i)=>({from:{index:i,price:100+i/10,at:seed+i},to:{index:i+20,price:101+i/10,at:seed+i+20}})),pivots:Array.from({length:24},(_,i)=>({index:i,price:100+i/100,at:seed+i}))};}
function frame(tf,{heavy=true}={}){
  const fib={leg:'UP_LEG_LOW_TO_HIGH',retracement:{'0.382':99.7,'0.5':99.5,'0.618':99.3,'0.705':99.1,'0.786':98.9},extension:{'1.272':102.2,'1.618':103.4},pricePositionPct:62};
  const ote={longDiscountZone:{low:98.9,high:99.4},shortPremiumZone:{low:100.6,high:101.1}};
  return {available:true,fresh:true,asOf:1790798400000,source:'BINANCE',synthetic:tf==='45m',close:100,trend:'UP',breakOfStructure:'BOS_UP',rsi14:58,atrPct:1.2,ema20:99.2,ema50:97.8,prior20High:101.2,prior20Low:96.4,
    candle:{direction:'BULL',bodyPct:63},forming:{direction:'BULL',changeAtr:0.2,notClosed:true},preMove:{state:'WATCH',direction:'LONG',score:64},volatility:{spike:null,trail:{direction:'UP',price:96.9}},readout:{stretch:{state:'NORMAL',zone:'PREMIUM'}},
    keyLevels:{above:[101.2],below:[99.3]},patterns:[{type:'RISING_WEDGE',side:'SHORT',status:'FORMING',geometry:heavy?geometry(1):undefined},{type:'DISPLACEMENT',side:'LONG',status:'CONFIRMED',geometry:heavy?geometry(2):undefined},{type:'DOUBLE_TOP',side:'SHORT',status:'FORMING',geometry:heavy?geometry(3):undefined},{type:'BULL_FLAG_OR_PENNANT',side:'LONG',status:'FORMING',geometry:heavy?geometry(4):undefined}],
    swingStructure:{state:'BULLISH',event:'BOS_UP',lastConfirmedSwingHigh:{price:101.2},lastConfirmedSwingLow:{price:98.5},confirmedPivots:heavy?Array.from({length:40},(_,i)=>({role:i%2?'HIGH':'LOW',index:i,price:98+i/10,at:i})):[],trendLines:heavy?[geometry(9)]:[]},
    recentFairValueGaps:[{side:'BULL',low:99.1,high:99.4,ce50:99.25},{side:'BEAR',low:100.7,high:101,ce50:100.85}],
    orderBlocks:{bullish:[{side:'BULL',low:98.8,high:99.2,broken:false,volRel:1.3}],bearish:[{side:'BEAR',low:100.8,high:101.2,broken:false,volRel:1.1}]},
    liquidity:{buySide:101.2,sellSide:96.4,fairValueGaps:[{side:'BULL',low:99.1,high:99.4,ce50:99.25},{side:'BEAR',low:100.7,high:101,ce50:100.85}],notes:heavy?'L'.repeat(2500):undefined},
    fibLevels:fib,oteReference:ote,smcContext:{available:true,swingEvent:'BOS_UP',swingState:'BULLISH',dealingRange:{low:96.4,high:101.2,equilibrium:98.8,positionPct:75,zone:'PREMIUM'},fibLevels:fib,oteReference:ote,note:heavy?'S'.repeat(1200):undefined,semantics:'SMC_EVIDENCE_ONLY',source:'BINANCE'}};
}
function preEntry(){return {version:'R2544.21',authority:'EVIDENCE_ONLY_JEV_FINAL',reliability:{score:1,quality:'HIGH',usable:true,tradeCoverageSec:120,trades120s:80,depthSamples:50,l1OfiTransitions30s:40,reasons:[]},samplingConfidence:{shortWindow:{score:0.44,quality:'SPARSE'},overall:{score:0.82,quality:'FULL',usable:true},sparseWindows:['OFI_5s_SPARSE']},flowPersistence:{score:0.18,sign:'BUY',consistency:0.75,confidence:0.8,quality:'FULL'},long:{supportIndex:0.48,trapRiskIndex:0.31,state:'CONTINUATION_SUPPORT'},short:{supportIndex:0.29,trapRiskIndex:0.42,state:'MIXED_OR_NEUTRAL'},actionHint:'FLOW_MIXED',notProbability:true,executionAuthority:false};}
function packet({heavy=true}={}){
  const fs5=frame('5m',{heavy}),fs15=frame('15m',{heavy});
  return {contract:'R2537_JEV_CONTEXT_COMPLETE_READ_ONLY',symbol:'TESTUSDT',livePrice:100,
    chartNarrative:{contract:'DETERMINISTIC',source:'CLOSED_CANDLE_NUMERIC',hash:'abc',alignment:{direction:'UP',agreementPct:75},frames:Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf=>[tf,{available:true,detail:'FULL',flags:['A','B'],line:(tf+' '+('N'.repeat(heavy?1800:40)))}]))},
    coreFrames:{'5m':fs5,'15m':fs15},timingFrames:{'1m':frame('1m',{heavy}),'3m':frame('3m',{heavy})},higherContext:Object.fromEntries(['30m','45m','1h','4h','1d'].map(tf=>[tf,frame(tf,{heavy})])),
    levelMap:{above:[{tf:'15m',type:'FIB',price:101.2}],below:[{tf:'15m',type:'OTE',price:99.2}]},liquidationHistory:{available:true,zones:[{side:'SHORT',price:101.4,quote:10000}]},
    microstructure:{preEntryAdverseSelection:preEntry(),spreadBps:1.2,depth20Imbalance:0.14},derivatives:{available:true,openInterest:{delta5mPct:0.3},fundingRate:0.0001,takerBuySellRatio:1.12},observedLiquidations:{available:true,count:1,longLiquidatedQuote:0,shortLiquidatedQuote:2500},dataQuality:{advisoryUsable:true},global:{btc:{trend:'UP'},riskState:'NORMAL'}};
}
function cortex(){return '# Trader Cortex\n\n'+['Decision doctrine','Market regime recognition','Structure and price action','Classical chart formations','Candlestick information','Support, resistance, and location','SMC / liquidity vocabulary','Volume, open interest, funding, positioning','Order flow, CVD, and tape logic','Depth / order-book microstructure','Core strategy families','Trap recognition','5m scalp expertise','15m trade expertise','Execution-cost discipline','Risk and position management','Experience memory — ALWAYS ON','Knowledge-gap protocol','Evidence reliability hierarchy'].map(h=>'## '+h+'\n'+('Meaningful '+h+' evidence. ').repeat(45)).join('\n\n');}
function memory(){const analog=i=>({eventId:'e'+i,symbol:'TESTUSDT',side:i%2?'LONG':'SHORT',family:'TREND_PULLBACK',lane:i%2?'5M_SCALP':'15M_TRADE',netPnl:i%2?2:-2,rMultiple:i%2?0.6:-0.5,similarity:0.7,lesson:'A'.repeat(600)});return {alwaysOn:true,source:'MEASURED',measuredSampleCount:170,jevLessonCount:24,lifetime:{samples:170},tradeLessons:{version:'R2544.21',samples:170,lifetime:{net:-10},worked:['w1','w2','w3','w4'],failed:['f1','f2','f3','f4'],repeatedMistakes:['m1','m2','m3','m4'],byPreEntryFlow:Array.from({length:12},(_,i)=>['STATE'+i,10,50,0,1,2,-2])},caseMemory:{version:'R2544.21',available:true,samples:8,summary:{netPnl:0},counterexamples:{winnerCount:4,loserCount:4},analogs:Array.from({length:8},(_,i)=>analog(i))},caseMemoryByLane:{LONG_5M_SCALP:{available:true,samples:4,summary:{netPnl:1},counterexamples:{winnerCount:2,loserCount:2},analogs:Array.from({length:4},(_,i)=>analog(i))}},measuredOutcomes:Array.from({length:12},(_,i)=>analog(i)),jevLessons:Array.from({length:12},(_,i)=>analog(i))};}
function knowledge(){return Array.from({length:8},(_,i)=>({topic:'topic'+i,family:'MICROSTRUCTURE',verifiedAt:'2026-09-30',summary:'K'.repeat(3000),keyPoints:['P'.repeat(700),'Q'.repeat(700),'R'.repeat(700)],sourceUrls:['https://example.com/'+i,'https://example.org/'+i]}));}
function decisionBody(pass=2){
  const p=packet({heavy:true});const base={model:'typesafe/jev-1.13',state:{description:'D'.repeat(1200),decisionContract:{version:'R2544.22',authority:'JEV_FINAL'},professionalTraderCortex:{version:'R2.5.3.4',mode:'LIVE_REASONING_REFERENCE_READ_ONLY',reference:cortex()},dynamicKnowledge:{entries:knowledge(),text:'K'.repeat(9000)},experienceMemory:memory(),coreMarketPacket:p}};
  if(pass===1){base.state.record={symbol:'TESTUSDT',baseFrames:{'5m':p.coreFrames['5m'],'15m':p.coreFrames['15m']},radar:{sideHint:'LONG'}};base.questions={lane_focus:{type:'choice',criteria:{A:'a'}},direction_focus:{type:'choice',criteria:{A:'a'}}};}
  else {base.state.pass1Handoff={laneFocus:'15M_TRADE',directionFocus:'LONG',requestedEvidence:['ORDER_FLOW_CVD','DEPTH_L2'],snapshotHash:'1234567890abcdef'};base.state.record={attention:{symbol:'TESTUSDT',baseFrames:{'5m':p.coreFrames['5m'],'15m':p.coreFrames['15m']}},requestedEvidence:{orderFlow:{text:'E'.repeat(5000)},depth:{text:'F'.repeat(4000)}},executablePlanOptions:[{id:'LONG_15M_TRADE',side:'LONG',entryPrice:100,stopPrice:98,takeProfit1:102,takeProfit2:104,takeProfit3:106}]};base.questions={trade_plan:{type:'choice',criteria:{WAIT:'wait',LONG_15M_TRADE:'long'}},entry_timing:{type:'choice',criteria:{MARKET_NOW:'now',WAIT_PULLBACK:'wait'}}};}
  return base;
}

test('R2544.22 PASS-1 budgets to 42k target when optional/redundant context is the excess and preserves decision core',()=>{
  const input=decisionBody(1);const before=J.protectedCoreTruth(input);assert.ok(Buffer.byteLength(JSON.stringify(input),'utf8')>52000);
  const out=J.prepareDecisionRequest(input);assert.equal(out.ok,true,JSON.stringify(out.diagnostics));assert.equal(out.diagnostics.pass,1);assert.equal(out.diagnostics.maxBytes,48000);assert.equal(out.diagnostics.targetBytes,42000);
  assert.ok(out.diagnostics.bytes<=42000,`PASS1 ${out.diagnostics.bytes}`);assert.equal(out.diagnostics.coreTruthProtected,true);assert.deepEqual(J.protectedCoreTruth(out.body),before);
  assert.ok(out.body.state.coreMarketPacket.microstructure.preEntryAdverseSelection.samplingConfidence);assert.equal(out.body.state.coreMarketPacket.coreFrames['5m'].fibLevels.retracement['0.618'],99.3);
  assert.ok(out.diagnostics.trimStepsApplied.includes('SEMANTIC_OPTIONAL_CONTEXT_PROJECTION'));
});

test('R2544.22 PASS-2 budgets to 46k target and keeps plans, requested evidence, PASS-1 handoff and protected market truth',()=>{
  const input=decisionBody(2);const before=J.protectedCoreTruth(input);assert.ok(Buffer.byteLength(JSON.stringify(input),'utf8')>57000);
  const out=J.prepareDecisionRequest(input);assert.equal(out.ok,true,JSON.stringify(out.diagnostics));assert.equal(out.diagnostics.pass,2);assert.equal(out.diagnostics.targetBytes,46000);assert.ok(out.diagnostics.bytes<=46000,`PASS2 ${out.diagnostics.bytes}`);
  assert.equal(out.diagnostics.coreTruthProtected,true);assert.deepEqual(J.protectedCoreTruth(out.body),before);assert.equal(out.body.state.pass1Handoff.snapshotHash,'1234567890abcdef');assert.equal(out.body.state.record.executablePlanOptions[0].id,'LONG_15M_TRADE');assert.ok(out.body.state.record.requestedEvidence.orderFlow);
  assert.ok(out.body.state.coreMarketPacket.microstructure.preEntryAdverseSelection.samplingConfidence);assert.equal(out.body.state.coreMarketPacket.coreFrames['15m'].orderBlocks.bearish[0].high,101.2);
});

test('R2544.22 never silently deletes an irreducibly oversized protected core; it fails closed with a distinct reason',()=>{
  const input=decisionBody(2);input.state.coreMarketPacket.microstructure.irreduciblePublicEvidence='Z'.repeat(60000);input.state.professionalTraderCortex=null;input.state.dynamicKnowledge=null;input.state.experienceMemory=null;input.state.record.requestedEvidence=null;
  const out=J.prepareDecisionRequest(input);assert.equal(out.ok,false);assert.equal(out.diagnostics.blockReason,'JEV_CORE_CONTEXT_TOO_LARGE');assert.ok(out.diagnostics.bytes>48000);assert.equal(out.diagnostics.coreTruthProtected,true);assert.equal(out.body.state.coreMarketPacket.microstructure.irreduciblePublicEvidence.length,60000);
});

function tmpRoot(){const r=fs.mkdtempSync(path.join(os.tmpdir(),'r254422-'));fs.mkdirSync(path.join(r,'config'),{recursive:true});fs.writeFileSync(path.join(r,'config','jev.json'),JSON.stringify({enabled:true,model:'typesafe/jev-1.13',dailyCapUsd:2,maxPayloadChars:48000}));return r;}
function uFrame(){return {available:true,fresh:true,asOf:1790798400000,close:100,trend:'UP',rsi14:55,atrPct:1,prior20High:102,prior20Low:98,swingStructure:{state:'BULLISH',lastConfirmedSwingLow:{price:99},lastConfirmedSwingHigh:{price:101}},liquidity:{buySide:102,sellSide:98},patterns:[],candle:{closed:true},smcContext:{available:true,dealingRange:{low:98,high:102,equilibrium:100,positionPct:50,zone:'EQUILIBRIUM'},fibLevels:{leg:'UP_LEG',retracement:{'0.618':99.5}},oteReference:{longDiscountZone:{low:99,high:99.5}}}};}
function unified(){const frames={};for(const tf of ['1m','3m','5m','15m','30m','45m','1h','4h','1d'])frames[tf]=uFrame();return {symbol:'TESTUSDT',livePrice:100,frames,dataQuality:{advisoryUsable:true},microstructure:{available:true,spreadBps:1,depth20Imbalance:0.1},marketMakerEvidence:{orderFlow:{available:true},preEntryAdverseSelection:preEntry()},derivatives:{available:true},liquidationContext:{available:false},learning:{measuredSampleCount:0,jevLessonCount:0,stats:[],measuredOutcomes:[],jevLessons:[]},opportunityPaths:{LONG:{continuity:[]},SHORT:{continuity:[]}}};}
function response(x){return {ok:true,status:200,async text(){return JSON.stringify(x);}};}

test('R2544.22 PASS-1 -> PASS-2 carries a compact audited handoff instead of replaying the whole PASS-1 request',async t=>{
  const root=tmpRoot();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let finalSeen=null;
  const client=J.createJevClient({root,apiKey:'sk-or-v1-'+'x'.repeat(40),fetchImpl:async(_url,opt={})=>{const body=JSON.parse(opt.body);if(body.questions.lane_focus){const answers={lane_focus:{choice:'15M_TRADE'},direction_focus:{choice:'LONG'},knowledge_research:{choice:'SKIP'},knowledge_family:{choice:'AUTO'}};for(const k of Object.keys(body.questions))if(k.startsWith('evidence_'))answers[k]={choice:k==='evidence_order_flow_cvd'?'REQUEST':'SKIP'};return response({answers,usage:{cost:0.00001}});}finalSeen=body;return response({answers:{trade_plan:{choice:'WAIT'},setup_family:{choice:'NONE_WAIT'},entry_timing:{choice:'WAIT_NEW_EVIDENCE'},wait_reason:{choice:'EDGE_INSUFFICIENT'},edge_basis:{choice:'NO_EDGE'},pre_entry_flow_assessment:{choice:'NEUTRAL_OR_MIXED'},management_style:{choice:'HOLD_TO_INVALIDATION'},target_profile:{choice:'BALANCED'},partial_profile:{choice:'THIRDS'},breakeven_rule:{choice:'STRUCTURE_ONLY'},trail_rule:{choice:'JEV_DYNAMIC'}},usage:{cost:0.00001}});}});
  const u=unified();const p1=await client.sovereignPass1({candidate:{symbol:'TESTUSDT',side:'LONG'},unified:u});assert.equal(p1.ok,true);assert.equal(p1.snapshotHash.length,24);assert.deepEqual(p1.requestedEvidence,['ORDER_FLOW_CVD']);
  const plans=buildSovereignPlanOptions(u);const p2=await client.sovereignFinal({candidate:{symbol:'TESTUSDT'},unified:u,evidence:{requested:['ORDER_FLOW_CVD'],orderFlow:{available:true}},planOptions:plans,pass1:p1});assert.equal(p2.ok,true);assert.ok(finalSeen.state.pass1Handoff);assert.equal(finalSeen.state.pass1Handoff.laneFocus,'15M_TRADE');assert.equal(finalSeen.state.pass1Handoff.snapshotHash,p1.snapshotHash);assert.deepEqual(finalSeen.state.pass1Handoff.requestedEvidence,['ORDER_FLOW_CVD']);assert.equal('questions' in finalSeen.state.pass1Handoff,false);
});

test('R2544.22 runtime/Office expose hard context budget and protected-core telemetry',()=>{
  const root=path.join(__dirname,'..');const server=fs.readFileSync(path.join(root,'server.js'),'utf8');const off=fs.readFileSync(path.join(root,'office-dashboard','office-server.js'),'utf8');const html=fs.readFileSync(path.join(root,'office-dashboard','public','office.html'),'utf8');
  assert.match(server,/R2544\.24-PASS2-FINAL-BUDGET/);assert.match(server,/R2544_22_PASS_SPECIFIC_BUDGET/);assert.match(server,/R2544_22_CORE_MARKET_PROTECTED/);assert.match(server,/R2544_23_PASS1_QUESTION_COMPACTION/);assert.match(server,/R2544_24_PASS2_QUESTION_COMPACTION/);assert.match(off,/2\.5\.4-R2544\.24-JEV-Brain/);assert.match(off,/targetBytes/);assert.match(off,/coreTruthProtected/);assert.match(html,/CORE DEĞİŞTİ/);assert.match(html,/targetBytes/);
});
