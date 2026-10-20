'use strict';
// R2544.67 İlk 3 = two named sub-strategies (İLK 3 ERKEN LONG / İLK 3 TEPE SHORT): own switch (TEST / LIVE with confirmation),
// own JEV choice, own results. Fixture copied from r2544-58-top3-v2.test.js (same synthetic early-LONG retest).
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
const FAKE={apiKey:'fake-test-key-r58',apiSecret:'fake-test-secret-r58'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({top3={},fund='-0.0001',strictStore=false,extraRanks={},mode='TEST',judge=undefined}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r58-run-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:true,...top3}));
  writeTradingMode(root,{mode,changedAt:'2026-10-14T10:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
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
    credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',...(judge!==undefined?{top3Judge:judge}:{}),market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  const ranks=controller._testTop3Ranks();
  // rank book: SIG climbed to 10 (11:00) / 9 (12:00); not ranked 3 h earlier; never in the top 3
  for(let t=HOUR0-60*H;t<=HOUR0+H;t+=H){const mp={};for(let i=0;i<50;i++)mp['C'+i+'USDT']=i+1;if(t>=HOUR0)mp.SIGUSDT=t===HOUR0?10:9;if(t>=HOUR0)Object.assign(mp,extraRanks);ranks.record(t,mp);}
  return {root,state,events,controller,paper:controller._testPaper(),kinds:k=>events.filter(e=>e.k===k)};
}


// ---------------- R2544.67 ----------------
test('R2544.67 İLK 3 ERKEN LONG off: the same closed 5m retest opens nothing; on again: it opens (TEST), each sub-strategy has its own switch',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({top3:{early:{enabled:false}}});
  assert.equal((await f.controller.testSupervisorTick()).action,'TEST_ARMED');
  const st0=f.controller.top3Status();
  assert.deepEqual(st0.subs.map(x=>[x.key,x.name,x.enabled]),[['early','İLK 3 ERKEN LONG',false],['top','İLK 3 TEPE SHORT',true]]);
  const r=await f.controller.top3Tick();assert.equal(r.v2.signals,0,'no LONG candidates while ERKEN LONG is off');assert.equal(Object.keys(f.controller._testTop3State().active).length,0);
  assert.equal(f.controller.laneStatus().top3.sub.early.selected,false);
  // same signal, ERKEN LONG switched on from Office before the scan: the lot opens
  require('../binance-rate-limit').resetForTests();
  const g=fixture({top3:{early:{enabled:false}}});await g.controller.testSupervisorTick();
  const on=g.controller.configureTop3({earlyEnabled:true,source:'OFFICE'});assert.equal(on.subs.find(x=>x.key==='early').enabled,true);
  const r2=await g.controller.top3Tick();assert.equal(r2.v2.entries,1,JSON.stringify(g.controller.top3Status().lastScan5));
  assert.equal(Object.values(g.controller._testTop3State().active)[0].rule,'LONG_EARLY_RETEST');
  const cc=g.kinds('TOP3_CONFIG_CHANGED').at(-1).p;assert.equal(cc.before.early,false);assert.equal(cc.after.early,true);
});

test('R2544.67 both sub-strategies off = nothing to run; the gate says so',async()=>{
  const f=fixture({top3:{early:{enabled:false},top:{enabled:false}}});await f.controller.testSupervisorTick();
  assert.equal(f.controller.top3Status().gate,'TOP3_NO_SUB_STRATEGY');
  f.controller.configureTop3({topEnabled:true});assert.equal(f.controller.top3Status().gate,'OPEN');
});

test('R2544.67 LIVE: a sub-strategy ON needs the LIVE confirmation, OFF is immediate; JEV choice needs none',()=>{
  const f=fixture({mode:'LIVE',top3:{enabled:true,liveEnabled:true}});
  assert.equal(f.controller.configureTop3({earlyEnabled:false}).subs.find(x=>x.key==='early').enabled,false);
  assert.deepEqual(f.controller.configureTop3({earlyEnabled:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(f.controller.top3Status().subs.find(x=>x.key==='early').enabled,false,'unchanged without LIVE');
  assert.equal(f.controller.configureTop3({earlyEnabled:true,confirm:'LIVE'}).subs.find(x=>x.key==='early').enabled,true);
  assert.equal(f.controller.configureTop3({topEnabled:false}).subs.find(x=>x.key==='top').enabled,false);
  assert.equal(f.controller.configureTop3({topJev:true}).subs.find(x=>x.key==='top').jev,true);
  assert.equal(f.controller.top3Status().tradingMode,'LIVE');
});

test('R2544.67 JEV per sub-strategy: ERKEN LONG with JEV sends its name and its own history; REJECT = no order; JEV missing = no order for that sub only',async()=>{
  require('../binance-rate-limit').resetForTests();
  const seen=[];const judge=async a=>{seen.push(a);return {ok:true,called:true,decision:'REJECT_ENTRY',reason:'LATE_OR_CROWDED'};};
  const f=fixture({top3:{early:{jev:true}},judge});await f.controller.testSupervisorTick();
  const st=f.controller.top3Status();assert.equal(st.subs.find(x=>x.key==='early').jev,true);assert.equal(st.subs.find(x=>x.key==='top').jev,false,'TEPE SHORT keeps the lane setting (JEV off)');
  const r=await f.controller.top3Tick();assert.equal(r.v2.signals,1);assert.equal(r.v2.entries,0);
  assert.equal(seen.length,1);assert.equal(seen[0].signal.strategy,'İLK 3 ERKEN LONG');assert.equal(seen[0].experience.rule,'LONG_EARLY_RETEST');
  assert.equal(f.controller.top3Status().lastScan5.entries[0].reason,'TOP3_JEV_NOT_APPROVED');
  require('../binance-rate-limit').resetForTests();
  const g=fixture({top3:{early:{jev:true}},judge:null});await g.controller.testSupervisorTick();
  assert.equal(g.controller.top3Status().gate,'OPEN','TEPE SHORT (JEV off) can still run');
  const r3=await g.controller.top3Tick();assert.equal(r3.v2.entries,0);assert.equal(g.controller.top3Status().lastScan5.entries[0].reason,'TOP3_JEV_UNAVAILABLE');
  const h=fixture({top3:{jevMode:true},judge:null});await h.controller.testSupervisorTick();assert.equal(h.controller.top3Status().gate,'TOP3_JEV_UNAVAILABLE','both need JEV, none wired');
});

test('R2544.67 config file: sub switches and JEV choice (null = lane setting) are written and read back',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r67-cfg-'));fs.mkdirSync(path.join(root,'config'));
  let c=T3.writeTop3Switches(root,{earlyEnabled:false,topJev:true});assert.equal(c.early.enabled,false);assert.equal(c.top.jev,true);assert.equal(T3.subJev(c,'SHORT'),true);assert.equal(T3.subJev(c,'LONG'),false);
  c=T3.writeTop3Switches(root,{topJev:null,jevMode:true});assert.equal(c.top.jev,undefined);assert.equal(T3.subJev(c,'SHORT'),true,'no own choice follows the lane JEV mode');
  c=T3.writeTop3Switches(root,{earlyEnabled:'x'});assert.equal(c.early.enabled,false,'non-boolean ignored');
});

test('R2544.67 Office and API wiring: sub rows, buttons, routes forward only the sub switches; JEV gate record carries the strategy name',()=>{
  const {CONTROL_BODY}=require('../office-dashboard/office-server');
  assert.deepEqual(CONTROL_BODY['/api/control/top3']({earlyEnabled:false,topEnabled:true,earlyJev:null,topJev:'x',confirm:'live',junk:1}),{earlyEnabled:false,topEnabled:true,earlyJev:null,confirm:'LIVE'});
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['t3Subs','btnT3Early','btnT3EarlyJev','btnT3Top','btnT3TopJev','t3EarlyRes','t3TopRes'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.includes("top3Control({[key]:true,confirm:'LIVE'}"));
  const srv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');assert.ok(srv.includes('earlyEnabled:body?.earlyEnabled,topEnabled:body?.topEnabled'));assert.ok(srv.includes("const RUNTIME_RELEASE='R2544.67-TOP3-SUBS'"));
  assert.ok(fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8').includes('strategy:signal.strategy||null'));
});
