'use strict';
// R2544.67.5 -> R2544.68 (user 21.10: "MARJ AYARINI İSTEDİĞİM ZAMAN TESTTE DEĞİŞTİREMİYORUM"; then "24 SAAT DÜŞMÜŞ COİNE SHORT MU AÇILIR"):
//  - ZİRVE-5 has its own margin / leverage box in Office: TEST any time, LIVE with the 'LIVE' confirmation; empty = risk-based.
//  - The 24 h falling condition of R2544.67.5 was wrong (it shorts a coin that has already fallen = chasing) and is removed:
//    no switch, no filter; a leftover key in zirve5.json is ignored and dropped on the next write.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {writeTradingMode}=require('../binance-live-transport');
const Z=require('../zirve5');
const src=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function root(z5=null,mode='TEST'){
  const r=fs.mkdtempSync(path.join(os.tmpdir(),'r675-'));fs.mkdirSync(path.join(r,'config'));
  fs.writeFileSync(path.join(r,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(r,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  fs.writeFileSync(path.join(r,'config','top3-hunter.json'),JSON.stringify({enabled:false,marginQuote:70,leverage:10}));
  if(z5)fs.writeFileSync(path.join(r,'config','zirve5.json'),JSON.stringify(z5));
  writeTradingMode(r,{mode,changedAt:'2026-10-21T08:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  return r;
}
const controller=(r,events=[])=>require('../live-controller').createLiveController({root:r,clock:()=>Date.UTC(2026,9,21,10,0),store:{journal:(k,s,p)=>events.push({k,p}),recordLearning:()=>{}},
  scanner:{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:{apiKey:'fake-r675',apiSecret:'fake-r675'},fetchImpl:async()=>{throw new Error('NO_NETWORK_IN_TEST');},
  paperAutoTick:false,defaultTradingMode:'TEST',market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});

test('R2544.68 config: margin/leverage writes validate; the removed 24 h condition is ignored and dropped from an old file',()=>{
  const r=root({enabled:true,requireFalling24h:true,updatedAt:'2026-10-21T07:00:00.000Z'});
  const c0=Z.readConfig(r);assert.equal('requireFalling24h' in c0,false,'no such setting any more');
  assert.equal(c0.longEnabled,true);assert.equal(c0.shortEnabled,true,'both sides on by default');
  let c=Z.writeConfig(r,{marginQuote:20,leverage:5});assert.equal(c.marginQuote,20);assert.equal(c.leverage,5);
  assert.equal(JSON.parse(fs.readFileSync(Z.configFile(r),'utf8')).requireFalling24h,undefined,'leftover key dropped on write');
  c=Z.writeConfig(r,{marginQuote:'12.5'});assert.equal(c.marginQuote,12.5);
  assert.deepEqual(Z.writeConfig(r,{marginQuote:3}).reasons,['ZIRVE5_MARGIN_INVALID']);
  assert.deepEqual(Z.writeConfig(r,{leverage:25}).reasons,['ZIRVE5_LEVERAGE_INVALID']);
  assert.deepEqual(Z.writeConfig(r,{leverage:2.5}).reasons,['ZIRVE5_LEVERAGE_INVALID']);
  assert.equal(Z.readConfig(r).marginQuote,12.5,'a rejected write changes nothing');
  c=Z.writeConfig(r,{marginQuote:null,leverage:null});assert.equal(c.marginQuote,null,'null = back to risk-based');assert.equal(c.leverage,null);
  assert.ok(!/requireFalling24h/.test(src('live-controller.js')),'no 24 h filter in the lane');
});

test('R2544.68 margin box through the controller: TEST any time; LIVE needs LIVE; status shows own/automatic sizing',()=>{
  require('../binance-rate-limit').resetForTests();
  const ev=[],c=controller(root(),ev);
  let st=c.z5Status();assert.equal(st.sizing.automatic,true);assert.equal(st.sizing.ownLeverage,null);assert.equal(st.sizing.leverage,10,'İlk 3 leverage when empty');
  const s=c.configureZ5({marginQuote:20,leverage:5,source:'OFFICE'});
  assert.equal(s.ok,true,JSON.stringify(s.reasons));assert.equal(s.sizing.marginQuote,20);assert.equal(s.sizing.automatic,false);assert.equal(s.sizing.ownLeverage,5);
  assert.equal(ev.filter(e=>e.k==='ZIRVE5_CONFIG_CHANGED').at(-1).p.after.marginQuote,20);
  assert.deepEqual(c.configureZ5({marginQuote:2}).reasons,['ZIRVE5_MARGIN_INVALID']);
  assert.equal(c.configureZ5({marginQuote:null,leverage:null}).sizing.automatic,true);
  require('../binance-rate-limit').resetForTests();
  const L=root(null,'LIVE'),lc=controller(L);
  assert.deepEqual(lc.configureZ5({marginQuote:20}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(Z.readConfig(L).marginQuote,null,'nothing written without confirmation');
  assert.equal(lc.configureZ5({marginQuote:20,confirm:'LIVE'}).ok,true);assert.equal(Z.readConfig(L).marginQuote,20);
});

test('R2544.68 wiring: core route and Office pass margin/leverage and the side switches; the ZİRVE-5 card has the box and the save button',()=>{
  const {CONTROL_BODY}=require('../office-dashboard/office-server');
  const b=CONTROL_BODY['/api/control/zirve5'];
  assert.deepEqual(b({marginQuote:20,leverage:5,confirm:'live'}),{source:'OFFICE',marginQuote:20,leverage:5,confirm:'LIVE'});
  assert.deepEqual(b({marginQuote:null,leverage:null}),{source:'OFFICE',marginQuote:null,leverage:null});
  assert.deepEqual(b({marginQuote:'20',leverage:'x',longEnabled:'no',orders:[1]}),{source:'OFFICE'},'strings and unknown keys are dropped');
  assert.match(src('server.js'),/configureZ5\(\{enabled:body\?\.enabled,liveEnabled:body\?\.liveEnabled,jevMode:body\?\.jevMode,longEnabled:body\?\.longEnabled,shortEnabled:body\?\.shortEnabled,partialEnabled:body\?\.partialEnabled,requireSweep:body\?\.requireSweep,\.\.\.own\('marginQuote'\),\.\.\.own\('leverage'\)/);
  const html=src('office-dashboard/public/office.html');
  for(const id of ['z5Margin','z5Lev','btnZ5Save'])assert.match(html,new RegExp(`id="${id}"`),id);
  assert.match(html,/onClick\('#btnZ5Save'/);assert.match(html,/Uyarı: ZİRVE-5 marjı/);
  assert.match(src('zirve5.js'),/ZIRVE5_VERSION = 'R2544\.68-ZIRVE5-VIDEO'/);
});
