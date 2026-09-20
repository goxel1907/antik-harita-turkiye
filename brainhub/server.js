const http=require('http');
const fs=require('fs');
const path=require('path');
const nodeCrypto=require('crypto');
const scanner=require('./scanner');
const market=require('./market');
const pipeline=require('./pipeline');
const {openStore}=require('./store');
const {createLiveController}=require('./live-controller');
const {createJevClient}=require('./jev-decision');

const ROOT=process.env.BRAINHUB_ROOT||path.resolve(__dirname,'..');
const CFG=path.join(ROOT,'config','models.json');
const LOG=path.join(ROOT,'logs','brainpub.log');
const cfg=JSON.parse(fs.readFileSync(CFG,'utf8').replace(/^\uFEFF/,''));
const KEY=(process.env.BRAINHUB_ROUTER_KEY||'').trim();
const HOST=process.env.BRAINHUB_HOST||'127.0.0.1';
const PORT=Number(process.env.BRAINHUB_PORT||8787);
const CLIENT_TOKEN=(process.env.BRAINHUB_CLIENT_TOKEN||'').trim();
const OPENROUTER_API_KEY=(process.env.BRAINHUB_OPENROUTER_API_KEY||'').trim();
const OPENROUTER_MANAGEMENT_KEY=(process.env.BRAINHUB_OPENROUTER_MANAGEMENT_KEY||'').trim();
const BINANCE_CREDENTIALS={
  apiKey:(process.env.BRAINHUB_BINANCE_API_KEY||'').trim(),
  apiSecret:(process.env.BRAINHUB_BINANCE_API_SECRET||'').trim()
};
const TTL=(Number(cfg.healthCacheSeconds)||600)*1000;
if(!KEY){console.error('BRAINHUB_ROUTER_KEY missing');process.exit(2);}
if(HOST!=='127.0.0.1'&&HOST!=='::1'&&CLIENT_TOKEN.length<32){console.error('BRAINHUB_CLIENT_TOKEN (32+ chars) required for non-loopback binding');process.exit(2);}
const store=openStore(ROOT);
const jev=createJevClient({root:ROOT,apiKey:OPENROUTER_API_KEY,managementKey:OPENROUTER_MANAGEMENT_KEY});
jev.billingStatus({force:true}).catch(()=>{});

fs.mkdirSync(path.dirname(LOG),{recursive:true});
const state=new Map();
const visionState=new Map();
let rr=0;
const ROLE_HINTS={
  DEFAULT:[],
  FAST:['lightning','flash','mimo','spark'],
  SCALP:['lightning','flash','mimo','spark'],
  STRUCTURE:['ultra','pickle','muse','mimo'],
  PATTERN:['ultra','muse','pickle','mimo'],
  MICROSTRUCTURE:['mimo','lightning','ultra','flash'],
  REGIME:['muse','ultra','pickle','mimo'],
  RISK:['ultra','pickle','muse','mimo']
};
function normalizeRole(v){
  const r=String(v||'DEFAULT').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(ROLE_HINTS,r)?r:'DEFAULT';
}
function roleInstruction(role){
  switch(normalizeRole(role)){
    case 'FAST': return 'Role FAST: look for the earliest valid 1m/3m/5m opportunity. Do not wait for 15m unless the requested setup is explicitly the legacy 15m strategy. Never trade on speed alone.';
    case 'SCALP': return 'Role SCALP: evaluate the earliest valid 1m/3m/5m scalp opportunity without waiting for 15m. Require closed-candle structure, valid liquidity/execution context and deterministic risk checks; speed alone is never enough.';
    case 'STRUCTURE': return 'Role STRUCTURE: compare 1m through 1d structure, liquidity, wick behavior and continuity. Timeframes are context, not votes. Synthetic 45m is not an independent confirmation.';
    case 'PATTERN': return 'Role PATTERN: evaluate closed-candle formations and their invalidation. Distinguish FORMING, CONFIRMED, FAILED, INVALIDATED and RECLAIMED states.';
    case 'MICROSTRUCTURE': return 'Role MICROSTRUCTURE: treat depth/CVD/OFI quality labels literally. Do not infer market-maker intent from snapshots or fabricate liquidation clusters.';
    case 'REGIME': return 'Role REGIME: evaluate BTC, ETH, ETH/BTC and market-cap context as regime information, not as an automatic veto or directional vote.';
    case 'RISK': return 'Role RISK: protect structural invalidation, stale-data, RR, duplicate/lease and max-risk rules. Never widen the original stop merely because a higher timeframe is supportive.';
    default: return 'Use only supplied data. Do not invent missing facts and do not place orders.';
  }
}
function rankPool(models,role,rotate=false){
  const unique=[...new Set((models||[]).filter(Boolean))];
  if(rotate&&unique.length){const n=rr++%unique.length;unique.push(...unique.splice(0,n));}
  const hints=ROLE_HINTS[normalizeRole(role)]||[];
  if(!hints.length)return unique;
  return unique.map((model,index)=>{
    const z=model.toLowerCase();
    let rank=999;
    for(let i=0;i<hints.length;i++){if(z.includes(hints[i])){rank=i;break;}}
    return {model,index,rank};
  }).sort((a,b)=>a.rank-b.rank||a.index-b.index).map(x=>x.model);
}
function orderedModels(role='DEFAULT',preferred=''){
  const free=rankPool([...(cfg.opencode||[])],role,true);
  if(preferred&&free.includes(preferred))return [preferred,...free.filter(x=>x!==preferred)];
  return free;
}

function log(s){
  const line=new Date().toISOString()+' '+s;
  console.log(line);
  fs.appendFileSync(LOG,line+'\n');
}
function send(res,code,obj){
  const b=JSON.stringify(obj,null,2);
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(b),'cache-control':'no-store'});
  res.end(b);
}
function sendBuffer(res,code,buffer,type,extra={}){
  res.writeHead(code,{'content-type':type,'content-length':buffer.length,'cache-control':'no-store','x-content-type-options':'nosniff',...extra});
  res.end(buffer);
}
function isLoopback(req){
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}
function authorized(req){
  if(!CLIENT_TOKEN)return isLoopback(req);
  const supplied=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(supplied.length!==CLIENT_TOKEN.length)return false;
  return nodeCrypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(CLIENT_TOKEN));
}
function extract(raw){
  raw=String(raw||'');
  let out='';
  const add=v=>{
    if(typeof v==='string')out+=v;
    else if(Array.isArray(v))for(const x of v){
      if(typeof x==='string')out+=x;
      else if(x&&typeof x.text==='string')out+=x.text;
      else if(x&&typeof x.content==='string')out+=x.content;
    }
  };
  const take=j=>{
    if(!j)return;
    if(Array.isArray(j.choices))for(const c of j.choices||[]){add(c?.delta?.content);add(c?.message?.content);add(c?.text);}
    add(j.output_text);add(j.text);if(j.message)add(j.message.content);
  };
  try{take(JSON.parse(raw));}catch{}
  if(out.trim())return out.trim();
  for(const line of raw.split(/\r?\n/)){
    let d=line.trim();
    if(d.startsWith('data:'))d=d.slice(5).trim();
    if(!d||d==='[DONE]'||(!d.startsWith('{')&&!d.startsWith('[')))continue;
    try{take(JSON.parse(d));}catch{}
  }
  if(out.trim())return out.trim();
  const re=/"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while((m=re.exec(raw))){try{out+=JSON.parse('"'+m[1]+'"');}catch{}}
  return out.trim();
}
function localVisionConfig(){
  const raw=cfg.localVision && typeof cfg.localVision==='object' && !Array.isArray(cfg.localVision) ? cfg.localVision : {};
  const requested=Array.isArray(raw.models)?raw.models:[];
  const models=uniqueModels(requested.map(x=>String(x||'').trim()).filter(x=>/^[A-Za-z0-9._:+-]{1,120}$/.test(x)))
    .map(x=>'local/'+x);
  const candidate=String(raw.baseUrl||'http://127.0.0.1:11434/v1').trim().replace(/\/+$/,'');
  let baseUrl='';
  try{
    const u=new URL(candidate);
    if(u.protocol==='http:'&&['127.0.0.1','localhost','::1'].includes(u.hostname))baseUrl=candidate;
  }catch{}
  const contextSize=Math.max(4096,Math.min(65536,Number(raw.contextSize||32768)));
  const timeoutMs=Math.max(60000,Math.min(600000,Number(raw.timeoutMs||300000)));
  const localOnly=raw.localOnly!==false;
  return {enabled:raw.enabled===true&&!!baseUrl&&models.length>0,baseUrl,models,contextSize,timeoutMs,localOnly};
}
async function callModel(model,messages,timeoutMs=12000,requestOptions={}){
  const local=localVisionConfig();
  const isLocal=String(model||'').startsWith('local/');
  if(isLocal&&(!local.enabled||!local.models.includes(model)))throw new Error('local vision model not enabled');
  const baseUrl=isLocal?local.baseUrl:String(cfg.baseUrl||'').replace(/\/+$/,'');
  const wireModel=isLocal?String(model).slice('local/'.length):model;
  const url=baseUrl+'/chat/completions';
  const headers=isLocal?{'content-type':'application/json'}:{authorization:'Bearer '+KEY,'content-type':'application/json'};
  const request={model:wireModel,messages,stream:false};
  if(isLocal)request.temperature=Number.isFinite(Number(requestOptions.temperature))?Number(requestOptions.temperature):0;
  if(Number.isInteger(Number(requestOptions.maxTokens))&&Number(requestOptions.maxTokens)>0){
    request.max_tokens=Math.max(64,Math.min(8192,Number(requestOptions.maxTokens)));
  }
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.timeout(timeoutMs)});
  const raw=await r.text();
  if(!r.ok)throw new Error('HTTP '+r.status+' '+raw.slice(0,300));
  const text=extract(raw);
  if(!text)throw new Error('empty response');
  state.set(model,{ok:true,at:Date.now(),error:null});
  return {model,text};
}
function recentFailure(map,model){
  const s=map.get(model);
  return !!(s&&s.ok===false&&(Date.now()-s.at)<TTL);
}
function blocked(model){ return recentFailure(state,model); }
function visionBlocked(model){ return recentFailure(visionState,model); }
function visionAvailability(){
  let ccfg={};try{ccfg=readCommitteeConfig();}catch{}
  const models=orderedVisionModels(ccfg,'STRUCTURE',true).map(model=>{
    const s=visionState.get(model);
    const error=String(s?.error||'');
    let reason='NOT_VERIFIED';
    if(s?.ok===true && Date.now()-s.at<TTL) reason='AVAILABLE';
    else if(/MONTHLY_REQUEST_COUNT|reached the limit/i.test(error)) reason='QUOTA_EXHAUSTED';
    else if(/only be used from within OpenCode|FreeTierError/i.test(error)) reason='PROVIDER_RESTRICTED';
    else if(String(model).startsWith('local/')&&/exceeds the available context size|exceed_context_size/i.test(error)) reason='LOCAL_CONTEXT_TOO_SMALL';
    else if(String(model).startsWith('local/')&&/fetch failed|ECONNREFUSED|connect/i.test(error)) reason='LOCAL_UNAVAILABLE';
    else if(/timeout|aborted/i.test(error)) reason='TIMEOUT';
    else if(error) reason='PROVIDER_UNAVAILABLE';
    return {model,reason,lastCheckedAt:s?.at||null};
  });
  const verified=models.filter(x=>x.reason==='AVAILABLE').length;
  const notes=[];
  if(models.some(x=>x.reason==='PROVIDER_RESTRICTED')) notes.push('OpenCode dış uygulama erişimini reddediyor');
  if(models.some(x=>x.reason==='QUOTA_EXHAUSTED')) notes.push('Kiro model kotası dolu');
  if(models.some(x=>x.reason==='LOCAL_CONTEXT_TOO_SMALL')) notes.push('yerel Ollama Vision context penceresi 9TF için yetersiz');
  if(models.some(x=>x.reason==='LOCAL_UNAVAILABLE')) notes.push('yerel Ollama Vision kullanılamıyor');
  if(models.some(x=>x.reason==='TIMEOUT')) notes.push('model yanıtı süre aşımına uğradı');
  return {verifiedModels:verified,models,summaryTr:(verified?'Görsel model yanıtı doğrulandı: '+verified:'Görsel model erişimi doğrulanamadı')+(notes.length?' • '+notes.join(' • '):'')};
}
function uniqueModels(xs){ return [...new Set((xs||[]).filter(Boolean))]; }
function orderedVisionModels(ccfg,role='STRUCTURE',includeCooldown=false){
  const free=uniqueModels(cfg.opencode||[]);
  const kiro=uniqueModels(cfg.kiro||[]);
  const local=localVisionConfig();
  const allowed=new Set([...free,...kiro]);
  const explicit=uniqueModels([...(ccfg?.visionAnalysts||[]),...(ccfg?.visionBackupAnalysts||[])]).filter(x=>allowed.has(x));
  const general=uniqueModels([...(ccfg?.analysts||[]),...(ccfg?.backupAnalysts||[])]).filter(x=>allowed.has(x));
  const freePool=uniqueModels([...explicit.filter(x=>free.includes(x)),...general.filter(x=>free.includes(x)),...free]);
  const kiroPool=uniqueModels([...explicit.filter(x=>kiro.includes(x)),...general.filter(x=>kiro.includes(x)),...kiro]);
  const configuredQuotaModels=uniqueModels(Array.isArray(ccfg?.kiroFreeQuotaVisionModels)
    ? ccfg.kiroFreeQuotaVisionModels
    : ['kr/claude-sonnet-4.5','kr/claude-haiku-4.5']).filter(x=>kiro.includes(x));
  const preferHealthy=xs=>[
    ...xs.filter(x=>visionState.get(x)?.ok===true),
    ...xs.filter(x=>visionState.get(x)?.ok!==true&&(includeCooldown||!visionBlocked(x)))
  ];
  const visionRank=xs=>{
    const roleRanked=rankPool(xs,role,true);
    const hint=m=>{
      const z=String(m||'').toLowerCase();
      if(z.includes('vision'))return 0;
      if(z.includes('claude-sonnet-4.5'))return 1;
      if(z.includes('claude-haiku-4.5'))return 2;
      if(z.includes('muse-spark-1.3'))return 3;
      if(z.includes('muse-spark-1.2'))return 4;
      return 9;
    };
    return roleRanked.map((model,index)=>({model,index,hint:hint(model)}))
      .sort((a,b)=>a.hint-b.hint||a.index-b.index).map(x=>x.model);
  };
  const allowKiroFreeQuota=ccfg?.allowKiroFreeQuotaVision === true;
  const allowLegacyKiroFallback=ccfg?.allowKiroVisionFallback === true;
  const rankedFree=visionRank(preferHealthy(freePool));
  const kiroCandidates=allowKiroFreeQuota
    ? configuredQuotaModels
    : (allowLegacyKiroFallback?kiroPool:[]);
  const maxFree=kiroCandidates.length?Math.max(1,Math.min(6,Number(ccfg?.maxFreeVisionAttempts||3))):rankedFree.length;
  const localRoutes=visionRank(preferHealthy(local.enabled?local.models:[]));
  if(local.enabled&&local.localOnly)return uniqueModels(localRoutes);
  return uniqueModels([
    ...localRoutes,
    ...rankedFree.slice(0,maxFree),
    ...visionRank(preferHealthy(kiroCandidates))
  ]);
}
async function ask(prompt,system,preferred,role='DEFAULT'){
  role=normalizeRole(role);
  const msgs=[];
  const sys=[roleInstruction(role),String(system||'').trim()].filter(Boolean).join(' ');
  if(sys)msgs.push({role:'system',content:sys});
  msgs.push({role:'user',content:prompt});
  const list=orderedModels(role,preferred);
  const errors=[];
  for(const m of list){
    if(blocked(m))continue;
    try{
      const out=await callModel(m,msgs);
      log('ASK OK role='+role+' model='+m);
      return {...out,role,attempts:errors.length+1};
    }catch(e){
      const msg=String(e.message||e);
      state.set(m,{ok:false,at:Date.now(),error:msg.slice(0,240)});
      errors.push({model:m,error:msg.slice(0,240)});
      log('ASK FAIL role='+role+' model='+m+' '+msg.slice(0,180));
    }
  }
  throw Object.assign(new Error('no healthy model'),{errors});
}
function readBody(req,maxBytes=1048576){
  return new Promise((resolve,reject)=>{
    let b='';
    req.on('data',c=>{b+=c;if(b.length>maxBytes){reject(new Error('body too large'));req.destroy();}});
    req.on('end',()=>resolve(b));
    req.on('error',reject);
  });
}
function normalizeVisionImages(images){
  if(!Array.isArray(images)||!images.length)return [];
  const out=[];
  let totalBytes=0;
  for(const raw of images.slice(0,9)){
    const tf=String(raw?.tf||'').toLowerCase();
    const mode=String(raw?.mode||'clean').toLowerCase();
    const dataUrl=String(raw?.dataUrl||raw?.url||'').trim();
    if(!/^(1m|3m|5m|15m|30m|45m|1h|4h|1d)$/.test(tf))continue;
    if(!/^(clean|annotated)$/.test(mode))continue;
    const m=dataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if(!m)continue;
    const approxBytes=Math.floor(m[2].length*3/4);
    if(approxBytes<100||approxBytes>700000)continue;
    if(totalBytes+approxBytes>5000000)break;
    totalBytes+=approxBytes;
    out.push({tf,mode,dataUrl,bytes:approxBytes});
  }
  return out;
}
function multimodalUserContent(prompt,images){
  const normalized=normalizeVisionImages(images);
  if(!normalized.length)return {content:String(prompt||''),images:[]};
  const content=[{
    type:'text',
    text:String(prompt||'')+'\n\nVISION_CHARTS: Aşağıdaki grafikler aynı sembolün farklı zaman dilimleridir. Görseldeki FORMING son mumu teyit mumu sayma; kapanmış mum yapısı ile mevcut forming mumu ayrı değerlendir.'
  }];
  for(const image of normalized){
    content.push({type:'text',text:'CHART '+image.tf+' '+image.mode.toUpperCase()});
    content.push({type:'image_url',image_url:{url:image.dataUrl,detail:'high'}});
  }
  return {content,images:normalized};
}
function tfPromptTag(tf){
  return String(tf||'').toUpperCase();
}
function localVisionExtractionPrompt(images,localContext){
  const normalized=normalizeVisionImages(images);
  const tf=String(normalized[0]?.tf||'').toLowerCase();
  const tag=tfPromptTag(tf);
  const tfContext=localContext?.frames?.[tf]||{available:false};
  const shared={
    symbol:localContext?.symbol||null,
    livePrice:localContext?.livePrice??null,
    sourceCandidate:localContext?.sourceCandidate||null,
    timeframe:tfContext,
    policy:{
      formingCandleIsContextOnly:true,
      synthetic45mIsContextNotIndependentVote:tf==='45m',
      execution:'ADVISORY_ONLY'
    }
  };
  return [
    'LOCAL_VISION_SINGLE_TF. Yalnız ekli '+tf+' grafiğini gerçekten incele.',
    'Görsel kanıt ile DETERMINISTIC_CONTEXT_JSON içeriğini birlikte değerlendir. Nihai global planı burada yazma.',
    'Tam olarak şu 6 satırı Türkçe ve coin-specific döndür. Kısa yaz; etiketlerden hiçbirini atlama:',
    'TF_'+tag+': <=70 karakter; yön etkisi',
    'TF_'+tag+'_WHY: <=100 karakter; tek ana görsel + deterministik kanıt',
    'TF_'+tag+'_WAIT: <=60 karakter; tam koşul veya NONE',
    'TF_'+tag+'_ROLE: yalnız SUPPORT veya VETO veya NEUTRAL',
    'TF_'+tag+'_FORMING: <=70 karakter; teyit olmadığı açık',
    'TF_'+tag+'_RISK: <=70 karakter; tek ana risk',
    tf==='45m'?'Sentetik 45m bağımsız oy değildir.':'',
    'Görmediğin şeyi uydurma. Market-maker niyeti çıkarma. Başka satır veya açıklama ekleme.',
    'DETERMINISTIC_CONTEXT_JSON:',
    JSON.stringify(shared)
  ].filter(Boolean).join('\n');
}
function localPixelBatchPrompt(images){
  if(normalizeVisionImages(images).length!==1)throw new Error('PIXEL_SINGLE_IMAGE_REQUIRED');
  return [
    'LOCAL_PIXEL_SINGLE. Read only the large 3x3 diagnostic grid in the upper left of the attached chart.',
    'Number cells left-to-right, top-to-bottom, 1..9: first row 1,2,3; second row 4,5,6; last row 7,8,9.',
    'Each cell has its number printed inside. Read the digit printed inside the bright MAGENTA cell. Reply with only that one digit. No timeframe, labels or explanation.'
  ].join('\n');
}
function visionBatches(images,size=1){
  const xs=normalizeVisionImages(images);
  const out=[];
  for(let i=0;i<xs.length;i+=size)out.push(xs.slice(i,i+size));
  return out;
}
let localVisionProgress={runId:null,stage:'IDLE',startedAt:null,updatedAt:new Date().toISOString(),durationMs:0,model:null,error:null};
let localVisionTail=Promise.resolve();
let localVisionQueueDepth=0;
async function withLocalVisionSingleFlight(fn){
  const previous=localVisionTail;
  let release;
  localVisionTail=new Promise(resolve=>{release=resolve;});
  localVisionQueueDepth++;
  await previous;
  try{return await fn();}
  finally{
    localVisionQueueDepth=Math.max(0,localVisionQueueDepth-1);
    release();
  }
}
function setLocalVisionProgress(stage,extra={}){
  const now=Date.now();
  const started=Number(extra.startedMs||0) || Number(localVisionProgress.startedAtMs||0) || now;
  localVisionProgress={
    ...localVisionProgress,
    ...extra,
    stage:String(stage||'UNKNOWN'),
    startedAtMs:started,
    startedAt:new Date(started).toISOString(),
    updatedAt:new Date(now).toISOString(),
    durationMs:Math.max(0,now-started)
  };
  delete localVisionProgress.startedMs;
  return localVisionProgress;
}
async function callLocalStage(label,model,messages,timeoutMs,requestOptions){
  const started=Date.now();
  setLocalVisionProgress(label,{model,stageStartedAt:new Date(started).toISOString(),error:null});
  try{
    const out=await callModel(model,messages,timeoutMs,requestOptions);
    const durationMs=Date.now()-started;
    setLocalVisionProgress(label+'_DONE',{model,lastStage:label,lastStageDurationMs:durationMs,error:null});
    return {...out,stageDurationMs:durationMs};
  }catch(e){
    const cause=String(e?.cause?.message||e?.cause||'').slice(0,180);
    const detail=String(e?.message||e).slice(0,260);
    const err=new Error(label+': '+detail+(cause?' | cause='+cause:''));
    err.stage=label;
    err.stageDurationMs=Date.now()-started;
    setLocalVisionProgress(label+'_ERROR',{model,lastStage:label,lastStageDurationMs:err.stageDurationMs,error:err.message.slice(0,500)});
    throw err;
  }
}
function localRoleSummary(tfEvidence){
  const roleMap={};
  const re=/^\s*TF_(1M|3M|5M|15M|30M|45M|1H|4H|1D)_ROLE\s*:\s*(SUPPORT|VETO|NEUTRAL)\s*$/gim;
  let m;
  while((m=re.exec(String(tfEvidence||''))))roleMap[m[1].toLowerCase()]=m[2].toUpperCase();
  const canonical={'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','45m':'45m','1h':'1h','4h':'4h','1d':'1d'};
  const support=[],veto=[];
  for(const tf of ['1m','3m','5m','15m','30m','45m','1h','4h','1d']){
    const role=roleMap[tf];
    if(role==='SUPPORT')support.push(canonical[tf]);
    if(role==='VETO')veto.push(canonical[tf]);
  }
  return {
    supportLine:'SUPPORT_TFS: '+(support.length?support.join(','):'NONE'),
    vetoLine:'VETO_TFS: '+(veto.length?veto.join(','):'NONE')
  };
}
function parseLabelMap(text){
  const lines=new Map();
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=String(rawLine||'').trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/,'');
    const colon=line.indexOf(':');
    if(colon<1)continue;
    const label=line.slice(0,colon).replace(/[\`*"']/g,'').trim().toUpperCase();
    const value=line.slice(colon+1).replace(/\s+/g,' ').trim();
    if(label&&value&&!lines.has(label))lines.set(label,value);
  }
  return lines;
}
function tfEvidenceContract(tf,text){
  const tag=tfPromptTag(tf);
  const required=[
    'TF_'+tag,
    'TF_'+tag+'_WHY',
    'TF_'+tag+'_WAIT',
    'TF_'+tag+'_ROLE',
    'TF_'+tag+'_FORMING',
    'TF_'+tag+'_RISK'
  ];
  const lines=parseLabelMap(text);
  const missing=required.filter(x=>!String(lines.get(x)||'').trim());
  const roleLabel='TF_'+tag+'_ROLE';
  const role=String(lines.get(roleLabel)||'').trim().toUpperCase();
  if(lines.has(roleLabel)&&!['SUPPORT','VETO','NEUTRAL'].includes(role))missing.push(roleLabel);
  return {ok:missing.length===0,required,missing:[...new Set(missing)],lines};
}
function mergeLabelContracts(base,repair,labels){
  const merged=new Map(base?.lines instanceof Map?base.lines:[]);
  const repairLines=repair?.lines instanceof Map?repair.lines:new Map();
  for(const label of labels){
    const v=String(repairLines.get(label)||'').trim();
    if(v)merged.set(label,v);
  }
  return {lines:merged};
}
function canonicalTfEvidence(tf,contract){
  const tag=tfPromptTag(tf);
  const labels=['TF_'+tag,'TF_'+tag+'_WHY','TF_'+tag+'_WAIT','TF_'+tag+'_ROLE','TF_'+tag+'_FORMING','TF_'+tag+'_RISK'];
  return labels.map(label=>label+': '+String(contract?.lines?.get(label)||'').replace(/\s+/g,' ').trim().slice(0,520)).join('\n');
}
function localTfRepairPrompt(tf,missing,localContext,visualText){
  const tfContext=localContext?.frames?.[tf]||{available:false};
  return [
    'LOCAL_TF_SCHEMA_REPAIR. Bu bir metin şema onarımıdır; yeni görsel yorumu yapma.',
    'Yalnız eksik/geçersiz etiketleri ALREADY_EXTRACTED_VISUAL_EVIDENCE ve TF_CONTEXT_JSON içinden tamamla.',
    'Başka etiket veya açıklama yazma. Yeni piyasa iddiası uydurma.',
    'Eksik/geçersiz etiketler: '+missing.join(', '),
    'ROLE yalnız SUPPORT veya VETO veya NEUTRAL olabilir.',
    'FORMING alanı kapanmış mum teyidi olmadığını açıkça söylemeli.',
    'Her değer kısa olsun; WHY<=120, WAIT<=80, FORMING<=90, RISK<=90 karakter. Tüm istenen etiketleri mutlaka yaz.',
    'ALREADY_EXTRACTED_VISUAL_EVIDENCE:',
    String(visualText||'').slice(0,2200),
    'TF_CONTEXT_JSON: '+JSON.stringify(tfContext)
  ].join('\n');
}
function labeledContract(text,labels){
  const lines=new Map();
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=String(rawLine||'').trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/,'');
    const colon=line.indexOf(':');
    if(colon<1)continue;
    const label=line.slice(0,colon).replace(/[\`*"']/g,'').trim().toUpperCase();
    if(!lines.has(label))lines.set(label,line.slice(colon+1).trim());
  }
  const missing=labels.filter(x=>!String(lines.get(x)||'').trim());
  return {ok:missing.length===0,missing,lines};
}
function normalizedLabeledText(contract,labels,maxChars=240){
  return labels.map(label=>{
    const raw=String(contract?.lines?.get(label)||'').replace(/\s+/g,' ').trim();
    return label+': '+raw.slice(0,maxChars);
  }).join('\n');
}
function globalCoreContract(text){
  const labels=['STATUS','SIDE','CONFIDENCE','ORIGIN_TF','OWNER_TF','SETUP','EXEC_PATH'];
  const base=labeledContract(text,labels);
  const invalid=[];
  const status=String(base.lines.get('STATUS')||'').toUpperCase();
  const side=String(base.lines.get('SIDE')||'').toUpperCase();
  const confidence=Number(base.lines.get('CONFIDENCE'));
  const origin=String(base.lines.get('ORIGIN_TF')||'').toLowerCase();
  const owner=String(base.lines.get('OWNER_TF')||'').toLowerCase();
  const tfs=['1m','3m','5m','15m','30m','45m','1h','4h','1d'];
  if(base.lines.has('STATUS')&&!['WATCH','QUALIFIED','REJECT'].includes(status))invalid.push('STATUS');
  if(base.lines.has('SIDE')&&!['LONG','SHORT'].includes(side))invalid.push('SIDE');
  if(base.lines.has('CONFIDENCE')&&(!Number.isFinite(confidence)||confidence<0||confidence>100))invalid.push('CONFIDENCE');
  if(base.lines.has('ORIGIN_TF')&&!tfs.includes(origin))invalid.push('ORIGIN_TF');
  if(base.lines.has('OWNER_TF')&&!tfs.includes(owner))invalid.push('OWNER_TF');
  const badText=v=>/[|<>]|\b(?:WATCH\s*\||LONG\s*\||1m\s*\|)|en fazla/i.test(String(v||''));
  if(base.lines.has('SETUP')&&badText(base.lines.get('SETUP')))invalid.push('SETUP');
  if(base.lines.has('EXEC_PATH')&&badText(base.lines.get('EXEC_PATH')))invalid.push('EXEC_PATH');
  const missing=[...new Set([...base.missing,...invalid])];
  return {ok:missing.length===0,missing,lines:base.lines};
}
function compactLocalFinalizeContext(localContext){
  const c=localContext&&typeof localContext==='object'?localContext:{};
  const frames={};
  for(const tf of ['1m','3m','5m','15m','30m','45m','1h','4h','1d']){
    const f=c.frames?.[tf]||{};
    frames[tf]={
      available:f.available===true,
      fresh:f.fresh??null,
      close:f.close??null,
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
  const m=c.microstructure||{};
  const l=c.liquidationContext||{};
  return {
    symbol:c.symbol||null,
    livePrice:c.livePrice??null,
    sourceCandidate:c.sourceCandidate||null,
    frames,
    opportunityPaths:c.opportunityPaths||null,
    microstructure:m.available?{
      available:true,
      quality:m.quality||m.sourceQuality||null,
      spreadBps:m.spreadBps??null,
      depth20Imbalance:m.depth20Imbalance??null,
      cvdSampleQuote:m.cvdSampleQuote??null,
      cvdSource:m.cvdSource||null,
      ofiProxyQuote:m.ofiProxyQuote??null,
      streaming:m.streaming?{
        available:Boolean(m.streaming.available),
        connected:Boolean(m.streaming.connected),
        ageMs:m.streaming.ageMs??null
      }:null
    }:{available:false,reason:m.reason||null},
    liquidationContext:l.available?{
      available:true,
      source:l.source||null,
      semantics:l.semantics||null,
      count:l.count??null,
      asOf:l.asOf||null,
      longLiquidatedQuote:l.longLiquidatedQuote??null,
      shortLiquidatedQuote:l.shortLiquidatedQuote??null,
      zones:Array.isArray(l.zones)?l.zones.slice(0,3):[]
    }:{available:false,reason:l.reason||null},
    global:c.global||null,
    dataQuality:c.dataQuality||null,
    policy:c.policy||null
  };
}
function localGlobalNarrativeRepairMessages(role,missing,visionText,localContext,narrativeText,coreText){
  return [
    {role:'system',content:roleInstruction(role)+' LOCAL_GLOBAL_NARRATIVE_REPAIR: repair only missing narrative labels from supplied evidence. Do not change direction/status, do not invent facts, and return only requested LABEL: value lines. Advisory only.'},
    {role:'user',content:[
      'Repair only these labels: '+missing.join(', '),
      'WHY: concise common evidence/conflict',
      'RISK_NOTE: concise main invalidation risk',
      'WAIT_FOR: exact wait condition; NONE only when evidence already supports no wait',
      'FORMING_CONTEXT: forming candle is context only, never confirmation',
      'VISION_SUMMARY: concise 9TF support/veto and origin-to-owner summary',
      'WAIT_FOR rule: CORE_DECISION STATUS QUALIFIED ise WAIT_FOR değeri TAM OLARAK NONE olmalı.',
      '',
      'CORE_DECISION:',
      String(coreText||''),
      '',
      'EXISTING_NARRATIVE:',
      String(narrativeText||'').slice(0,1800),
      '',
      'TF_EVIDENCE:',
      String(visionText||''),
      '',
      'COMPACT_CONTEXT_JSON:',
      JSON.stringify(localContext||{})
    ].join('\n')}
  ];
}
function localGlobalCoreRepairMessages(role,missing,visionText,localContext){
  return [
    {role:'system',content:roleInstruction(role)+' LOCAL_GLOBAL_CORE_REPAIR: choose concrete values, never echo option lists or placeholders. Return only requested LABEL: value lines. Advisory only.'},
    {role:'user',content:[
      'Repair only these labels: '+missing.join(', '),
      'Allowed STATUS: WATCH or QUALIFIED or REJECT',
      'Allowed SIDE: LONG or SHORT',
      'CONFIDENCE: one integer 0-100',
      'ORIGIN_TF and OWNER_TF: one of 1m,3m,5m,15m,30m,45m,1h,4h,1d',
      'SETUP and EXEC_PATH: concrete short names, never instruction text.',
      '',
      'TF_EVIDENCE:',
      String(visionText||''),
      '',
      'COMPACT_CONTEXT_JSON:',
      JSON.stringify(localContext||{})
    ].join('\n')}
  ];
}
function localGlobalCoreMessages(role,visionText,localContext){
  const sys=[
    roleInstruction(role),
    'LOCAL_GLOBAL_CORE: use only TF_EVIDENCE and COMPACT_CONTEXT_JSON. Return exactly seven short labeled lines. No prose outside labels. QUALIFIED is blocked when ORIGIN_TF or OWNER_TF is VETO, or when the selected execution path still has unresolved confirmation/reclaim/wait. Other timeframe VETO roles are contextual conflicts for Jev review, not automatic majority vetoes. Advisory only.'
  ].join(' ');
  return [
    {role:'system',content:sys},
    {role:'user',content:[
      'STATUS: WATCH | QUALIFIED | REJECT',
      'SIDE: LONG | SHORT',
      'CONFIDENCE: 0-100',
      'ORIGIN_TF: 1m | 3m | 5m | 15m | 30m | 45m | 1h | 4h | 1d',
      'OWNER_TF: 1m | 3m | 5m | 15m | 30m | 45m | 1h | 4h | 1d',
      'SETUP: en fazla 5 kelime',
      'EXEC_PATH: en fazla 5 kelime',
      'Safety rule: STATUS=QUALIFIED requires ORIGIN_TF and OWNER_TF not to be VETO and no unresolved execution-path wait/confirmation condition. Other TF VETO roles remain contextual evidence for Jev.',
      '',
      'TF_EVIDENCE:',
      String(visionText||''),
      '',
      'COMPACT_CONTEXT_JSON:',
      JSON.stringify(localContext||{})
    ].join('\n')}
  ];
}
function localGlobalNarrativeMessages(role,visionText,localContext,coreText){
  const sys=[
    roleInstruction(role),
    'LOCAL_GLOBAL_NARRATIVE: use only TF_EVIDENCE and COMPACT_CONTEXT_JSON. Return exactly five labeled Turkish lines. Each value must be concise: maximum 220 characters. Do not repeat patterns or timeframe names more than necessary. Forming candles are context only, never confirmation. Advisory only.'
  ].join(' ');
  return [
    {role:'system',content:sys},
    {role:'user',content:[
      'WHY: en fazla 220 karakter; ortak ana kanıt ve çelişki',
      'RISK_NOTE: en fazla 180 karakter; ana bozulma riski',
      'WAIT_FOR: en fazla 180 karakter; tam koşul; QUALIFIED ise NONE',
      'FORMING_CONTEXT: en fazla 180 karakter; forming bağlamı ve teyit olmadığı',
      'VISION_SUMMARY: en fazla 220 karakter; 9TF ortak yapı, destek/veto ve origin→owner',
      'WAIT_FOR rule: CORE_DECISION STATUS QUALIFIED ise WAIT_FOR değeri TAM OLARAK NONE olmalı; WATCH/REJECT ise gerçek bekleme/engelleme koşulunu yaz.',
      '',
      'CORE_DECISION:',
      String(coreText||''),
      '',
      'TF_EVIDENCE:',
      String(visionText||''),
      '',
      'COMPACT_CONTEXT_JSON:',
      JSON.stringify(localContext||{})
    ].join('\n')}
  ];
}
function readCommitteeConfig(){
  const cpath=path.join(ROOT,'config','committee.json');
  return JSON.parse(fs.readFileSync(cpath,'utf8').replace(/^\uFEFF/,''));
}
function candidateForSymbol(scan,symbol){
  const pools=[scan?.earlyTop5,scan?.top5Confirmed,scan?.leaderHunters,scan?.leaders];
  for(const pool of pools){
    const found=Array.isArray(pool)?pool.find(x=>x?.symbol===symbol):null;
    if(found)return found;
  }
  return null;
}
async function runLocalVisionCommittee(body){
  return withLocalVisionSingleFlight(()=>runLocalVisionCommitteeUnlocked(body));
}
async function runLocalVisionCommitteeUnlocked(body){
  const j=body&&typeof body==='object'?body:{};
  const role=normalizeRole(j.role||'DEFAULT');
  const vision=multimodalUserContent(j.prompt,j.images);
  if(!vision.images.length)throw new Error('local vision images required');
  const local=localVisionConfig();
  if(!local.enabled||!local.localOnly||!local.models.length)throw new Error('local-only vision route is not enabled');
  let ccfg={};try{ccfg=readCommitteeConfig();}catch{}
  const routed=orderedVisionModels(ccfg,role,true);
  const model=String(routed[0]||local.models[0]||'');
  if(!model.startsWith('local/'))throw new Error('local-only vision model unavailable');
  const forceVisionProbe=j.forceVisionProbe===true;
  const started=Date.now();
  const runId=nodeCrypto.randomBytes(6).toString('hex');
  setLocalVisionProgress(forceVisionProbe?'PIXEL_RUN_START':'DETAIL_RUN_START',{runId,startedMs:started,model,error:null,lastStage:null,lastStageDurationMs:null});
  try{
    let text='';
    let analystMeta={};
    if(forceVisionProbe){
      const batchTexts=[];
      const batchDurations=[];
      for(const batch of visionBatches(j.images,1)){
        const visualInput=multimodalUserContent(localPixelBatchPrompt(batch),batch);
        const visualMessages=[
          {role:'system',content:'You are a visual transport diagnostic. Read the magenta cell position in the attached grid. Return exactly one digit from 1 to 9, with no labels or explanation.'},
          {role:'user',content:visualInput.content}
        ];
        const batchStarted=Date.now();
        const tf=String(batch[0]?.tf||'?');
        const visual=await callLocalStage('PIXEL_TF='+tf,model,visualMessages,local.timeoutMs,{temperature:0,maxTokens:64});
        batchDurations.push(Date.now()-batchStarted);
        batchTexts.push(pipeline.formatSingleVisionPixelReply(String(batch[0]?.tf||''),visual.text));
      }
      text=batchTexts.filter(Boolean).join('\n');
      analystMeta={localVisionTwoStage:false,localVisionPixelBatched:true,localVisionBatchSize:1,batchDurations};
    }else{
      const batchTexts=[];
      const batchDurations=[];
      const visionStarted=Date.now();
      for(const batch of visionBatches(j.images,1)){
        const visualInput=multimodalUserContent(localVisionExtractionPrompt(batch,j.localContext||{}),batch);
        const visualMessages=[
          {role:'system',content:'You are the local Brain Hub single-timeframe visual extractor. Read the attached chart. Return exactly the requested TF_* labeled lines, never VIS_* labels. Do not place orders.'},
          {role:'user',content:visualInput.content}
        ];
        const batchStarted=Date.now();
        const tf=String(batch[0]?.tf||'?');
        const visual=await callLocalStage('VISUAL_TF='+tf,model,visualMessages,local.timeoutMs,{temperature:0,maxTokens:180});
        let contract=tfEvidenceContract(tf,visual.text);
        if(!contract.ok){
          const repairMessages=[
            {role:'system',content:'LOCAL_TF_SCHEMA_REPAIR. Repair only requested TF_* labels from already extracted evidence. Do not invent new visual claims. ROLE must be exactly SUPPORT, VETO, or NEUTRAL. Return LABEL: value lines only.'},
            {role:'user',content:localTfRepairPrompt(tf,contract.missing,j.localContext||{},visual.text)}
          ];
          const repair=await callLocalStage('TF_SCHEMA_REPAIR='+tf,model,repairMessages,local.timeoutMs,{temperature:0,maxTokens:320});
          const repairContract=tfEvidenceContract(tf,repair.text);
          contract=mergeLabelContracts(contract,repairContract,contract.missing);
          const canonical=canonicalTfEvidence(tf,contract);
          contract=tfEvidenceContract(tf,canonical);
          if(!contract.ok)throw new Error('TF_CONTRACT='+tf+' missing='+contract.missing.join(','));
        }
        const canonical=canonicalTfEvidence(tf,contract);
        batchDurations.push(Date.now()-batchStarted);
        batchTexts.push(canonical);
      }
      const visionDurationMs=Date.now()-visionStarted;
      const visionText=batchTexts.filter(Boolean).join('\n');
      const finalizeStarted=Date.now();
      const finalizeContext=compactLocalFinalizeContext(j.localContext||{});
      const core=await callLocalStage(
        'FINALIZE_CORE',
        model,
        localGlobalCoreMessages(role,visionText,finalizeContext),
        local.timeoutMs,
        {temperature:0,maxTokens:320}
      );
      const coreLabels=['STATUS','SIDE','CONFIDENCE','ORIGIN_TF','OWNER_TF','SETUP','EXEC_PATH'];
      let coreContract=globalCoreContract(core.text);
      if(!coreContract.ok){
        const coreRepair=await callLocalStage(
          'FINALIZE_CORE_REPAIR',
          model,
          localGlobalCoreRepairMessages(role,coreContract.missing,visionText,finalizeContext),
          local.timeoutMs,
          {temperature:0,maxTokens:220}
        );
        const repairContract=globalCoreContract(coreRepair.text);
        coreContract=mergeLabelContracts(coreContract,repairContract,coreContract.missing);
        coreContract=globalCoreContract(normalizedLabeledText(coreContract,coreLabels,80));
      }
      if(!coreContract.ok)throw new Error('GLOBAL_CORE_CONTRACT missing='+coreContract.missing.join(','));
      const narrative=await callLocalStage(
        'FINALIZE_NARRATIVE',
        model,
        localGlobalNarrativeMessages(role,visionText,finalizeContext,normalizedLabeledText(coreContract,coreLabels,80)),
        local.timeoutMs,
        {temperature:0,maxTokens:420}
      );
      const narrativeLabels=['WHY','RISK_NOTE','WAIT_FOR','FORMING_CONTEXT','VISION_SUMMARY'];
      let narrativeContract=labeledContract(narrative.text,narrativeLabels);
      if(!narrativeContract.ok){
        const narrativeRepair=await callLocalStage(
          'FINALIZE_NARRATIVE_REPAIR',
          model,
          localGlobalNarrativeRepairMessages(role,narrativeContract.missing,visionText,finalizeContext,narrative.text,normalizedLabeledText(coreContract,coreLabels,80)),
          local.timeoutMs,
          {temperature:0,maxTokens:260}
        );
        const repairContract=labeledContract(narrativeRepair.text,narrativeLabels);
        narrativeContract=mergeLabelContracts(narrativeContract,repairContract,narrativeContract.missing);
        narrativeContract=labeledContract(normalizedLabeledText(narrativeContract,narrativeLabels,240),narrativeLabels);
      }
      if(!narrativeContract.ok)throw new Error('GLOBAL_NARRATIVE_CONTRACT missing='+narrativeContract.missing.join(','));
      const finalizeDurationMs=Date.now()-finalizeStarted;
      const roleSummary=localRoleSummary(visionText);
      text=[
        normalizedLabeledText(coreContract,coreLabels,80),
        normalizedLabeledText(narrativeContract,narrativeLabels,240),
        roleSummary.supportLine,
        roleSummary.vetoLine,
        visionText,
        'EXECUTION: ADVISORY_ONLY'
      ].filter(Boolean).join('\n');
      analystMeta={
        localVisionTwoStage:true,
        localVisionBatchSize:1,
        visionExtractionText:visionText.slice(0,5000),
        visionDurationMs,
        batchDurations,
        finalizeDurationMs,
        globalFinalizeSplit:true
      };
    }
    const durationMs=Date.now()-started;
    visionState.set(model,{ok:true,at:Date.now(),error:null,durationMs});
    setLocalVisionProgress(forceVisionProbe?'PIXEL_RUN_COMPLETE':'DETAIL_RUN_COMPLETE',{runId,model,lastStageDurationMs:durationMs,error:null});
    const analyst={ok:true,model,text,durationMs,...analystMeta};
    const minReplies=Math.max(1,Number(ccfg.minAnalystReplies||2));
    const minVisionReplies=Math.max(1,Number(ccfg.minVisionAnalystReplies||1));
    const out={
      ok:true,role,mode:'degraded_single',degraded:minReplies>1,
      degradedReason:minReplies>1?'DEGRADED_1_ANALYST':null,
      requiredAnalystReplies:minReplies,
      requiredVisionAnalystReplies:minVisionReplies,
      receivedAnalystReplies:1,
      forceVisionProbe,
      visionTimeoutMs:local.timeoutMs,
      visionParallelAnalysts:1,
      localVisionTwoStage:!forceVisionProbe,
      localVisionBatchSize:1,
      visionKiroFreeQuota:false,
      disagreement:false,
      verdictConsensus:null,
      vision:{attached:vision.images.length,timeframes:vision.images.map(x=>x.tf),modes:vision.images.map(x=>x.mode)},
      analysts:[analyst],
      failed:[],
      judge:{used:false},
      model,
      text
    };
    log('COMMITTEE LOCAL_DIRECT OK role='+role+' model='+model+' visionCharts='+vision.images.length+' singleTf=yes forceProbe='+(forceVisionProbe?'yes':'no'));
    return out;
  }catch(e){
    const durationMs=Date.now()-started;
    setLocalVisionProgress(forceVisionProbe?'PIXEL_RUN_ERROR':'DETAIL_RUN_ERROR',{runId,model,lastStageDurationMs:durationMs,error:String(e?.message||e).slice(0,500)});
    const cause=String(e?.cause?.message||e?.cause||'').slice(0,240);
    const msg=(String(e?.message||e)+(cause?' | cause='+cause:'')).slice(0,500);
    visionState.set(model,{ok:false,at:Date.now(),error:msg,durationMs});
    const committee={
      ok:false,error:'no vision analyst replies',role,
      required:1,received:0,
      vision:{attached:vision.images.length,timeframes:vision.images.map(x=>x.tf),modes:vision.images.map(x=>x.mode)},
      attemptedModels:[model],
      localVisionDirect:true,
      localVisionBatchSize:1,
      failures:[{model,error:msg,durationMs}]
    };
    const err=new Error('committee unavailable: no vision analyst replies | '+model+': '+msg);
    err.committee=committee;
    throw err;
  }
}
async function committeeCall(body){
  const local=localVisionConfig();
  const hasVision=normalizeVisionImages(body?.images).length>0;
  if(hasVision&&local.enabled&&local.localOnly){
    return runLocalVisionCommittee(body);
  }
  const r=await fetch('http://127.0.0.1:'+PORT+'/committee',{method:'POST',headers:{'content-type':'application/json',...(CLIENT_TOKEN?{authorization:'Bearer '+CLIENT_TOKEN}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(1500000)});
  const data=await r.json();
  if(!r.ok){
    const failures=Array.isArray(data?.failures)?data.failures:[];
    const failureText=failures.slice(0,4).map(x=>String(x?.model||'?')+': '+String(x?.error||'error')).join(' | ');
    const err=new Error('committee unavailable: '+(data.error||r.status)+(failureText?' | '+failureText:''));
    err.committee=data;
    throw err;
  }
  return data;
}
const decisionPipeline={...pipeline,run:(args)=>pipeline.run({...args,decisionJudge:jev.judge})};
const live=createLiveController({root:ROOT,store,scanner,pipeline:decisionPipeline,committee:committeeCall,exitJudge:jev.judgeExit,credentials:BINANCE_CREDENTIALS});

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://127.0.0.1');
    if(!authorized(req))return send(res,401,{ok:false,error:'unauthorized'});
    if(req.method==='GET'&&u.pathname==='/health'){
      const ls=live.status();
      const local=localVisionConfig();
      return send(res,200,{ok:true,time:new Date().toISOString(),host:HOST,port:PORT,routerKeyLoaded:true,version:'brainhub-pro-1',featureVersion:'9.5.99-VISION',execution:ls.armed?'LIVE_ARMED_PER_ORDER_GRANT_REQUIRED':'ADVISORY_ONLY',live:{configured:ls.liveConfigured,armed:ls.armed,expiresAt:ls.expiresAt},database:'sqlite',router:'9Router',configured:{opencode:(cfg.opencode||[]).length,kiro:(cfg.kiro||[]).length,localVision:local.enabled?local.models.length:0,openRouterJev:jev.localStatus().configured?1:0,total:(cfg.opencode||[]).length+(cfg.kiro||[]).length+(local.enabled?local.models.length:0)},features:['UNIFIED_9TF','CAUSAL_45M','ROLE_ROUTING','FAILED_BREAKOUT_GUARD','CHART_DATA','CHART_PNG_CLEAN','CHART_PNG_ANNOTATED','VISION_COMMITTEE_INPUT','VISION_CAPABILITY_FALLBACK','VISION_PROBE','VISION_PIXEL_PROBE','KIRO_FREE_QUOTA_VISION_OPT_IN','LOCAL_OLLAMA_VISION_FALLBACK','LOCAL_OLLAMA_VISION_16K','LOCAL_OLLAMA_VISION_32K','LOCAL_OLLAMA_VISION_ONLY','LOCAL_OLLAMA_VISION_TWO_STAGE','LOCAL_OLLAMA_VISION_BATCH3','LOCAL_OLLAMA_VISION_SINGLE_TF','LOCAL_OLLAMA_VISION_COMPACT_FINALIZE','LOCAL_OLLAMA_VISION_TF_CONTRACT','LOCAL_OLLAMA_VISION_SPLIT_GLOBAL','LOCAL_OLLAMA_VISION_PROGRESS','LOCAL_OLLAMA_VISION_SEMANTIC_CONTRACT','LOCAL_OLLAMA_VISION_TEXT_REPAIR','LOCAL_OLLAMA_VISION_SLIM_TF_CONTEXT','LOCAL_OLLAMA_VISION_SINGLE_FLIGHT','LOCAL_OLLAMA_VISION_COMPACT_GLOBAL_CONTEXT','LOCAL_OLLAMA_VISION_NARRATIVE_REPAIR','VISION_SEMANTIC_DOWNGRADE','LOCAL_VISION_NO_DUPLICATE_IMAGE_REPAIR','LOCAL_OLLAMA_VISION_DIRECT_PIPELINE','OPENROUTER_DPAPI_SECRET','OPENROUTER_JEV_DECISIONS_PROBE','OPENROUTER_JEV_ADVISORY_VETO_GATE','OPENROUTER_JEV_DAILY_BUDGET','OPENROUTER_JEV_SOFT_HARD_BUDGET','OPENROUTER_ACCOUNT_CREDIT_TELEMETRY','ACTIVE_POSITION_9TF_REVIEW','JEV_POSITION_EXIT_JUDGE','BRAIN_LEARNING_SOFT_CONTEXT','ANDROID_TURKISH_DECISION_TEXT','VISION_CHART_896X504','VISION_CHART_640X360','VISION_CHART_448X252','KKK_DETAILED_9TF_DIAGNOSTICS','LEADER_DETAIL_PROBE','OPENCODE_OFFICIAL_FREE_INFERENCE','LIVE_FAIL_CLOSED'],featureCompatibility:{OPENCODE_OFFICIAL_FREE_INFERENCE:'BOOTSTRAP_ALIAS_ONLY',LOCAL_OLLAMA_VISION_BATCH3:'BOOTSTRAP_ALIAS_ONLY',VISION_CHART_896X504:'BOOTSTRAP_ALIAS_ONLY',VISION_CHART_640X360:'BOOTSTRAP_ALIAS_ONLY'}});
    }
    if(req.method==='GET'&&u.pathname==='/openrouter/status'){
      const remote=u.searchParams.get('remote')==='1';
      const out=remote?await jev.remoteStatus():jev.localStatus();
      return send(res,out.ok===false?503:200,out);
    }
    if(req.method==='POST'&&u.pathname==='/jev/probe'){
      const out=await jev.probe();
      return send(res,out.ok?200:503,out);
    }
    if(req.method==='GET'&&u.pathname==='/jev/budget'){
      return send(res,200,{ok:true,...jev.budgetStatus(),model:jev.config.model,mode:jev.config.mode});
    }
    if(req.method==='GET'&&u.pathname==='/openrouter/billing'){
      const force=u.searchParams.get('force')==='1';
      return send(res,200,await jev.billingStatus({force}));
    }
    if(req.method==='GET'&&u.pathname==='/live/status'){
      return send(res,200,{...live.status(),visionAvailability:visionAvailability(),visionProgress:{...localVisionProgress,queueDepth:localVisionQueueDepth},jev:jev.localStatus(),openRouterBilling:jev.billingSnapshot()});
    }
    if(req.method==='GET'&&u.pathname==='/live/account'){
      const out=await live.accountSummary();
      return send(res,out?.ok?200:503,out);
    }
    if(req.method==='GET'&&u.pathname==='/live/readiness'){
      const symbol=String(u.searchParams.get('symbol')||'').trim().toUpperCase();
      const out=await live.liveReadiness({symbol});
      return send(res,200,out);
    }
    if(req.method==='POST'&&u.pathname==='/live/arm'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      if(body?.confirm!=='LIVE')return send(res,400,{ok:false,armed:false,liveAllowed:false,execution:'LIVE_BLOCKED',reasons:['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']});
      const out=await live.arm({confirmed:true});
      return send(res,out.ok?200:409,out);
    }
    if(req.method==='POST'&&u.pathname==='/live/disarm'){
      let body={};try{body=JSON.parse((await readBody(req))||'{}');}catch{return send(res,400,{ok:false,error:'invalid json'});}
      return send(res,200,live.disarm(typeof body.reason==='string'?body.reason:'USER_DISARM'));
    }
    if(req.method==='POST'&&u.pathname==='/live/execute'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      const out=await live.execute(body||{});
      return send(res,out.ok?200:409,out);
    }
    if(req.method==='GET'&&u.pathname==='/live/leader-auto'){
      return send(res,200,live.leaderAutoStatus());
    }
    if(req.method==='POST'&&u.pathname==='/live/leader-auto'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      const out=live.configureLeaderAuto(body||{});
      return send(res,out.ok?200:409,out);
    }
    if(req.method==='GET'&&u.pathname==='/models/healthy'){
      const local=localVisionConfig();
      const models=[...(cfg.opencode||[]),...(cfg.kiro||[]),...(local.enabled?local.models:[])].map(model=>({
        model,
        status:state.has(model)?(state.get(model).ok?'healthy':'cooldown'):'untested',
        last:state.get(model)?.at||null,
        error:state.get(model)?.error||null,
        visionStatus:visionState.has(model)?(visionState.get(model).ok?'healthy':'cooldown'):'untested',
        visionLast:visionState.get(model)?.at||null,
        visionError:visionState.get(model)?.error||null
      }));
      return send(res,200,{cacheSeconds:TTL/1000,models});
    }
    if(req.method==='GET'&&u.pathname==='/models/routes'){
      let ccfg={};try{ccfg=readCommitteeConfig();}catch{}
      const configured=[...(ccfg.analysts||[]),...(ccfg.backupAnalysts||[])];
      const base=configured.length?configured:[...(cfg.opencode||[])];
      const routes={};
      for(const role of Object.keys(ROLE_HINTS))routes[role]=rankPool(base,role,false);
      const visionRoutes={};
      for(const role of Object.keys(ROLE_HINTS))visionRoutes[role]=orderedVisionModels(ccfg,role);
      const visionKiroFreeQuota=ccfg.allowKiroFreeQuotaVision===true;
      const visionKiroFallback=ccfg.allowKiroVisionFallback===true;
      const local=localVisionConfig();
      const kiroFreeQuotaVisionModels=uniqueModels(Array.isArray(ccfg.kiroFreeQuotaVisionModels)?ccfg.kiroFreeQuotaVisionModels:[]).filter(x=>(cfg.kiro||[]).includes(x));
      return send(res,200,{
        ok:true,
        freeFirst:true,
        roles:routes,
        visionRoutes,
        judges:ccfg.judges||[],
        kiroJudgeOnly:true,
        localVisionEnabled:local.enabled,
        localVisionModels:local.models,
        localVisionBaseUrl:local.baseUrl||null,
        localVisionContextSize:local.contextSize,
        localVisionTimeoutMs:local.timeoutMs,
        localVisionOnly:local.localOnly,
        localVisionTwoStage:true,
        localVisionBatchSize:1,
        localVisionSingleTf:true,
        localVisionCompactFinalize:true,
        localVisionTfContract:true,
        localVisionSplitGlobal:true,
        localVisionDirectPipeline:true,
        localVisionFirst:true,
        visionKiroFreeQuota,
        kiroFreeQuotaVisionModels,
        visionKiroFallback,
        paidVisionFallbackEnabled:visionKiroFallback,
        openRouterJev:jev.localStatus(),
        note:local.enabled
          ? (local.localOnly
              ? '9TF Vision uses only the explicitly enabled loopback Ollama model; text-only routing remains on 9Router. Local Vision failure is fail-closed and no remote Vision fallback is attempted.'
              : '9TF Vision uses explicitly enabled loopback Ollama first; text-only routing remains on 9Router. Missing local Vision remains fail-closed and no paid provider is enabled.')
          : (visionKiroFreeQuota
              ? '9TF Vision may use only the explicitly allowlisted Kiro connected-account quota models after free OpenCode attempts. This opt-in does not enable any separate paid API provider.'
              : (visionKiroFallback
                  ? 'Legacy Kiro Vision fallback is explicitly enabled.'
                  : 'Local/Kiro Vision is disabled until explicit opt-in; missing Vision remains fail-closed.'))
      });
    }
    if(req.method==='GET'&&u.pathname==='/vision/progress'){
      return send(res,200,{ok:true,...localVisionProgress,queueDepth:localVisionQueueDepth});
    }
    if(req.method==='GET'&&u.pathname==='/vision/probe'){
      const symbol=String(u.searchParams.get('symbol')||'BTCUSDT').trim().toUpperCase();
      if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      const pack=await pipeline.buildVisionCharts(symbol,128,{visionProbe:true});
      if(!pack?.ok)return send(res,503,{ok:false,error:'vision charts incomplete',symbol,charts:{attached:pack?.attached||0,required:pack?.required||9,failures:pack?.failures||[]}});
      try{
        const out=await committeeCall({
          role:'STRUCTURE',
          system:'Vision transport diagnostic only. Inspect every attached timeframe image. Read only the diagnostic color marker requested in the prompt. Do not give trading advice and do not place orders. The diagnostic marker is not market evidence.',
          prompt:pipeline.visionPixelProbePrompt(),
          images:pack.images,
          forceVisionProbe:true
        });
        const visualVerification=pipeline.evaluateVisionPixelProbe(out.text,pack.frames);
        const payload={
          symbol,
          charts:{attached:pack.attached,required:pack.required,barsRequested:pack.barsRequested,mode:pack.mode},
          vision:out.vision||null,
          model:out.model||'',
          mode:out.mode||'',
          degraded:out.degraded===true,
          requiredAnalystReplies:out.requiredAnalystReplies||null,
          requiredVisionAnalystReplies:out.requiredVisionAnalystReplies||null,
          receivedAnalystReplies:out.receivedAnalystReplies||0,
          failed:Array.isArray(out.failed)?out.failed:[],
          visualVerification,
          text:String(out.text||'').slice(0,1200)
        };
        if(!visualVerification.ok)return send(res,503,{ok:false,error:'vision pixel verification failed',...payload});
        return send(res,200,{ok:true,...payload});
      }catch(e){
        return send(res,503,{ok:false,error:'vision probe failed',symbol,detail:String(e.message||e).slice(0,1200),charts:{attached:pack.attached,required:pack.required,barsRequested:pack.barsRequested,mode:pack.mode},committee:e.committee||null});
      }
    }
    if(req.method==='POST'&&u.pathname==='/ask'){
      const raw=await readBody(req);
      let j={};try{j=JSON.parse(raw||'{}');}catch{return send(res,400,{ok:false,error:'invalid json'});}
      if(!j.prompt||typeof j.prompt!=='string')return send(res,400,{ok:false,error:'prompt required'});
      try{
        const out=await ask(j.prompt,j.system||'',j.model||'',j.role||'DEFAULT');
        return send(res,200,{ok:true,...out});
      }catch(e){
        return send(res,503,{ok:false,error:e.message,details:e.errors||[]});
      }
    }

    if(req.method==='POST'&&u.pathname==='/committee'){
      let ccfg={};
      try{ccfg=readCommitteeConfig();}
      catch(e){return send(res,500,{ok:false,error:'committee config error',detail:String(e.message||e)});}
      const raw=await readBody(req,8*1024*1024);
      let j={};
      try{j=JSON.parse(raw||'{}');}catch{return send(res,400,{ok:false,error:'invalid json'});}
      if(!j.prompt||typeof j.prompt!=='string')return send(res,400,{ok:false,error:'prompt required'});
      const vision=multimodalUserContent(j.prompt,j.images);
      const directLocal=localVisionConfig();
      if(vision.images.length&&directLocal.enabled&&directLocal.localOnly){
        try{
          const out=await runLocalVisionCommittee(j);
          return send(res,200,out);
        }catch(e){
          const c=e&&e.committee&&typeof e.committee==='object'?e.committee:null;
          return send(res,503,c||{ok:false,error:'no vision analyst replies',detail:String(e?.message||e).slice(0,800)});
        }
      }

      const role=normalizeRole(j.role||'DEFAULT');
      const configured=[...(Array.isArray(ccfg.analysts)?ccfg.analysts:[]),...(Array.isArray(ccfg.backupAnalysts)?ccfg.backupAnalysts:[])];
      const freeSet=new Set(cfg.opencode||[]);
      const eligible=(configured.length?configured:[...(cfg.opencode||[])]).filter(x=>freeSet.has(x));
      const hasVision=vision.images.length>0;
      const forceVisionProbe=hasVision&&j.forceVisionProbe===true;
      const routed=hasVision
        ? orderedVisionModels(ccfg,role,forceVisionProbe)
        : rankPool(eligible.length?eligible:[...(cfg.opencode||[])],role,true);
      const judges=Array.isArray(ccfg.judges)?ccfg.judges:[];
      const minReplies=Math.max(1,Number(ccfg.minAnalystReplies||2));
      const minVisionReplies=Math.max(1,Number(ccfg.minVisionAnalystReplies||1));
      const requiredReplies=hasVision?minVisionReplies:minReplies;
      const textParallel=Math.max(1,Math.min(Number(ccfg.parallelAnalysts||3),routed.length||1));
      const visionParallel=Math.max(1,Math.min(2,Number(ccfg.visionParallelAnalysts||1),routed.length||1));
      const parallel=hasVision?visionParallel:textParallel;
      const visionTimeoutMs=Math.max(30000,Math.min(180000,Number(ccfg.visionTimeoutMs||90000)));
      const localVision=localVisionConfig();
      const localTwoStage=hasVision&&!forceVisionProbe&&localVision.enabled&&localVision.localOnly&&routed.length===1&&String(routed[0]||'').startsWith('local/');
      const messages=[];
      const system=[roleInstruction(role),String(j.system||'').trim()].filter(Boolean).join(' ');
      if(system)messages.push({role:'system',content:system});
      messages.push({role:'user',content:vision.content});

      async function probe(model){
        if(hasVision?!forceVisionProbe&&visionBlocked(model):blocked(model))return {ok:false,model,error:hasVision?'vision cooldown':'cooldown',durationMs:0};
        const started=Date.now();
        try{
          const modelTimeoutMs=hasVision&&String(model).startsWith('local/')
            ? Math.max(visionTimeoutMs,localVision.timeoutMs)
            : (hasVision?visionTimeoutMs:20000);
          if(localTwoStage&&String(model).startsWith('local/')){
            const batchTexts=[];
            const batchDurations=[];
            const visionStarted=Date.now();
            for(const batch of visionBatches(j.images,3)){
              const visualInput=multimodalUserContent(localVisionExtractionPrompt(batch),batch);
              const visualMessages=[
                {role:'system',content:'You are the local Brain Hub visual extractor. Read every attached timeframe image. Return only the requested VIS_* lines. Do not place orders.'},
                {role:'user',content:visualInput.content}
              ];
              const batchStarted=Date.now();
              const visual=await callModel(model,visualMessages,modelTimeoutMs,{temperature:0,maxTokens:600});
              batchDurations.push(Date.now()-batchStarted);
              batchTexts.push(pipeline.formatSingleVisionPixelReply(String(batch[0]?.tf||''),visual.text));
            }
            const visionDurationMs=Date.now()-visionStarted;
            const visionText=batchTexts.filter(Boolean).join('\n');
            const finalizeStarted=Date.now();
            const finalized=await callModel(
              model,
              localVisionFinalizeMessages(role,j.system||'',j.prompt,visionText),
              Math.max(120000,localVision.timeoutMs),
              {temperature:0,maxTokens:4096}
            );
            const finalizeDurationMs=Date.now()-finalizeStarted;
            const durationMs=Date.now()-started;
            visionState.set(model,{ok:true,at:Date.now(),error:null,durationMs});
            return {
              ok:true,model,text:finalized.text,durationMs,
              localVisionTwoStage:true,
              localVisionBatchSize:1,
              visionExtractionText:visionText.slice(0,5000),
              visionDurationMs,batchDurations,finalizeDurationMs
            };
          }
          if(forceVisionProbe&&localVision.enabled&&localVision.localOnly&&String(model).startsWith('local/')&&vision.images.length>3){
            const batchTexts=[];
            const batchDurations=[];
            for(const batch of visionBatches(j.images,3)){
              const visualInput=multimodalUserContent(localPixelBatchPrompt(batch),batch);
              const visualMessages=[
                {role:'system',content:'You are a visual transport diagnostic. Read the magenta cell position in the attached grid. Return exactly one digit from 1 to 9, with no labels or explanation.'},
                {role:'user',content:visualInput.content}
              ];
              const batchStarted=Date.now();
              const visual=await callModel(model,visualMessages,modelTimeoutMs,{temperature:0,maxTokens:192});
              batchDurations.push(Date.now()-batchStarted);
              batchTexts.push(pipeline.formatSingleVisionPixelReply(String(batch[0]?.tf||''),visual.text));
            }
            const durationMs=Date.now()-started;
            const text=batchTexts.filter(Boolean).join('\n');
            visionState.set(model,{ok:true,at:Date.now(),error:null,durationMs});
            return {ok:true,model,text,durationMs,localVisionTwoStage:false,localVisionPixelBatched:true,localVisionBatchSize:1,batchDurations};
          }
          const r=await callModel(model,messages,modelTimeoutMs);
          const durationMs=Date.now()-started;
          if(hasVision)visionState.set(model,{ok:true,at:Date.now(),error:null,durationMs});
          return {ok:true,model,text:r.text,durationMs,localVisionTwoStage:false};
        }catch(e){
          const durationMs=Date.now()-started;
          const msg=String(e.message||e).slice(0,400);
          if(hasVision)visionState.set(model,{ok:false,at:Date.now(),error:msg,durationMs});
          else state.set(model,{ok:false,at:Date.now(),error:msg});
          return {ok:false,model,error:msg,durationMs};
        }
      }

      let results=[];
      let good=[];
      if(hasVision){
        for(let i=0;i<routed.length&&good.length<requiredReplies;i+=parallel){
          const batch=await Promise.all(routed.slice(i,i+parallel).map(probe));
          results.push(...batch);
          good=results.filter(x=>x.ok&&x.text);
        }
      }else{
        results=await Promise.all(routed.slice(0,parallel).map(probe));
        good=results.filter(x=>x.ok&&x.text);
        for(const m of routed.slice(parallel)){
          if(good.length>=requiredReplies)break;
          const r=await probe(m);
          results.push(r);
          if(r.ok&&r.text)good.push(r);
        }
      }
      if(good.length===0){
        const directFailures=results.filter(x=>!x.ok).slice(0,12);
        const allVisionCandidates=hasVision?orderedVisionModels(ccfg,role,true):[];
        const cooldownFailures=hasVision
          ? allVisionCandidates
              .filter(model=>visionBlocked(model))
              .map(model=>{
                const st=visionState.get(model) || {};
                return {
                  model,
                  error:String(st.error || 'vision cooldown').slice(0,400),
                  durationMs:Number(st.durationMs || 0),
                  lastFailureAt:Number(st.at || 0),
                  cooldown:true
                };
              })
          : [];
        const seen=new Set();
        const failures=[...directFailures,...cooldownFailures]
          .filter(x=>{
            const key=String(x?.model || '')+'|'+String(x?.error || '');
            if(seen.has(key))return false;
            seen.add(key);
            return true;
          })
          .slice(0,12);
        return send(res,503,{
          ok:false,
          error:hasVision?'no vision analyst replies':'no analyst replies',
          role,
          required:requiredReplies,
          received:0,
          vision:{attached:vision.images.length,timeframes:vision.images.map(x=>x.tf),modes:vision.images.map(x=>x.mode)},
          attemptedModels:results.map(x=>x.model),
          cooldownModels:cooldownFailures.map(x=>x.model),
          forceVisionProbe:forceVisionProbe||false,
          visionTimeoutMs:hasVision?visionTimeoutMs:null,
          visionParallelAnalysts:hasVision?visionParallel:null,
          localVisionTwoStage:localTwoStage,
          localVisionBatchSize:(localTwoStage||(forceVisionProbe&&localVision.enabled&&localVision.localOnly))?1:null,
          failures
        });
      }
      const degraded=good.length<minReplies;

      const norm=t=>String(t||'').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
      const exact=new Set(good.map(x=>norm(x.text))).size===1;
      const verdict=t=>{
        const z=String(t||'').toUpperCase().replace(/[- ]/g,'_');
        const m=z.match(/\b(NO_TRADE|LONG|SHORT|WAIT|HOLD|REJECT)\b/);
        return m?m[1]:null;
      };
      const vs=good.map(x=>verdict(x.text));
      const verdictConsensus=vs.every(Boolean)&&new Set(vs).size===1;
      const disagreement=!exact&&!verdictConsensus;
      const needJudge=j.forceJudge===true||(ccfg.judgeOnlyOnDisagreement!==false&&disagreement);

      const bundle=good.map((x,i)=>'ANALYST_'+(i+1)+' '+x.model+'\n'+x.text).join('\n\n---\n\n');
      let finalText='';
      let finalModel='';
      let judge=null;

      if(needJudge&&judges.length){
        const jp=[
          {role:'system',content:'You are the committee judge. Resolve conflicts using only supplied analyst answers and source context. Preserve the exact output schema and every required field requested in ORIGINAL REQUEST, including SUPPORT_TFS, VETO_TFS, FORMING_CONTEXT, all TF_* summary/WHY/WAIT/ROLE/FORMING/RISK lines, and VISION_SUMMARY when present. Do not invent facts, do not infer hidden market-maker intent, and do not place orders.'},
          {role:'user',content:'ROLE: '+role+'\nORIGINAL REQUEST:\n'+j.prompt+'\n\nANALYST ANSWERS:\n'+bundle}
        ];
        for(const m of judges){
          try{
            const r=await callModel(m,jp,20000);
            finalText=r.text;finalModel=m;judge={used:true,model:m};break;
          }catch(e){
            judge={used:false,lastModel:m,error:String(e.message||e).slice(0,240)};
          }
        }
      }

      if(!finalText&&hasVision&&good.length===1){
        finalText=good[0].text;
        finalModel=good[0].model;
      }
      if(!finalText){
        const synth=hasVision?(good[0]?.model||orderedModels(role)[0]):(orderedModels(role)[0]||good[0].model);
        const sp=[
          {role:'system',content:'Synthesize the analyst answers into one final answer. Preserve consensus and material disagreement, but most importantly preserve the exact output schema and every required field requested in ORIGINAL REQUEST. Preserve STATUS, SIDE, CONFIDENCE, ORIGIN_TF, OWNER_TF, SETUP, EXEC_PATH, WHY, RISK_NOTE, WAIT_FOR, SUPPORT_TFS, VETO_TFS, FORMING_CONTEXT, every TF_* summary/WHY/WAIT/ROLE/FORMING/RISK line, VISION_SUMMARY and EXECUTION. Return plain labeled lines only: no Markdown, bullets, table, JSON, code fence, heading or extra prose. Use only supplied facts. This is advisory only.'},
          {role:'user',content:'ROLE: '+role+'\nORIGINAL REQUEST:\n'+j.prompt+'\n\nANALYST ANSWERS:\n'+bundle}
        ];
        try{
          const r=await callModel(synth,sp,20000);
          finalText=r.text;finalModel=synth;
        }catch{
          finalText=good[0].text;finalModel=good[0].model;
        }
      }

      log('COMMITTEE OK role='+role+' analysts='+good.length+' degraded='+(degraded?'yes':'no')+' disagreement='+disagreement+' judge='+(judge&&judge.used?judge.model:'no')+' visionCharts='+vision.images.length);
      return send(res,200,{ok:true,role,mode:degraded?'degraded_single':(judge&&judge.used?'judge':'consensus'),degraded,degradedReason:degraded?'DEGRADED_1_ANALYST':null,requiredAnalystReplies:minReplies,requiredVisionAnalystReplies:hasVision?minVisionReplies:null,receivedAnalystReplies:good.length,forceVisionProbe:forceVisionProbe||false,visionTimeoutMs:hasVision?visionTimeoutMs:null,visionParallelAnalysts:hasVision?visionParallel:null,localVisionTwoStage:localTwoStage,localVisionBatchSize:(localTwoStage||(forceVisionProbe&&localVision.enabled&&localVision.localOnly))?1:null,visionKiroFreeQuota:hasVision&&ccfg.allowKiroFreeQuotaVision===true,disagreement,verdictConsensus:verdictConsensus?(vs[0]||null):null,vision:{attached:vision.images.length,timeframes:vision.images.map(x=>x.tf),modes:vision.images.map(x=>x.mode)},analysts:good,failed:results.filter(x=>!x.ok),judge:judge||{used:false},model:finalModel,text:finalText});
    }

    if(req.method==='GET'&&u.pathname==='/scanner'){
      try{return send(res,200,await scanner.scan());}
      catch(e){log('SCANNER FAIL '+String(e.message||e));return send(res,503,{ok:false,error:'scanner failed',detail:String(e.message||e)});}
    }
    if(req.method==='GET'&&u.pathname==='/context/global')return send(res,200,await market.globalContext());
    if(req.method==='GET'&&u.pathname==='/context/symbol'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      return send(res,200,await market.symbolContext(symbol));
    }
    if(req.method==='GET'&&u.pathname==='/context/unified'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      const [sym,global,scan]=await Promise.all([market.symbolContext(symbol),market.globalContext(),scanner.scan()]);
      const unified=pipeline.buildUnifiedContext({symbol:sym,global,candidate:candidateForSymbol(scan,symbol)});
      return send(res,200,{ok:true,...unified});
    }
    if(req.method==='GET'&&u.pathname==='/chart/data'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      const tf=(u.searchParams.get('tf')||'15m').toLowerCase();
      const bars=Number(u.searchParams.get('bars')||128);
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      try{return send(res,200,await market.chartContext(symbol,tf,bars));}
      catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    if(req.method==='GET'&&u.pathname==='/chart/png'){
      const symbol=(u.searchParams.get('symbol')||'').toUpperCase();
      const tf=(u.searchParams.get('tf')||'15m').toLowerCase();
      const mode=(u.searchParams.get('mode')||'clean').toLowerCase();
      const bars=Number(u.searchParams.get('bars')||128);
      if(!market.validSymbol(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      try{
        const chart=await market.chartContext(symbol,tf,bars);
        const png=market.renderChartPng(chart,mode);
        return sendBuffer(res,200,png,'image/png',{'x-brainhub-symbol':symbol,'x-brainhub-timeframe':tf,'x-brainhub-chart-mode':mode});
      }catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    if(req.method==='GET'&&u.pathname==='/leader/committee'){
      const scan=await scanner.scan();
      const leaderCommittee=require('./leader-committee');
      return send(res,200,await leaderCommittee.run({scan,port:PORT,token:CLIENT_TOKEN}));
    }
    if(req.method==='GET'&&u.pathname==='/leader/detail-probe'){
      try{
        const scan=await scanner.scan();
        const leaderCommittee=require('./leader-committee');
        const candidate=leaderCommittee.detailProbeCandidate(scan,16);
        if(!candidate)return send(res,200,{ok:true,candidateFound:false,reason:'NO_VALID_USDT_PERPETUAL_DEEP_SCAN_CANDIDATE',analysisOnly:true,execution:'ADVISORY_ONLY',orderPlaced:false});
        const out=await decisionPipeline.run({
          scan,
          store,
          committee:committeeCall,
          executionIntent:{symbol:String(candidate.symbol||'').toUpperCase(),side:String(candidate.side||'').toUpperCase(),analysisTracking:true}
        });
        return send(res,200,{...out,analysisOnly:true,detailProbe:true,execution:'ADVISORY_ONLY',orderPlaced:false});
      }catch(e){
        const detail=String(e?.stack||e?.message||e).slice(0,2400);
        log('LEADER DETAIL PROBE FAIL '+detail);
        return send(res,503,{ok:false,error:'leader detail probe failed',detail:String(e?.message||e).slice(0,1200),analysisOnly:true,execution:'ADVISORY_ONLY',orderPlaced:false});
      }
    }
    if(req.method==='GET'&&u.pathname==='/leader/plan'){
      try{
        const scan=await scanner.scan();
        const out=await decisionPipeline.run({scan,store,committee:committeeCall});
        return send(res,200,out);
      }catch(e){
        const detail=String(e?.stack||e?.message||e).slice(0,2400);
        log('LEADER PLAN FAIL '+detail);
        return send(res,503,{ok:false,error:'leader plan failed',detail:String(e?.message||e).slice(0,1200)});
      }
    }
    if(req.method==='GET'&&u.pathname==='/journal')return send(res,200,{ok:true,items:store.getJournal(u.searchParams.get('limit'))});
    if(req.method==='GET'&&u.pathname==='/learning')return send(res,200,{ok:true,...store.learning()});
    if(req.method==='POST'&&u.pathname==='/journal/outcome'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      try{return send(res,200,{ok:store.label(body.id,body.outcome)});}catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    if(req.method==='POST'&&u.pathname==='/lease'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      try{return send(res,200,{ok:true,...store.lease(body.action,body.resource,body.owner,body.token,body.ttlMs)});}catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    if(req.method==='POST'&&u.pathname==='/execution/claim'){
      let body;try{body=JSON.parse(await readBody(req));}catch{return send(res,400,{ok:false,error:'invalid json'});}
      try{return send(res,200,{ok:true,...store.claim(body.eventId,body.owner,body.resource,body.token,body.lineageId||body.eventId)});}catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
    }
    return send(res,404,{ok:false,error:'not found'});
  }catch(e){
    log('SERVER '+String(e.stack||e));
    return send(res,500,{ok:false,error:'server error'});
  }
});

server.listen(PORT,HOST,()=>log('BrainHub listening on http://'+HOST+':'+PORT));

const openRouterBillingTimer=setInterval(()=>{jev.billingStatus({force:true}).catch(()=>{});},300000);
if(typeof openRouterBillingTimer.unref==='function')openRouterBillingTimer.unref();

const activePositionReviewTimer=setInterval(async()=>{
  try{
    const out=await live.activePositionReviewTick();
    if(out?.ok===true&&out?.skipped!==true){
      log('POSITION REVIEW symbol='+(out.symbol||'unknown')+' action='+(out.action||'unknown')+' ownerTF='+(out.ownerTF||'unknown'));
    }else if(out?.ok===false&&out?.skipped!==true){
      log('POSITION REVIEW ERROR '+String(out?.reason||'unknown').slice(0,180));
    }
  }catch(e){log('POSITION REVIEW TIMER '+String(e?.message||e).slice(0,180));}
},300000);
if(typeof activePositionReviewTimer.unref==='function')activePositionReviewTimer.unref();

const leaderAutoTimer=setInterval(async()=>{
  try{
    const out=await live.leaderAutoTick();
    if(out?.orderPlaced===true){
      log('LEADER AUTO ORDER symbol='+(out?.leaderIntent?.symbol||out?.symbol||'unknown')+' execution='+(out?.execution||'unknown'));
    }else if(out?.ok===false&&out?.skipped!==true){
      log('LEADER AUTO BLOCK execution='+(out?.execution||'unknown')+' reasons='+JSON.stringify(out?.reasons||[]));
    }
  }catch(e){
    log('LEADER AUTO TIMER '+String(e?.message||e).slice(0,200));
  }
},60000);
if(typeof leaderAutoTimer.unref==='function')leaderAutoTimer.unref();
