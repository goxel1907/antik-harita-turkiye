'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLiveController } = require('../live-controller');

function policy() {
  return {
    armMinutes:1440,
    expectedLeverage:10,
    maxEntryDeviationPct:1,
    limits:{
      maxRiskPctPerTrade:5,
      maxNotionalPctPerTrade:100,
      maxDailyLossPct:20,
      maxOpenPositions:3,
      maxFamilyExposurePct:100
    },
    apiPermissions:{
      configured:true,
      futuresEnabled:true,
      withdrawalsEnabled:false,
      ipRestricted:true
    }
  };
}

function response(body, status = 200) {
  return {
    ok:status >= 200 && status < 300,
    status,
    async text(){ return JSON.stringify(body); }
  };
}

function candidateScan() {
  return {
    universeCount:528,
    leaders:[{
      symbol:'AAAUSDT',
      side:'LONG',
      attackRank:1,
      projectedRank:1,
      leaderState:'TOP3_APPROACH',
      tradeQuality:90,
      directionSupport:3,
      spreadBps:1,
      longExpansionScore:80,
      shortExpansionScore:5,
      expansionScore:80,
      leaderHunterScore:150,
      movementPotential:75
    }],
    top3Approach:[],
    top10Approach:[],
    earlyTop5:[],
    earlyExpansion:[]
  };
}

function advisory(status, side = 'LONG') {
  return {
    ok:true,
    candidateFound:true,
    symbol:'AAAUSDT',
    candidate:{ symbol:'AAAUSDT', side },
    plan:{
      valid:status === 'QUALIFIED',
      status,
      side,
      confidence:status === 'REJECT' ? 20 : 72,
      originTF:'1m',
      ownerTF:'5m',
      setup:'LIFECYCLE_REGRESSION',
      execPath:'VISION_9TF',
      why:'lifecycle regression fixture',
      riskNote:'fixture risk',
      waitFor:status === 'WATCH' ? '1m closed-candle continuation' : 'NONE',
      timeframeNotes:{ '1m':'fixture' },
      visionSummary:'fixture 9TF summary',
      execution:'ADVISORY_ONLY'
    },
    unifiedContext:{
      opportunityPaths:{
        LONG:{
          originTF:'1m',
          ownerTF:'5m',
          continuity:[{ frame:'1m', score:70, immediateEligible:true, state:'ACTIVE_CONTEXT' }]
        },
        SHORT:{ originTF:null, ownerTF:null, continuity:[] }
      },
      frames:{}
    },
    vision:{ ok:true, attached:9, required:9, barsRequested:128, mode:'annotated', failures:[] },
    committee:{ vision:{ attached:9 }, model:'fixture-model', mode:'consensus', degraded:false },
    execution:'ADVISORY_ONLY',
    orderPlaced:false
  };
}

function makeFetch(clockRef, calls) {
  return async url => {
    calls.push(String(url));
    const u=new URL(String(url));
    if (u.pathname === '/fapi/v1/time') return response({ serverTime:clockRef.now });
    if (u.pathname === '/fapi/v3/account') return response({
      totalWalletBalance:'100',
      totalMarginBalance:'100',
      availableBalance:'100',
      totalUnrealizedProfit:'0',
      positions:[]
    });
    if (u.pathname === '/fapi/v1/positionSide/dual') return response({ dualSidePosition:false });
    throw new Error('unexpected Binance fetch in lifecycle test: '+u.pathname);
  };
}

test('Leader Auto keeps 9TF analysis running while LIVE arm stays off and never contacts Binance', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-leader-analysis-disarmed-'));
  const cfg=path.join(root,'config');
  fs.mkdirSync(cfg,{recursive:true});
  fs.writeFileSync(path.join(cfg,'live-policy.json'),JSON.stringify(policy(),null,2));

  const clockRef={ now:Date.UTC(2026,8,19,0,10,0) };
  const fetchCalls=[];
  const fetchImpl=async url => {
    fetchCalls.push(String(url));
    throw new Error('analysis-only disarmed tick must not contact Binance');
  };
  const store={ journal(){ return '00000000-0000-0000-0000-000000000010'; } };
  let pipelineCalls=0;
  const pipeline={
    async run(input){
      pipelineCalls++;
      assert.equal(input.executionIntent.symbol,'AAAUSDT');
      return advisory('QUALIFIED');
    }
  };
  const scanner={ async scan(){ return candidateScan(); } };
  const controller=createLiveController({
    root,store,scanner,pipeline,committee:async()=>({ok:true,text:''}),
    credentials:{ apiKey:'unused', apiSecret:'unused' },
    fetchImpl,clock:()=>clockRef.now
  });

  assert.equal(controller.status().armed,false);
  assert.equal(controller.configureLeaderAuto({
    enabled:true,marginQuote:20,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true
  }).ok,true);

  const result=await controller.leaderAutoTick();
  assert.equal(result.execution,'LEADER_AUTO_WAIT_ARM');
  assert.equal(result.analysisOnly,true);
  assert.equal(result.orderPlaced,false);
  assert.equal(result.liveAllowed,false);
  assert.equal(result.symbol,'AAAUSDT');
  assert.equal(pipelineCalls,1);
  assert.equal(fetchCalls.length,0);

  const st=controller.leaderAutoStatus();
  assert.equal(st.lastExecution,'LEADER_AUTO_WAIT_ARM');
  assert.equal(st.diagnostics.candidates[0].selected,true);
  assert.equal(st.diagnostics.candidates[0].planStatus,'QUALIFIED');
  assert.equal(st.diagnostics.candidates[0].vision.attached,9);

  fs.rmSync(root,{recursive:true,force:true});
});

test('LiveReadiness stays disarmed, sends only read-only Binance requests and validates dry-run plus one-shot fingerprint', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-live-readiness-'));
  const cfg=path.join(root,'config');
  fs.mkdirSync(cfg,{recursive:true});
  fs.writeFileSync(path.join(cfg,'live-policy.json'),JSON.stringify(policy(),null,2));

  const clockRef={ now:Date.UTC(2026,8,19,1,20,0) };
  const calls=[];
  const fetchImpl=async (url,options={}) => {
    const u=new URL(String(url));
    const method=String(options?.method || 'GET').toUpperCase();
    calls.push({ path:u.pathname, method });
    assert.equal(method,'GET','readiness must never submit a Binance write request');

    if(u.pathname==='/fapi/v1/time') return response({ serverTime:clockRef.now });
    if(u.pathname==='/fapi/v3/account') return response({
      totalWalletBalance:'100',
      totalMarginBalance:'100',
      availableBalance:'100',
      totalUnrealizedProfit:'0',
      positions:[]
    });
    if(u.pathname==='/fapi/v1/income') return response([]);
    if(u.pathname==='/fapi/v1/positionSide/dual') return response({ dualSidePosition:false });
    if(u.pathname==='/fapi/v1/exchangeInfo') return response({
      symbols:[{
        symbol:'AAAUSDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',
        filters:[
          {filterType:'MARKET_LOT_SIZE',minQty:'0.001',maxQty:'1000',stepSize:'0.001'},
          {filterType:'PRICE_FILTER',minPrice:'0.1',maxPrice:'100000',tickSize:'0.1'},
          {filterType:'MIN_NOTIONAL',notional:'5'}
        ]
      }]
    });
    if(u.pathname==='/fapi/v1/ticker/price') return response({ symbol:'AAAUSDT', price:'100' });
    throw new Error('unexpected readiness Binance fetch: '+u.pathname);
  };

  const scan=candidateScan();
  const readinessAdvisory={
    ...advisory('QUALIFIED'),
    plan:{
      ...advisory('QUALIFIED').plan,
      originTF:'15m',
      ownerTF:'1h',
      waitFor:'NONE'
    },
    unifiedContext:{
      symbol:'AAAUSDT',
      livePrice:100,
      dataQuality:{ advisoryUsable:true },
      microstructure:{ spreadBps:1 },
      frames:{
        '15m':{
          available:true,fresh:true,atrPct:1,prior20Low:99,prior20High:104,
          breakoutExecution:{status:'NO_ACTIVE_BREAKOUT'}
        },
        '1h':{
          available:true,fresh:true,atrPct:2,prior20Low:96,prior20High:108,
          breakoutExecution:{status:'NO_ACTIVE_BREAKOUT'}
        }
      },
      opportunityPaths:{
        LONG:{
          originTF:'15m',
          ownerTF:'1h',
          continuity:[
            {frame:'15m',score:72,immediateEligible:true,state:'ACTIVE_CONTEXT'},
            {frame:'1h',score:65,immediateEligible:false,state:'ACTIVE_CONTEXT'}
          ]
        },
        SHORT:{ originTF:null,ownerTF:null,continuity:[] }
      }
    },
    vision:{ ok:true,attached:9,required:9,barsRequested:128,mode:'annotated',failures:[] },
    committee:{ vision:{attached:9},model:'fixture-model',mode:'consensus',degraded:false }
  };

  const store={ journal(){ return '00000000-0000-0000-0000-000000000020'; } };
  const pipeline={ async run(input){
    assert.equal(input.executionIntent.symbol,'AAAUSDT');
    assert.equal(input.executionIntent.analysisTracking,true);
    return readinessAdvisory;
  }};
  const scanner={ async scan(){ return scan; } };

  const controller=createLiveController({
    root,store,scanner,pipeline,committee:async()=>({ok:true,text:''}),
    credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' },
    fetchImpl,clock:()=>clockRef.now
  });

  assert.equal(controller.status().armed,false);
  assert.equal(controller.configureLeaderAuto({
    enabled:true,marginQuote:20,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true
  }).ok,true);

  const out=await controller.liveReadiness();
  assert.equal(out.ok,true);
  assert.equal(out.readyForUserArm,true);
  assert.equal(out.armed,false);
  assert.equal(out.liveAllowed,false);
  assert.equal(out.orderPlaced,false);
  assert.equal(out.orderRequestSent,false);
  assert.equal(out.symbol,'AAAUSDT');
  assert.equal(out.planStatus,'QUALIFIED');
  assert.equal(out.vision.attached,9);
  assert.equal(out.dryRun.ok,true);
  assert.equal(out.dryRun.simulated,true);
  assert.equal(out.dryRun.submitted,false);
  assert.equal(out.dryRun.requestSent,false);
  assert.equal(out.exchangeRules.ok,true);
  assert.equal(out.authorizationSimulation.issueOk,true);
  assert.equal(out.authorizationSimulation.consumeOnceOk,true);
  assert.equal(out.authorizationSimulation.replayBlocked,true);
  assert.ok(calls.length>0);
  assert.ok(calls.every(x=>x.method==='GET'));
  assert.equal(controller.status().armed,false,'readiness must not arm LIVE');

  fs.rmSync(root,{recursive:true,force:true});
});

test('leader lifecycle persists across restart and reanalysis remains analysis-only', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-leader-life-'));
  const cfg=path.join(root,'config');
  fs.mkdirSync(cfg,{recursive:true});
  fs.writeFileSync(path.join(cfg,'live-policy.json'),JSON.stringify(policy(),null,2));

  const clockRef={ now:Date.UTC(2026,8,18,13,0,0) };
  const calls=[];
  const fetchImpl=makeFetch(clockRef,calls);
  const store={
    journal(){ return '00000000-0000-0000-0000-000000000001'; }
  };
  const committee=async()=>({ ok:true, text:'' });

  let primaryCalls=0;
  const firstPipeline={
    async run(input){
      primaryCalls++;
      assert.equal(input.executionIntent.symbol,'AAAUSDT');
      assert.notEqual(input.executionIntent.analysisTracking,true);
      return advisory('WATCH');
    }
  };
  const firstScanner={ async scan(){ return candidateScan(); } };

  const first=createLiveController({
    root,store,scanner:firstScanner,pipeline:firstPipeline,committee,
    credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' },
    fetchImpl,clock:()=>clockRef.now
  });
  assert.equal((await first.arm({confirmed:true})).armed,true);
  assert.equal(first.configureLeaderAuto({
    enabled:true,marginQuote:20,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true
  }).ok,true);

  const initial=await first.leaderAutoTick();
  assert.equal(initial.execution,'LEADER_AUTO_WAIT');
  assert.equal(primaryCalls,1);

  const stateFile=path.join(root,'data','leader-analysis-state.json');
  assert.equal(fs.existsSync(stateFile),true);
  const disk=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(disk.bySymbol.AAAUSDT.state,'WATCH');
  assert.equal(disk.bySymbol.AAAUSDT.reanalysisEligible,true);

  let trackedCalls=0;
  const statuses=['REJECT','WATCH'];
  const secondPipeline={
    async run(input){
      trackedCalls++;
      assert.equal(input.executionIntent.symbol,'AAAUSDT');
      assert.equal(input.executionIntent.side,'LONG');
      assert.equal(input.executionIntent.analysisTracking,true);
      return advisory(statuses[Math.min(trackedCalls-1,statuses.length-1)]);
    }
  };
  const emptyScanner={ async scan(){ return { universeCount:528, leaders:[] }; } };

  const second=createLiveController({
    root,store,scanner:emptyScanner,pipeline:secondPipeline,committee,
    credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' },
    fetchImpl,clock:()=>clockRef.now
  });

  const restored=second.leaderAutoStatus().analysisLifecycle;
  assert.equal(restored.tracked,1);
  assert.equal(restored.rows[0].symbol,'AAAUSDT');
  assert.equal(restored.rows[0].state,'WATCH');

  assert.equal((await second.arm({confirmed:true})).armed,true);
  const fetchesAfterArm=calls.length;

  clockRef.now += 60_000;
  const invalidated=await second.leaderAutoTick();
  assert.equal(invalidated.execution,'LEADER_AUTO_WAIT');
  assert.equal(trackedCalls,1);
  assert.equal(second.leaderAutoStatus().analysisLifecycle.rows[0].state,'INVALIDATED');
  assert.equal(second.leaderAutoStatus().analysisLifecycle.rows[0].reanalysisEligible,true);
  assert.equal(calls.length,fetchesAfterArm,'analysis-only reanalysis must not contact Binance order/account endpoints');

  clockRef.now += 60_000;
  const rebased=await second.leaderAutoTick();
  assert.equal(rebased.execution,'LEADER_AUTO_WAIT');
  assert.equal(trackedCalls,2);
  const afterRebase=second.leaderAutoStatus().analysisLifecycle.rows[0];
  assert.equal(afterRebase.state,'REBASE');
  assert.equal(afterRebase.rebaseCount,1);
  assert.equal(calls.length,fetchesAfterArm,'REBASE analysis-only pass must remain non-executing');

  fs.rmSync(root,{recursive:true,force:true});
});
