'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {LocalL2Manager}=require('../local-l2');

test('R2544.26 local L2 bridges snapshot and enforces pu continuity',async()=>{
  let now=1000;
  const l2=new LocalL2Manager({now:()=>now,snapshotLoader:async()=>({lastUpdateId:100,bids:[['100','5'],['99','3']],asks:[['101','4'],['102','2']]})});
  const s=l2._new('BTCUSDT');l2.states.set('BTCUSDT',s);s.buffer.push({e:'depthUpdate',s:'BTCUSDT',E:1000,U:99,u:101,pu:98,b:[['100','6']],a:[['101','3']]});
  await l2._seed('BTCUSDT');
  assert.equal(l2.state('BTCUSDT').status,'HEALTHY');
  assert.equal(l2.state('BTCUSDT').lastU,101);
  now=1100;l2.ingest({e:'depthUpdate',s:'BTCUSDT',E:1100,U:102,u:103,pu:101,b:[['100','7']],a:[]});
  assert.equal(l2.state('BTCUSDT').lastU,103);
  const snap=l2.snapshot('BTCUSDT',now,[]);
  assert.equal(snap.sequenceHealthy,true);assert.equal(snap.canVeto,false);assert.equal(snap.executionAuthority,false);
});

test('R2544.26 local L2 sequence gap becomes resyncing, never a veto',async()=>{
  let now=1000,resolve;
  const l2=new LocalL2Manager({now:()=>now,snapshotLoader:()=>new Promise(r=>{resolve=r;})});
  const s=l2._new('ETHUSDT');l2.states.set('ETHUSDT',s);s.seeded=true;s.status='HEALTHY';s.snapshotLastUpdateId=100;s.lastU=105;s.bids.set('100',2);s.asks.set('101',2);s.lastEventAt=1000;
  now=1200;l2.ingest({e:'depthUpdate',s:'ETHUSDT',E:1200,U:106,u:107,pu:104,b:[],a:[]});
  const snap=l2.snapshot('ETHUSDT',now,[]);
  assert.equal(snap.available,false);assert.equal(snap.state,'RESYNCING');assert.equal(snap.canVeto,false);
  resolve({lastUpdateId:107,bids:[['100','2']],asks:[['101','2']]});
});
