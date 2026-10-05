'use strict';
// Reporting only. No POST/DELETE, strategy, PnL recomputation or manual inference.
const n=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const id=v=>v===null||v===undefined||v===''?null:String(v);
function matchFinalExit(row,trades,order,algos){
 const start=Date.parse(row.openedAt||''),end=Date.parse(row.closedAt||'');
 const closing=row.side==='LONG'?'SELL':row.side==='SHORT'?'BUY':null;
 const unknown=reason=>({version:'R2544.40',confirmed:false,exitType:'UNKNOWN_CLOSE',reason});
 if(!closing||!Number.isFinite(start)||!Number.isFinite(end)||!Array.isArray(trades)||trades.length>=1000)return unknown('TRADE_HISTORY_INCOMPLETE');
 const fills=trades.filter(t=>t.symbol===row.symbol&&t.side===closing&&['BOTH',row.side].includes(t.positionSide||'BOTH')&&n(t.qty)>0&&n(t.time)>=start&&n(t.time)<=end).sort((a,b)=>n(b.time)-n(a.time)||Number(b.id)-Number(a.id));
 const last=fills[0];if(!last||!id(last.orderId))return unknown('NO_CLOSING_FILL');
 const latest=fills.filter(t=>n(t.time)===n(last.time));
 if(new Set(latest.map(t=>id(t.orderId))).size!==1)return unknown('AMBIGUOUS_FINAL_FILL');
 if(!order||order.symbol!==row.symbol||id(order.orderId)!==id(last.orderId)||order.side!==closing||!['BOTH',row.side].includes(order.positionSide||'BOTH')||order.status!=='FILLED')return unknown('FINAL_ORDER_NOT_CONFIRMED');
 if(!Array.isArray(algos)||algos.length>=1000)return unknown('ALGO_HISTORY_INCOMPLETE');
 const matches=(Array.isArray(algos)?algos:[]).filter(a=>a.symbol===row.symbol&&a.side===closing&&['BOTH',row.side].includes(a.positionSide||'BOTH')&&id(a.actualOrderId)===id(last.orderId));
 if(matches.length>1)return unknown('AMBIGUOUS_ALGO_LINK');
 const algo=matches[0],type=String(algo?.orderType||order.origType||order.type||'').toUpperCase();
 let exitType=['STOP','STOP_MARKET'].includes(type)?'STOP_LOSS':type==='TRAILING_STOP_MARKET'?'TRAILING_STOP':['TAKE_PROFIT','TAKE_PROFIT_MARKET'].includes(type)?'TAKE_PROFIT':null;
 // A MARKET order alone cannot distinguish a user from another API client.
 if(!exitType)return {...unknown('NON_CONDITIONAL_FINAL_ORDER'),orderId:id(last.orderId),orderType:type,fillAt:n(last.time)};
 return {version:'R2544.40',confirmed:true,exitType,source:algo?'BINANCE_FILL_ALGO_ORDER_ID':'BINANCE_FILL_ORIGINAL_ORDER_TYPE',
  orderId:id(last.orderId),algoId:id(algo?.algoId),orderType:type,fillAt:n(last.time)};
}
async function readCloseExitEvidence(transport,row,credentials,canRead=()=>true){
 const start=Date.parse(row.openedAt||''),end=Date.parse(row.closedAt||'');
 if(!['LONG','SHORT'].includes(row.side)||!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>=7*86400000)return {version:'R2544.40',confirmed:false,exitType:'UNKNOWN_CLOSE',reason:'WINDOW_UNAVAILABLE'};
 const get=(route,params)=>{if(!canRead()){const e=new Error('REPORTING_YIELD');e.code='REPORTING_YIELD';throw e;}return transport._fetchJson('GET',route,{params,credentials,signed:true});};
 try{
  const trades=await get('/fapi/v1/userTrades',{symbol:row.symbol,startTime:start,endTime:end,limit:1000});
  const closing=row.side==='LONG'?'SELL':'BUY';
  const last=(Array.isArray(trades)?trades:[]).filter(t=>t.symbol===row.symbol&&t.side===closing&&['BOTH',row.side].includes(t.positionSide||'BOTH')&&n(t.qty)>0&&n(t.time)>=start&&n(t.time)<=end).sort((a,b)=>n(b.time)-n(a.time)||Number(b.id)-Number(a.id))[0];
  if(!last||!id(last.orderId)||trades.length>=1000)return matchFinalExit(row,trades,null,[]);
  const order=await get('/fapi/v1/order',{symbol:row.symbol,orderId:id(last.orderId)});
  // Algo history is queried even if generated execution order has type MARKET.
  const algos=await get('/fapi/v1/allAlgoOrders',{symbol:row.symbol,startTime:start,endTime:end,limit:1000});
  return matchFinalExit(row,trades,order,algos);
 }catch(e){return {version:'R2544.40',confirmed:false,exitType:'UNKNOWN_CLOSE',reason:e?.code==='REPORTING_YIELD'?'REPORTING_DEFERRED':'EXCHANGE_EVIDENCE_UNAVAILABLE',errorCode:String(e?.code||e?.status||'READ_FAILED').slice(0,80)};}
}
function exitCorrectionFor(row,records=[]){
 return records.filter(x=>x.kind==='CLOSE_EXIT_EVIDENCE'&&x.symbol===row.symbol&&
  (x.payload?.closedId===row.id|| (!!row.eventId&&x.payload?.eventId===row.eventId))&&
  x.payload?.openedAt===row.openedAt&&x.payload?.closedAt===row.closedAt)
  .sort((a,b)=>Number(b.ts)-Number(a.ts))[0]?.payload?.evidence||null;
}
module.exports={matchFinalExit,readCloseExitEvidence,exitCorrectionFor};
