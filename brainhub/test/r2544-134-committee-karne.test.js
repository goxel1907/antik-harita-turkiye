'use strict';
// R2544.134 KURUL KARNESİ + KOTA UYKUSU (kullanıcı 09.11: "zayıflama durumunda o modellerin yerine geçecek, aratmayacak modeller")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const A=require('../trade-autopsy'),T=require('../top3-hunter'),MC=require('../model-committee');
const M5=300000,t0=Date.UTC(2026,10,1,10,2,0),b0=Date.UTC(2026,10,1,10,0,0);
const bar=(i,o,h,l,c)=>[b0+i*M5,o,h,l,c];
const tr={side:'LONG',entryPrice:100,stopPct:0.02,targetPct:0.04,openedAt:t0};
test('R2544.134 replay: the entry bar counts - a stop inside it is seen; its high before the entry is not a target',()=>{
  // entry at 10:02 inside the 10:00 bar; that bar fell to 97,5 (below the stop 98) -> STOP, not the later target
  const k=[bar(0,101,105,97.5,99),bar(1,99,104.5,98.5,104.2)];
  assert.equal(A.replayAll(tr,k).PLAN.R,-1);assert.equal(A.replayAll(tr,k).PLAN.how,'STOP');
  // the entry bar's high (105, before the entry) does not count; only its close (101 = +0,5R)
  const k2=[bar(0,99,105,99.5,101),bar(1,101,101.5,100.5,101)];assert.notEqual(A.replayAll(tr,k2).PLAN.how,'HEDEF');
});
test('R2544.134 vote truth: an EXIT vote is weighed against holding with today\'s rule on the same candles',()=>{
  const k=[bar(0,100,100.5,99.6,100.4),bar(1,100.4,100.6,99.9,100.2),bar(2,100.2,100.3,97.8,98)]; // stopped in bar 2
  const d=[{at:b0+M5+60000,action:'EXIT',committee:{votes:[{m:'nv/a',a:'EXIT'},{m:'gm/b',a:'HOLD'},{m:'cf/c',a:'TAKE_PARTIAL'}]}}];
  const v=A.replayVotes(tr,k,d);assert.deepEqual(v.map(x=>x.m),['nv/a','cf/c'],'only exit-like votes');
  assert.equal(v[0].v,1.1,'exit at bar 1 close (+0,1R) vs hold to the stop (-1R) = +1,1R');
  assert.deepEqual(A.replayVotes(tr,k,[{at:b0,action:'HOLD',committee:{votes:[{m:'x',a:'HOLD'}]}}]),[]);
});
test('R2544.134 karne: score from median + robust mean; a member right < 40 % with a robust mean < -0,3R is benched; < 8 votes = no opinion',()=>{
  const L=v=>({replay:{votes:v}}),good=Array.from({length:10},(_,i)=>({m:'good',v:i<7?0.5:-0.4})),bad=Array.from({length:13},(_,i)=>({m:'bad',v:i<4?0.3:-1.2})),few=[{m:'few',v:-3}];
  const K=T.committeeKarne([L(good),L(bad),L(few)]);
  assert.ok(K.models.good.score>0);assert.equal(K.models.good.bench,false);assert.equal(K.models.bad.bench,true);assert.equal(K.models.few.score,0);assert.equal(K.models.few.bench,false);
});
const okProbe=async()=>({ok:true,text:'{"ok":true}'});
test('R2544.134 committee: the karne orders the seats and a benched member never sits (desk or quick vote)',async()=>{
  const ids=['ROUTER:gemini/a','ROUTER:nvidia/b','OR:c:free','ROUTER:gemini/bad'];
  const c=MC.createCommittee({members:ids.map(id=>({id,call:okProbe})),size:3,clock:()=>Date.UTC(2026,10,9,7,0,0)});await c.probe({force:true});
  c.setRank({models:{'nvidia/b':{score:0.4},'c:free':{score:0.2},'gemini/bad':{score:-1,bench:true}}});
  assert.deepEqual(c.pick(3).map(m=>m.id).slice(0,2),['ROUTER:nvidia/b','OR:c:free']);assert.ok(!c.pick(4).some(m=>m.id==='ROUTER:gemini/bad'));
  assert.deepEqual(c.status().karne.benched,['gemini/bad']);
});
test('R2544.134 quota sleep: a Gemini member answering "quota" for 3 minutes sleeps until midnight Pacific (TR 11:00 in winter); its allowance is spread over the day',async()=>{
  let now=Date.UTC(2026,10,9,9,0,0),fail=false;const q='HTTP 503 [gemini/gemini-4-argon] [429]: You exceeded your current quota';
  const c=MC.createCommittee({members:[{id:'ROUTER:gemini/x',call:async()=>fail?{ok:false,reason:q}:{ok:true,text:'{"ok":true}'}},{id:'ROUTER:nvidia/y',call:okProbe}],clock:()=>now});
  for(let i=0;i<5;i++){await c.probe({force:true});now+=60000;} // 5 good answers in this pool day
  fail=true;for(let i=0;i<4;i++){await c.probe({force:true});now+=70000;}
  const h=c.status().members.find(m=>m.id==='ROUTER:gemini/x');
  assert.equal(h.sleepUntil,Date.UTC(2026,10,10,8,0,0),'midnight Los Angeles (PST) = 08:00 UTC');assert.equal(h.capSeen,5);
  assert.ok(!c.healthy().some(m=>m.id==='ROUTER:gemini/x'),'a sleeper does not sit');
  // the next pool day: at 1 h after the reset it may use 5*1/24+2 answers, not all five
  now=Date.UTC(2026,10,10,9,0,0);fail=false;await c.probe({force:true});await c.probe({force:true});await c.probe({force:true});
  assert.ok(!c.pick(2).some(m=>m.id==='ROUTER:gemini/x'),'over its hourly share: the seat goes to another member');
  assert.equal(MC.nextPacificMidnight(Date.UTC(2026,6,9,9,0,0)),Date.UTC(2026,6,10,7,0,0),'summer (PDT) = 07:00 UTC');
});
test('R2544.134 wiring: replays carry vote truths, the karne reaches the desk committee, the NVIDIA seats use the connected ids',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(lc,/deskJudges\.committee\.setRank\(K\)/);assert.match(lc,/karne:deskKarne/);assert.match(lc,/l\.replay\?\.version!==RP_VERSION&&\(l\.rpTries134\|\|0\)<3/);
  for(const id of ['nvidia/deepseek-ai/deepseek-v4-pro','nvidia/moonshotai/kimi-k2.6','nvidia/z-ai/glm-5.2'])assert.ok(sv.includes(`'${id}'`));
  assert.ok(!sv.includes("'nvidia/moonshotai/kimi-k3'"));
});
