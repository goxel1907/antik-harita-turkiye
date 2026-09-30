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

// CLAUDE_R2544_16_SLOT_POLICY (kullanıcı kararı 29.09 akşam): ilk 10'a aday → 4–10 → 11–24 → erken ilgi →
// patlamaya yakın (LONG/SHORT) → ilk 3 EN SON. Her katman temsil edilir.
test('R2544.16: ayrıntılı inceleme 36 coin; sıra ilk 10 adayı → 4–10 → 11–24 → erken ilgi → patlamaya yakın → ilk 3',()=>{
  const now=Date.now();
  const universe=[];
  for(let i=1;i<=80;i++) universe.push(row(i, i<=30 ? 31-i : (i%9)-4));
  // C040: 5 dk önce merdivende 30. sıradaydı, şimdi 12. → ilk 10'a (hatta ilk 3'e) aday
  universe[39].priceChangePercent=19.5;
  // C060: son 2 dakikada −%3 (merdiven dışı, SHORT yönde patlamaya yakın)
  const prevLight={[row(60).symbol]:{at:now-2*60000,lastPrice:row(60).lastPrice*1.03}};
  const prev={ts:now-60000,bySymbol:{},lightweight:prevLight,ladder:{[row(40).symbol]:{h:[[now-5*60000,30]]}}};
  const attention={available:true,updatedAt:now,ageMs:1000,rows:[
    {symbol:row(70).symbol,talkScore:90,earlyMoveScore:95,sourceConfidence:80,preMoveState:'ERKEN',direction:'YUKARI'},
    {symbol:row(71).symbol,talkScore:88,earlyMoveScore:92,sourceConfidence:75,preMoveState:'ERKEN',direction:'YUKARI'}]};
  assert.equal(TARGET_DETAIL_LIMIT,36);
  const out=selectCandidates(universe,prev,attention,TARGET_DETAIL_LIMIT);
  assert.equal(out.candidates.length,36);
  const idx=s=>out.candidates.findIndex(x=>x.symbol===s);
  const src=s=>out.candidates.find(x=>x.symbol===s)?.targetSources||[];
  assert.equal(out.candidates[0].symbol,row(40).symbol,'ilk 10 adayı en önde');
  assert.equal(out.candidates[0].targetSources[0],'GAINER_APPROACH');
  assert.deepEqual(out.candidates.slice(1,8).map(x=>x.gainerRank),[4,5,6,7,8,9,10],'sonra 4–10');
  for(let i=11;i<=24;i++)if(i!==12)assert.ok(idx('C'+String(31-i).padStart(3,'0')+'USDT')>=0||out.candidates.some(x=>x.gainerRank===i),'11–24: '+i);
  assert.ok(idx(row(70).symbol)>idx(out.candidates.find(x=>x.gainerRank===24).symbol),'erken ilgi 11–24 sonrasında');
  assert.ok(src(row(60).symbol).includes('NEAR_EXPLOSION'),'sert düşen coin patlamaya yakın havuzunda');
  const c60=out.candidates.find(x=>x.symbol===row(60).symbol);
  assert.equal(c60.nearExplosion.direction,'SHORT');assert.equal(c60.nearExplosion.source,'SURGE_DOWN');
  assert.ok(idx(row(60).symbol)>idx(row(71).symbol),'patlamaya yakın erken ilgiden sonra');
  for(const i of [1,2,3]){assert.ok(src(row(i).symbol).includes('GAINER_TOP3'),'ilk 3 kapsamda');assert.ok(idx(row(i).symbol)>idx(row(60).symbol),'ilk 3 en son: '+i);}
  assert.deepEqual(out.slotPlan.map(x=>x.source),['GAINER_APPROACH','GAINER_TOP10','GAINER_TOP24','APP_EARLY_ATTENTION','NEAR_EXPLOSION','GAINER_TOP3']);
  assert.ok(out.candidates.filter(x=>x.gainerRank&&x.gainerRank<=24).every(x=>x.targetSources.includes('BINANCE_TOP24_GAINER')));
  assert.ok(out.ladder.nextLadder[row(1).symbol].h.length>=1,'sıra geçmişi saklanır');
});

test('R2544.16: JEV sırası: ilk 10 adayı → 4–10 → 11–24 → erken ilgi → patlamaya yakın → ilk 3 → eski havuzlar',()=>{
  const base=(symbol,rank,extra={})=>({symbol,side:'LONG',attackRank:rank,projectedRank:rank,leaderState:'WATCH',tradeQuality:80,spreadBps:1,
    directionSupport:2,longExpansionScore:60,shortExpansionScore:10,expansionScore:60,leaderHunterScore:100-rank,movementPotential:70,...extra});
  const scan={
    ladderTop3:[base('G1USDT',9,{gainerRank:1})],ladderApproach:[base('APPUSDT',8,{gainerRank:14,ladderApproach:'TOP10_CANDIDATE'})],
    attentionCandidates:[base('ATTNUSDT',16)],ladderTop10:[base('G5USDT',3,{gainerRank:5})],ladderTop24:[base('G15USDT',2,{gainerRank:15})],
    nearExplosionCandidates:[base('NEARUSDT',20,{side:'SHORT',nearExplosion:{source:'SURGE_DOWN',direction:'SHORT'}})],
    leaders:[base('ATK1USDT',1)],acceleratingCandidates:[base('FASTUSDT',13)],top3Approach:[],top10Approach:[],earlyTop5:[],earlyExpansion:[]
  };
  const out=selectDeepCandidates(scan,24);
  assert.deepEqual(out.map(x=>[x.symbol,x.deepScanReason]),[
    ['APPUSDT','GAINER_APPROACH'],['G5USDT','GAINER_TOP10'],['G15USDT','GAINER_TOP24'],['ATTNUSDT','APP_EARLY_ATTENTION'],
    ['NEARUSDT','NEAR_EXPLOSION'],['G1USDT','GAINER_TOP3'],['FASTUSDT','LIGHTWEIGHT_ACCELERATION'],['ATK1USDT','CURRENT_ATTACK_TOP10']]);
});

test('R2544.16: kısa listede bile her katman görünür, öncelik sırası bozulmaz',()=>{
  const mk=(p,n,extra={})=>Array.from({length:n},(_,i)=>({symbol:p+i+'USDT',side:'LONG',...extra}));
  const scan={ladderApproach:mk('AP',6),ladderTop10:mk('TT',7),ladderTop24:mk('TF',14),attentionCandidates:mk('AT',4),nearExplosionCandidates:mk('NE',5),ladderTop3:mk('TH',3)};
  const out=selectDeepCandidates(scan,8);
  const reasons=out.map(x=>x.deepScanReason);
  assert.equal(out.length,8);
  for(const r of ['GAINER_APPROACH','GAINER_TOP10','GAINER_TOP24','APP_EARLY_ATTENTION','NEAR_EXPLOSION','GAINER_TOP3'])assert.ok(reasons.includes(r),r);
  const order=['GAINER_APPROACH','GAINER_TOP10','GAINER_TOP24','APP_EARLY_ATTENTION','NEAR_EXPLOSION','GAINER_TOP3'];
  assert.deepEqual([...reasons].sort((a,b)=>order.indexOf(a)-order.indexOf(b)),reasons,'öncelik sırası');
  const out24=selectDeepCandidates(scan,24);
  assert.equal(out24.filter(x=>x.deepScanReason==='GAINER_TOP3').length,3,'24 listede ilk 3 tamamı (en sonda)');
  assert.equal(out24.at(-1).deepScanReason,'GAINER_TOP3');
});
