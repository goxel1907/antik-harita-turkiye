'use strict';
// R2544.125 (kullanıcı 04.11: "128 ders nasıl 2 doğrulanmış oluyor, her dersten bir şey öğrenmesi gerekir"; "animasyonda ne dediği ne yaptığı net belli olsun")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const T=require('../top3-hunter'),TB=require('../trader-brain');
const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const H=3600000,t0=Date.UTC(2026,9,20);
const mk=(i,R,o={})=>({mode:'TEST',rule:'LONG_EARLY_RETEST',side:'LONG',symbol:'C'+i+'USDT',openedAt:t0+i*H,closedAt:t0+i*H+30*60000,rMultiple:R,stopPct:0.025,
  features:{rank:6,volMult:8,levelName:'PWH',fund:0.0001,premium:0.001,ind:{ok:true,vdpm:{obstacle2R:false},vwob:{oppIn2R:false},lth:{trend:'WITH'}},entryCtx:{preRunR:0.2,btc1hWith:0},...o},autopsy:{ok:true,outcome:R>0?'KAZANC':'KAYIP',causes:[R>0?'TEMIZ_DEVAM':'YANLIS_YON']}});
test('R2544.125 brainCase: the 5 most similar past trades one by one (coin, side, R, why), a lean and a sentence',()=>{
  const L=[mk(1,-1),mk(2,-1.1),mk(3,-0.9),mk(4,1.2),mk(5,-1),mk(6,-1.2)];
  const b=T.brainCase(L,'LONG_EARLY_RETEST',{...mk(0,0).features,stopPct:0.025});
  assert.equal(b.version,'R2544.125-BRAIN');assert.equal(b.k,5);assert.equal(b.n,5);assert.equal(b.lean,'OLUMSUZ');
  assert.ok(b.cases.every(c=>c.side==='LONG'&&c.why&&Number.isFinite(c.R)));assert.ok(b.cases.some(c=>c.why==='yön yanlış'));
  assert.match(b.sentence,/^Benzer 5 işlem: \d kazanç \/ \d kayıp, ort -?\d+,\d\dR → olumsuz$/);
  assert.equal(T.brainCase([],'LONG_EARLY_RETEST',{rank:6}).lean,'BILGI_YOK');
});
test('R2544.125 brainScore: live predictions are scored on the result; the replay uses ONLY earlier trades; the always-negative baseline is shown',()=>{
  const L=[];for(let i=1;i<=14;i++)L.push(mk(i,i%3===0?1.1:-1));
  L.push({...mk(20,1.5),features:{...mk(20,1.5).features,brain:{lean:'OLUMLU',avgR:0.4}}},{...mk(21,-1),features:{...mk(21,-1).features,brain:{lean:'OLUMLU',avgR:0.3}}});
  const s=T.brainScore(L,{mode:'TEST'});
  assert.equal(s.live.n,2);assert.equal(s.live.hits,1);assert.equal(s.live.hitPct,50);assert.equal(s.live.olumlu.avgR,0.25);
  assert.ok(s.back.n>0,'replayed');assert.equal(s.alwaysNegPct,Math.round(100*L.filter(l=>l.rMultiple<=0).length/L.length));
  const first=L[0];const b=T.brainCase(L.filter(p=>p.closedAt<first.openedAt),first.rule,first.features);assert.equal(b.lean,'BILGI_YOK','the first trade had nothing to recall');
  assert.equal(T.brainScore([],{mode:'TEST'}).back.n,0);
});
test('R2544.125 the committee sees the recall case by case and is told it is not proven',()=>{
  const L=[mk(1,-1),mk(2,-1.1),mk(3,-0.9),mk(4,1.2),mk(5,-1)];const b=T.brainCase(L,'LONG_EARLY_RETEST',{...mk(0,0).features,stopPct:0.025});
  const e=TB.briefing({side:'LONG',rule:'LONG_EARLY_RETEST',plan:{entry:1,stop:0.97,target:1.06},tfs:{},levels:[],btc:null,P:2,R:0.03,experience:b}).experience;
  assert.match(e,/^brain recalls the 5 most similar past trades of this rule \(by entry facts\): C\dUSDT|^brain recalls the 5 most similar past trades of this rule \(by entry facts\): C\d LONG/);
  assert.match(e,/lean OLUMSUZ\. Measured on 128 real trades: right in direction, NOT proven - weigh it against the chart, do not obey it\.$/);
  const lc=src('live-controller.js');
  assert.match(lc,/try\{ef\.brain=top3Lib\.brainCase\(top3State\.lessons,x\.rule,ef\);\}catch\{\}/);assert.match(lc,/try\{ef\.brain=top3Lib\.brainCase\(z\.lessons,rule,ef\);\}catch\{\}/);
  assert.equal((lc.match(/experience:ef\.brain\|\|ef\.similar,flags\}\)/g)||[]).length,2);assert.match(lc,/experience:f0\.brain\|\|f0\.similar\|\|null/);
  assert.match(lc,/brain:\(\(\)=>\{try\{const all=\[\.\.\.\(top3State\.lessons\|\|\[\]\),\.\.\.\(z5State\(\)\.lessons\|\|\[\]\)\],sc=top3Lib\.brainScore\(all,\{mode\}\)/);
});
test('R2544.125 Office: the brain canvas shows the signal, its 5 memories, the verdict and the report card',()=>{
  const h=src('office-dashboard/public/office.html');
  for(const re of [/BEYİN: '\+lean\.t/,/📒 BEYNİN KARNESİ/,/hep "olumsuz" deseydi/,/olumlu dediğinde/,/olumsuz dediğinde/,/son tahminler \(✓ dediği oldu \/ ✗ olmadı\)/,/✓ dediği oldu/,/BEYİN ANİMASYONU/,/t\.brain\|\|null/])assert.match(h,re);
  assert.doesNotMatch(h,/function brBuild\(/,'the random star field is gone');
});
