'use strict';
// R2544.98 (kullanıcı 28.10: "modellere masa giriş ve çıkışlarda mütabık ve tam yetkili olması lazım ... hassas talimat ... veriler, grafik,
// kâr durumu asla göz ardı edilmemeli; işlem açılan zaman dilimi çok önemli; pro trader burada ne yapardı"). LAB 27.10: +2R'den stopa döndü,
// masa 11 kez TUT dedi (eski talimat "HOLD is the measured default").
const test=require('node:test'),assert=require('node:assert/strict');
const DESK=require('../position-desk'),TB=require('../trader-brain');
const T0=Date.UTC(2026,9,27,18,35,0),M5=300000;
// LAB-like LONG: entry 0.04647, stop 0.04577 (1R = 0.0007); ran to +1.75R, now back at +0.55R
const lot={symbol:'LABUSDT',side:'LONG',rule:'LONG_EARLY_RETEST',mode:'TEST',entryPrice:0.04647,stopPrice:0.04577,tpPrice:0.0611,openedAt:T0,deadline:T0+24*3600000,leverage:10,
  part:{atR:2,share:0.5,price:0.04787,done:false,beFee:0.0012},entryFeatures:{}};
const k5=[];for(let i=0;i<40;i++){const t=T0-10*M5+i*M5,peak=i===22?0.04647+1.75*0.0007:null,c=i<10?0.0464:i<23?0.0464+(i-10)*0.00009:0.0475-(i-23)*0.00004;
  k5.push({t,o:c,h:peak??c+0.00003,l:c-0.00003,c,v:1000,tb:500});}
const mark=0.04647+0.55*0.0007;
test('R2544.98 desk prompt: no HOLD default; trade timeframe, open profit, giveback and noise come first; the screen carries them',()=>{
  assert.doesNotMatch(DESK.SYSTEM,/measured default/i);
  for(const w of ['tradeTimeframe','givebackR','toPartR','noiseR','Neither holding nor acting is a default','Do not wait for the stop','chartReading'])assert.ok(DESK.SYSTEM.includes(w),w);
  const p=DESK.packet({lot,mark,k5,k15:k5,k1h:k5,btc5:k5.slice(-13),oi:[],why:null,now:T0+30*M5,lane:'ILK3',chart:{m5:null}});
  assert.deepEqual(p.tradeTimeframe.trigger,'5m');assert.equal(p.tradeTimeframe.structure,'15m');
  assert.ok(Math.abs(p.position.mfeR-1.75)<0.01,'best so far');assert.ok(Math.abs(p.position.nowR-0.55)<0.01);assert.ok(Math.abs(p.position.givebackR-1.2)<0.01,'1.2R of open profit given back');
  assert.ok(Math.abs(p.position.toPartR-1.45)<0.01,'distance to the +2R profit protection');assert.ok(p.noiseR.m5>0);
  assert.ok(!p.measuredFacts.some(f=>/HOLD is the measured default/.test(f)));
  const z=DESK.packet({lot:{...lot,lane:'ZIRVE5'},mark,k5,k15:k5,k1h:k5,btc5:[],oi:[],now:T0+30*M5,lane:'ZIRVE5'});assert.equal(z.tradeTimeframe.trigger,'15m');assert.equal(z.tradeTimeframe.structure,'1h');
  assert.ok(DESK.DESK_ROLES.find(r=>r.key==='risk').text.includes('givebackR'));assert.doesNotMatch(DESK.DESK_ROLES.map(r=>r.text).join(' '),/measured default/);
});
test('R2544.98 committee agreement: no single majority but most voters want to reduce risk -> the mildest reducing action; HOLD majority stays HOLD; one voter has no authority',async()=>{
  const v=(m,action,stopChoice='KEEP')=>({member:m,ok:true,vote:{ok:true,action,stopChoice,reason:'MOMENTUM_FADING',reasonTr:m+' '+action}});
  const run=async res=>DESK.judge({packet:{stopChoices:{KEEP:1}},mode:'TEST',cfg:{testJudges:['COMMITTEE']},judges:{committee:{decide:async()=>res}},stats:{}});
  let r=await run({ok:true,final:'HOLD',consensus:'NO_MAJORITY_DEFAULT',rounds:2,votes:[],round2:[v('a','HOLD'),v('b','HOLD'),v('c','TIGHTEN_STOP','BREAKEVEN'),v('d','EXIT'),v('e','TAKE_PARTIAL')]});
  assert.equal(r.d.action,'TIGHTEN_STOP','3 of 5 want less risk: the mildest of what they voted');assert.equal(r.d.stopChoice,'BREAKEVEN');assert.equal(r.committee.consensus,'REDUCE_MAJORITY');assert.match(r.d.reasonTr,/çoğunluk riski azaltmak istedi \(3\/5\)/);
  r=await run({ok:true,final:'HOLD',consensus:'NO_MAJORITY_DEFAULT',rounds:2,votes:[],round2:[v('a','HOLD'),v('b','HOLD'),v('c','EXIT'),v('d','TAKE_PARTIAL')]});
  assert.equal(r.d.action,'HOLD','2 of 4 is not more than half');
  r=await run({ok:true,final:'HOLD',consensus:'SINGLE_VOTER_DEFAULT',rounds:1,votes:[v('a','EXIT')],round2:null});
  assert.equal(r.d.action,'HOLD');assert.match(r.d.reasonTr,/tek oy, yetki yok/);
  r=await run({ok:true,final:'EXIT',consensus:'MAJORITY_AFTER_DEBATE',rounds:2,votes:[],round2:[v('a','EXIT'),v('b','EXIT'),v('c','HOLD')]});assert.equal(r.d.action,'EXIT');
});
test('R2544.98 entry prompt: the trade timeframe and a professional thinking order; still no habit either way; desk screen has 5m chart reading',()=>{
  for(const w of ['tradeTimeframe','WHAT TRADE IS THIS','TRIGGER','ROOM AND RISK','do not skip by habit, and do not take by habit','chartReading computed by code','trust the chartReading numbers'])assert.ok(TB.ENTRY_SYSTEM.includes(w),w);
  assert.equal(TB.ENTRY_TF.LONG_EARLY_RETEST.trigger,'5m');assert.equal(TB.ENTRY_TF.ZIRVE5_FIBO_LONG.trigger,'15m');
  const lc=require('fs').readFileSync(require('path').join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/const chart=\{m5:TB\.chartReading\(k5\.raw,'5m'/);assert.match(lc,/deskKlines\(a\.symbol,'5m',80\)/);
  assert.equal(TB.TB_VERSION,'R2544.98-TRADER-BRAIN-PRO');assert.equal(DESK.DESK_VERSION,'R2544.98-POSITION-DESK-PRO');
});
test('R2544.98 entry gate: only an agreed SKIP (unanimous / majority after debate, 2+ voters) blocks; a single voter or no majority leaves the decision to the rule',()=>{
  const lc=require('fs').readFileSync(require('path').join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/const agreed=\['UNANIMOUS','MAJORITY_AFTER_DEBATE'\]\.includes\(r\.consensus\)&&\(r\.voters\|\|0\)>=2;/);
  assert.match(lc,/return \{veto:agreed&&r\.final!=='TAKE',record:\{at:clock\(\),decision:agreed\?r\.final:'RULE'/);
});
