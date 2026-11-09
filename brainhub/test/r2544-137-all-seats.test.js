'use strict';
// R2544.137 (kullanıcı 09.11: "boş koltuk bırakma, hedef koyma, ne kadar çok model oturacaksa otursun"; oy kuralı: bugünkü - çoğunluk + tartışma)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const MC=require('../model-committee'),sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'),lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),pd=fs.readFileSync(path.join(__dirname,'..','position-desk.js'),'utf8');
test('R2544.137 every healthy member sits at the desk and at the entry vote; the vote rule is unchanged (majority + debate, 2/3 = no debate)',async()=>{
  const ids=Array.from({length:12},(_,i)=>(i%3===0?'ROUTER:gemini/m':i%3===1?'OVH:m':'KILO:m')+i);
  const c=MC.createCommittee({members:ids.map(id=>({id,call:async a=>/Health/.test(a.system)?{ok:true,text:'{"ok":true}'}:{ok:true,text:'{"action":"HOLD"}'}})),size:99,clock:()=>Date.UTC(2026,10,9,12)});
  await c.probe({force:true});assert.equal(c.pick(99).length,12,'all twelve sit');
  const r=await c.decide({system:'s',prompt:'p',validate:()=>true,parse:t=>{try{return {ok:true,...JSON.parse(t)};}catch{return {ok:false};}},field:'action',fallback:'HOLD'});
  assert.equal(r.voters,12);assert.equal(r.consensus,'UNANIMOUS');
  assert.match(sv,/const DESK_ALL=99;/);assert.match(sv,/createCommittee\(\{size:DESK_ALL,timeoutMs:60000,debateSkipShare:2\/3,/);assert.match(lc,/const ENTRY_TEAM=99;/);
});
test('R2544.137 the desk record keeps whether each member saw the chart (proof the chart reached it)',()=>{
  assert.match(pd,/img:v\.img === true, \.\.\.\(v\.compact \? \{ compact:true \} : \{\}\)/);
});
