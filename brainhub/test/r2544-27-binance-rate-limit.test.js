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
