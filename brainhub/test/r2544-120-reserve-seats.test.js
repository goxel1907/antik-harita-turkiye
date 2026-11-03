'use strict';
// R2544.120 (03.11 09:06 + 09:36 MEGA masası: 5 üyeden 4'ü hata verdi -> tek oy, karar yok): boş koltuklar bir kez yedek üyeyle dolar.
// Cloudflare 9Router'da 'cf/@cf/...' (R2544.119'daki 'cloudflare-ai/@cf/...' adları 403 "Model is not available" aldı).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const MC=require('../model-committee'),REG=require('../free-model-registry');

const parse=x=>{try{return {ok:true,...JSON.parse(x)};}catch{return {ok:false};}};
function setup(failing){
  const t=Date.UTC(2026,10,3,9,0,0),calls=[];
  const ids=['ROUTER:gemini/a','ROUTER:gemini/b','ROUTER:requesty/c','ROUTER:requesty/d','ROUTER:nvidia/e','ROUTER:groq/f','ROUTER:cf/g','OR:h'];
  const mk=id=>({id,call:async({prompt})=>{if(prompt==='ping')return {ok:true,text:'{"ok":true}'};calls.push(id);
    return failing.has(id)?{ok:false,reason:'HTTP 503 [429] busy'}:{ok:true,text:'{"action":"HOLD","reasonTr":"'+id+'"}'};}});
  const c=MC.createCommittee({clock:()=>t,size:5,members:ids.map(mk)});
  return {c,calls,ids};
}
test('R2544.120 four of five seats fail -> the empty seats go once to members that were not asked; the desk decides with several voters',async()=>{
  const {c,calls}=setup(new Set(['ROUTER:gemini/a','ROUTER:requesty/c','ROUTER:nvidia/e','ROUTER:groq/f']));
  await c.probe({force:true});
  const team=c.status().team;assert.equal(team.length,5);
  const r=await c.decide({system:'s',prompt:'desk',validate:()=>true,parse,field:'action',fallback:'HOLD'});
  assert.equal(r.ok,true);
  const failedInTeam=team.filter(id=>['ROUTER:gemini/a','ROUTER:requesty/c','ROUTER:nvidia/e','ROUTER:groq/f'].includes(id));
  assert.ok(failedInTeam.length>=3,'the test really has a broken table: '+team.join(','));
  assert.ok(r.replaced.length>=1,'seats were refilled');
  for(const x of r.replaced){assert.ok(!team.includes(x.by),'a reserve was not in the first team');assert.ok(/429/.test(x.error));}
  assert.ok(r.voters>=2,'more than one voter: '+r.voters);assert.notEqual(r.consensus,'SINGLE_VOTER_DEFAULT');
  assert.ok(r.votes.some(v=>v.reserveFor),'the vote list says which seat a reserve took');
  const asked=new Set(calls);assert.ok(asked.size<=team.length+r.replaced.length,'one reserve round only');
});
test('R2544.120 a healthy table (3+ answers) asks no reserve; quota is not spent twice',async()=>{
  const {c,calls}=setup(new Set(['ROUTER:gemini/a']));
  await c.probe({force:true});
  const r=await c.decide({system:'s',prompt:'desk',validate:()=>true,parse,field:'action',fallback:'HOLD'});
  assert.deepEqual(r.replaced,[]);assert.equal(calls.length,5);
});
test('R2544.120 no healthy reserve left -> the table works with what it has, nothing breaks',async()=>{
  const {c}=setup(new Set(['ROUTER:gemini/a','ROUTER:gemini/b','ROUTER:requesty/c','ROUTER:requesty/d','ROUTER:nvidia/e','ROUTER:groq/f','ROUTER:cf/g','OR:h']));
  await c.probe({force:true});
  const r=await c.decide({system:'s',prompt:'desk',validate:()=>true,parse,field:'action',fallback:'HOLD'});
  assert.equal(r.ok,false);assert.equal(r.reason,'COMMITTEE_NO_ANSWER');assert.equal(r.replaced.length,3,'the 3 not-asked members were tried once');
});
test('R2544.120 9Router /v1/models vision flag is kept per model (Cloudflare is not in the catalog file)',async()=>{
  const body={object:'list',data:[{id:'cf/@cf/moonshotai/kimi-k2.6',capabilities:{vision:true}},{id:'cf/@cf/zai-org/glm-4.7-flash',capabilities:{vision:false}},{id:'groq/x'}]};
  const out=await REG.discoverOpenAIModels({baseUrl:'http://127.0.0.1:1/v1',fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify(body)})});
  assert.equal(out.ok,true);assert.deepEqual(out.vision,{'cf/@cf/moonshotai/kimi-k2.6':true,'cf/@cf/zai-org/glm-4.7-flash':false});
  assert.deepEqual(out.models,['cf/@cf/moonshotai/kimi-k2.6','cf/@cf/zai-org/glm-4.7-flash','groq/x']);
});
test('R2544.120 Cloudflare: cf/ is a free provider, only the ids 9Router lists for the user; the R2544.119 ids that got 403 are gone',()=>{
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const FREE=new Function('return '+sv.match(/const ROUTER_FREE_PROVIDERS=(\/.*?\/i?);/)[1])();
  assert.ok(FREE.test('cf/@cf/moonshotai/kimi-k2.6'));assert.ok(!FREE.test('cc/claude-opus-5-5'),'Claude subscription (cc/) never joins');assert.ok(!FREE.test('gh/gpt-5.4'));
  for(const m of ['cloudflare-ai/@cf/zai-org/glm-5.3-flash','cloudflare-ai/@cf/moonshotai/kimi-k2.6','cloudflare-ai/@cf/deepseek-ai/deepseek-v4.1-flash-1017','cloudflare-ai/@cf/qwen/qwen3.8-27b'])assert.ok(!sv.includes("'"+m+"'"),m);
  assert.match(sv,/committeeSeesCharts\(m\)\{const live=/,'the live vision flag is asked first');
  assert.equal(MC.PROVIDER_CAP.cf,4);assert.equal(MC.limitOf('ROUTER:cf/@cf/x').text,'Cloudflare 10k nöron/gün');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'..','model-committee.js'),'utf8'),/Cohere deneme/);
});
test('R2544.120 Cloudflare "AiError: Model ... is not available" (not on this account) gives the seat away; a busy / overloaded answer does not',()=>{
  const n=Date.UTC(2026,10,3,10,0,0),g=e=>MC.isGone({lastOk:false,error:e,consecutiveFail:1,at:n},n);
  assert.equal(g('HTTP 503 {"error":{"message":"[cf/@cf/moonshotai/kimi-k2.6] [403]: {"errors":[{"message":"AiError: Model @cf/moonshotai/kimi-k2.6 is not available'),true);
  for(const e of ['HTTP 503 The service is not available, try later','HTTP 503 [gemini/gemini-3.6-flash] [503]: This model is currently experiencing high demand','HTTP 503 [429] You exceeded your current quota'])assert.equal(g(e),false,e);
});
