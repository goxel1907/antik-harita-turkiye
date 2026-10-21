'use strict';
// R2544.70 PRICE ACTION ÇEKİRDEĞİ (user 21.10: "price action stratejilerini bir yerde topla ... fitil dahil tüm yapıları görmesi gerekiyor
// ... doğru zamanlama, doğru giriş, doğru TP, doğru SL ... JEV açıkken JEV'e yanlış bilgi taşınmasın, her 3 stratejide"). pa-core.js is
// the one source: swings with wicks, untaken liquidity (equal highs/lows), range/EQ, SFP sweeps; causal (closed candles only).
// Measured rule (1 month top-5): the SFP sweep requirement -> ZİRVE-5 (both sides) and İlk 3 TEPE SHORT; not ERKEN LONG (measured worse).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PA=require('../pa-core'),Z=require('../zirve5'),T3=require('../top3-hunter');
const {writeTradingMode}=require('../binance-live-transport');
const M15=900000;
const C=(o,h,l,c,t=0)=>({openTime:t,open:o,high:h,low:l,close:c});
const flat=(n,p=100)=>Array.from({length:n},(_,i)=>C(p,p+0.1,p-0.1,p,i));

test('R2544.70 pa-core: swings use the WICKS, are known only after n candles closed, and the SFP is a wick beyond + close back (a close beyond is a breakout)',()=>{
  const c=flat(20);c[10]={...c[10],high:105,close:100.2};                 // a long upper wick, small body
  const sw=PA.swings(c,3);const h=sw.find(s=>s.kind==='H');assert.ok(h);assert.equal(h.i,10);assert.equal(h.price,105,'the wick is the swing');assert.equal(h.confirmedAt,13);
  assert.equal(PA.liquidityPools(c,12).filter(p=>p.kind==='H').length,0,'not known before candle 13 closed (no look-ahead)');
  assert.equal(PA.liquidityPools(c,13).filter(p=>p.kind==='H')[0].price,105);
  // SFP: wick above 105, close back below -> sweep; close above -> breakout, not an SFP
  const sfp=c.map(x=>({...x}));sfp[18]=C(100,105.5,99.9,100.4,18);
  const s=PA.sweeps(sfp,18,'SHORT',{n:3,within:24,lookback:96});assert.equal(s.length,1);assert.equal(s[0].level,105);assert.equal(s[0].extreme,105.5);
  const brk=c.map(x=>({...x}));brk[18]=C(100,106,99.9,105.8,18);
  assert.equal(PA.sweeps(brk,18,'SHORT',{n:3,within:24,lookback:96}).length,0,'closed above the swing = breakout, not a sweep');
  // a swing already taken earlier is not liquidity any more and cannot be swept again
  const taken=sfp.map(x=>({...x}));taken[15]=C(100,105.2,99.9,100,15);
  assert.equal(PA.liquidityPools(taken,16).filter(p=>p.kind==='H').length,0,'105 was taken by the wick at candle 15');
});

test('R2544.70 pa-core: equal lows are one pool with touches; nextLiquidity is the first untaken pool beyond the entry; range position',()=>{
  const c=flat(60,100);
  for(const i of [10,25])c[i]={...c[i],low:95};                           // two equal lows at 95 (equal-low liquidity)
  c[40]={...c[40],low:97};                                                  // a nearer single low
  const pools=PA.liquidityPools(c,59,{n:3,lookback:96});
  const eq=pools.find(p=>p.kind==='L'&&p.price===95);assert.ok(eq);assert.equal(eq.touches,2,'equal lows = one pool, two touches');
  const nx=PA.nextLiquidity(c,59,'SHORT',100,{n:3,lookback:96});assert.equal(nx.price,97,'the first pool below a short is the nearer 97 low');
  assert.ok(Math.abs(PA.targetBeforePool(nx,'SHORT')-97*1.001)<1e-9,'target just before the pool');
  const r=PA.dealingRange(c,59,96,100);assert.equal(r.low,95);assert.ok(r.pos>0.9);
  const ctx=PA.context(c,59,100,{n:3,lookback:96});assert.equal(ctx.liquidityBelow[0].price,97);assert.equal(ctx.liquidityBelow[1].touches,2);assert.equal(ctx.range.posPct,Math.round(r.pos*100));
});

// ZİRVE-5 SHORT scenario WITH an SFP on the confirmation candle: the rise ends with a swing high (99.45), three lower highs, then the
// confirmation bear candle wicks to 99.6 (above 99.45) and closes 98.55 (back below) = sweep + volume-backed bear close inside the zone.
function series(points,lastOpen,qv=1000){
  const out=[];for(let s=1;s<points.length;s++){const a=points[s-1],b=points[s];for(let i=1;i<=8;i++){const p=a+(b-a)*(i-1)/8,c=a+(b-a)*i/8;out.push([p,c]);}}
  const t0=lastOpen-(out.length-1)*M15;
  return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05,quoteVolume:qv}));
}
function sweepScenario(side,lastOpen,{sweep=true}={}){
  const P=[100,100,100,100,100,100,100,103,98,101.5,96,92,99.4];
  const extra=[[99.4,99.3,99.35,99.25],[99.3,99.1,99.32,99.05],[99.1,99.0,99.12,98.95]];                  // [open, close, high, low]: lower highs after 99.45
  const conf=sweep?[99.2,98.55,99.6,98.5]:[99.0,98.4,99.05,98.35];                                         // with SFP: wick 99.6 > 99.45, close 98.55 < 99.45
  const c=series(P,lastOpen-(extra.length+1)*M15);
  let t=c.at(-1).openTime;for(const [o,cl,h,l] of [...extra,conf]){t+=M15;c.push({openTime:t,closeTime:t+M15-1,open:o,close:cl,high:h,low:l,quoteVolume:1000});}
  c.at(-1).quoteVolume=5000;
  return side==='SHORT'?c:c.map(x=>({...x,open:200-x.open,close:200-x.close,high:200-x.low,low:200-x.high}));
}
test('R2544.70 ZİRVE-5: the confirmation must come with a liquidity sweep (SFP); the signal carries the sweep and the price-action context',()=>{
  const t=Date.UTC(2026,9,21,10,0);
  for(const side of ['SHORT','LONG']){
    const v=Z.videoScan(sweepScenario(side,t));assert.equal(v.signals.length,1,side+' '+JSON.stringify(v.waiting.length));
    const g=v.signals[0];assert.equal(g.side,side);assert.ok(g.sweep,'SFP found');assert.equal(g.sweep.barsAgo,0,'the confirmation candle itself swept the swing');
    assert.ok(Math.abs(g.sweep.level-(side==='SHORT'?99.45:200-99.45))<1e-9,JSON.stringify(g.sweep));
    assert.ok(g.pa&&g.pa.range&&Array.isArray(g.pa.liquidityAbove)&&Array.isArray(g.pa.liquidityBelow),'context for JEV');
    const n=Z.videoScan(sweepScenario(side,t,{sweep:false}));assert.equal(n.signals.length,1);assert.equal(n.signals[0].sweep,null,'no sweep -> the signal says so');
  }
  assert.equal(Z.DEFAULT_CONFIG.requireSweep,true);assert.equal(Z.DEFAULT_CONFIG.sweepN,3);assert.equal(Z.DEFAULT_CONFIG.sweepWithin,24);assert.equal(Z.DEFAULT_CONFIG.sweepLookback,96,'the measured parameters');
  assert.equal(T3.DEFAULT_CONFIG.top.requireSweep,true);assert.equal(T3.DEFAULT_CONFIG.top.sweepLookback,288);assert.equal(T3.DEFAULT_CONFIG.early.requireSweep,undefined,'ERKEN LONG measured worse with it: not added');
});

const FAKE={apiKey:'fake-test-key-r70',apiSecret:'fake-test-secret-r70'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({z5={enabled:true},sweep=true,judge=undefined}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r70-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify(z5));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-21T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const bar=Date.UTC(2026,9,21,10,0),k=sweepScenario('SHORT',bar,{sweep}),c0=k.at(-1).close,state={now:bar+M15+10000,px:{Z5USDT:{bid:c0,ask:c0+0.01}}};
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url)=>{const u=new URL(url),p=u.pathname;
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['Z5USDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'Z5USDT',highPrice:'110',lowPrice:'90',lastPrice:'99',quoteVolume:'50000000',priceChangePercent:'-1'}]);
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines')return ok(k.map(r=>[r.openTime,String(r.open),String(r.high),String(r.low),String(r.close),'0',r.closeTime,String(r.quoteVolume)]));
    throw new Error('UNEXPECTED '+p);};
  const events=[];
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k2,s,p)=>events.push({k:k2,s,p}),recordLearning:()=>{}},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}},...(judge!==undefined?{zirve5Judge:judge}:{})});
  return {controller,events,kinds:k2=>events.filter(e=>e.k===k2),lot:()=>Object.values(controller._testTop3State().active)[0]||null};
}
test('R2544.70 controller: with the sweep the lane enters (the lot records the sweep); without it ZIRVE5_NO_SWEEP and no order; the Office switch turns it off',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();await f.controller.testSupervisorTick();
  assert.equal((await f.controller.z5Tick()).entries,1,JSON.stringify(f.controller.z5Status().recentEntries));
  const a=f.lot();assert.equal(a.side,'SHORT');assert.ok(a.entryFeatures.sweep&&Math.abs(a.entryFeatures.sweep.level-99.45)<1e-9);assert.ok(a.entryFeatures.pa.range);
  require('../binance-rate-limit').resetForTests();
  const g=fixture({sweep:false});await g.controller.testSupervisorTick();
  assert.equal((await g.controller.z5Tick()).entries,0);assert.equal(g.lot(),null);
  assert.equal(g.controller.z5Status().recentEntries[0].reason,'ZIRVE5_NO_SWEEP');assert.equal(g.kinds('ZIRVE5_BLOCKED')[0].p.reason,'ZIRVE5_NO_SWEEP');
  assert.equal(g.controller.configureZ5({requireSweep:false}).switches.requireSweep,false);
  require('../binance-rate-limit').resetForTests();
  const h=fixture({sweep:false,z5:{enabled:true,requireSweep:false}});await h.controller.testSupervisorTick();
  assert.equal((await h.controller.z5Tick()).entries,1,'switched off = the R2544.68 rule');
});

test('R2544.70 JEV-on: the ZİRVE-5 judge receives the sweep + context; both gate records carry priceAction and stay under 48 kB with the real 86 kB packet',async()=>{
  require('../binance-rate-limit').resetForTests();
  const seen=[];const f=fixture({z5:{enabled:true,jevMode:true},judge:async a=>{seen.push(a);return {ok:true,called:true,decision:'APPROVE_ENTRY',reason:'WEAK_RETEST'};}});
  await f.controller.testSupervisorTick();assert.equal((await f.controller.z5Tick()).entries,1);
  assert.ok(seen[0].features.sweep&&seen[0].features.pa&&seen[0].features.pa.liquidityBelow,'what the rule saw goes to JEV');
  const {createJevClient,protectedCoreTruth}=require('../jev-decision');
  const packet=require('./fixtures/r42-carv-r41-packet.json').packet;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r70-jev-'));fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  let sent=null;const reply=b=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(b)});
  const c=createJevClient({root,apiKey:'sk-or-v1-fake',clock:()=>Date.UTC(2026,9,21,10,20),fetchImpl:async(_,o)=>{sent=o.body;return reply({answers:{zirve5_decision:{choice:'APPROVE_ENTRY'},zirve5_reason:{choice:'WEAK_RETEST'},top3_decision:{choice:'APPROVE_ENTRY'},top3_reason:{choice:'NO_EDGE'}},usage:{cost:0}});}});
  const chart={available:true,symbol:packet.symbol,packet,asOf:Date.UTC(2026,9,21,10,15),ageMs:1000,source:'TEST'};
  await c.sovereignZirve5Gate({symbol:packet.symbol,signal:seen[0].signal,features:seen[0].features,candle:Date.UTC(2026,9,21,10,0),chartContext:chart});
  let body=JSON.parse(sent);assert.ok(Buffer.byteLength(sent)<=48000);
  assert.deepEqual(body.state.record.priceAction.sweep,seen[0].features.sweep);assert.deepEqual(body.state.record.priceAction.context,seen[0].features.pa);
  // İlk 3 TEPE SHORT gate: the trigger's sweep and the pa-core context
  const trig={ok:true,side:'SHORT',rule:'SHORT_TOP_BREAK',top:1.08,hl:1.05,topAt:1,breakAt:2,topVolMult:8,sweep:{at:1,level:1.078,extreme:1.08}};
  const pa={version:'x',sweepsOfHighs:[{level:1.078}],liquidityAbove:[],liquidityBelow:[{price:1.04,touches:2,distPct:-1.2}],range:{posPct:80}};
  sent=null;await c.sovereignTop3Gate({symbol:packet.symbol,signal:{ok:true,side:'SHORT',rule:'SHORT_TOP_BREAK',strategy:'İLK 3 TEPE SHORT',v2:trig,levels:{pdh:1.07},pa},features:{ok:true,close:1.04},rank:5,candle:1,chartContext:chart});
  body=JSON.parse(sent);assert.ok(Buffer.byteLength(sent)<=48000);
  assert.deepEqual(body.state.record.priceAction,{sweep:trig.sweep,context:pa});
});

test('R2544.70 normal system packet: core15m (sweeps, untaken liquidity, range) from the same pa-core on the same closed 15m candles',()=>{
  const PS=require('../pa-setups');const t=Date.UTC(2026,9,21,10,0),c=sweepScenario('SHORT',t);
  const raw=c.map(x=>[x.openTime,String(x.open),String(x.high),String(x.low),String(x.close),'0',x.closeTime,String(x.quoteVolume)]);
  const pa=PS.paSetups({rawFrames:{'15m':raw,'1d':[]},now:t+M15+5000});
  const direct=PA.context(PA.toCandles(raw),raw.length-1,c.at(-1).close,{n:3,lookback:96,within:24});
  assert.deepEqual(pa.core15m.liquidityBelow,direct.liquidityBelow);assert.deepEqual(pa.core15m.sweepsOfHighs,direct.sweepsOfHighs);assert.equal(pa.core15m.range.posPct,direct.range.posPct);
  assert.ok(pa.core15m.sweepsOfHighs.length>=1,'the SFP of the 99.45 high is visible to the normal system too');
});

test('R2544.70 wiring: Office/API pass the sweep switches; LIVE needs LIVE; Office buttons, reasons and the chart overlay use pa-core',()=>{
  const {CONTROL_BODY}=require('../office-dashboard/office-server');
  assert.equal(CONTROL_BODY['/api/control/zirve5']({requireSweep:false}).requireSweep,false);
  assert.equal(CONTROL_BODY['/api/control/top3']({topSweep:false}).topSweep,false);
  const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(src('server.js'),/requireSweep:body\?\.requireSweep/);assert.match(src('server.js'),/topSweep:body\?\.topSweep/);
  const html=src('office-dashboard/public/office.html');
  for(const id of ['btnZ5Sweep','btnT3TopSweep'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/ZIRVE5_NO_SWEEP:'süpürme \(SFP\) yok/);assert.match(html,/V2_NO_SWEEP:'süpürme \(SFP\) yok'/);
  assert.match(src('market.js'),/PA\.context\(closed,closed\.length-1,null,\{n:3,lookback:chart\.frame==='15m'\?96:288,within:24\}\)/,'chart overlay = the lanes\' parameters');
  for(const f of ['jev-brain/JEV-DEPLOY.ps1','manage.ps1'])assert.ok(src(f).includes("'pa-core.js'"),f+' deploys pa-core.js');
});
test('R2544.70 LIVE: a sweep-switch change needs the LIVE confirmation on both lanes',()=>{
  require('../binance-rate-limit').resetForTests();
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r70l-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  writeTradingMode(root,{mode:'LIVE',changedAt:'2026-10-21T08:00:00.000Z',testStartedAt:null,testAutoRun:false});
  const c=require('../live-controller').createLiveController({root,clock:()=>Date.UTC(2026,9,21,10,0),store:{journal(){},recordLearning(){}},scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:FAKE,fetchImpl:async()=>{throw new Error('NO_NETWORK');},paperAutoTick:false,defaultTradingMode:'LIVE',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  assert.deepEqual(c.configureZ5({requireSweep:false}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(c.configureZ5({requireSweep:false,confirm:'LIVE'}).switches.requireSweep,false);
  assert.deepEqual(c.configureTop3({topSweep:false}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(c.configureTop3({topSweep:false,confirm:'LIVE'}).switches.topSweep,false);
});
