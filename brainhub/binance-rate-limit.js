'use strict';

const fs = require('node:fs');
const pathMod = require('node:path');

// R2544.27 — process-wide Binance REST guard.
// Goal: prevent parallel scanner/market/live REST bursts from turning HTTP 429 into HTTP 418 IP bans.
// This is transport safety, not trade/strategy authority.

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MIN_GAP_MS = 50;
const DEFAULT_PUBLIC_SOFT_WEIGHT_1M = 1600;
const DEFAULT_LIVE_READ_SOFT_WEIGHT_1M = 1900;

const state = {
  active:0,
  waiters:[],
  lastStartAt:0,
  events:[],
  cooldownUntil:0,
  cooldownReason:null,
  lastStatus:null,
  last429At:0,
  last418At:0,
  usedWeight1m:null,
  usedWeightAt:0,
  requests:0,
  locallyBlocked:0,
  quarantined:false,
  quarantineSince:0,
  quarantineReason:null,
  recoveryProbeAttempts:0,
  recoveryProbeSuccesses:0,
  lastRequestAt:0,
  lastRequestPath:null,
  lastRequestKind:null
};

function stateFile(){
  const root=String(process.env.BRAINHUB_ROOT||'').trim();
  return root?pathMod.join(root,'data','binance-rate-limit-state.json'):null;
}
function persistState(){
  const file=stateFile(); if(!file)return;
  try{
    fs.mkdirSync(pathMod.dirname(file),{recursive:true});
    fs.writeFileSync(file,JSON.stringify({
      version:1,savedAt:Date.now(),cooldownUntil:state.cooldownUntil||0,cooldownReason:state.cooldownReason||null,
      lastStatus:state.lastStatus||null,last429At:state.last429At||0,last418At:state.last418At||0,
      quarantined:state.quarantined===true,quarantineSince:state.quarantineSince||0,quarantineReason:state.quarantineReason||null,
      lastRequestAt:state.lastRequestAt||0,lastRequestPath:state.lastRequestPath||null,lastRequestKind:state.lastRequestKind||null
    })+'\n','utf8');
  }catch{}
}
function hydrateState(){
  const file=stateFile(); if(!file)return;
  try{
    if(!fs.existsSync(file))return;
    const x=JSON.parse(fs.readFileSync(file,'utf8'));
    state.cooldownUntil=Number.isFinite(Number(x?.cooldownUntil))?Number(x.cooldownUntil):0;
    state.cooldownReason=typeof x?.cooldownReason==='string'?x.cooldownReason:null;
    state.lastStatus=Number.isFinite(Number(x?.lastStatus))?Number(x.lastStatus):null;
    state.last429At=Number.isFinite(Number(x?.last429At))?Number(x.last429At):0;
    state.last418At=Number.isFinite(Number(x?.last418At))?Number(x.last418At):0;
    state.quarantined=x?.quarantined===true;
    state.quarantineSince=Number.isFinite(Number(x?.quarantineSince))?Number(x.quarantineSince):0;
    state.quarantineReason=typeof x?.quarantineReason==='string'?x.quarantineReason:null;
    state.lastRequestAt=Number.isFinite(Number(x?.lastRequestAt))?Number(x.lastRequestAt):0;
    state.lastRequestPath=typeof x?.lastRequestPath==='string'?x.lastRequestPath:null;
    state.lastRequestKind=typeof x?.lastRequestKind==='string'?x.lastRequestKind:null;
  }catch{}
}
hydrateState();

function n(v){ if(v===null||v===undefined||v==='')return null; const x=Number(v); return Number.isFinite(x)?x:null; }
function clampInt(v,lo,hi,fallback){ const x=Math.round(Number(v)); return Number.isFinite(x)?Math.max(lo,Math.min(hi,x)):fallback; }
function sleep(ms){ return ms>0?new Promise(r=>setTimeout(r,ms)):Promise.resolve(); }
function header(headers,name){ try{return headers&&typeof headers.get==='function'?headers.get(name):null;}catch{return null;} }
function prune(now){ state.events=state.events.filter(x=>now-x.at<60000); }
function estimatedWeight1m(now=Date.now()){ prune(now); return state.events.reduce((s,x)=>s+x.weight,0); }

function routeKey(path=''){
  try{
    const u=new URL(String(path),'https://fapi.binance.com');
    const keep=['interval','limit','period'].map(k=>[k,u.searchParams.get(k)]).filter(([,v])=>v!==null);
    return u.pathname+(keep.length?'?'+keep.map(([k,v])=>`${k}=${v}`).join('&'):'');
  }catch{return String(path||'UNKNOWN').slice(0,96)||'UNKNOWN';}
}

function endpointWeight(path=''){
  let u; try{u=new URL(String(path),'https://fapi.binance.com');}catch{return 5;}
  const p=u.pathname, lim=Number(u.searchParams.get('limit')||0), hasSymbol=Boolean(u.searchParams.get('symbol'));
  if(p==='/fapi/v1/depth') return lim>=1000?20:lim>=500?10:lim>=100?5:2;
  if(p==='/fapi/v1/aggTrades') return 20;
  if(p==='/fapi/v1/klines' || p==='/fapi/v1/continuousKlines') return lim>=1000?10:lim>=500?5:lim>=100?2:1;
  if(p==='/fapi/v1/ticker/24hr') return hasSymbol?1:40;
  if(p==='/fapi/v1/ticker/bookTicker') return hasSymbol?2:5;
  if(p==='/fapi/v1/premiumIndex') return hasSymbol?1:10;
  if(p==='/fapi/v3/account' || p==='/fapi/v3/positionRisk') return 5;
  if(p==='/fapi/v1/exchangeInfo') return 1;
  if(p.startsWith('/futures/data/')) return 1;
  return 2;
}

class BinanceRateLimitError extends Error{
  constructor(message,{cooldownUntil=0,reason=null,estimatedWeight=null,weight=null}={}){
    super(message); this.name='BinanceRateLimitError'; this.code=message; this.cooldownUntil=cooldownUntil||0;
    this.reason=reason||null; this.estimatedWeight=estimatedWeight; this.weight=weight;
  }
}

function parseRetryAfter(headers,now){
  const raw=header(headers,'retry-after'); if(!raw)return 0;
  const sec=Number(raw); if(Number.isFinite(sec)&&sec>=0)return now+Math.ceil(sec*1000);
  const dt=Date.parse(raw); return Number.isFinite(dt)?dt:0;
}
function parseBanUntil(body){
  const msg=String(body?.msg||body?.message||'');
  const m=msg.match(/banned\s+until\s+(\d{10,16})/i); if(!m)return 0;
  let x=Number(m[1]); if(!Number.isFinite(x))return 0; if(x<1e12)x*=1000; return x;
}
function setCooldown(until,reason,status,now=Date.now()){
  if(Number.isFinite(until)&&until>state.cooldownUntil){state.cooldownUntil=until;state.cooldownReason=reason||null;}
  state.lastStatus=status||state.lastStatus;
  if(status===429)state.last429At=now;
  if(status===418)state.last418At=now;
}

function observeResponse({status,headers,body,path=null,kind=null,now=Date.now()}={}){
  const used=n(header(headers,'x-mbx-used-weight-1m'));
  if(used!==null){state.usedWeight1m=used;state.usedWeightAt=now;}
  state.lastStatus=Number(status)||state.lastStatus;
  if(status===429){
    const retry=parseRetryAfter(headers,now)||now+60000;
    setCooldown(Math.max(retry,now+1000),'BINANCE_HTTP_429_BACKOFF',429,now);
  }else if(status===418){
    const ban=parseBanUntil(body), retry=parseRetryAfter(headers,now);
    setCooldown(Math.max(ban,retry,now+5*60000),'BINANCE_HTTP_418_IP_BAN',418,now);
    state.quarantined=true;
    state.quarantineSince=state.quarantineSince||now;
    state.quarantineReason='BINANCE_HTTP_418_IP_BAN';
  }else if(Number(status)>=200&&Number(status)<300&&kind==='RECOVERY_PROBE'){
    state.quarantined=false;
    state.quarantineSince=0;
    state.quarantineReason=null;
    state.recoveryProbeSuccesses++;
    state.cooldownUntil=Math.max(state.cooldownUntil,now+60000);
    state.cooldownReason='BINANCE_RECOVERY_WARMUP';
  }
  if(status===429||status===418||(Number(status)>=200&&Number(status)<300&&kind==='RECOVERY_PROBE'))persistState();
  return status;
}

function releaseSlot(){
  state.active=Math.max(0,state.active-1);
  const next=state.waiters.shift(); if(next)next();
}
async function takeSlot(maxWaitMs){
  const maxConcurrent=clampInt(process.env.BINANCE_REST_MAX_CONCURRENT,1,8,DEFAULT_MAX_CONCURRENT);
  if(state.active<maxConcurrent){state.active++;return;}
  let timer=null,done=false;
  await new Promise((resolve,reject)=>{
    const wake=()=>{if(done)return;done=true;if(timer)clearTimeout(timer);state.active++;resolve();};
    state.waiters.push(wake);
    timer=setTimeout(()=>{if(done)return;done=true;const i=state.waiters.indexOf(wake);if(i>=0)state.waiters.splice(i,1);reject(new BinanceRateLimitError('BINANCE_REST_QUEUE_TIMEOUT'));},maxWaitMs);
    timer.unref?.();
  });
}

async function acquire({path='',kind='PUBLIC',weight=null,maxWaitMs=5000,nowFn=Date.now}={}){
  const now=nowFn();
  if(state.cooldownUntil>now){state.locallyBlocked++;throw new BinanceRateLimitError('BINANCE_RATE_LIMIT_COOLDOWN',{cooldownUntil:state.cooldownUntil,reason:state.cooldownReason});}
  if(state.quarantined&&kind!=='RECOVERY_PROBE'){state.locallyBlocked++;throw new BinanceRateLimitError('BINANCE_418_QUARANTINE',{cooldownUntil:state.cooldownUntil,reason:state.quarantineReason||'BINANCE_HTTP_418_IP_BAN'});}
  const w=Math.max(1,Math.round(n(weight)??endpointWeight(path)));
  const local=estimatedWeight1m(now);
  const publicSoft=clampInt(process.env.BINANCE_PUBLIC_SOFT_WEIGHT_1M,400,2200,DEFAULT_PUBLIC_SOFT_WEIGHT_1M);
  const liveSoft=clampInt(process.env.BINANCE_LIVE_READ_SOFT_WEIGHT_1M,600,2300,DEFAULT_LIVE_READ_SOFT_WEIGHT_1M);
  const soft=kind==='LIVE_READ'?liveSoft:publicSoft;
  if(kind!=='LIVE_WRITE' && kind!=='RECOVERY_PROBE' && local+w>soft){state.locallyBlocked++;throw new BinanceRateLimitError('BINANCE_LOCAL_WEIGHT_GUARD',{estimatedWeight:local,weight:w,reason:'LOCAL_60S_ESTIMATE'});}
  // Remote header reflects other processes sharing the same public IP too. Preserve headroom for live reads/writes.
  if(kind==='PUBLIC' && state.usedWeight1m!==null && now-state.usedWeightAt<65000 && state.usedWeight1m>=publicSoft){state.locallyBlocked++;throw new BinanceRateLimitError('BINANCE_REMOTE_WEIGHT_GUARD',{estimatedWeight:state.usedWeight1m,weight:w,reason:'X_MBX_USED_WEIGHT_1M'});}
  if(kind==='LIVE_READ' && state.usedWeight1m!==null && now-state.usedWeightAt<65000 && state.usedWeight1m>=liveSoft){state.locallyBlocked++;throw new BinanceRateLimitError('BINANCE_REMOTE_WEIGHT_GUARD',{estimatedWeight:state.usedWeight1m,weight:w,reason:'X_MBX_USED_WEIGHT_1M'});}

  await takeSlot(maxWaitMs);
  try{
    const after=nowFn();
    if(state.cooldownUntil>after)throw new BinanceRateLimitError('BINANCE_RATE_LIMIT_COOLDOWN',{cooldownUntil:state.cooldownUntil,reason:state.cooldownReason});
    if(state.quarantined&&kind!=='RECOVERY_PROBE')throw new BinanceRateLimitError('BINANCE_418_QUARANTINE',{cooldownUntil:state.cooldownUntil,reason:state.quarantineReason||'BINANCE_HTTP_418_IP_BAN'});
    const minGap=clampInt(process.env.BINANCE_REST_MIN_GAP_MS,0,500,DEFAULT_MIN_GAP_MS);
    const wait=Math.max(0,state.lastStartAt+minGap-after);
    if(wait>maxWaitMs)throw new BinanceRateLimitError('BINANCE_REST_PACE_TIMEOUT');
    await sleep(wait);
    const started=nowFn(); state.lastStartAt=started; state.events.push({at:started,weight:w,kind,route:routeKey(path)}); state.requests++;
    state.lastRequestAt=started;state.lastRequestPath=String(path||'').slice(0,180)||null;state.lastRequestKind=kind;
    if(kind==='RECOVERY_PROBE')state.recoveryProbeAttempts++; prune(started);
    return {release:releaseSlot,weight:w};
  }catch(e){releaseSlot();throw e;}
}

function status(now=Date.now()){
  prune(now);
  const req1m=state.events.length;
  const countKind=kind=>state.events.reduce((n,x)=>n+(x.kind===kind?1:0),0);
  const routes=new Map();
  for(const e of state.events){const k=e.route||'UNKNOWN',r=routes.get(k)||{route:k,count:0,weight:0};r.count++;r.weight+=Number(e.weight)||0;routes.set(k,r);}
  const topRoutes1m=[...routes.values()].sort((a,b)=>b.weight-a.weight||b.count-a.count).slice(0,8);
  return {
    active:state.active,queued:state.waiters.length,requests1m:req1m,publicRequests1m:countKind('PUBLIC'),liveReadRequests1m:countKind('LIVE_READ'),liveWriteRequests1m:countKind('LIVE_WRITE'),recoveryProbeRequests1m:countKind('RECOVERY_PROBE'),estimatedWeight1m:estimatedWeight1m(now),topRoutes1m,usedWeight1m:state.usedWeight1m,
    usedWeightAgeMs:state.usedWeightAt?Math.max(0,now-state.usedWeightAt):null,cooldownUntil:state.cooldownUntil||null,
    cooldownMs:state.cooldownUntil>now?state.cooldownUntil-now:0,cooldownReason:state.cooldownReason,lastStatus:state.lastStatus,
    last429At:state.last429At||null,last418At:state.last418At||null,requests:state.requests,locallyBlocked:state.locallyBlocked,
    quarantined:state.quarantined,quarantineSince:state.quarantineSince||null,quarantineReason:state.quarantineReason,
    recoveryProbeAttempts:state.recoveryProbeAttempts,recoveryProbeSuccesses:state.recoveryProbeSuccesses,
    lastRequestAt:state.lastRequestAt||null,lastRequestPath:state.lastRequestPath,lastRequestKind:state.lastRequestKind,
    maxConcurrent:clampInt(process.env.BINANCE_REST_MAX_CONCURRENT,1,8,DEFAULT_MAX_CONCURRENT),
    minGapMs:clampInt(process.env.BINANCE_REST_MIN_GAP_MS,0,500,DEFAULT_MIN_GAP_MS),
    publicSoftWeight1m:clampInt(process.env.BINANCE_PUBLIC_SOFT_WEIGHT_1M,400,2200,DEFAULT_PUBLIC_SOFT_WEIGHT_1M),
    liveReadSoftWeight1m:clampInt(process.env.BINANCE_LIVE_READ_SOFT_WEIGHT_1M,600,2300,DEFAULT_LIVE_READ_SOFT_WEIGHT_1M)
  };
}
function resetForTests(){
  state.active=0;state.waiters.splice(0);state.lastStartAt=0;state.events.splice(0);state.cooldownUntil=0;state.cooldownReason=null;
  state.lastStatus=null;state.last429At=0;state.last418At=0;state.usedWeight1m=null;state.usedWeightAt=0;state.requests=0;state.locallyBlocked=0;
  state.quarantined=false;state.quarantineSince=0;state.quarantineReason=null;state.recoveryProbeAttempts=0;state.recoveryProbeSuccesses=0;
  state.lastRequestAt=0;state.lastRequestPath=null;state.lastRequestKind=null;
}

module.exports={BinanceRateLimitError,endpointWeight,acquire,observeResponse,status,resetForTests};
