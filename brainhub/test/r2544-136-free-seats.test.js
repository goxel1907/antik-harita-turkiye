'use strict';
// R2544.136 ÜCRETSİZ KOLTUK HAVUZU (kullanıcı 09.11: "zayıflamada yerine geçecek, aratmayacak modeller"; onay: "hepsini kur")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'),MC=require('../model-committee');
const fnSrc=name=>{const i=sv.indexOf(name),j=sv.indexOf('const directMembers=()=>',i);return sv.slice(i,j).trimEnd();}; // R2544.147: the function ends right before directMembers
test('R2544.136 keyless seat: an OpenAI-compatible answer is read; an HTTP error, an empty answer and a network error are a failed vote (never a throw)',async()=>{
  const directAsk=eval('('+fnSrc('async function directAsk').replace(/^async function directAsk/,'async function')+')');
  const d={base:'https://x.test/v1',model:'m1',maxTokens:100};let seen=null;
  const ok=await directAsk(d,{system:'S',prompt:'P'},async(url,o)=>{seen={url,body:JSON.parse(o.body),key:o.headers.Authorization};return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:' {"action":"HOLD"} '}}]})};});
  assert.deepEqual(ok,{ok:true,text:'{"action":"HOLD"}',model:'m1',img:false,compact:false});
  assert.equal(seen.url,'https://x.test/v1/chat/completions');assert.equal(seen.body.model,'m1');assert.equal(seen.body.messages[1].content,'P');assert.equal(seen.key,undefined,'no key is ever sent');
  assert.match((await directAsk(d,{},async()=>({ok:false,status:429,text:async()=>'rate limited'}))).reason,/^HTTP 429/);
  assert.match((await directAsk(d,{},async()=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:''},finish_reason:'length'}]})}))).reason,/EMPTY_ANSWER length/);
  assert.equal((await directAsk(d,{},async()=>{throw new Error('ECONNRESET');})).ok,false);
});
test('R2544.136 wiring: OVH (gpt-oss-120b, Llama-3.3-70B) and Kilo (Nemotron nano-omni / ultra / super-vl) sit at the desk only; the exam never spends them',()=>{
  for(const id of ['OVH:gpt-oss-120b','OVH:Meta-Llama-3_3-70B-Instruct','KILO:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free','KILO:nvidia/nemotron-3-ultra-550b-a55b:free','KILO:nvidia/nemotron-3.5-super-vl:free'])assert.ok(sv.includes(`id:'${id}'`),id);
  assert.match(sv,/freeMember\(freeWorker,poolId\),\.\.\.\(noAiStudio\?\[\]:directMembers\(\)\)\]/);
  assert.ok(/Qwen3\.5-397B-A17B/.test(sv.slice(sv.indexOf('const DIRECT_FREE'),sv.indexOf('async function directAsk'))),'R2544.141: Qwen 397B sits with 150 s and 8000 tokens (63 s measured)');
  assert.equal(MC.memberKey('KILO:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'),'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free','shares the karne of the same model');
  assert.equal(MC.memberKey('OVH:gpt-oss-120b'),'gpt-oss-120b');
});
test('R2544.136 NVIDIA live list: only ids NVIDIA itself lists may sit; without a list nothing is filtered',()=>{
  let nvidiaLive={at:0,ids:null};const nvidiaLiveOk=eval('('+sv.match(/const nvidiaLiveOk=(m=>\{[^\n]*?\};)/)[1].replace(/;$/,'')+')');
  assert.equal(nvidiaLiveOk('nvidia/deepseek-ai/deepseek-v4-pro'),true,'no list yet');
  nvidiaLive={at:1,ids:new Set(['deepseek-ai/deepseek-v4.1-flash','nvidia/nemotron-3.5-super-vl-120b-a12b'])};
  assert.equal(nvidiaLiveOk('nvidia/deepseek-ai/deepseek-v4-pro'),false,'removed (410) -> out');assert.equal(nvidiaLiveOk('nvidia/deepseek-ai/deepseek-v4.1-flash'),true);
  assert.equal(nvidiaLiveOk('nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b'),true);assert.equal(nvidiaLiveOk('gemini/gemini-3.5-flash'),true,'other providers untouched');
  assert.match(sv,/fetch\('https:\/\/integrate\.api\.nvidia\.com\/v1\/models'/);
});
