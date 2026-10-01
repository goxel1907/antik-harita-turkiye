'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const rl=require('../binance-rate-limit');

function headers(values={}){const m=Object.fromEntries(Object.entries(values).map(([k,v])=>[k.toLowerCase(),String(v)]));return {get:k=>m[String(k).toLowerCase()]??null};}

test('R2544.27 estimates heavy Binance endpoints conservatively',()=>{
  assert.equal(rl.endpointWeight('/fapi/v1/depth?symbol=BTCUSDT&limit=1000'),20);
  assert.equal(rl.endpointWeight('/fapi/v1/aggTrades?symbol=BTCUSDT&limit=1000'),20);
  assert.equal(rl.endpointWeight('/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=72'),1);
  assert.equal(rl.endpointWeight('/fapi/v1/ticker/24hr'),40);
});

test('R2544.27 429 Retry-After creates global cooldown before another request can be sent',async()=>{
  rl.resetForTests(); const now=1000000;
  rl.observeResponse({status:429,headers:headers({'retry-after':'30'}),body:{code:-1003,msg:'Too many requests'},now});
  const st=rl.status(now); assert.equal(st.cooldownUntil,now+30000); assert.equal(st.lastStatus,429);
  await assert.rejects(()=>rl.acquire({path:'/fapi/v1/time',kind:'PUBLIC',nowFn:()=>now}),e=>e.code==='BINANCE_RATE_LIMIT_COOLDOWN');
});

test('R2544.27 418 ban-until timestamp dominates fallback and blocks LIVE writes too',async()=>{
  rl.resetForTests(); const now=1000000,ban=1300000;
  rl.observeResponse({status:418,headers:headers({}),body:{code:-1003,msg:`IP banned until ${ban}`},now});
  assert.equal(rl.status(now).cooldownUntil,ban);
  await assert.rejects(()=>rl.acquire({path:'/fapi/v1/order',kind:'LIVE_WRITE',nowFn:()=>now}),e=>e.code==='BINANCE_RATE_LIMIT_COOLDOWN');
});

test('R2544.27 remote used-weight header protects public headroom without becoming strategy authority',async()=>{
  rl.resetForTests(); const old=process.env.BINANCE_PUBLIC_SOFT_WEIGHT_1M; process.env.BINANCE_PUBLIC_SOFT_WEIGHT_1M='400';
  try{
    rl.observeResponse({status:200,headers:headers({'x-mbx-used-weight-1m':'450'}),now:2000000});
    await assert.rejects(()=>rl.acquire({path:'/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=72',kind:'PUBLIC',nowFn:()=>2000000}),e=>e.code==='BINANCE_REMOTE_WEIGHT_GUARD');
    const permit=await rl.acquire({path:'/fapi/v1/order',kind:'LIVE_WRITE',nowFn:()=>2000000});permit.release();
  }finally{if(old===undefined)delete process.env.BINANCE_PUBLIC_SOFT_WEIGHT_1M;else process.env.BINANCE_PUBLIC_SOFT_WEIGHT_1M=old;rl.resetForTests();}
});

test('R2544.27 WebSocket market endpoints use supported /ws path',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const market=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  const l2=fs.readFileSync(path.join(__dirname,'..','local-l2.js'),'utf8');
  const liq=fs.readFileSync(path.join(__dirname,'..','liquidation-history.js'),'utf8');
  assert.doesNotMatch(market,/fstream\.binance\.com\/(?:public|market)\/ws/);
  assert.match(market,/wss:\/\/fstream\.binance\.com\/ws/);
  assert.match(l2,/wss:\/\/fstream\.binance\.com\/ws/);
  assert.doesNotMatch(liq,/fstream\.binance\.com\/market\/ws/);
});

test('R2544.27c 418 quarantine remains closed after timer expiry until explicit recovery probe',async()=>{
  rl.resetForTests(); const now=3000000,ban=3300000;
  rl.observeResponse({status:418,headers:headers({}),body:{code:-1003,msg:`IP banned until ${ban}`},path:'/fapi/v1/premiumIndex',kind:'PUBLIC',now});
  assert.equal(rl.status(now).quarantined,true);
  await assert.rejects(()=>rl.acquire({path:'/fapi/v1/premiumIndex',kind:'PUBLIC',nowFn:()=>ban+1}),e=>e.code==='BINANCE_418_QUARANTINE');
  await assert.rejects(()=>rl.acquire({path:'/fapi/v3/account',kind:'LIVE_READ',nowFn:()=>ban+1}),e=>e.code==='BINANCE_418_QUARANTINE');
  await assert.rejects(()=>rl.acquire({path:'/fapi/v1/order',kind:'LIVE_WRITE',nowFn:()=>ban+1}),e=>e.code==='BINANCE_418_QUARANTINE');
  const permit=await rl.acquire({path:'/fapi/v1/time',kind:'RECOVERY_PROBE',nowFn:()=>ban+1});
  assert.equal(rl.status(ban+1).lastRequestKind,'RECOVERY_PROBE');
  permit.release();
});

test('R2544.27c successful recovery probe opens quarantine only after a 60s warmup',async()=>{
  rl.resetForTests(); const now=4000000,ban=4300000,probeAt=ban+1;
  rl.observeResponse({status:418,headers:headers({}),body:{code:-1003,msg:`IP banned until ${ban}`},now});
  const permit=await rl.acquire({path:'/fapi/v1/time',kind:'RECOVERY_PROBE',nowFn:()=>probeAt});permit.release();
  rl.observeResponse({status:200,headers:headers({'x-mbx-used-weight-1m':'1'}),body:{serverTime:probeAt},path:'/fapi/v1/time',kind:'RECOVERY_PROBE',now:probeAt});
  const st=rl.status(probeAt);
  assert.equal(st.quarantined,false);
  assert.equal(st.recoveryProbeAttempts,1);
  assert.equal(st.recoveryProbeSuccesses,1);
  assert.equal(st.cooldownReason,'BINANCE_RECOVERY_WARMUP');
  assert.equal(st.cooldownUntil,probeAt+60000);
  await assert.rejects(()=>rl.acquire({path:'/fapi/v1/premiumIndex',kind:'PUBLIC',nowFn:()=>probeAt+1000}),e=>e.code==='BINANCE_RATE_LIMIT_COOLDOWN');
  const normal=await rl.acquire({path:'/fapi/v1/premiumIndex?symbol=BTCUSDT',kind:'PUBLIC',nowFn:()=>probeAt+60001});normal.release();
});

test('R2544.27c server exposes explicit recovery probe and no automatic unquarantine route',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const transport=fs.readFileSync(path.join(__dirname,'..','binance-live-transport.js'),'utf8');
  assert.match(server,/POST'&&u\.pathname==='\/binance\/recovery-probe'/);
  assert.match(server,/LIVE_MUST_BE_DISARMED_FOR_BINANCE_RECOVERY_PROBE/);
  assert.match(transport,/rateLimitKind:'RECOVERY_PROBE'/);
});

test('R2544.27c 418 quarantine persists across BrainHub restart',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jev-binance-quarantine-'));
  const mod=path.join(__dirname,'..','binance-rate-limit.js');
  const ban=Date.now()+300000;
  const env={...process.env,BRAINHUB_ROOT:root};
  const first=`const rl=require(${JSON.stringify(mod)});rl.resetForTests();rl.observeResponse({status:418,headers:{get:()=>null},body:{msg:'IP banned until ${ban}'},now:${ban-300000}});process.stdout.write(JSON.stringify(rl.status(${ban-299999})));`;
  const a=spawnSync(process.execPath,['-e',first],{env,encoding:'utf8'}); assert.equal(a.status,0,a.stderr);
  const second=`const rl=require(${JSON.stringify(mod)});process.stdout.write(JSON.stringify(rl.status(Date.now())));`;
  const b=spawnSync(process.execPath,['-e',second],{env,encoding:'utf8'}); assert.equal(b.status,0,b.stderr);
  const st=JSON.parse(b.stdout); assert.equal(st.quarantined,true); assert.equal(st.cooldownUntil,ban); assert.equal(st.lastStatus,418);
  fs.rmSync(root,{recursive:true,force:true});
});
