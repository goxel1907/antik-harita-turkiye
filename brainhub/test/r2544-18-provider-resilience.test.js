'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  OPENROUTER_FREE_BASELINE,
  NINEROUTER_OPENCODE_BASELINE,
  isOpenRouterFreeId,
  is9RouterOpenCodeFreeId,
  classifyProviderError,
  discoverOpenAIModels
}=require('../free-model-registry');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');

const root=path.resolve(__dirname,'..');
const src=f=>fs.readFileSync(path.join(root,f),'utf8');

function reply(status,payload,headers={}){
  return {
    ok:status>=200&&status<300,status,
    headers:{get:k=>headers[String(k).toLowerCase()]??null},
    text:async()=>JSON.stringify(payload)
  };
}

test('R2544.18 explicit helper registry is free-only and contains finance evidence route',()=>{
  assert.ok(OPENROUTER_FREE_BASELINE.includes('openrouter/free'));
  assert.ok(OPENROUTER_FREE_BASELINE.includes('inclusionai/ling-3.0-flash-fin:free'));
  assert.ok(OPENROUTER_FREE_BASELINE.every(isOpenRouterFreeId));
  assert.ok(NINEROUTER_OPENCODE_BASELINE.every(is9RouterOpenCodeFreeId));
  assert.equal(isOpenRouterFreeId('anthropic/claude-opus-4.1'),false);
  assert.equal(is9RouterOpenCodeFreeId('kr/claude-sonnet-4.5'),false);
});

test('R2544.18 provider errors are classified without pretending a model was untried',()=>{
  assert.deepEqual(classifyProviderError('HTTP 401 unauthorized'),{class:'AUTH',httpStatus:401});
  assert.deepEqual(classifyProviderError('HTTP 400 upstream endpoint unavailable'),{class:'UPSTREAM_UNAVAILABLE',httpStatus:400});
  assert.deepEqual(classifyProviderError('HTTP 503 temporarily overloaded'),{class:'OVERLOADED',httpStatus:503});
  assert.equal(classifyProviderError('request timed out').class,'TIMEOUT');
  assert.equal(classifyProviderError('fetch failed ECONNREFUSED').class,'CONNECTION');
});

test('R2544.18 9Router OpenCode model discovery accepts new oc routes dynamically',async()=>{
  let seen='';
  const out=await discoverOpenAIModels({
    baseUrl:'http://127.0.0.1:20128/v1',key:'local-key',
    fetchImpl:async(url)=>{seen=url;return reply(200,{data:[{id:'oc/new-market-free'},{id:'kr/glm-5'},{id:'paid/model'}]});}
  });
  assert.equal(out.ok,true);
  assert.equal(seen,'http://127.0.0.1:20128/v1/models');
  assert.deepEqual(out.models.filter(is9RouterOpenCodeFreeId),['oc/new-market-free']);
});

test('R2544.18 OpenRouter free helper falls back only to an explicit free model after upstream overload',async()=>{
  const bodies=[];let calls=0;
  const w=createOpenRouterFreeWorker({
    apiKey:'sk-or-v1-test_abcdefghijklmnopqrstuvwxyz',
    models:['openrouter/free','inclusionai/ling-3.0-flash-fin:free','paid/model'],maxAttempts:2,
    fetchImpl:async(_url,opts)=>{
      const body=JSON.parse(opts.body);bodies.push(body);calls++;
      if(calls===1)return reply(503,{error:{message:'temporarily overloaded'}});
      return reply(200,{model:body.model,choices:[{message:{content:'SECOND_OPINION_OK'}}]});
    }
  });
  const out=await w.review({system:'advisory evidence only',prompt:'market evidence'});
  assert.equal(out.ok,true);
  assert.equal(out.blocksJev,false); // helper stays explicitly advisory on success too
  assert.equal(bodies[0].model,'openrouter/free');
  assert.match(bodies[1].model,/:free$/);
  assert.equal(bodies.some(x=>x.model==='paid/model'),false);
  const st=w.status();
  assert.equal(st.optional,true);assert.equal(st.blocksJev,false);assert.equal(st.freeOnly,true);
  assert.ok(st.perModel.find(x=>x.model==='openrouter/free').failures>=1);
  assert.ok(st.perModel.find(x=>x.model==='inclusionai/ling-3.0-flash-fin:free').successes>=1);
});

test('R2544.18 OpenRouter free 429 does not spray the key across fallback models',async()=>{
  let now=100,calls=0;
  const w=createOpenRouterFreeWorker({
    apiKey:'sk-or-v1-test_abcdefghijklmnopqrstuvwxyz',clock:()=>now,maxAttempts:3,
    fetchImpl:async()=>{calls++;return reply(429,{error:{message:'rate limited',metadata:{headers:{}}}},{'retry-after':'60'});}
  });
  const out=await w.review({system:'x',prompt:'y'});
  assert.equal(out.ok,false);assert.equal(out.blocksJev,false);assert.equal(calls,1);
  const skipped=await w.review({system:'x',prompt:'y'});
  assert.equal(skipped.called,false);assert.equal(calls,1);
});

test('R2544.18 Headroom collision guard uses 8788 and never changes JEV authority',()=>{
  const server=src('server.js');
  const setup=src('HEADROOM-SETUP.ps1');
  const office=src('office-dashboard/public/office.html');
  const manager=src('manage.ps1');
  assert.match(server,/recommendedUrl:'http:\/\/127\.0\.0\.1:8788'/);
  assert.match(server,/Headroom default http:\/\/localhost:8787 points at BrainHub and receives 401/);
  assert.match(setup,/\[int\]\$Port = 8788/);
  assert.match(setup,/if \(\$Port -eq 8787\)/);
  assert.match(office,/9Router OpenCode Free/);
  assert.match(office,/OpenRouter free havuzu/);
  assert.match(office,/Headroom/);
  assert.match(manager,/free-model-registry\.js/);
  assert.match(manager,/HEADROOM-SETUP\.ps1/);
  assert.match(server,/const freeWorker=createOpenRouterFreeWorker/);
  assert.match(server,/const RUNTIME_RELEASE='R2544\.32-JEV-CAUSAL-BREAK-TREND'/);
});

test('R2544.18 Office probes Headroom sidecar separately from BrainHub 8787',()=>{
  const officeServer=src('office-dashboard/office-server.js');
  assert.match(officeServer,/HEADROOM_URL = \(process\.env\.HEADROOM_URL \|\| 'http:\/\/127\.0\.0\.1:8788'\)/);
  assert.match(officeServer,/HEADROOM_URL \+ '\/health'/);
  assert.match(officeServer,/OFFICE_VERSION = '2\.5\.12-R2544\.32-JEV-Brain'/);
});
