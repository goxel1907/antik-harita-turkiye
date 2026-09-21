'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  parseWorkerDecision,deterministicGuard,buildWorkerPrompt,combineWorkerReviews
}=require('../plan-workers');

function unified(){
  return {
    dataQuality:{advisoryUsable:true},
    livePrice:100,
    frames:{
      '1m':{available:true,fresh:true,close:100,trend:'DOWN',opportunity:{state:'ACTIVE',preferredSide:'SHORT',longScore:10,shortScore:70,originEligible:true,ownerEligible:true},breakoutExecution:{status:'CONFIRMED',allowed:true}},
      '5m':{available:true,fresh:true,close:101,trend:'DOWN',opportunity:{state:'ACTIVE',preferredSide:'SHORT',longScore:20,shortScore:65,originEligible:true,ownerEligible:true},breakoutExecution:{status:'CONFIRMED',allowed:true}},
      '3m':{available:true,fresh:true},'15m':{available:true,fresh:true}
    },
    opportunityPaths:{SHORT:{continuity:[{frame:'1m',score:70,immediateEligible:true},{frame:'5m',score:65,immediateEligible:true}]}},
    microstructure:{available:true,spreadBps:2,sourceQuality:'REST_SNAPSHOT_APPROX'}
  };
}
function tracked(){
  return {
    symbol:'AAAUSDT',side:'SHORT',state:'WATCH',planStatus:'WATCH',
    originTF:'1m',ownerTF:'5m',setup:'breakout',waitFor:'1m kapanis 99.5 altinda',
    why:'short structure',riskNote:'reclaim',confidence:72,lastAnalyzedAt:1_000_000,reanalysisEligible:true
  };
}
function candidate(){return {symbol:'AAAUSDT',side:'SHORT',spreadBps:2,attackRank:4,projectedRank:2,rankVelocity:3,rankAcceleration:1,movementPotential:70,expansionScore:68,tradeQuality:80,directionSupport:3,oiDeltaPct:0.3,volumeAcceleration:0.4,rangeExpansion:0.2,takerBuyRatio:0.4};}

test('worker parser accepts only WAIT/TRIGGERED/REFRESH_REQUIRED schema',()=>{
  const x=parseWorkerDecision('WORKER_STATE: TRIGGERED\nCONFIDENCE: 84\nREASON: 1m kapanis kosulu olustu\nRECHECK_TFS: 1m,5m');
  assert.equal(x.ok,true);
  assert.equal(x.state,'TRIGGERED');
  assert.deepEqual(x.recheckTFs,['1m','5m']);
  const bad=parseWorkerDecision('STATUS: QUALIFIED\nCONFIDENCE: 99\nREASON: trade\nRECHECK_TFS: 1m');
  assert.equal(bad.ok,false);
  assert.equal(bad.state,'REFRESH_REQUIRED');
});

test('deterministic worker forces full refresh on side change and waits on wide spread',()=>{
  const side=deterministicGuard({tracked:tracked(),candidate:{...candidate(),side:'LONG'},unified:unified(),now:1_100_000});
  assert.equal(side.state,'REFRESH_REQUIRED');
  assert.equal(side.reason,'WORKER_SCANNER_SIDE_CHANGED');

  const spread=deterministicGuard({tracked:tracked(),candidate:{...candidate(),spreadBps:10},unified:unified(),now:1_100_000});
  assert.equal(spread.state,'WAIT');
  assert.equal(spread.reason,'WORKER_SPREAD_ABOVE_8_BPS');
});

test('worker prompt cannot qualify or place an order',()=>{
  const p=buildWorkerPrompt({tracked:tracked(),candidate:candidate(),unified:unified()});
  assert.match(p,/worker QUALIFIED veremez/i);
  assert.match(p,/emir veremez/i);
  assert.match(p,/full9TfRequiredAfterTrigger/);
});

test('9Router WAIT avoids Vision and trigger disagreement escalates to full 9TF',()=>{
  const det={state:'REVIEW'};
  const wait=combineWorkerReviews({
    deterministic:det,
    router:{ok:true,state:'WAIT',confidence:80,reason:'kosul yok',recheckTFs:['1m']}
  });
  assert.equal(wait.state,'WAIT');
  assert.equal(wait.source,'9ROUTER');

  const disagree=combineWorkerReviews({
    deterministic:det,
    router:{ok:true,state:'TRIGGERED',confidence:82,reason:'tetik',recheckTFs:['1m']},
    openRouter:{ok:true,state:'WAIT',confidence:70,reason:'erken',recheckTFs:['1m','5m']}
  });
  assert.equal(disagree.state,'REFRESH_REQUIRED');
  assert.equal(disagree.source,'WORKER_DISAGREEMENT');
});
