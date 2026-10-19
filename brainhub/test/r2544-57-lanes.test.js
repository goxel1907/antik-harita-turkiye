'use strict';
// R2544.57 HAT ANAHTARLARI (user 13.10.2026): "istediğimde İlk 3 Avcısını Binance bakiye yükleyip istediğim marj ve
// kaldıraçta live durumuna geçirebileyim; JEV kararı ayrı: İlk 3 JEV'li / JEV'siz; normal sistem seçildiğinde yalnız JEV
// karar vererek işlemler açılsın; ayrı ayrı; kusursuz olmalı". Normal sistem (JEV hatları, OTO) and İlk 3 Avcısı are
// selected separately in TEST and LIVE; a LIVE start takes the selected lanes; İlk 3 margin/leverage from Office.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readTradingMode,writeTradingMode}=require('../binance-live-transport');
const T3=require('../top3-hunter');

const FAKE={apiKey:'fake-test-key-r57',apiSecret:'fake-test-secret-r57'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({mode='TEST',lanes=undefined,top3=null,realAvail=250,scanner=null}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r57-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  if(lanes!==undefined)fs.writeFileSync(path.join(root,'config','lane-selection.json'),JSON.stringify(lanes));
  if(top3)fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify(top3));
  writeTradingMode(root,{mode,changedAt:'2026-10-13T10:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  const state={now:1791370000000,realAvail,realWallet:realAvail,realPositions:[],calls:[]},events=[];
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push(`${m} ${p}`);
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker')return ok({symbol:u.searchParams.get('symbol'),bidPrice:'10',askPrice:'10.01'});
    if(p==='/fapi/v3/account')return ok({availableBalance:String(state.realAvail),totalWalletBalance:String(state.realWallet),positions:[]});
    if(p==='/fapi/v3/positionRisk')return ok(state.realPositions);
    if(p==='/fapi/v1/positionSide/dual')return ok({dualSidePosition:false});
    if(p==='/fapi/v1/income')return ok([]);
    throw new Error('UNEXPECTED '+m+' '+p);};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k,s,p)=>events.push({k,s,p})},
    scanner:scanner||{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  const oto=()=>JSON.parse(fs.readFileSync(path.join(root,'config','leader-auto.json'),'utf8')).enabled;
  const t3=()=>T3.readTop3Config(root);
  const settle=async(until,n=8)=>{for(let i=0;i<n&&!until();i++){state.now+=5000;await controller.testSupervisorTick();}};
  return {root,state,events,controller,oto,t3,settle,kinds:k=>events.filter(e=>e.k===k)};
}

test('R57 default after deploy: normal lane NOT selected (no JEV calls while the user tests İlk 3), the TEST run still arms',async()=>{
  const f=fixture({top3:{enabled:true}});
  const r=await f.controller.testSupervisorTick();
  assert.equal(r.action,'TEST_ARMED');assert.equal(f.oto(),false,'OTO is not forced on any more');
  const st=f.controller.status().tradingMode.run;
  assert.equal(st.state,'TEST_RUNNING','armed = running, even with İlk 3 alone');
  assert.equal(st.lanes.normal.selected,false);assert.equal(st.lanes.normal.defaulted,true);assert.equal(st.lanes.normal.active,false);
  assert.equal(st.lanes.top3.selected,true);assert.equal(st.lanes.top3.active,true);assert.equal(st.lanes.top3.decisions,'RULE');
  assert.equal(f.controller.top3Status().gate,'OPEN','İlk 3 runs without OTO');
});

test('R57 lanes in TEST: the normal lane switches OTO only while the run is on; İlk 3 on starts its 24 h window',async()=>{
  const f=fixture();
  // stopped: selecting the normal lane only remembers it (no analysis / JEV spend while not running)
  assert.equal(f.controller.selectLanes({normal:true}).ok,true);assert.equal(f.oto(),false);
  await f.controller.testSupervisorTick();assert.equal(f.controller.status().armed,true);assert.equal(f.oto(),true,'run on -> OTO follows the selection');
  assert.equal(f.controller.selectLanes({normal:false}).ok,true);assert.equal(f.oto(),false,'off is immediate');
  await f.controller.testSupervisorTick();assert.equal(f.oto(),false,'and stays off');
  const on=f.controller.selectLanes({top3:true});
  assert.equal(on.ok,true);assert.equal(f.t3().enabled,true);assert.equal(f.controller.top3Status().testWindow.source,'SWITCHED_ON');
  assert.deepEqual(f.controller.selectLanes({}).reasons,['LANE_SWITCH_MISSING']);
  assert.equal(f.kinds('LANES_SELECTED').length,3);
  // STOP turns OTO off but keeps the selection; START_TEST brings the selected lanes back
  f.controller.selectLanes({normal:true});
  await f.controller.runControl({action:'STOP'});assert.equal(f.oto(),false);assert.equal(f.controller.laneStatus().normal.selected,true);
  await f.controller.runControl({action:'START_TEST'});assert.equal(f.oto(),true);
});

test('R57 LIVE with İlk 3 only: balance checked against the İlk 3 margin, OTO stays OFF, İlk 3 live, no JEV lane',async()=>{
  const f=fixture({lanes:{normal:false},top3:{enabled:true},realAvail:25});
  await f.controller.testSupervisorTick();
  const r=await f.controller.runControl({action:'GO_LIVE'});
  assert.equal(r.ok,true,JSON.stringify(r));
  await f.settle(()=>f.controller.status().tradingMode.run.state==='LIVE_RUNNING');
  const st=f.controller.status();
  assert.equal(st.tradingMode.mode,'LIVE');assert.equal(st.armed,true);assert.equal(st.tradingMode.run.armSource,'USER_GO_LIVE');
  assert.equal(f.oto(),false,'normal lane not selected -> no JEV entries in LIVE');
  assert.equal(f.t3().liveEnabled,true,'İlk 3 goes live because it was selected');
  assert.equal(f.controller.top3Status().gate,'OPEN');
  assert.ok(f.events.some(e=>e.k==='LIVE_STARTED'&&e.p.marginQuote===20),'required balance = İlk 3 automatic margin floor (20), not the 32 OTO margin');
  assert.deepEqual(f.kinds('LIVE_LANES').map(e=>({normal:e.p.normal,top3:e.p.top3})),[{normal:false,top3:true}]);
  // back to TEST: no new real İlk 3 entry from that moment
  const b=await f.controller.runControl({action:'GO_TEST'});assert.equal(b.ok,true);
  assert.equal(f.t3().liveEnabled,false);
  await f.settle(()=>readTradingMode(f.root).mode==='TEST'&&f.controller.status().armed);
  assert.equal(readTradingMode(f.root).mode,'TEST');assert.equal(f.oto(),false);
});

test('R57 LIVE needs at least one lane and enough balance for the selected lanes; ON in LIVE needs the LIVE confirmation',async()=>{
  const f=fixture({lanes:{normal:false},top3:{enabled:false}});
  await f.controller.testSupervisorTick();
  assert.deepEqual((await f.controller.runControl({action:'GO_LIVE'})).reasons,['LANES_NONE_SELECTED']);
  assert.equal(readTradingMode(f.root).mode,'TEST');
  const g=fixture({lanes:{normal:true},top3:{enabled:true,marginQuote:60},realAvail:50});
  await g.controller.testSupervisorTick();
  const r=await g.controller.runControl({action:'GO_LIVE'});
  assert.deepEqual(r.reasons,['BINANCE_BALANCE_TOO_LOW']);assert.equal(r.detail.required,60,'the larger lane margin (İlk 3 60 > OTO 32)');
  // LIVE, both lanes: switching a lane ON needs 'LIVE'; OFF is immediate
  const h=fixture({mode:'LIVE',lanes:{normal:true},top3:{enabled:false}});
  assert.equal((await h.controller.runControl({action:'GO_LIVE'})).ok,true);
  assert.equal(h.oto(),true);
  assert.deepEqual(h.controller.selectLanes({top3:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  const on=h.controller.selectLanes({top3:true,confirm:'LIVE'});
  assert.equal(on.ok,true);assert.equal(h.t3().enabled,true);assert.equal(h.t3().liveEnabled,true);assert.equal(on.lanes.top3.active,true);
  assert.equal(h.controller.selectLanes({normal:false}).ok,true);assert.equal(h.oto(),false,'normal lane off in LIVE at once');
  assert.deepEqual(h.controller.selectLanes({normal:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
});

test('R57 the APK/old OTO switch is recorded as the normal-lane choice by the route',()=>{
  const srv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.ok(srv.includes("if(out.ok&&typeof otoBody.enabled==='boolean'&&otoBody.enabled!==otoWasOn)live.rememberNormalLane(otoBody.enabled);"),'only a real change is a lane choice (the old APK repeats its state every 60 s)');
  assert.ok(srv.includes("if(live.laneStatus().mode==='LIVE'&&otoBody.enabled===true&&!otoWasOn&&String(otoConfirm||'').toUpperCase()!=='LIVE')"),'a stale phone preference cannot start the JEV lane in LIVE');
  assert.ok(srv.includes("u.pathname==='/live/lanes'"));assert.ok(srv.includes('live.selectLanes({normal:body?.normal,top3:body?.top3,scalp5m:body?.scalp5m,trade15m:body?.trade15m,burst:body?.burst,confirm:body?.confirm'));
  const f=fixture();f.controller.rememberNormalLane(true);assert.equal(f.controller.laneStatus().normal.selected,true);
});

test('R57 İlk 3 margin/leverage: validated, LIVE needs the confirmation, effective leverage capped by the stop safety rule',()=>{
  const f=fixture();
  assert.deepEqual(f.controller.configureTop3({marginQuote:3}).reasons,['TOP3_MARGIN_INVALID']);
  assert.deepEqual(f.controller.configureTop3({leverage:21}).reasons,['TOP3_LEVERAGE_INVALID']);
  const s=f.controller.configureTop3({marginQuote:50,leverage:15});
  assert.equal(s.ok,true);assert.equal(s.settings.marginQuote,50);assert.equal(s.settings.leverage,15);
  assert.equal(s.settings.effectiveLong,11,'LONG stop -8%: liquidation before the stop above 11x');
  assert.deepEqual(s.settings.safeLeverage,{long:11,shortMin:11,shortMax:40});
  const auto=f.controller.configureTop3({marginQuote:null});assert.equal(auto.settings.marginAuto,true);
  assert.equal(f.kinds('TOP3_SETTINGS_CHANGED').length,2,'invalid ones are not written');
  const g=fixture({mode:'LIVE'});
  assert.deepEqual(g.controller.configureTop3({leverage:12}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(g.controller.configureTop3({leverage:12,confirm:'LIVE'}).ok,true);
});

test('R57 İlk 3 lots never use the core lane slots; the core review label names both own-manager lanes',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.ok(lc.includes("const slots=capacity({open:(ledgerState.open||[]).filter(p=>!activeTop3For(p.symbol)),pending:pendingOrders,max,now:clock()});"));
  assert.ok(lc.includes('const coreSlots=capacity({open:active.filter(x=>!activeTop3For(x?.symbol))'));
  assert.ok(lc.includes('openPositions:coreSlots.used'));
  assert.ok(lc.includes("if(Object.keys(top3State.active||{}).length||(top3State.pendingCloses||[]).length)w.push('TOP3_CLOSE_PENDING');"),'mode switches wait for İlk 3 closes to be booked');
  assert.ok(lc.includes("YALNIZ VUR-KAÇ / İLK 3 POZİSYONU"));
});

test('R57 Office: lane switches in the mode bar, LIVE start names the lanes, İlk 3 margin/leverage inputs; whitelists',()=>{
  process.env.BRAINHUB_ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'r57-office-'));delete process.env.OFFICE_KEY;
  const office=require('../office-dashboard/office-server.js');
  assert.equal(office.CONTROL_ROUTES['/api/control/lanes'],'/live/lanes');
  assert.deepEqual(office.CONTROL_BODY['/api/control/lanes']({normal:true,top3:'yes',confirm:'live',marginQuote:5}),{source:'OFFICE',normal:true,confirm:'LIVE'});
  assert.deepEqual(office.CONTROL_BODY['/api/control/top3']({marginQuote:'50',leverage:7.5}),{},'non-numeric margin / non-integer leverage dropped');
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['btnLaneNormal','btnLaneTop3','btnTop3Save','t3Margin','t3Lev'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.includes("CANLI’YA GEÇ (${which})"));assert.ok(html.includes("Önce en az bir hat seçin"));
  assert.ok(html.includes("laneAction({[key]:true,...(live?{confirm:'LIVE'}:{})}"));
  assert.ok(!html.includes('id="btnTop3Live"'),'no separate İlk 3 live switch: LIVE is chosen with the lanes');
});

test('R57 APK status: lanes and a compact İlk 3 summary, contract R2544.57_PC_STATUS',()=>{
  const {mobileStatus}=require('../mobile-status');
  const out=mobileStatus({ok:true,tradingMode:{mode:'TEST',run:{state:'TEST_RUNNING',lanes:{normal:{selected:false},top3:{selected:true}}}},
    top3:{version:'v',tradingMode:'TEST',switches:{enabled:true},gate:'OPEN',running:true,settings:{leverage:10},testWindow:{elapsedH:1,remainingMin:1380,done:false,scans:1,okScans:1,signals:2,entries:2,id:'w1'},
      active:[{symbol:'AUSDT',side:'SHORT',rule:'SHORT_TOP_FADE',signalKind:'REPEAT',entryPrice:1,stopPrice:1.05,tpPrice:0.9,markPrice:0.98,unrealizedPnl:2,leverage:10,marginQuote:20,remainingMin:100,entryFeatures:{big:1}}],
      lastScan:{at:'x',candle:'y',ranked:525,signals:[{symbol:'AUSDT',side:'SHORT',kind:'REPEAT',sig:{huge:1}}],errors:[],nearMisses:[1]},learning:{lessons:3,groups:[{n:3}],recent:[{lessonTr:'long text'}]}}});
  assert.equal(out.mobileContract,'R2544.58_PC_STATUS');
  assert.equal(out.tradingMode.run.lanes.top3.selected,true);
  assert.equal(out.top3.active[0].signalKind,'REPEAT');assert.equal(out.top3.active[0].entryFeatures,undefined);
  assert.deepEqual(out.top3.lastScan.signals,[{symbol:'AUSDT',side:'SHORT',kind:'REPEAT'}]);
  assert.equal(out.top3.learning.lessons,3);assert.equal(out.top3.learning.recent,undefined);assert.equal(out.top3.testWindow.id,undefined);
});

test('R57 paper ticks never queue up: one at a time, one price read per symbol, a STOP close is not stuck behind them',async()=>{
  const {PaperExchange}=require('../binance-live-transport');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r57-tick-'));writeTradingMode(root,{mode:'TEST'});
  let reads=0,now=1000;const slow=async s=>{reads++;await new Promise(r=>setTimeout(r,60));return {bid:10,ask:10.01};};
  const p=new PaperExchange({root,clock:()=>now,priceOf:slow,startBalance:1000,autoTick:false});
  for(const s of ['AUSDT','BUSDT']){
    await p.handle('POST','/fapi/v1/order',{params:{symbol:s,side:'BUY',type:'MARKET',quantity:'1'}});
    await p.handle('POST','/fapi/v1/algoOrder',{params:{symbol:s,side:'SELL',type:'STOP_MARKET',triggerPrice:'9',quantity:'1',reduceOnly:'true'}});
    await p.handle('POST','/fapi/v1/algoOrder',{params:{symbol:s,side:'SELL',type:'TAKE_PROFIT_MARKET',triggerPrice:'12',quantity:'1',reduceOnly:'true'}});
  }
  reads=0;
  const t1=p.tick(),t2=p.tick(),t3=p.tick();
  const r=await Promise.all([t1,t2,t3]);
  assert.equal(r.filter(x=>x.reason==='PAPER_TICK_BUSY').length,2,'overlapping ticks are skipped, not queued');
  assert.equal(reads,2,'4 orders on 2 symbols -> 2 price reads');
  const t0=Date.now();const c=await p.closeAll('TESTSTOP');assert.equal(c.closed,2);assert.ok(Date.now()-t0<1000);
});

test('R57 normal lane off: a running system still scans the market (no JEV, no order); a stopped one does not (14.10 "DÜZELT TARAMA YOK")',async()=>{
  let scans=0;
  const f=fixture({top3:{enabled:true},scanner:{scan:async()=>{scans++;return {universeCount:520,lightweightUniverseCount:640,targetUniverseCount:24,leaders:[{symbol:'AUSDT',side:'LONG',attackRank:2}]};}}});
  assert.equal((await f.controller.leaderAutoTick()).execution,'LEADER_AUTO_DISABLED','not running yet');assert.equal(scans,0);
  await f.controller.testSupervisorTick();assert.equal(f.controller.status().armed,true);assert.equal(f.oto(),false);
  const r=await f.controller.leaderAutoTick();
  assert.equal(r.execution,'LEADER_AUTO_SCAN_ONLY');assert.equal(r.orderPlaced,false);assert.deepEqual(r.reasons,['NORMAL_LANE_OFF_SCAN_ONLY']);assert.equal(scans,1);
  const h=f.controller.leaderAutoStatus().health;
  assert.equal(h.scanRuns,1);assert.equal(h.latestLightweightUniverseCount,640);assert.equal(h.latestUniverseCount,24);
  assert.equal(h.deepAnalyses,0,'no JEV evaluation');
  assert.equal((await f.controller.leaderAutoTick()).reasons[0],'SCAN_ONLY_WAIT');assert.equal(scans,1,'one scan per 5 min');
  f.state.now+=60000;await f.controller.leaderAutoTick();assert.equal(scans,1,'R2544.59: not every minute any more');
  f.state.now+=240000;await f.controller.leaderAutoTick();assert.equal(scans,2);
  await f.controller.runControl({action:'STOP'});f.state.now+=300000;
  assert.equal((await f.controller.leaderAutoTick()).execution,'LEADER_AUTO_DISABLED');assert.equal(scans,2,'stopped: no scan');
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.ok(html.includes("LEADER_AUTO_SCAN_ONLY:'yalnız tarama, 5 dakikada bir (Normal sistem kapalı)'"));
  assert.ok(html.includes("runMs>SILENT_RUN_MS&&scans===0) warn="),'the no-scan warning applies to every lane selection again');
});
