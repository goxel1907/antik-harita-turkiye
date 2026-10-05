'use strict';
// R42 (Claud-Work): live 05.10 position-management requests were 49-54 kB and 100% blocked at the
// 48 kB ceiling (PASS-2: 43%), and the urgent review retried every 5 s with a paid PASS-1 call.
// Fixture: R41 runtime packet shape (public market data). Soft context is synthetic but live-sized.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const J=require('../jev-decision'),{marketPacket}=require('../jev-market-packet');
const {expandMarketPacket}=require('../jev-wire-market');
const {buildSovereignEvidence}=require('../pipeline');
const {createReviewScheduler}=require('../review-scheduler');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r42-carv-r41-packet.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));

function unifiedFromPacket(p){
  const m=p.microstructure,frames={...clone(p.coreFrames),...clone(p.timingFrames),...clone(p.higherContext)};
  for(const [tf,f] of Object.entries(frames))f.officeOverlay=p.chartOverlayLevels[tf];
  return {symbol:p.symbol,livePrice:p.livePrice,frames,global:p.global,dataQuality:{...p.dataQuality,advisoryUsable:true},
    microstructure:{...m,streaming:{...m,cvdCoverageMs:(m.cvdCoverageSec||0)*1000},liquidationHistory:p.liquidationHistory},
    marketMakerEvidence:{bookBehavior:m.bookBehavior,preEntryAdverseSelection:m.preEntryAdverseSelection},
    liquidationContext:p.observedLiquidations,derivatives:p.derivatives};
}
// Live-sized synthetic soft context (no real account history): ~5 kB raw experience, three verified notes.
function syntheticLearning(){
  const note=t=>t+' Measured soft context only; never a hard gate, sizing change or execution rule. '.repeat(2);
  const lane=k=>({version:'R42-SYNTH',available:true,samples:7,summary:{netPnl:-1.25,avgR:-0.04},fidelity:{immutable:5,immutableR254421:1,immutableR254420:1,legacyPartial:0,note:note('Fidelity of '+k+'.')},counterexamples:{winnerCount:3,loserCount:4,note:note('Winners and losers both kept for '+k+'.')},analogs:[],softContextOnly:true,executionAuthority:false});
  return {tradeLessons:{version:'R42-SYNTH',samples:220,lifetime:{n:220,winPct:46,net:-150.5,pf:0.81,avgWin:4.1,avgLoss:-4.2},payoffRatio:{value:0.98},cols:['key','n','win%','netUSDT','PF','avgWin','avgLoss'],
      byTierSide:[],byFamilySide:[],byRegimeSide:[],byPreEntryFlow:[],byPriceAction:[],byFvgLifecycle:[],priceActionGrouping:note('Grouping.'),byExit:[],worked:[],failed:[],repeatedMistakes:[],howToUse:note('Use rows as calibration.'),
      current:{tier:'4-10',tierTr:'4-10',cols:['n','win%','net'],LONG:[3,33,-2.1],SHORT:[2,50,1.4]},sequence:{recent60:{closes:1,net:-7.2},lastClose:{side:'LONG',net:-7.2},candidate:'SYNTHUSDT',quickSwitchAfterLoss:true,returnToRecentSymbol:true,sameSymbolRecent:1,note:note('Sequence.')}},
    caseMemory:{version:'R42-SYNTH',available:true,samples:12,analogs:[],winners:[],losers:[],fidelity:{immutable:10,immutableR254421:1,immutableR254420:1,legacyPartial:0,note:note('Fidelity.')},counterexamples:{winnerCount:5,loserCount:7,note:note('Counterexamples.')},summary:{netPnl:-3.5,avgR:-0.05},softContextOnly:true,selfModify:false,autoPromotionToRules:false,executionAuthority:false},
    caseMemoryByLane:Object.fromEntries(['LONG_5M_SCALP','SHORT_5M_SCALP','LONG_15M_TRADE','SHORT_15M_TRADE'].map(k=>[k,lane(k)])),
    source:'BrainHub measured experience memory',measuredSampleCount:220,jevLessonCount:40,lifetime:{measuredSamples:220,wins:100,losses:118,flats:2,winRatePct:45.9,avgOutcomePct:-0.1,representation:'SYNTHETIC_TEST'}};
}
function liveRoot(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-r42-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const d of ['config','docs','data'])fs.mkdirSync(path.join(root,d));
  fs.writeFileSync(path.join(root,'config/jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  fs.copyFileSync(path.join(__dirname,'..','docs','JEV-PRO-TRADER-CORTEX-R2534.md'),path.join(root,'docs','JEV-PRO-TRADER-CORTEX-R2534.md'));
  const entry=i=>({status:'VERIFIED_REFERENCE',topic:'Synthetic verified note '+i,family:'PRICE_ACTION',verifiedAt:'2026-10-04T00:00:00Z',summary:'Synthetic reference summary. '.repeat(30),keyPoints:['Point one. '.repeat(8),'Point two. '.repeat(8)],sourceUrls:['https://example.invalid/'+i]});
  fs.writeFileSync(path.join(root,'data/jev-knowledge.json'),JSON.stringify({entries:[entry(1),entry(2),entry(3)]}));
  return root;
}
function liveLifecycle(p){
  const pick=f=>({trend:f.trend,breakOfStructure:f.breakOfStructure,rsi14:f.rsi14,atrPct:f.atrPct,swingState:f.structure,patterns:clone(f.patterns||[]).slice(-3),readout:{stretchState:f.readout?.stretchState,zone:f.readout?.zone}});
  const thesis={regime5m:pick(p.coreFrames['5m']),regime15m:pick(p.coreFrames['15m'])};
  return {thesis,lifecycle:{originTF:'15m',ownerTF:'15m',setup:'JEV_R2537_SWEEP_RECLAIM_15M_TRADE',initialQuantity:9426,initialEntryPrice:0.05092,initialStopPrice:0.05396,initialInvalidationPrice:0.0539,stopPrice:0.05396,
    entryPlan:{why:'15m sweep and reclaim below the swing high; short continuation.',setupFamily:'SWEEP_RECLAIM',entryTiming:'MARKET_NOW',edgeBasis:'STRUCTURE_LOCATION',lane:'15M_TRADE',takeProfit1:0.04793,takeProfit2:0.04491,takeProfit3:0.0419,managementStyle:'STRUCTURE_HOLD',partialProfile:'HALF_QUARTER_RUNNER'},
    entryContext:{why:'15m sweep and reclaim below the swing high; short continuation.',marketSignature:thesis},
    managementState:{phase:'INITIAL',mfeR:0.0081,maeR:-0.36,initialQuantity:9426,remainingQuantity:9426,remainingFraction:1,reducedFraction:0,partialProfile:'HALF_QUARTER_RUNNER',partialFractions:[0.5,0.25,0.25],breakevenRule:'STRUCTURE_ONLY',trailRule:'15M_STRUCTURE',
      recentManagementEvents:[{at:'2026-10-05T11:45:28.605Z',kind:'REGISTERED',runnerOrdersLive:true,entryPrice:0.05092,initialQty:9426,tpQty:[4713,2356,2357],tpPlaced:2},{at:'2026-10-05T11:45:35.162Z',kind:'LIQUIDATION_CHECK',estimated:0.0543,exchange:0.0593,marginMode:'CROSSED'}],recentJevActions:[]},
    managementContract:{enabled:true,minR:0,maxReviewPartials:2,minSpacingMin:10,reviewPartialsTaken:0,lastPartialAt:null,progressR:-0.193,allow:false,reason:'PARTIAL_DEFERRED_BELOW_MIN_R',guardScaleOut:'DISABLED_BY_JEV_PROFILE',
      rule:'PARTIAL_TAKE_PROFIT executes only inside the profit-partial contract: after TP1 fills, a partial needs progressR >= 1 (price beyond TP1) and must leave at least 25% of the initial size as the runner. REDUCE_RISK is a separate adverse-position action and never counts as profit taking. Mechanical 0.5R scale-out is disabled for 15M trades and JEV runner-heavy/structure-hold profiles. EXIT_NOW is never restricted.'}}};
}

test('R42 live-sized position management request reaches JEV with protected position, thesis and market truth',async t=>{
  const p=clone(fixture.packet),unified=unifiedFromPacket(p);unified.learning=syntheticLearning();
  const evidence=await buildSovereignEvidence({candidate:{symbol:p.symbol},unified,pass1:{requestedEvidence:['TIMING_1M','ORDER_FLOW_CVD','DEPTH_L2','DERIVATIVES','TRADINGVIEW_15M']},committee:null,visionAudit:false});
  evidence.missing.push('PASS1_ROUTING_UNAVAILABLE:SYNTHETIC');
  const root=liveRoot(t),{thesis,lifecycle}=liveLifecycle(p);let sent;
  const client=J.createJevClient({root,apiKey:'sk-or-v1-fake',fetchImpl:async(_,opts)=>{sent=opts.body;
    return {ok:true,status:200,text:async()=>JSON.stringify({answers:{position_action:{choice:'HOLD'},partial_fraction:{choice:'P33'}},usage:{cost:0}})};}});
  const out=await client.sovereignExit({position:{symbol:p.symbol,side:'SHORT',entryPrice:0.050885,markPrice:0.05151,quantity:9426,unrealizedPnl:-5.89},lifecycle,currentPlan:null,unified,evidence});
  const log=JSON.parse(fs.readFileSync(path.join(root,'logs/jev-request-size.log'),'utf8').trim().split('\n').pop());
  assert.equal(out.called,true,JSON.stringify({reason:out.reason,bytes:log.bytes,sections:log.sections}));assert.equal(out.ok,true);
  assert.ok(log.beforeBytes>log.maxBytes,'scenario must be over the ceiling before compaction');
  assert.ok(Buffer.byteLength(sent)<=48000);assert.equal(log.blockReason,null);assert.equal(log.coreTruthProtected,true);
  assert.ok(log.trimStepsApplied.includes('MANAGEMENT_EVIDENCE_RESIDUAL'));
  const body=JSON.parse(sent),record=expandMarketPacket(body.state.record);
  assert.deepEqual(J.protectedCoreTruth(body),J.protectedCoreTruth({state:{...body.state,coreMarketPacket:marketPacket(unified)}}));
  assert.deepEqual(record.entryThesis.marketSignature,clone(thesis));
  assert.equal(record.position.quantity,9426);assert.equal(record.lifecycle.initialQuantity,9426);
  assert.equal(record.managementContract.reason,'PARTIAL_DEFERRED_BELOW_MIN_R');
  assert.deepEqual(record.requestedEvidence.requested,evidence.requested);
  assert.ok(record.requestedEvidence.missing.includes('PASS1_ROUTING_UNAVAILABLE:SYNTHETIC'),'routing failure stays visible to JEV');
  assert.match(body.state.description,/EXIT_NOW is never restricted/);assert.match(body.state.description,/REDUCE_RISK/);
  t.diagnostic(`R42 POSITION_MANAGEMENT: ${Buffer.byteLength(sent)} / 48000 bytes (before ${log.beforeBytes}); protected truth parity`);
});

test('R42 duplicate narrative prose cannot block a PASS-2 final decision; protected truth unchanged',()=>{
  const packet=clone(fixture.packet);
  for(const tf of ['5m','15m'])packet.chartNarrative.frames[tf].line=String(packet.chartNarrative.frames[tf].line||'')+' Closed-bar reading repeated from numeric frames.'.repeat(140);
  const body={model:'typesafe/jev-1.13',state:{description:'PASS-2 final.',coreMarketPacket:packet,record:{attention:{symbol:packet.symbol},executablePlanOptions:[]}},questions:{trade_plan:{type:'choice',criteria:{WAIT:'No plan now.'}}}};
  const before=J.protectedCoreTruth(body),out=J.prepareDecisionRequest(body);
  assert.equal(out.diagnostics.pass,2);assert.equal(out.ok,true,JSON.stringify({bytes:out.diagnostics.bytes,steps:out.diagnostics.trimStepsApplied}));
  assert.ok(out.diagnostics.beforeBytes>48000);assert.ok(out.diagnostics.bytes<=48000);
  assert.equal(out.diagnostics.fitBeforeBlock,true);assert.ok(out.diagnostics.trimStepsApplied.some(x=>x.startsWith('FIT_BEFORE_BLOCK_NARRATIVE')));
  assert.deepEqual(J.protectedCoreTruth(out.body),before);
  const sentPacket=expandMarketPacket(out.body.state.coreMarketPacket);
  assert.equal(sentPacket.chartNarrative.readingInNumericFrames,true);
});

test('R42 fit-before-block never trims protected truth: an oversized immutable thesis still fails closed',()=>{
  const body={model:'typesafe/jev-1.13',state:{coreMarketPacket:clone(fixture.packet),record:{contract:'R2.5.3.2_JEV_SOVEREIGN_POSITION_MANAGEMENT',entryThesis:{why:'immutable '.repeat(8000)},position:{quantity:100}}},questions:{action:{type:'choice'}}};
  const before=J.protectedCoreTruth(body),out=J.prepareDecisionRequest(body,{pass:'OTHER'});
  assert.equal(out.ok,false);assert.match(out.diagnostics.blockReason,/TOO_LARGE/);assert.deepEqual(J.protectedCoreTruth(out.body),before);
});

test('R42 urgent review that does not reach JEV backs off 5-10-20-40-60 s and resets after a JEV decision',async()=>{
  let now=0,calls=0,reach=false;const s=createReviewScheduler({clock:()=>now});
  const review=async o=>{calls++;assert.equal(o.urgentOnly,true);return {ok:true,urgentReview:true,jev:{called:reach,ok:reach,reason:reach?null:'JEV_REQUEST_CONTEXT_TOO_LARGE'}};};
  const runsAt=[];
  for(now=0;now<=200000;now+=1000){const before=calls;await s.tick({pending:true,review});if(calls>before)runsAt.push(now);}
  assert.deepEqual(runsAt.slice(0,7),[0,5000,15000,35000,75000,135000,195000]);
  assert.equal(s.state().nextUrgentRetryMs,60000);
  reach=true;now+=60000;await s.tick({pending:true,review});assert.equal(s.state().urgentFailures,0);assert.equal(s.state().nextUrgentRetryMs,5000);
});

test('R42 Office shows an unreachable JEV position judge, credit exhaustion, and no false coverage alarm while slots are full',()=>{
  const office=require('../office-dashboard/office-server.js');
  const review=(reason,called=false)=>({symbol:'CARVUSDT',side:'SHORT',action:'HOLD_REVIEW',jev:{called,ok:called,reason}});
  const snap=(history,lastError=null)=>({status:{ok:true,data:{armed:true,jevSovereign:{enabled:true},featureVersion:'9.5.113-CLAUDE-VISION',
    jev:{provider:{lastError}},positionManager:{history,ledger:{openCount:1}},
    leaderAuto:{enabled:true,health:{deepAnalyses:94,uniqueAnalyzedSymbols:55,coverage:{targetCount:24,staleCount:24,oldestStaleMs:43*60000},claudeV112:{positionRest:{active:true,openPositions:1,maxOpenPositions:1}}}}}}});
  const blocked=office.derive(snap([1,2,3,4,5,6].map(()=>review('JEV_REQUEST_CONTEXT_TOO_LARGE')))).blockers;
  const judge=blocked.find(x=>x.code==='JEV_POSITION_JUDGE_UNREACHED');
  assert.ok(judge,'unreachable judge is visible');assert.equal(judge.level,'serious');assert.match(judge.detail,/JEV_REQUEST_CONTEXT_TOO_LARGE/);
  assert.equal(blocked.find(x=>x.code==='COVERAGE').level,'info','stale queue is expected while slots are full');
  const healthy=office.derive(snap([review(null,true),review('JEV_REQUEST_CONTEXT_TOO_LARGE'),review('JEV_REQUEST_CONTEXT_TOO_LARGE')])).blockers;
  assert.equal(healthy.some(x=>x.code==='JEV_POSITION_JUDGE_UNREACHED'),false,'one real JEV call in the window is not an outage');
  const credits=office.derive(snap([],{httpStatus:402,category:'INSUFFICIENT_CREDITS',message:'Insufficient credits',at:'2026-10-05T11:05:02.447Z'})).blockers;
  assert.equal(credits.find(x=>x.code==='JEV_PROVIDER_CREDITS')?.level,'critical');
});

test('R42 busy pipeline skips are not counted as urgent review failures',async()=>{
  let now=0;const s=createReviewScheduler({clock:()=>now});
  for(let i=0;i<5;i++){await s.tick({pending:true,review:async()=>({ok:true,skipped:true,reason:'VISION_PIPELINE_BUSY'})});now+=5000;}
  assert.equal(s.state().urgentFailures,0);
});
