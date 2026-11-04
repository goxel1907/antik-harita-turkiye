'use strict';
// R2544.124 (kullanıcı 04.11: "test bakiyesi eklense bile saatlik günlük haftalık kâr zararları net görmemiz lazım; canlıya geçeceğiz")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const T=require('../top3-hunter');
const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
test('R2544.124 pnlLedger: trading = realized + commission + funding; transfers apart; Istanbul hours / days; weeks start on Monday',()=>{
  const now=Date.UTC(2026,10,4,7,30,0); // 04.11 10:30 TR (Wednesday)
  const r=(iso,type,v,id)=>({time:Date.parse(iso),incomeType:type,income:String(v),tranId:id});
  const rows=[r('2026-11-03T20:50:00Z','REALIZED_PNL',-20,1),r('2026-11-03T20:50:00Z','COMMISSION',-0.5,2), // 03.11 23:50 TR
    r('2026-11-03T21:10:00Z','REALIZED_PNL',30,3),r('2026-11-03T21:10:00Z','COMMISSION',-0.5,4),             // 04.11 00:10 TR
    r('2026-11-04T07:05:00Z','FUNDING_FEE',-1,5),r('2026-11-03T17:20:00Z','TRANSFER',100,6),
    r('2026-11-02T06:00:00Z','REALIZED_PNL',10,7)];                                                         // Monday 02.11 09:00 TR
  const L=[{mode:'TEST',closedAt:Date.parse('2026-11-03T20:50:00Z'),rMultiple:-1},{mode:'TEST',closedAt:Date.parse('2026-11-03T21:10:00Z'),rMultiple:1.5},{mode:'LIVE',closedAt:now-1000,rMultiple:9}];
  const p=T.pnlLedger(rows,{now,lessons:L,mode:'TEST'});
  assert.equal(p.totals.all.net,18,'transfer not counted');assert.equal(p.cash.total,100);assert.equal(p.cash.n,1);
  assert.equal(p.totals.today.net,28.5,'today in Istanbul time starts 03.11 21:00 UTC');assert.equal(p.totals.today.trades,1);assert.equal(p.totals.today.funding,-1);
  assert.equal(p.days.at(-1).label,'04.11');assert.equal(p.days.at(-2).label,'03.11');assert.equal(p.days.at(-2).net,-20.5);assert.equal(p.days.at(-2).R,-1);
  assert.equal(p.weeks.at(-1).label,'02.11','week from Monday');assert.equal(p.weeks.at(-1).net,18);
  assert.equal(p.hours.length,24);assert.equal(p.hours.at(-1).label,'10');assert.equal(p.totals.all.trades,2,'LIVE lessons stay out of TEST');
});
test('R2544.124 Office: P&L panel with tiles, hourly / daily / weekly bars, the top-up line and the SONUÇ card dollars from the ledger',()=>{
  assert.match(html,/id="plCard"/);assert.match(html,/function plRender\(p\)/);assert.match(html,/plRender\(\(ccG\(s\?\.top3\)\|\|\{\}\)\.pnl\|\|null\)/);
  assert.match(html,/SAATLİK • son 24 saat/);assert.match(html,/GÜNLÜK • son 14 gün/);assert.match(html,/HAFTALIK • son 8 hafta/);
  assert.match(html,/kâr\/zarara KATILMAZ/);assert.match(html,/L30=pl\?\.totals\?\.last30d/);
});
