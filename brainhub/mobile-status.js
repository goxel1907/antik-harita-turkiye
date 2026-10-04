'use strict';
// Android consumes status, decisions and counters, not immutable market dossiers.
// The full endpoint remains available to Office and audit tools.
const DOSSIERS=new Set(['unified','unifiedContext','jevSeen','coreMarketPacket','marketSignature','entryCase','entryContext','entryContextRaw','caseMemory','caseMemoryByLane','frameSnapshot','marketPacket','rawSnapshot','chartOverlayLevels','timeframes','frames','geometry','chartReadingByTf','chartNarratives']);
function project(value){
  if(Array.isArray(value))return value.slice(0,24).map(project);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!DOSSIERS.has(key)).map(([key,v])=>[key,project(v)]));
}
function mobileStatus(status={}){
  const out=project(status);
  if(out.learning){
    const src=status.learning;
    out.learning=Object.fromEntries(['source','lifetime','stats','measuredSampleCount','recentMeasuredDetailCount','jevLessonCount','recentJevLessonCount','jevLessonTotalCount','changesAppliedToHardRisk','rMeasurementPolicy','note'].filter(k=>src[k]!==undefined).map(k=>[k,project(src[k])]));
  }
  out.compact=true;out.mobileContract='R2544.35_PC_STATUS';return out;
}
module.exports={mobileStatus};
