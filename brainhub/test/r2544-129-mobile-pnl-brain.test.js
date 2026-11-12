'use strict';
// R2544.129 (kullanıcı 04.11: "APK'yı ver"; EVAA / VVV / JCT "sonuç yok" göründü - lot sınırı doluydu)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {mobileStatus}=require('../mobile-status');
test('R2544.129 phone payload: P&L from the ledger (top-ups apart), the brain recall + report card, the funnel, desk fate and live R per lot',()=>{
  const tot=(net,n)=>({net,trades:n,wins:1,R:0.5,fees:-1});
  const desk={action:'EXIT',judge:'COMMITTEE',authority:true,guard:{code:'NOISE_GUARD',openMin:61,R:-0.216},committee:{consensus:'MAJORITY_AFTER_DEBATE',votes:[]},text:'ÇIK'};
  const st={top3:{version:'x',tradingMode:'TEST',switches:{},active:[{symbol:'FLUIDUSDT',side:'SHORT',livePath:[[1,0.1],[2,0.57],[3,0.46]],deskInfo:{last:desk,pending:null}}],
    pnl:{mode:'TEST',readAt:5,error:null,totals:{today:tot(108.93,6),last24h:tot(19.37,11),week:tot(-10.8,19),last30d:tot(19.83,128),all:tot(19.83,128)},cash:{total:300,n:3},days:[{label:'04.11',net:108.93}]},
    brain:{last:{symbol:'UAIUSDT',side:'SHORT',status:'OPEN',lean:'OLUMSUZ',sentence:'Benzer 5 işlem: 2 kazanç / 3 kayıp, ort -0,28R → olumsuz',cases:[{symbol:'LAUSDT',side:'SHORT',R:-1.1,why:'yön yanlış'}]},
      score:{lessons:128,alwaysNegPct:63,live:{n:0},back:{n:73,hitPct:62,olumlu:{avgR:0.06},olumsuz:{avgR:-0.37}}}},
    funnel:{signals:26,opened:12,ruleBlocked:9,committeeSkip:0,noResult:5,reasons:{TOP3_SLOTS_FULL:3},rows:[{at:'t',lane:'TOP3',symbol:'JCTUSDT',side:'SHORT',fate:'RULE_BLOCKED',reason:'TOP3_SLOTS_FULL'}]}}};
  const o=mobileStatus(st);
  assert.deepEqual(o.pnl.today,{net:108.93,n:6,w:1,R:0.5,fee:-1});assert.deepEqual(o.pnl.cash,{total:300,n:3});assert.deepEqual(o.pnl.days,[['04.11',108.93]]);
  assert.equal(o.brain.last.s,'UAI');assert.equal(o.brain.last.lean,'OLUMSUZ');assert.deepEqual(o.brain.last.cases[0],{s:'LA',side:'SHORT',R:-1.1,why:'yön yanlış'});
  assert.deepEqual(o.brain.score,{src:'back',n:73,hit:62,neg:63,pos:0.06,negR:-0.37});
  assert.deepEqual(o.funnel.rows[0],{at:'t',l:'TOP3',s:'JCT',side:'SHORT',f:'RULE_BLOCKED',why:'TOP3_SLOTS_FULL'});
  assert.deepEqual(o.top3.active[0].r,{R:0.46,best:0.57});assert.deepEqual(o.top3.active[0].cm.desk.f,{guard:true,min:61,R:-0.216});
  assert.equal(o.mobileContract,'R2544.78_PC_STATUS','old phones keep working');assert.equal(o.mobileFeatures,'R2544.154');
});
test('R2544.129 a full lane is written down (funnel and phone say "lot sınırı dolu", not "sonuç yok")',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/res\.reason='TOP3_SLOTS_FULL';try\{store\.journal\('TOP3_BLOCKED',x\.symbol,\{side:x\.side,rule:x\.rule,result:\{ok:false,reason:'TOP3_SLOTS_FULL'/);
  const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');assert.match(h,/TOP3_SLOTS_FULL:'lot sınırı dolu \(hat başına 2 açık işlem\)'/);
});
