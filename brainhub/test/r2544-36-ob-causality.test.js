'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine');
function fixture(){
  const bars=Array.from({length:40},(_,i)=>({open:100,high:100.1,low:99.9,close:100,closeTime:i+1,quoteVolume:100}));
  bars.push({open:100,high:100.05,low:99.8,close:99.9,closeTime:41,quoteVolume:100});
  bars.push({open:99.9,high:101.05,low:99.9,close:101,closeTime:42,quoteVolume:400});
  return bars;
}
for(const side of ['bullish','bearish'])test('OB origin survives later volatility without a new break: '+side,()=>{
  const base=fixture(),later=base.concat(Array.from({length:8},(_,i)=>({open:101,close:101,high:115,low:100.2,closeTime:43+i,quoteVolume:100})));
  const flip=xs=>side==='bullish'?xs:xs.map(x=>({...x,open:200-x.open,high:200-x.low,low:200-x.high,close:200-x.close}));
  const before=flip(base),after=flip(later);
  const atrBefore=E.atrSeries(before).at(-1),atrAfter=E.atrSeries(after).at(-1);
  assert.ok(atrAfter>5*atrBefore);
  const initial=E.orderBlocks(before,atrBefore)[side].find(x=>x.at===41);
  const retained=E.orderBlocks(after,atrAfter)[side].find(x=>x.at===41);
  assert.ok(initial);assert.ok(retained);
  for(const k of ['low','high','at','displacementAt'])assert.equal(retained[k],initial[k]);
  assert.equal(retained.broken,false);
});
test('later quiet candles cannot retroactively qualify a weak historical displacement',()=>{
  const bars=Array.from({length:40},(_,i)=>({open:100,high:105,low:95,close:100,closeTime:i+1,quoteVolume:100}));
  bars.push({open:100,high:100.1,low:99.8,close:99.9,closeTime:41,quoteVolume:100});
  bars.push({open:99.9,high:106.1,low:99.9,close:106,closeTime:42,quoteVolume:400});
  bars.push(...Array.from({length:55},(_,i)=>({open:106,high:106.01,low:105.99,close:106,closeTime:43+i,quoteVolume:100})));
  assert.equal(E.orderBlocks(bars,E.atrSeries(bars).at(-1)).bullish.some(x=>x.at===41),false);
});
test('a genuine subsequent close through the block still marks it broken',()=>{
  const bars=fixture();bars.push({open:100,high:100,low:99,close:99.1,closeTime:43,quoteVolume:100});
  const ob=E.orderBlocks(bars,E.atrSeries(bars).at(-1)).bullish.find(x=>x.at===41);
  assert.ok(ob);assert.equal(ob.broken,true);assert.equal(ob.breaker,true);
});
