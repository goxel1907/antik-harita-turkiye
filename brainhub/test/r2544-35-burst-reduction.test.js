'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBurstReduction}=require('../burst-reduction');
function fixture(side='LONG'){
 const active={symbol:'ABCUSDT',side,quantity:20,syntheticAddon:false,coreQtyBefore:0,stopAlgoId:55,stopPrice:99};
 const calls=[];const transport={positionSnapshot:async()=>({ok:true,qty:20,stepSize:1}),cancelAlgoOrder:async x=>{calls.push(['cancel',x]);return {ok:true};},reducePositionMarket:async x=>{calls.push(['market',x]);return {ok:true,status:'FILLED',executedQty:20,avgPrice:101};}};
 return {active,calls,transport,reducer:createBurstReduction({transport})};
}
test('R35 independent burst exits both sides only with confirmed execution and preserves stop until confirmation',async()=>{
 for(const side of ['LONG','SHORT']){const s=fixture(side),r=await s.reducer.reduce(s.active,'JEV_BURST_EXIT',{});
 assert.equal(r.ok,true);assert.equal(s.active.quantity,0);assert.equal(s.active.initialQuantity,20);
 assert.equal(s.calls[0][1].maxQuantity,20);assert.equal(s.calls[0][1].minRemainingQty,0);assert.equal(s.calls[0][1].side,side);assert.equal(s.active.stopAlgoId,55);}
});
test('R35 uncertain burst fill is queried before retry and never treated as a close',async()=>{
 const s=fixture();s.transport.reducePositionMarket=async()=>{s.calls.push(['market']);return {ok:false,requestSent:true};};
 assert.equal((await s.reducer.reduce(s.active,'JEV_BURST_EXIT',{})).ok,false);
 assert.equal(s.active.stopAlgoId,55,'unknown market fill must retain exchange stop');
 s.transport.reductionStatus=async()=>({ok:false});
 assert.equal((await s.reducer.reduce(s.active,'JEV_BURST_EXIT',{})).reason,'BURST_EXIT_FILL_UNCONFIRMED');
 assert.equal(s.calls.filter(x=>x[0]==='market').length,1);
 s.transport.reductionStatus=async()=>({ok:true,status:'FILLED',executedQty:20,avgPrice:101});
 assert.equal((await s.reducer.reduce(s.active,'JEV_BURST_EXIT',{})).ok,true);
 assert.equal(s.calls.filter(x=>x[0]==='market').length,1);
});
test('R35 shared same-side lots cannot authorize an unisolatable exit',async()=>{
 const s=fixture();s.active.syntheticAddon=true;s.active.coreQtyBefore=100;
 assert.equal((await s.reducer.reduce(s.active,'JEV_BURST_EXIT',{})).reason,'BURST_SHARED_POSITION_NOT_ISOLATABLE');
 assert.equal(s.active.stopAlgoId,55);assert.equal(s.calls.length,0);
});
test('R35 a vanished addon cannot authorize a reduction of the retained core or cancel its burst protection blindly',async()=>{
 const s=fixture();s.transport.positionSnapshot=async()=>({ok:true,qty:0,stepSize:1});
 assert.equal((await s.reducer.reduce(s.active,'JEV_BURST_EXIT',{})).reason,'BURST_CORE_FLOOR_NO_CONFIRMED_EXCESS');
 assert.equal(s.calls.length,0);
});
test('R35 confirmed quantity without a measured price never fabricates a realized result',async()=>{
 const s=fixture();s.transport.reducePositionMarket=async()=>({ok:true,status:'FILLED',executedQty:20,avgPrice:0});
 const r=await s.reducer.reduce(s.active,'JEV_BURST_EXIT',{});assert.equal(r.ok,true);assert.equal(r.avgPrice,null);
});
