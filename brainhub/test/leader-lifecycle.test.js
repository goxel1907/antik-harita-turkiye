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
      const out=advisory('QUALIFIED');
      out.plan.jevDecision={called:true,ok:true,veto:false,model:'fixture-jev',summaryTr:'Test karar kaydı',timeframeConflicts:{'1h':0.1}};
      return out;
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
  assert.equal(st.diagnostics.candidates[0].jevDecision.called,true);
  assert.equal(st.diagnostics.candidates[0].jevDecision.model,'fixture-jev');
  assert.equal(st.diagnostics.candidates[0].jevDecision.timeframeConflicts['1h'],0.1);

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
  scan.leaders.unshift({
    symbol:'FIRSTUSDT',
    side:'LONG',
    attackRank:1,
    projectedRank:1,
    leaderState:'TOP3_APPROACH',
    tradeQuality:95,
    directionSupport:3,
    spreadBps:1,
    longExpansionScore:90,
    shortExpansionScore:5,
    expansionScore:90,
    leaderHunterScore:180,
    movementPotential:80
  });
  scan.leaders[1].attackRank=2;
  scan.leaders[1].projectedRank=2;

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
    enabled:true,marginQuote:5,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true
  }).ok,true);

  const out=await controller.liveReadiness({symbol:'AAAUSDT'});
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

test('targeted LiveReadiness refreshes persisted ARMED lifecycle when fresh 9TF plan falls back to WATCH', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-readiness-sync-watch-'));
  const cfg=path.join(root,'config');
  fs.mkdirSync(cfg,{recursive:true});
  fs.writeFileSync(path.join(cfg,'live-policy.json'),JSON.stringify(policy(),null,2));

  const clockRef={ now:Date.UTC(2026,8,19,2,0,0) };
  const fetchImpl=async()=>{ throw new Error('WATCH readiness must not contact Binance'); };
  const store={ journal(){ return '00000000-0000-0000-0000-000000000030'; } };
  let calls=0;
  const pipeline={
    async run(input){
      calls++;
      assert.equal(input.executionIntent.symbol,'AAAUSDT');
      return advisory(calls===1?'QUALIFIED':'WATCH');
    }
  };
  const scanner={ async scan(){ return candidateScan(); } };
  const controller=createLiveController({
    root,store,scanner,pipeline,committee:async()=>({ok:true,text:''}),
    credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' },
    fetchImpl,clock:()=>clockRef.now
  });

  assert.equal(controller.configureLeaderAuto({
    enabled:true,marginQuote:20,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true
  }).ok,true);

  const first=await controller.leaderAutoTick();
  assert.equal(first.execution,'LEADER_AUTO_WAIT_ARM');
  assert.equal(controller.leaderAutoStatus().analysisLifecycle.rows[0].state,'ARMED');

  clockRef.now += 60_000;
  const readiness=await controller.liveReadiness({symbol:'AAAUSDT'});
  assert.equal(readiness.readyForUserArm,false);
  assert.equal(readiness.planStatus,'WATCH');

  const row=controller.leaderAutoStatus().analysisLifecycle.rows.find(x=>x.symbol==='AAAUSDT');
  assert.equal(row.state,'WATCH');
  assert.equal(row.planStatus,'WATCH');
  assert.equal(row.executionEligibleNow,true);

  fs.rmSync(root,{recursive:true,force:true});
});

test('fresh REVIEW_REQUIRED readiness demotes a persisted ARMED lifecycle to WATCH', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-readiness-review-required-'));
  const cfg=path.join(root,'config');
  fs.mkdirSync(cfg,{recursive:true});
  fs.writeFileSync(path.join(cfg,'live-policy.json'),JSON.stringify(policy(),null,2));

  const clockRef={ now:Date.UTC(2026,8,19,2,10,0) };
  const fetchImpl=async()=>{ throw new Error('review-required readiness must not contact Binance'); };
  const store={ journal(){ return '00000000-0000-0000-0000-000000000032'; } };
  let calls=0;
  const pipeline={
    async run(input){
      calls++;
      assert.equal(input.executionIntent.symbol,'AAAUSDT');
      if(calls===1) return advisory('QUALIFIED');
      const out=advisory('REVIEW_REQUIRED');
      out.plan.reason='VISION_COMMITTEE_UNAVAILABLE';
      out.plan.valid=false;
      return out;
    }
  };
  const scanner={ async scan(){ return candidateScan(); } };
  const controller=createLiveController({
    root,store,scanner,pipeline,committee:async()=>({ok:true,text:''}),
    credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' },
    fetchImpl,clock:()=>clockRef.now
  });

  assert.equal(controller.configureLeaderAuto({
    enabled:true,marginQuote:20,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true
  }).ok,true);

  const first=await controller.leaderAutoTick();
  assert.equal(first.execution,'LEADER_AUTO_WAIT_ARM');
  assert.equal(controller.leaderAutoStatus().analysisLifecycle.rows[0].state,'ARMED');

  clockRef.now += 60_000;
  const readiness=await controller.liveReadiness({symbol:'AAAUSDT'});
  assert.equal(readiness.readyForUserArm,false);
  assert.equal(readiness.planStatus,'REVIEW_REQUIRED');
  assert.ok(readiness.reasons.includes('VISION_COMMITTEE_UNAVAILABLE'));

  const row=controller.leaderAutoStatus().analysisLifecycle.rows.find(x=>x.symbol==='AAAUSDT');
  assert.equal(row.state,'WATCH');
  assert.equal(row.planStatus,'REVIEW_REQUIRED');
  assert.equal(row.planReason,'VISION_COMMITTEE_UNAVAILABLE');
  assert.equal(row.executionEligibleNow,true);

  fs.rmSync(root,{recursive:true,force:true});
});

test('tracked ARMED row is presented as WATCH when targeted readiness says symbol is no longer execution eligible', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-readiness-sync-ineligible-'));
  const cfg=path.join(root,'config');
  fs.mkdirSync(cfg,{recursive:true});
  fs.writeFileSync(path.join(cfg,'live-policy.json'),JSON.stringify(policy(),null,2));

  const clockRef={ now:Date.UTC(2026,8,19,2,20,0) };
  const fetchImpl=async()=>{ throw new Error('ineligible readiness must not contact Binance'); };
  const store={ journal(){ return '00000000-0000-0000-0000-000000000031'; } };
  const pipeline={ async run(){ return advisory('QUALIFIED'); } };
  let current='AAAUSDT';
  const scanner={
    async scan(){
      const scan=candidateScan();
      scan.leaders[0].symbol=current;
      return scan;
    }
  };
  const controller=createLiveController({
    root,store,scanner,pipeline,committee:async()=>({ok:true,text:''}),
    credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' },
    fetchImpl,clock:()=>clockRef.now
  });

  assert.equal(controller.configureLeaderAuto({
    enabled:true,marginQuote:20,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true
  }).ok,true);
  await controller.leaderAutoTick();
  assert.equal(controller.leaderAutoStatus().analysisLifecycle.rows[0].state,'ARMED');

  current='BBBUSDT';
  clockRef.now += 60_000;
  const readiness=await controller.liveReadiness({symbol:'AAAUSDT'});
  assert.equal(readiness.readyForUserArm,false);
  assert.equal(readiness.symbol,'AAAUSDT');
  assert.ok(readiness.reasons.includes('READINESS_SYMBOL_NOT_EXECUTION_ELIGIBLE'));

  const row=controller.leaderAutoStatus().analysisLifecycle.rows.find(x=>x.symbol==='AAAUSDT');
  assert.equal(row.state,'WATCH');
  assert.equal(row.planStatus,'REVIEW_REQUIRED');
  assert.equal(row.persistedState,'ARMED');
  assert.equal(row.persistedPlanStatus,'QUALIFIED');
  assert.equal(row.executionEligibleNow,false);
  assert.equal(row.statusReason,'READINESS_SYMBOL_NOT_EXECUTION_ELIGIBLE');

  fs.rmSync(root,{recursive:true,force:true});
});

test('leader lifecycle creates a new setupId when a non-active tracked direction flips', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-side-lineage-'));
  const cfg=path.join(root,'config');
  fs.mkdirSync(cfg,{recursive:true});
  fs.writeFileSync(path.join(cfg,'live-policy.json'),JSON.stringify(policy(),null,2));

  const clockRef={ now:Date.UTC(2026,8,19,3,0,0) };
  const fetchImpl=async()=>{ throw new Error('analysis-only side flip must not contact Binance'); };
  const store={ journal(){ return '00000000-0000-0000-0000-000000000033'; } };
  let calls=0;
  const pipeline={
    async run(){
      calls++;
      return calls===1 ? advisory('QUALIFIED','LONG') : advisory('WATCH','SHORT');
    }
  };
  const scanner={ async scan(){ return candidateScan(); } };
  const controller=createLiveController({
    root,store,scanner,pipeline,committee:async()=>({ok:true,text:''}),
    credentials:{ apiKey:'test-api-key', apiSecret:'test-api-secret' },
    fetchImpl,clock:()=>clockRef.now
  });

  assert.equal(controller.configureLeaderAuto({
    enabled:true,marginQuote:20,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true
  }).ok,true);

  const first=await controller.leaderAutoTick();
  assert.equal(first.execution,'LEADER_AUTO_WAIT_ARM');
  const before=controller.leaderAutoStatus().analysisLifecycle.rows.find(x=>x.symbol==='AAAUSDT');
  assert.equal(before.side,'LONG');
  assert.match(before.setupId,/^LHSET:AAAUSDT:LONG:/);

  clockRef.now += 60_000;
  const second=await controller.leaderAutoTick();
  assert.equal(second.execution,'LEADER_AUTO_WAIT');
  const after=controller.leaderAutoStatus().analysisLifecycle.rows.find(x=>x.symbol==='AAAUSDT');
  assert.equal(after.side,'SHORT');
  assert.equal(after.state,'WATCH');
  assert.notEqual(after.setupId,before.setupId);
  assert.match(after.setupId,/^LHSET:AAAUSDT:SHORT:/);
  assert.equal(after.lineageSideChanged,true);
  assert.equal(after.previousSetupId,before.setupId);

  fs.rmSync(root,{recursive:true,force:true});
});

test('restart repairs historical side/setup mismatch once and preserves active lineage', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-lineage-migration-'));
  try {
    fs.mkdirSync(path.join(root,'data'));
    const filename=path.join(root,'data','leader-analysis-state.json');
    const now=Date.UTC(2026,8,19,10,0,0);
    const broken={symbol:'AAAUSDT',side:'SHORT',setupId:'LHSET:AAAUSDT:LONG:legacy',state:'ARMED',planStatus:'QUALIFIED',lastAnalyzedAt:now};
    const active={...broken,symbol:'BBBUSDT',setupId:'LHSET:BBBUSDT:LONG:active',state:'ACTIVE'};
    fs.writeFileSync(filename,JSON.stringify({bySymbol:{AAAUSDT:broken,BBBUSDT:active}}));
    const deps={root,store:{journal(){}},scanner:{},pipeline:{},committee:async()=>({}),clock:()=>now};
    const first=createLiveController(deps).leaderAutoStatus().analysisLifecycle.rows;
    const repaired=first.find(x=>x.symbol==='AAAUSDT');
    assert.match(repaired.setupId,/^LHSET:AAAUSDT:SHORT:/);
    assert.equal(repaired.previousSetupId,broken.setupId);
    assert.equal(repaired.state,'WATCH');
    assert.equal(repaired.planStatus,'REVIEW_REQUIRED');
    assert.equal(repaired.executionEligibleNow,false);
    assert.deepEqual(first.find(x=>x.symbol==='BBBUSDT'),active);
    const second=createLiveController(deps).leaderAutoStatus().analysisLifecycle.rows.find(x=>x.symbol==='AAAUSDT');
    assert.equal(second.setupId,repaired.setupId);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('fresh failed vision cannot retain an earlier nine-chart success', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-fresh-vision-'));
  try {
    fs.mkdirSync(path.join(root,'config'));
    fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify(policy()));
    let failed=false;
    const controller=createLiveController({root,store:{journal(){}},scanner:{async scan(){return candidateScan();}},
      pipeline:{async run(){const out=advisory(failed?'REVIEW_REQUIRED':'WATCH'); if(failed){out.vision.attached=0;out.committee=null;out.plan.confidence=null;} return out;}},
      committee:async()=>({}),fetchImpl:async()=>{throw Error('must not contact exchange');}});
    controller.configureLeaderAuto({enabled:true,marginQuote:20,leverage:10,maxOpenPositions:3,allowLong:true,allowShort:true});
    await controller.leaderAutoTick();
    assert.equal(controller.leaderAutoStatus().analysisLifecycle.rows[0].visionAttached,9);
    failed=true;
    await controller.leaderAutoTick();
    const row=controller.leaderAutoStatus().analysisLifecycle.rows[0];
    assert.equal(row.visionAttached,0);
    assert.equal(row.confidence,null);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
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


test('re-enabling Leader Auto suppresses stale disabled status until the next tick', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-leader-stale-disabled-'));
  try {
    fs.mkdirSync(path.join(root,'config'),{recursive:true});
    fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify(policy(),null,2));
    const controller=createLiveController({
      root,
      store:{ journal(){} },
      scanner:{ async scan(){ return candidateScan(); } },
      pipeline:{ async run(){ return advisory('WATCH'); } },
      committee:async()=>({ok:true,text:''}),
      fetchImpl:async()=>{ throw new Error('disabled tick must not contact exchange'); }
    });

    const disabled=await controller.leaderAutoTick();
    assert.equal(disabled.execution,'LEADER_AUTO_DISABLED');
    assert.equal(controller.leaderAutoStatus().lastExecution,'LEADER_AUTO_DISABLED');

    const cfg=controller.configureLeaderAuto({
      enabled:true,marginQuote:25,leverage:10,maxOpenPositions:2,allowLong:true,allowShort:true
    });
    assert.equal(cfg.ok,true);
    const status=controller.leaderAutoStatus();
    assert.equal(status.enabled,true);
    assert.equal(status.lastExecution,null);
    assert.deepEqual(status.lastReasons,[]);
    assert.equal(status.consecutiveBlocked,0);
    assert.equal(status.lastTickAt,null);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});


test('OTO health telemetry counts deep analysis and final plan status without changing LIVE state', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-oto-health-'));
  try {
    fs.mkdirSync(path.join(root,'config'),{recursive:true});
    fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify(policy(),null,2));
    const clockRef={ now:Date.UTC(2026,8,20,19,0,0) };
    const controller=createLiveController({
      root,
      store:{ journal(){ return 'health-journal'; } },
      scanner:{ async scan(){ return candidateScan(); } },
      pipeline:{ async run(){ clockRef.now += 1250; return advisory('QUALIFIED'); } },
      committee:async()=>({ok:true,text:''}),
      fetchImpl:async()=>{ throw new Error('disarmed health test must not contact exchange'); },
      clock:()=>clockRef.now
    });
    assert.equal(controller.configureLeaderAuto({
      enabled:true,marginQuote:25,leverage:10,maxOpenPositions:2,allowLong:true,allowShort:true
    }).ok,true);

    const out=await controller.leaderAutoTick();
    assert.equal(out.analysisOnly,true);
    const health=controller.leaderAutoStatus().health;
    assert.equal(health.scanRuns,1);
    assert.equal(health.deepAnalyses,1);
    assert.equal(health.uniqueAnalyzedSymbols,1);
    assert.equal(health.qualified,1);
    assert.equal(health.watch,0);
    assert.equal(health.visionUnavailable,0);
    assert.equal(health.ordersPlaced,0);
    assert.equal(health.avgAnalysisMs,1250);
    assert.equal(controller.status().armed,false);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('coverage scheduler analyzes a fresh second candidate before repeating the recent first candidate', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-oto-coverage-'));
  try {
    fs.mkdirSync(path.join(root,'config'),{recursive:true});
    fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify(policy(),null,2));
    const clockRef={ now:Date.UTC(2026,8,20,20,0,0) };
    const base={
      side:'LONG',projectedRank:1,leaderState:'TOP3_APPROACH',
      tradeQuality:90,directionSupport:3,spreadBps:1,
      longExpansionScore:80,shortExpansionScore:5,expansionScore:80,
      leaderHunterScore:150,movementPotential:75
    };
    const scan={
      universeCount:523,
      leaders:[
        { ...base, symbol:'AAAUSDT', attackRank:1 },
        { ...base, symbol:'BBBUSDT', attackRank:2, projectedRank:2, leaderHunterScore:145 }
      ],
      top3Approach:[],top10Approach:[],earlyTop5:[],earlyExpansion:[]
    };
    const seen=[];
    const controller=createLiveController({
      root,
      store:{ journal(){ return 'coverage-journal'; } },
      scanner:{ async scan(){ return scan; } },
      pipeline:{ async run(input){ seen.push(input.executionIntent.symbol); return advisory('WATCH'); } },
      committee:async()=>({ok:true,text:''}),
      fetchImpl:async()=>{ throw new Error('disarmed coverage test must not contact exchange'); },
      clock:()=>clockRef.now
    });
    assert.equal(controller.configureLeaderAuto({
      enabled:true,marginQuote:25,leverage:10,maxOpenPositions:2,allowLong:true,allowShort:true
    }).ok,true);

    await controller.leaderAutoTick();
    clockRef.now += 30000;
    await controller.leaderAutoTick();
    assert.deepEqual(seen,['AAAUSDT','BBBUSDT']);
    const health=controller.leaderAutoStatus().health;
    assert.equal(health.deepAnalyses,2);
    assert.equal(health.uniqueAnalyzedSymbols,2);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});


test('Leader Auto reuses the already-qualified 9TF/Jev plan instead of requiring a second Vision qualification', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-leader-approved-reuse-'));
  try {
    const cfg=path.join(root,'config');
    fs.mkdirSync(cfg,{recursive:true});
    fs.writeFileSync(path.join(cfg,'live-policy.json'),JSON.stringify(policy(),null,2));
    const clockRef={ now:Date.UTC(2026,8,20,21,0,0) };
    const fetches=[];
    const fetchImpl=async (url,opts={})=>{
      const u=new URL(String(url));
      const method=String(opts.method||'GET').toUpperCase();
      fetches.push({method,path:u.pathname});
      if(u.pathname==='/fapi/v1/time') return response({serverTime:clockRef.now});
      if(u.pathname==='/fapi/v3/account') return response({
        totalWalletBalance:'100',totalMarginBalance:'100',availableBalance:'100',totalUnrealizedProfit:'0',positions:[]
      });
      if(u.pathname==='/fapi/v1/positionSide/dual') return response({dualSidePosition:false});
      if(u.pathname==='/fapi/v1/income') return response([]);
      if(u.pathname==='/fapi/v1/commissionRate') return response({symbol:'AAAUSDT',makerCommissionRate:'0.0002',takerCommissionRate:'0.0004'});
      if(u.pathname==='/fapi/v1/exchangeInfo') return response({symbols:[{
        symbol:'AAAUSDT',
        filters:[
          {filterType:'PRICE_FILTER',tickSize:'0.01',minPrice:'0.01',maxPrice:'1000000'},
          {filterType:'MARKET_LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'1000000'},
          {filterType:'MIN_NOTIONAL',notional:'5'}
        ]
      }]});
      if(u.pathname==='/fapi/v1/ticker/price') return response({symbol:'AAAUSDT',price:'102'});
      if(u.pathname==='/fapi/v1/leverageBracket') return response([{
        symbol:'AAAUSDT',
        brackets:[{bracket:1,notionalFloor:0,notionalCap:1000000,maintMarginRatio:0.095}]
      }]);
      throw new Error('unexpected Binance fetch '+method+' '+u.pathname);
    };
    const store={
      journal(){ return '00000000-0000-0000-0000-000000009105'; },
      lease(action){
        if(action==='acquire'||action==='renew')return {acquired:true,owner:'BRAINHUB_PC',expiresAt:clockRef.now+120000};
        if(action==='release')return {released:true};
        return {acquired:false};
      },
      claim(eventId,owner,resource,token,lineageId){ return {claimed:true,eventId,owner,lineageId}; },
      releaseClaim(){ return {released:true}; },
      recordLearning(){}
    };
    const scan=candidateScan();
    let pipelineCalls=0;
    const approved=advisory('QUALIFIED');
    approved.plan.jevDecision={ok:true,required:true,called:true,veto:false,vetoReasons:[]};
    approved.jevDecision=approved.plan.jevDecision;
    approved.preJevPlan={...approved.plan};
    approved.unifiedContext={
      symbol:'AAAUSDT',
      livePrice:100,
      dataQuality:{advisoryUsable:true},
      microstructure:{spreadBps:1,depthSoftContext:{micropriceBps:0}},
      frames:{
        '1m':{available:true,fresh:true,atrPct:1,prior20Low:95,prior20High:105,breakoutExecution:{status:'READY'}},
        '5m':{available:true,fresh:true,atrPct:1,prior20Low:94,prior20High:106,breakoutExecution:{status:'READY'}}
      },
      opportunityPaths:{
        LONG:{originTF:'1m',ownerTF:'5m',continuity:[
          {frame:'1m',immediateEligible:true,state:'ACTIVE_CONTEXT'},
          {frame:'5m',immediateEligible:false,state:'OWNER_CONTEXT'}
        ]},
        SHORT:{originTF:null,ownerTF:null,continuity:[]}
      }
    };
    const pipeline={
      resolveExecutionCandidate(){ return {candidate:scan.leaders[0],requestedSymbol:'AAAUSDT',targeted:true}; },
      async run(){
        pipelineCalls++;
        if(pipelineCalls>1) throw new Error('SECOND_VISION_PASS_MUST_NOT_RUN');
        return approved;
      }
    };
    const controller=createLiveController({
      root,store,scanner:{async scan(){return scan;}},pipeline,committee:async()=>({ok:true,text:''}),
      credentials:{apiKey:'test-api-key',apiSecret:'test-api-secret'},fetchImpl,clock:()=>clockRef.now
    });
    assert.equal((await controller.arm({confirmed:true})).armed,true);
    assert.equal(controller.configureLeaderAuto({
      enabled:true,marginQuote:20,leverage:10,maxOpenPositions:2,allowLong:true,allowShort:true
    }).ok,true);

    const out=await controller.leaderAutoTick();
    assert.equal(pipelineCalls,1,'live execution must reuse the first qualified Vision/Jev decision');
    assert.equal(out.orderPlaced,false);
    assert.ok(Array.isArray(out.reasons));
    // CLAUDE_V111_JEV_FINAL_AUTHORITY: JEV onayından sonra ATR chase artık stratejik
    // veto değildir. Akış hard-safety aşamasına kadar ilerlemeli; bu fixture özellikle
    // likidasyona çok yakın bakım marjı vererek STOP_BEYOND_LIQUIDATION ile fail-closed olur.
    assert.ok(out.reasons.includes('STOP_BEYOND_LIQUIDATION'),JSON.stringify(out.reasons));
    assert.equal(fetches.some(x=>x.path==='/fapi/v1/leverageBracket'),true,'JEV-approved flow must reach hard-safety leverage bracket check');
    assert.equal(fetches.some(x=>x.method==='POST'),false,'hard-safety block must occur before any Binance write');
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
