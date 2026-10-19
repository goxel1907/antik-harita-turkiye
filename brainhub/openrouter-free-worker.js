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
  let last={called:false,ok:false,at:null,model,reason:configured?'NOT_CALLED':'OPENROUTER_NOT_CONFIGURED'};

  async function review({system='',prompt=''}={}){
    if(!configured){
      last={called:false,ok:false,at:new Date(clock()).toISOString(),model,reason:'OPENROUTER_NOT_CONFIGURED'};
      return last;
    }
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
      if(!r.ok||!text)throw new Error('HTTP '+r.status+' '+clip(raw,300));
      const routedModel=String(j?.model||model);
      last={called:true,ok:true,at:new Date(clock()).toISOString(),model:routedModel,text:clip(text,1600),freeOnly:true};
      return last;
    }catch(e){
      last={called:true,ok:false,at:new Date(clock()).toISOString(),model,reason:'OPENROUTER_FREE_WORKER_UNAVAILABLE',detail:clip(e?.message||e,300),freeOnly:true};
      return last;
    }
  }

  function status(){
    return {configured,model,freeOnly:true,last:{...last}};
  }

  return {review,status};
}

module.exports={createOpenRouterFreeWorker};
