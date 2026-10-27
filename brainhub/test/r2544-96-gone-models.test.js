'use strict';
// R2544.96 (27.10 kurulumdan sonra, kullanıcı: "başka kullanılacak model varsa yaparız"): 9Router'ın model listesi eski; Groq / NVIDIA'da
// kalkmış modeller (410 Gone, [404] does not exist) kuruldaki yeri tutmaz, sağlayıcının bugün açık modelleri önce denenir.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const MC=require('../model-committee');
const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const STRONG=eval(sv.match(/const ROUTER_STRONG=(\/.*\/i);/)[1]);
const CAND=eval(sv.match(/const ROUTER_CANDIDATES=(\[[\s\S]*?\]);/)[1]);
test('R2544.96 gone = 410 / [404] model errors from the real 27.10 health file; quota, 429, 402 and timeouts are NOT gone; gone expires after 3 days',()=>{
  const now=Date.UTC(2026,9,27,20,0,0),r=(error,at=now-60000)=>({lastOk:false,error,at});
  assert.ok(MC.isGone(r('HTTP 410 {"error":{"message":"[410]: {\\"type\\":\\"about:blank\\",\\"title\\":\\"Gone\\",\\"status\\":410,\\"detail\\":\\"The model \'minimaxai/minimax-m2.7\' has reached its'),now));
  assert.ok(MC.isGone(r('HTTP 503 {"error":{"message":"[groq/meta-llama/llama-4-maverick-17b-128e-instruct] [404]: {\\"error\\":{\\"message\\":\\"The model `meta-llama/llama-4-maverick-17b-1'),now));
  assert.ok(MC.isGone(r('HTTP 503 {"error":{"message":"[nvidia/moonshotai/kimi-k2.6] [404]: {\\"status\\":404,\\"title\\":\\"Not Found\\",\\"detail\\":\\"Function'),now));
  for(const e of ['HTTP 503 {"error":{"message":"[kiro/glm-5] [402]: {\\"message\\":\\"You have reached the limit.','HTTP 503 {"error":{"message":"[gemini/gemini-3.8-flash] [429]: You exceeded your current quota','The operation was aborted due to timeout','MODEL_RATE_LIMIT HTTP 429','HTTP 502 wreq-js unavailable'])
    assert.equal(MC.isGone(r(e),now),false,e.slice(0,40));
  assert.equal(MC.isGone(r('HTTP 410 Gone',now-4*24*3600000),now),false,'retried after 3 days');
  assert.equal(MC.isGone({lastOk:true,error:'HTTP 410 Gone',at:now},now),false);
});
test('R2544.96 today\'s models first, a gone model gives its seat to the next, still 3 per provider; the committee tells the members function which are gone',async()=>{
  const ids=['nvidia/minimaxai/minimax-m2.7','nvidia/z-ai/glm-5.2','nvidia/moonshotai/kimi-k2.6','groq/llama-3.3-70b-versatile','groq/qwen/qwen3-32b','gemini/gemini-3.8-flash','gemini/gemini-3.7-flash','gemini/gemini-3.6-flash'];
  const out=MC.pickRouterExtras(ids,{strong:STRONG,perProvider:3,max:12,candidates:CAND,gone:id=>id==='ROUTER:nvidia/z-ai/glm-5.3'});
  const by=p=>out.filter(m=>m.startsWith(p+'/'));
  assert.deepEqual(by('nvidia'),['nvidia/deepseek-ai/deepseek-v4.1-flash','nvidia/minimaxai/minimax-m3.1-flash','nvidia/nvidia/nemotron-3-super-120b-a12b'],'gone GLM 5.3 skipped, the 4th candidate takes the seat');
  assert.deepEqual(by('groq'),['groq/openai/gpt-oss-120b','groq/qwen/qwen3.8-27b','groq/llama-3.3-70b-versatile']);
  assert.deepEqual(by('gemini'),['gemini/gemini-3.6-flash','gemini/gemma-4-31b-it','gemini/gemini-3.5-flash-lite'],'Gemini 3.7 / 3.8 (free quota 0) are not taken');
  assert.equal(new Set(out).size,out.length,'no duplicates');
  let seen=null;const t=Date.now();
  const c=MC.createCommittee({clock:()=>t,members:ctx=>{seen=ctx;return [{id:'ROUTER:groq/x',call:async()=>({ok:false,reason:'HTTP 503 [groq/x] [404]: The model `x` does not exist'})}];}});
  await c.probe({force:true});assert.equal(typeof seen.gone,'function');assert.equal(seen.gone('ROUTER:groq/x'),true);assert.equal(seen.gone('ROUTER:groq/y'),false);
  assert.match(sv,/members:ctx=>committeeMembers\(deskFreeWorker,'FREE:openrouter',ctx\)/);assert.match(sv,/members:ctx=>committeeMembers\(examFreeWorker,'FREE:openrouter',ctx\)/);
  assert.ok(STRONG.test('nvidia/deepseek-ai/deepseek-v4.1-flash')&&STRONG.test('groq/qwen/qwen3.8-27b')&&STRONG.test('gemini/gemma-4-31b-it')&&STRONG.test('nvidia/minimaxai/minimax-m3.1-flash'));
});
