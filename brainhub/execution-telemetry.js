'use strict';
// Read-only projection: no stage implies an order or weakens an execution gate.
function executionTelemetry(events=[]){
 const groups=new Map();
 for(const raw of events){
  const e=raw?.payload?{...raw.payload,at:raw.ts??raw.payload.at}:raw;
  if(!e?.decisionId)continue;
  const g=groups.get(e.decisionId)||{decisionId:e.decisionId,symbol:e.symbol||null,stages:[],reasons:[],at:0};
  if(e.stage&&e.kind==='JEV_FINAL_AUTHORITY'){
   const rawReasons=e.reasons??e.reason;
   g.stages.push({stage:e.stage,at:Number(e.at||e.ts||0),reasons:[].concat(rawReasons||[]).filter(Boolean).map(String)});
   g.at=Math.max(g.at,Number(e.at||e.ts||0));
  }
  groups.set(e.decisionId,g);
 }
 const chains=[...groups.values()].filter(g=>g.stages.length).map(g=>{
  g.stages.sort((a,b)=>a.at-b.at);
  const terminal=g.stages.filter(x=>x.stage!=='SOFT_WARNING').at(-1);
  return {...g,stage:terminal?.stage||null,reasons:terminal?.reasons||[]};
 }).sort((a,b)=>b.at-a.at||a.decisionId.localeCompare(b.decisionId));
 const counts={};
 for(const g of chains)for(const r of new Set(g.stages.filter(x=>x.stage==='HARD_BLOCK').flatMap(x=>x.reasons)))counts[r]=(counts[r]||0)+1;
 const latestBySymbol=new Map();
 for(const g of chains)if(!latestBySymbol.has(g.symbol))latestBySymbol.set(g.symbol,g);
 const lastBlock=[...latestBySymbol.values()].find(g=>g.stage==='HARD_BLOCK')||null;
 return {chains,reasonCounts:counts,lastBlock:lastBlock?{decisionId:lastBlock.decisionId,symbol:lastBlock.symbol,at:new Date(lastBlock.at).toISOString(),reasons:lastBlock.reasons,scope:'LAST_UNRESOLVED_DECISION_IN_WINDOW'}:null};
}
module.exports={executionTelemetry};
