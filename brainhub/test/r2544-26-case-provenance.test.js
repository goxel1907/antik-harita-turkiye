'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cm=require('../case-memory');
test('R2544.26 immutable entry case carries audit-only hashes and gap count without execution authority',()=>{
 const unified={symbol:'TESTUSDT',livePrice:100,generatedAt:'2026-10-01T00:00:00Z',frames:{'5m':{available:true,fresh:true,asOf:'2026-10-01T00:00:00Z',close:100,klineGapCount:2},'15m':{available:true,fresh:true,asOf:'2026-10-01T00:00:00Z',close:100,klineGapCount:1}},microstructure:{available:true,streaming:{available:true,ageMs:10,localL2:{available:true,state:'HEALTHY',confidence:.9,multiLevelOfi:.2,depthImbalance:.1,resyncCount5m:0}}},derivatives:{available:true,modeledLiquidation:{available:true,authority:'SHADOW_EVIDENCE_ONLY',events:2,density:{aboveNear:.4,belowNear:.6}}},dataQuality:{advisoryUsable:true}};
 const x=cm.buildEntryCase({unified,candidate:{symbol:'TESTUSDT'},plan:{side:'LONG',setupFamily:'TREND_PULLBACK',entryTiming:'MARKET_NOW'},entryPrice:100,stopPrice:99,takeProfit1:102});
 assert.equal(x.auditProvenance.version,'R2544.26');assert.equal(x.auditProvenance.dataGapCount,3);assert.match(x.auditProvenance.marketSnapshotHash,/^[a-f0-9]{64}$/);assert.equal(x.executionAuthority,false);assert.equal(x.flow.orderFlow.localL2.canVeto,false);assert.equal(x.flow.derivatives.modeledLiquidation.observed,false);
 const compact=cm.compactEntryCase(x);assert.equal(compact.auditProvenance,undefined); // audit hashes stay out of decision prompt
});
