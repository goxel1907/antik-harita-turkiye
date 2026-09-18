const http=require('http');
const fs=require('fs');
const path=require('path');
const scanner=require('./scanner');
const market=require('./market');
const pipeline=require('./pipeline');
const {openStore}=require('./store');
const {createLiveController}=require('./live-controller');

const ROOT=process.env.BRAINHUB_ROOT||path.resolve(__dirname,'..');
const CFG=path.join(ROOT,'config','models.json');
const LOG=path.join(ROOT,'logs','brainpub.log');
const cfg=JSON.parse(fs.readFileSync(CFG,'utf8').replace(/^\uFEFF/,''));
const KEY=(process.env.BRAINHUB_ROUTER_KEY||'').trim();
const HOST=process.env.BRAINHUB_HOST||'127.0.0.1';
const PORT=Number(process.env.BRAINHUB_PORT||8787);
const CLIENT_TOKEN=(process.env.BRAINHUB_CLIENT_TOKEN||'').trim();
const BINANCE_CREDENTIALS={
  apiKey:(process.env.BRAINHUB_BINANCE_API_KEY||'').trim(),
  apiSecret:(process.env.BRAINHUB_BINANCE_API_SECRET||'').trim()
};
const TTL=(Number(cfg.healthCacheSeconds)||600)*1000;
if(!KEY){console.error('BRAINHUB_ROUTER_KEY missing');process.exit(2);}
if(HOST!=='127.0.0.1'&&HOST!=='::1'&&CLIENT_TOKEN.length<32){console.error('BRAINHUB_CLIENT_TOKEN (32+ chars) required for non-loopback binding');process.exit(2);}
const store=openStore(ROOT);

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
  return require('crypto').timingSafeEqual(Buffer.from(supplied),Buffer.from(CLIENT_TOKEN));
}
const OPENCODE_OFFICIAL_FREE_INFERENCE='https://opencode.ai/inference/openai/v1/chat/completions';
const OPENCODE_OFFICIAL_FREE_MODELS=new Set(['mimo-v2.5-free','big-pickle']);
function isOpenCodeFreeRestriction(status,raw){
  const text=String(raw||'');
  return Number(status)===403 && /FreeTierError|free tier can only be used from within OpenCode/i.test(text);
}
function openCodeFreeId(model){
  const m=String(model||'').trim();
  return m.startsWith('oc/')?m.slice(3):'';
}
async function callOfficialOpenCodeFree(model,messages,timeoutMs){
  const id=openCodeFreeId(model);
  if(!OPENCODE_OFFICIAL_FREE_MODELS.has(id))throw new Error('official free inference model not allowed: '+id);
  const r=await fetch(OPENCODE_OFFICIAL_FREE_INFERENCE,{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({model:id,messages}),
    signal:AbortSignal.timeout(Math.max(30000,Number(timeoutMs)||90000))
  });
  const raw=await r.text();
  if(!r.ok)throw new Error('OpenCode official free inference HTTP '+r.status+' '+raw.slice(0,500));
  const text=extract(raw);
  if(!text)throw new Error('OpenCode official free inference empty response');
  return {model,text,transport:'opencode-official-free-inference'};
}
async function probeOfficialOpenCodeFree(){
  try{
    const r=await fetch('https://opencode.ai/zen/v1/models',{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
    const raw=await r.text();
    if(!r.ok)return {ok:false,status:r.status,error:raw.slice(0,300)};
    const j=JSON.parse(raw||'{}');
    const ids=new Set((Array.isArray(j?.data)?j.data:[]).map(x=>String(x?.id||'')));
    return {ok:true,status:r.status,mimoListed:ids.has('mimo-v2.5-free'),bigPickleListed:ids.has('big-pickle')};
  }catch(e){
    return {ok:false,error:String(e?.message||e).slice(0,400)};
  }
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
async function callModel(model,messages,timeoutMs=12000){
  const url=cfg.baseUrl+'/chat/completions';
  const r=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+KEY,'content-type':'application/json'},body:JSON.stringify({model,messages}),signal:AbortSignal.timeout(timeoutMs)});
  const raw=await r.text();
  if(!r.ok){
    const id=openCodeFreeId(model);
    const canOfficial=cfg.opencodeOfficialFreeInferenceFallback!==false && OPENCODE_OFFICIAL_FREE_MODELS.has(id) && isOpenCodeFreeRestriction(r.status,raw);
    if(canOfficial){
      try{
        const official=await callOfficialOpenCodeFree(model,messages,timeoutMs);
        state.set(model,{ok:true,at:Date.now(),error:null,transport:official.transport});
        log('OPENCODE OFFICIAL FREE FALLBACK OK model='+model);
        return official;
      }catch(e){
        const detail=String(e?.message||e).slice(0,700);
        throw new Error('OpenCode 9Router free route blocked; official free inference fallback failed: '+detail);
      }
    }
    throw new Error('HTTP '+r.status+' '+raw.slice(0,300));
  }
  const text=extract(raw);
  if(!text)throw new Error('empty response');
  state.set(model,{ok:true,at:Date.now(),error:null,transport:'9router'});
  return {model,text,transport:'9router'};
}
function recentFailure(map,model){
  const s=map.get(model);
  return !!(s&&s.ok===false&&(Date.now()-s.at)<TTL);
}
function blocked(model){ return recentFailure(state,model); }
function visionBlocked(model){ return recentFailure(visionState,model); }
function uniqueModels(xs){ return [...new Set((xs||[]).filter(Boolean))]; }
function orderedVisionModels(ccfg,role='STRUCTURE',includeCooldown=false){
  const free=uniqueModels(cfg.opencode||[]);
  const kiro=uniqueModels(cfg.kiro||[]);
  const allowed=new Set([...free,...kiro]);
  const explicit=uniqueModels([...(ccfg?.visionAnalysts||[]),...(ccfg?.visionBackupAnalysts||[])]).filter(x=>allowed.has(x));
  const general=uniqueModels([...(ccfg?.analysts||[]),...(ccfg?.backupAnalysts||[])]).filter(x=>allowed.has(x));
  const freePool=uniqueModels([...explicit.filter(x=>free.includes(x)),...general.filter(x=>free.includes(x)),...free]);
  const kiroPool=uniqueModels([...explicit.filter(x=>kiro.includes(x)),...general.filter(x=>kiro.includes(x)),...kiro]);
  const preferHealthy=xs=>[
    ...xs.filter(x=>visionState.get(x)?.ok===true),
    ...xs.filter(x=>visionState.get(x)?.ok!==true&&(includeCooldown||!visionBlocked(x)))
  ];
  const visionRank=xs=>{
    const roleRanked=rankPool(xs,role,true);
    const hint=m=>{
      const z=String(m||'').toLowerCase();
      if(z.includes('mimo-v2.5-free'))return 0;
      if(z.includes('vision'))return 1;
      if(z.includes('muse-spark-1.3'))return 2;
      if(z.includes('muse-spark-1.2'))return 3;
      return 9;
    };
    return roleRanked.map((model,index)=>({model,index,hint:hint(model)}))
      .sort((a,b)=>a.hint-b.hint||a.index-b.index).map(x=>x.model);
  };
  const allowKiro=ccfg?.allowKiroVisionFallback === true;
  const rankedFree=visionRank(preferHealthy(freePool));
  const maxFree=allowKiro?Math.max(1,Math.min(6,Number(ccfg?.maxFreeVisionAttempts||3))):rankedFree.length;
  return uniqueModels([
    ...rankedFree.slice(0,maxFree),
    ...(allowKiro?visionRank(preferHealthy(kiroPool)):[])
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
async function committeeCall(body){
  const r=await fetch('http://127.0.0.1:'+PORT+'/committee',{method:'POST',headers:{'content-type':'application/json',...(CLIENT_TOKEN?{authorization:'Bearer '+CLIENT_TOKEN}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
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
const live=createLiveController({root:ROOT,store,scanner,pipeline,committee:committeeCall,credentials:BINANCE_CREDENTIALS});

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://127.0.0.1');
    if(!authorized(req))return send(res,401,{ok:false,error:'unauthorized'});
    if(req.method==='GET'&&u.pathname==='/health'){
      const ls=live.status();
      return send(res,200,{ok:true,time:new Date().toISOString(),host:HOST,port:PORT,routerKeyLoaded:true,version:'brainhub-pro-1',featureVersion:'9.5.95-VISION',execution:ls.armed?'LIVE_ARMED_PER_ORDER_GRANT_REQUIRED':'ADVISORY_ONLY',live:{configured:ls.liveConfigured,armed:ls.armed,expiresAt:ls.expiresAt},database:'sqlite',router:'9Router',configured:{opencode:(cfg.opencode||[]).length,kiro:(cfg.kiro||[]).length,total:(cfg.opencode||[]).length+(cfg.kiro||[]).length},features:['UNIFIED_9TF','CAUSAL_45M','ROLE_ROUTING','FAILED_BREAKOUT_GUARD','CHART_DATA','CHART_PNG_CLEAN','CHART_PNG_ANNOTATED','VISION_COMMITTEE_INPUT','VISION_CAPABILITY_FALLBACK','VISION_PROBE','OPENCODE_OFFICIAL_FREE_INFERENCE','LIVE_FAIL_CLOSED']});
    }
    if(req.method==='GET'&&u.pathname==='/live/status')return send(res,200,live.status());
    if(req.method==='GET'&&u.pathname==='/live/account'){
      const out=await live.accountSummary();
      return send(res,out?.ok?200:503,out);
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
    if(req.method==='GET'&&u.pathname==='/opencode/status'){
      const official=await probeOfficialOpenCodeFree();
      return send(res,official.ok?200:503,{ok:official.ok,official,freeInferenceFallbackEnabled:cfg.opencodeOfficialFreeInferenceFallback!==false,models:[...OPENCODE_OFFICIAL_FREE_MODELS],note:official.ok?'Official OpenCode free model catalog is reachable; supported BrainHub fallback uses the documented free inference endpoint without paid/Kiro routing.':'Official OpenCode model catalog is not reachable from this PC.'});
    }
    if(req.method==='GET'&&u.pathname==='/models/healthy'){
      const models=[...(cfg.opencode||[]),...(cfg.kiro||[])].map(model=>({
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
      const visionKiroFallback=ccfg.allowKiroVisionFallback===true;
      return send(res,200,{ok:true,freeFirst:true,roles:routes,visionRoutes,judges:ccfg.judges||[],kiroJudgeOnly:true,visionKiroFallback,note:visionKiroFallback?'Text-only routes keep Kiro for judge duty; 9TF image requests may use Kiro only after explicit Vision fallback opt-in and failed free OpenCode candidates.':'Kiro Vision fallback is disabled by default; 9TF image analysis remains free-only unless explicitly enabled. API keys are never exposed here.'});
    }
    if(req.method==='GET'&&u.pathname==='/vision/probe'){
      const symbol=String(u.searchParams.get('symbol')||'BTCUSDT').trim().toUpperCase();
      if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol))return send(res,400,{ok:false,error:'invalid symbol'});
      const pack=await pipeline.buildVisionCharts(symbol,128);
      if(!pack?.ok)return send(res,503,{ok:false,error:'vision charts incomplete',symbol,charts:{attached:pack?.attached||0,required:pack?.required||9,failures:pack?.failures||[]}});
      try{
        const out=await committeeCall({
          role:'STRUCTURE',
          system:'Vision transport diagnostic only. Inspect every attached timeframe image. Do not give trading advice and do not place orders.',
          prompt:'Return exactly one line in this form: VISION_OK: <comma-separated timeframes you actually received>. Do not infer or invent missing charts.',
          images:pack.images,
          forceVisionProbe:true
        });
        return send(res,200,{ok:true,symbol,charts:{attached:pack.attached,required:pack.required,barsRequested:pack.barsRequested,mode:pack.mode},vision:out.vision||null,model:out.model||'',mode:out.mode||'',degraded:out.degraded===true,requiredAnalystReplies:out.requiredAnalystReplies||null,requiredVisionAnalystReplies:out.requiredVisionAnalystReplies||null,receivedAnalystReplies:out.receivedAnalystReplies||0,failed:Array.isArray(out.failed)?out.failed:[],text:String(out.text||'').slice(0,500)});
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
      const messages=[];
      const system=[roleInstruction(role),String(j.system||'').trim()].filter(Boolean).join(' ');
      if(system)messages.push({role:'system',content:system});
      messages.push({role:'user',content:vision.content});

      async function probe(model){
        if(hasVision?!forceVisionProbe&&visionBlocked(model):blocked(model))return {ok:false,model,error:hasVision?'vision cooldown':'cooldown',durationMs:0};
        const started=Date.now();
        try{
          const r=await callModel(model,messages,hasVision?visionTimeoutMs:20000);
          const durationMs=Date.now()-started;
          if(hasVision)visionState.set(model,{ok:true,at:Date.now(),error:null,durationMs});
          return {ok:true,model,text:r.text,durationMs};
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
        const failures=results.filter(x=>!x.ok).slice(0,12);
        return send(res,503,{
          ok:false,
          error:hasVision?'no vision analyst replies':'no analyst replies',
          role,
          required:requiredReplies,
          received:0,
          vision:{attached:vision.images.length,timeframes:vision.images.map(x=>x.tf),modes:vision.images.map(x=>x.mode)},
          attemptedModels:results.map(x=>x.model),
          forceVisionProbe:forceVisionProbe||false,
          visionTimeoutMs:hasVision?visionTimeoutMs:null,
          visionParallelAnalysts:hasVision?visionParallel:null,
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
          {role:'system',content:'You are the committee judge. Resolve conflicts using only supplied analyst answers and source context. Preserve the exact output schema and every required field requested in ORIGINAL REQUEST, including all TF_* lines and VISION_SUMMARY when present. Do not invent facts, do not infer hidden market-maker intent, and do not place orders.'},
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
          {role:'system',content:'Synthesize the analyst answers into one final answer. Preserve consensus and material disagreement, but most importantly preserve the exact output schema and every required field requested in ORIGINAL REQUEST. If ORIGINAL REQUEST asks for TF_1M..TF_1D, WHY, RISK_NOTE, WAIT_FOR or VISION_SUMMARY, all of those fields must remain present. Use only supplied facts. This is advisory only.'},
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
      return send(res,200,{ok:true,role,mode:degraded?'degraded_single':(judge&&judge.used?'judge':'consensus'),degraded,degradedReason:degraded?'DEGRADED_1_ANALYST':null,requiredAnalystReplies:minReplies,requiredVisionAnalystReplies:hasVision?minVisionReplies:null,receivedAnalystReplies:good.length,forceVisionProbe:forceVisionProbe||false,visionTimeoutMs:hasVision?visionTimeoutMs:null,visionParallelAnalysts:hasVision?visionParallel:null,disagreement,verdictConsensus:verdictConsensus?(vs[0]||null):null,vision:{attached:vision.images.length,timeframes:vision.images.map(x=>x.tf),modes:vision.images.map(x=>x.mode)},analysts:good,failed:results.filter(x=>!x.ok),judge:judge||{used:false},model:finalModel,text:finalText});
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
    if(req.method==='GET'&&u.pathname==='/leader/plan'){
      try{
        const scan=await scanner.scan();
        const out=await pipeline.run({scan,store,committee:committeeCall});
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
