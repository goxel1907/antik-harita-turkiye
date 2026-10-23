'use strict';
// ZİRVE-5 (R2544.64 lane, R2544.68 rule = FiboBuLL video: LONG + SHORT, volume-confirmed entry): rules, the controller lane
// (scan -> confirmation candle at the 15m close -> paper order), own names in the records, Office/API switches for every lane
// (TEST and LIVE), JEV mode (with / without JEV) and the JEV packet size cap.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const Z=require('../zirve5');
const M15=900000;

// 15m candles through the given points (8 candles per leg), constant quote volume; the last candle opens at lastOpen
function series(points,lastOpen,qv=1000){
  const out=[];for(let s=1;s<points.length;s++){const a=points[s-1],b=points[s];for(let i=1;i<=8;i++){const p=a+(b-a)*(i-1)/8,c=a+(b-a)*i/8;out.push([p,c]);}}
  const t0=lastOpen-(out.length-1)*M15;
  return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05,quoteVolume:qv}));
}
// SHORT: flat, top 103, dip 98, swing top 101.5, close breaks the 98 dip (zone [97.95, 101.55]), low 95.5, back up into the zone to
// 99.4, then the LAST candle is a volume-backed strong bear candle inside the zone (99.6 -> 98.6, 5x volume). LONG = the mirror.
const P=[100,100,100,100,100,100,100,103,98,101.5,96,95.5,99.4];
function scenario(side,lastOpen,{qv=5000,conf=null}={}){
  const c=series(side==='SHORT'?P:P.map(x=>200-x),lastOpen-M15);
  const k=conf||(side==='SHORT'?{o:99.6,c:98.6}:{o:200-99.6,c:200-98.6});
  c.push({openTime:lastOpen,closeTime:lastOpen+M15-1,open:k.o,close:k.c,high:Math.max(k.o,k.c)+0.05,low:Math.min(k.o,k.c)-0.05,quoteVolume:qv});
  return c;
}

test('R2544.64/68 rules: top 5 by 24 h range with volume >= 20M, only tradable USDT perps; plan = stop beyond the zone, target the liquidity (at least 1R), both sides',()=>{
  const tk=[{symbol:'AAAUSDT',highPrice:'130',lowPrice:'100',lastPrice:'120',quoteVolume:'30000000'},{symbol:'BBBUSDT',highPrice:'200',lowPrice:'50',lastPrice:'100',quoteVolume:'1000000'},
    {symbol:'CCCUSDT',highPrice:'11',lowPrice:'10',lastPrice:'10.5',quoteVolume:'90000000'},{symbol:'DDDUSDT',highPrice:'300',lowPrice:'100',lastPrice:'150',quoteVolume:'50000000'},
    {symbol:'EEEUSDC',highPrice:'300',lowPrice:'100',lastPrice:'150',quoteVolume:'50000000'}];
  const r=Z.rankByRange(tk,Z.DEFAULT_CONFIG,new Set(['AAAUSDT','BBBUSDT','CCCUSDT']));
  assert.deepEqual(r.map(x=>x.symbol),['AAAUSDT','CCCUSDT'],'BBB has too little volume, DDD is not tradable, EEEUSDC is not USDT');
  assert.equal(r[0].rank,1);assert.equal(r[0].range,0.25);
  assert.equal(Z.rankByRange(Array.from({length:9},(_,i)=>({symbol:'XX'+i+'USDT',highPrice:String(20+i),lowPrice:'10',lastPrice:'15',quoteVolume:'3e7'}))).length,5,'top 5 only');
  // SHORT: stop 0.1 % above the zone, target the low made after the break; a target closer than 1R becomes 1R
  let p=Z.plan(100,{side:'SHORT',stopPrice:102,liquidity:94});assert.equal(p.ok,true);assert.ok(Math.abs(p.stopPct-0.02)<1e-9);assert.equal(p.tpPrice,94);assert.ok(Math.abs(p.targetR-3)<1e-9);
  p=Z.plan(100,{side:'SHORT',stopPrice:102,liquidity:99});assert.ok(Math.abs(p.tpPrice-98)<1e-9,'liquidity inside 1R -> 1R');assert.equal(p.targetR,1);
  // LONG mirror
  p=Z.plan(100,{side:'LONG',stopPrice:98,liquidity:106});assert.equal(p.ok,true);assert.equal(p.side,'LONG');assert.ok(Math.abs(p.stopPct-0.02)<1e-9);assert.equal(p.tpPrice,106);assert.ok(Math.abs(p.targetR-3)<1e-9);
  p=Z.plan(100,{side:'LONG',stopPrice:98,liquidity:101});assert.ok(Math.abs(p.tpPrice-102)<1e-9);
  assert.equal(Z.plan(100,{side:'SHORT',stopPrice:100.1}).reason,'ZIRVE5_STOP_OUT_OF_BAND');assert.equal(Z.plan(100,{side:'LONG',stopPrice:80}).reason,'ZIRVE5_STOP_OUT_OF_BAND');
  assert.equal(Z.setupFor('LONG'),'ZIRVE5_FIBO_LONG');assert.equal(Z.setupFor('SHORT'),'ZIRVE5_FIBO_SHORT');
});

test('R2544.68 video rule: a break makes the zone (top break -> LONG, dip break -> SHORT); entry only on a volume-backed strong candle closing inside it',()=>{
  const t=Date.UTC(2026,9,21,10,0);
  const s=Z.videoScan(scenario('SHORT',t));
  assert.equal(s.signals.length,1,JSON.stringify(s));const g=s.signals[0];
  assert.equal(g.side,'SHORT');assert.ok(Math.abs(g.bottom-97.95)<1e-9,'the broken 98 dip');assert.ok(Math.abs(g.top-101.55)<1e-9,'the swing top that made the break');
  assert.ok(Math.abs(g.stopPrice-101.55*1.001)<1e-9);assert.ok(Math.abs(g.liquidity-95.45)<1e-9,'the low made after the break');
  assert.equal(g.confirm.volMult,5);assert.ok(g.confirm.body>=0.5);assert.equal(g.confirmAt,t+M15-1);
  const l=Z.videoScan(scenario('LONG',t));
  assert.equal(l.signals.length,1);assert.equal(l.signals[0].side,'LONG');assert.ok(Math.abs(l.signals[0].top-102.05)<1e-9);assert.ok(Math.abs(l.signals[0].bottom-98.45)<1e-9);
  assert.ok(l.signals[0].stopPrice<l.signals[0].bottom,'LONG stop below the zone');
  // no confirmation: low volume, weak body, wrong colour -> the zone keeps waiting, no entry
  assert.equal(Z.videoScan(scenario('SHORT',t,{qv:1400})).signals.length,0,'1.4x volume is not "hacimli"');
  assert.equal(Z.videoScan(scenario('SHORT',t,{conf:{o:99.6,c:99.58}})).signals.length,0,'a weak body (0.02 of a 0.12 range = 17 %) is not "güçlü" (R2544.75: body >= 30 %)');
  assert.equal(Z.videoScan(scenario('SHORT',t,{conf:{o:99.6,c:99.55}})).signals.length,1,'R2544.75: a 33 % body confirms (measured 23.10: body 30 % n44 +0.31R vs 50 % n36 +0.22R)');
  assert.equal(Z.videoScan(scenario('SHORT',t,{conf:{o:98.6,c:99.6}})).signals.length,0,'a bull candle never confirms a SHORT');
  assert.ok(Z.videoScan(scenario('SHORT',t,{qv:1400})).waiting.some(w=>w.side==='SHORT'),'still waiting for the confirmation');
  // a close beyond the zone ends it
  assert.equal(Z.videoScan(scenario('SHORT',t,{conf:{o:101,c:102}})).waiting.filter(w=>w.side==='SHORT'&&Math.abs(w.top-101.55)<1e-9).length,0,'closed above the zone top: SHORT zone gone');
  // the confirmation is a one-time event: one candle later the same zone is used up, no second signal
  const c=scenario('SHORT',t);c.push({openTime:t+M15,closeTime:t+2*M15-1,open:98.6,close:98.4,high:98.7,low:98.3,quoteVolume:1000});
  assert.equal(Z.videoScan(c).signals.length,0);
  // the chart reads the same state
  const vs=Z.videoStates(scenario('SHORT',t)).zones.find(z=>z.side==='SHORT'&&Math.abs(z.top-101.55)<1e-9);assert.equal(vs.video.state,'CONFIRMED');
});

const FAKE={apiKey:'fake-test-key-r64',apiSecret:'fake-test-secret-r64'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({z5=null,judge=undefined,mode='TEST',top3={},side='SHORT'}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r64-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false,...top3}));   // İlk 3 off: ZİRVE-5 runs on its own switch
  // R2544.70: the synthetic charts carry no SFP sweep; these tests are about the order path -> the sweep rule is tested in r2544-70
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({requireSweep:false,...(z5||{})}));
  writeTradingMode(root,{mode,changedAt:'2026-10-20T08:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  const bar=Date.UTC(2026,9,20,10,0),k=scenario(side,bar),lastClose=k.at(-1).close;
  const state={now:bar+M15+10000,calls:[],px:{Z5USDT:{bid:lastClose,ask:lastClose+0.01}},k15:{Z5USDT:k}},events=[];
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push(`${m} ${p}`);
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['Z5USDT','CALMUSDT','THINUSDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'Z5USDT',highPrice:'110',lowPrice:'90',lastPrice:'96',quoteVolume:'50000000',priceChangePercent:'-5'},
      {symbol:'THINUSDT',highPrice:'200',lowPrice:'50',lastPrice:'100',quoteVolume:'1000000',priceChangePercent:'40'},{symbol:'CALMUSDT',highPrice:'101',lowPrice:'99',lastPrice:'100',quoteVolume:'90000000',priceChangePercent:'0.1'},
      {symbol:'DELISTUSDT',highPrice:'300',lowPrice:'100',lastPrice:'150',quoteVolume:'50000000',priceChangePercent:'50'}]);
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines'&&u.searchParams.get('interval')==='15m'){const kk=state.k15[u.searchParams.get('symbol')]||[];return ok(kk.map(r=>[r.openTime,String(r.open),String(r.high),String(r.low),String(r.close),'0',r.closeTime,String(r.quoteVolume)]));}
    throw new Error('UNEXPECTED '+m+' '+p);};
  const store={journal:(k,s,p)=>{events.push({k,s,p});},recordLearning:()=>{}};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store,scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}},...(judge!==undefined?{zirve5Judge:judge}:{})});
  // the next 15m candle (no confirmation): for tests that rescan
  const nextBar=()=>{const t=state.k15.Z5USDT.at(-1).openTime+M15,c=state.k15.Z5USDT.at(-1).close;state.k15.Z5USDT=[...state.k15.Z5USDT.slice(1),{openTime:t,closeTime:t+M15-1,open:c,close:c,high:c+0.02,low:c-0.02,quoteVolume:1000}];state.now=t+M15+10000;};
  return {root,state,events,controller,nextBar,kinds:k=>events.filter(e=>e.k===k)};
}

test('R2544.68 controller: the 15m scan sees the confirmation candle and enters at once - SHORT and LONG, each under its own name',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();
  assert.equal((await f.controller.testSupervisorTick()).action,'TEST_ARMED');
  const r1=await f.controller.z5Tick();
  assert.equal(r1.scanned,true);assert.equal(r1.entries,1,JSON.stringify(f.controller.z5Status().recentEntries));
  const st=f.controller.z5Status();
  assert.equal(st.name,'ZİRVE-5');assert.equal(st.gate,'OPEN');assert.equal(st.decisions,'RULE');assert.equal(st.switches.longEnabled,true);assert.equal(st.switches.shortEnabled,true);
  assert.deepEqual(st.lastScan.top.map(x=>x.symbol),['Z5USDT','CALMUSDT'],'THIN has too little volume, DELIST is not tradable');
  assert.equal(st.lastScan.top[0].signals[0].side,'SHORT');
  const a=Object.values(f.controller._testTop3State().active)[0];
  assert.equal(a.lane,'ZIRVE5');assert.equal(a.rule,'ZIRVE5_FIBO_SHORT');assert.equal(a.strategy,'ZIRVE5_FIBO_SHORT');assert.equal(a.side,'SHORT');assert.equal(a.mode,'TEST');
  assert.equal(a.stopPrice,101.66,'0.1 % above the 101.55 zone top, rounded up to the tick');
  assert.ok(Math.abs(a.tpPrice-95.45)<0.011,'target = the low made after the break (liquidity) '+a.tpPrice);assert.ok(a.targetR>=1);
  assert.equal(a.z5zone.confirm.volMult,5);assert.ok(a.z5zone.confirmAt>0);
  assert.equal(f.kinds('ZIRVE5_ENTRY').length,1);assert.equal(f.kinds('TOP3_ENTRY').length,0);
  assert.equal(st.active.length,1);assert.equal(f.controller.top3Status().active.length,0,'İlk 3 never shows ZİRVE-5 lots');
  // one try per zone and one lot per coin: the same candle never enters twice
  f.state.now+=5000;assert.equal((await f.controller.z5Tick()).entries,0);
  // the close is booked under ZIRVE5 with its own setup, 15m, exit names and event id
  const rec=f.controller._testTop3CloseRecord({...a,exitReason:'TOP3_STOP',exitPrice:a.stopPrice,closedAt:f.state.now},{net:-2,realized:-1.9,commission:0.1,funding:0},null);
  assert.equal(rec.tradeLane,'ZIRVE5');assert.equal(rec.setup,'ZIRVE5_FIBO_SHORT');assert.equal(rec.originTF,'15m');assert.equal(rec.exitType,'ZIRVE5_STOP');
  assert.equal(rec.entryContext.lane,'ZIRVE5');assert.equal(rec.entryContext.setupFamily,'ZIRVE5');assert.equal(rec.entryContext.entryTiming,'ZONE_VOLUME_CONFIRMATION');
  assert.match(rec.eventId,/^ZIRVE5:z5/);assert.equal(rec.learningAuthority,'EXCLUDED_ZIRVE5_LANE');assert.ok(rec.rMultiple<0);
  assert.equal(require('../office-performance').laneOf(rec),'ZIRVE5','Office books it on the ZİRVE-5 desk');
  // LONG mirror
  require('../binance-rate-limit').resetForTests();
  const g=fixture({side:'LONG'});await g.controller.testSupervisorTick();
  assert.equal((await g.controller.z5Tick()).entries,1);
  const b=Object.values(g.controller._testTop3State().active)[0];
  assert.equal(b.side,'LONG');assert.equal(b.rule,'ZIRVE5_FIBO_LONG');assert.ok(b.stopPrice<98.45,'stop below the zone');assert.ok(Math.abs(b.tpPrice-104.55)<0.011,'target the high made after the break');
  assert.equal(g.controller._testTop3CloseRecord({...b,exitReason:'TOP3_TAKE_PROFIT',exitPrice:b.tpPrice,closedAt:g.state.now},{net:3,realized:3.1,commission:0.1,funding:0},null).setup,'ZIRVE5_FIBO_LONG');
});

test('R2544.68 side switches: LONG off -> a LONG confirmation is noted and skipped; SHORT off likewise; both off -> lane gate closed',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({side:'LONG',z5:{enabled:true,longEnabled:false}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,0);
  assert.equal(f.controller.z5Status().recentEntries[0].reason,'ZIRVE5_SIDE_OFF');assert.equal(f.controller.z5Status().recentEntries[0].side,'LONG');
  require('../binance-rate-limit').resetForTests();
  const g=fixture({z5:{enabled:true,shortEnabled:false}});await g.controller.testSupervisorTick();
  assert.equal((await g.controller.z5Tick()).entries,0);assert.equal(g.controller.z5Status().recentEntries[0].reason,'ZIRVE5_SIDE_OFF');
  // switching from Office: OFF immediate, ON in TEST immediate, both off = gate closed
  assert.equal(g.controller.configureZ5({shortEnabled:true}).switches.shortEnabled,true);
  assert.equal(g.controller.configureZ5({longEnabled:false,shortEnabled:false}).gate,'ZIRVE5_NO_SIDE');
  const ch=g.kinds('ZIRVE5_CONFIG_CHANGED').at(-1).p;assert.equal(ch.after.longEnabled,false);assert.equal(ch.after.shortEnabled,false);
  // LIVE: a side ON needs the LIVE confirmation, OFF never
  require('../binance-rate-limit').resetForTests();
  const L=fixture({mode:'LIVE',z5:{enabled:true,liveEnabled:true,longEnabled:false}});
  assert.deepEqual(L.controller.configureZ5({longEnabled:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(L.controller.configureZ5({longEnabled:true,confirm:'LIVE'}).switches.longEnabled,true);
  assert.equal(L.controller.configureZ5({shortEnabled:false}).switches.shortEnabled,false,'OFF needs no confirmation');
});

test('R2544.64 switches: ZİRVE-5 off stops it at once (no scan, waiting zones cleared) and on starts it again; İlk 3 off does not stop it',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true}},);await f.controller.testSupervisorTick();
  const off=f.controller.selectLanes({zirve5:false,source:'OFFICE'});assert.equal(off.ok,true);assert.equal(off.lanes.zirve5.selected,false);
  assert.equal(f.controller.z5Status().armed.length,0,'waiting zones dropped');assert.equal(f.controller.z5Status().gate,'ZIRVE5_DISABLED');
  assert.equal((await f.controller.z5Tick()).reason,'ZIRVE5_DISABLED');assert.equal(Object.keys(f.controller._testTop3State().active).length,0,'no entry while off');
  const on=f.controller.configureZ5({enabled:true,source:'OFFICE'});assert.equal(on.switches.enabled,true);assert.equal(on.gate,'OPEN');
  const re=await f.controller.z5Tick();assert.equal(re.scanned,true,'switching ON rescans the last closed candle at once');assert.equal(re.entries,1);
  assert.equal(f.controller.laneStatus().zirve5.selected,true);assert.equal(f.controller.laneStatus().zirve5.active,true);assert.equal(f.controller.laneStatus().zirve5.name,'ZİRVE-5');
  assert.equal(f.kinds('ZIRVE5_CONFIG_CHANGED').length,2);
  // the next candle has no confirmation: the remaining zones wait, nothing is queued from before
  f.nextBar();assert.equal((await f.controller.z5Tick()).entries,0);
});

test('R2544.64 every lane switch works both ways in TEST and in LIVE (ON in LIVE needs the LIVE confirmation, OFF never does)',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();await f.controller.testSupervisorTick();
  const sel=k=>{const l=f.controller.laneStatus();return k==='normal'||k==='top3'||k==='zirve5'?l[k].selected:l.normal.sub[k].selected;};
  for(const k of ['normal','top3','zirve5','scalp5m','trade15m','burst']){
    assert.equal(f.controller.selectLanes({[k]:false}).ok,true,k);assert.equal(sel(k),false,'TEST off '+k);
    assert.equal(f.controller.selectLanes({[k]:true}).ok,true,k);assert.equal(sel(k),true,'TEST on '+k);
  }
  // normal lane follows OTO while the run is on
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'config','leader-auto.json'),'utf8')).enabled,true);
  f.controller.selectLanes({normal:false});assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'config','leader-auto.json'),'utf8')).enabled,false);
});

test('R2544.64 LIVE: every lane switch OFF works without confirmation, ON needs LIVE; ZİRVE-5 trades in LIVE only with its LIVE permission',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({mode:'LIVE'});
  const sel=k=>{const l=f.controller.laneStatus();return k==='normal'||k==='top3'||k==='zirve5'?l[k].selected:l.normal.sub[k].selected;};
  assert.equal(f.controller.z5Status().tradingMode,'LIVE');assert.equal(f.controller.z5Status().gate,'ZIRVE5_LIVE_DISABLED','default: no LIVE permission');
  for(const k of ['normal','top3','zirve5','scalp5m','trade15m','burst']){
    assert.equal(f.controller.selectLanes({[k]:false}).ok,true,'LIVE off without confirmation '+k);assert.equal(sel(k),false,'LIVE off '+k);
    assert.deepEqual(f.controller.selectLanes({[k]:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED'],'LIVE on needs LIVE '+k);assert.equal(sel(k),false);
    assert.equal(f.controller.selectLanes({[k]:true,confirm:'LIVE'}).ok,true,k);assert.equal(sel(k),true,'LIVE on '+k);
  }
  const z=f.controller.z5Status();assert.equal(z.switches.liveEnabled,true,'the LIVE choice is recorded');
  assert.equal(z.gate,'LIVE_NOT_ARMED','permission given; the user still starts the run');
  assert.equal(f.controller.laneStatus().top3.liveAllowed,true);assert.equal(f.controller.laneStatus().zirve5.liveAllowed,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'config','leader-auto.json'),'utf8')).enabled,false,'the normal lane never starts OTO while the run is stopped');
  assert.deepEqual(f.controller.configureZ5({liveEnabled:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.deepEqual(f.controller.configureZ5({enabled:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED'],'ON in LIVE needs LIVE');
  f.controller.selectLanes({zirve5:false});
  assert.equal(f.controller.z5Status().switches.enabled,false);assert.equal(f.controller.z5Status().switches.liveEnabled,false,'lane OFF in LIVE also withdraws the LIVE permission');
  assert.equal(f.controller.z5Status().gate,'ZIRVE5_DISABLED');
  assert.equal(f.controller.configureZ5({jevMode:true}).switches.jevMode,true,'JEV mode is a stricter choice: no LIVE confirmation needed');
});

test('R2544.64/68 JEV mode: with JEV every entry needs APPROVE_ENTRY (reject = no order); without JEV the rule enters; JEV missing = no entry',async()=>{
  require('../binance-rate-limit').resetForTests();
  const seen=[];let decision='REJECT_ENTRY';
  const judge=async a=>{seen.push(a);return {ok:true,called:true,decision,reason:decision==='APPROVE_ENTRY'?'WEAK_RETEST':'SQUEEZE_RISK'};};
  const f=fixture({z5:{enabled:true,jevMode:true},judge});await f.controller.testSupervisorTick();
  assert.equal(f.controller.z5Status().decisions,'RULE_PLUS_JEV');
  assert.equal((await f.controller.z5Tick()).entries,0);
  assert.equal(seen.length,1);assert.equal(seen[0].signal.side,'SHORT');assert.equal(seen[0].signal.rule,'ZIRVE5_FIBO_SHORT');assert.ok(Math.abs(seen[0].signal.zone.top-101.55)<1e-9);
  assert.equal(seen[0].features.rank,1);assert.equal(seen[0].features.confirmVolMult,5);
  assert.equal(f.kinds('ZIRVE5_JEV_REVIEW')[0].p.decision,'REJECT_ENTRY');assert.equal(f.controller.z5Status().recentEntries[0].reason,'ZIRVE5_JEV_NOT_APPROVED');
  // JEV approves -> order (a fresh confirmation on a new lane instance)
  require('../binance-rate-limit').resetForTests();
  decision='APPROVE_ENTRY';const h=fixture({z5:{enabled:true,jevMode:true},judge,side:'LONG'});await h.controller.testSupervisorTick();
  assert.equal((await h.controller.z5Tick()).entries,1);
  assert.equal(seen.at(-1).signal.side,'LONG');assert.equal(Object.values(h.controller._testTop3State().active)[0].jev.decision,'APPROVE_ENTRY');
  // JEV mode on but no JEV wired: fail closed
  const g=fixture({z5:{enabled:true,jevMode:true},judge:null});await g.controller.testSupervisorTick();
  assert.equal(g.controller.z5Status().gate,'ZIRVE5_JEV_UNAVAILABLE');
  // switch JEV off from Office -> rule only
  assert.equal(g.controller.configureZ5({jevMode:false}).decisions,'RULE');assert.equal(g.controller.z5Status().gate,'OPEN');
});

test('R2544.64/68 JEV ZİRVE-5 gate: the request with a real 86 kB market packet stays under the 48 kB cap and keeps the rule, zone, confirmation and decision guide (both sides)',async()=>{
  const {createJevClient}=require('../jev-decision');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r64-jev-'));fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  const packet=require('./fixtures/r42-carv-r41-packet.json').packet;assert.ok(Buffer.byteLength(JSON.stringify(packet))>80000);
  let sent=null;
  const reply=(status,payload)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},text:async()=>JSON.stringify(payload)});
  for(const side of ['SHORT','LONG']){
    const c=createJevClient({root,apiKey:'sk-or-v1-fake',clock:()=>Date.UTC(2026,9,20,10,20),fetchImpl:async(_,o)=>{sent=o.body;return reply(200,{answers:{zirve5_decision:{choice:'APPROVE_ENTRY'},zirve5_reason:{choice:'WEAK_RETEST'}},usage:{cost:0.00001}});}});
    const zone={side,top:101.55,bottom:97.95,equilibrium:99.75,liquidity:side==='SHORT'?95.45:104.5,zoneAt:Date.UTC(2026,9,20,8,0),confirmAt:Date.UTC(2026,9,20,10,15)};
    const out=await c.sovereignZirve5Gate({symbol:packet.symbol,signal:{ok:true,side,rule:Z.setupFor(side),zone,maxHoldMs:24*3600000},
      features:{ok:true,rank:1,range24:0.2,change24:-5,confirmBody:0.9,confirmVolMult:5,confirmClose:98.6},candle:Date.UTC(2026,9,20,10,0),chartContext:{available:true,symbol:packet.symbol,packet,asOf:Date.UTC(2026,9,20,10,15),ageMs:1000,source:'TEST'}});
    assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.decision,'APPROVE_ENTRY');assert.equal(out.reason,'WEAK_RETEST');assert.equal(out.mode,'ZIRVE5_GATE');
    const bytes=Buffer.byteLength(sent);assert.ok(bytes<=48000,'request '+bytes+' B');
    const body=JSON.parse(sent);
    assert.equal(body.state.record.contract,'R2544.68_ZIRVE5_GATE');assert.equal(body.state.record.side,side);assert.equal(body.state.record.zone.equilibrium,99.75);
    assert.equal(body.state.record.confirmation.volumeVsMedian24h,5);assert.equal(body.state.record.rule,Z.setupFor(side));
    assert.ok(body.state.record.decisionGuide.approveWhen.length>=3&&body.state.record.decisionGuide.rejectWhen.length>=3,'the decision guide survives the size budget');
    assert.doesNotMatch(JSON.stringify(body.state.record.decisionGuide),/already falling over 24 h/,'the wrong 24 h hint is gone');
    assert.match(body.state.description,/APPROVE/);assert.match(body.state.description,new RegExp(side));assert.ok(body.questions.zirve5_decision&&body.questions.zirve5_reason);
  }
  // invalid signal never calls JEV
  let calls=0;const c2=createJevClient({root,apiKey:'sk-or-v1-fake',fetchImpl:async()=>{calls++;return reply(200,{});}});
  assert.equal((await c2.sovereignZirve5Gate({symbol:'XUSDT',signal:{ok:true,side:'SIDEWAYS',zone:{}},features:{ok:true}})).reason,'ZIRVE5_SIGNAL_INVALID');assert.equal(calls,0);
});

test('R2544.64/68 Office: switch routes forward only the ZİRVE-5 switches; lanes route carries zirve5; status cached and refreshed after a press',()=>{
  const {CONTROL_ROUTES,CONTROL_BODY}=require('../office-dashboard/office-server');
  assert.equal(CONTROL_ROUTES['/api/control/zirve5'],'/live/zirve5');
  assert.deepEqual(CONTROL_BODY['/api/control/zirve5']({enabled:false,jevMode:true,liveEnabled:true,longEnabled:true,shortEnabled:false,confirm:'live',marginQuote:5,junk:1,requireFalling24h:true}),
    {source:'OFFICE',enabled:false,liveEnabled:true,jevMode:true,longEnabled:true,shortEnabled:false,marginQuote:5,confirm:'LIVE'},'side switches and margin are forwarded (core validates, LIVE needs LIVE); junk and the removed 24 h switch are dropped');
  assert.deepEqual(CONTROL_BODY['/api/control/lanes']({zirve5:true,top3:false,junk:true}),{source:'OFFICE',top3:false,zirve5:true});
  const src=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');
  assert.ok(src.includes("'/live/zirve5'"));assert.ok(src.includes("'top3', 'zirve5']) cache.delete(k)"));
  const srv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.ok(srv.includes("u.pathname==='/live/zirve5'"));assert.ok(srv.includes('live.z5Tick()'));assert.ok(srv.includes('zirve5Judge:jev.sovereignZirve5Gate'));
  assert.ok(srv.includes('longEnabled:body?.longEnabled,shortEnabled:body?.shortEnabled'));assert.ok(!srv.includes('requireFalling24h'));
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['btnLaneZirve5','z5Card','btnZ5On','btnZ5Long','btnZ5Short','btnZ5Jev','btnZ5Live','z5Host','z5Margin','z5Lev','btnZ5Save'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.includes("ZIRVE5:'ZİRVE-5'"));assert.ok(html.includes('/api/control/zirve5'));
  assert.ok(!html.includes('btnZ5Fall')&&!html.includes('requireFalling24h'),'the 24 h falling switch is gone');
  assert.match(html,/hacimli, güçlü bir boğa/);
});

test('R2544.64 deploy script expects exactly the Office and core versions this build ships (20.10 deploy stopped on a stale Office version)',()=>{
  const dep=fs.readFileSync(path.join(__dirname,'..','jev-brain','JEV-DEPLOY.ps1'),'utf8');
  const office=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8').match(/const OFFICE_VERSION = '([^']+)'/)[1];
  const core=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8').match(/const RUNTIME_RELEASE='([^']+)'/)[1];
  assert.equal(dep.match(/\$EXPECTED_OFFICE = '([^']+)'/)[1],office,'JEV-DEPLOY.ps1 $EXPECTED_OFFICE = office-server OFFICE_VERSION');
  assert.equal(dep.match(/\$EXPECTED_RELEASE = '([^']+)'/)[1],core,'JEV-DEPLOY.ps1 $EXPECTED_RELEASE = server RUNTIME_RELEASE');
});

test('R2544.67.3 self-audit: without its own margin ZİRVE-5 sizes by risk (2 % of equity at the stop) - it never borrows İlk 3\'s fixed margin (BTW 20.10: 70 USDT x 10x put ~30 % of the TEST account at risk)',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({top3:{marginQuote:70,leverage:10}});await f.controller.testSupervisorTick();
  assert.equal(f.controller.z5Status().sizing.automatic,true);assert.equal(f.controller.z5Status().sizing.riskPct,0.02);
  assert.equal((await f.controller.z5Tick()).entries,1);
  const a=Object.values(f.controller._testTop3State().active)[0],equity=100;
  assert.ok(Math.abs(a.riskQuote-equity*0.02)<0.1,'about 2 USDT lost at the stop, got '+a.riskQuote);
  assert.ok(a.notional<70*10,'not the İlk 3 margin x leverage ('+a.notional+')');
  // its own margin is used as is (the user's choice), like İlk 3
  require('../binance-rate-limit').resetForTests();
  const g=fixture({top3:{marginQuote:70,leverage:10},z5:{enabled:true,marginQuote:10,leverage:5}});await g.controller.testSupervisorTick();
  assert.equal(g.controller.z5Status().sizing.automatic,false);
  assert.equal((await g.controller.z5Tick()).entries,1);
  const b=Object.values(g.controller._testTop3State().active)[0];assert.ok(Math.abs(b.notional-50)<1,'10 USDT x 5x = 50, got '+b.notional);
});
