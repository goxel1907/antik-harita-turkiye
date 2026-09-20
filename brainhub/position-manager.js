'use strict';

const LOW_TFS=['1m','3m','5m'];
const ANCHOR_TFS=['15m','30m','1h','4h','1d'];
const ACTION_TR={
  HOLD:'TUT',
  HOLD_REVIEW:'TUT • VERİYİ YENİDEN KONTROL ET',
  PROTECT_PROFIT:'KÂRI KORU',
  PARTIAL_TAKE_PROFIT:'KISMİ KÂR AL',
  EXIT_NOW:'ÇIKIŞI DEĞERLENDİR'
};

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function opposite(side){return side==='LONG'?'SHORT':side==='SHORT'?'LONG':null;}
function frameConflict(frame,side){
  if(!frame?.available||frame?.fresh===false||!['LONG','SHORT'].includes(side))return {conflict:false,score:0,reasons:[]};
  const opp=opposite(side),reasons=[];let score=0;
  const trend=String(frame.trend||'').toUpperCase();
  if((opp==='SHORT'&&trend==='DOWN')||(opp==='LONG'&&trend==='UP')){score+=1;reasons.push('TERS_TREND');}
  const bos=String(frame.breakOfStructure||'').toUpperCase();
  if((opp==='SHORT'&&bos==='DOWN')||(opp==='LONG'&&bos==='UP')){score+=2;reasons.push('TERS_BOS');}
  const preferred=String(frame.opportunity?.preferredSide||'').toUpperCase();
  const oppScore=finite(opp==='LONG'?frame.opportunity?.longScore:frame.opportunity?.shortScore);
  if(preferred===opp&&oppScore!==null&&oppScore>=55){score+=1;reasons.push('TERS_FIRSAT_YOLU');}
  const breakout=String(frame.breakoutExecution?.status||'').toUpperCase();
  if(breakout==='FAILED_BREAKOUT'){score+=1;reasons.push('BASARISIZ_KIRILIM');}
  return {conflict:score>=2,score,reasons};
}
function positionPnlPct(position){
  const entry=finite(position?.entryPrice),mark=finite(position?.markPrice),side=String(position?.side||'').toUpperCase();
  if(entry===null||mark===null||entry<=0||!['LONG','SHORT'].includes(side))return null;
  return (side==='LONG'?(mark-entry)/entry:(entry-mark)/entry)*100;
}
function assessPosition({position,lifecycle={},unified={}}={}){
  const side=String(position?.side||lifecycle?.side||'').toUpperCase();
  const ownerTF=String(lifecycle?.ownerTF||'').toLowerCase();
  const originTF=String(lifecycle?.originTF||'').toLowerCase();
  const frames=unified?.frames||{};
  const byTf={};
  for(const tf of [...LOW_TFS,...ANCHOR_TFS,'45m'])byTf[tf]=frameConflict(frames?.[tf],side);
  const lowConflicts=LOW_TFS.filter(tf=>byTf[tf]?.conflict);
  const anchorConflicts=ANCHOR_TFS.filter(tf=>byTf[tf]?.conflict);
  const ownerConflict=ownerTF&&byTf[ownerTF]?byTf[ownerTF].conflict:false;
  const ownerIsLow=LOW_TFS.includes(ownerTF);
  const pnlPct=positionPnlPct(position);
  const inProfit=pnlPct!==null&&pnlPct>0;
  const lowTfNoiseOnly=lowConflicts.length>0&&anchorConflicts.length===0&&(ownerIsLow||!ownerConflict);
  const bigPictureBroken=Boolean(
    ownerConflict&&(
      ownerIsLow ? anchorConflicts.length>=2 : anchorConflicts.length>=1
    )
  );
  const partialEvidence=Boolean(
    inProfit&&(
      anchorConflicts.length>=1 ||
      (ownerConflict&&lowConflicts.length>=2)
    )
  );
  const protectEvidence=Boolean(
    inProfit&&(anchorConflicts.length>=1||lowConflicts.length>=2||ownerConflict)
  );
  return {
    side,originTF:originTF||null,ownerTF:ownerTF||null,pnlPct,inProfit,
    lowConflicts,anchorConflicts,ownerConflict,ownerIsLow,lowTfNoiseOnly,
    bigPictureBroken,partialEvidence,protectEvidence,
    dataQualityUsable:unified?.dataQuality?.advisoryUsable===true,
    rule:'1m/3m/5m tek başına yapısal çıkış değildir; owner ve büyük resim doğrulaması gerekir.'
  };
}
function capJevExitAction(requested,assessment){
  const a=String(requested||'HOLD').toUpperCase();
  if(!assessment?.dataQualityUsable)return 'HOLD_REVIEW';
  if(a==='EXIT_NOW'&&!assessment.bigPictureBroken){
    if(assessment.partialEvidence)return 'PARTIAL_TAKE_PROFIT';
    if(assessment.protectEvidence)return 'PROTECT_PROFIT';
    return 'HOLD';
  }
  if(a==='PARTIAL_TAKE_PROFIT'&&!assessment.partialEvidence){
    return assessment.protectEvidence?'PROTECT_PROFIT':'HOLD';
  }
  if(a==='PROTECT_PROFIT'&&!assessment.protectEvidence)return 'HOLD';
  if(!Object.prototype.hasOwnProperty.call(ACTION_TR,a))return 'HOLD_REVIEW';
  return a;
}
function actionTurkish(action){return ACTION_TR[action]||ACTION_TR.HOLD_REVIEW;}

module.exports={LOW_TFS,ANCHOR_TFS,ACTION_TR,frameConflict,positionPnlPct,assessPosition,capJevExitAction,actionTurkish};
