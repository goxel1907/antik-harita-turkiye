'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {requestedExecutionSettings,applyDynamicSizingGuards}=require('../live-controller');
const {accountRiskCaps}=require('../risk-gate');

const policy={expectedLeverage:5,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:10,maxDailyLossPct:2,maxOpenPositions:3,maxFamilyExposurePct:30}};
test('valid mobile over-cap requests are clamped downward without raising PC ceilings',()=>{
  const out=requestedExecutionSettings({requestedMarginQuote:20,requestedLeverage:10,requestedMaxOpenPositions:4},policy);
  assert.equal(out.ok,true);
  assert.equal(out.requestedLeverage,10);
  assert.equal(out.leverage,5);
  assert.equal(out.requestedMaxOpenPositions,4);
  assert.equal(out.maxOpenPositions,3);
  assert.deepEqual(out.adjustments.map(x=>x.code),['LEVERAGE_CLAMPED_TO_PC_CAP','MAX_OPEN_POSITIONS_CLAMPED_TO_PC_CAP']);
  assert.equal(out.reasons.length,0);
});
test('invalid mobile leverage still fails closed instead of being clamped',()=>{
  const out=requestedExecutionSettings({requestedMarginQuote:20,requestedLeverage:130,requestedMaxOpenPositions:2},policy);
  assert.equal(out.ok,false);
  assert.ok(out.reasons.includes('REQUESTED_LEVERAGE_INVALID'));
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
