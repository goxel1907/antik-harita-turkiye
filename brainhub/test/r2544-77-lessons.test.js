'use strict';
// R2544.77 (user 23.10: "bu işlemlerin hepsine bak doğru mu, beyine doğru öğrenim gitmiş mi"). Found on the real lane memory:
//  - a kâr koruma lot showed the rest's exit % ("kazanç -0,1 %" on a +0,42 R win): the lesson result is now the whole lot's;
//  - ZİRVE-5 exits (ZIRVE5_*) had no tags and a raw exit text; ZİRVE-5 rule names were raw;
//  - "başabaş stop (1R sonrası korunan)" (kâr koruma is at 2R now);
//  - a winner that ran >= 3R and came back (AKE 6,2R -> break-even) carried no tag: GAVE_BACK.
// The lane memory (İlk 3 and ZİRVE-5 lessons, which JEV reads) is repaired once; Office price R uses the live mark.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const T=require('../top3-hunter');
const lotZ5={id:'z1',symbol:'AKEUSDT',side:'SHORT',rule:'ZIRVE5_FIBO_SHORT',lane:'ZIRVE5',entryPrice:0.024155,exitPrice:0.024175,stopPct:0.0197,tpPrice:0.021035,openedAt:0,closedAt:8.6e6,signalKind:'FRESH',mode:'TEST',entryFeatures:{sweep:{}}};
const recZ5={netPnl:4.19,rMultiple:0.4244,outcomePct:0.84,exitType:'ZIRVE5_BE_STOP',partial:{atR:1,share:0.5,taken:true}};
test('R2544.77 lesson: kâr koruma lot = whole-lot result; ZİRVE-5 exit tags and text; GAVE_BACK after >= 3R',()=>{
  const l=T.buildLesson(lotZ5,recZ5,{mfePct:0.123,maePct:-0.002});
  assert.equal(l.resultPct,0.0084,'net / notional of the whole lot, not the rest\'s exit price (-0.08 %)');assert.equal(l.resultBasis,'NET_PNL_WHOLE_LOT');
  assert.deepEqual(l.tags,['BREAKEVEN_STOP','PARTIAL_TAKEN','GAVE_BACK']);
  assert.match(l.lessonTr,/^ZİRVE-5 SHORT \(15 dk alan onayı\): kazanç \+0,8% \/ 0,42 R/);assert.match(l.lessonTr,/çıkış başabaş stop \(kâr koruma sonrası\)/);
  assert.match(l.lessonTr,/Kâr koruma: %50'si 1R'de alındı \(sonuç tüm lotun\)/);assert.match(l.lessonTr,/6,2 R gördükten sonra kârın çoğunu geri verdi/);
  assert.deepEqual(l.partial,{atR:1,share:0.5,taken:true});
  // a target hit is never "gave back"; ZİRVE-5 take profit / stop get their tags
  assert.deepEqual(T.buildLesson(lotZ5,{...recZ5,exitType:'ZIRVE5_TAKE_PROFIT',partial:null,rMultiple:6.5},{mfePct:0.13,maePct:0}).tags,['TARGET_HIT']);
  assert.ok(T.buildLesson(lotZ5,{...recZ5,exitType:'ZIRVE5_STOP',partial:null,rMultiple:-1},{mfePct:0.001,maePct:-0.02}).tags.includes('STOPPED'));
});
test('R2544.77 lane memory repair: old kâr koruma / ZİRVE-5 lessons fixed once (JEV reads them); idempotent',()=>{
  const old=[{id:'a',symbol:'IOTXUSDT',rule:'LONG_EARLY_RETEST',exitType:'TOP3_BE_STOP',rMultiple:0.4196,stopPct:0.0238,resultPct:-0.0014,mfePct:0.0303,tags:['BREAKEVEN_STOP'],
      lessonTr:"Erken LONG (5 dk geri test): kazanç -0,1% / 0,42 R, 0,2 sa; en iyi +3,0% (hedefin %43'i), en kötü -1,0%; çıkış başabaş stop (1R sonrası korunan)."},
    {id:'b',symbol:'AKEUSDT',rule:'ZIRVE5_FIBO_SHORT',exitType:'ZIRVE5_BE_STOP',rMultiple:0.4244,stopPct:0.0197,resultPct:-0.0008,mfePct:0.123,tags:[],
      lessonTr:"ZIRVE5_FIBO_SHORT: kazanç -0,2% / 0,42 R, 2,4 sa; en iyi +12,3% (hedefin %95'i), en kötü -5,2%; çıkış ZIRVE5_BE_STOP."},
    {id:'c',symbol:'ZAMAUSDT',rule:'SHORT_TOP_BREAK',exitType:'TOP3_TAKE_PROFIT',rMultiple:1.71,stopPct:0.031,resultPct:0.078,mfePct:0.079,tags:['TARGET_HIT'],lessonTr:'Tepe SHORT: kazanç +7,8% / 1,71 R; çıkış hedef.'}];
  const r=T.repairLessons(old);assert.equal(r.repaired,2,'the target-hit lesson is untouched');
  const [a,b,c]=r.lessons;
  assert.ok(Math.abs(a.resultPct-0.0100)<0.0001);assert.deepEqual(a.tags,['BREAKEVEN_STOP','PARTIAL_TAKEN']);assert.match(a.lessonTr,/kazanç \+1,0% \/ 0,42 R/);assert.match(a.lessonTr,/kâr koruma sonrası/);
  assert.deepEqual(b.tags,['BREAKEVEN_STOP','PARTIAL_TAKEN','GAVE_BACK']);assert.match(b.lessonTr,/^ZİRVE-5 SHORT \(15 dk alan onayı\): kazanç \+0,8%/);assert.match(b.lessonTr,/çıkış başabaş stop \(kâr koruma sonrası\)/);assert.match(b.lessonTr,/6,2 R gördükten sonra/);
  assert.equal(c,old[2]);
  assert.equal(T.repairLessons(r.lessons).repaired,0,'idempotent');
});
test('R2544.77 wiring: the ZİRVE-5 lane memory is repaired on load; Office price R uses the live paper mark',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(lc,/const z=top3State\.z5;if\(z&&Array\.isArray\(z\.lessons\)\)\{const rep=top3Lib\.repairLessons\(z\.lessons\)/);
  assert.match(h,/const e0=Number\(p\.entryPrice\),s0=Number\(p\.originalStopPrice\?\?p\.stopPrice\),m0=Number\(q\.markPrice\)/);
});
