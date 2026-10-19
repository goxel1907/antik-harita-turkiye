'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createOpenRouterFreeWorker}=require('../openrouter-free-worker');

test('OpenRouter worker is hard-wired to the free router and never becomes an execution authority',async()=>{
  let seen=null;
  const fetchImpl=async(url,opts)=>{
    seen={url,body:JSON.parse(opts.body)};
    return {
      ok:true,status:200,
      text:async()=>JSON.stringify({
        model:'openrouter/free',
        choices:[{message:{content:'WORKER_STATE: WAIT\nCONFIDENCE: 70\nREASON: kosul yok\nRECHECK_TFS: 1m'}}]
      })
    };
  };
  const w=createOpenRouterFreeWorker({apiKey:'sk-or-v1-abcdefghijklmnopqrstuvwxyz123456',fetchImpl,clock:()=>1234});
  const out=await w.review({system:'worker only',prompt:'watch'});
  assert.equal(out.ok,true);
  assert.equal(out.freeOnly,true);
  assert.equal(seen.url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(seen.body.model,'openrouter/free');
  assert.match(seen.body.messages[0].content,/worker/i);
});

test('OpenRouter worker fails open to the main Brain flow when no key is configured',async()=>{
  const w=createOpenRouterFreeWorker({apiKey:''});
  const out=await w.review({system:'x',prompt:'y'});
  assert.equal(out.ok,false);
  assert.equal(out.called,false);
  assert.equal(out.reason,'OPENROUTER_NOT_CONFIGURED');
});
