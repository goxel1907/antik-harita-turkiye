const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {createJevClient,noulProbability,decisionQuestions,compactDecisionRecord}=require('../jev-decision');

function rootWithConfig(extra={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-jev-'));
  fs.mkdirSync(path.join(root,'config'),{recursive:true});
  fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({
    enabled:true,model:'typesafe/jev-1.13',
    decisionsUrl:'https://example.test/api/alpha/decisions',
    keyUrl:'https://example.test/api/v1/key',
    mode:'ADVISORY_VETO_ONLY',dailyCapUsd:0.25,timeoutMs:5000,maxPayloadChars:24000,reservePerCallUsd:0.01,...extra
  }));
  return root;
}
function response(status,obj){return {ok:status>=200&&status<300,status,async text(){return JSON.stringify(obj);}};}
const completeAnswers=()=>Object.fromEntries(Object.keys(decisionQuestions()).map(k=>[k,{noul:0.01}]));
const key='sk-or-v1-test_key_12345678901234567890';

test('noul probability parser accepts numeric Jev shape and rejects missing values',()=>{
  assert.equal(noulProbability({noul:0.82}),0.82);
  assert.equal(noulProbability({noul:2}),null);
  assert.equal(noulProbability([]),null);
  assert.equal(noulProbability({noul:-1}),null);
  assert.equal(noulProbability(0),0);
  assert.equal(noulProbability('0.35'),0.35);
  assert.equal(noulProbability(null),null);
  assert.equal(noulProbability(undefined),null);
  assert.equal(noulProbability(''),null);
  assert.equal(noulProbability(false),null);
  assert.equal(noulProbability({noul:null}),null);
  assert.equal(noulProbability({probability:''}),null);
});

test('Jev client stays fail-closed without key and never calls network',async()=>{
  const root=rootWithConfig();
  let calls=0;
  const client=createJevClient({root,apiKey:'',fetchImpl:async()=>{calls++;throw new Error('network');}});
  assert.equal(client.localStatus().configured,false);
  const j=await client.judge({plan:{status:'QUALIFIED'}});
  assert.equal(j.required,true);
  assert.equal(j.veto,true);
  assert.equal(j.reason,'JEV_KEY_UNAVAILABLE');
  assert.equal(calls,0);
  fs.rmSync(root,{recursive:true,force:true});
});

test('Jev remote status and synthetic probe stay on pinned OpenRouter endpoints',async()=>{
  const root=rootWithConfig();
  const calls=[];
  const client=createJevClient({
    root,apiKey:key,
    fetchImpl:async(url,opts={})=>{
      calls.push({url,opts});
      if(url.endsWith('/api/v1/key'))return response(200,{data:{label:'BrainHub-JEV',limit:5,usage:0}});
      const body=JSON.parse(opts.body);
      assert.equal(body.model,'typesafe/jev-1.13');
      assert.equal(body.state.record.synthetic,true);
      return response(200,{answers:{synthetic_probe:{noul:0.99}},usage:{prompt_tokens:120,cost:0.00001}});
    }
  });
  const s=await client.remoteStatus();
  assert.equal(s.reachable,true);
  assert.equal(s.keyMetadata.label,'BrainHub-JEV');
  const p=await client.probe();
  assert.equal(p.ok,true);
  assert.equal(p.probe,'PASS');
  assert.equal(calls.length,2);
  assert.ok(calls[1].url.endsWith('/api/alpha/decisions'));
  fs.rmSync(root,{recursive:true,force:true});
});

test('Jev successful response without usage metadata settles to a small conservative estimate',async()=>{
  const root=rootWithConfig();
  const client=createJevClient({
    root,apiKey:key,
    fetchImpl:async()=>response(200,{answers:{...completeAnswers(),
      structural_veto:{noul:0.01},
      forming_dependency:{noul:0.01},
      data_quality_insufficient:{noul:0.01},
      direction_conflict:{noul:0.01}
    }})
  });
  const j=await client.judge({candidate:{symbol:'BTCUSDT'},plan:{status:'QUALIFIED',timeframeDiagnostics:{}},unified:{frames:{}}});
  assert.equal(j.ok,true);
  assert.equal(j.veto,false);
  assert.ok(j.costUsd>0);
  assert.ok(j.costUsd<0.001);
  fs.rmSync(root,{recursive:true,force:true});
});

test('Jev judge is not called for WATCH plans',async()=>{
  const root=rootWithConfig();
  let calls=0;
  const client=createJevClient({root,apiKey:key,fetchImpl:async()=>{calls++;throw new Error('network');}});
  const j=await client.judge({plan:{status:'WATCH'}});
  assert.equal(j.called,false);
  assert.equal(calls,0);
  fs.rmSync(root,{recursive:true,force:true});
});

test('Jev QUALIFIED judge uses pinned alpha Decisions API and can veto',async()=>{
  const root=rootWithConfig();
  const calls=[];
  const client=createJevClient({
    root,apiKey:key,
    fetchImpl:async(url,opts={})=>{
      calls.push({url,opts});
      const body=JSON.parse(opts.body);
      assert.equal(body.model,'typesafe/jev-1.13');
      assert.equal(body.state.description.includes('advisory'),true);
      assert.equal(body.questions.structural_veto.type,'noul');
      return response(200,{
        answers:{...completeAnswers(),
          structural_veto:{noul:0.91},
          forming_dependency:{noul:0.10},
          data_quality_insufficient:{noul:0.05},
          direction_conflict:{noul:0.08}
        },
        usage:{prompt_tokens:500,cost:0.000021}
      });
    }
  });
  const j=await client.judge({
    candidate:{symbol:'BTCUSDT',side:'LONG'},
    plan:{status:'QUALIFIED',side:'LONG',confidence:80,timeframeDiagnostics:{},supportTFs:['1h'],vetoTFs:[]},
    unified:{frames:{},dataQuality:{advisoryUsable:true},policy:{execution:'ADVISORY_ONLY'}}
  });
  assert.equal(j.ok,true);
  assert.equal(j.veto,true);
  assert.deepEqual(j.vetoReasons,['JEV_STRUCTURAL_VETO']);
  assert.equal(j.costUsd,0.000021);
  assert.equal(calls.length,1);
  assert.ok(calls[0].url.endsWith('/api/alpha/decisions'));
  assert.equal(j.budget.calls,1);
  assert.ok(j.budget.spentUsd<0.001);
  fs.rmSync(root,{recursive:true,force:true});
});

test('Jev budget blocks calls before network when daily cap cannot reserve another call',async()=>{
  const root=rootWithConfig({dailyCapUsd:0.01,reservePerCallUsd:0.01});
  fs.mkdirSync(path.join(root,'data'),{recursive:true});
  fs.writeFileSync(path.join(root,'data','jev-usage.json'),JSON.stringify({day:new Date().toISOString().slice(0,10),spentUsd:0.01,calls:1}));
  let calls=0;
  const client=createJevClient({root,apiKey:key,fetchImpl:async()=>{calls++;throw new Error('network');}});
  const j=await client.judge({plan:{status:'QUALIFIED'},candidate:{},unified:{}});
  assert.equal(j.ok,false);
  assert.equal(j.veto,true);
  assert.equal(j.reason,'JEV_DAILY_BUDGET_EXHAUSTED');
  assert.equal(calls,0);
  fs.rmSync(root,{recursive:true,force:true});
});


test('detailed Jev contract rejects missing timeframe answer and array probabilities',async t=>{
  const root=rootWithConfig();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const answers=completeAnswers();delete answers.conflict_4h;
  answers.wait_required={noul:[]};
  const client=createJevClient({root,apiKey:key,fetchImpl:async()=>response(200,{answers})});
  const result=await client.judge({plan:{status:'QUALIFIED'}});
  assert.equal(result.ok,false);assert.equal(result.veto,true);
  assert.ok(result.missing.includes('4h'));assert.ok(result.missing.includes('waitRequired'));
});
test('Jev detail preserves 9TF SMC/global evidence as valid JSON and rejects oversize before network',async t=>{
  const root=rootWithConfig({maxPayloadChars:4000});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const input={candidate:{symbol:'BTCUSDT'},plan:{status:'QUALIFIED'},unified:{symbol:'BTCUSDT',global:{btc:{trend:'UP'}},frames:{'4h':{available:true,smcContext:{bos:'DOWN'}}}}};
  const record=JSON.parse(compactDecisionRecord(input,24000));
  assert.equal(record.frames['4h'].smcContext.bos,'DOWN');assert.equal(record.global.btc.trend,'UP');
  input.unified.frames['4h'].smcContext.extra='x'.repeat(8000);
  let called=false;const client=createJevClient({root,apiKey:key,fetchImpl:async()=>{called=true;throw Error('network');}});
  const result=await client.judge(input);
  assert.equal(result.reason,'JEV_EVIDENCE_PAYLOAD_TOO_LARGE');assert.equal(result.veto,true);assert.equal(called,false);
});
test('Jev reports typed TF conflict and Turkish reason without generating trade prices',async t=>{
  const root=rootWithConfig();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const answers=completeAnswers();answers.conflict_4h={noul:0.9};answers.smc_liquidity_conflict={noul:0.8};
  const client=createJevClient({root,apiKey:key,fetchImpl:async()=>response(200,{answers,usage:{cost:0.02}})});
  const result=await client.judge({plan:{status:'QUALIFIED',waitFor:'closed reclaim'}});
  assert.equal(result.veto,true);assert.deepEqual(result.conflictingTFs,['4h']);assert.match(result.summaryTr,/4h/);
  assert.equal(result.costUsd,0.02);assert.equal(result.budget.spentUsd,0.02);
  assert.equal(result.entry,undefined);
});
test('Jev settlement across midnight never refunds previous-day reserve from new-day spend',async t=>{
  const root=rootWithConfig();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let now=Date.parse('2026-09-19T23:59:59Z');
  const client=createJevClient({root,apiKey:key,clock:()=>now,fetchImpl:async()=>{
    now+=2000;fs.writeFileSync(path.join(root,'data','jev-usage.json'),JSON.stringify({day:'2026-09-20',spentUsd:0.02,calls:2}));
    return response(200,{answers:completeAnswers(),usage:{cost:0.001}});
  }});
  await client.judge({plan:{status:'QUALIFIED'}});
  assert.equal(client.budgetStatus().spentUsd,0.02);
});
