'use strict';
// R2544.118 (kullanıcı 03.11: "giriş yaptığı durumun verileri, çıkıştaki veriler, grafikteki o anki durum - her şeyi öğreniyor değil mi";
// "6 ay diye sınama saçmalık, bu gerçek işlem gelecek, o anki kararları daha net öğrenir"): the entry screen and the exit chart are written
// into every lesson as numbers; the brain asks about them; a lesson comes from the real trades only (6-month lab = information).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const TB=require('../trader-brain'),T3=require('../top3-hunter');
const H=3600000,T0=Date.UTC(2026,9,20,13,0,0);
const series=(n,ms,start,p0,step)=>Array.from({length:n},(_,i)=>{const p=p0+i*step+(i%7<3?0.02:-0.02)*p0;return [start+i*ms,p,p*1.006,p*0.994,p+step*0.5,100+i,start+(i+1)*ms-1,0,0,60];});
const K=()=>({m5:series(80,300000,T0-80*300000,10,0.01),m15:series(80,900000,T0-80*900000,9,0.02),h1:series(80,H,T0-80*H,8,0.03),h4:series(80,4*H,T0-80*4*H,6,0.05),d1:series(80,24*H,T0-80*24*H,3,0.05),btc1h:series(40,H,T0-40*H,60000,10)});
test('R2544.118 entry photo: the screen the models saw, in numbers (leans, stop vs ATR, swing beyond stop, first obstacle, chase, liquidity, trends)',()=>{
  const pk=TB.entryPacket({k:K(),plan:{side:'LONG',rule:'LONG_EARLY_RETEST',entry:10.8,stop:10.6,target:11.4},t:T0});
  const f=TB.screenFacts(pk);
  assert.equal(f.v,'R2544.118');assert.equal(f.lean.length,5);assert.equal(f.leanFor+f.leanAgainst+f.lean.filter(x=>x==='MIXED').length,5);
  assert.ok(Number.isFinite(f.stopAtr5)&&Number.isFinite(f.stopPct));for(const k of ['d1','h4','h1','m15','m5'])assert.ok(k in f.trend);
  assert.equal(typeof f.chaseHigh,'boolean');assert.equal(typeof f.liqMagnet,'boolean');assert.ok('firstObstacleR' in f&&'chg24' in f);
  assert.equal(TB.screenFacts(null),null);
});
test('R2544.118 exit photo: the 5m and 15m chart at the exit, judged for the trade side',()=>{
  const k=K();const t=T0+60*60000,k5=series(170,300000,t-170*300000,10,0.01);
  const x=TB.exitFacts(k5,t,'SHORT',10.5,10.8,k.m15);
  assert.equal(x.v,'R2544.118');assert.equal(x.at,t);assert.ok('m5' in x&&'m15' in x,'both frames are always present (null when the chart engine has < 52 closed candles)');
  for(const m of [x.m5,x.m15])if(m){assert.ok('trend' in m);if(m.lastEvent)assert.equal(typeof m.lastEvent.withTrade,'boolean');}
  assert.equal(TB.exitFacts(null,t,'LONG',1,0.9).m5,null,'no candles -> no invented chart'); // real 02-03.11 HAEDAL / ICNT / TA checked by hand: 5m + 15m filled
});
test('R2544.118 the brain asks about the entry screen; a lesson comes from the real trades only (no 6-month gate)',()=>{
  const now=Date.UTC(2026,10,3,3);
  const l=(i,win,sf,flags)=>({rule:'SHORT_TOP_BREAK',side:'SHORT',symbol:'X'+i,openedAt:now,stopPct:0.03,rMultiple:win?2:-1,features:{screenFacts:sf,ruleFlags:flags},autopsy:{ok:true,outcome:win?'KAZANC':'KAYIP',causes:[],factors:{}}});
  const ls=[...Array.from({length:10},(_,i)=>l(i,false,{leanFor:3,leanAgainst:1,stopAtr5:0.7,swingBeyond5:true,firstObstacleR:0.6,chaseHigh:true,liqMagnet:false},[{code:'V2_STOP_OUT_OF_RANGE'}])),
            ...Array.from({length:10},(_,i)=>l(20+i,true,{leanFor:1,leanAgainst:1,stopAtr5:1.8,swingBeyond5:false,firstObstacleR:2.2,chaseHigh:false,liqMagnet:true},[]))];
  const c=T3.causeStats(ls,'SHORT_TOP_BREAK'),g=(k,v)=>c.factors.find(f=>f.key===k&&f.value===v);
  assert.equal(g('tfLean','COK_LEHTE').call,'KAYIP_TARAFI');assert.equal(g('stopNoise','true').call,'KAYIP_TARAFI');assert.equal(g('swingBeyond','true').call,'KAYIP_TARAFI');
  assert.equal(g('obstacleNear','true').call,'KAYIP_TARAFI');assert.equal(g('chaseHigh','true').call,'KAYIP_TARAFI');assert.equal(g('liqMagnet','true').call,'KAZANC_TARAFI');
  assert.equal(g('ruleWarn','true').call,'KAYIP_TARAFI','R2544.116 warnings are learned too');
  assert.ok(!c.factors.some(f=>f.call==='TEST_ONLY'),'no 6-month gate');assert.ok(c.text.some(t=>/^Ayırt edici \(gerçek işlemler\)/.test(t)));
});
test('R2544.118 wiring: the entry photo is stored right after the entry even without a committee vote; the exit photo at the autopsy',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/\{const sf=TB\.screenFacts\(packet\);if\(sf\)\{\(lot\.entryFeatures\|\|\(lot\.entryFeatures=\{\}\)\)\.screenFacts=sf;saveTop3State\(\);\}\}/);
  assert.match(lc,/if\(lot\.entryFeatures\?\.committee\|\|!deskJudges\?\.committee\|\|typeof deskJudges\.committee\.decide!=='function'\)return null;/);
  assert.match(lc,/if\(!l\.exitFacts\)try\{const kx=await k5Window\(l\.symbol,l\.closedAt-14\*TOP3_HOUR/);
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.doesNotMatch(html,/"ders" = son dersler VE 6 aylık hafıza/);assert.match(html,/Ders artık yalnız gerçek işlemlerden çıkar/);
});
