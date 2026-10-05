'use strict';
const {profitGiveback}=require('./outcome-metrics');
// A read-only interpretation layer. Keep the raw record and financial result;
// old TP/PnL-derived exit labels are not proof of the final order's authority.
function learningQuality(record){
  const p={...record};
  const inferred=new Set(['STOP_LOSS','TP1_THEN_STOP','TP1_RUNNER_TRAIL','TP1_BREAKEVEN','TAKE_PROFIT']);
  const warnings=[];
  if(p.outcomePath){
    const giveback=profitGiveback(p.outcomePath.mfeR,p.rMultiple??p.outcomePath.rMultiple);
    if(p.outcomePath.mfeGivebackR!==giveback)warnings.push('PROFIT_GIVEBACK_RECOMPUTED_FROM_OBSERVED_MFE');
    p.outcomePath={...p.outcomePath,mfeGivebackR:giveback};
  }
  const exchangeVerified=p.exitEvidence?.version==='R2544.40'&&p.exitEvidence.confirmed===true&&
    !!p.exitEvidence.orderId&&['BINANCE_FILL_ALGO_ORDER_ID','BINANCE_FILL_ORIGINAL_ORDER_TYPE'].includes(p.exitEvidence.source)&&
    p.exitEvidence.exitType===p.exitType;
  if(p.exitEvidenceVersion!=='R2544.35'&&!exchangeVerified&&inferred.has(p.exitType)){
    p.recordedExitType=p.exitType;p.exitType='UNVERIFIED_LEGACY_EXIT';
    warnings.push('FINAL_EXIT_AUTHORITY_NOT_CONFIRMED');
  }
  if(p.outcomePath?.mfeR==null||p.outcomePath?.maeR==null)warnings.push('EXCURSION_PATH_UNMEASURED');
  return {...p,qualityWarnings:warnings,interpretationVersion:'R2544.35',rawHistoryPreserved:true};
}
module.exports={learningQuality};
