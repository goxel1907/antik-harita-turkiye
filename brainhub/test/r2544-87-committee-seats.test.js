'use strict';
// R2544.87 (kullanıcı 27.10: "anlık sinyallere karar vermeyecekler mi"; "başka çalışan modeller yok mu, zaman dilimlerine entegre edecek"):
// kurulda koltuklar (1g/4sa, 1sa/15dk, 5dk+akış, risk), 9Router Gemini/MiniMax üyeleri, canlı TEST lotlarına GÖLGE giriş kararı.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const TB=require('../trader-brain'),{createCommittee,family}=require('../model-committee'),DESK=require('../position-desk');
test('R2544.87 seats: every member gets its own timeframe seat in round 1 and keeps it in the debate; votes carry the seat',async()=>{
  const seen={},ok='{"ok":true}',J=d=>JSON.stringify({decision:d,confidence:60,pTarget:40,reasonTr:'r'});
  const mk=(id,ans)=>({id,call:async({system})=>{(seen[id]||(seen[id]=[])).push(system);const a=ans.shift();return {ok:true,model:id,text:a};}});
  const c=createCommittee({size:4,members:[mk('ROUTER:gc/gemini-3.1-pro-preview',[ok,J('SKIP'),J('SKIP')]),mk('ROUTER:kr/claude-sonnet-4.5',[ok,J('TAKE'),J('SKIP')]),mk('ROUTER:kr/deepseek-3.2',[ok,J('SKIP'),J('SKIP')]),mk('ROUTER:kr/glm-5',[ok,J('TAKE'),J('TAKE')])]});
  await c.probe({force:true});
  const r=await c.decide({system:TB.ENTRY_SYSTEM,prompt:'{}',validate:TB.validEntry,parse:TB.parseEntry,field:'decision',fallback:'SKIP',roles:TB.ENTRY_ROLES});
  assert.match(seen['ROUTER:gc/gemini-3.1-pro-preview'][1],/YOUR SEAT AT THE DESK: HIGHER-TIMEFRAME ANALYST/);
  assert.match(seen['ROUTER:kr/claude-sonnet-4.5'][1],/PRICE ACTION READER/); // R2544.88 seatassert.match(seen['ROUTER:kr/deepseek-3.2'][1],/BULL ADVOCATE/); // R2544.93assert.match(seen['ROUTER:kr/glm-5'][1],/RISK OFFICER/);
  assert.match(seen['ROUTER:kr/glm-5'][2],/RISK OFFICER[\s\S]*Trader A \(1g\/4sa\): SKIP/,'round 2 keeps the seat and shows the others with their seats');
  assert.deepEqual(r.votes.map(v=>v.seat),['1g/4sa','price action','boğa','ayı']);
  assert.equal(r.final,'SKIP');assert.equal(r.consensus,'MAJORITY_AFTER_DEBATE','3 of 4 after the debate');
  assert.equal(family('ROUTER:gc/gemini-3-flash-preview'),'GEMINI');assert.equal(family('ROUTER:kr/minimax-m2.5'),'MINIMAX');
  assert.equal(DESK.DESK_ROLES.length,5); // R2544.88 price action seat
});
test('R2544.87 wiring: Gemini first, 4 seats, live TEST lots get a SHADOW committee entry decision from candles closed before the entry; Office shows it',()=>{
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/const TRADER_ROUTER_ORDER=\['gc\/gemini-3\.1-pro-preview','kr\/claude-sonnet-4\.5','kr\/deepseek-3\.2','kr\/glm-5','kr\/minimax-m2\.5'/);
  assert.match(sv,/const deskCommittee=createCommittee\(\{size:5,/);assert.match(sv,/const examCommittee=createCommittee\(\{size:3,/); // R2544.92: exam 3 members // R2544.88: 5 seats
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),i=lc.indexOf('async function entryCommitteeShadow('),b=lc.slice(i,lc.indexOf('\n  // R2544.89 kurul kap',i)); // R2544.89: the gate and the desk executor follow
  assert.ok(i>0);assert.match(b,/end=t-1/);assert.match(b,/roles:TB\.ENTRY_ROLES/);assert.match(b,/shadow:true/);
  assert.doesNotMatch(b,/placeAlgo|placeRunnerStop|top3CloseMarket|top3Open\(|cancel/,'never trades');
  assert.match(lc,/entryCommitteeShadow\(Object\.values\(top3State\.active\|\|\{\}\)\.find\(a=>a&&a\.symbol===x\.symbol&&a\.lane!=='ZIRVE5'\)\)\.catch\(\(\)=>\{\}\);/,'İlk 3: not awaited');
  assert.match(lc,/if\(opened\.ok\)\{entries\+\+;entryCommitteeShadow\(/,'ZİRVE-5');
  assert.match(lc,/entryComparison:/);
  const ex=fs.readFileSync(path.join(__dirname,'..','trader-exam.js'),'utf8');assert.match(ex,/roles:TB\.ENTRY_ROLES/);
  const of=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(of,/function entryCmLine\(c\)/);assert.equal((of.match(/entryCmLine\(a\.entryCommittee\)/g)||[]).length,2);assert.match(of,/kurul giriş kararı \(kapananlar\)/);
});
test('R2544.87 exam: a pause meant for the older build ends by itself on this build',async()=>{
  const os=require('node:os'),{createTraderExam,EXAM_VERSION}=require('../trader-exam'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ex87-'));
  fs.writeFileSync(path.join(dir,'packets.jsonl'),JSON.stringify({id:'q1',rule:'LONG_EARLY_RETEST',packet:{}})+'\n');
  const committee={decide:async()=>({ok:true,final:'SKIP',consensus:'UNANIMOUS',rounds:1,voters:4,votes:[],round2:null})};
  fs.writeFileSync(path.join(dir,'exam-config.json'),JSON.stringify({enabled:false}));
  assert.equal(await createTraderExam({dir,committee}).tick(),null,'plain pause holds');
  fs.writeFileSync(path.join(dir,'exam-config.json'),JSON.stringify({enabled:false,enableForVersion:EXAM_VERSION}));
  assert.equal((await createTraderExam({dir,committee}).tick()).id,'q1');assert.equal(EXAM_VERSION,'R2544.98-TRADER-EXAM-PRO');
});
test('R2544.91 seats follow the model, not the position: Claude reads price action even when Gemini is missing; Qwen3 Coder is off the table',async()=>{
  const mk=id=>({id,call:async()=>({ok:true,text:'{"ok":true}'})}),run=async ids=>{const c=createCommittee({size:5,members:ids.map(mk)});await c.probe({force:true});const t=c.pick(),s=c.assignSeats(t,TB.ENTRY_ROLES);return Object.fromEntries(t.map((m,i)=>[m.id.replace('ROUTER:',''),s[i].key]));};
  assert.deepEqual(await run(['ROUTER:kr/claude-sonnet-4.5','ROUTER:kr/deepseek-3.2','ROUTER:kr/glm-5','ROUTER:kr/minimax-m2.5','ROUTER:kr/claude-haiku-4.5']),
    {'kr/claude-sonnet-4.5':'price action','kr/deepseek-3.2':'boğa','kr/glm-5':'ayı','kr/minimax-m2.5':'1g/4sa','kr/claude-haiku-4.5':'5dk+akış'});
  assert.deepEqual(await run(['ROUTER:gc/gemini-3.1-pro-preview','ROUTER:kr/claude-sonnet-4.5','ROUTER:kr/deepseek-3.2','ROUTER:kr/glm-5','ROUTER:kr/minimax-m2.5']),
    {'gc/gemini-3.1-pro-preview':'1g/4sa','kr/claude-sonnet-4.5':'price action','kr/deepseek-3.2':'boğa','kr/glm-5':'ayı','kr/minimax-m2.5':'5dk+akış'});
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');assert.doesNotMatch(sv.match(/const TRADER_ROUTER_ORDER=\[[^\]]*\]/)[0],/qwen3-coder/);assert.match(sv,/!\/qwen3-coder\/\.test\(m\)/);
});
