'use strict';
// R2544.140 (09.11 16:38: 8 of 26 healthy after one slow round; the order book was refused although the stream flowed)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),MC=require('../model-committee');
test('R2544.140 a timeout is slowness, not sickness: the member keeps its seat until 3 timeouts in a row; any other error takes it out at once',async()=>{
  let mode={a:'ok',b:'ok'};const call=k=>async x=>/Health/.test(x.system)?{ok:true,text:'{"ok":true}'}:mode[k]==='slow'?{ok:false,reason:'COMMITTEE_TIMEOUT'}:mode[k]==='bad'?{ok:false,reason:'HTTP 500 boom'}:{ok:true,text:'{"action":"HOLD"}'};
  const c=MC.createCommittee({members:[{id:'OVH:a',call:call('a')},{id:'KILO:b',call:call('b')}],size:9,clock:()=>Date.UTC(2026,10,9,14)});await c.probe({force:true});
  const ask=()=>c.decide({system:'s',prompt:'p',validate:()=>true,parse:t=>{try{return {ok:true,...JSON.parse(t)};}catch{return {ok:false};}},field:'action',fallback:'HOLD'});
  mode={a:'slow',b:'bad'};await ask();const ids=()=>c.healthy().map(m=>m.id);
  assert.deepEqual(ids(),['OVH:a'],'slow stays, broken leaves');
  await ask();assert.deepEqual(ids(),['OVH:a'],'2 timeouts: still seated');await ask();assert.deepEqual(ids(),[],'3 in a row: out');
});
test('R2544.140 the desk asks the stream with the time NOW (the look start made a fresher book look stale); Kilo nano-omni reasoning off',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(lc,/sn=ms\.snapshot\(a\.symbol,clock\(\)\)/);assert.ok(!/ms\.snapshot\(a\.symbol,now\)/.test(lc));
  assert.match(sv,/id:'KILO:nvidia\/nemotron-3-nano-omni-30b-a3b-reasoning:free',[^\n]*extra:\{reasoning:\{enabled:false\}\}/);
});
