'use strict';
// Read-only projection. Keep exchange/ledger truth and measured totals, omit entry-case dossiers.
function pick(row,keys){return Object.fromEntries(keys.filter(k=>row?.[k]!==undefined).map(k=>[k,row[k]]));}
const OPEN=['symbol','side','quantity','entryPrice','markPrice','unrealizedPnl','unrealizedR','leverage','notional','liquidationPrice','stopPrice','originalStopPrice','takeProfit1','runnerPhase','trailTf','openedBy','openedAt','lane','originTF','setup','strategyVersion','releaseContract'];
const CLOSED=['symbol','side','netPnl','rMultiple','exitType','closedAt','ts','tradeLane','originTF','holdMinutes'];
function mobilePositions(report={}){
  return {...pick(report,['ok','asOf','ledgerOk','ledgerError','openCount','openUnrealizedPnl','summary','deskSummary','execution']),
    compact:true,summaryScope:report.summaryScope||'UNSPECIFIED',
    open:(report.open||[]).map(x=>pick(x,OPEN)),closed:(report.closed||[]).slice(0,5).map(x=>pick(x,CLOSED))};
}
module.exports={mobilePositions};
