'use strict';
// CLAUDE_R2544_PREMOVE (Claude Work, 2026-09-28) — hareket BAŞLAMADAN yakalama.
// Kapalı mumlardan deterministik ön-hareket imzası: sıkışma (düşük gerçek aralık), hacim birikimi
// (fiyat oynamadan hacim artışı = emilim), taker delta baskısı (quote bazlı CVD eğimi), seviyeye yakınlık
// (prior20 high/low) ve kapanış konumu. Çıktı yön + tetik seviyeleri üretir; KARAR VERMEZ.
// Kullanım: (1) hızlı-hat JEV dikkat sırası (hareket başlamadan JEV'e gider), (2) JEV paketinde kanıt.
function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
const round=(n,p=6)=>n===null||!Number.isFinite(n)?null:Number(n.toFixed(p));
function atr(c,n=14){
  if(c.length<n+1)return null;
  let s=0;for(let i=c.length-n;i<c.length;i++){const k=c[i],p=c[i-1];s+=Math.max(k.high-k.low,Math.abs(k.high-p.close),Math.abs(k.low-p.close));}
  return s/n;
}
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}

function preMoveSignal(candles,{atr14=null,prior20High=null,prior20Low=null,frame=null}={}){
  const c=Array.isArray(candles)?candles.filter(k=>k&&[k.open,k.high,k.low,k.close].every(Number.isFinite)):[];
  if(c.length<34)return {available:false,frame,reason:'INSUFFICIENT_CLOSED_CANDLES'};
  const a=finite(atr14)??atr(c);
  const last=c.at(-1);
  if(!(a>0)||!(last.close>0))return {available:false,frame,reason:'ATR_INVALID'};
  const win=c.slice(-8), prev=c.slice(-28,-8);
  const trWin=mean(win.map((k,i)=>{const p=i?win[i-1]:c.at(-9);return Math.max(k.high-k.low,Math.abs(k.high-p.close),Math.abs(k.low-p.close));}));
  const compression=trWin/a;                                  // <0.75 sıkışma
  const hi8=Math.max(...win.map(k=>k.high)),lo8=Math.min(...win.map(k=>k.low));
  const rangeAtr=(hi8-lo8)/a;                                  // <2.5 dar kutu
  const qv=k=>finite(k.quoteVolume)??(finite(k.volume)??0)*k.close;
  const vol5=mean(c.slice(-5).map(qv)), volBase=mean(prev.map(qv));
  const volBuild=volBase>0?vol5/volBase:null;                  // >1.4 birikim
  const move5Atr=Math.abs(last.close-c.at(-6).close)/a;        // hacim varken fiyat az oynadıysa emilim
  const deltaOf=k=>{const q=qv(k),tb=finite(k.takerBuyQuote);return q>0&&tb!==null?(2*tb-q):null;};
  const d=win.map(deltaOf).filter(x=>x!==null), q8=win.map(qv).reduce((x,y)=>x+y,0);
  const deltaRatio=d.length>=6&&q8>0?d.reduce((x,y)=>x+y,0)/q8:null; // -1..1
  const closeLoc=mean(c.slice(-5).map(k=>k.high>k.low?(k.close-k.low)/(k.high-k.low):0.5));
  const ph=finite(prior20High)??hi8, pl=finite(prior20Low)??lo8;
  const distHighAtr=(ph-last.close)/a, distLowAtr=(last.close-pl)/a;
  // Ateşleme: son kapalı mum 8'li kutuyu gövdeyle ve hacimle kırdı → hareket BAŞLADI (geç kalma riski).
  const body=Math.abs(last.close-last.open)/a;
  const boxHi=Math.max(...c.slice(-9,-1).map(k=>k.high)),boxLo=Math.min(...c.slice(-9,-1).map(k=>k.low));
  const ignitionUp=body>=1.2&&last.close>boxHi&&(qv(last)/(volBase||Infinity))>=2;
  const ignitionDown=body>=1.2&&last.close<boxLo&&(qv(last)/(volBase||Infinity))>=2;

  let score=0;const reasons=[];
  if(compression<0.75){score+=Math.min(25,Math.round((0.75-compression)*60)+10);reasons.push('COMPRESSION');}
  if(rangeAtr<2.5){score+=10;reasons.push('TIGHT_BOX');}
  if(volBuild!==null&&volBuild>=1.4){score+=Math.min(25,Math.round((volBuild-1.4)*25)+10);reasons.push(move5Atr<1?'VOLUME_ABSORPTION':'VOLUME_BUILD');}
  let bias=0;
  if(deltaRatio!==null&&Math.abs(deltaRatio)>=0.08){bias+=Math.sign(deltaRatio)*(Math.abs(deltaRatio)>=0.18?2:1);reasons.push(deltaRatio>0?'TAKER_BUY_PRESSURE':'TAKER_SELL_PRESSURE');}
  if(closeLoc>=0.62){bias+=1;reasons.push('CLOSES_HIGH');}else if(closeLoc<=0.38){bias-=1;reasons.push('CLOSES_LOW');}
  if(distHighAtr>=0&&distHighAtr<=0.6){bias+=1;score+=10;reasons.push('PRESSING_HIGH');}
  if(distLowAtr>=0&&distLowAtr<=0.6){bias-=1;score+=10;reasons.push('PRESSING_LOW');}
  if(Math.abs(bias)>=2){score+=Math.min(20,Math.abs(bias)*6);}
  const direction=bias>=2?'LONG':bias<=-2?'SHORT':'BOTH';
  let state='NONE';
  if(ignitionUp||ignitionDown)state='IGNITION';
  else if(score>=55)state='PRE_MOVE';
  else if(score>=35)state='WATCH';
  const buf=0.1*a;
  return {
    available:true,frame,state,score:Math.min(100,score),
    direction:ignitionUp?'LONG':ignitionDown?'SHORT':direction,
    triggers:{long:round(Math.max(hi8,Math.min(ph,hi8+a))+buf),short:round(Math.min(lo8,Math.max(pl,lo8-a))-buf)},
    invalidation:{long:round(lo8-buf),short:round(hi8+buf)},
    metrics:{compression:round(compression,3),rangeAtr:round(rangeAtr,3),volBuild:round(volBuild,3),move5Atr:round(move5Atr,3),
      deltaRatio:round(deltaRatio,3),closeLocation:round(closeLoc,3),distHighAtr:round(distHighAtr,3),distLowAtr:round(distLowAtr,3),bodyAtr:round(body,3)},
    reasons,asOf:last.closeTime??null
  };
}

// 1m + 3m birleşik öncelik (hızlı hat sıralaması). IGNITION > PRE_MOVE > WATCH; aynı yön iki TF'de → bonus.
function combinePreMove(byTf={}){
  const rank={IGNITION:3,PRE_MOVE:2,WATCH:1,NONE:0};
  const xs=['1m','3m','5m'].map(tf=>byTf[tf]).filter(x=>x&&x.available);
  if(!xs.length)return {available:false,priority:0,state:'NONE',direction:'BOTH'};
  const best=xs.reduce((a,b)=>(rank[b.state]*100+b.score)>(rank[a.state]*100+a.score)?b:a);
  const dirs=xs.filter(x=>x.state!=='NONE'&&x.direction!=='BOTH').map(x=>x.direction);
  const agree=dirs.length>=2&&dirs.every(d=>d===dirs[0]);
  const priority=rank[best.state]*100+best.score+(agree?25:0);
  return {available:true,state:best.state,frame:best.frame,direction:agree?dirs[0]:best.direction,score:best.score,priority,tfAgreement:agree,
    triggers:best.triggers,invalidation:best.invalidation,reasons:best.reasons.slice(0,8)};
}

module.exports={preMoveSignal,combinePreMove};
