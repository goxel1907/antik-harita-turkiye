'use strict';

function clip(v,n=800){return String(v??'').replace(/\s+/g,' ').trim().slice(0,n);}

function createOpenRouterFreeWorker({
  apiKey='',
  fetchImpl=globalThis.fetch,
  clock=()=>Date.now(),
  timeoutMs=15000,
  model='openrouter/free'
}={}){
  const key=String(apiKey||'').trim();
  const configured=key.startsWith('sk-or-v1-')&&typeof fetchImpl==='function';
  let failures=0,cooldownUntil=0,busy=false;
  model='openrouter/free'; // Never permit a paid-model override.
  let last={called:false,ok:false,at:null,model,reason:configured?'NOT_CALLED':'OPENROUTER_NOT_CONFIGURED'};

  async function review({system='',prompt=''}={}){
    if(!configured){
      last={called:false,ok:false,at:new Date(clock()).toISOString(),model,reason:'OPENROUTER_NOT_CONFIGURED'};
      return last;
    }
    if(busy||clock()<cooldownUntil)return {called:false,ok:false,optional:true,blocksJev:false,freeOnly:true,model,reason:busy?'OPTIONAL_WORKER_BUSY':'OPTIONAL_WORKER_COOLDOWN',cooldownUntil};
    busy=true;
    const body={
      model,
      messages:[
        {role:'system',content:String(system||'')},
        {role:'user',content:String(prompt||'')}
      ],
      temperature:0,
      max_tokens:220
    };
    try{
      const r=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{
        method:'POST',
        headers:{
          authorization:'Bearer '+key,
          'content-type':'application/json',
          'HTTP-Referer':'https://brainhub.local',
          'X-Title':'BrainHub Plan Worker'
        },
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(Math.max(5000,Math.min(30000,Number(timeoutMs)||15000)))
      });
      const raw=await r.text();
      let j={};try{j=raw?JSON.parse(raw):{};}catch{}
      const text=String(j?.choices?.[0]?.message?.content||j?.output_text||'').trim();
      if(!r.ok||!text){
        const reset=Number(j?.error?.metadata?.headers?.['X-RateLimit-Reset']);
        const retry=Number(r.headers?.get?.('retry-after'));
        if(r.status===429)cooldownUntil=Math.max(cooldownUntil,Number.isFinite(reset)?Math.min(reset,clock()+86400000):0,retry>0?clock()+Math.min(retry,86400)*1000:0);
        throw new Error('HTTP '+r.status+' '+clip(raw,300));
      }
      failures=0;cooldownUntil=0;
      const routedModel=String(j?.model||model);
      last={called:true,ok:true,at:new Date(clock()).toISOString(),model:routedModel,text:clip(text,1600),freeOnly:true};
      return last;
    }catch(e){
      failures++;cooldownUntil=Math.max(cooldownUntil,clock()+Math.min(1800000,30000*2**Math.min(failures-1,6)));
      last={called:true,ok:false,at:new Date(clock()).toISOString(),model,reason:'OPENROUTER_FREE_WORKER_UNAVAILABLE',optional:true,blocksJev:false,cooldownUntil,detail:clip(e?.message||e,300),freeOnly:true};
      return last;
    }finally{busy=false;}
  }

  function status(){
    return {configured,model,freeOnly:true,optional:true,blocksJev:false,failures,cooldownUntil,busy,last:{...last}};
  }

  return {review,status};
}

module.exports={createOpenRouterFreeWorker};
