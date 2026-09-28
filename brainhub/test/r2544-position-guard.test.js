'use strict';
// CLAUDE_R2544 (Claude Work, 2026-09-28): risk tavanı kaldırıldı → açık pozisyon koruması + tutarlı likidasyon.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const G=require('../position-guard');
const L=require('../liquidation');
const {buildLeaderLiveIntent}=require('../leader-live-intent');

const base=(o={})=>({row:{symbol:'ABCUSDT',side:'LONG',entryPrice:100,originalStopPrice:98,currentStop:98,originTF:'5m',createdAt:0,...(o.row||{})},
  snap:{qty:10,entryPrice:100,markPrice:100,tickSize:0.01,...(o.snap||{})},phase:o.phase||'INITIAL',now:o.now??60000,config:{...G.DEFAULTS,...(o.config||{})}});

test('liquidation model: isolated formula, long/short symmetric, stop-before-liq check',()=>{
  const l=L.estimateLiquidation({side:'LONG',entryPrice:100,leverage:12,maintenanceMarginRate:0.005});
  const s=L.estimateLiquidation({side:'SHORT',entryPrice:100,leverage:12,maintenanceMarginRate:0.005});
  assert.ok(Math.abs(l.price-92.1273)<0.001); assert.ok(Math.abs(s.price-107.7944)<0.001);
  assert.ok(Math.abs(l.distancePct-s.distancePct)<0.1,'yaklaşık simetrik');
  assert.equal(L.stopVsLiquidation({side:'SHORT',entryPrice:100,stopPrice:107,liquidationPrice:s.price}).ok,true);
  assert.equal(L.stopVsLiquidation({side:'SHORT',entryPrice:100,stopPrice:107.6,liquidationPrice:s.price}).reason,'STOP_BEYOND_LIQUIDATION');
  assert.equal(L.stopVsLiquidation({side:'LONG',entryPrice:100,stopPrice:92.5,liquidationPrice:l.price}).reason,'STOP_BEYOND_LIQUIDATION');
  assert.equal(L.effectiveLiquidationPrice({exchangeLiquidationPrice:'91.5',estimate:l}).source,'BINANCE_POSITION_RISK');
  assert.equal(L.effectiveLiquidationPrice({exchangeLiquidationPrice:'0',estimate:l}).source,'ESTIMATE_ISOLATED');
});

test('intent: risk tavanı verilmezse (panel modu) büyük yapısal stop engellenmez; likidasyon kapısı aynı modeli kullanır',()=>{
  const filters={tickSize:0.0001,lotStep:1,minQty:1,maxQty:1e7,minNotional:5};
  const mk=stop=>buildLeaderLiveIntent({candidate:{symbol:'JOEUSDT',side:'SHORT'},
    unified:{symbol:'JOEUSDT',livePrice:0.0365,frames:{'5m':{available:true,fresh:true,atrPct:0.64}}},
    plan:{jevSovereign:true,status:'QUALIFIED',side:'SHORT',originTF:'5m',ownerTF:'5m',entryPrice:0.0365,stopPrice:stop,invalidationPrice:stop,
      takeProfit1:0.0355,takeProfit2:0.0345,takeProfit3:0.0335},
    marginQuote:40,leverage:12,filters,entryReferencePrice:0.0365,jevFinalAuthority:true,maintenanceMarginRate:0.01});
  const ok=mk(0.0376);   // %3 stop
  assert.equal(ok.reasons.includes('TRADE_RISK_CAP_EXCEEDED'),false);
  assert.equal(ok.reasons.includes('STOP_BEYOND_LIQUIDATION'),false,JSON.stringify(ok.reasons));
  assert.ok(ok.estimatedLiquidationPrice>0.0376);
  const bad=mk(0.0395);  // %8.2 stop, 12x likidasyon ~%7.3
  assert.ok(bad.reasons.includes('STOP_BEYOND_LIQUIDATION'));
  assert.equal(bad.reasons.includes('TRADE_RISK_CAP_EXCEEDED'),false);
});

test('guard: no action on a healthy fresh scalp',()=>{
  const r=G.evaluateGuard(base({snap:{markPrice:100.4}}));
  assert.equal(r.action,'NONE');
});

test('guard scalp: breakeven after +0.7R, profit lock after +1.2R, never widens',()=>{
  let r=G.evaluateGuard(base({snap:{markPrice:101.5}}));
  assert.equal(r.action,'TIGHTEN_STOP'); assert.equal(r.reason,'GUARD_SCALP_BREAKEVEN'); assert.ok(r.target>100&&r.target<100.2);
  r=G.evaluateGuard(base({snap:{markPrice:102.5}}));
  assert.equal(r.reason,'GUARD_SCALP_PROFIT_LOCK'); assert.equal(r.target,101);
  r=G.evaluateGuard(base({row:{currentStop:101.2},snap:{markPrice:102.5}}));
  assert.equal(r.action,'NONE','mevcut stop daha sıkıysa geri çekilmez');
});

test('guard scalp: fast-fail tightens early loss; crossed level closes; time stop closes a dead scalp',()=>{
  let r=G.evaluateGuard(base({snap:{markPrice:98.7},now:5*60000}));
  assert.equal(r.reason,'GUARD_SCALP_FAST_FAIL'); assert.equal(r.target,98.4);
  r=G.evaluateGuard(base({snap:{markPrice:98.35},now:5*60000}));
  assert.equal(r.action,'CLOSE'); assert.equal(r.reason,'GUARD_SCALP_FAST_FAIL_LEVEL_ALREADY_CROSSED');
  r=G.evaluateGuard(base({snap:{markPrice:99.9},now:26*60000}));
  assert.equal(r.action,'CLOSE'); assert.equal(r.reason,'GUARD_SCALP_TIME_STOP');
  r=G.evaluateGuard(base({row:{guardMfeR:0.5},snap:{markPrice:99.9},now:26*60000}));
  assert.equal(r.action,'NONE','ilerleme göstermiş scalp zaman stopu yemez');
});

test('guard SHORT symmetric',()=>{
  const r=G.evaluateGuard(base({row:{side:'SHORT',originalStopPrice:102,currentStop:102},snap:{markPrice:98.5}}));
  assert.equal(r.reason,'GUARD_SCALP_BREAKEVEN'); assert.ok(r.target<100&&r.target>99.8);
});

test('guard trade lane: breakeven at 1R, long time stop only when losing',()=>{
  const row={originTF:'15m',originalStopPrice:95,currentStop:95};
  let r=G.evaluateGuard(base({row,snap:{markPrice:104}}));
  assert.equal(r.action,'NONE');
  r=G.evaluateGuard(base({row,snap:{markPrice:105.1}}));
  assert.equal(r.reason,'GUARD_TRADE_BREAKEVEN');
  r=G.evaluateGuard(base({row,snap:{markPrice:99.5},now:181*60000}));
  assert.equal(r.reason,'GUARD_TRADE_TIME_STOP');
});

test('guard liquidation: stop beyond Binance liquidation is tightened; proximity closes; works after TP1 too',()=>{
  let r=G.evaluateGuard(base({row:{originTF:'15m',originalStopPrice:90,currentStop:90},snap:{markPrice:99,liquidationPrice:92}}));
  assert.equal(r.reason,'GUARD_STOP_NEAR_LIQUIDATION'); assert.ok(r.target>92&&r.target<99); assert.equal(r.metrics.liquidationSource,'BINANCE_POSITION_RISK');
  r=G.evaluateGuard(base({row:{originTF:'15m',originalStopPrice:90,currentStop:90},snap:{markPrice:92.5,liquidationPrice:92}}));
  assert.equal(r.action,'CLOSE'); assert.equal(r.reason,'GUARD_LIQUIDATION_PROXIMITY');
  r=G.evaluateGuard(base({phase:'TRAILING',row:{originTF:'15m',originalStopPrice:90,currentStop:90},snap:{markPrice:99,liquidationPrice:92}}));
  assert.equal(r.reason,'GUARD_STOP_NEAR_LIQUIDATION');
  r=G.evaluateGuard(base({row:{originTF:'15m',originalStopPrice:95,currentStop:95},snap:{markPrice:99,liquidationPrice:0},estimatedLiquidationPrice:null}));
  assert.equal(r.action,'NONE','likidasyon bilinmiyorsa uydurma eylem yok');
});

test('guard config file: OFF/SHADOW/BINDING and numeric override',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guard-'));
  try{
    assert.equal(G.readConfig(root).mode,'BINDING');
    fs.mkdirSync(path.join(root,'config'));
    fs.writeFileSync(path.join(root,'config','position-guard.json'),'﻿'+JSON.stringify({mode:'shadow',scalpTimeStopMin:40}));
    const c=G.readConfig(root); assert.equal(c.mode,'SHADOW'); assert.equal(c.scalpTimeStopMin,40);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('controller: guard places reduce-only tighter stop, then closes crossed scalp and cleans orders',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r2544-guard-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'config'),{recursive:true});
  fs.writeFileSync(path.join(root,'config','claude-v111.json'),JSON.stringify({runnerMode:'OFF'}));
  const v111=require('../claude-v111');
  const prevRoot=process.env.BRAINHUB_ROOT; process.env.BRAINHUB_ROOT=root; v111.resetConfigCache();
  t.after(()=>{process.env.BRAINHUB_ROOT=prevRoot;v111.resetConfigCache();});
  const state={qty:30,mark:101.5,now:Date.now(),algo:0,liq:'92.1'};
  const writes=[];
  const reply=b=>({ok:true,status:200,async text(){return JSON.stringify(b);}});
  const fetchImpl=async(url,opt={})=>{
    const u=new URL(url);const method=opt.method||'GET';
    const params=new URLSearchParams(method==='GET'?u.search.slice(1):(opt.body||''));
    if(u.pathname==='/fapi/v1/time')return reply({serverTime:state.now});
    if(u.pathname==='/fapi/v1/positionSide/dual')return reply({dualSidePosition:false});
    if(u.pathname==='/fapi/v3/positionRisk')return reply([{symbol:'ABCUSDT',positionSide:'BOTH',positionAmt:String(state.qty),entryPrice:'100',markPrice:String(state.mark),liquidationPrice:state.liq,isolatedWallet:'0'}]);
    if(u.pathname==='/fapi/v1/exchangeInfo')return reply({symbols:[{symbol:'ABCUSDT',filters:[{filterType:'MARKET_LOT_SIZE',stepSize:'1',minQty:'1',maxQty:'100000'},{filterType:'PRICE_FILTER',tickSize:'0.01',minPrice:'0.01',maxPrice:'100000'}]}]});
    if(u.pathname==='/fapi/v1/algoOrder'&&method==='POST'){state.algo++;writes.push({op:'POST',type:params.get('type'),qty:params.get('quantity'),trigger:Number(params.get('triggerPrice')),reduceOnly:params.get('reduceOnly')});return reply({algoId:'G'+state.algo});}
    if(u.pathname==='/fapi/v1/algoOrder'&&method==='DELETE'){writes.push({op:'DELETE',algoId:params.get('algoId')});return reply({code:200});}
    if(u.pathname==='/fapi/v1/order'&&method==='POST'){writes.push({op:'MARKET',side:params.get('side'),qty:params.get('quantity'),reduceOnly:params.get('reduceOnly')});const q=state.qty;state.qty=0;return reply({orderId:77,executedQty:String(q),status:'FILLED'});}
    throw new Error('unexpected '+method+' '+u.pathname);
  };
  const {createLiveController}=require('../live-controller');
  const journal=[];
  const controller=createLiveController({root,credentials:{apiKey:'test-api-key',apiSecret:'test-api-secret'},fetchImpl,clock:()=>state.now,
    store:{journal:(k,s,p)=>{journal.push({k,p});return 'id';}},scanner:{async scan(){throw new Error('unused');}},
    pipeline:{async run(){throw new Error('unused');}},committee:async()=>({})});
  controller._testRegisterRunner({intent:{symbol:'ABCUSDT',side:'LONG',entryPrice:100,stopPrice:98,takeProfit3:106,originTF:'5m',estimatedLiquidationPrice:92.1},
    result:{symbol:'ABCUSDT',side:'LONG',executedQty:30,tpQuantities:[10,10,10],stopAlgoId:'S1',tpAlgoIds:['T1','T2'],runner:{enabled:false},stopProtected:true},mode:'OFF',lane:'5M_SCALP'});
  const r1=await controller.runnerTick();
  assert.equal(r1.results[0].action,'GUARD_STOP_MOVED',JSON.stringify(r1));
  assert.equal(writes[0].type,'STOP_MARKET'); assert.equal(writes[0].reduceOnly,'true'); assert.equal(writes[0].qty,'30');
  assert.ok(writes[0].trigger>100&&writes[0].trigger<100.2,'başabaş');
  assert.ok(journal.some(x=>x.k==='CLAUDE_V111_RUNNER'&&x.p.kind==='LIQUIDATION_CHECK'&&x.p.exchange===92.1));
  state.mark=99.9; state.now+=26*60000;          // ölü scalp: +0.75R görmüş ama BE stopu mark'ın üstünde → seviyeyi geçti → kapat
  const r2=await controller.runnerTick();
  assert.equal(r2.results[0].action,'GUARD_CLOSE',JSON.stringify(r2));
  assert.ok(writes.some(x=>x.op==='MARKET'&&x.side==='SELL'&&x.reduceOnly==='true'));
  state.now+=15000;
  await controller.runnerTick();
  const deleted=writes.filter(x=>x.op==='DELETE').map(x=>x.algoId);
  for(const id of ['G1','S1','T1','T2'])assert.ok(deleted.includes(id),'kapanışta emir temizliği: '+id);
  assert.equal(controller.runnerStatus().rows[0].phase,'CLOSED');
  assert.ok(controller.runnerStatus().guard);
});

test('öz-denetim: küçük R ile +0.7R scalp erken KAPATILMAZ (hedef mark\'a çok yakınsa bekler)',()=>{
  // R=%0.3: BE hedefi 100.12, mark 100.21 → aralık %0.09 < minGap %0.15 → eylem yok (eski hata: CLOSE)
  const r=G.evaluateGuard(base({row:{originalStopPrice:99.7,currentStop:99.7},snap:{markPrice:100.21}}));
  assert.equal(r.action,'NONE',JSON.stringify(r));
  const crossed=G.evaluateGuard(base({row:{originalStopPrice:99.7,currentStop:99.7,guardMfeR:0.8},snap:{markPrice:100.05}}));
  assert.equal(crossed.action,'CLOSE','BE seviyesi gerçekten geçildiyse kapatır');
});

test('öz-denetim: emir öncesi kapıdan geçen stop, girişte guard tarafından likidasyon için sıkılaştırılmaz (tek kural)',()=>{
  let checked=0;
  for(const lev of [3,5,8,10,12,15,20,25]){
    for(const mmr of [0.004,0.005,0.01,0.025]){
      for(const side of ['LONG','SHORT']){
        const est=L.estimateLiquidation({side,entryPrice:100,leverage:lev,maintenanceMarginRate:mmr});
        for(let stopPct=0.3;stopPct<15;stopPct+=0.37){
          const stop=side==='LONG'?100*(1-stopPct/100):100*(1+stopPct/100);
          const pre=L.stopVsLiquidation({side,entryPrice:100,stopPrice:stop,liquidationPrice:est.price});
          const g=G.evaluateGuard({row:{symbol:'X',side,entryPrice:100,originalStopPrice:stop,currentStop:stop,originTF:'15m',createdAt:0},
            snap:{qty:1,entryPrice:100,markPrice:100,tickSize:0.0001,liquidationPrice:est.price},phase:'INITIAL',now:1000});
          const guardLiqAction=g.reason==='GUARD_STOP_NEAR_LIQUIDATION'||g.reason==='GUARD_LIQUIDATION_PROXIMITY';
          if(pre.ok)assert.equal(guardLiqAction,false,`lev ${lev} mmr ${mmr} ${side} stop ${stopPct.toFixed(2)}%: kapı geçti ama guard sıkılaştırdı`);
          else assert.equal(guardLiqAction,true,`lev ${lev} ${side} stop ${stopPct.toFixed(2)}%: kapı reddetti ama guard görmedi`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked>2000);
});
