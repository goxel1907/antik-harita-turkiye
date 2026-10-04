'use strict';

const OPENROUTER_FREE_BASELINE = Object.freeze([
  // Bootstrap only. A successful live catalog replaces these routes; a name
  // or zero price is not proof of trading expertise or successful inference.
  'openrouter/free',
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-26b-a4b-it:free',
  'qwen/qwen3.8-27b:free'
]);

const NINEROUTER_OPENCODE_BASELINE = Object.freeze([
  'oc/muse-spark-1.2-contributor-free',
  'oc/muse-spark-1.3-contributor-free',
  'oc/big-pickle',
  'oc/mimo-v2.5-free',
  'oc/ling-3.0-flash-fin-free',
  'oc/nemotron-3-ultra-free',
  'oc/nemotron-3.5-lightning-free'
]);

function unique(xs){ return [...new Set((xs||[]).map(x=>String(x||'').trim()).filter(Boolean))]; }
function isOpenRouterFreeId(id){
  const z=String(id||'').trim();
  return z==='openrouter/free'||/:free$/i.test(z);
}
function is9RouterOpenCodeFreeId(id){
  const z=String(id||'').trim();
  return /^oc\//i.test(z)&&(/(?:[-:]free)$/i.test(z)||NINEROUTER_OPENCODE_BASELINE.includes(z));
}
function select9RouterFreeModels(discovery,configured=NINEROUTER_OPENCODE_BASELINE){
  // An authoritative empty catalog means the provider is disconnected, not
  // permission to retry a stale bootstrap pool. Failed discovery retains the
  // last successful catalog, including an empty one.
  const discovered=discovery?.lastSuccessAt!==null&&discovery?.lastSuccessAt!==undefined;
  return unique(discovered?discovery.models:configured).filter(is9RouterOpenCodeFreeId);
}
function normalizeModelPayload(payload){
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.models)?payload.models:[];
  return unique(rows.map(x=>typeof x==='string'?x:(x?.id||x?.model||x?.name||'')));
}
// A free suffix alone is insufficient when a catalog contains stale or priced entries.
function freeCatalogModels(payload){
  const rows=Array.isArray(payload?.data)?payload.data:[];
  return unique(rows.filter(x=>isOpenRouterFreeId(x?.id)&&x.pricing&&x.pricing.prompt!==undefined&&x.pricing.completion!==undefined&&
    Object.values(x.pricing).every(v=>v!==null&&v!==''&&Number(v)===0)&&
    (!Array.isArray(x.architecture?.output_modalities)||x.architecture.output_modalities.includes('text'))).map(x=>x.id));
}
function providerGroup(model){
  const z=String(model||'').toLowerCase();
  if(z.startsWith('oc/'))return '9ROUTER_OPENCODE_FREE';
  if(z.startsWith('kr/'))return '9ROUTER_KIRO_QUOTA';
  if(z.startsWith('local/'))return 'LOCAL_VISION';
  if(z==='openrouter/free'||z.endsWith(':free'))return 'OPENROUTER_FREE';
  return 'OTHER';
}
function classifyProviderError(error,statusCode=null){
  const msg=String(error||'');
  const code=Number(statusCode)||Number((msg.match(/\bHTTP\s+(\d{3})\b/i)||[])[1])||null;
  if(code===401||code===403)return {class:'AUTH',httpStatus:code};
  if(code===404||/no endpoints found|model.*not found|paid.only/i.test(msg))return {class:'MODEL_UNAVAILABLE',httpStatus:code};
  if(/RESPONSE_TRUNCATED|RESPONSE_SCHEMA_INVALID/.test(msg))return {class:'INVALID_RESPONSE',httpStatus:code};
  if(code===429)return {class:'RATE_LIMIT',httpStatus:code};
  if(code===502||code===503||code===504||/overload|temporar(?:ily)? unavailable|capacity/i.test(msg))return {class:'OVERLOADED',httpStatus:code};
  if(code===400&&/upstream|endpoint unavailable|provider/i.test(msg))return {class:'UPSTREAM_UNAVAILABLE',httpStatus:code};
  if(/timeout|timed out|aborted/i.test(msg))return {class:'TIMEOUT',httpStatus:code};
  if(/ECONNREFUSED|fetch failed|connect/i.test(msg))return {class:'CONNECTION',httpStatus:code};
  return {class:'FAILED',httpStatus:code};
}

async function discoverOpenAIModels({baseUrl,key='',fetchImpl=globalThis.fetch,timeoutMs=3000}={}){
  if(typeof fetchImpl!=='function')return {ok:false,models:[],error:'FETCH_UNAVAILABLE'};
  const base=String(baseUrl||'').trim().replace(/\/+$/,'');
  if(!base)return {ok:false,models:[],error:'BASE_URL_MISSING'};
  const url=base+'/models';
  const started=Date.now();
  try{
    const r=await fetchImpl(url,{method:'GET',headers:key?{authorization:'Bearer '+key}:{},signal:AbortSignal.timeout(Math.max(1000,Math.min(10000,Number(timeoutMs)||3000)))});
    const raw=await r.text();let j=null;try{j=raw?JSON.parse(raw):null;}catch{}
    if(!r.ok)return {ok:false,models:[],status:r.status,error:('HTTP '+r.status+' '+raw).slice(0,400),durationMs:Date.now()-started};
    if(!Array.isArray(j)&&!Array.isArray(j?.data)&&!Array.isArray(j?.models))return {ok:false,models:[],status:r.status,error:'MODEL_CATALOG_SCHEMA_INVALID',durationMs:Date.now()-started};
    return {ok:true,models:normalizeModelPayload(j),status:r.status,durationMs:Date.now()-started};
  }catch(e){return {ok:false,models:[],error:String(e?.message||e).slice(0,400),durationMs:Date.now()-started};}
}

module.exports={
  OPENROUTER_FREE_BASELINE,
  NINEROUTER_OPENCODE_BASELINE,
  unique,isOpenRouterFreeId,is9RouterOpenCodeFreeId,select9RouterFreeModels,normalizeModelPayload,freeCatalogModels,providerGroup,classifyProviderError,discoverOpenAIModels
};
