'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildPreEntryAdverseSelection,sampleConfidence,samplingConfidence}=require('../preentry-microstructure');
const {buildMarketMakerEvidence}=require('../market-maker-evidence');
const {marketPacket}=require('../jev-market-packet');
const cm=require('../case-memory');
const {depthDynamics,flowWindowStats,bookTickerFlowStats}=require('../market');
const tradeLessons=require('../trade-lessons');
const {prepareDecisionRequest,MAX_DECISION_REQUEST_BYTES}=require('../jev-decision');
const {CURATED_OPEN_SOURCE_REPOS}=require('../knowledge-research');

const root=path.resolve(__dirname,'..');
const NOW=1790798400000;
const src=f=>fs.readFileSync(path.join(root,f),'utf8');
function flow({buy=700,sell=300,move=0,trades=30}={}){const t=buy+sell;return {trades,buyQuote:buy,sellQuote:sell,deltaQuote:buy-sell,buyRatio:buy/t,sellRatio:sell/t,priceMoveBps:move};}
function streaming({absorption='BUY_AGGRESSION_ABSORBED_AT_ASK',buyFlow=true,ageMs=800}={}){
  const win=buyFlow?flow({buy:760,sell:240,move:-0.3}):flow({buy:240,sell:760,move:0.3});
  const ofi=buyFlow?{available:true,transitions:80,coverageMs:30000,normalizedOfi:0.62,priceMoveBps:-0.2,queueImbalanceCurrent:0.18,queueImbalanceDelta:-0.08,micropriceBps:-1.1}:{available:true,transitions:80,coverageMs:30000,normalizedOfi:-0.62,priceMoveBps:0.2,queueImbalanceCurrent:-0.18,queueImbalanceDelta:0.08,micropriceBps:1.1};
  return {available:true,ageMs,asOf:NOW,cvdAsOf:NOW-200,depthAsOf:NOW-100,cvdCoverageMs:120000,cvdTrades120s:160,depth20Imbalance:buyFlow?0.12:-0.12,spreadBps:1.2,
    depthSoftContext:{micropriceBps:buyFlow?-1.4:1.4},
    orderFlow:{windows:{'5s':win,'10s':win,'15s':win,'30s':win,'60s':win,'120s':win}},
    level1Ofi:{windows:{'5s':ofi,'15s':ofi,'30s':ofi,'60s':ofi,'120s':ofi},semantics:'SEQUENCED_PUBLIC_BOOKTICKER_LEVEL1_OFI_ONLY'},
    depthDynamics:{available:true,samples:70,pressure:{'15s':{delta:buyFlow?-0.16:0.16},'30s':{delta:buyFlow?-0.1:0.1}},spread:{baselineBps:0.9,currentBps:1.2},possibleLiquidityPulls:buyFlow?[{side:'BID',removedQuote:9000}]:[{side:'ASK',removedQuote:9000}],replenishment:buyFlow?[{side:'ASK',currentQuote:8000,confidence:0.8}]:[{side:'BID',currentQuote:8000,confidence:0.8}],absorption:{available:true,type:absorption,confidence:0.82}}};
}
function frame(){return {available:true,fresh:true,asOf:'2026-09-30T20:00:00Z',close:100,trend:'UP',rsi14:55,atrPct:1,swingStructure:{state:'BULLISH'},readout:{stretch:{state:'NORMAL',zone:'DISCOUNT',chaseRisk:{LONG:'LOW',SHORT:'LOW'}}}};}

test('R2544.21 long-trap advisor detects buy aggression absorbed at ask without claiming identity',()=>{
  const s=streaming({buyFlow:true,absorption:'BUY_AGGRESSION_ABSORBED_AT_ASK'});
  const x=buildPreEntryAdverseSelection({streaming:s,derivatives:{available:true,openInterest:{delta5mPct:0.3},takerBuySellRatio:1.4},microstructure:{spreadBps:1.2}});
  assert.equal(x.reliability.quality,'HIGH');
  assert.ok(x.long.trapRiskIndex>x.long.supportIndex,x.long);
  assert.ok(x.short.supportIndex>x.long.supportIndex);
  assert.match(x.actionHint,/LONG_WAIT_FLOW_NORMALIZATION|FLOW_SUPPORTS_SHORT/);
  assert.equal(x.participantIdentity,'NOT_IDENTIFIED');assert.equal(x.participantIntent,'NOT_ASSERTED');assert.equal(x.canVeto,false);assert.equal(x.canExecute,false);assert.equal(x.notProbability,true);
});

test('R2544.21 short-trap advisor detects sell aggression absorbed at bid',()=>{
  const s=streaming({buyFlow:false,absorption:'SELL_AGGRESSION_ABSORBED_AT_BID'});
  const x=buildPreEntryAdverseSelection({streaming:s,derivatives:{available:true,openInterest:{delta5mPct:0.2},takerBuySellRatio:0.7},microstructure:{spreadBps:1.2}});
  assert.ok(x.short.trapRiskIndex>x.short.supportIndex,x.short);
  assert.ok(x.long.supportIndex>x.short.supportIndex);
  assert.match(x.actionHint,/SHORT_WAIT_FLOW_NORMALIZATION|FLOW_SUPPORTS_LONG/);
});

test('R2544.21 sparse/warming microstructure is DATA_INSUFFICIENT rather than false zero',()=>{
  const x=buildPreEntryAdverseSelection({streaming:{available:true,ageMs:1000,cvdCoverageMs:5000,cvdTrades120s:1,spreadBps:2,orderFlow:{windows:{'5s':flow({trades:1})}},depthDynamics:{available:false}},microstructure:{}});
  assert.equal(x.reliability.usable,false);assert.equal(x.actionHint,'DATA_INSUFFICIENT');assert.ok(x.reliability.reasons.length>0);
});

test('R2544.21 partial-L2 depth dynamics exposes pressure and spread baseline without true-OFI claim',()=>{
  const now=1790798400000,mid=100;const hist=[];
  for(let i=0;i<40;i++){
    const at=now-(39-i)*1000;const bidQ=10+i*0.3,askQ=20-i*0.2;
    hist.push({at,bids:[{price:99.99,quote:bidQ},{price:99.98,quote:8}],asks:[{price:100.01,quote:askQ},{price:100.02,quote:8}]});
  }
  const d=depthDynamics(hist,[],now,mid);
  assert.equal(d.available,true);assert.ok(d.pressure['15s']);assert.ok(Number.isFinite(d.pressure['15s'].delta));assert.ok(Number.isFinite(d.spread.baselineBps));assert.match(d.note,/do not identify an exchange participant/i);
});

test('R2544.21 sequenced bookTicker computes directional Level-1 OFI without claiming full L2',()=>{
  const rows=[];
  for(let i=0;i<40;i++)rows.push({at:NOW-(39-i)*250,updateId:100+i,bid:99.99,ask:100.01,bidQty:10+i*0.2,askQty:20-i*0.15});
  const x=bookTickerFlowStats(rows,NOW,15000);
  assert.equal(x.available,true);assert.ok(x.transitions>=30);assert.ok(x.normalizedOfi>0.5,x);assert.match(x.semantics,/LEVEL1_OFI/);assert.match(x.note,/not full L2\/L3/i);
});

test('R2544.21 market-maker evidence carries compact multi-window pre-entry advisory only',()=>{
  const s=streaming({buyFlow:true});
  const mm=buildMarketMakerEvidence({streaming:s,derivatives:{available:true,openInterest:{delta5mPct:0.2},takerBuySellRatio:1.3},microstructure:{sourceQuality:'STREAMING_PARTIAL_BOOK'}});
  assert.ok(mm.orderFlow['5s']);assert.ok(mm.orderFlow['15s']);assert.ok(mm.orderFlow['60s']);assert.ok(mm.preEntryAdverseSelection);assert.equal(mm.preEntryAdverseSelection.executionAuthority,false);
});

test('R2544.21 JEV market packet and immutable case contain pre-entry evidence',()=>{
  const s=streaming({buyFlow:true});const frames={};for(const tf of cm.TFS)frames[tf]=frame();
  const u={symbol:'XUSDT',livePrice:100,frames,dataQuality:{advisoryUsable:true},microstructure:{available:true,streaming:s,depth20Imbalance:0.12,spreadBps:1.2,depthSoftContext:s.depthSoftContext},derivatives:{available:true,openInterest:{delta5mPct:0.2},takerBuySellRatio:1.3},liquidationContext:{available:false}};
  u.marketMakerEvidence=buildMarketMakerEvidence({streaming:s,derivatives:u.derivatives,microstructure:u.microstructure});
  const p=marketPacket(u);assert.ok(p.microstructure.preEntryAdverseSelection);assert.equal(p.microstructure.preEntryAdverseSelection.notProbability,true);
  const ec=cm.buildEntryCase({unified:u,candidate:{symbol:'XUSDT'},plan:{side:'LONG',setupFamily:'TREND_PULLBACK',lane:'5M_SCALP'},jevDecision:{preEntryFlowAssessment:'TRAP_RISK_WAIT'}});
  assert.equal(ec.version,'R2544.21');assert.ok(ec.flow.preEntryAdverseSelection);assert.equal(ec.decision.preEntryFlowAssessment,'TRAP_RISK_WAIT');
  const compact=cm.compactEntryCase(ec);assert.ok(compact.flow.preEntryAdverseSelection);assert.ok(JSON.stringify(compact).length<16000);
});

test('R2544.21 measured trade lessons calibrate pre-entry trap state with winners and losers instead of a veto rule',()=>{
  const pe=buildPreEntryAdverseSelection({streaming:streaming({buyFlow:true}),derivatives:{available:true,openInterest:{delta5mPct:0.2},takerBuySellRatio:1.4},microstructure:{}});
  const mk=(net,id)=>({id,symbol:'XUSDT',side:'LONG',netPnl:net,rMultiple:net>0?0.7:-0.6,riskQuote:10,initialQuantity:1,stopDistancePct:1,openedAt:'2026-09-30T20:00:00Z',closedAt:'2026-09-30T20:10:00Z',exitType:net>0?'TP1_RUNNER_TRAIL':'JEV_EXIT_NOW',entryContext:{setupFamily:'TREND_PULLBACK',lane:'5M_SCALP',entryTiming:'MARKET_NOW',entryCase:{flow:{preEntryAdverseSelection:pe},decision:{preEntryFlowAssessment:'TRAP_RISK_WAIT'}}}});
  const cards=tradeLessons.buildCards([mk(-5,'a'),mk(6,'b')]);
  assert.match(cards[0].preEntry.state,/TRAP_RISK_(HIGH|ELEVATED)/);assert.ok(cards[0].tags.includes('LOSS_AFTER_PREENTRY_TRAP_RISK'));assert.ok(cards[1].tags.includes('WIN_DESPITE_PREENTRY_TRAP_RISK'));
  const d=tradeLessons.digest(cards);assert.equal(d.version,'R2544.21');assert.ok(d.byPreEntryFlow.some(r=>/TRAP_RISK_(HIGH|ELEVATED)\|LONG/.test(String(r[0]))));assert.match(d.howToUse,/kazanan hem kaybeden/i);
});

test('R2544.21 context budget keeps pre-entry core evidence under hard cap',()=>{
  const s=streaming({buyFlow:true});const pe=buildPreEntryAdverseSelection({streaming:s,derivatives:{available:true,openInterest:{delta5mPct:0.2},takerBuySellRatio:1.3},microstructure:{}});
  const huge='X'.repeat(12000);const state={professionalTraderCortex:{reference:huge},dynamicKnowledge:{entries:Array.from({length:8},()=>({summary:huge}))},experienceMemory:{caseMemory:{analogs:Array.from({length:8},()=>({lesson:huge}))}},coreMarketPacket:{coreFrames:{'5m':frame(),'15m':frame()},timingFrames:{'1m':frame(),'3m':frame()},higherContext:{'1h':frame()},microstructure:{preEntryAdverseSelection:pe}}};
  const x=prepareDecisionRequest({model:'x',state,questions:{trade_plan:{type:'choice'}}});
  assert.equal(x.ok,true);assert.ok(x.diagnostics.bytes<=MAX_DECISION_REQUEST_BYTES);assert.ok(x.body.state.coreMarketPacket.microstructure.preEntryAdverseSelection);
});

test('R2544.21 JEV prompt, Office and deployment list expose pre-entry timing evidence',()=>{
  const j=src('jev-decision.js'),html=src('office-dashboard/public/office.html'),srv=src('server.js'),off=src('office-dashboard/office-server.js'),manage=src('manage.ps1');
  assert.match(j,/preEntryAdverseSelection/);assert.match(j,/ADVERSE_SELECTION_RISK/);assert.match(j,/TRAP_RISK_WAIT/);
  assert.match(html,/Giriş Öncesi Mikroyapı \/ Tuzak Riski/);assert.match(html,/Pre-entry tuzak/);
  assert.match(srv,/R2544\.22-HARD-CONTEXT-BUDGET/);assert.match(off,/2\.5\.2-R2544\.22-JEV-Brain/);assert.match(manage,/preentry-microstructure\.js/);
});



test('R2544.21 PROM-like sparse 5s/15s OFI windows are explicitly confidence-downweighted',()=>{
  const mk=(transitions,coverageMs,normalizedOfi=0.5,priceMoveBps=0)=>({available:true,transitions,coverageMs,normalizedOfi,priceMoveBps,queueImbalanceCurrent:0.2,queueImbalanceDelta:0,micropriceBps:0.2});
  const flowW=(trades,coverageMs,imbalance=0.2,priceMoveBps=0)=>({trades,coverageMs,buyQuote:500*(1+imbalance),sellQuote:500*(1-imbalance),buyRatio:(1+imbalance)/2,sellRatio:(1-imbalance)/2,priceMoveBps});
  const s={available:true,ageMs:200,asOf:NOW,cvdAsOf:NOW-50,depthAsOf:NOW-50,cvdCoverageMs:120000,cvdTrades120s:75,spreadBps:1,depth20Imbalance:0.1,
    orderFlow:{windows:{'5s':flowW(3,3561,-0.6),'15s':flowW(8,14106,-0.4),'30s':flowW(18,28846,-0.1,-2),'60s':flowW(35,59216,-0.05,-3),'120s':flowW(75,119000,-0.1,-3)}},
    level1Ofi:{windows:{'5s':mk(4,3561,-0.7077),'15s':mk(7,14106,-0.227),'30s':mk(23,28846,0.0463,-2.319),'60s':mk(73,59216,0.0547,-3.092)}},
    depthDynamics:{available:true,samples:49,pressure:{'15s':{delta:0},'30s':{delta:0}},spread:{baselineBps:1},possibleLiquidityPulls:[],replenishment:[],absorption:{available:false}}};
  const sc=samplingConfidence(s);
  assert.equal(sc.ofi['5s'].quality,'SPARSE');assert.equal(sc.ofi['15s'].quality,'SPARSE');assert.equal(sc.ofi['60s'].quality,'FULL');
  assert.ok(sc.ofi['5s'].score<0.35,sc.ofi['5s']);assert.ok(sc.ofi['15s'].score<0.35,sc.ofi['15s']);assert.ok(sc.ofi['60s'].score>=0.95,sc.ofi['60s']);
  assert.equal(sc.shortWindow.quality,'SPARSE');assert.ok(sc.overall.score>sc.shortWindow.score);assert.ok(sc.sparseWindows.includes('OFI_5s_SPARSE'));
  const x=buildPreEntryAdverseSelection({streaming:s,microstructure:{spreadBps:1},derivatives:{}});
  assert.equal(x.level1Ofi['5s'].confidenceQuality,'SPARSE');assert.ok(x.level1Ofi['5s'].confidence<0.35);
  assert.equal(x.level1Ofi['60s'].confidenceQuality,'FULL');assert.ok(x.level1Ofi['60s'].confidence>=0.95);
  assert.equal(x.signalUsable,true);
});

test('R2544.21 sample confidence requires both window coverage and event sufficiency',()=>{
  const sparse=sampleConfidence('5s',{transitions:4,coverageMs:3561},'OFI');
  const manyButShort=sampleConfidence('5s',{transitions:40,coverageMs:1000},'OFI');
  const full=sampleConfidence('5s',{transitions:20,coverageMs:4900},'OFI');
  assert.ok(sparse.score<0.35,sparse);assert.ok(manyButShort.score<0.3,manyButShort);assert.equal(full.quality,'FULL');
});

test('R2544.21 aggTrade windows expose coverageMs for honest sample confidence',()=>{
  const now=NOW;const trades=[];for(let i=0;i<10;i++)trades.push({at:now-4500+i*500,sign:i%2?1:-1,quote:100,price:100+i*0.01});
  const w=flowWindowStats(trades,now,5000);assert.ok(w.coverageMs>=4000&&w.coverageMs<=5000,w);assert.equal(w.trades,10);
});

test('R2544.22 runtime and Office preserve R2544.21 sparse-flow confidence hardening',()=>{
  const srv=src('server.js'),off=src('office-dashboard/office-server.js'),html=src('office-dashboard/public/office.html'),jev=src('jev-decision.js');
  assert.match(srv,/R2544\.22-HARD-CONTEXT-BUDGET/);assert.match(srv,/R2544_21_SPARSE_FLOW_CONFIDENCE/);assert.match(off,/2\.5\.2-R2544\.22-JEV-Brain/);
  assert.match(html,/kısa pencere/);assert.match(html,/Seyrek pencere/);assert.match(jev,/samplingConfidence/);assert.match(jev,/SPARSE\/VERY_SPARSE/);
});

test('R2544.21 low-star/research references are license-verified and reference-only registry inputs',()=>{
  const by=new Map(CURATED_OPEN_SOURCE_REPOS.map(x=>[x.repo,x]));
  for(const repo of ['armaansg/orderbook-microstructure','S-razmi/DeepLOB']){assert.equal(by.get(repo)?.license,'MIT');assert.ok(by.get(repo)?.why);assert.ok(by.get(repo)?.concepts?.length);}
  assert.equal(by.has('malekdhaouadi/Limit-Order-Book-Mid-price-Prediction'),false,'GitHub metadata license was not verified; do not ingest it');
});
