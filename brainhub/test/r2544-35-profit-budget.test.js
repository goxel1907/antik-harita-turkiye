'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {allocations,createProfitBudget}=require('../profit-budget');
function setup({cancelOk=true,partialFails=false,replaceFails=false}={}){
 const row={symbol:'TESTUSDT',side:'LONG',initialQty:3334,tpQty:[1667,833,834],tpPlaced:2,tpAlgoIds:[11,12],takeProfit1:0.077,takeProfit2:0.079,originalStopAlgoId:10};
 let qty=3334,serial=20;const calls=[],orders=new Map([[11,1667],[12,833]]);
 const transport={
  positionSnapshot:async()=>({ok:true,qty,stepSize:1,hedgeMode:false}),
  cancelAlgoOrder:async ref=>{calls.push(['cancel',ref]);if(!cancelOk)return {ok:false};orders.delete(ref.algoId);return {ok:true};},
  reducePositionMarket:async args=>{calls.push(['partial',args]);if(partialFails)return {ok:false,requestSent:false};const n=Math.floor(qty*args.fraction+1e-8);qty-=n;return {ok:true,orderPlaced:true,executedQty:n,remainingQty:qty};},
  placeTakeProfit:async args=>{calls.push(['tp',args]);if(replaceFails)return {ok:false,requestSent:false};const id=serial++;orders.set(id,args.quantity);return {ok:true,algoId:id};}
 };
 return {row,transport,calls,orders,qty:()=>qty,setQty:q=>{qty=q;},budget:createProfitBudget({transport})};
}
test('R35 guard one-third and subsequent TP fills share a budget and retain 834/3334 runner',async()=>{
 const s=setup(),r=await s.budget.reduce({row:s.row,fraction:1/3,reason:'GUARD_SCALE_OUT'});
 assert.equal(r.ok,true);assert.equal(r.profitBudget.ok,true);assert.equal(r.executedQty,1111);
 assert.equal(s.row.mgmtReducedQty,1111);assert.equal(s.qty(),2223);
 assert.deepEqual([...s.orders.values()],[556,833]);
 assert.equal(s.qty()-[...s.orders.values()].reduce((a,b)=>a+b,0),834);
 assert.equal(s.calls.some(x=>x[0]==='cancel'&&x[1].algoId===10),false,'protective stop remains installed');
 assert.deepEqual(s.calls.slice(0,3).map(x=>x[0]),['cancel','cancel','partial']);
});
test('R35 unconfirmed cancellation prevents a new market partial',async()=>{
 const s=setup({cancelOk:false}),r=await s.budget.reduce({row:s.row,fraction:1/3});
 assert.equal(r.ok,false);assert.equal(r.reason,'PROFIT_ORDER_CANCEL_UNCONFIRMED');
 assert.equal(s.calls.some(x=>x[0]==='partial'),false);assert.equal(s.row.profitCancelPending.length,2);
});
test('R35 rejected partial restores original profit reservations without counting a reduction',async()=>{
 const s=setup({partialFails:true}),r=await s.budget.reduce({row:s.row,fraction:1/3});
 assert.equal(r.ok,false);assert.equal(s.row.mgmtReducedQty,0);
 assert.deepEqual([...s.orders.values()],[1667,833]);assert.equal(s.row.profitBudgetPending,false);
});
test('R35 replacement failures are retained for repair and cannot leave oversized old TPs',async()=>{
 const s=setup({replaceFails:true}),r=await s.budget.reduce({row:s.row,fraction:1/3});
 assert.equal(r.ok,true);assert.equal(r.profitBudget.ok,false);assert.equal(s.orders.size,0);assert.equal(s.row.profitBudgetPending,true);
});
test('R35 post-TP1 partials respect the floor even when TP2 is still pending',()=>{
 const row={initialQty:3334,tpQty:[1667,833,834],tpPlaced:2,mgmtReducedQty:555};
 const p=allocations(row,{qty:1112,stepSize:1});assert.deepEqual(p.legs.map(x=>x.pending),[0,278]);
 assert.equal(p.maxPartialQty,278);assert.equal(p.runnerFloor,834);
});
test('R35 unknown market fill prevents another partial until its exchange order is terminal',async()=>{
 const s=setup();s.transport.reducePositionMarket=async()=>({ok:false,requestSent:true,clientOrderId:'unknown'});
 s.transport.reductionStatus=async()=>({ok:false});
 await s.budget.reduce({row:s.row,fraction:1/3});const r=await s.budget.reduce({row:s.row,fraction:1/3});
 assert.equal(r.reason,'PROFIT_BUDGET_REPAIR_PENDING');assert.ok(s.row.profitReductionUnknown);
});
test('R35 restart after an unknown confirmed fill repairs orders without another market reduction',async()=>{
 const s=setup();let sends=0;
 s.transport.reducePositionMarket=async()=>{sends++;s.setQty(2223);return {ok:false,requestSent:true};};
 await s.budget.reduce({row:s.row,fraction:1/3,reason:'GUARD_SCALE_OUT'});
 const saved=JSON.parse(JSON.stringify(s.row));assert.match(saved.profitReductionUnknown.clientOrderId,/^JX[a-f0-9]{30}$/);
 s.transport.reductionStatus=async()=>({ok:true,status:'FILLED',executedQty:1111});
 const restarted=createProfitBudget({transport:s.transport});
 const r=await restarted.reduce({row:saved,fraction:1/3,reason:'GUARD_SCALE_OUT'});
 assert.equal(r.ok,true);assert.equal(r.recovered,true);assert.equal(sends,1);
 assert.equal(saved.mgmtReducedQty,1111);assert.deepEqual([...s.orders.values()],[556,833]);
 assert.equal(saved.scaleOutDone,true,'recovered fill cannot repeat the one-time guard');
});
test('R35 concurrent guard and JEV partial requests cannot spend the same reservations',async()=>{
 const s=setup();let release;const gate=new Promise(r=>{release=r;});
 const original=s.transport.cancelAlgoOrder;s.transport.cancelAlgoOrder=async ref=>{await gate;return original(ref);};
 const first=s.budget.reduce({row:s.row,fraction:1/3,reason:'GUARD_SCALE_OUT'});
 const second=await s.budget.reduce({row:s.row,fraction:1/3,reason:'JEV_PARTIAL_TAKE_PROFIT'});
 assert.equal((await s.budget.close({row:s.row,reason:'JEV_EXIT_NOW'})).reason,'PROFIT_BUDGET_BUSY');
 assert.equal(second.reason,'PROFIT_BUDGET_BUSY');release();assert.equal((await first).ok,true);
 assert.equal(s.calls.filter(x=>x[0]==='partial').length,1);
});
test('R35 missing TP geometry or active fallback blocks a partial before cancelling protective reservations',async()=>{
 for(const field of ['takeProfit1','tp3FallbackPlaced']){
  const s=setup();if(field==='takeProfit1')delete s.row[field];else s.row[field]=true;
  const r=await s.budget.reduce({row:s.row,fraction:1/3});
  assert.equal(r.ok,false);assert.equal(s.calls.length,0);assert.equal(s.orders.size,2);
 }
});
test('R35 short partials preserve the same quantity budget, and a concurrent manual reduction is not attributed to our order',async()=>{
 const s=setup();s.row.side='SHORT';
 s.transport.reducePositionMarket=async()=>{s.setQty(2123);return {ok:true,executedQty:1111,orderPlaced:true};};
 const r=await s.budget.reduce({row:s.row,fraction:1/3});
 assert.equal(r.ok,true);assert.equal(s.row.mgmtReducedQty,1111);
 assert.ok([...s.orders.values()].reduce((a,b)=>a+b,0)<=2123-834);
});
test('R35 recovered JEV partial retains its exchange identity and counts once for the partial contract',async()=>{
 const s=setup();s.transport.reducePositionMarket=async()=>{s.setQty(2223);return {ok:false,requestSent:true};};
 await s.budget.reduce({row:s.row,fraction:1/3,reason:'JEV_PARTIAL_TAKE_PROFIT'});
 const cid=s.row.profitReductionUnknown.clientOrderId;
 s.transport.reductionStatus=async()=>({ok:true,status:'FILLED',executedQty:1111});
 await s.budget.restore(s.row,{});
 assert.equal(s.row.managementFills.length,1);assert.equal(s.row.managementFills[0].clientOrderId,cid);
 assert.equal(s.row.managementFills[0].action,'PARTIAL_TAKE_PROFIT');
 await s.budget.restore(s.row,{});assert.equal(s.row.managementFills.length,1);
});
