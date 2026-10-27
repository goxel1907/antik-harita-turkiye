'use strict';
// R2544.94 MODEL KARNESİ + KALAN LİMİT (kullanıcı 27.10: "model karnesi ... onay verdim; modellerin office'te kalan limit ve başka senin
// düşündüğün gösterge var ise ekle ofis katının oraya"). Yalnız ölçer ve gösterir: hiçbir giriş / çıkış kararını değiştirmez.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const MC=require('../model-committee');
test('R2544.94 scorecard: each model scored on its own first-round vote against the closed trade R; edge = avg R of TAKEs - avg R of SKIPs; missed decisions counted',()=>{
  const v=(m,d)=>({m,d});
  const lessons=[
    {rMultiple:2,features:{committee:{decision:'TAKE',round1:[v('kr/claude-sonnet-4.5','TAKE'),v('google/gemma-4-31b-it:free','SKIP')],votes:[v('kr/claude-sonnet-4.5','TAKE'),v('google/gemma-4-31b-it:free','TAKE')]}}},
    {rMultiple:-1,features:{committee:{decision:'SKIP',round1:[v('kr/claude-sonnet-4.5','SKIP'),v('google/gemma-4-31b-it:free','TAKE')]}}},
    {rMultiple:-1,features:{committee:{error:'COMMITTEE_NO_HEALTHY_MEMBER'}}},
    {rMultiple:1,features:{}}];
  const s=MC.scorecard({lessons});
  assert.deepEqual(s.live['kr/claude-sonnet-4.5'],{n:2,take:{n:1,avgR:2},skip:{n:1,avgR:-1},edge:3,hitPct:100});
  assert.deepEqual(s.live['google/gemma-4-31b-it:free'],{n:2,take:{n:1,avgR:-1},skip:{n:1,avgR:2},edge:-3,hitPct:0},'the first-round (independent) vote is scored, not the vote after the debate');
  assert.equal(s.committee.missed,1);assert.equal(s.committee.scored,2);assert.equal(s.committee.baseR,0.5);assert.equal(s.committee.live.edge,3);
  const answers=[{id:'q1',judge:'COMMITTEE',decision:'SKIP',round1:[{member:'ROUTER:kr/glm-5',ok:true,decision:'SKIP'},{member:'OR:google/gemma-4-31b-it:free',ok:true,decision:'TAKE'},{member:'ROUTER:kr/deepseek-3.2',ok:false,decision:null}]},{id:'q2',judge:'COMMITTEE',decision:'SKIP',round1:[{member:'ROUTER:kr/glm-5',ok:true,decision:'SKIP'}]},{id:'q9',decision:'TAKE',round1:[]}];
  const e=MC.scorecard({answers,key:{q1:{R:3},q2:{R:-1}}});
  assert.deepEqual(e.exam['kr/glm-5'],{n:2,take:{n:0,avgR:null},skip:{n:2,avgR:1},edge:null,hitPct:50},'"always SKIP" has no edge');
  assert.equal(e.exam['google/gemma-4-31b-it:free'].take.avgR,3);assert.ok(!e.exam['kr/deepseek-3.2'],'a failed answer is not a vote');
  assert.equal(e.committee.examN,2);assert.equal(e.committee.examBaseR,1);assert.equal(e.committee.exam.skip.avgR,1,'the packets the committee skipped would have paid +1R on average');
});
test('R2544.94 limits: today counters (probes included), monthly quota vs temporary 429 told apart, success clears the flag, counters reset next day',async()=>{
  let t=Date.UTC(2026,9,27,10,0,0),mode='ok';
  const err={month:'HTTP 503 [kiro/glm-5] [402]: {"message":"You have reached the limit.","reason":"MONTHLY_REQUEST_COUNT"}',rate:'HTTP 429 {"error":{"message":"Provider returned error","code":429}}'};
  const m={id:'ROUTER:kr/glm-5',call:async()=>mode==='ok'?{ok:true,text:'{"ok":true}'}:{ok:false,reason:err[mode]}};
  const c=MC.createCommittee({members:[m],clock:()=>t});
  await c.probe({force:true});mode='month';await c.probe({force:true});
  let h=c.status().members[0];assert.equal(h.callsToday,2);assert.equal(h.okToday,1);assert.equal(h.quota.kind,'MONTHLY');assert.equal(h.quota.monthly,true);
  mode='rate';t+=60000;await c.probe({force:true});h=c.status().members[0];assert.equal(h.quota.kind,'RATE');
  mode='ok';t+=24*3600000;await c.probe({force:true});h=c.status().members[0];assert.equal(h.quota,null);assert.equal(h.callsToday,1,'new day');
  assert.equal(MC.quotaOf('The operation was aborted due to timeout'),null);assert.equal(MC.quotaOf('OPENROUTER_FREE_QUOTA_EXHAUSTED',1).kind,'QUOTA');
});
test('R2544.94 board: OpenRouter remaining is exact (account), 9Router remaining is published limit - our calls (approximate), cooldowns, team first',()=>{
  const now=Date.UTC(2026,9,27,12,0,0),today='2026-10-27';
  const status={team:['OR:google/gemma-4-31b-it:free'],members:[
    {id:'ROUTER:groq/openai/gpt-oss-120b',healthy:true,day:today,callsToday:12,okToday:11,msToday:24000},
    {id:'ROUTER:kr/claude-sonnet-4.5',healthy:false,lastOk:false,error:'You have reached the limit. MONTHLY',day:'2026-10-26',callsToday:40},
    {id:'OR:google/gemma-4-31b-it:free',healthy:true,day:today,callsToday:3,okToday:3,msToday:9000},
    {id:'OR:poolside/laguna-s-2.1:free',healthy:false,lastOk:false,error:'HTTP 429 Provider returned error'}]};
  const free={quota:{used:150,limit:1000,remaining:850},perModel:[{model:'poolside/laguna-s-2.1:free',cooldownUntil:now+5*60000}]};
  const b=MC.board({status,freeStatus:free,score:MC.scorecard({lessons:[{rMultiple:1,features:{committee:{decision:'TAKE',round1:[{m:'google/gemma-4-31b-it:free',d:'TAKE'}]}}}]}),now});
  assert.equal(b.rows[0].id,'OR:google/gemma-4-31b-it:free','the members at the table come first');
  const r=id=>b.rows.find(x=>x.id===id);
  assert.deepEqual(r('ROUTER:groq/openai/gpt-oss-120b').limit,{text:'Groq 1000/gün',perDay:1000,remaining:988,approx:true,account:null,cooldownMin:null});
  assert.deepEqual(r('ROUTER:groq/openai/gpt-oss-120b').today,{calls:12,ok:11,avgMs:2000});
  assert.equal(r('ROUTER:kr/claude-sonnet-4.5').today.calls,0,'yesterday is not today');assert.equal(r('ROUTER:kr/claude-sonnet-4.5').quota.kind,'MONTHLY','old records are read from the error text');
  assert.deepEqual(r('OR:google/gemma-4-31b-it:free').limit.account,{used:150,limit:1000,remaining:850});assert.equal(r('OR:poolside/laguna-s-2.1:free').limit.cooldownMin,5);
  assert.equal(r('OR:poolside/laguna-s-2.1:free').quota.kind,'RATE');assert.equal(r('OR:google/gemma-4-31b-it:free').live.take.avgR,1);assert.deepEqual(b.orAccount,{used:150,limit:1000,remaining:850});
});
test('R2544.94 exam: the answer key is read only for the score (never sent to a model); answers are cached; Office draws 5 seats and the board; desk status carries it',async()=>{
  const {createTraderExam}=require('../trader-exam'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ex94-'));
  fs.writeFileSync(path.join(dir,'packets.jsonl'),JSON.stringify({id:'q1',rule:'LONG_EARLY_RETEST',packet:{a:1}})+'\n');
  const keyFile=path.join(dir,'key.json');fs.writeFileSync(keyFile,JSON.stringify({q1:{R:7.777}}));
  const seen=[];const committee={healthy:()=>[{id:'a'},{id:'b'}],decide:async a=>{seen.push(JSON.stringify(a));return {ok:true,final:'SKIP',consensus:'UNANIMOUS',rounds:1,votes:[{member:'OR:x',ok:true,vote:{decision:'SKIP'}}],voters:2};}};
  const ex=createTraderExam({dir,committee,keyFile,minIntervalMs:0});await ex.tick();
  assert.ok(seen.length===1&&!seen[0].includes('7.777'),'the key never reaches a prompt');
  assert.equal(ex.answers().length,1);assert.equal(ex.answers(),ex.answers(),'cached while the file is unchanged');assert.equal(ex.key().q1.R,7.777);
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(html,/const CM=\{x:550,y:945,seats:\[\[-300,0\],\[-160,-50\],\[0,-60\],\[160,-50\],\[300,0\]\]/);assert.match(html,/function renderBoard\(b\)/);assert.match(html,/renderBoard\(pd\?\.cmBoard\|\|null\)/);
  assert.match(html,/const VW=1100, VH=1280;/);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');assert.match(lc,/cmBoard:\(\(\)=>\{try\{const cs=/);assert.match(lc,/MC\.board\(\{status:cs,freeStatus:/);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');assert.match(sv,/examScoreInput:\(\)=>\(\{answers:traderExam\.answers\(\),key:traderExam\.key\(\)\}\)/);assert.match(sv,/'harness','indikator','sinav_key\.json'/);
});
