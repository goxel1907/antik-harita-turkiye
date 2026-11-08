'use strict';
// R2544.130 (kullanıcı 09.11 "önerilerini yap"; ölçüm: kurul düşünme ortanca 111 sn, en çok 303 sn; karar -> emir ortanca 19 sn)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const MC=require('../model-committee');
const parse=x=>{try{return {ok:true,...JSON.parse(x)};}catch{return {ok:false};}};
function run(actions,share){let calls=0;const t=Date.UTC(2026,10,9);const mk=(id,a)=>({id,call:async({prompt})=>{if(prompt==='ping')return {ok:true,text:'{"ok":true}'};calls++;return {ok:true,text:JSON.stringify({action:a})};}});
  const c=MC.createCommittee({clock:()=>t,size:actions.length,debateSkipShare:share,members:actions.map((a,i)=>mk('ROUTER:p'+i+'/m'+i,a))});return {c,calls:()=>calls};}
test('R2544.130 a 2/3 first-round majority decides at once (no debate round); a split table still debates; off by default',async()=>{
  let r=run(['EXIT','EXIT','HOLD'],2/3);await r.c.probe({force:true});let d=await r.c.decide({system:'s',prompt:'x',validate:()=>true,parse,field:'action',fallback:'HOLD'});
  assert.equal(d.consensus,'STRONG_MAJORITY');assert.equal(d.final,'EXIT');assert.equal(d.rounds,1);assert.equal(r.calls(),3,'one round only');
  r=run(['EXIT','EXIT','HOLD','HOLD','TIGHTEN_STOP'],2/3);await r.c.probe({force:true});d=await r.c.decide({system:'s',prompt:'x',validate:()=>true,parse,field:'action',fallback:'HOLD'});
  assert.equal(d.rounds,2,'2 of 5 is not a strong majority: the debate runs');
  r=run(['EXIT','EXIT','HOLD'],null);await r.c.probe({force:true});d=await r.c.decide({system:'s',prompt:'x',validate:()=>true,parse,field:'action',fallback:'HOLD'});assert.equal(d.rounds,2,'without the option: as before');
});
test('R2544.130 wiring: desk committee 60 s per member + 2/3 skip; the reason text and Office know STRONG_MAJORITY; a fresh desk order runs at once',()=>{
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'),pd=fs.readFileSync(path.join(__dirname,'..','position-desk.js'),'utf8'),lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(sv,/createCommittee\(\{size:5,timeoutMs:60000,debateSkipShare:2\/3,/);assert.match(pd,/r\.consensus === 'STRONG_MAJORITY' \? 'güçlü çoğunluk \(tartışmasız\): '/);assert.match(h,/STRONG_MAJORITY:'GÜÇLÜ ÇOĞUNLUK'/);
  assert.match(lc,/async function positionDeskTick\(\)\{const r=await positionDeskLook\(\);if\(r&&r\.freshOrder\)\{if\(!top3Busy\)\{try\{await top3Settle\(\);\}catch\{\}\}else kickDeskOrders\(\);\}return r;\}/);
});
