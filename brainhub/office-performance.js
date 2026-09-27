'use strict';
const RELEASE='R2542_JEV_TRADER_OFFICE';
const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
// Old live-ledger rows had no eventId. A backfill can refer to the same entry a
// few milliseconds earlier. Match its full entry identity, never symbol alone.
function sameEntry(a,b){
 const at=Date.parse(a.openedAt||''),bt=Date.parse(b.openedAt||'');
 return !!a.symbol&&a.symbol===b.symbol&&!!a.side&&a.side===b.side&&
   Number.isFinite(at)&&Number.isFinite(bt)&&Math.abs(at-bt)<=1000&&
   num(a.entryPrice)!==null&&num(a.entryPrice)===num(b.entryPrice)&&
   num(a.quantity)!==null&&num(a.quantity)===num(b.quantity);
}
function reconcileCloses(rows){
 const direct=rows.filter(x=>!x.backfilled),seen=new Map(),trades=[],excluded=[];
 for(const row of [...direct,...rows.filter(x=>x.backfilled)]){
   const original=(row.eventId&&seen.get(row.eventId))||
     (row.backfilled&&direct.find(x=>sameEntry(x,row)));
   if(original){excluded.push({id:row.id,symbol:row.symbol,openedAt:row.openedAt,canonicalId:original.id,reason:row.eventId===original.eventId?'DUPLICATE_EVENT_ID':'BACKFILL_OF_EXISTING_ENTRY'});continue;}
   trades.push(row);if(row.eventId)seen.set(row.eventId,row);
 }
 return {trades,excluded};
}
function enrichCloses(rows,records=[]){
 const entries=records.filter(x=>x.kind==='LIVE_EXECUTION'&&x.payload?.result?.orderPlaced===true);
 const exits=records.filter(x=>x.kind==='JEV_POSITION_EXECUTION'&&x.payload?.result?.orderPlaced===true&&Number(x.payload?.result?.executedQty)>0);
 return rows.map(raw=>{
   const row={...raw}, at=Date.parse(row.openedAt||''), end=Date.parse(row.closedAt||'');
   const matches=entries.filter(e=>e.symbol===row.symbol&&e.payload.result.side===row.side&&(row.eventId?e.payload.eventId===row.eventId:Number.isFinite(at)&&Math.abs(Number(e.ts)-at)<=2000));
   if(matches.length!==1||!Number.isFinite(end))return row;
   const e=matches[0],p=e.payload,r=p.result;
   // CLAUDE_R2543: motor artık ilk miktarı kendisi yazıyor (initialQuantity + riskBasis). Varsa ona güven,
   // yoksa giriş journalinden kurtar. Ham satır reportingSource altında korunur.
   const engineInitialQty=num(row.initialQuantity);
   const engineBasisOk=typeof row.riskBasis==='string'&&!/QUANTITY_UNAVAILABLE|REMAINING_FALLBACK/.test(row.riskBasis);
   const entryQty=(engineInitialQty!==null&&engineInitialQty>0&&engineBasisOk)?engineInitialQty:num(r.executedQty),entry=num(row.entryPrice),stop=num(p.riskGate?.structuralStop?.stopPrice??p.plan?.stopPrice);
   row.reportingSource={entryJournalId:e.id,rawExitType:row.exitType,rawQuantity:row.quantity,rawRiskQuote:row.riskQuote};
   if(entryQty>0&&entry!==null&&stop!==null){
     row.quantity=entryQty;row.notional=entry!==null?entry*entryQty:null;
     row.riskQuote=entry!==null&&stop!==null?Math.abs(entry-stop)*entryQty:null;
     row.rMultiple=num(row.netPnl)!==null&&row.riskQuote>0?Number(row.netPnl)/row.riskQuote:null;
     row.outcomePct=num(row.netPnl)!==null&&row.notional>0?Number(row.netPnl)/row.notional*100:null;
     row.reportingSource.quantityRecovered=true;row.reportingSource.riskBasis='ORIGINAL_ENTRY_QUOTE_AND_STOP_NOT_FILL_VWAP';
   }
   const next=entries.filter(x=>x.symbol===row.symbol&&Number(x.ts)>Number(e.ts)).sort((a,b)=>a.ts-b.ts)[0];
   const upper=Math.min(end,next?Number(next.ts)-1:end);
   const lineage=exits.filter(x=>x.symbol===row.symbol&&x.payload.result.side===row.side&&Number(x.ts)>=Number(e.ts)&&Number(x.ts)<=upper);
   const full=lineage.filter(x=>x.payload.action==='EXIT_NOW'&&x.payload.result.fullyClosed===true&&x.payload.result.reduceOnly===true).at(-1);
   const partial=lineage.filter(x=>x.payload.action==='PARTIAL_TAKE_PROFIT');
   if(full){row.exitType='JEV_EXIT_NOW';row.reportingSource.exitJournalId=full.id;}
   if(partial.length){row.partialExitType='JEV_PARTIAL_TAKE_PROFIT';row.reportingSource.partialExitJournalIds=partial.map(x=>x.id);}
   return row;
 });
}
function laneOf(x={}){const raw=x.tradeLaneName||x.lane||x.entryContext?.lane||x.tradeLane?.name||x.tradeLane||x.jevLaneFocus;return ({SCALP_MOMENTUM:'5M_SCALP',MAIN_15M:'15M_TRADE'})[raw]||(['5M_SCALP','15M_TRADE'].includes(raw)?raw:'UNSPECIFIED');}
function summary(rows,open=[]){
 const xs=rows.filter(x=>num(x.netPnl)!==null), rs=xs.map(x=>num(x.rMultiple)).filter(x=>x!==null).sort((a,b)=>a-b);
 const wins=xs.filter(x=>num(x.netPnl)>0).length,losses=xs.filter(x=>num(x.netPnl)<0).length;
 return {closed:xs.length,wins,losses,flats:xs.length-wins-losses,winRatePct:xs.length?100*wins/xs.length:null,netPnl:xs.reduce((s,x)=>s+num(x.netPnl),0),rSamples:rs.length,avgR:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null,medianR:rs.length?(rs[Math.floor((rs.length-1)/2)]+rs[Math.floor(rs.length/2)])/2:null,open:open.length,openPnl:open.reduce((s,x)=>s+(num(x.unrealizedPnl)||0),0)};
}
function decisions(events){
 const a=events.filter(x=>x.kind==='ANALYSIS'&&!x.analysisSkipped), final=a.filter(x=>x.jevCalled), unique=stage=>new Set(events.filter(x=>x.stage===stage).map(x=>x.decisionId||x.id)).size;
 const distribution=(xs,key)=>xs.reduce((out,x)=>{const k=x[key]||'UNSPECIFIED';out[k]=(out[k]||0)+1;return out;},{});
 const approved=unique('APPROVED'), safetyPassed=unique('HARD_SAFETY_READY'),orders=unique('ORDER_PLACED');
 const blocked=events.filter(x=>x.stage==='HARD_BLOCK'||x.kind==='TICK_RESULT'&&x.execution==='LEADER_AUTO_BLOCKED');
 const reasons={}; const seen=new Set();for(const e of blocked)for(const reason of e.reasons||[e.reason||'UNSPECIFIED']){const key=(e.decisionId||e.id)+':'+reason;if(!seen.has(key)){seen.add(key);reasons[reason]=(reasons[reason]||0)+1;}}
 const symbols=new Set(a.map(x=>x.symbol));
 return {analyses:a.length,pass1:a.filter(x=>x.jevPass1Called).length,pass2:final.length,long:final.filter(x=>x.jevFinalAction==='LONG').length,short:final.filter(x=>x.jevFinalAction==='SHORT').length,wait:final.filter(x=>x.jevFinalAction==='WAIT').length,marketNow:final.filter(x=>x.jevEntryTiming==='MARKET_NOW'&&x.jevFinalAction!=='WAIT').length,timing:distribution(final,'jevEntryTiming'),waitReasons:distribution(final.filter(x=>x.jevEntryTiming!=='MARKET_NOW'),'jevWaitReason'),approved,safetyPassed,orders,blockedReasons:reasons,decisionToSafetyPct:approved?100*safetyPassed/approved:null,safetyToOrderPct:safetyPassed?100*orders/safetyPassed:null,decisionToOrderPct:approved?100*orders/approved:null,uniqueCoverage:symbols.size,reanalysisRatePct:a.length?100*(a.length-symbols.size)/a.length:null,materialChanges:distribution(a,'materialChangeReason'),dedupeSkipped:events.filter(x=>x.kind==='DEDUPE').length};
}
function performanceReport(records=[],open=[],now=Date.now()){
 const events=records.filter(x=>x.kind==='R2542_OFFICE_EVENT').map(x=>({...x.payload,id:x.id,ts:x.ts}));
 const closed=records.filter(x=>x.kind==='POSITION_CLOSED').map(x=>({...x.payload,id:x.id,ts:x.ts,symbol:x.symbol}));
 const version=x=>x.releaseContract||x.entryContext?.releaseContract||'LEGACY';
 const {trades,excluded}=reconcileCloses(enrichCloses(closed,records));
 const versions=[...new Set([RELEASE,...trades.map(version),...events.map(version)])];
 const make=(name,ev,ts,os,complete)=>({name,telemetryAvailable:complete,...decisions(ev),...summary(ts,os)});
 const recentEvents=events.filter(x=>x.ts>=now-3600000),recentTrades=trades.filter(x=>Date.parse(x.closedAt||'')>=now-3600000);
 return {source:'SQLITE_JOURNAL_ALL_ROWS',generatedAt:now,reconciliation:{rawClosedRows:closed.length,canonicalClosedRows:trades.length,excluded},historyNote:'Karar telemetrisi bu güncellemeden itibaren kalıcıdır; eski eksik olaylar yeniden üretilmez.',funnel:decisions(recentEvents),total:summary(trades,open),versions:versions.map(v=>({version:v,...summary(trades.filter(x=>version(x)===v),open.filter(x=>version(x)===v))})),desks:['5M_SCALP','15M_TRADE','UNSPECIFIED'].map(desk=>({desk,recent:make('Son 60 dk',recentEvents.filter(x=>laneOf(x)===desk),recentTrades.filter(x=>laneOf(x)===desk),open.filter(x=>laneOf(x)===desk),true),cohorts:versions.map(v=>({...make(v,events.filter(x=>version(x)===v&&laneOf(x)===desk),trades.filter(x=>version(x)===v&&laneOf(x)===desk),open.filter(x=>version(x)===v&&laneOf(x)===desk),v===RELEASE),version:v}))}))};
}
module.exports={enrichCloses,RELEASE,laneOf,summary,decisions,performanceReport,sameEntry,reconcileCloses};
