'use strict';
// R2544.51: TEST (paper) mode, burst off for real money, 0.30 % burst stop floor, Office mode/arm/OTO switches.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {BinanceLiveTransport,PaperExchange,readTradingMode,writeTradingMode,PAPER_ROUTES}=require('../binance-live-transport');
const {PULLBACK_RULES}=require('../burst-scalp');
const {performanceReport}=require('../office-performance');

const FAKE={apiKey:'fake-test-key-r51',apiSecret:'fake-test-secret-r51'}; // made-up, never real
const tmp=p=>fs.mkdtempSync(path.join(os.tmpdir(),p));
function paperFixture({balance=100,mode='TEST'}={}){
  const root=tmp('r51-paper-');let now=1_000_000;const px={AUSDT:{bid:100,ask:100.1}};
  if(mode)writeTradingMode(root,{mode});
  const paper=new PaperExchange({root,clock:()=>now,priceOf:async s=>px[s],startBalance:balance,autoTick:false});
  return {root,paper,px,tick:ms=>{now+=ms;},order:(params)=>paper.handle('POST','/fapi/v1/order',{params:{type:'MARKET',...params}})};
}
const code=async p=>{try{await p;return null;}catch(e){return e?.body?.code??e?.code??String(e);}};

test('R51 trading mode file: missing -> default, explicit TEST/LIVE honoured, written atomically',()=>{
  const root=tmp('r51-mode-');
  assert.deepEqual(readTradingMode(root,'TEST'),{mode:'TEST',defaulted:true});
  assert.deepEqual(readTradingMode(root),{mode:'LIVE',defaulted:true});
  writeTradingMode(root,{mode:'TEST',testStartedAt:5});
  assert.equal(readTradingMode(root,'LIVE').mode,'TEST');assert.equal(readTradingMode(root).defaulted,false);
  writeTradingMode(root,{mode:'LIVE'});assert.equal(readTradingMode(root,'TEST').mode,'LIVE');
  assert.equal(fs.existsSync(path.join(root,'config','trading-mode.json.tmp')),false);
});

test('R51 paper market fills at ask/bid with 0.05 % taker fee, realised PnL and Binance-shaped income',async()=>{
  const f=paperFixture({balance:100});
  await f.paper.handle('POST','/fapi/v1/leverage',{params:{symbol:'AUSDT',leverage:10}});
  const o=await f.order({symbol:'AUSDT',side:'BUY',quantity:'2',newClientOrderId:'c1'});
  assert.equal(o.status,'FILLED');assert.equal(Number(o.avgPrice),100.1);assert.equal(o.clientOrderId,'c1');
  let pos=await f.paper.handle('GET','/fapi/v3/positionRisk',{params:{symbol:'AUSDT'}});
  assert.equal(Number(pos[0].positionAmt),2);assert.equal(Number(pos[0].entryPrice),100.1);
  f.px.AUSDT={bid:101,ask:101.1};f.tick(1000);
  const c=await f.order({symbol:'AUSDT',side:'SELL',quantity:'5',reduceOnly:'true'});
  assert.equal(Number(c.executedQty),2,'reduceOnly is capped to the open size');
  pos=await f.paper.handle('GET','/fapi/v3/positionRisk',{params:{symbol:'AUSDT'}});assert.equal(pos.length,0);
  const inc=await f.paper.handle('GET','/fapi/v1/income',{params:{symbol:'AUSDT'}});
  const realized=inc.filter(x=>x.incomeType==='REALIZED_PNL').reduce((a,x)=>a+Number(x.income),0);
  const fees=inc.filter(x=>x.incomeType==='COMMISSION').reduce((a,x)=>a+Number(x.income),0);
  assert.ok(Math.abs(realized-(101-100.1)*2)<1e-9);
  assert.ok(Math.abs(fees+(2*100.1+2*101)*0.0005)<1e-9);
  const s=f.paper.summary();assert.ok(Math.abs(s.net-(realized+fees))<1e-3);assert.equal(s.fills,2);assert.equal(s.openPositions,0);
  const trades=await f.paper.handle('GET','/fapi/v1/userTrades',{params:{symbol:'AUSDT'}});assert.equal(trades.length,2);
  const again=new PaperExchange({root:f.root,clock:()=>2e6,priceOf:async()=>f.px.AUSDT,autoTick:false});
  assert.equal(again.summary().fills,2,'state survives a restart');
});

test('R51 paper exchange answers with Binance error codes',async()=>{
  const f=paperFixture({balance:10});
  await f.paper.handle('POST','/fapi/v1/leverage',{params:{symbol:'AUSDT',leverage:5}});
  assert.equal(await code(f.order({symbol:'AUSDT',side:'BUY',quantity:'1'})),-2019,'margin');
  assert.equal(await code(f.order({symbol:'AUSDT',side:'SELL',quantity:'0.1',reduceOnly:'true'})),-2022,'reduceOnly without position');
  assert.equal(await code(f.paper.handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'BUY',type:'LIMIT',quantity:'0.1',price:'99'}})),-1116,'MARKET only');
  await f.order({symbol:'AUSDT',side:'BUY',quantity:'0.1',newClientOrderId:'dup'});
  assert.equal(await code(f.order({symbol:'AUSDT',side:'BUY',quantity:'0.1',newClientOrderId:'dup'})),-4116,'duplicate client id');
  assert.equal(await code(f.paper.handle('POST','/fapi/v1/algoOrder',{params:{symbol:'AUSDT',side:'SELL',type:'STOP_MARKET',triggerPrice:'100.2',closePosition:'true'}})),-2021,'stop above mid would trigger');
  assert.equal(await code(f.paper.handle('DELETE','/fapi/v1/algoOrder',{params:{symbol:'AUSDT',algoId:'123'}})),-2011);
  assert.equal(await code(f.paper.handle('GET','/fapi/v1/order',{params:{symbol:'AUSDT',orderId:'1'}})),-2013);
});

test('R51 paper stop and take-profit trigger on the live mid and close the whole position',async()=>{
  const f=paperFixture({balance:100});
  await f.order({symbol:'AUSDT',side:'BUY',quantity:'1'});
  const stop=await f.paper.handle('POST','/fapi/v1/algoOrder',{params:{symbol:'AUSDT',side:'SELL',type:'STOP_MARKET',triggerPrice:'99.5',closePosition:'true',clientAlgoId:'s1'}});
  const tp=await f.paper.handle('POST','/fapi/v1/algoOrder',{params:{symbol:'AUSDT',side:'SELL',type:'TAKE_PROFIT_MARKET',triggerPrice:'102',quantity:'1',reduceOnly:'true'}});
  assert.equal(stop.algoStatus,'NEW');assert.equal((await f.paper.tick()).triggered,0);
  f.px.AUSDT={bid:99.3,ask:99.4};f.tick(1000);
  assert.equal((await f.paper.tick()).triggered,1);
  const algos=await f.paper.handle('GET','/fapi/v1/allAlgoOrders',{params:{symbol:'AUSDT'}});
  assert.equal(algos.find(a=>a.algoId===stop.algoId).algoStatus,'FINISHED');
  assert.equal(f.paper.hasExposure(),false);
  assert.equal((await f.paper.tick()).triggered,0,'the reduce-only TP has nothing left to close');
  assert.equal(algos.find(a=>a.algoId===tp.algoId).algoStatus,'NEW');
  assert.ok(f.paper.summary().realized<0);
});

test('R51 transport in TEST mode never sends an order to Binance; LIVE routing is unchanged',async()=>{
  const root=tmp('r51-transport-'),calls=[];
  const fetchImpl=async(url,init)=>{calls.push({url:String(url),method:init.method});return new Response(JSON.stringify(String(url).includes('leverageBracket')?[{symbol:'AUSDT',brackets:[]}]:{orderId:1,status:'NEW'}),{status:200,headers:{'content-type':'application/json'}});};
  const t=new BinanceLiveTransport({registry:{consume(){return null;}},fetchImpl});
  const paper=new PaperExchange({root,priceOf:async()=>({bid:10,ask:10.01}),defaultMode:'TEST',autoTick:false});
  t.attachPaper(paper);
  assert.equal(t.testModeActive(),true);
  const o=await t._fetchJson('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'BUY',type:'MARKET',quantity:'1'},credentials:FAKE,signed:true});
  assert.equal(o.paper,true);assert.equal(calls.length,0);
  for(const [m,p] of [['POST','/fapi/v1/batchOrders'],['DELETE','/fapi/v1/allOpenOrders'],['POST','/fapi/v1/marginType']]){
    const e=await t._fetchJson(m,p,{credentials:FAKE,signed:true}).then(()=>null,x=>x);
    assert.equal(e?.message,'TEST_MODE_REAL_EXCHANGE_BLOCKED',p);assert.equal(e.requestSent,false);
  }
  const e2=await t._fetchJson('GET','/fapi/v2/balance',{credentials:FAKE,signed:true}).then(()=>null,x=>x);
  assert.equal(e2?.message,'TEST_MODE_REAL_EXCHANGE_BLOCKED','unsimulated signed read is refused too');
  assert.equal(calls.length,0);
  await t._fetchJson('GET','/fapi/v1/leverageBracket',{params:{symbol:'AUSDT'},credentials:FAKE,signed:true});
  assert.equal(calls.length,1,'read-only leverage bracket stays real (sizing)');
  for(const r of PAPER_ROUTES)assert.ok(/^(GET|POST|DELETE) \/fapi\//.test(r));
  writeTradingMode(root,{mode:'LIVE'});paper.invalidateMode();
  assert.equal(t.testModeActive(),false);
  await t._fetchJson('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'BUY',type:'MARKET',quantity:'1'},credentials:FAKE,signed:true});
  assert.equal(calls.length,2);assert.equal(calls[1].method,'POST');assert.match(calls[1].url,/\/fapi\/v1\/order$/);
});

function controllerFixture({mode=null,burstLiveEnabled=false,credentials={}}={}){
  const root=tmp('r51-ctl-');fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:true,marginQuote:30,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true,...(burstLiveEnabled?{burstLiveEnabled:true}:{})}));
  if(mode)writeTradingMode(root,{mode});
  const state={now:1_000_000,calls:0,fetches:[]},events=[];
  const snap={available:true,ageMs:100,spreadBps:1,bid:10,ask:10.01,localL2:{available:true,sequenceHealthy:true,confidence:.9},
    orderFlow:{windows:{'1s':{buyRatio:.85,sellRatio:.15,priceMoveBps:6,buyQuote:9000,sellQuote:1000},'3s':{buyRatio:.85,sellRatio:.15,priceMoveBps:12,trades:8,buyQuote:18000,sellQuote:2000},'5s':{buyRatio:.85,sellRatio:.15}}},
    level1Ofi:{windows:{'1s':{normalizedOfi:.8,queueImbalanceCurrent:.7,micropriceBps:1},'3s':{normalizedOfi:.8,transitions:4}}}};
  const stream={ensureSymbol(){},ensureLocalL2:()=>({}),snapshot:()=>snap,localL2:{releaseReservation(){}}};
  const pool=['A','B'].map(x=>({symbol:x+'USDT',direction:'LONG',state:'IGNITION',preMove:{state:'IGNITION',direction:'LONG'}}));
  const fetchImpl=async url=>{state.fetches.push(String(url));if(String(url).includes('/fapi/v1/time'))return new Response(JSON.stringify({serverTime:state.now}),{status:200});throw Error('NO_NETWORK_IN_FIXTURE');};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k,s,p)=>events.push({k,s,p})},
    scanner:{scan:async()=>({preMoveSignals:pool,nearExplosion:pool})},pipeline:{},committee:async()=>({}),
    market:{marketStream:stream,cachedChartContext:symbol=>({available:true,symbol,packet:{},asOf:state.now,ageMs:0})},
    burstJudge:async()=>{state.calls++;return {ok:true,called:true,decision:'ARM_LONG',side:'LONG',ttlMs:30000,reason:'EARLY_EXPANSION',triggerThreshold:.82};},
    credentials,fetchImpl,paperAutoTick:false});
  return {controller,state,events,root};
}

test('R51 burst stays off for real money unless the user enables it; TEST mode runs it',async()=>{
  const live=controllerFixture();
  const r=await live.controller.burstArmTick();
  assert.equal(r.reason,'BURST_LIVE_DISABLED');assert.equal(live.state.calls,0,'no JEV call either');
  assert.equal(live.controller.burstStatus().armed.length,0);
  const paper=controllerFixture({mode:'TEST'});
  const t=await paper.controller.burstArmTick();
  assert.notEqual(t.reason,'BURST_LIVE_DISABLED');assert.equal(paper.controller.burstStatus().armed.length,2);
  assert.ok(paper.events.filter(x=>x.p&&typeof x.p==='object').every(x=>x.p.tradingMode==='TEST'),'every TEST journal row is tagged');
  assert.ok(live.events.every(x=>!x.p||x.p.tradingMode===undefined),'LIVE rows carry no TEST tag');
  const optIn=controllerFixture({burstLiveEnabled:true});
  assert.notEqual((await optIn.controller.burstArmTick()).reason,'BURST_LIVE_DISABLED');
});

test('R51 burst structural stop floor is 0.30 % (06.10 variant B)',()=>{
  assert.equal(PULLBACK_RULES.minStopPct,0.30);
});

test('R51 mode switch: explicit, refused while armed or with a paper position, resets the paper balance',async()=>{
  const f=controllerFixture({credentials:FAKE});
  let st=f.controller.tradingModeStatus();assert.equal(st.mode,'LIVE');assert.equal(st.realOrdersPossible,true);assert.equal(st.paper,null);
  assert.deepEqual((await f.controller.setTradingMode({mode:'PAPER'})).reasons,['TRADING_MODE_INVALID']);
  const sw=await f.controller.setTradingMode({mode:'TEST',startBalance:250});
  assert.equal(sw.ok,true);assert.equal(sw.mode,'TEST');assert.equal(sw.paper.startBalance,250);assert.equal(sw.realOrdersPossible,false);
  assert.ok(f.state.fetches.some(u=>u.includes('/fapi/v3/positionRisk')),'real account checked flat before switching');
  assert.ok(f.events.some(x=>x.k==='TRADING_MODE_CHANGED'&&x.p.from==='LIVE'&&x.p.to==='TEST'));
  assert.equal(f.controller.status().tradingMode.mode,'TEST');
  const armed=await f.controller.arm({confirmed:true});
  assert.equal(armed.ok,true,'TEST arm probes the paper account');
  assert.ok(!f.state.fetches.some(u=>u.includes('/fapi/v3/account')),'account probe never reached Binance');
  assert.deepEqual((await f.controller.setTradingMode({mode:'LIVE'})).reasons,['DISARM_FIRST']);
  f.controller.disarm('TEST');
  await f.controller._testPaper().handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'BUY',type:'MARKET',quantity:'1'}});
  const blocked=await f.controller.setTradingMode({mode:'LIVE'});
  assert.equal(blocked.ok,false);assert.ok(blocked.reasons.includes('TEST_POSITION_OPEN'));
  await f.controller._testPaper().handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'SELL',type:'MARKET',quantity:'1',reduceOnly:'true'}});
  const back=await f.controller.setTradingMode({mode:'LIVE'});
  assert.equal(back.ok,true);assert.equal(back.mode,'LIVE');assert.equal(readTradingMode(f.root).mode,'LIVE');
});

test('R51 reports keep TEST closes out of the real-money totals',()=>{
  const close=(id,net,mode)=>({id,ts:id,kind:'POSITION_CLOSED',symbol:'AUSDT',payload:{side:'LONG',netPnl:net,rMultiple:net,openedAt:new Date(id).toISOString(),closedAt:new Date(id+60000).toISOString(),tradeLane:'5M_SCALP',eventId:'e'+id,...(mode?{tradingMode:mode}:{})}});
  const r=performanceReport([close(1e12,2),close(1e12+1e6,-1,'TEST'),close(1e12+2e6,-3,'TEST')],[],1e12+3e6);
  assert.equal(r.total.closed,1);assert.equal(r.total.netPnl,2);
  assert.equal(r.testMode.total.closed,2);assert.equal(r.testMode.total.netPnl,-4);
  assert.equal(r.reconciliation.testClosedRows,2);
  const desk=r.desks.find(d=>d.desk==='5M_SCALP');
  assert.ok(desk.cohorts.some(c=>c.version==='TEST'&&c.closed===2));
  assert.ok(desk.cohorts.filter(c=>c.version!=='TEST').every(c=>c.netPnl>=0),'real cohorts never include TEST losses');
});

test('R51 Office control: local header required, body rebuilt from a whitelist, token added server-side',async t=>{
  const seen=[];
  const brain=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{seen.push({path:req.url,auth:req.headers.authorization,body:JSON.parse(b||'{}')});res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));});});
  await new Promise(r=>brain.listen(0,'127.0.0.1',r));t.after(()=>brain.close());
  process.env.BRAINHUB_URL='http://127.0.0.1:'+brain.address().port;process.env.BRAINHUB_CLIENT_TOKEN='fake-office-token-r51';process.env.BRAINHUB_ROOT=tmp('r51-office-');delete process.env.OFFICE_KEY;
  const office=require('../office-dashboard/office-server.js');
  await new Promise(r=>office.server.listen(0,'127.0.0.1',r));t.after(()=>office.server.close());
  const base='http://127.0.0.1:'+office.server.address().port;
  const post=(p,body,headers={'content-type':'application/json','x-jev-office-control':'1'})=>fetch(base+p,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await post('/api/control/mode',{mode:'TEST',confirm:'TEST'},{'content-type':'application/json'})).status,403);
  assert.equal((await post('/api/control/arm',{confirm:'LIVE'},{'content-type':'text/plain','x-jev-office-control':'1'})).status,403);
  assert.equal(seen.length,0);
  assert.equal((await post('/api/control/mode',{mode:'test',confirm:'test',testBalance:'250',burstLiveEnabled:true})).status,200);
  assert.equal((await post('/api/control/oto',{enabled:true,burstLiveEnabled:true,marginQuote:999,leverage:125})).status,200);
  assert.equal((await post('/api/control/arm',{confirm:'LIVE',extra:1})).status,200);
  assert.equal((await post('/api/control/disarm',{reason:'x'.repeat(50)})).status,200);
  assert.deepEqual(seen.map(x=>x.path),['/live/mode','/live/leader-auto','/live/arm','/live/disarm']);
  assert.deepEqual(seen[0].body,{mode:'TEST',confirm:'TEST',testBalance:250});
  assert.deepEqual(seen[1].body,{enabled:true},'OTO switch never changes sizing or the burst opt-in');
  assert.deepEqual(seen[2].body,{confirm:'LIVE'});assert.deepEqual(seen[3].body,{reason:'OFFICE_USER'});
  assert.ok(seen.every(x=>x.auth==='Bearer fake-office-token-r51'));
  assert.equal((await post('/api/control/pair',{})).status,405,'no other write route');
  assert.equal((await fetch(base+'/api/control/mode',{method:'PUT',headers:{'content-type':'application/json','x-jev-office-control':'1'},body:'{}'})).status,405);
});

test('R51 Office page has the mode panel and badges TEST rows',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['modeBar','btnModeTest','btnModeLive','btnArm','btnDisarm','btnOto'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/'x-jev-office-control':'1'/);
  assert.match(html,/tradingMode==='TEST'\?'<span class="tbadge">TEST<\/span>'/);
  assert.match(html,/BURST_LIVE_DISABLED:'Vur-kaç gerçek parada kapalı/);
});
