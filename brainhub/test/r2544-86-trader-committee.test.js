'use strict';
// R2544.86 TRADER BEYNİ + MODEL KURULU + SINAV (kullanıcı 27.10: "trader gibi düşünen, tüm zaman dilimlerini anlayan robot"; "ücretsiz";
// "9Router'dakileri de bağla"; "modellerin çalıştığına emin ol, ortak mutabakat yapacaklar"; "Office katında avatar olarak masada").
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const TB=require('../trader-brain'),{createCommittee,family}=require('../model-committee'),{createTraderExam}=require('../trader-exam'),DESK=require('../position-desk');
const H=3600000,T0=Date.UTC(2026,9,20,12,0,0);
const series=(n,ms,start,p0,step)=>Array.from({length:n},(_,i)=>{const p=p0+i*step;return [start+i*ms,p,p*1.004,p*0.996,p+step*0.5,100+i,0,0,0,60];});
test('R2544.86 trader screen: 5 timeframes on CLOSED candles only, prices scaled (entry = 100), no symbol and no date',()=>{
  const k={m5:series(80,300000,T0-80*300000,10,0.01),m15:series(60,900000,T0-60*900000,9,0.02),h1:series(60,H,T0-60*H,8,0.03),h4:series(40,4*H,T0-40*4*H,6,0.1),d1:series(70,24*H,T0-70*24*H,3,0.1),btc1h:series(40,H,T0-40*H,60000,10)};
  k.m5.push([T0,10.8,99,0.1,10.9,999,0,0,0,999]); // a candle that is NOT closed at t: must never be seen
  const p=TB.entryPacket({k,plan:{side:'LONG',rule:'LONG_EARLY_RETEST',entry:10.8,stop:10.6,target:11.4},t:T0});
  const txt=JSON.stringify(p);
  assert.doesNotMatch(txt,/USDT|2026|T12:/,'no symbol, no date');assert.equal(p.plan.entry,100);assert.equal(p.plan.targetR,3);
  for(const tf of ['m5','m15','h1','h4','d1'])assert.ok(p.timeframes[tf]?.structure,tf);
  assert.ok(!txt.includes('9174'),'the open candle (high 99 -> 916.7) is excluded');
  assert.equal(p.timeframes.h1.structure.trend,'RANGE','straight line has no swings -> RANGE, never invented');
  assert.ok(p.levels.find(l=>l.name==='prevDayHigh'));assert.match(p.baseRate,/about 0R/);
  assert.equal(TB.parseEntry('x {"decision":"TAKE","confidence":70,"pTarget":40,"reasonTr":"4 sa yukarı"}').decision,'TAKE');
  assert.equal(TB.parseEntry('{"decision":"BUY"}').ok,false);
});
const member=(id,answers,calls)=>({id,call:async({system})=>{calls.push(id+(system.includes('Other traders')?':R2':system.startsWith('Health')?':P':':R1'));const a=answers.shift();return a===null?{ok:false,reason:'HTTP 503'}:{ok:true,model:id,text:a};}});
const J=(d,r='x')=>JSON.stringify({decision:d,confidence:60,pTarget:40,reasonTr:r});
test('R2544.86 committee: health check first, 3 members from different families, unanimous -> decision; split -> debate round -> majority; no majority -> default',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cm-')),calls=[],ok='{"ok":true}';
  const ms=[member('ROUTER:kr/claude-sonnet-4.5',[ok,J('TAKE','4 sa trend yukarı'),J('TAKE')],calls),member('ROUTER:kr/claude-haiku-4.5',[ok],calls),member('ROUTER:kr/deepseek-3.2',[ok,J('SKIP','2R önünde direnç'),J('TAKE')],calls),
    member('ROUTER:kr/glm-5',[null],calls),member('FREE:openrouter',[ok,J('TAKE'),J('TAKE')],calls)];
  const c=createCommittee({members:ms,healthFile:path.join(dir,'h.json')});
  await c.probe({force:true});
  assert.deepEqual(c.healthy().map(m=>m.id).sort(),['FREE:openrouter','ROUTER:kr/claude-haiku-4.5','ROUTER:kr/claude-sonnet-4.5','ROUTER:kr/deepseek-3.2']);
  assert.deepEqual(c.pick().map(m=>m.id).sort(),['FREE:openrouter','ROUTER:kr/claude-sonnet-4.5','ROUTER:kr/deepseek-3.2'],'one per family: Claude, DeepSeek, OpenRouter (R2544.92: spread over providers)');
  const r=await c.decide({system:'S',prompt:'P',validate:TB.validEntry,parse:TB.parseEntry,field:'decision',fallback:'SKIP'});
  assert.equal(r.consensus,'MAJORITY_AFTER_DEBATE');assert.equal(r.final,'TAKE');assert.equal(r.rounds,2);
  assert.ok(calls.filter(x=>x.endsWith(':R2')).length===3,'every member sees the others in round 2');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'h.json'),'utf8')).health['ROUTER:kr/glm-5'].lastOk===false,'the failed model is recorded and kept off the table');
  // no majority among 2 voters -> default
  const c2=createCommittee({members:[member('ROUTER:kr/claude-sonnet-4.5',[ok,J('TAKE'),J('TAKE')],[]),member('FREE:openrouter',[ok,J('SKIP'),J('SKIP')],[])]});await c2.probe({force:true});
  const r2=await c2.decide({system:'S',prompt:'P',validate:TB.validEntry,parse:TB.parseEntry,field:'decision',fallback:'SKIP'});
  assert.equal(r2.consensus,'NO_MAJORITY_DEFAULT');assert.equal(r2.final,'SKIP');
  // nobody healthy -> no decision at all
  const c3=createCommittee({members:[member('FREE:openrouter',[null],[])]});await c3.probe({force:true});
  assert.equal((await c3.decide({system:'S',prompt:'P',parse:TB.parseEntry,field:'decision',fallback:'SKIP'})).reason,'COMMITTEE_NO_HEALTHY_MEMBER');
  assert.equal(family('ROUTER:kr/claude-haiku-4.5'),'CLAUDE');
});
test('R2544.86 exam: asks the committee one packet at a time, keeps every vote, never sees the outcome; desk uses the committee (no majority -> HOLD)',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ex-'));
  fs.writeFileSync(path.join(dir,'packets.jsonl'),[{id:'a1',rule:'LONG_EARLY_RETEST',packet:{plan:{entry:100}}},{id:'a2',rule:'LONG_EARLY_RETEST',packet:{plan:{entry:100}}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
  let now=1e12;const committee={decide:async()=>({ok:true,final:'SKIP',consensus:'UNANIMOUS',rounds:1,voters:3,votes:[{member:'ROUTER:kr/claude-sonnet-4.5',ok:true,vote:{decision:'SKIP',reasonTr:'r'}}],round2:null})};
  const ex=createTraderExam({dir,committee,clock:()=>now});
  assert.equal((await ex.tick()).id,'a1');assert.equal(await ex.tick(),null,'45 s pacing');now+=46000;assert.equal((await ex.tick()).id,'a2');now+=46000;assert.equal((await ex.tick()).finished,true);
  const ans=fs.readFileSync(path.join(dir,'answers.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(ans.length,2);assert.equal(ans[0].round1[0].decision,'SKIP');assert.ok(!('R' in ans[0]));
  assert.equal(ex.status().answered,2);
  const cfg=DESK.readConfig(fs.mkdtempSync(path.join(os.tmpdir(),'d-')));
  assert.deepEqual(cfg.testJudges,['COMMITTEE','FREE']);assert.deepEqual(cfg.liveJudges,['JEV','COMMITTEE','FREE']);
  const dc={decide:async o=>{assert.equal(o.field,'action');assert.equal(o.fallback,'HOLD');return {ok:true,final:'HOLD',consensus:'NO_MAJORITY_DEFAULT',rounds:2,votes:[{member:'ROUTER:kr/glm-5',ok:true,vote:{action:'EXIT',reason:'NO_EDGE'}}],round2:[{member:'ROUTER:kr/glm-5',ok:true,vote:{action:'EXIT'}}]};}};
  const r=await DESK.judge({packet:{symbol:'XUSDT',side:'LONG'},mode:'TEST',cfg,judges:{committee:dc},stats:{}});
  assert.equal(r.judge,'COMMITTEE');assert.equal(r.d.action,'HOLD');assert.match(r.d.reasonTr,/tek oy, yetki yok|çoğunluk yok/); // R2544.98assert.deepEqual(r.committee.votes,[{m:'kr/glm-5',a:'EXIT',s:null}]);
});
test('R2544.86 wiring: 9Router members + OpenRouter free, separate committees for desk and exam, health checks, Office committee table, deploy lists',()=>{
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/const TRADER_ROUTER_ORDER=\['gc\/gemini-3\.1-pro-preview','kr\/claude-sonnet-4\.5','kr\/deepseek-3\.2','kr\/glm-5'/);
  assert.match(sv,/const deskCommittee=createCommittee\(/);assert.match(sv,/const examCommittee=createCommittee\(/);
  assert.match(sv,/committee:deskCommittee,examStatus:\(\)=>traderExam\.status\(\)/);assert.match(sv,/setInterval\(\(\)=>\{traderExam\.tick\(\)/);
  const of=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(of,/function committeeSvg\(\)/);assert.match(of,/\$\{committeeSvg\(\)\}/);assert.match(of,/renderCommittee\(s\)/);assert.match(of,/const VW=1100, VH=1280/);
  for(const f of ['manage.ps1',path.join('jev-brain','JEV-DEPLOY.ps1')]){const t=fs.readFileSync(path.join(__dirname,'..',f),'utf8');for(const m of ['trader-brain.js','model-committee.js','trader-exam.js'])assert.ok(t.includes("'"+m+"'"),f+' '+m);}
  const fw=fs.readFileSync(path.join(__dirname,'..','openrouter-free-worker.js'),'utf8');assert.match(fw,/\['POSITION_DESK','TRADER'\]\.includes\(role\)\?4096:1536/);
});
