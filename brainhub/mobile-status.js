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
  // R2544.57: İlk 3 Avcısı for the APK (no lessons text, no scan dumps)
  const t=status.top3;
  if(t&&typeof t==='object'){
    const pick=(o,ks)=>o&&typeof o==='object'?Object.fromEntries(ks.filter(k=>o[k]!==undefined).map(k=>[k,o[k]])):null;
    out.top3={version:t.version,tradingMode:t.tradingMode,switches:t.switches,gate:t.gate,running:t.running,settings:t.settings||null,
      testWindow:pick(t.testWindow,['startedAt','endsAt','elapsedH','remainingMin','done','scans','okScans','signals','entries']),
      active:(t.active||[]).slice(0,12).map(a=>pick(a,['symbol','side','rule','signalKind','mode','entryPrice','stopPrice','tpPrice','markPrice','unrealizedPnl','leverage','marginQuote','remainingMin','riskQuote'])),
      lastScan:t.lastScan?{at:t.lastScan.at,candle:t.lastScan.candle,ranked:t.lastScan.ranked,signals:(t.lastScan.signals||[]).slice(0,8).map(x=>({symbol:x.symbol,side:x.side,kind:x.kind||null})),errors:(t.lastScan.errors||[]).slice(0,3)}:null,
      // R2544.58 v2: rules version, risk per trade and the last 5m pass for the phone
      rules:t.rules?{rulesVersion:t.rules.rulesVersion??1,riskPct:t.rules.riskPct??null}:null,
      lastScan5:t.lastScan5?{at:t.lastScan5.at,bar:t.lastScan5.bar,candidates:t.lastScan5.candidates||null,checked:t.lastScan5.checked,
        signals:(t.lastScan5.signals||[]).slice(0,8).map(x=>({symbol:x.symbol,side:x.side,rule:x.rule})),
        waiting:(t.lastScan5.nearMisses||[]).slice(0,6).map(x=>({symbol:x.symbol,side:x.side,reason:x.reason})),errors:(t.lastScan5.errors||[]).slice(0,3)}:null,
      results:t.results||null,windowResults:t.windowResults||null,
      learning:t.learning?{lessons:t.learning.lessons,groups:(t.learning.groups||[]).slice(0,8)}:null};
  }
  out.compact=true;out.mobileContract='R2544.58_PC_STATUS';return out;
}
module.exports={mobileStatus};
