'use strict';
// R2544.69 KÂR KORUMA (user 21.10: PARTI saw +2.29R and closed -0.12R; "nerede kapatacağını bilmiyor"; then "TESTTE NE TEST
// EDİLİYOR İSE CANLIDA BU BİREBİR ÇALIŞACAK"): at +1R a reduce-only take-profit takes half the lot, then the rest's stop goes to
// break-even + fees and the target is re-placed for the rest. The SAME code runs in TEST (paper exchange) and LIVE (Binance):
// here LIVE runs against a simulated Binance (signed HTTP requests answered by a separate exchange model) and the order
// requests of both modes are compared one by one.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode,PaperExchange}=require('../binance-live-transport');
const Z=require('../zirve5');
const M15=900000;
function series(points,lastOpen,qv=1000){
  const out=[];for(let s=1;s<points.length;s++){const a=points[s-1],b=points[s];for(let i=1;i<=8;i++){const p=a+(b-a)*(i-1)/8,c=a+(b-a)*i/8;out.push([p,c]);}}
  const t0=lastOpen-(out.length-1)*M15;
  return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05,quoteVolume:qv}));
}
// SHORT zone [97.95, 101.55]; after the break price runs to 92 (liquidity ~91.95 = ~2.2R), comes back into the zone, then a
// volume-backed bear candle closes inside it (99.6 -> 98.6). LONG = the mirror.
const P=[100,100,100,100,100,100,100,103,98,101.5,96,92,99.4];
function scenario(side,lastOpen){
  const c=series(side==='SHORT'?P:P.map(x=>200-x),lastOpen-M15);
  const k=side==='SHORT'?{o:99.6,c:98.6}:{o:200-99.6,c:200-98.6};
  c.push({openTime:lastOpen,closeTime:lastOpen+M15-1,open:k.o,close:k.c,high:Math.max(k.o,k.c)+0.05,low:Math.min(k.o,k.c)-0.05,quoteVolume:5000});
  return c;
}
const FAKE={apiKey:'fake-test-key-r69',apiSecret:'fake-test-secret-r69'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({side='SHORT',z5={enabled:true},top3={}}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r69-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  // R2544.73: the default level is 2R; these mechanics tests pin 1R (same code path at any level)
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false,partial:{atR:1},...top3}));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({requireSweep:false,partAtR:1,...z5}));   // R2544.70: sweep rule tested in r2544-70
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-21T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const bar=Date.UTC(2026,9,21,10,0),k=scenario(side,bar),c0=k.at(-1).close;
  const state={now:bar+M15+10000,px:{Z5USDT:{bid:c0,ask:c0+0.01}},k15:{Z5USDT:k},orders:[]};
  // simulated Binance for LIVE: its own exchange model (same Binance error codes), answering the signed HTTP requests
  const binRoot=fs.mkdtempSync(path.join(os.tmpdir(),'r69bin-'));
  const binance=new PaperExchange({root:binRoot,clock:()=>state.now,priceOf:async s=>state.px[s],defaultMode:'LIVE',startBalance:100,autoTick:false});
  binance.active=()=>true;   // the exchange model always runs its triggers (it plays Binance, not the TEST switch)
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['Z5USDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'Z5USDT',highPrice:'110',lowPrice:'90',lastPrice:'99',quoteVolume:'50000000',priceChangePercent:'-1'}]);
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines'){const kk=state.k15[u.searchParams.get('symbol')]||[];return ok(kk.map(r=>[r.openTime,String(r.open),String(r.high),String(r.low),String(r.close),'0',r.closeTime,String(r.quoteVolume)]));}
    // signed account / order endpoints -> the simulated Binance (the request is exactly what Binance would receive)
    const params={};for(const [k2,v] of u.searchParams)if(!['timestamp','signature','recvWindow'].includes(k2))params[k2]=v;
    if(o.body){for(const [k2,v] of new URLSearchParams(String(o.body)))if(!['timestamp','signature','recvWindow'].includes(k2))params[k2]=v;}
    if(['POST','DELETE'].includes(m))state.orders.push({mode:'LIVE',m,p,params});
    try{return ok(await binance.handle(m,p,{params}));}
    catch(e){return {ok:false,status:e.status||400,async text(){return JSON.stringify(e.body||{code:-1,msg:String(e.message)});}};}
  };
  const events=[];
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k2,s,p)=>events.push({k:k2,s,p}),recordLearning:()=>{}},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  // TEST: record what the paper exchange receives (the same request objects the transport would sign for Binance)
  const paper=controller._testPaper(),h=paper.handle.bind(paper);
  paper.handle=async(m,p,opts={})=>{if(['POST','DELETE'].includes(m))state.orders.push({mode:'TEST',m,p,params:{...(opts.params||{})}});return h(m,p,opts);};
  const exchange=()=>controller.status().tradingMode?.mode==='LIVE'?binance:paper;
  const setPx=v=>{state.px.Z5USDT={bid:v,ask:Number((v+0.01).toFixed(2))};};
  // one exchange beat: price, triggers, then the lane manager (same order as the running system)
  const beat=async v=>{if(v!==undefined)setPx(v);state.now+=2000;await exchange().tick();state.now+=2000;await controller.top3Tick();};
  return {root,state,events,controller,binance,paper,exchange,setPx,beat,kinds:k2=>events.filter(e=>e.k===k2),lot:()=>Object.values(controller._testTop3State().active)[0]||null};
}
const pos=async(ex)=>{const r=await ex.handle('GET','/fapi/v3/positionRisk',{params:{symbol:'Z5USDT'}});return Number(r[0]?.positionAmt||0);};

test('R2544.69 TEST: half at +1R (exchange order), rest stop to break-even + fees, target re-placed; a return to break-even closes the rest in profit',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);
  const a=JSON.parse(JSON.stringify(f.lot()));assert.equal(a.side,'SHORT');   // a copy: the live lot object changes
  const R=a.stopPrice-a.entryPrice;assert.ok(R>0);
  assert.ok(a.part&&a.part.onExchange===true,JSON.stringify(a.part));assert.equal(a.part.atR,1);
  assert.ok(Math.abs(a.part.qty-Math.floor(a.quantity/2*1000)/1000)<1e-9,'half the lot');assert.equal(a.initialQuantity,a.quantity);
  assert.ok(Math.abs(a.part.price-(a.entryPrice-R))<=0.011,'at entry - 1R (tick-rounded toward the entry) '+a.part.price);
  const open=f.paper.state.algos.filter(x=>x.algoStatus==='NEW');
  assert.equal(open.length,3,'stop + target + partial');assert.ok(open.every(x=>x.reduceOnly===true),'all reduce-only');
  const full=a.quantity;
  // +0.8R: nothing happens
  await f.beat(a.entryPrice-0.8*R);assert.equal(f.lot().part.done,false);assert.equal(Math.abs(await pos(f.paper)),full);
  // +1.1R: the partial fills on the exchange; the manager moves the rest to break-even + fees and re-places the target
  await f.beat(a.entryPrice-1.1*R);
  const b=f.lot();assert.equal(b.part.done,true);assert.equal(b.part.beDone,true);assert.equal(b.beMoved,true);
  assert.ok(Math.abs(Math.abs(await pos(f.paper))-(full-a.part.qty))<1e-9,'half closed');assert.ok(Math.abs(b.quantity-(full-a.part.qty))<1e-9);
  assert.ok(b.stopPrice<a.entryPrice&&b.stopPrice>=a.entryPrice*(1-0.0012)-0.011,'SHORT stop now just under the entry (fees covered): '+b.stopPrice);
  assert.equal(b.initialStopPrice,a.stopPrice,'risk stays measured from the entry stop');
  const now=f.paper.state.algos.filter(x=>x.algoStatus==='NEW');
  assert.equal(now.length,2);assert.ok(now.every(x=>Math.abs(Number(x.quantity)-b.quantity)<1e-9),'stop and target sized for the rest');
  assert.equal(f.kinds('ZIRVE5_PARTIAL').length,1);assert.equal(f.kinds('ZIRVE5_PARTIAL_BE').length,1);
  // price comes back to break-even: the rest closes there; the lot is still in profit
  await f.beat(a.entryPrice*(1-0.0005));await f.beat();
  assert.equal(f.lot(),null,'lot finished');assert.equal(await pos(f.paper),0);
  const c=f.kinds('TOP3_CLOSED').at(-1).p;assert.equal(c.exitReason,'TOP3_BE_STOP');
  const rec=f.controller._testTop3CloseRecord(c,{net:0.1,realized:0.2,commission:0.1,funding:0},null);
  assert.equal(rec.quantity,full,'record keeps the opened quantity');assert.equal(rec.partial.taken,true);assert.equal(rec.partial.restToBreakEven,true);
  assert.ok(Math.abs(rec.riskQuote-full*R)<0.05,'risk on the full lot and the entry stop');
  const pnl=f.paper.state.income.filter(x=>x.symbol==='Z5USDT').reduce((s,x)=>s+Number(x.income),0);
  assert.ok(pnl>0,'half at +1R and the rest at break-even + fees = net profit after fees: '+pnl);
  assert.ok(Math.abs(pnl/(full*R)-0.5)<0.12,'about +0.5R ('+(pnl/(full*R)).toFixed(3)+'R)');
});

test('R2544.69 TEST: price already back through break-even when the manager sees the partial -> the rest is closed at once (never left open)',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({side:'LONG'});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);
  const a=f.lot(),R=a.entryPrice-a.stopPrice;assert.equal(a.side,'LONG');
  // the partial fills on the exchange tick, then price drops under break-even before the manager runs
  f.setPx(a.entryPrice+1.2*R);f.state.now+=2000;await f.paper.tick();
  f.setPx(a.entryPrice-0.2*R);f.state.now+=2000;await f.controller.top3Tick();
  assert.equal(f.lot(),null);assert.equal(await pos(f.paper),0);
  assert.equal(f.kinds('TOP3_CLOSED').at(-1).p.exitReason,'TOP3_BE_STOP');
  assert.equal(f.paper.state.algos.filter(x=>x.algoStatus==='NEW').length,0,'no order left behind');
});

test('R2544.69 switches and limits: partial OFF = old behaviour; a target within ~1R = no partial (the target takes it); İlk 3 v2 carries the same plan',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,partialEnabled:false}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);
  assert.equal(f.lot().part,null);assert.equal(f.paper.state.algos.filter(x=>x.algoStatus==='NEW').length,2,'stop + target only');
  // target within 1R + 0.05: skipped (reason recorded)
  require('../binance-rate-limit').resetForTests();
  const g=fixture();g.state.k15.Z5USDT=(()=>{const c=series([100,100,100,100,100,100,100,103,98,101.5,96,95.5,99.4],Date.UTC(2026,9,21,10,0)-M15);
    c.push({openTime:Date.UTC(2026,9,21,10,0),closeTime:Date.UTC(2026,9,21,10,0)+M15-1,open:99.6,close:98.6,high:99.65,low:98.55,quoteVolume:5000});return c;})();
  await g.controller.testSupervisorTick();assert.equal((await g.controller.z5Tick()).entries,1);
  assert.equal(g.lot().part.skipped,'PART_TARGET_WITHIN_PART_R');
  // config + Office switch
  const T3=require('../top3-hunter');assert.equal(T3.DEFAULT_CONFIG.partial.enabled,true);assert.equal(Z.DEFAULT_CONFIG.partialEnabled,true);
  assert.equal(f.controller.configureZ5({partialEnabled:true}).switches.partialEnabled,true);
  assert.equal(f.controller.configureTop3({partialEnabled:false}).partial.enabled,false);
  const {CONTROL_BODY}=require('../office-dashboard/office-server');
  assert.equal(CONTROL_BODY['/api/control/zirve5']({partialEnabled:false}).partialEnabled,false);
  assert.equal(CONTROL_BODY['/api/control/top3']({partialEnabled:true}).partialEnabled,true);
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.ok(html.includes('id="btnZ5Part"')&&html.includes('id="btnT3Part"'));
});

test('R2544.69 TEST = LIVE: the same signal sends the same orders (type, side, quantity, trigger, reduce-only) to the paper exchange in TEST and to Binance in LIVE, and both end the same',async()=>{
  const runMode=async live=>{
    require('../binance-rate-limit').resetForTests();
    const f=fixture();await f.controller.testSupervisorTick();
    if(live){const r=await f.controller.runControl({action:'GO_LIVE'});assert.equal(r.ok,true,JSON.stringify(r));
      assert.equal(f.controller.status().tradingMode.mode,'LIVE');assert.equal(f.controller.z5Status().switches.liveEnabled,true);}
    const ex=live?f.binance:f.paper;
    assert.equal((await f.controller.z5Tick()).entries,1,JSON.stringify(f.controller.z5Status().recentEntries));
    const a=f.lot(),R=a.stopPrice-a.entryPrice;assert.equal(a.mode,live?'LIVE':'TEST');
    await f.beat(a.entryPrice-1.1*R);assert.equal(f.lot().part.beDone,true);
    await f.beat(a.entryPrice*(1-0.0005));await f.beat();
    assert.equal(f.lot(),null);assert.equal(await pos(ex),0);
    const mine=f.state.orders.filter(o=>o.mode===(live?'LIVE':'TEST')).map(o=>({m:o.m,p:o.p,side:o.params.side||null,type:o.params.type||null,
      quantity:o.params.quantity||null,triggerPrice:o.params.triggerPrice||null,reduceOnly:o.params.reduceOnly||null,leverage:o.params.leverage||null}));
    return {orders:mine,exit:f.kinds('TOP3_CLOSED').at(-1).p.exitReason,a};
  };
  const T=await runMode(false),L=await runMode(true);
  assert.ok(T.orders.length>=8,'entry, leverage, stop, target, partial, new stop, new target, cancels: '+T.orders.length);
  assert.deepEqual(L.orders,T.orders,'LIVE sends exactly what TEST sends');
  assert.equal(L.exit,T.exit);assert.equal(L.a.entryPrice,T.a.entryPrice);assert.equal(L.a.part.price,T.a.part.price);
  assert.ok(T.orders.some(o=>o.p==='/fapi/v1/algoOrder'&&o.m==='POST'&&o.type==='TAKE_PROFIT_MARKET'&&Number(o.quantity)===T.a.part.qty),'the partial is a reduce-only take-profit order on the exchange');
});

// ===== R2544.73 (user 22.10: "1R'ı erken mi alıyor? ... sen ne öneriyorsan onu yapalım, testten sonra canlıda aynı şekilde
// çalışacak"): 1 month, today's entry rules, n74: half at 1R +0.27R/trade, half at 2R +0.41R, none +0.44R (drawdown -7.4R vs
// -5.4R at 2R). Default -> 2R / 50 %; level and share settable from Office per lane (TEST any time, LIVE needs 'LIVE').
const Z5L=require('../zirve5'),T3L=require('../top3-hunter');
test('R2544.73 default kâr koruma is 2R / 50 % on both lanes; a lot opened with the default carries it (or skips it when the target is nearer)',async()=>{
  assert.equal(Z5L.DEFAULT_CONFIG.partAtR,2);assert.equal(Z5L.DEFAULT_CONFIG.partShare,0.5);
  assert.equal(T3L.DEFAULT_CONFIG.partial.atR,2);assert.equal(T3L.DEFAULT_CONFIG.partial.share,0.5);
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,partAtR:null}});await f.controller.testSupervisorTick();
  assert.equal(f.controller.z5Status().partial.atR,2,'status shows the default level');
  assert.equal((await f.controller.z5Tick()).entries,1);
  const a=f.lot(),R=Math.abs(a.stopPrice-a.entryPrice),tR=Math.abs(a.tpPrice-a.entryPrice)/R;
  assert.ok(tR>2.05,'the target of this scenario (~2.17R) is beyond 2R: '+tR);
  assert.equal(a.part.atR,2);assert.ok(a.part.onExchange===true);assert.ok(Math.abs(a.part.price-(a.entryPrice-2*R))<=0.011,'at entry - 2R: '+a.part.price);
});
test('R2544.73 Office setting: level and share per lane (TEST), validated, null = default; the next lot uses it; LIVE needs LIVE',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,partAtR:null}});await f.controller.testSupervisorTick();
  const s=f.controller.configureZ5({partAtR:1.5,partShare:0.33});assert.equal(s.ok,true,JSON.stringify(s));assert.equal(s.partial.atR,1.5);assert.equal(s.partial.share,0.33);
  assert.deepEqual(f.controller.configureZ5({partAtR:7}).reasons,['ZIRVE5_PARTIAL_LEVEL_INVALID']);
  assert.deepEqual(f.controller.configureZ5({partShare:0.95}).reasons,['ZIRVE5_PARTIAL_SHARE_INVALID']);
  assert.equal((await f.controller.z5Tick()).entries,1);
  const a=f.lot();assert.equal(a.part.atR,1.5);assert.equal(a.part.share,0.33);
  assert.equal(f.controller.configureZ5({partAtR:null,partShare:null}).partial.atR,2,'empty = default 2R');
  const t=f.controller.configureTop3({partAtR:3,partShare:0.4});assert.equal(t.partial.atR,3);assert.equal(t.partial.share,0.4);
  assert.deepEqual(f.controller.configureTop3({partShare:0.95}).reasons,['TOP3_PARTIAL_SHARE_INVALID']);
  assert.deepEqual(f.controller.configureTop3({partAtR:0.2}).reasons,['TOP3_PARTIAL_LEVEL_INVALID']);
  assert.equal(f.controller.configureTop3({partAtR:null,partShare:null}).partial.atR,2);
  // LIVE: a level change needs the explicit LIVE confirmation on both lanes
  writeTradingMode(f.root,{mode:'LIVE',changedAt:'2026-10-22T08:00:00.000Z',testStartedAt:null,testAutoRun:false});f.controller._testPaper().invalidateMode();
  assert.deepEqual(f.controller.configureZ5({partAtR:1.5}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.deepEqual(f.controller.configureTop3({partAtR:1.5}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(f.controller.configureZ5({partAtR:1.5,confirm:'LIVE'}).partial.atR,1.5);
  assert.equal(f.controller.configureTop3({partAtR:2.5,confirm:'LIVE'}).partial.atR,2.5);
});
test('R2544.73 wiring: core routes and Office pass level/share; Office has the boxes; lot lines show each lot\'s own level',()=>{
  const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  const {CONTROL_BODY}=require('../office-dashboard/office-server');
  assert.deepEqual(CONTROL_BODY['/api/control/zirve5']({partAtR:2,partShare:0.5}),{source:'OFFICE',partAtR:2,partShare:0.5});
  assert.equal(CONTROL_BODY['/api/control/top3']({partAtR:null}).partAtR,null);
  assert.match(src('server.js'),/\.\.\.own\('partAtR'\),\.\.\.own\('partShare'\)/);assert.match(src('server.js'),/\{partAtR:body\.partAtR\}/);
  const html=src('office-dashboard/public/office.html');
  for(const id of ['z5PartR','z5PartPct','btnZ5PartSave','t3PartR','t3PartPct','btnT3PartSave'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(!html.includes('1R’de yarısı: AÇIK'),'button labels come from the status, not a fixed 1R');
  assert.match(html,/a\.part\.atR\?\?1/);
});
test('R2544.73 TEST = LIVE at the new default 2R: the same orders reach the paper exchange (TEST) and Binance (LIVE); half at 2R, rest to break-even',async()=>{
  const runMode=async live=>{
    require('../binance-rate-limit').resetForTests();
    const f=fixture({z5:{enabled:true,partAtR:null}});await f.controller.testSupervisorTick();
    if(live){const r=await f.controller.runControl({action:'GO_LIVE'});assert.equal(r.ok,true,JSON.stringify(r));}
    const ex=live?f.binance:f.paper;
    assert.equal((await f.controller.z5Tick()).entries,1);
    const a=f.lot(),R=a.stopPrice-a.entryPrice;assert.equal(a.part.atR,2);
    await f.beat(a.entryPrice-1.5*R);assert.equal(f.lot().part.done===true,false,'1.5R: nothing taken yet (the old 1R would have)');
    await f.beat(a.entryPrice-2.05*R);assert.equal(f.lot().part.beDone,true,'2R: half taken, rest at break-even');
    await f.beat(a.entryPrice*(1-0.0005));await f.beat();
    assert.equal(f.lot(),null);assert.equal(await pos(ex),0);
    return {orders:f.state.orders.filter(o=>o.mode===(live?'LIVE':'TEST')).map(o=>({m:o.m,p:o.p,side:o.params.side||null,type:o.params.type||null,quantity:o.params.quantity||null,triggerPrice:o.params.triggerPrice||null})),
      exit:f.kinds('TOP3_CLOSED').at(-1).p.exitReason,part:a.part.price};
  };
  const T=await runMode(false),L=await runMode(true);
  assert.deepEqual(L.orders,T.orders,'LIVE sends exactly what TEST sends');assert.equal(L.exit,T.exit);assert.equal(L.part,T.part);
});
