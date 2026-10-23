'use strict';
// R2544.78 (user 23.10: "otomatik yenileme olacak canlıda, ben istediğimde kapat / durdur diyeceğim sadece"). A LIVE start by the
// user (CANLI'ya geç) keeps its arm: renewed in the last hour of the 24 h with a fresh Binance probe, re-armed after a PC restart.
// Only the user ends it: Durdur, TEST'e dön (after the real lots are flat), LIVE-KAPAT / any disarm. A failed probe widens nothing.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readTradingMode,writeTradingMode}=require('../binance-live-transport');
const {mobileStatus}=require('../mobile-status');

const FAKE={apiKey:'fake-test-key-r78renew',apiSecret:'fake-test-secret-r78renew'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
const H=3600000;
function fixture({file={mode:'LIVE',testAutoRun:false}}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r78-renew-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','lane-selection.json'),JSON.stringify({normal:true}));
  writeTradingMode(root,file);
  const state={now:1791370000000,realAvail:250,realWallet:250,realPositions:[],calls:[],down:false},events=[];
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push(`${m} ${p}`);
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(state.down&&p.startsWith('/fapi/v'))throw new Error('ECONNRESET');
    if(p==='/fapi/v3/account')return ok({availableBalance:String(state.realAvail),totalWalletBalance:String(state.realWallet),totalMarginBalance:String(state.realWallet),totalUnrealizedProfit:'0',positions:[]});
    if(p==='/fapi/v3/positionRisk')return ok(state.realPositions);
    if(p==='/fapi/v1/positionSide/dual')return ok({dualSidePosition:false});
    if(p==='/fapi/v1/income')return ok([]);
    if(p==='/fapi/v1/ticker/bookTicker')return ok({symbol:u.searchParams.get('symbol'),bidPrice:'10',askPrice:'10.01'});
    throw new Error('UNEXPECTED '+m+' '+p);};
  const make=()=>require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k,s,p)=>events.push({k,s,p})},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST'});
  const f={root,state,events,make,controller:make()};
  f.tick=async(ms=5000)=>{state.now+=ms;return f.controller.testSupervisorTick();};
  f.exp=()=>Date.parse(f.controller.status().tradingMode.run.armExpiresAt||'')||null;
  f.kinds=k=>events.filter(x=>x.k===k);
  return f;
}

test('R2544.78 CANLI\'ya geç turns the LIVE auto-renew on; the arm is renewed in its last hour with a fresh Binance probe',async()=>{
  const f=fixture();
  assert.equal((await f.controller.runControl({action:'GO_LIVE'})).ok,true);
  assert.equal(readTradingMode(f.root).liveAutoRun,true);
  let run=f.controller.status().tradingMode.run;
  assert.equal(run.state,'LIVE_RUNNING');assert.equal(run.liveAutoRun,true);
  const first=f.exp();assert.equal(first,f.state.now+24*H);assert.equal(Date.parse(run.nextRenewAt),first-H);
  // 22 h later: nothing to do yet (more than an hour left)
  f.state.now+=22*H;const probes0=f.state.calls.filter(c=>c==='GET /fapi/v3/account').length;
  assert.equal((await f.controller.testSupervisorTick()).action,undefined);
  assert.equal(f.state.calls.filter(c=>c==='GET /fapi/v3/account').length,probes0,'no Binance read before the last hour');
  // 23 h 05 min: renewed (account + positionSide probed), same arm (no new generation), 24 h from now
  f.state.now+=65*60000;
  assert.equal((await f.controller.testSupervisorTick()).action,'LIVE_ARM_RENEWED');
  assert.equal(f.exp(),f.state.now+24*H);assert.ok(f.state.calls.filter(c=>c==='GET /fapi/v3/account').length>probes0);
  assert.equal(f.controller.status().armed,true);assert.equal(f.controller.status().tradingMode.run.armSource,'USER_GO_LIVE');
  assert.equal(f.kinds('LIVE_ARM_RENEWED').length,1);
  // three more days: still running, renewed each day
  for(let d=0;d<3;d++){f.state.now+=23*H+5*60000;await f.controller.testSupervisorTick();}
  assert.equal(f.controller.status().armed,true);assert.equal(f.kinds('LIVE_ARM_RENEWED').length,4);
});

test('R2544.78 a failed renewal keeps the old arm until its end, then no entries; retried every minute; recovers by itself',async()=>{
  const f=fixture();await f.controller.runControl({action:'GO_LIVE'});
  const first=f.exp();
  f.state.now+=23*H+30*60000;f.state.down=true;
  const r=await f.controller.testSupervisorTick();
  assert.equal(r.ok,false);assert.deepEqual(r.reasons,['BINANCE_FUTURES_CREDENTIAL_PROBE_FAILED']);
  assert.equal(f.exp(),first,'the old arm is kept (not cut short, not extended)');assert.equal(f.controller.status().armed,true);
  assert.equal((await f.tick(5000)).waiting,'LIVE_RENEW_RETRY','retry after a minute, not every 5 s');
  // past the end: the arm runs out (no new entries) - LIVE stays on auto-renew and re-arms when Binance answers again
  f.state.now=first+60000;
  assert.equal((await f.controller.testSupervisorTick()).ok,false);
  assert.equal(f.controller.status().armed,false,'no arm without a passed probe');
  assert.equal(readTradingMode(f.root).liveAutoRun,true);
  assert.ok(f.kinds('LIVE_ARM_RENEW_FAILED').length+f.kinds('LIVE_REARM_FAILED').length<=2,'failures are journaled at most every 30 min');
  f.state.down=false;f.state.now+=61000;
  assert.equal((await f.controller.testSupervisorTick()).action,'LIVE_REARMED');
  assert.equal(f.controller.status().armed,true);assert.equal(f.controller.status().tradingMode.run.armSource,'LIVE_AUTORENEW');
  assert.equal(f.controller.status().tradingMode.run.lastError,null);
});

test('R2544.78 PC restart in LIVE: the new process re-arms by itself (user never stopped it)',async()=>{
  const f=fixture();await f.controller.runControl({action:'GO_LIVE'});
  f.controller=f.make(); // restart: armState is gone, the mode file keeps liveAutoRun
  assert.equal(f.controller.status().armed,false);
  assert.equal((await f.tick()).action,'LIVE_REARMED');
  assert.equal(f.controller.status().armed,true);assert.equal(f.controller.status().tradingMode.run.state,'LIVE_RUNNING');
});

test('R2544.78 Durdur ends it: no renewal, no re-arm after a restart; CANLI\'ya geç starts it again',async()=>{
  const f=fixture();await f.controller.runControl({action:'GO_LIVE'});
  assert.equal((await f.controller.runControl({action:'STOP'})).ok,true);
  assert.equal(readTradingMode(f.root).liveAutoRun,undefined);assert.equal(f.controller.status().armed,false);
  for(let i=0;i<3;i++)await f.tick(H);
  f.controller=f.make();for(let i=0;i<3;i++)await f.tick(H);
  assert.equal(f.controller.status().armed,false);assert.equal(f.controller.status().tradingMode.run.liveAutoRun,false);
  assert.equal((await f.controller.runControl({action:'GO_LIVE'})).ok,true);assert.equal(readTradingMode(f.root).liveAutoRun,true);
});

test('R2544.78 LIVE-KAPAT (disarm) ends it too, also while a renewal probe is out',async()=>{
  const f=fixture();await f.controller.runControl({action:'GO_LIVE'});
  f.controller.disarm('USER_DISARM');
  assert.equal(readTradingMode(f.root).liveAutoRun,undefined);
  await f.tick(25*H);assert.equal(f.controller.status().armed,false,'no re-arm after LIVE-KAPAT');
  // a disarm that lands while the renewal probe is in flight wins
  await f.controller.runControl({action:'GO_LIVE'});f.state.now+=23*H+10*60000;
  const p=f.controller.testSupervisorTick();f.controller.disarm('USER_DISARM');const r=await p;
  assert.notEqual(r.action,'LIVE_ARM_RENEWED');assert.equal(f.controller.status().armed,false);assert.equal(readTradingMode(f.root).liveAutoRun,undefined);
});

test('R2544.78 TEST\'e dön with an open real lot: the arm keeps being renewed while the lot is managed, survives a restart, then TEST',async()=>{
  const f=fixture();await f.controller.runControl({action:'GO_LIVE'});
  f.state.realPositions=[{symbol:'BUSDT',positionAmt:'3',entryPrice:'2',markPrice:'2.1',unRealizedProfit:'0.3',leverage:'10',notional:'6.3',liquidationPrice:'0'}];
  await f.controller.positionLedgerTick();
  assert.equal((await f.controller.runControl({action:'GO_TEST'})).ok,true);
  assert.ok(readTradingMode(f.root).liveWindDownAt);
  f.state.now+=23*H+10*60000;await f.controller.testSupervisorTick();
  assert.equal(f.controller.status().armed,true,'renewed: break-even moves / time exit keep working');assert.equal(f.kinds('LIVE_ARM_RENEWED').length,1);
  f.controller=f.make();await f.tick();
  let st=f.controller.status();
  assert.equal(st.tradingMode.run.state,'LIVE_WIND_DOWN','the wind-down survives the restart');assert.equal(st.armed,true);
  f.state.realPositions=[];
  for(let i=0;i<6&&readTradingMode(f.root).mode!=='TEST';i++)await f.tick();
  const m=readTradingMode(f.root);
  assert.equal(m.mode,'TEST');assert.equal(m.liveAutoRun,undefined);assert.equal(m.liveWindDownAt,undefined);
});

test('R2544.78 TEST mode is unchanged: no LIVE renewal and no real signed call',async()=>{
  const f=fixture({file:{mode:'TEST',changedAt:'2026-10-06T12:34:13.362Z',testStartedAt:null,testAutoRun:true}});
  await f.tick();assert.equal(f.controller.status().tradingMode.run.state,'TEST_RUNNING');
  assert.equal(f.controller.status().tradingMode.run.liveAutoRun,false);
  assert.equal(f.kinds('LIVE_AUTORENEW_ON').length,0);
});

test('R2544.78 phone status carries the balance; deploy refuses while LIVE auto-renews',()=>{
  const out=mobileStatus({account:{ok:true,configured:true,walletBalance:50.12,availableBalance:20.1,equity:51,unrealizedPnl:0.88,openPositions:1,asOf:'2026-10-23T12:00:00Z',cached:true}});
  assert.deepEqual(out.account,{ok:true,walletBalance:50.12,availableBalance:20.1,equity:51,unrealizedPnl:0.88,openPositions:1,asOf:'2026-10-23T12:00:00Z'});
  assert.equal(out.mobileContract,'R2544.78_PC_STATUS');
  assert.deepEqual(mobileStatus({account:{ok:false,reasons:['BINANCE_CREDENTIALS_REQUIRED']}}).account,{ok:false,reason:'BINANCE_CREDENTIALS_REQUIRED'});
  const dep=fs.readFileSync(path.join(__dirname,'..','jev-brain','JEV-DEPLOY.ps1'),'utf8');
  assert.match(dep,/\$tmode -eq 'LIVE' -and \$autoRenew\) \{ throw/);
  const srv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(srv,/account=await live\.accountSummary\(\{maxAgeMs:15000\}\)/);
});
