'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const rl=require('../binance-rate-limit');
const scanner=require('../scanner');

test('R2544.27e scanner closed-candle cache reuses unchanged 5m history',async()=>{
  rl.resetForTests();
  const oldFetch=global.fetch;
  let calls=0;
  const now=Date.now();
  global.fetch=async()=>{calls++;return {ok:true,status:200,headers:{get:()=>null},json:async()=>[[now-600000,'1','1','1','1','1',now-300001,'1',0,0,'0.5']]};};
  try{
    const a=await scanner.scannerKlines('BTCUSDT','5m',7,2000);
    const b=await scanner.scannerKlines('BTCUSDT','5m',7,2000);
    assert.equal(calls,1);
    assert.deepEqual(a,b);
  }finally{global.fetch=oldFetch;rl.resetForTests();}
});

test('R2544.27e fast lane reuses fresh scanner preMove instead of duplicate REST probing',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(src,/SCAN_PREMOVE_REUSE_MS = 35000/);
  assert.match(src,/SCANNER_PREMOVE/);
  assert.match(src,/if\(scanFresh\)/);
});

test('R2544.27e symbol context removes per-call aggTrades snapshot and makes streaming depth primary',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  assert.doesNotMatch(src,/aggTrades\?symbol=\$\{symbol\}&limit=100/);
  assert.match(src,/streamDepthFresh \? Promise\.resolve\(null\) : getJson/);
  assert.match(src,/restCvdCache\.get\(symbol\)/);
  assert.match(src,/publicGetInFlight\.has\(key\)/);
});

test('R2544.27e rate telemetry exposes top weighted routes for one-minute diagnosis',async()=>{
  rl.resetForTests();
  const p1=await rl.acquire({path:'/fapi/v1/aggTrades?symbol=BTCUSDT&limit=1000',kind:'PUBLIC'});p1.release();
  const p2=await rl.acquire({path:'/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=40',kind:'PUBLIC'});p2.release();
  const st=rl.status();
  assert.ok(Array.isArray(st.topRoutes1m));
  assert.equal(st.topRoutes1m[0].route,'/fapi/v1/aggTrades?limit=1000');
  assert.equal(st.topRoutes1m[0].weight,20);
  rl.resetForTests();
});
