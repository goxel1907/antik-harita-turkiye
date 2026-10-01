'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildPreEntryAdverseSelection}=require('../preentry-microstructure');
function w(){return {available:true,trades:30,coverageMs:30000,buyRatio:.55,sellRatio:.45,deltaQuote:100,buyQuote:550,sellQuote:450,priceMoveBps:1};}
function ofi(){return {available:true,transitions:60,coverageMs:30000,normalizedOfi:.2,priceMoveBps:1,queueImbalanceCurrent:.1,queueImbalanceDelta:.02,micropriceBps:.2};}
test('R2544.26 local L2 is compact evidence and cannot veto',()=>{
 const streaming={available:true,ageMs:50,spreadBps:2,asOf:1000,cvdAsOf:1000,depthAsOf:1000,cvdCoverageMs:120000,cvdTrades120s:100,orderFlow:{windows:{'5s':w(),'15s':w(),'30s':w(),'60s':w(),'120s':w()}},level1Ofi:{windows:{'5s':ofi(),'15s':ofi(),'30s':ofi(),'60s':ofi()}},depthDynamics:{available:true,samples:40},localL2:{available:true,state:'HEALTHY',sequenceHealthy:true,ageMs:40,resyncCount5m:0,confidence:.9,confidenceQuality:'FULL',multiLevelOfi:.35,depthImbalance:.2,wallPersistence:{side:'BID',share:.31,ageMs:12000},liquidityPull:{side:'NONE',bidQuote:0,askQuote:0},replenishment:{side:'BID',bidQuote:1000,askQuote:0},absorption:{side:'BID',confidence:.7}}};
 const x=buildPreEntryAdverseSelection({streaming,derivatives:{},microstructure:{}});
 assert.equal(x.version,'R2544.26');assert.equal(x.canVeto,false);assert.equal(x.localL2.canVeto,false);assert.equal(x.localL2.multiLevelOfi,.35);
 assert.ok(x.long.components.some(c=>c.id==='LOCAL_L2_MULTILEVEL_OFI'));
});
test('R2544.26 unavailable L2 does not block otherwise usable evidence',()=>{
 const streaming={available:true,ageMs:50,spreadBps:2,asOf:1000,cvdAsOf:1000,depthAsOf:1000,cvdCoverageMs:120000,cvdTrades120s:100,orderFlow:{windows:{'5s':w(),'15s':w(),'30s':w(),'60s':w(),'120s':w()}},level1Ofi:{windows:{'5s':ofi(),'15s':ofi(),'30s':ofi(),'60s':ofi()}},depthDynamics:{available:true,samples:40},localL2:{available:false,state:'RESYNCING',confidence:0}};
 const x=buildPreEntryAdverseSelection({streaming,derivatives:{},microstructure:{}});
 assert.equal(x.signalUsable,true);assert.equal(x.canVeto,false);
});
