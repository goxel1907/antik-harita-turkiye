'use strict';
// R2544.97 (R96 kurulumu 27.10 23:36 sonrası gerçek sağlık dosyası): Groq gpt-oss-120b sınav sorusunda "413 Request too large" (ücretsiz katman
// tek istekte ~8K jeton); NVIDIA GLM 5.3 / DeepSeek V4.1 110 sn zaman aşımı. İkisi de kuruldaki yeri 3 gün tutmaz; geçici hatalar tutar.
const test=require('node:test'),assert=require('node:assert/strict');
const MC=require('../model-committee');
test('R2544.97 413 too large = unusable at once; 3 timeouts in a row = unusable; 1-2 timeouts, quota, 429, 500 are not; 3 days then retried',()=>{
  const now=Date.UTC(2026,9,27,21,0,0),r=(error,consecutiveFail=1,at=now-60000)=>({lastOk:false,error,consecutiveFail,at});
  const big='HTTP 413 {"error":{"message":"[413]: {\\"error\\":{\\"message\\":\\"Request too large for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 11904';
  assert.equal(MC.unusableWhy(r(big)),'TOO_BIG');assert.ok(MC.isGone(r(big),now),'even though the text says "Limit" (a quota word)');
  assert.equal(MC.unusableWhy(r('The operation was aborted due to timeout',3)),'SLOW');assert.ok(MC.isGone(r('The operation was aborted due to timeout',3),now));
  assert.equal(MC.isGone(r('The operation was aborted due to timeout',2),now),false,'two timeouts are not enough');
  for(const e of ['HTTP 503 [gemini/gemini-3.6-flash] [429]: You exceeded your current quota','HTTP 503 [gemini/gemma-4-31b-it] [500]: Internal error encountered.','HTTP 503 [kiro/glm-5] [402]: You have reached the limit. MONTHLY_REQUEST_COUNT'])
    assert.equal(MC.isGone(r(e,5),now),false,e.slice(0,40));
  assert.equal(MC.unusableWhy(r('HTTP 410 Gone')),'GONE');assert.equal(MC.isGone(r(big,1,now-4*24*3600000),now),false,'retried after 3 days');
});
test('R2544.97 a too-big Groq model gives its seat away after the first real call; the probe alone does not hide it',async()=>{
  let t=Date.UTC(2026,9,27,21,0,0),big=false;
  const mk=id=>({id,call:async({prompt})=>big&&prompt!=='ping'?{ok:false,reason:'HTTP 413 Request too large for model, Limit 8000'}:{ok:true,text:'{"ok":true,"decision":"SKIP"}'}});
  const c=MC.createCommittee({clock:()=>t,size:2,members:ctx=>MC.pickRouterExtras(['groq/openai/gpt-oss-120b','groq/qwen/qwen3.8-27b'],{gone:ctx.gone}).map(id=>mk('ROUTER:'+id))});
  await c.probe({force:true});assert.equal(c.healthy().length,2);
  big=true;await c.decide({system:'s',prompt:'packet',validate:()=>true,parse:x=>({ok:true,...JSON.parse(x)}),field:'decision',fallback:'SKIP'});
  assert.equal(c.status().members.length,0,'both 413 → both leave the member list');
});
