'use strict';
function capacity({open=[],pending=[],max=2,symbol=null,now=Date.now()}={}){
 const key=x=>String(typeof x==='string'?x:x.symbol||'').toUpperCase();
 const active=new Set(open.map(key).filter(Boolean));
 const live=pending.filter(x=>!['CANCELED','REJECTED','EXPIRED','RELEASED'].includes(x.state)&&!(x.state==='RESERVED'&&Number(x.expiresAt)<=now));
 const queued=new Set(live.map(key).filter(x=>x&&!active.has(x)));
 const unavailable=live.some(x=>x.unavailable===true);
 const full=unavailable||active.size+queued.size>=max;
 const reason=unavailable?'PENDING_STATE_UNAVAILABLE':symbol&&active.has(key(symbol))?'SYMBOL_POSITION_ALREADY_OPEN':symbol&&queued.has(key(symbol))?'SYMBOL_ORDER_PENDING':full?'OPEN_POSITION_CAP_REACHED':null;
 return {open:active.size,pending:queued.size,max,used:active.size+queued.size,full,blocked:!!reason,reason,openSymbols:[...active],pendingSymbols:[...queued]};
}
module.exports={capacity};
