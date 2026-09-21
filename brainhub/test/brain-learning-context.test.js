'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {compactOutcomeLearningContext}=require('../pipeline');
const {openStore}=require('../store');

test('Brain Learning excludes unlabeled PLAN/WATCH history from local decision context',()=>{
  const out=compactOutcomeLearningContext({
    recent:[
      {symbol:'AAAUSDT',side:'LONG',setup:'A',originTF:'1m',ownerTF:'5m',decision:'WATCH',outcomePct:null},
      {symbol:'BBBUSDT',side:'SHORT',setup:'B',originTF:'3m',ownerTF:'15m',decision:'QUALIFIED'}
    ],
    stats:[]
  });
  assert.equal(out.available,false);
  assert.equal(out.outcomeSamples,0);
  assert.deepEqual(out.recentOutcomes,[]);
  assert.deepEqual(out.stats,[]);
  assert.equal(out.semantics,'OUTCOME_BACKED_SOFT_CONTEXT_ONLY');
});

test('Brain Learning passes only measured closed outcomes and aggregated outcome stats',()=>{
  const out=compactOutcomeLearningContext({
    recent:[
      {symbol:'AAAUSDT',side:'LONG',setup:'BREAK_RETEST',originTF:'1m',ownerTF:'5m',decision:'CLOSED',outcomePct:2.34567},
      {symbol:'CCCUSDT',side:'LONG',setup:'UNLABELED',originTF:'1m',ownerTF:'5m',decision:'WATCH',outcomePct:null}
    ],
    stats:[
      {side:'LONG',setup:'BREAK_RETEST',originTF:'1m',ownerTF:'5m',samples:4,wins:3,winRate:75,avgOutcomePct:1.23456},
      {side:'SHORT',setup:'EMPTY',originTF:'3m',ownerTF:'15m',samples:0,winRate:null,avgOutcomePct:null}
    ]
  });
  assert.equal(out.available,true);
  assert.equal(out.outcomeSamples,4);
  assert.equal(out.recentOutcomes.length,1);
  assert.equal(out.recentOutcomes[0].symbol,'AAAUSDT');
  assert.equal(out.recentOutcomes[0].outcomePct,2.3457);
  assert.equal(out.stats.length,1);
  assert.equal(out.stats[0].samples,4);
  assert.equal(out.stats[0].winRate,75);
  assert.equal(out.stats[0].avgOutcomePct,1.2346);
});

test('Brain Learning context never exposes hard-risk mutation flags',()=>{
  const out=compactOutcomeLearningContext({
    recent:[{symbol:'AAAUSDT',side:'LONG',decision:'CLOSED',outcomePct:-1}],
    stats:[{side:'LONG',setup:'X',originTF:'1m',ownerTF:'5m',samples:1,winRate:0,avgOutcomePct:-1}],
    changesAppliedToHardRisk:true
  });
  assert.equal(Object.prototype.hasOwnProperty.call(out,'changesAppliedToHardRisk'),false);
  assert.match(out.note,/hard risk/i);
});


test('recordLearning keeps null outcome as unknown instead of 0 percent',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'brainhub-learning-null-'));
  let store=null;
  try{
    store=openStore(root);
    store.recordLearning('POSITION_CLOSED','AAAUSDT',{
      side:'LONG',setup:'X',originTF:'1m',ownerTF:'5m',decision:'CLOSED',outcomePct:null
    });
    const ctx=store.learningContext({symbol:'AAAUSDT'});
    assert.equal(ctx.recent.length,1);
    assert.equal(ctx.recent[0].outcomePct,null);
    assert.equal(ctx.stats.length,0);
    const compact=compactOutcomeLearningContext(ctx);
    assert.equal(compact.available,false);
    assert.equal(compact.outcomeSamples,0);
  }finally{
    try{ store?.db?.close?.(); }catch{}
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
