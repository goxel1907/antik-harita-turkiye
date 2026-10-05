'use strict';
// Urgent protection reviews have priority over new analysis, without overlapping
// the shared pipeline. Busy attempts do not consume the request.
// R42: an urgent review that ran but did not reach a valid JEV decision (request
// blocked, provider error, credits exhausted) used to retry every 5 s with a fresh
// paid PASS-1 call (live 05.10: ~980 reviews / 2 JEV decisions on one position).
// Such failures now back off 5 -> 10 -> 20 -> 40 -> 60 s; a valid JEV decision or a
// cleared request resets the cadence. The request itself stays pending.
function urgentReviewReachedJev(out){return out?.jev?.called===true&&out?.jev?.ok===true;}
function createReviewScheduler({clock=()=>Date.now(),normalIntervalMs=60000,retryMs=5000,maxRetryMs=60000}={}){
  let busy=false,lastNormal=null,lastUrgent=null,urgentFailures=0;
  const urgentWaitMs=()=>Math.min(maxRetryMs,retryMs*2**Math.max(0,Math.min(urgentFailures,16)-1));
  return {async tick({pending=false,backgroundReady=false,review}){
    const now=clock();
    if(busy)return {ok:true,skipped:true,reason:'POSITION_REVIEW_SCHEDULER_BUSY'};
    if(pending){const wait=urgentWaitMs();if(lastUrgent!==null&&now-lastUrgent<wait)return {ok:true,skipped:true,reason:'URGENT_REVIEW_RETRY_CADENCE',retryInMs:wait-(now-lastUrgent),urgentFailures};lastUrgent=now;}
    else{urgentFailures=0;if(!backgroundReady||lastNormal!==null&&now-lastNormal<normalIntervalMs)return {ok:true,skipped:true,reason:'POSITION_REVIEW_BACKGROUND_CADENCE'};lastNormal=now;}
    busy=true;
    try{
      const out=await review({urgentOnly:pending});
      if(pending&&out?.skipped!==true){
        if(out?.ok===true&&out?.urgentReview===true&&urgentReviewReachedJev(out))urgentFailures=0;
        else urgentFailures+=1;
      }
      return out;
    }finally{busy=false;}
  },
  state(){return {busy,urgentFailures,nextUrgentRetryMs:urgentWaitMs()};}};
}
module.exports={createReviewScheduler,urgentReviewReachedJev};
