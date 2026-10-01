'use strict';
// CLAUDE_R2544_15: yükselenler merdiveni, 24 saatlik likidasyon kaydı, seviye haritası, JEV radarı ve Office merdiveni.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const os=require('os');const path=require('path');
const {LiquidationHistory}=require('../liquidation-history');
const {levelMap,liquidationHistoryDigest,marketPacket}=require('../jev-market-packet');
const {buildGainerLadder}=require('../scanner');
test('merdiven: her taramada yeniden sıralanır, sıra geçmişi ve 5 dk hızı doğru',()=>{
  const now=1_800_000_000_000;
  const u=[{symbol:'AUSDT',priceChangePercent:30,quoteVolume:5,lastPrice:1},{symbol:'BUSDT',priceChangePercent:25,quoteVolume:5,lastPrice:2},
    {symbol:'CUSDT',priceChangePercent:-2,quoteVolume:9,lastPrice:3},{symbol:'DUSDT',priceChangePercent:26,quoteVolume:5,lastPrice:1.1}];
  const prev={ladder:{DUSDT:{h:[[now-5*60000,9],[now-60000,5]]}},lightweight:{DUSDT:{at:now-5*60000,lastPrice:1.0}}};
  const L=buildGainerLadder(u,prev,now);
  assert.deepEqual(L.top3.map(x=>x.symbol),['AUSDT','DUSDT','BUSDT']);
  const d=L.bySymbol.get('DUSDT');
  assert.equal(d.gainerRank,2);assert.equal(d.gainerRankPrev,5);assert.equal(d.gainerRankVelocity,7,'9→2 / 5 dk');
  assert.equal(d.shortChangePct,10);assert.equal(d.ladderTier,'TOP3');
  assert.equal(L.bySymbol.has('CUSDT'),false,'düşen coin merdivende yok');
  assert.equal(L.nextLadder.DUSDT.h.at(-1)[1],2);
});
test('likidasyon kaydı: tüm piyasa akışı → sembol kümeleri, 24 saat saklama, diske yazma/yükleme',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'liq-'));let t=1_800_000_000_000;
  const h=new LiquidationHistory({root,WebSocketImpl:null,now:()=>t});
  const ev=(s,S,p,q,T)=>({e:'forceOrder',o:{s,S,ap:String(p),z:String(q),T}});
  h.ingest(ev('ZECUSDT','SELL',100,50,t-3600000));h.ingest(ev('ZECUSDT','SELL',100.2,50,t-1800000));
  h.ingest(ev('ZECUSDT','BUY',110,10,t-600000));h.ingest(ev('XUSDT','BUY',5,1,t-600000));h.ingest(ev('ZECUSDT','SELL',90,1,t-25*3600000));
  const c=h.clusters('ZECUSDT',105);
  assert.equal(c.count,3,'24 saatten eski olay sayılmaz');
  assert.equal(c.clusters[0].side,'LONG_LIQUIDATED');assert.ok(Math.abs(c.clusters[0].price-100.1)<0.01);assert.equal(c.clusters[0].count,2);
  assert.ok(c.clusters[0].distPct<0);assert.equal(c.shortLiquidatedQuote,1100);
  h.save();const h2=new LiquidationHistory({root,WebSocketImpl:null,now:()=>t});h2.load();
  assert.equal(h2.clusters('ZECUSDT',105).count,3,'yeniden başlatmada geçmiş korunur');
  const s=fs.readFileSync(path.join(__dirname,'..','market.js'),'utf8');
  assert.match(s,/micro\.liquidationHistory = liquidationHistory\.clusters\(symbol, ref\)/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','manage.ps1'),'utf8'),/'liquidation-history\.js'/,'güncelleyici yeni modülü kopyalar');
});
test('seviye haritası: 15m–1d FVG/OB/breaker/fib/OTE/aralık + 24s likidasyon, üstte/altta en yakın 7',()=>{
  const f=(o={})=>({available:true,prior20High:112,prior20Low:95,smcContext:{dealingRange:{high:120,low:90},fibLevels:{retracement:{'0.5':105.5,'0.618':102}},
    oteReference:{longDiscountZone:{low:96,high:99}}},recentFairValueGaps:[{side:'BEAR',low:108,high:109}],
    orderBlocks:{bullish:[{low:97,high:98,broken:false,volRel:2.4}],bearish:[{low:103,high:104,broken:true,breaker:true}]},liquidity:{equalHigh:{price:115}},...o});
  const u={livePrice:104.5,frames:{'15m':f(),'4h':f()},microstructure:{liquidationHistory:{available:true,clusters:[{price:100.1,side:'LONG_LIQUIDATED',quote:10020}]}}};
  const m=levelMap(u);
  assert.ok(m.above.length<=7&&m.below.length<=7);
  assert.ok(m.below.some(x=>/24h:LIQ_LONGS_10k/.test(x.k)),'24s likidasyon kümesi');
  assert.ok(m.below.some(x=>/BREAKER_SUP/.test(x.k))&&m.above.some(x=>/FVG_BEAR/.test(x.k))&&m.below.some(x=>/OB_BULLx2\.4/.test(x.k)));
  assert.ok(m.below.some(x=>/15m:FIB618\+4h:FIB618/.test(x.k)),'aynı fiyattaki seviyeler birleşir');
  assert.ok(m.above.every((x,i,a)=>i===0||a[i-1].p<=x.p)&&m.below.every((x,i,a)=>i===0||a[i-1].p>=x.p));
  const pk=marketPacket(u);assert.ok(pk.levelMap&&pk.liquidationHistory&&pk.liquidationHistory.clusters.length===1);
  assert.ok(Buffer.byteLength(JSON.stringify(pk.levelMap))<1400);
});
test('JEV radarı merdiven yerini taşır; açıklama seviye haritasını anlatır; seçim önceliği ağırlıklı',()=>{
  const jd=fs.readFileSync(path.join(__dirname,'..','jev-decision.js'),'utf8');
  assert.match(jd,/ladder:candidate\?\.gainerRank\?\{rank:finiteNumber\(candidate\.gainerRank\)/);
  assert.match(jd,/coreMarketPacket\.levelMap lists the nearest levels/);
  const lc=fs.readFileSync(path.join(__dirname,'..','live-controller.js'),'utf8');
  assert.match(lc,/const priorityTurn=leaderAutoPickCount!==0;/);
  const oh=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
  assert.match(oh,/Yükselenler merdiveni \(Binance 24s, canlı\)/);assert.match(oh,/function renderLadder\(s\)/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','office-dashboard','office-server.js'),'utf8'),/'\/scanner\/last'/);
  const sv=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(sv,/u\.pathname==='\/scanner\/last'/);assert.match(sv,/market\.liquidationHistory\.start\(\)/);
});
test('likidasyon kaydı: WebSocket açılınca !forceOrder@arr aboneliği gönderilir, mesajlar kaydedilir',async()=>{
  const sent=[];let inst=null;
  class FakeWS{constructor(url){this.url=url;this.readyState=1;inst=this;this.h={};}addEventListener(n,f){this.h[n]=f;}send(m){sent.push(JSON.parse(m));}close(){}}
  const h=new LiquidationHistory({root:fs.mkdtempSync(path.join(os.tmpdir(),'liq2-')),WebSocketImpl:FakeWS,persist:false});
  h.start();
  assert.equal(inst.url,'wss://fstream.binance.com/ws');
  inst.h.open();
  assert.deepEqual(sent[0],{method:'SUBSCRIBE',params:['!forceOrder@arr'],id:1});
  await inst.h.message({data:JSON.stringify({e:'forceOrder',E:1,o:{s:'PUMPUSDT',S:'BUY',ap:'0.005',z:'100000',T:Date.now()}})});
  const c=h.clusters('PUMPUSDT');
  assert.equal(c.count,1);assert.equal(c.clusters[0].side,'SHORT_LIQUIDATED');assert.equal(h.health().connected,true);
  if(h.watchTimer)clearTimeout(h.watchTimer);
});
