'use strict';

const {OPENROUTER_FREE_BASELINE,isOpenRouterFreeId,freeCatalogModels,classifyProviderError,unique}=require('./free-model-registry');
const fs=require('node:fs');
const path=require('node:path');
const {roleInstruction,normalizeRole}=require('./worker-expertise');

function clip(v,n=800){return String(v??'').replace(/\s+/g,' ').trim().slice(0,n);}

function createOpenRouterFreeWorker({
  apiKey='',
  fetchImpl=globalThis.fetch,
  clock=()=>Date.now(),
  timeoutMs=15000,
  model='openrouter/free',
  models=OPENROUTER_FREE_BASELINE,
  preferredModels=[],
  maxAttempts=2,
  autoDiscovery=false,
  statePath=null,
  dailyLimit=50,
  minuteLimit=10
}={}){
  const key=String(apiKey||'').trim();
  const configured=key.startsWith('sk-or-v1-')&&typeof fetchImpl==='function';
  let freeModels=unique([...(models||[]),model,'openrouter/free']).filter(isOpenRouterFreeId);
  const preferred=unique(Array.isArray(preferredModels)?preferredModels:[]).filter(isOpenRouterFreeId);
  let failures=0,cooldownUntil=0,busy=false,rr=0;
  const perModel=new Map();
  let catalog={attemptAt:null,successAt:null,error:null},quota={day:new Date(clock()).toISOString().slice(0,10),used:0,limit:Math.max(1,Number(dailyLimit)||50),lastCheckedAt:null},minuteCalls=[];
  try{if(statePath){const saved=JSON.parse(fs.readFileSync(statePath,'utf8').replace(/^\uFEFF/,''));for(const row of saved.perModel||[])if(isOpenRouterFreeId(row.model))perModel.set(row.model,row);if(saved.quota?.day===quota.day)quota={...quota,...saved.quota};minuteCalls=(saved.minuteCalls||[]).filter(at=>Number.isFinite(at)&&clock()-at<60000);cooldownUntil=Number(saved.cooldownUntil)||0;}}catch{}
  function persist(){if(!statePath)return;try{fs.mkdirSync(path.dirname(statePath),{recursive:true});const tmp=statePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify({version:1,quota,minuteCalls,cooldownUntil,perModel:[...perModel].map(([model,row])=>({model,...row}))}));fs.renameSync(tmp,statePath);}catch{}}
  function rollover(){const day=new Date(clock()).toISOString().slice(0,10);if(quota.day!==day)quota={day,used:0,limit:Math.max(1,Number(dailyLimit)||50),lastCheckedAt:null};minuteCalls=minuteCalls.filter(at=>clock()-at<60000);}
  async function refresh(){
    if(!autoDiscovery)return;
    const now=clock();
    if(catalog.attemptAt===null||now-catalog.attemptAt>=30*60*1000){
      catalog.attemptAt=now;
      try{const r=await fetchImpl('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(5000)});const j=JSON.parse(await r.text());if(!r.ok||!Array.isArray(j?.data))throw new Error('FREE_CATALOG_UNAVAILABLE');const ids=freeCatalogModels(j);freeModels=unique(['openrouter/free',...ids]);catalog.successAt=now;catalog.error=null;}catch(e){catalog.error=clip(e?.message||e,160);}
    }
    if(quota.lastCheckedAt===null||now-quota.lastCheckedAt>=15*60*1000){
      quota.lastCheckedAt=now;
      try{const r=await fetchImpl('https://openrouter.ai/api/v1/key',{headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(5000)});const j=JSON.parse(await r.text());const q=j?.data?.free_model_daily_requests;if(r.ok&&q&&Number.isFinite(q.limit)&&q.limit>=0&&Number.isFinite(q.used)&&q.used>=0){quota.limit=q.limit;quota.used=Math.max(quota.used,q.used);}}catch{}
    }
    persist();
  }
  model='openrouter/free'; // compatibility field: never permit a paid override.
  let last={called:false,ok:false,at:null,model,reason:configured?'NOT_CALLED':'OPENROUTER_NOT_CONFIGURED'};

  function modelState(id){return perModel.get(id)||{attempts:0,successes:0,failures:0,consecutiveFailures:0,lastOk:false,lastAt:null,lastOkAt:null,lastError:null,lastErrorClass:null,httpStatus:null,cooldownUntil:0,lastLatencyMs:null};}
  function blocked(id){return clock()<Number(modelState(id).cooldownUntil||0);}
  function mark(id,{ok,error=null,errorClass=null,httpStatus=null,latencyMs=null,cooldown=null,validatedRole=null}={}){
    const p=modelState(id),now=clock();
    perModel.set(id,{
      ...p,attempts:p.attempts+1,successes:p.successes+(ok?1:0),failures:p.failures+(ok?0:1),lastAt:now,
      lastOk:ok===true,consecutiveFailures:ok?0:Number(p.consecutiveFailures||0)+1,
      validatedRoles:validatedRole?{...(p.validatedRoles||{}),[validatedRole]:now}:p.validatedRoles||{},
      lastOkAt:ok?now:p.lastOkAt,lastError:ok?null:clip(error,300),lastErrorClass:ok?null:(errorClass||'FAILED'),httpStatus:ok?null:(httpStatus||null),
      cooldownUntil:ok?0:(cooldown??p.cooldownUntil??0),lastLatencyMs:Number.isFinite(Number(latencyMs))?Number(latencyMs):p.lastLatencyMs
    });
    persist();
  }
  function orderedPool(role){
    if(!freeModels.length)return ['openrouter/free'];
    const direct=freeModels.filter(x=>x!=='openrouter/free');
    if(!direct.length)return ['openrouter/free'];
    const n=rr++%direct.length;
    const rotated=['openrouter/free',...direct.slice(n),...direct.slice(0,n)];
    const rank=id=>{const s=modelState(id);return s.lastOk===true&&clock()-s.lastOkAt<3600000?(s.validatedRoles?.[role]!==undefined&&clock()-s.validatedRoles[role]<3600000?2:1):0;};
    // Preferences only order the current free catalog; they cannot resurrect a
    // removed model, override its cooldown or enable a priced provider.
    const preferenceRank=id=>{const n=preferred.indexOf(id);return n<0?preferred.length:n;};
    return rotated.sort((a,b)=>rank(b)-rank(a)||preferenceRank(a)-preferenceRank(b));
  }

  async function callOne(id,system,prompt,validate,role){
    if(!isOpenRouterFreeId(id))throw new Error('NON_FREE_MODEL_REJECTED');
    const started=clock();
    const body={
      model:id,
      messages:[{role:'system',content:roleInstruction(role)+' '+String(system||'')},{role:'user',content:String(prompt||'')}],
      temperature:0,max_tokens:768,provider:{max_price:{prompt:0,completion:0}}
    };
    const r=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','HTTP-Referer':'https://brainhub.local','X-Title':'BrainHub Plan Worker'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(Math.max(5000,Math.min(30000,Number(timeoutMs)||15000)))
    });
    const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{};}catch{}
    const content=j?.choices?.[0]?.message?.content??j?.output_text;
    const text=(typeof content==='string'?content:Array.isArray(content)?content.filter(x=>x?.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n'):'').trim();
    if(!r.ok){
      const err=new Error('HTTP '+r.status+' '+clip(raw,300));err.status=r.status;err.payload=j;err.headers=r.headers;throw err;
    }
    if(j?.choices?.[0]?.finish_reason==='length')throw new Error('RESPONSE_TRUNCATED');
    if(!text)throw new Error(j?.error?'PROVIDER_RESPONSE_ERROR':'EMPTY_MODEL_OUTPUT');
    if(text.length>16000)throw new Error('RESPONSE_SCHEMA_INVALID: output too large');
    if(typeof validate==='function'&&validate(text)!==true)throw new Error('RESPONSE_SCHEMA_INVALID');
    const routedModel=String(j?.model||id);
    mark(id,{ok:true,latencyMs:clock()-started,validatedRole:typeof validate==='function'?role:null});
    return {routedModel,text};
  }

  async function review({system='',prompt='',validate=null,role='DEFAULT'}={}){
    role=normalizeRole(role);
    if(!configured){
      last={called:false,ok:false,at:new Date(clock()).toISOString(),model,reason:'OPENROUTER_NOT_CONFIGURED'};return last;
    }
    if(busy||clock()<cooldownUntil)return {called:false,ok:false,optional:true,blocksJev:false,freeOnly:true,model,reason:busy?'OPTIONAL_WORKER_BUSY':'OPTIONAL_WORKER_COOLDOWN',cooldownUntil};
    busy=true;
    const errors=[];
    try{
      rollover();await refresh();
      if(quota.used>=quota.limit||minuteCalls.length>=Math.max(1,Math.min(20,Number(minuteLimit)||10))){last={called:false,ok:false,optional:true,blocksJev:false,freeOnly:true,reason:'OPENROUTER_FREE_QUOTA_EXHAUSTED',quota:{...quota}};return last;}
      const pool=orderedPool(role).filter(x=>!blocked(x));
      const attempts=Math.max(1,Math.min(3,Number(maxAttempts)||2));
      for(const id of pool.slice(0,attempts)){
        if(quota.used>=quota.limit||minuteCalls.length>=Math.max(1,Math.min(20,Number(minuteLimit)||10)))break;
        const started=clock();
        try{
          quota.used++;minuteCalls.push(clock());persist();
          const out=await callOne(id,system,prompt,validate,role);
          failures=0;cooldownUntil=0;
          persist();
          // Preserve line breaks and complete JSON. Whitespace flattening corrupts WORKER_STATE/CONFIDENCE parsing.
          last={called:true,ok:true,at:new Date(clock()).toISOString(),model:out.routedModel,requestedModel:id,text:out.text,role,schemaValidated:typeof validate==='function',factualAccuracyVerified:false,freeOnly:true,optional:true,blocksJev:false,attempts:errors.length+1};
          return last;
        }catch(e){
          const msg=clip(e?.message||e,300);const c=classifyProviderError(msg,e?.status);
          const p=modelState(id);const modelFailures=Number(p.consecutiveFailures||0)+1;
          let until=clock()+Math.min(1800000,30000*2**Math.min(modelFailures-1,6));
          if(c.class==='MODEL_UNAVAILABLE')until=clock()+86400000;
          if(c.class==='AUTH')until=clock()+3600000;
          const reset=Number(e?.payload?.error?.metadata?.headers?.['X-RateLimit-Reset']);
          const retryHeader=e?.headers?.get?.('retry-after');const retry=Number(retryHeader)||Math.max(0,(Date.parse(retryHeader)-clock())/1000);
          if(c.httpStatus===429)until=Math.max(until,Number.isFinite(reset)?Math.min(reset,clock()+86400000):0,retry>0?clock()+Math.min(retry,86400)*1000:0);
          mark(id,{ok:false,error:msg,errorClass:c.class,httpStatus:c.httpStatus,latencyMs:clock()-started,cooldown:until});
          errors.push({model:id,error:msg,errorClass:c.class,httpStatus:c.httpStatus});
          // 429 is commonly key/free-tier level. Do not spray the same key across
          // explicit free endpoints after a quota response.
          if(c.httpStatus===429||c.class==='AUTH'){cooldownUntil=Math.max(cooldownUntil,until);persist();break;}
        }
      }
      failures++;
      cooldownUntil=Math.max(cooldownUntil,clock()+Math.min(1800000,30000*2**Math.min(failures-1,6)));
      persist();
      last={called:true,ok:false,at:new Date(clock()).toISOString(),model,reason:'OPENROUTER_FREE_WORKER_UNAVAILABLE',optional:true,blocksJev:false,cooldownUntil,detail:errors.map(x=>`${x.model}:${x.errorClass}${x.httpStatus?' HTTP '+x.httpStatus:''}`).join(' | ').slice(0,500),freeOnly:true,errors};
      return last;
    }finally{busy=false;}
  }

  function status(){
    rollover();return {configured,model,models:freeModels,preferredModels:preferred.filter(id=>freeModels.includes(id)),freeOnly:true,optional:true,blocksJev:false,failures,cooldownUntil,busy,catalog:{...catalog},quota:{...quota,remaining:Math.max(0,quota.limit-quota.used),minuteUsed:minuteCalls.length},last:{...last},perModel:freeModels.map(id=>({model:id,...modelState(id),status:blocked(id)?'cooldown':modelState(id).lastOk===true&&clock()-modelState(id).lastOkAt<3600000?'healthy':modelState(id).attempts>0?'failed':'untested'}))};
  }
  return {review,status};
}

module.exports={createOpenRouterFreeWorker};
