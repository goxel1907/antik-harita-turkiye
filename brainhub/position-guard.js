'use strict';
// CLAUDE_R2544_POSITION_GUARD (Claude Work, 2026-09-28) — açık pozisyon "ultra takip" koruması.
// Kullanıcı kararı: işlem başına risk tavanı kaldırıldı (panel tek otorite). Bu modül tavanın yerine
// AÇIK POZİSYONU korur. Yalnız koruyucu, reduce-only eylem üretir; asla giriş açmaz, stopu asla GENİŞLETMEZ.
//   • Likidasyon: Binance liquidationPrice (yoksa isolated tahmin) — stop likidasyona çok yakınsa sıkılaştır,
//     fiyat likidasyona çok yaklaştıysa kapat.
//   • 5M_SCALP (vurkaç): erken başabaş, kâr kilidi, hızlı-başarısızlık sıkılaştırma, zaman stopu.
//   • 15M_TRADE (runner): TP1 öncesi 1R'de başabaş, uzun süre ilerlemezse zaman stopu.
//   TP1 sonrası (BREAKEVEN/TRAILING) iz süren stop CLAUDE_V111 runner'dadır; guard orada yalnız likidasyon bekçisidir.
const fs=require('node:fs');
const {LIQ_RULE,safeStopDistancePct}=require('./liquidation');
const path=require('node:path');

const DEFAULTS=Object.freeze({
  mode:'BINDING',                // OFF | SHADOW | BINDING
  tickSec:10,
  scalpBreakevenAtR:0.7, scalpLockAtR:1.2, scalpLockR:0.5,
  scalpFastFailMin:10, scalpFastFailR:-0.6, scalpFastFailTightenR:-0.8,
  scalpTimeStopMin:25, scalpTimeStopMaxMfeR:0.3, scalpTimeStopMaxProgressR:0.1,
  tradeBreakevenAtR:1.0, tradeTimeStopMin:180, tradeTimeStopMaxMfeR:0.3, tradeTimeStopMaxProgressR:0,
  breakevenBufferPct:0.12,
  liqStopMaxFraction:LIQ_RULE.maxFraction, // emir öncesi kapıyla AYNI kural (liquidation.js safeStopDistancePct)
  liqBufferPct:LIQ_RULE.bufferPct,
  liqTightenFraction:0.9,        // ihlalde yeni stop mesafesi = güvenli mesafenin %90'ı
  liqEmergencyPct:0.8,           // mark likidasyona %0.8'den yakınsa kapat
  minGapPct:0.15,                // yeni stop mark'a bu kadardan yakın olamaz (yoksa kapat)
  minImprovePct:0.05,
  tightenCooldownSec:15,
  chaseMaxRunR:0.5,              // analizden bu yana giriş yönünde >0.5R kaçtıysa kovalama yok → taze veriyle hemen yeniden JEV
  chasePriorityMin:3,            // kaçan sembol 3 dk boyunca hızlı hatta öncelikli
  // CLAUDE_R2544_4_SCALE_OUT (29.09 kanıtı: 64 gerçek işlemin 1m yolu; medyan MFE 0,62R, yalnız 19/64 işlem
  // stoptan önce 1R gördü). 0,5R'de 1/3 azalt + başabaş, 1R'de borsa TP1 (1/3), kalan runner. Test edilen
  // yönetimlerin en iyisi (-0,09R/işlem; gerçekleşen -0,22R/işlem). 0 = kapalı.
  scaleOutEnabled:1, scaleOutAtR:0.5, scaleOutFraction:0.3333, scaleOutMinMovePct:0.3, // ücret (~%0,1 gidiş-dönüş) üstünde anlamlı kâr
  // CLAUDE_R2544_4_PARTIAL_CONTRACT: JEV pozisyon incelemesinin KISMİ KÂR AL kararı için yürütme sözleşmesi.
  // AZTEC 29.09: 5 dk'da bir 6 kısmi (ilki 0,08R'de) → pozisyonun %97'si hareket gelmeden kapandı.
  partialContractEnabled:1, partialMinR:0.5, partialMaxReviewCount:2, partialMinSpacingMin:10,
  // CLAUDE_R2544_4_LOSS_STREAK: art arda 2 zararlı kapanış → 30 dk yeni giriş yok (açık pozisyon yönetimi sürer).
  // 68 kapanış: 2 zarar sonrası 30 dk içinde açılan 17 işlem toplam -5,48R / -55,8 USDT (ort. -0,32R; genel -0,22R).
  // 29.09 01:45–02:14: PHA, PENDLE zararından sonra COTI (-2,79) ve SOON (-12,32) bu pencerede açıldı. 0 = kapalı.
  lossStreakPauseCount:2, lossStreakPauseMin:30
});

function finite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function num(v,d,lo,hi){const n=finite(v);return n===null?d:Math.min(hi,Math.max(lo,n));}

function readConfig(root){
  let raw={};
  try{if(root)raw=JSON.parse(fs.readFileSync(path.join(root,'config','position-guard.json'),'utf8').replace(/^﻿/,''));}catch{raw={};}
  const mode=String(raw.mode||DEFAULTS.mode).toUpperCase();
  const out={...DEFAULTS,mode:['OFF','SHADOW','BINDING'].includes(mode)?mode:DEFAULTS.mode};
  for(const k of Object.keys(DEFAULTS)){
    if(k==='mode')continue;
    if(raw[k]!==undefined)out[k]=num(raw[k],DEFAULTS[k],-10,100000);
  }
  return out;
}

function laneOf(row){
  const lane=String(row?.lane||'').toUpperCase();
  if(lane==='5M_SCALP'||lane==='15M_TRADE')return lane;
  const tf=String(row?.originTF||'').toLowerCase();
  return ['1m','3m','5m'].includes(tf)?'5M_SCALP':'15M_TRADE';
}

function roundStop(price,side,tick){
  const t=finite(tick);
  if(!(t>0))return price;
  // LONG stop aşağıda: yukarı yuvarla (daha sıkı); SHORT stop yukarıda: aşağı yuvarla (daha sıkı).
  const q=price/t;
  const r=side==='LONG'?Math.ceil(q-1e-9)*t:Math.floor(q+1e-9)*t;
  return Number(r.toFixed(12));
}

// Saf karar fonksiyonu (test edilebilir). row: runner kaydı; snap: Binance positionSnapshot.
function evaluateGuard({row,snap,phase='INITIAL',now=Date.now(),config=DEFAULTS,estimatedLiquidationPrice=null}={}){
  const cfg={...DEFAULTS,...(config||{})};
  const side=String(row?.side||snap?.side||'').toUpperCase();
  const entry=finite(snap?.entryPrice)??finite(row?.entryPrice);
  const mark=finite(snap?.markPrice);
  const origStop=finite(row?.originalStopPrice);
  const curStop=finite(row?.currentStop)??origStop;
  const out={action:'NONE',reason:null,target:null,metrics:{}};
  if(!['LONG','SHORT'].includes(side)||entry===null||mark===null||origStop===null||!(finite(snap?.qty)>0)){
    out.reason='GUARD_INPUT_INCOMPLETE';return out;
  }
  const dir=side==='LONG'?1:-1;
  const R=Math.abs(entry-origStop);
  if(!(R>0)){out.reason='GUARD_R_INVALID';return out;}
  const progressR=dir*(mark-entry)/R;
  const mfeR=Math.max(finite(row?.guardMfeR)??progressR,progressR);
  const ageMin=Math.max(0,(now-(finite(row?.createdAt)??now))/60000);
  const lane=laneOf(row);
  const exLiq=finite(snap?.liquidationPrice);
  const liqPrice=exLiq!==null&&exLiq>0?exLiq:finite(estimatedLiquidationPrice??row?.estimatedLiquidationPrice);
  const liqSource=exLiq!==null&&exLiq>0?'BINANCE_POSITION_RISK':liqPrice!==null?'ESTIMATE_ISOLATED':'UNKNOWN';
  const liqDistPct=liqPrice!==null&&liqPrice>0?Math.abs(mark-liqPrice)/mark*100:null;
  Object.assign(out.metrics,{lane,R,progressR:Number(progressR.toFixed(4)),mfeR:Number(mfeR.toFixed(4)),ageMin:Number(ageMin.toFixed(2)),
    markPrice:mark,entryPrice:entry,currentStop:curStop,liquidationPrice:liqPrice,liquidationSource:liqSource,
    liquidationDistancePct:liqDistPct===null?null:Number(liqDistPct.toFixed(4))});

  const tighter=(target)=>curStop===null?true:(dir===1?target>curStop:target<curStop);
  const improvePct=(target)=>curStop===null?100:Math.abs(target-curStop)/mark*100;
  const propose=(rawTarget,reason)=>{
    const target=roundStop(rawTarget,side,snap?.tickSize);
    const gapPct=dir*(mark-target)/mark*100; // stop mark'ın doğru tarafında ve uzaklığı
    // Seviye GERÇEKTEN geçildiyse kapat; yalnız çok yakınsa bekle (küçük R'li kazançlı scalp erken kapatılmaz).
    if(gapPct<=0)return {action:'CLOSE',reason:reason+'_LEVEL_ALREADY_CROSSED',target:null};
    if(gapPct<cfg.minGapPct)return null;
    if(!tighter(target)||improvePct(target)<cfg.minImprovePct)return null; // asla genişletme
    return {action:'TIGHTEN_STOP',reason,target};
  };
  const decide=(d)=>{if(d){out.action=d.action;out.reason=d.reason;out.target=d.target;}return out;};

  // 1) Likidasyon bekçisi (her fazda).
  if(liqDistPct!==null){
    if(liqDistPct<=cfg.liqEmergencyPct)return decide({action:'CLOSE',reason:'GUARD_LIQUIDATION_PROXIMITY',target:null});
    const stopDistPct=curStop===null?Infinity:dir*(mark-curStop)/mark*100;
    const safe=safeStopDistancePct(liqDistPct,{bufferPct:cfg.liqBufferPct,maxFraction:cfg.liqStopMaxFraction});
    out.metrics.safeStopDistancePct=Number(safe.toFixed(4));
    if(stopDistPct>safe){
      const safePct=safeStopDistancePct(liqDistPct,{bufferPct:cfg.liqBufferPct,maxFraction:cfg.liqStopMaxFraction});
    const d=propose(mark-dir*mark*safePct/100*cfg.liqTightenFraction,'GUARD_STOP_NEAR_LIQUIDATION');
      if(d)return decide(d);
    }
  }
  // TP1 sonrası iz süren stop runner'dadır.
  if(String(phase||'INITIAL').toUpperCase()!=='INITIAL')return out;

  // 2) Kademeli kâr: 0,5R'de bir kez 1/3 azalt; ardından stop başabaşa (asla genişlemez).
  if(cfg.scaleOutEnabled>0){
    const movePct=dir*(mark-entry)/entry*100;
    if(row?.scaleOutDone!==true&&progressR>=cfg.scaleOutAtR&&movePct>=cfg.scaleOutMinMovePct){
      out.action='SCALE_OUT';out.reason='GUARD_SCALE_OUT_'+cfg.scaleOutAtR+'R';out.fraction=cfg.scaleOutFraction;return out;
    }
    if(row?.scaleOutDone===true){
      const d=propose(entry*(1+dir*cfg.breakevenBufferPct/100),'GUARD_SCALE_OUT_BREAKEVEN');if(d)return decide(d);
    }
  }

  if(lane==='5M_SCALP'){
    if(ageMin<=cfg.scalpFastFailMin&&progressR<=cfg.scalpFastFailR){
      const d=propose(entry+dir*cfg.scalpFastFailTightenR*R,'GUARD_SCALP_FAST_FAIL');if(d)return decide(d);
    }
    if(mfeR>=cfg.scalpLockAtR){
      const d=propose(entry+dir*cfg.scalpLockR*R,'GUARD_SCALP_PROFIT_LOCK');if(d)return decide(d);
    }
    if(mfeR>=cfg.scalpBreakevenAtR){
      const d=propose(entry*(1+dir*cfg.breakevenBufferPct/100),'GUARD_SCALP_BREAKEVEN');if(d)return decide(d);
    }
    if(ageMin>=cfg.scalpTimeStopMin&&mfeR<cfg.scalpTimeStopMaxMfeR&&progressR<cfg.scalpTimeStopMaxProgressR){
      return decide({action:'CLOSE',reason:'GUARD_SCALP_TIME_STOP',target:null});
    }
  }else{
    if(mfeR>=cfg.tradeBreakevenAtR){
      const d=propose(entry*(1+dir*cfg.breakevenBufferPct/100),'GUARD_TRADE_BREAKEVEN');if(d)return decide(d);
    }
    if(ageMin>=cfg.tradeTimeStopMin&&mfeR<cfg.tradeTimeStopMaxMfeR&&progressR<cfg.tradeTimeStopMaxProgressR){
      return decide({action:'CLOSE',reason:'GUARD_TRADE_TIME_STOP',target:null});
    }
  }
  return out;
}

// JEV incelemesinden gelen KISMİ KÂR AL için yürütme sözleşmesi (saf fonksiyon). Tam çıkış (EXIT_NOW) buradan geçmez.
function partialContract({side,entryPrice,initialStop,markPrice,partialEvents=[],now=Date.now(),config=DEFAULTS}={}){
  const cfg={...DEFAULTS,...(config||{})};
  const s=String(side||'').toUpperCase(),e=finite(entryPrice),st=finite(initialStop),m=finite(markPrice);
  const events=(Array.isArray(partialEvents)?partialEvents:[]).filter(x=>String(x?.action||'')==='PARTIAL_TAKE_PROFIT');
  const lastAt=events.reduce((a,x)=>Math.max(a,finite(x?.at)||0),0)||null;
  const base={enabled:cfg.partialContractEnabled>0,minR:cfg.partialMinR,maxReviewPartials:cfg.partialMaxReviewCount,
    minSpacingMin:cfg.partialMinSpacingMin,reviewPartialsTaken:events.length,lastPartialAt:lastAt,progressR:null};
  if(!(cfg.partialContractEnabled>0))return {...base,allow:true,reason:'PARTIAL_CONTRACT_OFF'};
  if(!['LONG','SHORT'].includes(s)||e===null||st===null||m===null||e===st)return {...base,allow:false,reason:'PARTIAL_CONTRACT_INPUT_INCOMPLETE'};
  const progressR=(s==='LONG'?1:-1)*(m-e)/Math.abs(e-st);
  const out={...base,progressR:Number(progressR.toFixed(3))};
  if(events.length>=cfg.partialMaxReviewCount)return {...out,allow:false,reason:'PARTIAL_DEFERRED_MAX_COUNT'};
  if(lastAt&&now-lastAt<cfg.partialMinSpacingMin*60000)return {...out,allow:false,reason:'PARTIAL_DEFERRED_SPACING'};
  if(progressR<cfg.partialMinR)return {...out,allow:false,reason:'PARTIAL_DEFERRED_BELOW_MIN_R'};
  return {...out,allow:true,reason:'PARTIAL_CONTRACT_OK'};
}

module.exports={DEFAULTS,readConfig,evaluateGuard,partialContract,laneOf,roundStop};
