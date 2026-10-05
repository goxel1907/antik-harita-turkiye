'use strict';
const crypto=require('node:crypto');
const n=x=>x==null?null:Number.isFinite(Number(x))?Number(x):null;
// An exchange position cannot atomically isolate synthetic lots. Refuse shared
// positions; keep the protective stop while a standalone exit is unconfirmed.
// A pending market order must reach terminal exchange status before any retry.
function createBurstReduction({transport,persist=()=>{}}){
  async function reduce(active,reason,credentials){
    if(active.syntheticAddon)return {ok:false,reason:'BURST_SHARED_POSITION_NOT_ISOLATABLE'};
    active.initialQuantity=active.initialQuantity||active.quantity;
    if(active.exitPending){
      const order=await transport.reductionStatus({symbol:active.symbol,clientOrderId:active.exitPending.clientOrderId,credentials});
      if(!order?.ok||!['FILLED','CANCELED','EXPIRED','REJECTED'].includes(order.status))return {ok:false,reason:'BURST_EXIT_FILL_UNCONFIRMED'};
      const executed=n(order.executedQty)||0;
      active.quantity=Math.max(0,active.exitPending.quantityBefore-executed);
      if(executed>0){active.exitFilledQty=(n(active.exitFilledQty)||0)+executed;if(n(order.avgPrice)>0)active.exitQuote=(n(active.exitQuote)||0)+executed*n(order.avgPrice);else active.exitPriceUnmeasured=true;}
      active.exitPending=null;persist(active);
      if(active.quantity<=0)return {ok:true,avgPrice:!active.exitPriceUnmeasured&&active.exitFilledQty>0?active.exitQuote/active.exitFilledQty:null,executedQty:executed};
    }
    const snap=await transport.positionSnapshot({symbol:active.symbol,side:active.side,credentials});
    if(!snap?.ok)return {ok:false,reason:'BURST_EXIT_INVENTORY_UNAVAILABLE'};
    const floor=active.syntheticAddon?Math.max(0,n(active.coreQtyBefore)||0):0;
    const qty=Math.min(n(active.quantity)||0,Math.max(0,snap.qty-floor));
    if(!(qty>=snap.stepSize))return {ok:false,reason:'BURST_CORE_FLOOR_NO_CONFIRMED_EXCESS'};
    active.exitRequestedReason=reason;
    const clientOrderId='JX'+crypto.randomBytes(15).toString('hex');
    active.exitPending={clientOrderId,quantityBefore:active.quantity,reason};persist(active);
    const r=await transport.reducePositionMarket({symbol:active.symbol,side:active.side,fraction:1,maxQuantity:qty,minRemainingQty:floor,clientOrderId,credentials,reason});
    if(r?.ok&&r.status==='FILLED'&&n(r.executedQty)>0){
      const filled=n(r.executedQty);active.quantity=Math.max(0,active.quantity-filled);
      // R2544.47: Binance can ACK a filled MARKET order with avgPrice 0; one order query (weight 1) measures it,
      // so realizedR/learning are not lost (ORCA 05.10 21:18 closed with exitPrice null). Best effort only.
      let px=n(r.avgPrice);
      if(!(px>0)&&typeof transport.reductionStatus==='function'){try{const st=await transport.reductionStatus({symbol:active.symbol,clientOrderId,credentials});if(st?.ok&&n(st.avgPrice)>0)px=n(st.avgPrice);}catch{}}
      active.exitFilledQty=(n(active.exitFilledQty)||0)+filled;if(px>0)active.exitQuote=(n(active.exitQuote)||0)+filled*px;else active.exitPriceUnmeasured=true;
      active.exitPending=null;persist(active);
      return {...r,ok:active.quantity<=0,reason:active.quantity<=0?reason:'BURST_EXIT_PARTIAL_PENDING',avgPrice:!active.exitPriceUnmeasured&&active.exitFilledQty>0?active.exitQuote/active.exitFilledQty:null};
    }
    if(r?.requestSent===false||r?.orderPlaced===false&&r?.requestSent!==true){
      active.exitPending=null;persist(active);
      const refreshed=await transport.positionSnapshot({symbol:active.symbol,side:active.side,credentials});
      if(!active.stopAlgoId&&refreshed?.ok&&refreshed.qty>=floor+active.quantity){
        const stop=await transport.placeRunnerStop({symbol:active.symbol,side:active.side,hedgeMode:refreshed.hedgeMode,quantity:active.quantity,triggerPrice:active.stopPrice,clientAlgoId:'BS'+crypto.randomBytes(15).toString('hex'),credentials});
        if(stop?.ok){active.stopAlgoId=stop.algoId;persist(active);}
      }
    }
    return {...r,ok:false,reason:'BURST_EXIT_FILL_UNCONFIRMED'};
  }
  return {reduce};
}
module.exports={createBurstReduction};
