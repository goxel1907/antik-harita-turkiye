'use strict';
// R2544.71 (user 21.10): "marj ayarlarını marja göre düzelt hatta teste yetecek miktarı kendin yaz ... canlıya geçtiğimizde marj
// ve kaldıraç max poza göre canlıda işlem açacak, teste marj açısından işlemleri frenleyen birşey olmasın; açılan işlemlerin
// hepsini beyine yazmamız lazım ayrıca açık olan pozları beyine yaz, deploy sonrası kapanacağından garantiye alalım".
//  - TEST: a FIXED margin above the free virtual balance tops the paper account up (TRANSFER, result stays trades only);
//    automatic sizing (% of equity) is not topped up (TEST = LIVE); LIVE never tops up.
//  - every ZİRVE-5 / İlk 3 lot goes to the brain when it opens (older lots once, BACKFILL);
//  - the TEST deploy pauses NEW entries only: open virtual lots stay open (stop/TP on the paper exchange, manager running),
//    their state goes to the brain; the restart gap is caught up from 1m candles.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode,readTradingMode,PaperExchange}=require('../binance-live-transport');
const M15=900000;

test('R2544.71 paper deposit: wallet and start balance rise together, net stays the trading result, booked as TRANSFER',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r71-dep-'));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-21T00:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const p=new PaperExchange({root,clock:()=>Date.UTC(2026,9,21,20),priceOf:async()=>({bid:10,ask:10.01}),startBalance:100,autoTick:false});
  await p.handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'BUY',type:'MARKET',quantity:'2'}});
  const before=p.summary();
  const d=await p.deposit(300,'TOPUP_TEST');assert.equal(d.ok,true);assert.equal(d.amount,300);
  const s=p.summary();
  assert.ok(Math.abs(s.wallet-before.wallet-300)<1e-6);assert.ok(Math.abs(s.startBalance-before.startBalance-300)<1e-6);
  assert.equal(s.net,before.net,'the deposit is not a profit');assert.equal(s.realized,before.realized);
  assert.equal(s.deposited,300);assert.equal(s.deposits,1);
  const tr=p.state.income.filter(x=>x.incomeType==='TRANSFER');assert.equal(tr.length,1);assert.equal(tr[0].symbol,'');
  assert.ok(await p.freeBalance()>300);
  assert.equal((await p.deposit(0)).ok,false);
});

test('R2544.71 paper restart: the first tick of a new process catches up a short gap (deploy restart) - the stop crossed meanwhile fills',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r71-gap-'));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-21T00:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const T=Date.parse('2026-10-21T20:00:00Z');let now=T;let px={AUSDT:{bid:1.0,ask:1.0}};
  const candles=Array.from({length:10},(_,i)=>{const t=T+i*60000;return i===1?[t,1.0,1.07,0.99,1.0]:[t,1.0,1.002,0.998,1.0];});
  const mk=()=>new PaperExchange({root,clock:()=>now,priceOf:async s=>px[s],candlesOf:async(s,a,b)=>candles.filter(c=>c[0]>=a&&c[0]<b),startBalance:200,autoTick:false});
  const p1=mk();
  await p1.handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'SELL',type:'MARKET',quantity:'10'}});
  await p1.handle('POST','/fapi/v1/algoOrder',{params:{symbol:'AUSDT',side:'BUY',algoType:'CONDITIONAL',type:'STOP_MARKET',triggerPrice:'1.05',quantity:'10',reduceOnly:'true'}});
  await p1.tick();p1._save();                                   // last tick at 20:00:00, saved
  now=T+80000;                                                  // the core restarts; 80 s later (under the 90 s steady-state gap)
  const p2=mk();await p2.tick();                                // minute 20:01 spiked to 1.07 while the core was down
  const a=p2.state.algos.find(x=>x.orderType==='STOP_MARKET');
  assert.equal(a.algoStatus,'FINISHED','the stop the exchange would have filled is filled');assert.equal(a.catchUp,true);
  assert.equal(Object.keys(p2.state.positions).length,0);
  // steady state keeps 90 s: a later 60 s gap is not replayed
  now+=60000;assert.equal(p2.startTicked,true);
});

// ZİRVE-5 SHORT scenario with an SFP (same as R2544.70)
function series(points,lastOpen,qv=1000){
  const out=[];for(let s=1;s<points.length;s++){const a=points[s-1],b=points[s];for(let i=1;i<=8;i++){const p=a+(b-a)*(i-1)/8,c=a+(b-a)*i/8;out.push([p,c]);}}
  const t0=lastOpen-(out.length-1)*M15;
  return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05,quoteVolume:qv}));
}
function sweepScenario(lastOpen){
  const P=[100,100,100,100,100,100,100,103,98,101.5,96,92,99.4];
  const extra=[[99.4,99.3,99.35,99.25],[99.3,99.1,99.32,99.05],[99.1,99.0,99.12,98.95]],conf=[99.2,98.55,99.6,98.5];
  const c=series(P,lastOpen-(extra.length+1)*M15);
  let t=c.at(-1).openTime;for(const [o,cl,h,l] of [...extra,conf]){t+=M15;c.push({openTime:t,closeTime:t+M15-1,open:o,close:cl,high:h,low:l,quoteVolume:1000});}
  c.at(-1).quoteVolume=5000;return c;
}
const FAKE={apiKey:'fake-test-key-r71',apiSecret:'fake-test-secret-r71'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({z5={enabled:true},mode='TEST'}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r71-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify(z5));
  writeTradingMode(root,{mode,changedAt:'2026-10-21T08:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  const bar=Date.UTC(2026,9,21,10,0),k=sweepScenario(bar),c0=k.at(-1).close,state={now:bar+M15+10000,px:{Z5USDT:{bid:c0,ask:c0+0.01}}};
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url)=>{const u=new URL(url),p=u.pathname;
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['Z5USDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'Z5USDT',highPrice:'110',lowPrice:'90',lastPrice:'99',quoteVolume:'50000000',priceChangePercent:'-1'}]);
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines')return ok(k.map(r=>[r.openTime,String(r.open),String(r.high),String(r.low),String(r.close),'0',r.closeTime,String(r.quoteVolume)]));
    throw new Error('UNEXPECTED '+p);};
  const events=[],learned=[];
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k2,s,p)=>events.push({k:k2,s,p}),recordLearning:(k2,s,p)=>learned.push({k:k2,s,p})},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  return {root,controller,events,learned,state,kinds:k2=>events.filter(e=>e.k===k2),lot:()=>Object.values(controller._testTop3State().active)[0]||null};
}

test('R2544.71 TEST: a fixed ZİRVE-5 margin above the free balance tops the paper account up and the lot opens as set; the lot goes to the brain at entry',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,marginQuote:500,leverage:10}});await f.controller.testSupervisorTick();
  assert.ok(f.controller._testPaper().summary().available<200,'starts with the 100 USDT paper account');
  assert.equal((await f.controller.z5Tick()).entries,1,JSON.stringify(f.controller.z5Status().recentEntries));
  const a=f.lot();assert.equal(a.marginQuote,500,'the margin as set, not cut by the balance');
  const top=f.kinds('TEST_BALANCE_TOPUP');assert.equal(top.length,1);assert.equal(top[0].p.lane,'ZIRVE5');assert.equal(top[0].p.amount%100,0);
  const s=f.controller._testPaper().summary();assert.ok(s.deposited>=500);assert.ok(Math.abs(s.net-(s.wallet-s.startBalance))<1e-3);
  const o=f.learned.filter(x=>x.k==='ZIRVE5_OPENED');assert.equal(o.length,1,'written to the brain at entry');
  assert.equal(o[0].p.id,a.id);assert.equal(o[0].p.reason,'ENTRY');assert.equal(o[0].p.outcomePct,null,'an opening is never a PnL sample');
  assert.ok(o[0].p.entryFeatures?.sweep,'what the rule saw (sweep, context) goes with it');assert.ok(a.brainOpenedAt>0);
});

test('R2544.71 TEST: automatic sizing (no own margin) is NOT topped up - it follows the account like LIVE',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);
  assert.equal(f.kinds('TEST_BALANCE_TOPUP').length,0);assert.equal(f.controller._testPaper().summary().deposited,0);
});

test('R2544.71 LIVE: never tops up (the real balance decides)',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({mode:'LIVE'});
  assert.equal(await f.controller._testTopUp(500,'ZIRVE5'),null);assert.equal(f.kinds('TEST_BALANCE_TOPUP').length,0);
});

test('R2544.71 PAUSE_TEST (TEST deploy): new entries stop, the open lot stays open with its exchange stop/TP and its state goes to the brain; STOP still closes',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=f.lot();
  const r=await f.controller.runControl({action:'PAUSE_TEST'});
  assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(r.keptOpen,['Z5USDT']);assert.equal(r.lotsToBrain,1);
  assert.equal(f.controller.runStatus().state,'STOPPED','entries disarmed');assert.equal(f.controller.runStatus().testAutoRun,false);
  assert.equal(readTradingMode(f.root).testAutoRun,false,'TEST does not re-arm by itself during the deploy');
  assert.equal(Object.keys(f.controller._testPaper().state.positions).length,1,'the virtual position is still open');
  assert.ok(f.controller._testPaper().state.algos.some(x=>x.algoStatus==='NEW'&&x.orderType==='STOP_MARKET'),'its stop is still on the exchange');
  assert.ok(f.controller._testTop3State().active[a.id],'the lane still manages it');
  const snap=f.learned.filter(x=>x.k==='ZIRVE5_OPEN_SNAPSHOT');assert.equal(snap.length,1);assert.equal(snap[0].p.keptOpen,true);assert.equal(snap[0].p.reason,'TEST_PAUSE');
  assert.ok(Number.isFinite(snap[0].p.unrealizedR));
  assert.equal((await f.controller.testSupervisorTick()).idle,true,'paused: the supervisor stays idle');
  // a pause is TEST only
  const g=fixture({mode:'LIVE'});assert.deepEqual((await g.controller.runControl({action:'PAUSE_TEST'})).reasons,['NOT_IN_TEST_MODE']);
  // START_TEST after the deploy arms again; the lot is still there
  assert.equal((await f.controller.runControl({action:'START_TEST'})).ok,true);assert.ok(f.controller._testTop3State().active[a.id]);
  // STOP (Office "Durdur") keeps its meaning: virtual lots are closed
  const st=await f.controller.runControl({action:'STOP'});assert.equal(st.paperClosed,1);
});

test('R2544.71 BACKFILL: a lot opened by an older build (no brain record) is written once on the next tick',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=f.lot();
  delete a.brainOpenedAt;f.learned.length=0;
  await f.controller.top3Tick();await f.controller.top3Tick();
  const o=f.learned.filter(x=>x.k==='ZIRVE5_OPENED');assert.equal(o.length,1,'once');assert.equal(o[0].p.reason,'BACKFILL');
});

test('R2544.71 wiring: core route accepts PAUSE_TEST; deploy scripts keep TEST lots and keep the LIVE rule; Office shows the virtual deposits',()=>{
  const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(src('server.js'),/\['STOP','START_TEST','PAUSE_TEST','RESET_TEST','GO_LIVE','GO_TEST'\]/);
  const ps=src('jev-brain/JEV-TEST-DEPLOY.ps1'),dep=src('jev-brain/JEV-DEPLOY.ps1');
  for(const [n,x] of [['JEV-TEST-DEPLOY',ps],['JEV-DEPLOY',dep]])assert.doesNotMatch(x,/[^\x00-\x7F]/,n+' ASCII (PowerShell 5.1)');
  assert.match(ps,/action = 'PAUSE_TEST'/);assert.match(ps,/RUN_ACTION_INVALID/);assert.match(ps,/\[System\.IO\.File\]::Replace\(\$tmp, \$f, \$bak\)/,'old-core fallback: atomic mode-file write');
  assert.match(ps,/UTF8Encoding\(\$false\)/,'no BOM');assert.match(ps,/if \(\[string\]\$j\.mode -ne 'TEST'\) \{ throw/,'never touches a LIVE mode file');
  assert.match(ps,/if \(\$st\.armed -eq \$true\) \{ throw 'Baslatma kapanmadi/);
  assert.match(dep,/if \(\$pos\.Count -gt 0 -and \$tmode -ne 'TEST'\) \{ throw "ACIK POZISYON VAR/,'LIVE: no deploy with an open position');
  assert.match(dep,/TEST CALISIYOR \(baslatma acik\)\. TEST modunda JEV-TEST-DEPLOY\.cmd kullanin/);
  assert.match(src('office-dashboard/public/office.html'),/marj için eklenen sanal \$\{usdt\(p\.deposited\)\}/);
});
