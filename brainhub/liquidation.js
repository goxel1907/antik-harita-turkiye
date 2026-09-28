'use strict';
// CLAUDE_R2544_LIQUIDATION_MODEL (Claude Work, 2026-09-28)
// Tek likidasyon modeli: emir öncesi kontrol (leader-live-intent) ve açık pozisyon koruması
// (position-guard) AYNI fonksiyonu kullanır. Emir öncesi: Binance isolated one-way formülü
// (cross'ta gerçek likidasyon daha uzaktadır → bu tahmin muhafazakârdır). Pozisyon açıldıktan
// sonra Binance positionRisk.liquidationPrice (>0 ise) OTORİTEDİR.

function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}

// Binance USDT-M isolated, tek pozisyon:
//   LONG : LP = EP*(1-1/L)/(1-MMR) - cum/(Q*(1-MMR))
//   SHORT: LP = EP*(1+1/L)/(1+MMR) + cum/(Q*(1+MMR))
function estimateLiquidation({side,entryPrice,leverage,maintenanceMarginRate,maintenanceAmount=0,quantity=null}={}){
  const s=String(side||'').toUpperCase();
  const ep=finite(entryPrice),lev=finite(leverage),mmr=finite(maintenanceMarginRate);
  if(!['LONG','SHORT'].includes(s)||ep===null||ep<=0||lev===null||lev<=0||mmr===null||mmr<0||mmr>=1)return {ok:false,reason:'LIQUIDATION_INPUT_INVALID'};
  const q=finite(quantity),cum=finite(maintenanceAmount)||0;
  const cumTerm=q!==null&&q>0?cum/q:0;
  let price=s==='LONG'
    ?ep*(1-1/lev)/(1-mmr)-cumTerm/(1-mmr)
    :ep*(1+1/lev)/(1+mmr)+cumTerm/(1+mmr);
  if(!(price>0))price=s==='LONG'?0:null;
  const distancePct=price===null?null:Math.abs(ep-price)/ep*100;
  return {ok:price!==null,model:'BINANCE_ISOLATED_ONE_WAY',side:s,entryPrice:ep,leverage:lev,maintenanceMarginRate:mmr,price,distancePct};
}

// TEK GÜVENLİ STOP KURALI (emir öncesi kapı + açık pozisyon koruması aynı sayıyı kullanır):
// stop mesafesi ≤ min(likidasyon mesafesi − tampon, maxFraction × likidasyon mesafesi).
const LIQ_RULE=Object.freeze({bufferPct:0.5,maxFraction:0.9});
function safeStopDistancePct(liqDistancePct,{bufferPct=LIQ_RULE.bufferPct,maxFraction=LIQ_RULE.maxFraction}={}){
  const d=finite(liqDistancePct);
  if(d===null||d<=0)return 0;
  return Math.max(0,Math.min(d-Math.max(0,finite(bufferPct)??LIQ_RULE.bufferPct),d*(finite(maxFraction)??LIQ_RULE.maxFraction)));
}
// Stop likidasyondan güvenli mesafede ÖNCE mi tetiklenir?
function stopVsLiquidation({side,entryPrice,stopPrice,liquidationPrice,bufferPct=LIQ_RULE.bufferPct,maxFraction=LIQ_RULE.maxFraction}={}){
  const s=String(side||'').toUpperCase();
  const ep=finite(entryPrice),sp=finite(stopPrice),lp=finite(liquidationPrice),buf=Math.max(0,finite(bufferPct)??0.5);
  if(!['LONG','SHORT'].includes(s)||ep===null||sp===null||lp===null)return {ok:false,known:false,reason:'LIQUIDATION_UNKNOWN'};
  const stopDistancePct=Math.abs(ep-sp)/ep*100;
  const liqDistancePct=Math.abs(ep-lp)/ep*100;
  const usableLiqDistancePct=safeStopDistancePct(liqDistancePct,{bufferPct:buf,maxFraction});
  const stopOnRightSide=s==='LONG'?sp<ep:sp>ep;
  const liqOnRightSide=s==='LONG'?lp<ep:lp>ep;
  const stopBeforeLiq=liqOnRightSide&&stopDistancePct<=usableLiqDistancePct+1e-12;
  return {ok:stopOnRightSide&&stopBeforeLiq,known:true,stopDistancePct,liqDistancePct,usableLiqDistancePct,
    stopToLiqFraction:liqDistancePct>0?stopDistancePct/liqDistancePct:null,
    reason:!stopOnRightSide?'STOP_WRONG_SIDE':stopBeforeLiq?null:'STOP_BEYOND_LIQUIDATION'};
}

// Açık pozisyon: Binance değeri >0 ise otorite, yoksa tahmin.
function effectiveLiquidationPrice({exchangeLiquidationPrice,estimate}={}){
  const x=finite(exchangeLiquidationPrice);
  if(x!==null&&x>0)return {price:x,source:'BINANCE_POSITION_RISK'};
  const e=finite(estimate?.price??estimate);
  if(e!==null&&e>0)return {price:e,source:'ESTIMATE_ISOLATED'};
  return {price:null,source:'UNKNOWN'};
}

module.exports={LIQ_RULE,safeStopDistancePct,estimateLiquidation,stopVsLiquidation,effectiveLiquidationPrice};
