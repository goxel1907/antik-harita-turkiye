'use strict';
// R2544.100 (kullanıcı 28.10: "ollamayı yaptım"): Ollama Cloud ücretsiz = aynı anda tek bulut modeli -> kurulda en çok 1 Ollama üyesi,
// sınav Ollama'yı yemez; "yoğun" (429) cevabı veren üye saatlik yoklamayı beklemeden 10 dk sonra yeniden denenir.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const MC=require('../model-committee');
const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const STRONG=eval(sv.match(/const ROUTER_STRONG=(\/.*\/i);/)[1]),CAND=eval(sv.match(/const ROUTER_CANDIDATES=(\[[\s\S]*?\]);/)[1]);
test('R2544.100 one Ollama Cloud member at most (today\'s models first); a gone one hands over to the next; the exam leaves Ollama to the desk',()=>{
  const ids=['ollama/gpt-oss:120b','ollama/kimi-k2.5','ollama/glm-5','ollama/minimax-m2.5','ollama/deepseek-v4.1-flash:cloud','groq/openai/gpt-oss-120b'];
  let out=MC.pickRouterExtras(ids,{strong:STRONG,perProvider:3,max:12,candidates:CAND});
  assert.deepEqual(out.filter(m=>m.startsWith('ollama/')),['ollama/gpt-oss:120b']);
  out=MC.pickRouterExtras(ids,{strong:STRONG,perProvider:3,max:12,candidates:CAND,gone:id=>id==='ROUTER:ollama/gpt-oss:120b'});
  assert.deepEqual(out.filter(m=>m.startsWith('ollama/')),['ollama/glm-5.3'],'the next of today\'s list');
  assert.equal(MC.limitOf('ROUTER:ollama/gpt-oss:120b').text,'Ollama Cloud oturum/hafta');
  assert.ok(sv.includes(String.raw`...extra.filter(m=>!(noAiStudio&&/^ROUTER:(gemini|ollama)\//.test(m.id)))`));
});
test('R2544.100 a busy (429) member is asked again after 10 min; a monthly quota or a timeout waits for the hourly probe',async()=>{
  let t=Date.UTC(2026,9,28,6,0,0);const calls={};
  const mk=(id,fail)=>({id,call:async()=>{calls[id]=(calls[id]||0)+1;return fail()?{ok:false,reason:fail()}:{ok:true,text:'{"ok":true}'};}});
  let busy='HTTP 503 [gemini/gemini-3.6-flash] [429]: You exceeded your current quota';
  const c=MC.createCommittee({clock:()=>t,members:[mk('ROUTER:gemini/x',()=>busy),mk('ROUTER:kr/glm-5',()=>'HTTP 503 [kiro/glm-5] [402]: You have reached the limit. MONTHLY_REQUEST_COUNT'),mk('ROUTER:nvidia/y',()=>'The operation was aborted due to timeout'),mk('ROUTER:groq/z',()=>null)]});
  await c.probe({force:true});assert.deepEqual(calls,{'ROUTER:gemini/x':1,'ROUTER:kr/glm-5':1,'ROUTER:nvidia/y':1,'ROUTER:groq/z':1});
  t+=5*60000;assert.equal(await c.probe(),null,'5 min: nothing to ask again');
  t+=5*60000;busy=null;await c.probe();
  assert.deepEqual(calls,{'ROUTER:gemini/x':2,'ROUTER:kr/glm-5':1,'ROUTER:nvidia/y':1,'ROUTER:groq/z':1},'only the busy one is asked again');
  assert.ok(c.healthy().some(m=>m.id==='ROUTER:gemini/x'),'back at the table');
  t+=50*60000;await c.probe();assert.equal(calls['ROUTER:groq/z'],2,'the hourly probe still runs for everyone');
});
test('R2544.100 quotaOf: a bare 402 counts as a used-up quota (an R2544.94 patch had written a backspace into that regex)',()=>{
  assert.equal(MC.quotaOf('HTTP 402 Payment Required',1).kind,'QUOTA');
  assert.ok(!fs.readFileSync(path.join(__dirname,'..','model-committee.js'),'utf8').includes('\x08'),'no control characters in the source');
});
