'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const J=require('../jev-decision');
const {expandMarketPacket}=require('../jev-wire-market');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r42-carv-r41-packet.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));
function body(){
  return {model:'test',state:{coreMarketPacket:clone(fixture.packet),
    record:{contract:'R2544.58_TOP3_V2_GATE',symbol:fixture.packet.symbol,side:'SHORT',
      rule:'SHORT_TOP_BREAK',position:{quantity:0},riskState:{mode:'TEST',armed:false,marginQuote:30,leverage:10}},
    laneExperience:{rule:'SHORT_TOP_BREAK',closedLots:80,groups:[{n:80,netPnl:-2}],
      buckets:{volume:[{n:30,avgR:-0.1}]},labPriors:{samples:60},
      learning:{wins:35,losses:45,factors:Array.from({length:24},(_,i)=>({key:'factor'+i,value:i,lossPct:0.4,winPct:0.3,call:'MIXED'})),text:'Duplicate factor prose. '.repeat(100)},
      similar:{n:2,wins:1,losses:1,cases:[{symbol:'WINUSDT',R:1},{symbol:'LOSSUSDT',R:-1}]},
      recent:Array.from({length:6},(_,i)=>({symbol:'HIST'+i+'USDT',rMultiple:i%2?-1:1,
        resultPct:i%2?-2:2,mfePct:2,maePct:-2,exitType:'STOP_OR_TARGET',autopsy:'Measured outcome.',
        features:{rank:0,fund:0,premium:null,ind:{obstacle:false},experience:'MIXED',
          committee:{decision:'SKIP',shadow:true,votes:[{reason:'Archived vote. '.repeat(850)}]},
          leverageVote:{by:'KURUL',want:10,committee:{text:'Archived rationale. '.repeat(100)}},
          brain:{n:20,wins:10,losses:10,avgR:0,lean:'MIXED',cases:['Archived case. '.repeat(50)]},
          similar:{n:2,wins:1,losses:1,mixed:true,cases:['Old analog. '.repeat(50)]}}}))}},
    questions:{top3_decision:{type:'choice',criteria:{APPROVE_ENTRY:'Enter.',REJECT_ENTRY:'Skip.'}}}};
}
test('oversized lane history fits without changing identity, risk or protected market truth',()=>{
  const input=body(),snapshot=JSON.stringify(input),out=J.prepareDecisionRequest(input);
  assert.ok(out.diagnostics.beforeBytes>110000);
  assert.equal(out.ok,true,JSON.stringify({bytes:out.diagnostics.bytes,reason:out.diagnostics.blockReason}));
  assert.ok(out.diagnostics.bytes<=48000);
  assert.equal(Buffer.byteLength(out.serialized,'utf8'),out.diagnostics.bytes);
  assert.deepEqual(J.protectedCoreTruth(out.body),J.protectedCoreTruth(input));
  assert.deepEqual(out.body.state.record,input.state.record);
  assert.deepEqual(out.body.questions,input.questions);
  assert.equal(JSON.stringify(input),snapshot);
  const a=input.state.laneExperience,b=expandMarketPacket(out.body.state.laneExperience);
  for(const k of ['rule','closedLots','groups','buckets','labPriors','learning','similar'])assert.deepEqual(b[k],a[k]);
  assert.deepEqual(b.recent.map(x=>x.rMultiple),[1,-1]);
  assert.equal(b.recent[0].features.rank,0);
  assert.equal(b.recent[0].features.premium,null);
  assert.equal(b.recent[0].features.ind.obstacle,false);
  assert.equal(b.recent[0].features.committee.shadow,true);
  assert.equal(b.requestProjection.recentAvailable,6);
});
test('small lane requests are unchanged',()=>{
  const input={state:{record:{symbol:'TESTUSDT',side:'LONG'},laneExperience:{closedLots:0,recent:[]}},questions:{}};
  assert.deepEqual(J.prepareDecisionRequest(input).body,input);
});
test('history sample keeps last recorded, a winner and a loser without inventing missing cases',()=>{
  for(const values of [[0,1,-1,1,-1,1],[-1,-1,-1,-1,-1,-1]]){
    const input=body();input.state.laneExperience.recent.forEach((x,i)=>{x.rMultiple=values[i];});
    const out=J.prepareDecisionRequest(input);
    assert.equal(out.ok,true);
    assert.deepEqual(expandMarketPacket(out.body.state.laneExperience).recent.map(x=>x.rMultiple),
      values[0]===0?[0,1,-1]:[-1]);
  }
});
test('UTF-8 bytes remain the limit even when character count is below 48000',()=>{
  const input={state:{coreMarketPacket:{symbol:'TESTUSDT',microstructure:{exact:'\u20ac'.repeat(17000)}}},questions:{}};
  const out=J.prepareDecisionRequest(input);
  assert.ok(out.diagnostics.chars<48000);
  assert.ok(out.diagnostics.bytes>48000);
  assert.equal(out.ok,false);
  assert.equal(out.diagnostics.blockReason,'JEV_CORE_CONTEXT_TOO_LARGE');
});
test('repeated preparation is stable',()=>{
  const once=J.prepareDecisionRequest(body()),twice=J.prepareDecisionRequest(once.body);
  assert.equal(twice.serialized,once.serialized);
});
test('unknown oversized history and oversized protected truth stay blocked',()=>{
  const optional=body();optional.state.laneExperience.unknownPayload='X'.repeat(60000);
  const a=J.prepareDecisionRequest(optional);
  assert.equal(a.ok,false);assert.equal(a.diagnostics.blockReason,'JEV_REQUEST_CONTEXT_TOO_LARGE');
  const core=body();core.state.coreMarketPacket.microstructure.irreducible='X'.repeat(60000);
  const b=J.prepareDecisionRequest(core,{maxBytes:999999});
  assert.equal(b.ok,false);assert.equal(b.diagnostics.maxBytes,48000);
  assert.equal(b.diagnostics.blockReason,'JEV_CORE_CONTEXT_TOO_LARGE');
  assert.deepEqual(J.protectedCoreTruth(b.body),J.protectedCoreTruth(core));
});
// All client-side filesystem effects go to memory; no service or real config is used.
function isolatedClient({success=false}={}){
  const filename=path.join(__dirname,'..','jev-decision.js'),root=path.resolve('unused-memory-root');
  const config=path.join(root,'config','jev.json'),logs=[],sent=[];
  const files=new Map([[config,JSON.stringify({enabled:true,dailyCapUsd:1})]]);
  let writes=0,calls=0;const writtenPaths=[];
  const memoryFs={existsSync:p=>files.has(p),
    readFileSync:p=>{if(files.has(p))return files.get(p);throw Error('MEMORY_FILE_ABSENT');},
    mkdirSync:()=>{},
    appendFileSync:(p,line)=>{files.set(p,(files.get(p)||'')+line);logs.push(JSON.parse(line));},
    writeFileSync:(p,value)=>{writes++;writtenPaths.push(p);files.set(p,value);},
    renameSync:(from,to)=>{writes++;writtenPaths.push(to);files.set(to,files.get(from));files.delete(from);}};
  const realRequire=createRequire(filename),mod={exports:{}};
  const load=vm.runInNewContext('(function(require,module,exports){'+fs.readFileSync(filename,'utf8')+'\n})',
    {Buffer,AbortController,setTimeout,clearTimeout});
  load(name=>name==='fs'?memoryFs:realRequire(name),mod,mod.exports);
  const client=mod.exports.createJevClient({root,apiKey:'sk-or-v1-unit-test',clock:()=>1794575000000,
    fetchImpl:async(_,options)=>{
      calls++;if(!success)throw Error('NETWORK_FORBIDDEN');
      sent.push(options.body);
      return {ok:true,status:200,text:async()=>JSON.stringify({usage:{cost:0},answers:{
        top3_decision:{choice:'REJECT_ENTRY'},top3_leverage:{choice:'LEV_10'},top3_reason:{choice:'NO_EDGE'},
        zirve5_decision:{choice:'REJECT_ENTRY'},zirve5_leverage:{choice:'LEV_10'},zirve5_reason:{choice:'NO_EDGE'}}})};
    }});
  return {client,logs,sent,files,writtenPaths,config,counts:()=>({writes,calls})};
}
for(const lane of ['TOP3','ZIRVE5'])for(const kind of ['CORE','REQUEST'])test(lane+' '+kind+' size block preserves called:false and attempted:false',async()=>{
  const x=isolatedClient(),packet={symbol:'TESTUSDT',livePrice:1,microstructure:kind==='CORE'?{irreducible:'X'.repeat(60000)}:{}};
  const args={symbol:'TESTUSDT',signal:{ok:true,side:'SHORT',rule:'SHORT_TOP_BREAK',stopRef:1,zone:{}},
    features:{ok:true,close:1},experience:kind==='REQUEST'?{unknownPayload:'X'.repeat(60000)}:null,
    chartContext:{available:true,symbol:'TESTUSDT',packet}};
  const out=await (lane==='TOP3'?x.client.sovereignTop3Gate(args):x.client.sovereignZirve5Gate(args));
  assert.equal(out.reason,kind==='CORE'?'JEV_CORE_CONTEXT_TOO_LARGE':'JEV_REQUEST_CONTEXT_TOO_LARGE');
  assert.equal(out.called,false);assert.equal(out.attempted,false);assert.equal(out.ok,false);
  assert.equal(x.counts().calls,0);
  assert.ok(x.writtenPaths.length>0,'local preflight trace is recorded');
  assert.ok(x.writtenPaths.every(p=>p.startsWith(path.join(path.resolve('unused-memory-root'),'logs','entry-decisions')+path.sep)), 'no budget or configuration write on a preflight block');
  assert.equal(x.files.get(x.config),JSON.stringify({enabled:true,dailyCapUsd:1}));
  assert.equal(x.logs.at(-1).blocked,true);
});

function expectedHistory(input){
  const expected=clone(input);
  expected.recent=[expected.recent[0],expected.recent[1]].map(lot=>({...lot,features:{
    rank:0,fund:0,premium:null,ind:{obstacle:false},experience:'MIXED',
    committee:{decision:'SKIP',shadow:true},leverageVote:{by:'KURUL',want:10},
    brain:{n:20,wins:10,losses:10,avgR:0,lean:'MIXED'},
    similar:{n:2,wins:1,losses:1,mixed:true}}}));
  expected.requestProjection={policy:'LANE_HISTORY_DIGEST_V1',
    recentAvailable:6,recentKept:2,selection:'LAST_RECORDED_PLUS_WINNER_AND_LOSER',
    historyFeatureSummaries:['committee','leverageVote','brain','similar'],
    measuredLearningUnchanged:true,softContextOnly:true};
  return expected;
}
test('entire decoded history equals the independently specified digest after serialization',()=>{
  const input=body(),before=JSON.stringify(input),out=J.prepareDecisionRequest(input);
  const wire=JSON.parse(out.serialized),history=wire.state.laneExperience;
  assert.equal(history.wire.version,'R2544.34_LOSSLESS_ROWS');
  assert.ok(Object.keys(history.wire.fields).length>0);
  const expected=expectedHistory(input.state.laneExperience),decoded=expandMarketPacket(history);
  assert.deepEqual(decoded,expected);
  assert.equal(JSON.stringify(decoded),JSON.stringify(expected));
  assert.equal(JSON.stringify(input),before);
  assert.match(history.wire.interpretation,/local to state.laneExperience/);
  const market=wire.state.coreMarketPacket;
  assert.ok(market.wire);
  const shared=Object.keys(history.wire.fields).filter(k=>market.wire.fields[k]);
  assert.ok(shared.some(k=>JSON.stringify(history.wire.fields[k])!==JSON.stringify(market.wire.fields[k])));
  assert.deepEqual(J.protectedCoreTruth(wire),J.protectedCoreTruth(input));
});
test('recent reverses append order; it does not sort by close timestamp',()=>{
  const T=require('../top3-hunter'),xs=[300,100,900].map((closedAt,i)=>({
    symbol:'ORDER'+i+'USDT',rule:'SHORT_TOP_BREAK',side:'SHORT',kind:'FRESH',mode:'TEST',
    closedAt,rMultiple:i%2?-1:1,features:{rank:i+1}}));
  assert.deepEqual(T.experienceFor(xs,'SHORT_TOP_BREAK',{recent:3}).recent.map(x=>x.symbol),
    ['ORDER2USDT','ORDER1USDT','ORDER0USDT']);
  assert.deepEqual(T.experienceSummary(xs,{recent:3}).recent.map(x=>x.closedAt),[900,100,300]);
});
for(const lane of ['TOP3_V1','TOP3_V2','ZIRVE5'])test(lane+' sends the fitting serialized body through fake fetch with intact current facts and learning',async t=>{
  const x=isolatedClient({success:true}),reference=isolatedClient({success:true});
  const input=body(),p=input.state.coreMarketPacket,price=p.livePrice;
  const args={symbol:p.symbol,signal:{ok:true,side:'SHORT',rule:'SHORT_TOP_BREAK',
      stopRef:price*1.05,stopPct:0.05,tpPct:0.1,maxHoldMs:3600000,
      zone:{top:price*1.02,bottom:price*0.98,equilibrium:price,liquidity:price*0.9,zoneAt:100},
      ...(lane==='TOP3_V2'?{v2:{top:price*1.05,hl:price*0.99,topVolMult:3}}:{})},
    features:{ok:true,close:price,fund:0,premium:0,rank:0},
    chartContext:{available:true,symbol:p.symbol,asOf:200,ageMs:0,source:'FIXTURE',packet:p},
    experience:input.state.laneExperience};
  const snapshot=JSON.stringify(args);
  const run=(client,a)=>lane==='ZIRVE5'?client.sovereignZirve5Gate(a):client.sovereignTop3Gate(a);
  const out=await run(x.client,args),baseline=await run(reference.client,{...args,experience:null});
  assert.equal(out.ok,true);assert.equal(out.called,true);assert.equal(out.decision,'REJECT_ENTRY');
  assert.equal(baseline.ok,true);assert.equal(x.counts().calls,1);assert.equal(reference.counts().calls,1);
  const serialized=x.sent[0];assert.equal(typeof serialized,'string');
  const sent=JSON.parse(serialized),plain=JSON.parse(reference.sent[0]);
  assert.ok(Buffer.byteLength(serialized,'utf8')<=48000);
  assert.equal(JSON.stringify(sent),serialized);
  const size=x.logs.find(row=>row.maxBytes);
  assert.equal(size.blocked,false);assert.equal(size.bytes,Buffer.byteLength(serialized,'utf8'));
  assert.deepEqual(sent.state.record,plain.state.record);
  assert.equal(sent.state.record.symbol,args.symbol);assert.equal(sent.state.record.side,'SHORT');
  assert.deepEqual(sent.questions,plain.questions);
  const protectedSent=J.protectedCoreTruth(sent);
  assert.deepEqual(protectedSent.entryGate,sent.state.record);
  const {entryGate,...protectedMarket}=protectedSent;
  assert.deepEqual(protectedMarket,J.protectedCoreTruth({state:{coreMarketPacket:p}}));
  const expected=expectedHistory(input.state.laneExperience);
  assert.equal(sent.state.laneExperience.wire.version,'R2544.34_LOSSLESS_ROWS');
  assert.match(sent.state.laneExperience.wire.interpretation,/local to state.laneExperience/);
  assert.deepEqual(expandMarketPacket(sent.state.laneExperience),expected);
  assert.equal(JSON.stringify(expandMarketPacket(sent.state.laneExperience)),JSON.stringify(expected));
  assert.equal(JSON.stringify(args),snapshot);
  assert.ok([...x.files.keys()].some(k=>k.endsWith('jev-usage.json')));
  assert.ok([...x.files.keys()].every(k=>!/(top3-hunter-state|kesif-state|learning)/.test(k)));
  t.diagnostic(lane+': '+size.bytes+' bytes; fake fetch=1; matching baseline fetch=1; real filesystem writes/network=0');
});
