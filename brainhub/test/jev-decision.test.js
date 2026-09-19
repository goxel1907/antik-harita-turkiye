const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {createJevClient}=require('../jev-decision');

function rootWithConfig(enabled=true){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-jev-'));
  fs.mkdirSync(path.join(root,'config'),{recursive:true});
  fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({
    enabled,
    model:'typesafe/jev-1.13',
    decisionsUrl:'https://example.test/api/alpha/decisions',
    keyUrl:'https://example.test/api/v1/key',
    mode:'ADVISORY_VETO_ONLY',
    dailyCapUsd:0.25,
    timeoutMs:5000
  }));
  return root;
}
function response(status,obj){
  return {ok:status>=200&&status<300,status,async text(){return JSON.stringify(obj);}};
}

test('Jev client stays disabled without explicit config/key and never calls network', async()=>{
  const root=rootWithConfig(false);
  let calls=0;
  const client=createJevClient({root,apiKey:'',fetchImpl:async()=>{calls++;throw new Error('network');}});
  assert.equal(client.localStatus().configured,false);
  const p=await client.probe();
  assert.equal(p.ok,false);
  assert.equal(p.reason,'OPENROUTER_NOT_CONFIGURED');
  assert.equal(calls,0);
  fs.rmSync(root,{recursive:true,force:true});
});

test('Jev probe uses only OpenRouter alpha decisions with pinned model and synthetic advisory state', async()=>{
  const root=rootWithConfig(true);
  const calls=[];
  const client=createJevClient({
    root,
    apiKey:'sk-or-v1-test_key_12345678901234567890',
    fetchImpl:async(url,opts={})=>{
      calls.push({url,opts});
      if(url.endsWith('/api/v1/key'))return response(200,{data:{label:'BrainHub-JEV',limit:5,usage:0}});
      const body=JSON.parse(opts.body);
      assert.equal(body.model,'typesafe/jev-1.13');
      assert.equal(body.state.record.synthetic,true);
      assert.equal(body.state.record.execution,'ADVISORY_ONLY');
      assert.equal(body.questions.synthetic_probe.type,'noul');
      return response(200,{answers:{synthetic_probe:{noul:0.99}},usage:{prompt_tokens:120,cost:0.00001}});
    }
  });
  const s=await client.remoteStatus();
  assert.equal(s.reachable,true);
  assert.equal(s.keyMetadata.label,'BrainHub-JEV');
  const p=await client.probe();
  assert.equal(p.ok,true);
  assert.equal(p.probe,'PASS');
  assert.equal(p.model,'typesafe/jev-1.13');
  assert.equal(p.usage.cost,0.00001);
  assert.equal(calls.length,2);
  assert.ok(calls[1].url.endsWith('/api/alpha/decisions'));
  assert.equal(calls[1].opts.headers.authorization.startsWith('Bearer sk-or-v1-'),true);
  fs.rmSync(root,{recursive:true,force:true});
});
