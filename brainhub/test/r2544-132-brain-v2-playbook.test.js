'use strict';
// R2544.132 BEYİN v2 (kullanıcı 09.11: "beyin v2'ye başla; eldeki test verileri boşa gitmesin")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const A=require('../trade-autopsy'),T=require('../top3-hunter');
const M5=300000,t0=Date.UTC(2026,10,1,10,0,0);
// LONG 100, stop 2 % (1R = 2), target 4 % (2R); bars [t, o, h, l, c]
const bar=(i,o,h,l,c)=>[t0+i*M5,o,h,l,c];
const tr={side:'LONG',entryPrice:100,stopPct:0.02,targetPct:0.04,openedAt:t0};
test('R2544.132 replay: the same path under each rule; same-bar stop + level -> stop first (pessimistic); break-even from the next bar',()=>{
  // up to +1R (102), then down to the stop (98)
  const k=[bar(0,100,101,99.5,100.5),bar(1,100.5,102.1,100.2,101.8),bar(2,101.8,101.9,99.9,100),bar(3,100,100.2,97.9,98)];
  const r=A.replayAll(tr,k);
  assert.equal(r.PLAN.R,-1);assert.equal(r.PLAN.how,'STOP');assert.equal(r.KK2.R,-1,'2R never reached');
  assert.equal(r.BE1.R,0,'stop at entry from the bar after +1R');assert.equal(r.BE1.how,'BASABAS');
  assert.equal(r.KK1.R,0.5,'half at 1R (+0,5R), the rest at break-even');
  // one bar touches both the stop and the target -> the stop
  const k2=[bar(0,100,104.5,97.5,101)];assert.equal(A.replayAll(tr,k2).PLAN.R,-1);
  // the target first: +2R; T15 takes 1,5R
  const k3=[bar(0,100,101,99.5,100.8),bar(1,100.8,104.2,100.5,104)];const r3=A.replayAll(tr,k3);assert.equal(r3.PLAN.R,2);assert.equal(r3.T15.R,1.5);
  // time: no level in 4 h -> Z4 closes at the 4 h close
  const k4=Array.from({length:60},(_,i)=>bar(i,100,100.5,99.6,100+(i<48?0.2:0.6)));const r4=A.replayAll(tr,k4);assert.equal(r4.Z4.how,'SURE');assert.equal(r4.Z4.R,0.1);
});
const lesson=(i,real,R)=>({id:'L'+i,mode:'TEST',rule:'SHORT_TOP_BREAK',symbol:'X'+i+'USDT',side:'SHORT',openedAt:t0+i*3600000,closedAt:t0+i*3600000+1800000,rMultiple:real,replay:{R}});
const mk=(kk2,be1)=>({PLAN:{R:kk2},KK2:{R:kk2},BE1:{R:be1},KK1:{R:kk2},T15:{R:kk2},Z4:{R:kk2},Z8:{R:kk2}});
test('R2544.132 playbook: a rule is recommended only when better in both halves, t >= 2 and without its biggest trade; one huge trade never decides',()=>{
  const steady=Array.from({length:24},(_,i)=>lesson(i,-1,mk(-1,i%3===0?-0.6:-0.4)));
  let pb=T.playbook(steady,{mode:'TEST'});const be=pb.groups[0].rules.find(r=>r.key==='BE1');
  assert.equal(be.verdict,'ÖNERİLİR');assert.equal(pb.groups[0].recommend,'BE1');assert.match(pb.groups[0].text,/^ÖNERİ: \+1R’de stopu girişe çek/);
  const one=Array.from({length:24},(_,i)=>lesson(100+i,0,mk(0,i===5?30:-0.05)));
  pb=T.playbook(one,{mode:'TEST'});assert.notEqual(pb.groups[0].rules.find(r=>r.key==='BE1').verdict,'ÖNERİLİR','one trade (+30R) does not make a rule');
  assert.equal(pb.groups[0].recommend,null);assert.match(pb.groups[0].text,/şimdiki kural/);
  const few=Array.from({length:10},(_,i)=>lesson(200+i,-1,mk(-1,-0.4)));assert.equal(T.playbook(few,{mode:'TEST'}).groups[0].recommend,null,'under 20 trades: no proposal');
  const r=T.playbook(steady,{mode:'TEST'}).recent[0];assert.equal(r.best.k,'BE1');
  const same=T.playbook([lesson(300,-1,mk(-1,-1))],{mode:'TEST'}).recent[0];assert.equal(same.best,null,'all equal: no rule would have changed it');
});
test('R2544.132 wiring: old lessons are replayed in the autopsy pass (6 a pass, 24 h after the open); the recall carries plan / best rule; Office shows the playbook',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),tb=fs.readFileSync(path.join(__dirname,'..','trader-brain.js'),'utf8'),h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(lc,/now>=l\.openedAt\+DAYMS\+10\*60000/);assert.match(lc,/\.filter\(rpDue\)\.sort\(\(a,b\)=>a\.openedAt-b\.openedAt\)\.slice\(0,6\)/);assert.match(lc,/l\.replay=\{version:'R2544\.132-REPLAY',at:now,R:rr\}/);
  assert.match(lc,/playbook:\(\(\)=>\{try\{return top3Lib\.playbook\(/);assert.match(tb,/left to the plan/);assert.match(tb,/best management/);
  assert.match(h,/📘 OYUN KİTABI/);assert.match(h,/function pbHtml\(pb\)/);assert.match(h,/hiçbir kural kurtarmazdı/);
});

test('R2544.132 a rule ahead only through one trade is "not proven", not "current is better"; a winning trade with no better rule says the current management was best',()=>{
  const xs=Array.from({length:24},(_,i)=>lesson(400+i,0,mk(0,i===3?20:-0.3)));const be=T.playbook(xs,{mode:'TEST'}).groups[0].rules.find(r=>r.key==='BE1');
  assert.ok(be.diff>0&&be.robust<0);assert.equal(be.verdict,'KANITLANMADI');
  const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');assert.match(h,/şimdiki yönetim en iyisiydi/);assert.match(h,/götürürdü/);
});
