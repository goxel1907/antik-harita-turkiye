'use strict';
// R2544.55 JEV EDGE: narrow "+1R before the stop within 4 h?" Noul per plan, kept probabilities/confidence, code-side
// expected-value gate (fees included). The gate only removes entries; a missing answer never blocks.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const edge=require('../jev-edge');
const {createJevClient,compactPass2QuestionsResidual}=require('../jev-decision');
const {buildSovereignPlanOptions}=require('../pipeline');

const plan=(id,side,entry,stop,lane='5M_SCALP')=>({id,side,lane,entryPrice:entry,stopPrice:stop,takeProfit1:entry+(entry-stop)});

test('R55 one narrow Noul per executable plan, prices computed in code, at most six',()=>{
  const plans=[plan('LONG_5M_SCALP','LONG',100,99),plan('SHORT_5M_SCALP','SHORT',100,101),plan('BAD','LONG',100,101),
    ...[1,2,3,4,5].map(i=>plan('LONG_X'+i,'LONG',100,99.5))];
  const {questions,map}=edge.buildEdgeQuestions(plans);
  assert.equal(Object.keys(questions).length,5,'bad geometry skipped, six plans considered');
  assert.equal(map.LONG_5M_SCALP,'p1r_long_5m_scalp');assert.equal(map.BAD,undefined);
  const q=questions.p1r_long_5m_scalp;
  assert.equal(q.type,'noul');assert.match(q.instructions,/from entry 100, will price touch \+1R at 101 before touching the stop 99 within 4 hours/);
  assert.match(questions.p1r_short_5m_scalp.instructions,/\+1R at 99 before touching the stop 101/);
  assert.match(edge.EDGE_CONTEXT.measuredHistory,/44\.5%/);assert.match(edge.EDGE_CONTEXT.breakEven,/55%/);
});

test('R55 parse keeps choice probabilities, confidence and p(+1R first) for the selected plan',()=>{
  const plans=[plan('LONG_5M_SCALP','LONG',100,99),plan('SHORT_5M_SCALP','SHORT',100,101)];
  const {map}=edge.buildEdgeQuestions(plans);
  const out=edge.parseEdge({trade_plan:{type:'choice',choice:'LONG_5M_SCALP',confidence:0.62,probabilities:{LONG_5M_SCALP:0.8,SHORT_5M_SCALP:0.05,WAIT:0.15}},
    entry_timing:{choice:'MARKET_NOW',confidence:0.5},p1r_long_5m_scalp:{type:'noul',noul:0.63},p1r_short_5m_scalp:0.21},plans,'LONG_5M_SCALP',map);
  assert.equal(out.selected.planId,'LONG_5M_SCALP');assert.equal(out.selected.p1R,0.63);assert.equal(out.planEdges.SHORT_5M_SCALP.p1R,0.21);
  assert.equal(out.tradePlan.confidence,0.62);assert.equal(out.tradePlan.probabilities.WAIT,0.15);assert.equal(out.entryTiming.confidence,0.5);
  assert.equal(edge.parseEdge({},plans,'WAIT',map).selected,null);
});

test('R55 gate: EV after fees decides; tight stops need more probability; low confidence and SHADOW behave',()=>{
  const e=(p,conf=0.6)=>({selected:{p1R:p},tradePlan:{confidence:conf}});
  let g=edge.edgeGate({edge:e(0.6),side:'LONG',entryPrice:100,stopPrice:99}); // stop 1% -> fee 0.1R -> EV 0.1
  assert.equal(g.ok,true);assert.equal(g.decision,'PASS');assert.equal(g.feeR,0.1);assert.equal(g.evR,0.1);assert.equal(g.breakEvenP,0.55);
  g=edge.edgeGate({edge:e(0.55),side:'LONG',entryPrice:100,stopPrice:99});assert.equal(g.ok,false);assert.equal(g.reason,'JEV_EDGE_BELOW_BREAKEVEN');
  g=edge.edgeGate({edge:e(0.7),side:'SHORT',entryPrice:100,stopPrice:100.2}); // 0.2% stop -> fee 0.5R
  assert.equal(g.ok,false);assert.ok(g.evR<0);
  g=edge.edgeGate({edge:e(0.75,0.2),side:'LONG',entryPrice:100,stopPrice:98});assert.equal(g.ok,false);assert.deepEqual(g.reasons,['JEV_LOW_CONFIDENCE']);
  g=edge.edgeGate({edge:e(0.4),side:'LONG',entryPrice:100,stopPrice:99,config:{mode:'SHADOW'}});assert.equal(g.ok,true);assert.equal(g.decision,'SHADOW_WOULD_BLOCK');
  g=edge.edgeGate({edge:null,side:'LONG',entryPrice:100,stopPrice:99});assert.equal(g.ok,true,'a missing answer never blocks');assert.equal(g.reason,'JEV_EDGE_MISSING');
  g=edge.edgeGate({edge:null,side:'LONG',entryPrice:100,stopPrice:99,config:{missingPolicy:'BLOCK'}});assert.equal(g.ok,false);
  assert.equal(edge.edgeGate({edge:e(0.1),side:'LONG',entryPrice:100,stopPrice:99,config:{enabled:false}}).decision,'DISABLED');
});

test('R55 config file overrides defaults within bounds',()=>{
  const r=fs.mkdtempSync(path.join(os.tmpdir(),'r55-cfg-'));fs.mkdirSync(path.join(r,'config'));
  assert.deepEqual(edge.readEdgeConfig(r),edge.DEFAULT_CONFIG);
  fs.writeFileSync(path.join(r,'config','jev-edge.json'),JSON.stringify({mode:'shadow',evMinR:0.1,confidenceMin:7,missingPolicy:'block'}));
  const c=edge.readEdgeConfig(r);assert.equal(c.mode,'SHADOW');assert.equal(c.evMinR,0.1);assert.equal(c.confidenceMin,0.35,'out of range ignored');assert.equal(c.missingPolicy,'BLOCK');
});

test('R55 residual compaction keeps edge questions whole (their prices are the question)',()=>{
  const q={p1r_long_5m_scalp:{type:'noul',instructions:'Plan LONG_5M_SCALP (LONG 5M_SCALP): from entry 100, will price touch +1R at 101 before touching the stop 99 within 4 hours? Apply state.edgeContext; a stop touch first is NO.'},
    trade_plan:{type:'choice',instructions:'x'.repeat(300),criteria:{WAIT:'w',LONG_5M_SCALP:'long'}}};
  const out=compactPass2QuestionsResidual(q);
  assert.equal(out.p1r_long_5m_scalp.instructions,q.p1r_long_5m_scalp.instructions);assert.equal(out.p1r_long_5m_scalp.type,'noul');
});

function frame(){return {available:true,fresh:true,asOf:Date.now(),close:100,trend:'MIXED',rsi14:52,atrPct:1,prior20High:102,prior20Low:98,
  swingStructure:{lastConfirmedSwingLow:{price:99},lastConfirmedSwingHigh:{price:101}},liquidity:{buySide:102,sellSide:98},patterns:[],candle:{closed:true},
  orderBlocks:{bullish:[{side:'BULL',low:98.8,high:99.2,broken:false}],bearish:[{side:'BEAR',low:100.8,high:101.2,broken:false}]},
  smcContext:{available:true,dealingRange:{low:98,high:102,equilibrium:100,positionPct:50,zone:'EQUILIBRIUM'}}};}
function unified(){return {symbol:'BTCUSDT',livePrice:100,frames:Object.fromEntries(['1m','3m','5m','15m','30m','1h','4h','1d'].map(tf=>[tf,frame()])),
  dataQuality:{advisoryUsable:true},microstructure:{available:true,spreadBps:1},marketMakerEvidence:{orderFlow:{available:true}},derivatives:{available:true},
  liquidationContext:{available:false},learning:{recent:[],stats:[],measuredOutcomes:[],jevLessons:[],lifetime:{measuredSamples:0},measuredSampleCount:0},opportunityPaths:{LONG:{continuity:[]},SHORT:{continuity:[]}}};}

test('R55 PASS-2 request carries edgeContext + one edge question per plan; the result keeps JEV probabilities',async t=>{
  const r=fs.mkdtempSync(path.join(os.tmpdir(),'r55-jev-'));t.after(()=>fs.rmSync(r,{recursive:true,force:true}));
  fs.mkdirSync(path.join(r,'config'),{recursive:true});fs.mkdirSync(path.join(r,'docs'),{recursive:true});
  fs.copyFileSync(path.join(__dirname,'..','docs','JEV-PRO-TRADER-CORTEX-R2534.md'),path.join(r,'docs','JEV-PRO-TRADER-CORTEX-R2534.md'));
  fs.writeFileSync(path.join(r,'config','jev.json'),JSON.stringify({enabled:true,model:'typesafe/jev-1.13',dailyCapUsd:2,softBudgetUsd:0.25,maxPayloadChars:48000}));
  const plans=buildSovereignPlanOptions(unified());let seen=null;
  const client=createJevClient({root:r,apiKey:'sk-or-v1-'+'x'.repeat(40),fetchImpl:async(_u,opt={})=>{seen=JSON.parse(opt.body);
    const edgeAnswers=Object.fromEntries(Object.keys(seen.questions).filter(k=>k.startsWith('p1r_')).map(k=>[k,{type:'noul',noul:k==='p1r_long_5m_scalp'?0.64:0.3}]));
    return {ok:true,status:200,async text(){return JSON.stringify({answers:{
      trade_plan:{type:'choice',choice:'LONG_5M_SCALP',confidence:0.58,probabilities:{LONG_5M_SCALP:0.7,WAIT:0.2,SHORT_5M_SCALP:0.1}},
      setup_family:{type:'choice',choice:'SWEEP_RECLAIM'},entry_timing:{type:'choice',choice:'MARKET_NOW',confidence:0.4},edge_basis:{type:'choice',choice:'LIQUIDITY_SMC'},
      management_style:{type:'choice',choice:'TP1_BE_TRAIL'},target_profile:{type:'choice',choice:'BALANCED'},partial_profile:{type:'choice',choice:'THIRDS'},
      breakeven_rule:{type:'choice',choice:'AFTER_TP1'},trail_rule:{type:'choice',choice:'5M_STRUCTURE'},...edgeAnswers},usage:{cost:0.00001}});}};}});
  const out=await client.sovereignFinal({candidate:{symbol:'BTCUSDT'},unified:unified(),evidence:{requested:['TRADINGVIEW_5M']},planOptions:plans});
  assert.equal(out.ok,true,JSON.stringify(out.reason||''));
  assert.ok(seen.state.edgeContext,'edge context sent');assert.match(seen.state.edgeContext.measuredHistory,/44\.5%/);
  const eq=Object.keys(seen.questions).filter(k=>k.startsWith('p1r_'));
  assert.equal(eq.length,Math.min(6,plans.length));assert.ok(eq.includes('p1r_long_5m_scalp'));
  assert.match(seen.questions.p1r_long_5m_scalp.instructions,/will price touch \+1R at [0-9.]+ before touching the stop [0-9.]+ within 4 hours/);
  assert.equal(out.jevEdge.selected.planId,'LONG_5M_SCALP');assert.equal(out.jevEdge.selected.p1R,0.64);
  assert.equal(out.jevEdge.tradePlan.confidence,0.58);assert.equal(out.jevEdge.tradePlan.probabilities.WAIT,0.2);
});

test('R55 execution path: gate before margin/order, journaled with geometry, edge kept on the trade record',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  const g=src.indexOf('jevEdgeLib.edgeGate('),m=src.indexOf('const maintenance=await maintenanceMarginRateFor(candidate.symbol,requestedNotional,creds);');
  assert.ok(g>0&&m>g,'gate runs before margin and order');
  assert.ok(src.indexOf("R45 LOCATION_CHASE_GUARD")<g,'after the location/chase guards');
  assert.match(src,/store\.journal\('JEV_EDGE_GATE',candidate\.symbol,\{\.\.\.eg,side:/);
  assert.match(src,/edge:jd\.jevEdge\|\|null,edgeGate:advisory\?\.jevEdgeGate\|\|null/);
  const pl=fs.readFileSync(path.join(__dirname,'..','pipeline.js'),'utf8');
  assert.match(pl,/confidence:final\.jevEdge\?\.tradePlan\?\.confidence\?\?null/);assert.match(pl,/jevEdge:final\.jevEdge\|\|null,jevDecision:/);
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const k of ['JEV_EDGE_BELOW_BREAKEVEN','JEV_LOW_CONFIDENCE','JEV_EDGE_MISSING'])assert.ok(html.includes(k+':'),k);
});
