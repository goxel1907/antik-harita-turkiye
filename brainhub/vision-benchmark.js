'use strict';

const { structure } = require('./engine');

function candle(i,{open,high,low,close,volume=1000}){
  const openTime=i*900000;
  return {openTime,closeTime:openTime+899999,open,high,low,close,volume,quoteVolume:volume*close,takerBuyQuote:volume*close*0.5,forming:false};
}

function baseSeries(){
  const out=[];
  let p=100;
  for(let i=0;i<63;i++){
    const d=(i%6-2.5)*0.04;
    const o=p;
    const c=100+d;
    out.push(candle(i,{open:o,high:Math.max(o,c)+0.35,low:Math.min(o,c)-0.35,close:c,volume:1000+i*3}));
    p=c;
  }
  return out;
}

function syntheticVisionCases(){
  const breakout=baseSeries();
  breakout.push(candle(63,{open:100.1,high:104.4,low:99.9,close:104.0,volume:3000}));

  const sweep=baseSeries();
  // A clear long lower wick below the recent range that closes back inside.
  sweep.push(candle(63,{open:100.0,high:100.7,low:96.2,close:100.5,volume:2800}));

  const fvg=baseSeries().slice(0,61);
  fvg.push(candle(61,{open:99.8,high:100.0,low:99.4,close:99.9,volume:1100}));
  fvg.push(candle(62,{open:101.5,high:103.0,low:101.4,close:102.8,volume:3500}));
  fvg.push(candle(63,{open:103.0,high:103.8,low:102.2,close:103.5,volume:2200}));

  const mk=(id,label,candles)=>({
    id,label,
    chart:{ok:true,symbol:'SYNTHUSDT',frame:'15m',bars:candles.length,closedBars:candles.length,formingBars:0,generatedAt:new Date(0).toISOString(),candles,analysis:structure(candles,'15m')}
  });
  return [
    mk('BOS_UP','BOS_UP',breakout),
    mk('SWEEP_RECLAIM','SWEEP_RECLAIM',sweep),
    mk('BULL_FVG','BULL_FVG',fvg)
  ];
}

function parseBenchmarkLabel(text){
  const m=/^\s*PATTERN\s*:\s*(BOS_UP|SWEEP_RECLAIM|BULL_FVG)\s*$/im.exec(String(text||''));
  return m?m[1].toUpperCase():null;
}

module.exports={syntheticVisionCases,parseBenchmarkLabel};
