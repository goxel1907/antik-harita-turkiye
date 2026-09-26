'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {derive}=require('../office-dashboard/office-server');
function snapshot(pass1=0){return {
  status:{ok:true,data:{armed:false,featureVersion:'9.5.113-CLAUDE-VISION',jevSovereign:{enabled:true},
    leaderAuto:{enabled:true,health:{scanRuns:120,tickResults:120,deepAnalyses:180,uniqueAnalyzedSymbols:49,
      sovereignPass1Calls:pass1,sovereignFinalCalls:0,topReasons:[{reason:'JEV_DAILY_BUDGET_EXHAUSTED',count:300}]}}}},
  jevBudget:{ok:true,data:{remainingUsd:0.00115387,reservePerCallUsd:0.002,dailyCapUsd:5,
    canReserveNextCall:false,budgetCallBlocked:true,nextResetAt:'2026-09-27T00:00:00Z'}},
  positions:{ok:true,data:{performance:{funnel:{analyses:12,uniqueCoverage:3,pass1:4,pass2:1,long:1,short:0,wait:0,safetyPassed:1,orders:0}}}}
};}
test('Office preserves runtime scanner health while reconciling durable decision funnel',()=>{
  const snap=snapshot(); const original=JSON.stringify(snap); const d=derive(snap);
  assert.equal(JSON.stringify(snap),original);
  assert.equal(d.scanner.scanRuns,120); assert.equal(d.scanner.tickResults,120);
  assert.equal(d.scanner.deepAnalyses,180); assert.equal(d.scanner.uniqueAnalyzedSymbols,49);
  assert.equal(d.funnel.find(x=>x.key==='pass1').value,4);
  assert.equal(d.funnel.find(x=>x.key==='orders').value,0);
});
for(const pass1 of [0,3])test(`Office budget refusal suppresses misleading pipeline diagnosis (PASS-1 ${pass1})`,()=>{
  const d=derive(snapshot(pass1));
  assert.equal(d.budgetBlocked,true);
  const b=d.blockers.find(x=>x.code==='JEV_DAILY_BUDGET_EXHAUSTED');
  assert.ok(b); assert.match(b.detail,/0\.001154/); assert.match(b.detail,/0\.002000/);
  assert.match(b.detail,/2026-09-27T00:00:00Z/);
  assert.equal(d.blockers.some(x=>['JEV_PASS1_MISSING','JEV_FINAL_MISSING'].includes(x.code)),false);
  assert.equal(d.desks.scanner.busy,true);
});
test('Office current reset budget wins over historical budget refusals',()=>{
  const s=snapshot(); s.jevBudget.data={...s.jevBudget.data,budgetCallBlocked:false,canReserveNextCall:true,remainingUsd:5};
  s.status.data.jev={budget:{budgetCallBlocked:true,canReserveNextCall:false}};
  const d=derive(s); assert.equal(d.budgetBlocked,false);
  assert.equal(d.blockers.some(x=>x.code==='JEV_DAILY_BUDGET_EXHAUSTED'),false);
  assert.equal(d.blockers.some(x=>x.code==='JEV_PASS1_MISSING'),true);
});
test('Office falls back to runtime operational budget when endpoint unavailable',()=>{
  const s=snapshot(3); s.status.data.jev={budget:s.jevBudget.data};s.jevBudget={ok:false};
  assert.equal(derive(s).budgetBlocked,true);
});
console.log('R2542_OFFICE_BUDGET_TRUTH_OK');
