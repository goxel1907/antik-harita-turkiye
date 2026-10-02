'use strict';

const zlib = require('zlib');
const { FRAMES, NATIVE_FRAMES, analyzeFrames, microstructure, parseKlines, aggregate45m, structure } = require('./engine');
const { combinePreMove } = require('./premove');
const { LocalL2Manager } = require('./local-l2');
const binanceRate = require('./binance-rate-limit');

const FUTURES = 'https://fapi.binance.com';
const SPOT = 'https://api.binance.com';
const GECKO = 'https://api.coingecko.com/api/v3';
const FUTURES_WS = 'wss://fstream.binance.com/public/ws';
const FUTURES_MARKET_WS = 'wss://fstream.binance.com/market/ws';
const frameCache = new Map();
const depthCache = new Map();
const derivativesCache = new Map();
const publicGetInFlight = new Map();
const restCvdCache = new Map();
let globalCache = { at: 0, result: null };

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round(n, places = 6) {
  return n === null || !Number.isFinite(n) ? null : Number(n.toFixed(places));
}
function validSymbol(s) { return typeof s === 'string' && /^[A-Z0-9]{1,28}USDT$/.test(s); }

function depthImbalance(bids, asks) {
  const parse = side => Array.isArray(side)
    ? side.slice(0, 20).map(x => [finite(x?.[0]), finite(x?.[1])]).filter(x => x[0] > 0 && x[1] > 0)
    : [];
  const b = parse(bids), a = parse(asks);
  if (!b.length || !a.length) return null;
  const bn = b.reduce((s, x) => s + x[0] * x[1], 0);
  const an = a.reduce((s, x) => s + x[0] * x[1], 0);
  return bn + an > 0 ? (bn - an) / (bn + an) : null;
}

function depthSoftContext(bids, asks) {
  const parse = side => Array.isArray(side)
    ? side.slice(0, 20).map(x => ({
        price:finite(x?.[0]),
        qty:finite(x?.[1])
      })).filter(x => x.price > 0 && x.qty > 0)
    : [];
  const b = parse(bids), a = parse(asks);
  if (!b.length || !a.length) return null;

  const sideStats = rows => {
    const notionals=rows.map(x => x.price * x.qty).filter(x => Number.isFinite(x) && x > 0);
    const total=notionals.reduce((sum,x) => sum + x,0);
    if (!(total > 0) || !notionals.length) return null;
    let entropy=0;
    for(const n of notionals){
      const p=n/total;
      if(p>0) entropy -= p*Math.log(p);
    }
    const normalized=notionals.length > 1 ? entropy/Math.log(notionals.length) : 0;
    const max=Math.max(...notionals);
    return {
      totalQuote:total,
      normalizedEntropy:Math.max(0,Math.min(1,normalized)),
      concentration:Math.max(0,Math.min(1,1-normalized)),
      maxWallShare:Math.max(0,Math.min(1,max/total))
    };
  };

  const bidStats=sideStats(b), askStats=sideStats(a);
  if(!bidStats || !askStats) return null;

  const bestBid=b[0], bestAsk=a[0];
  const mid=(bestBid.price+bestAsk.price)/2;
  const denom=bestBid.qty+bestAsk.qty;
  const microprice=denom>0
    ? (bestAsk.price*bestBid.qty + bestBid.price*bestAsk.qty)/denom
    : null;
  const micropriceBps=microprice && mid>0 ? (microprice-mid)/mid*10000 : null;

  const combinedTotal=bidStats.totalQuote+askStats.totalQuote;
  const weightedEntropy=combinedTotal>0
    ? (bidStats.normalizedEntropy*bidStats.totalQuote + askStats.normalizedEntropy*askStats.totalQuote)/combinedTotal
    : null;
  const weightedConcentration=weightedEntropy===null ? null : 1-weightedEntropy;

  return {
    source:'BINANCE_DEPTH20_PARTIAL_BOOK',
    normalizedEntropy:round(weightedEntropy,4),
    concentration:round(weightedConcentration,4),
    bidEntropy:round(bidStats.normalizedEntropy,4),
    askEntropy:round(askStats.normalizedEntropy,4),
    bidWallShare:round(bidStats.maxWallShare,4),
    askWallShare:round(askStats.maxWallShare,4),
    wallPressure:round(bidStats.maxWallShare-askStats.maxWallShare,4),
    microprice:round(microprice),
    micropriceBps:round(micropriceBps,4),
    semantics:'SOFT_MICROSTRUCTURE_CONTEXT_ONLY',
    note:'Depth entropy, wall concentration and microprice are partial-book descriptors only; they do not prove spoofing, hidden liquidity or market-maker intent.'
  };
}

function liquidationZones(records, mid, bucketBps = 10) {
  if (!Array.isArray(records) || !records.length || !(mid > 0)) return [];
  const step = Math.max(mid * bucketBps / 10000, Number.EPSILON);
  const buckets = new Map();
  for (const r of records) {
    if (!(r.price > 0) || !(r.quote > 0)) continue;
    const key = Math.round(r.price / step);
    const k = `${key}:${r.side}`;
    let z = buckets.get(k);
    if (!z) {
      z = { side:r.side, priceSum:0, weight:0, quote:0, count:0, firstAt:r.at, lastAt:r.at };
      buckets.set(k, z);
    }
    z.priceSum += r.price * r.quote;
    z.weight += r.quote;
    z.quote += r.quote;
    z.count += 1;
    z.firstAt = Math.min(z.firstAt, r.at);
    z.lastAt = Math.max(z.lastAt, r.at);
  }
  return [...buckets.values()]
    .map(z => ({
      side:z.side,
      price:round(z.weight > 0 ? z.priceSum / z.weight : null),
      observedQuote:round(z.quote, 2),
      count:z.count,
      firstAt:z.firstAt,
      lastAt:z.lastAt,
      semantics:'OBSERVED_FORCE_ORDER_CLUSTER'
    }))
    .sort((a, b) => b.observedQuote - a.observedQuote)
    .slice(0, 6);
}


function median(values) {
  const a=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return 0;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function parseDepthLevels(rows,limit=12) {
  return (Array.isArray(rows)?rows:[]).slice(0,limit).map(x=>{
    const price=finite(x?.[0]), qty=finite(x?.[1]);
    return {price,qty,quote:price&&qty?price*qty:null};
  }).filter(x=>x.price>0&&x.qty>0&&x.quote>0);
}
function flowWindowStats(trades, now, windowMs) {
  const rows=(Array.isArray(trades)?trades:[]).filter(x=>now>=x.at&&now-x.at<=windowMs);
  const buy=rows.filter(x=>x.sign>0), sell=rows.filter(x=>x.sign<0);
  const sum=a=>a.reduce((s,x)=>s+(Number(x.quote)||0),0);
  const buyQuote=sum(buy), sellQuote=sum(sell), totalQuote=buyQuote+sellQuote;
  const first=rows[0], last=rows.at(-1);
  const priceMoveBps=first?.price>0&&last?.price>0 ? (last.price-first.price)/first.price*10000 : null;
  const quotes=rows.map(x=>Number(x.quote)||0).filter(x=>x>0).sort((a,b)=>a-b);
  const p90=quotes.length?quotes[Math.min(quotes.length-1,Math.floor(quotes.length*0.90))]:0;
  const threshold=Math.max(p90, totalQuote>0?totalQuote*0.03:0);
  const large=rows.filter(x=>(Number(x.quote)||0)>=threshold&&threshold>0);
  const largeBuy=large.filter(x=>x.sign>0), largeSell=large.filter(x=>x.sign<0);
  const regularity = sideRows => {
    if(sideRows.length<4)return null;
    const ints=[];
    for(let i=1;i<sideRows.length;i++)ints.push(sideRows[i].at-sideRows[i-1].at);
    const mean=ints.reduce((s,x)=>s+x,0)/ints.length;
    if(!(mean>0))return null;
    const variance=ints.reduce((s,x)=>s+(x-mean)**2,0)/ints.length;
    return Math.sqrt(variance)/mean;
  };
  const buyCv=regularity(largeBuy), sellCv=regularity(largeSell);
  let possibleTwapLike=null;
  if(buyCv!==null&&buyCv<=0.45)possibleTwapLike={side:'BUY',samples:largeBuy.length,intervalCv:round(buyCv,4)};
  if(sellCv!==null&&sellCv<=0.45&&(!possibleTwapLike||largeSell.length>possibleTwapLike.samples))possibleTwapLike={side:'SELL',samples:largeSell.length,intervalCv:round(sellCv,4)};
  return {
    windowMs,
    coverageMs:first&&last?Math.max(0,last.at-first.at):0,
    trades:rows.length,
    buyQuote:round(buyQuote,2),
    sellQuote:round(sellQuote,2),
    deltaQuote:round(buyQuote-sellQuote,2),
    buyRatio:totalQuote>0?round(buyQuote/totalQuote,4):null,
    sellRatio:totalQuote>0?round(sellQuote/totalQuote,4):null,
    priceMoveBps:priceMoveBps===null?null:round(priceMoveBps,3),
    largestTradeQuote:quotes.length?round(quotes.at(-1),2):null,
    largeTradeThresholdQuote:threshold>0?round(threshold,2):null,
    largeBuyCount:largeBuy.length,
    largeSellCount:largeSell.length,
    possibleTwapLike,
    semantics:'PUBLIC_AGGTRADE_FLOW_EVIDENCE_ONLY'
  };
}
// R2544.20: Level-1 Order Flow Imbalance (Cont-Kukanov-Stoikov style) from the
// sequenced public Binance bookTicker observations that BrainHub already receives.
// This is materially different from the partial-depth20 pressure heuristic below:
// bookTicker carries best bid/ask prices AND sizes, so consecutive observations can
// support an event-level L1 OFI contribution. It still does NOT reconstruct hidden
// orders, participant identity, or a full Level-2/Level-3 book.
function bookTickerFlowStats(history, now, windowMs) {
  const rows=(Array.isArray(history)?history:[])
    .filter(x=>now>=x.at&&now-x.at<=windowMs&&x.bid>0&&x.ask>x.bid&&x.bidQty>=0&&x.askQty>=0)
    .sort((a,b)=>a.at-b.at||Number(a.updateId||0)-Number(b.updateId||0));
  if(rows.length<2)return {available:false,windowMs,samples:rows.length,reason:'BOOKTICKER_HISTORY_WARMING'};
  let ofi=0,gross=0,validTransitions=0;
  for(let i=1;i<rows.length;i++){
    const p=rows[i-1],c=rows[i];
    if(!(c.at>=p.at))continue;
    // CKS L1 OFI contribution. Sizes are base-asset quantities; normalization
    // by gross absolute event flow below makes the directional index comparable.
    const e=(c.bidQty*(c.bid>=p.bid?1:0))-(p.bidQty*(c.bid<=p.bid?1:0))
      -(c.askQty*(c.ask<=p.ask?1:0))+(p.askQty*(c.ask>=p.ask?1:0));
    if(!Number.isFinite(e))continue;
    ofi+=e;gross+=Math.abs(e);validTransitions++;
  }
  const first=rows[0],last=rows.at(-1),firstMid=(first.bid+first.ask)/2,lastMid=(last.bid+last.ask)/2;
  const qImb=x=>{const d=x.bidQty+x.askQty;return d>0?(x.bidQty-x.askQty)/d:null;};
  const qVals=rows.map(qImb).filter(Number.isFinite);
  const queueCurrent=qImb(last),queueMean=qVals.length?qVals.reduce((a,b)=>a+b,0)/qVals.length:null;
  const micro=x=>{const d=x.bidQty+x.askQty;return d>0?(x.ask*x.bidQty+x.bid*x.askQty)/d:null;};
  const microLast=micro(last),microBps=microLast&&lastMid>0?(microLast-lastMid)/lastMid*10000:null;
  const normalized=gross>0?Math.max(-1,Math.min(1,ofi/gross)):0;
  return {
    available:validTransitions>0,windowMs,samples:rows.length,transitions:validTransitions,
    coverageMs:last.at-first.at,rawOfi:round(ofi,6),grossAbsOfi:round(gross,6),normalizedOfi:round(normalized,4),
    priceMoveBps:firstMid>0?round((lastMid-firstMid)/firstMid*10000,3):null,
    queueImbalanceCurrent:round(queueCurrent,4),queueImbalanceMean:round(queueMean,4),
    queueImbalanceDelta:queueCurrent!==null&&qImb(first)!==null?round(queueCurrent-qImb(first),4):null,
    micropriceBps:round(microBps,4),
    semantics:'SEQUENCED_PUBLIC_BOOKTICKER_LEVEL1_OFI',
    note:'Level-1 OFI from consecutive public best-bid/ask price+size observations; not full L2/L3 reconstruction and not participant identity.'
  };
}
function depthDynamics(history, trades, now, mid) {
  if(!(mid>0))return {available:false,reason:'MID_UNAVAILABLE'};
  const rows=(Array.isArray(history)?history:[]).filter(x=>now>=x.at&&now-x.at<=45000);
  if(rows.length<3)return {available:false,reason:'DEPTH_HISTORY_WARMING'};
  const step=Math.max(mid*0.0002,Number.EPSILON);
  const bucket=p=>Math.round(Number(p)/step);
  const mapSide=(levels)=>{
    const m=new Map();
    for(const x of Array.isArray(levels)?levels:[]){
      if(!(x?.price>0)||!(x?.quote>0))continue;
      const k=bucket(x.price);
      const prev=m.get(k)||{priceSum:0,quote:0};
      prev.priceSum+=x.price*x.quote; prev.quote+=x.quote; m.set(k,prev);
    }
    return m;
  };
  const snapshots=rows.map(r=>({at:r.at,bids:mapSide(r.bids),asks:mapSide(r.asks)}));
  const last=snapshots.at(-1);
  // R2544.20: multi-window partial-L2 pressure. This is NOT true sequenced OFI; it is a
  // deterministic descriptor of how displayed depth imbalance and spread changed in retained snapshots.
  const snapStats=snapshots.map(s=>{
    const b=[...s.bids.values()],a=[...s.asks.values()];
    const bq=b.reduce((z,x)=>z+(Number(x.quote)||0),0),aq=a.reduce((z,x)=>z+(Number(x.quote)||0),0),tot=bq+aq;
    const bb=b.length?Math.max(...b.map(x=>Number(x.priceSum)/Math.max(Number(x.quote),Number.EPSILON))):null;
    const aa=a.length?Math.min(...a.map(x=>Number(x.priceSum)/Math.max(Number(x.quote),Number.EPSILON))):null;
    const md=bb>0&&aa>0?(bb+aa)/2:null;
    return {at:s.at,imbalance:tot>0?(bq-aq)/tot:null,spreadBps:md>0?(aa-bb)/md*10000:null};
  }).filter(x=>x.imbalance!==null);
  const pressure={};
  for(const [key,ms] of [['5s',5000],['15s',15000],['30s',30000],['45s',45000]]){
    const q=snapStats.filter(x=>now>=x.at&&now-x.at<=ms);
    if(!q.length)continue;
    const mean=q.reduce((z,x)=>z+x.imbalance,0)/q.length,first=q[0].imbalance,lastImb=q.at(-1).imbalance;
    pressure[key]={samples:q.length,current:round(lastImb,4),mean:round(mean,4),delta:round(lastImb-first,4)};
  }
  const spreadVals=snapStats.map(x=>x.spreadBps).filter(Number.isFinite).sort((a,b)=>a-b);
  const spreadBaseline=spreadVals.length?median(spreadVals):null;
  const currentLevels=(side)=>{
    const m=last[side], vals=[...m.entries()].map(([k,v])=>({k,price:v.quote>0?v.priceSum/v.quote:null,quote:v.quote}));
    const med=median(vals.map(x=>x.quote));
    const total=vals.reduce((s,x)=>s+x.quote,0);
    return vals.map(x=>{
      let seen=0, peak=0;
      for(const s of snapshots){const q=s[side].get(x.k)?.quote||0;if(q>0)seen++;if(q>peak)peak=q;}
      return {...x,persistence:seen/snapshots.length,peakQuote:peak,wall:x.quote>=Math.max(med*2.5,total*0.10)};
    }).filter(x=>x.wall).sort((a,b)=>b.quote-a.quote).slice(0,4);
  };
  const bidWalls=currentLevels('bids'), askWalls=currentLevels('asks');
  const peakMap=(side)=>{
    const m=new Map();
    for(const s of snapshots)for(const [k,v] of s[side]){
      const p=m.get(k)||{peakQuote:0,price:0,seen:0};
      if(v.quote>p.peakQuote){p.peakQuote=v.quote;p.price=v.priceSum/v.quote;}
      p.seen++;m.set(k,p);
    }
    return m;
  };
  const currentBid=last.bids,currentAsk=last.asks, peakBid=peakMap('bids'),peakAsk=peakMap('asks');
  const nearbyTradeQuote=(price)=>{
    if(!(price>0))return 0;
    return (Array.isArray(trades)?trades:[]).filter(t=>now>=t.at&&now-t.at<=45000&&t.price>0&&Math.abs(t.price-price)/price<=0.0006)
      .reduce((s,t)=>s+(Number(t.quote)||0),0);
  };
  const pulls=[];
  const scanPull=(side,peaks,current)=>{
    const peakVals=[...peaks.values()].map(x=>x.peakQuote).filter(x=>x>0);
    const threshold=Math.max(median(peakVals)*2.5,1);
    for(const [k,p] of peaks){
      if(p.peakQuote<threshold)continue;
      const cur=current.get(k)?.quote||0;
      const removed=Math.max(0,p.peakQuote-cur);
      const traded=nearbyTradeQuote(p.price);
      if(cur<=p.peakQuote*0.25&&removed>0&&traded<=removed*0.35){
        pulls.push({side:side==='bids'?'BID':'ASK',price:round(p.price),peakQuote:round(p.peakQuote,2),remainingQuote:round(cur,2),removedQuote:round(removed,2),nearbyTradedQuote:round(traded,2)});
      }
    }
  };
  scanPull('bids',peakBid,currentBid); scanPull('asks',peakAsk,currentAsk);
  pulls.sort((a,b)=>b.removedQuote-a.removedQuote);
  const f30=flowWindowStats(trades,now,30000);
  const strongestBid=bidWalls[0]||null, strongestAsk=askWalls[0]||null;
  let absorption={available:false,reason:'NO_CLEAR_ABSORPTION'};
  if(f30.sellRatio>=0.65&&Number(f30.priceMoveBps)>-8&&strongestBid?.persistence>=0.35){
    const confidence=Math.min(0.88,0.45+(f30.sellRatio-0.65)*0.9+strongestBid.persistence*0.18);
    absorption={available:true,type:'SELL_AGGRESSION_ABSORBED_AT_BID',side:'BID',confidence:round(confidence,3),wallPrice:round(strongestBid.price),wallQuote:round(strongestBid.quote,2)};
  }else if(f30.buyRatio>=0.65&&Number(f30.priceMoveBps)<8&&strongestAsk?.persistence>=0.35){
    const confidence=Math.min(0.88,0.45+(f30.buyRatio-0.65)*0.9+strongestAsk.persistence*0.18);
    absorption={available:true,type:'BUY_AGGRESSION_ABSORBED_AT_ASK',side:'ASK',confidence:round(confidence,3),wallPrice:round(strongestAsk.price),wallQuote:round(strongestAsk.quote,2)};
  }
  const replenishment=[];
  const scanReplenish=(walls,side)=>{
    for(const w of walls){
      const traded=nearbyTradeQuote(w.price);
      if(w.persistence>=0.45&&traded>=w.quote*0.30){
        replenishment.push({side,price:round(w.price),currentQuote:round(w.quote,2),peakQuote:round(w.peakQuote,2),persistence:round(w.persistence,3),nearbyTradedQuote:round(traded,2),confidence:round(Math.min(0.85,0.4+w.persistence*0.35+Math.min(0.2,traded/Math.max(1,w.quote)*0.05)),3)});
      }
    }
  };
  scanReplenish(bidWalls,'BID'); scanReplenish(askWalls,'ASK');
  return {
    available:true,
    windowMs:45000,
    samples:snapshots.length,
    bucketBps:2,
    bidWalls:bidWalls.map(x=>({price:round(x.price),quote:round(x.quote,2),persistence:round(x.persistence,3)})),
    askWalls:askWalls.map(x=>({price:round(x.price),quote:round(x.quote,2),persistence:round(x.persistence,3)})),
    possibleLiquidityPulls:pulls.slice(0,6),
    replenishment:replenishment.slice(0,6),
    absorption,
    pressure,
    spread:{currentBps:snapStats.length?round(snapStats.at(-1).spreadBps,3):null,baselineBps:spreadBaseline===null?null:round(spreadBaseline,3),expansionRatio:spreadBaseline>0&&snapStats.length?round(snapStats.at(-1).spreadBps/spreadBaseline,3):null},
    semantics:'HEURISTIC_PUBLIC_L2_PLUS_AGGTRADE_EVIDENCE_ONLY',
    note:'Top-of-book persistence, pull, replenishment and absorption are heuristics from public partial L2 plus aggTrade. They do not identify an exchange participant or prove spoofing/iceberg intent.'
  };
}
function liquidationVelocity(records, now) {
  const stats=ms=>{
    const rows=(Array.isArray(records)?records:[]).filter(x=>now>=x.at&&now-x.at<=ms);
    const long=rows.filter(x=>x.side==='LONG_LIQUIDATED'), short=rows.filter(x=>x.side==='SHORT_LIQUIDATED');
    const sum=a=>a.reduce((s,x)=>s+(Number(x.quote)||0),0);
    return {windowMs:ms,count:rows.length,longQuote:round(sum(long),2),shortQuote:round(sum(short),2),longCount:long.length,shortCount:short.length};
  };
  const s10=stats(10000),s60=stats(60000),s300=stats(300000);
  const total=s60.longQuote+s60.shortQuote;
  let cascade={available:false,reason:'NO_CLEAR_CASCADE'};
  if(s60.count>=3&&total>=10000){
    const longShare=total>0?s60.longQuote/total:0, shortShare=total>0?s60.shortQuote/total:0;
    if(longShare>=0.75)cascade={available:true,type:'LONG_LIQUIDATION_CASCADE',confidence:round(Math.min(0.95,0.55+(longShare-0.75)+Math.min(0.2,s60.count/30)),3),quote:s60.longQuote,count:s60.longCount};
    else if(shortShare>=0.75)cascade={available:true,type:'SHORT_LIQUIDATION_CASCADE',confidence:round(Math.min(0.95,0.55+(shortShare-0.75)+Math.min(0.2,s60.count/30)),3),quote:s60.shortQuote,count:s60.shortCount};
  }
  return {windows:{'10s':s10,'60s':s60,'300s':s300},cascade,semantics:'OBSERVED_BINANCE_FORCE_ORDER_ONLY'};
}

class StreamingMarket {
  constructor({ WebSocketImpl = (typeof WebSocket === 'function' ? WebSocket : null), now = () => Date.now() } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.now = now;
    this.channels = {
      public:{ endpoint:FUTURES_WS, streams:['bookTicker','depth20@100ms'], ws:null, connecting:false, timer:null, retryMs:1000 },
      market:{ endpoint:FUTURES_MARKET_WS, streams:['aggTrade','forceOrder'], ws:null, connecting:false, timer:null, retryMs:1000 }
    };
    this.stopped = false;
    this.states = new Map();
    this.subscribed = new Set();
    this.subscriptionId = 1;
    this.maxSymbols = 80;
    this.evictions = 0;
    this.protectedSymbols = new Set();
    this.tradeWindowMs = 120000;
    this.liquidationWindowMs = 15 * 60 * 1000;
    this.staleMs = 15000;
    this.localL2 = new LocalL2Manager({
      WebSocketImpl:this.WebSocketImpl,
      now:this.now,
      maxSymbols:6,
      staleMs:3000,
      snapshotLoader:async symbol=>getJson(FUTURES, `/fapi/v1/depth?symbol=${symbol}&limit=1000`, 7000)
    });
  }
  ensureLocalL2(symbol){
    if(process.env.BRAINHUB_LOCAL_L2==='0')return null;
    return this.localL2.ensureSymbol(symbol);
  }
  ensureSymbol(symbol) {
    symbol = String(symbol || '').toUpperCase();
    if (!validSymbol(symbol)) throw new Error('invalid USDT perpetual symbol');
    if (!this.states.has(symbol)) {
      if (this.states.size >= this.maxSymbols) {
        const victim = [...this.states.values()].filter(x=>!this.protectedSymbols.has(x.symbol))
          .sort((a,b)=>(a.lastRequestedAt||0)-(b.lastRequestedAt||0)||a.symbol.localeCompare(b.symbol))[0];
        if (!victim) return null; // optional stream unavailable; REST evidence still runs
        this.sendSubscriptions([victim.symbol], 'UNSUBSCRIBE');
        this.states.delete(victim.symbol); this.subscribed.delete(victim.symbol); this.evictions++;
      }
      this.states.set(symbol, {
        symbol, lastEventAt:0, book:null, depth:null, depthAt:0,
        bookHistory:[], lastBookHistoryAt:0,
        depthHistory:[], lastDepthHistoryAt:0,
        trades:[], tradeAt:0, liquidations:[], liquidationAt:0, createdAt:this.now()
      });
    }
    this.states.get(symbol).lastRequestedAt=this.now();
    const added=!this.subscribed.has(symbol);
    this.subscribed.add(symbol);
    this.connect();
    if(added)this.subscribeSymbols([symbol]);
    return this.states.get(symbol);
  }
  // Preserve the public-book socket interface used by existing diagnostics.
  get ws() { return this.channels.public.ws; }
  set ws(value) { this.channels.public.ws = value; }
  connect() {
    for (const channel of Object.values(this.channels)) this.connectChannel(channel);
  }
  connectChannel(channel) {
    if (this.stopped || !this.WebSocketImpl || channel.ws || channel.connecting || !this.subscribed.size) return;
    channel.connecting = true;
    let ws;
    try { ws = new this.WebSocketImpl(channel.endpoint); }
    catch { channel.connecting = false; this.scheduleReconnect(channel); return; }
    channel.ws = ws;
    const on = (name, fn) => {
      if (typeof ws.addEventListener === 'function') ws.addEventListener(name, fn);
      else ws['on' + name] = fn;
    };
    on('open', () => {
      if (this.stopped || channel.ws !== ws) return;
      channel.connecting = false;
      channel.retryMs = 1000;
      this.sendSubscriptions([...this.subscribed], 'SUBSCRIBE', channel);
    });
    on('message', async event => {
      try {
        if (this.stopped || channel.ws !== ws) return;
        let raw = event?.data;
        if (raw && typeof raw.text === 'function') raw = await raw.text();
        else if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString('utf8');
        else if (ArrayBuffer.isView(raw)) raw = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
        if (this.stopped || channel.ws !== ws) return;
        this.ingest(typeof raw === 'string' ? JSON.parse(raw) : raw);
      } catch { }
    });
    on('error', () => { });
    on('close', () => {
      if (channel.ws !== ws) return;
      channel.ws = null;
      channel.connecting = false;
      this.scheduleReconnect(channel);
    });
  }
  scheduleReconnect(channel) {
    if (this.stopped || !this.WebSocketImpl || !this.subscribed.size || channel.timer) return;
    const delay = Math.min(channel.retryMs, 30000);
    channel.retryMs = Math.min(delay * 2, 30000);
    channel.timer = setTimeout(() => {
      channel.timer = null;
      this.connectChannel(channel);
    }, delay);
    channel.timer.unref?.();
  }
  subscribeSymbols(symbols) {
    this.sendSubscriptions(symbols.filter(s => this.subscribed.has(s)), 'SUBSCRIBE');
  }
  sendSubscriptions(symbols, method, onlyChannel = null) {
    if (this.stopped) return;
    for (const channel of onlyChannel ? [onlyChannel] : Object.values(this.channels)) {
      const ws = channel.ws;
      if (ws?.readyState !== 1 || typeof ws.send !== 'function') continue;
      const params = symbols.flatMap(symbol => channel.streams.map(s => `${symbol.toLowerCase()}@${s}`));
      if (params.length) try { ws.send(JSON.stringify({method, params, id:this.subscriptionId++})); } catch { }
    }
  }
  cleanup(state, now = this.now()) {
    state.trades = state.trades.filter(x => now - x.at <= this.tradeWindowMs && now >= x.at);
    state.liquidations = state.liquidations.filter(x => now - x.at <= this.liquidationWindowMs && now >= x.at);
    state.bookHistory = (Array.isArray(state.bookHistory)?state.bookHistory:[]).filter(x => now - x.at <= 130000 && now >= x.at).slice(-1400);
    state.depthHistory = (Array.isArray(state.depthHistory)?state.depthHistory:[]).filter(x => now - x.at <= 90000 && now >= x.at).slice(-180);
  }
  ingest(message) {
    const data = message?.data && typeof message.data === 'object' ? message.data : message;
    if (!data || typeof data !== 'object') return false;
    const eventType = String(data.e || '');
    const symbol = String(data.s || data.o?.s || '').toUpperCase();
    if (!validSymbol(symbol)) return false;
    const state = this.states.get(symbol);
    if (!state) return false; // late packets must not resurrect an evicted subscription
    const now = this.now();
    const eventAt = finite(data.E) ?? finite(data.T) ?? finite(data.o?.T) ?? now;
    state.lastEventAt = Math.max(state.lastEventAt, eventAt || now);
    if (eventType === 'bookTicker') {
      const bid = finite(data.b), ask = finite(data.a), bidQty = finite(data.B), askQty = finite(data.A);
      if (bid > 0 && ask > bid) {
        state.book = { bid, ask, bidQty, askQty, at:eventAt || now, updateId:finite(data.u) };
        if(!state.lastBookHistoryAt || (eventAt||now)-state.lastBookHistoryAt>=100){
          state.bookHistory.push({at:eventAt||now,updateId:finite(data.u),bid,ask,bidQty:Math.max(0,bidQty||0),askQty:Math.max(0,askQty||0)});
          state.lastBookHistoryAt=eventAt||now;
          if(state.bookHistory.length>1400)state.bookHistory.splice(0,state.bookHistory.length-1400);
        }
      }
    } else if (eventType === 'depthUpdate') {
      const imbalance = depthImbalance(data.b, data.a);
      state.depth = { bids:Array.isArray(data.b) ? data.b.slice(0,20) : [], asks:Array.isArray(data.a) ? data.a.slice(0,20) : [], imbalance, at:eventAt || now };
      state.depthAt = eventAt || now;
      if(!state.lastDepthHistoryAt || (eventAt||now)-state.lastDepthHistoryAt>=500){
        state.depthHistory.push({at:eventAt||now,bids:parseDepthLevels(data.b,12),asks:parseDepthLevels(data.a,12)});
        state.lastDepthHistoryAt=eventAt||now;
        if(state.depthHistory.length>180)state.depthHistory.splice(0,state.depthHistory.length-180);
      }
    } else if (eventType === 'aggTrade') {
      const price = finite(data.p), qty = finite(data.q), at = finite(data.T) ?? eventAt ?? now;
      if (price > 0 && qty > 0 && at <= now + 5000) {
        state.trades.push({ at, price, qty, quote:price * qty, sign:data.m ? -1 : 1 });
        state.tradeAt = Math.max(state.tradeAt, at);
      }
    } else if (eventType === 'forceOrder') {
      const o = data.o || {};
      const price = finite(o.ap) > 0 ? finite(o.ap) : finite(o.p);
      const qty = finite(o.z) > 0 ? finite(o.z) : finite(o.q);
      const at = finite(o.T) ?? eventAt ?? now;
      if (price > 0 && qty > 0 && ['BUY','SELL'].includes(String(o.S || '').toUpperCase())) {
        state.liquidations.push({
          at,
          price,
          quote:price * qty,
          side:String(o.S).toUpperCase() === 'SELL' ? 'LONG_LIQUIDATED' : 'SHORT_LIQUIDATED'
        });
        state.liquidationAt = Math.max(state.liquidationAt, at);
      }
    } else return false;
    this.cleanup(state, now);
    return true;
  }
  snapshot(symbol, now = this.now()) {
    symbol = String(symbol || '').toUpperCase();
    const state = this.states.get(symbol);
    if (!state) return {
      available:false, symbol, reason:'STREAM_NOT_STARTED', websocketAvailable:Boolean(this.WebSocketImpl), connected:Boolean(this.ws && this.ws.readyState === 1)
    };
    this.cleanup(state, now);
    const connected = Boolean(this.ws && this.ws.readyState === 1);
    const lastAt = Math.max(state.lastEventAt, state.book?.at || 0, state.depthAt || 0, state.tradeAt || 0, state.liquidationAt || 0);
    const ageMs = lastAt > 0 && now >= lastAt ? now - lastAt : null;
    const bookFresh = state.book && now >= state.book.at && now - state.book.at <= this.staleMs;
    const bid = bookFresh ? state.book.bid : null;
    const ask = bookFresh ? state.book.ask : null;
    const mid = bid && ask ? (bid + ask) / 2 : null;
    const cvdQuote = state.trades.reduce((s, x) => s + x.sign * x.quote, 0);
    const longLiqQuote = state.liquidations.filter(x => x.side === 'LONG_LIQUIDATED').reduce((s, x) => s + x.quote, 0);
    const shortLiqQuote = state.liquidations.filter(x => x.side === 'SHORT_LIQUIDATED').reduce((s, x) => s + x.quote, 0);
    const zones = liquidationZones(state.liquidations, mid || state.book?.bid || state.book?.ask || 0);
    // R2544.29 BURST_SCALP: 1s/3s windows are fed entirely from the existing WebSocket
    // aggTrade/bookTicker ring buffers. No extra REST call is introduced.
    const flow1=flowWindowStats(state.trades,now,1000), flow3=flowWindowStats(state.trades,now,3000), flow5=flowWindowStats(state.trades,now,5000), flow10=flowWindowStats(state.trades,now,10000), flow15=flowWindowStats(state.trades,now,15000), flow30=flowWindowStats(state.trades,now,30000), flow60=flowWindowStats(state.trades,now,60000), flow120=flowWindowStats(state.trades,now,120000);
    const l1Ofi1=bookTickerFlowStats(state.bookHistory,now,1000),l1Ofi3=bookTickerFlowStats(state.bookHistory,now,3000),l1Ofi5=bookTickerFlowStats(state.bookHistory,now,5000),l1Ofi15=bookTickerFlowStats(state.bookHistory,now,15000),l1Ofi30=bookTickerFlowStats(state.bookHistory,now,30000),l1Ofi60=bookTickerFlowStats(state.bookHistory,now,60000),l1Ofi120=bookTickerFlowStats(state.bookHistory,now,120000);
    const dynamics=depthDynamics(state.depthHistory,state.trades,now,mid || state.book?.bid || state.book?.ask || 0);
    const localL2=this.localL2.snapshot(symbol,now,state.trades);
    const liqVelocity=liquidationVelocity(state.liquidations,now);
    const depthFresh = Boolean(state.depth && now >= state.depth.at && now - state.depth.at <= this.staleMs);
    const softDepth = depthFresh ? depthSoftContext(state.depth.bids, state.depth.asks) : null;
    const available = Boolean(bookFresh && ageMs !== null && ageMs <= this.staleMs);
    return {
      available,
      symbol,
      reason:available ? null : 'STREAM_WARMING_OR_STALE',
      source:'Binance USD-M public WebSocket',
      websocketAvailable:Boolean(this.WebSocketImpl),
      connected,
      asOf:lastAt || null,
      ageMs,
      bid:round(bid),
      ask:round(ask),
      spreadBps:mid ? round((ask - bid) / mid * 10000, 3) : null,
      depth20Imbalance:depthFresh ? round(state.depth.imbalance, 4) : null,
      depthAsOf:state.depthAt || null,
      depthSoftContext:softDepth,
      cvdQuote120s:state.trades.length ? round(cvdQuote, 2) : null,
      cvdTrades120s:state.trades.length,
      // CLAUDE_R2544_6_CVD_COVERAGE: yeni abone olunan sembolde pencere 120 sn değil birkaç saniyedir.
      cvdCoverageMs:state.createdAt > 0 && now >= state.createdAt ? Math.min(this.tradeWindowMs, now - state.createdAt) : null,
      cvdComplete:state.createdAt > 0 && now - state.createdAt >= this.tradeWindowMs - 5000,
      cvdSource:'BINANCE_WS_AGGTRADE',
      cvdAsOf:state.tradeAt || null,
      cvdAgeMs:state.tradeAt > 0 && now >= state.tradeAt ? now - state.tradeAt : null,
      orderFlow:{windows:{'1s':flow1,'3s':flow3,'5s':flow5,'10s':flow10,'15s':flow15,'30s':flow30,'60s':flow60,'120s':flow120},semantics:'PUBLIC_AGGTRADE_EVIDENCE_ONLY'},
      level1Ofi:{windows:{'1s':l1Ofi1,'3s':l1Ofi3,'5s':l1Ofi5,'15s':l1Ofi15,'30s':l1Ofi30,'60s':l1Ofi60,'120s':l1Ofi120},semantics:'SEQUENCED_PUBLIC_BOOKTICKER_LEVEL1_OFI_ONLY'},
      depthDynamics:dynamics,
      localL2,
      observedLiquidations:{
        available:state.liquidations.length > 0,
        windowMs:this.liquidationWindowMs,
        // CLAUDE_R2544_6: yeni abonelikte 15 dk'lık pencere dolmamıştır; "0 tasfiye" ile "gözlem yok" ayrılır.
        coverageMs:state.createdAt > 0 && now >= state.createdAt ? Math.min(this.liquidationWindowMs, now - state.createdAt) : null,
        count:state.liquidations.length,
        asOf:state.liquidationAt || null,
        longLiquidatedQuote:round(longLiqQuote, 2),
        shortLiquidatedQuote:round(shortLiqQuote, 2),
        zones,
        velocity:liqVelocity.windows,
        cascade:liqVelocity.cascade,
        semantics:'OBSERVED_BINANCE_FORCE_ORDER_ONLY',
        note:'Observed liquidation prints only; not a complete liquidation heatmap, future cluster map, or proof of market-maker intent.'
      },
      limitations:[
        'bookTicker supports sequenced Level-1 OFI, but it is not a full Level-2/Level-3 reconstruction and cannot reveal hidden orders.',
        'Partial depth20 stream is not a locally sequenced full order book and is not true multi-level OFI.',
        'Depth entropy, wall concentration and microprice are soft descriptors; no spoofing/hidden-liquidity claim is made.',
        'CVD covers the retained public aggTrade window only.',
        'Force-order records are observed liquidation prints, not all future liquidation levels.'
      ]
    };
  }
  health() {
    const now = this.now();
    let fresh = 0, warming = 0;
    for (const symbol of this.states.keys()) {
      if (this.snapshot(symbol, now).available) fresh++; else warming++;
    }
    return {
      websocketAvailable:Boolean(this.WebSocketImpl),
      connected:Boolean(this.ws && this.ws.readyState === 1),
      subscribedSymbols:this.subscribed.size,
      maxSymbols:this.maxSymbols, evictions:this.evictions, capacityKind:'PUBLIC_MARKET_DATA_CACHE',
      freshSymbols:fresh,
      warmingOrStaleSymbols:warming,
      endpoint:FUTURES_WS,
      channels:Object.fromEntries(Object.entries(this.channels).map(([name,c]) => [name,{endpoint:c.endpoint,connected:c.ws?.readyState===1}])),
      localL2:this.localL2.health(),
      publicOnly:true
    };
  }
  shutdown() {
    this.stopped = true;
    this.localL2.shutdown();
    for (const channel of Object.values(this.channels)) {
      if (channel.timer) clearTimeout(channel.timer);
      channel.timer = null;
      const ws = channel.ws;
      channel.ws = null;
      channel.connecting = false;
      if (ws && typeof ws.close === 'function') try { ws.close(); } catch { }
    }
  }
}

const marketStream = new StreamingMarket();
// CLAUDE_R2544_15_LIQUIDATION_HISTORY: tüm piyasa likidasyon akışı (24 saat, diske kalıcı). Testte başlatılmaz.
const { LiquidationHistory } = require('./liquidation-history');
const liquidationHistory = new LiquidationHistory();

async function getJson(base, endpoint, timeout = 10000) {
  const isBinance=/\.binance\.com$/i.test(new URL(base).hostname);
  const key=isBinance?`${base}${endpoint}`:null;
  if(key&&publicGetInFlight.has(key))return publicGetInFlight.get(key);
  const task=(async()=>{
    const permit=isBinance ? await binanceRate.acquire({path:endpoint,kind:'PUBLIC',maxWaitMs:Math.min(5000,Math.max(1000,timeout-250))}) : null;
    try {
      const res = await fetch(base + endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) {
        let body=null; try{body=await res.json();}catch{}
        if(isBinance)binanceRate.observeResponse({status:res.status,headers:res.headers,body,path:endpoint,kind:'PUBLIC'});
        const e=new Error(`${new URL(base).hostname} HTTP ${res.status}`);e.status=res.status;e.body=body;throw e;
      }
      if(isBinance)binanceRate.observeResponse({status:res.status,headers:res.headers,path:endpoint,kind:'PUBLIC'});
      return res.json();
    } finally { permit?.release?.(); }
  })();
  if(key)publicGetInFlight.set(key,task);
  try{return await task;}finally{if(key&&publicGetInFlight.get(key)===task)publicGetInFlight.delete(key);}
}

async function restCvd120(symbol, now = Date.now()) {
  const cached=restCvdCache.get(symbol);
  if(cached&&now-cached.at<30000)return cached.result;
  const start = now - 120000;
  let from = start, trades = 0, quote = 0, lastAt = null, pages = 0, complete = true;
  while (pages < 3) {
    const rows = await getJson(FUTURES, `/fapi/v1/aggTrades?symbol=${symbol}&startTime=${from}&endTime=${now}&limit=1000`, 7000);
    pages++;
    if (!Array.isArray(rows) || !rows.length) break;
    for (const t of rows) { const p = Number(t.p), q = Number(t.q); if (!Number.isFinite(p) || !Number.isFinite(q)) continue; quote += (t.m ? -1 : 1) * p * q; trades++; lastAt = Number(t.T) || lastAt; }
    if (rows.length < 1000) break;
    from = Number(rows.at(-1).T) + 1;
    if (pages >= 3) complete = false;
  }
  const coverageMs = complete ? 120000 : Math.max(0, (lastAt || start) - start);
  const result={ cvdQuote:Math.round(quote * 100) / 100, trades, coverageMs, complete, lastTradeAt:lastAt };
  restCvdCache.set(symbol,{at:Date.now(),result});
  if(restCvdCache.size>200){for(const k of [...restCvdCache.keys()].slice(0,40))restCvdCache.delete(k);}
  return result;
}

function modeledLiquidationDensityFromOi(rows, markPrice){
  const xs=Array.isArray(rows)?rows:[];const mark=finite(markPrice);
  const baseBars=240; // 60h on 15m public OI history
  const base={available:false,observed:false,estimated:true,authority:'SHADOW_EVIDENCE_ONLY',canQualify:false,canVeto:false,canSize:false,canExecute:false,executionAuthority:false,source:'BINANCE_USDM_PUBLIC_OI_MODEL'};
  if(xs.length<baseBars+8||!(mark>0))return {...base,reason:'INSUFFICIENT_60H_OI_HISTORY'};
  const pts=xs.map(x=>{const q=finite(x?.sumOpenInterest),v=finite(x?.sumOpenInterestValue);return {q,v,p:q&&v&&q>0?v/q:null,t:finite(x?.timestamp)};}).filter(x=>x.q!==null&&x.p!==null);
  if(pts.length<baseBars+8)return {...base,reason:'INSUFFICIENT_VALID_OI_HISTORY'};
  const changes=[];for(let i=1;i<pts.length;i++)changes.push(Math.abs(pts[i].q-pts[i-1].q));
  const zones=[];let events=0;
  for(let i=baseBars+1;i<pts.length;i++){
    const dq=pts[i].q-pts[i-1].q;if(!(dq>0))continue;
    const a=Math.max(0,i-baseBars-1),b=i-1;const hist=changes.slice(a,b).filter(Number.isFinite);const ma=hist.length?hist.reduce((z,x)=>z+x,0)/hist.length:0;if(!(ma>0))continue;
    const ratio=dq/ma;if(ratio<1.2)continue;const tier=ratio>=3?'H3':ratio>=2?'H2':'H1';const levs=tier==='H3'?[100,50,25,10,5]:tier==='H2'?[100,50,25,10]:[100,50,25];const side=pts[i].p>=pts[i-1].p?'LONG':'SHORT';const tierW=tier==='H3'?3:tier==='H2'?2:1.2;events++;
    for(const lev of levs){const liq=side==='LONG'?pts[i].p*(1-1/lev):pts[i].p*(1+1/lev);if(!(liq>0))continue;zones.push({side,liq,weight:dq*pts[i].p*tierW/levs.length});}
  }
  if(!zones.length)return {...base,available:true,events:0,lookbackHours:round(pts.length*.25,1),baselineHours:60,density:{aboveNear:0,aboveMid:0,aboveFar:0,belowNear:0,belowMid:0,belowFar:0},note:'No qualifying positive OI anomaly in the modeled window; zero is model output, not observed liquidation absence.'};
  const bucket={aboveNear:0,aboveMid:0,aboveFar:0,belowNear:0,belowMid:0,belowFar:0};let total=0;
  for(const z of zones){const d=(z.liq-mark)/mark*10000,ad=Math.abs(d);const side=d>=0?'above':'below';const band=ad<=150?'Near':ad<=500?'Mid':'Far';bucket[side+band]+=z.weight;total+=z.weight;}
  for(const k of Object.keys(bucket))bucket[k]=total>0?round(bucket[k]/total,4):0;
  return {...base,available:true,events,lookbackHours:round(pts.length*.25,1),baselineHours:60,density:bucket,semantics:'MODELED_OI_LIQUIDATION_DENSITY_NOT_OBSERVED_FORCEORDER',note:'OI-anomaly/leverage zones are modeled research only. Entry/leverage distribution is unknown; observed Binance forceOrder remains separate and authoritative only as observed prints.'};
}

async function derivativesContext(symbol) {
  if(!validSymbol(symbol))throw new Error('invalid USDT perpetual symbol');
  const now=Date.now();
  const cached=derivativesCache.get(symbol);
  if(cached&&now-cached.at<30000)return cached.result;
  const endpoints=[
    ['/fapi/v1/openInterest?symbol='+symbol,'openInterest'],
    ['/futures/data/openInterestHist?symbol='+symbol+'&period=5m&limit=3','openInterestHist'],
    ['/futures/data/openInterestHist?symbol='+symbol+'&period=15m&limit=360','openInterestModelHist'],
    ['/fapi/v1/premiumIndex?symbol='+symbol,'premium'],
    ['/futures/data/takerlongshortRatio?symbol='+symbol+'&period=5m&limit=3','taker'],
    ['/futures/data/topLongShortPositionRatio?symbol='+symbol+'&period=5m&limit=3','topPosition'],
    ['/futures/data/topLongShortAccountRatio?symbol='+symbol+'&period=5m&limit=3','topAccount'],
    ['/futures/data/globalLongShortAccountRatio?symbol='+symbol+'&period=5m&limit=3','globalAccount']
  ];
  const settled=await Promise.allSettled(endpoints.map(([url])=>getJson(FUTURES,url,7000)));
  const by={};
  settled.forEach((r,i)=>{by[endpoints[i][1]]=r.status==='fulfilled'?r.value:null;});
  const hist=Array.isArray(by.openInterestHist)?by.openInterestHist:[];
  // CLAUDE_R2544_6_OI_CONTRACTS: OI değişimi SÖZLEŞME adedi üzerinden (standart). Önceden USD değeri kullanılıyordu;
  // fiyat hareketi OI değişimi gibi görünüyordu (MARSCOIN: değer -%1,2 ↔ sözleşme -%0,10).
  const prevQ=hist.length>=2?Number(hist.at(-2)?.sumOpenInterest):null, lastQ=hist.length?Number(hist.at(-1)?.sumOpenInterest):null;
  const prev=hist.length>=2?Number(hist.at(-2)?.sumOpenInterestValue):null;
  const last=hist.length?Number(hist.at(-1)?.sumOpenInterestValue):null;
  const oiDeltaPct=Number.isFinite(prevQ)&&prevQ!==0&&Number.isFinite(lastQ)?(lastQ-prevQ)/prevQ*100:null;
  const oiValueDeltaPct=Number.isFinite(prev)&&prev!==0&&Number.isFinite(last)?(last-prev)/prev*100:null;
  const lastRow=x=>Array.isArray(x)&&x.length?x.at(-1):null;
  const tak=lastRow(by.taker), tp=lastRow(by.topPosition), ta=lastRow(by.topAccount), ga=lastRow(by.globalAccount);
  const modeledLiquidation=modeledLiquidationDensityFromOi(by.openInterestModelHist,finite(by.premium?.markPrice));
  const out={
    available:Boolean(by.openInterest||by.premium||tak||tp||ta||ga),
    source:'Binance USD-M public REST',
    asOf:now,
    openInterest:{
      current:finite(by.openInterest?.openInterest),
      time:finite(by.openInterest?.time),
      delta5mPct:oiDeltaPct===null?null:round(oiDeltaPct,4),
      valueDelta5mPct:oiValueDeltaPct===null?null:round(oiValueDeltaPct,4),
      deltaBasis:'CONTRACTS_LAST_TWO_5M_BUCKETS',
      valueLast:Number.isFinite(last)?round(last,2):null
    },
    funding:by.premium?{
      markPrice:finite(by.premium.markPrice),indexPrice:finite(by.premium.indexPrice),
      lastFundingRate:finite(by.premium.lastFundingRate),nextFundingTime:finite(by.premium.nextFundingTime),
      interestRate:finite(by.premium.interestRate)
    }:null,
    taker:tak?{buySellRatio:finite(tak.buySellRatio),buyVol:finite(tak.buyVol),sellVol:finite(tak.sellVol),timestamp:finite(tak.timestamp)}:null,
    topTraderPosition:tp?{longShortRatio:finite(tp.longShortRatio),longAccount:finite(tp.longAccount),shortAccount:finite(tp.shortAccount),timestamp:finite(tp.timestamp)}:null,
    topTraderAccount:ta?{longShortRatio:finite(ta.longShortRatio),longAccount:finite(ta.longAccount),shortAccount:finite(ta.shortAccount),timestamp:finite(ta.timestamp)}:null,
    globalAccount:ga?{longShortRatio:finite(ga.longShortRatio),longAccount:finite(ga.longAccount),shortAccount:finite(ga.shortAccount),timestamp:finite(ga.timestamp)}:null,
    modeledLiquidation,
    semantics:'DERIVATIVES_POSITIONING_CONTEXT_ONLY',
    note:'Open interest, funding, taker flow and long/short ratios are contextual evidence. modeledLiquidation is SHADOW_EVIDENCE_ONLY and never mixed with observed forceOrder. Top-trader ratios do not identify market makers and do not independently qualify a trade.'
  };
  derivativesCache.set(symbol,{at:now,result:out});
  return out;
}

async function frameSet(symbol, base = FUTURES, path = '/fapi/v1/klines') {
  const cacheKey = `${base}:${symbol}`;
  const cached = frameCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30000) return cached.result;
  const result = {}, errors = {};
  let next = 0;
  async function worker() {
    while (next < NATIVE_FRAMES.length) {
      const frame = NATIVE_FRAMES[next++];
      try { result[frame] = await getJson(base, `${path}?symbol=${symbol}&interval=${frame}&limit=${frame === '15m' ? 180 : 72}`, 12000); }
      catch (e) { errors[frame] = String(e.message || e); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const snapshotNow=Date.now();
  const out = { frames: analyzeFrames(result,snapshotNow), rawFrames:result, errors, asOf:snapshotNow };
  frameCache.set(cacheKey, { at: snapshotNow, result: out });
  return out;
}
// CLAUDE_R2544_PREMOVE: hızlı-hat sıralaması için hafif prob — yalnız 1m+3m (72 mum), 15 sn önbellek.
const preMoveCache = new Map();
async function preMoveProbe(symbol) {
  if (!validSymbol(symbol)) return { available:false, reason:'SYMBOL_INVALID' };
  const cached = preMoveCache.get(symbol);
  if (cached && Date.now() - cached.at < 15000) return cached.result;
  const byTf = {};
  await Promise.all(['1m','3m'].map(async tf => {
    try {
      const raw = await getJson(FUTURES, `/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=72`, 6000);
      const candles = parseKlines(raw, Date.now());
      const s = structure(candles, tf);
      byTf[tf] = s?.preMove || { available:false, frame:tf, reason:s?.reason || 'NO_PREMOVE' };
    } catch (e) { byTf[tf] = { available:false, frame:tf, reason:String(e.message || e).slice(0,80) }; }
  }));
  const result = { symbol, at:Date.now(), byTf, combined:combinePreMove(byTf) };
  preMoveCache.set(symbol, { at:Date.now(), result });
  if (preMoveCache.size > 400) { for (const k of [...preMoveCache.keys()].slice(0,100)) preMoveCache.delete(k); }
  return result;
}
async function symbolContext(symbol, options = {}) {
  if (!validSymbol(symbol)) throw new Error('invalid USDT perpetual symbol');
  marketStream.ensureSymbol(symbol);
  marketStream.ensureLocalL2(symbol);
  const seedNow=Date.now();
  const streamSeed=marketStream.snapshot(symbol,seedNow);
  const streamDepthFresh=streamSeed?.available===true&&streamSeed?.depth20Imbalance!==null&&streamSeed?.depthSoftContext;
  const [frames, depthResult, derivativesResult] = await Promise.allSettled([
    options?.frameSnapshot ? Promise.resolve(options.frameSnapshot) : frameSet(symbol),
    streamDepthFresh ? Promise.resolve(null) : getJson(FUTURES, `/fapi/v1/depth?symbol=${symbol}&limit=20`, 9000),
    derivativesContext(symbol)
  ]);
  if (frames.status !== 'fulfilled') throw frames.reason;
  const now = Date.now();
  const micro = depthResult.status === 'fulfilled' && depthResult.value
    ? microstructure(depthResult.value, [], depthCache.get(symbol), now)
    : { available:false, reason:streamDepthFresh?'REST_DEPTH_SKIPPED_STREAM_FRESH':String(depthResult.reason?.message || depthResult.reason || 'NO_DEPTH') };
  if (micro.snapshot) {
    depthCache.set(symbol, micro.snapshot);
    delete micro.snapshot;
  }
  const streaming = marketStream.snapshot(symbol, now);
  let restCvdBackfill=null;
  // R2544.27e: WebSocket aggTrade is primary. The old extra /aggTrades?limit=100 snapshot
  // duplicated CVD evidence on every symbolContext call. REST is now only a 120s warm-up/stale
  // fallback and is cached for 30s; once WS coverage is complete, zero REST aggTrades is needed.
  if (streaming && streaming.cvdComplete !== true) {
    try {
      const bf = await restCvd120(symbol, now);
      if (bf) {
        restCvdBackfill=bf;
        streaming.cvdQuote120s = bf.cvdQuote; streaming.cvdTrades120s = bf.trades;
        streaming.cvdCoverageMs = bf.coverageMs; streaming.cvdComplete = bf.complete; streaming.cvdSource = 'BINANCE_REST_AGGTRADES_120S';
        streaming.cvdAsOf = bf.lastTradeAt;
      }
    } catch (e) { streaming.cvdBackfillError = String(e.message || e).slice(0, 80); }
  }
  const derivatives = derivativesResult.status==='fulfilled' ? derivativesResult.value : {available:false,reason:String(derivativesResult.reason?.message||derivativesResult.reason||'DERIVATIVES_UNAVAILABLE')};
  micro.sourceQuality = 'REST_SNAPSHOT_APPROX';
  micro.derivatives = derivatives;
  micro.streaming = streaming;
  try {
    if (process.env.BRAINHUB_LIQ_HISTORY !== '0' && !process.env.NODE_TEST_CONTEXT) liquidationHistory.start();
    const ref = finite(streaming?.bid) && finite(streaming?.ask) ? (streaming.bid + streaming.ask) / 2 : null;
    micro.liquidationHistory = liquidationHistory.clusters(symbol, ref);
  } catch (e) { micro.liquidationHistory = { available:false, reason:String(e.message || e).slice(0, 80) }; }
  micro.observedLiquidations = streaming.observedLiquidations || {
    available:false, count:0, longLiquidatedQuote:0, shortLiquidatedQuote:0, zones:[], semantics:'OBSERVED_BINANCE_FORCE_ORDER_ONLY'
  };
  if(restCvdBackfill&&streaming?.cvdQuote120s!==null){
    micro.cvdSampleQuote=streaming.cvdQuote120s;
    micro.cvdSampleTrades=streaming.cvdTrades120s;
    micro.cvdWindow='REST backfill of the last 120s while WebSocket warms';
    micro.cvdSource='BINANCE_REST_AGGTRADES_120S';
  }
  if (streaming.available) {
    micro.available = true;
    micro.sourceQuality = 'STREAMING_PARTIAL_BOOK';
    if (streaming.bid !== null) micro.bid = streaming.bid;
    if (streaming.ask !== null) micro.ask = streaming.ask;
    if (streaming.spreadBps !== null) micro.spreadBps = streaming.spreadBps;
    if (streaming.depth20Imbalance !== null) micro.depth20Imbalance = streaming.depth20Imbalance;
    if (streaming.depthSoftContext) micro.depthSoftContext = streaming.depthSoftContext;
    if (streaming.cvdQuote120s !== null) {
      micro.cvdSampleQuote = streaming.cvdQuote120s;
      micro.cvdSampleTrades = streaming.cvdTrades120s;
      micro.cvdWindow = 'continuous retained public aggTrade window, at most 120s';
      micro.cvdSource = streaming.cvdSource || 'BINANCE_WS_AGGTRADE_120S';
    }
    micro.ofiNote = streaming.localL2?.available===true?'Sequence-safe local L2 is available as separate evidence; REST/depth20 remain fallback context.':'REST two-snapshot OFI proxy may be present as fallback context; partial depth20 streaming is not true sequenced local-book OFI.';
  }
  return {
    ok: true, symbol, generatedAt: new Date(now).toISOString(),
    source: 'Binance USDT-M public REST + public WebSocket when fresh; closed candles only; 45m causally aggregated from three closed 15m candles',
    timeframes: frames.value.frames, timeframeErrors: frames.value.errors,
    microstructure: micro,
    derivatives,
    streamHealth: marketStream.health(),
    limitations: [
      'Streaming depth20 is a partial-book fallback; active-symbol localL2 uses Binance USD-M snapshot + diff-depth U/u/pu continuity when healthy',
      'Streaming CVD covers the retained public aggTrade window, not a complete session',
      'Observed forceOrder prints are not a complete liquidation heatmap or future liquidation map',
      'FVG, wick sweeps and liquidity levels are structural context, not executable prices',
      '45m is synthetic and is not an independent vote'
    ]
  };
}
function parseChartKlines(raw, now = Date.now()) {
  if (!Array.isArray(raw)) throw new Error('klines must be an array');
  return raw.map(k => ({
    openTime:finite(k?.[0]), open:finite(k?.[1]), high:finite(k?.[2]),
    low:finite(k?.[3]), close:finite(k?.[4]), volume:finite(k?.[5]),
    closeTime:finite(k?.[6]), quoteVolume:finite(k?.[7]), takerBuyQuote:finite(k?.[10])
  })).filter(k =>
    Object.values(k).every(v => v !== null) &&
    k.openTime < k.closeTime &&
    k.high >= k.low &&
    k.high >= Math.max(k.open, k.close) &&
    k.low <= Math.min(k.open, k.close)
  ).map(k => ({ ...k, forming:k.closeTime >= now }));
}

function aggregate45mChart(candles15m, now = Date.now()) {
  const FIFTEEN_MS = 15 * 60 * 1000;
  const FORTYFIVE_MS = 45 * 60 * 1000;
  const buckets = new Map();
  for (const c of Array.isArray(candles15m) ? candles15m : []) {
    const bucket = Math.floor(c.openTime / FORTYFIVE_MS) * FORTYFIVE_MS;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(c);
  }
  const out = [];
  for (const [bucket, rows0] of [...buckets.entries()].sort((a,b) => a[0] - b[0])) {
    const rows = rows0
      .filter(x => x.openTime >= bucket && x.openTime < bucket + FORTYFIVE_MS)
      .sort((a,b) => a.openTime - b.openTime);
    if (!rows.length) continue;
    const first = rows[0], last = rows.at(-1);
    const expectedClose = bucket + FORTYFIVE_MS - 1;
    const complete = rows.length === 3 &&
      rows[0].openTime === bucket &&
      rows[1].openTime === bucket + FIFTEEN_MS &&
      rows[2].openTime === bucket + 2 * FIFTEEN_MS &&
      expectedClose < now;
    out.push({
      openTime:bucket,
      open:first.open,
      high:Math.max(...rows.map(x => x.high)),
      low:Math.min(...rows.map(x => x.low)),
      close:last.close,
      volume:rows.reduce((sum,x) => sum + x.volume, 0),
      closeTime:expectedClose,
      quoteVolume:rows.reduce((sum,x) => sum + x.quoteVolume, 0),
      takerBuyQuote:rows.reduce((sum,x) => sum + x.takerBuyQuote, 0),
      forming:!complete,
      componentCount:rows.length
    });
  }
  return out;
}


function chartContextFromFrameSnapshot(symbol, frame, requestedBars, snapshot) {
  if (!validSymbol(symbol)) throw new Error('invalid USDT perpetual symbol');
  frame = String(frame || '').toLowerCase();
  if (!FRAMES.includes(frame)) throw new Error('invalid timeframe');
  if (!snapshot || !snapshot.rawFrames || !snapshot.frames) throw new Error('frame snapshot required');
  const bars = Math.max(64, Math.min(256, Number(requestedBars) || 128));
  const now = Number(snapshot.asOf) || Date.now();
  const sourceFrame = frame === '45m' ? '15m' : frame;
  const raw = snapshot.rawFrames[sourceFrame];
  if (!Array.isArray(raw)) throw new Error('frame snapshot raw candles unavailable');
  let chartCandles = parseChartKlines(raw, now);
  let closedCandles = parseKlines(raw, now);
  if (frame === '45m') {
    chartCandles = aggregate45mChart(chartCandles, now);
    closedCandles = aggregate45m(closedCandles, now);
  }
  chartCandles = chartCandles.slice(-bars);
  closedCandles = closedCandles.slice(-bars);
  if (closedCandles.length < 52) throw new Error('insufficient closed candles for chart analysis');
  if (chartCandles.length < 2) throw new Error('insufficient candles for chart');
  // R2541_ATOMIC_PACKET_CHART: analysis is the exact frame object that fed symbolContext/JEV.
  // Do not recompute it from a second REST request or a later candle boundary.
  const analysis = snapshot.frames[frame] || structure(closedCandles, frame);
  const forming = chartCandles.filter(x => x.forming === true);
  return {
    ok:true,symbol,frame,
    bars:chartCandles.length,closedBars:closedCandles.length,formingBars:forming.length,requestedBars:bars,
    generatedAt:new Date(now).toISOString(),snapshotAsOf:now,
    synthetic:frame === '45m',
    source:frame === '45m'
      ? 'ATOMIC FRAME SNAPSHOT • Binance 15m candles; closed 45m analysis plus current partial 45m visual context'
      : `ATOMIC FRAME SNAPSHOT • Binance USDT-M ${frame}; exact JEV closed-candle analysis plus forming visual context`,
    candles:chartCandles.map(x => ({
      openTime:x.openTime, closeTime:x.closeTime, open:x.open, high:x.high, low:x.low, close:x.close,
      volume:x.volume, quoteVolume:x.quoteVolume, takerBuyQuote:x.takerBuyQuote,
      forming:x.forming === true,
      ...(frame === '45m' ? { componentCount:Number(x.componentCount || 3) } : {})
    })),
    analysis,
    imageContract:{
      clean:'candles + volume only; current forming candle included and explicitly marked in data',
      annotated:'R2541 atomic snapshot: candles + volume + EMA20/EMA50 + confirmed-swing trend lines + dealing range + liquidity + FVG/CE50 + OB + OTE + Fib + pattern geometry + swing/BOS/CHoCH + observed liquidations',
      formingCandlesIncluded:true,formingCandleMayConfirmSignal:false,structuralAnalysisUsesClosedCandlesOnly:true,futureLeakageAllowed:false,
      atomicPacketChart:true
    }
  };
}

async function atomicMirrorContext(symbol, frame, requestedBars = 128) {
  if (!validSymbol(symbol)) throw new Error('invalid USDT perpetual symbol');
  const snapshot=await frameSet(symbol);
  const [sym,chart]=await Promise.all([
    symbolContext(symbol,{frameSnapshot:snapshot}),
    Promise.resolve(chartContextFromFrameSnapshot(symbol,frame,requestedBars,snapshot))
  ]);
  const analysisAsOf=Number(chart?.analysis?.asOf)||0;
  const snapshotId=`${symbol}:${String(frame).toLowerCase()}:${Number(snapshot.asOf)||0}:${analysisAsOf}`;
  return {symbolContext:sym,chart,snapshotId,snapshotAsOf:Number(snapshot.asOf)||null};
}

async function chartContext(symbol, frame, requestedBars = 128) {
  if (!validSymbol(symbol)) throw new Error('invalid USDT perpetual symbol');
  frame = String(frame || '').toLowerCase();
  if (!FRAMES.includes(frame)) throw new Error('invalid timeframe');
  const bars = Math.max(64, Math.min(256, Number(requestedBars) || 128));
  const now = Date.now();
  const sourceFrame = frame === '45m' ? '15m' : frame;
  const sourceLimit = frame === '45m' ? Math.min(1000, bars * 3 + 12) : Math.min(500, bars + 4);
  const raw = await getJson(FUTURES, `/fapi/v1/klines?symbol=${symbol}&interval=${sourceFrame}&limit=${sourceLimit}`, 15000);

  let chartCandles = parseChartKlines(raw, now);
  let closedCandles = parseKlines(raw, now);
  if (frame === '45m') {
    chartCandles = aggregate45mChart(chartCandles, now);
    closedCandles = aggregate45m(closedCandles, now);
  }

  chartCandles = chartCandles.slice(-bars);
  closedCandles = closedCandles.slice(-bars);
  if (closedCandles.length < 52) throw new Error('insufficient closed candles for chart analysis');
  if (chartCandles.length < 2) throw new Error('insufficient candles for chart');

  const analysis = structure(closedCandles, frame);
  const forming = chartCandles.filter(x => x.forming === true);
  return {
    ok:true,
    symbol,
    frame,
    bars:chartCandles.length,
    closedBars:closedCandles.length,
    formingBars:forming.length,
    requestedBars:bars,
    generatedAt:new Date(now).toISOString(),
    synthetic:frame === '45m',
    source:frame === '45m'
      ? 'Binance 15m candles; closed 45m analysis plus current partial 45m visual context'
      : `Binance USDT-M ${frame}; closed-candle analysis plus current forming candle visual context`,
    candles:chartCandles.map(x => ({
      openTime:x.openTime, closeTime:x.closeTime, open:x.open, high:x.high, low:x.low, close:x.close,
      volume:x.volume, quoteVolume:x.quoteVolume, takerBuyQuote:x.takerBuyQuote,
      forming:x.forming === true,
      ...(frame === '45m' ? { componentCount:Number(x.componentCount || 3) } : {})
    })),
    analysis,
    imageContract:{
      clean:'candles + volume only; current forming candle included and explicitly marked in data',
      annotated:'candles + volume + EMA20/EMA50 + confirmed swing trend lines + dealing range/extension classification + prior/equal liquidity + FVG/CE50 + OB + OTE + Fib + swing/BOS/CHoCH reference levels; optional observed force-order liquidation levels; confirmed structural overlays come only from closed candles',
      formingCandlesIncluded:true,
      formingCandleMayConfirmSignal:false,
      structuralAnalysisUsesClosedCandlesOnly:true,
      futureLeakageAllowed:false
    }
  };
}

const CRC_TABLE = (() => {
  const out = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    out[n] = c >>> 0;
  }
  return out;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), 8 + data.length);
  return out;
}
function encodePng(width, height, rgba) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y=0; y<height; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level:9 })), pngChunk('IEND', Buffer.alloc(0))]);
}
function renderChartPng(chart, mode = 'clean', options = {}) {
  mode = String(mode || 'clean').toLowerCase();
  if (!['clean','annotated'].includes(mode)) throw new Error('invalid chart mode');
  const candles = Array.isArray(chart?.candles) ? chart.candles : [];
  if (candles.length < 2) throw new Error('chart candles required');
  const width = 1280, height = 720;
  // CLAUDE_R2544_8_LABEL_GUTTER: sağ etiket sütunu 190→270 px (fiyat büyük yazı + ad küçük yazı; Office'te okunabilirlik).
  const left = 24, right = width - (String(mode||'').toLowerCase()==='annotated' ? 330 : 190), top = 22, priceBottom = 555, volumeTop = 585, bottom = 700;
  const pixels = Buffer.alloc(width * height * 4);
  const bg=[13,17,23,255], grid=[42,49,62,255], wick=[174,183,196,255];
  const bull=[46,204,113,255], bear=[231,76,60,255], volume=[76,106,146,255];
  function px(x,y,c) {
    x=Math.round(x);y=Math.round(y);
    if(x<0||x>=width||y<0||y>=height)return;
    const i=(y*width+x)*4;
    pixels[i]=c[0];pixels[i+1]=c[1];pixels[i+2]=c[2];pixels[i+3]=c[3]??255;
  }
  function fillRect(x0,y0,x1,y1,c) {
    x0=Math.max(0,Math.floor(Math.min(x0,x1)));x1=Math.min(width-1,Math.ceil(Math.max(x0,x1)));
    y0=Math.max(0,Math.floor(Math.min(y0,y1)));y1=Math.min(height-1,Math.ceil(Math.max(y0,y1)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)px(x,y,c);
  }
  function blendRect(x0,y0,x1,y1,c,a=0.18) {
    x0=Math.max(0,Math.floor(Math.min(x0,x1)));x1=Math.min(width-1,Math.ceil(Math.max(x0,x1)));
    y0=Math.max(0,Math.floor(Math.min(y0,y1)));y1=Math.min(height-1,Math.ceil(Math.max(y0,y1)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const i=(y*width+x)*4;
      pixels[i]=Math.round(pixels[i]*(1-a)+c[0]*a);
      pixels[i+1]=Math.round(pixels[i+1]*(1-a)+c[1]*a);
      pixels[i+2]=Math.round(pixels[i+2]*(1-a)+c[2]*a);
      pixels[i+3]=255;
    }
  }
  function line(x0,y0,x1,y1,c) {
    x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
    const dx=Math.abs(x1-x0), sx=x0<x1?1:-1, dy=-Math.abs(y1-y0), sy=y0<y1?1:-1;
    let err=dx+dy;
    while(true){px(x0,y0,c);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}
  }
  const FONT3X5={
    'A':'010101111101101','B':'110101110101110','C':'011100100100011','D':'110101101101110','E':'111100110100111','F':'111100110100100',
    'G':'011100101101011','H':'101101111101101','I':'111010010010111','J':'001001001101010','K':'101101110101101','L':'100100100100111',
    'M':'101111111101101','N':'101111111111101','O':'010101101101010','P':'110101110100100','Q':'010101101111011','R':'110101110101101',
    'S':'011100010001110','T':'111010010010010','U':'101101101101111','V':'101101101101010','W':'101101111111101','X':'101101010101101',
    'Y':'101101010010010','Z':'111001010100111',
    '0':'111101101101111','1':'010110010010111','2':'111001111100111','3':'111001111001111','4':'101101111001001','5':'111100111001111','6':'111100111101111','7':'111001010010010','8':'111101111101111','9':'111101111001111', // CLAUDE_R2544_8_DIGITS: 6/8/9 glifleri X/zikzak gibi okunuyordu
   
    '-':'000000111000000','.':'000000000000010','/':'001001010100100',':':'000010000010000','%':'101001010100101','+':'000010111010000','(':'010100100100010',')':'010001001001010',' ':'000000000000000'
  };
  function asciiLabel(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 .\-\/:+()%]/g,' ');}
  function textWidth(text,scale=2){return asciiLabel(text).length*4*scale;}
  function drawText(x,y,text,c,scale=2){
    let ox=Math.round(x);const t=asciiLabel(text);
    for(const ch of t){
      const bits=FONT3X5[ch]||FONT3X5[' '];
      for(let i=0;i<15;i++)if(bits[i]==='1'){
        const gx=i%3,gy=Math.floor(i/3);
        fillRect(ox+gx*scale,y+gy*scale,ox+gx*scale+scale-1,y+gy*scale+scale-1,c);
      }
      ox+=4*scale;
    }
  }
    // CLAUDE_R2544_9_FONT5X7: 3x5 piksel yazı yerine 5x7 (klasik terminal) yazı — 2x ölçekte 10x14 px, rakamlar ayırt edilebilir.
    const F57={A:'01110100011000111111100011000110001',B:'11110100011000111110100011000111110',C:'01110100011000010000100001000101110',D:'11110100011000110001100011000111110',E:'11111100001000011110100001000011111',F:'11111100001000011110100001000010000',G:'01110100011000010111100011000101111',H:'10001100011000111111100011000110001',I:'01110001000010000100001000010001110',J:'00111000100001000010000101001001100',K:'10001100101010011000101001001010001',L:'10000100001000010000100001000011111',M:'10001110111010110101100011000110001',N:'10001100011100110101100111000110001',O:'01110100011000110001100011000101110',P:'11110100011000111110100001000010000',Q:'01110100011000110001101011001001101',R:'11110100011000111110101001001010001',S:'01111100001000001110000010000111110',T:'11111001000010000100001000010000100',U:'10001100011000110001100011000101110',V:'10001100011000110001100010101000100',W:'10001100011000110101101011010101010',X:'10001100010101000100010101000110001',Y:'10001100010101000100001000010000100',Z:'11111000010001000100010001000011111',
      '0':'01110100011001110101110011000101110','1':'00100011000010000100001000010001110','2':'01110100010000100010001000100011111','3':'11111000100010000010000011000101110','4':'00010001100101010010111110001000010','5':'11111100001111000001000011000101110','6':'00110010001000011110100011000101110','7':'11111000010001000100010000100001000','8':'01110100011000101110100011000101110','9':'01110100011000101111000010001001100',
      '.':'00000000000000000000000000110001100','-':'00000000000000011111000000000000000','/':'00001000100001000100010000100010000',':':'00000011000110000000011000110000000','%':'11000110010001000100010001001100011','+':'00000001000010011111001000010000000','(':'00010001000100001000010000010000010',')':'01000001000001000010000100010001000',' ':'00000000000000000000000000000000000','=':'00000000001111100000111110000000000'};
    const text57=(x,y,t,c,sc=2)=>{let ox=Math.round(x);for(const ch of asciiLabel(t)){const b=F57[ch]||F57[' '];for(let i=0;i<35;i++)if(b[i]==='1'){const gx=i%5,gy=Math.floor(i/5);fillRect(ox+gx*sc,y+gy*sc,ox+gx*sc+sc-1,y+gy*sc+sc-1,c);}ox+=6*sc;}};
  fillRect(0,0,width-1,height-1,bg);
  const rawMin=Math.min(...candles.map(x=>Number(x.low))), rawMax=Math.max(...candles.map(x=>Number(x.high)));
  const span=Math.max(1e-12,rawMax-rawMin), pad=span*0.06;
  const pmin=rawMin-pad,pmax=rawMax+pad;
  const yPrice=p=>top+(pmax-Number(p))/(pmax-pmin)*(priceBottom-top);
  const step=(right-left)/candles.length;
  const xAt=i=>left+step*(i+0.5);
  for(let i=0;i<=6;i++){
    const y=top+(priceBottom-top)*i/6;line(left,y,right,y,grid);
  }
  for(let i=0;i<=8;i++){
    const x=left+(right-left)*i/8;line(x,top,x,priceBottom,grid);
  }
  const maxVol=Math.max(1,...candles.map(x=>Number(x.volume)||0));
  for(let i=0;i<candles.length;i++){
    const c=candles[i], x=xAt(i), col=Number(c.close)>=Number(c.open)?bull:bear;
    line(x,yPrice(c.high),x,yPrice(c.low),wick);
    const half=Math.max(1,Math.floor(step*0.28));
    const yo=yPrice(c.open), yc=yPrice(c.close);
    fillRect(x-half,Math.min(yo,yc),x+half,Math.max(yo,yc)+1,col);
    const vh=(Number(c.volume)||0)/maxVol*(bottom-volumeTop);
    fillRect(x-half,bottom-vh,x+half,bottom,volume);
  }
  if(mode==='annotated'){
    const closes=candles.map(x=>Number(x.close));
    function emaSeries(period){
      const a=2/(period+1), out=[];let v=closes[0];
      for(let i=0;i<closes.length;i++){if(i===0)v=closes[0];else v=a*closes[i]+(1-a)*v;out.push(v);}return out;
    }
    function path(values,c){for(let i=1;i<values.length;i++)line(xAt(i-1),yPrice(values[i-1]),xAt(i),yPrice(values[i]),c);}
    function xForAt(at){
      const t=Number(at);if(!Number.isFinite(t))return null;
      let best=-1,dist=Infinity;
      for(let i=0;i<candles.length;i++){
        const ct=Number(candles[i].closeTime);
        if(!Number.isFinite(ct))continue;
        const d=Math.abs(ct-t);
        if(d===0)return xAt(i);
        if(d<dist){dist=d;best=i;}
      }
      // R2541_STRICT_TIME_AXIS: koordinatı grafiğin kenarına körlemesine yapıştırma.
      // Yalnız gerçek mum zamanına yarım mum aralığından daha yakınsa toleranslı eşleştir.
      const gaps=[];
      for(let i=1;i<candles.length;i++){
        const a=Number(candles[i-1].closeTime),b=Number(candles[i].closeTime);
        if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)gaps.push(b-a);
      }
      const stepMs=gaps.length?[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)]:0;
      return best>=0&&stepMs>0&&dist<=stepMs*0.5?xAt(best):null;
    }
    const levelLabels=[];
    const fmtP=p=>{const n=Number(p);if(!Number.isFinite(n))return '';const d=Math.abs(n)>=100?2:Math.abs(n)>=1?4:6;return n.toFixed(d).replace(/0+$/,'').replace(/\.$/,'');};
    // CLAUDE_R2544_9_SHORT_NAMES: sağ sütunda okunaklı kısa adlar.
    const SHORT={'ONCEKI20 H':'ONC20 TEPE','ONCEKI20 L':'ONC20 DIP','ARALIK EQ':'DENGE','FVG BOGA CE50':'FVG BOGA','FVG AYI CE50':'FVG AYI','ESIT H':'ESIT TEPE','ESIT L':'ESIT DIP'};
    const shortName=t=>{let s=String(t);for(const [k,v] of Object.entries(SHORT))s=s.replace(k,v);return s.replace(/FIB 0\./,'FIB .');};
    const addLevel=(price,text,col,prio=5)=>{const p=Number(price);if(Number.isFinite(p)&&p>=pmin&&p<=pmax)levelLabels.push({price:p,y:yPrice(p),name:shortName(text),text:`${text} ${fmtP(p)}`,col,prio});};
    const addZoneLabel=(z,text,col,prio)=>{const lo=Number(z?.low),hi=Number(z?.high);if(Number.isFinite(lo)&&Number.isFinite(hi))addLevel((lo+hi)/2,text,col,prio);};
    // CLAUDE_R2544_9_LEVEL_ORIGIN: 29.09 — yatay seviyeler grafiğin EN SOLUNDAN çiziliyordu; seviyenin doğmadığı geçmişte de
    // varmış gibi görünüyordu. Artık her seviye oluştuğu mumdan (swing pivotu, FVG/OB mumu, önceki-20 tepesi/dibi, Fib bacağının
    // başlangıcı) sağa çizilir. Kaynağı bilinmeyen (fiyat, tasfiye kümesi) ve üst zaman dilimi seviyeleri tam genişlik ve kesikli.
    const xAtTime=t=>{const v=Number(t);if(!Number.isFinite(v))return null;for(let i=0;i<candles.length;i++){const o=Number(candles[i].openTime),c=Number(candles[i].closeTime);if(Number.isFinite(o)&&Number.isFinite(c)&&v>=o&&v<=c)return xAt(i);}const f=Number(candles[0]?.openTime);if(Number.isFinite(f)&&v<f)return left;return xForAt(v);};
    const fromX=at=>{const x=at==null?null:(xForAt(at)??xAtTime(at));return x===null?left:Math.max(left,Math.round(x-step*0.5));};
    const hline=(price,col,x0=left,dashed=false)=>{const y=yPrice(price);if(!Number.isFinite(y))return;if(!dashed){line(x0,y,right,y,col);return;}for(let x=x0;x<right;x+=9)line(x,y,Math.min(right,x+5),y,col);};
    const idxOfExtreme=(n,hi)=>{const s=Math.max(0,candles.length-1-n),e=candles.length-1;let bi=-1,bv=hi?-Infinity:Infinity;for(let i=s;i<e;i++){const v=Number(hi?candles[i].high:candles[i].low);if(hi?v>bv:v<bv){bv=v;bi=i;}}return bi;};
    const renderLabels=()=>{
      const lift=c=>{const l=0.299*c[0]+0.587*c[1]+0.114*c[2];if(l>=150)return c;const k=Math.min(0.6,(150-l)/150+0.2);return [Math.round(c[0]+(255-c[0])*k),Math.round(c[1]+(255-c[1])*k),Math.round(c[2]+(255-c[2])*k),255];};
      const sorted=levelLabels.filter(r=>Number.isFinite(r.y)).sort((a,b)=>a.y-b.y);
      const groups=[];
      for(const r of sorted){
        const g=groups[groups.length-1];
        // fiyat ve pozisyon satırları (öncelik 0) başka seviyeyle birleşmez: kendi fiyatlarıyla ayrı satırda kalır
        const same=g&&r.prio!==0&&g.prio!==0&&(Math.abs(g.y-r.y)<=2||Math.abs(g.price-r.price)<=Math.abs(g.price)*0.00015);
        if(same){if(!g.names.includes(r.name))g.names.push(r.name);if(r.prio<g.prio){g.prio=r.prio;g.col=r.col;}}
        else groups.push({price:r.price,y:r.y,names:[r.name],col:r.col,prio:r.prio,isPrice:r.name==='FIYAT'});
      }
      const SC=2,CW=6*SC,GH=7*SC,x0=right+10;
      for(const g of groups){
        g.priceTxt=fmtP(g.price);const pw=g.priceTxt.length*CW;const room=Math.max(4,Math.floor((width-(x0+pw+8)-4)/CW));
        const lines=[];let cur='';for(const n of g.names){const add=cur?cur+'/'+n:n;if(add.length<=room)cur=add;else{if(cur)lines.push(cur);cur=n.length>room?n.slice(0,room-1)+'+':n;}}if(cur)lines.push(cur);
        g.lines=lines.slice(0,2);if(lines.length>2)g.lines[1]=(g.lines[1].slice(0,room-1))+'+';g.h=g.lines.length>1?GH*2+8:GH+5;g.pw=pw;
      }
      const minY=top,maxY=priceBottom;
      // CLAUDE_R2544_9B_NEAR_PLACEMENT: 29.09 canlı HYPE — 27 etiket tüm sütunu doldurunca satırlar fiyatlarından 100+ px
      // kayıyordu (POZ GIRIS 88.301 başka bir fiyatın hizasında). Yeni yerleşim: önce fiyat/pozisyon (öncelik 0), sonra öncelik
      // sırasına ve fiyata yakınlığa göre her satır gerçek fiyatına EN YAKIN boş yere konur; ±MAXD px içinde yer yoksa
      // (öncelik 0 hariç) o satır çizilmez. Böylece görünen her etiket kendi çizgisinin hizasında kalır.
      const MAXD=54,occ=[];
      const free=(y,h)=>y>=minY&&y+h<=maxY&&occ.every(o=>y+h<=o[0]||y>=o[1]);
      const lastClose=Number(candles.at(-1)?.close);
      const order=groups.map((g,i)=>i).sort((a,b)=>(groups[a].prio-groups[b].prio)||(Math.abs(groups[a].price-lastClose)-Math.abs(groups[b].price-lastClose)));
      const pos={};const keep=[];
      for(const i of order){
        const g=groups[i],want=Math.max(minY,Math.min(maxY-g.h,Math.round(g.y)-Math.round(GH/2)-2));
        let best=null;
        const lim=g.prio===0?(maxY-minY):MAXD;
        for(let d=0;d<=lim&&best===null;d++){for(const y of [want-d,want+d]){if(free(y,g.h)){best=y;break;}}}
        if(best===null)continue;
        pos[i]=best;occ.push([best,best+g.h]);keep.push(i);
      }
      // seçilen satırlar fiyat sırasıyla (ters dönme olmadan) yeniden yerleştirilir: ileri + geri geçiş
      keep.sort((a,b)=>groups[a].y-groups[b].y);
      const hidden=groups.length-keep.length;
      if(hidden>0)text57(right+10,priceBottom+8,`+${hidden} SEVIYE TABLODA`,[150,160,175,255],2);
      {let yy=minY;for(const i of keep){const g=groups[i];const want=Math.max(minY,Math.min(maxY-g.h,Math.round(g.y)-Math.round(GH/2)-2));pos[i]=Math.max(yy,want);yy=pos[i]+g.h;}
       for(let k=keep.length-1;k>=0;k--){const i=keep[k],g=groups[i];const lim=k===keep.length-1?maxY:pos[keep[k+1]];if(pos[i]+g.h>lim)pos[i]=lim-g.h;}}
      for(const i of keep){
        const g=groups[i],y=pos[i],col=lift(g.col);
        fillRect(right+4,y,width-2,y+g.h-2,g.isPrice?[48,54,66,255]:(g.prio===0?[40,34,20,255]:[20,25,32,255]));
        fillRect(right+4,y,right+6,y+g.h-2,g.col);
        text57(x0,y+2,g.priceTxt,col,SC);
        text57(x0+g.pw+8,y+2,g.lines[0]||'',col,SC);
        if(g.lines[1])text57(x0+g.pw+8,y+GH+6,g.lines[1],col,SC);
        const ty=Math.round(g.y),my=y+Math.round(GH/2)+2;
        if(Math.abs(ty-my)>2)line(right,ty,right+4,my,g.col);
      }
    };
    path(emaSeries(20),[255,193,7,255]);
    path(emaSeries(50),[156,92,204,255]);
    const a=chart.analysis||{};

    const swHiAt=a?.swingStructure?.lastConfirmedSwingHigh?.at,swLoAt=a?.swingStructure?.lastConfirmedSwingLow?.at;
    const legAt=[Number(swHiAt),Number(swLoAt)].filter(Number.isFinite);const legX=legAt.length?fromX(Math.min(...legAt)):left;
    // R2541: dealing range bands/levels. Outside-range state is supplied by engine.js.
    const dr=a?.smcContext?.dealingRange||{};
    const drLow=Number(dr.low),drHigh=Number(dr.high),drEq=Number(dr.equilibrium);
    if(Number.isFinite(drLow)&&Number.isFinite(drHigh)&&drHigh>drLow){
      if(Number.isFinite(drEq)){
        blendRect(legX,yPrice(drHigh),right,yPrice(drEq),[255,87,34],0.035);
        blendRect(legX,yPrice(drEq),right,yPrice(drLow),[33,150,243],0.035);
      }
      hline(drHigh,[255,112,67,255],legX);addLevel(drHigh,'ARALIK UST',[255,112,67,255],2);
      hline(drLow,[66,165,245,255],legX);addLevel(drLow,'ARALIK ALT',[66,165,245,255],2);
      if(Number.isFinite(drEq)){hline(drEq,[158,158,158,255],legX);addLevel(drEq,'ARALIK EQ',[200,200,200,255],4);}
    }

    // R2541_CONFIRMED_SWING_TRENDLINES: no close-regression pseudo trend line.
    const trendLines=a?.swingStructure?.trendLines||{};
    const drawTrend=(tl,col,label)=>{
      if(!tl||tl.active!==true)return;
      const x0=xForAt(tl?.from?.at),x1=xForAt(tl?.projected?.at||tl?.to?.at);
      const y0=Number(tl?.from?.price),y1=Number(tl?.projected?.price??tl?.to?.price);
      if(x0===null||x1===null||!Number.isFinite(y0)||!Number.isFinite(y1))return;
      line(x0,yPrice(y0),x1,yPrice(y1),col);line(x0,yPrice(y0)+1,x1,yPrice(y1)+1,col);
      const ty=Math.max(top,Math.min(priceBottom-16,Math.round(yPrice(y1))-15));fillRect(Math.min(right-110,x1+4),ty-1,Math.min(right-110,x1+4)+textWidth(label,2)*1.5+4,ty+14,[13,17,23,255]);text57(Math.min(right-110,x1+6),ty,label,col,2);
    };
    drawTrend(trendLines.upSupport,[0,230,118,255],'TREND HL');
    drawTrend(trendLines.downResistance,[255,82,82,255],'TREND LH');

    const i20h=idxOfExtreme(20,true),i20l=idxOfExtreme(20,false);
    const levels=[
      [a.prior20High,'ONCEKI20 H',[0,188,212,255],i20h>=0?Math.max(left,xAt(i20h)-step*0.5):left,3],
      [a.prior20Low,'ONCEKI20 L',[255,152,0,255],i20l>=0?Math.max(left,xAt(i20l)-step*0.5):left,3],
      [a.liquidity?.equalHigh?.price,'ESIT H',[232,232,232,255],fromX(a.liquidity?.equalHigh?.at??a.liquidity?.equalHigh?.points?.[0]?.at),3],
      [a.liquidity?.equalLow?.price,'ESIT L',[232,232,232,255],fromX(a.liquidity?.equalLow?.at??a.liquidity?.equalLow?.points?.[0]?.at),3]
    ];
    for(const [price,name,col,x0,prio] of levels){if(Number.isFinite(Number(price))){hline(price,col,x0);addLevel(price,name,col,prio);}}
    for(const g of Array.isArray(a.recentFairValueGaps)?a.recentFairValueGaps:[]){
      const low=Number(g.low),high=Number(g.high),ce=Number(g.ce50),col=g.side==='BULL'?[76,255,145,255]:[255,112,96,255];
      if(Number.isFinite(low)&&Number.isFinite(high)){
        const gx=Math.max(left,fromX(g.at)-2*step);
        blendRect(gx,yPrice(high),right,yPrice(low),g.side==='BULL'?[46,204,113]:[231,76,60],0.10);
        if(Number.isFinite(ce)){hline(ce,col,gx);addLevel(ce,`FVG ${g.side==='BULL'?'BOGA':'AYI'} CE50`,col,4);}
      }
    }
    for(const ob of Array.isArray(a?.orderBlocks?.bullish)?a.orderBlocks.bullish:[]){
      const low=Number(ob.low),high=Number(ob.high);if(!ob.broken&&Number.isFinite(low)&&Number.isFinite(high)){blendRect(fromX(ob.at),yPrice(high),right,yPrice(low),[0,150,136],0.12);addZoneLabel(ob,'BOGA OB',[64,224,208,255],3);}
    }
    for(const ob of Array.isArray(a?.orderBlocks?.bearish)?a.orderBlocks.bearish:[]){
      const low=Number(ob.low),high=Number(ob.high);if(!ob.broken&&Number.isFinite(low)&&Number.isFinite(high)){blendRect(fromX(ob.at),yPrice(high),right,yPrice(low),[244,67,54],0.12);addZoneLabel(ob,'AYI OB',[255,110,100,255],3);}
    }
    const ote=a?.smcContext?.oteReference||{};
    const drawZone=(z,col,alpha,label)=>{const low=Number(z?.low),high=Number(z?.high);if(Number.isFinite(low)&&Number.isFinite(high)){blendRect(legX,yPrice(high),right,yPrice(low),col,alpha);addZoneLabel(z,label,[220,220,220,255],5);}};
    drawZone(ote.longDiscountZone,[33,150,243],0.07,'OTE ALIS');
    drawZone(ote.shortPremiumZone,[255,87,34],0.07,'OTE SATIS');
    const fib=a?.smcContext?.fibLevels?.retracement||{};
    const fibCols={'0.382':[126,87,194,255],'0.5':[255,235,59,255],'0.618':[0,188,212,255],'0.705':[205,220,57,255],'0.786':[255,152,0,255]};
    for(const key of Object.keys(fibCols)){const price=Number(fib[key]);if(Number.isFinite(price)){hline(price,fibCols[key],legX);addLevel(price,`FIB ${key}`,fibCols[key],key==='0.618'||key==='0.5'?4:6);}}

    // Swing/BOS/CHoCH reference levels.
    const swingHi=Number(a?.swingStructure?.lastConfirmedSwingHigh?.price);
    const swingLo=Number(a?.swingStructure?.lastConfirmedSwingLow?.price);
    if(Number.isFinite(swingHi)){const c=['BOS_UP','CHOCH_UP'].includes(a?.swingStructure?.event)?[255,235,59,255]:[120,144,156,255];hline(swingHi,c,fromX(swHiAt));addLevel(swingHi,a?.swingStructure?.event==='CHOCH_UP'?'CHOCH H':'SWING H',c,2);}
    if(Number.isFinite(swingLo)){const c=['BOS_DOWN','CHOCH_DOWN'].includes(a?.swingStructure?.event)?[255,235,59,255]:[120,144,156,255];hline(swingLo,c,fromX(swLoAt));addLevel(swingLo,a?.swingStructure?.event==='CHOCH_DOWN'?'CHOCH L':'SWING L',c,2);}

    // R2541_PATTERN_GEOMETRY: only engine-produced confirmed-pivot coordinates are drawn.
    const patternName={ASCENDING_TRIANGLE:'YUKSELEN UCGEN',DESCENDING_TRIANGLE:'ALCALAN UCGEN',SYMMETRICAL_TRIANGLE:'SIMETRIK UCGEN',RISING_WEDGE:'YUKSELEN KAMA',FALLING_WEDGE:'ALCALAN KAMA',RISING_CHANNEL:'YUKSELEN KANAL',FALLING_CHANNEL:'ALCALAN KANAL',RANGE:'YATAY ARALIK'};
    let patternLabelOffset=0;
    for(const pat of (Array.isArray(a?.patterns)?a.patterns:[]).filter(x=>Array.isArray(x?.geometry?.lines)&&x.geometry.lines.length).slice(-3)){
      const col=String(pat.side||'').toUpperCase()==='LONG'?[74,222,128,255]:String(pat.side||'').toUpperCase()==='SHORT'?[255,99,99,255]:[180,180,220,255];
      for(const gl of pat.geometry.lines){const x0=xForAt(gl?.from?.at),x1=xForAt(gl?.to?.at);const p0=Number(gl?.from?.price),p1=Number(gl?.to?.price);if(x0!==null&&x1!==null&&Number.isFinite(p0)&&Number.isFinite(p1))line(x0,yPrice(p0),x1,yPrice(p1),col);}
      const text=patternName[pat.type]||pat.type;if(text){text57(left+8,top+6+patternLabelOffset,text,col,2);patternLabelOffset+=18;}
    }

    // CLAUDE_R2544_9_HTF_LEVELS: üst zaman dilimi (5m grafikte 15m/1h, 15m grafikte 1h/4h) ana seviyeleri — kesikli, "1H"/"4H" önekli.
    for(const h of Array.isArray(options?.htfLevels)?options.htfLevels:[]){
      const p=Number(h?.price);if(!Number.isFinite(p)||p<pmin||p>pmax)continue;
      const col=Array.isArray(h.col)?h.col:[186,104,200,255];
      const lo=Number(h?.low),hi=Number(h?.high);
      // CLAUDE_R2544_9C_CLEAN: üst TF çizgileri mumların üstünü kaplamasın — yalnız grafiğin sağ %30'unda kısa kesikli
      const hx0=Math.round(right-(right-left)*0.30);
      if(Number.isFinite(lo)&&Number.isFinite(hi)&&hi>lo)blendRect(hx0,yPrice(hi),right,yPrice(lo),col.slice(0,3),0.07);
      hline(p,col,hx0,true);addLevel(p,`${String(h.tf||'').toUpperCase()} ${h.name}`,col,Number(h.prio)||6);
    }

    // Observed Binance force-order liquidation clusters (historical prints only, not a future heatmap).
    // CLAUDE_R2544_9C_LIQ_BANDS: 29.09 ZEC — 6 ayrı "LIKID LONG" kesikli çizgisi 1405–1414 arasını kırmızı çizgilerle dolduruyordu.
    // Aynı taraftaki kümeler %0,4 içinde tek banda birleşir (adet + toplam USDT), yalnız grafiğin sağ %25'inde çizilir.
    {
      const liqs=(Array.isArray(options?.observedLiquidations)?options.observedLiquidations:[]).map(z=>({price:Number(z?.price),side:String(z?.side||'').toUpperCase(),quote:Number(z?.quote)||0,count:Number(z?.count)||1})).filter(z=>Number.isFinite(z.price)&&z.price>=pmin&&z.price<=pmax).sort((a,b)=>a.price-b.price);
      const bands=[];
      for(const z of liqs){const b=bands.find(x=>x.side===z.side&&z.price<=x.hi*1.004&&z.price>=x.lo*0.996);if(b){b.lo=Math.min(b.lo,z.price);b.hi=Math.max(b.hi,z.price);b.quote+=z.quote;b.count+=z.count;}else bands.push({side:z.side,lo:z.price,hi:z.price,quote:z.quote,count:z.count});}
      const lx0=Math.round(right-(right-left)*0.25);
      for(const b of bands){
        const isLong=b.side.includes('LONG');const col=isLong?[255,82,82,255]:[0,230,118,255];
        const y0=yPrice(b.hi),y1=yPrice(b.lo);blendRect(lx0,Math.min(y0,y1)-1,right,Math.max(y0,y1)+1,col.slice(0,3),0.22);
        const mid=(b.lo+b.hi)/2;hline(mid,col,lx0,true);
        const k=b.quote>=1e6?(b.quote/1e6).toFixed(1)+'M':b.quote>=1e3?Math.round(b.quote/1e3)+'K':String(Math.round(b.quote));
        addLevel(mid,`LIKID ${isLong?'LONG':'SHORT'} X${b.count}${b.quote>0?' '+k:''}`,col,3);
      }
    }

    // CLAUDE_R2544_9_POSITION_OVERLAY: açık pozisyon (TradingView uzun/kısa pozisyon aracı gibi): girişten sağa yeşil hedef ve
    // kırmızı risk kutusu, giriş/stop/TP çizgileri ve LONG/SHORT etiketi. Yalnız görselleştirme; emir veya karar üretmez.
    const posn=options?.position;
    if(posn&&['LONG','SHORT'].includes(String(posn.side||'').toUpperCase())){
      const side=String(posn.side).toUpperCase(),e=Number(posn.entryPrice),st=Number(posn.stopPrice),tp=Number(posn.takeProfit1),mk=Number(posn.markPrice);
      if(Number.isFinite(e)){
        const px0=Math.max(left,Math.min(right-40,Math.round((xAtTime(Date.parse(posn.openedAt))??(right-40))-step*0.5)));
        const clampY=p=>Math.max(top,Math.min(priceBottom,yPrice(p)));
        if(Number.isFinite(tp))blendRect(px0,clampY(tp),right,clampY(e),[38,166,154],0.26);
        if(Number.isFinite(st))blendRect(px0,clampY(e),right,clampY(st),[239,83,80],0.26);
        const ey=clampY(e);line(px0,ey,right,ey,[255,255,255,255]);line(px0,ey+1,right,ey+1,[255,255,255,255]);
        if(Number.isFinite(st))line(px0,clampY(st),right,clampY(st),[239,83,80,255]);
        if(Number.isFinite(tp))line(px0,clampY(tp),right,clampY(tp),[38,166,154,255]);
        const pct=Number.isFinite(mk)&&e>0?(side==='LONG'?(mk-e)/e:(e-mk)/e)*100:null;
        const tag=`${side} ${pct===null?'':(pct>=0?'+':'')+pct.toFixed(2)+'%'}`.trim();
        const tw=tag.length*12+10,ty=Math.max(top,Math.min(priceBottom-18,Math.round(ey)-20)),tx=Math.max(left,Math.min(px0,right-tw-2));
        fillRect(tx,ty,tx+tw,ty+17,side==='LONG'?[27,120,90,255]:[170,45,45,255]);text57(tx+5,ty+2,tag,[255,255,255,255],2);
        addLevel(e,`POZ ${side==='LONG'?'ALIS':'SATIS'} GIRIS`,[255,255,255,255],0);
        if(Number.isFinite(st))addLevel(st,'POZ STOP',[239,83,80,255],0);
        if(Number.isFinite(tp))addLevel(tp,'POZ TP1',[38,166,154,255],0);
      }
    }

    const lastPx=Number(candles.at(-1)?.close);
    if(Number.isFinite(lastPx)){hline(lastPx,[255,255,255,255],left,true);addLevel(lastPx,'FIYAT',[255,255,255,255],0);}
    renderLabels();
  }
  // CLAUDE_R2544_9C_PRICE_AXIS: TEMİZ grafikte fiyat ekseni yoktu (fiyat okunamıyordu). Izgara fiyatları + son fiyat etiketi.
  {
    const gridCol=[120,132,150,255];
    const fmtA=p=>{const n=Number(p);const d=Math.abs(n)>=100?2:Math.abs(n)>=1?4:6;return n.toFixed(d);};
    for(let i=0;i<=6;i++){const y=Math.round(top+(priceBottom-top)*i/6);const pv=pmax-(pmax-pmin)*i/6;
      if(mode==='annotated'){const t=fmtA(pv);fillRect(left+2,y+2,left+6+t.length*6,y+11,[13,17,23,255]);text57(left+4,y+3,t,gridCol,1);}
      else{const lp0=Number(candles.at(-1)?.close);if(Number.isFinite(lp0)&&Math.abs(yPrice(lp0)-y)<16)continue;text57(right+10,Math.max(top,Math.min(priceBottom-14,y-7)),fmtA(pv),gridCol,2);}}
    if(mode!=='annotated'){const lp=Number(candles.at(-1)?.close),lo=Number(candles.at(-1)?.open);if(Number.isFinite(lp)){const y=Math.round(yPrice(lp));const c=lp>=lo?[38,166,154,255]:[239,83,80,255];
      for(let x=left;x<right;x+=6)line(x,y,Math.min(right,x+3),y,c);const t=fmtA(lp);fillRect(right+4,y-9,right+14+t.length*12,y+9,c);text57(right+9,y-6,t,[255,255,255,255],2);}}
  }
  line(left,volumeTop-8,right,volumeTop-8,grid);

  const probeCell=Number(options?.visionProbeCell);
  if(Number.isInteger(probeCell)&&probeCell>=1&&probeCell<=9){
    const active=[255,0,255,255], inactive=[30,34,42,255], border=[255,255,255,255];
    // Diagnostic only: at 448x252 the old 64px cells became 22px and
    // subpixel borders disappeared. Keep each cell 56px with visible gutters.
    const mx=36,my=36,cell=160,gap=24,pad=16;
    const grid=3*cell+2*gap;
    // Fixed labels on every cell make the diagnostic readable without
    // relying on spatial counting. They never encode which cell is active.
    const digits=['010111010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001001001001','111101111101111','111101111001111'];
    fillRect(mx-pad,my-pad,mx+grid+pad-1,my+grid+pad-1,border);
    fillRect(mx-pad+8,my-pad+8,mx+grid+pad-9,my+grid+pad-9,bg);
    for(let i=0;i<9;i++){
      const row=Math.floor(i/3), col=i%3;
      const x0=mx+col*(cell+gap), y0=my+row*(cell+gap);
      fillRect(x0-6,y0-6,x0+cell+5,y0+cell+5,border);
      fillRect(x0,y0,x0+cell-1,y0+cell-1,(i+1)===probeCell?active:inactive);
      for(let bit=0;bit<15;bit++)if(digits[i][bit]==='1'){
        const dx=x0+65+(bit%3)*10,dy=y0+55+Math.floor(bit/3)*10;
        fillRect(dx,dy,dx+9,dy+9,border);
      }
    }
  }

  const requestedWidth=Number(options?.outputWidth||width);
  const requestedHeight=Number(options?.outputHeight||height);
  const outWidth=Math.max(320,Math.min(width,Number.isFinite(requestedWidth)?Math.round(requestedWidth):width));
  const outHeight=Math.max(180,Math.min(height,Number.isFinite(requestedHeight)?Math.round(requestedHeight):height));
  if(outWidth===width&&outHeight===height)return encodePng(width,height,pixels);
  const scaled=Buffer.alloc(outWidth*outHeight*4);
  for(let y=0;y<outHeight;y++){
    const sy=Math.min(height-1,Math.floor(y*height/outHeight));
    for(let x=0;x<outWidth;x++){
      const sx=Math.min(width-1,Math.floor(x*width/outWidth));
      const si=(sy*width+sx)*4, di=(y*outWidth+x)*4;
      scaled[di]=pixels[si];
      scaled[di+1]=pixels[si+1];
      scaled[di+2]=pixels[si+2];
      scaled[di+3]=pixels[si+3];
    }
  }
  return encodePng(outWidth,outHeight,scaled);
}

async function globalContext() {
  const now = Date.now();
  if (globalCache.result && now - globalCache.at < 60000) return globalCache.result;
  const [btc, eth, ethbtc, gecko] = await Promise.allSettled([
    frameSet('BTCUSDT'), frameSet('ETHUSDT'),
    frameSet('ETHBTC', SPOT, '/api/v3/klines'),
    getJson(GECKO, '/global', 12000)
  ]);
  const marketCap = { available: false, reason: 'GLOBAL_MARKET_CAP_UNAVAILABLE' };
  if (gecko.status === 'fulfilled') {
    const d = gecko.value?.data || {};
    const total = Number(d.total_market_cap?.usd);
    const p = d.market_cap_percentage || {};
    const b = Number(p.btc), e = Number(p.eth), u = Number(p.usdt);
    const updated = Number(d.updated_at) * 1000;
    if (Number.isFinite(total) && total > 0 && [b, e, u].every(Number.isFinite) && updated > 0 && now - updated < 900000) {
      Object.assign(marketCap, {
        available: true, source: 'CoinGecko /global; derived proxies, not TradingView indices',
        asOf: new Date(updated).toISOString(), totalUsd: Math.round(total),
        usdtDominancePct: Number(u.toFixed(4)),
        total2ProxyUsd: Math.round(total * (1 - b / 100)),
        total3ProxyUsd: Math.round(total * (1 - b / 100 - e / 100)),
        note: 'TOTAL2/TOTAL3 subtract BTC/ETH dominance from CoinGecko global cap; constituents and timing may differ from chart indices'
      });
      delete marketCap.reason;
    } else marketCap.reason = 'GLOBAL_MARKET_CAP_STALE_OR_INVALID';
  } else marketCap.reason = String(gecko.reason?.message || gecko.reason);
  const unwrap = r => r.status === 'fulfilled'
    ? { available: !!r.value.frames['15m']?.available, source: 'Binance closed candles; synthetic 45m from closed 15m', ...r.value }
    : { available: false, reason: String(r.reason?.message || r.reason) };
  const result = {
    ok: true, generatedAt: new Date(now).toISOString(),
    btc: unwrap(btc), eth: unwrap(eth), ethbtc: unwrap(ethbtc), marketCap,
    advisoryOnly: true
  };
  globalCache = { at: now, result };
  return result;
}
module.exports = { liquidationHistory, restCvd120, globalContext, symbolContext, preMoveProbe, derivativesContext, modeledLiquidationDensityFromOi, chartContext, atomicMirrorContext, renderChartPng, validSymbol, StreamingMarket, marketStream, liquidationZones, liquidationVelocity, depthImbalance, depthSoftContext, depthDynamics, flowWindowStats, bookTickerFlowStats };
