'use strict';
const rows=v=>Array.isArray(v)?v:[];
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const sym=c=>String(c?.symbol||'').trim().toUpperCase();
const rank=c=>num(c?.gainerRank||c?.attackRank)||999;
const velocity=c=>num(c?.gainerRankVelocity??c?.rankVelocity);

function uniquePool(items){
 const seen=new Set(),out=[];
 for(const c of rows(items)){
  const s=sym(c); if(!s||seen.has(s))continue; seen.add(s); out.push(c);
 }
 return out;
}
function velocitySort(a,b){
 return velocity(b)-velocity(a) || num(a?.projectedGainerRank??a?.projectedRank)-num(b?.projectedGainerRank??b?.projectedRank) || rank(a)-rank(b);
}
function selectDeterministicCandidates(scan,limit=24){
 // R2544.16: discovery-first ordering. Top3 is intentionally LAST: by the time a coin is
 // already Top3, much of the move may be extended. Each earlier tier gets a reserved floor
 // so coverage cannot be starved by current leaders.
 const leaders=rows(scan?.leaders);
 const approach=uniquePool([
  ...rows(scan?.ladderApproach), ...rows(scan?.top10Approach), ...rows(scan?.top3Approach),
  ...leaders.filter(c=>['TOP10_APPROACH','TOP3_APPROACH'].includes(String(c?.leaderState||'')))
 ]).filter(c=>rank(c)>10 || velocity(c)>0).sort(velocitySort);
 const top4to10=uniquePool(rows(scan?.ladderTop10).length?scan.ladderTop10:leaders.filter(c=>rank(c)>=4&&rank(c)<=10)).sort((a,b)=>rank(a)-rank(b)||velocitySort(a,b));
 const top11to24=uniquePool(rows(scan?.ladderTop24).length?scan.ladderTop24:leaders.filter(c=>rank(c)>=11&&rank(c)<=24)).sort(velocitySort);
 const early=uniquePool([
  ...rows(scan?.attentionCandidates), ...rows(scan?.earlyTop5), ...rows(scan?.earlyExpansion),
  ...rows(scan?.acceleratingCandidates), ...rows(scan?.accumulationCandidates)
 ]).sort(velocitySort);
 const near=uniquePool(rows(scan?.nearExplosionCandidates)).sort((a,b)=>
  num(b?.nearExplosionScore??b?.preMoveScore??b?.expansionScore)-num(a?.nearExplosionScore??a?.preMoveScore??a?.expansionScore) || velocitySort(a,b));
 const top3=uniquePool(rows(scan?.ladderTop3).length?scan.ladderTop3:leaders.filter(c=>rank(c)>=1&&rank(c)<=3)).sort((a,b)=>rank(a)-rank(b));
 const fallback=uniquePool(rows(scan?.gainerCandidates).concat(leaders));
 const pools=[
  {tier:'APPROACH',reason:'GAINER_APPROACH',rows:approach,cap:5,floor:2},
  {tier:'TOP4_10',reason:'GAINER_TOP10',rows:top4to10,cap:7,floor:2},
  {tier:'TOP11_24',reason:'GAINER_TOP24',rows:top11to24,cap:14,floor:2},
  {tier:'EARLY',reason:'APP_EARLY_ATTENTION',rows:early,cap:4,floor:2},
  {tier:'NEAR_EXPLOSION',reason:'NEAR_EXPLOSION',rows:near,cap:5,floor:2},
  {tier:'TOP3',reason:'GAINER_TOP3',rows:top3,cap:3,floor:Math.min(3,top3.length)},
  {tier:'COVERAGE',reason:'LIGHTWEIGHT_ACCELERATION',rows:fallback,cap:limit,floor:0}
 ];
 const seen=new Set(),out=[];
 const available=p=>new Set(p.rows.map(sym).filter(s=>s&&!seen.has(s))).size;
 const add=(c,p)=>{const s=sym(c);if(!s||seen.has(s)||out.length>=limit)return false;seen.add(s);out.push({...c,symbol:s,priorityTier:p.tier,deepScanReason:p.reason});return true;};
 if(limit<12)for(const p of pools.slice(0,6))p.floor=Math.min(1,p.floor);
 for(let i=0;i<pools.length;i++){
  const p=pools[i];
  const reserve=pools.slice(i+1,6).reduce((acc,q)=>acc+Math.min(q.floor,q.cap,available(q)),0);
  const allowed=Math.max(0,Math.min(p.cap,limit-out.length-reserve));
  let n=0;for(const c of p.rows){if(n>=allowed||out.length>=limit)break;if(add(c,p))n++;}
 }
 return out;
}
function pickPriorityCandidate(candidates,history={},cursor=0){
 if(!candidates?.length)return {candidate:null,index:-1,reason:'NO_CANDIDATE'};
 // One deterministic fairness cycle; every discovery tier gets a turn before Top3 repeats.
 const schedule=['APPROACH','TOP4_10','TOP11_24','EARLY','NEAR_EXPLOSION','TOP3','COVERAGE'];
 const slot=schedule[cursor%schedule.length];
 let pool=candidates.map((candidate,index)=>({candidate,index,last:num(history[candidate.symbol]?.lastAnalyzedAt)}));
 const preferred=pool.filter(x=>x.candidate.priorityTier===slot);
 if(preferred.length)pool=preferred;
 // Least-recently analyzed wins inside the tier: prevents a hot symbol from monopolizing JEV calls.
 pool.sort((a,b)=>a.last-b.last||a.index-b.index);
 return {...pool[0],reason:'R2544_16_'+slot};
}
// R40: a cheap worker check is not a completed deep analysis. Failed attempts
// still receive a retry cooldown, shared by primary and fast attention lanes.
function attentionAt(symbol,history={},attempts=new Map(),seen=new Map()){
 return Math.max(num(history[symbol]?.lastAnalyzedAt),num(attempts.get(symbol)),num(seen.get('JEVATTN|'+symbol)));
}
function freshAttention(candidates,{history={},attempts=new Map(),seen=new Map(),now=Date.now(),cooldownMs=60000}={}){
 return rows(candidates).map((candidate,index)=>({candidate,index,last:attentionAt(sym(candidate),history,attempts,seen)}))
  .filter(x=>!x.last||now-x.last>=cooldownMs).sort((a,b)=>a.last-b.last||a.index-b.index);
}
function pickFreshAttention(candidates,options,priorityTurn=true){
 const fresh=freshAttention(candidates,options);
 const chosen=(priorityTurn?[...fresh].sort((a,b)=>a.index-b.index):fresh)[0];
 return chosen?{...chosen,reason:priorityTurn?'PRIORITY_STALE_OR_NEW':'LEAST_RECENT_STALE_OR_NEW'}:
  {candidate:null,index:-1,reason:'ATTENTION_POOL_COOLDOWN'};
}
function coverageState(candidates,history={},attempts=new Map(),now=Date.now(),firstSeen=new Map()){
 const xs=uniquePool(candidates).map(c=>({symbol:sym(c),deep:num(history[sym(c)]?.lastAnalyzedAt),at:Math.max(num(history[sym(c)]?.lastAnalyzedAt),num(attempts.get(sym(c)))),since:num(firstSeen.get(sym(c)))}));
 const pending=xs.filter(x=>!x.at||now-x.at>=300000);
 const timed=pending.map(x=>x.at||x.since).filter(x=>x>0).map(x=>Math.max(0,now-x));
 return {targetCount:xs.length,staleCount:pending.length,neverAnalyzed:xs.filter(x=>!x.deep).length,neverAttempted:xs.filter(x=>!x.at).length,
  oldestStaleMs:timed.length?Math.max(...timed):0,semantics:'CURRENT_ATTENTION_POOL_ATTEMPTS_NOT_FULL_EXCHANGE'};
}
module.exports={selectDeterministicCandidates,pickPriorityCandidate,attentionAt,freshAttention,pickFreshAttention,coverageState};
