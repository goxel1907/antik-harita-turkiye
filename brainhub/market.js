'use strict';

const zlib = require('zlib');
const { FRAMES, NATIVE_FRAMES, analyzeFrames, microstructure, parseKlines, aggregate45m, structure } = require('./engine');

const FUTURES = 'https://fapi.binance.com';
const SPOT = 'https://api.binance.com';
const GECKO = 'https://api.coingecko.com/api/v3';
const FUTURES_WS = 'wss://fstream.binance.com/ws';
const frameCache = new Map();
const depthCache = new Map();
const derivativesCache = new Map();
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
    this.ws = null;
    this.connecting = false;
    this.reconnectTimer = null;
    this.reconnectMs = 1000;
    this.states = new Map();
    this.subscribed = new Set();
    this.subscriptionId = 1;
    this.maxSymbols = 80;
    this.tradeWindowMs = 120000;
    this.liquidationWindowMs = 15 * 60 * 1000;
    this.staleMs = 15000;
  }
  ensureSymbol(symbol) {
    symbol = String(symbol || '').toUpperCase();
    if (!validSymbol(symbol)) throw new Error('invalid USDT perpetual symbol');
    if (!this.states.has(symbol)) {
      if (this.states.size >= this.maxSymbols) throw new Error('stream symbol capacity reached');
      this.states.set(symbol, {
        symbol, lastEventAt:0, book:null, depth:null, depthAt:0,
        depthHistory:[], lastDepthHistoryAt:0,
        trades:[], tradeAt:0, liquidations:[], liquidationAt:0
      });
    }
    this.subscribed.add(symbol);
    this.connect();
    this.subscribeSymbols([symbol]);
    return this.states.get(symbol);
  }
  connect() {
    if (!this.WebSocketImpl || this.ws || this.connecting || !this.subscribed.size) return;
    this.connecting = true;
    let ws;
    try { ws = new this.WebSocketImpl(FUTURES_WS); }
    catch { this.connecting = false; this.scheduleReconnect(); return; }
    this.ws = ws;
    const on = (name, fn) => {
      if (typeof ws.addEventListener === 'function') ws.addEventListener(name, fn);
      else ws['on' + name] = fn;
    };
    on('open', () => {
      this.connecting = false;
      this.reconnectMs = 1000;
      this.subscribeSymbols([...this.subscribed], true);
    });
    on('message', async event => {
      try {
        let raw = event?.data;
        if (raw && typeof raw.text === 'function') raw = await raw.text();
        else if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString('utf8');
        else if (ArrayBuffer.isView(raw)) raw = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        this.ingest(msg);
      } catch { }
    });
    on('error', () => { });
    on('close', () => {
      if (this.ws === ws) this.ws = null;
      this.connecting = false;
      this.scheduleReconnect();
    });
  }
  scheduleReconnect() {
    if (!this.WebSocketImpl || !this.subscribed.size || this.reconnectTimer) return;
    const delay = Math.min(this.reconnectMs, 30000);
    this.reconnectMs = Math.min(delay * 2, 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
  }
  subscribeSymbols(symbols, force = false) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || typeof ws.send !== 'function') return;
    const params = [];
    for (const symbol of symbols) {
      if (!force && !this.subscribed.has(symbol)) continue;
      const s = symbol.toLowerCase();
      params.push(`${s}@aggTrade`, `${s}@bookTicker`, `${s}@depth20@100ms`, `${s}@forceOrder`);
    }
    if (!params.length) return;
    try { ws.send(JSON.stringify({ method:'SUBSCRIBE', params, id:this.subscriptionId++ })); }
    catch { }
  }
  cleanup(state, now = this.now()) {
    state.trades = state.trades.filter(x => now - x.at <= this.tradeWindowMs && now >= x.at);
    state.liquidations = state.liquidations.filter(x => now - x.at <= this.liquidationWindowMs && now >= x.at);
    state.depthHistory = (Array.isArray(state.depthHistory)?state.depthHistory:[]).filter(x => now - x.at <= 90000 && now >= x.at).slice(-180);
  }
  ingest(message) {
    const data = message?.data && typeof message.data === 'object' ? message.data : message;
    if (!data || typeof data !== 'object') return false;
    const eventType = String(data.e || '');
    const symbol = String(data.s || data.o?.s || '').toUpperCase();
    if (!validSymbol(symbol)) return false;
    const state = this.states.get(symbol) || this.ensureSymbol(symbol);
    const now = this.now();
    const eventAt = finite(data.E) ?? finite(data.T) ?? finite(data.o?.T) ?? now;
    state.lastEventAt = Math.max(state.lastEventAt, eventAt || now);
    if (eventType === 'bookTicker') {
      const bid = finite(data.b), ask = finite(data.a), bidQty = finite(data.B), askQty = finite(data.A);
      if (bid > 0 && ask > bid) state.book = { bid, ask, bidQty, askQty, at:eventAt || now };
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
    const flow10=flowWindowStats(state.trades,now,10000), flow30=flowWindowStats(state.trades,now,30000), flow120=flowWindowStats(state.trades,now,120000);
    const dynamics=depthDynamics(state.depthHistory,state.trades,now,mid || state.book?.bid || state.book?.ask || 0);
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
      cvdAsOf:state.tradeAt || null,
      orderFlow:{windows:{'10s':flow10,'30s':flow30,'120s':flow120},semantics:'PUBLIC_AGGTRADE_EVIDENCE_ONLY'},
      depthDynamics:dynamics,
      observedLiquidations:{
        available:state.liquidations.length > 0,
        windowMs:this.liquidationWindowMs,
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
        'Partial depth20 stream is not a locally sequenced full order book and is not true OFI.',
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
      freshSymbols:fresh,
      warmingOrStaleSymbols:warming,
      endpoint:FUTURES_WS,
      publicOnly:true
    };
  }
  shutdown() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.connecting = false;
    if (ws && typeof ws.close === 'function') {
      try { ws.close(); } catch { }
    }
  }
}

const marketStream = new StreamingMarket();

async function getJson(base, endpoint, timeout = 10000) {
  const res = await fetch(base + endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${new URL(base).hostname} HTTP ${res.status}`);
  return res.json();
}

async function derivativesContext(symbol) {
  if(!validSymbol(symbol))throw new Error('invalid USDT perpetual symbol');
  const now=Date.now();
  const cached=derivativesCache.get(symbol);
  if(cached&&now-cached.at<30000)return cached.result;
  const endpoints=[
    ['/fapi/v1/openInterest?symbol='+symbol,'openInterest'],
    ['/futures/data/openInterestHist?symbol='+symbol+'&period=5m&limit=3','openInterestHist'],
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
  const prev=hist.length>=2?Number(hist.at(-2)?.sumOpenInterestValue||hist.at(-2)?.sumOpenInterest):null;
  const last=hist.length?Number(hist.at(-1)?.sumOpenInterestValue||hist.at(-1)?.sumOpenInterest):null;
  const oiDeltaPct=Number.isFinite(prev)&&prev!==0&&Number.isFinite(last)?(last-prev)/prev*100:null;
  const lastRow=x=>Array.isArray(x)&&x.length?x.at(-1):null;
  const tak=lastRow(by.taker), tp=lastRow(by.topPosition), ta=lastRow(by.topAccount), ga=lastRow(by.globalAccount);
  const out={
    available:Boolean(by.openInterest||by.premium||tak||tp||ta||ga),
    source:'Binance USD-M public REST',
    asOf:now,
    openInterest:{
      current:finite(by.openInterest?.openInterest),
      time:finite(by.openInterest?.time),
      delta5mPct:oiDeltaPct===null?null:round(oiDeltaPct,4),
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
    semantics:'DERIVATIVES_POSITIONING_CONTEXT_ONLY',
    note:'Open interest, funding, taker flow and long/short ratios are contextual evidence. Top-trader ratios do not identify market makers and do not independently qualify a trade.'
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
async function symbolContext(symbol, options = {}) {
  if (!validSymbol(symbol)) throw new Error('invalid USDT perpetual symbol');
  marketStream.ensureSymbol(symbol);
  const [frames, depthResult, tradeResult, derivativesResult] = await Promise.allSettled([
    options?.frameSnapshot ? Promise.resolve(options.frameSnapshot) : frameSet(symbol),
    getJson(FUTURES, `/fapi/v1/depth?symbol=${symbol}&limit=20`, 9000),
    getJson(FUTURES, `/fapi/v1/aggTrades?symbol=${symbol}&limit=100`, 9000),
    derivativesContext(symbol)
  ]);
  if (frames.status !== 'fulfilled') throw frames.reason;
  const now = Date.now();
  const micro = depthResult.status === 'fulfilled'
    ? microstructure(depthResult.value, tradeResult.status === 'fulfilled' ? tradeResult.value : [], depthCache.get(symbol), now)
    : { available: false, reason: String(depthResult.reason?.message || depthResult.reason) };
  if (micro.snapshot) {
    depthCache.set(symbol, micro.snapshot);
    delete micro.snapshot;
  }
  const streaming = marketStream.snapshot(symbol, now);
  const derivatives = derivativesResult.status==='fulfilled' ? derivativesResult.value : {available:false,reason:String(derivativesResult.reason?.message||derivativesResult.reason||'DERIVATIVES_UNAVAILABLE')};
  micro.sourceQuality = 'REST_SNAPSHOT_APPROX';
  micro.derivatives = derivatives;
  micro.streaming = streaming;
  micro.observedLiquidations = streaming.observedLiquidations || {
    available:false, count:0, longLiquidatedQuote:0, shortLiquidatedQuote:0, zones:[], semantics:'OBSERVED_BINANCE_FORCE_ORDER_ONLY'
  };
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
      micro.cvdSource = 'BINANCE_WS_AGGTRADE_120S';
    }
    micro.ofiNote = 'REST two-snapshot OFI proxy may be present as fallback context; partial depth20 streaming is not true sequenced local-book OFI.';
  }
  return {
    ok: true, symbol, generatedAt: new Date(now).toISOString(),
    source: 'Binance USDT-M public REST + public WebSocket when fresh; closed candles only; 45m causally aggregated from three closed 15m candles',
    timeframes: frames.value.frames, timeframeErrors: frames.value.errors,
    microstructure: micro,
    derivatives,
    streamHealth: marketStream.health(),
    limitations: [
      'Streaming depth20 is a partial book and does not prove resting-liquidity persistence or true sequenced OFI',
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
  const left = 24, right = width - 190, top = 22, priceBottom = 555, volumeTop = 585, bottom = 700;
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
    '0':'111101101101111','1':'010110010010111','2':'110001111100111','3':'110001111001110','4':'101101111001001','5':'111100110001110','6':'011100111101010','7':'111001010010010','8':'010101010101010','9':'010101111001110',
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
    const addLevel=(price,text,col)=>{const p=Number(price);if(Number.isFinite(p)&&p>=pmin&&p<=pmax)levelLabels.push({price:p,y:yPrice(p),text:`${text} ${fmtP(p)}`,col});};
    const addZoneLabel=(z,text,col)=>{const lo=Number(z?.low),hi=Number(z?.high);if(Number.isFinite(lo)&&Number.isFinite(hi))addLevel((lo+hi)/2,text,col);};
    const renderLabels=()=>{
      const rows=levelLabels.sort((a,b)=>a.y-b.y);let lastY=-999;
      for(const r of rows){let y=Math.max(top,Math.min(priceBottom-11,Math.round(r.y)-5));if(y-lastY<11)y=lastY+11;if(y>priceBottom-11)continue;lastY=y;
        const w=Math.min(176,textWidth(r.text,2)+8);fillRect(right+4,y-2,right+4+w,y+10,[20,25,32,255]);drawText(right+8,y,r.text,r.col,2);
      }
    };
    path(emaSeries(20),[255,193,7,255]);
    path(emaSeries(50),[156,92,204,255]);
    const a=chart.analysis||{};

    // R2541: dealing range bands/levels. Outside-range state is supplied by engine.js.
    const dr=a?.smcContext?.dealingRange||{};
    const drLow=Number(dr.low),drHigh=Number(dr.high),drEq=Number(dr.equilibrium);
    if(Number.isFinite(drLow)&&Number.isFinite(drHigh)&&drHigh>drLow){
      if(Number.isFinite(drEq)){
        blendRect(left,yPrice(drHigh),right,yPrice(drEq),[255,87,34],0.035);
        blendRect(left,yPrice(drEq),right,yPrice(drLow),[33,150,243],0.035);
      }
      line(left,yPrice(drHigh),right,yPrice(drHigh),[255,112,67,255]);addLevel(drHigh,'ARALIK UST',[255,112,67,255]);
      line(left,yPrice(drLow),right,yPrice(drLow),[66,165,245,255]);addLevel(drLow,'ARALIK ALT',[66,165,245,255]);
      if(Number.isFinite(drEq)){line(left,yPrice(drEq),right,yPrice(drEq),[158,158,158,255]);addLevel(drEq,'ARALIK EQ',[200,200,200,255]);}
    }

    // R2541_CONFIRMED_SWING_TRENDLINES: no close-regression pseudo trend line.
    const trendLines=a?.swingStructure?.trendLines||{};
    const drawTrend=(tl,col,label)=>{
      if(!tl||tl.active!==true)return;
      const x0=xForAt(tl?.from?.at),x1=xForAt(tl?.projected?.at||tl?.to?.at);
      const y0=Number(tl?.from?.price),y1=Number(tl?.projected?.price??tl?.to?.price);
      if(x0===null||x1===null||!Number.isFinite(y0)||!Number.isFinite(y1))return;
      line(x0,yPrice(y0),x1,yPrice(y1),col);line(x0,yPrice(y0)+1,x1,yPrice(y1)+1,col);
      const ty=Math.max(top,Math.min(priceBottom-12,Math.round(yPrice(y1))-11));drawText(Math.min(right-120,x1+6),ty,label,col,2);
    };
    drawTrend(trendLines.upSupport,[0,230,118,255],'TREND HL');
    drawTrend(trendLines.downResistance,[255,82,82,255],'TREND LH');

    const levels=[
      [a.prior20High,'ONCEKI20 H',[0,188,212,255]],
      [a.prior20Low,'ONCEKI20 L',[255,152,0,255]],
      [a.liquidity?.equalHigh?.price,'ESIT H',[232,232,232,255]],
      [a.liquidity?.equalLow?.price,'ESIT L',[232,232,232,255]]
    ];
    for(const [price,name,col] of levels){if(Number.isFinite(Number(price))){line(left,yPrice(price),right,yPrice(price),col);addLevel(price,name,col);}}
    for(const g of Array.isArray(a.recentFairValueGaps)?a.recentFairValueGaps:[]){
      const low=Number(g.low),high=Number(g.high),ce=Number(g.ce50),col=g.side==='BULL'?[76,255,145,255]:[255,112,96,255];
      if(Number.isFinite(low)&&Number.isFinite(high)){
        blendRect(left,yPrice(high),right,yPrice(low),g.side==='BULL'?[46,204,113]:[231,76,60],0.10);
        if(Number.isFinite(ce)){line(left,yPrice(ce),right,yPrice(ce),col);addLevel(ce,`FVG ${g.side==='BULL'?'BOGA':'AYI'} CE50`,col);}
      }
    }
    for(const ob of Array.isArray(a?.orderBlocks?.bullish)?a.orderBlocks.bullish:[]){
      const low=Number(ob.low),high=Number(ob.high);if(!ob.broken&&Number.isFinite(low)&&Number.isFinite(high)){blendRect(left,yPrice(high),right,yPrice(low),[0,150,136],0.12);addZoneLabel(ob,'BOGA OB',[64,224,208,255]);}
    }
    for(const ob of Array.isArray(a?.orderBlocks?.bearish)?a.orderBlocks.bearish:[]){
      const low=Number(ob.low),high=Number(ob.high);if(!ob.broken&&Number.isFinite(low)&&Number.isFinite(high)){blendRect(left,yPrice(high),right,yPrice(low),[244,67,54],0.12);addZoneLabel(ob,'AYI OB',[255,110,100,255]);}
    }
    const ote=a?.smcContext?.oteReference||{};
    const drawZone=(z,col,alpha,label)=>{const low=Number(z?.low),high=Number(z?.high);if(Number.isFinite(low)&&Number.isFinite(high)){blendRect(left,yPrice(high),right,yPrice(low),col,alpha);addZoneLabel(z,label,[220,220,220,255]);}};
    drawZone(ote.longDiscountZone,[33,150,243],0.07,'OTE ALIS');
    drawZone(ote.shortPremiumZone,[255,87,34],0.07,'OTE SATIS');
    const fib=a?.smcContext?.fibLevels?.retracement||{};
    const fibCols={'0.382':[126,87,194,255],'0.5':[255,235,59,255],'0.618':[0,188,212,255],'0.705':[205,220,57,255],'0.786':[255,152,0,255]};
    for(const key of Object.keys(fibCols)){const price=Number(fib[key]);if(Number.isFinite(price)){line(left,yPrice(price),right,yPrice(price),fibCols[key]);addLevel(price,`FIB ${key}`,fibCols[key]);}}

    // Swing/BOS/CHoCH reference levels.
    const swingHi=Number(a?.swingStructure?.lastConfirmedSwingHigh?.price);
    const swingLo=Number(a?.swingStructure?.lastConfirmedSwingLow?.price);
    if(Number.isFinite(swingHi)){const c=['BOS_UP','CHOCH_UP'].includes(a?.swingStructure?.event)?[255,235,59,255]:[120,144,156,255];line(left,yPrice(swingHi),right,yPrice(swingHi),c);addLevel(swingHi,a?.swingStructure?.event==='CHOCH_UP'?'CHOCH H':'SWING H',c);}
    if(Number.isFinite(swingLo)){const c=['BOS_DOWN','CHOCH_DOWN'].includes(a?.swingStructure?.event)?[255,235,59,255]:[120,144,156,255];line(left,yPrice(swingLo),right,yPrice(swingLo),c);addLevel(swingLo,a?.swingStructure?.event==='CHOCH_DOWN'?'CHOCH L':'SWING L',c);}

    // R2541_PATTERN_GEOMETRY: only engine-produced confirmed-pivot coordinates are drawn.
    const patternName={ASCENDING_TRIANGLE:'YUKSELEN UCGEN',DESCENDING_TRIANGLE:'ALCALAN UCGEN',SYMMETRICAL_TRIANGLE:'SIMETRIK UCGEN',RISING_WEDGE:'YUKSELEN KAMA',FALLING_WEDGE:'ALCALAN KAMA',RISING_CHANNEL:'YUKSELEN KANAL',FALLING_CHANNEL:'ALCALAN KANAL',RANGE:'YATAY ARALIK'};
    let patternLabelOffset=0;
    for(const pat of (Array.isArray(a?.patterns)?a.patterns:[]).filter(x=>Array.isArray(x?.geometry?.lines)&&x.geometry.lines.length).slice(-3)){
      const col=String(pat.side||'').toUpperCase()==='LONG'?[74,222,128,255]:String(pat.side||'').toUpperCase()==='SHORT'?[255,99,99,255]:[180,180,220,255];
      for(const gl of pat.geometry.lines){const x0=xForAt(gl?.from?.at),x1=xForAt(gl?.to?.at);const p0=Number(gl?.from?.price),p1=Number(gl?.to?.price);if(x0!==null&&x1!==null&&Number.isFinite(p0)&&Number.isFinite(p1))line(x0,yPrice(p0),x1,yPrice(p1),col);}
      const text=patternName[pat.type]||pat.type;if(text){drawText(left+8,top+6+patternLabelOffset,text,col,2);patternLabelOffset+=12;}
    }

    // Observed Binance force-order liquidation clusters (historical prints only, not a future heatmap).
    for(const z of Array.isArray(options?.observedLiquidations)?options.observedLiquidations:[]){
      const price=Number(z?.price);if(!Number.isFinite(price)||price<pmin||price>pmax)continue;
      const side=String(z?.side||'').toUpperCase();const col=side.includes('LONG')?[255,82,82,255]:side.includes('SHORT')?[0,230,118,255]:[255,255,255,255];
      line(left,yPrice(price),right,yPrice(price),col);line(left,yPrice(price)+1,right,yPrice(price)+1,col);addLevel(price,side.includes('LONG')?'LIKID LONG':'LIKID SHORT',col);
    }

    const lastPx=Number(candles.at(-1)?.close);
    if(Number.isFinite(lastPx)){line(left,yPrice(lastPx),right,yPrice(lastPx),[255,255,255,255]);addLevel(lastPx,'FIYAT',[255,255,255,255]);}
    renderLabels();
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
module.exports = { globalContext, symbolContext, derivativesContext, chartContext, atomicMirrorContext, renderChartPng, validSymbol, StreamingMarket, marketStream, liquidationZones, liquidationVelocity, depthImbalance, depthSoftContext, depthDynamics, flowWindowStats };
