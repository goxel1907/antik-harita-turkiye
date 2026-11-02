'use strict';
// R2544.107 (kullanıcı 02.11: "110 derste nasıl 1 doğrulanmış ders oluyor, beyin sadece bunu mu öğrenmiş"): beyin 4 değil, girişte bilinen
// etkenleri de sorar (sıra, seviye türü, hacim katı, stop, fonlama, saat, 24 sa aralık; ZİRVE-5'te LTH trend, POC, karşı OB). Bantlar önceden
// sabit; 6 aylık hafıza harness/indikator/lab_factors2.js ile aynı tanım. "Ders" kuralı değişmedi (son dersler + 6 ay aynı yön).
const test=require('node:test'),assert=require('node:assert/strict');
const T3=require('../top3-hunter');
const now=Date.UTC(2026,10,2,3,0,0);
const lesson=(i,win,f={},extra={})=>({rule:'SHORT_TOP_BREAK',side:'SHORT',symbol:'X'+i+'USDT',openedAt:now,stopPct:0.03,rMultiple:win?1:-1,features:{rank:5,topVolMult:8,fund:0.0001,pa:{range:{posPct:70}},...f},
  autopsy:{ok:true,outcome:win?'KAZANC':'KAYIP',causes:[],factors:{btc:'NOTR'}},...extra});
test('R2544.107 the brain asks the entry-time questions and says how many it asked; a factor split in recent lessons but not in 6 months is not a lesson',()=>{
  const ls=[...Array.from({length:10},(_,i)=>lesson(i,false,{rank:2})),...Array.from({length:10},(_,i)=>lesson(20+i,true,{rank:15}))];
  const c=T3.causeStats(ls,'SHORT_TOP_BREAK');
  const r13=c.factors.find(f=>f.key==='rankBand'&&f.value==='1-3');assert.equal(r13.lossPct,1);assert.equal(r13.winPct,0);assert.equal(r13.call,'TEST_ONLY','6 months: rank 1-3 is 16% / 12% -> not a lesson');
  assert.ok(c.factors.some(f=>f.key==='session'&&f.value==='ASYA'),'saat (UTC 3) -> Asya');assert.ok(c.factors.some(f=>f.key==='stopBand'&&f.value==='2-4'));
  assert.ok(c.text.some(l=>/^Sorulan \d+ soru \(etken değeri\): 0 ders • \d+ tek başına neden değil • \d+ 6 ayda tutmadı/.test(l)),c.text.join('\n'));
});
test('R2544.107 ZİRVE-5 SHORT: trend with the trade (LTH) is a lesson only when the recent lessons agree with the 6-month memory (32% / 56%)',()=>{
  const z=(i,win,trend)=>({rule:'ZIRVE5_FIBO_SHORT',side:'SHORT',symbol:'Z'+i,openedAt:now,stopPct:0.05,rMultiple:win?1:-1,features:{ind:{lth:{trend}}},autopsy:{ok:true,outcome:win?'KAZANC':'KAYIP',causes:[],factors:{}}});
  const ls=[...Array.from({length:8},(_,i)=>z(i,false,i<1?'WITH':'AGAINST')),...Array.from({length:8},(_,i)=>z(10+i,true,i<6?'WITH':'AGAINST'))];
  const c=T3.causeStats(ls,'ZIRVE5_FIBO_SHORT');const w=c.factors.find(f=>f.key==='lthWith'&&f.value==='true');
  assert.equal(w.call,'KAZANC_TARAFI');assert.ok(c.text.some(l=>/^Ayırt edici \(son dersler \+ 6 ay aynı yönde\): .*trend işlemle aynı yönde \(LTH\)/.test(l)));
  assert.ok(c.text.some(l=>/^6 aylık hafıza, girişte bilinen: .*trend işlemle aynı yönde \(LTH\) \(kayıp %32 \/ kazanç %56\)/.test(l)),'entry-time memory on its own line');
});
