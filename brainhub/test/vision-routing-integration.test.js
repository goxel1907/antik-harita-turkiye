'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function freePort() {
  const s = http.createServer();
  const port = await listen(s);
  await new Promise(resolve => s.close(resolve));
  return port;
}

async function waitFor(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
      lastError = new Error('HTTP '+r.status);
    } catch (e) {
      lastError = e;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('server did not become ready');
}

function stopChild(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 1500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { child.kill('SIGTERM'); } catch { resolve(); }
  });
}

function hasImageInput(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.some(m => Array.isArray(m?.content) && m.content.some(x => x?.type === 'image_url'));
}

function fakeImage(tf) {
  const bytes = Buffer.alloc(256, tf.length + 1);
  return { tf, mode:'annotated', dataUrl:'data:image/png;base64,'+bytes.toString('base64') };
}

test('9TF Vision prefers explicitly enabled loopback Ollama and never uses it for text-only committee calls', { timeout:20000 }, async () => {
  const routerRequested=[];
  const localRequested=[];
  const fakeRouter=http.createServer(async (req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({error:'not found'}));}
    let raw=''; for await(const chunk of req) raw+=chunk;
    const body=JSON.parse(raw||'{}'); const model=String(body.model||''); const vision=hasImageInput(body);
    routerRequested.push({model,vision});
    if(vision){res.writeHead(500,{'content-type':'application/json'});return res.end(JSON.stringify({error:'router vision should not be reached when local succeeds'}));}
    res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({choices:[{message:{content:'NO_TRADE'}}]}));
  });
  const fakeOllama=http.createServer(async (req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({error:'not found'}));}
    let raw=''; for await(const chunk of req) raw+=chunk;
    const body=JSON.parse(raw||'{}');
    const vision=hasImageInput(body);
    localRequested.push({model:String(body.model||''),vision,authorization:req.headers.authorization||'',temperature:body.temperature,maxTokens:body.max_tokens||null});
    const joinedAll=(body.messages||[]).map(m=>typeof m?.content==='string'?m.content:'').join('\n');
    const textRepair=/LOCAL_TF_SCHEMA_REPAIR/.test(joinedAll);
    const repairTf=textRepair?([...(joinedAll.matchAll(/TF_(1M|3M|5M|15M|30M|45M|1H|4H|1D)(?=[:_])/g))].map(m=>m[1])[0]||'1M'):null;
    let content=textRepair
      ? ['TF_'+repairTf+': test summary','TF_'+repairTf+'_WHY: test why','TF_'+repairTf+'_WAIT: test wait','TF_'+repairTf+'_ROLE: SUPPORT','TF_'+repairTf+'_FORMING: test forming','TF_'+repairTf+'_RISK: test risk'].join('\n')
      : /LOCAL_GLOBAL_NARRATIVE_REPAIR/.test(joinedAll)
        ? 'VISION_SUMMARY: repaired test vision'
        : /LOCAL_GLOBAL_CORE_REPAIR/.test(joinedAll)
          ? ['STATUS: WATCH','SIDE: LONG','CONFIDENCE: 55','ORIGIN_TF: 1m','OWNER_TF: 1h','SETUP: TEST','EXEC_PATH: WATCH'].join('\n')
          : /WHY: en fazla 220 karakter/.test(joinedAll)
            ? ['WHY: test why','RISK_NOTE: test risk','WAIT_FOR: test wait','FORMING_CONTEXT: test forming'].join('\n')
            : ['STATUS: WATCH | QUALIFIED | REJECT','SIDE: LONG | SHORT','CONFIDENCE: 0-100','ORIGIN_TF: 1m | 3m | 5m','OWNER_TF: 1m | 1h','SETUP: en fazla 5 kelime','EXEC_PATH: en fazla 5 kelime'].join('\n');
    if(vision){
      const texts=body.messages.flatMap(m=>Array.isArray(m?.content)?m.content.filter(x=>x?.type==='text').map(x=>String(x.text||'')):[]);
      const joined=texts.join('\n');
      const probe=[...joined.matchAll(/PROBE_(1M|3M|5M|15M|30M|45M|1H|4H|1D):/g)].map(m=>m[1]);
      if(joined.includes('LOCAL_PIXEL_SINGLE')){
        content='1';
      }else if(probe.length){
        content=[...new Set(probe)].map(tag=>'PROBE_'+tag+': 1').join('\n');
      }else{
        const tf=[...joined.matchAll(/TF_(1M|3M|5M|15M|30M|45M|1H|4H|1D)(?=[:_])/g)].map(m=>m[1])[0]||'1M';
        content=[
          'TF_'+tf+': test summary',
          'TF_'+tf+'_WHY: test why',
          'TF_'+tf+'_WAIT: test wait',
          'TF_'+tf+'_ROLE: '+(tf==='1H'?'SUPPORT | VETO | NEUTRAL':'SUPPORT'),
          'TF_'+tf+'_FORMING: test forming',
          'TF_'+tf+'_RISK: test risk'
        ].join('\n');
      }
    }
    res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  const routerPort=await listen(fakeRouter), localPort=await listen(fakeOllama);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-local-vision-route-')), brainPort=await freePort(), configDir=path.join(root,'config');
  fs.mkdirSync(configDir,{recursive:true});
  fs.writeFileSync(path.join(configDir,'models.json'),JSON.stringify({
    baseUrl:'http://127.0.0.1:'+routerPort+'/v1',opencode:['oc/text-a','oc/text-b'],kiro:['kr/not-needed'],
    localVision:{enabled:true,baseUrl:'http://127.0.0.1:'+localPort+'/v1',models:['qwen3-vl:test'],contextSize:16384,timeoutMs:300000,localOnly:true},healthCacheSeconds:1
  }),'utf8');
  fs.writeFileSync(path.join(configDir,'committee.json'),JSON.stringify({
    analysts:['oc/text-a','oc/text-b'],backupAnalysts:[],judges:[],minAnalystReplies:2,minVisionAnalystReplies:1,maxFreeVisionAttempts:2,
    allowKiroFreeQuotaVision:false,allowKiroVisionFallback:false,parallelAnalysts:2,visionParallelAnalysts:1,judgeOnlyOnDisagreement:true
  }),'utf8');
  const serverPath=path.join(__dirname,'..','server.js');
  const child=spawn(process.execPath,[serverPath],{cwd:root,env:{...process.env,BRAINHUB_ROOT:root,BRAINHUB_ROUTER_KEY:'integration-test-router-key-123456',BRAINHUB_HOST:'127.0.0.1',BRAINHUB_PORT:String(brainPort),BRAINHUB_CLIENT_TOKEN:''},stdio:['ignore','pipe','pipe']});
  try{
    const health=await waitFor('http://127.0.0.1:'+brainPort+'/health');
    assert.ok(health.features.includes('LOCAL_OLLAMA_VISION_FALLBACK')); assert.ok(health.features.includes('LOCAL_OLLAMA_VISION_PROGRESS')); assert.ok(health.features.includes('LOCAL_OLLAMA_VISION_SINGLE_FLIGHT')); assert.ok(health.features.includes('LOCAL_OLLAMA_VISION_COMPACT_GLOBAL_CONTEXT')); assert.ok(health.features.includes('LOCAL_OLLAMA_VISION_NARRATIVE_REPAIR')); assert.equal(health.configured.localVision,1);
    const initialProgress=await (await fetch('http://127.0.0.1:'+brainPort+'/vision/progress')).json();
    assert.equal(initialProgress.ok,true); assert.equal(typeof initialProgress.stage,'string');
    const tfs=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
    const vr=await fetch('http://127.0.0.1:'+brainPort+'/committee',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'STRUCTURE',prompt:'Local Vision routing regression',images:tfs.map(fakeImage)})});
    const vision=await vr.json(); assert.equal(vr.status,200,JSON.stringify(vision)); assert.equal(vision.model,'local/qwen3-vl:test'); assert.equal(vision.vision?.attached,9);
    assert.equal(localRequested.length,14); assert.equal(localRequested.filter(x=>x.vision===true).length,9); assert.equal((vision.text.match(/^TF_1H_ROLE: SUPPORT$/gm)||[]).length,1); assert.doesNotMatch(vision.text,/^TF_1H_ROLE: SUPPORT \| VETO \| NEUTRAL$/m); assert.equal(localRequested.filter(x=>x.vision===true&&x.maxTokens===180).length,9); assert.equal(localRequested.filter(x=>x.vision===false&&x.maxTokens===320).length,2); assert.ok(localRequested.filter(x=>x.vision===true).every(x=>x.model==='qwen3-vl:test'&&x.authorization===''&&x.temperature===0)); assert.ok(localRequested.some(x=>x.vision===false&&x.maxTokens===320)); assert.ok(localRequested.some(x=>x.vision===false&&x.maxTokens===220)); assert.ok(localRequested.some(x=>x.vision===false&&x.maxTokens===420)); assert.ok(localRequested.some(x=>x.vision===false&&x.maxTokens===260)); assert.equal(vision.localVisionTwoStage,true); assert.equal(vision.localVisionBatchSize,1); assert.match(vision.text,/TF_1M_WHY:/); assert.match(vision.text,/SUPPORT_TFS:/); assert.equal(routerRequested.some(x=>x.vision),false);
    const routes=await (await fetch('http://127.0.0.1:'+brainPort+'/models/routes')).json();
    assert.equal(routes.localVisionEnabled,true); assert.equal(routes.localVisionFirst,true); assert.equal(routes.localVisionModels[0],'local/qwen3-vl:test'); assert.equal(routes.localVisionContextSize,16384); assert.equal(routes.localVisionTimeoutMs,300000); assert.equal(routes.localVisionOnly,true); assert.equal(routes.localVisionTwoStage,true); assert.equal(routes.localVisionBatchSize,1); assert.equal(routes.localVisionSingleTf,true); assert.equal(routes.localVisionCompactFinalize,true); assert.equal(routes.localVisionTfContract,true); assert.equal(routes.localVisionSplitGlobal,true); assert.equal(routes.localVisionDirectPipeline,true); assert.deepEqual(routes.visionRoutes.STRUCTURE,['local/qwen3-vl:test']); assert.equal(routes.paidVisionFallbackEnabled,false);
    const beforeForce=localRequested.length;
    const fr=await fetch('http://127.0.0.1:'+brainPort+'/committee',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'STRUCTURE',prompt:'raw pixel probe',images:tfs.map(fakeImage),forceVisionProbe:true})});
    assert.equal(fr.status,200); assert.equal(localRequested.length,beforeForce+9); assert.ok(localRequested.slice(-9).every(x=>x.vision===true&&x.maxTokens===64));
    const forceBody=await fr.json(); assert.equal(forceBody.localVisionTwoStage,false); assert.equal(forceBody.localVisionBatchSize,1); assert.match(forceBody.text,/PROBE_1M: 1/); assert.match(forceBody.text,/PROBE_1D: 1/);
    const beforeLocal=localRequested.length;
    const tr=await fetch('http://127.0.0.1:'+brainPort+'/committee',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'SCALP',prompt:'Return NO_TRADE'})});
    assert.equal(tr.status,200); assert.equal(localRequested.length,beforeLocal); assert.ok(routerRequested.filter(x=>!x.vision).length>=2);
    const liveStatus=await (await fetch('http://127.0.0.1:'+brainPort+'/live/status')).json(); assert.equal(liveStatus.armed,false); assert.equal(liveStatus.visionAvailability.verifiedModels,1);
  } finally {
    await stopChild(child); await new Promise(resolve=>fakeRouter.close(resolve)); await new Promise(resolve=>fakeOllama.close(resolve)); fs.rmSync(root,{recursive:true,force:true});
  }
});

test('9TF Vision may use an explicitly opted-in Kiro free-quota route without changing text-only routing', { timeout:20000 }, async () => {
  const requested = [];
  const fakeRouter = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type':'application/json' });
      return res.end(JSON.stringify({ error:'not found' }));
    }
    let raw='';
    for await (const chunk of req) raw += chunk;
    const body=JSON.parse(raw||'{}');
    const model=String(body.model||'');
    const vision=hasImageInput(body);
    requested.push({ model, vision });

    if (vision && model.startsWith('oc/')) {
      res.writeHead(400, { 'content-type':'application/json' });
      return res.end(JSON.stringify({ error:'image input unsupported by this model' }));
    }
    if (vision && model.startsWith('kr/')) {
      res.writeHead(200, { 'content-type':'application/json' });
      return res.end(JSON.stringify({ choices:[{ message:{ content:'VISION_OK: 1m,3m,5m,15m,30m,45m,1h,4h,1d' } }] }));
    }
    res.writeHead(200, { 'content-type':'application/json' });
    return res.end(JSON.stringify({ choices:[{ message:{ content:'NO_TRADE' } }] }));
  });

  const routerPort=await listen(fakeRouter);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-vision-route-'));
  const brainPort=await freePort();
  const configDir=path.join(root,'config');
  fs.mkdirSync(configDir,{recursive:true});

  const opencode=['oc/free-fast','oc/free-structure'];
  const kiro=['kr/vision-backup'];
  fs.writeFileSync(path.join(configDir,'models.json'),JSON.stringify({
    baseUrl:'http://127.0.0.1:'+routerPort+'/v1',
    opencode,
    kiro,
    healthCacheSeconds:1
  }),'utf8');
  fs.writeFileSync(path.join(configDir,'committee.json'),JSON.stringify({
    analysts:opencode,
    backupAnalysts:[],
    judges:[],
    minAnalystReplies:2,
    minVisionAnalystReplies:1,
    maxFreeVisionAttempts:2,
    allowKiroFreeQuotaVision:true,
    kiroFreeQuotaVisionModels:['kr/vision-backup'],
    allowKiroVisionFallback:false,
    parallelAnalysts:2,
    judgeOnlyOnDisagreement:true
  }),'utf8');

  const serverPath=path.join(__dirname,'..','server.js');
  const child=spawn(process.execPath,[serverPath],{
    cwd:root,
    env:{
      ...process.env,
      BRAINHUB_ROOT:root,
      BRAINHUB_ROUTER_KEY:'integration-test-router-key-123456',
      BRAINHUB_HOST:'127.0.0.1',
      BRAINHUB_PORT:String(brainPort),
      BRAINHUB_CLIENT_TOKEN:''
    },
    stdio:['ignore','pipe','pipe']
  });

  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=String(chunk);});

  try {
    const bootstrapHealth=await waitFor('http://127.0.0.1:'+brainPort+'/health');
    assert.ok(bootstrapHealth.features.includes('VISION_PIXEL_PROBE'));
    assert.ok(bootstrapHealth.features.includes('KIRO_FREE_QUOTA_VISION_OPT_IN'));
    assert.ok(bootstrapHealth.features.includes('OPENCODE_OFFICIAL_FREE_INFERENCE'));
    assert.equal(bootstrapHealth.featureCompatibility?.OPENCODE_OFFICIAL_FREE_INFERENCE,'BOOTSTRAP_ALIAS_ONLY');

    const tfs=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
    const vr=await fetch('http://127.0.0.1:'+brainPort+'/committee',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        role:'STRUCTURE',
        system:'Vision routing regression only.',
        prompt:'Return exactly VISION_OK and the received timeframes.',
        images:tfs.map(fakeImage)
      })
    });
    const vision=await vr.json();
    assert.equal(vr.status,200,JSON.stringify(vision));
    assert.equal(vision.ok,true);
    assert.equal(vision.vision?.attached,9);
    assert.equal(vision.model,'kr/vision-backup');
    assert.equal(vision.mode,'degraded_single');
    assert.equal(vision.degraded,true);
    assert.equal(vision.receivedAnalystReplies,1);
    assert.equal(vision.requiredVisionAnalystReplies,1);
    assert.match(String(vision.text),/^VISION_OK:/);

    const imageCalls=requested.filter(x=>x.vision);
    assert.ok(imageCalls.some(x=>x.model==='oc/free-fast'));
    assert.ok(imageCalls.some(x=>x.model==='oc/free-structure'));
    assert.ok(imageCalls.some(x=>x.model==='kr/vision-backup'));
    const firstKiro=imageCalls.findIndex(x=>x.model.startsWith('kr/'));
    const lastFree=Math.max(...imageCalls.map((x,i)=>x.model.startsWith('oc/')?i:-1));
    assert.ok(firstKiro>lastFree,'Kiro free quota must remain a fallback after free OpenCode Vision attempts');

    const routes=await (await fetch('http://127.0.0.1:'+brainPort+'/models/routes')).json();
    assert.equal(routes.visionKiroFreeQuota,true);
    assert.equal(routes.paidVisionFallbackEnabled,false);
    assert.deepEqual(routes.kiroFreeQuotaVisionModels,['kr/vision-backup']);
    assert.ok(routes.visionRoutes.STRUCTURE.includes('kr/vision-backup'));

    const hr=await fetch('http://127.0.0.1:'+brainPort+'/models/healthy');
    const health=await hr.json();
    const freeHealth=health.models.filter(x=>String(x.model).startsWith('oc/'));
    const kiroHealth=health.models.find(x=>x.model==='kr/vision-backup');
    assert.ok(freeHealth.every(x=>x.visionStatus==='cooldown'));
    assert.equal(kiroHealth.visionStatus,'healthy');
    const liveStatus=await (await fetch('http://127.0.0.1:'+brainPort+'/live/status')).json();
    assert.equal(liveStatus.armed,false);
    assert.equal(liveStatus.visionAvailability.verifiedModels,1);
    assert.ok(liveStatus.visionAvailability.models.some(x=>x.reason==='PROVIDER_UNAVAILABLE'));

    const beforeText=requested.length;
    const tr=await fetch('http://127.0.0.1:'+brainPort+'/committee',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({role:'SCALP',prompt:'Return NO_TRADE'})
    });
    const textOnly=await tr.json();
    assert.equal(tr.status,200,JSON.stringify(textOnly));
    const textCalls=requested.slice(beforeText);
    assert.ok(textCalls.length>=2);
    assert.ok(textCalls.every(x=>x.model.startsWith('oc/')));
  } finally {
    await stopChild(child);
    await new Promise(resolve=>fakeRouter.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }

  assert.equal(stderr.includes('BRAINHUB_ROUTER_KEY missing'),false,stderr);
});

test('9TF Vision never consumes Kiro when neither free-quota nor legacy fallback is explicitly enabled', { timeout:20000 }, async () => {
  const requested=[];
  const fakeRouter=http.createServer(async (req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){
      res.writeHead(404,{'content-type':'application/json'});
      return res.end(JSON.stringify({error:'not found'}));
    }
    let raw=''; for await(const chunk of req) raw+=chunk;
    const body=JSON.parse(raw||'{}');
    const model=String(body.model||'');
    const vision=hasImageInput(body);
    requested.push({model,vision});
    if(vision&&model.startsWith('oc/')){
      res.writeHead(400,{'content-type':'application/json'});
      return res.end(JSON.stringify({error:'image input unsupported'}));
    }
    res.writeHead(200,{'content-type':'application/json'});
    return res.end(JSON.stringify({choices:[{message:{content:'VISION_OK: should-not-use-paid-fallback'}}]}));
  });

  const routerPort=await listen(fakeRouter);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-vision-free-only-'));
  const brainPort=await freePort();
  const configDir=path.join(root,'config');
  fs.mkdirSync(configDir,{recursive:true});
  fs.writeFileSync(path.join(configDir,'models.json'),JSON.stringify({
    baseUrl:'http://127.0.0.1:'+routerPort+'/v1',
    opencode:['oc/free-only'],
    kiro:['kr/paid-vision'],
    healthCacheSeconds:1
  }),'utf8');
  fs.writeFileSync(path.join(configDir,'committee.json'),JSON.stringify({
    analysts:['oc/free-only'],
    backupAnalysts:[],
    judges:['kr/paid-vision'],
    minAnalystReplies:2,
    minVisionAnalystReplies:1,
    parallelAnalysts:1,
    judgeOnlyOnDisagreement:true
  }),'utf8');

  const serverPath=path.join(__dirname,'..','server.js');
  const child=spawn(process.execPath,[serverPath],{
    cwd:root,
    env:{
      ...process.env,
      BRAINHUB_ROOT:root,
      BRAINHUB_ROUTER_KEY:'integration-test-router-key-123456',
      BRAINHUB_HOST:'127.0.0.1',
      BRAINHUB_PORT:String(brainPort),
      BRAINHUB_CLIENT_TOKEN:''
    },
    stdio:['ignore','pipe','pipe']
  });

  try{
    await waitFor('http://127.0.0.1:'+brainPort+'/health');
    const tfs=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
    const r=await fetch('http://127.0.0.1:'+brainPort+'/committee',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({role:'STRUCTURE',prompt:'Vision free-only regression',images:tfs.map(fakeImage)})
    });
    const body=await r.json();
    assert.equal(r.status,503,JSON.stringify(body));
    assert.equal(body.error,'no vision analyst replies');
    assert.ok(requested.some(x=>x.model==='oc/free-only'&&x.vision));
    assert.equal(requested.some(x=>x.model.startsWith('kr/')),false,'paid/Kiro route must require explicit opt-in');

    const routes=await (await fetch('http://127.0.0.1:'+brainPort+'/models/routes')).json();
    assert.equal(routes.visionKiroFreeQuota,false);
    assert.equal(routes.visionKiroFallback,false);
    assert.equal(routes.paidVisionFallbackEnabled,false);
    assert.ok(routes.visionRoutes.STRUCTURE.every(x=>x.startsWith('oc/')));
  }finally{
    await stopChild(child);
    await new Promise(resolve=>fakeRouter.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
});

