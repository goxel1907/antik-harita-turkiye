'use strict';
// R2544.141 DÜŞÜNEN MASA (kullanıcı 10.11: "modellerin en çok düşünenleri masaya otursun, eksik model masası istemiyorum")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const MC=require('../model-committee'),sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const block=sv.slice(sv.indexOf('const DIRECT_FREE=['),sv.indexOf('async function directAsk'));
test('R2544.141 thinking seats think: no reasoning switch-off, 8000 tokens and 150 s each; the measured thinkers sit, the two that ran out of tokens do not',()=>{
  assert.match(sv,/const THINK_MS=150000,/);
  for(const id of ['OVH:gpt-oss-120b','OVH:Qwen3.5-397B-A17B','OVH:Qwen3.6-27B','KILO:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free','KILO:nvidia/nemotron-3-ultra-550b-a55b:free','KILO:nvidia/nemotron-3.5-super-vl:free','KILO:dots-studio/dots-3-note-preview:free'])
    assert.ok(new RegExp("id:'"+id.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')+"',[^\\n]*maxTokens:8000,timeoutMs:THINK_MS").test(block),id);
  assert.ok(!/reasoning_effort|reasoning:\{|extra:/.test(block),'thinking is not switched off or lowered');
  assert.ok(!/Qwen3\.8-27B|lightning/.test(block),'out of tokens while thinking: left out');
  assert.match(sv,/call:a=>directAsk\(d,a\),\.\.\.\(d\.timeoutMs\?\{timeoutMs:d\.timeoutMs\}:\{\}\)/);
  assert.match(sv,/AbortSignal\.timeout\(\(d\.timeoutMs\|\|100000\)\+10000\)/);
  assert.match(sv,/\.\.\.\(\/\^nvidia\\\/\/\.test\(m\)\?\{timeoutMs:THINK_MS\}:\{\}\)/,'the 9Router NVIDIA thinkers get the time too (R2544.156: the full THINK_MS)');
});
test('R2544.141 a member with its own time is waited for; a fast member keeps the desk limit; the quick (leverage) vote keeps its short limit',async()=>{
  const real=global.setTimeout,waits=[];
  // the committee's withTimeout arms one timer per call: record the limits it was armed with
  global.setTimeout=(fn,ms,...a)=>{waits.push(ms);return real(fn,0,...a);};
  try{
    const mk=(id,extra)=>({id,...extra,call:async x=>/Health/.test(x.system)?{ok:true,text:'{"ok":true}'}:new Promise(()=>{})}); // never answers
    const c=MC.createCommittee({members:[mk('KILO:thinker',{timeoutMs:150000}),mk('OVH:fast',{})],size:9,timeoutMs:60000,clock:()=>Date.UTC(2026,10,10,8)});
    await c.probe({force:true});waits.length=0;
    await c.decide({system:'s',prompt:'p',validate:()=>true,parse:()=>({ok:false}),field:'action',fallback:'HOLD'});
    assert.ok(waits.includes(150000),'the thinker got 150 s');assert.ok(waits.includes(60000),'the fast seat kept 60 s');
    waits.length=0;await c.quick({system:'s',prompt:'p',validate:()=>true,parse:()=>({ok:false}),size:2,callTimeoutMs:8000});
    assert.ok(waits.length>0&&waits.every(ms=>ms===8000),'the quick vote does not wait for a thinker');
  }finally{global.setTimeout=real;}
});
