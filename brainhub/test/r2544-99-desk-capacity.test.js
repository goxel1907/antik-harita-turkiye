'use strict';
// R2544.99 (28.10 05:00, ilk yetkili masa kararları): 5 üyeden 4'ü cevap veremedi - OpenRouter 30 sn'de zaman aşımı (yeni pro ekran
// daha uzun), Gemini 3.6 Flash günlük kota (sınav aynı anahtarı harcıyordu). Masa OpenRouter'ı 90 sn bekler; sınav AI Studio kotasını yemez.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');
const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
test('R2544.99 the desk waits 90 s for an OpenRouter free model (the cap was 30 s); other workers keep their own timeout',async()=>{
  assert.match(sv,/const deskFreeWorker=createOpenRouterFreeWorker\(\{[^]*?timeoutMs:90000,maxAttempts:3/);
  const src=fs.readFileSync(path.join(__dirname,'..','openrouter-free-worker.js'),'utf8');assert.match(src,/Math\.min\(100000,Number\(timeoutMs\)\|\|15000\)/);
  assert.match(src,/body:JSON\.stringify\(body\),signal:AbortSignal\.timeout\(Math\.max\(5000,Math\.min\(100000,Number\(timeoutMs\)\|\|15000\)\)\)/,'the call uses the worker timeout up to 100 s');
});
test('R2544.99 the exam committee leaves out the Google AI Studio models (gemini/...); the desk keeps them',()=>{
  assert.match(sv,/members:ctx=>committeeMembers\(examFreeWorker,'FREE:openrouter',ctx,\{noAiStudio:true\}\)/);
  assert.match(sv,/members:ctx=>committeeMembers\(deskFreeWorker,'FREE:openrouter',ctx\)/);
  assert.ok(sv.includes(String.raw`...extra.filter(m=>!(noAiStudio&&/^ROUTER:(gemini|ollama)\//.test(m.id)))`)); // R2544.100 + ollama
});
