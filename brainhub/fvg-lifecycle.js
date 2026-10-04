'use strict';

// Closed-bar observations only. No inference about intrabar ordering, hidden
// liquidity or future price. A contiguous visit is one test, not one per bar.
const VERSION='R2544.38_FVG_LIFECYCLE';
const pct=x=>Number(x.toFixed(3));
function lifecycle(c,origin,side,low,high){
  const width=high-low,mid=(low+high)/2,dir=side==='BULL'?1:-1,edge=side==='BULL'?high:low;
  let fill=0,tests=0,inside=false,start=-1,mfe=0,mae=0;
  const times={},life={version:VERSION,state:'UNTESTED',fillPct:0,testCount:0,ce50Touched:false};
  for(let i=origin+1;i<c.length;i++){
    const k=c[i],overlap=k.low<=high&&k.high>=low;
    if(overlap&&!inside){tests++;start=i;mfe=0;mae=0;times.firstTestAt??=k.closeTime;times.lastTestStartedAt=k.closeTime;}
    if(overlap){
      times.lastTouchAt=k.closeTime;
      fill=Math.max(fill,Math.min(1,Math.max(0,side==='BULL'?(high-Math.max(low,k.low))/width:(Math.min(high,k.high)-low)/width)));
      if(k.low<=mid&&k.high>=mid){life.ce50Touched=true;times.ce50At??=k.closeTime;}
    }
    if(start>=0){
      // The first-touch bar's extrema may precede contact: never call them a
      // post-touch excursion. Later completed bars have known temporal order.
      if(i>start){mfe=Math.max(mfe,dir*(side==='BULL'?k.high-edge:k.low-edge)/edge*100);mae=Math.max(mae,-dir*(side==='BULL'?k.low-edge:k.high-edge)/edge*100);}
      life.reaction={barsAfterTest:i-start,closePct:pct(dir*(k.close-edge)/edge*100),...(i>start?{mfePct:pct(mfe),maePct:pct(mae)}:{})};
    }
    const invalid=side==='BULL'?k.close<low:k.close>high;
    if(fill>=1)times.filledAt??=k.closeTime;
    if(invalid)times.invalidatedAt=k.closeTime;
    life.state=invalid?'INVALIDATED':fill>=1?'FILLED':life.ce50Touched?'CE50_TESTED':fill>0?'PARTIAL':tests?'TOUCHED':'UNTESTED';
    inside=overlap;
    // An exhausted gap stops accumulating tests/reactions. Archive the facts
    // observed at retirement; do not silently resurrect it as a fresh gap.
    if(invalid||fill>=1)break;
  }
  life.fillPct=pct(fill*100);life.testCount=tests;Object.assign(life,times);
  return life;
}
function fairValueGaps(c,{lookback=25}={}){
  if(!Array.isArray(c)||c.length<3||c.some((k,i)=>!k||!['open','high','low','close','closeTime'].every(x=>Number.isFinite(k[x]))||k.low>Math.min(k.open,k.close)||k.high<Math.max(k.open,k.close)||k.low<=0||(i>0&&k.closeTime<=c[i-1].closeTime)))return [];
  const out=[];
  for(let i=Math.max(2,c.length-lookback);i<c.length;i++){
    const a=c[i-2],k=c[i];let side,low,high;
    if(k.low>a.high){side='BULL';low=a.high;high=k.low;}
    else if(k.high<a.low){side='BEAR';low=k.high;high=a.low;}
    else continue;
    const life=lifecycle(c,i,side,low,high);
    out.push({side,low,high,ce50:(low+high)/2,at:k.closeTime,filled:['FILLED','INVALIDATED'].includes(life.state),touched:life.testCount>0,lifecycle:life});
  }
  return out;
}
module.exports={VERSION,fairValueGaps};
