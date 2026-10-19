'use strict';
// R2544.56 İLK 3 AVCISI (user 12.10.2026): "24 saat çalışsın, şu an için JEV'siz; JEV'e geçiş düğmesi; ilk 3'e girip tepe
// yapan coinlerin düşüşünü de yakalasın; hem LIVE hem JEV modu basınca aktif olsun (Office)". Hourly LONG 6/6 and
// post-top SHORT, own stop/TP/24 h exit, own bookkeeping (EXCLUDED_TOP3_LANE), TEST without JEV, switches from Office.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const T3=require('../top3-hunter');
const {laneOf}=require('../office-performance');

const H=3600000;
const tmp=p=>fs.mkdtempSync(path.join(os.tmpdir(),p));
// Hourly candles [t,o,h,l,c,v]: an alternating ±1.5 % base (hourly volatility ~3 %) with volume 100, then a custom tail.
function candles(endOpen,n,tail=[]){
  const rows=[];const base=n-tail.length;
  for(let i=0;i<base;i++){const t=endOpen-(n-1-i)*H,c=i%2?1.015:0.985,o=i%2?0.985:1.015;rows.push([t,o,Math.max(o,c)*1.001,Math.min(o,c)*0.999,c,100]);}
  tail.forEach((x,j)=>{const t=endOpen-(tail.length-1-j)*H;rows.push([t,...x]);});
  return rows;
}

test('R56 hourly features follow the research definitions (closed candles only)',()=>{
  const T=1791367200000;
  assert.equal(T3.hourlyFeatures(candles(T,150)).ok,false,'needs 200 closed candles');
  const k=candles(T,721,[[1.0,1.42,0.99,1.40,5000]]);
  const f=T3.hourlyFeatures(k);
  assert.equal(f.ok,true);assert.equal(f.openTime,T);
  assert.ok(Math.abs(f.r1-(1.40/1.015-1))<1e-12,'r1 vs previous close');
  assert.ok(Math.abs(f.r24-(1.40/k[k.length-25][4]-1))<1e-12,'r24 vs close 24 bars back');
  assert.equal(f.vmed,100);assert.equal(f.vr1,50,'volume vs the 7-day median ending 24 bars earlier');
  assert.equal(f.breakout7d,true);assert.ok(f.vol30>0.0134);assert.equal(f.red,false);
  assert.ok(Math.abs(f.peak24-1.42)<1e-12);assert.equal(f.dropFromPeak,1-1.40/1.42);
});

test('R56 LONG 6/6 needs every condition; each failure is named',()=>{
  const T=1791367200000,f=T3.hourlyFeatures(candles(T,721,[[1.0,1.42,0.99,1.40,5000]]));
  const ctx={rank:3,top10In7d:1,btc24:0.005};
  const ok=T3.longSignal(f,ctx);
  assert.equal(ok.ok,true);assert.equal(ok.rule,'LONG_6OF6');assert.equal(ok.stopPct,0.08);assert.equal(ok.tpPct,0.30);assert.equal(ok.maxHoldMs,24*H);
  assert.deepEqual(T3.longSignal(f,{...ctx,rank:8}).reasons,['RANK_NOT_TOP']);
  assert.deepEqual(T3.longSignal(f,{...ctx,top10In7d:0}).reasons,['NOT_A_REPEAT_GAINER']);
  assert.deepEqual(T3.longSignal(f,{...ctx,btc24:0.02}).reasons,['BTC_TOO_STRONG']);
  assert.deepEqual(T3.longSignal(f,{rank:null,top10In7d:null,btc24:null}).reasons,['RANK_NOT_TOP','NOT_A_REPEAT_GAINER','BTC_TOO_STRONG'],'missing context fails closed');
  const weak=T3.hourlyFeatures(candles(T,721,[[1.0,1.42,0.99,1.40,2000]]));
  assert.deepEqual(T3.longSignal(weak,ctx).reasons,['VOLUME_SURGE_BELOW'],'20x volume is not 33.9x');
  const lv=T3.entryLevels(ok,2);assert.equal(lv.ok,true);assert.ok(Math.abs(lv.stopPrice-1.84)<1e-12);assert.ok(Math.abs(lv.tpPrice-2.6)<1e-12);
});

test('R56 SHORT after the top: recent top 3, >=15% below the 24 h peak, red high-volume hour, stop 2..8% above',()=>{
  const T=1791367200000;
  const tail=[[1.0,2.0,0.99,1.95,800],[1.95,1.96,1.80,1.82,600],[1.82,1.83,1.70,1.72,500],[1.72,1.72,1.66,1.66,400],[1.66,1.66,1.63,1.64,300],[1.64,1.655,1.62,1.65,300],[1.65,1.66,1.58,1.60,400]];
  const f=T3.hourlyFeatures(candles(T,721,tail));
  assert.equal(f.red,true);assert.ok(f.dropFromPeak>=0.15);assert.equal(f.high3,1.66);
  const s=T3.shortSignal(f,{inTop3Within:true});
  assert.equal(s.ok,true);assert.equal(s.rule,'SHORT_TOP_FADE');assert.ok(Math.abs(s.stopRef-1.66*1.01)<1e-12);
  assert.deepEqual(T3.shortSignal(f,{inTop3Within:false}).reasons,['NOT_IN_TOP3_RECENTLY']);
  const lv=T3.entryLevels(s,1.60);assert.equal(lv.ok,true);assert.ok(lv.stopPct>0.02&&lv.stopPct<0.08);assert.ok(Math.abs(lv.tpPrice-1.44)<1e-12);
  assert.equal(T3.entryLevels(s,1.66).reason,'TOP3_SHORT_STOP_OUT_OF_RANGE','stop closer than 2% (fees) is no trade');
  assert.equal(T3.entryLevels(s,1.50).reason,'TOP3_SHORT_STOP_OUT_OF_RANGE','stop beyond 8% (10x safety) is no trade');
  const green=T3.hourlyFeatures(candles(T,721,[...tail.slice(0,-1),[1.58,1.62,1.57,1.60,400]]));
  assert.deepEqual(T3.shortSignal(green,{inTop3Within:true}).reasons,['HOUR_NOT_RED']);
});

test('R56 rank book: windows, top-50 storage, pruning and persistence; ranks from 24 h tickers',()=>{
  const root=tmp('r56-rank-'),file=path.join(root,'data','top3-ranks.json');
  const rb=new T3.RankBook({file,keepHours:5});
  for(let i=0;i<7;i++)rb.record(i*H+123,{AUSDT:i+1,BUSDT:60});
  assert.equal(Object.keys(rb.hours).length,5,'oldest hours pruned');
  assert.equal(rb.hours[6*H].BUSDT,undefined,'only the top 50 kept');
  assert.equal(rb.countInTop('AUSDT',3,0,7*H),1,'hours 2..6 kept; only rank 3 (hour 2) is in the top 3');
  assert.deepEqual(rb.symbolsInTop(5,4*H,5*H),['AUSDT']);assert.deepEqual(rb.symbolsInTop(4,4*H,5*H),[]);
  assert.equal(rb.hoursCovered(7*H,3*H),3);
  rb.save();assert.equal(new T3.RankBook({file}).countInTop('AUSDT',10,0,7*H),5);
  const r=T3.ranksFromTickers([{symbol:'AUSDT',priceChangePercent:'5'},{symbol:'BUSDT',priceChangePercent:'12.5'},{symbol:'CUSDC',priceChangePercent:'99'},{symbol:'DUSDT',priceChangePercent:'40'}],new Set(['AUSDT','BUSDT','CUSDC']));
  assert.deepEqual(r,{BUSDT:1,AUSDT:2},'USDT only, tradable only, by 24 h change');
});

test('R56 config: defaults off; Office/API can change only the three switches',()=>{
  const root=tmp('r56-cfg-');
  const d=T3.readTop3Config(root);
  assert.equal(d.enabled,false);assert.equal(d.jevMode,false);assert.equal(d.liveEnabled,false);assert.equal(d.leverage,10);assert.equal(d.maxActive,2);
  fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({leverage:8,long:{stopPct:0.07}}));
  const w=T3.writeTop3Switches(root,{enabled:true,jevMode:'yes',leverage:50,long:{stopPct:0.5}});
  assert.equal(w.enabled,true);assert.equal(w.jevMode,false,'non-boolean ignored');assert.equal(w.leverage,8);assert.equal(w.long.stopPct,0.07,'numeric rules stay the user file values');
});

// ---------- controller: a full TEST (paper) run ----------
const FAKE={apiKey:'fake-test-key-r56',apiSecret:'fake-test-secret-r56'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
const HOUR0=1791370800000; // an hour boundary
function fixture({otoEnabled=false,mode='TEST',top3=null,judge=null}={}){
  const root=tmp('r56-run-');fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:otoEnabled,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  // R2544.58: these tests cover the hourly rules (rulesVersion 1); the 5m v2 rules have their own tests
  if(top3)fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({rulesVersion:1,...top3}));
  writeTradingMode(root,{mode,changedAt:'2026-10-12T10:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  const state={now:HOUR0-3600000+5000,calls:[],px:{},klines:{},k5:{},tick:{},streamed:[]},events=[];
  const others=Array.from({length:60},(_,i)=>'C'+String(i).padStart(2,'0')+'USDT');
  for(let i=0;i<others.length;i++)state.tick[others[i]]=10-i*0.3;
  state.tick.BTCUSDT=0.5;
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.0001'},{filterType:'LOT_SIZE',stepSize:'0.1',minQty:'0.1',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push(`${m} ${p}`);
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v3/account')return ok({availableBalance:'250',totalWalletBalance:'250',positions:[]});
    if(p==='/fapi/v3/positionRisk')return ok([]);
    if(p==='/fapi/v1/positionSide/dual')return ok({dualSidePosition:false});
    if(p==='/fapi/v1/income')return ok([]);
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:Object.keys(state.tick).map(sym)});
    if(p==='/fapi/v1/ticker/24hr'){if(state.tickerFail>0){state.tickerFail--;throw new Error('network down');}
      // live size: ~690 contracts x ~400 B = ~280 KB (above the 256 KB default response cap)
      return ok(Object.entries(state.tick).map(([symbol,v])=>({symbol,priceChangePercent:String(v),pad:'x'.repeat(4800)})));}
    if(p==='/fapi/v1/klines'&&u.searchParams.get('interval')==='5m')return ok((state.k5[u.searchParams.get('symbol')]||[]).map(r=>r.map(String)));
    if(p==='/fapi/v1/klines'){const s=u.searchParams.get('symbol'),hour=Math.floor(state.now/H)*H;const k=(state.klines[s]||(e=>candles(e,721)))(hour-H);return ok([...k,[hour,1,1,1,1,1]].map(r=>[r[0],String(r[1]),String(r[2]),String(r[3]),String(r[4]),String(r[5])]));}
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    throw new Error('UNEXPECTED '+m+' '+p);};
  const store={journal:(k,s,p)=>events.push({k,s,p}),recordLearning:(k,s,p)=>events.push({k:'LEARN:'+k,s,p})};
  const make=()=>require('../live-controller').createLiveController({root,clock:()=>state.now,store,
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:mode,top3Judge:judge,
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol:s=>{state.streamed.push(s);}}}}); // no real WebSocket in tests
  const controller=make();
  const paper=controller._testPaper();
  const ranks=controller._testTop3Ranks();
  // 168 hours of rank history so no bootstrap is needed: the C coins fill the top; SIG was 5th once (50 h ago).
  const seed=(extra={})=>{const T=HOUR0-H;for(let t=T-168*H;t<T;t+=H){const m={};others.slice(0,50).forEach((s,i)=>{m[s]=i+1;});for(const [s,r] of Object.entries(extra[t]||{}))m[s]=r;ranks.record(t,m);}};
  const kinds=k=>events.filter(e=>e.k===k);
  return {root,state,events,kinds,controller,paper,ranks,seed,others,restart:make};
}
const LONG_TAIL=[[1.0,1.42,0.99,1.40,5000]];
const startTest=async f=>{const r=await f.controller.testSupervisorTick();assert.equal(r.action,'TEST_ARMED',JSON.stringify(r));assert.equal(f.controller.status().armed,true);};
const atScan=f=>{f.state.now=HOUR0+60000;};

test('R56 disabled lane does nothing (no market calls); LIVE switch needs the explicit confirmation',async()=>{
  const f=fixture();
  const r=await f.controller.top3Tick();
  assert.equal(r.reason,'TOP3_DISABLED');
  assert.equal(f.state.calls.filter(c=>/ticker\/24hr|klines/.test(c)).length,0);
  assert.deepEqual(f.controller.configureTop3({liveEnabled:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.deepEqual(f.controller.configureTop3({leverage:50}).reasons,['TOP3_LEVERAGE_INVALID'],'R2544.57: leverage is a validated setting');
  assert.deepEqual(f.controller.configureTop3({}).reasons,['TOP3_SWITCH_MISSING']);
  const on=f.controller.configureTop3({liveEnabled:true,confirm:'LIVE'});
  assert.equal(on.ok,true);assert.equal(on.switches.liveEnabled,true);assert.equal(on.switches.enabled,false,'LIVE permission alone does not start the lane');
  assert.equal(f.kinds('TOP3_CONFIG_CHANGED').length,1);
});

test('R56 TEST without JEV: LONG 6/6 fires at the hourly close, enters on paper with exchange stop+TP, books the TP close in its own lane',async()=>{
  const f=fixture({top3:{enabled:true}});
  f.seed({[HOUR0-H-50*H]:{SIGUSDT:5}});
  f.state.tick.SIGUSDT=40;f.state.px.SIGUSDT={bid:1.40,ask:1.401};
  f.state.klines.SIGUSDT=e=>candles(e,721,LONG_TAIL);
  await startTest(f);
  const early=await f.controller.top3Tick();assert.equal(early.reason,'TOP3_WAIT_CANDLE_CLOSE');
  atScan(f);
  const r=await f.controller.top3Tick();
  assert.equal(r.scanned,true);assert.equal(r.signals,1);assert.equal(r.entries,1);
  assert.equal(f.kinds('TOP3_SIGNAL')[0].s,'SIGUSDT');
  const st=f.controller.top3Status();
  assert.equal(st.running,true);assert.equal(st.gate,'OPEN');assert.equal(st.active.length,1);
  const a=st.active[0];
  assert.equal(a.side,'LONG');assert.equal(a.rule,'LONG_6OF6');assert.equal(a.mode,'TEST');assert.equal(a.leverage,10);
  assert.equal(a.marginQuote,25,'panel margin 32 capped at 25% of the 100 USDT paper balance');
  assert.equal(a.entryPrice,1.401);assert.ok(Math.abs(a.stopPrice-1.2889)<1e-9);assert.ok(Math.abs(a.tpPrice-1.8213)<1e-9);assert.equal(a.tpOnExchange,true);
  assert.equal(f.paper.summary().openAlgos,2,'STOP_MARKET + TAKE_PROFIT_MARKET on the (paper) exchange');
  assert.deepEqual(f.state.streamed,['SIGUSDT'],'the lot gets a live price stream');
  assert.equal(f.kinds('TOP3_ENTRY').length,1);assert.equal(f.kinds('TOP3_ENTRY')[0].p.tradingMode,'TEST');
  assert.equal((await f.controller.top3Tick()).reason,'TOP3_HOUR_DONE','one scan per hour');
  // price reaches the target: the paper exchange fires the TP; the manager books it and cancels the stop
  f.state.px.SIGUSDT={bid:1.83,ask:1.831};f.state.now+=1000;await f.paper.tick();
  f.state.now+=30000;await f.controller.top3Tick();
  assert.equal(f.controller.top3Status().active.length,0);
  assert.equal(f.paper.summary().openAlgos,0,'leftover stop cancelled');
  const closed=f.kinds('POSITION_CLOSED');assert.equal(closed.length,1);
  const p=closed[0].p;
  assert.equal(p.tradeLane,'TOP3_HUNTER');assert.equal(p.learningAuthority,'EXCLUDED_TOP3_LANE');assert.equal(p.exitType,'TOP3_TAKE_PROFIT');
  assert.equal(p.eventId.startsWith('TOP3:'),true);assert.equal(p.tradingMode,'TEST');assert.ok(p.netPnl>40,'+30% x 10x on 25 USDT minus fees');
  assert.equal(laneOf(p),'TOP3_HUNTER');
  const s2=f.controller.top3Status();assert.equal(s2.results.test.closed,0,'status reads the journal store (fake store has none)');
});

test('R56 time exit after 24 h closes at market; a disabled lane still manages its open lot',async()=>{
  const f=fixture({top3:{enabled:true}});
  f.seed({[HOUR0-H-50*H]:{SIGUSDT:5}});f.state.tick.SIGUSDT=40;f.state.px.SIGUSDT={bid:1.40,ask:1.401};f.state.klines.SIGUSDT=e=>candles(e,721,LONG_TAIL);
  await startTest(f);atScan(f);await f.controller.top3Tick();
  assert.equal(f.controller.top3Status().active.length,1);
  f.controller.configureTop3({enabled:false});
  const a=Object.values(f.controller._testTop3State().active)[0];a.deadline=f.state.now-1;
  f.state.px.SIGUSDT={bid:1.45,ask:1.451};f.state.now+=30000;
  const r=await f.controller.top3Tick();
  assert.equal(r.reason,'TOP3_DISABLED');
  assert.equal(f.controller.top3Status().active.length,0);assert.equal(f.paper.summary().openPositions,0);
  f.state.now+=30000;await f.controller.top3Tick();
  const p=f.kinds('POSITION_CLOSED')[0].p;assert.equal(p.exitType,'TOP3_TIME_EXIT');assert.ok(p.netPnl>0);
});

test('R56 JEV mode: no judge -> lane waits; REJECT -> no trade; APPROVE -> trade carries the JEV decision',async()=>{
  const f0=fixture({top3:{enabled:true,jevMode:true}});await startTest(f0);
  assert.equal(f0.controller.top3Status().gate,'TOP3_JEV_UNAVAILABLE');
  for(const decision of ['REJECT_ENTRY','APPROVE_ENTRY']){
    const seen=[];
    const f=fixture({top3:{enabled:true,jevMode:true},judge:async x=>{seen.push(x);return {ok:true,called:true,decision,reason:decision==='APPROVE_ENTRY'?'EARLY_CONTINUATION':'LATE_OR_CROWDED'};}});
    f.seed({[HOUR0-H-50*H]:{SIGUSDT:5}});f.state.tick.SIGUSDT=40;f.state.px.SIGUSDT={bid:1.40,ask:1.401};f.state.klines.SIGUSDT=e=>candles(e,721,LONG_TAIL);
    await startTest(f);atScan(f);
    const r=await f.controller.top3Tick();
    assert.equal(seen.length,1);assert.equal(seen[0].symbol,'SIGUSDT');assert.equal(seen[0].signal.rule,'LONG_6OF6');
    assert.equal(f.kinds('TOP3_JEV_REVIEW')[0].p.decision,decision);
    if(decision==='REJECT_ENTRY'){assert.equal(r.entries,0);assert.equal(f.controller.top3Status().lastScan.entries[0].reason,'TOP3_JEV_NOT_APPROVED');assert.equal(f.paper.summary().openPositions,0);}
    else{assert.equal(r.entries,1);assert.equal(f.controller.top3Status().active[0].jev.decision,'APPROVE_ENTRY');}
  }
});

test('R56 SHORT after a top-3 coin tops out: structural stop above the last 3 hours, -10% target',async()=>{
  const f=fixture({top3:{enabled:true}});
  f.seed({[HOUR0-H-5*H]:{SIGUSDT:2}});
  f.state.tick.SIGUSDT=5;f.state.px.SIGUSDT={bid:1.60,ask:1.601};
  // T-3 and T-2 are below the volume bar, so T is the rule's first hit (as the research would count it)
  f.state.klines.SIGUSDT=e=>candles(e,721,[[1.0,2.0,0.99,1.95,800],[1.95,1.96,1.80,1.82,600],[1.82,1.83,1.70,1.72,500],[1.72,1.72,1.66,1.66,200],[1.66,1.66,1.63,1.64,200],[1.64,1.655,1.62,1.65,300],[1.65,1.66,1.58,1.60,400]]);
  await startTest(f);atScan(f);
  const r=await f.controller.top3Tick();
  assert.equal(r.entries,1);
  const a=f.controller.top3Status().active[0];
  assert.equal(a.side,'SHORT');assert.equal(a.rule,'SHORT_TOP_FADE');assert.equal(a.entryPrice,1.60);
  assert.ok(Math.abs(a.stopPrice-1.6766)<1e-9);assert.ok(Math.abs(a.tpPrice-1.44)<1e-9);
  const pos=await f.paper.handle('GET','/fapi/v3/positionRisk',{params:{symbol:'SIGUSDT'}});assert.ok(Number(pos[0].positionAmt)<0);
});

test('R56 LIVE mode: the lane never trades unless "Canlıda çalışsın" was confirmed; status reports why',async()=>{
  const f=fixture({mode:'LIVE',top3:{enabled:true}});
  assert.equal(f.controller.top3Status().gate,'TOP3_LIVE_DISABLED');
  f.controller.configureTop3({liveEnabled:true,confirm:'LIVE'});
  assert.equal(f.controller.top3Status().gate,'LIVE_NOT_ARMED','still needs the user arm and OTO');
});

test('R56 Office: switch route forwards only the three switches; card, labels and wiring are present',()=>{
  process.env.BRAINHUB_ROOT=tmp('r56-office-');delete process.env.OFFICE_KEY;
  const office=require('../office-dashboard/office-server.js');
  assert.equal(office.CONTROL_ROUTES['/api/control/top3'],'/live/top3');
  assert.deepEqual(office.CONTROL_BODY['/api/control/top3']({enabled:true,jevMode:'1',liveEnabled:true,confirm:'live',leverage:125,marginQuote:999,other:1}),{enabled:true,liveEnabled:true,confirm:'LIVE',marginQuote:999,leverage:125},'R2544.57: margin/leverage pass through; the core validates them');
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['top3Card','btnTop3On','btnTop3Jev','btnTop3Save','t3Margin','t3Lev','top3Host'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.includes("laneAction({top3:true,confirm:'LIVE'}"),'R2544.57: İlk 3 goes LIVE as a lane (double press + LIVE)');assert.ok(html.includes("TOP3_HUNTER:'İLK 3 AVCISI'"));assert.ok(html.includes("BRAINHUB_TOP3"));
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.ok(server.includes('top3Judge:jev.sovereignTop3Gate'));assert.ok(server.includes("u.pathname==='/live/top3'"));assert.ok(server.includes('live.top3Tick()'));
  assert.ok(server.includes("const RUNTIME_RELEASE='R2544.59B-FAST-STORE'"));
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.ok(lc.includes("t3?'BRAINHUB_TOP3'"));assert.ok(lc.includes('!activeTop3For(p.symbol)'),'core position review skips top3 lots');
  assert.ok(fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8').includes('sovereignBurstExit,sovereignTop3Gate,'));
});

test('R56 live fix: the all-symbol 24 h ticker (~280 KB) passes the response cap; other public responses keep 256 KB',async()=>{
  const {BinanceLiveTransport}=require('../binance-live-transport');const {LiveAuthorizationRegistry}=require('../live-authorization');
  const big='[' + Array.from({length:700},(_,i)=>JSON.stringify({symbol:'C'+i+'USDT',priceChangePercent:'1.0',pad:'x'.repeat(380)})).join(',') + ']';
  assert.ok(big.length>262144);
  const t=new BinanceLiveTransport({registry:new LiveAuthorizationRegistry(),clock:()=>Date.now(),fetchImpl:async()=>({ok:true,status:200,async text(){return big;}})});
  assert.equal((await t._fetchJson('GET','/fapi/v1/ticker/24hr')).length,700);
  await assert.rejects(t._fetchJson('GET','/fapi/v1/klines',{params:{symbol:'AUSDT',interval:'1h',limit:'722'}}),/BINANCE_RESPONSE_TOO_LARGE/);
});

test('R56 live fix: a scan without market data does not use up the hour; it retries after 2 min',async()=>{
  const f=fixture({top3:{enabled:true}});
  f.seed({[HOUR0-H-50*H]:{SIGUSDT:5}});f.state.tick.SIGUSDT=40;f.state.px.SIGUSDT={bid:1.40,ask:1.401};f.state.klines.SIGUSDT=e=>candles(e,721,LONG_TAIL);
  f.state.tickerFail=1;
  await startTest(f);atScan(f);
  const r1=await f.controller.top3Tick();
  assert.equal(r1.scanned,true);assert.equal(r1.signals,0);
  assert.match(f.controller.top3Status().lastScan.errors[0],/^TOP3_MARKET_DATA_UNAVAILABLE/);
  f.state.now+=30000;assert.equal((await f.controller.top3Tick()).reason,'TOP3_RETRY_WAIT');
  f.state.now+=95000;
  const r2=await f.controller.top3Tick();
  assert.equal(r2.scanned,true);assert.equal(r2.signals,1);assert.equal(r2.entries,1);
  assert.equal((await f.controller.top3Tick()).reason,'TOP3_HOUR_DONE');
});

test('R56 24 h TEST window: starts with the lane, stops scanning and entries after 24 h, "Yeni 24 saat" restarts it',async()=>{
  const f=fixture({top3:{enabled:true}});
  f.seed({[HOUR0-H-50*H]:{SIGUSDT:5}});f.state.tick.SIGUSDT=40;f.state.px.SIGUSDT={bid:1.40,ask:1.401};f.state.klines.SIGUSDT=e=>candles(e,721,LONG_TAIL);
  await startTest(f);atScan(f);
  const r=await f.controller.top3Tick();assert.equal(r.entries,1);
  let st=f.controller.top3Status();
  assert.equal(st.testWindow.source,'FIRST_RUN','a lane already on when deployed starts its window on the first tick');
  assert.equal(st.testWindow.done,false);assert.equal(st.testWindow.scans,1);assert.equal(st.testWindow.okScans,1);assert.equal(st.testWindow.signals,1);assert.equal(st.testWindow.entries,1);
  assert.equal(f.kinds('TOP3_TEST_WINDOW_START').length,1);
  // 24 h later: no scan (no ticker call), gate closed, status shows the finished window
  const a=Object.values(f.controller._testTop3State().active)[0];a.deadline=f.state.now+30*H; // keep the lot open
  f.state.now=st.testWindow.endsAt+60000;
  const before=f.state.calls.filter(c=>/ticker\/24hr/.test(c)).length;
  const done=await f.controller.top3Tick();
  assert.equal(done.reason,'TOP3_TEST_WINDOW_DONE');
  assert.equal(f.state.calls.filter(c=>/ticker\/24hr/.test(c)).length,before,'no scan after the window');
  st=f.controller.top3Status();assert.equal(st.gate,'TOP3_TEST_WINDOW_DONE');assert.equal(st.testWindow.done,true);assert.equal(st.running,false);
  assert.equal(st.active.length,1,'the open lot is still managed (own stop/target/24 h exit)');
  assert.equal(f.kinds('TOP3_TEST_WINDOW_DONE').length,1);
  // user presses "Yeni 24 saat başlat"
  const again=f.controller.configureTop3({restartWindow:true});
  assert.equal(again.ok,true);assert.equal(again.testWindow.source,'RESTART');assert.equal(again.testWindow.done,false);assert.equal(again.testWindow.scans,0);
  await f.controller.testSupervisorTick(); // the TEST supervisor re-arms the 24 h paper arm
  assert.equal(f.controller.top3Status().gate,'OPEN');
  // switching off and on again also starts a fresh window
  f.controller.configureTop3({enabled:false});f.state.now+=1000;
  assert.equal(f.controller.configureTop3({enabled:true}).testWindow.source,'SWITCHED_ON');
});

test('R56 Office forwards restartWindow; the card has the 24 h counter and the restart label',()=>{
  process.env.BRAINHUB_ROOT=tmp('r56-office2-');delete process.env.OFFICE_KEY;
  const office=require('../office-dashboard/office-server.js');
  assert.deepEqual(office.CONTROL_BODY['/api/control/top3']({restartWindow:true,startedAt:5}),{restartWindow:true});
  assert.deepEqual(office.CONTROL_BODY['/api/control/top3']({restartWindow:'yes'}),{});
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.ok(html.includes("'Yeni 24 saat başlat'"));assert.ok(html.includes('24 saatlik test:'));assert.ok(html.includes('top3Control({restartWindow:true}'));
  assert.ok(fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8').includes('restartWindow:body?.restartWindow===true'));
});

test('R56 research dedupe: first hit counts, then one per coin and rule per 24 h',()=>{
  const t0=1791367200000;
  const hits=[t0,t0+5*H,t0+25*H,t0+30*H,t0+49*H];
  assert.equal(T3.countedSignalAt(hits,t0).counted,true);
  assert.equal(T3.countedSignalAt(hits,t0+5*H).counted,false);
  assert.equal(T3.countedSignalAt(hits,t0+25*H).counted,true,'24 h after the last counted hit');
  assert.equal(T3.countedSignalAt(hits,t0+30*H).counted,false);
  assert.equal(T3.countedSignalAt(hits,t0+49*H).counted,true);
  assert.equal(T3.countedSignalAt([t0+40*H],t0+40*H).counted,true,'a lone hit counts');
  assert.equal(T3.countedSignalAt(hits,t0+30*H).lastCounted,t0+25*H);
});

test('R56 repeat signal (rule already fired on the coin within 24 h, GTC/W 13.10): TEST takes it labelled REPEAT, LIVE leaves it out',async()=>{
  const tail=[[1.0,2.0,0.99,1.95,800],[1.95,1.96,1.80,1.82,600],[1.82,1.83,1.70,1.72,500],[1.72,1.72,1.66,1.66,400],[1.66,1.66,1.63,1.64,200],[1.64,1.655,1.62,1.65,300],[1.65,1.66,1.58,1.60,400]];
  // T-3 already satisfies the rule (red, 17% below the peak, volume 4x): T is a repeat, the research entered at T-3
  const f=fixture({top3:{enabled:true}});
  f.seed({[HOUR0-H-5*H]:{SIGUSDT:2}});f.state.tick.SIGUSDT=5;f.state.px.SIGUSDT={bid:1.60,ask:1.601};f.state.klines.SIGUSDT=e=>candles(e,721,tail);
  await startTest(f);atScan(f);
  const r=await f.controller.top3Tick();
  assert.equal(r.signals,1);assert.equal(r.entries,1,'TEST: "gördüğü sinyale girsin"');
  const st=f.controller.top3Status();
  assert.equal(st.active[0].signalKind,'REPEAT');assert.equal(st.lastScan.entries[0].kind,'REPEAT');
  assert.equal(f.kinds('TOP3_SIGNAL')[0].p.kind,'REPEAT');assert.equal(f.kinds('TOP3_SIGNAL')[0].p.lastCounted,new Date(HOUR0-H-3*H).toISOString());
  // LIVE (lane on, live allowed, not armed: the scan still classifies): only what the research would count
  const g=fixture({mode:'LIVE',top3:{enabled:true,liveEnabled:true}});
  g.seed({[HOUR0-H-5*H]:{SIGUSDT:2}});g.state.tick.SIGUSDT=5;g.state.px.SIGUSDT={bid:1.60,ask:1.601};g.state.klines.SIGUSDT=e=>candles(e,721,tail);
  atScan(g);const r2=await g.controller.top3Tick();
  assert.equal(r2.signals,0);
  const ls=g.controller.top3Status().lastScan;
  assert.equal(ls.stale.length,1);assert.equal(ls.stale[0].symbol,'SIGUSDT');assert.equal(ls.stale[0].lastCounted,new Date(HOUR0-H-3*H).toISOString());
  assert.equal(g.kinds('TOP3_SIGNAL_STALE').length,1);
});

test('R56 TEST has no slot limit (user 13.10: "testte sınır koyma"): every signal is entered; LIVE keeps maxActive',async()=>{
  const f=fixture({top3:{enabled:true}});
  const syms=['S1USDT','S2USDT','S3USDT'],extra={};syms.forEach(x=>{extra[x]=6;});
  f.seed({[HOUR0-H-50*H]:extra});
  syms.forEach((x,i)=>{f.state.tick[x]=40-i;f.state.px[x]={bid:1.40,ask:1.401};f.state.klines[x]=e=>candles(e,721,LONG_TAIL);});
  await startTest(f);atScan(f);
  const r=await f.controller.top3Tick();
  assert.equal(r.signals,3);assert.equal(r.entries,3,'maxActive 2 does not apply in TEST');
  assert.equal(f.controller.top3Status().active.length,3);
  assert.equal(f.controller.top3Status().learning.limitsInTest,'NONE');assert.equal(f.controller.top3Status().learning.limitsInLive.maxActive,2);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.ok(lc.includes("if(liveLimits&&Object.keys(top3State.active).length>=cfg.maxActive){res.reason='TOP3_SLOTS_FULL';continue;}"),'LIVE slot limit kept');
});

test('R56 İlk 3 hafızası: a closed lot becomes a lesson (5m best/worst excursion), JEV mode reads it on the next signal, it survives a restart',async()=>{
  const seen=[];
  const f=fixture({top3:{enabled:true,jevMode:true},judge:async x=>{seen.push(x);return {ok:true,called:true,decision:'APPROVE_ENTRY',reason:'EARLY_CONTINUATION'};}});
  f.seed({[HOUR0-H-50*H]:{SIGUSDT:5,SIG2USDT:5}});
  f.state.tick.SIGUSDT=40;f.state.px.SIGUSDT={bid:1.40,ask:1.401};f.state.klines.SIGUSDT=e=>candles(e,721,LONG_TAIL);
  await startTest(f);atScan(f);
  await f.controller.top3Tick();
  assert.equal(seen.length,1);assert.equal(seen[0].experience.closedLots,0,'no history yet');assert.equal(seen[0].signalKind,'FRESH');
  // the lot runs to the target; 5m path: best 1.85 (+32%), worst 1.38 (-1.5%)
  const t0=f.state.now;
  f.state.k5.SIGUSDT=[[t0,1.40,1.41,1.38,1.40,10],[t0+300000,1.40,1.85,1.39,1.83,10]];
  f.state.px.SIGUSDT={bid:1.83,ask:1.831};f.state.now+=1000;await f.paper.tick();
  f.state.now+=30000;await f.controller.top3Tick();
  const st=f.controller.top3Status();
  assert.equal(st.learning.lessons,1);
  const g=st.learning.groups[0];assert.deepEqual([g.mode,g.rule,g.kind,g.n,g.wins,g.targetHit],['TEST','LONG_6OF6','FRESH',1,1,1]);
  const lesson=f.kinds('TOP3_LESSON')[0].p;
  assert.equal(lesson.verdict,'WIN');assert.equal(lesson.pathSource,'5m');
  assert.ok(Math.abs(lesson.mfePct-(1.85/1.401-1))<1e-4);assert.ok(Math.abs(lesson.maePct-(1.38/1.401-1))<1e-4);
  assert.ok(lesson.tags.includes('TARGET_HIT'));assert.equal(lesson.features.rank,1);assert.ok(lesson.features.vr1>=33.9);
  assert.ok(lesson.lessonTr.startsWith('LONG 6/6: kazanç'),lesson.lessonTr);
  assert.equal(f.kinds('LEARN:TOP3_LESSON').length,1,'also written to the learning store');
  const closed=f.kinds('POSITION_CLOSED')[0].p;assert.equal(closed.entryContext.top3.pathSource,'5m');assert.equal(closed.entryContext.top3.signalKind,'FRESH');
  // next hour, a new LONG on another coin: JEV gets the lane memory with the first lesson
  f.state.now=HOUR0+H+60000;f.state.tick.SIG2USDT=39;f.state.px.SIG2USDT={bid:1.40,ask:1.401};f.state.klines.SIG2USDT=e=>candles(e,721,LONG_TAIL);
  f.state.klines.SIGUSDT=e=>candles(e,721);
  await f.controller.top3Tick();
  assert.equal(seen.length,2);
  const ex=seen[1].experience;assert.equal(ex.rule,'LONG_6OF6');assert.equal(ex.closedLots,1);assert.equal(ex.recent[0].symbol,'SIGUSDT');assert.equal(ex.recent[0].verdict,'WIN');
  assert.equal(ex.note,'FEW_SAMPLES_TREAT_AS_ANECDOTE');
  // the memory is in the lane's state file: a restarted controller still has it
  const again=f.restart();assert.equal(again.top3Status().learning.lessons,1);
});

test('R56 a lot opened before the signal label existed is learned as UNLABELED, never as FRESH',()=>{
  const now=1791370800000;
  const l=T3.buildLesson({id:'x',symbol:'WUSDT',side:'SHORT',rule:'SHORT_TOP_FADE',mode:'TEST',entryPrice:0.019518,tpPrice:0.017567,stopPct:0.0259,openedAt:now-H,closedAt:now,exitPrice:0.0194},{netPnl:1,rMultiple:0.2,exitType:'TOP3_STOP_OR_EXTERNAL'},null);
  assert.equal(l.kind,'UNLABELED');assert.equal(l.pathSource,'NONE');
  assert.equal(T3.experienceSummary([l]).groups[0].kind,'UNLABELED');
});

// ---------- R2544.57 (14.10 deploy STOP): a lot the core closes itself is CUT_SHORT, never a stop ----------
test('R57 lesson labels: SYSTEM_CLOSE is cut short (not a stop); legacy deploy-STOP lessons are repaired, real stop-outs stay',()=>{
  const now=1791969764731;
  const sys=T3.buildLesson({id:'a',symbol:'WALUSDT',side:'LONG',rule:'LONG_6OF6',signalKind:'FRESH',mode:'TEST',entryPrice:0.0457,tpPrice:0.0457*1.3,stopPct:0.08,openedAt:now-3*H,closedAt:now,exitPrice:0.0498},{netPnl:26.99,rMultiple:1.129,exitType:'TOP3_SYSTEM_CLOSE'},{mfePct:0.12,maePct:-0.012});
  assert.ok(sys.tags.includes('CUT_SHORT')&&sys.tags.includes('SYSTEM_CLOSE'));assert.equal(sys.tags.includes('STOPPED'),false);
  assert.ok(Math.abs(sys.resultPct-(0.0498/0.0457-1))<1e-4);assert.equal(sys.resultBasis,'EXIT_PRICE');
  assert.match(sys.lessonTr,/sistem kapattı/);assert.match(sys.lessonTr,/Yarıda kesildi/);
  // legacy: lots booked at the 14.10 deploy STOP as "stop / dış kapanış" without an exit price
  const legacy=(id,side,r,stopPct,dt)=>({...T3.buildLesson({id,symbol:id+'USDT',side,rule:side==='LONG'?'LONG_6OF6':'SHORT_TOP_FADE',signalKind:'FRESH',mode:'TEST',entryPrice:1,tpPrice:side==='LONG'?1.3:0.9,stopPct,openedAt:now-H,closedAt:now+dt},{netPnl:r*10,rMultiple:r,exitType:'TOP3_STOP_OR_EXTERNAL'},{mfePct:0.05,maePct:-0.02}),pathSource:'5m'});
  const lessons=[legacy('Q','LONG',0.1217,0.08,0),legacy('S','SHORT',1.3646,0.0371,5),legacy('AVA','LONG',-0.8651,0.0801,10),legacy('X','LONG',-1.05,0.08,9*H)];
  assert.equal(lessons[0].tags.includes('STOPPED'),true,'the old labelling');assert.equal(lessons[0].resultPct,null);
  const rep=T3.repairLessons(lessons);
  assert.equal(rep.repaired,3,'a -1.05 R close (a real stop-out) stays as it was');
  const [q,s,ava,x]=rep.lessons;
  for(const l of [q,s,ava]){assert.equal(l.exitType,'TOP3_SYSTEM_CLOSE');assert.equal(l.tags.includes('STOPPED'),false);assert.ok(l.tags.includes('CUT_SHORT'));assert.equal(l.repairedFrom,'TOP3_STOP_OR_EXTERNAL');assert.equal(l.pathSource,'5m');}
  assert.equal(s.tags.includes('STOPPED_AFTER_HALF_TARGET'),false);
  assert.ok(Math.abs(q.resultPct-0.1217*0.08)<1e-4,'net result from R x stop distance');assert.equal(q.resultBasis,'NET_PNL');assert.equal(ava.verdict,'LOSS');
  assert.equal(x,lessons[3]);assert.equal(T3.repairLessons(rep.lessons).repaired,0,'idempotent');
  const g=T3.experienceSummary(rep.lessons).groups.find(y=>y.rule==='LONG_6OF6');assert.equal(g.stopped,1);assert.equal(g.cutShort,2);
  assert.equal(T3.repairLessons([legacy('L','LONG',0.3,0.08,0)]).lessons[0].exitType,'TOP3_EXTERNAL_CLOSE','alone (no other close within 5 s) = closed outside the lane');
});

test('R57 STOP in TEST: the İlk 3 lot is booked as SYSTEM_CLOSE with its real exit fill; a manual close is EXTERNAL_CLOSE; the state file is repaired on load',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({top3:{enabled:true}});
  f.seed({[HOUR0-H-50*H]:{SIGUSDT:5}});f.state.tick.SIGUSDT=40;f.state.px.SIGUSDT={bid:1.40,ask:1.401};f.state.klines.SIGUSDT=e=>candles(e,721,LONG_TAIL);
  await startTest(f);atScan(f);
  assert.equal((await f.controller.top3Tick()).entries,1);
  f.state.px.SIGUSDT={bid:1.50,ask:1.501};f.state.now+=20*60000;
  const s=await f.controller.runControl({action:'STOP'});assert.equal(s.ok,true);assert.equal(s.paperClosed,1);
  f.state.now+=30000;await f.controller.top3Tick();
  const closed=f.kinds('TOP3_CLOSED')[0].p;assert.equal(closed.exitReason,'TOP3_SYSTEM_CLOSE');assert.equal(closed.systemClose.reason,'USER_STOP');
  assert.ok(Math.abs(closed.exitPrice-1.50)<1e-9,'exit = the paper close fill');
  const rec=f.kinds('POSITION_CLOSED').map(e=>e.p).find(p=>p.tradeLane==='TOP3_HUNTER');assert.equal(rec.exitType,'TOP3_SYSTEM_CLOSE');assert.equal(rec.entryContext.top3.closedBy,'USER_STOP');
  const lesson=f.kinds('TOP3_LESSON')[0].p;assert.equal(lesson.exitType,'TOP3_SYSTEM_CLOSE');assert.ok(lesson.tags.includes('CUT_SHORT'));assert.equal(lesson.tags.includes('STOPPED'),false);
  assert.ok(Math.abs(lesson.resultPct-(1.50/1.401-1))<1e-4);assert.equal(f.controller.top3Status().learning.groups[0].cutShort,1);
  // a lot closed by hand (not by its stop/target, not by the core) is EXTERNAL_CLOSE; one closed at its stop price is a stop
  const g=fixture({top3:{enabled:true}});
  g.seed({[HOUR0-H-50*H]:{SIGUSDT:5}});g.state.tick.SIGUSDT=40;g.state.px.SIGUSDT={bid:1.40,ask:1.401};g.state.klines.SIGUSDT=e=>candles(e,721,LONG_TAIL);
  await startTest(g);atScan(g);await g.controller.top3Tick();
  const lot=Object.values(g.controller._testTop3State().active)[0];
  g.state.px.SIGUSDT={bid:1.45,ask:1.451};g.state.now+=60000;
  await g.paper.handle('POST','/fapi/v1/order',{params:{symbol:'SIGUSDT',side:'SELL',type:'MARKET',quantity:String(lot.quantity),reduceOnly:'true'}});
  g.state.now+=30000;await g.controller.top3Tick();
  assert.equal(g.kinds('TOP3_CLOSED')[0].p.exitReason,'TOP3_EXTERNAL_CLOSE');assert.ok(Math.abs(g.kinds('TOP3_CLOSED')[0].p.exitPrice-1.45)<1e-9);
  // the deploy-STOP lessons already in a state file are relabelled when the controller starts
  const st=JSON.parse(fs.readFileSync(path.join(g.root,'data','top3-hunter-state.json'),'utf8'));
  const old=T3.buildLesson({id:'old1',symbol:'QUSDT',side:'LONG',rule:'LONG_6OF6',signalKind:'FRESH',mode:'TEST',entryPrice:1,tpPrice:1.3,stopPct:0.08,openedAt:g.state.now-6*H,closedAt:g.state.now-H},{netPnl:5.57,rMultiple:0.1217,exitType:'TOP3_STOP_OR_EXTERNAL'},null);
  const old2={...old,id:'old2',symbol:'WALUSDT',closedAt:old.closedAt+3};
  st.lessons.push(old,old2);fs.writeFileSync(path.join(g.root,'data','top3-hunter-state.json'),JSON.stringify(st));
  const again=g.restart();
  const groups=again.top3Status().learning.groups;assert.equal(groups.reduce((a,x)=>a+x.cutShort,0),3,'1 manual close + 2 repaired');assert.equal(groups.reduce((a,x)=>a+x.stopped,0),0);
  assert.equal(g.kinds('TOP3_LESSONS_REPAIRED')[0].p.repaired,2);
});

test('R57 closes left pending by the older build at a deploy STOP are booked and repaired to SYSTEM_CLOSE by the new build',async()=>{
  require('../binance-rate-limit').resetForTests(); // the shared 60 s weight estimate fills up across this file's paper runs
  const f=fixture({top3:{enabled:true}});
  const syms=['S1USDT','S2USDT'],extra={};syms.forEach(x=>{extra[x]=6;});
  f.seed({[HOUR0-H-50*H]:extra});
  syms.forEach((x,i)=>{f.state.tick[x]=40-i;f.state.px[x]={bid:1.40,ask:1.401};f.state.klines[x]=e=>candles(e,721,LONG_TAIL);});
  await startTest(f);atScan(f);
  assert.equal((await f.controller.top3Tick()).entries,2);
  // what R2544.57 before this fix left behind: paper closed without a mark, lots moved to pendingCloses as EXCHANGE_EXIT
  f.state.now+=60000;await f.paper.closeAll('TESTSTOP');
  const st=f.controller._testTop3State();
  for(const a of Object.values(st.active)){delete st.active[a.id];st.pendingCloses.push({...a,exitReason:'TOP3_EXCHANGE_EXIT',exitPrice:null,closedAt:f.state.now,detectedAt:f.state.now,noIncome:false});}
  f.state.now+=30000;await f.controller.top3Tick();
  const lessons=f.controller._testTop3State().lessons;
  assert.equal(lessons.length,2);
  for(const l of lessons){assert.equal(l.exitType,'TOP3_SYSTEM_CLOSE');assert.equal(l.tags.includes('STOPPED'),false);assert.ok(l.tags.includes('CUT_SHORT'));}
});
