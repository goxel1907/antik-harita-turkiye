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

// CLAUDE_V112_VISION_BENCHMARK_21: 7 sınıf × 3 varyant = 21 sentetik vaka (LONG/SHORT simetrik).
// Varyantlar v110 Vision profilindeki gerçek boyutlarda çizilir: 15m ana 896×504, scalp/bağlam 640×360.
// Amaç: 4B yerel modelin grafik okuma doğruluğunu sınıf ve boyut bazında ölçmek (işlem kararı değildir).
const V112_LABELS=['BOS_UP','BOS_DOWN','SWEEP_RECLAIM','SWEEP_REJECT','BULL_FVG','BEAR_FVG','RANGE'];
function seriesV112(seed,{base=100,amp=0.35,n=63}={}){
  const out=[];
  let p=base;
  for(let i=0;i<n;i++){
    const d=(((i*7+seed*3)%11)/11-0.5)*amp*0.5;
    const o=p, c=base+d;
    out.push(candle(i,{open:o,high:Math.max(o,c)+amp,low:Math.min(o,c)-amp,close:c,volume:1000+((i*13+seed)%40)*5}));
    p=c;
  }
  return out;
}
function mirror(candles,base){
  return candles.map(k=>({...k,open:2*base-k.open,close:2*base-k.close,high:2*base-k.low,low:2*base-k.high}));
}
function eventCandles(label,base,amp,start){
  const k=(i,o,h,l,c,v)=>candle(start+i,{open:base+o*amp,high:base+h*amp,low:base+l*amp,close:base+c*amp,volume:v});
  switch(label){
    case 'BOS_UP': return [k(0,0.2,12,-0.2,11,3200)];
    case 'SWEEP_RECLAIM': return [k(0,0.1,1.2,-6,1.0,2900)];
    case 'BULL_FVG': return [k(0,-0.2,0.3,-1.2,0.1,1100),k(1,4.5,8.5,4.2,8,3500),k(2,8.2,10.5,6.2,10,2200)];
    case 'RANGE': return [k(0,0.1,1.2,-1.1,-0.2,1150)];
    default: return null;
  }
}
function syntheticVisionCasesV112(){
  const variants=[
    {v:'A',size:{width:896,height:504},profile:'main15m',base:100,amp:0.35,seed:1},
    {v:'B',size:{width:640,height:360},profile:'scalp',base:100,amp:0.35,seed:4},
    {v:'C',size:{width:640,height:360},profile:'context',base:0.045,amp:0.00018,seed:7}
  ];
  const cases=[];
  for(const label of V112_LABELS){
    const bearish=['BOS_DOWN','SWEEP_REJECT','BEAR_FVG'].includes(label);
    const bullTwin={BOS_DOWN:'BOS_UP',SWEEP_REJECT:'SWEEP_RECLAIM',BEAR_FVG:'BULL_FVG'}[label]||label;
    for(const vr of variants){
      const series=seriesV112(vr.seed,{base:vr.base,amp:vr.amp,n:label.endsWith('FVG')?61:63});
      let candles=[...series,...eventCandles(bullTwin,vr.base,vr.amp,series.length)];
      if(bearish)candles=mirror(candles,vr.base);
      cases.push({
        id:label+'_'+vr.v,label,size:vr.size,profile:vr.profile,
        chart:{ok:true,symbol:'SYNTHUSDT',frame:vr.profile==='scalp'?'3m':'15m',bars:candles.length,closedBars:candles.length,formingBars:0,generatedAt:new Date(0).toISOString(),candles,analysis:structure(candles,'15m')}
      });
    }
  }
  return cases;
}

const BENCHMARK_LABEL_RE=/^\s*PATTERN\s*:\s*(BOS_UP|BOS_DOWN|SWEEP_RECLAIM|SWEEP_REJECT|BULL_FVG|BEAR_FVG|RANGE)\s*$/im;
function parseBenchmarkLabel(text){
  const m=BENCHMARK_LABEL_RE.exec(String(text||''));
  return m?m[1].toUpperCase():null;
}

function summarizeBenchmark(results){
  const by=(key)=>{
    const m=new Map();
    for(const r of results){const k=r[key];const x=m.get(k)||{total:0,matched:0};x.total++;if(r.match)x.matched++;m.set(k,x);}
    return Object.fromEntries([...m.entries()].map(([k,x])=>[k,{...x,accuracyPct:Number((100*x.matched/Math.max(1,x.total)).toFixed(1))}]));
  };
  const matched=results.filter(r=>r.match).length;
  return {cases:results.length,matched,accuracyPct:Number((100*matched/Math.max(1,results.length)).toFixed(1)),byLabel:by('expected'),byProfile:by('profile'),unparsed:results.filter(r=>r.actual===null).length};
}

module.exports={syntheticVisionCases,syntheticVisionCasesV112,parseBenchmarkLabel,summarizeBenchmark,V112_LABELS};
