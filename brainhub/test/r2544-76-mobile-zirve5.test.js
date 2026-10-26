'use strict';
// R2544.76 (user 23.10: "APK'yı da güncelle, canlıya geçtiğimizde sorun olmasın"). The phone reads /live/status?compact=1 and
// /live/positions?compact=1. It had no ZİRVE-5 at all (lanes, lots, size) and no kâr koruma state; a LIVE switch from the phone would
// take a selected ZİRVE-5 live without the phone showing it. PC side: the compact status carries ZİRVE-5 and the partial state.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {mobileStatus}=require('../mobile-status'),{mobilePositions}=require('../mobile-positions');
const z5={ok:true,version:'R2544.68-ZIRVE5-VIDEO',tradingMode:'LIVE',switches:{enabled:true,liveEnabled:true,jevMode:false,longEnabled:true,shortEnabled:true,partialEnabled:true,requireSweep:true},
  partial:{enabled:true,atR:2,share:0.5,beFee:0.0012},decisions:'RULE',gate:'OPEN',running:true,sizing:{marginQuote:30,leverage:10,automatic:false,riskPct:0.02},
  rules:{k:1.5,topN:5,volMult:1.5,bodyMin:0.3,minStopPct:0.002,maxStopPct:0.08,maxHoldH:24,windowBars:48},nextScanAt:'2026-10-23T10:45:08.000Z',
  armed:[{symbol:'ALTUSDT',zones:[{side:'SHORT'}]},{symbol:'PTBUSDT',zones:[]}],
  lastScan:{at:'2026-10-23T10:30:08Z',bar:'2026-10-23T10:15:00Z',signals:1,armed:7,errors:[],top:[{symbol:'PTBUSDT',rank:1,range24:1.3,zones:[{side:'SHORT',top:1,bottom:0.9}],signals:[{side:'SHORT',confirm:{body:0.8},mtf:{h1:'DOWN',h4:'RANGE',m5:5,against1h:false,against4h:false}}]}]},
  active:[{id:'z5x',symbol:'AKEUSDT',side:'SHORT',entryPrice:0.024155,stopPrice:0.024126,tpPrice:0.021035,stopPct:0.0197,targetR:6.5,markPrice:0.0218,unrealizedPnl:12.3,leverage:10,marginQuote:30,remainingMin:300,
    part:{atR:2,share:0.5,price:0.0232,qty:100,done:true,beDone:true,algoId:8000000001},mtf:{h1:'DOWN',h4:'UP',m5:null,against1h:false,against4h:true},why:'long text'}],
  recentEntries:[{at:'2026-10-23T08:30:18Z',symbol:'AGTUSDT',side:'LONG',opened:false,reason:'ZIRVE5_NO_SWEEP',rank:4,extra:'x'}],
  recentCloses:[{symbol:'IRYSUSDT'}],results:{test:{closed:3,wins:2,losses:1,netPnl:40,avgR:0.5},live:{closed:0,wins:0,losses:0,netPnl:0,avgR:null},all:{}},learning:{lessons:12}};
const top3={version:'v',tradingMode:'LIVE',switches:{enabled:true},active:[{symbol:'REZUSDT',side:'LONG',rule:'LONG_EARLY_RETEST',entryPrice:1,stopPrice:0.99,tpPrice:1.2,part:{atR:2,share:0.5,done:true,beDone:true,price:1.02,qty:5},entryFeatures:{big:'x'.repeat(5000)}}]};
test('R2544.76 compact status: ZİRVE-5 for the phone (switches, size, kâr koruma, lots with partial and multi-timeframe info, last scan, reasons, results) without dumps',()=>{
  const out=mobileStatus({run:{lanes:{zirve5:{selected:true,liveAllowed:true}}},top3,zirve5:z5});
  assert.equal(out.mobileContract,'R2544.78_PC_STATUS'); // R2544.78: + balance
  const z=out.zirve5;assert.equal(z.sizing.marginQuote,30);assert.equal(z.partial.atR,2);assert.equal(z.switches.liveEnabled,true);assert.equal(z.rules.bodyMin,0.3);
  assert.deepEqual(z.active[0].part,{atR:2,share:0.5,price:0.0232,done:true,beDone:true},'level, share, taken, rest at break-even (no order ids)');
  assert.equal(z.active[0].mtf.against4h,true);assert.equal(z.active[0].why,undefined,'no long text');
  assert.equal(z.lastScan.top[0].zones,1,'zone count, not the zones');assert.equal(z.lastScan.top[0].signals[0].mtf.h1,'DOWN');
  assert.deepEqual(z.recent[0],{at:'2026-10-23T08:30:18Z',symbol:'AGTUSDT',side:'LONG',opened:false,reason:'ZIRVE5_NO_SWEEP',rank:4});
  assert.equal(z.results.test.closed,3);assert.equal(z.armedCoins,2);
  assert.deepEqual(out.top3.active[0].part,{atR:2,share:0.5,price:1.02,done:true,beDone:true});assert.equal(out.top3.active[0].entryFeatures,undefined);
  assert.equal(out.run.lanes.zirve5.selected,true,'the lane switch state reaches the phone');
  assert.ok(Buffer.byteLength(JSON.stringify(out))<20000,'stays small for the phone');
});
test('R2544.76 compact positions: price R and the kâr koruma state reach the phone',()=>{
  const p=mobilePositions({ok:true,open:[{symbol:'AKEUSDT',side:'SHORT',unrealizedR:2.56,priceR:5.05,partialTaken:true,partAtR:2,partShare:0.5,openedBy:'BRAINHUB_ZIRVE5',entryCase:{big:1}}],closed:[]});
  assert.equal(p.open[0].priceR,5.05);assert.equal(p.open[0].partialTaken,true);assert.equal(p.open[0].partAtR,2);assert.equal(p.open[0].entryCase,undefined);
});
test('R2544.76 wiring: the core passes ZİRVE-5 to the phone status; ZİRVE-5 open lots carry their kâr koruma state (Office lot line too)',()=>{
  const s=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'),lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(s,/mobileStatus\(\{\.\.\.report,top3:live\.top3Status\(\),zirve5:live\.z5Status\(\),account\}\)/); // R2544.78: + balance
  assert.match(lc,/against4h:a\.entryFeatures\.mtf\.against4h===true\}:null,ind:[^\n]*?,part:a\.part\|\|null,beMoved:a\.beMoved===true/);
});
