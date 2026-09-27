'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {requestedExecutionSettings,applyDynamicSizingGuards}=require('../live-controller');
const {accountRiskCaps}=require('../risk-gate');

const policy={expectedLeverage:5,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:10,maxDailyLossPct:2,maxOpenPositions:1,maxFamilyExposurePct:80}};

test('panel leverage and max positions remain exact even above old PC defaults',()=>{
  const out=requestedExecutionSettings({requestedMarginQuote:20,requestedLeverage:10,requestedMaxOpenPositions:3},policy);
  assert.equal(out.ok,true);
  assert.equal(out.marginQuote,20);
  assert.equal(out.leverage,10);
  assert.equal(out.maxOpenPositions,3);
  assert.equal(out.sizingAuthority,'USER_PANEL_EXACT');
  assert.deepEqual(out.adjustments,[]);
});

test('invalid panel leverage still fails closed',()=>{
  const out=requestedExecutionSettings({requestedMarginQuote:20,requestedLeverage:130,requestedMaxOpenPositions:2},policy);
  assert.equal(out.ok,false);
  assert.ok(out.reasons.includes('REQUESTED_LEVERAGE_INVALID'));
});

// CLAUDE_R2543_RISK_CAP_BINDING: panel marj/kaldıraç/max pozisyon ve toplam aile zarfı için otorite olmayı
// sürdürür; ancak İŞLEM BAŞINA RİSK tavanı artık config'teki değerdir ve talebe göre büyütülmez.
test('exact panel sizing raises notional/family envelopes but never the configured per-trade risk cap',()=>{
  const accountRisk={
    account:{available:true,equity:1000,availableBalance:1000,dailyRealizedPnl:0,openPositions:0},
    intent:{family:'ALT_LONG',riskQuote:25,notionalQuote:200,familyExposureAfterQuote:200},
    limits:policy.limits
  };
  const result=applyDynamicSizingGuards(accountRisk,{dynamic:true,marginQuote:20,leverage:10,maxOpenPositions:3},policy);
  assert.equal(result.ok,true);
  assert.equal(result.sizing.appliedMarginQuote,20);
  assert.equal(result.sizing.appliedLeverage,10);
  assert.equal(result.sizing.appliedMaxOpenPositions,3);
  assert.equal(result.sizing.expectedNotionalQuote,200);
  assert.equal(result.accountRisk.limits.maxRiskPctPerTrade,policy.limits.maxRiskPctPerTrade);
  assert.equal(result.sizing.riskAuthority,'CONFIGURED_RISK_CAP_BINDING');
  assert.equal(result.sizing.configuredMaxRiskPctPerTrade,policy.limits.maxRiskPctPerTrade);
  assert.equal(result.sizing.riskCapQuote,10,'1000 USDT equity × %1 = 10 USDT işlem başına risk tavanı');
  assert.ok(result.accountRisk.limits.maxNotionalPctPerTrade>=20);
  assert.equal(result.accountRisk.limits.maxOpenPositions,3);
  assert.equal(result.accountRisk.limits.maxDailyLossPct,2);
  assert.ok(result.accountRisk.limits.maxFamilyExposurePct>=60);
  // 25 USDT risk (equity %2,5) tavanı aşar → hesap risk kapısı engeller (boyut ölçeklenmeden emir geçmez).
  assert.equal(accountRiskCaps(result.accountRisk).ok,false);
  const capped=applyDynamicSizingGuards({...accountRisk,intent:{...accountRisk.intent,riskQuote:9.5}},{dynamic:true,marginQuote:20,leverage:10,maxOpenPositions:3},policy);
  assert.equal(accountRiskCaps(capped.accountRisk).ok,true,'tavana uyan risk geçer');
});

test('panel sizing cannot silently create an order larger than margin times leverage',()=>{
  const accountRisk={
    account:{available:true,equity:1000,availableBalance:1000,dailyRealizedPnl:0,openPositions:0},
    intent:{family:'ALT_LONG',riskQuote:5,notionalQuote:250,familyExposureAfterQuote:250},
    limits:policy.limits
  };
  const result=applyDynamicSizingGuards(accountRisk,{dynamic:true,marginQuote:20,leverage:10,maxOpenPositions:3},policy);
  assert.equal(result.ok,false);
  assert.ok(result.reasons.includes('ORDER_NOTIONAL_EXCEEDS_REQUESTED_MARGIN_LEVERAGE'));
});

test('requested margin above available balance is blocked rather than silently reduced',()=>{
  const accountRisk={
    account:{available:true,equity:100,availableBalance:15,dailyRealizedPnl:0,openPositions:0},
    intent:{family:'ALT_LONG',riskQuote:1,notionalQuote:200,familyExposureAfterQuote:200},
    limits:policy.limits
  };
  const result=applyDynamicSizingGuards(accountRisk,{dynamic:true,marginQuote:20,leverage:10,maxOpenPositions:3},policy);
  assert.equal(result.ok,false);
  assert.ok(result.reasons.includes('REQUESTED_MARGIN_EXCEEDS_AVAILABLE_BALANCE'));
});

test('missing family exposure still fails closed',()=>{
  const out=applyDynamicSizingGuards({account:{equity:1000,availableBalance:1000},intent:{notionalQuote:100}}, {dynamic:true,marginQuote:20,leverage:5,maxOpenPositions:1},policy);
  assert.equal(out.ok,false);
  assert.ok(out.reasons.includes('FAMILY_EXPOSURE_INVALID'));
});


test('exact panel sizing with 25 USDT 10x max2 is not blocked by legacy 100 percent family cap',()=>{
  const tightPolicy={
    expectedLeverage:3,
    limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:25,maxDailyLossPct:5,maxOpenPositions:1,maxFamilyExposurePct:100}
  };
  const accountRisk={
    account:{available:true,equity:80.54,availableBalance:80.54,dailyRealizedPnl:0,openPositions:0},
    intent:{family:'ALL_USDT_PERP',riskQuote:4,notionalQuote:250,familyExposureAfterQuote:250},
    limits:tightPolicy.limits
  };
  const settings={dynamic:true,marginQuote:25,leverage:10,maxOpenPositions:2};
  // CLAUDE_R2543: aile zarfı panelden türetilir (eski davranış), fakat işlem riski tavana uymak zorundadır.
  const capRespectingRisk={...accountRisk,intent:{...accountRisk.intent,riskQuote:0.8}};
  const result=applyDynamicSizingGuards(capRespectingRisk,settings,tightPolicy);
  assert.equal(result.ok,true);
  assert.equal(result.sizing.expectedNotionalQuote,250);
  assert.equal(result.sizing.requestedFamilyExposureQuote,500);
  assert.ok(result.accountRisk.limits.maxFamilyExposurePct>620);
  const gate=accountRiskCaps(result.accountRisk);
  assert.equal(gate.ok,true,JSON.stringify(gate.reasons));
});

test('exact panel total family envelope still blocks exposure beyond margin x leverage x max positions',()=>{
  const tightPolicy={
    expectedLeverage:3,
    limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:25,maxDailyLossPct:5,maxOpenPositions:1,maxFamilyExposurePct:100}
  };
  const accountRisk={
    account:{available:true,equity:80.54,availableBalance:80.54,dailyRealizedPnl:0,openPositions:1},
    intent:{family:'ALL_USDT_PERP',riskQuote:4,notionalQuote:250,familyExposureAfterQuote:700},
    limits:tightPolicy.limits
  };
  const settings={dynamic:true,marginQuote:25,leverage:10,maxOpenPositions:2};
  const result=applyDynamicSizingGuards(accountRisk,settings,tightPolicy);
  assert.equal(result.ok,true);
  const gate=accountRiskCaps(result.accountRisk);
  assert.equal(gate.ok,false);
  assert.ok(gate.reasons.includes('FAMILY_EXPOSURE_CAP_EXCEEDED'));
});
