'use strict';

// R2544.19 Contextual Episode Memory.
// Converts entry/current market state into a compact observational fingerprint.
// No participant identity or hidden market-maker intent is inferred.
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function u(v){return String(v??'').trim().toUpperCase();}
function signBucket(v,{eps=0.0001,pos='POS',neg='NEG',flat='FLAT'}={}){
  const x=n(v); if(x===null)return null; return x>eps?pos:x<-eps?neg:flat;
}
function ratioBucket(v,prefix){
  const x=n(v); if(x===null)return null;
  if(x>=1.5)return prefix+'_HIGH';
  if(x>=1.05)return prefix+'_ABOVE1';
  if(x<=0.67)return prefix+'_LOW';
  if(x<=0.95)return prefix+'_BELOW1';
  return prefix+'_NEUTRAL';
}
function frameFromMarketSignature(f){
  if(!f||typeof f!=='object')return null;
  const ro=f.readout||{};
  return {
    trend:u(f.trend)||null,bos:u(f.breakOfStructure)||null,rsi:n(f.rsi14),atr:n(f.atrPct),
    swing:u(f.swingState)||null,
    patterns:(Array.isArray(f.patterns)?f.patterns:[]).slice(0,4).map(p=>({
      type:u(p?.type||p),side:u(p?.side)||null,status:u(p?.status)||null
    })),
    sweep:u(f.sweep?.type||f.sweep?.state||f.sweep)||null,
    stretch:u(ro.stretchState)||null,zone:u(ro.zone)||null,
    chaseLong:u(ro.chaseLong)||null,chaseShort:u(ro.chaseShort)||null,
    squeeze:u(ro.squeeze)||null,displacement:u(ro.displacement)||null,
    effort:u(ro.effort)||null,divergence:u(ro.divergence)||null
  };
}
function frameFromUnified(f){
  if(!f||f.available===false)return null;
  const ro=f.readout||{},st=ro.stretch||{},sq=ro.squeeze||{},dp=ro.displacement||{},ef=ro.effort||{};
  return {
    trend:u(f.trend)||null,bos:u(f.breakOfStructure)||null,rsi:n(f.rsi14),atr:n(f.atrPct),
    swing:u(f.swingStructure?.state)||null,
    patterns:(Array.isArray(f.patterns)?f.patterns:[]).slice(-4).map(p=>({
      type:u(p?.type||p),side:u(p?.side)||null,status:u(p?.status)||null
    })),
    sweep:u(f.liquidity?.sweep?.type||f.liquidity?.lastSweep?.type||f.liquidity?.sweep||f.liquidity?.lastSweep)||null,
    stretch:u(st.state)||null,zone:u(st.zone)||null,
    chaseLong:u(st?.chaseRisk?.LONG)||null,chaseShort:u(st?.chaseRisk?.SHORT)||null,
    squeeze:u(sq.state)||null,displacement:u(dp.dir)||null,
    effort:u(ef.state)||null,divergence:u(ef.divergence)||null
  };
}
function liqFromUnified(u0){
  const liq=u0?.liquidationContext||{};
  const zones=Array.isArray(liq.zones)?liq.zones:[];
  let longQuote=0,shortQuote=0;
  for(const z of zones){
    const q=n(z?.quote||z?.notional||z?.usd||z?.amountQuote)||0;
    const t=u(z?.type||z?.side||'');
    if(t.includes('LONG'))longQuote+=q;
    else if(t.includes('SHORT'))shortQuote+=q;
  }
  return {available:liq.available===true||zones.length>0,count:n(liq.count)??zones.length,source:liq.source||null,longQuote,shortQuote};
}
function signatureFromMarketSignature(sig,side=null){
  if(!sig||typeof sig!=='object')return null;
  return {
    version:'R2544.19_EPISODE_V1',side:u(side)||null,
    f5:frameFromMarketSignature(sig.regime5m),f15:frameFromMarketSignature(sig.regime15m),
    flow:{cvd:n(sig?.orderFlow?.cvd120s),available:sig?.orderFlow?.available===true,source:sig?.orderFlow?.source||null},
    depth:{imbalance:n(sig?.depth?.imbalance),spreadBps:n(sig?.depth?.spreadBps)},
    derivatives:{
      oiDeltaPct:n(sig?.derivatives?.oiDeltaPct),funding:n(sig?.derivatives?.fundingRate),
      takerRatio:n(sig?.derivatives?.takerBuySellRatio),topTraderRatio:n(sig?.derivatives?.topTraderRatio),
      globalRatio:n(sig?.derivatives?.globalRatio)
    },
    liquidations:{
      available:sig?.observedLiquidations?.available===true,count:n(sig?.observedLiquidations?.count),
      source:sig?.observedLiquidations?.source||null,longQuote:n(sig?.observedLiquidations?.longQuote),
      shortQuote:n(sig?.observedLiquidations?.shortQuote)
    },
    semantics:{participantIdentity:'NOT_IDENTIFIED',participantIntent:'NOT_ASSERTED',liquidations:'OBSERVED_ONLY'}
  };
}
function signatureFromUnified(ctx,side=null){
  if(!ctx||typeof ctx!=='object')return null;
  const flow=ctx?.marketMakerEvidence?.orderFlow||ctx?.microstructure?.streaming?.orderFlow||{};
  const m=ctx?.microstructure||{}, d=ctx?.derivatives||{};
  const liq=liqFromUnified(ctx);
  return {
    version:'R2544.19_EPISODE_V1',side:u(side)||null,
    f5:frameFromUnified(ctx?.frames?.['5m']),f15:frameFromUnified(ctx?.frames?.['15m']),
    flow:{available:flow.available===true||n(flow?.cvdQuote120s??flow?.cvd120s??m?.streaming?.cvdQuote120s)!==null,
      source:flow.source||m?.streaming?.source||null,cvd:n(flow?.cvdQuote120s??flow?.cvd120s??m?.streaming?.cvdQuote120s)},
    depth:{imbalance:n(m?.depth20Imbalance??m?.streaming?.depth20Imbalance),spreadBps:n(m?.spreadBps)},
    derivatives:{
      oiDeltaPct:n(d?.openInterest?.delta5mPct??d?.oiDelta5mPct),funding:n(d?.fundingRate??d?.funding?.lastFundingRate),
      takerRatio:n(d?.takerBuySellRatio??d?.taker?.buySellRatio),
      topTraderRatio:n(d?.topTraderRatio??d?.topTrader?.ratio),globalRatio:n(d?.globalRatio??d?.global?.ratio)
    },
    liquidations:liq,
    semantics:{participantIdentity:'NOT_IDENTIFIED',participantIntent:'NOT_ASSERTED',liquidations:'OBSERVED_ONLY'}
  };
}
function rsiBucket(x){x=n(x);if(x===null)return null;return x>=70?'RSI_OB':x>=55?'RSI_STRONG':x<=30?'RSI_OS':x<=45?'RSI_WEAK':'RSI_NEUTRAL';}
function frameTokens(tf,f,side){
  if(!f)return [];
  const z=[],pre=tf+'_';
  if(f.trend)z.push(pre+'TREND_'+f.trend);
  if(f.bos)z.push(pre+'BOS_'+f.bos);
  if(f.swing)z.push(pre+'SWING_'+f.swing);
  const rb=rsiBucket(f.rsi);if(rb)z.push(pre+rb);
  if(f.stretch)z.push(pre+'STRETCH_'+f.stretch);
  if(f.zone)z.push(pre+'ZONE_'+f.zone);
  const ch=side==='LONG'?f.chaseLong:side==='SHORT'?f.chaseShort:null;
  if(ch)z.push(pre+'CHASE_'+side+'_'+ch);
  if(f.squeeze)z.push(pre+'SQUEEZE_'+f.squeeze);
  if(f.displacement)z.push(pre+'DISP_'+f.displacement);
  if(f.effort)z.push(pre+'EFFORT_'+f.effort);
  if(f.divergence)z.push(pre+'DIV_'+f.divergence);
  if(f.sweep)z.push(pre+'SWEEP_'+f.sweep);
  for(const p of f.patterns||[])if(p.type)z.push(pre+'PAT_'+p.type+(p.side?'_'+p.side:'')+(p.status?'_'+p.status:''));
  return z;
}
function tokens(sig){
  if(!sig)return [];
  const side=u(sig.side)||'UNKNOWN',z=['SIDE_'+side];
  z.push(...frameTokens('5M',sig.f5,side),...frameTokens('15M',sig.f15,side));
  const cvd=signBucket(sig?.flow?.cvd,{eps:1,pos:'CVD_BUY',neg:'CVD_SELL',flat:'CVD_FLAT'});if(cvd)z.push(cvd);
  const im=signBucket(sig?.depth?.imbalance,{eps:0.08,pos:'DEPTH_BID_HEAVY',neg:'DEPTH_ASK_HEAVY',flat:'DEPTH_BALANCED'});if(im)z.push(im);
  const sp=n(sig?.depth?.spreadBps);if(sp!==null)z.push(sp<=5?'SPREAD_TIGHT':sp<=15?'SPREAD_NORMAL':'SPREAD_WIDE');
  const oi=signBucket(sig?.derivatives?.oiDeltaPct,{eps:0.02,pos:'OI_RISING',neg:'OI_FALLING',flat:'OI_FLAT'});if(oi)z.push(oi);
  const fund=signBucket(sig?.derivatives?.funding,{eps:0.00001,pos:'FUNDING_POS',neg:'FUNDING_NEG',flat:'FUNDING_FLAT'});if(fund)z.push(fund);
  const tr=ratioBucket(sig?.derivatives?.takerRatio,'TAKER_BUYSELL');if(tr)z.push(tr);
  const top=ratioBucket(sig?.derivatives?.topTraderRatio,'TOPTRADER');if(top)z.push(top);
  const glob=ratioBucket(sig?.derivatives?.globalRatio,'GLOBAL');if(glob)z.push(glob);
  const lq=n(sig?.liquidations?.longQuote),sq=n(sig?.liquidations?.shortQuote),cnt=n(sig?.liquidations?.count);
  if(cnt!==null&&cnt>0)z.push('LIQ_PRINTS_PRESENT');
  if(lq!==null||sq!==null){
    const a=lq||0,b=sq||0;
    if(a>b*1.5&&a>0)z.push('LONG_LIQUIDATION_DOM');
    else if(b>a*1.5&&b>0)z.push('SHORT_LIQUIDATION_DOM');
    else if(a+b>0)z.push('LIQUIDATION_MIXED');
  }
  return [...new Set(z)];
}
function weight(t){
  if(t.startsWith('SIDE_'))return 2.5;
  if(t.includes('_PAT_')||t.includes('_SWEEP_'))return 1.6;
  if(t.startsWith('CVD_')||t.startsWith('DEPTH_')||t.startsWith('OI_')||t.startsWith('TAKER_')||t.includes('LIQUIDATION'))return 1.5;
  if(t.includes('STRETCH')||t.includes('CHASE'))return 1.4;
  return 1;
}
function similarity(a,b){
  const A=new Set(tokens(a)),B=new Set(tokens(b)); if(!A.size||!B.size)return {score:0,shared:[],different:[]};
  let inter=0,uni=0;const U=new Set([...A,...B]);
  for(const t of U){const w=weight(t);uni+=w;if(A.has(t)&&B.has(t))inter+=w;}
  const shared=[...A].filter(t=>B.has(t)).sort((x,y)=>weight(y)-weight(x)||x.localeCompare(y));
  const different=[...U].filter(t=>A.has(t)!==B.has(t)).slice(0,12);
  return {score:uni?Number((inter/uni).toFixed(3)):0,shared:shared.slice(0,10),different};
}
function mechanics(sig){
  if(!sig)return {labels:[],participantIdentity:'NOT_IDENTIFIED',participantIntent:'NOT_ASSERTED'};
  const z=tokens(sig);
  return {labels:z.filter(t=>/CVD_|DEPTH_|OI_|TAKER_|LIQUIDATION|SWEEP_|STRETCH_|CHASE_|PAT_/.test(t)).slice(0,16),
    participantIdentity:'NOT_IDENTIFIED',participantIntent:'NOT_ASSERTED',
    note:'Observed mechanics only. These labels describe public price/flow/liquidation evidence; they do not identify or infer a market maker.'};
}
function nearestEpisodes(cards,current,{limitPerOutcome=3,minScore=0.18}={}){
  if(!current)return null;
  const rows=[];
  for(const c of cards||[]){
    if(c.net===null||!c.episodeSignature)continue;
    const s=similarity(current,c.episodeSignature);
    if(s.score<minScore)continue;
    rows.push({symbol:c.symbol,side:c.side,family:c.family,lane:c.lane,timing:c.timing,net:c.net,r:c.r,exit:c.exit,
      score:s.score,shared:s.shared.slice(0,7),different:s.different.slice(0,6),closedMs:c.closedMs||null,
      mechanics:c.mechanics?.labels||[]});
  }
  rows.sort((a,b)=>b.score-a.score||(b.closedMs||0)-(a.closedMs||0));
  const slim=x=>({...x,closedMs:undefined});
  const wins=rows.filter(x=>x.net>0).slice(0,limitPerOutcome).map(slim);
  const losses=rows.filter(x=>x.net<0).slice(0,limitPerOutcome).map(slim);
  return {
    current:{side:current.side,tokens:tokens(current).slice(0,28),mechanics:mechanics(current)},
    wins,losses,
    mixedEvidence:wins.length>0&&losses.length>0,
    policy:'Nearest historical contexts are contrastive evidence, not a prediction. Compare both similar winners and similar losers; identify which CURRENT features differ before reusing a lesson. Never infer hidden participant identity or intent.'
  };
}
module.exports={signatureFromMarketSignature,signatureFromUnified,tokens,similarity,mechanics,nearestEpisodes};
