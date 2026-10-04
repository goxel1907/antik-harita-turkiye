'use strict';

// R37. Numerical evidence only. Adapted definitions: pyvsmc (MIT, pinned in
// third-party/price-action/SOURCES.json), stolgo close/level relations (MIT).
// Unlike retrospective pivot libraries, a pivot becomes usable only after its
// right-hand candles close. The input MUST be closed, chronological OHLC bars.
const VERSION='R2544.37_CAUSAL_PRICE_ACTION';
function valid(c){return Array.isArray(c)&&c.every((k,i)=>k&&['open','high','low','close'].every(x=>Number.isFinite(k[x]))&&k.low<=Math.min(k.open,k.close)&&k.high>=Math.max(k.open,k.close)&&Number.isFinite(k.closeTime)&&(i===0||k.closeTime>c[i-1].closeTime));}
function analyzePriceAction(c,{lookback=5,scopes=[['INTERNAL',2],['SWING',3]],useFvg=true,useBos=true}={}){
  if(!valid(c)||c.length<3)return {version:VERSION,available:false,reason:'INVALID_OR_INSUFFICIENT_CLOSED_OHLC',executionAuthority:false};
  const zones=new Map(),events=[],levels={},last=c.at(-1);
  // All anchors are revisited from left to right; never rewrite confirmation.
  const impulse=(i,side,kind,scope,level=null)=>{
    events.push({side,kind,scope,level,confirmedAt:c[i].closeTime});
    for(let j=i-1;j>=Math.max(0,i-lookback);j--){
      if(side==='BULL'?c[j].close>=c[j].open:c[j].close<=c[j].open)continue;
      const id=side+':'+c[j].closeTime;
      const volume=c.slice(Math.max(0,i-10),i).map(x=>x.volume).filter(Number.isFinite),mean=volume.length?volume.reduce((a,b)=>a+b,0)/volume.length:0;
      if(!zones.has(id))zones.set(id,{side,scope,impulse:kind,zoneMode:'FULL_RANGE',low:c[j].low,high:c[j].high,at:c[j].closeTime,confirmedAt:c[i].closeTime,displacementAt:c[i].closeTime,volRel:mean>0&&Number.isFinite(c[i].volume)?Number((c[i].volume/mean).toFixed(3)):null,mitigated:false,broken:false,breaker:false,state:'FRESH',touchAt:null,brokenAt:null,reclaimedAt:null});
      break;
    }
  };
  for(let i=0;i<c.length;i++){
    const k=c[i];
    // State changes only after confirmation; creation/impulse is not a retest.
    for(const z of zones.values()){
      if(k.closeTime<=z.confirmedAt)continue;
      if(!z.mitigated&&k.low<=z.high&&k.high>=z.low){z.mitigated=true;z.touchAt=k.closeTime;if(!z.broken)z.state='MITIGATED';}
      if(!z.broken&&(z.side==='BULL'?k.close<z.low:k.close>z.high)){z.broken=true;z.breaker=true;z.brokenAt=k.closeTime;z.state='BROKEN';}
      if(z.breaker&&(z.side==='BULL'?k.close>z.high:k.close<z.low)){z.breaker=false;z.reclaimedAt=k.closeTime;z.state='RECLAIMED';}
      else if(z.broken&&!z.breaker&&(z.side==='BULL'?k.close<z.low:k.close>z.high)){z.breaker=true;z.state='BROKEN';}
      // A reclaimed original block stays invalid; it is never silently fresh again.
    }
    if(useBos)for(const [scope,w] of scopes){
      const s=levels[scope]||(levels[scope]={high:null,low:null,direction:null});
      const p=i-w;
      if(p>=w){
        const window=c.slice(p-w,p+w+1),candidate=c[p];
        // Strict ties avoid arbitrarily choosing equal highs/lows as unique pivots.
        if(window.every((x,j)=>j===w||x.high<candidate.high))s.high={price:candidate.high,at:candidate.closeTime,confirmedAt:k.closeTime,used:false};
        if(window.every((x,j)=>j===w||x.low>candidate.low))s.low={price:candidate.low,at:candidate.closeTime,confirmedAt:k.closeTime,used:false};
      }
      for(const [edge,side,dir] of [['high','BULL','UP'],['low','BEAR','DOWN']]){
        const l=s[edge];
        if(!l||l.used||!(side==='BULL'?k.close>l.price:k.close<l.price))continue;
        // A close crossing a previously confirmed pivot is observable now.
        const kind=s.direction&&s.direction!==dir?'CHOCH':'BOS';
        l.used=true;s.direction=dir;impulse(i,side,kind,scope,l.price);
      }
    }
    if(useFvg&&i>=2){
      if(k.low>c[i-2].high)impulse(i,'BULL','FVG','INTERNAL',c[i-2].high);
      if(k.high<c[i-2].low)impulse(i,'BEAR','FVG','INTERNAL',c[i-2].low);
    }
  }
  const select=side=>[...zones.values()].filter(z=>z.side===side).map(z=>({...z,distancePct:Number(((last.close-(z.low+z.high)/2)/last.close*100).toFixed(3))})).sort((a,b)=>Number(a.broken)-Number(b.broken)||Math.abs(a.distancePct)-Math.abs(b.distancePct)||b.confirmedAt-a.confirmedAt).slice(0,4);
  // Prior levels are frozen before the current bar, not a rolling level including it.
  const prior=c.slice(Math.max(0,c.length-21),-1);
  const support=Math.min(...prior.map(x=>x.low)),resistance=Math.max(...prior.map(x=>x.high));
  const prev=c.at(-2),relation=(p,edge)=>({price:p,asOf:prev.closeTime,
    event:edge==='HIGH'?(last.close>p&&prev.close<=p?'CLOSE_CROSS_UP':last.high>p&&last.close<=p?'WICK_REJECTION':'NONE'):(last.close<p&&prev.close>=p?'CLOSE_CROSS_DOWN':last.low<p&&last.close>=p?'WICK_RECLAIM':'NONE')});
  return {version:VERSION,available:true,asOf:last.closeTime,executionAuthority:false,
    orderBlocks:{bullish:select('BULL'),bearish:select('BEAR')},events:events.slice(-4),
    prior20:{support:relation(support,'LOW'),resistance:relation(resistance,'HIGH')},
    coverage:{closedCandles:c.length,pivotRightBars:{INTERNAL:2,SWING:3},lookback,zoneMode:'FULL_RANGE'}};
}
function mergeOrderBlocks(legacy,pa,price){
  const pick=key=>{
    const old=(legacy?.[key]||[]).map(z=>({...z,scope:'PRIOR10_DISPLACEMENT',zoneMode:'LOW_OPEN_OR_OPEN_HIGH',confirmedAt:z.displacementAt,impulse:'ATR_PRIOR10_BREAK',state:z.broken?(z.breaker?'BROKEN':'RECLAIMED'):z.mitigated?'MITIGATED':'FRESH'}));
    const all=[...(pa?.orderBlocks?.[key]||[]),...old],seen=new Set();
    return all.filter(z=>{const id=z.at+':'+z.low+':'+z.high;if(seen.has(id))return false;seen.add(id);return true;}).sort((a,b)=>Number(a.broken)-Number(b.broken)||Math.abs((a.low+a.high)/2-price)-Math.abs((b.low+b.high)/2-price)||b.confirmedAt-a.confirmedAt).slice(0,2);
  };
  return {bullish:pick('bullish'),bearish:pick('bearish')};
}
function priceActionDigest(pa){if(!pa)return null;return {version:pa.version,available:pa.available,asOf:pa.asOf??null,events:pa.events??[],prior20:pa.prior20??null,coverage:pa.coverage??null,executionAuthority:false};}
module.exports={VERSION,analyzePriceAction,mergeOrderBlocks,priceActionDigest};
