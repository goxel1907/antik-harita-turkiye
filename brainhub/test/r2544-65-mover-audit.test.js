'use strict';
// R2544.65 kaçan hareket denetimi: replays JCTUSDT at 20.10.2026 03:30 UTC with the REAL Binance candles (the breakout of the
// previous-day high 0.002 at 03:10 with 18x volume, the retest at 03:20) and the rank the İlk 3 lane really had (37 at the
// 02:00 hour). The audit must say what the live system saw: pattern formed, live context rejected it (rank out of band).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const FX=require('./fixtures/r65-jct-20101030.json');
const H=3600000,M5=300000;
const FAKE={apiKey:'fake-test-key-r65',apiSecret:'fake-test-secret-r65'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r65-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:true}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-20T00:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const now=Date.UTC(2026,9,20,3,30)+25000,calls=[],events=[];
  const ticker=[{symbol:'JCTUSDT',priceChangePercent:'5.4',quoteVolume:'2400000',highPrice:'0.00205',lowPrice:'0.00188',lastPrice:'0.002027'},
    ...Array.from({length:30},(_,i)=>({symbol:'C'+i+'XUSDT',priceChangePercent:String(40-i),quoteVolume:'60000000',highPrice:String(1.2+i*0.01),lowPrice:'1',lastPrice:'1.1'}))];
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname;calls.push(p+(u.searchParams.get('symbol')?'?'+u.searchParams.get('symbol'):''));
    if(p==='/fapi/v1/time')return ok({serverTime:now});
    if(p==='/fapi/v1/ticker/24hr')return ok(ticker);
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:[]});
    if(p==='/fapi/v1/klines'){const s=u.searchParams.get('symbol'),iv=u.searchParams.get('interval');
      if(s==='JCTUSDT'&&iv==='5m')return ok(FX.k5.map(r=>[r[0],String(r[1]),String(r[2]),String(r[3]),String(r[4]),'0',r[0]+M5-1,String(r[5])]));
      if(s==='JCTUSDT'&&iv==='1d')return ok(FX.d1.map(r=>[r[0],String(r[1]),String(r[2]),String(r[3]),String(r[4]),'0',r[0]+86400000-1,String(r[5])]));
      return ok([]);}
    throw new Error('UNEXPECTED '+p);};
  const store={journal:(k,s,p)=>events.push({k,s,p}),recordLearning:()=>{}};
  const controller=require('../live-controller').createLiveController({root,clock:()=>now,store,scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  // the İlk 3 rank book as it was: JCT 23 (00:00), 37 (01:00), 38 (02:00 hour, the newest record at 03:30)
  const ranks=controller._testTop3Ranks();
  for(let T=Date.UTC(2026,9,19,0,0);T<=Date.UTC(2026,9,20,2,0);T+=H){const m={};for(let i=0;i<49;i++)m['C'+i+'XUSDT']=i+1;
    const jr=T===Date.UTC(2026,9,20,0,0)?23:T===Date.UTC(2026,9,20,1,0)?37:T===Date.UTC(2026,9,20,2,0)?38:null;if(jr)m.JCTUSDT=jr;ranks.record(T,m);}
  return {controller,events,calls,kinds:k=>events.filter(e=>e.k===k)};
}

test('R2544.65 audit replays JCT 20.10 03:30: live İlk 3 saw no breakout (week/month highs only); with day highs the rank rule rejects it; the pattern itself formed (PDH 0.002, 18x)',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();
  const r=await f.controller.moverAuditTick();assert.equal(r.ok,true,JSON.stringify(r));
  const st=f.controller.moverAuditStatus(),row=st.last.rows.find(x=>x.symbol==='JCTUSDT');
  assert.ok(row,'JCT is audited (a 24 h gainer)');
  assert.equal(row.ilk3.rankUsed,38,'the hour-old rank the lane really used');assert.equal(st.last.rankHour,'2026-10-20T02:00:00.000Z');
  assert.equal(row.ilk3.longCandidate,true,'rank 23 two hours earlier made it a candidate');
  assert.equal(row.ilk3.long,'V2_NO_BREAKOUT','live setting counts only week/month highs: the lane saw no breakout');
  assert.match(row.ilk3.longDay,/^V2_CONTEXT:.*RANK_OUT_OF_BAND/,'with previous-day highs the live rank context rejects it '+JSON.stringify(row.ilk3));
  assert.equal(row.ilk3.longPattern,'V2_RETEST_ALREADY_PASSED','without the rank rule the pattern formed (retest at 03:20 already passed at 03:30)');
  assert.equal(row.ilk3.level,0.002);assert.ok(row.ilk3.volMult>15,'breakout volume 18x the 24 h median');
  assert.equal(row.zirve5.why,'VOLUME_BELOW_20M','ZİRVE-5 never saw it: 24 h volume 2.4M');
  assert.equal(row.normal.why,'NORMAL_LANE_OFF');
  const j=f.kinds('MOVER_AUDIT')[0].p,jr=j.rows.find(x=>x.s==='JCTUSDT');assert.equal(jr.L,'V2_NO_BREAKOUT');assert.match(jr.D,/RANK_OUT_OF_BAND/);assert.equal(jr.rk,38);
  assert.ok(Buffer.byteLength(JSON.stringify(j))<6000,'journal row stays small');
  // one audit per 15m candle; read-only (no order endpoint was called)
  assert.equal((await f.controller.moverAuditTick()).reason,'AUDIT_WAIT');
  assert.equal(f.calls.some(c=>c.startsWith('/fapi/v1/order')||c.startsWith('/fapi/v1/leverage')),false);
});

test('R2544.65 wiring: route, timer, Office card and table; deploy script versions',()=>{
  const srv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.ok(srv.includes("u.pathname==='/live/movers'"));assert.ok(srv.includes('live.moverAuditTick()'));assert.ok(srv.includes("const RUNTIME_RELEASE='R2544.65-MOVER-AUDIT'"));
  const off=fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8');assert.ok(off.includes("'/live/movers'"));assert.ok(off.includes("brainGet('/live/movers')"));
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  for(const id of ['moverCard','moverHost'])assert.ok(html.includes(`id="${id}"`),id);assert.ok(html.includes('function renderMovers('));assert.ok(html.includes('renderMovers(s)'));
});
