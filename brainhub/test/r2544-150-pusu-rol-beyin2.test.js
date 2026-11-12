'use strict';
// R2544.150: PUSU twins (the exact opposite of every forecast), a different lens for every model each round (no herd), every model told its
// own record and its twin's, and BEYİN-2 - a brain that really learns (online logistic regression, one step per real outcome).
const test=require('node:test'),assert=require('node:assert/strict');
const K=require('../kesif');

test('R2544.150 PUSU: every directional forecast gets its exact opposite with the same stop, target, hours and entry; never a twin of a twin, a label or NONE', ()=>{
  const r=K.open({model:'OVH:x',symbol:'AUSDT',forecast:{ok:true,direction:'LONG',stopPct:2,targetPct:5,horizonH:4,confidence:70,reasonTr:'r',trapTr:'t'},at:1000,round:'k1'});
  const t=K.mirror(r);assert.equal(t.model,'PUSU:OVH:x');assert.equal(t.side,'SHORT');assert.deepEqual([t.stopPct,t.targetPct,t.horizonH,t.entryAt,t.symbol],[2,5,4,r.entryAt,'AUSDT']);assert.equal(t.id,r.id+':PUSU');assert.equal(t.trap,undefined);
  assert.equal(K.mirror(t),null);assert.equal(K.mirror({...r,model:'_ETIKET'}),null);assert.equal(K.mirror({...r,side:'NONE'}),null);assert.equal(K.mirror({...r,done:true}),null);
  // scored on the same candles: the LONG reaches its target first -> the twin SHORT is stopped
  const c=(i,o,h,l,cl)=>[r.entryAt+i*300000,String(o),String(h),String(l),String(cl),'1',0,'1',1,'0'];
  const k=[c(0,100,101,99.5,100.8),c(1,100.8,105.5,100.5,105)];
  assert.equal(K.resolve(r,k,r.entryAt+3*300000).outcome,'TARGET');assert.equal(K.resolve(t,k,r.entryAt+3*300000).outcome,'STOP');
});

test('R2544.150 roles: every model reads the round through a lens; the lens rotates round by round; the prompt asks for the obvious trade and the trap', ()=>{
  const ids=['OVH:a','OVH:b','KILO:c','ROUTER:nvidia/d','ROUTER:cf/e','OVH:f','OVH:g'];
  const r1=ids.map(i=>K.roleFor(i,1).key),r2=ids.map(i=>K.roleFor(i,2).key);
  assert.ok(new Set(r1).size>=3,'not one opinion seven times');assert.ok(r1.every((x,i)=>x!==r2[i]),'the lens changes every round');
  assert.equal(K.ROLES.length,7);assert.ok(K.ROLES.some(r=>r.key==='PUSU'&&/bait/.test(r.en)));
  assert.match(K.SYSTEM,/obviousTr/);assert.match(K.SYSTEM,/trapTr/);assert.match(K.SYSTEM,/Do not copy the crowd/);assert.match(K.SYSTEM,/ambush twin/);
  const p=K.parse('{"direction":"SHORT","stopPct":2,"targetPct":4,"horizonH":3,"obviousTr":"herkes long","trapTr":"long stoplari dipte"}');assert.equal(p.trapTr,'long stoplari dipte');assert.equal(p.obviousTr,'herkes long');
  assert.equal(K.herd([{direction:'LONG'},{direction:'LONG'},{direction:'LONG'},{direction:'SHORT'},{direction:'NONE'}]),0.75);assert.equal(K.herd([{direction:'LONG'}]),null);
});

test('R2544.150 every model is told its own record and its twin\'s; a twin that beats it says "you have been the bait"', ()=>{
  const kr={rows:[{model:'x',n:10,hitPct:20,avgR:-0.6,long:{n:5,avgR:-1},short:{n:5,avgR:-0.2}},{model:'PUSU:x',n:10,hitPct:60,avgR:0.4}]};
  const me=K.selfRecord(kr,'x');assert.equal(me.ambushTwin.avgR,0.4);assert.match(me.lesson,/bait/);
  assert.equal(K.selfRecord(kr,'nobody').n,0);assert.equal(K.selfRecord({rows:[{model:'y',n:10,avgR:0.5},{model:'PUSU:y',n:10,avgR:-0.6}]},'y').lesson,undefined);
  const b=K.brief({},[],K.brainCall({},[]),{rows:[{model:'PUSU:IZ:DUVAR',n:3},{model:'BEYIN2',n:2},{model:'PUSU:ORTAK',n:1}]});
  assert.deepEqual(b.desk.rows.map(r=>r.trader),['ambush twin (the exact opposite) of trace rule DUVAR','learning brain','ambush twin (the exact opposite) of the crowd']);
});

test('R2544.150 BEYİN-2 really learns: on a live stream where one footprint decides the move it beats the base rate in both halves; copies do not shout; on noise it stays near the base rate', ()=>{
  const run=(signal,copies,seed,copyNoise=false)=>{let m={};const rows=[];const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
    for(let i=0;i<200;i++){const up=rnd()<0.5,cn=rnd()<0.5,feats=[...Array.from({length:60},(_,j)=>'noise'+j+':'+(rnd()<0.5?'A':'B')),up?'iz:defter:ALIS':'iz:defter:SATIS',...Array.from({length:copies},(_,j)=>'kopya'+j+':'+((copyNoise?cn:up)?'A':'B'))];
      const y=rnd()<signal?(up?1:0):(up?0:1);rows.push({at:i,p:K.brainCall(m,feats).pUp,p2:K.brain2P(m,feats),b:0.5,y});m=K.matrixAdd(m,feats,y?'UP':'DOWN',2);}return {m,rows};};
  const s=run(0.85,0,7),L=K.learningCheck(s.rows,'p2');assert.equal(L.which,'BEYIN2');assert.equal(L.state,'OGRENIYOR');assert.ok(L.all.skillPct>20,'clearly better than the base rate: '+L.all.skillPct);
  assert.ok(K.brain2Top(s.m,3).some(t=>t.f.startsWith('iz:defter:')),'the footprint that decides is the one with evidence');
  // 15 copies of a MEANINGLESS footprint (charts repeat the same fact on 5 timeframes): the summing brain is fooled, the averaging one is not
  for(const seed of [3,7,11]){const c=run(0.5,15,seed,true),p1=K.learningCheck(c.rows,'p').all.skillPct,p2=K.learningCheck(c.rows,'p2').all.skillPct;assert.ok(p1<-20&&p2>-6,`seed ${seed}: brain1 ${p1} brain2 ${p2}`);}
  const mix=run(0.75,15,3,true);assert.ok(K.learningCheck(mix.rows,'p2').all.skillPct>5,'a real footprint among meaningless copies is still found');
  for(const seed of [3,11,19]){const n=run(0.5,0,seed);assert.ok(K.learningCheck(n.rows,'p2').all.skillPct>-6,'noise: no false learning (seed '+seed+')');}
  assert.equal(K.brain2Forecast(s.m,0.8,2).direction,'LONG');assert.equal(K.brain2Forecast({_total:{UP:3,DOWN:4}},0.9,2).direction,'NONE','warming up below 20 directional labels');
});

test('R2544.150 who voted what becomes features of the learning brain (model, role, crowd, herd)', ()=>{
  const f=K.voteFeats([{key:'m1',direction:'LONG'},{key:'m2',direction:'SHORT'}],{m1:'PUSU',m2:'TREND'},'SHORT',0.9);
  assert.deepEqual(f.sort(),['oy:m1:LONG','oy:m2:SHORT','oy:ortak:SHORT','oy:suru:YUKSEK','rol:PUSU:LONG','rol:TREND:SHORT']);
});

test('R2544.150 the committee poll gives every member its own prompt', async()=>{
  const MC=require('../model-committee');const seen={};
  const members=['A:1','B:2'].map(id=>({id,call:async a=>{if(a.system===MC.PROBE_SYSTEM)return {ok:true,text:'{"ok":true}'};seen[id]=a.prompt;return {ok:true,text:'{"direction":"NONE"}'};}}));
  const c=MC.createCommittee({members,size:2});await c.probe({force:true});
  const r=await c.poll({system:'s',prompt:id=>JSON.stringify({me:id}),validate:K.valid,parse:K.parse});
  assert.equal(r.voters,2);assert.deepEqual(seen,{'A:1':'{"me":"A:1"}','B:2':'{"me":"B:2"}'});
});
