'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const J=require('../jev-decision'),T=require('../top3-hunter'),W=require('../jev-wire-market');
const market=require('./fixtures/r42-carv-r41-packet.json').packet;
const lc=fs.readFileSync(path.join(__dirname,'../live-controller.js'),'utf8');
function history(){return {rule:'LONG_EARLY_RETEST',closedLots:80,groups:[{mode:'LIVE',n:5,wins:4,losses:1,avgR:0.3},{mode:'TEST',n:75,wins:26,losses:49,avgR:-0.1}],
  buckets:{volume:[{n:30,avgR:-0.1}]},labPriors:{n:80,avgR:-0.2},
  learning:{lessons:80,wins:30,losses:50,lossDirection:{DOGRU:15,YANLIS:35},
    factors:[{key:'direction',value:'WRONG',lossPct:0.7,winPct:0.2,call:'MIXED'}],
    text:Array.from({length:18},()=>('Measured history has 80 outcomes, 30 wins, 50 losses; wrong direction in 70% of losses and 20% of wins. ').repeat(32))},
  similar:{n:2,wins:1,losses:1,cases:[{symbol:'WINUSDT',R:1},{symbol:'LOSSUSDT',R:-1}]},
  recent:[{symbol:'WINUSDT',rMultiple:1,features:{rank:0,premium:null}},{symbol:'LOSSUSDT',rMultiple:-1,features:{rank:5,premium:0}}]};}
function input(ex=history()){return {model:'fake',state:{coreMarketPacket:structuredClone(market),
  record:{contract:'R2544.58_TOP3_V2_GATE',symbol:market.symbol,side:'LONG',proposedPlan:{entryPrice:100,stopPrice:98,tpPrice:106},entryFeatures:{ind:{ok:true,vdpm:{obstacle2R:false}},ruleFlags:[]}},laneExperience:ex},
  questions:{top3_decision:{type:'choice',criteria:{APPROVE_ENTRY:'Enter.',REJECT_ENTRY:'Skip.'}}}};}
test('R195 array-shaped archived summaries cannot block a real gate while current facts and measured tables fit',()=>{
  const body=input(),before=structuredClone(body),out=J.prepareDecisionRequest(body);
  assert.equal(out.ok,true,JSON.stringify(out.diagnostics));assert.ok(out.diagnostics.bytes<=48000);
  assert.deepEqual(J.protectedCoreTruth(out.body),J.protectedCoreTruth(body));assert.deepEqual(out.body.state.record,body.state.record);
  const archived=W.expandMarketPacket(out.body.state.laneExperience);
  for(const k of ['groups','buckets','labPriors','similar'])assert.deepEqual(archived[k],body.state.laneExperience[k]);
  const {text,...measured}=body.state.laneExperience.learning;
  assert.deepEqual(archived.learning,{...measured,textInMeasuredFields:true});
  assert.deepEqual(archived.recent.map(x=>[x.symbol,x.rMultiple]),[['WINUSDT',1],['LOSSUSDT',-1]]);
  assert.deepEqual(body,before,'local learning object is unchanged');
  assert.ok(out.diagnostics.trimStepsApplied.includes('LANE_HISTORY_DUPLICATE_PROSE'));
});
test('R195 V1 wire history is decoded with its own dictionary; aggregates survive the residual fit',()=>{
  const ex=history();ex.requestProjection={policy:'LANE_HISTORY_DIGEST_V1',recentAvailable:6,recentKept:2};
  ex.learning.factors=Array.from({length:36},(_,i)=>({key:'factor'+i,value:'WITH',lossPct:0.7,winPct:0.2,labLossPct:0.6,labWinPct:0.3,call:'MIXED'}));
  const encoded=W.encodeMarketPacket(ex);assert.equal(encoded.encoded,true);
  const out=J.prepareDecisionRequest(input(encoded.packet));assert.equal(out.ok,true,JSON.stringify(out.diagnostics));
  const after=W.expandMarketPacket(out.body.state.laneExperience);
  assert.deepEqual(after.learning.factors,ex.learning.factors);assert.equal(after.requestProjection.recentAvailable,6);
  assert.deepEqual(after.groups,ex.groups);
});
test('R195 history without a measured factor table is not stripped; mandatory current evidence still cannot be dropped',()=>{
  const ex=history();delete ex.learning.factors;
  assert.equal(J.prepareDecisionRequest(input(ex)).ok,false,'sole historical evidence is not claimed to be duplicate');
  const body=input();body.state.record.entryFeatures.ind.essential='X'.repeat(60000);
  const out=J.prepareDecisionRequest(body);assert.equal(out.ok,false);assert.deepEqual(out.body.state.record,body.state.record);
});
test('R195 an actual gate call is emitted after archive fitting and a genuine JEV rejection remains a rejection',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r195-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));let sent=null,calls=0;
  const c=J.createJevClient({root,apiKey:'sk-or-v1-synthetic-test-only',fetchImpl:async(_,o)=>{
    calls++;sent=JSON.parse(o.body);return {ok:true,status:200,text:async()=>JSON.stringify({answers:{top3_decision:{choice:'REJECT_ENTRY'},top3_reason:{choice:'LATE_OR_CROWDED'},top3_leverage:{choice:'LEV_10'}},usage:{cost:0}})};
  }});
  const out=await c.sovereignTop3Gate({symbol:market.symbol,signal:{ok:true,side:'LONG',rule:'LONG_EARLY_RETEST',v2:{level:99},levels:{},proposedPlan:{entryPrice:100,stopPrice:98,tpPrice:106}},features:{ok:true,close:100},
    chartContext:{available:true,symbol:market.symbol,packet:structuredClone(market)},experience:history()});
  assert.equal(calls,1);assert.equal(out.ok,true);assert.equal(out.called,true);assert.equal(out.decision,'REJECT_ENTRY');assert.ok(Buffer.byteLength(JSON.stringify(sent))<=48000);
  assert.equal(out.entryTrace.status,'REPLIED');
});
test('R195 no response, real approval, real rejection and unverifiable legacy answers stay distinct',()=>{
  for(const j of [{ok:false,called:false,decision:'REJECT_ENTRY',reason:'JEV_REQUEST_CONTEXT_TOO_LARGE'},{ok:false,called:true,decision:'REJECT_ENTRY',reason:'OPENROUTER_402'}]){
    const r=T.entryJevReview(j);assert.equal(r.status,'NO_RESPONSE');assert.equal(r.decision,null);assert.equal(r.rawDecision,'REJECT_ENTRY');assert.match(r.label,/cevapsız/);
  }
  const yes=T.entryJevReview({ok:true,called:true,decision:'APPROVE_ENTRY'}),no=T.entryJevReview({ok:true,called:true,decision:'REJECT_ENTRY'});
  assert.equal(yes.label,'JEV GİR');assert.equal(no.label,'JEV GİRME');
  assert.equal(T.entryJevReview({decision:'REJECT_ENTRY',called:true}).status,'UNVERIFIED');
  assert.equal(T.entryJevReview({decision:'REJECT_ENTRY',called:false},{decision:'REJECT_ENTRY',ok:false,called:false}).status,'NO_RESPONSE');
});
test('R195 actual entry branches block invalid local packets; genuine JEV decisions and credit/timeout policies are preserved',()=>{
  const topEnd=lc.indexOf('// R2544.89 KURUL KAPISI');
  const first=lc.lastIndexOf("const ev={decision:jev?.decision||'REJECT_ENTRY',called:jev?.called===true,ok:jev?.ok===true,reason:jev?.reason||null,side:x.side,rule:x.rule,requestSize:",topEnd);
  assert.ok(first>0);
  const top3=lc.slice(first,topEnd).replace(/\n\s*}\s*$/,'\n');
  const zStart=lc.indexOf("const ev={decision:jev?.decision||'REJECT_ENTRY',called:jev?.called===true,ok:jev?.ok===true,reason:jev?.reason||null,requestSize:",lc.indexOf('async function z5Tick('));
  assert.ok(zStart>0);
  const z5=lc.slice(zStart,lc.indexOf('const z5Adv=true;',zStart)).replace(/\n\s*}\s*$/,'\n');
  const helpers=lc.match(/function jevKurul\(c\)\{[^}]*\}/)[0]+'\n'+lc.match(/function jevSaysNo\(j\)\{[^}]*\}/)[0];
  for(const [name,fragment]of [['TOP3',top3],['ZIRVE5',z5]]){
    const run=new Function('jev','top3Lib',helpers+`;const cfg={jevMode:true,committeeMode:true},ef={},res={},x={symbol:'SYNTHUSDT',side:'LONG',rule:'LONG_EARLY_RETEST'},sym=x.symbol,side=x.side,sg={rank:1},z={},notes=[],events=[],store={journal:(...x)=>events.push(x)},z5Note=(_,x)=>notes.push(x);let orderStageReached=0;for(let n=0;n<1;n++){${fragment};orderStageReached++;}return {orderStageReached,events,notes,res};`);
    for(const reason of ['JEV_REQUEST_CONTEXT_TOO_LARGE','JEV_CORE_CONTEXT_TOO_LARGE','JEV_CONTEXT_TRUTH_CHANGED']){
      const r=run({ok:false,called:false,decision:'REJECT_ENTRY',reason},T);assert.equal(r.orderStageReached,0,name+' '+reason);assert.ok(r.events.some(x=>x[0]===name+'_BLOCKED'));
    }
    assert.equal(run({ok:true,called:true,decision:'REJECT_ENTRY'},T).orderStageReached,0,name+' actual rejection');
    assert.equal(run({ok:true,called:true,decision:'APPROVE_ENTRY'},T).orderStageReached,1,name+' approval is preserved');
    assert.equal(run({ok:false,called:true,decision:'REJECT_ENTRY',reason:'OPENROUTER_402'},T).orderStageReached,1,name+' existing credit policy');
    assert.equal(run({ok:false,called:false,decision:'REJECT_ENTRY',reason:'timeout'},T).orderStageReached,1,name+' existing timeout policy');
  }
});
test('R195 real controller desk handoff and entry explanation cannot turn a size failure into a JEV rejection',()=>{
  const a={side:'LONG',rule:'LONG_EARLY_RETEST',leverage:10,jev:{decision:'REJECT_ENTRY',called:false,reason:'JEV_REQUEST_CONTEXT_TOO_LARGE'},
    entryFeatures:{jevVote:{decision:'REJECT_ENTRY',called:false,ok:false,reason:'JEV_REQUEST_CONTEXT_TOO_LARGE'}}};
  const segment=lc.slice(lc.indexOf('const g0=a.goxel||null,advisors='),lc.indexOf('const auth=deskAuthority(a);'));
  const advisors=new Function('a','finite','top3Lib',segment+';return advisors;')(a,x=>Number.isFinite(x)?x:null,T);
  assert.equal(advisors.entry.jev.status,'NO_RESPONSE');assert.equal(advisors.entry.jev.decision,null);assert.equal(advisors.entry.jev.called,false);
  const whySrc=lc.slice(lc.indexOf('function top3Why('),lc.indexOf('function top3Gate('));
  const why=new Function('a','finite','top3Lib','TOP3_WHY',whySrc+';return top3Why(a);')(a,x=>Number.isFinite(x)?x:null,T,{});
  assert.match(why,/cevapsız/);assert.doesNotMatch(why,/JEV REJECT_ENTRY/);
});
test('R195 Office distinguishes a failed request and uses actual per-lane settings/sub-switches',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../office-dashboard/public/office.html'),'utf8');
  const helper=html.slice(html.indexOf('function entryJevText('),html.indexOf('function ccSimple('));
  const ctx={};vm.createContext(ctx);vm.runInContext(helper,ctx);
  assert.match(ctx.entryJevText({ok:false,called:false,decision:'REJECT_ENTRY',reason:'JEV_REQUEST_CONTEXT_TOO_LARGE'}),/cevapsız/);
  assert.equal(ctx.entryJevText({ok:true,called:true,decision:'REJECT_ENTRY'}),'JEV GİRME');
  const model=html.slice(html.indexOf('function ccModel('),html.indexOf('function ccEq('));
  const box={ccG:x=>x,rxShort:x=>x};vm.createContext(box);vm.runInContext(model,box);
  const m=box.ccModel({top3:{switches:{enabled:true},subs:[{key:'early',enabled:true},{key:'top',enabled:false}],cc:{strategies:[{key:'ERKEN_LONG',lane:'ILK3'},{key:'TEPE_SHORT',lane:'ILK3'}]}}});
  assert.equal(m.strat[0].sub,true);assert.equal(m.strat[1].sub,false);
});
test('R195 read-only diagnostics retains executed-entry traces and desk/close evidence after newer scans',async t=>{
  const {collect}=require('../delivery-tools/r194/collect-diagnostics.cjs'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r195-diag-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const rt=path.join(root,'brain/runtime'),traces=path.join(rt,'logs/entry-decisions');fs.mkdirSync(path.join(rt,'data'),{recursive:true});fs.mkdirSync(traces,{recursive:true});
  const dbFile=path.join(rt,'data/brainhub.sqlite'),db=new DatabaseSync(dbFile);db.exec('CREATE TABLE journal(id TEXT,ts INTEGER,kind TEXT,symbol TEXT,payload TEXT)');
  const id=randomUUID(),oldFile=path.join(traces,id+'.json');fs.writeFileSync(oldFile,JSON.stringify({requestId:id,symbol:'SYNTHUSDT',status:'PREFLIGHT_BLOCKED'}));fs.utimesSync(oldFile,new Date(0),new Date(0));
  for(let n=0;n<32;n++){const rid=randomUUID();fs.writeFileSync(path.join(traces,rid+'.json'),JSON.stringify({requestId:rid,symbol:'OTHERUSDT'}));}
  db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run('entry',Date.now(),'TOP3_ENTRY','SYNTHUSDT',JSON.stringify({entryFeatures:{jevVote:{entryTrace:{requestId:id}}}}));
  db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run('desk',Date.now(),'POSITION_DESK_REVIEW','SYNTHUSDT',JSON.stringify({judge:'JEV',action:'EXIT'}));
  db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run('close',Date.now(),'TOP3_CLOSED','SYNTHUSDT',JSON.stringify({id:'synthetic'}));db.close();
  const before=fs.readFileSync(dbFile),out=await collect({brainRoot:path.join(root,'brain'),out:path.join(root,'out'),offline:true});
  assert.ok(out.report.entryTraces.some(x=>x.requestId===id));assert.equal(out.report.counts.POSITION_DESK_REVIEW,1);assert.equal(out.report.counts.TOP3_CLOSED,1);
  assert.deepEqual(fs.readFileSync(dbFile),before);assert.equal(out.report.activity.modelCalls,0);assert.equal(out.report.activity.orderCalls,0);
});
