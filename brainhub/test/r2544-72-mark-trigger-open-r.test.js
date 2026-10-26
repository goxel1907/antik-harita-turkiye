'use strict';
// R2544.72 (user 22.10: "bu pozisyonlara bak ... giriş ve çıkış zamanlaması ... herşeyi kontrol et"). Found and fixed:
//  - Office open rows: R was measured from the MOVED stop (after the partial/break-even): BASED 26.5R, ZAMA 27.9R, AKE 37.5R;
//    now from the entry stop (initialStopPrice);
//  - a ZİRVE-5 lot showed "dış/manuel" and İlk 3's release label;
//  - İlk 3 lots did not carry the SFP the rule required (only the signal had it) - now in entryFeatures (brain, lessons);
//  - the TEST paper exchange triggered stop/TP on the bid/ask mid; Binance triggers these orders (workingType MARK_PRICE) on
//    the MARK price (ZAMA 22.10: paper half 01:18, mark reached it 01:21) - now on the mark when the stream has it.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode,PaperExchange}=require('../binance-live-transport');

function paperAt(px){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r72-'));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-22T00:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const asked=[];
  const p=new PaperExchange({root,clock:()=>Date.UTC(2026,9,22,1,18),priceOf:async()=>({...px.v}),candlesOf:async(s,a,b,kind)=>{asked.push(kind);return [];},startBalance:1000,autoTick:false});
  return {p,asked};
}
test('R2544.72 paper: a MARK_PRICE take-profit fills when the MARK price reaches it, not when only the mid does; no mark = mid (as before)',async()=>{
  const px={v:{bid:0.0830,ask:0.0830,mark:0.0830}};const {p}=paperAt(px);
  await p.handle('POST','/fapi/v1/order',{params:{symbol:'ZAMAUSDT',side:'SELL',type:'MARKET',quantity:'100'}});
  await p.handle('POST','/fapi/v1/algoOrder',{params:{symbol:'ZAMAUSDT',side:'BUY',algoType:'CONDITIONAL',type:'TAKE_PROFIT_MARKET',triggerPrice:'0.08039',quantity:'50',reduceOnly:'true'}});
  const a=p.state.algos[0];assert.equal(a.workingType,'MARK_PRICE');
  px.v={bid:0.08035,ask:0.08037,mark:0.08045};await p.tick();                       // mid below 0.08039, mark still above (ZAMA 01:18)
  assert.equal(a.algoStatus,'NEW','the mid alone does not fill a MARK_PRICE order');
  px.v={bid:0.08030,ask:0.08032,mark:0.08036};await p.tick();                       // mark reaches it (01:21)
  assert.equal(a.algoStatus,'FINISHED');
  // no mark from the stream: the mid decides (old behaviour, never stuck)
  await p.handle('POST','/fapi/v1/algoOrder',{params:{symbol:'ZAMAUSDT',side:'BUY',algoType:'CONDITIONAL',type:'STOP_MARKET',triggerPrice:'0.0815',quantity:'50',reduceOnly:'true'}});
  const s=p.state.algos[1];px.v={bid:0.0816,ask:0.0816};await p.tick();assert.equal(s.algoStatus,'FINISHED');
  // placing: "would immediately trigger" is judged on the mark too
  await p.handle('POST','/fapi/v1/order',{params:{symbol:'ZAMAUSDT',side:'SELL',type:'MARKET',quantity:'10'}});
  px.v={bid:0.0800,ask:0.0800,mark:0.0805};
  await p.handle('POST','/fapi/v1/algoOrder',{params:{symbol:'ZAMAUSDT',side:'BUY',algoType:'CONDITIONAL',type:'TAKE_PROFIT_MARKET',triggerPrice:'0.0802',quantity:'10',reduceOnly:'true'}});
  assert.equal(p.state.algos[2].algoStatus,'NEW','mark 0.0805 is above a 0.0802 short target: accepted although the mid is below');
});
test('R2544.72 paper catch-up replays MARK_PRICE orders on mark-price candles',async()=>{
  const px={v:{bid:1,ask:1,mark:1}};const {p,asked}=paperAt(px);
  await p.handle('POST','/fapi/v1/order',{params:{symbol:'AUSDT',side:'SELL',type:'MARKET',quantity:'10'}});
  await p.handle('POST','/fapi/v1/algoOrder',{params:{symbol:'AUSDT',side:'BUY',algoType:'CONDITIONAL',type:'STOP_MARKET',triggerPrice:'1.05',quantity:'10',reduceOnly:'true'}});
  await p._catchUp(Date.UTC(2026,9,22,1,0),Date.UTC(2026,9,22,1,18));assert.deepEqual(asked,['MARK']);
});
test('R2544.72 stream: markPrice@1s is subscribed and the snapshot carries a fresh mark price (stale after 3 s)',()=>{
  const M=require('../market');let now=Date.UTC(2026,9,22,1,0);
  const s=new M.StreamingMarket({WebSocketImpl:null,now:()=>now});
  assert.deepEqual(s.channels.market.streams,['aggTrade','forceOrder','markPrice@1s'],'subscribed on the market endpoint');
  s.ensureSymbol?.('ZAMAUSDT');if(!s.states.has('ZAMAUSDT'))s.states.set('ZAMAUSDT',{symbol:'ZAMAUSDT',lastEventAt:0,book:null,depth:null,depthAt:0,bookHistory:[],lastBookHistoryAt:0,depthHistory:[],lastDepthHistoryAt:0,trades:[],tradeAt:0,liquidations:[],liquidationAt:0,mark:null,createdAt:now});
  assert.equal(s.ingest({e:'markPriceUpdate',E:now,s:'ZAMAUSDT',p:'0.08036'}),true);
  assert.equal(s.snapshot('ZAMAUSDT',now).markPrice,0.08036);
  now+=4000;assert.equal(s.snapshot('ZAMAUSDT',now).markPrice,null,'stale mark is not used');
});
test('R2544.72 wiring: open rows take R from the entry stop; ZİRVE-5 lots are named; İlk 3 lots carry the sweep; mark candles weigh like klines',()=>{
  const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  const lc=src('live-controller.js');
  assert.match(lc,/const firstStop=lot\?\(finite\(lot\.initialStopPrice\)\?\?finite\(lot\.stopPrice\)\)/);
  assert.match(lc,/releaseContract:bl\?BURST_RELEASE_CONTRACT:t3\?\(t3\.lane==='ZIRVE5'\?z5Lib\.ZIRVE5_VERSION:top3Lib\.TOP3_VERSION\)/);
  assert.match(lc,/sweep:x\.trig\.sweep\|\|null,pa:x\.pa\|\|null,ind:x\.ind\|\|null\}/);
  assert.match(lc,/kind==='MARK'\?'\/fapi\/v1\/markPriceKlines':'\/fapi\/v1\/klines'/);
  assert.match(src('office-dashboard/public/office.html'),/p\.openedBy==='BRAINHUB_ZIRVE5'\?'OTO ZİRVE-5'/);
  const {endpointWeight}=require('../binance-rate-limit');
  if(typeof endpointWeight==='function')assert.equal(endpointWeight('/fapi/v1/markPriceKlines?symbol=A&limit=1000'),10);
});

test('R2544.72 open row (functional): after the stop moved to break-even the R is still from the entry stop; ZİRVE-5 opener and version',async()=>{
  require('../binance-rate-limit').resetForTests();
  const M15=900000,ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r72o-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({enabled:true,requireSweep:false}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-22T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  // R2544.64 rule series: rise, dip break, volume-backed bear close inside the zone
  const series=(points,lastOpen,qv=1000)=>{const out=[];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];for(let j=1;j<=8;j++){const p=a+(b-a)*(j-1)/8,c=a+(b-a)*j/8;out.push([p,c]);}}
    const t0=lastOpen-(out.length-1)*M15;return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05,quoteVolume:qv}));};
  const bar=Date.UTC(2026,9,22,8,0),k=series([100,100,100,100,100,100,100,103,98,101.5,96,92,99.4,98.6],bar);k.at(-1).quoteVolume=5000;
  const c0=k.at(-1).close,state={now:bar+M15+10000,px:{Z5USDT:{bid:c0,ask:c0+0.01}}};
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url)=>{const u=new URL(url),p=u.pathname;
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s2=u.searchParams.get('symbol'),x=state.px[s2]||{bid:10,ask:10.01};return ok({symbol:s2,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['Z5USDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'Z5USDT',highPrice:'110',lowPrice:'90',lastPrice:'99',quoteVolume:'50000000',priceChangePercent:'-1'}]);
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines')return ok(k.map(r=>[r.openTime,String(r.open),String(r.high),String(r.low),String(r.close),'0',r.closeTime,String(r.quoteVolume)]));
    throw new Error('UNEXPECTED '+p);};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal(){},recordLearning(){}},scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:{apiKey:'fake-r72',apiSecret:'fake-r72'},fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  await controller.testSupervisorTick();assert.equal((await controller.z5Tick()).entries,1,JSON.stringify(controller.z5Status().recentEntries));
  const lot=Object.values(controller._testTop3State().active)[0],R0=Math.abs(lot.entryPrice-lot.stopPrice);
  // the partial moved the stop to break-even (as BASED/ZAMA/AKE 22.10)
  lot.initialStopPrice=lot.stopPrice;lot.stopPrice=lot.entryPrice*0.9988;lot.beMoved=true;
  const mark=lot.entryPrice-1.5*R0;state.px.Z5USDT={bid:mark,ask:mark+0.01};
  await controller.positionLedgerTick();
  const row=controller.positionsStatus().open.find(r=>r.symbol==='Z5USDT');
  assert.equal(row.openedBy,'BRAINHUB_ZIRVE5');assert.match(String(row.releaseContract),/ZIRVE5/);
  assert.equal(row.originalStopPrice,lot.initialStopPrice);
  assert.ok(row.unrealizedR>1&&row.unrealizedR<2,'about 1.5 R from the entry stop, not 1000 R from the break-even stop: '+row.unrealizedR);
  assert.ok(Math.abs(row.priceR-1.5)<0.05,'price distance in R from the entry stop: '+row.priceR);assert.equal(row.partialTaken,false);
});
