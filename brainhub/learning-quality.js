'use strict';
// A read-only interpretation layer. Keep the raw record and financial result;
// old TP/PnL-derived exit labels are not proof of the final order's authority.
function learningQuality(record){
  const p={...record};
  const inferred=new Set(['STOP_LOSS','TP1_THEN_STOP','TP1_RUNNER_TRAIL','TP1_BREAKEVEN','TAKE_PROFIT']);
  const warnings=[];
  if(p.exitEvidenceVersion!=='R2544.35'&&inferred.has(p.exitType)){
    p.recordedExitType=p.exitType;p.exitType='UNVERIFIED_LEGACY_EXIT';
    warnings.push('FINAL_EXIT_AUTHORITY_NOT_CONFIRMED');
  }
  if(p.outcomePath?.mfeR==null||p.outcomePath?.maeR==null)warnings.push('EXCURSION_PATH_UNMEASURED');
  return {...p,qualityWarnings:warnings,interpretationVersion:'R2544.35',rawHistoryPreserved:true};
}
module.exports={learningQuality};
