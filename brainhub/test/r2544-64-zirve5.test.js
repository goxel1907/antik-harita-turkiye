'use strict';
// R2544.64 ZİRVE-5 SHORT: rules, the controller lane (scan -> armed zone -> equilibrium touch -> paper SHORT), own name in the
// records, Office/API switches for every lane (TEST and LIVE), JEV mode (with / without JEV) and the JEV packet size cap.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const Z=require('../zirve5');
const M15=900000;

// 15m candles through the given points (8 candles per leg); the last candle opens at lastOpen
function series(points,lastOpen){
  const out=[];for(let s=1;s<points.length;s++){const a=points[s-1],b=points[s];for(let i=1;i<=8;i++){const p=a+(b-a)*(i-1)/8,c=a+(b-a)*i/8;out.push([p,c]);}}
  const t0=lastOpen-(out.length-1)*M15;
  return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05}));
}
// flat start, top 103, dip 98, swing top 101.5, then the close breaks the 98 dip and price drifts lower (equilibrium not reached)
const PTS=[100,100,100,100,100,103,98,101.5,96,95.5,96.2,95.8];

test('R2544.64 rules: top 5 by 24 h range with volume >= 20M, only tradable USDT perps; plan = stop above the zone, 2R; touch = bid at the equilibrium',()=>{
  const tk=[{symbol:'AAAUSDT',highPrice:'130',lowPrice:'100',lastPrice:'120',quoteVolume:'30000000'},{symbol:'BBBUSDT',highPrice:'200',lowPrice:'50',lastPrice:'100',quoteVolume:'1000000'},
    {symbol:'CCCUSDT',highPrice:'11',lowPrice:'10',lastPrice:'10.5',quoteVolume:'90000000'},{symbol:'DDDUSDT',highPrice:'300',lowPrice:'100',lastPrice:'150',quoteVolume:'50000000'},
    {symbol:'EEEUSDC',highPrice:'300',lowPrice:'100',lastPrice:'150',quoteVolume:'50000000'}];
  const r=Z.rankByRange(tk,Z.DEFAULT_CONFIG,new Set(['AAAUSDT','BBBUSDT','CCCUSDT']));
  assert.deepEqual(r.map(x=>x.symbol),['AAAUSDT','CCCUSDT'],'BBB has too little volume, DDD is not tradable, EEEUSDC is not USDT');
  assert.equal(r[0].rank,1);assert.equal(r[0].range,0.25);
  assert.equal(Z.rankByRange(Array.from({length:9},(_,i)=>({symbol:'XX'+i+'USDT',highPrice:String(20+i),lowPrice:'10',lastPrice:'15',quoteVolume:'3e7'}))).length,5,'top 5 only');
  const zone={equilibrium:100,stopPrice:102.1,top:102};
  const p=Z.plan(100,zone);assert.equal(p.ok,true);assert.ok(Math.abs(p.stopPct-0.021)<1e-9);assert.ok(Math.abs(p.tpPrice-95.8)<1e-9,'2R below the entry');
  assert.equal(Z.plan(100,{stopPrice:100.1}).reason,'ZIRVE5_STOP_OUT_OF_BAND');assert.equal(Z.plan(100,{stopPrice:120}).reason,'ZIRVE5_STOP_OUT_OF_BAND');
  assert.equal(Z.touched(zone,99.99),false);assert.equal(Z.touched(zone,100),true);assert.equal(Z.touched(zone,102.2),false,'through the stop = not an entry');
});

test('R2544.64 armed zones are the chart\'s waiting SHORT zones (fibo-zones.js): dip break -> [broken dip, swing top]',()=>{
  const c=series(PTS,Date.UTC(2026,9,20,10,0));
  const zs=Z.armedShortZones(c);
  assert.equal(zs.length,1,JSON.stringify(zs));
  assert.ok(Math.abs(zs[0].bottom-97.95)<1e-9,'the broken 98 dip');assert.ok(Math.abs(zs[0].top-101.55)<1e-9,'the swing top that made the break');
  assert.ok(Math.abs(zs[0].equilibrium-99.75)<1e-9);assert.ok(Math.abs(zs[0].stopPrice-101.55*1.001)<1e-9);
  // price back above the zone top -> no armed zone; equilibrium already touched -> not waiting any more
  assert.equal(Z.armedShortZones(series([...PTS,102.5],Date.UTC(2026,9,20,12,0))).length,0);
  assert.equal(Z.armedShortZones(series([...PTS,99.9],Date.UTC(2026,9,20,12,0))).length,0);
});

const FAKE={apiKey:'fake-test-key-r64',apiSecret:'fake-test-secret-r64'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({z5=null,judge=undefined,mode='TEST'}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r64-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));   // İlk 3 off: ZİRVE-5 runs on its own switch
  if(z5)fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify(z5));
  writeTradingMode(root,{mode,changedAt:'2026-10-20T08:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  const bar=Date.UTC(2026,9,20,10,0),state={now:bar+M15+10000,calls:[],px:{Z5USDT:{bid:95.8,ask:95.81}},k15:{Z5USDT:series(PTS,bar)}},events=[];
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push(`${m} ${p}`);
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['Z5USDT','CALMUSDT','THINUSDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'Z5USDT',highPrice:'110',lowPrice:'90',lastPrice:'96',quoteVolume:'50000000',priceChangePercent:'-5'},
      {symbol:'THINUSDT',highPrice:'200',lowPrice:'50',lastPrice:'100',quoteVolume:'1000000',priceChangePercent:'40'},{symbol:'CALMUSDT',highPrice:'101',lowPrice:'99',lastPrice:'100',quoteVolume:'90000000',priceChangePercent:'0.1'},
      {symbol:'DELISTUSDT',highPrice:'300',lowPrice:'100',lastPrice:'150',quoteVolume:'50000000',priceChangePercent:'50'}]);
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines'&&u.searchParams.get('interval')==='15m'){const k=state.k15[u.searchParams.get('symbol')]||[];return ok(k.map(r=>[r.openTime,String(r.open),String(r.high),String(r.low),String(r.close),'0',r.closeTime,'1000']));}
    throw new Error('UNEXPECTED '+m+' '+p);};
  const store={journal:(k,s,p)=>{events.push({k,s,p});},recordLearning:()=>{}};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store,scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}},...(judge!==undefined?{zirve5Judge:judge}:{})});
  return {root,state,events,controller,kinds:k=>events.filter(e=>e.k===k)};
}

test('R2544.64 controller: scan arms the top-5 coin\'s zone, the equilibrium touch opens a paper SHORT under the lane\'s own name',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();
  assert.equal((await f.controller.testSupervisorTick()).action,'TEST_ARMED');
  const r1=await f.controller.z5Tick();
  assert.equal(r1.scanned,true);assert.equal(r1.entries,0,'price is under the equilibrium: wait');
  const st=f.controller.z5Status();
  assert.equal(st.name,'ZİRVE-5 SHORT');assert.equal(st.gate,'OPEN');assert.equal(st.decisions,'RULE');
  assert.deepEqual(st.lastScan.top.map(x=>x.symbol),['Z5USDT','CALMUSDT'],'THIN has too little volume, DELIST is not tradable');
  assert.equal(st.armed.length,1);assert.equal(st.armed[0].symbol,'Z5USDT');assert.ok(Math.abs(st.armed[0].zones[0].equilibrium-99.75)<1e-9);
  assert.equal(f.kinds('ZIRVE5_SCAN').length,1);
  // same candle: no new scan; bid reaches the equilibrium -> SHORT at market
  f.state.now+=5000;f.state.px.Z5USDT={bid:99.76,ask:99.77};
  const r2=await f.controller.z5Tick();
  assert.equal(r2.scanned,false);assert.equal(r2.entries,1,JSON.stringify(f.controller.z5Status().recentEntries));
  const a=Object.values(f.controller._testTop3State().active)[0];
  assert.equal(a.lane,'ZIRVE5');assert.equal(a.rule,'ZIRVE5_FIBO_SHORT');assert.equal(a.side,'SHORT');assert.equal(a.mode,'TEST');
  assert.equal(a.stopPrice,101.66,'0.1 % above the 101.55 zone top, rounded up to the tick');
  const s=a.stopPrice/a.entryPrice-1;const sRaw=101.55*1.001/a.entryPrice-1;assert.ok(Math.abs(a.tpPrice-a.entryPrice*(1-2*sRaw))<0.011&&Math.abs(a.tpPrice-a.entryPrice*(1-2*s))<0.03,'2R target from the real fill '+JSON.stringify({e:a.entryPrice,st:a.stopPrice,tp:a.tpPrice}));
  assert.equal(a.rulesVersion,undefined,'no İlk 3 break-even rule on this lane');
  assert.equal(f.kinds('ZIRVE5_ENTRY').length,1);assert.equal(f.kinds('TOP3_ENTRY').length,0);
  assert.equal(f.controller.z5Status().active.length,1);assert.equal(f.controller.top3Status().active.length,0,'İlk 3 never shows ZİRVE-5 lots');
  // one try per zone and one lot per coin
  f.state.now+=5000;assert.equal((await f.controller.z5Tick()).entries,0);
  // the close is booked under ZIRVE5 with its own setup, 15m, exit names and event id
  const rec=f.controller._testTop3CloseRecord({...a,exitReason:'TOP3_STOP',exitPrice:a.stopPrice,closedAt:f.state.now},{net:-2,realized:-1.9,commission:0.1,funding:0},null);
  assert.equal(rec.tradeLane,'ZIRVE5');assert.equal(rec.setup,'ZIRVE5_FIBO_SHORT');assert.equal(rec.originTF,'15m');assert.equal(rec.exitType,'ZIRVE5_STOP');
  assert.equal(rec.entryContext.lane,'ZIRVE5');assert.equal(rec.entryContext.setupFamily,'ZIRVE5');assert.match(rec.eventId,/^ZIRVE5:z5/);assert.equal(rec.learningAuthority,'EXCLUDED_ZIRVE5_LANE');
  assert.ok(rec.rMultiple<0);
  assert.equal(require('../office-performance').laneOf(rec),'ZIRVE5','Office books it on the ZİRVE-5 desk');
});

test('R2544.64 switches: ZİRVE-5 off stops it at once (no scan, armed zones cleared) and on starts it again; İlk 3 off does not stop it',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();await f.controller.testSupervisorTick();await f.controller.z5Tick();
  assert.equal(f.controller.z5Status().armed.length,1);
  const off=f.controller.selectLanes({zirve5:false,source:'OFFICE'});assert.equal(off.ok,true);assert.equal(off.lanes.zirve5.selected,false);
  assert.equal(f.controller.z5Status().armed.length,0,'armed zones dropped');assert.equal(f.controller.z5Status().gate,'ZIRVE5_DISABLED');
  f.state.now+=M15;f.state.px.Z5USDT={bid:99.8,ask:99.81};
  assert.equal((await f.controller.z5Tick()).reason,'ZIRVE5_DISABLED');assert.equal(Object.keys(f.controller._testTop3State().active).length,0,'no entry while off');
  const on=f.controller.configureZ5({enabled:true,source:'OFFICE'});assert.equal(on.switches.enabled,true);assert.equal(on.gate,'OPEN');
  assert.equal(f.controller.laneStatus().zirve5.selected,true);assert.equal(f.controller.laneStatus().zirve5.active,true);
  assert.equal(f.kinds('ZIRVE5_CONFIG_CHANGED').length,2);
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

test('R2544.64 JEV mode: with JEV every entry needs APPROVE_ENTRY (reject = no order); without JEV the rule enters; JEV missing = no entry',async()=>{
  require('../binance-rate-limit').resetForTests();
  const seen=[];let decision='REJECT_ENTRY';
  const judge=async a=>{seen.push(a);return {ok:true,called:true,decision,reason:decision==='APPROVE_ENTRY'?'WEAK_RETEST':'SQUEEZE_RISK'};};
  const f=fixture({z5:{enabled:true,jevMode:true},judge});await f.controller.testSupervisorTick();
  assert.equal(f.controller.z5Status().decisions,'RULE_PLUS_JEV');
  await f.controller.z5Tick();f.state.now+=5000;f.state.px.Z5USDT={bid:99.76,ask:99.77};
  assert.equal((await f.controller.z5Tick()).entries,0);
  assert.equal(seen.length,1);assert.equal(seen[0].signal.side,'SHORT');assert.ok(Math.abs(seen[0].signal.zone.top-101.55)<1e-9);assert.equal(seen[0].features.rank,1);
  assert.equal(f.kinds('ZIRVE5_JEV_REVIEW')[0].p.decision,'REJECT_ENTRY');assert.equal(f.controller.z5Status().recentEntries[0].reason,'ZIRVE5_JEV_NOT_APPROVED');
  // next candle: zone armed again by the scan, JEV approves -> order
  decision='APPROVE_ENTRY';f.state.now+=M15;f.state.k15.Z5USDT=series(PTS,Date.UTC(2026,9,20,10,15));f.state.px.Z5USDT={bid:95.9,ask:95.91};
  await f.controller.z5Tick();f.state.now+=5000;f.state.px.Z5USDT={bid:99.76,ask:99.77};
  assert.equal((await f.controller.z5Tick()).entries,1);
  assert.equal(Object.values(f.controller._testTop3State().active)[0].jev.decision,'APPROVE_ENTRY');
  // JEV mode on but no JEV wired: fail closed
  const g=fixture({z5:{enabled:true,jevMode:true},judge:null});await g.controller.testSupervisorTick();
  assert.equal(g.controller.z5Status().gate,'ZIRVE5_JEV_UNAVAILABLE');
  // switch JEV off from Office -> rule only
  assert.equal(g.controller.configureZ5({jevMode:false}).decisions,'RULE');assert.equal(g.controller.z5Status().gate,'OPEN');
});

test('R2544.64 JEV ZİRVE-5 gate: the request with a real 86 kB market packet stays under the 48 kB cap and keeps the rule, zone and decision guide',async()=>{
  const {createJevClient}=require('../jev-decision');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r64-jev-'));fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  const packet=require('./fixtures/r42-carv-r41-packet.json').packet;assert.ok(Buffer.byteLength(JSON.stringify(packet))>80000);
  let sent=null;
  const reply=(status,payload)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},text:async()=>JSON.stringify(payload)});
  const c=createJevClient({root,apiKey:'sk-or-v1-fake',clock:()=>Date.UTC(2026,9,20,10,20),fetchImpl:async(_,o)=>{sent=o.body;return reply(200,{answers:{zirve5_decision:{choice:'APPROVE_ENTRY'},zirve5_reason:{choice:'WEAK_RETEST'}},usage:{cost:0.00001}});}});
  const zone={top:101.55,bottom:97.95,equilibrium:99.75,zoneAt:Date.UTC(2026,9,20,8,0)};
  const out=await c.sovereignZirve5Gate({symbol:packet.symbol,signal:{ok:true,side:'SHORT',rule:'ZIRVE5_FIBO_SHORT',zone,targetR:2,maxHoldMs:24*3600000},
    features:{ok:true,rank:1,range24:0.2,change24:-5,bid:99.76},candle:Date.UTC(2026,9,20,10,0),chartContext:{available:true,symbol:packet.symbol,packet,asOf:Date.UTC(2026,9,20,10,15),ageMs:1000,source:'TEST'}});
  assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.decision,'APPROVE_ENTRY');assert.equal(out.reason,'WEAK_RETEST');assert.equal(out.mode,'ZIRVE5_GATE');
  const bytes=Buffer.byteLength(sent);assert.ok(bytes<=48000,'request '+bytes+' B');
  const body=JSON.parse(sent);
  assert.equal(body.state.record.contract,'R2544.64_ZIRVE5_GATE');assert.equal(body.state.record.zone.equilibrium,99.75);
  assert.ok(body.state.record.decisionGuide.approveWhen.length>=3&&body.state.record.decisionGuide.rejectWhen.length>=3,'the decision guide survives the size budget');
  assert.match(body.state.description,/APPROVE/);assert.ok(body.questions.zirve5_decision&&body.questions.zirve5_reason);
  // invalid signal never calls JEV
  let calls=0;const c2=createJevClient({root,apiKey:'sk-or-v1-fake',fetchImpl:async()=>{calls++;return reply(200,{});}});
  assert.equal((await c2.sovereignZirve5Gate({symbol:'XUSDT',signal:{ok:true,side:'LONG'},features:{ok:true}})).reason,'ZIRVE5_SIGNAL_INVALID');assert.equal(calls,0);
});

test('R2544.64 Office: switch routes forward only the ZİRVE-5 switches; lanes route carries zirve5; status cached and refreshed after a press',()=>{
  const {CONTROL_ROUTES,CONTROL_BODY}=require('../office-dashboard/office-server');
  assert.equal(CONTROL_ROUTES['/api/control/zirve5'],'/live/zirve5');
  assert.deepEqual(CONTROL_BODY['/api/control/zirve5']({enabled:false,jevMode:true,liveEnabled:true,confirm:'live',marginQuote:5,junk:1}),{source:'OFFICE',enabled:false,liveEnabled:true,jevMode:true,confirm:'LIVE'});
  assert.deepEqual(CONTROL_BODY['/api/control/lanes']({zirve5:true,top3:false,junk:true}),{source:'OFFICE',top3:false,zirve5:true});
  const src=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');
  assert.ok(src.includes("'/live/zirve5'"));assert.ok(src.includes("'top3', 'zirve5']) cache.delete(k)"));
  const srv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.ok(srv.includes("u.pathname==='/live/zirve5'"));assert.ok(srv.includes('live.z5Tick()'));assert.ok(srv.includes('zirve5Judge:jev.sovereignZirve5Gate'));
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['btnLaneZirve5','z5Card','btnZ5On','btnZ5Jev','btnZ5Live','z5Host'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.includes("ZIRVE5:'ZİRVE-5 SHORT'"));assert.ok(html.includes('/api/control/zirve5'));
});

test('R2544.64 deploy script expects exactly the Office and core versions this build ships (20.10 deploy stopped on a stale Office version)',()=>{
  const dep=fs.readFileSync(path.join(__dirname,'..','jev-brain','JEV-DEPLOY.ps1'),'utf8');
  const office=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8').match(/const OFFICE_VERSION = '([^']+)'/)[1];
  const core=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8').match(/const RUNTIME_RELEASE='([^']+)'/)[1];
  assert.equal(dep.match(/\$EXPECTED_OFFICE = '([^']+)'/)[1],office,'JEV-DEPLOY.ps1 $EXPECTED_OFFICE = office-server OFFICE_VERSION');
  assert.equal(dep.match(/\$EXPECTED_RELEASE = '([^']+)'/)[1],core,'JEV-DEPLOY.ps1 $EXPECTED_RELEASE = server RUNTIME_RELEASE');
});
