'use strict';

const { FRAMES, analyzeFrames, microstructure } = require('./engine');

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
    while (next < FRAMES.length) {
      const frame = FRAMES[next++];
      try { result[frame] = await getJson(base, `${path}?symbol=${symbol}&interval=${frame}&limit=72`, 12000); }
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
    source: 'Binance USDT-M public REST; closed candles only',
    timeframes: frames.value.frames, timeframeErrors: frames.value.errors,
    microstructure: micro,
    limitations: ['REST depth snapshots do not prove resting-liquidity persistence or true OFI', 'Recent aggTrades are sampled CVD, not full session CVD', 'FVG and swing levels are structural context, not executable prices']
  };
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
    ? { available: !!r.value.frames['15m']?.available, source: 'Binance closed candles', ...r.value }
    : { available: false, reason: String(r.reason?.message || r.reason) };
  const result = {
    ok: true, generatedAt: new Date(now).toISOString(),
    btc: unwrap(btc), eth: unwrap(eth), ethbtc: unwrap(ethbtc), marketCap,
    advisoryOnly: true
  };
  globalCache = { at: now, result };
  return result;
}
module.exports = { globalContext, symbolContext, validSymbol };
