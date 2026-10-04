'use strict';
const crypto=require('node:crypto');
// All partial exits share the original TP budget. The protective stop remains
// installed while profit orders are cancelled/re-sized; uncertain cancellations
// prohibit an additional market partial. EXIT_NOW is handled separately.
const number=x=>x==null?null:Number.isFinite(Number(x))?Number(x):null;
const floor=(x,step)=>Math.floor((x+step*1e-8)/step)*step;
const ceil=(x,step)=>Math.ceil((x-step*1e-8)/step)*step;
function allocations(row,snap){
  const initial=number(row.initialQty),step=number(snap.stepSize),quantity=number(snap.qty);
  if(!(initial>0&&step>0&&quantity>0)||quantity>initial+step)return null;
  const original=row.originalTpQty||row.tpQty;
  if(!Array.isArray(original)||original.length<3||original.some(q=>!(number(q)>=0)))return null;
  const runnerFloor=Math.max(ceil(initial*0.25,step),number(original[2]));
  const managed=number(row.mgmtReducedQty)||0,spent=Math.max(0,initial-quantity);
  let paid=Math.max(0,spent-managed),budget=Math.max(0,floor(quantity-runnerFloor,step)),cumulative=0;
  const previous=row.tpQty||original;
  const legs=original.slice(0,Math.min(2,Number(row.tpPlaced)||2)).map((q,i)=>{
    cumulative+=q;
    const filled=Math.min(number(previous[i])||0,paid);paid=Math.max(0,paid-filled);
    const pending=Math.min(budget,Math.max(0,floor(cumulative-spent,step)));
    budget=Math.max(0,budget-pending);
    // Later cumulative targets include quantities already assigned to earlier TPs.
    cumulative-=pending;
    return {index:i,filled,pending,target:number(i===0?row.takeProfit1:row.takeProfit2)};
  });
  return {runnerFloor,legs,maxPartialQty:Math.max(0,floor(quantity-runnerFloor,step))};
}
function createProfitBudget({transport,clock=()=>Date.now(),emit=()=>{},persist=()=>{}}){
  const busy=new Set();
  async function exclusive(row,operation){
    const key=row.symbol+':'+row.side;
    if(busy.has(key))return {ok:false,orderPlaced:false,reason:'PROFIT_BUDGET_BUSY'};
    busy.add(key);try{return await operation();}finally{busy.delete(key);}
  }
  function confirmed(row,reason,quantity,clientOrderId){
    if(!(quantity>0))return;
    if(reason==='GUARD_SCALE_OUT'){row.scaleOutDone=true;row.scaleOutAt=clock();}
    if(reason==='JEV_PARTIAL_TAKE_PROFIT'){row.jevPartialBE=true;row.jevPartialBEAt=clock();}
    const at=clock();row.lastConfirmedPartial={reason,quantity,at,clientOrderId};
    const action=reason==='JEV_PARTIAL_TAKE_PROFIT'?'PARTIAL_TAKE_PROFIT':reason==='JEV_REDUCE_RISK'?'REDUCE_RISK':null;
    if(action&&clientOrderId&&!row.managementFills?.some(x=>x.clientOrderId===clientOrderId))
      row.managementFills=[...(row.managementFills||[]),{action,at,executedQty:quantity,clientOrderId}].slice(-8);
    persist();
  }
  function ready(row){
    if(row.tp3FallbackPlaced)return 'PROFIT_FALLBACK_ACTIVE';
    if(!(number(row.takeProfit1)>0)||Number(row.tpPlaced)>1&&!(number(row.takeProfit2)>0))return 'PROFIT_BUDGET_TARGET_UNAVAILABLE';
    return null;
  }
  async function cancel(row,credentials){
    const refs=[...(row.tpAlgoIds||[]).filter(x=>x!=null).map(algoId=>({algoId})),...(row.profitCancelPending||[])];
    row.tpAlgoIds=[];row.profitCancelPending=refs.slice();row.profitBudgetPending=true;persist();
    for(const ref of refs){
      let r;try{r=await transport.cancelAlgoOrder({...ref,credentials});}catch{r={ok:false};}
      const gone=r?.ok===true||[-2011,-2013].includes(Number(r?.exchangeError?.code));
      if(gone){row.profitCancelPending=row.profitCancelPending.filter(x=>x!==ref);persist();}
    }
    persist();return !row.profitCancelPending.length;
  }
  async function restore(row,credentials){
    const invalid=ready(row);if(invalid)return {ok:false,reason:invalid};
    let recoveredReduction=null;
    if(row.profitReductionUnknown){
      let order;try{order=await transport.reductionStatus({symbol:row.symbol,clientOrderId:row.profitReductionUnknown.clientOrderId,credentials});}catch{}
      if(!order?.ok||!['FILLED','CANCELED','EXPIRED','REJECTED'].includes(order.status))return {ok:false,reason:'PARTIAL_FILL_UNCONFIRMED'};
      row.mgmtReducedQty=row.profitReductionUnknown.managedBefore+(number(order.executedQty)||0);
      recoveredReduction={executedQty:number(order.executedQty)||0,reason:row.profitReductionUnknown.reason};
      confirmed(row,recoveredReduction.reason,recoveredReduction.executedQty,row.profitReductionUnknown.clientOrderId);
      row.profitReductionUnknown=null;persist();
    }
    if(!await cancel(row,credentials))return {ok:false,reason:'PROFIT_ORDER_CANCEL_UNCONFIRMED'};
    const snap=await transport.positionSnapshot({symbol:row.symbol,side:row.side,credentials});
    if(!snap?.ok)return {ok:false,reason:'PROFIT_BUDGET_SNAPSHOT_UNAVAILABLE'};
    if(!(snap.qty>0)){row.profitBudgetPending=false;persist();return {ok:true,closed:true};}
    const plan=allocations(row,snap);
    if(!plan)return {ok:false,reason:'PROFIT_BUDGET_GEOMETRY_UNAVAILABLE'};
    row.originalTpQty=row.originalTpQty||row.tpQty.slice();
    const next=row.tpQty.slice();
    for(const leg of plan.legs)next[leg.index]=leg.filled+leg.pending;
    next[2]=plan.runnerFloor;row.tpQty=next;row.profitBudgetVersion='R2544.35';persist();
    for(const leg of plan.legs){
      next[leg.index]=leg.filled+leg.pending;
      if(!(leg.pending>0))continue;
      if(!(leg.target>0))return {ok:false,reason:'PROFIT_BUDGET_TARGET_UNAVAILABLE'};
      const clientAlgoId='PB'+crypto.randomBytes(15).toString('hex');
      let r;try{r=await transport.placeTakeProfit({symbol:row.symbol,side:row.side,hedgeMode:snap.hedgeMode,quantity:leg.pending,triggerPrice:leg.target,clientAlgoId,credentials});}catch{r={ok:false,requestSent:true};}
      if(!r?.ok){
        if(r?.requestSent!==false)row.profitCancelPending.push({clientAlgoId});
        persist();return {ok:false,reason:'PROFIT_BUDGET_REPLACE_PENDING'};
      }
      row.tpAlgoIds[leg.index]=r.algoId;
      persist();
    }
    row.tpQty=next;row.profitBudgetPending=false;row.lastObservedQuantity=snap.qty;row.lastObservedQuantityAt=clock();
    emit(row,'PROFIT_BUDGET_REBALANCED',{remainingQty:snap.qty,runnerFloor:plan.runnerFloor,legs:plan.legs});persist();
    return {ok:true,plan,recoveredReduction};
  }
  async function reduce({row,fraction,credentials,reason}){
    const invalid=ready(row);if(invalid)return {ok:false,orderPlaced:false,reason:invalid};
    if(!(number(fraction)>0&&number(fraction)<1))return {ok:false,orderPlaced:false,reason:'PARTIAL_FRACTION_INVALID'};
    if(row.profitBudgetPending){
      const repaired=await restore(row,credentials);
      if(!repaired.ok)return {ok:false,orderPlaced:false,reason:'PROFIT_BUDGET_REPAIR_PENDING'};
      if(repaired.recoveredReduction?.executedQty>0)return {ok:true,orderPlaced:false,recovered:true,executedQty:repaired.recoveredReduction.executedQty,profitBudget:repaired};
    }
    // Cancel every pending profit reservation before making an additional partial.
    // A still-live/unknown TP could otherwise consume the retained runner.
    if(!await cancel(row,credentials))return {ok:false,orderPlaced:false,reason:'PROFIT_ORDER_CANCEL_UNCONFIRMED'};
    const snap=await transport.positionSnapshot({symbol:row.symbol,side:row.side,credentials});
    const plan=snap?.ok?allocations(row,snap):null;
    if(!plan){await restore(row,credentials);return {ok:false,orderPlaced:false,reason:'PROFIT_BUDGET_GEOMETRY_UNAVAILABLE'};}
    const qty=Math.min(plan.maxPartialQty,floor(snap.qty*fraction,snap.stepSize));
    if(!(qty>=snap.stepSize)){await restore(row,credentials);return {ok:false,orderPlaced:false,reason:'PARTIAL_RUNNER_FLOOR'};}
    const clientOrderId='JX'+crypto.randomBytes(15).toString('hex');
    // Persist the identity before transmission, so a restart cannot repeat an
    // uncertain reduction. Restoration must query this order before any retry.
    row.profitReductionUnknown={clientOrderId,managedBefore:number(row.mgmtReducedQty)||0,reason,at:clock()};persist();
    let result;
    try{result=await transport.reducePositionMarket({symbol:row.symbol,side:row.side,fraction:qty/snap.qty,maxQuantity:qty,minRemainingQty:plan.runnerFloor,clientOrderId,credentials,reason});}
    catch{result={ok:false,orderPlaced:false,requestSent:true,reason:'PARTIAL_REQUEST_UNCONFIRMED'};}
    if(!result?.ok&&result?.requestSent===true){
      persist();return {...result,profitBudget:{ok:false,reason:'PARTIAL_FILL_UNCONFIRMED'}};
    }
    // Only this order's confirmed execution is a management reduction. Inventory
    // loss may also include a user's manual close; it is not evidence of our fill.
    const after=await transport.positionSnapshot({symbol:row.symbol,side:row.side,credentials});
    if(result?.ok&&number(result.executedQty)>0){
      row.mgmtReducedQty=(number(row.mgmtReducedQty)||0)+number(result.executedQty);
      confirmed(row,reason,number(result.executedQty),clientOrderId);
    }else if(result?.requestSent===true){
      persist();return {...result,profitBudget:{ok:false,reason:'PARTIAL_FILL_UNCONFIRMED'}};
    }
    if(after?.ok&&after.qty>=0&&after.qty<=snap.qty){
      row.lastObservedQuantity=after.qty;row.lastObservedQuantityAt=clock();
    }
    row.mgmtReducedQty=number(row.mgmtReducedQty)||0;
    row.profitReductionUnknown=null;persist();
    const profitBudget=await restore(row,credentials);
    return {...result,profitBudget};
  }
  return {restore:(row,credentials)=>exclusive(row,()=>restore(row,credentials)),reduce:args=>exclusive(args.row,()=>reduce(args)),close:({row,credentials,reason})=>exclusive(row,async()=>{
    if(!await cancel(row,credentials))return {ok:false,orderPlaced:false,requestSent:false,reason:'PROFIT_ORDER_CANCEL_UNCONFIRMED'};
    return transport.reducePositionMarket({symbol:row.symbol,side:row.side,fraction:1,credentials,reason});
  })};
}
module.exports={allocations,createProfitBudget};
