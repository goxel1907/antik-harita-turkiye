'use strict';
// R2544.131 (kullanıcı 09.11: kaldıraç min 10x, üstünü kurul güvene göre; JEV açıkken son söz JEV; gecikme yok)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const MC=require('../model-committee'),TB=require('../trader-brain');
test('R2544.131 quick vote: the fastest healthy members, one round, a time-out does not make a member sick',async()=>{
  const t=Date.UTC(2026,10,9);const slow={id:'ROUTER:a/slow',call:async({prompt})=>prompt==='ping'?{ok:true,text:'{"ok":true}'}:new Promise(r=>setTimeout(()=>r({ok:true,text:'{"leverage":20}'}),400))};
  const fast=i=>({id:'ROUTER:b'+i+'/fast',call:async({prompt})=>prompt==='ping'?{ok:true,text:'{"ok":true}'}:{ok:true,text:'{"leverage":'+(12+i)+',"confidence":60}'}});
  const c=MC.createCommittee({clock:()=>t,size:5,members:[slow,fast(0),fast(1)]});await c.probe({force:true});
  const r=await c.quick({system:TB.LEVERAGE_SYSTEM,prompt:'{}',validate:TB.validLeverage,parse:TB.parseLeverage,size:3,callTimeoutMs:100});
  assert.equal(r.votes.length,3);assert.equal(r.votes.filter(v=>v.ok).length,2);assert.equal(r.votes.find(v=>v.member==='ROUTER:a/slow').error,'QUICK_TIMEOUT');
  assert.ok(c.healthy().some(m=>m.id==='ROUTER:a/slow'),'the slow member keeps its seat');assert.equal(TB.leverageOf(r.votes),12);
});
test('R2544.131 JEV asks the leverage in all three entry gates; Office says who chose it',()=>{
  const j=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8'),h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.equal((j.match(/_leverage:\{type:'choice'/g)||[]).length,3);assert.equal((j.match(/leverage:jevLev\(a\.(top3|zirve5)_leverage\)/g)||[]).length,3);
  assert.match(h,/a\.leverageBy==='JEV'\?'JEV seçti':a\.leverageBy==='KURUL'\?'kurul seçti':'ayar'/);assert.match(h,/Kaldıraç en az 10x; üstünü \(en çok 20x\) kurul güvene göre seçer, JEV açıkken son söz JEV/);
});
