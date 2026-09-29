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

// CLAUDE_R2544_15_SLOT_POLICY: öncelik Binance yükselenler merdiveni (ilk 3 → erken teşhis → erken ilgi → 4–10 → 11–24).
test('R2544.15: ayrıntılı inceleme 30 coin; merdivenin ilk 24ü, erken teşhis ve erken ilgi önce gelir',()=>{
  const now=Date.now();
  const universe=[];
  for(let i=1;i<=80;i++) universe.push(row(i, i<=30 ? 31-i : (i%9)-4));
  // C040: 5 dk önce merdivende 30. sıradaydı, şimdi 12. → ilk 3 adayı (erken teşhis)
  universe[39].priceChangePercent=19.5;
  const prev={ts:now-60000,bySymbol:{},lightweight:{},ladder:{[row(40).symbol]:{h:[[now-5*60000,30]]}}};
  const attention={available:true,updatedAt:now,ageMs:1000,rows:[
    {symbol:row(70).symbol,talkScore:90,earlyMoveScore:95,sourceConfidence:80,preMoveState:'ERKEN',direction:'YUKARI'},
    {symbol:row(71).symbol,talkScore:88,earlyMoveScore:92,sourceConfidence:75,preMoveState:'ERKEN',direction:'YUKARI'}]};
  assert.equal(TARGET_DETAIL_LIMIT,30);
  const out=selectCandidates(universe,prev,attention,TARGET_DETAIL_LIMIT);
  assert.equal(out.candidates.length,30);
  const src=s=>out.candidates.find(x=>x.symbol===s)?.targetSources||[];
  assert.deepEqual(out.candidates.slice(0,3).map(x=>x.symbol),[row(1).symbol,row(2).symbol,row(3).symbol],'ilk 3 önce');
  assert.ok(src(row(40).symbol).includes('GAINER_APPROACH'),'tırmanan coin erken teşhiste');
  const c40=out.candidates.find(x=>x.symbol===row(40).symbol);
  assert.equal(c40.approach,'TOP3_CANDIDATE','30→12 sıra/5 dk: 5 dk içinde ilk 3 bekleniyor');assert.equal(c40.gainerRank,12);assert.ok(c40.gainerRankVelocity>=3);
  assert.ok(src(row(70).symbol).includes('APP_EARLY_ATTENTION')&&src(row(71).symbol).includes('APP_EARLY_ATTENTION'),'erken ilgi ayrılmış slotta');
  for(let i=4;i<=10;i++)assert.ok(out.candidates.some(x=>x.gainerRank===i),'4–10 tamamı: '+i);
  for(let i=11;i<=24;i++)assert.ok(out.candidates.some(x=>x.gainerRank===i),'11–24 tamamı: '+i);
  assert.ok(out.candidates.filter(x=>x.gainerRank&&x.gainerRank<=24).every(x=>x.targetSources.includes('BINANCE_TOP24_GAINER')));
  assert.ok(out.ladder.nextLadder[row(1).symbol].h.length>=1,'sıra geçmişi saklanır');
});

test('R2544.15: JEV sırası merdiveni izler: ilk 3 → erken teşhis → erken ilgi → 4–10 → 11–24 → eski havuzlar',()=>{
  const base=(symbol,rank,extra={})=>({symbol,side:'LONG',attackRank:rank,projectedRank:rank,leaderState:'WATCH',tradeQuality:80,spreadBps:1,
    directionSupport:2,longExpansionScore:60,shortExpansionScore:10,expansionScore:60,leaderHunterScore:100-rank,movementPotential:70,...extra});
  const scan={
    ladderTop3:[base('G1USDT',9,{gainerRank:1})],ladderApproach:[base('APPUSDT',8,{gainerRank:14,ladderApproach:'TOP3_CANDIDATE'})],
    attentionCandidates:[base('ATTNUSDT',16)],ladderTop10:[base('G5USDT',3,{gainerRank:5})],ladderTop24:[base('G15USDT',2,{gainerRank:15})],
    leaders:[base('ATK1USDT',1)],acceleratingCandidates:[base('FASTUSDT',13)],top3Approach:[],top10Approach:[],earlyTop5:[],earlyExpansion:[]
  };
  const out=selectDeepCandidates(scan,24);
  assert.deepEqual(out.map(x=>[x.symbol,x.deepScanReason]),[
    ['G1USDT','GAINER_TOP3'],['APPUSDT','GAINER_APPROACH'],['ATTNUSDT','APP_EARLY_ATTENTION'],['G5USDT','GAINER_TOP10'],['G15USDT','GAINER_TOP24'],
    ['ATK1USDT','CURRENT_ATTACK_TOP10'],['FASTUSDT','LIGHTWEIGHT_ACCELERATION']]);
});
