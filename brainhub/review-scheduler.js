'use strict';
// Urgent protection reviews have priority over new analysis, without overlapping
// the shared pipeline. Busy attempts do not consume the request.
function createReviewScheduler({clock=()=>Date.now(),normalIntervalMs=60000,retryMs=5000}={}){
  let busy=false,lastNormal=null,lastUrgent=null;
  return {async tick({pending=false,backgroundReady=false,review}){
    const now=clock();
    if(busy)return {ok:true,skipped:true,reason:'POSITION_REVIEW_SCHEDULER_BUSY'};
    if(pending){if(lastUrgent!==null&&now-lastUrgent<retryMs)return {ok:true,skipped:true,reason:'URGENT_REVIEW_RETRY_CADENCE'};lastUrgent=now;}
    else{if(!backgroundReady||lastNormal!==null&&now-lastNormal<normalIntervalMs)return {ok:true,skipped:true,reason:'POSITION_REVIEW_BACKGROUND_CADENCE'};lastNormal=now;}
    busy=true;try{return await review({urgentOnly:pending});}finally{busy=false;}
  }};
}
module.exports={createReviewScheduler};
