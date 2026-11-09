'use strict';
// R2544.138 EKSİKSİZ EKRAN (kullanıcı 09.11: "veriler bilgiler grafik durumu tam doğru eksiksiz; 15m 1h da olmalı, 4 saatlik ve günlük,
// fonlama ve emir defteri; spike mumlara karşı koruma, iğne ucu bırakıp alınmış likiditeler, balinaların tercih edeceği bölgeler")
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const TB=require('../trader-brain'),DESK=require('../position-desk');
const k=(o,h,l,c,v=100)=>({open:o,high:h,low:l,close:c,volume:v});
test('R2544.138 wick hunts: a long wick that took liquidity and closed back is listed (stop hunt), a full-body move is not',()=>{
  const c=[...Array.from({length:20},()=>k(100,101,99,100.2)),k(100,106,99.8,100.3),k(100.3,100.6,99.9,100.4),k(100.4,104,100.3,103.9)];
  const w=TB.wickHunts(c,2,p=>({price:p,R:null}));assert.equal(w.length,1);assert.equal(w[0].side,'UPPER_WICK');assert.equal(w[0].price,106);assert.equal(w[0].barsAgo,2);
  assert.deepEqual(TB.wickHunts(c,0,p=>({price:p})),[],'no ATR = no claim');
});
test('R2544.138 volume profile: point of control where the volume traded, a 70 % value area around it, prices rounded to 6 digits',()=>{
  const c=[...Array.from({length:30},(_,i)=>k(100,100.5,99.5,100,1000)),...Array.from({length:10},(_,i)=>k(110,110.5,109.5,110,50))];
  const v=TB.volumeProfile(c,p=>({price:p,R:null}));assert.ok(Math.abs(v.poc.price-100)<0.6,'POC at the heavy zone');assert.ok(v.valueArea.low.price<=100&&v.valueArea.high.price>=100);
  assert.ok(String(v.poc.price).replace('.','').length<=7);assert.equal(TB.volumeProfile(c.slice(0,10),p=>({price:p})),null,'too few candles');
});
test('R2544.138 microstructure in a few numbers: order book imbalance, wall shares, taker flow, observed liquidation zones with their R; a cold stream says so',()=>{
  const m=DESK.microOf({available:true,ageMs:120,spreadBps:3.2,depth20Imbalance:-0.21,depthSoftContext:{bidWallShare:0.1,askWallShare:0.4,wallPressure:-0.3,micropriceBps:-1.1},cvdQuote120s:-5200,cvdComplete:true,
    observedLiquidations:{count:3,windowMs:900000,longLiquidatedQuote:12000,shortLiquidatedQuote:0,zones:[{side:'LONG_LIQUIDATED',price:0.98,quote:12000}],cascade:null}},p=>Number(((1-p)/0.02).toFixed(2)));
  assert.equal(m.orderBook.depth20Imbalance,-0.21);assert.equal(m.orderBook.askWallShare,0.4);assert.equal(m.takerFlow.cvdQuote120s,-5200);assert.equal(m.observedLiquidations.zones[0].R,1);assert.equal(m.observedLiquidations.windowMin,15);
  assert.deepEqual(DESK.microOf({available:false,reason:'STREAM_WARMING_OR_STALE'}),{available:false,reason:'STREAM_WARMING_OR_STALE'});
});
test('R2544.138 the desk packet carries 5m/15m/1h AND 4h/1d readings, funding, the order book and a data check; the desk record keeps the check',()=>{
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8'),tb=fs.readFileSync(path.join(__dirname,'..','trader-brain.js'),'utf8'),pd=fs.readFileSync(path.join(__dirname,'..','position-desk.js'),'utf8');
  assert.match(lc,/const chart=\{m5:TB\.chartReading\(k5\.raw,'5m'.*m15:TB\.chartReading\(k15\.raw,'15m'.*h1:TB\.chartReading\(k1h\.raw,'1h'/);
  assert.match(lc,/chart\.h4=TB\.chartReading\(k4h\.raw,'4h'/);assert.match(lc,/chart\.d1=TB\.chartReading\(k1d\.raw,'1d'/);
  assert.match(lc,/\/fapi\/v1\/premiumIndex',\{params:\{symbol:a\.symbol\}\}/);assert.match(lc,/const micro=DESK\.microOf\(sn,Rf\)/);assert.match(lc,/ms\.ensureSymbol\(x\.symbol\)/);
  assert.match(lc,/frames:\{m5:!!chart\.m5,m15:!!chart\.m15,h1:!!chart\.h1,h4:!!chart\.h4,d1:!!chart\.d1\},funding:!!funding,orderBook:micro\.available===true/);
  assert.match(lc,/shadow:true,data:dataCheck\}/);
  assert.match(tb,/trendLines:\(\(\) =>/);assert.match(tb,/wickHunts:wickHunts\(c, finite\(s\.atr14\), lvl\)/);assert.match(tb,/volumeProfile:volumeProfile\(c, lvl\)/);
  assert.match(pd,/funding, microstructure:micro,/);assert.match(pd,/\^OVH:\|\^KILO:/,'keyless seats are recorded under the karne key');
  const p=DESK.packet({lot:{symbol:'X',side:'LONG',entryPrice:1,stopPrice:0.98,tpPrice:1.06,openedAt:0,initialStopPrice:0.98},mark:1.01,k5:[],k15:[],k1h:[],btc5:[],oi:[],now:600000,lane:'ILK3',
    chart:{m5:null,m15:{},h1:{},h4:{},d1:{}},micro:{available:false},funding:{rate8hPct:-0.1},dataCheck:{frames:{h4:true}}});
  assert.deepEqual(p.market.funding,{rate8hPct:-0.1});assert.deepEqual(p.market.microstructure,{available:false});assert.ok(p.market.chartReading.h4&&p.market.chartReading.d1);assert.deepEqual(p.dataCheck,{frames:{h4:true}});
});
test('R2544.138 open-source registry review (09.11): 31 repos alive, none archived; two license records corrected from GitHub',()=>{
  const kr=fs.readFileSync(path.join(__dirname,'..','knowledge-research.js'),'utf8');
  assert.match(kr,/repo:'crisari666\/liquidity-scanner',[^\n]*license:'MIT',licenseCheckedAt:'2026-11-09'/);
  assert.match(kr,/repo:'minchillo4\/btc-liquidation-heatmap',[^\n]*license:'NONE_DETECTED',licenseCheckedAt:'2026-11-09'/);
  assert.ok(!/UNVERIFIED_CURRENT/.test(kr));
});
