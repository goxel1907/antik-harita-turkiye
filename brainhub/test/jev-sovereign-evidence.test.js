'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {buildMarketMakerEvidence}=require('../market-maker-evidence');
const {buildUnifiedContext}=require('../pipeline');
const {compactDecisionRecord}=require('../jev-decision');

test('market-maker footprint stays evidence-only and never claims participant identity',()=>{
  const streaming={
    available:true,asOf:123,spreadBps:1.2,depth20Imbalance:0.32,cvdQuote120s:-50000,
    orderFlow:{windows:{'30s':{trades:20,buyQuote:10000,sellQuote:60000,deltaQuote:-50000,buyRatio:0.1429,sellRatio:0.8571,priceMoveBps:-1.2,largeBuyCount:1,largeSellCount:4}}},
    depthDynamics:{available:true,bidWalls:[{price:100,quote:120000,persistence:0.8}],askWalls:[],possibleLiquidityPulls:[],replenishment:[{side:'BID',price:100,confidence:0.8}],absorption:{available:true,type:'SELL_AGGRESSION_ABSORBED_AT_BID',confidence:0.82}},
    observedLiquidations:{available:true,count:4,longLiquidatedQuote:90000,shortLiquidatedQuote:0,zones:[],cascade:{available:true,type:'LONG_LIQUIDATION_CASCADE',confidence:0.8}}
  };
  const out=buildMarketMakerEvidence({streaming,derivatives:{available:true,openInterest:{delta5mPct:1.2}},microstructure:{sourceQuality:'STREAMING_PARTIAL_BOOK'}});
  assert.equal(out.authority,'EVIDENCE_ONLY');
  assert.equal(out.canQualify,false);
  assert.equal(out.canExecute,false);
  assert.equal(out.participantIdentity,'NOT_IDENTIFIED');
  assert.equal(out.bookBehavior.absorption.type,'SELL_AGGRESSION_ABSORBED_AT_BID');
  assert.match(out.interpretationRules.join(' '),/not participant identity/i);
});

test('unified/JEV record carries market microstructure evidence without authority escalation',()=>{
  const now=Date.now();
  const frame={available:true,asOf:now,close:100,trend:'UP',rsi14:55,atrPct:1,breakOfStructure:null,prior20High:102,prior20Low:98,returnPct:0.4,candle:{},patterns:[],swingStructure:{state:'BULLISH'},smcContext:{},orderBlocks:{},buySideLiquidity:102,sellSideLiquidity:98,recentFairValueGaps:[],liquidity:{},opportunity:{available:true,state:'ACTIVE',preferredSide:'LONG',longScore:70,shortScore:20}};
  const symbol={symbol:'BTCUSDT',timeframes:Object.fromEntries(['1m','3m','5m','15m','30m','45m','1h','4h','1d'].map(tf=>[tf,frame])),microstructure:{available:true,sourceQuality:'STREAMING_PARTIAL_BOOK',bid:99.99,ask:100.01,streaming:{available:true,asOf:now,orderFlow:{windows:{}},depthDynamics:{available:false},observedLiquidations:{available:false}}},derivatives:{available:true,openInterest:{delta5mPct:0.5}}};
  const unified=buildUnifiedContext({symbol,global:{},candidate:{symbol:'BTCUSDT',side:'LONG'},now});
  assert.equal(unified.authority.finalStrategicAuthority,'JEV');
  assert.equal(unified.authority.workerAuthority,'EVIDENCE_ONLY');
  assert.equal(unified.sourceCandidate.authority,'ATTENTION_ONLY');
  assert.equal(unified.marketMakerEvidence.authority,'EVIDENCE_ONLY');
  const rec=JSON.parse(compactDecisionRecord({candidate:{symbol:'BTCUSDT',side:'LONG'},plan:{status:'QUALIFIED',side:'LONG',timeframeDiagnostics:{}},unified},64000));
  assert.equal(rec.marketMakerEvidence.authority,'EVIDENCE_ONLY');
  assert.equal(rec.authority.finalStrategicAuthority,'JEV');
  assert.equal(rec.visualPolicy.numericAuthority,'BINANCE_BRAINHUB');
});
