'use strict';
// CLAUDE_R2544_16_CHART_READOUT (Claude Work, 2026-09-29) — grafik okuma katmanı. Kapalı mumdan deterministik.
// Fikirler açık kaynak incelemesinden (kod kopyası YOK, kendi uygulamamız):
//  - stretch: çapalı VWAP (pencerenin dibinden/tepesinden) ± σ bantları, EMA20'ye ATR uzaklığı, premium/discount konumu
//    (kovalama/aşırı uzama ölçüsü; 29.09 analizi: ilk 3 yükselende LONG kaybı kazancın 2 katı)
//  - squeeze: Bollinger(20,2) Keltner(20; 1.0/1.5/2.0×ATR) içinde mi, kaç mumdur, salındı mı, momentum yönü
//  - displacement: gövde ≥1,5 ATR, gövde/aralık ≥0,6 ve ≥0,25 ATR FVG bırakan son yer değiştirme; bacağın neresindeyiz (OTE 62–79)
//  - pools: ≥2 swing'in kümelendiği likidite havuzları; süpürüldü+geri alındı / kırılıp kabul edildi / dokunulmadı
//  - effort: dalga (zigzag 1×ATR) hacmi ve taker delta — yeni uç daha az çabayla → tükenme; RSI uyumsuzluğu
// Hepsi YUMUŞAK BAĞLAM: kapı, eşik, veto değildir; JEV'in okumasını keskinleştirir.
function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function round(n,p=6){return n===null||!Number.isFinite(n)?null:Number(n.toFixed(p));}
function sma(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}
function qv(k){return finite(k.quoteVolume)??((finite(k.volume)??0)*k.close);}
function trOf(c,i){const k=c[i],p=c[i-1]||k;return Math.max(k.high-k.low,Math.abs(k.high-p.close),Math.abs(k.low-p.close));}
function ema(values,period){if(values.length<period)return null;const a=2/(period+1);let v=values[0];for(let i=1;i<values.length;i++)v=a*values[i]+(1-a)*v;return v;}
function rsiSeries(close,period=14){
  const out=new Array(close.length).fill(null);
  if(close.length<period+1)return out;
  let g=0,l=0;
  for(let i=1;i<=period;i++){const d=close[i]-close[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}
  g/=period;l/=period;out[period]=l===0?(g===0?50:100):100-100/(1+g/l);
  for(let i=period+1;i<close.length;i++){const d=close[i]-close[i-1];g=(g*(period-1)+Math.max(0,d))/period;l=(l*(period-1)+Math.max(0,-d))/period;out[i]=l===0?(g===0?50:100):100-100/(1+g/l);}
  return out;
}
// Çapalı VWAP: çapadan itibaren tipik fiyat × hacim. σ, hacim ağırlıklı sapma (sayısal kararlılık için çapa fiyatına göre).
function anchoredVwap(c,from){
  if(from<0||from>=c.length)return null;
  const p0=(c[from].high+c[from].low+c[from].close)/3;
  let sv=0,spv=0,sp2v=0;
  for(let i=from;i<c.length;i++){const k=c[i],v=Math.max(0,qv(k)/Math.max(k.close,1e-12)),tp=(k.high+k.low+k.close)/3-p0;sv+=v;spv+=tp*v;sp2v+=tp*tp*v;}
  if(!(sv>0))return null;
  const m=spv/sv,sd=Math.sqrt(Math.max(0,sp2v/sv-m*m));
  return {vwap:m+p0,sd,bars:c.length-from};
}
function stretch(c,a14,{window=96}={}){
  if(!Array.isArray(c)||c.length<30||!(a14>0))return null;
  const w=c.slice(-Math.min(window,c.length)),off=c.length-w.length,last=c.at(-1);
  let lo=0,hi=0;w.forEach((k,i)=>{if(k.low<w[lo].low)lo=i;if(k.high>w[hi].high)hi=i;});
  const fromLow=anchoredVwap(c,off+lo),fromHigh=anchoredVwap(c,off+hi);
  const e20=ema(c.map(k=>k.close),20);
  const rangeHi=w[hi].high,rangeLo=w[lo].low,pos=rangeHi>rangeLo?(last.close-rangeLo)/(rangeHi-rangeLo):null;
  const z=v=>v&&v.sd>0?round((last.close-v.vwap)/v.sd,2):null;
  const ext=v=>v?round((last.close-v.vwap)/a14,2):null;
  const upExt=ext(fromLow),dnExt=ext(fromHigh),upZ=z(fromLow),dnZ=z(fromHigh),emaAtr=e20?round((last.close-e20)/a14,2):null;
  // Uzama etiketi: hareket yönündeki çapadan ölçülür (yükselişte dipten, düşüşte tepeden).
  const upLeg=hi>=lo;
  const legExt=upLeg?upExt:dnExt,legZ=upLeg?upZ:dnZ;
  const mag=Math.max(Math.abs(legExt??0),Math.abs((legZ??0))*1.2,Math.abs(emaAtr??0));
  const state=mag>=4?'EXTREME':mag>=2.5?'EXTENDED':mag>=1.5?'STRETCHED':'NORMAL';
  return {
    leg:upLeg?'UP':'DOWN',state,
    avwapLow:fromLow?{price:round(fromLow.vwap),upper2:round(fromLow.vwap+2*fromLow.sd),lower2:round(fromLow.vwap-2*fromLow.sd),extAtr:upExt,z:upZ,barsAgo:w.length-1-lo}:null,
    avwapHigh:fromHigh?{price:round(fromHigh.vwap),upper2:round(fromHigh.vwap+2*fromHigh.sd),lower2:round(fromHigh.vwap-2*fromHigh.sd),extAtr:dnExt,z:dnZ,barsAgo:w.length-1-hi}:null,
    ema20Atr:emaAtr,
    rangePosPct:pos===null?null:round(pos*100,1),
    zone:pos===null?null:pos>0.55?'PREMIUM':pos<0.45?'DISCOUNT':'EQUILIBRIUM',
    // Kovalama riski: fiyatın gideceği yönde zaten ne kadar yol alındığı. LONG için yükselişte uzama + premium; SHORT tersi.
    chaseRisk:{
      LONG:upLeg&&(state==='EXTREME'||state==='EXTENDED')&&pos!==null&&pos>0.8?'HIGH':upLeg&&state!=='NORMAL'&&pos!==null&&pos>0.65?'MEDIUM':'LOW',
      SHORT:!upLeg&&(state==='EXTREME'||state==='EXTENDED')&&pos!==null&&pos<0.2?'HIGH':!upLeg&&state!=='NORMAL'&&pos!==null&&pos<0.35?'MEDIUM':'LOW'
    }
  };
}
function squeeze(c,{n=20}={}){
  if(!Array.isArray(c)||c.length<n+15)return null;
  const state=i=>{
    const s=c.slice(i-n+1,i+1),m=sma(s.map(k=>k.close));
    const sd=Math.sqrt(sma(s.map(k=>(k.close-m)**2)));
    const atrN=sma(s.map((_,j)=>trOf(c,i-n+1+j)));
    const bbw=2*sd;
    if(bbw<1.0*atrN)return 3; if(bbw<1.5*atrN)return 2; if(bbw<2.0*atrN)return 1; return 0;
  };
  const names=['OFF','ON_WIDE','ON','ON_NARROW'];
  const last=c.length-1,cur=state(last);
  let bars=0;for(let i=last;i>=n&&state(i)>0&&bars<60;i--)bars++;
  let released=null;
  if(cur===0){for(let i=last-1,b=1;i>=Math.max(n,last-6);i--,b++){if(state(i)>0){released={barsAgo:b,from:names[state(i)]};break;}}}
  const mom=[];for(let i=last-5;i<=last;i++)mom.push(i-12>=0?c[i].close-c[i-12].close:0);
  const m=sma(mom);
  return {state:names[cur],bars,released,momentum:m>0?'UP':m<0?'DOWN':'FLAT'};
}
function displacement(c,a14,{lookback=30}={}){
  if(!Array.isArray(c)||c.length<lookback+5||!(a14>0))return null;
  const last=c.at(-1);
  for(let i=c.length-2;i>=c.length-lookback&&i>=2;i--){
    const k=c[i],body=Math.abs(k.close-k.open),rng=k.high-k.low;
    if(!(body>=1.5*a14&&rng>0&&body/rng>=0.6))continue;
    const up=k.close>k.open,a=c[i-1],b=c[i+1];
    const gap=up?b.low-a.high:a.low-b.high;
    if(!(gap>=0.25*a14))continue;
    // Bacak: yer değiştirmeden önceki 10 mumun ucu → sonraki en uç nokta.
    const pre=c.slice(Math.max(0,i-10),i),post=c.slice(i);
    const start=up?Math.min(...pre.map(x=>x.low),k.low):Math.max(...pre.map(x=>x.high),k.high);
    const end=up?Math.max(...post.map(x=>x.high)):Math.min(...post.map(x=>x.low));
    const leg=Math.abs(end-start);
    const retr=leg>0?(up?(end-last.close):(last.close-end))/leg:null;
    return {dir:up?'UP':'DOWN',barsAgo:c.length-1-i,bodyAtr:round(body/a14,2),fvgAtr:round(gap/a14,2),
      legStart:round(start),legEnd:round(end),retracePct:retr===null?null:round(retr*100,1),
      inOte:retr!==null&&retr>=0.62&&retr<=0.79,beyondLegStart:retr!==null&&retr>1};
  }
  return null;
}
function liquidityPools(c,a14,pv){
  if(!Array.isArray(c)||c.length<30||!(a14>0)||!pv)return null;
  const last=c.at(-1),w=c.slice(-60);
  const tol=Math.max((Math.max(...w.map(k=>k.high))-Math.min(...w.map(k=>k.low)))*0.01,a14*0.1);
  const cluster=(pts,isHigh)=>{
    const s=[...pts].sort((a,b)=>a.price-b.price),out=[];
    for(const p of s){const g=out.at(-1);if(g&&p.price-g.max<=tol){g.members.push(p);g.max=p.price;}else out.push({members:[p],min:p.price,max:p.price});}
    return out.filter(g=>g.members.length>=2).map(g=>{
      const level=isHigh?g.max:g.min,lastIdx=Math.max(...g.members.map(m=>m.index));
      const after=c.slice(lastIdx+1);
      let status='UNSWEPT',barsAgo=null;
      const j=after.findIndex(k=>isHigh?k.high>level+0.1*a14:k.low<level-0.1*a14);
      if(j>=0){
        const back=after.slice(j,j+4).findIndex(k=>isHigh?k.close<level:k.close>level);
        const held=after.slice(j).every(k=>isHigh?k.close<=level+0.05*a14:k.close>=level-0.05*a14);
        status=back>=0&&held?'SWEPT_RECLAIMED':back>=0?'SWEPT_THEN_BROKEN':'BROKEN_ACCEPTED';
        barsAgo=after.length-1-j;
      }
      return {side:isHigh?'BUY_SIDE':'SELL_SIDE',price:round(level),touches:g.members.length,status,barsAgo,distAtr:round((level-last.close)/a14,2)};
    });
  };
  const hi=cluster(pv.highs||[],true),lo=cluster(pv.lows||[],false);
  const near=l=>l.sort((a,b)=>Math.abs(a.distAtr)-Math.abs(b.distAtr)).slice(0,2);
  return {buySide:near(hi),sellSide:near(lo)};
}
function effort(c,a14){
  if(!Array.isArray(c)||c.length<40||!(a14>0))return null;
  // Zigzag dalgaları (1×ATR dönüş). Her dalganın hacmi ve taker deltası.
  const waves=[];let dir=0,ext=c[0].close,extI=0,start=0;
  for(let i=1;i<c.length;i++){
    const k=c[i];
    if(dir>=0&&k.high>ext){ext=k.high;extI=i;if(dir===0)dir=1;}
    else if(dir<=0&&k.low<ext){ext=k.low;extI=i;if(dir===0)dir=-1;}
    if(dir===1&&ext-k.low>=a14){waves.push({dir:1,from:start,to:extI,price:ext});dir=-1;start=extI;ext=k.low;extI=i;}
    else if(dir===-1&&k.high-ext>=a14){waves.push({dir:-1,from:start,to:extI,price:ext});dir=1;start=extI;ext=k.high;extI=i;}
  }
  waves.push({dir,from:start,to:c.length-1,price:dir===1?Math.max(...c.slice(start).map(k=>k.high)):Math.min(...c.slice(start).map(k=>k.low)),open:true});
  for(const w of waves){const s=c.slice(w.from+1,w.to+1);w.vol=s.reduce((a,k)=>a+qv(k),0);const tb=s.map(k=>finite(k.takerBuyQuote)).filter(x=>x!==null);w.delta=tb.length===s.length&&s.length?s.reduce((a,k)=>a+2*finite(k.takerBuyQuote)-qv(k),0):null;w.bars=s.length||1;}
  const cur=waves.at(-1),prevSame=[...waves].slice(0,-1).reverse().find(w=>w.dir===cur.dir);
  let state='NONE';
  if(prevSame&&cur.dir!==0){
    const newExt=cur.dir===1?cur.price>prevSame.price:cur.price<prevSame.price;
    const lessEffort=cur.vol/cur.bars<prevSame.vol/prevSame.bars*0.8;
    const deltaFade=cur.delta!==null&&prevSame.delta!==null&&(cur.dir===1?cur.delta<prevSame.delta*0.6:cur.delta>prevSame.delta*0.6);
    if(newExt&&(lessEffort||deltaFade))state=cur.dir===1?'UP_EXHAUSTION':'DOWN_EXHAUSTION';
    else if(newExt)state=cur.dir===1?'UP_WITH_EFFORT':'DOWN_WITH_EFFORT';
  }
  // RSI uyumsuzluğu: son iki swing tepe/dip (dalga uçları) arasında fiyat vs RSI.
  const rs=rsiSeries(c.map(k=>k.close));
  const ends=waves.filter(w=>!w.open);
  const highs=ends.filter(w=>w.dir===1).slice(-2),lows=ends.filter(w=>w.dir===-1).slice(-2);
  let divergence=null;
  const lastIdx=c.length-1;
  if(cur.dir===1&&highs.length>=1){const p=highs.at(-1);if(cur.price>p.price&&rs[lastIdx]!==null&&rs[p.to]!==null&&rs[lastIdx]<rs[p.to]-2&&rs[p.to]>=55)divergence='BEARISH_RSI';}
  if(cur.dir===-1&&lows.length>=1){const p=lows.at(-1);if(cur.price<p.price&&rs[lastIdx]!==null&&rs[p.to]!==null&&rs[lastIdx]>rs[p.to]+2&&rs[p.to]<=45)divergence='BULLISH_RSI';}
  return {wave:cur.dir===1?'UP':cur.dir===-1?'DOWN':'FLAT',waveBars:cur.bars,state,divergence,
    volVsPrev:prevSame?round((cur.vol/cur.bars)/Math.max(prevSame.vol/prevSame.bars,1e-9),2):null};
}
function chartReadout(c,a14,pv,frame=null){
  if(!Array.isArray(c)||c.length<40||!(a14>0))return null;
  const out={frame};
  try{out.stretch=stretch(c,a14);}catch{out.stretch=null;}
  try{out.squeeze=squeeze(c);}catch{out.squeeze=null;}
  try{out.displacement=displacement(c,a14);}catch{out.displacement=null;}
  try{out.pools=liquidityPools(c,a14,pv);}catch{out.pools=null;}
  try{out.effort=effort(c,a14);}catch{out.effort=null;}
  return out;
}
// JEV paketi için ≈120–180 bayt özet (kısa anahtar + dizi). Açıklama PASS metinlerinde:
// st=[bacak,durum,bölge,konum%,ema20ATR,avwap,extATR,z]  ch=kovalama riski (yalnız LOW değilse)
// sq=[sıkışma,mum,salınalı(mum),momentum] (yalnız ON/ON_NARROW veya yeni salınım)  dp=[yön,mumÖnce,gövdeATR,geriÇekilme%,OTE]
// pl={b:[[fiyat,dokunuş,durum,uzaklıkATR]],s:[...]} (süpürülmüş/kırılmış ya da 2 ATR içindeki havuz)  ef=[durum,uyumsuzluk,hacimOranı] (yalnız tükenme/uyumsuzluk)
function sig(n){n=finite(n);return n===null?null:Number(n.toPrecision(6));}
function readoutDigest(r){
  if(!r||typeof r!=='object')return null;
  if(r.d===1)return r; // zaten özet
  const s=r.stretch,q=r.squeeze,d=r.displacement,e=r.effort,p=r.pools;
  const o={d:1};
  if(s){
    const av=s.leg==='UP'?s.avwapLow:s.avwapHigh;
    o.st=[s.leg,s.state,s.zone,s.rangePosPct,s.ema20Atr,av?sig(av.price):null,av?av.extAtr:null,av?av.z:null];
    const ch=s.chaseRisk||{};const c=[];if(ch.LONG&&ch.LONG!=='LOW')c.push('LONG_'+ch.LONG);if(ch.SHORT&&ch.SHORT!=='LOW')c.push('SHORT_'+ch.SHORT);
    if(c.length)o.ch=c.join(',');
  }
  if(q&&(q.state==='ON'||q.state==='ON_NARROW'||q.released))o.sq=[q.state,q.bars,q.released?q.released.barsAgo:null,q.momentum];
  if(d)o.dp=[d.dir,d.barsAgo,d.bodyAtr,d.retracePct,d.inOte?1:0];
  if(p){
    const keep=x=>x.filter(z=>z.status!=='UNSWEPT'||Math.abs(z.distAtr)<=2).map(z=>[sig(z.price),z.touches,z.status,z.distAtr]);
    const b=keep(p.buySide||[]),l=keep(p.sellSide||[]);
    if(b.length||l.length)o.pl={b,s:l};
  }
  if(e&&(/EXHAUSTION/.test(e.state)||e.divergence))o.ef=[e.state,e.divergence,e.volVsPrev];
  return Object.keys(o).length>1?o:null;
}
// R45 (user rule 05.10.2026): no chasing, LONG or SHORT; entries come from the trader's zones (OB, FVG, OTE/Fib,
// liquidity, formations). An entry is a chase when, on the lane's owner timeframe, the leg is stretched
// (STRETCHED/EXTENDED/EXTREME) and price sits in the wrong zone for the side (LONG in PREMIUM, SHORT in DISCOUNT)
// while the other of 5m/15m is also in the wrong zone, or when 5m/15m chase risk for the side is HIGH.
// Price inside the side's own OTE, unbroken OB or unfilled FVG on the owner timeframe is a zone entry, not a
// chase. Missing location data never blocks (evidence gap, not negative evidence).
function stretchOf(frame){
  const ro=frame?.readout;if(!ro||typeof ro!=='object')return null;
  if(ro.d===1){const st=Array.isArray(ro.st)?ro.st:[],ch=String(ro.ch||'');
    const lvl=s=>new RegExp(s+'_HIGH').test(ch)?'HIGH':new RegExp(s+'_MEDIUM').test(ch)?'MEDIUM':'LOW';
    return st.length?{leg:st[0]||null,state:st[1]||null,zone:st[2]||null,pos:finite(st[3]),chaseRisk:{LONG:lvl('LONG'),SHORT:lvl('SHORT')}}:null;}
  const s=ro.stretch;return s&&typeof s==='object'?{leg:s.leg||null,state:s.state||null,zone:s.zone||null,pos:finite(s.rangePosPct),chaseRisk:s.chaseRisk||{}}:null;
}
function inSideZone(frame,side,price){
  const p=finite(price),hits=[];if(!frame||p===null)return hits;
  const inside=(lo,hi)=>finite(lo)!==null&&finite(hi)!==null&&Math.min(lo,hi)<=p&&p<=Math.max(lo,hi);
  const ote=(frame?.oteReference||frame?.smcContext?.oteReference)?.[side==='LONG'?'longDiscountZone':'shortPremiumZone'];if(ote&&inside(ote.low,ote.high))hits.push('OTE');
  for(const ob of (frame?.orderBlocks?.[side==='LONG'?'bullish':'bearish']||[]))if(ob&&ob.broken!==true&&inside(ob.low,ob.high)){hits.push('OB');break;}
  for(const g of (Array.isArray(frame?.recentFairValueGaps)?frame.recentFairValueGaps:[]))if(g&&g.side===(side==='LONG'?'BULL':'BEAR')&&g.filled!==true&&inside(g.low,g.high)){hits.push('FVG');break;}
  return hits;
}
function locationChaseGate({side,lane=null,ownerTF=null,frames={},price=null}={}){
  side=String(side||'').toUpperCase();
  const owner=['5m','15m'].includes(String(ownerTF||'').toLowerCase())?String(ownerTF).toLowerCase():String(lane||'').toUpperCase().startsWith('5M')?'5m':'15m';
  const other=owner==='5m'?'15m':'5m',o=stretchOf(frames?.[owner]),x=stretchOf(frames?.[other]);
  if(!['LONG','SHORT'].includes(side)||!o)return {ok:true,checked:false,reason:'LOCATION_DATA_UNAVAILABLE',owner};
  const wrong=s=>!!s&&((side==='LONG'&&s.zone==='PREMIUM')||(side==='SHORT'&&s.zone==='DISCOUNT'));
  const stretched=s=>!!s&&['STRETCHED','EXTENDED','EXTREME'].includes(String(s.state||'').toUpperCase());
  const highChase=[o,x].some(s=>String(s?.chaseRisk?.[side]||'').toUpperCase()==='HIGH');
  const wrongZoneStretched=stretched(o)&&wrong(o)&&wrong(x);
  const inZone=inSideZone(frames?.[owner],side,price);
  const chase=(highChase||wrongZoneStretched)&&!inZone.length;
  const brief=s=>s?{state:s.state,zone:s.zone,pos:s.pos,chase:s.chaseRisk?.[side]||null}:null;
  return {ok:!chase,checked:true,reason:chase?'LOCATION_CHASE_BLOCK':null,side,owner,ownerStretch:brief(o),otherStretch:brief(x),highChase,wrongZoneStretched,inZone};
}
module.exports={chartReadout,readoutDigest,stretch,squeeze,displacement,liquidityPools,effort,anchoredVwap,rsiSeries,stretchOf,inSideZone,locationChaseGate};
