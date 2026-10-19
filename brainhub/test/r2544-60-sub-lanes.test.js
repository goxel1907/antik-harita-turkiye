'use strict';
// R2544.60 sub-lanes (user 19.10: "oto live a geçilmeden hangi hattın çalışacağı seçilmeli, ister 1 hat ister 3 hat";
// "test te bunların hepsinin test edilmesi öğrenilmesi gerekiyor"). Fixture copied from r2544-57-lanes.test.js.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readTradingMode,writeTradingMode}=require('../binance-live-transport');
const T3=require('../top3-hunter');

const FAKE={apiKey:'fake-test-key-r57',apiSecret:'fake-test-secret-r57'}; // made-up, never real
const ok=body=>({ok:true,status:200,async text(){return JSON.stringify(body);}});
function fixture({mode='TEST',lanes=undefined,top3=null,realAvail=250,scanner=null}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r57-'));fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','live-policy.json'),JSON.stringify({armMinutes:1440,expectedLeverage:5,maxEntryDeviationPct:1,limits:{maxRiskPctPerTrade:1,maxNotionalPctPerTrade:20,maxDailyLossPct:100,maxOpenPositions:3,maxFamilyExposurePct:40},apiPermissions:{configured:true,futuresEnabled:true,withdrawalsEnabled:false,ipRestricted:true}}));
  fs.writeFileSync(path.join(root,'config','leader-auto.json'),JSON.stringify({enabled:false,marginQuote:32,leverage:10,maxOpenPositions:1,allowLong:true,allowShort:true}));
  if(lanes!==undefined)fs.writeFileSync(path.join(root,'config','lane-selection.json'),JSON.stringify(lanes));
  if(top3)fs.writeFileSync(path.join(root,'config','top3-hunter.json'),JSON.stringify(top3));
  writeTradingMode(root,{mode,changedAt:'2026-10-13T10:00:00.000Z',testStartedAt:null,testAutoRun:mode==='TEST'});
  const state={now:1791370000000,realAvail,realWallet:realAvail,realPositions:[],calls:[]},events=[];
  const fetchImpl=async(url,o={})=>{const u=new URL(url),p=u.pathname,m=o.method||'GET';state.calls.push(`${m} ${p}`);
    if(p==='/fapi/v1/time')return ok({serverTime:state.now});
    if(p==='/fapi/v1/ticker/bookTicker')return ok({symbol:u.searchParams.get('symbol'),bidPrice:'10',askPrice:'10.01'});
    if(p==='/fapi/v3/account')return ok({availableBalance:String(state.realAvail),totalWalletBalance:String(state.realWallet),positions:[]});
    if(p==='/fapi/v3/positionRisk')return ok(state.realPositions);
    if(p==='/fapi/v1/positionSide/dual')return ok({dualSidePosition:false});
    if(p==='/fapi/v1/income')return ok([]);
    throw new Error('UNEXPECTED '+m+' '+p);};
  const controller=require('../live-controller').createLiveController({root,clock:()=>state.now,store:{journal:(k,s,p)=>events.push({k,s,p})},
    scanner:scanner||{scan:async()=>({})},pipeline:{},committee:async()=>({}),credentials:FAKE,fetchImpl,paperAutoTick:false,defaultTradingMode:'TEST',
    market:{marketStream:{snapshot:()=>({available:false}),ensureSymbol(){}}}});
  const oto=()=>JSON.parse(fs.readFileSync(path.join(root,'config','leader-auto.json'),'utf8')).enabled;
  const t3=()=>T3.readTop3Config(root);
  const settle=async(until,n=8)=>{for(let i=0;i<n&&!until();i++){state.now+=5000;await controller.testSupervisorTick();}};
  return {root,state,events,controller,oto,t3,settle,kinds:k=>events.filter(e=>e.k===k)};
}

test('R2544.60 sub-lanes default ON (old files, TEST tests everything); the OTO switch keeps the sub-lane choice',async()=>{
  const f=fixture({lanes:{normal:true},top3:{enabled:true}});
  await f.controller.testSupervisorTick();
  const sub=f.controller.laneStatus().normal.sub;
  assert.deepEqual([sub.scalp5m.selected,sub.trade15m.selected,sub.burst.selected],[true,true,true]);
  assert.equal(f.controller.selectLanes({trade15m:false}).ok,true);
  const file=()=>JSON.parse(fs.readFileSync(path.join(f.root,'config','lane-selection.json'),'utf8'));
  assert.equal(file().trade15m,false);assert.equal(file().normal,true,'normal kept');
  assert.equal(f.controller.selectLanes({normal:false}).ok,true);assert.equal(file().trade15m,false,'normal switch keeps sub-lanes');
  assert.equal(f.controller.selectLanes({normal:true}).ok,true);
  assert.equal(f.controller.laneStatus().normal.sub.trade15m.selected,false);
  assert.equal(f.controller.laneStatus().normal.sub.scalp5m.selected,true);
});

test('R2544.60 sub-lane gate: only the chosen lanes open; unknown lane / fast lane fail closed',()=>{
  const f=fixture({lanes:{normal:true}});
  const g=f.controller._testSubLaneGate;
  assert.equal(g({lane:'SCALP_MOMENTUM'}).ok,true);assert.equal(g({lane:'WHATEVER'}).ok,true,'all on: nothing filtered (old behaviour)');
  f.controller.selectLanes({scalp5m:false});
  assert.deepEqual(g({lane:'SCALP_MOMENTUM'}),{ok:false,desk:'5M_SCALP',reason:'LANE_NOT_SELECTED_5M_SCALP'});
  assert.equal(g({lane:'5M_SCALP'}).ok,false);
  assert.equal(g({lane:'MAIN_15M'}).ok,true);assert.equal(g({tradeLaneName:'15M_TRADE'}).ok,true);
  assert.equal(g({lane:''},true).reason,'LANE_NOT_SELECTED_5M_SCALP','fast lane = 5M scalp');
  assert.equal(g({lane:'WHATEVER'}).reason,'LANE_UNKNOWN_SUB_LANE_OFF');
  f.controller.selectLanes({scalp5m:true,trade15m:false});
  assert.equal(g({lane:'MAIN_15M'}).reason,'LANE_NOT_SELECTED_15M_TRADE');assert.equal(g({lane:'SCALP_MOMENTUM'}).ok,true);
});

test('R2544.60 LIVE: a sub-lane ON needs confirm LIVE, OFF is immediate; GO_LIVE needs an effective lane',async()=>{
  const h=fixture({mode:'LIVE',lanes:{normal:true,scalp5m:false,trade15m:false,burst:true},top3:{enabled:false}});
  assert.deepEqual((await h.controller.runControl({action:'GO_LIVE'})).reasons,['LANES_NONE_SELECTED'],'normal with only burst (TEST-only in LIVE) is no lane');
  assert.deepEqual(h.controller.selectLanes({trade15m:true}).reasons,['EXPLICIT_LIVE_CONFIRMATION_REQUIRED']);
  assert.equal(h.controller.selectLanes({trade15m:true,confirm:'LIVE'}).ok,true);
  assert.equal((await h.controller.runControl({action:'GO_LIVE'})).ok,true);
  assert.equal(h.controller.selectLanes({trade15m:false}).ok,true,'off needs no confirmation');
  assert.equal(h.controller.laneStatus().normal.sub.trade15m.selected,false);
  assert.equal(h.controller.laneStatus().normal.sub.burst.active,false,'burst stays off in LIVE without burstLiveEnabled');
});

test('R2544.60 wiring: gate before the chase guard in the leader execution, burst checks, routes and Office buttons',()=>{
  const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  const lc=src('live-controller.js');
  const i=lc.indexOf('async function executeLeaderExclusive'),g=lc.indexOf('R2544.60_SUB_LANE_GATE',i),c=lc.indexOf('R45 LOCATION_CHASE_GUARD',i),o=lc.indexOf('placeOrder',g);
  assert.ok(i>0&&g>i&&c>g,'gate inside the leader execution, before the chase guard');
  assert.match(lc.slice(lc.indexOf('async function burstArmTick'),lc.indexOf('async function burstArmTick')+1600),/BURST_LANE_NOT_SELECTED/);
  assert.match(lc.slice(lc.indexOf('async function burstOpen'),lc.indexOf('async function burstOpen')+400),/BURST_LANE_NOT_SELECTED/);
  assert.match(src('server.js'),/scalp5m:body\?\.scalp5m,trade15m:body\?\.trade15m,burst:body\?\.burst/);
  assert.match(src('office-dashboard/office-server.js'),/\['normal', 'top3', 'scalp5m', 'trade15m', 'burst'\]/);
  const html=src('office-dashboard/public/office.html');
  for(const id of ['btnLaneScalp','btnLane15m','btnLaneBurst'])assert.ok(html.includes(`id="${id}"`)&&html.includes(`onClick('#${id}'`),id);
  assert.ok(!/confirm\(|prompt\(/.test(html.slice(html.indexOf('function laneToggle'),html.indexOf('function laneToggle')+800)),'no browser dialogs');
  void o;
});
