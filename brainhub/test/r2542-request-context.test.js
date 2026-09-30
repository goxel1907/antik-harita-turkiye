'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepareDecisionRequest,createJevClient,MAX_DECISION_REQUEST_BYTES}=require('../jev-decision');
test('whole request compacts references but preserves market, plans and questions byte for byte',()=>{
  const input={model:'test',state:{description:'contract',coreMarketPacket:{price:12.345,frames:{numeric:123},padding:'x'.repeat(28000)},
    record:{executablePlanOptions:[{id:'SHORT',stop:13}],requestedEvidence:{cvd:-100}},
    professionalTraderCortex:{reference:'reference '.repeat(2000)},
    dynamicKnowledge:{entries:Array.from({length:8},()=>({summary:'context '.repeat(500)}))},
    experienceMemory:{alwaysOn:true,measuredSampleCount:50,lifetime:{wins:20,losses:30},stats:Array(20).fill({sample:1})}},
    questions:{trade_plan:{type:'choice',criteria:{LONG:'long',SHORT:'short',WAIT:'wait'}}}};
  const before=JSON.stringify(input);const out=prepareDecisionRequest(input);
  assert.equal(out.ok,true);assert.ok(out.diagnostics.bytes<=MAX_DECISION_REQUEST_BYTES);
  assert.ok(out.diagnostics.bytes<out.diagnostics.beforeBytes);
  assert.deepEqual(out.body.state.coreMarketPacket,input.state.coreMarketPacket);
  assert.deepEqual(out.body.state.record,input.state.record);
  assert.deepEqual(out.body.questions,input.questions);
  assert.deepEqual(out.body.state.experienceMemory.lifetime,input.state.experienceMemory.lifetime);
  assert.equal(JSON.stringify(input),before);
});
test('UTF-8 byte guard rejects untrimmable truth before any network call or budget reservation',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-context-'));
  fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config/jev.json'),JSON.stringify({enabled:true,dailyCapUsd:100}));
  let calls=0;
  const client=createJevClient({root,apiKey:'sk-or-v1-test',fetchImpl:async()=>{calls++;throw Error('NETWORK_FORBIDDEN');}});
  const unified={symbol:'TESTUSDT',dataQuality:{detail:'界'.repeat(30000)}};
  for(const fn of ['sovereignPass1','sovereignFinal']){
    const out=await client[fn]({unified,planOptions:[]});
    assert.equal(out.reason,'JEV_CORE_CONTEXT_TOO_LARGE');assert.equal(out.called,false);assert.equal(out.attempted,false);
  }
  assert.equal(calls,0);assert.equal(fs.existsSync(path.join(root,'data/jev-usage.json')),false);
});
test('small requests are unchanged',()=>{
  const body={model:'x',state:{numeric:1},questions:{q:{type:'noul',instructions:'test'}}};
  assert.deepEqual(prepareDecisionRequest(body).body,body);
});
