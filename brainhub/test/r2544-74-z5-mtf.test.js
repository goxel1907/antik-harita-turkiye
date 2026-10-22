'use strict';
// R2544.74 (user 22.10: "alt ve üst zaman dilimlerindeki grafik yapısını takip ediyor mu?" -> measured: 5m early entry worse, 1h/4h
// structure filters inconsistent -> "evet yap": record them as INFORMATION on every ZİRVE-5 signal / lot (brain, JEV, Office), never a
// rule). The math equals the measurement (harness/zirve5/z5_mtf_parity.js: 1h/4h 234/234, 5m 216/216 on the month).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Z=require('../zirve5');const {writeTradingMode}=require('../binance-live-transport');
const H1=3600000,M5=300000,M15=900000;
// a zig-zag with rising (or falling) swings: 1h candles
function zig(n,up,t0=Date.UTC(2026,9,1)){const out=[];let p=100;for(let i=0;i<n;i++){const leg=Math.floor(i/6)%2===0,step=(leg?1:-0.6)*(up?1:-1);p+=step;out.push({openTime:t0+i*H1,open:p-step,high:Math.max(p,p-step)+0.1,low:Math.min(p,p-step)-0.1,close:p,quoteVolume:1000});}return out;}
test('R2544.74 structure: rising swings = UP, falling = DOWN; only candles closed before t; 4h is built from 1h',()=>{
  const up=zig(120,true),dn=zig(120,false),t=up.at(-1).openTime+H1;
  assert.equal(Z.htfStructure(up,t,H1).trend,'UP');assert.equal(Z.htfStructure(dn,t,H1).trend,'DOWN');
  assert.equal(Z.htfStructure(up.slice(0,20),t,H1).trend,null,'too little history = unknown, never a guess');
  const cut=Z.htfStructure(up,up[60].openTime,H1);assert.equal(cut.candles,60,'a candle still forming at t is not used');
  const h4=Z.aggregate(up,4*H1);assert.equal(h4.length,30);assert.equal(h4[0].high,Math.max(...up.slice(0,4).map(c=>c.high)));
});
test('R2544.74 5m confirmation inside the 15m candle: the first strong, volume-backed 5m close inside the zone; none when absent',()=>{
  const bar=Date.UTC(2026,9,22,8,15),k=[];for(let i=300;i>0;i--)k.push({openTime:bar-i*M5,open:100,high:100.2,low:99.8,close:100,quoteVolume:1000});
  const zone={side:'SHORT',top:100.5,bottom:99.5};
  k.push({openTime:bar,open:100.3,high:100.6,low:100.0,close:100.1,quoteVolume:900});        // weak volume: no
  k.push({openTime:bar+M5,open:100.4,high:100.45,low:99.9,close:99.95,quoteVolume:2000});    // strong bear, 2x volume, inside: yes
  const r=Z.m5Confirm(k,bar,zone);assert.equal(r.confirmed,true);assert.equal(r.minutesEarly,5);assert.equal(r.price,99.95);
  k[k.length-1].quoteVolume=1200;assert.equal(Z.m5Confirm(k,bar,zone).confirmed,false);
  const info=Z.mtfInfo({h1:zig(120,true,bar-120*H1),k5:k,barOpen:bar,zone});
  assert.equal(info.h1.trend,'UP');assert.equal(info.against1h,true,'a SHORT against a rising 1h structure is flagged');assert.equal(info.informationOnly,true);
});
// controller: the ZİRVE-5 lot carries the mtf record; it never blocks an entry (information only)
function series(points,lastOpen,qv=1000){const out=[];for(let s=1;s<points.length;s++){const a=points[s-1],b=points[s];for(let i=1;i<=8;i++){const p=a+(b-a)*(i-1)/8,c=a+(b-a)*i/8;out.push([p,c]);}}
  const t0=lastOpen-(out.length-1)*M15;return out.map(([o,c],i)=>({openTime:t0+i*M15,closeTime:t0+(i+1)*M15-1,open:o,close:c,high:Math.max(o,c)+0.05,low:Math.min(o,c)-0.05,quoteVolume:qv}));}
function sweepScenario(lastOpen){const P=[100,100,100,100,100,100,100,103,98,101.5,96,92,99.4];const extra=[[99.4,99.3,99.35,99.25],[99.3,99.1,99.32,99.05],[99.1,99.0,99.12,98.95]],conf=[99.2,98.55,99.6,98.5];
  const c=series(P,lastOpen-(extra.length+1)*M15);let t=c.at(-1).openTime;for(const [o,cl,h,l] of [...extra,conf]){t+=M15;c.push({openTime:t,closeTime:t+M15-1,open:o,close:cl,high:h,low:l,quoteVolume:1000});}c.at(-1).quoteVolume=5000;return c;}
test('R2544.74 controller: every ZİRVE-5 signal and lot carries 1h/4h/5m information; the scan journal records it; entries are unchanged',async()=>{
  require('../binance-rate-limit').resetForTests();
  const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r74-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({enabled:true}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-22T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const bar=Date.UTC(2026,9,22,10,0),k=sweepScenario(bar),c0=k.at(-1).close,state={now:bar+M15+10000,px:{Z5USDT:{bid:c0,ask:c0+0.01}}},asked=[];
  const h1=zig(240,false,bar-240*H1);   // a falling 1h structure: with the SHORT
  const sym=s=>({symbol:s,contractType:'PERPETUAL',status:'TRADING',quoteAsset:'USDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'10000000'},{filterType:'MIN_NOTIONAL',notional:'5'}]});
  const fetchImpl=async(url)=>{const u=new URL(url),p=u.pathname;
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker'){const s=u.searchParams.get('symbol'),x=state.px[s]||{bid:10,ask:10.01};return ok({symbol:s,bidPrice:String(x.bid),askPrice:String(x.ask)});}
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:['Z5USDT','BTCUSDT'].map(sym)});
    if(p==='/fapi/v1/ticker/24hr')return ok([{symbol:'Z5USDT',highPrice:'110',lowPrice:'90',lastPrice:'99',quoteVolume:'50000000',priceChangePercent:'-1'}]);
    if(p==='/fapi/v1/leverageBracket')return ok([{symbol:u.searchParams.get('symbol'),brackets:[{bracket:1,initialLeverage:50,notionalCap:1000000,notionalFloor:0}]}]);
    if(p==='/fapi/v1/klines'){const iv=u.searchParams.get('interval');asked.push(iv);const rows=iv==='1h'?h1:k;return ok(rows.map(r=>[r.openTime,String(r.open),String(r.high),String(r.low),String(r.close),'0',r.openTime+(iv==='1h'?H1:M15)-1,String(r.quoteVolume)]));}
    throw new Error('UNEXPECTED '+p);};
  const events=[],learned=[];
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k2,s,p)=>events.push({k:k2,s,p}),recordLearning:(k2,s,p)=>learned.push({k:k2,s,p})},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:{apiKey:'fake-r74',apiSecret:'fake-r74'},fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  await controller.testSupervisorTick();
  assert.equal((await controller.z5Tick()).entries,1,'information only: the entry is not changed');
  assert.ok(asked.includes('1h')&&asked.includes('5m'),'1h and 5m read for the signal: '+asked.join(','));
  const lot=Object.values(controller._testTop3State().active)[0],m=lot.entryFeatures.mtf;
  assert.equal(m.version,'R2544.74-Z5-MTF');assert.equal(m.informationOnly,true);assert.equal(m.h1.trend,'DOWN');assert.equal(m.against1h,false);assert.ok(m.m5&&typeof m.m5.confirmed==='boolean');
  assert.equal(learned.find(x=>x.k==='ZIRVE5_OPENED').p.entryFeatures.mtf.h1.trend,'DOWN','the brain gets it');
  assert.equal(controller.z5Status().active[0].mtf.h1,'DOWN','Office gets it');
  const scan=controller.z5Status().lastScan||{};const sig=(scan.top||[]).flatMap(r=>r.signals||[])[0];assert.equal(sig.mtf.h1,'DOWN','the scan record has it (every signal, entered or not)');
  const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(html,/bilgi \(kural değil\): 1 sa /);assert.match(html,/function mtfTr\(t\)/);assert.ok(!html.includes("' (1R) hedef emrinde'"),'pending partial shows its own level');
});
test('R2544.74 JEV-on: the ZİRVE-5 gate record carries the multi-timeframe information (marked information only) and stays under 48 kB with the real packet',async()=>{
  const {createJevClient}=require('../jev-decision');const packet=require('./fixtures/r42-carv-r41-packet.json').packet;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r74-jev-'));fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config','jev.json'),JSON.stringify({enabled:true,dailyCapUsd:2}));
  let sent=null;const reply=b=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(b)});
  const c=createJevClient({root,apiKey:'sk-or-v1-fake',clock:()=>Date.UTC(2026,9,22,10,20),fetchImpl:async(_,o)=>{sent=o.body;return reply({answers:{zirve5_decision:{choice:'APPROVE_ENTRY'},zirve5_reason:{choice:'WEAK_RETEST'}},usage:{cost:0}});}});
  const bar=Date.UTC(2026,9,22,10,0),k=[];for(let i=300;i>0;i--)k.push({openTime:bar-i*M5,open:100,high:100.2,low:99.8,close:100,quoteVolume:1000});
  const mtf=Z.mtfInfo({h1:zig(240,true,bar-240*H1),k5:k,barOpen:bar,zone:{side:'SHORT',top:100.5,bottom:99.5}});
  const chart={available:true,symbol:packet.symbol,packet,asOf:bar,ageMs:1000,source:'TEST'};
  await c.sovereignZirve5Gate({symbol:packet.symbol,signal:{ok:true,side:'SHORT',rule:'ZIRVE5_FIBO_SHORT',zone:{top:100.5,bottom:99.5,equilibrium:100,liquidity:96,confirmAt:bar+M15}},
    features:{ok:true,rank:2,range24:0.5,change24:-3,confirmClose:99.6,confirmBody:0.8,confirmVolMult:3,mtf},candle:bar,chartContext:chart});
  assert.ok(sent&&Buffer.byteLength(sent)<=48000);const r=JSON.parse(sent).state.record.multiTimeframe;
  assert.equal(r.h1.trend,'UP');assert.equal(r.against1h,true);assert.match(r.note,/information only/);
});
