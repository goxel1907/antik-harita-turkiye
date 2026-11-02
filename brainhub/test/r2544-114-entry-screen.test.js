'use strict';
// R2544.114 NET EKRAN (kullanıcı 02.11: "modeller neye karar verdiğini net bilmeli görmeli ... verinin grafiğin ne durumda olduğunu
// bilmeden kör dövüş olur"): the committee reads a code-written briefing first - why the rule fired, the real management,
// every timeframe fact marked FOR / AGAINST this side, opposite levels before the target in R, BTC, neutral odds + break-even hit rate.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const TB=require('../trader-brain');
const H=3600000,T0=Date.UTC(2026,9,20,12,0,0);
const series=(n,ms,start,p0,step)=>Array.from({length:n},(_,i)=>{const p=p0+i*step;return [start+i*ms,p,p*1.004,p*0.996,p+step*0.5,100+i,0,0,0,60];});
const K=()=>({m5:series(80,300000,T0-80*300000,10,0.01),m15:series(80,900000,T0-80*900000,9,0.02),h1:series(80,H,T0-80*H,8,0.03),h4:series(80,4*H,T0-80*4*H,6,0.05),d1:series(80,24*H,T0-80*24*H,3,0.05),btc1h:series(40,H,T0-40*H,60000,10)});

test('R2544.114 screen comes first and says why the rule fired, in scaled prices and R (no symbol, no date)',()=>{
  const trig={level:10.7,levelName:'PWH',retestLow:10.69,volMult:25.82,breakoutAt:T0-10*300000,retestAt:T0-3*300000};
  const p=TB.entryPacket({k:K(),plan:{side:'LONG',rule:'LONG_EARLY_RETEST',entry:10.8,stop:10.6,target:11.4},t:T0,trigger:trig});
  assert.deepEqual(Object.keys(p).slice(0,4),['contract','task','side','screen'],'the briefing is the first thing a model reads');
  const s=p.screen,txt=JSON.stringify(p);
  assert.doesNotMatch(txt,/USDT|2026|T12:/);
  assert.match(s.whyTheRuleFired[0],/previous week high 99\.074 \(-0\.50R\) on a 5m candle with 25\.8x median volume/);
  assert.match(s.whyTheRuleFired[1],/retest low 98\.981 \(-0\.55R\)/);
  assert.match(s.whyTheRuleFired[2],/7 five-minute candles/);
  assert.equal(s.timeframes.length,5);for(const l of s.timeframes)assert.match(l,/^(1d|4h|1h|15m|5m): leans (FOR|AGAINST|MIXED)/);
  assert.match(s.timeframeTally,/leaning FOR this LONG/);
  assert.match(s.trade,/^EARLY LONG\. Entry 100, stop 98\.148 \(-1R = 1\.85% away\), target 105\.556 \(\+3\.00R\)/);
});

test('R2544.114 management is the REAL one (erken LONG: stop to entry at +1R) and the odds are neutral with a break-even hit rate',()=>{
  const p=TB.entryPacket({k:K(),plan:{side:'LONG',rule:'LONG_EARLY_RETEST',entry:10.8,stop:10.6,target:11.4},t:T0});
  assert.match(p.screen.management,/at \+1R the stop moves to entry/);assert.equal(p.plan.management,p.screen.management);
  assert.match(p.screen.odds,/34% of all signals of this rule ended in profit \(n 504/);
  assert.match(p.screen.odds,/more than about 25% of cases/,'1 / (1 + 3R) = 25 %');
  assert.equal(p.baseRate,undefined);assert.doesNotMatch(JSON.stringify(p),/most signals of this setup lost|earns nothing/i,'the old one-sided line is gone');
  const q=TB.entryPacket({k:K(),plan:{side:'SHORT',rule:'SHORT_TOP_BREAK',entry:10.8,stop:11.0,target:10.3},t:T0,management:'custom from live config'});
  assert.equal(q.screen.management,'custom from live config');assert.match(q.screen.odds,/more than about 29% of cases/);
});

test('R2544.114 every fact is judged for THIS side: the same rising chart is FOR a LONG and AGAINST a SHORT',()=>{
  const L=TB.entryPacket({k:K(),plan:{side:'LONG',rule:'ZIRVE5_FIBO_LONG',entry:10.8,stop:10.6,target:11.2},t:T0}).screen;
  const S=TB.entryPacket({k:K(),plan:{side:'SHORT',rule:'ZIRVE5_FIBO_SHORT',entry:10.8,stop:11.0,target:10.4},t:T0}).screen;
  const lean=s=>s.timeframes.map(l=>l.split(':')[1].trim().split(' ')[1]);
  for(let i=0;i<5;i++){const a=lean(L)[i],b=lean(S)[i];if(a==='FOR')assert.notEqual(b,'FOR',`${L.timeframes[i]} / ${S.timeframes[i]}`);}
  assert.ok(L.timeframes.some(l=>/against: close \+[\d.]+% from EMA20 = [\d.]+ ATR stretched up/.test(l)),'a straight rise is stretched: AGAINST the long');
  assert.ok(S.timeframes.some(l=>/for: close \+[\d.]+% from EMA20/.test(l)),'and FOR the short');
  assert.ok(L.timeframes.every(l=>/trend RANGE/.test(l)),'a straight line has no swings -> RANGE, never invented');
  assert.match(L.btc,/^BTC 1h trend /);
  const tfs={h1:{structure:{trend:'UP',volLast3VsMedian:3,takerBuyShareLast3:0.62},chartReading:{trend:'UP',swing:{highs:'HH',lows:'HL'},events:[{side:'BULL',kind:'BOS',R:-0.5,barsAgo:0}],
    patterns:[{type:'BEARISH_ENGULFING',side:'SHORT',status:'CONFIRMED'}],momentum:{rsi14:74,chaseRisk:{LONG:'HIGH',SHORT:'LOW'}}}}};
  const bl=TB.briefing({side:'LONG',rule:'LONG_EARLY_RETEST',plan:{stop:98,target:106,targetR:3,stopDistancePct:2},tfs,levels:[],btc:null,P:x=>x,R:()=>null}).timeframes[0];
  assert.equal(bl,'1h: leans MIXED | for: trend UP (HH/HL); last structure event BULL BOS on the last closed candle (-0.50R); last 3 candles 3.0x median volume, taker buy 62% | against: RSI 74 overbought; bearish engulfing confirmed; chase risk HIGH (entry far from the base of the move)');
  const bs=TB.briefing({side:'SHORT',rule:'SHORT_TOP_BREAK',plan:{stop:102,target:94,targetR:3,stopDistancePct:2},tfs,levels:[],btc:null,P:x=>x,R:()=>null}).timeframes[0];
  assert.equal(bs,'1h: leans AGAINST | for: RSI 74 overbought; bearish engulfing confirmed | against: trend UP (HH/HL); last structure event BULL BOS on the last closed candle (-0.50R); last 3 candles 3.0x median volume, taker buy 62%');
});

test('R2544.114 room to target lists opposite levels in R; protection lists levels behind entry',()=>{
  const levels=[{name:'high24h',price:102.2,R:1.2},{name:'prevDayLow',price:99.5,R:-0.3},{name:'prevMonthHigh',price:120,R:9}];
  const tfs={m15:{structure:null,chartReading:{openFvg:[{side:'BEAR',R:0.6},{side:'BULL',R:-0.4}],orderBlocks:[{side:'BEAR',R:2.4}]}}};
  const b=TB.briefing({side:'LONG',rule:'LONG_EARLY_RETEST',plan:{stop:98,target:106,targetR:3,stopDistancePct:2},tfs,levels,btc:null,trigger:null,P:x=>x,R:()=>null});
  assert.match(b.roomToTarget,/15m bear FVG at \+0\.60R; high24h at \+1\.20R; 15m bear order block at \+2\.40R\. First one at \+0\.60R/);
  assert.doesNotMatch(b.roomToTarget,/prevMonthHigh/,'beyond the target is not an obstacle');
  assert.match(b.behindEntry,/prevDayLow at -0\.30R|15m bull FVG at -0\.40R/);assert.equal(b.btc,'BTC data missing');assert.deepEqual(b.whyTheRuleFired,[]);
});

test('R2544.114 wiring: the live gate passes the trigger and the real management; the record keeps the plan for later replay',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(src,/committeeEntryGate\(\{symbol:x\.symbol,[^}]*trigger:x\.trig,management:committeeManagement\(cfg,x\.side,false\)\}\)/);
  assert.match(src,/committeeEntryGate\(\{symbol:sym,[^}]*trigger:sg,management:committeeManagement\(cfg,side,true\)\}\)/);
  assert.match(src,/TB\.entryPacket\(\{k,plan:\{side,rule,entry,stop,target\},t:t0,trigger,management\}\)/);
  assert.match(src,/plan:\{entry,stop,target,targetR:packet\.plan\?\.targetR\?\?null\},screenTally:packet\.screen\?\.timeframeTally/);
  assert.match(TB.ENTRY_SYSTEM,/START WITH `screen`/);assert.match(TB.ENTRY_SYSTEM,/break-even hit rate/);
  assert.doesNotMatch(TB.ENTRY_SYSTEM,/Most signals of this setup lose/);
});
