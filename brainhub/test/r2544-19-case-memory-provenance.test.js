'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cm=require('../case-memory');
const {prepareDecisionRequest,MAX_DECISION_REQUEST_BYTES,compactExperienceMemory}=require('../jev-decision');
const {CURATED_OPEN_SOURCE_REPOS}=require('../knowledge-research');
const {openStore}=require('../store');
const os=require('node:os');

const root=path.resolve(__dirname,'..');
const src=f=>fs.readFileSync(path.join(root,f),'utf8');

function frame({trend='UP',state='BULLISH',fresh=true,asOf='2026-09-30T18:00:00.000Z',stretch='NORMAL',chase='LOW',close=100}={}){
  return {available:true,fresh,asOf,close,trend,rsi14:52,atrPct:1.2,ema20:99,ema50:98,
    swingStructure:{state},candle:{direction:'BULL',bodyPct:60},forming:{direction:'BULL'},patterns:[{type:'BREAKOUT_CLOSE',status:'CONFIRMED',side:'LONG'}],
    readout:{stretch:{state:stretch,zone:'DISCOUNT',rangePositionPct:35,chaseRisk:{LONG:chase,SHORT:'LOW'}},squeeze:{state:'OFF'},displacement:{dir:'UP'},effort:{state:'NORMAL'}}};
}
function unified(){
  const frames={};for(const tf of cm.TFS)frames[tf]=frame();
  return {symbol:'TESTUSDT',generatedAt:'2026-09-30T18:00:01.000Z',livePrice:100,frames,dataQuality:{advisoryUsable:true},
    microstructure:{available:true,depth20Imbalance:-0.4,spreadBps:3,microprice:100.01,streaming:{ageMs:500,cvdQuote120s:400}},
    derivatives:{available:true,oiDelta5mPct:0.1,fundingRate:0.0001,takerBuySellRatio:1.3,topTraderLongShortRatio:1.1,globalLongShortRatio:1.0},
    liquidationContext:{available:true,count:3,buyQuote:100,sellQuote:50,cascade:false}};
}

test('R2544.19 immutable entry case freezes entry-time truth and hash',()=>{
  const u=unified();
  const c=cm.buildEntryCase({unified:u,candidate:{symbol:'TESTUSDT',gainerRank:8,priceChange24hPct:12},plan:{side:'LONG',setupFamily:'TREND_PULLBACK',entryTiming:'MARKET_NOW',edgeBasis:'LIQUIDITY_SMC',lane:'5M_SCALP',ownerTF:'5m',why:'entry reason'},entryPrice:100,stopPrice:98,takeProfit1:103,now:Date.parse('2026-09-30T18:00:02Z')});
  const h=c.snapshotHash; assert.equal(c.immutable,true);assert.equal(h.length,64);assert.equal(c.frames['5m'].close,100);
  u.frames['5m'].close=77;u.microstructure.depth20Imbalance=0.9;
  assert.equal(c.frames['5m'].close,100);assert.equal(c.snapshotHash,h);
});

test('R2544.19 data quality flags stale/missing frames without inventing values',()=>{
  const u=unified(); delete u.frames['3m'];u.frames['15m'].fresh=false;u.microstructure.streaming.ageMs=30000;
  const q=cm.dataQuality(u,{now:Date.parse('2026-09-30T18:01:00Z')});
  assert.ok(q.flags.some(x=>x.includes('MISSING_TF:3m')));assert.ok(q.flags.some(x=>x.includes('STALE_TF:15m')));assert.ok(q.flags.includes('MICROSTRUCTURE_STALE_GT_15S'));
});

test('R2544.19 microstructure engine emits observable labels, not market-maker identity',()=>{
  const u=unified();u.frames['5m'].trend='DOWN';u.frames['1m'].forming.direction='BEAR';
  const events=cm.microstructureEvents(u,{side:'LONG'}).map(x=>x.type);
  assert.ok(events.includes('BUY_AGGRESSION_ABSORBED'));
  assert.equal(events.some(x=>/MARKET_MAKER|IDENTITY|SPOOFING_ACTOR/.test(x)),false);
});

test('R2544.19 analog memory returns winners and losers as counterexamples',()=>{
  const base=cm.buildEntryCase({unified:unified(),candidate:{symbol:'AUSDT'},plan:{side:'LONG',setupFamily:'TREND_PULLBACK',lane:'5M_SCALP'}});
  const t=(symbol,net,r)=>({symbol,side:'LONG',netPnl:net,rMultiple:r,exitType:net>0?'TAKE_PROFIT':'STOP_LOSS',entryContext:{setupFamily:'TREND_PULLBACK',lane:'5M_SCALP',entryCase:JSON.parse(JSON.stringify(base))}});
  const d=cm.analogDigest([t('AUSDT',5,1),t('BUSDT',-4,-0.8),t('CUSDT',2,0.4)],{currentCase:base,limit:5,minSimilarity:0.1});
  assert.equal(d.available,true);assert.ok(d.winners.length>=1);assert.ok(d.losers.length>=1);assert.equal(d.softContextOnly,true);assert.equal(d.executionAuthority,false);
});



test('R2544.19 analog memory can use older measured marketSignature only as discounted partial-fidelity evidence',()=>{
  const cur=cm.buildCurrentCase({unified:unified(),candidate:{symbol:'NOWUSDT'},side:'LONG'});
  const legacy={symbol:'OLDUSDT',side:'LONG',netPnl:3,rMultiple:0.6,tradeLane:'5M_SCALP',entryContext:{setupFamily:'TREND_PULLBACK',marketSignature:{regime5m:{trend:'UP',readout:{stretchState:'NORMAL',chaseLong:'LOW'}},regime15m:{trend:'UP',readout:{stretchState:'NORMAL',chaseLong:'LOW'}},orderFlow:{cvd120s:400},depth:{imbalance:-0.4},derivatives:{oiDeltaPct:0.1,fundingRate:0.0001,takerBuySellRatio:1.3}}}};
  const d=cm.analogDigest([legacy],{currentCase:cur,limit:5,minSimilarity:0.05});assert.equal(d.available,true);assert.equal(d.analogs[0].fidelity,'LEGACY_PARTIAL_SIGNATURE');assert.equal(d.fidelity.legacyPartial,1);assert.equal(d.analogs[0].entryHash,null);
});



test('R2544.19 lane-specific analog memory stays compact enough for always-on reasoning',()=>{
  const mk=()=>({version:'R2544.19',available:true,samples:3,summary:{netPnl:1,avgR:0.1},counterexamples:{winnerCount:2,loserCount:1},analogs:Array.from({length:3},(_,i)=>({symbol:'S'+i+'USDT',side:'LONG',family:'TREND_PULLBACK',lane:'5M_SCALP',netPnl:i?2:-1,rMultiple:i?0.5:-0.3,similarity:0.7,fidelity:'IMMUTABLE_R2544_19',microstructureEvents:['DELTA_PRICE_DIVERGENCE']}))});
  const lanes={LONG_5M_SCALP:mk(),SHORT_5M_SCALP:mk(),LONG_15M_TRADE:mk(),SHORT_15M_TRADE:mk()};
  const x=compactExperienceMemory({caseMemoryByLane:lanes,caseMemory:mk(),tradeLessons:{worked:['x'],failed:['y']},measuredOutcomes:[],jevLessons:[]},8500);
  assert.ok(JSON.stringify(x).length<=9000);assert.ok(x.caseMemoryByLane.LONG_5M_SCALP.analogs.length<=2);
});

test('R2544.19 context budget trims optional case/OSS before rejecting core market packet',()=>{
  const huge='X'.repeat(12000);
  const state={professionalTraderCortex:{reference:huge},dynamicKnowledge:{entries:Array.from({length:12},(_,i)=>({topic:'T'+i,summary:huge,keyPoints:[huge],sourceUrls:['https://example.com']}))},experienceMemory:{caseMemory:{version:'R2544.19',available:true,analogs:Array.from({length:8},(_,i)=>({symbol:'C'+i,lesson:huge}))},measuredOutcomes:Array.from({length:20},()=>({why:huge})),jevLessons:Array.from({length:20},()=>({why:huge}))},coreMarketPacket:{coreFrames:{'5m':frame(),'15m':frame()},timingFrames:{'1m':frame(),'3m':frame()},higherContext:{'1h':frame(),'4h':frame()},microstructure:{available:true,depth20Imbalance:0.2},derivatives:{fundingRate:0.001},liquidationContext:{available:true}},record:{entryThesis:{why:'core thesis'}}};
  const r=prepareDecisionRequest({model:'x',state,questions:{trade_plan:{type:'x'}}});
  assert.equal(r.ok,true);assert.ok(r.diagnostics.bytes<=MAX_DECISION_REQUEST_BYTES);assert.equal(r.diagnostics.contextBudget.coreMarketPriority,true);assert.ok(r.diagnostics.trimStepsApplied.some(x=>x==='SEMANTIC_OPTIONAL_CONTEXT_PROJECTION'||x==='OPTIONAL_CONTEXT_TIGHT'));assert.equal(r.diagnostics.coreTruthProtected,true);assert.ok(r.body.state.coreMarketPacket.coreFrames['5m']);
});

test('R2544.19 OSS provenance adds only verified-license requested references',()=>{
  const by=new Map(CURATED_OPEN_SOURCE_REPOS.map(x=>[x.repo,x]));
  for(const repo of ['MarcoSalzer/crypto-microstructure','mamonet/orderbook-heatmap','twowaymind/orderflow-metrics','ml4t/engineer','juitindev/crypto-market-data-pipeline']){
    assert.equal(by.get(repo)?.license,'MIT',repo);assert.ok(by.get(repo)?.why);assert.ok(by.get(repo)?.concepts?.length);
  }
  assert.equal(by.has('mkih76/binance-orderflow'),false); // GitHub metadata exposed no verified license during R2544.19 build.
  assert.equal(by.has('ndt93/FinancialML'),false);        // same: do not silently ingest unknown-license code.
});



test('R2544.19 public-L2 pull/replenishment heuristics become observable case tags only',()=>{
  const u=unified();u.marketMakerEvidence={bookBehavior:{available:true,semantics:'HEURISTIC_PUBLIC_L2_PLUS_AGGTRADE_EVIDENCE_ONLY',possibleLiquidityPulls:[{side:'ASK',price:101,removedQuote:5000,remainingQuote:20,nearbyTradedQuote:100}],replenishment:[{side:'BID',price:99,currentQuote:4000,persistence:0.8,confidence:0.7}],absorption:{available:false}}};
  const events=cm.microstructureEvents(u,{side:'LONG'}).map(x=>x.type);
  assert.ok(events.includes('RESTING_LIQUIDITY_PULLED'));assert.ok(events.includes('RESTING_LIQUIDITY_HELD'));
});

test('R2544.19 oversized learning close stays parseable JSON and preserves compact entry case',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bh-r254419-learning-'));const st=openStore(tmp);
  const ec=cm.buildEntryCase({unified:unified(),candidate:{symbol:'TESTUSDT'},plan:{side:'LONG',setupFamily:'TREND_PULLBACK',lane:'5M_SCALP',why:'Y'.repeat(500)},entryPrice:100,stopPrice:98,takeProfit1:103});
  const id=st.recordLearning('POSITION_CLOSED','TESTUSDT',{symbol:'TESTUSDT',side:'LONG',netPnl:5,rMultiple:1,openedAt:new Date(Date.now()-60000).toISOString(),closedAt:new Date().toISOString(),entryContext:{setupFamily:'TREND_PULLBACK',entryCase:ec,oversized:'Z'.repeat(50000)},outcomePath:{mfeR:1.4,maeR:-0.2,events:Array.from({length:80},(_,i)=>({kind:'X',at:i,reason:'R'.repeat(300)}))}});
  const row=st.db.prepare('SELECT payload FROM learning_events WHERE id=?').get(id);assert.ok(row?.payload);const parsed=JSON.parse(row.payload);assert.equal(parsed.symbol,'TESTUSDT');assert.ok(parsed.entryContext?.entryCase?.snapshotHash);assert.ok(row.payload.length<=32000);
});

test('R2544.22 runtime/Office preserve case memory, provenance and read-only authority',()=>{
  assert.match(src('server.js'),/R2544\.32-JEV-CAUSAL-BREAK-TREND/);
  assert.match(src('server.js'),/\/learning\/case-memory/);
  assert.match(src('office-dashboard/office-server.js'),/2\.5\.12-R2544\.32-JEV-Brain/);
  assert.match(src('office-dashboard/public/office.html'),/Vaka Hafızası/);
  assert.match(src('office-dashboard/public/office.html'),/Açık Kaynak Bilgi Provenance/);
  assert.match(src('manage.ps1'),/case-memory\.js/);
});
