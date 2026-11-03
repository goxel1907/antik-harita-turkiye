'use strict';
// R2544.122 (03.11 11:20 sağlık: 18 hasta üyenin 7'si CEVAP VERMİŞTİ ama okunamadı): her tam {...} denenir, son geçerli olan kazanır.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const PD=require('../position-desk'),TB=require('../trader-brain');
const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('R2544.122 desk reader: thinking, code fences, two objects, a "}" inside a string, lower case - the vote is kept',()=>{
  const think='<think>maybe {HOLD} or exit? {"action":"EXIT"} no...</think>\n```json\n{"action":"hold","stopChoice":"breakeven","reasonTr":"yapı sağlam }"}\n```';
  const a=PD.parseFree(think);assert.equal(a.ok,true);assert.equal(a.action,'HOLD','the thought is not the answer');assert.equal(a.stopChoice,'BREAKEVEN');assert.equal(a.reasonTr,'yapı sağlam }');
  assert.equal(PD.parseFree('Plan {a:1}. Final: {"action":"Take Partial"} {"note":"x"}').action,'TAKE_PARTIAL','the last object WITH an action wins');
  assert.equal(PD.parseFree('{"action":"close"}').action,'EXIT');
  assert.equal(PD.parseFree('{"action":"tighten-stop","stopChoice":"LOCK 1R"}').stopChoice,'LOCK_1R');
});
test('R2544.122 desk reader still refuses what is not an answer',()=>{
  assert.deepEqual(PD.parseFree('{"action":"FLY"}'),{ok:false,reason:'DESK_ACTION_INVALID'});
  assert.deepEqual(PD.parseFree('no json at all'),{ok:false,reason:'DESK_JSON_INVALID'});
  assert.deepEqual(PD.parseFree('{"action": "HOLD"'),{ok:false,reason:'DESK_JSON_INVALID'},'a cut answer is not completed by guessing');
});
test('R2544.122 entry reader: same tolerance; TAKE / SKIP only',()=>{
  const e=TB.parseEntry('Reasoning: {x}\n{"decision":"skip","confidence":70,"pTarget":30,"reasonTr":"tepe {süpürülmedi}"}');
  assert.equal(e.ok,true);assert.equal(e.decision,'SKIP');assert.equal(e.pTarget,30);assert.equal(e.reasonTr,'tepe {süpürülmedi}');
  assert.equal(TB.parseEntry('{"decision":"Take"}').decision,'TAKE');assert.equal(TB.parseEntry('{"decision":"GİR"}').decision,'TAKE');
  assert.equal(TB.parseEntry('{"decision":"MAYBE"}').ok,false);
});
test('R2544.122 a reasoning model that hit the token limit after a complete valid answer keeps it; a cut answer still fails',()=>{
  for(const f of ['server.js','openrouter-free-worker.js']){const s=src(f);assert.match(s,/finish_reason==='length'&&!\(text&&typeof (requestOptions\.)?validate==='function'&&(requestOptions\.)?validate\(text\)===true\)\)throw new Error\('RESPONSE_TRUNCATED'\)/,f);}
});
test('R2544.122 the desk record says which empty seat a reserve took',()=>{
  const s=src('position-desk.js');assert.match(s,/committee:\{ consensus:reduceAgreed \? 'REDUCE_MAJORITY' : r\.consensus, rounds:r\.rounds, votes, replaced, voters:r\.voters \?\? null \}/);
  assert.match(s,/\.\.\.\(v\.reserveFor \? \{ r:short\(v\.reserveFor\) \} : \{\}\)/);
});
