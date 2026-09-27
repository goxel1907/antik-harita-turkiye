'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sourceModule = path.join(__dirname,'..','close-idempotency.js');
const { sameExecutionClose } = require(fs.existsSync(sourceModule)?sourceModule:path.join(__dirname,'..','server','close-idempotency.js'));

const identity = {
  symbol:'TESTUSDT',
  side:'LONG',
  openedAt:'2026-09-26T10:00:00.000Z',
  quantity:20,
  entryPrice:0.5000
};

// Exact event identity.
assert.equal(
  sameExecutionClose(
    {symbol:'TESTUSDT',side:'LONG',eventId:'LH:TEST:1'},
    identity,
    {eventId:'LH:TEST:1'}
  ),
  true
);

// Legacy/restart: setup/TF/hold/PnL changed, but execution is the same.
assert.equal(
  sameExecutionClose(
    {
      symbol:'TESTUSDT',
      side:'LONG',
      openedAt:'2026-09-26T10:00:45.000Z',
      quantity:20.01,
      entryPrice:0.5008,
      setup:'OLD_SETUP',
      ownerTF:'15m',
      holdMinutes:300,
      netPnl:999
    },
    {
      ...identity,
      setup:'NEW_SETUP',
      ownerTF:'5m',
      holdMinutes:10,
      netPnl:-999
    }
  ),
  true
);

// Same symbol/side but a genuinely later trade must stay separate.
assert.equal(
  sameExecutionClose(
    {
      symbol:'TESTUSDT',
      side:'LONG',
      openedAt:'2026-09-26T10:10:00.000Z',
      quantity:20,
      entryPrice:0.5000
    },
    identity
  ),
  false
);

// Same time but materially different quantity must stay separate.
assert.equal(
  sameExecutionClose(
    {
      symbol:'TESTUSDT',
      side:'LONG',
      openedAt:'2026-09-26T10:00:20.000Z',
      quantity:30,
      entryPrice:0.5000
    },
    identity
  ),
  false
);

// Opposite side must never collapse.
assert.equal(
  sameExecutionClose(
    {
      symbol:'TESTUSDT',
      side:'SHORT',
      openedAt:'2026-09-26T10:00:20.000Z',
      quantity:20,
      entryPrice:0.5000
    },
    identity
  ),
  false
);

// No executable identity fields => do not guess.
assert.equal(
  sameExecutionClose(
    {
      symbol:'TESTUSDT',
      side:'LONG',
      openedAt:'2026-09-26T10:00:20.000Z'
    },
    {
      symbol:'TESTUSDT',
      side:'LONG',
      openedAt:'2026-09-26T10:00:00.000Z'
    }
  ),
  false
);

console.log('R2542_CLOSED_TRADE_IDEMPOTENCY_OK');
assert.equal(sameExecutionClose({...identity,eventId:'first'}, {...identity,eventId:'second'}),false);
assert.equal(sameExecutionClose({...identity,openedAt:'2026-09-26T09:59:10Z',closedAt:'2026-09-26T09:59:50Z'},identity),false);
assert.equal(sameExecutionClose({...identity,symbol:''},{...identity,symbol:''}),false);
assert.equal(sameExecutionClose({...identity,quantity:null},{...identity,quantity:null}),false);
console.log('R2542_DUPLICATE_CLOSE_WRITE_GUARD_OK');

const test=require('node:test'),os=require('node:os');
const controllerPath=fs.existsSync(sourceModule)?path.join(__dirname,'..','live-controller.js'):path.join(__dirname,'..','server','live-controller.js');
for(const firstWriter of ['ledger','backfill'])test('concurrent close writers and restart append once: '+firstWriter,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2542-close-race-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'data'));
 const now=Date.now(),opened=now-3600000;
 fs.writeFileSync(path.join(root,'data','leader-analysis-state.json'),JSON.stringify({version:1,bySymbol:{TESTUSDT:{symbol:'TESTUSDT',side:'LONG',state:'ACTIVE',activeAt:opened+5,entryPrice:100,quantity:2,stopPrice:95,entryContext:{releaseContract:'R2541_ATOMIC_TURKISH_SAFE'}}}}));
 const rows=[{id:'execution',kind:'LIVE_EXECUTION',symbol:'TESTUSDT',ts:opened,payload:{eventId:'LH:TESTUSDT:ENTRY',result:{orderPlaced:true,side:'LONG',executedQty:2,livePrice:100},plan:{side:'LONG'},riskGate:{structuralStop:{entryPrice:100,stopPrice:95}}}}];
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let incomeCalls=0,learned=0;
 const store={officeRecords:()=>rows.filter(x=>x.kind==='POSITION_CLOSED'),recentJournal:k=>rows.filter(x=>x.kind===k),latestJournal:()=>null,journal:(kind,symbol,payload)=>{rows.push({id:String(rows.length),kind,symbol,payload,ts:now});},recordLearning:()=>{learned++}};
 const reply=x=>({ok:true,status:200,text:async()=>JSON.stringify(x)});
 const deps={root,store,scanner:{},pipeline:{},committee:async()=>({}),credentials:{apiKey:'test-key',apiSecret:'test-secret'},fetchImpl:async(url,opts)=>{
   assert.equal(opts.method||'GET','GET');const p=new URL(url).pathname;
   if(p==='/fapi/v1/time')return reply({serverTime:Date.now()});
   if(p==='/fapi/v3/account')return reply({positions:[]});
   if(p==='/fapi/v1/income'){incomeCalls++;if(incomeCalls===1){entered();await gate;}return reply([{incomeType:'REALIZED_PNL',income:'10',time:now-1000}]);}
   throw new Error('unexpected '+p);
 }};
 const {createLiveController}=require(controllerPath);const c=createLiveController(deps);
 await c.positionLedgerTick();
 const waiting=firstWriter==='ledger'?c.backfillClosedOutcomes():c.positionLedgerTick();await started;
 if(firstWriter==='ledger')await c.positionLedgerTick();else await c.backfillClosedOutcomes();
 release();await waiting;
 assert.equal(rows.filter(x=>x.kind==='POSITION_CLOSED').length,1);assert.equal(learned,1);
 const restarted=createLiveController(deps);await restarted.positionLedgerTick();await restarted.backfillClosedOutcomes();
 assert.equal(rows.filter(x=>x.kind==='POSITION_CLOSED').length,1);assert.equal(restarted.status().armed,false);
});

test('learning uses canonical close samples while preserving every raw row',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2542-learning-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const {openStore}=require(path.join(path.dirname(controllerPath),'store.js'));const s=openStore(root);
 const original={...identity,closedAt:'2026-09-26T10:05:00Z',outcomePct:2,netPnl:10};
 s.recordLearning('POSITION_CLOSED','TESTUSDT',original);
 s.recordLearning('POSITION_CLOSED','TESTUSDT',{...original,backfilled:true,eventId:'legacy-entry',outcomePct:3});
 const context=s.learningContext();assert.equal(context.lifetime.measuredSamples,1);assert.equal(context.excludedDuplicateCloses,1);assert.equal(context.measuredOutcomes.length,1);
 assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM learning_events').get().n,2);s.db.close();
});
