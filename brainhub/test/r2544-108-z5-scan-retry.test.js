'use strict';
// R2544.108 (kullanıcı 02.11: "hiç işleme giremedi, darboğaz ya da görmediğin bir hata mı var"): ZİRVE-5 taraması 24 saatlik
// listeyi (/ticker/24hr) alamayınca mumu "tarandı" sayıyordu, o mum bir daha denenmiyordu (25.10: 96 taramanın 73'ü boş, 02.11: 2 boş).
// Artık liste gelmezse mum kullanılmış sayılmaz: kapanıştan sonraki 3 dakika içinde 20 sn arayla yeniden denenir.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {writeTradingMode}=require('../binance-live-transport');
const M15=15*60000;
const FAKE={apiKey:'fake-test-key-r108',apiSecret:'fake-test-secret-r108'}; // uydurma, gerçek değil
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function setup(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r108-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify({enabled:false}));
  fs.writeFileSync(path.join(root,'config','zirve5.json'),JSON.stringify({enabled:true,requireSweep:false}));
  writeTradingMode(root,{mode:'TEST',changedAt:'2026-10-20T08:00:00.000Z',testStartedAt:null,testAutoRun:true});
  const bar=Date.UTC(2026,10,2,10,0),state={now:bar+M15+10000,fail:1,tick:0},events=[];
  const fetchImpl=async url=>{const p=new URL(url).pathname;
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/exchangeInfo')return ok({symbols:[]});
    if(p==='/fapi/v1/ticker/24hr'){state.tick++;if(state.fail-->0)throw new Error('fetch failed');return ok([]);}
    throw new Error('UNEXPECTED '+p);};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k,s,p)=>events.push({k,s,p}),recordLearning:()=>{}},
    scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  return {state,events,controller,bar};
}

test('R2544.108 ZİRVE-5: 24 sa listesi gelmezse mum kullanılmış sayılmaz, 20 sn sonra aynı mum yeniden taranır',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=setup();
  const r1=await f.controller.z5Tick();assert.equal(r1.scanned,true);
  assert.ok(f.controller.z5Status().lastScan.errors.includes('TICKER_24HR'));
  f.state.now+=5000;assert.equal((await f.controller.z5Tick()).scanned,false,'20 sn dolmadan yeniden denemez (borsayı dövmez)');
  f.state.now+=16000;const r3=await f.controller.z5Tick();assert.equal(r3.scanned,true,'aynı mum yeniden tarandı');
  assert.ok(!f.controller.z5Status().lastScan.errors.includes('TICKER_24HR'));assert.equal(f.state.tick,2);
  f.state.now+=30000;assert.equal((await f.controller.z5Tick()).scanned,false,'başarılı taramadan sonra mum bitti');
  const scans=f.events.filter(e=>e.k==='ZIRVE5_SCAN');assert.equal(scans.length,2);assert.equal(scans[0].p.bar,scans[1].p.bar);
});

test('R2544.108 ZİRVE-5: 3 dakikadan sonra yeniden deneme yok (onay mumu bayatlar, kovalama yok)',async()=>{
  require('../binance-rate-limit').resetForTests();
  const f=setup();f.state.fail=100;f.state.now=f.bar+M15+170000;
  assert.equal((await f.controller.z5Tick()).scanned,true);
  f.state.now+=25000;assert.equal((await f.controller.z5Tick()).scanned,false,'kapanıştan 3 dk sonra mum bırakılır');
  assert.equal(f.state.tick,1);
});

test('R2544.108 kaynak: yeniden deneme yalnız TICKER_24HR için, süre ve aralık sabit',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.ok(src.includes("r.errors.includes('TICKER_24HR')&&clock()-(bar+z5Lib.M15)<180000"));
  assert.ok(src.includes('z.retryAt=clock()+20000'));
});
