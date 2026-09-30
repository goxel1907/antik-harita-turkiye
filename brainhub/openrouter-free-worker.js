'use strict';

const {OPENROUTER_FREE_BASELINE,isOpenRouterFreeId,classifyProviderError,unique}=require('./free-model-registry');

function clip(v,n=800){return String(v??'').replace(/\s+/g,' ').trim().slice(0,n);}

function createOpenRouterFreeWorker({
  apiKey='',
  fetchImpl=globalThis.fetch,
  clock=()=>Date.now(),
  timeoutMs=15000,
  model='openrouter/free',
  models=OPENROUTER_FREE_BASELINE,
  maxAttempts=2
}={}){
  const key=String(apiKey||'').trim();
  const configured=key.startsWith('sk-or-v1-')&&typeof fetchImpl==='function';
  const freeModels=unique([...(models||[]),model,'openrouter/free']).filter(isOpenRouterFreeId);
  let failures=0,cooldownUntil=0,busy=false,rr=0;
  const perModel=new Map();
  model='openrouter/free'; // compatibility field: never permit a paid override.
  let last={called:false,ok:false,at:null,model,reason:configured?'NOT_CALLED':'OPENROUTER_NOT_CONFIGURED'};

  function modelState(id){return perModel.get(id)||{attempts:0,successes:0,failures:0,lastAt:null,lastOkAt:null,lastError:null,lastErrorClass:null,httpStatus:null,cooldownUntil:0,lastLatencyMs:null};}
  function blocked(id){return clock()<Number(modelState(id).cooldownUntil||0);}
  function mark(id,{ok,error=null,errorClass=null,httpStatus=null,latencyMs=null,cooldown=null}={}){
    const p=modelState(id),now=clock();
    perModel.set(id,{
      ...p,attempts:p.attempts+1,successes:p.successes+(ok?1:0),failures:p.failures+(ok?0:1),lastAt:now,
      lastOkAt:ok?now:p.lastOkAt,lastError:ok?null:clip(error,300),lastErrorClass:ok?null:(errorClass||'FAILED'),httpStatus:ok?null:(httpStatus||null),
      cooldownUntil:ok?0:(cooldown??p.cooldownUntil??0),lastLatencyMs:Number.isFinite(Number(latencyMs))?Number(latencyMs):p.lastLatencyMs
    });
  }
  function orderedPool(){
    if(!freeModels.length)return ['openrouter/free'];
    const direct=freeModels.filter(x=>x!=='openrouter/free');
    if(!direct.length)return ['openrouter/free'];
    const n=rr++%direct.length;
    return ['openrouter/free',...direct.slice(n),...direct.slice(0,n)];
  }

  async function callOne(id,system,prompt){
    if(!isOpenRouterFreeId(id))throw new Error('NON_FREE_MODEL_REJECTED');
    const started=clock();
    const body={
      model:id,
      messages:[{role:'system',content:String(system||'')},{role:'user',content:String(prompt||'')}],
      temperature:0,max_tokens:220
    };
    const r=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','HTTP-Referer':'https://brainhub.local','X-Title':'BrainHub Plan Worker'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(Math.max(5000,Math.min(30000,Number(timeoutMs)||15000)))
    });
    const raw=await r.text();let j={};try{j=raw?JSON.parse(raw):{};}catch{}
    const text=String(j?.choices?.[0]?.message?.content||j?.output_text||'').trim();
    if(!r.ok||!text){
      const err=new Error('HTTP '+r.status+' '+clip(raw,300));err.status=r.status;err.payload=j;err.headers=r.headers;throw err;
    }
    const routedModel=String(j?.model||id);
    mark(id,{ok:true,latencyMs:clock()-started});
    return {routedModel,text};
  }

  async function review({system='',prompt=''}={}){
    if(!configured){
      last={called:false,ok:false,at:new Date(clock()).toISOString(),model,reason:'OPENROUTER_NOT_CONFIGURED'};return last;
    }
    if(busy||clock()<cooldownUntil)return {called:false,ok:false,optional:true,blocksJev:false,freeOnly:true,model,reason:busy?'OPTIONAL_WORKER_BUSY':'OPTIONAL_WORKER_COOLDOWN',cooldownUntil};
    busy=true;
    const errors=[];
    try{
      const pool=orderedPool().filter(x=>!blocked(x));
      const attempts=Math.max(1,Math.min(3,Number(maxAttempts)||2));
      for(const id of pool.slice(0,attempts)){
        const started=clock();
        try{
          const out=await callOne(id,system,prompt);
          failures=0;cooldownUntil=0;
          last={called:true,ok:true,at:new Date(clock()).toISOString(),model:out.routedModel,requestedModel:id,text:clip(out.text,1600),freeOnly:true,optional:true,blocksJev:false,attempts:errors.length+1};
          return last;
        }catch(e){
          const msg=clip(e?.message||e,300);const c=classifyProviderError(msg,e?.status);
          const p=modelState(id);const modelFailures=p.failures+1;
          let until=clock()+Math.min(1800000,30000*2**Math.min(modelFailures-1,6));
          const reset=Number(e?.payload?.error?.metadata?.headers?.['X-RateLimit-Reset']);
          const retry=Number(e?.headers?.get?.('retry-after'));
          if(c.httpStatus===429)until=Math.max(until,Number.isFinite(reset)?Math.min(reset,clock()+86400000):0,retry>0?clock()+Math.min(retry,86400)*1000:0);
          mark(id,{ok:false,error:msg,errorClass:c.class,httpStatus:c.httpStatus,latencyMs:clock()-started,cooldown:until});
          errors.push({model:id,error:msg,errorClass:c.class,httpStatus:c.httpStatus});
          // 429 is commonly key/free-tier level. Do not spray the same key across
          // explicit free endpoints after a quota response.
          if(c.httpStatus===429){cooldownUntil=Math.max(cooldownUntil,until);break;}
        }
      }
      failures++;
      cooldownUntil=Math.max(cooldownUntil,clock()+Math.min(1800000,30000*2**Math.min(failures-1,6)));
      last={called:true,ok:false,at:new Date(clock()).toISOString(),model,reason:'OPENROUTER_FREE_WORKER_UNAVAILABLE',optional:true,blocksJev:false,cooldownUntil,detail:errors.map(x=>`${x.model}:${x.errorClass}${x.httpStatus?' HTTP '+x.httpStatus:''}`).join(' | ').slice(0,500),freeOnly:true,errors};
      return last;
    }finally{busy=false;}
  }

  function status(){
    return {configured,model,models:freeModels,freeOnly:true,optional:true,blocksJev:false,failures,cooldownUntil,busy,last:{...last},perModel:freeModels.map(id=>({model:id,...modelState(id),status:modelState(id).successes>0&&!blocked(id)?'healthy':blocked(id)?'cooldown':modelState(id).attempts>0?'failed':'untested'}))};
  }
  return {review,status};
}

module.exports={createOpenRouterFreeWorker};
