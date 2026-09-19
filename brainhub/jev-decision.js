const fs=require('fs');
const path=require('path');

const DEFAULTS={
  enabled:false,
  model:'typesafe/jev-1.13',
  decisionsUrl:'https://openrouter.ai/api/alpha/decisions',
  keyUrl:'https://openrouter.ai/api/v1/key',
  mode:'ADVISORY_VETO_ONLY',
  dailyCapUsd:0.25,
  timeoutMs:30000
};

function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
  catch{return {};}
}
function normalizeConfig(root){
  const raw=readJson(path.join(root,'config','jev.json'));
  const model=String(raw.model||DEFAULTS.model).trim();
  const decisionsUrl=String(raw.decisionsUrl||DEFAULTS.decisionsUrl).trim();
  const keyUrl=String(raw.keyUrl||DEFAULTS.keyUrl).trim();
  const timeoutMs=Math.max(5000,Math.min(120000,Number(raw.timeoutMs||DEFAULTS.timeoutMs)));
  const dailyCapUsd=Math.max(0.01,Math.min(100,Number(raw.dailyCapUsd||DEFAULTS.dailyCapUsd)));
  return {
    enabled:raw.enabled===true,
    model,
    decisionsUrl,
    keyUrl,
    mode:'ADVISORY_VETO_ONLY',
    dailyCapUsd,
    timeoutMs
  };
}
function sanitizedKeyMetadata(data){
  const d=data&&typeof data==='object'?data:{};
  const src=d.data&&typeof d.data==='object'?d.data:d;
  const keep=['label','limit','limit_remaining','usage','usage_daily','usage_weekly','usage_monthly','is_free_tier','rate_limit'];
  const out={};
  for(const k of keep)if(Object.prototype.hasOwnProperty.call(src,k))out[k]=src[k];
  return out;
}
async function fetchJson(fetchImpl,url,options,timeoutMs){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetchImpl(url,{...options,signal:controller.signal});
    const raw=await r.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch{data={raw:raw.slice(0,500)};}
    return {ok:r.ok,status:r.status,data};
  }finally{clearTimeout(timer);}
}
function createJevClient({root,apiKey='',fetchImpl=globalThis.fetch}={}){
  if(!root)throw new Error('root required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation required');
  const cfg=normalizeConfig(root);
  const key=String(apiKey||'').trim();
  const configured=cfg.enabled&&key.startsWith('sk-or-v1-');

  function localStatus(){
    return {
      ok:true,
      configured,
      enabled:cfg.enabled,
      keyLoaded:!!key,
      model:cfg.model,
      mode:cfg.mode,
      dailyCapUsd:cfg.dailyCapUsd,
      decisionsApi:'OPENROUTER_ALPHA_DECISIONS',
      paidFallbackEnabled:false
    };
  }
  async function remoteStatus(){
    if(!configured)return {...localStatus(),reachable:false,reason:'OPENROUTER_NOT_CONFIGURED'};
    try{
      const r=await fetchJson(fetchImpl,cfg.keyUrl,{method:'GET',headers:{authorization:'Bearer '+key,'content-type':'application/json'}},cfg.timeoutMs);
      if(!r.ok)return {...localStatus(),reachable:false,httpStatus:r.status,reason:'OPENROUTER_KEY_CHECK_FAILED'};
      return {...localStatus(),reachable:true,keyMetadata:sanitizedKeyMetadata(r.data)};
    }catch(e){
      return {...localStatus(),reachable:false,reason:'OPENROUTER_KEY_CHECK_ERROR',detail:String(e?.message||e).slice(0,240)};
    }
  }
  async function probe(){
    if(!configured)return {...localStatus(),ok:false,reason:'OPENROUTER_NOT_CONFIGURED'};
    const body={
      model:cfg.model,
      state:{
        description:'Synthetic BrainHub connectivity probe. This is not market data and must not authorize an order.',
        record:{kind:'BRAINHUB_JEV_PROBE',synthetic:true,execution:'ADVISORY_ONLY'}
      },
      questions:{
        synthetic_probe:{
          type:'noul',
          instructions:'Is this record explicitly marked as a synthetic BrainHub connectivity probe?',
          criteria:{
            true:'The record explicitly says it is a synthetic BrainHub connectivity probe.',
            false:'The record is not explicitly marked as a synthetic BrainHub connectivity probe.'
          }
        }
      }
    };
    const started=Date.now();
    try{
      const r=await fetchJson(fetchImpl,cfg.decisionsUrl,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)},cfg.timeoutMs);
      if(!r.ok)return {...localStatus(),ok:false,reason:'JEV_PROBE_HTTP_ERROR',httpStatus:r.status,durationMs:Date.now()-started,detail:JSON.stringify(r.data).slice(0,500)};
      const answers=r.data&&typeof r.data==='object'?r.data.answers:null;
      const answer=answers&&typeof answers==='object'?answers.synthetic_probe:null;
      if(!answer)return {...localStatus(),ok:false,reason:'JEV_PROBE_SCHEMA_MISMATCH',durationMs:Date.now()-started,responseKeys:Object.keys(r.data||{}).slice(0,20)};
      const usage=r.data?.usage&&typeof r.data.usage==='object'?r.data.usage:null;
      return {
        ...localStatus(),
        ok:true,
        reachable:true,
        probe:'PASS',
        durationMs:Date.now()-started,
        answerShape:Object.keys(answer||{}).slice(0,12),
        usage:usage?{
          prompt_tokens:usage.prompt_tokens??usage.input_tokens??null,
          completion_tokens:usage.completion_tokens??usage.output_tokens??null,
          cost:usage.cost??null
        }:null
      };
    }catch(e){
      return {...localStatus(),ok:false,reason:'JEV_PROBE_ERROR',durationMs:Date.now()-started,detail:String(e?.message||e).slice(0,300)};
    }
  }
  return {config:cfg,localStatus,remoteStatus,probe};
}
module.exports={DEFAULTS,normalizeConfig,sanitizedKeyMetadata,createJevClient};
