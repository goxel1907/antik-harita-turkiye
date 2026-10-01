'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {marketPacket}=require('../jev-market-packet');
test('R2544.26 market packet keeps modeled liquidation shadow-only and compact',()=>{
 const u={symbol:'TESTUSDT',livePrice:100,frames:{'1m':{available:false},'3m':{available:false},'5m':{available:false},'15m':{available:false}},microstructure:{available:true,streaming:{available:true,ageMs:10}},derivatives:{available:true,modeledLiquidation:{available:true,authority:'SHADOW_EVIDENCE_ONLY',observed:false,estimated:true,events:4,baselineHours:60,density:{aboveNear:.2,aboveMid:.1,aboveFar:.1,belowNear:.3,belowMid:.2,belowFar:.1}}}};
 const p=marketPacket(u);assert.equal(p.derivatives.modeledLiquidation.authority,'SHADOW_EVIDENCE_ONLY');assert.equal(p.derivatives.modeledLiquidation.observed,false);assert.equal(p.derivatives.modeledLiquidation.canVeto,false);assert.ok(Buffer.byteLength(JSON.stringify(p.derivatives.modeledLiquidation))<500);
});
