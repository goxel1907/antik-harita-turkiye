'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const J=require('../jev-decision');

function livePass1Questions(){
  const questions={
    lane_focus:{
      type:'choice',
      instructions:'Which lane deserves first attention for this symbol? Choose by the supplied market state, not by a fixed rule. This is only an evidence-routing decision, not a trade approval.',
      criteria:{
        '5M_SCALP':'The immediate opportunity is primarily a 5-minute scalp question.',
        '15M_TRADE':'The immediate opportunity is primarily a 15-minute trade question.',
        'BOTH':'Both 5m scalp and 15m trade hypotheses deserve evidence.',
        'UNDECIDED':'The base state is insufficient to prefer a lane before evidence.'
      }
    },
    direction_focus:{
      type:'choice',
      instructions:'Which directional hypothesis deserves evidence first? Scanner side is only an attention hint and must not bind this choice.',
      criteria:{
        'LONG':'LONG deserves first evidence attention.',
        'SHORT':'SHORT deserves first evidence attention.',
        'BOTH':'LONG and SHORT both remain live hypotheses.',
        'UNDECIDED':'Do not privilege either direction yet.'
      }
    },
    knowledge_research:{
      type:'choice',
      instructions:'Is there a material trading concept, formation, indicator, microstructure term, derivatives concept or execution concept in the supplied state that is not adequately covered by the professional Cortex/dynamic knowledge? Request research only for a real knowledge gap, never just to delay a decision.',
      criteria:{SKIP:'Existing verified knowledge is adequate for this decision.',RESEARCH_IF_GAP:'A material knowledge gap should be researched by the free-model research desk before PASS-2.'}
    },
    knowledge_family:{
      type:'choice',
      instructions:'If research is requested, choose the closest family. This routes research only; it never approves a trade.',
      criteria:{AUTO:'Let BrainHub detect the unfamiliar term.',PATTERN:'Chart/candlestick formation.',INDICATOR:'Indicator or quantitative transform.',MICROSTRUCTURE:'Order flow/depth/tape concept.',DERIVATIVES:'OI/funding/liquidation/positioning concept.',EXECUTION:'Futures execution/risk mechanics.',OTHER:'Other trading knowledge.'}
    }
  };
  for(const [id,description] of J.SOVEREIGN_EVIDENCE){
    questions['evidence_'+id.toLowerCase()]={
      type:'choice',
      instructions:'Decide whether this evidence should be requested for the current decision. '+description+' Do not request it merely because a checklist exists; request it only if it can materially improve the decision.',
      criteria:{REQUEST:'Request this evidence now.',SKIP:'Do not spend time or payload on this evidence for this decision.'}
    };
  }
  return questions;
}

function memory(){
  const analog=(i,win)=>({eventId:'e'+i,symbol:'TESTUSDT',side:i%2?'LONG':'SHORT',family:'TREND_PULLBACK',lane:i%2?'5M_SCALP':'15M_TRADE',netPnl:win?3.2:-2.7,rMultiple:win?0.8:-0.6,exitType:win?'TP1':'STOP',similarity:0.71,fidelity:'IMMUTABLE_R2544_21',preEntry:{quality:'FULL',actionHint:'FLOW_MIXED'},lesson:(win?'winner ':'loser ')+('measured lesson '.repeat(55))});
  return {
    alwaysOn:true,source:'MEASURED',measuredSampleCount:177,jevLessonCount:24,lifetime:{samples:177,netPnl:-170.9},
    tradeLessons:{version:'R2544.21',samples:177,lifetime:{net:-170.9},worked:['worked '+('W'.repeat(450)),'worked2 '+('W'.repeat(420)),'worked3'],failed:['failed '+('F'.repeat(450)),'failed2 '+('F'.repeat(420)),'failed3'],repeatedMistakes:['RAPID_REENTRY_AFTER_LOSS '+('M'.repeat(250)),'LEADER_CHASE_LONG '+('M'.repeat(220)),'WIDE_STOP'],current:{tier:'TOP4_10',LONG:[4,50,-2]},symbol:{samples:3},byPreEntryFlow:Array.from({length:8},(_,i)=>['STATE'+i+'|LONG',10+i,45+i,(-5+i),0.8,2.1,-2.4])},
    caseMemory:{version:'R2544.21',available:true,samples:6,summary:{netPnl:-1.2,avgR:-0.1},fidelity:{immutable:6},counterexamples:{winnerCount:3,loserCount:3},analogs:[analog(1,true),analog(2,false),analog(3,true)]},
    caseMemoryByLane:{LONG_5M_SCALP:{version:'R2544.21',available:true,samples:4,summary:{netPnl:1},fidelity:{immutable:4},counterexamples:{winnerCount:2,loserCount:2},analogs:[analog(4,true),analog(5,false)]},SHORT_15M_TRADE:{version:'R2544.21',available:true,samples:4,summary:{netPnl:-1},fidelity:{immutable:4},counterexamples:{winnerCount:2,loserCount:2},analogs:[analog(6,false),analog(7,true)]}}
  };
}

function liveShapedBody(){
  const q=livePass1Questions();
  const core={
    contract:'R2537_JEV_CONTEXT_COMPLETE_READ_ONLY',symbol:'TESTUSDT',livePrice:100,
    coreFrames:{'5m':{available:true,fresh:true,close:100,trend:'UP',rsi14:58,atrPct:1.2,recentFairValueGaps:[{side:'BULL',low:99,high:99.4}],orderBlocks:{bullish:[{low:98.8,high:99.2}]},fibLevels:{retracement:{'0.618':99.3}},oteReference:{longDiscountZone:{low:98.9,high:99.4}}},'15m':{available:true,fresh:true,close:100,trend:'UP',rsi14:61,atrPct:1.8,recentFairValueGaps:[{side:'BULL',low:98.6,high:99}],orderBlocks:{bearish:[{low:100.8,high:101.2}]},fibLevels:{retracement:{'0.618':98.9}},oteReference:{shortPremiumZone:{low:100.5,high:101}}}},
    timingFrames:{'1m':{available:true,fresh:true,close:100,trend:'UP',preMove:{state:'WATCH'}},'3m':{available:true,fresh:true,close:100,trend:'UP',preMove:{state:'WATCH'}}},
    higherContext:{'30m':{available:true,fresh:true,close:99,trend:'UP'},'45m':{available:true,fresh:true,close:99,trend:'UP',synthetic:true},'1h':{available:true,fresh:true,close:98,trend:'UP'},'4h':{available:true,fresh:true,close:96,trend:'UP'},'1d':{available:true,fresh:true,close:90,trend:'UP'}},
    levelMap:{above:[{price:101.2}],below:[{price:99.2}]},liquidationHistory:{available:true,zones:[]},
    microstructure:{preEntryAdverseSelection:{version:'R2544.21',authority:'EVIDENCE_ONLY_JEV_FINAL',reliability:{quality:'HIGH',score:1,usable:true},samplingConfidence:{shortWindow:{score:.67,quality:'MODERATE'},overall:{score:.86,quality:'FULL',usable:true},sparseWindows:['OFI_5s_UNAVAILABLE']},actionHint:'FLOW_MIXED'},livePublicPacket:'X'.repeat(26500)},
    derivatives:{available:true,openInterest:{delta5mPct:.1},fundingRate:.00001},observedLiquidations:{available:true,count:2},dataQuality:{advisoryUsable:true},global:{riskState:'NORMAL'}
  };
  return {model:'typesafe/jev-1.13',state:{
    description:'JEV PASS-1 evidence routing. '+('D'.repeat(620)),
    decisionContract:{version:'R2544.23',authority:'JEV_FINAL',phase:'PASS1_EVIDENCE_ROUTING',rules:['NO_FIXED_SCORE','NO_2_OF_3','NO_HARD_15M_VETO'],note:'C'.repeat(390)},
    professionalTraderCortex:{version:'R2.5.3.4',mode:'LIVE_REASONING_REFERENCE_READ_ONLY',reference:'## Decision doctrine\n'+('Cortex '.repeat(250))},
    dynamicKnowledge:{entries:[{topic:'microstructure',family:'MICROSTRUCTURE',verifiedAt:'2026-09-30',summary:'Verified compact reference '+('K'.repeat(300)),keyPoints:['one','two'],sourceUrls:['https://example.com']}],referenceProjected:true},
    experienceMemory:memory(),coreMarketPacket:core,
    record:{symbol:'TESTUSDT',radar:{sideHint:'LONG'},attention:{tier:'TOP4_10'},note:'R'.repeat(1300)}
  },questions:q};
}

test('R2544.23 compacts PASS-1 routing prose without changing question IDs or choice keys',()=>{
  const q=livePass1Questions();
  const c=J.compactPass1Questions(q);
  assert.deepEqual(Object.keys(c),Object.keys(q));
  for(const k of Object.keys(q))assert.deepEqual(Object.keys(c[k].criteria),Object.keys(q[k].criteria),k);
  assert.ok(Buffer.byteLength(JSON.stringify(c),'utf8')<Buffer.byteLength(JSON.stringify(q),'utf8')-1500);
  assert.match(c.evidence_order_flow_cvd.instructions,/order-flow\/CVD/i);
});

test('R2544.23 reproduces the live 49k PASS-1 failure class and fits under 42k without altering protected market truth',()=>{
  const input=liveShapedBody();
  const before=J.protectedCoreTruth(input);
  const rawBytes=Buffer.byteLength(JSON.stringify(input),'utf8');
  const qBytes=Buffer.byteLength(JSON.stringify(input.questions),'utf8');
  assert.ok(rawBytes>48000,`fixture must begin over hard max, got ${rawBytes}`);
  assert.ok(qBytes>6000,`fixture must carry live-like question schema, got ${qBytes}`);
  const out=J.prepareDecisionRequest(input);
  assert.equal(out.ok,true,JSON.stringify(out.diagnostics));
  assert.equal(out.diagnostics.pass,1);
  assert.equal(out.diagnostics.targetBytes,42000);
  assert.equal(out.diagnostics.maxBytes,48000);
  assert.ok(out.diagnostics.bytes<=42000,`PASS1 must meet target, got ${out.diagnostics.bytes}`);
  assert.equal(out.diagnostics.blockReason,null);
  assert.equal(out.diagnostics.coreTruthProtected,true);
  assert.deepEqual(J.protectedCoreTruth(out.body),before);
  assert.ok(out.diagnostics.trimStepsApplied.includes('PASS1_QUESTION_SCHEMA_COMPACT'));
  assert.ok(out.diagnostics.trimStepsApplied.includes('PASS1_ROUTING_MEMORY_TIGHT'));
  assert.ok(out.diagnostics.questionsBytes<qBytes);
  assert.equal(out.body.state.coreMarketPacket.microstructure.preEntryAdverseSelection.samplingConfidence.overall.quality,'FULL');
  assert.equal(out.body.state.experienceMemory.caseMemory.counterexamples.winnerCount,3);
  assert.equal(out.body.state.experienceMemory.caseMemory.counterexamples.loserCount,3);
});

test('R2544.23 PASS-1 routing memory compaction is not applied to PASS-2',()=>{
  const mem=memory();
  const body={model:'typesafe/jev-1.13',state:{description:'x',decisionContract:{},experienceMemory:mem,coreMarketPacket:{contract:'x',symbol:'T',livePrice:1,coreFrames:{},timingFrames:{},higherContext:{},microstructure:{},derivatives:{},observedLiquidations:{},dataQuality:{},global:{}},record:{requestedEvidence:{},executablePlanOptions:[{id:'LONG_15M_TRADE'}]},pass1Handoff:{laneFocus:'15M_TRADE'}},questions:{trade_plan:{type:'choice',criteria:{WAIT:'wait',LONG_15M_TRADE:'long'}},entry_timing:{type:'choice',criteria:{MARKET_NOW:'now'}}}};
  const out=J.prepareDecisionRequest(body);
  assert.equal(out.diagnostics.pass,2);
  assert.equal(out.diagnostics.trimStepsApplied.includes('PASS1_ROUTING_MEMORY_TIGHT'),false);
  assert.equal(out.diagnostics.trimStepsApplied.includes('PASS1_QUESTION_SCHEMA_COMPACT'),false);
});
