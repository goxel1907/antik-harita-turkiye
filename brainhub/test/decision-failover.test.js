'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createJevClient}=require('../jev-decision');
const {createCommittee}=require('../model-committee');
const F=require('../decision-failover');
const DESK=require('../position-desk');
const {advisorRequest,evaluateGoxel}=require('../decision-advisors');
const key='sk-or-v1-'+'x'.repeat(40);
const failure={ok:false,reason:'JEV_HTTP_ERROR',httpStatus:402};
const response=(status,body)=>({ok:status===200,status,text:async()=>JSON.stringify(body)});
function root(t,extra={}){const p=fs.mkdtempSync(path.join(os.tmpdir(),'credit-failover-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));
  fs.mkdirSync(path.join(p,'config'));fs.writeFileSync(path.join(p,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2,...extra}));return p;}
function answersFor(body,overrides={}){return Object.fromEntries(Object.entries(body.questions).map(([k,q])=>[k,q.type==='choice'?{choice:overrides[k]||Object.keys(q.criteria)[0],confidence:0.7}:{probability:0.6}]));}
function vote(body,answers,id){const a=F.validateAnswers(body,{answers});return {member:id,model:id,ok:!!a,vote:a?{ok:true,answers:a,proposal:F.signature(body,a)}:null};}
function unanimous(body,answers=answersFor(body)){const votes=['one','two','three'].map(id=>vote(body,answers,id));return {ok:true,final:votes[0].vote.proposal,consensus:'UNANIMOUS',votes,rounds:1};}
function stubFallback(select=body=>answersFor(body),inspect=()=>{}){return F.createCommitteeFallback({committee:{decide:async args=>{
  const body=JSON.parse(args.prompt);inspect(body,args);return unanimous(body,select(body));}}});}
function context(){const frame={available:true,fresh:true,asOf:Date.now(),close:100,trend:'UP',atrPct:1,candle:{closed:true},patterns:[],liquidity:{buySide:105,sellSide:98},swingStructure:{lastConfirmedSwingLow:{price:98},lastConfirmedSwingHigh:{price:102}}};
  return {symbol:'BTCUSDT',livePrice:100,frames:Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf=>[tf,{...frame}])),
    dataQuality:{advisoryUsable:true},microstructure:{available:true,spreadBps:1},global:{},derivatives:{},opportunityPaths:{LONG:{continuity:[]},SHORT:{continuity:[]}},learning:{recent:[],stats:[]}};}
const routeAnswers=body=>answersFor(body,{lane_focus:'5M_SCALP',direction_focus:'LONG'});

test('typed answers reject unknown choices, omitted questions, invalid probabilities and text',()=>{
  const body={questions:{lane_focus:{type:'choice',criteria:{BOTH:'both'}},p:{type:'noul'}}};
  assert.equal(F.validateAnswers(body,{answers:{lane_focus:{choice:'BUY'},p:{probability:.5}}}),null);
  assert.equal(F.validateAnswers(body,{answers:{lane_focus:{choice:'BOTH'}}}),null);
  assert.equal(F.validateAnswers(body,{answers:{lane_focus:{choice:'BOTH'},p:{probability:2}}}),null);
  assert.equal(F.parseResponse('prefix {"answers":{}} trailing'),null);
  assert.deepEqual(F.parseResponse('```json\n{"answers":{}}\n```'),{answers:{}});
});
test('backup requires whole-proposal majority, two distinct members, and reports the real owner',async()=>{
  const body={state:{symbol:'BTCUSDT'},questions:{burst_decision:{type:'choice',criteria:{ARM_LONG:'yes',DO_NOT_ARM:'no'}},ttl:{type:'choice',criteria:{TTL_120S:'120',TTL_180S:'180'}}}};
  const a=answersFor(body),b=answersFor(body,{ttl:'TTL_180S'});
  let result={ok:true,final:F.signature(body,a),rounds:1,votes:[vote(body,a,'one'),vote(body,b,'two'),{member:'three',ok:false}]};
  const run=F.createCommitteeFallback({committee:{decide:async()=>result}});
  assert.equal((await run({body,failure})).ok,false,'matching direction alone cannot authorize different TTLs');
  result=unanimous(body);let out=await run({body,failure});assert.equal(out.ok,true);assert.equal(out.route.owner,'COMMITTEE');assert.equal(out.route.agreeing,3);assert.equal(out.costUsd,null);
  result.votes=[result.votes[0],result.votes[0]];assert.equal((await run({body,failure})).ok,false,'duplicate identity is one vote');
});
test('real committee answers the same typed schema and preserves the original state',async t=>{
  const p=root(t),members=['ROUTER:kr/claude-sonnet-4.5','ROUTER:kr/deepseek-3.2','FREE:openrouter'].map(id=>({id,call:async({prompt})=>{
    let b;try{b=JSON.parse(prompt);}catch{};
    return {ok:true,model:id,text:JSON.stringify(b?.questions?{answers:routeAnswers(b)}:{ok:true})};}}));
  const c=createCommittee({members,healthFile:path.join(p,'health.json')});await c.probe({force:true});
  const body={state:{coreMarketPacket:{symbol:'BTCUSDT',livePrice:100},experienceMemory:{lesson:'measured'},advisors:{source:'GOXEL_PRO'}},questions:{lane_focus:{type:'choice',criteria:{'5M_SCALP':'scalp'}},direction_focus:{type:'choice',criteria:{LONG:'long'}}}};
  const before=JSON.stringify(body),out=await F.createCommitteeFallback({committee:c})({body,failure});
  assert.equal(out.ok,true);assert.ok(out.route.members.length>=2);assert.equal(JSON.stringify(body),before);
});
test('402 falls back; later passes skip paid retries for five minutes, then recover to JEV',async t=>{
  let at=Date.UTC(2026,10,16,12),calls=0,credit=false;
  const p=root(t);let seen;
  const client=createJevClient({root:p,apiKey:key,clock:()=>at,committeeFallback:stubFallback(routeAnswers,b=>{seen=b;}),
    decisionAdvisors:async()=>({authority:'EVIDENCE_ONLY',source:'GOXEL_PRO',available:true}),
    fetchImpl:async(_url,opt)=>{calls++;return credit?response(200,{answers:routeAnswers(JSON.parse(opt.body)),usage:{cost:.001}}):response(402,{error:'insufficient credits'});}});
  const args={candidate:{symbol:'BTCUSDT'},unified:context()};
  const a=await client.sovereignPass1(args);assert.equal(a.ok,true);assert.equal(a.model,'COMMITTEE');assert.equal(a.finalAuthority,'COMMITTEE');
  assert.equal(a.decisionOwner,'COMMITTEE');assert.equal(a.costUsd,null);assert.equal(calls,1);assert.equal(seen.state.advisors.source,'GOXEL_PRO');
  assert.equal(JSON.stringify(seen).includes(key),false);
  const b=await client.sovereignPass1(args);assert.equal(b.ok,true);assert.equal(calls,1);assert.equal(b.jevCalled,false);
  at+=300001;credit=true;const c=await client.sovereignPass1(args);assert.equal(c.ok,true);assert.equal(c.model,'typesafe/jev-1.13');assert.equal(calls,2);
  assert.equal(client.localStatus().decisionFailover.last.owner,'JEV');
});
test('daily budget failure uses backup without paid requests or modifying the user cap',async t=>{
  const p=root(t,{dailyCapUsd:.01,reservePerCallUsd:.002});let calls=0;
  fs.mkdirSync(path.join(p,'data'));fs.writeFileSync(path.join(p,'data','jev-usage.json'),JSON.stringify({day:new Date().toISOString().slice(0,10),spentUsd:.01,calls:1}));
  const client=createJevClient({root:p,apiKey:key,committeeFallback:stubFallback(routeAnswers),fetchImpl:async()=>{calls++;throw Error('unexpected');}});
  const out=await client.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:context()});
  assert.equal(out.ok,true);assert.equal(out.decisionOwner,'COMMITTEE');assert.equal(calls,0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(p,'config','jev.json'))).dailyCapUsd,.01);
});
test('auth errors and invalid burst input never obtain backup permission',async t=>{
  const p=root(t);let called=0;const client=createJevClient({root:p,apiKey:key,committeeFallback:async()=>{called++;return {};},fetchImpl:async()=>response(401,{error:'wrong key'})});
  assert.equal((await client.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:context()})).ok,false);assert.equal(called,0);
  assert.equal((await client.sovereignBurstArm({candidate:{symbol:'bad'}})).ok,false);assert.equal(called,0);
  assert.equal(F.creditFailure({ok:false,reason:'JEV_REQUEST_CONTEXT_TOO_LARGE'}),false);
  assert.equal(F.creditFailure({ok:false,httpStatus:429}),false);
});
test('primary success never spends committee calls',async t=>{
  const p=root(t);let fallback=0;const client=createJevClient({root:p,apiKey:key,committeeFallback:async()=>{fallback++;},fetchImpl:async(_u,o)=>response(200,{answers:routeAnswers(JSON.parse(o.body)),usage:{cost:.001}})});
  assert.equal((await client.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:context()})).ok,true);assert.equal(fallback,0);
});
for(const lane of ['5M_SCALP','15M_TRADE'])test(`credit backup selects a supplied ${lane} plan through the original semantic validator`,async t=>{
  const p=root(t);const select=body=>{const a=answersFor(body,{trade_plan:'PLAN_LONG',entry_timing:'MARKET_NOW',wait_reason:'NONE_MARKET_NOW'});
    for(const k of ['setup_family','edge_basis']){const keys=Object.keys(body.questions[k].criteria);a[k]={choice:keys.find(x=>!['NONE_WAIT','NO_EDGE','ORDER_FLOW_DEPTH'].includes(x))};}return a;};
  const client=createJevClient({root:p,apiKey:key,committeeFallback:stubFallback(select),fetchImpl:async()=>response(402,{error:'credits'})});
  const out=await client.sovereignFinal({candidate:{symbol:'BTCUSDT'},unified:context(),evidence:{},planOptions:[{id:'PLAN_LONG',side:'LONG',lane,originTF:lane==='5M_SCALP'?'5m':'15m',ownerTF:lane==='5M_SCALP'?'5m':'15m',entryPrice:100,invalidationPrice:99,stopPrice:99,takeProfit1:101,takeProfit2:102,takeProfit3:103}]});
  assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.selectedPlan.id,'PLAN_LONG');assert.equal(out.decisionOwner,'COMMITTEE');assert.equal(out.finalAuthority,true);
});
test('position exit and burst authorization/exit use original contracts with committee attribution',async t=>{
  const p=root(t);const client=createJevClient({root:p,apiKey:key,committeeFallback:stubFallback(body=>answersFor(body,{position_action:'EXIT_NOW',burst_decision:'ARM_LONG',burst_exit:'EXIT_NOW'})),fetchImpl:async()=>response(402,{error:'credits'})});
  const u=context();const exit=await client.sovereignExit({position:{symbol:'BTCUSDT',side:'LONG',entryPrice:100,markPrice:99,quantity:1},lifecycle:{},currentPlan:{},unified:u});
  assert.equal(exit.ok,true);assert.equal(exit.finalAuthority,true);assert.equal(exit.action,'EXIT_NOW');assert.equal(exit.decisionOwner,'COMMITTEE');assert.doesNotMatch(exit.summaryTr,/JEV/);
  const chartContext={available:true,symbol:'BTCUSDT',packet:{symbol:'BTCUSDT'},asOf:Date.now(),ageMs:0};
  const arm=await client.sovereignBurstArm({candidate:{symbol:'BTCUSDT'},preMove:{state:'IGNITION',direction:'LONG'},stream:{symbol:'BTCUSDT',available:true,ageMs:0},chartContext});
  assert.equal(arm.ok,true);assert.equal(arm.side,'LONG');assert.equal(arm.finalAuthority,'COMMITTEE');
  const burstExit=await client.sovereignBurstExit({active:{burstId:'b1',symbol:'BTCUSDT',side:'LONG',entryPrice:100,stopPrice:99,openedAt:Date.now()-10000},stream:{available:true,ageMs:0},progress:{},chartContext});
  assert.equal(burstExit.ok,true);assert.equal(burstExit.action,'EXIT_NOW');assert.equal(burstExit.decisionOwner,'COMMITTEE');
});
test('failed quorum cannot become a valid normal, burst or position decision',async t=>{
  const p=root(t);const c=createJevClient({root:p,apiKey:key,committeeFallback:F.createCommitteeFallback({committee:{decide:async()=>({ok:true,final:'NO_CONSENSUS',votes:[]})}}),fetchImpl:async()=>response(402,{})});
  const a=await c.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:context()});assert.equal(a.ok,false);assert.equal(a.failoverReason,'FAILOVER_NO_CONSENSUS');
  const x=await c.sovereignExit({position:{symbol:'BTCUSDT',side:'LONG',entryPrice:100},lifecycle:{},currentPlan:{},unified:context()});assert.equal(x.ok,false);assert.equal(x.finalAuthority,false);assert.equal(x.action,'HOLD_REVIEW');
});
test('existing desk fallback now receives Goxel observations unchanged',async()=>{
  const packet={symbol:'BTCUSDT',side:'LONG',stopChoices:{KEEP:null}};const advisors={goxel:{at:1,saysExit:true,screens:[{screen:'TREND',against:true}]}};let seen;
  const out=await DESK.judge({packet,advisors,mode:'LIVE',cfg:{liveJudges:['JEV','COMMITTEE']},stats:{},judges:{jev:async()=>({ok:false,reason:'CREDITS'}),committee:{decide:async args=>{seen=args.prompt;return {ok:true,final:'HOLD',votes:[],rounds:1};}}}});
  assert.equal(out.ok,true);assert.equal(out.judge,'COMMITTEE');assert.ok(seen.includes('saysExit'));assert.equal(packet.advisors,undefined);
});
test('Goxel evidence labels unavailable data and reads original fills without granting authority',()=>{
  assert.equal(advisorRequest({state:{record:{symbol:'BTCUSDT'}}}).symbol,'BTCUSDT');
  const empty=evaluateGoxel({symbol:'BTCUSDT',at:1});assert.equal(empty.available,false);assert.equal(empty.authority,'EVIDENCE_ONLY');
  const missing=evaluateGoxel({symbol:'BTCUSDT',position:{symbol:'BTCUSDT',side:'LONG',entryPrice:100},pk:{timeframes:{}},at:1});assert.equal(missing.available,false);
  assert.equal(advisorRequest({state:{coreMarketPacket:{symbol:'BTCUSDT'},record:{position:{symbol:'ETHUSDT'}}}}).valid,false);
});
test('Goxel position evidence contains nine real screens and uses the fill rather than the candle open',()=>{
  const start=Date.UTC(2026,10,16,12),pk={timeframes:Object.fromEntries(['m5','m15','h1','h4','d1'].map(k=>[k,{structure:{trend:'RANGE',atrPct:1},chartReading:{events:[],patterns:[]}}]))};
  const out=evaluateGoxel({symbol:'BTCUSDT',position:{side:'LONG',entryPrice:100,stopPrice:99,openedAt:start},
    pk,sc:{taker:1.2,imb1:.1,oiChgPct:1},candles:[[start,90,102,89,101,100]],at:start+400000});
  assert.equal(out.available,true);assert.equal(out.screens.length,9);assert.equal(out.curR,1);assert.equal(out.authority,'EVIDENCE_ONLY');
  assert.equal(out.orderPlaced,undefined);assert.equal(out.initialStop,99);
});
test('overlapping requests keep their own fallback owner, symbol and packet identity',async t=>{
  const p=root(t),pending=[],fallback=stubFallback(routeAnswers);
  const client=createJevClient({root:p,apiKey:key,fetchImpl:async()=>response(402,{}),
    committeeFallback:req=>new Promise(resolve=>pending.push(()=>fallback(req).then(resolve)))});
  const u=context(),a=client.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:u});
  const b=client.sovereignPass1({candidate:{symbol:'ETHUSDT'},unified:{...u,symbol:'ETHUSDT'}});
  for(let n=0;n<50&&pending.length<2;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,2);pending[1]();pending[0]();const [x,y]=await Promise.all([a,b]);
  assert.equal(x.decisionRoute.symbol,'BTCUSDT');assert.equal(y.decisionRoute.symbol,'ETHUSDT');
  assert.notEqual(x.decisionRoute.requestId,y.decisionRoute.requestId);assert.notEqual(x.decisionRoute.packetHash,y.decisionRoute.packetHash);
});
test('a fallback exception leaves entry unauthorized and does not modify learning/preferences',async t=>{
  const p=root(t);fs.mkdirSync(path.join(p,'data'));const learning=path.join(p,'data','learning.json'),sizing=path.join(p,'config','user-sizing.json');
  fs.writeFileSync(learning,'{"learned":123}');fs.writeFileSync(sizing,'{"margin":15}');
  const client=createJevClient({root:p,apiKey:key,fetchImpl:async()=>response(402,{}),committeeFallback:async()=>{throw Error('offline');}});
  const out=await client.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:context()});assert.equal(out.ok,false);assert.equal(out.failoverReason,'FAILOVER_EXCEPTION');
  assert.equal(fs.readFileSync(learning,'utf8'),'{"learned":123}');assert.equal(fs.readFileSync(sizing,'utf8'),'{"margin":15}');
});
test('optional slow Goxel evidence cannot stall the primary decision',async t=>{
  const p=root(t);let seen;
  const c=createJevClient({root:p,apiKey:key,advisoryTimeoutMs:5,decisionAdvisors:()=>new Promise(()=>{}),
    fetchImpl:async(_u,o)=>{seen=JSON.parse(o.body);return response(200,{answers:routeAnswers(seen),usage:{cost:.001}});}});
  const out=await c.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:context()});
  assert.equal(out.ok,true);assert.equal(seen.state.advisors.available,false);assert.equal(seen.state.advisors.reason,'GOXEL_ADVISOR_PENDING');
});
test('disabled JEV does not activate either backup or market-advisor requests',async t=>{
  const p=root(t,{enabled:false});let calls=0;const fail=async()=>{calls++;throw Error('must not call');};
  const c=createJevClient({root:p,apiKey:key,decisionAdvisors:fail,committeeFallback:fail,fetchImpl:fail});
  assert.equal((await c.sovereignPass1({candidate:{symbol:'BTCUSDT'},unified:context()})).ok,false);assert.equal(calls,0);
});
test('Office reports a connected backup honestly without claiming that a trade was authorized',()=>{
  const office=require('../office-dashboard/office-server');
  const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'..','office-dashboard','demo-sim-v109.json')));
  snapshot.status.ok=true;snapshot.status.data.jev={budget:{canReserveNextCall:false,remainingUsd:0,reservePerCallUsd:.002,dailyCapUsd:1},
    provider:{lastError:{httpStatus:402}},decisionFailover:{wired:true}};
  const blockers=office.derive(snapshot).blockers;
  const credit=blockers.find(b=>b.code==='JEV_PROVIDER_CREDITS');assert.equal(credit.level,'warning');assert.match(credit.detail,/çoğunluk yoksa yeni giriş açılmaz/);
  snapshot.status.data.jev.decisionFailover.wired=false;
  assert.equal(office.derive(snapshot).blockers.find(b=>b.code==='JEV_PROVIDER_CREDITS').level,'critical');
});
