'use strict';
// R2544.106 POZİSYON MASASI (kullanıcı 02.11: "pozisyon kartı afilli olsun; geçmiş pozlar son 5 poz durumu; geçmiş poz bilgileri istatistik ve
// grafiklerle göster"). commandSummary.pos: son 5 işlem (R yolu), sonuç dağılımı, çıkış türleri, ortalamalar. Yalnız gösterim.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const T3=require('../top3-hunter');
test('R2544.106 position summary: last 5 newest first with an R path from desk reviews, R distribution, exit kinds, hold / best R / given-back averages',()=>{
  const now=Date.UTC(2026,10,2,9,0,0),H=3600000;
  const L=(i,R,mfe,exit,desk=null)=>({rule:'LONG_EARLY_RETEST',symbol:'C'+i+'USDT',side:'LONG',rMultiple:R,mfeR:mfe,exitType:exit,holdH:1,openedAt:now-(10-i)*H-H,closedAt:now-(10-i)*H,mode:'TEST',desk,autopsy:{text:'not '+i}});
  const ls=[L(1,-1.05,2,'TOP3_STOP'),L(2,2.23,2.5,'TOP3_TAKE_PROFIT'),L(3,0.98,2.6,'TOP3_BE_STOP'),L(4,-0.11,1.93,'TOP3_DESK_EXIT',{decisions:[{at:now-6*H-H+20*60000,R:1.5,action:'HOLD'},{at:now-6*H-H+40*60000,R:-0.1,action:'EXIT',authority:true}]}),L(5,-1,0.3,'TOP3_STOP'),L(6,3,3.1,'TOP3_TAKE_PROFIT')];
  const p=T3.commandSummary(ls,{mode:'TEST',now}).pos;
  assert.equal(p.recent.length,5);assert.equal(p.recent[0].symbol,'C6USDT','newest first');assert.equal(p.recent[0].name,'İlk 3 ERKEN LONG');
  const d=p.recent.find(r=>r.symbol==='C4USDT');assert.deepEqual(d.path,[[0,0],[20,1.5],[40,-0.1],[60,-0.11]]);assert.equal(d.deskActed,true);assert.equal(d.autopsy,'not 4');
  assert.deepEqual(p.bins.map(b=>b.n),[2,1,1,0,2]);assert.deepEqual(p.exits,{STOP:2,HEDEF:2,'BAŞABAŞ':1,MASA:1});
  assert.equal(p.avgHoldMin,60);assert.equal(p.sawOneR,5);assert.equal(p.avgGivebackR,Number(((3.05+0.27+1.62+2.04+0.1)/5).toFixed(2)));
});
test('R2544.106 Office: position desk panel (open card with track + R path + desk votes, last 5, distribution, exits) inside the command center; display only',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['ccPos','psOpen','psLast5','psHist'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/try\{renderPos\(s\);\}catch\(e\)\{console\.warn\('pos',e\);\}/);
  const a=html.indexOf('// ---------- R2544.106 POZİSYON MASASI'),b=html.indexOf('// ---------- R2544.104 KOMUTA MERKEZİ');assert.ok(a>0&&b>a);assert.doesNotMatch(html.slice(a,b),/fetch\(|\/api\/control/);
});
