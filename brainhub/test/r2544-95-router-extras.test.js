'use strict';
// R2544.95 (kullanıcı 27.10: "hangilerine anahtar gireceğim"): 9Router'a eklenen ücretsiz sağlayıcıların (NVIDIA, Google AI Studio, Groq,
// Cerebras, Kilo) modelleri kurula her sağlayıcıdan en çok 3 tane katılır; NVIDIA'nın 100+ modeli diğerlerini dışarıda bırakmaz.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pickRouterExtras,limitOf,createCommittee}=require('../model-committee');
const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const STRONG=eval(sv.match(/const ROUTER_STRONG=(\/.*\/i);/)[1]);
test('R2544.95 at most 3 models per provider, 12 in all; text models only; Kiro / Gemini CLI / OpenCode stay in the fixed list',()=>{
  const nv=['meta/llama-3.3-70b-instruct','meta/llama-4-maverick-17b-128e-instruct','meta/llama-4-scout-17b-16e-instruct','nvidia/llama-3.3-nemotron-super-49b-v1.5','nvidia/nemotron-3-ultra-550b-a55b','deepseek-ai/deepseek-v3.1','qwen/qwen3-235b-a22b','minimaxai/minimax-m2.7','moonshotai/kimi-k2-instruct','openai/gpt-oss-120b'].map(m=>'nvidia/'+m);
  const ids=[...nv,'nvidia/nvidia/llama-3.1-nemotron-safety-guard-8b','groq/llama-3.3-70b-versatile','groq/openai/gpt-oss-120b','groq/whisper-large-v3','gemini/gemini-2.5-flash','gemini/gemini-3-flash-preview','gemini/gemini-2.5-flash-preview-tts','cerebras/gpt-oss-120b','kc/nvidia/nemotron-3-ultra-550b-a55b:free','kc/poolside/laguna-s-2.1:free','kr/claude-sonnet-4.5','gc/gemini-2.5-pro','oc/glm-5','groq/qwen3-coder-480b'];
  const out=pickRouterExtras(ids,{strong:STRONG,perProvider:3,max:12});
  const by=p=>out.filter(m=>m.startsWith(p+'/'));
  assert.equal(by('nvidia').length,3,'NVIDIA does not take every seat');
  assert.deepEqual(by('groq'),['groq/llama-3.3-70b-versatile','groq/openai/gpt-oss-120b']);
  assert.deepEqual(by('gemini'),['gemini/gemini-2.5-flash','gemini/gemini-3-flash-preview'],'no TTS model');
  assert.deepEqual(by('cerebras'),['cerebras/gpt-oss-120b']);assert.deepEqual(by('kc'),['kc/nvidia/nemotron-3-ultra-550b-a55b:free']);
  assert.ok(!out.some(m=>/^(kr|gc|oc)\//.test(m)||/whisper|guard|tts|qwen3-coder/.test(m)));assert.ok(out.length<=12);
  assert.ok(STRONG.test('nvidia/minimaxai/minimax-m2.7'),'MiniMax M2 counts as strong');
  assert.equal(pickRouterExtras(ids,{have:new Set(['groq/llama-3.3-70b-versatile']),strong:STRONG}).filter(m=>m.startsWith('groq/')).length,1,'fixed members are not added twice');
});
test('R2544.95 the new providers show their published limit on the board and are their own provider at the table',async()=>{
  assert.equal(limitOf('ROUTER:nvidia/meta/llama-3.3-70b-instruct').perDay,10000);assert.equal(limitOf('ROUTER:groq/openai/gpt-oss-120b').perDay,1000);
  assert.equal(limitOf('ROUTER:gemini/gemini-2.5-flash').text,'AI Studio günlük');assert.equal(limitOf('ROUTER:kc/nvidia/nemotron-3-ultra-550b-a55b:free').text,'Kilo 200/saat');
  const mk=id=>({id,call:async()=>({ok:true,text:'{"ok":true}'})});
  const c=createCommittee({size:5,members:['ROUTER:nvidia/meta/llama-3.3-70b-instruct','ROUTER:nvidia/deepseek-ai/deepseek-v3.1','ROUTER:groq/openai/gpt-oss-120b','ROUTER:gemini/gemini-2.5-flash','ROUTER:kc/nvidia/nemotron-3-ultra-550b-a55b:free','OR:google/gemma-4-31b-it:free'].map(mk)});
  await c.probe({force:true});const team=c.pick().map(m=>m.id.split('/')[0]);
  assert.ok(new Set(team).size>=5,'five different providers at a five-seat table: '+team.join(', '));
  assert.match(sv,/pickRouterExtras\(committeeRouterIds\.ids\|\|\[\],\{have,strong:ROUTER_STRONG,perProvider:3,max:12\}\)/);
});
