'use strict';
// R43 (Claud-Work, user decisions 05.10.2026): free 9Router/OpenRouter models actually selected, burst L2 slots,
// burst margin rule and JEV-held exits, stream windows aligned to exchange time, packet-relevant knowledge,
// and closes sent by an external actor kept out of strategy learning.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const R=require('../free-model-registry');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');
const {LocalL2Manager}=require('../local-l2');
const {StreamingMarket}=require('../market');
const {burstEvidence,exitEvidence,burstMarginRule}=require('../burst-scalp');
const J=require('../jev-decision');
const {matchFinalExit,orderSourceClass}=require('../close-exit-evidence');
const {enrichCloses,performanceReport}=require('../office-performance');
const {openStore}=require('../store');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r42-carv-r41-packet.json'),'utf8'));

test('R43 9Router selects only account-login free text tiers, lightest first; combos/auto/agentic/thinking never',()=>{
  const catalog=['grafik','claude-my-combo','gc/gemini-2.5-pro','gc/gemini-2.5-flash','gc/gemini-2.5-flash-lite','kr/auto','kr/claude-sonnet-4.5','kr/claude-sonnet-4.5-thinking','kr/claude-haiku-4.5-agentic','kr/claude-haiku-4.5','kr/glm-5','openai/gpt-x'];
  assert.deepEqual(R.select9RouterFreeModels({lastSuccessAt:1,models:catalog}),['gc/gemini-2.5-flash-lite','gc/gemini-2.5-flash','kr/claude-haiku-4.5','kr/glm-5','gc/gemini-2.5-pro','kr/claude-sonnet-4.5']);
  assert.equal(R.providerGroup('gc/gemini-2.5-flash'),'9ROUTER_GEMINI_CLI_QUOTA');
  assert.equal(R.is9RouterOpenCodeFreeId('kr/glm-5'),false,'OpenCode predicate itself is unchanged');
});

test('R43 provider errors: agent-only 403 and upstream 429 are model-level, key-level 429/401 stay key-level',()=>{
  assert.equal(R.classifyProviderError('HTTP 403 x:free is only available on agentic harnesses').class,'MODEL_UNAVAILABLE');
  assert.equal(R.classifyProviderError('HTTP 429 x:free is temporarily rate-limited upstream').class,'MODEL_RATE_LIMIT');
  assert.equal(R.classifyProviderError('HTTP 429 Rate limit exceeded: free-models-per-day').class,'RATE_LIMIT');
  assert.equal(R.classifyProviderError('HTTP 401 invalid key').class,'AUTH');
});

test('R43 OpenRouter free worker skips an agent-only model and a throttled provider, then uses a working free model',async()=>{
  const calls=[],reply=(status,body)=>({ok:status===200,status,headers:{get:()=>null},text:async()=>JSON.stringify(body)});
  // Pool order: openrouter/free (throttled upstream), the agent-only model, then the working model; 3 attempts.
  const worker=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',models:['a/agent-only:free','c/works:free'],maxAttempts:3,fetchImpl:async(_,o)=>{
    const b=JSON.parse(o.body);calls.push(b);
    if(b.model==='a/agent-only:free')return reply(403,{error:{message:b.model+' is only available on agentic harnesses'}});
    if(b.model==='openrouter/free')return reply(429,{error:{message:'openrouter/free is temporarily rate-limited upstream'}});
    return reply(200,{choices:[{message:{content:'WORKER_STATE: WAIT'},finish_reason:'stop'}]});
  }});
  const out=await worker.review({prompt:'p'});
  assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.requestedModel,'c/works:free');
  assert.equal(worker.status().cooldownUntil,0,'a model-level failure does not pause the worker');
  assert.ok(calls.every(b=>b.max_tokens===1536&&b.reasoning?.exclude===true));
});

test('R43 OpenRouter free worker stops spending its attempt on a model failing 3+ times in a row',async()=>{
  let now=1_000_000;const seen=[];
  const worker=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake',clock:()=>now,models:['x/chronic:free','y/new:free'],preferredModels:['x/chronic:free'],maxAttempts:1,fetchImpl:async(_,o)=>{
    const b=JSON.parse(o.body);seen.push(b.model);
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'WORKER_STATE: WAIT'},finish_reason:b.model==='x/chronic:free'?'length':'stop'}]})};
  }});
  for(let i=0;i<3;i++){await worker.review({prompt:'p'});now+=3_600_000;}
  assert.deepEqual(seen,['x/chronic:free','x/chronic:free','x/chronic:free'],'preferred model goes first while not chronic');
  const out=await worker.review({prompt:'p'});
  assert.notEqual(seen.at(-1),'x/chronic:free','after three straight failures an untested free model goes first');
  assert.equal(out.ok,true);
});

test('R43 local L2: two dedicated burst books join without evicting analysis; analysis capacity unchanged',()=>{
  let now=100000;const m=new LocalL2Manager({now:()=>now,maxSymbols:2,burstSlots:2});
  assert.ok(m.ensureSymbol('AAUSDT'));assert.ok(m.ensureSymbol('BBUSDT'));
  assert.ok(m.ensureSymbol('B1USDT',{priority:'BURST',leaseMs:60000}));
  assert.ok(m.ensureSymbol('B2USDT',{priority:'BURST',leaseMs:60000}));
  assert.equal(m.states.size,4);assert.equal(m.evictions,0);
  assert.equal(m.ensureSymbol('CCUSDT'),null,'analysis still limited to its own two books');
  const h=m.health();assert.equal(h.burstSlots,2);assert.equal(h.burstReserved,2);
  const legacy=new LocalL2Manager({now:()=>now,maxSymbols:1});legacy.ensureSymbol('AAUSDT');
  assert.equal(legacy.ensureSymbol('BBUSDT',{priority:'BURST'})!==null,true,'without burstSlots a burst still evicts as before');
});

test('R43 burst margin: flat uses half of the panel margin, in position uses half of free margin',()=>{
  assert.deepEqual(burstMarginRule({flat:true,panelMarginQuote:40,availableBalance:87.88}),{ok:true,marginQuote:20,rule:'FLAT_HALF_PANEL_MARGIN'});
  assert.equal(burstMarginRule({flat:true,panelMarginQuote:40,availableBalance:15}).reason,'BURST_PANEL_MARGIN_UNAVAILABLE');
  assert.deepEqual(burstMarginRule({flat:false,panelMarginQuote:40,availableBalance:46.4}),{ok:true,marginQuote:23.2,rule:'IN_POSITION_HALF_FREE_MARGIN'});
  assert.equal(burstMarginRule({flat:false,panelMarginQuote:40,availableBalance:0}).ok,false);
});

test('R43 burst exit after 120 s belongs to JEV while in profit; stop/fast-fail and the 10 min ceiling stay',()=>{
  const t0=1_000_000,snap={bid:101.9,ask:102.1,available:true,ageMs:100};
  const active={side:'LONG',entryPrice:100,stopPrice:99,openedAt:t0};
  const at=sec=>t0+sec*1000;
  assert.equal(exitEvidence(snap,active,at(130)).reason,'BURST_TIME_EXIT','no JEV decision: time exit');
  assert.equal(exitEvidence(snap,{...active,jevExitDecision:{action:'HOLD',receivedAt:at(127)}},at(130)).reason,null,'JEV HOLD in profit keeps the runner');
  assert.equal(exitEvidence(snap,{...active,jevExitDecision:{action:'HOLD',receivedAt:at(115)}},at(130)).reason,'BURST_TIME_EXIT','stale HOLD');
  assert.equal(exitEvidence({...snap,bid:99.8,ask:99.9},{...active,jevExitDecision:{action:'HOLD',receivedAt:at(128)}},at(130)).reason,'BURST_TIME_EXIT','HOLD while losing');
  assert.equal(exitEvidence(snap,{...active,jevExitDecision:{action:'HOLD',receivedAt:at(598)}},at(601)).reason,'BURST_TIME_EXIT','absolute ceiling');
  assert.equal(exitEvidence({...snap,bid:99.4,ask:99.5},{...active,jevExitDecision:{action:'HOLD',receivedAt:at(9)}},at(10)).reason,'BURST_FAST_FAIL');
});

function feed(m,symbol,{eventAt,rxAt}){
  const s=symbol;let n=0;
  for(let t=eventAt-2900;t<=eventAt;t+=100){n++;
    m.now=()=>rxAt-(eventAt-t);
    m.ingest({e:'bookTicker',s,E:t,T:t,u:n,b:String(100+n*0.001),B:String(50+n),a:String(100.02+n*0.001),A:String(40)});
    m.ingest({e:'aggTrade',s,E:t,T:t,p:String(100.01+n*0.001),q:'3',m:false});
  }
  m.now=()=>rxAt;
}
test('R43 stream windows follow exchange time when the PC clock is ahead or behind Binance',()=>{
  for(const skew of [900,-700]){
    const m=new StreamingMarket({WebSocketImpl:null});m.ensureSymbol('ABCUSDT');
    const eventAt=2_000_000_000_000;feed(m,'ABCUSDT',{eventAt,rxAt:eventAt+skew});
    const snap=m.snapshot('ABCUSDT',eventAt+skew);
    assert.ok(snap.orderFlow.windows['1s'].trades>=5,'1s window populated with skew '+skew);
    assert.equal(snap.level1Ofi.windows['3s'].available,true);
    assert.equal(burstEvidence({...snap,localL2:{available:true,sequenceHealthy:true,confidence:0.9}},'LONG').contradictions.includes('TRIGGER_WINDOW_INCOMPLETE'),false);
    assert.ok(Math.abs(m.health().clockAlignment.eventLagMs-Math.max(-3000,Math.min(1500,skew)))<=1);
  }
});

test('R43 alignment is bounded: a stream that stopped long ago still reads as stale',()=>{
  const m=new StreamingMarket({WebSocketImpl:null});m.ensureSymbol('ABCUSDT');
  const eventAt=2_000_000_000_000;feed(m,'ABCUSDT',{eventAt,rxAt:eventAt+400});
  const snap=m.snapshot('ABCUSDT',eventAt+400+20000);
  assert.equal(snap.available,false);
});

test('R43 the packet-relevant verified note survives knowledge compaction',()=>{
  const entries=[{topic:'BULL_FLAG_OR_PENNANT',summary:'newest'},{topic:'EVENING_STAR',summary:'older'},{topic:'BEARISH_ENGULFING',summary:'oldest'}];
  assert.equal(J.rankKnowledgeByPacket(entries,fixture.packet)[0].topic,'BEARISH_ENGULFING');
  const body={model:'typesafe/jev-1.13',state:{description:'PASS-1',coreMarketPacket:JSON.parse(JSON.stringify(fixture.packet)),dynamicKnowledge:{mode:'VERIFIED_READ_ONLY_DYNAMIC_REFERENCE',entries:entries.map(e=>({...e,keyPoints:['k'],sourceUrls:['https://example.invalid']}))},record:{attention:{symbol:fixture.packet.symbol}}},questions:{lane_focus:{type:'choice'}}};
  const out=J.prepareDecisionRequest(body);
  assert.equal(out.body.state.dynamicKnowledge.entries[0].topic,'BEARISH_ENGULFING');
  assert.deepEqual(J.protectedCoreTruth(out.body),J.protectedCoreTruth(body));
});

const start=Date.parse('2026-10-05T08:45:40Z'),end=Date.parse('2026-10-05T10:39:09Z');
const row={id:'C1',eventId:'E1',symbol:'ABCUSDT',side:'LONG',openedAt:new Date(start).toISOString(),closedAt:new Date(end).toISOString(),netPnl:-7.2,exitType:'EXTERNAL_CLOSE',entryPrice:1,quantity:10,riskQuote:10};
const fill={symbol:row.symbol,side:'SELL',positionSide:'BOTH',qty:'10',time:end-36000,orderId:230455643,id:7};
const order=cid=>({symbol:row.symbol,side:'SELL',positionSide:'BOTH',status:'FILLED',type:'MARKET',orderId:230455643,clientOrderId:cid});
test('R43 the final order source separates Binance UI, other API clients, BrainHub and liquidation',()=>{
  const ui=matchFinalExit(row,[fill],order('web_A1b2C3d4e5f6g7h8'),[]);
  assert.equal(ui.actor,'EXTERNAL_BINANCE_UI');assert.equal(ui.strategyOutcome,false);assert.equal(ui.confirmed,false);assert.equal(ui.clientOrderIdPrefix,'web_A1b2C3d4');
  assert.equal(matchFinalExit(row,[fill],order('x-agent-123'),[]).actor,'EXTERNAL_API_CLIENT');
  assert.equal(matchFinalExit(row,[fill],order('JX0123456789abcdef'),[]).actor,'BRAINHUB');
  assert.equal(matchFinalExit(row,[fill],order('autoclose-1234'),[]).strategyOutcome,null);
  assert.equal(orderSourceClass(null).clientOrderIdClass,'UNKNOWN');
  assert.equal(matchFinalExit(row,[fill],order('web_x'),[{symbol:row.symbol,side:'SELL',positionSide:'BOTH',actualOrderId:'230455643',algoId:'9',orderType:'STOP_MARKET'}]).version,'R2544.40','confirmed stop evidence keeps its version');
});

test('R43 an external close keeps its money in reports but leaves lessons, case memory and measured stats',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r43-actor-')),s=openStore(root);
  try{
    const cid=s.journal('POSITION_CLOSED',row.symbol,row);s.recordLearning('POSITION_CLOSED',row.symbol,row);
    assert.equal(s.tradeLessons().cards.length,1);
    const ev=matchFinalExit(row,[fill],order('web_A1b2C3d4e5f6'),[]);
    s.journal('CLOSE_EXIT_EVIDENCE',row.symbol,{closedId:cid,eventId:row.eventId,openedAt:row.openedAt,closedAt:row.closedAt,evidence:ev});
    assert.equal(s.tradeLessons().cards.length,0);
    const lc=s.learningContext();assert.equal(lc.measuredOutcomes.length,0);assert.equal(lc.excludedExternalActorCloses,1);
    const records=s.officeRecords();const [fixed]=enrichCloses([{...row,id:cid}],records);assert.equal(fixed.exitType,'EXTERNAL_ACTOR_CLOSE');
    assert.equal(performanceReport(records.slice().reverse(),[],end+1).total.netPnl,-7.2,'financial result unchanged');
  }finally{s.db.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('R43 an older MARKET-close record is read once more to learn the order source, then never again',async()=>{
  const {createLiveController}=require('../live-controller');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r43-requery-')),calls=[],events=[];let now=end+3600000;
  const old={kind:'CLOSE_EXIT_EVIDENCE',symbol:row.symbol,payload:{closedId:row.id,eventId:row.eventId,openedAt:row.openedAt,closedAt:row.closedAt,evidence:{version:'R2544.40',confirmed:false,exitType:'UNKNOWN_CLOSE',reason:'NON_CONDITIONAL_FINAL_ORDER',orderId:'230455643',orderType:'MARKET'}}};
  const prior=[0,1,2].map(i=>({...old,id:'P'+i,ts:end+60000+i*900000}));
  const store={journal:(kind,symbol,payload)=>{events.push({id:'X'+events.length,ts:now,kind,symbol,payload});},officeRecords:()=>[{id:row.id,ts:end,kind:'POSITION_CLOSED',symbol:row.symbol,payload:row},...prior,...events]};
  const fetchImpl=async(url,opts)=>{const u=new URL(url);calls.push(u.pathname);
    const bodies={'/fapi/v1/time':{serverTime:now},'/fapi/v3/positionRisk':[],'/fapi/v1/userTrades':[fill],'/fapi/v1/order':order('web_A1b2C3d4e5f6'),'/fapi/v1/allAlgoOrders':[]};
    if(!(u.pathname in bodies))throw Error('UNEXPECTED_FIXTURE_ROUTE '+u.pathname);
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(bodies[u.pathname])};};
  try{
    const c=createLiveController({root,store,clock:()=>now,scanner:{},pipeline:{},market:{},committee:async()=>({}),credentials:{apiKey:'fixture-only-key',apiSecret:'fixture-only-secret'},fetchImpl});
    await c.positionLedgerTick();
    const fresh=events.filter(x=>x.kind==='CLOSE_EXIT_EVIDENCE');assert.equal(fresh.length,1);assert.equal(fresh[0].payload.evidence.actor,'EXTERNAL_BINANCE_UI');
    now+=3600000;await c.positionLedgerTick();assert.equal(events.filter(x=>x.kind==='CLOSE_EXIT_EVIDENCE').length,1,'no further reads');
    assert.equal(calls.filter(x=>x==='/fapi/v1/order').length,1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
