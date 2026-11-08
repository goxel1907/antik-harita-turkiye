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
function fixture({side='SHORT',z5={enabled:true},top3={},deskJudges=null,extra={}}={}){
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
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',deskJudges,...extra,
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
  // R2544.116 (kullanıcı 03.11: "gördüğü her fırsata girecek o kadar ve öğrenecek"): by default the entry never waits for the committee
  require('../binance-rate-limit').resetForTests();
  let f0=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm(SKIP)}});await f0.controller.testSupervisorTick();
  assert.equal((await f0.controller.z5Tick()).entries,1,'every signal opens; the committee votes after the entry and the desk manages');assert.equal(f0.kinds('ZIRVE5_COMMITTEE_SKIP').length,0);
  // committeeEntryVeto:true brings the gate back (a SKIP whose own odds are under break-even blocks)
  require('../binance-rate-limit').resetForTests();
  let f=fixture({z5:{enabled:true,committeeMode:true,committeeEntryVeto:true},deskJudges:{committee:cm(SKIP)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,0,'committee said SKIP');assert.equal(f.lot(),null);
  const sk=f.kinds('ZIRVE5_COMMITTEE_SKIP');assert.equal(sk.length,1);assert.equal(sk[0].p.decision,'SKIP');assert.equal(sk[0].p.authority,true);
  assert.equal(f.state.orders.length,0,'not a single order');
  require('../binance-rate-limit').resetForTests();
  const c=cm(TAKE);f=fixture({z5:{enabled:true,committeeMode:true,committeeEntryVeto:true},deskJudges:{committee:c}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=f.lot();
  assert.equal(a.entryFeatures.committee.decision,'TAKE');assert.equal(a.entryFeatures.committee.authority,true);
  assert.deepEqual(c.calls[0].roles.map(r=>r.key),['price action','boğa','ayı','1g/4sa','5dk+akış']);assert.equal(c.calls[0].fallback,'SKIP');
  const pk=JSON.parse(c.calls[0].prompt);assert.equal(pk.plan.entry,100);assert.ok(pk.plan.stop>100,'SHORT stop above the entry on the screen');
  require('../binance-rate-limit').resetForTests();
  f=fixture({z5:{enabled:true,committeeMode:true,committeeEntryVeto:true},deskJudges:{committee:cm({ok:false,reason:'COMMITTEE_NO_HEALTHY_MEMBER',votes:[]})}});await f.controller.testSupervisorTick();
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
  assert.match(lc,/order=both\?\['JEV','COMMITTEE'\]:\['COMMITTEE'\];/,'with authority only the committee decides (R2544.127: JEV + KURUL -> JEV first, then the committee)');
  assert.match(lc,/cfg:\{\.\.\.cfg,testJudges:order,liveJudges:order\}/,'the same order in TEST and LIVE');
  assert.match(lc,/if\(rec\.action!=='HOLD'&&!rec\.downgraded&&\(rec\.judge==='COMMITTEE'\|\|\(both&&rec\.judge==='JEV'\)\)&&!rec\.guard\)a\.deskOrder=/,'R2544.127: JEV orders run only in JEV + KURUL');
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');assert.equal((sv.match(/committeeMode:body\?\.committeeMode/g)||[]).length,2);
  const os2=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');assert.equal((os2.match(/'committeeMode'\]\) if \(typeof b\[k\] === 'boolean'\)/g)||[]).length,2);
  const of=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['btnTop3Cm','btnZ5Cm','btnCmLive'])assert.ok(of.includes('id="'+id+'"'),id);
  assert.match(of,/const g=document\.getElementById\('btnGoLive'\);if\(g&&!g\.disabled\)\{g\.click\(\)/,'one click = committee ON + the normal LIVE confirmation (the user presses it)');
  const ms=require('../mobile-status');assert.ok(fs.readFileSync(path.join(__dirname,'..','mobile-status.js'),'utf8').includes('out.committee={team:'));
});

// ---------------------------------------------------------------- R2544.98 (kullanıcı 28.10: "bunların çalıştığına emin olalım test yapalım")
const v98=(m,d)=>({member:m,ok:true,seat:null,vote:{decision:d,pTarget:20,reasonTr:m+' '+d}}); // R2544.116: own odds under break-even
test('R2544.98 entry: one model saying SKIP does NOT block (the rule decides); an agreed SKIP of 2+ models blocks; both land in the phone list',async()=>{
  require('../binance-rate-limit').resetForTests();
  let f=fixture({z5:{enabled:true,committeeMode:true,committeeEntryVeto:true},deskJudges:{committee:cm({ok:true,final:'SKIP',consensus:'SINGLE_VOTER_DEFAULT',rounds:1,voters:1,votes:[v98('OR:x','SKIP')],round2:null})}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1,'a lone model has no veto');
  const rec=f.lot().entryFeatures.committee;assert.equal(rec.decision,'RULE');assert.equal(rec.committeeDecision,'SKIP');assert.equal(rec.agreed,false);
  let ring=f.controller._testTop3State().cmRecent;assert.equal(ring[0].blocked,false);assert.equal(ring[0].c,'SINGLE_VOTER_DEFAULT');
  require('../binance-rate-limit').resetForTests();
  f=fixture({z5:{enabled:true,committeeMode:true,committeeEntryVeto:true},deskJudges:{committee:cm({ok:true,final:'SKIP',consensus:'MAJORITY_AFTER_DEBATE',rounds:2,voters:3,votes:[],round2:[v98('ROUTER:groq/a','SKIP'),v98('OR:b','SKIP'),v98('ROUTER:nvidia/c','TAKE')]})}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,0,'2 of 3 agreed: SKIP');assert.equal(f.state.orders.length,0);
  ring=f.controller._testTop3State().cmRecent;assert.equal(ring[0].blocked,true);assert.deepEqual(ring[0].v.map(x=>x.d),['SKIP','SKIP','TAKE']);
  require('../binance-rate-limit').resetForTests();
  f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm({ok:true,final:'SKIP',consensus:'NO_MAJORITY_DEFAULT',rounds:2,voters:4,votes:[],round2:[v98('a','SKIP'),v98('b','SKIP'),v98('c','TAKE'),v98('d','TAKE')]})}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1,'no agreement (2-2): the rule decides');
});
test('R2544.98 desk with authority, real tick: 3 of 5 want less risk after the debate -> the mildest (TIGHTEN_STOP to break-even) runs on the exchange',async()=>{
  require('../binance-rate-limit').resetForTests();
  const vote=(m,action,stopChoice='KEEP')=>({member:m,ok:true,seat:null,vote:{ok:true,action,stopChoice,reason:'MOMENTUM_FADING',confidence:60,reasonTr:m,watchTr:''}});
  const desk={ok:true,final:'HOLD',consensus:'NO_MAJORITY_DEFAULT',rounds:2,voters:5,votes:[],round2:[vote('a','HOLD'),vote('b','HOLD'),vote('c','TIGHTEN_STOP','BREAKEVEN'),vote('d','EXIT'),vote('e','TAKE_PARTIAL')]};
  const c=cm(o=>o.field==='action'?desk:TAKE);
  const f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:c}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=JSON.parse(JSON.stringify(f.lot())),R=a.stopPrice-a.entryPrice;
  await f.beat(a.entryPrice-0.8*R);f.state.now+=31*60000;                // in profit (SHORT), first desk look after 30 min (R2544.117)
  let r=null;for(let i=0;i<100&&!r;i++){r=await f.controller._testDeskTick();if(!r)await new Promise(z=>setTimeout(z,10));} // the scan's own desk look may still be running (deskBusy)
  assert.ok(r&&r.ok,JSON.stringify(r));assert.equal(r.action,'TIGHTEN_STOP');
  // R2544.117 noise guard: +0.8R and never +1R -> the desk's order is recorded, not executed
  assert.equal(f.lot().desk.last.guard.code,'NOISE_GUARD');assert.ok(!f.lot().deskOrder,'not executed');
  f.controller._testDeskGuard({protectR:-99});f.state.now+=31*60000;r=null;  // guard opened (the fixture's 5m path gives no mfe): the order runs
  for(let i=0;i<100&&!r;i++){r=await f.controller._testDeskTick();if(!r)await new Promise(z=>setTimeout(z,10));}
  assert.ok(r&&r.ok,JSON.stringify(r));assert.equal(r.action,'TIGHTEN_STOP');f.controller._testDeskGuard({protectR:1});
  const call=c.calls.find(x=>x.field==='action');assert.doesNotMatch(call.system,/measured default/);const pk=JSON.parse(call.prompt);
  assert.equal(pk.tradeTimeframe.trigger,'15m');assert.ok(pk.position.givebackR!==undefined&&pk.noiseR);
  const rec=f.lot().desk.last;assert.equal(rec.shadow,false);assert.equal(rec.authority,true);assert.equal(rec.committee.consensus,'REDUCE_MAJORITY');
  // R2544.130: the order ran right after the decision (no queue until the next tick)
  assert.ok(!f.lot().deskOrder,'not queued: already done');assert.equal(rec.done?.ok,true,'done right away: '+JSON.stringify(rec.done));assert.equal(f.kinds('POSITION_DESK_STOP').length,1);
  await f.beat();const b=f.lot();assert.ok(b.stopPrice<a.stopPrice&&b.stopPrice<=a.entryPrice*1.0012+0.011,'stop moved to break-even on the exchange: '+b.stopPrice);
  const st=f.paper.state.algos.filter(x=>x.algoStatus==='NEW').find(x=>String(x.algoId)===String(b.stopAlgoId));assert.ok(st&&Math.abs(Number(st.triggerPrice)-b.stopPrice)<1e-9);
});
test('R2544.98 "Kurulla CANLI" switches: both strategies to the committee AND selected for LIVE in one go (TEST); the lanes say who decides; LIVE itself stays a separate press',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true},top3:{enabled:true}});
  assert.equal(f.controller.laneStatus().top3.liveAllowed,false);assert.equal(f.controller.laneStatus().zirve5.liveAllowed,false);
  const a=f.controller.configureTop3({committeeMode:true,liveEnabled:true,confirm:'LIVE'}),b=f.controller.configureZ5({committeeMode:true,liveEnabled:true,confirm:'LIVE'});
  assert.equal(a.ok,true,JSON.stringify(a));assert.equal(b.ok,true,JSON.stringify(b));
  const L=f.controller.laneStatus();
  assert.equal(L.top3.liveAllowed,true,'İlk 3 selected for LIVE');assert.equal(L.zirve5.liveAllowed,true,'ZİRVE-5 selected for LIVE');
  assert.equal(L.top3.decisions,'RULE_PLUS_COMMITTEE');assert.equal(L.zirve5.decisions,'RULE_PLUS_COMMITTEE');
  assert.equal(f.controller.tradingModeStatus().mode,'TEST','nothing went LIVE by itself');
  assert.equal(f.controller.configureZ5({liveEnabled:true}).ok,false,'without the LIVE confirmation ZİRVE-5 is not selected');
});

test('R2544.123 the desk decision says what happened to its order: a refused stop -> done.ok=false with the reason; a moved stop -> done.ok=true; the view shows a pending order',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm(TAKE)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=JSON.parse(JSON.stringify(f.lot())),R=a.stopPrice-a.entryPrice;
  await f.beat(a.entryPrice-0.6*R);
  const lot=f.lot();lot.desk=lot.desk||{decisions:[]};lot.desk.decisions=lot.desk.decisions||[];
  const bad={at:f.state.now,action:'TIGHTEN_STOP',authority:true};lot.desk.decisions.push(bad);lot.desk.last=bad;
  lot.deskOrder={action:'TIGHTEN_STOP',stopPrice:a.stopPrice+0.5,at:bad.at};
  const v=f.controller.z5Status().active.find(x=>x.id===lot.id).deskInfo;assert.equal(v.pending.action,'TIGHTEN_STOP','Office sees the order on its way');
  await f.beat();
  const b1=f.lot().desk.decisions.find(d=>d.at===bad.at);assert.equal(b1.done.ok,false);assert.equal(b1.done.kind,'STOP_SKIPPED');assert.equal(b1.done.reason,'NOT_TIGHTER_OR_THROUGH_PRICE');
  f.state.now+=60000;const be=Number((a.entryPrice*0.999).toFixed(2)),good={at:f.state.now,action:'TIGHTEN_STOP',authority:true};
  f.lot().desk.decisions.push(good);f.lot().deskOrder={action:'TIGHTEN_STOP',stopPrice:be,at:good.at};await f.beat();
  const g=f.lot().desk.decisions.find(d=>d.at===good.at);assert.equal(g.done.ok,true);assert.equal(g.done.kind,'STOP');assert.ok(g.done.price>0);
  assert.equal(f.controller.z5Status().active.find(x=>x.id===lot.id).deskInfo.pending,null,'nothing pending after it ran');
});

test('R2544.124 P&L panel: the controller reads the account ledger through the SAME call in TEST (paper) as in LIVE (Binance); a closed trade shows up, a virtual top-up does not',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true,committeeMode:true},deskJudges:{committee:cm(TAKE)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=f.lot(),R=a.stopPrice-a.entryPrice;
  await f.beat(a.entryPrice-0.3*R);f.lot().deskOrder={action:'EXIT',at:f.state.now,by:'COMMITTEE'};await f.beat();assert.equal(f.lot(),null);
  await f.paper.deposit(100,'TOPUP_TEST');
  assert.equal(f.controller.top3Status().pnl.readAt,null,'a status read does not fetch by itself');await f.controller.pnlRefresh();
  const p=f.controller.top3Status().pnl;assert.ok(p&&p.totals,'ledger read');assert.equal(p.mode,'TEST');assert.equal(p.error,null);
  const inc=f.paper.state.income,net=inc.filter(x=>x.incomeType!=='TRANSFER').reduce((s,x)=>s+Number(x.income),0);
  assert.equal(p.totals.all.net,Number(net.toFixed(2)),'panel = paper ledger (realized + commission)');assert.ok(p.totals.all.fees<0,'commission counted');
  assert.equal(p.cash.total,100,'the top-up is listed apart');assert.equal(p.cash.n,1);
  const src=require('fs').readFileSync(require('path').join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(src,/transport\._fetchJson\('GET','\/fapi\/v1\/income',\{params:\{startTime:Math\.floor\(start\),endTime:Math\.floor\(clock\(\)\),limit:1000\},credentials:creds,signed:true\}\)/,'one call, both modes');
});

test('R2544.127 JEV + KURUL + bot: both switches in one press; the bot opens even when JEV says no (JEV votes); JEV alone still gates',async()=>{
  require('../binance-rate-limit').resetForTests();
  const NO=async()=>({ok:true,called:true,decision:'REJECT_ENTRY',reason:'jev says no'});
  let f=fixture({z5:{enabled:true},deskJudges:{committee:cm(TAKE)},extra:{zirve5Judge:NO}});await f.controller.testSupervisorTick();
  assert.equal(f.controller.configureZ5({committeeMode:true,jevMode:true}).ok,true);
  let sw=f.controller.z5Status().switches;assert.equal(sw.committeeMode,true);assert.equal(sw.jevMode,true,'both on together = JEV + KURUL');assert.equal(f.controller.z5Status().decisions,'RULE_PLUS_JEV_COMMITTEE');
  assert.equal((await f.controller.z5Tick()).entries,1,'the bot opens; JEV only votes');assert.equal(f.lot().entryFeatures.jevVote.decision,'REJECT_ENTRY');
  assert.equal(f.controller.runStatus().lanes?.zirve5?.decisions??'RULE_PLUS_JEV_COMMITTEE','RULE_PLUS_JEV_COMMITTEE');
  require('../binance-rate-limit').resetForTests();
  f=fixture({z5:{enabled:true},deskJudges:{committee:cm(TAKE)},extra:{zirve5Judge:NO}});await f.controller.testSupervisorTick();
  f.controller.configureZ5({jevMode:true});sw=f.controller.z5Status().switches;assert.equal(sw.committeeMode,false,'one alone stays exclusive');
  assert.equal((await f.controller.z5Tick()).entries,0,'JEV alone still gates the entry (unchanged)');
});

test('R2544.127 JEV + KURUL desk: JEV decides first and its reducing order runs; when JEV cannot answer the committee decides',async()=>{
  require('../binance-rate-limit').resetForTests();
  const vote=(m,action)=>({member:m,ok:true,seat:null,vote:{ok:true,action,stopChoice:'KEEP',reason:'MOMENTUM_FADING',confidence:60,reasonTr:m,watchTr:''}});
  const deskHold={ok:true,final:'HOLD',consensus:'UNANIMOUS',rounds:1,voters:2,votes:[vote('a','HOLD'),vote('b','HOLD')]};
  const c=cm(o=>o.field==='action'?deskHold:TAKE);let jevUp=true;const jevCalls=[];
  const jev=async({packet})=>{jevCalls.push(packet);return jevUp?{ok:true,action:'EXIT',stopChoice:'KEEP',reason:'MOMENTUM_FADING',reasonTr:'JEV: çık',model:'jev'}:{ok:false,reason:'OPENROUTER_402'};};
  const f=fixture({z5:{enabled:true,committeeMode:true,jevMode:true},deskJudges:{committee:c,jev},extra:{zirve5Judge:async()=>({ok:true,called:true,decision:'APPROVE_ENTRY'})}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=JSON.parse(JSON.stringify(f.lot())),R=a.stopPrice-a.entryPrice;
  f.controller._testDeskGuard({protectR:-99});
  await f.beat(a.entryPrice-0.5*R);f.state.now+=31*60000;
  jevUp=false;let r=null;for(let i=0;i<100&&!r;i++){r=await f.controller._testDeskTick();if(!r)await new Promise(z=>setTimeout(z,10));}
  assert.ok(r&&r.ok,JSON.stringify(r));assert.equal(r.judge,'COMMITTEE','JEV down -> the committee decides');assert.equal(f.lot().desk.last.authority,true);
  jevUp=true;f.state.now+=31*60000;r=null;for(let i=0;i<100&&!r;i++){r=await f.controller._testDeskTick();if(!r)await new Promise(z=>setTimeout(z,10));}
  assert.ok(r&&r.ok,JSON.stringify(r));assert.equal(r.judge,'JEV');assert.equal(r.action,'EXIT');assert.ok(jevCalls.length>=2);
  await f.beat();assert.equal(f.lot(),null,'JEV\'s EXIT ran (JEV + KURUL: authorised)');assert.equal(f.kinds('POSITION_DESK_EXIT').length,1);
  f.controller._testDeskGuard({protectR:1});
});

test('R2544.128 the open lot keeps a real R path (one point a minute from the mark, R from the entry stop); ZİRVE-5 status carries it',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({z5:{enabled:true},deskJudges:{committee:cm(TAKE)}});await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1);const a=JSON.parse(JSON.stringify(f.lot())),R=a.stopPrice-a.entryPrice;
  for(const k of [0.2,0.5,0.3]){f.state.now+=61000;await f.beat(a.entryPrice-k*R);}
  const lp=f.lot().livePath;assert.ok(Array.isArray(lp)&&lp.length>=3,JSON.stringify(lp));
  assert.ok(lp.every((p,i)=>i===0||p[0]-lp[i-1][0]>=60000),'one point a minute at most');
  assert.ok(Math.abs(lp.at(-1)[1]-0.3)<0.05,'R from the entry stop: '+lp.at(-1)[1]);assert.ok(Math.max(...lp.map(p=>p[1]))>=0.45);
  assert.deepEqual(f.controller.z5Status().active[0].livePath,lp,'Office gets it for ZİRVE-5 lots too');
});

test('R2544.130 LIVE sizing on (simulated) Binance: 100 $ balance, lane margin 30 $ -> the position locks exactly 30 $ margin, leverage >= the lane setting (10x); a margin above 95 % of the free balance is refused',async()=>{
  require('../binance-rate-limit').resetForTests();
  const live=async z5=>{const f=fixture({z5:{enabled:true,committeeMode:true,...z5},deskJudges:{committee:cm(TAKE)}});await f.controller.testSupervisorTick();
    const g=await f.controller.runControl({action:'GO_LIVE'});assert.equal(g.ok,true,JSON.stringify(g));
    for(let i=0;i<40&&!(f.controller.status().tradingMode?.mode==='LIVE'&&f.controller.status().armed);i++){f.state.now+=2000;await f.controller.testSupervisorTick();}
    assert.equal(f.controller.status().tradingMode.mode,'LIVE');assert.equal(f.controller.status().armed,true,'armed against (simulated) Binance');return f;};
  const f=await live({marginQuote:30,leverage:10});
  assert.equal((await f.controller.z5Tick()).entries,1,'the bot opens in LIVE with the committee as owner');
  const lev=f.state.orders.filter(o=>o.mode==='LIVE'&&o.p==='/fapi/v1/leverage').at(-1),ord=f.state.orders.find(o=>o.mode==='LIVE'&&o.p==='/fapi/v1/order'&&o.params.type==='MARKET');
  assert.ok(lev&&Number(lev.params.leverage)>=10,'leverage sent to Binance >= 10x: '+JSON.stringify(lev));assert.ok(ord,'a market entry order went to Binance');
  const a=f.lot(),notional=Number(ord.params.quantity)*a.entryPrice,L=Number(lev.params.leverage);
  if(process.env.SHOW_LIVE_SIZE)console.log('CANLI_OLCU marj',a.marginQuote,'kaldirac',L,'pozisyon',notional.toFixed(2),'kilitlenen marj',(notional/L).toFixed(2),'stop%',(a.stopPct*100).toFixed(2),'stopta kayip',(notional*a.stopPct).toFixed(2));
  assert.equal(a.marginQuote,30,'the lane margin, not resized');assert.equal(a.leverage,L);
  assert.ok(Math.abs(notional/L-30)<=30*0.03+0.01*a.entryPrice/L,'locked margin = notional / leverage ≈ 30 $: '+(notional/L).toFixed(2)+' (lot step rounding)');
  const r=(await f.binance.handle('GET','/fapi/v3/positionRisk',{params:{symbol:'Z5USDT'}}))[0];assert.ok(Math.abs(Number(r.positionAmt))>0,'the position is on (simulated) Binance');
  require('../binance-rate-limit').resetForTests();
  const g=await live({marginQuote:99,leverage:10});
  assert.equal((await g.controller.z5Tick()).entries,0,'99 $ > 95 % of the 100 $ free balance: refused, never resized');
  assert.ok(!g.state.orders.some(o=>o.mode==='LIVE'&&o.p==='/fapi/v1/order'),'no order sent');
});
