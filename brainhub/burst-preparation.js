'use strict';
const finite=x=>x!==null&&x!==undefined&&!(typeof x==='string'&&!x.trim())&&Number.isFinite(Number(x));
// Bounded, persistent preparation. This grants no strategic or order authority.
class BurstPreparationQueue{
 constructor({now=()=>Date.now(),maxPending=2,ttlMs=120000,onExpire=()=>{}}={}){this.now=now;this.maxPending=maxPending;this.ttlMs=ttlMs;this.onExpire=onExpire;this.pending=new Map();this.cursor=0;}
 release(symbol){this.pending.delete(symbol);}
 pick(pool,{armed=[],blocked=[],slots=4}={}){
  const excluded=new Set([...armed,...blocked]);
  for(const [s,p] of this.pending){if(excluded.has(s)||this.now()-p.since>=this.ttlMs){const reason=excluded.has(s)?'EXCLUDED':'PREPARATION_TIMEOUT';this.pending.delete(s);excluded.add(s);this.onExpire(s,reason);}else{const current=pool.find(c=>c.symbol===s);if(current)p.candidate=current;}}
  const limit=Math.min(this.maxPending,slots),candidates=pool.filter(c=>!excluded.has(c.symbol)&&!this.pending.has(c.symbol));
  if(this.pending.size<limit&&candidates.length){const n=Math.min(limit-this.pending.size,candidates.length),start=this.cursor%candidates.length;for(const c of [...candidates.slice(start),...candidates.slice(0,start)].slice(0,n))this.pending.set(c.symbol,{since:this.now(),candidate:c});this.cursor+=n;}
  return [...this.pending.values()].slice(0,limit).map(p=>p.candidate);
 }
}
// R2544.46: readiness reads the trade clock (>=8 trades within 15 s) instead of a fixed 3 s window, which is
// empty on most altcoins. L1 OFI is optional evidence (neutral when missing), never a readiness veto.
function burstPreparationReadiness(stream){
 const reasons=[],l2=stream?.localL2||{},tc=stream?.orderFlow?.tradeClock,f=stream?.orderFlow?.windows?.['3s'];
 const o=stream?.level1Ofi?.eventClock?.fast||stream?.level1Ofi?.windows?.['3s'];
 if(stream?.available!==true||!finite(stream?.ageMs)||Number(stream.ageMs)<0||Number(stream.ageMs)>2500)reasons.push('BURST_STREAM_NOT_FRESH');
 if(l2.available!==true||l2.sequenceHealthy!==true||!finite(l2.confidence)||Number(l2.confidence)<0.55)reasons.push('BURST_L2_NOT_READY');
 if(tc&&typeof tc==='object'){
  const x=tc.fast||{};
  if(!finite(x.buyRatio)||!finite(x.sellRatio)||!finite(x.priceMoveBps)||!(Number(x.trades)>=8))reasons.push('BURST_TRADE_CLOCK_NOT_READY');
 }else if(!finite(f?.buyRatio)||!finite(f?.sellRatio)||!finite(f?.priceMoveBps)||(finite(f?.trades)&&Number(f.trades)<2))reasons.push('BURST_3S_TRADES_NOT_READY');
 return {ready:reasons.length===0,reasons,streamAvailable:stream?.available===true,streamAgeMs:stream?.ageMs??null,l2State:l2.state||null,l2Ready:l2.available===true,l2AgeMs:l2.ageMs??null,l2Confidence:l2.confidence??null,
  trades3s:f?.trades??null,tradeClockFastTrades:tc?.fast?.trades??null,tradeClockFastSpanMs:tc?.fast?.spanMs??null,
  ofiAvailable:finite(o?.normalizedOfi)&&o?.available!==false,ofiTransitions3s:o?.transitions??null};
}
module.exports={BurstPreparationQueue,burstPreparationReadiness};
