'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {selectCandidates,TARGET_DETAIL_LIMIT}=require('../scanner');
const {selectDeepCandidates}=require('../leader-committee');

function row(i,change=0){
  const symbol='C'+String(i).padStart(3,'0')+'USDT';
  return {
    symbol,
    quoteVolume:1_000_000_000-i*1_000_000,
    priceChangePercent:change,
    lastPrice:1+i/100,
    range24hPct:6,
    volumeRank:i
  };
}

test('priority target universe caps per-symbol detail work at 24 and preserves bucket order',()=>{
  const universe=[];
  for(let i=1;i<=80;i++) universe.push(row(i, i<=30 ? 31-i : (i%9)-4));
  const prev={bySymbol:{}};
  for(let i=1;i<=10;i++) prev.bySymbol[row(i).symbol]={rank:i,rankVelocity:0,leaderHunterScore:50-i};

  const attention={
    available:true,updatedAt:Date.now(),ageMs:1000,
    rows:[
      {symbol:row(70).symbol,talkScore:90,earlyMoveScore:95,sourceConfidence:80,preMoveState:'ERKEN',direction:'YUKARI_İLGİ'},
      {symbol:row(71).symbol,talkScore:88,earlyMoveScore:92,sourceConfidence:75,preMoveState:'ERKEN',direction:'YUKARI_İLGİ'}
    ]
  };

  const out=selectCandidates(universe,prev,attention,TARGET_DETAIL_LIMIT);
  assert.equal(out.candidates.length,24);
  assert.deepEqual(out.candidates.slice(0,3).map(x=>x.symbol),[row(1).symbol,row(2).symbol,row(3).symbol]);
  assert.deepEqual(out.candidates.slice(3,10).map(x=>x.symbol),[row(4).symbol,row(5).symbol,row(6).symbol,row(7).symbol,row(8).symbol,row(9).symbol,row(10).symbol]);
  assert.ok(out.top24Gainers.length<=24);
  assert.ok(out.candidates.some(x=>x.targetSources.includes('BINANCE_TOP24_GAINER')));
  assert.ok(out.candidates.some(x=>x.targetSources.includes('ACCUMULATION_PROXY')));
  assert.ok(out.candidates.some(x=>x.targetSources.includes('APP_EARLY_ATTENTION')));
});

test('deep 9TF priority is top3, ranks4-10, gainers, accumulation, then app attention',()=>{
  const base=(symbol,rank)=>({
    symbol,side:'LONG',attackRank:rank,projectedRank:rank,leaderState:'WATCH',
    tradeQuality:80,spreadBps:1,directionSupport:2,longExpansionScore:60,shortExpansionScore:10,
    expansionScore:60,leaderHunterScore:100-rank,movementPotential:70
  });
  const scan={
    leaders:[
      base('TOP1USDT',1),
      base('TOP2USDT',2),
      base('TOP4USDT',4),
      base('TOP7USDT',7)
    ],
    gainerCandidates:[base('GAINUSDT',14)],
    accumulationCandidates:[base('ACCUSDT',15)],
    attentionCandidates:[base('ATTNUSDT',16)],
    top3Approach:[],top10Approach:[],earlyTop5:[],earlyExpansion:[]
  };
  const out=selectDeepCandidates(scan,16);
  assert.deepEqual(
    out.map(x=>[x.symbol,x.deepScanReason]),
    [
      ['TOP1USDT','CURRENT_ATTACK_TOP10'],
      ['TOP2USDT','CURRENT_ATTACK_TOP10'],
      ['TOP4USDT','CURRENT_ATTACK_TOP10'],
      ['TOP7USDT','CURRENT_ATTACK_TOP10'],
      ['GAINUSDT','BINANCE_TOP24_GAINER'],
      ['ACCUSDT','ACCUMULATION_BREAKOUT_PROXY'],
      ['ATTNUSDT','APP_EARLY_ATTENTION']
    ]
  );
});
