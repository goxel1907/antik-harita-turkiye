'use strict';
const rows=v=>Array.isArray(v)?v:[];
function selectDeterministicCandidates(scan,limit=24){
 const leaders=rows(scan?.leaders);
 const rank=c=>Number(c.attackRank)>0?Number(c.attackRank):999;
 const top=leaders.filter(c=>rank(c)<=3).sort((a,b)=>rank(a)-rank(b));
 const approach=rows(scan?.top3Approach).concat(leaders.filter(c=>c.leaderState==='TOP3_APPROACH'));
 const early=rows(scan?.acceleratingCandidates).concat(rows(scan?.accumulationCandidates),rows(scan?.attentionCandidates),rows(scan?.top10Approach),rows(scan?.earlyTop5),rows(scan?.earlyExpansion));
 const main=leaders.filter(c=>rank(c)>3).sort((a,b)=>rank(a)-rank(b)).concat(rows(scan?.gainerCandidates));
 const pools=[{rows:top,tier:'TOP3',reason:'CURRENT_ATTACK_TOP10'},{rows:approach,tier:'APPROACH',reason:'TOP3_APPROACH'},
  {rows:main,tier:'TOP24',reason:'BINANCE_TOP24_GAINER'},{rows:early,tier:'EARLY',reason:'EARLY_ATTENTION'}];
 const seen=new Set(),out=[];
 const add=(c,p)=>{if(!c?.symbol||seen.has(c.symbol)||out.length>=limit)return;seen.add(c.symbol);out.push({...c,priorityTier:p.tier,deepScanReason:p.reason});};
 top.forEach(c=>add(c,pools[0]));
 approach.slice(0,4).forEach(c=>add(c,pools[1]));
 // Reserve early-discovery capacity instead of filling every slot with the Top24 pool first.
 early.slice(0,4).forEach(c=>add(c,pools[3]));
 for(let i=0;i<Math.max(main.length,approach.length,early.length)&&out.length<limit;i++)for(const p of [pools[2],pools[1],pools[3]])if(p.rows[i])add(p.rows[i],p);
 return out.sort((a,b)=>({TOP3:0,APPROACH:1,TOP24:2,EARLY:3}[a.priorityTier]-{TOP3:0,APPROACH:1,TOP24:2,EARLY:3}[b.priorityTier]));
}
function pickPriorityCandidate(candidates,history={},cursor=0){
 if(!candidates?.length)return {candidate:null,index:-1,reason:'NO_CANDIDATE'};
 // Priority slots alternate with whole-pool coverage; Top24/early symbols cannot starve.
 const slot=['TOP3','APPROACH','TOP3','COVERAGE'][cursor%4];
 let pool=candidates.map((candidate,index)=>({candidate,index,last:Number(history[candidate.symbol]?.lastAnalyzedAt||0)}));
 const preferred=pool.filter(x=>x.candidate.priorityTier===slot);
 if(slot!=='COVERAGE'&&preferred.length)pool=preferred;
 pool.sort((a,b)=>a.last-b.last||a.index-b.index);
 return {...pool[0],reason:'DETERMINISTIC_'+slot};
}
module.exports={selectDeterministicCandidates,pickPriorityCandidate};
