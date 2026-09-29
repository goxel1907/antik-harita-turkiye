'use strict';
// CLAUDE_R2544_10_RUNNER_FLOOR: 29.09 DRIFT LONG — giriş 0,020488, stop 0,020257 (R≈0,000231), ilk 14641.
// 09:55 guard 1/3 (0,5R) → 09:58 TP1 4880 doldu (faz TRAILING, kalan 4882 = %33,3) →
// 10:03 JEV kısmi 1627 @0,02058 (0,39R) → 10:14 JEV kısmi 1085 @0,02063 (0,6R) → runner %14,8.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const G=require('../position-guard');
const base={side:'LONG',entryPrice:0.020488,initialStop:0.020257,partialEvents:[],now:0,config:G.DEFAULTS};
test('TP1 sonrası TP1 fiyatının altında JEV kısmisi ertelenir (DRIFT 10:03 / 10:14)',()=>{
  const a=G.partialContract({...base,markPrice:0.02058,phase:'TRAILING',remainingFraction:4882/14641,reducedFraction:4879/14641});
  assert.equal(a.allow,false);assert.equal(a.reason,'PARTIAL_DEFERRED_POST_TP1_BELOW_TP1');
  const b=G.partialContract({...base,markPrice:0.02063,phase:'BREAKEVEN',remainingFraction:4882/14641});
  assert.equal(b.reason,'PARTIAL_DEFERRED_POST_TP1_BELOW_TP1');
});
test('TP1 ötesinde kısmi runner tabanına (%25) kırpılır, taban dolunca ertelenir',()=>{
  const ok=G.partialContract({...base,markPrice:0.02082,phase:'TRAILING',remainingFraction:4882/14641});
  assert.equal(ok.allow,true);assert.equal(ok.reason,'PARTIAL_CONTRACT_OK');
  assert.ok(Math.abs(ok.maxFractionOfInitial-(4882/14641-0.25))<1e-3,'yalnız %8,3 satılabilir');
  // live-controller kırpması: fraction ≤ maxFractionOfInitial*init/cur → 1/3 istek 0,25'e iner (1220 adet), runner 3662 = %25.
  const f=Math.max(0.01,Math.min(1/3,ok.maxFractionOfInitial*14641/4882));
  assert.ok(Math.abs(4882*(1-f)/14641-0.25)<2e-3);
  const floor=G.partialContract({...base,markPrice:0.02082,phase:'TRAILING',remainingFraction:0.26});
  assert.equal(floor.allow,false);assert.equal(floor.reason,'PARTIAL_DEFERRED_RUNNER_FLOOR');
});
test('TP1 öncesi davranış ve eski çağrılar değişmez',()=>{
  const pre=G.partialContract({...base,markPrice:0.02058,phase:'INITIAL',reducedFraction:0});
  assert.equal(pre.allow,true);assert.ok(Math.abs(pre.maxFractionOfInitial-0.3334)<1e-6);
  const legacy=G.partialContract({...base,markPrice:0.02058});
  assert.equal(legacy.allow,true,'faz/runner verisi yoksa TP1 öncesi say');
  const short=G.partialContract({side:'SHORT',entryPrice:1415.2,initialStop:1427.7,markPrice:1400,partialEvents:[],now:0,config:G.DEFAULTS,phase:'TRAILING',remainingFraction:0.66});
  assert.equal(short.allow,true);assert.ok(Math.abs(short.maxFractionOfInitial-0.41)<1e-6);
});
test('config ile kapatılabilir; live-controller kalan oranı gönderir; sözleşme metni JEV\'e yazılı',()=>{
  const off=G.partialContract({...base,markPrice:0.02058,phase:'TRAILING',remainingFraction:0.3,config:{...G.DEFAULTS,postTp1PartialMinR:-10,postTp1RunnerFloorFraction:0}});
  assert.equal(off.allow,true);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/remainingFraction:finite\(runnerRow\?\.initialQty\)>0/);
  assert.match(lc,/after TP1 fills, a partial needs progressR >= 1 \(price beyond TP1\) and must leave at least 25% of the initial size as the runner/);
  const oh=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(oh,/TP1 sonrası: kısmi ≥1R • runner ≥%25/);
});
