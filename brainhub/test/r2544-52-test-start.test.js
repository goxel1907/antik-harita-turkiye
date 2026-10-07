'use strict';
// R2544.52 (07.10.2026): the R51 TEST ran 19 h with OTO off — 2,415 ticks LEADER_AUTO_DISABLED, no scan, no JEV call.
// Start now turns OTO + arm on together, Stop turns both off, the 24 h window starts at the first start, TEST can be
// restarted, and the full entry path (preflight, leverage, MARKET, STOP, TPs) is proven to run on the paper exchange.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BinanceLiveTransport,PaperExchange,readTradingMode,writeTradingMode}=require('../binance-live-transport');

const FAKE={apiKey:'fake-test-key-r52',apiSecret:'fake-test-secret-r52'}; // made-up, never real
const tmp=p=>fs.mkdtempSync(path.join(os.tmpdir(),p));
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});

test('R52 full entry in TEST mode: preflight, MARKET, STOP and TPs all land on the paper exchange; no signed call reaches Binance',async()=>{
  const root=tmp('r52-submit-');writeTradingMode(root,{mode:'TEST',testStartedAt:1});
  const calls=[];
  const fetchImpl=async(url,o={})=>{const p=new URL(url).pathname,m=o.method||'GET';calls.push(`${m} ${p}`);
    if(p==='/fapi/v1/time')return ok({serverTime:1000000});
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',filters:[{filterType:'MARKET_LOT_SIZE',minQty:'0.001',maxQty:'1000',stepSize:'0.001'},{filterType:'PRICE_FILTER',minPrice:'0.1',maxPrice:'1000000',tickSize:'0.1'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]});
    if(p==='/fapi/v1/ticker/price')return ok({symbol:'BTCUSDT',price:'100'});
    throw new Error('REAL_EXCHANGE_CALL '+m+' '+p);};
  let px={bid:99.95,ask:100.05};
  const paper=new PaperExchange({root,clock:()=>1000000,priceOf:async()=>px,startBalance:200,autoTick:false});
  const t=new BinanceLiveTransport({registry:{consume:({grantId})=>({ok:true,consumed:true,liveAllowed:true,execution:'LIVE_AUTHORIZED_ONCE',grantId,lineageId:'l-r52',clientOrderId:'r52-entry',symbol:'BTCUSDT',side:'LONG',reasons:[]})},fetchImpl,clock:()=>1000000}).attachPaper(paper);
  const r=await t.submit({grantId:'g-r52',order:{action:'OPEN',symbol:'BTCUSDT',side:'LONG',orderType:'MARKET',quantity:0.3,entryPrice:100,stopPrice:98.8,takeProfit1:102,takeProfit2:104,takeProfit3:106,clientOrderId:'r52-entry',lineageId:'l-r52'},credentials:FAKE,livePolicy:{expectedLeverage:10,maxEntryDeviationPct:0.5}});
  assert.equal(r.ok,true,JSON.stringify(r.reasons||r));assert.equal(r.orderPlaced,true);assert.equal(r.stopProtected,true);assert.equal(r.tpProtected,true);
  assert.deepEqual(calls.filter(c=>!/\/fapi\/v1\/(time|exchangeInfo|ticker\/price)$/.test(c)),[],'only public market data went to Binance');
  const s=paper.summary();assert.equal(s.openPositions,1);assert.equal(s.openAlgos,4);assert.equal(s.fills,1);
  assert.ok(s.fees<0,'taker fee booked');
  px={bid:98.6,ask:98.7};assert.equal((await paper.tick()).triggered,1,'stop fires on the live price');
  assert.equal(paper.hasExposure(),false);assert.ok(paper.summary().realized<0);
});

function controllerFixture({mode='TEST'}={}){
  const root=tmp('r52-ctl-');fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  if(mode)writeTradingMode(root,{mode,changedAt:'2026-10-06T12:34:13.362Z',testStartedAt:mode==='TEST'?1791290053362:null});
  const state={now:1791359000000},events=[];
  const fetchImpl=async url=>{if(String(url).includes('/fapi/v1/time'))return ok({serverTime:state.now});throw Error('NO_NETWORK_IN_FIXTURE');};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k,s,p)=>events.push({k,s,p})},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false});
  return {controller,state,events,root};
}

test('R52 TEST restart: new paper balance and the 24 h clock waits for the first start',async()=>{
  const f=controllerFixture();
  let st=f.controller.tradingModeStatus();
  assert.equal(st.testStarted,true);assert.ok(st.testElapsedHours>19,'the 06.10 file: 19 h already counted');
  assert.equal((await f.controller.setTradingMode({mode:'TEST'})).unchanged,true,'plain TEST->TEST changes nothing');
  const r=await f.controller.setTradingMode({mode:'TEST',startBalance:200,restart:true});
  assert.equal(r.ok,true);assert.equal(r.testStarted,false);assert.equal(r.testElapsedHours,null);assert.equal(r.paper.startBalance,200);
  assert.ok(f.events.some(x=>x.k==='TRADING_MODE_CHANGED'&&x.p.restart===true));
  f.state.now+=3600000;assert.equal(f.controller.tradingModeStatus().testElapsedHours,null,'no clock before the first start');
  const armed=await f.controller.arm({confirmed:true});assert.equal(armed.ok,true);
  st=f.controller.tradingModeStatus();assert.equal(st.testStarted,true);assert.equal(st.testElapsedHours,0);
  assert.equal(readTradingMode(f.root).testStartedAt,f.state.now);
  f.state.now+=2*3600000;assert.equal(f.controller.tradingModeStatus().testElapsedHours,2);
  f.controller.disarm('X');f.state.now+=1000;await f.controller.arm({confirmed:true});
  assert.equal(f.controller.tradingModeStatus().testElapsedHours,2,'a later start does not reset the window');
  assert.deepEqual((await f.controller.setTradingMode({mode:'TEST',restart:true})).reasons,['DISARM_FIRST'],'restart only when stopped');
});

test('R52 LIVE mode start never touches the TEST clock',async()=>{
  const f=controllerFixture({mode:'LIVE'});
  const before=fs.readFileSync(path.join(f.root,'config','trading-mode.json'),'utf8');
  const a=await f.controller.arm({confirmed:true});
  assert.equal(a.ok,false,'fixture has no network: the LIVE account probe fails closed');
  assert.equal(fs.readFileSync(path.join(f.root,'config','trading-mode.json'),'utf8'),before);
  assert.equal(f.controller.tradingModeStatus().testStarted,false);
});

test('R52 Office forwards the TEST restart flag and nothing else new',()=>{
  const {CONTROL_BODY}=require('../office-dashboard/office-server.js');
  assert.deepEqual(CONTROL_BODY['/api/control/mode']({mode:'test',confirm:'test',testBalance:'200',restart:true,leverage:125}),{mode:'TEST',confirm:'TEST',testBalance:200,restart:true});
  assert.deepEqual(CONTROL_BODY['/api/control/mode']({mode:'TEST',confirm:'TEST',restart:'yes'}),{mode:'TEST',confirm:'TEST'});
});
