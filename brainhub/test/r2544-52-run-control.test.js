'use strict';
// R2544.52 run control (user 07.10.2026): "TEST runs as if I had deposited 200 USD; when I press OTO aç it goes live with
// my Binance balance and margin." TEST autorun, OTO aç = GO_LIVE (real preflight, paper lots closed, then LIVE),
// OTO kapat = GO_TEST (real lot managed until flat), STOP, START_TEST, RESET_TEST; a TEST arm never survives in LIVE.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readTradingMode,writeTradingMode}=require('../binance-live-transport');

const FAKE={apiKey:'fake-test-key-r52run',apiSecret:'fake-test-secret-r52run'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({mode='TEST',file=null,otoEnabled=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r52-run-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:otoEnabled,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  writeTradingMode(root,file||{mode,changedAt:'2026-10-06T12:34:13.362Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  const state={now:1791370000000,realAvail:250,realWallet:250,realPositions:[],calls:[]},events=[];
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push(`${m} ${p}`);
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker')return ok({symbol:u.searchParams.get('symbol'),bidPrice:String(state.bid??10),askPrice:String(state.ask??10.01)});
    if(p==='/fapi/v3/account')return ok({availableBalance:String(state.realAvail),totalWalletBalance:String(state.realWallet),positions:[]});
    if(p==='/fapi/v3/positionRisk')return ok(state.realPositions);
    if(p==='/fapi/v1/positionSide/dual')return ok({dualSidePosition:false});
    if(p==='/fapi/v1/income')return ok([]);
    throw new Error('UNEXPECTED '+m+' '+p);};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k,s,p)=>events.push({k,s,p})},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST'});
  const oto=()=>JSON.parse(fs.readFileSync(path.join(root,'config','leader-auto.json'),'utf8')).enabled;
  const realSigned=()=>state.calls.filter(c=>/\/fapi\/v3\/(account|positionRisk)$/.test(c));
  const ticks=async(n=6)=>{let r;for(let i=0;i<n;i++){state.now+=5000;r=await controller.testSupervisorTick();if(r?.action||r?.running)break;}return r;};
  return {root,state,events,controller,oto,realSigned,ticks,paper:controller._testPaper()};
}

test('R52 TEST runs by itself: a pre-R52 file with OTO on migrates to autorun, paper arm comes on, no real signed call',async()=>{
  const f=fixture({otoEnabled:true,file:{mode:'TEST',changedAt:'2026-10-06T12:34:13.362Z',testStartedAt:1791290053362}});
  const r=await f.controller.testSupervisorTick();
  assert.equal(r.action,'TEST_ARMED');
  const m=readTradingMode(f.root);assert.equal(m.testAutoRun,true);assert.ok(m.r52MigratedAt);
  assert.equal(f.oto(),true);
  const st=f.controller.status();
  assert.equal(st.armed,true);assert.equal(st.tradingMode.run.state,'TEST_RUNNING');assert.equal(st.tradingMode.run.armSource,'TEST_AUTORUN');
  assert.equal(st.tradingMode.testStarted,true);assert.equal(st.tradingMode.testElapsedHours,0,'fresh 24 h window after the migration');
  assert.deepEqual(f.realSigned(),[],'paper probe only');
  assert.equal((await f.controller.testSupervisorTick()).running,true);
});

test('R52 a pre-R52 file of a stopped system stays stopped after the restart (deploy check: not armed)',async()=>{
  const f=fixture({otoEnabled:false,file:{mode:'TEST',changedAt:'2026-10-06T12:34:13.362Z',testStartedAt:1791290053362}});
  const r=await f.controller.testSupervisorTick();
  assert.equal(r.idle,true);assert.equal(readTradingMode(f.root).testAutoRun,false);assert.equal(f.controller.status().armed,false);
  assert.equal((await f.controller.runControl({action:'START_TEST'})).ok,true);assert.equal(f.controller.status().armed,true);
});

test('R52 OTO switched off elsewhere (APK) while TEST runs is a stop; START_TEST resumes',async()=>{
  const f=fixture();await f.controller.testSupervisorTick();
  f.controller.configureLeaderAuto({enabled:false});
  assert.equal((await f.controller.testSupervisorTick()).action,'STOPPED_BY_OTO_OFF');
  assert.equal(f.controller.status().armed,false);assert.equal(readTradingMode(f.root).testAutoRun,false);
  assert.equal((await f.controller.testSupervisorTick()).idle,true,'stays stopped');
  const s=await f.controller.runControl({action:'START_TEST'});
  assert.equal(s.ok,true);assert.equal(f.controller.status().armed,true);assert.equal(f.oto(),true);
});

test('R52 STOP turns autorun, OTO and arm off, closes the virtual lots, and the supervisor leaves it off',async()=>{
  const f=fixture();await f.controller.testSupervisorTick();
  await f.paper.handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'BUY',type:'MARKET',quantity:'1'}});
  const s=await f.controller.runControl({action:'STOP'});
  assert.equal(s.ok,true);assert.equal(s.tradingMode.run.state,'STOPPED');assert.equal(s.paperClosed,1);assert.equal(f.paper.hasExposure(),false);
  assert.equal(f.oto(),false);assert.equal(f.controller.status().armed,false);
  await f.ticks(3);assert.equal(f.controller.status().armed,false);
});

test('R52 OTO aç is refused when the Binance balance is below the OTO margin; TEST keeps running',async()=>{
  const f=fixture();await f.controller.testSupervisorTick();f.state.realAvail=10;f.state.realWallet=10;
  const r=await f.controller.runControl({action:'GO_LIVE'});
  assert.equal(r.ok,false);assert.deepEqual(r.reasons,['BINANCE_BALANCE_TOO_LOW']);assert.equal(r.detail.required,32);assert.equal(r.detail.available,10);
  assert.equal(readTradingMode(f.root).mode,'TEST');assert.equal(f.controller.status().armed,true);assert.equal(f.oto(),true);
  f.state.realAvail=250;f.state.realPositions=[{symbol:'XUSDT',positionAmt:'5',entryPrice:'1',markPrice:'1'}];
  assert.deepEqual((await f.controller.runControl({action:'GO_LIVE'})).reasons,['REAL_POSITION_OPEN'],'a manual real lot blocks the switch');
});

test('R52 OTO aç: paper lots are closed (booked as TEST), then LIVE with OTO and a real arm; OTO kapat returns to TEST',async()=>{
  const f=fixture();await f.controller.testSupervisorTick();
  await f.paper.handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'BUY',type:'MARKET',quantity:'2'}});
  await f.controller.positionLedgerTick();
  let r=await f.controller.runControl({action:'GO_LIVE'});
  assert.equal(r.ok,true,JSON.stringify(r));
  for(let i=0;i<6&&f.controller.status().tradingMode.run.state!=='LIVE_RUNNING';i++){f.state.now+=5000;await f.controller.testSupervisorTick();}
  const st=f.controller.status();
  assert.equal(st.tradingMode.mode,'LIVE');assert.equal(st.tradingMode.run.state,'LIVE_RUNNING');assert.equal(st.tradingMode.run.armSource,'USER_GO_LIVE');
  assert.equal(f.oto(),true);assert.equal(f.paper.hasExposure(),false);assert.equal(f.paper.summary().fills,2,'open + forced close');
  assert.ok(f.realSigned().includes('GET /fapi/v3/account'),'live preflight and arm read the real account');
  assert.ok(f.events.some(x=>x.k==='LIVE_STARTED'&&x.p.available===250));
  assert.equal(st.tradingMode.realOrdersPossible,true);
  r=await f.controller.runControl({action:'GO_TEST'});
  assert.equal(r.ok,true);
  for(let i=0;i<6&&!(readTradingMode(f.root).mode==='TEST'&&f.controller.status().armed);i++){f.state.now+=5000;await f.controller.testSupervisorTick();}
  const back=f.controller.status();
  assert.equal(back.tradingMode.mode,'TEST');assert.equal(back.tradingMode.run.state,'TEST_RUNNING');assert.equal(back.tradingMode.run.armSource,'TEST_AUTORUN');
  assert.equal(f.paper.summary().fills,2,'paper account kept');
});

test('R52 OTO kapat with an open real lot: no new entries, lot stays armed and managed until flat, then TEST',async()=>{
  const f=fixture({file:{mode:'LIVE',testAutoRun:false}});
  assert.equal((await f.controller.runControl({action:'GO_LIVE'})).ok,true);
  assert.equal(f.controller.status().tradingMode.run.state,'LIVE_RUNNING');
  f.state.realPositions=[{symbol:'BUSDT',positionAmt:'3',entryPrice:'2',markPrice:'2.1',unRealizedProfit:'0.3',leverage:'10',notional:'6.3',liquidationPrice:'0'}];
  await f.controller.positionLedgerTick();
  await f.controller.runControl({action:'GO_TEST'});
  assert.equal(f.oto(),false,'no new real entries');
  for(let i=0;i<3;i++){f.state.now+=5000;await f.controller.testSupervisorTick();}
  let st=f.controller.status();
  assert.equal(st.tradingMode.mode,'LIVE');assert.equal(st.armed,true,'JEV keeps managing the real lot');assert.equal(st.tradingMode.run.state,'LIVE_WIND_DOWN');
  assert.ok(st.tradingMode.run.switch.waiting.includes('POSITION_OPEN'));
  f.state.realPositions=[];
  for(let i=0;i<6&&readTradingMode(f.root).mode!=='TEST';i++){f.state.now+=5000;await f.controller.testSupervisorTick();}
  assert.equal(readTradingMode(f.root).mode,'TEST');
});

test('R52 a TEST arm never survives in LIVE',async()=>{
  const f=fixture();await f.controller.testSupervisorTick();
  writeTradingMode(f.root,{mode:'LIVE',testAutoRun:false});f.paper.invalidateMode();
  assert.equal((await f.controller.testSupervisorTick()).action,'DISARMED_TEST_ARM_IN_LIVE');
  assert.equal(f.controller.status().armed,false);
});

test('R52 RESET_TEST closes paper lots, then a new balance and a new run',async()=>{
  const f=fixture();await f.controller.testSupervisorTick();
  await f.paper.handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'SELL',type:'MARKET',quantity:'1'}});
  await f.controller.positionLedgerTick();
  assert.equal((await f.controller.runControl({action:'RESET_TEST',testBalance:300})).ok,true);
  for(let i=0;i<6&&!(f.paper.summary().startBalance===300&&f.controller.status().armed);i++){f.state.now+=5000;await f.controller.testSupervisorTick();}
  const s=f.paper.summary();assert.equal(s.startBalance,300);assert.equal(s.fills,0);assert.equal(s.openPositions,0);
  assert.equal(f.controller.status().tradingMode.run.state,'TEST_RUNNING');
});

test('R52 server and Office: /live/run needs LIVE confirmation for OTO aç; Office forwards only whitelisted fields',()=>{
  const srv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(srv,/u\.pathname==='\/live\/run'/);
  assert.match(srv,/action==='GO_LIVE'&&body\?\.confirm!=='LIVE'/);
  assert.match(srv,/live\.testSupervisorTick\(\)/);
  const {CONTROL_BODY,CONTROL_ROUTES}=require('../office-dashboard/office-server.js');
  assert.equal(CONTROL_ROUTES['/api/control/run'],'/live/run');
  assert.deepEqual(CONTROL_BODY['/api/control/run']({action:'go_live',confirm:'live',marginQuote:999,leverage:125}),{action:'GO_LIVE',confirm:'LIVE'});
  assert.deepEqual(CONTROL_BODY['/api/control/run']({action:'rm -rf'}),{action:'INVALID'});
});

test('R52 Office panel: OTO aç = CANLI behind a second press, Stop is one press, no browser dialogs',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['btnGoLive','btnGoTest','btnStartTest','btnResetTest','btnStop','testBalance'])assert.match(html,new RegExp(`id="${id}"`));
  const panel=html.slice(html.indexOf('// R2544.51/52 TEST/LIVE mod paneli.'),html.indexOf('let last=null;'));
  assert.doesNotMatch(panel,/\b(confirm|prompt)\((?!\))/,'07.10: a suppressed confirm() made a button silently do nothing');
  const goLive=panel.slice(panel.indexOf("onClick('#btnGoLive'"),panel.indexOf("onClick('#btnGoTest'"));
  assert.match(goLive,/secondPress\('btnGoLive'/);assert.match(goLive,/action:'GO_LIVE',confirm:'LIVE'/);
  const stop=panel.slice(panel.indexOf("onClick('#btnStop'"));
  assert.doesNotMatch(stop,/secondPress/);assert.match(stop,/action:'STOP'/);
  assert.match(panel,/fetch\('\/api\/control\/run'/);
  assert.match(panel,/ÇALIŞIYOR görünüyor ama/);assert.match(panel,/BINANCE_BALANCE_TOO_LOW/);
});

test('R52 TEST deploy wrapper: TEST mode only, stops safely, runs JEV-DEPLOY unchanged, restarts TEST',()=>{
  const ps=fs.readFileSync(path.join(__dirname,'..','jev-brain','JEV-TEST-DEPLOY.ps1'),'utf8');
  assert.match(ps,/tradingMode\.mode -ne 'TEST'\) \{ throw/,'never touches LIVE');
  assert.match(ps,/'\/live\/run' @\{ action = 'STOP' \}/);assert.match(ps,/Open-Positions \$RT/);
  assert.match(ps,/-File \(Join-Path \$PSScriptRoot 'JEV-DEPLOY\.ps1'\)/);assert.match(ps,/if \(\$LASTEXITCODE -ne 0\) \{ throw/);
  assert.match(ps,/'\/live\/run' @\{ action = 'START_TEST' \}/);
  assert.doesNotMatch(ps,/[^\x00-\x7F]/,'ASCII like the other scripts');
  const deploy=fs.readFileSync(path.join(__dirname,'..','jev-brain','JEV-DEPLOY.ps1'),'utf8');
  assert.match(deploy,/if \(\$liveState\.armed -eq \$true\) \{ throw/,'the deploy safety rule is unchanged');
  assert.match(deploy,/if \(\$pos\.Count -gt 0\) \{ throw/);
});

test('R52 one PnL everywhere in TEST: open rows take the paper live mark, total = equity - start',async()=>{
  const f=fixture();await f.controller.testSupervisorTick();
  await f.paper.handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'BUY',type:'MARKET',quantity:'2'}});
  await f.controller.positionLedgerTick();
  const ledgerPnl=f.controller.positionsStatus().open[0].unrealizedPnl;
  f.state.bid=10.5;f.state.ask=10.51;await f.paper.handle('GET','/fapi/v3/account'); // the paper mark moves; the ledger read is older
  const s=f.paper.summary(),row=f.controller.positionsStatus().open[0];
  assert.equal(row.unrealizedPnl,s.positions[0].unrealizedPnl,'table = TEST summary');assert.notEqual(row.unrealizedPnl,ledgerPnl);
  assert.ok(Math.abs(row.markPrice-10.505)<1e-9);assert.ok(Math.abs(s.total-(s.equity-s.startBalance))<1e-9);assert.ok(Math.abs(s.total-(s.net+s.unrealized))<1e-3);
  assert.ok(s.available>0);assert.equal(row.tradingMode,'TEST');
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const s2 of ['Kâr/zarar: TOPLAM','açık PnL ${openPnl.toFixed(2)}',"const paperK = st.tradingMode?.mode==='TEST'"])assert.ok(html.includes(s2),s2);
});
