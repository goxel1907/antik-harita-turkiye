const fs=require('fs');
const path=require('path');

const DEFAULTS={
  enabled:false,
  model:'typesafe/jev-1.13',
  decisionsUrl:'https://openrouter.ai/api/alpha/decisions',
  keyUrl:'https://openrouter.ai/api/v1/key',
  mode:'ADVISORY_VETO_ONLY',
  dailyCapUsd:0.25,
  timeoutMs:30000,
  maxPayloadChars:24000,
  reservePerCallUsd:0.01
};

const CHECKS = [
  ['structural_veto','structuralVeto','JEV_STRUCTURAL_VETO','Yapısal çelişki', 'BOS/CHoCH, failed breakout, body/wick or candle-pattern evidence contradicts the existing setup.'],
  ['forming_dependency','formingDependency','JEV_FORMING_CONFIRMATION_DEPENDENCY','Açık mum teyit yerine kullanılmış','The plan needs a forming candle as confirmation rather than context.'],
  ['data_quality_insufficient','dataQualityInsufficient','JEV_DATA_QUALITY_INSUFFICIENT','Veri kalitesi yetersiz','Critical timestamps, closed candles or evidence are missing/stale; auxiliary unavailable data alone is scoreless.'],
  ['direction_conflict','directionConflict','JEV_DIRECTION_CONFLICT','Yön çelişkisi','The proposed LONG/SHORT direction contradicts supplied structure or global BTC/ETH context.'],
  ['symbol_package_integrity','symbolPackageIntegrity','JEV_PACKAGE_INTEGRITY','Coin/paket uyuşmazlığı','Candidate, context and chart-evidence symbols differ, or the nine-frame package is incomplete.'],
  ['origin_owner_continuity','originOwnerContinuity','JEV_CONTINUITY_CONFLICT','Başlangıç-sahip sürekliliği bozuk','The stated origin-to-owner handoff lacks supplied continuity evidence or widens invalidation risk.'],
  ['tf_conflict','tfConflict','JEV_TF_CONFLICT','Zaman dilimleri çelişiyor','The setup ignores a material timeframe veto or counts synthetic 45m as an independent confirming vote. Timeframes are roles, not majority votes.'],
  ['smc_liquidity_conflict','smcLiquidityConflict','JEV_SMC_LIQUIDITY_CONFLICT','SMC/likidite çelişkisi','Supplied FVG, OB/breaker, BSL/SSL, sweep/reclaim or invalidation evidence contradicts the setup; do not infer hidden market-maker intent.'],
  ['microstructure_reliability','microstructureReliability','JEV_MICROSTRUCTURE_UNRELIABLE','Mikro yapı kanıtı yanlış kullanılmış','The plan treats stale/partial depth, sampled CVD, proxy OFI or observed liquidations as reliable proof; correlated measures must stay one soft family.'],
  ['closed_candle_confirmation','closedCandleConfirmation','JEV_CLOSED_CONFIRMATION_MISSING','Kapanmış mum teyidi eksik','Required closed-candle breakout/reclaim/body-wick confirmation is absent in the supplied evidence.'],
  ['visual_data_consistency','visualDataConsistency','JEV_VISUAL_DATA_CONFLICT','Grafik-veri çelişkisi','Text extracted from the actual charts conflicts with deterministic candle/price evidence. You cannot see PNGs; missing visual evidence must not be invented.'],
  ['wait_required','waitRequired','JEV_WAIT_REQUIRED','Bekleme koşulu tamamlanmamış','A stated setup-specific wait/reclaim/invalidation condition remains unresolved, so QUALIFIED should wait.']
];
const FRAMES=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
function decisionQuestions(){
  const questions=Object.fromEntries(CHECKS.map(([id,,,,evidence])=>[id,{type:'noul',instructions:'Does this veto condition apply? '+evidence,criteria:{true:evidence,false:'Supplied evidence does not establish this veto condition.'}}]));
  for(const tf of FRAMES)questions['conflict_'+tf]={type:'noul',instructions:'Does '+tf+' contain a material setup contradiction requiring a wait? Use supplied evidence only; 45m is synthetic.',criteria:{true:'Explicit evidence in this timeframe contradicts the proposed setup.',false:'No material contradiction is established in this timeframe.'}};
  return questions;
}

function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
  catch{return {};}
}
function writeJsonAtomic(file,obj){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(obj,null,2),'utf8');
  fs.renameSync(tmp,file);
}
function utcDay(now=Date.now()){return new Date(now).toISOString().slice(0,10);}
function normalizeConfig(root){
  const raw=readJson(path.join(root,'config','jev.json'));
  const model=String(raw.model||DEFAULTS.model).trim();
  const decisionsUrl=String(raw.decisionsUrl||DEFAULTS.decisionsUrl).trim();
  const keyUrl=String(raw.keyUrl||DEFAULTS.keyUrl).trim();
  const timeoutMs=Math.max(5000,Math.min(120000,Number(raw.timeoutMs||DEFAULTS.timeoutMs)));
  const dailyCapUsd=Math.max(0.01,Math.min(100,Number(raw.dailyCapUsd||DEFAULTS.dailyCapUsd)));
  const maxPayloadChars=Math.max(4000,Math.min(64000,Number(raw.maxPayloadChars||DEFAULTS.maxPayloadChars)));
  const reservePerCallUsd=Math.max(0.001,Math.min(0.05,Number(raw.reservePerCallUsd||DEFAULTS.reservePerCallUsd)));
  return {enabled:raw.enabled===true,model,decisionsUrl,keyUrl,mode:'ADVISORY_VETO_ONLY',dailyCapUsd,timeoutMs,maxPayloadChars,reservePerCallUsd};
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
function probabilityValue(value){
  if(value===null||value===undefined)return null;
  if(typeof value==='string'&&!value.trim())return null;
  if(typeof value==='boolean')return null;
  if(typeof value!=='number'&&typeof value!=='string')return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0&&n<=1?n:null;
}
function noulProbability(answer){
  const direct=probabilityValue(answer);
  if(direct!==null)return direct;
  if(!answer||typeof answer!=='object'||Array.isArray(answer))return null;
  for(const k of ['noul','probability','yes','true']){
    const n=probabilityValue(answer[k]);
    if(n!==null)return n;
  }
  return null;
}
function compactDecisionRecord({candidate,plan,unified},maxChars){
  const frames={};
  for(const tf of ['1m','3m','5m','15m','30m','45m','1h','4h','1d']){
    const d=plan?.timeframeDiagnostics?.[tf]||{};
    const f=unified?.frames?.[tf]||{};
    frames[tf]={
      available:f.available===true, asOf:f.asOf||null, summary:String(d.summary||'').slice(0,240),
      candle:f.candle||null, patterns:f.patterns||[], smcContext:f.smcContext||null, liquidity:f.liquidity||null,
      role:d.role||null,
      why:String(d.why||'').slice(0,240),
      waitFor:String(d.waitFor||'').slice(0,180),
      formingContext:String(d.formingContext||'').slice(0,180),
      risk:String(d.risk||'').slice(0,180),
      fresh:f.fresh??null,
      trend:f.trend??null,
      breakOfStructure:f.breakOfStructure??null,
      opportunity:f.opportunity?{
        state:f.opportunity.state??null,
        preferredSide:f.opportunity.preferredSide??null,
        originEligible:f.opportunity.originEligible??null,
        ownerEligible:f.opportunity.ownerEligible??null
      }:null,
      breakoutExecution:f.breakoutExecution?{
        status:f.breakoutExecution.status??null,
        allowed:f.breakoutExecution.allowed??null
      }:null
    };
  }
  const record={
    symbol:String(candidate?.symbol||unified?.symbol||'').slice(0,32),
    candidateSide:String(candidate?.side||'').toUpperCase()||null,
    contextSymbol:unified?.symbol||null, generatedAt:unified?.generatedAt||null,
    global:unified?.global||null, liquidationContext:unified?.liquidationContext||null,
    plan:{
      status:plan?.status||null,
      side:plan?.side||null,
      confidence:plan?.confidence??null,
      originTF:plan?.originTF||null,
      ownerTF:plan?.ownerTF||null,
      setup:String(plan?.setup||'').slice(0,180),
      execPath:String(plan?.execPath||'').slice(0,180),
      why:String(plan?.why||'').slice(0,500),
      riskNote:String(plan?.riskNote||'').slice(0,360),
      waitFor:String(plan?.waitFor||'').slice(0,360),
      formingContext:String(plan?.formingContext||'').slice(0,360),
      supportTFs:Array.isArray(plan?.supportTFs)?plan.supportTFs:[],
      vetoTFs:Array.isArray(plan?.vetoTFs)?plan.vetoTFs:[],
      visionSummary:String(plan?.visionSummary||'').slice(0,600)
    },
    frames,
    dataQuality:unified?.dataQuality||null,
    opportunityPaths:unified?.opportunityPaths||null,
    microstructure:unified?.microstructure?.available?{
      available:true,
      sourceQuality:unified.microstructure.sourceQuality||null,
      spreadBps:unified.microstructure.spreadBps??null,
      depth20Imbalance:unified.microstructure.depth20Imbalance??null,
      cvdSampleQuote:unified.microstructure.cvdSampleQuote??null, cvdSource:unified.microstructure.cvdSource||null,
      ofiProxyQuote:unified.microstructure.ofiProxyQuote??null, trueOfiClaimed:false,
      streaming:unified.microstructure.streaming?{
        available:Boolean(unified.microstructure.streaming.available),
        connected:Boolean(unified.microstructure.streaming.connected),
        ageMs:unified.microstructure.streaming.ageMs??null
      }:null
    }:{available:false},
    policy:unified?.policy||null,
    execution:'ADVISORY_ONLY'
  };
  const raw=JSON.stringify(record);
  if(raw.length>maxChars)throw new Error('JEV_EVIDENCE_PAYLOAD_TOO_LARGE');
  return raw;
}
function usageCost(data,reserve,body){
  const u=data?.usage&&typeof data.usage==='object'?data.usage:null;
  const direct=u?.cost==null?NaN:Number(u.cost);
  if(Number.isFinite(direct)&&direct>=0)return direct;
  const tokens=Number(u?.prompt_tokens??u?.input_tokens);
  if(Number.isFinite(tokens)&&tokens>=0)return tokens*0.042/1_000_000;
  const chars=JSON.stringify(body||{}).length;
  const conservativeTokens=Math.max(1,Math.ceil(chars/3));
  return Math.min(reserve,conservativeTokens*0.042/1_000_000*1.5);
}

function createJevClient({root,apiKey='',fetchImpl=globalThis.fetch,clock=()=>Date.now()}={}){
  if(!root)throw new Error('root required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation required');
  const cfg=normalizeConfig(root);
  const key=String(apiKey||'').trim();
  const configured=cfg.enabled&&key.startsWith('sk-or-v1-');
  const usageFile=path.join(root,'data','jev-usage.json');

  function readUsage(){
    const day=utcDay(clock());
    let raw={};
    if(fs.existsSync(usageFile)){
      try{raw=JSON.parse(fs.readFileSync(usageFile,'utf8'));}
      catch{throw new Error('JEV_BUDGET_FILE_INVALID');}
      if(!raw.day||!Number.isFinite(raw.spentUsd)||raw.spentUsd<0)throw new Error('JEV_BUDGET_FILE_INVALID');
    }
    if(raw.day!==day)return {day,spentUsd:0,calls:0,lastAt:null};
    return {day,spentUsd:Math.max(0,Number(raw.spentUsd)||0),calls:Math.max(0,Number(raw.calls)||0),lastAt:raw.lastAt||null};
  }
  function writeUsage(u){writeJsonAtomic(usageFile,u);}
  function budgetStatus(){
    const u=readUsage();
    return {...u,dailyCapUsd:cfg.dailyCapUsd,remainingUsd:Math.max(0,cfg.dailyCapUsd-u.spentUsd),reservePerCallUsd:cfg.reservePerCallUsd};
  }
  function reserveBudget(){
    const u=readUsage();
    if(u.spentUsd+cfg.reservePerCallUsd>cfg.dailyCapUsd+1e-12)return {ok:false,usage:u};
    const reserved={...u,spentUsd:u.spentUsd+cfg.reservePerCallUsd,calls:u.calls+1,lastAt:new Date(clock()).toISOString()};
    writeUsage(reserved);
    return {ok:true,usage:reserved,reservedUsd:cfg.reservePerCallUsd};
  }
  function settleBudget(reservation,actualUsd){
    if(!reservation?.ok)return readUsage();
    const u=readUsage();
    if(u.day!==reservation.usage.day)return u;
    const actual=Math.max(0,Number(actualUsd)||0);
    const settled={...u,spentUsd:Math.max(0,u.spentUsd-reservation.reservedUsd+actual),lastAt:new Date(clock()).toISOString()};
    writeUsage(settled);
    return settled;
  }
  function localStatus(){
    return {
      ok:true,configured,enabled:cfg.enabled,keyLoaded:!!key,model:cfg.model,mode:cfg.mode,
      dailyCapUsd:cfg.dailyCapUsd,decisionsApi:'OPENROUTER_ALPHA_DECISIONS',
      paidFallbackEnabled:false,budget:budgetStatus()
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
  async function decisions(body,{reserve=true}={}){
    if(!configured)return {ok:false,configured:false,required:false,reason:'OPENROUTER_NOT_CONFIGURED'};
    const reservation=reserve?reserveBudget():{ok:true,reservedUsd:0};
    if(!reservation.ok)return {ok:false,configured:true,required:true,reason:'JEV_DAILY_BUDGET_EXHAUSTED',budget:budgetStatus()};
    const started=clock();
    try{
      const r=await fetchJson(fetchImpl,cfg.decisionsUrl,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)},cfg.timeoutMs);
      if(!r.ok){
        if(reserve)settleBudget(reservation,cfg.reservePerCallUsd);
        return {ok:false,configured:true,required:true,reason:'JEV_HTTP_ERROR',httpStatus:r.status,durationMs:clock()-started,detail:JSON.stringify(r.data).slice(0,500),budget:budgetStatus()};
      }
      const cost=reserve?usageCost(r.data,cfg.reservePerCallUsd,body):0;
      if(reserve)settleBudget(reservation,cost);
      return {ok:true,configured:true,required:true,data:r.data,durationMs:clock()-started,costUsd:cost,budget:budgetStatus()};
    }catch(e){
      if(reserve)settleBudget(reservation,cfg.reservePerCallUsd);
      return {ok:false,configured:true,required:true,reason:'JEV_REQUEST_ERROR',durationMs:clock()-started,detail:String(e?.message||e).slice(0,300),budget:budgetStatus()};
    }
  }
  async function probe(){
    const body={
      model:cfg.model,
      state:{description:'Synthetic BrainHub connectivity probe. This is not market data and must not authorize an order.',record:{kind:'BRAINHUB_JEV_PROBE',synthetic:true,execution:'ADVISORY_ONLY'}},
      questions:{synthetic_probe:{type:'noul',instructions:'Is this record explicitly marked as a synthetic BrainHub connectivity probe?',criteria:{true:'The record explicitly says it is a synthetic BrainHub connectivity probe.',false:'The record is not explicitly marked as a synthetic BrainHub connectivity probe.'}}}
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...localStatus(),...out};
    const answer=out.data?.answers?.synthetic_probe;
    if(!answer)return {...localStatus(),ok:false,configured:true,required:true,reason:'JEV_PROBE_SCHEMA_MISMATCH',durationMs:out.durationMs,budget:out.budget};
    return {...localStatus(),ok:true,reachable:true,probe:'PASS',durationMs:out.durationMs,answerShape:Object.keys(answer||{}).slice(0,12),usage:{cost:out.costUsd},budget:out.budget};
  }
  async function judge({candidate,plan,unified}={}){
    if(!configured)return {ok:!cfg.enabled,configured:false,required:cfg.enabled,called:false,veto:cfg.enabled,reason:cfg.enabled?'JEV_KEY_UNAVAILABLE':'OPENROUTER_NOT_CONFIGURED'};
    if(String(plan?.status||'').toUpperCase()!=='QUALIFIED')return {ok:true,configured:true,required:true,called:false,veto:false,reason:'JEV_NOT_NEEDED_FOR_NON_QUALIFIED',budget:budgetStatus()};
    let record;
    try{record=compactDecisionRecord({candidate,plan,unified},cfg.maxPayloadChars);}
    catch(e){return {ok:false,configured:true,required:true,called:false,veto:true,reason:e.message,budget:budgetStatus()};}
    const body={
      model:cfg.model,
      state:{
        description:'One compact BrainHub crypto-futures advisory plan. Judge only whether existing QUALIFIED status must be vetoed or held for review. Never create a trade, entry, stop, target, leverage, size, or order.',
        record
      },
      questions:decisionQuestions()
    };
    const out=await decisions(body,{reserve:true});
    if(!out.ok)return {...out,called:true,veto:true,mode:cfg.mode};
    const answers=out.data?.answers&&typeof out.data.answers==='object'?out.data.answers:{};
    const probabilities=Object.fromEntries(CHECKS.map(([id,key])=>[key,noulProbability(answers[id])]));
    const timeframeConflicts=Object.fromEntries(FRAMES.map(tf=>[tf,noulProbability(answers['conflict_'+tf])]));
    const missing=Object.entries({...probabilities,...timeframeConflicts}).filter(([,v])=>v===null).map(([k])=>k);
    if(missing.length)return {ok:false,configured:true,required:true,called:true,veto:true,reason:'JEV_DECISION_SCHEMA_MISMATCH',missing,probabilities,timeframeConflicts,budget:out.budget,costUsd:out.costUsd,mode:cfg.mode};
    const failed=CHECKS.filter(([,key])=>probabilities[key]>=(key==='formingDependency'?0.70:0.65));
    const conflictingTFs=FRAMES.filter(tf=>timeframeConflicts[tf]>=0.65);
    const vetoReasons=failed.map(([, ,reason])=>reason);
    if(conflictingTFs.length&&!vetoReasons.includes('JEV_TF_CONFLICT'))vetoReasons.push('JEV_TF_CONFLICT');
    const summaryTr=(vetoReasons.length?'Jev bekletiyor: '+failed.map(x=>x[3]).join('; '):'Jev ek veto bulmadı; yürütme ve risk kontrolleri ayrıca gereklidir.')+
      (conflictingTFs.length?' Çelişen TF: '+conflictingTFs.join(', ')+'.':'')+
      (vetoReasons.length?' Beklenen koşul (mevcut plan): '+String(plan.waitFor||'Güncel kanıtlarla yeniden değerlendirme'):'');
    return {ok:true,configured:true,required:true,called:true,veto:vetoReasons.length>0,vetoReasons,probabilities,timeframeConflicts,conflictingTFs,summaryTr,model:cfg.model,mode:cfg.mode,durationMs:out.durationMs,costUsd:out.costUsd,budget:out.budget};
  }
  return {config:cfg,localStatus,remoteStatus,probe,judge,budgetStatus};
}
module.exports={CHECKS,decisionQuestions,DEFAULTS,normalizeConfig,sanitizedKeyMetadata,noulProbability,compactDecisionRecord,createJevClient};
