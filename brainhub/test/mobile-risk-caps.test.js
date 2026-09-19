'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {requestedExecutionSettings,applyDynamicSizingGuards}=require('../live-controller');
const {accountRiskCaps}=require('../risk-gate');

const policy={expectedLeverage:5,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:10,maxDailyLossPct:2,maxOpenPositions:3,maxFamilyExposurePct:30}};
test('mobile leverage and position requests cannot exceed PC ceilings',()=>{
  const out=requestedExecutionSettings({requestedMarginQuote:20,requestedLeverage:10,requestedMaxOpenPositions:4},policy);
  assert.equal(out.ok,false);
  assert.ok(out.reasons.includes('REQUESTED_LEVERAGE_EXCEEDS_PC_CAP'));
  assert.ok(out.reasons.includes('REQUESTED_MAX_OPEN_POSITIONS_EXCEEDS_PC_CAP'));
});
test('explicit mobile sizing cannot rewrite notional or family exposure ceilings',()=>{
  const accountRisk={account:{available:true,equity:1000,availableBalance:1000,dailyRealizedPnl:0,openPositions:0},intent:{family:'ALT_LONG',riskQuote:1,notionalQuote:200,familyExposureAfterQuote:400},limits:policy.limits};
  const before=JSON.stringify(accountRisk);
  const result=applyDynamicSizingGuards(accountRisk,{dynamic:true,marginQuote:40,leverage:5,maxOpenPositions:2},policy);
  assert.equal(result.ok,true);
  assert.equal(result.accountRisk.limits.maxNotionalPctPerTrade,10);
  assert.equal(result.accountRisk.limits.maxFamilyExposurePct,30);
  assert.equal(result.accountRisk.limits.maxOpenPositions,2);
  assert.equal(accountRiskCaps(result.accountRisk).ok,false);
  assert.equal(JSON.stringify(accountRisk),before);
});
test('missing family exposure fails closed during mobile sizing',()=>{
  const out=applyDynamicSizingGuards({account:{equity:1000,availableBalance:1000},intent:{notionalQuote:100}}, {dynamic:true,marginQuote:20,leverage:5,maxOpenPositions:1},policy);
  assert.equal(out.ok,false);
  assert.ok(out.reasons.includes('FAMILY_EXPOSURE_INVALID'));
});
