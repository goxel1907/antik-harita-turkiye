'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUnifiedContext, liquidationContext, planFields, combineRiskGate, enforceExecutionLineage, combineExecutionReadiness, resolveExecutionCandidate, visionPlanContract, visionRepairLabels, visionRepairPrompt, mergeVisionRepairText } = require('../pipeline');
const { preflightRiskGate, accountRiskCaps, structuralStopGate, killSwitchGate, executionClaimGate } = require('../risk-gate');
const { buildDryRunOrder } = require('../binance-dry-run-executor');

function frame(asOf, longScore, shortScore) {
  return {
    available:true, asOf, close:100, trend:longScore > shortScore ? 'UP' : 'DOWN', rsi14:55, atrPct:1,
    prior20High:101, prior20Low:99, breakOfStructure:null, returnPct:0.5,
    candle:{ direction:'BULL' }, patterns:[], recentFairValueGaps:[], buySideLiquidity:101, sellSideLiquidity:99,
    liquidity:{ equalHigh:null, equalLow:null, lastSweep:null },
    opportunity:{ available:true, longScore, shortScore, state:'WATCH', preferredSide:longScore > shortScore ? 'LONG' : 'SHORT', originEligible:true, ownerEligible:true }
  };
}

function unifiedFixture() {
  const now = Date.UTC(2026, 8, 17, 10, 0, 0);
  const symbol = {
    symbol:'BTCUSDT',
    timeframes:{
      '1m':frame(now - 60000, 70, 10),
      '3m':frame(now - 180000, 62, 15),
      '5m':frame(now - 300000, 55, 20),
      '15m':frame(now - 15 * 60000, 20, 20)
    },
    microstructure:{
      available:true, bid:100, ask:100.1, sourceQuality:'STREAMING_PARTIAL_BOOK',
      streaming:{ available:true },
      observedLiquidations:{ available:true, count:1, asOf:now, longLiquidatedQuote:25000, shortLiquidatedQuote:0, zones:[{side:'LONG_LIQUIDATED',price:99.5,observedQuote:25000}] }
    },
    streamHealth:{ connected:true }
  };
  const global = { marketCap:{available:false}, btc:{available:false}, eth:{available:false}, ethbtc:{available:false} };
  return { now, unified:buildUnifiedContext({ symbol, global, now }) };
}

function qualifiedPlan() {
  return planFields([
    'STATUS: QUALIFIED',
    'SIDE: LONG',
    'CONFIDENCE: 78',
    'ORIGIN_TF: 1m',
    'OWNER_TF: 5m',
    'SETUP: continuation',
    'EXEC_PATH: reclaim-or-continuity',
    'WHY: deterministic regression fixture',
    'RISK_NOTE: preserve structural invalidation',
    'EXECUTION: ADVISORY_ONLY'
  ].join('\n'));
}

test('Vision plan contract requires detailed Turkish WHY WAIT ROLE FORMING RISK for all 9 timeframes', () => {
  const tags={ '1m':'1M','3m':'3M','5m':'5M','15m':'15M','30m':'30M','45m':'45M','1h':'1H','4h':'4H','1d':'1D' };
  const roles={ '1m':'SUPPORT','3m':'SUPPORT','5m':'NEUTRAL','15m':'VETO','30m':'NEUTRAL','45m':'NEUTRAL','1h':'SUPPORT','4h':'NEUTRAL','1d':'NEUTRAL' };
  const tfLines=[];
  for (const tf of Object.keys(tags)) {
    const tag=tags[tf];
    tfLines.push(
      'TF_'+tag+': Türkçe '+tf+' grafik ve veri özeti',
      'TF_'+tag+'_WHY: '+tf+' yapısında somut neden',
      'TF_'+tag+'_WAIT: '+(tf==='15m'?'kapanmış mum reclaim':'NONE'),
      'TF_'+tag+'_ROLE: '+roles[tf],
      'TF_'+tag+'_FORMING: forming mum yalnız bağlamdır; kapanış teyidi değildir',
      'TF_'+tag+'_RISK: '+tf+' ana yapısal risk'
    );
  }

  const complete = planFields([
    'STATUS: WATCH',
    'SIDE: LONG',
    'CONFIDENCE: 70',
    'ORIGIN_TF: 1m',
    'OWNER_TF: 1h',
    'SETUP: continuation',
    'EXEC_PATH: reclaim',
    'WHY: Türkçe somut gerekçe',
    'RISK_NOTE: Türkçe ana risk',
    'WAIT_FOR: 15m veto kalkarken 1m yapısı korunmalı',
    'SUPPORT_TFS: 1m,3m,1h',
    'VETO_TFS: 15m',
    'FORMING_CONTEXT: Dokuz TF forming mumları yalnız anlık bağlamdır ve kapanmış mum teyidi değildir',
    ...tfLines,
    'VISION_SUMMARY: Dokuz grafiğin ortak yapısı, destek/veto ilişkisi ve çelişkisi',
    'EXECUTION: ADVISORY_ONLY'
  ].join('\n'));

  assert.deepEqual(visionPlanContract(complete), { ok:true, missing:[], warnings:[] });
  assert.deepEqual(complete.supportTFs,['1m','3m','1h']);
  assert.deepEqual(complete.vetoTFs,['15m']);
  assert.equal(complete.timeframeDiagnostics['1m'].role,'SUPPORT');
  assert.match(complete.timeframeDiagnostics['15m'].waitFor,/reclaim/);
  assert.match(complete.timeframeDiagnostics['4h'].formingContext,/kapanış teyidi değildir/);

  const incompleteLines=tfLines.filter(x=>!x.startsWith('TF_3M_WAIT:'));
  const incomplete = planFields([
    'STATUS: QUALIFIED',
    'SIDE: LONG',
    'CONFIDENCE: 80',
    'ORIGIN_TF: 1m',
    'OWNER_TF: 1h',
    'SETUP: continuation',
    'EXEC_PATH: direct',
    'WHY: gerekçe var',
    'RISK_NOTE: risk var',
    'WAIT_FOR: NONE',
    'SUPPORT_TFS: 1m,1h',
    'VETO_TFS: 15m',
    'FORMING_CONTEXT: forming yalnız bağlam',
    ...incompleteLines,
    'VISION_SUMMARY: özet var'
  ].join('\n'));

  const contract = visionPlanContract(incomplete);
  assert.equal(contract.ok,false);
  assert.ok(contract.missing.includes('TF_3M_WAIT'));
  assert.ok(!contract.missing.includes('SUPPORT_TFS_ROLE_MISMATCH'));
  assert.ok(contract.warnings.includes('SUPPORT_TFS_ROLE_MISMATCH'));
});
test('QUALIFIED Vision plan is rejected when WAIT_FOR still contains a pending trigger', () => {
  const tags={ '1m':'1M','3m':'3M','5m':'5M','15m':'15M','30m':'30M','45m':'45M','1h':'1H','4h':'4H','1d':'1D' };
  const tfLines=[];
  for (const [tf,tag] of Object.entries(tags)) {
    tfLines.push(
      'TF_'+tag+': '+tf+' özet',
      'TF_'+tag+'_WHY: '+tf+' somut neden',
      'TF_'+tag+'_WAIT: NONE',
      'TF_'+tag+'_ROLE: '+(tf==='1m'||tf==='5m'?'SUPPORT':'NEUTRAL'),
      'TF_'+tag+'_FORMING: forming mum yalnız bağlamdır; kapanış teyidi değildir',
      'TF_'+tag+'_RISK: '+tf+' ana risk'
    );
  }
  const plan=planFields([
    'STATUS: QUALIFIED',
    'SIDE: LONG',
    'CONFIDENCE: 81',
    'ORIGIN_TF: 1m',
    'OWNER_TF: 5m',
    'SETUP: continuation',
    'EXEC_PATH: direct',
    'WHY: kapalı mum yapısı destekliyor',
    'RISK_NOTE: yapı bozulursa geçersiz',
    'WAIT_FOR: 5m kapanışı ayrıca onaylanmalı',
    'SUPPORT_TFS: 1m,5m',
    'VETO_TFS: NONE',
    'FORMING_CONTEXT: forming mum teyit değildir',
    ...tfLines,
    'VISION_SUMMARY: 9TF ortak yapı özeti',
    'EXECUTION: ADVISORY_ONLY'
  ].join('\n'));
  const contract=visionPlanContract(plan);
  assert.equal(plan.valid,true);
  assert.equal(plan.status,'QUALIFIED');
  assert.equal(contract.ok,false);
  assert.ok(contract.missing.includes('QUALIFIED_WAIT_FOR_NOT_NONE'));
});

test('Vision repair pass can fill omitted TF fields without changing existing parsed fields', () => {
  const tags={ '1m':'1M','3m':'3M','5m':'5M','15m':'15M','30m':'30M','45m':'45M','1h':'1H','4h':'4H','1d':'1D' };
  const roles={ '1m':'SUPPORT','3m':'SUPPORT','5m':'SUPPORT','15m':'VETO','30m':'NEUTRAL','45m':'NEUTRAL','1h':'NEUTRAL','4h':'NEUTRAL','1d':'NEUTRAL' };
  const tfLines=[];
  for(const tf of Object.keys(tags)){
    if(tf==='30m'||tf==='45m')continue;
    const tag=tags[tf];
    tfLines.push(
      'TF_'+tag+': '+tf+' özet',
      'TF_'+tag+'_WHY: '+tf+' neden',
      'TF_'+tag+'_WAIT: NONE',
      'TF_'+tag+'_ROLE: '+roles[tf],
      'TF_'+tag+'_FORMING: forming bağlam',
      'TF_'+tag+'_RISK: '+tf+' risk'
    );
  }
  const baseText=[
    'STATUS: WATCH','SIDE: SHORT','CONFIDENCE: 66','ORIGIN_TF: 1m','OWNER_TF: 5m',
    'SETUP: reclaim','EXEC_PATH: retest','WHY: ana neden','RISK_NOTE: ana risk','WAIT_FOR: 30m ve 45m bağlamı',
    'SUPPORT_TFS: 1m,3m,5m','VETO_TFS: 15m','FORMING_CONTEXT: forming teyit değildir',
    ...tfLines,'VISION_SUMMARY: ortak yapı','EXECUTION: ADVISORY_ONLY'
  ].join('\n');
  const before=planFields(baseText);
  const contractBefore=visionPlanContract(before);
  assert.equal(contractBefore.ok,false);
  assert.ok(contractBefore.missing.includes('TF_30M'));
  assert.ok(contractBefore.missing.includes('TF_45M_RISK'));

  const labels=visionRepairLabels(contractBefore.missing);
  assert.ok(labels.includes('TF_30M'));
  assert.ok(labels.includes('TF_45M_RISK'));
  const repairPrompt=visionRepairPrompt('ORIGINAL',before,contractBefore.missing);
  assert.match(repairPrompt,/MISSING_LABELS:/);
  assert.match(repairPrompt,/TF_30M/);

  const repairText=[
    'TF_30M: 30m özet','TF_30M_WHY: 30m neden','TF_30M_WAIT: NONE','TF_30M_ROLE: NEUTRAL','TF_30M_FORMING: 30m forming bağlam','TF_30M_RISK: 30m risk',
    'TF_45M: sentetik 45m özet','TF_45M_WHY: 45m neden','TF_45M_WAIT: NONE','TF_45M_ROLE: NEUTRAL','TF_45M_FORMING: 45m forming bağlam','TF_45M_RISK: 45m risk'
  ].join('\n');
  const repaired=planFields(mergeVisionRepairText(baseText,repairText));
  const contractAfter=visionPlanContract(repaired);
  assert.equal(repaired.status,'WATCH');
  assert.equal(repaired.side,'SHORT');
  assert.equal(repaired.why,'ana neden');
  assert.deepEqual(contractAfter,{ok:true,missing:[],warnings:[]});
});

test('per-TF roles are canonical while contradictory SUPPORT_TFS/VETO_TFS summaries stay visible as warnings', () => {
  const tags={ '1m':'1M','3m':'3M','5m':'5M','15m':'15M','30m':'30M','45m':'45M','1h':'1H','4h':'4H','1d':'1D' };
  const roles={ '1m':'SUPPORT','3m':'SUPPORT','5m':'SUPPORT','15m':'NEUTRAL','30m':'VETO','45m':'NEUTRAL','1h':'NEUTRAL','4h':'VETO','1d':'NEUTRAL' };
  const tfLines=[];
  for(const tf of Object.keys(tags)){
    const tag=tags[tf];
    tfLines.push(
      'TF_'+tag+': Türkçe özet',
      'TF_'+tag+'_WHY: somut neden',
      'TF_'+tag+'_WAIT: NONE',
      'TF_'+tag+'_ROLE: '+roles[tf],
      'TF_'+tag+'_FORMING: forming yalnız bağlamdır',
      'TF_'+tag+'_RISK: ana risk'
    );
  }
  const plan=planFields([
    'STATUS: WATCH','SIDE: SHORT','CONFIDENCE: 72','ORIGIN_TF: 3m','OWNER_TF: 5m',
    'SETUP: support flip','EXEC_PATH: retest','WHY: somut','RISK_NOTE: risk','WAIT_FOR: NONE',
    'SUPPORT_TFS: 1m,3m,5m','VETO_TFS: 30m,1h,4h',
    'FORMING_CONTEXT: forming bağlamdır',...tfLines,'VISION_SUMMARY: ortak yapı','EXECUTION: ADVISORY_ONLY'
  ].join('\n'));
  assert.deepEqual(plan.supportTFs,['1m','3m','5m']);
  assert.deepEqual(plan.vetoTFs,['30m','4h']);
  assert.deepEqual(plan.declaredVetoTFs,['30m','1h','4h']);
  assert.deepEqual(plan.roleConsistencyWarnings,['VETO_TFS_ROLE_MISMATCH']);
  assert.deepEqual(visionPlanContract(plan),{ok:true,missing:[],warnings:['VETO_TFS_ROLE_MISMATCH']});
});
test('plan parser accepts harmless Markdown/JSON-like label decoration without inventing missing KKK fields', () => {
  const tags=['1M','3M','5M','15M','30M','45M','1H','4H','1D'];
  const lines=[
    '```text',
    '- **STATUS:** watch',
    '- **SIDE:** long',
    '- **CONFIDENCE:** 72',
    '- **ORIGIN_TF:** 1m',
    '- **OWNER_TF:** 1h',
    '- **SETUP:** reclaim',
    '- **EXEC_PATH:** continuation',
    '- **WHY:** Türkçe somut neden',
    '- **RISK_NOTE:** Türkçe risk',
    '- **WAIT_FOR:** NONE',
    '- **SUPPORT_TFS:** 1m,3m,1h',
    '- **VETO_TFS:** 15m',
    '- **FORMING_CONTEXT:** forming yalnız bağlamdır, teyit değildir'
  ];
  const roles={ '1M':'SUPPORT','3M':'SUPPORT','5M':'NEUTRAL','15M':'VETO','30M':'NEUTRAL','45M':'NEUTRAL','1H':'SUPPORT','4H':'NEUTRAL','1D':'NEUTRAL' };
  for(const tag of tags){
    lines.push(
      '- **TF_'+tag+':** Türkçe özet',
      '- **TF_'+tag+'_WHY:** somut neden',
      '- **TF_'+tag+'_WAIT:** NONE',
      '- **TF_'+tag+'_ROLE:** '+roles[tag],
      '- **TF_'+tag+'_FORMING:** forming kapanış teyidi değildir',
      '- **TF_'+tag+'_RISK:** ana risk'
    );
  }
  lines.push('- **VISION_SUMMARY:** ortak yapı ve çelişki','```');
  const plan=planFields(lines.join('\n'));
  assert.equal(plan.valid,true);
  assert.equal(plan.status,'WATCH');
  assert.equal(plan.side,'LONG');
  assert.deepEqual(visionPlanContract(plan),{ok:true,missing:[],warnings:[]});
  assert.match(plan.rawOutputSnippet,/\*\*STATUS:/);

  const partial=planFields('**STATUS:** WATCH\n**SIDE:** sideways\n**WHY:** korunmalı');
  assert.equal(partial.valid,false);
  assert.equal(partial.status,'WATCH');
  assert.equal(partial.side,null);
  assert.equal(partial.why,'korunmalı');
  assert.match(partial.rawOutputSnippet,/SIDE/);
});
test('LIVE execution candidate is locked to the requested signal symbol instead of the top scanner pick', () => {
  const scan = {
    leaders:[
      {
        symbol:'AAAUSDT', side:'LONG', attackRank:1, leaderState:'TOP3_APPROACH',
        tradeQuality:90, directionSupport:3, spreadBps:1, longExpansionScore:80, shortExpansionScore:2,
        leaderHunterScore:150, movementPotential:70, expansionScore:80
      },
      {
        symbol:'BBBUSDT', side:'SHORT', attackRank:2, leaderState:'EARLY_TOP5',
        tradeQuality:76, directionSupport:2, spreadBps:2, longExpansionScore:4, shortExpansionScore:52,
        leaderHunterScore:95, movementPotential:45, expansionScore:52
      }
    ]
  };

  const advisory = resolveExecutionCandidate(scan, null);
  assert.equal(advisory.candidate.symbol, 'AAAUSDT');

  const targeted = resolveExecutionCandidate(scan, { symbol:'BBBUSDT' });
  assert.equal(targeted.targeted, true);
  assert.equal(targeted.requestedSymbol, 'BBBUSDT');
  assert.equal(targeted.candidate.symbol, 'BBBUSDT');
  assert.equal(targeted.reason, null);
});

test('LIVE execution rejects the requested symbol explicitly when it is not execution eligible', () => {
  const scan = {
    leaders:[
      {
        symbol:'AAAUSDT', side:'LONG', attackRank:1, leaderState:'TOP3_APPROACH',
        tradeQuality:90, directionSupport:3, spreadBps:1, longExpansionScore:80, shortExpansionScore:2,
        leaderHunterScore:150
      },
      {
        symbol:'BBBUSDT', side:'SHORT', attackRank:2, leaderState:'EARLY_TOP5',
        tradeQuality:40, directionSupport:0, spreadBps:12, longExpansionScore:2, shortExpansionScore:20,
        leaderHunterScore:60
      }
    ]
  };

  const targeted = resolveExecutionCandidate(scan, { symbol:'BBBUSDT' });
  assert.equal(targeted.targeted, true);
  assert.equal(targeted.candidate, null);
  assert.equal(targeted.reason, 'REQUESTED_SYMBOL_NOT_EXECUTION_ELIGIBLE');
});

test('Unified Brain can originate at 1m without waiting for 15m and carries observed liquidations as context', () => {
  const { unified:u } = unifiedFixture();
  assert.equal(u.opportunityPaths.LONG.originTF, '1m');
  assert.equal(u.opportunityPaths.LONG.ownerTF, '5m');
  assert.equal(u.policy.unifiedEngineDoesNotWaitFor15m, true);
  assert.equal(u.liquidationContext.available, true);
  assert.equal(u.liquiditySemantics.marketMakerIntent, 'NOT_INFERRED');
  assert.equal(u.dataQuality.microstructureQuality, 'STREAMING_PARTIAL_BOOK');
});

test('pipeline risk gate can qualify dry-run context but never authorizes live execution', () => {
  const { unified } = unifiedFixture();
  const plan = qualifiedPlan();
  const riskGate = preflightRiskGate({ plan, unified });
  const pipelineLikeOutput = { plan, riskGate, execution:'ADVISORY_ONLY', orderPlaced:false };
  assert.equal(pipelineLikeOutput.riskGate.ok, true);
  assert.equal(pipelineLikeOutput.riskGate.eligibleForDryRun, true);
  assert.equal(pipelineLikeOutput.riskGate.liveAllowed, false);
  assert.equal(pipelineLikeOutput.execution, 'ADVISORY_ONLY');
  assert.equal(pipelineLikeOutput.orderPlaced, false);
});

test('combined pipeline gate is fail-closed until account caps, structural stop, kill-switch and execution claim all pass', () => {
  const { unified } = unifiedFixture();
  const preflight = preflightRiskGate({ plan:qualifiedPlan(), unified });
  assert.equal(preflight.ok, true);

  const passingStop = structuralStopGate({
    side:'LONG',
    entryPrice:100.05,
    stopPrice:98.8,
    structuralInvalidationPrice:99,
    bufferQuote:0.1
  });
  assert.equal(passingStop.ok, true);

  const passingKillSwitch = killSwitchGate({
    control:{ available:true, tripped:false, dryRunEnabled:true }
  });
  assert.equal(passingKillSwitch.ok, true);

  const passingClaim = executionClaimGate({
    claim:{ claimed:true, lineageId:'lineage-regression-001' }
  });
  assert.equal(passingClaim.ok, true);

  const missingAccount = accountRiskCaps({});
  const accountBlocked = combineRiskGate(preflight, missingAccount, passingStop, passingKillSwitch, passingClaim);
  assert.equal(accountBlocked.ok, false);
  assert.equal(accountBlocked.eligibleForDryRun, false);
  assert.equal(accountBlocked.liveAllowed, false);
  assert.ok(accountBlocked.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'));
  assert.equal(accountBlocked.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'), false);
  assert.equal(accountBlocked.remainingMandatoryControls.includes('KILL_SWITCH'), false);
  assert.equal(accountBlocked.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'), false);

  const passingAccount = accountRiskCaps({
    account:{ available:true, equity:10000, dailyRealizedPnl:-50, openPositions:1 },
    intent:{ riskQuote:50, notionalQuote:1000, family:'ALT', familyExposureAfterQuote:1500 },
    limits:{
      maxRiskPctPerTrade:1,
      maxNotionalPctPerTrade:20,
      maxDailyLossPct:3,
      maxOpenPositions:3,
      maxFamilyExposurePct:25
    }
  });
  assert.equal(passingAccount.ok, true);

  const missingStop = structuralStopGate({ side:'LONG' });
  const stopBlocked = combineRiskGate(preflight, passingAccount, missingStop, passingKillSwitch, passingClaim);
  assert.equal(stopBlocked.ok, false);
  assert.equal(stopBlocked.eligibleForDryRun, false);
  assert.equal(stopBlocked.liveAllowed, false);
  assert.ok(stopBlocked.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'));
  assert.equal(stopBlocked.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'), false);
  assert.equal(stopBlocked.remainingMandatoryControls.includes('KILL_SWITCH'), false);
  assert.equal(stopBlocked.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'), false);

  const missingKillSwitch = killSwitchGate({});
  const killSwitchBlocked = combineRiskGate(preflight, passingAccount, passingStop, missingKillSwitch, passingClaim);
  assert.equal(killSwitchBlocked.ok, false);
  assert.equal(killSwitchBlocked.eligibleForDryRun, false);
  assert.equal(killSwitchBlocked.liveAllowed, false);
  assert.ok(killSwitchBlocked.remainingMandatoryControls.includes('KILL_SWITCH'));
  assert.equal(killSwitchBlocked.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'), false);
  assert.equal(killSwitchBlocked.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'), false);
  assert.equal(killSwitchBlocked.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'), false);

  const missingClaim = executionClaimGate({});
  const claimBlocked = combineRiskGate(preflight, passingAccount, passingStop, passingKillSwitch, missingClaim);
  assert.equal(claimBlocked.ok, false);
  assert.equal(claimBlocked.eligibleForDryRun, false);
  assert.equal(claimBlocked.liveAllowed, false);
  assert.ok(claimBlocked.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'));
  assert.equal(claimBlocked.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'), false);
  assert.equal(claimBlocked.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'), false);
  assert.equal(claimBlocked.remainingMandatoryControls.includes('KILL_SWITCH'), false);

  const allowed = combineRiskGate(preflight, passingAccount, passingStop, passingKillSwitch, passingClaim);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.eligibleForDryRun, true);
  assert.equal(allowed.liveAllowed, false);
  assert.equal(allowed.execution, 'ADVISORY_ONLY');
  assert.equal(allowed.remainingMandatoryControls.includes('ACCOUNT_RISK_CAPS'), false);
  assert.equal(allowed.remainingMandatoryControls.includes('STRUCTURAL_STOP_AND_NO_WIDEN'), false);
  assert.equal(allowed.remainingMandatoryControls.includes('KILL_SWITCH'), false);
  assert.equal(allowed.remainingMandatoryControls.includes('LEASE_AND_LINEAGE_CLAIM'), false);
});

test('claimed execution lineage must exactly match the execution intent lineage', () => {
  const { unified } = unifiedFixture();
  const preflight = preflightRiskGate({ plan:qualifiedPlan(), unified });
  const account = accountRiskCaps({
    account:{ available:true, equity:10000, dailyRealizedPnl:-50, openPositions:1 },
    intent:{ riskQuote:50, notionalQuote:1000, family:'ALT', familyExposureAfterQuote:1500 },
    limits:{ maxRiskPctPerTrade:1, maxNotionalPctPerTrade:20, maxDailyLossPct:3, maxOpenPositions:3, maxFamilyExposurePct:25 }
  });
  const stop = structuralStopGate({ side:'LONG', entryPrice:100.05, stopPrice:98.8, structuralInvalidationPrice:99, bufferQuote:0.1 });
  const killSwitch = killSwitchGate({ control:{ available:true, tripped:false, dryRunEnabled:true } });
  const claim = executionClaimGate({ claim:{ claimed:true, lineageId:'lineage-regression-001' } });
  const base = combineRiskGate(preflight, account, stop, killSwitch, claim);
  assert.equal(base.ok, true);

  const mismatch = enforceExecutionLineage(base, claim, { lineageId:'lineage-regression-002' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.eligibleForDryRun, false);
  assert.equal(mismatch.liveAllowed, false);
  assert.equal(mismatch.lineageAlignment.ok, false);
  assert.equal(mismatch.lineageAlignment.claimedLineageId, 'lineage-regression-001');
  assert.equal(mismatch.lineageAlignment.intentLineageId, 'lineage-regression-002');
  assert.ok(mismatch.reasons.includes('EXECUTION_LINEAGE_MISMATCH'));
  assert.ok(mismatch.remainingMandatoryControls.includes('EXECUTION_LINEAGE_ALIGNMENT'));

  const aligned = enforceExecutionLineage(base, claim, { lineageId:'lineage-regression-001' });
  assert.equal(aligned.ok, true);
  assert.equal(aligned.eligibleForDryRun, true);
  assert.equal(aligned.liveAllowed, false);
  assert.equal(aligned.lineageAlignment.ok, true);
  assert.equal(aligned.reasons.includes('EXECUTION_LINEAGE_MISMATCH'), false);
  assert.equal(aligned.remainingMandatoryControls.includes('EXECUTION_LINEAGE_ALIGNMENT'), false);
});

test('pipeline dry-run executor stays fail-closed without intent and never sends an exchange request', () => {
  const { unified } = unifiedFixture();
  const preflight = preflightRiskGate({ plan:qualifiedPlan(), unified });
  const account = accountRiskCaps({
    account:{ available:true, equity:10000, dailyRealizedPnl:-50, openPositions:1 },
    intent:{ riskQuote:50, notionalQuote:1000, family:'ALT', familyExposureAfterQuote:1500 },
    limits:{ maxRiskPctPerTrade:1, maxNotionalPctPerTrade:20, maxDailyLossPct:3, maxOpenPositions:3, maxFamilyExposurePct:25 }
  });
  const stop = structuralStopGate({ side:'LONG', entryPrice:100.05, stopPrice:98.8, structuralInvalidationPrice:99, bufferQuote:0.1 });
  const killSwitch = killSwitchGate({ control:{ available:true, tripped:false, dryRunEnabled:true } });
  const claim = executionClaimGate({ claim:{ claimed:true, lineageId:'lineage-regression-001' } });
  const riskGate = combineRiskGate(preflight, account, stop, killSwitch, claim);
  assert.equal(riskGate.ok, true);

  const missingIntentExecutor = buildDryRunOrder({
    intent:{ mode:'DRY_RUN', live:false, symbol:'BTCUSDT', side:'LONG' },
    riskGate
  });
  const blocked = combineExecutionReadiness(riskGate, missingIntentExecutor);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.eligibleForDryRun, false);
  assert.equal(blocked.liveAllowed, false);
  assert.ok(blocked.remainingMandatoryControls.includes('BINANCE_DRY_RUN_EXECUTOR'));

  const dryRunExecutor = buildDryRunOrder({
    intent:{
      mode:'DRY_RUN',
      live:false,
      action:'OPEN',
      symbol:'BTCUSDT',
      side:'LONG',
      orderType:'MARKET',
      quantity:0.01,
      entryPrice:100.05,
      stopPrice:98.8,
      clientOrderId:'dryrun-regression-001',
      lineageId:'lineage-regression-001'
    },
    riskGate
  });
  const ready = combineExecutionReadiness(riskGate, dryRunExecutor);
  assert.equal(ready.ok, true);
  assert.equal(ready.eligibleForDryRun, true);
  assert.equal(ready.liveAllowed, false);
  assert.equal(ready.execution, 'ADVISORY_ONLY');
  assert.equal(ready.remainingMandatoryControls.includes('BINANCE_DRY_RUN_EXECUTOR'), false);
  assert.equal(dryRunExecutor.simulated, true);
  assert.equal(dryRunExecutor.submitted, false);
  assert.equal(dryRunExecutor.transport.attempted, false);
  assert.equal(dryRunExecutor.transport.requestSent, false);
});

test('missing force-order prints never become a fabricated liquidation map', () => {
  const x = liquidationContext({ observedLiquidations:{ available:false, count:0 } });
  assert.equal(x.available, false);
  assert.equal(x.reason, 'NO_RECENT_OBSERVED_FORCE_ORDER_PRINTS');
  assert.match(x.note, /Do not fabricate/);
});