'use strict';

const zlib = require('zlib');
const { FRAMES, NATIVE_FRAMES, analyzeFrames, microstructure, parseKlines, aggregate45m, structure } = require('./engine');

const FUTURES = 'https://fapi.binance.com';
const SPOT = 'https://api.binance.com';
const GECKO = 'https://api.coingecko.com/api/v3';
const frameCache = new Map();
const depthCache = new Map();
let globalCache = { at: 0, result: null };

async function getJson(base, endpoint, timeout = 10000) {
  const res = await fetch(base + endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${new URL(base).hostname} HTTP ${res.status}`);
  return res.json();
}
function validSymbol(s) { return typeof s === 'string' && /^[A-Z0-9]{2,28}USDT$/.test(s); }
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
  const out = { frames: analyzeFrames(result), errors, asOf: Date.now() };
  frameCache.set(cacheKey, { at: Date.now(), result: out });
  return out;
}
async function symbolContext(symbol) {
  if (!validSymbol(symbol)) throw new Error('invalid USDT perpetual symbol');
  const [frames, depthResult, tradeResult] = await Promise.allSettled([
    frameSet(symbol),
    getJson(FUTURES, `/fapi/v1/depth?symbol=${symbol}&limit=20`, 9000),
    getJson(FUTURES, `/fapi/v1/aggTrades?symbol=${symbol}&limit=100`, 9000)
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
  return {
    ok: true, symbol, generatedAt: new Date(now).toISOString(),
    source: 'Binance USDT-M public REST; closed candles only; 45m causally aggregated from three closed 15m candles',
    timeframes: frames.frames, timeframeErrors: frames.errors,
    microstructure: micro,
    limitations: ['REST depth snapshots do not prove resting-liquidity persistence or true OFI', 'Recent aggTrades are sampled CVD, not full session CVD', 'FVG, wick sweeps and liquidity levels are structural context, not executable prices', '45m is synthetic and is not an independent vote']
  };
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
  let candles = parseKlines(raw, now);
  if (frame === '45m') candles = aggregate45m(candles, now);
  candles = candles.slice(-bars);
  if (candles.length < 2) throw new Error('insufficient closed candles for chart');
  const analysis = structure(candles, frame);
  return {
    ok: true,
    symbol,
    frame,
    bars: candles.length,
    requestedBars: bars,
    generatedAt: new Date(now).toISOString(),
    synthetic: frame === '45m',
    source: frame === '45m' ? 'Binance 15m closed candles; causal UTC-aligned 3x aggregation' : `Binance USDT-M ${frame} closed candles`,
    candles: candles.map(x => ({
      openTime:x.openTime, closeTime:x.closeTime, open:x.open, high:x.high, low:x.low, close:x.close,
      volume:x.volume, quoteVolume:x.quoteVolume, takerBuyQuote:x.takerBuyQuote
    })),
    analysis,
    imageContract: {
      clean:'candles + volume only',
      annotated:'candles + volume + EMA20/EMA50 + structural liquidity/FVG overlays',
      formingCandlesIncluded:false,
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
function renderChartPng(chart, mode = 'clean') {
  mode = String(mode || 'clean').toLowerCase();
  if (!['clean','annotated'].includes(mode)) throw new Error('invalid chart mode');
  const candles = Array.isArray(chart?.candles) ? chart.candles : [];
  if (candles.length < 2) throw new Error('chart candles required');
  const width = 1280, height = 720;
  const left = 24, right = width - 24, top = 22, priceBottom = 555, volumeTop = 585, bottom = 700;
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
    path(emaSeries(20),[255,193,7,255]);
    path(emaSeries(50),[156,92,204,255]);
    const a=chart.analysis||{};
    const levels=[
      [a.prior20High,[0,188,212,255]],
      [a.prior20Low,[255,152,0,255]],
      [a.liquidity?.equalHigh?.price,[232,232,232,255]],
      [a.liquidity?.equalLow?.price,[232,232,232,255]]
    ];
    for(const [price,col] of levels){if(Number.isFinite(Number(price)))line(left,yPrice(price),right,yPrice(price),col);}
    for(const g of Array.isArray(a.recentFairValueGaps)?a.recentFairValueGaps:[]){
      const low=Number(g.low),high=Number(g.high);
      if(Number.isFinite(low)&&Number.isFinite(high))blendRect(left,yPrice(high),right,yPrice(low),g.side==='BULL'?[46,204,113]:[231,76,60],0.10);
    }
  }
  line(left,volumeTop-8,right,volumeTop-8,grid);
  return encodePng(width,height,pixels);
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
module.exports = { globalContext, symbolContext, chartContext, renderChartPng, validSymbol };
