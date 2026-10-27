'use strict';
// R2544.89 KURUL YETKİSİ (kullanıcı 27.10: "istediğim zaman tek tık ile canlıya geçebilmeliyim bu modeller ile; APK'da da"): karar sahibi
// KURUL seçilince girişte kurul vetosu, açık pozisyonda masa yetkili (yalnız azaltan emirler). Sanal borsada uçtan uca.
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
const FAKE={apiKey:'fake-test-key-r89',apiSecret:'fake-test-secret-r89'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({side='SHORT',z5={enabled:true},top3={},deskJudges=null}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r89-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  // R2544.73: the default level is 2R; these mechanics tests pin 1R (same code path at any level)
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false,partial:{atR:1},...top3}));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({requireSweep:false,partAtR:1,...z5}));   // R2544.70: sweep rule tested in r2544-70
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-21T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const bar=Date.UTC(2026,9,21,10,0),k=scenario(side,bar),c0=k.at(-1).close;
  const state={now:bar+M15+10000,px:{Z5USDT:{bid:c0,ask:c0+0.01}},k15:{Z5USDT:k},orders:[]};
  // simulated Binance for LIVE: its own exchange model (same Binance error codes), answering the signed HTTP requests
  const binRoot=fs.mkdtempSync(path.join(os.tmpdir(),'r89bin-'));
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
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',deskJudges,
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

// committee stub: decide() answers as configured; every call is recorded
const cm=(answer)=>{const calls=[];return {calls,decide:async o=>{calls.push(o);return typeof answer==='function'?answer(o):answer;}};};
const TAKE={ok:true,final:'TAKE',consensus:'UNANIMOUS',rounds:1,voters:5,votes:[{member:'ROUTER:gc/gemini-3.1-pro-preview',seat:'1g/4sa',ok:true,vote:{decision:'TAKE',pTarget:60,reasonTr:'4 sa aşağı'}}],round2:null};
const SKIP={...TAKE,final:'SKIP',votes:[{member:'ROUTER:kr/claude-sonnet-4.5',seat:'price action',ok:true,vote:{decision:'SKIP',pTarget:20,reasonTr:'karşı OB 0,9R'}}]};

test('R2544.89 entry gate: KURUL mode -> the committee must say TAKE (veto only); SKIP = no trade; no answer = the rule goes on',async()=>{
  require('../binance-rate-limit').resetForTests();
  let f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm(SKIP)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,0,'committee said SKIP');assert.equal(f.lot(),null);
  const sk=f.kinds('ZIRVE5_COMMITTEE_SKIP');assert.equal(sk.length,1);assert.equal(sk[0].p.decision,'SKIP');assert.equal(sk[0].p.authority,true);
  assert.equal(f.state.orders.length,0,'not a single order');
  require('../binance-rate-limit').resetForTests();
  const c=cm(TAKE);f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:c}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=f.lot();
  assert.equal(a.entryFeatures.committee.decision,'TAKE');assert.equal(a.entryFeatures.committee.authority,true);
  assert.deepEqual(c.calls[0].roles.map(r=>r.key),['price action','boğa','ayı','1g/4sa','5dk+akış']);assert.equal(c.calls[0].fallback,'SKIP');
  const pk=JSON.parse(c.calls[0].prompt);assert.equal(pk.plan.entry,100);assert.ok(pk.plan.stop>100,'SHORT stop above the entry on the screen');
  require('../binance-rate-limit').resetForTests();
  f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm({ok:false,reason:'COMMITTEE_NO_HEALTHY_MEMBER',votes:[]})}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1,'models down -> the rule decides (user: works with the free models off)');
  assert.equal(f.lot().entryFeatures.committee.fallback,'RULE');assert.equal(f.lot().entryFeatures.committee.error,'COMMITTEE_NO_HEALTHY_MEMBER');
  require('../binance-rate-limit').resetForTests();
  f=fixture({z5:{enabled:true},deskJudges:{committee:cm(SKIP)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1,'KURUL mode OFF: the committee never blocks (shadow only)');
});

test('R2544.89 desk authority: EXIT closes the lot at market and cancels its orders; it only runs while armed and once',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm(TAKE)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=f.lot(),R=a.stopPrice-a.entryPrice;
  await f.beat(a.entryPrice-0.3*R);assert.ok(f.lot());
  f.lot().deskOrder={action:'EXIT',at:f.state.now,by:'COMMITTEE'};
  await f.beat();
  assert.equal(f.lot(),null,'closed by the desk');assert.equal(await pos(f.paper),0);
  assert.equal(f.kinds('TOP3_CLOSED').at(-1).p.exitReason,'TOP3_DESK_EXIT');assert.equal(f.kinds('POSITION_DESK_EXIT').length,1);
  assert.equal(f.paper.state.algos.filter(x=>x.algoStatus==='NEW').length,0,'no order left behind');
});

test('R2544.89 desk authority: TIGHTEN_STOP moves the stop only TOWARD profit and never through the price; an expired order is dropped',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm(TAKE)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=JSON.parse(JSON.stringify(f.lot())),R=a.stopPrice-a.entryPrice;
  await f.beat(a.entryPrice-0.6*R);
  // wider (worse) stop for a SHORT = higher: refused
  f.lot().deskOrder={action:'TIGHTEN_STOP',stopPrice:a.stopPrice+0.5,at:f.state.now};await f.beat();
  assert.equal(f.lot().stopPrice,a.stopPrice);assert.equal(f.kinds('POSITION_DESK_STOP_SKIPPED').at(-1).p.reason,'NOT_TIGHTER_OR_THROUGH_PRICE');
  // through the price: refused
  f.lot().deskOrder={action:'TIGHTEN_STOP',stopPrice:a.entryPrice-0.7*R,at:f.state.now};await f.beat();
  assert.equal(f.lot().stopPrice,a.stopPrice);
  // break-even: accepted, the exchange stop order is replaced
  const be=Number((a.entryPrice*0.999).toFixed(2));f.lot().deskOrder={action:'TIGHTEN_STOP',stopPrice:be,at:f.state.now};await f.beat();
  const b=f.lot();assert.ok(b.stopPrice<=be+0.011&&b.stopPrice<a.stopPrice,'stop moved down to break-even: '+b.stopPrice);assert.equal(b.initialStopPrice,a.stopPrice,'risk still measured from the entry stop');
  const live=f.paper.state.algos.filter(x=>x.algoStatus==='NEW'),st=live.find(x=>String(x.algoId)===String(b.stopAlgoId));
  assert.ok(st,'the new stop is on the exchange');assert.ok(Math.abs(Number(st.triggerPrice)-b.stopPrice)<1e-9);assert.ok(!live.some(x=>String(x.algoId)===String(a.stopAlgoId)),'the old stop is cancelled');
  // an order older than 10 min is dropped
  f.lot().deskOrder={action:'EXIT',at:f.state.now-11*60000};await f.beat();
  assert.ok(f.lot(),'not executed');assert.equal(f.kinds('POSITION_DESK_ORDER_EXPIRED').length,1);
});

test('R2544.89 desk authority: TAKE_PARTIAL takes the planned kâr koruma NOW, then the rest goes to break-even by the existing logic',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm(TAKE)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=JSON.parse(JSON.stringify(f.lot())),R=a.stopPrice-a.entryPrice;
  assert.ok(a.part&&!a.part.done&&a.part.qty>0);
  await f.beat(a.entryPrice-0.5*R);
  f.lot().deskOrder={action:'TAKE_PARTIAL',at:f.state.now};await f.beat();await f.beat();
  const b=f.lot();assert.equal(b.part.done,true);assert.equal(b.part.byDesk,true);assert.equal(b.part.beDone,true,'the rest moved to break-even');
  assert.ok(Math.abs(Math.abs(await pos(f.paper))-(a.quantity-a.part.qty))<1e-9,'half closed');
  assert.ok(b.stopPrice<a.entryPrice,'SHORT stop now under the entry');
  assert.equal(f.paper.state.algos.filter(x=>x.algoStatus==='NEW').length,2,'stop + target for the rest; the planned partial order was cancelled');
});

test('R2544.89 switches: KURUL and JEV are exclusive; LIVE needs the explicit confirmation to switch KURUL on; Office, server, phone carry it',()=>{
  const T=require('../top3-hunter'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'cfg89-'));fs.mkdirSync(path.join(dir,'config'));
  assert.equal(T.readTop3Config(dir).committeeMode,false,'default OFF');T.writeTop3Switches(dir,{committeeMode:true});assert.equal(T.readTop3Config(dir).committeeMode,true);
  assert.equal(Z.readConfig(dir).committeeMode,false);Z.writeConfig(dir,{committeeMode:true});assert.equal(Z.readConfig(dir).committeeMode,true);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.equal((lc.match(/if\(p\.committeeMode===true\)p\.jevMode=false;else if\(p\.jevMode===true\)p\.committeeMode=false;/g)||[]).length,2);
  assert.match(lc,/if\(!testModeNow\(\)&&\(p\.earlyEnabled===true\|\|p\.topEnabled===true\|\|p\.committeeMode===true\|\|/);
  assert.match(lc,/if\(\(p\.liveEnabled===true\|\|\(live&&\(p\.committeeMode===true\|\|/);
  assert.match(lc,/cfg:\{\.\.\.cfg,testJudges:\['COMMITTEE'\],liveJudges:\['COMMITTEE'\]\}/,'with authority only the committee decides');
  assert.match(lc,/if\(rec\.action!=='HOLD'&&!rec\.downgraded&&rec\.judge==='COMMITTEE'\)a\.deskOrder=/);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');assert.equal((sv.match(/committeeMode:body\?\.committeeMode/g)||[]).length,2);
  const os2=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');assert.equal((os2.match(/'committeeMode'\]\) if \(typeof b\[k\] === 'boolean'\)/g)||[]).length,2);
  const of=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['btnTop3Cm','btnZ5Cm','btnCmLive'])assert.ok(of.includes('id="'+id+'"'),id);
  assert.match(of,/const g=document\.getElementById\('btnGoLive'\);if\(g&&!g\.disabled\)\{g\.click\(\)/,'one click = committee ON + the normal LIVE confirmation (the user presses it)');
  const ms=require('../mobile-status');assert.ok(fs.readFileSync(path.join(__dirname,'..','mobile-status.js'),'utf8').includes('out.committee={team:'));
});
