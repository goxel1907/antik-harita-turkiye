'use strict';
// R2544.92 (kullanıcı 27.10: "openrouter'da ve 9router'da başka ücretsiz modelleri kur, tek düze gitme, birinin kotası biterse diğeri devam
// etsin; openrouter'dan hiç model bağlamadın"): OpenRouter ücretsiz modelleri tek tek üye, 9Router'a eklenen resmî sağlayıcılar kendiliğinden
// katılır, kurul sağlayıcılar arasında sırayla seçilir; sınav kotayı yemez.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCommittee,provider,family}=require('../model-committee');
test('R2544.92 the table is spread over providers: a provider out of quota never empties the committee',async()=>{
  const ok={ok:true,text:'{"ok":true}'},dead={ok:false,reason:'HTTP 503 [402] You have reached the limit. MONTHLY'};
  let kiroDown=false;const mk=id=>({id,call:async()=>(/ROUTER:kr\//.test(id)&&kiroDown?dead:ok)});
  const ids=['ROUTER:kr/claude-sonnet-4.5','ROUTER:kr/deepseek-3.2','ROUTER:kr/glm-5','ROUTER:kr/minimax-m2.5','ROUTER:groq/llama-4-maverick','OR:google/gemma-4-31b-it:free','OR:nvidia/nemotron-3-ultra-550b-a55b:free','FREE:openrouter'];
  const c=createCommittee({size:5,members:()=>ids.map(mk)});await c.probe({force:true});
  const team=c.pick().map(m=>m.id);assert.equal(team.length,5);
  assert.ok(new Set(team.map(provider)).size>=3,'at least three providers at the table: '+team.join(', '));
  assert.ok(team.some(id=>id.startsWith('OR:'))&&team.some(id=>id.startsWith('ROUTER:kr/'))&&team.includes('ROUTER:groq/llama-4-maverick'));
  kiroDown=true;await c.probe({force:true});
  const t2=c.pick().map(m=>m.id);assert.ok(t2.length>=3,'still a committee without Kiro: '+t2.join(', '));assert.ok(!t2.some(id=>id.startsWith('ROUTER:kr/')));
  assert.equal(provider('ROUTER:kr/glm-5'),'ROUTER:kr');assert.equal(provider('OR:google/gemma-4-31b-it:free'),'OR');
  assert.equal(family('OR:google/gemma-4-31b-it:free'),'GEMMA');assert.equal(family('ROUTER:groq/llama-4-maverick'),'LLAMA');
});
test('R2544.92 members are re-read on every check: a model added in 9Router joins without a code change',async()=>{
  const list=['ROUTER:kr/claude-sonnet-4.5'];const c=createCommittee({size:5,members:()=>list.map(id=>({id,call:async()=>({ok:true,text:'{"ok":true}'})}))});
  await c.probe({force:true});assert.equal(c.healthy().length,1);
  list.push('ROUTER:cerebras/gpt-oss-120b');await c.probe({force:true});assert.equal(c.healthy().length,2);
});
test('R2544.92 OpenRouter: every named free model is its own member (own cooldown); 9Router API providers join; exam 3 members, 100/day, waits for >= 2 healthy',async()=>{
  const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');
  const calls=[];const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-fake-test-r92',fetchImpl:async(url,o)=>{calls.push(url);if(/models|key/.test(url)&&!o?.body)return {ok:true,async text(){return JSON.stringify({data:[]});}};
    const b=JSON.parse(o.body);return {ok:true,async text(){return JSON.stringify({model:b.model,choices:[{message:{content:'{"decision":"SKIP"}'},finish_reason:'stop'}]});}};}});
  const r=await w.reviewModel('google/gemma-4-31b-it:free',{system:'s',prompt:'p',role:'TRADER'});assert.equal(r.ok,true);assert.equal(r.model,'google/gemma-4-31b-it:free');
  assert.equal((await w.reviewModel('openai/gpt-5',{system:'s',prompt:'p'})).reason,'NON_FREE_MODEL_REJECTED','never a paid model');
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/const OR_FREE_PREF=\['nvidia\/nemotron-3-ultra-550b-a55b:free','google\/gemma-4-31b-it:free','poolside\/laguna-s-2\.1:free'/);
  assert.match(sv,/members:\(\)=>committeeMembers\(deskFreeWorker,'FREE:openrouter'\)/);assert.match(sv,/const examCommittee=createCommittee\(\{size:3,members:\(\)=>committeeMembers\(examFreeWorker/);
  assert.match(sv,/committee:examCommittee,dailyCap:100\}/);assert.match(sv,/!\/\^\(kr\|gc\|oc\)\\\/\/\.test\(m\)&&!\/qwen3-coder\/\.test\(m\)&&ROUTER_STRONG\.test\(m\)/);
  const {createTraderExam,EXAM_VERSION}=require('../trader-exam'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ex92-'));
  fs.writeFileSync(path.join(dir,'packets.jsonl'),JSON.stringify({id:'q1',rule:'LONG_EARLY_RETEST',packet:{}})+'\n');
  const one={healthy:()=>[{id:'x'}],decide:async()=>{throw new Error('must not be asked');}};
  assert.equal((await createTraderExam({dir,committee:one}).tick()).skipped,'COMMITTEE_NOT_READY');
  assert.ok(!fs.existsSync(path.join(dir,'exam-state.json'))||!JSON.parse(fs.readFileSync(path.join(dir,'exam-state.json'),'utf8')).attempts.q1,'the packet is not marked as failed');
  assert.equal(EXAM_VERSION,'R2544.93-TRADER-EXAM-BB');
});
test('R2544.93 bull and bear at the table: even a 3-member committee seats price action + BULL + BEAR; the prompt no longer says skipping is fine',async()=>{
  const TB=require('../trader-brain');const mk=id=>({id,call:async()=>({ok:true,text:'{"ok":true}'})});
  const c=createCommittee({size:3,members:()=>['OR:google/gemma-4-31b-it:free','OR:nvidia/nemotron-3-ultra-550b-a55b:free','OR:poolside/laguna-s-2.1:free'].map(mk)});await c.probe({force:true});
  const seats=c.assignSeats(c.pick(),TB.ENTRY_ROLES).map(r=>r.key).sort();assert.deepEqual(seats,['ayı','boğa','price action']);
  assert.match(TB.ENTRY_ROLES.find(r=>r.key==='boğa').text,/strongest honest case FOR/);assert.match(TB.ENTRY_ROLES.find(r=>r.key==='ayı').text,/strongest honest case AGAINST/);
  assert.doesNotMatch(TB.ENTRY_SYSTEM,/Skipping is fine/);assert.match(TB.ENTRY_SYSTEM,/do not skip by habit, and do not take by habit/);
});
