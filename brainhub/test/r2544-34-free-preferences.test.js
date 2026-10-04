'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');
const reply=j=>({ok:true,status:200,text:async()=>JSON.stringify(j)});
const row=id=>({id,pricing:{prompt:'0',completion:'0'},architecture:{output_modalities:['text']}});
test('preferred free model orders the live catalog without enabling a paid or removed model',async()=>{
 const seen=[];
 const worker=createOpenRouterFreeWorker({apiKey:'sk-or-v1-test',autoDiscovery:true,
  preferredModels:['paid/model','removed/model:free','good/model:free'],
  fetchImpl:async(url,options)=>{
   if(url.endsWith('/models'))return reply({data:[row('good/model:free'),row('other/model:free')]});
   if(url.endsWith('/key'))return reply({data:{}});
   seen.push(JSON.parse(options.body));return reply({model:'good/model:free',choices:[{message:{content:'AUDIT_OK'}}]});
  }});
 const out=await worker.review({prompt:'connectivity audit',validate:text=>text==='AUDIT_OK'});
 assert.equal(out.ok,true);assert.equal(seen[0].model,'good/model:free');
 assert.deepEqual(worker.status().preferredModels,['good/model:free']);
 assert.deepEqual(seen[0].provider.max_price,{prompt:0,completion:0});
});
test('a preferred model cooldown sends the next request to another free route',async()=>{
 let now=100000;const calls=[];
 const worker=createOpenRouterFreeWorker({apiKey:'sk-or-v1-test',clock:()=>now,maxAttempts:2,
  models:['preferred/model:free','other/model:free'],preferredModels:['preferred/model:free','other/model:free'],
  fetchImpl:async(url,options)=>{
   const body=JSON.parse(options.body);calls.push(body.model);
   if(body.model==='preferred/model:free')throw new Error('timeout');
   return reply({model:body.model,choices:[{message:{content:'OK'}}]});
  }});
 assert.equal((await worker.review({prompt:'audit'})).ok,true);
 now+=1;
 assert.equal((await worker.review({prompt:'audit'})).ok,true);
 assert.deepEqual(calls,['preferred/model:free','other/model:free','other/model:free']);
});
