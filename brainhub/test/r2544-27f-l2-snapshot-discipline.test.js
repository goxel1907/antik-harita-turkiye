'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {LocalL2Manager}=require('../local-l2');

test('R2544.27f uses 2026 split Binance websocket endpoints',()=>{
  const l2=new LocalL2Manager();
  assert.equal(l2.endpoint,'wss://fstream.binance.com/public/ws');
  const market=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  assert.match(market,/FUTURES_WS = 'wss:\/\/fstream\.binance\.com\/public\/ws'/);
  assert.match(market,/FUTURES_MARKET_WS = 'wss:\/\/fstream\.binance\.com\/market\/ws'/);
  const liq=fs.readFileSync(path.join(__dirname,'..','liquidation-history.js'),'utf8');
  assert.match(liq,/wss:\/\/fstream\.binance\.com\/market\/ws/);
});

test('R2544.27f snapshot with no bridge waits for stream instead of reseeding every event',async()=>{
  let now=1000,calls=0;
  const l2=new LocalL2Manager({now:()=>now,minReseedMs:15000,snapshotLoader:async()=>{calls++;return {lastUpdateId:100,bids:[['100','2']],asks:[['101','2']]};}});
  const s=l2._new('BTCUSDT');l2.states.set('BTCUSDT',s);
  await l2._seed('BTCUSDT');
  assert.equal(calls,1);assert.equal(s.seeded,true);assert.equal(s.awaitingBridge,true);assert.equal(s.status,'WARMING');
  // stale event is ignored, not treated as a gap and not reseeded
  now=1100;l2.ingest({e:'depthUpdate',s:'BTCUSDT',E:1100,U:90,u:99,pu:89,b:[],a:[]});
  assert.equal(calls,1);assert.equal(s.status,'WARMING');
  // first valid bridge makes the book healthy without another REST snapshot
  now=1200;l2.ingest({e:'depthUpdate',s:'BTCUSDT',E:1200,U:99,u:101,pu:98,b:[['100','3']],a:[]});
  assert.equal(calls,1);assert.equal(s.status,'HEALTHY');assert.equal(s.awaitingBridge,false);assert.equal(s.lastU,101);
});

test('R2544.27f L2 pool defers churn while all resident symbols are young',()=>{
  let now=100000;
  const l2=new LocalL2Manager({now:()=>now,maxSymbols:2,minResidenceMs:60000,evictionCooldownMs:30000});
  l2.states.set('AAAUSDT',l2._new('AAAUSDT'));l2.subscribed.add('AAAUSDT');
  l2.states.set('BBBUSDT',l2._new('BBBUSDT'));l2.subscribed.add('BBBUSDT');
  const x=l2.ensureSymbol('CCCUSDT');
  assert.equal(x,null);assert.equal(l2.states.size,2);assert.equal(l2.evictions,0);assert.equal(l2.evictionDeferrals,1);
});
