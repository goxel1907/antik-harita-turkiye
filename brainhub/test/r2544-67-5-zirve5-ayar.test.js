'use strict';
// R2544.67.5 (user 21.10: "MARJ AYARINI İSTEDİĞİM ZAMAN TESTTE DEĞİŞTİREMİYORUM ... KESİN YANLIŞ YAPTIĞIN AYARLAR VAR"):
//  1) ZİRVE-5 SHORTs only a coin that is DOWN over 24 h (switchable; 21.10 night: DOOD +83 %, JCT +131 %, IOST +37 % shorted, all stopped)
//  2) ZİRVE-5 has its own margin / leverage box in Office: TEST any time, LIVE with the 'LIVE' confirmation; empty = risk-based.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const Z=require('../zirve5');
const M15=900000;
const src=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

function series(points,lastOpen){
  const out=[];for(let s=1;s<points.length;s++){const a=points[s-1],b=points[s];for(let i=1;i<=8;i++){const p=a+(b-a)*(i-1)/8,c=a+(b-a)*i/8;out.push([p,c]);}}
  const t0=lastOpen-(out.length-1)*M15;
  return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05}));
}
const PTS=[100,100,100,100,100,103,98,101.5,96,95.5,96.2,95.8];
const FAKE={apiKey:'fake-test-key-r675',apiSecret:'fake-test-secret-r675'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({z5=null,mode='TEST',change='-5'}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r675-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false,marginQuote:70,leverage:10}));
  if(z5)fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify(z5));
  writeTradingMode(root,{mode,changedAt:'2026-10-21T08:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  const bar=Date.UTC(2026,9,20,10,0),state={now:bar+M15+10000,change,px:{Z5USDT:{bid:95.8,ask:95.81}},k15:{Z5USDT:series(PTS,bar)}},events=[];
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['Z5USDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr'){const t={symbol:'Z5USDT',highPrice:'110',lowPrice:'90',lastPrice:'96',quoteVolume:'50000000'};if(state.change!==null)t.priceChangePercent=state.change;return ok([t]);}
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines'&&u.searchParams.get('interval')==='15m'){const k=state.k15[u.searchParams.get('symbol')]||[];return ok(k.map(r=>[r.openTime,String(r.open),String(r.high),String(r.low),String(r.close),'0',r.closeTime,'1000']));}
    throw new Error('UNEXPECTED '+m+' '+p);};
  const store={journal:(k,s,p)=>{events.push({k,s,p});},recordLearning:()=>{}};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store,scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),
    credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  return {root,state,events,controller,kinds:k=>events.filter(e=>e.k===k)};
}

test('R2544.67.5 config: 24 h falling condition is ON by default (also for an old zirve5.json); margin/leverage writes validate',()=>{
  assert.equal(Z.DEFAULT_CONFIG.requireFalling24h,true);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r675c-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({enabled:true,updatedAt:'2026-10-20T10:40:06.759Z'}));   // the file on the PC today
  assert.equal(Z.readConfig(root).requireFalling24h,true,'an old file without the key gets the safe default');
  assert.equal(Z.writeConfig(root,{requireFalling24h:false}).requireFalling24h,false);
  let c=Z.writeConfig(root,{marginQuote:20,leverage:5});assert.equal(c.marginQuote,20);assert.equal(c.leverage,5);
  c=Z.writeConfig(root,{marginQuote:'12,5'.replace(',','.')});assert.equal(c.marginQuote,12.5);
  assert.deepEqual(Z.writeConfig(root,{marginQuote:3}).reasons,['ZIRVE5_MARGIN_INVALID']);
  assert.deepEqual(Z.writeConfig(root,{leverage:25}).reasons,['ZIRVE5_LEVERAGE_INVALID']);
  assert.deepEqual(Z.writeConfig(root,{leverage:2.5}).reasons,['ZIRVE5_LEVERAGE_INVALID']);
  assert.equal(Z.readConfig(root).marginQuote,12.5,'a rejected write changes nothing');
  c=Z.writeConfig(root,{marginQuote:null,leverage:null});assert.equal(c.marginQuote,null,'null = back to risk-based');assert.equal(c.leverage,null);
  assert.equal(c.requireFalling24h,false,'other keys untouched');
});

test('R2544.67.5 a coin UP over 24 h is shown but not armed (no SHORT); switching the condition off arms it; unknown 24 h change is not armed',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture({change:'83'});
  await f.controller.testSupervisorTick();
  await f.controller.z5Tick();
  let st=f.controller.z5Status();
  assert.equal(st.switches.requireFalling24h,true);
  assert.equal(st.lastScan.top[0].zones.length,1,'the zone is still drawn/listed');
  assert.equal(st.lastScan.top[0].skip,'ZIRVE5_24H_NOT_FALLING');assert.equal(st.lastScan.top[0].change24,83);
  assert.equal(st.armed.length,0,'not armed');
  assert.equal(f.kinds('ZIRVE5_SCAN')[0].p.top[0].skip,'ZIRVE5_24H_NOT_FALLING','the scan record says why');
  f.state.now+=5000;f.state.px.Z5USDT={bid:99.76,ask:99.77};
  assert.equal((await f.controller.z5Tick()).entries,0,'equilibrium touched but no SHORT on a pumping coin');
  // condition off (Office) -> the last closed candle is rescanned on the next tick and the zone is armed
  const off=f.controller.configureZ5({requireFalling24h:false,source:'OFFICE'});
  assert.equal(off.ok,true);assert.equal(off.switches.requireFalling24h,false);
  f.state.px.Z5USDT={bid:95.9,ask:95.91};
  const r=await f.controller.z5Tick();assert.equal(r.scanned,true);
  st=f.controller.z5Status();assert.equal(st.armed.length,1);assert.equal(st.lastScan.top[0].skip,undefined);
  const ch=f.kinds('ZIRVE5_CONFIG_CHANGED').at(-1).p;assert.equal(ch.before.requireFalling24h,true);assert.equal(ch.after.requireFalling24h,false);
  // condition back on: armed zones dropped at once, rescan next tick
  f.controller.configureZ5({requireFalling24h:true});assert.equal(f.controller.z5Status().armed.length,0);
  // 24 h change missing in the ticker -> fail closed
  require('../binance-rate-limit').resetForTests();
  const g=fixture({change:null});await g.controller.testSupervisorTick();await g.controller.z5Tick();
  assert.equal(g.controller.z5Status().armed.length,0);
  // a FALLING coin is armed as before
  require('../binance-rate-limit').resetForTests();
  const h=fixture({change:'-15.8'});await h.controller.testSupervisorTick();await h.controller.z5Tick();
  assert.equal(h.controller.z5Status().armed.length,1);
});

test('R2544.67.5 ZİRVE-5 margin box: TEST any time, the entry uses exactly that margin; empty = risk-based; LIVE needs LIVE',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=fixture();
  await f.controller.testSupervisorTick();
  let st=f.controller.z5Status();assert.equal(st.sizing.automatic,true);assert.equal(st.sizing.ownLeverage,null);
  const s=f.controller.configureZ5({marginQuote:20,leverage:5,source:'OFFICE'});
  assert.equal(s.ok,true,JSON.stringify(s.reasons));assert.equal(s.sizing.marginQuote,20);assert.equal(s.sizing.automatic,false);assert.equal(s.sizing.leverage,5);assert.equal(s.sizing.ownLeverage,5);
  assert.equal(f.kinds('ZIRVE5_CONFIG_CHANGED').at(-1).p.after.marginQuote,20);
  assert.deepEqual(f.controller.configureZ5({marginQuote:2}).reasons,['ZIRVE5_MARGIN_INVALID']);
  await f.controller.z5Tick();f.state.now+=5000;f.state.px.Z5USDT={bid:99.76,ask:99.77};
  assert.equal((await f.controller.z5Tick()).entries,1,JSON.stringify(f.controller.z5Status().recentEntries));
  const a=Object.values(f.controller._testTop3State().active)[0];
  assert.equal(a.marginQuote,20,'the margin entered in Office, not İlk 3\'s 70');assert.ok(a.leverage<=5);
  // back to automatic
  const back=f.controller.configureZ5({marginQuote:null,leverage:null});assert.equal(back.sizing.automatic,true);assert.equal(back.sizing.leverage,10,'İlk 3 leverage when empty');
  // LIVE: a sizing change needs the explicit confirmation
  require('../binance-rate-limit').resetForTests();
  const L=fixture({mode:'LIVE'});
  assert.deepEqual(L.controller.configureZ5({marginQuote:20}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(Z.readConfig(L.root).marginQuote,null,'nothing written without confirmation');
  assert.equal(L.controller.configureZ5({marginQuote:20,confirm:'LIVE'}).ok,true);assert.equal(Z.readConfig(L.root).marginQuote,20);
  assert.equal(L.controller.configureZ5({requireFalling24h:false}).ok,true,'the condition is a filter, not an order: no confirmation needed');
});

test('R2544.67.5 wiring: core route and Office pass the new fields; the ZİRVE-5 card has the box, the save button and the condition switch',()=>{
  const {CONTROL_BODY}=require('../office-dashboard/office-server');
  const b=CONTROL_BODY['/api/control/zirve5'];
  assert.deepEqual(b({requireFalling24h:false,marginQuote:20,leverage:5,confirm:'live'}),{source:'OFFICE',requireFalling24h:false,marginQuote:20,leverage:5,confirm:'LIVE'});
  assert.deepEqual(b({marginQuote:null,leverage:null}),{source:'OFFICE',marginQuote:null,leverage:null});
  assert.deepEqual(b({marginQuote:'20',leverage:'x',requireFalling24h:'no',orders:[1]}),{source:'OFFICE'},'strings and unknown keys are dropped');
  const server=src('server.js');
  assert.match(server,/configureZ5\(\{enabled:body\?\.enabled,liveEnabled:body\?\.liveEnabled,jevMode:body\?\.jevMode,requireFalling24h:body\?\.requireFalling24h,\.\.\.own\('marginQuote'\),\.\.\.own\('leverage'\)/);
  const html=src('office-dashboard/public/office.html');
  for(const id of ['z5Margin','z5Lev','btnZ5Save','btnZ5Fall'])assert.match(html,new RegExp(`id="${id}"`),id);
  assert.match(html,/onClick\('#btnZ5Save'/);assert.match(html,/onClick\('#btnZ5Fall'/);
  assert.match(html,/24 sa yükselişte → SHORT yok/);
  assert.match(html,/Uyarı: ZİRVE-5 marjı/);
  assert.match(src('zirve5.js'),/ZIRVE5_VERSION = 'R2544\.67\.5-ZIRVE5-SHORT'/);
});
