'use strict';
// R2544.58 İLK 3 v2 (user 14.10.2026: "1 saatlik muma bakarak girerse sıvar; düşüşü/yükselişi erken mum seviyelerinden
// tespit et; büyük zaman dilimlerinde kurulan likidasyon oyunlarına göre gardını al"; 05.10 "kovalama yok"). 5m triggers
// at the previous day/week/month highs, no chase, zone guards, risk-sized lots, same-coin pause.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const T3=require('../top3-hunter');

const M5=300000,H=3600000,DAY=86400000;
const HOUR0=1791370800000; // 11:00 UTC
// 5m candles [t,o,h,l,c,quoteVol]; flat at `px` with volume 100
const flat=(t0,n,px,vol=100)=>Array.from({length:n},(_,i)=>[t0+i*M5,px,px*1.001,px*0.999,px,vol]);

test('R58 daily levels come from CLOSED days only: previous day / 7 days / 30 days',()=>{
  const D=Math.floor((HOUR0+2*H)/DAY)*DAY;
  const kd=Array.from({length:35},(_,i)=>{const t=D-(34-i)*DAY;const h=t===D-DAY?1.02:t===D-20*DAY?1.15:t===D?9.99:1.0;return [t,1,h,0.9,1];});
  const lv=T3.dailyLevels(kd,HOUR0+2*H);
  assert.equal(lv.pdh,1.02);assert.equal(lv.pwh,1.02);assert.equal(lv.pmh,1.15,'today (9.99) is not closed and never counts');
  assert.deepEqual(T3.dailyLevels(kd.slice(-3),HOUR0+2*H),{day:D,pdh:1.02,pwh:null,pmh:null},'week needs 3 days, month 10');
});

// breakout at bar q-2 through 1.02 with 5x volume, then a retest at q
function earlySeries({retest=true,vol=500,extra=[]}={}){
  const q0=HOUR0+2*H+5*60000,start=q0-339*M5;
  const k=flat(start,340,1.0);
  for(const r of k)if(r[0]<HOUR0-23*H){r[1]=r[2]=r[3]=r[4]=0.9;}
  const i=k.length-3;k[i-1][4]=1.01;
  k[i]=[k[i][0],1.01,1.031,1.009,1.03,vol];
  k[i+1]=[k[i+1][0],1.03,1.04,1.028,1.035,150];
  k[i+2]=retest?[k[i+2][0],1.035,1.036,1.006,1.026,180]:[k[i+2][0],1.035,1.045,1.03,1.04,120];
  return [...k,...extra];
}
const LV={pdh:1.02,pwh:1.02,pmh:1.15};
const ctxOk=()=>({ok:true,reasons:[]});

test('R58 EARLY LONG fires only on the FIRST retest candle of a fresh 5m breakout (no chase)',()=>{
  const k=earlySeries();
  const t=T3.earlyLongTrigger(k,()=>LV,ctxOk);
  assert.equal(t.ok,true,JSON.stringify(t));assert.equal(t.rule,'LONG_EARLY_RETEST');assert.equal(t.level,1.02);assert.equal(t.levelName,'PWH','1.02 is both the day and the week high: the bigger timeframe names it');assert.equal(t.retestLow,1.006);assert.equal(t.volMult,5);
  assert.equal(T3.earlyLongTrigger(k.slice(0,-1),()=>LV,ctxOk).reason,'V2_WAITING_RETEST','breakout without retest: wait, never buy the breakout candle');
  const after=[...k,[k.at(-1)[0]+M5,1.026,1.04,1.025,1.038,100]];
  assert.equal(T3.earlyLongTrigger(after,()=>LV,ctxOk).reason,'V2_RETEST_ALREADY_PASSED','a missed retest is not chased');
  assert.equal(T3.earlyLongTrigger(earlySeries({vol:250}),()=>LV,ctxOk).reason,'V2_BREAKOUT_VOLUME_LOW');
  assert.equal(T3.earlyLongTrigger(k,()=>LV,()=>({ok:false,reasons:['NOT_CLIMBING']})).reason,'V2_CONTEXT');
  const failed=earlySeries();failed[failed.length-2]=[failed.at(-2)[0],1.03,1.03,1.0,1.005,200]; // closes 1.5 % under the level
  assert.equal(T3.earlyLongTrigger(failed,()=>LV,ctxOk).reason,'V2_BREAKOUT_FAILED');
  assert.equal(T3.earlyLongTrigger(earlySeries({retest:false}),()=>LV,ctxOk).reason,'V2_WAITING_RETEST');
});

test('R58 EARLY LONG plan: stop under the retest, target under the next zone; no long right under a zone; 3R in price discovery',()=>{
  const t=T3.earlyLongTrigger(earlySeries(),()=>LV,ctxOk);
  const p=T3.earlyLongPlan(1.0262,t,LV);
  assert.equal(p.ok,true,JSON.stringify(p));assert.ok(Math.abs(p.stopPrice-1.006*0.997)<1e-12);assert.ok(Math.abs(p.tpPrice-1.15*0.995)<1e-12);assert.equal(p.zone,1.15);
  assert.equal(T3.earlyLongPlan(1.0262,t,{...LV,pmh:1.06}).reason,'V2_ZONE_TOO_CLOSE','the next liquidation zone is < 2R away');
  const free=T3.earlyLongPlan(1.0262,t,{pdh:1.02,pwh:1.02,pmh:1.02});assert.equal(free.zone,null);assert.ok(Math.abs(free.targetR-3)<1e-9);
  assert.equal(T3.earlyLongPlan(1.0262,{...t,retestLow:1.022},LV).reason,'V2_STOP_OUT_OF_RANGE','stop < 1.2 % (fees) is no trade');
});

// a fresh 24 h high at q-3, then a close under the low of the 6 candles before it
function topSeries({breakEarly=false,newHighNow=false}={}){
  const q0=HOUR0+2*H,start=q0-339*M5;const k=flat(start,340,1.0);
  const j=k.length-4;
  for(let m=j-6;m<j;m++)k[m]=[k[m][0],1.06,1.075,1.05+(m-j+6)*0.002,1.07,300];
  k[j]=[k[j][0],1.07,1.08,1.065,1.075,800];
  k[j+1]=[k[j+1][0],1.075,1.076,1.055,breakEarly?1.04:1.06,400];
  k[j+2]=[k[j+2][0],1.06,1.065,1.052,1.055,300];
  k[j+3]=newHighNow?[k[j+3][0],1.055,1.09,1.05,1.08,500]:[k[j+3][0],1.055,1.056,1.035,1.04,500];
  return k;
}
test('R58 TOP SHORT fires on the first 5m close under the pre-top structure low; never while a new high is being made',()=>{
  const t=T3.topShortTrigger(topSeries());
  assert.equal(t.ok,true,JSON.stringify(t));assert.equal(t.rule,'SHORT_TOP_BREAK');assert.equal(t.top,1.08);assert.equal(t.hl,1.05);
  assert.equal(T3.topShortTrigger(topSeries({breakEarly:true})).reason,'V2_BREAK_ALREADY_PASSED','a passed break is not chased');
  assert.equal(T3.topShortTrigger(topSeries({newHighNow:true})).reason,'V2_NEW_HIGH_NOW');
  assert.equal(T3.topShortTrigger(topSeries().slice(0,-1)).reason,'V2_NO_BREAK_YET');
  const p=T3.topShortPlan(1.04,t,{pdh:1.07,pwh:1.07,pmh:1.20});
  assert.equal(p.ok,true,JSON.stringify(p));assert.ok(Math.abs(p.stopPrice-1.08*1.003)<1e-12);assert.ok(Math.abs(p.tpPrice-1.04*(1-2.5*p.stopPct))<1e-12);
  assert.equal(T3.topShortPlan(1.04,t,{pdh:1.07,pwh:1.10,pmh:1.20}).reason,'V2_UNSWEPT_ZONE_ABOVE','the week high 1.10 is within 5 % above the top: the market maker goes there first');
  assert.equal(T3.topShortPlan(1.00,t,{}).reason,'V2_STOP_OUT_OF_RANGE');
});

test('R58 risk-sized lots: riskPct of equity at the stop, never above margin x leverage; defaults',()=>{
  assert.equal(T3.riskSizedNotional({equity:200,riskPct:0.02,stopPct:0.025,marginCap:20,leverage:10}),160);
  assert.equal(T3.riskSizedNotional({equity:200,riskPct:0.02,stopPct:0.01,marginCap:20,leverage:10}),200,'capped by margin x leverage');
  assert.equal(T3.riskSizedNotional({equity:0,riskPct:0.02,stopPct:0.01,marginCap:20,leverage:10}),null);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r58-cfg-'));
  const d=T3.readTop3Config(root);assert.equal(d.rulesVersion,2);assert.equal(d.riskPct,0.02);assert.equal(d.early.retestBars,24);assert.equal(d.top.targetR,2.5);
  fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({rulesVersion:1,riskPct:0.5,early:{volMult:4},top:{requireWeeklySwept:true}}));
  const c=T3.readTop3Config(root);assert.equal(c.rulesVersion,1);assert.equal(c.riskPct,0.02,'riskPct above 10 % is ignored');assert.equal(c.early.volMult,4);assert.equal(c.top.requireWeeklySwept,true);
});

// ---------- controller: one v2 pass in TEST (paper) ----------
const FAKE={apiKey:'fake-test-key-r58',apiSecret:'fake-test-secret-r58'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({top3={},fund='-0.0001',strictStore=false,extraRanks={}}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r58-run-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:true,...top3}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-14T10:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const state={now:HOUR0+2*H+10*60000+10000,calls:[],px:{SIGUSDT:{bid:1.026,ask:1.0262}},k5:{SIGUSDT:earlySeries()}},events=[];
  const D=Math.floor(state.now/DAY)*DAY;
  const kd=Array.from({length:35},(_,i)=>{const t=D-(34-i)*DAY;return [t,'1',String(t===D-DAY?1.02:t===D-20*DAY?1.15:1.0),'0.9','1','1000'];});
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.0001'},{filterType:'LOT_SIZE',stepSize:'0.1',minQty:'0.1',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push(`${m} ${p}${u.searchParams.get('interval')?'?'+u.searchParams.get('interval'):''}`);
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['SIGUSDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([]);
    if(p==='/fapi/v1/premiumIndex')return ok([{symbol:'SIGUSDT',lastFundingRate:fund,markPrice:'1.026',indexPrice:'1.0262'}]);
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines'&&u.searchParams.get('interval')==='1d')return ok(kd);
    if(p==='/fapi/v1/klines'&&u.searchParams.get('interval')==='5m'){const k=state.k5[u.searchParams.get('symbol')]||[];return ok(k.map(r=>[r[0],String(r[1]),String(r[2]),String(r[3]),String(r[4]),'0',r[0]+M5-1,String(r[5])]));}
    throw new Error('UNEXPECTED '+m+' '+p);};
  // strictStore: like the real store, a symbol outside [A-Z0-9] is refused
  const store={journal:(k,s,p)=>{if(strictStore&&s&&!/^[A-Z0-9]{2,28}$/.test(s))throw new Error('invalid symbol');events.push({k,s,p});},recordLearning:()=>{}};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store,scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  const ranks=controller._testTop3Ranks();
  // rank book: SIG climbed to 10 (11:00) / 9 (12:00); not ranked 3 h earlier; never in the top 3
  for(let t=HOUR0-60*H;t<=HOUR0+H;t+=H){const mp={};for(let i=0;i<50;i++)mp['C'+i+'USDT']=i+1;if(t>=HOUR0)mp.SIGUSDT=t===HOUR0?10:9;if(t>=HOUR0)Object.assign(mp,extraRanks);ranks.record(t,mp);}
  return {root,state,events,controller,paper:controller._testPaper(),kinds:k=>events.filter(e=>e.k===k)};
}

test('R58 controller: a closed 5m retest opens the EARLY LONG on paper with the structural stop, the zone target and a 2 % risk lot',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();
  assert.equal((await f.controller.testSupervisorTick()).action,'TEST_ARMED');
  const r=await f.controller.top3Tick();
  assert.equal(r.v2?.signals,1,JSON.stringify({r,ls:f.controller.top3Status().lastScan5}));assert.equal(r.v2.entries,1);
  const a=Object.values(f.controller._testTop3State().active)[0];
  assert.equal(a.rule,'LONG_EARLY_RETEST');assert.equal(a.rulesVersion,2);assert.equal(a.side,'LONG');
  assert.equal(a.stopPrice,1.0029,'under the retest low 1.006 (-0.3 %), rounded down to the tick');
  assert.equal(a.tpPrice,1.1442,'just under the previous month high 1.15');
  const equity=100; // paper start balance
  assert.ok(Math.abs(a.riskQuote-equity*0.02)<0.05,'2 % of equity lost at the stop: '+a.riskQuote);
  assert.ok(a.notional<a.marginQuote*a.leverage+1e-9);
  assert.equal(a.entryFeatures.levelName,'PWH');assert.equal(a.entryFeatures.fund,-0.0001);
  assert.equal(f.state.calls.some(c=>c==='GET /fapi/v1/klines?1h'),false,'v2 never decides on hourly candles');
  const st=f.controller.top3Status();
  assert.equal(st.rules.rulesVersion,2);assert.equal(st.lastScan5.signals[0].symbol,'SIGUSDT');assert.equal(st.lastScan5.entries[0].opened,true);
  assert.equal(f.kinds('TOP3_SIGNAL')[0].p.rule,'LONG_EARLY_RETEST');
  // same 5m candle again: no second pass; the coin then pauses 24 h after the entry
  assert.equal((await f.controller.top3Tick()).v2,null,'one pass per closed 5m candle');
  assert.equal(f.controller._testTop3Cooldown('SIGUSDT','LONG'),'TOP3_COOLDOWN');
  assert.equal(f.controller._testTop3Cooldown('SIGUSDT','SHORT'),null);
});

test('R58 same-coin pause after a stop: 24 h on that side (BLUAI was shorted 5 times on 14.10)',async()=>{
  const f=fixture();
  const st=f.controller._testTop3State();
  st.recentCloses=[{id:'x',symbol:'BLUAIUSDT',side:'SHORT',rule:'SHORT_TOP_BREAK',exitReason:'TOP3_STOP',closedAt:f.state.now-20*H}];
  assert.equal(f.controller._testTop3Cooldown('BLUAIUSDT','SHORT'),'TOP3_STOP_COOLDOWN');
  st.recentCloses[0].closedAt=f.state.now-25*H;
  assert.equal(f.controller._testTop3Cooldown('BLUAIUSDT','SHORT'),null);
  st.lastEntry={'BLUAIUSDT:SHORT':f.state.now-11*H};assert.equal(f.controller._testTop3Cooldown('BLUAIUSDT','SHORT'),'TOP3_COOLDOWN','12 h after a SHORT entry');
});

test('R58 Office and JEV: v2 rules text, 5m scan line, reason labels; JEV gets the 5m trigger and the zones',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.ok(html.includes('Kurallar (v2, her kapanan <b>5 dk</b> mumda; saatlik mum beklenmez)'));
  assert.ok(html.includes('Son 5 dk tarama:'));assert.ok(html.includes("V2_ZONE_TOO_CLOSE:'üstteki likidasyon bölgesi 2R’den yakın (LONG yok)'"));
  assert.ok(html.includes("TOP3_STOP_COOLDOWN:'aynı coinde stop sonrası 24 saat bekleme'"));
  const jev=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.ok(jev.includes("contract:'R2544.58_TOP3_V2_GATE'"));assert.ok(jev.includes('previousMonthHigh'));
});

test('R58 options: LONG only while shorts pay (maxFunding), break-even after 1R moves the exchange stop and books a BE stop',async()=>{
  require('../binance-rate-limit').resetForTests();
  const g=fixture({top3:{early:{maxFunding:0}},fund:'0.0001'});
  await g.controller.testSupervisorTick();await g.controller.top3Tick();
  assert.equal(g.controller.top3Status().lastScan5.entries[0].reason,'TOP3_FUNDING_LONGS_CROWDED');assert.equal(Object.keys(g.controller._testTop3State().active).length,0);
  require('../binance-rate-limit').resetForTests();
  const f=fixture({top3:{early:{beAtR:1}}});
  await f.controller.testSupervisorTick();await f.controller.top3Tick();
  const a=Object.values(f.controller._testTop3State().active)[0];assert.ok(a,'entered');
  const oneR=a.entryPrice*(1+a.stopPct)+0.001;
  f.state.px.SIGUSDT={bid:oneR,ask:oneR+0.0002};f.state.now+=30000;await f.controller.top3Tick();
  assert.equal(a.beMoved,true);assert.ok(a.stopPrice>=a.entryPrice*1.001-1e-9&&a.stopPrice<a.entryPrice*1.0012,'stop at break-even + fees: '+a.stopPrice);
  assert.equal(f.kinds('TOP3_BREAKEVEN').length,1);
  f.state.px.SIGUSDT={bid:a.entryPrice*0.999,ask:a.entryPrice*0.9992};f.state.now+=1000;await f.paper.tick();
  f.state.now+=30000;await f.controller.top3Tick();f.state.now+=30000;await f.controller.top3Tick();
  const c=f.kinds('TOP3_CLOSED')[0].p;assert.equal(c.exitReason,'TOP3_BE_STOP');
  const l=f.kinds('TOP3_LESSON')[0].p;assert.ok(l.tags.includes('BREAKEVEN_STOP'));assert.equal(l.tags.includes('STOPPED'),false);
  assert.equal(f.controller._testTop3Cooldown('SIGUSDT','LONG'),'TOP3_COOLDOWN','24 h after the entry still applies; a BE stop is not a stop-out');
});

test('R58 a TEST window started under the hourly rules restarts once for v2 (results never mix)',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();
  const st=f.controller._testTop3State();st.window={id:'wold',startedAt:f.state.now-3*H,endsAt:f.state.now+21*H,source:'RESTART',scans:5,okScans:5,signals:2,entries:2};
  await f.controller.testSupervisorTick();await f.controller.top3Tick();
  const w=f.controller.top3Status().testWindow;assert.equal(w.source,'RULES_V2');assert.equal(w.rulesVersion,2);assert.equal(w.scans,1,'counts only v2 passes');
  assert.equal(f.kinds('TOP3_TEST_WINDOW_START').length,1);
  f.state.now+=5*60000;await f.controller.top3Tick();assert.equal(f.controller.top3Status().testWindow.source,'RULES_V2','no second restart');
});

test('R58 15.10 fix: symbols the store cannot book (我踏马来了USDT) are never traded; a close it cannot book is still learned',async()=>{
  require('../binance-rate-limit').resetForTests();
  const W='我踏马来了USDT';
  const f=fixture({strictStore:true,extraRanks:{[W]:8}});
  f.state.k5[W]=earlySeries();f.state.px[W]={bid:1.026,ask:1.0262};
  await f.controller.testSupervisorTick();await f.controller.top3Tick();
  const ls=f.controller.top3Status().lastScan5;
  assert.equal(ls.skippedSymbols,1);assert.equal(ls.signals.some(x=>x.symbol===W),false);
  assert.equal(ls.signals.filter(x=>x.symbol==='SIGUSDT').length,1,'the bookable coin still trades');
  // a lot of such a symbol that is already open (opened by 58 before this fix) closes: learned + reported, not lost
  const st=f.controller._testTop3State();
  st.pendingCloses.push({id:'t3w',symbol:W,side:'SHORT',rule:'SHORT_TOP_BREAK',mode:'TEST',entryPrice:0.013184,stopPrice:0.013936,tpPrice:0.011305,stopPct:0.057,quantity:3787,
    startedAt:f.state.now-3*H,openedAt:f.state.now-3*H,closedAt:f.state.now-11*60000,detectedAt:f.state.now-11*60000,exitReason:'TOP3_TAKE_PROFIT',exitPrice:0.0113,signalKind:'FRESH'});
  f.state.now+=30000;await f.controller.top3Tick();
  assert.equal(st.pendingCloses.length,0,'not stuck');assert.ok(st.lessons.some(l=>l.id==='t3w'),'learned');
  assert.equal(f.kinds('TOP3_CLOSE_UNBOOKED')[0].p.symbol,W);
});
