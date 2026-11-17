'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const J=require('../jev-decision');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r194-'));
  fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sent=[];
  const client=J.createJevClient({root,apiKey:'sk-or-v1-'+'f'.repeat(40),fetchImpl:async(_url,o)=>{
    const body=JSON.parse(o.body);sent.push(body);
    const answers={};for(const [k,q] of Object.entries(body.questions))answers[k]={choice:k.endsWith('_decision')?'REJECT_ENTRY':Object.keys(q.criteria)[0]};
    return {ok:true,status:200,text:async()=>JSON.stringify({answers,usage:{cost:0.00001}})};
  }});
  return {root,sent,client};
}
const proposal={basis:'SIGNAL_CANDLE_CLOSE',entryPrice:100,stopPrice:97.5,tpPrice:105,stopPct:0.025,targetR:2,maxHoldMs:86400000,flags:[{code:'V2_ZONE_TOO_CLOSE',zoneR:0.7}]};
const features={ok:true,close:100,fund:0.0001,premium:0.002,
  ind:{ok:true,vdpm:{obstacle2R:true,level:101}},experience:{verdict:'AVOID',n:18},
  brain:{n:5,mixed:true},similar:{n:3,avgR:-0.4},entryCtx:{btc:{direction:'UP'}},ruleFlags:proposal.flags};
test('R194 captured TOP3 v2 wire request carries exact proposed geometry and computed evidence, without changing JEV rejection',async t=>{
  const f=fixture(t),before=JSON.stringify(features);
  const r=await f.client.sovereignTop3Gate({symbol:'SYNTHUSDT',signal:{ok:true,side:'LONG',rule:'LONG_EARLY_RETEST',v2:{ok:true,level:99,retestLow:98,volMult:4},levels:{pdh:99,pwh:106},maxHoldMs:86400000,proposedPlan:proposal},features,rank:8,candle:1794910000000});
  assert.equal(r.decision,'REJECT_ENTRY');assert.equal(f.sent.length,1);
  const rec=f.sent[0].state.record;
  assert.equal(rec.proposedPlan.entryPrice,100);assert.equal(rec.proposedPlan.stopPrice,97.5);assert.equal(rec.proposedPlan.tpPrice,105);
  assert.deepEqual(rec.entryFeatures.ind,features.ind);assert.deepEqual(rec.entryFeatures.brain,features.brain);
  assert.deepEqual(rec.entryFeatures.ruleFlags,proposal.flags);assert.equal(JSON.stringify(features),before);
  assert.equal(rec.proposedPlan.maxHoldMs,86400000);
  assert.ok(r.requestSize.bytes<48000);assert.equal(r.requestSize.blockReason,null);
  assert.equal(r.entryTrace.recorded,true);
  const trace=JSON.parse(fs.readFileSync(path.join(f.root,r.entryTrace.relativeFile),'utf8'));
  assert.equal(trace.status,'REPLIED');assert.equal(trace.attempts,1);
  assert.deepEqual(trace.body,f.sent[0]);assert.equal(trace.reply.answers.top3_decision.choice,'REJECT_ENTRY');
  assert.ok(!JSON.stringify(trace).includes('sk-or-v1-'),'authorization header/key never enters the trace');
});
test('R194 ZIRVE5 receives numerical proposal and entry indicators as facts rather than missing features references',async t=>{
  const f=fixture(t);
  const r=await f.client.sovereignZirve5Gate({symbol:'SYNTHUSDT',signal:{ok:true,side:'LONG',zone:{top:101,bottom:97,equilibrium:99,liquidity:105,zoneAt:1794900000000,confirmAt:1794910000000},maxHoldMs:86400000,proposedPlan:proposal},features:{...features,confirmClose:100,confirmBody:0.7,confirmVolMult:2},candle:1794910000000});
  assert.equal(r.decision,'REJECT_ENTRY');
  const rec=f.sent[0].state.record;
  assert.deepEqual(rec.entryFeatures.ind,features.ind);assert.equal(rec.proposedPlan.stopPrice,97.5);
});
test('R194 gate current evidence remains intact under context pressure; mandatory evidence cannot be silently dropped to claim protected truth',()=>{
  const record={contract:'R2544.58_TOP3_V2_GATE',symbol:'SYNTHUSDT',proposedPlan:proposal,
    entryFeatures:{ind:{patterns:[{geometry:{observed:'x'.repeat(60000)},type:'CURRENT_ZONE'}]}}};
  const body={model:'fake',state:{record},questions:{top3_decision:{type:'choice',criteria:{APPROVE_ENTRY:'yes',REJECT_ENTRY:'no'}}}};
  const out=J.prepareDecisionRequest(body);
  assert.equal(out.ok,false,'oversized required evidence is an explicit block, not silent deletion');
  assert.deepEqual(out.body.state.record,record);
  assert.notEqual(J.protectedCoreTruth(body),null,'entry gate has protected facts even without a chart cache');
});
test('R194 required entry observations survive a real chart packet under normal compaction',()=>{
  const packet=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/r42-carv-r41-packet.json'),'utf8')).packet;
  const body={model:'fake',state:{coreMarketPacket:packet,record:{contract:'R2544.58_TOP3_V2_GATE',symbol:packet.symbol,proposedPlan:proposal,entryFeatures:features}},questions:{top3_decision:{type:'choice',criteria:{APPROVE_ENTRY:'yes',REJECT_ENTRY:'no'}}}};
  const out=J.prepareDecisionRequest(body);
  assert.equal(out.diagnostics.coreTruthProtected,true);
  assert.deepEqual(out.body.state.record,body.state.record);
  assert.equal(out.ok,true,JSON.stringify(out.diagnostics));
});
test('R194 a failed local trace write cannot change the model decision or block its request',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'logs'),'synthetic-file-blocks-directory');
  const r=await f.client.sovereignTop3Gate({symbol:'SYNTHUSDT',signal:{ok:true,side:'LONG',v2:{level:99},levels:{},proposedPlan:proposal},features});
  assert.equal(f.sent.length,1);assert.equal(r.ok,true);assert.equal(r.decision,'REJECT_ENTRY');
  assert.equal(r.entryTrace.recorded,false);assert.equal(r.entryTrace.reason,'ENTRY_TRACE_WRITE_FAILED');
});
test('R194 offline diagnostics reads the selected ledger without changing it and removes credentials',async t=>{
  const {collect}=require('../delivery-tools/r194/collect-diagnostics.cjs'),{DatabaseSync}=require('node:sqlite');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r194-diag-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const rt=path.join(root,'brain','runtime'),out=path.join(root,'out');fs.mkdirSync(path.join(rt,'config'),{recursive:true});fs.mkdirSync(path.join(rt,'data'));
  const prefs=path.join(rt,'config','jev.json');fs.writeFileSync(prefs,JSON.stringify({enabled:true,apiKey:'DO_NOT_EXPORT_THIS_KEY'}));
  fs.writeFileSync(path.join(rt,'config','auth.json'),'NEVER_READ_AUTH');
  fs.writeFileSync(path.join(rt,'data','top3-hunter-state.json'),JSON.stringify({lastGate:'OPEN',lastScan5:{checked:30,signals:[]},z5:{lastGate:'ZIRVE5_ACCOUNT_UNAVAILABLE',recent:[{reason:'ACCOUNT_UNAVAILABLE'}],lessons:[{}]}}));
  fs.writeFileSync(path.join(rt,'data','kesif-state.json'),JSON.stringify({lastRoundAt:1794910000000,sozRecent:[{reason:'NO_WORD_HOLDER'}]}));
  const dbFile=path.join(rt,'data','brainhub.sqlite'),db=new DatabaseSync(dbFile);db.exec('CREATE TABLE journal(id TEXT,ts INTEGER,kind TEXT,symbol TEXT,payload TEXT)');
  db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run('synthetic',Date.now(),'TOP3_JEV_REVIEW','SYNTHUSDT',JSON.stringify({decision:'REJECT_ENTRY',reason:'NO_EDGE',apiSecret:'DO_NOT_EXPORT_SECRET'}));db.close();
  const before=fs.readFileSync(dbFile),prefsBefore=fs.readFileSync(prefs);
  const r=await collect({brainRoot:path.join(root,'brain'),out,offline:true});
  assert.equal(r.report.state['top3-hunter-state.json'].z5.lastGate,'ZIRVE5_ACCOUNT_UNAVAILABLE');
  assert.equal(r.report.state['top3-hunter-state.json'].z5.lessonCount,1);
  assert.equal(r.report.state['kesif-state.json'].recentDecisions[0].reason,'NO_WORD_HOLDER');
  assert.equal(r.report.counts.TOP3_JEV_REVIEW,1);assert.deepEqual(fs.readFileSync(dbFile),before);assert.deepEqual(fs.readFileSync(prefs),prefsBefore);
  const text=fs.readFileSync(path.join(out,'JEV-TESHIS.json'),'utf8');
  assert.ok(!/DO_NOT_EXPORT|NEVER_READ_AUTH/.test(text));assert.ok(text.includes('REJECT_ENTRY'));
  assert.equal(r.report.activity.orderCalls,0);assert.equal(r.report.activity.modelCalls,0);
});
