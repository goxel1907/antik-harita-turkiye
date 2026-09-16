'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.BRAINHUB_ROOT || path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'data', 'scanner-state.json');
const BASE = 'https://fapi.binance.com';
const EXCHANGE_TTL_MS = 10 * 60 * 1000;

let exchangeCache = { at: 0, data: null };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(a, b) {
  a = num(a); b = num(b);
  return a ? ((b - a) / a) * 100 : 0;
}

function round(v, d = 4) {
  const p = 10 ** d;
  return Math.round(num(v) * p) / p;
}

async function jget(endpoint, timeoutMs = 10000) {
  const r = await fetch(BASE + endpoint, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Binance HTTP ${r.status} ${endpoint}`);
  return r.json();
}

async function exchangeInfo() {
  if (exchangeCache.data && Date.now() - exchangeCache.at < EXCHANGE_TTL_MS) return exchangeCache.data;
  const data = await jget('/fapi/v1/exchangeInfo', 12000);
  exchangeCache = { at: Date.now(), data };
  return data;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return { ts: 0, bySymbol: {} };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_PATH);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { symbol: items[i]?.symbol || String(items[i]), error: String(e?.message || e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function tfStats(k) {
  if (!Array.isArray(k) || k.length < 2) return { mom: 0, taker: 0.5 };
  const first = num(k[0][4]);
  const last = num(k[k.length - 1][4]);
  let quote = 0, takerBuyQuote = 0;
  for (const x of k) {
    quote += num(x[7]);
    takerBuyQuote += num(x[10]);
  }
  return {
    mom: pct(first, last),
    taker: quote > 0 ? takerBuyQuote / quote : 0.5
  };
}

async function enrich(x, book, premium, prev) {
  const s = encodeURIComponent(x.symbol);
  const [k1, k3, k5, oi] = await Promise.all([
    jget(`/fapi/v1/klines?symbol=${s}&interval=1m&limit=4`, 9000),
    jget(`/fapi/v1/klines?symbol=${s}&interval=3m&limit=4`, 9000),
    jget(`/fapi/v1/klines?symbol=${s}&interval=5m&limit=4`, 9000),
    jget(`/fapi/v1/openInterest?symbol=${s}`, 9000)
  ]);

  const a = tfStats(k1), b = tfStats(k3), c = tfStats(k5);
  const bid = num(book?.bidPrice), ask = num(book?.askPrice);
  const mid = (bid + ask) / 2;
  const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : 999;
  const oiNow = num(oi.openInterest);
  const oiPrev = num(prev?.oi);
  const oiDeltaPct = oiPrev > 0 ? pct(oiPrev, oiNow) : 0;
  const taker = (a.taker + b.taker + c.taker) / 3;
  const directionalMomentum = a.mom * 0.50 + b.mom * 0.30 + c.mom * 0.20;
  const side = directionalMomentum >= 0 ? 'LONG' : 'SHORT';

  const momentumScore = Math.abs(a.mom) * 4 + Math.abs(b.mom) * 2 + Math.abs(c.mom) * 1.25;
  const flowScore = Math.abs(taker - 0.5) * 200 * 0.12;
  const oiScore = Math.min(Math.abs(oiDeltaPct), 10) * 0.6;
  const spreadScore = Math.max(0, 2 - Math.min(spreadBps, 20) * 0.10);
  const attackScore = momentumScore + flowScore + oiScore + spreadScore;
  const tradeQuality = Math.max(0, Math.min(100,
    100 - Math.min(spreadBps * 5, 50) - Math.min(x.volumeRank * 0.35, 30)
  ));

  return {
    symbol: x.symbol,
    side,
    attackScore: round(attackScore, 3),
    tradeQuality: round(tradeQuality, 1),
    m1: round(a.mom, 4),
    m3: round(b.mom, 4),
    m5: round(c.mom, 4),
    takerBuyRatio: round(taker, 4),
    openInterest: round(oiNow, 4),
    oiDeltaPct: round(oiDeltaPct, 4),
    spreadBps: round(spreadBps, 3),
    fundingRate: round(num(premium?.lastFundingRate) * 100, 5),
    priceChange24hPct: round(x.priceChangePercent, 3),
    quoteVolume24h: round(x.quoteVolume, 0),
    volumeRank: x.volumeRank
  };
}

function addLeaderHunterFields(x, rank, prevRow) {
  const oldRank = num(prevRow?.rank);
  const prevVelocity = num(prevRow?.rankVelocity);
  const rankVelocity = oldRank > 0 ? oldRank - rank : 0;
  const rankAcceleration = rankVelocity - prevVelocity;
  const dirSign = x.side === 'LONG' ? 1 : -1;
  const directionSupport = [x.m1, x.m3, x.m5].filter(v => num(v) * dirSign > 0).length;
  const flowSupport = x.side === 'LONG' ? x.takerBuyRatio >= 0.52 : x.takerBuyRatio <= 0.48;
  const oiSupport = num(x.oiDeltaPct) > 0.05;
  const spreadSupport = num(x.spreadBps) <= 8;

  const leaderHunterScore =
    num(x.attackScore) +
    Math.max(0, rankVelocity) * 1.8 +
    Math.max(0, rankAcceleration) * 0.8 +
    directionSupport * 2.5 +
    (flowSupport ? 4 : 0) +
    (oiSupport ? 2 : 0) +
    (spreadSupport ? 2 : 0) +
    num(x.tradeQuality) * 0.04;

  const top5Confirmed =
    rank <= 5 &&
    directionSupport >= 2 &&
    x.tradeQuality >= 55 &&
    spreadSupport;

  const earlyTop5 =
    rank > 5 && rank <= 15 &&
    rankVelocity >= 2 &&
    rankAcceleration >= -1 &&
    directionSupport >= 2 &&
    x.tradeQuality >= 60 &&
    spreadSupport &&
    (flowSupport || oiSupport);

  let leaderState = 'WATCH';
  if (top5Confirmed) leaderState = 'TOP5_CONFIRMED';
  else if (earlyTop5) leaderState = 'EARLY_TOP5';
  else if (rankVelocity >= 2 && directionSupport >= 2) leaderState = 'RISING';

  Object.assign(x, {
    attackRank: rank,
    rankVelocity,
    rankAcceleration,
    directionSupport,
    flowSupport,
    oiSupport,
    spreadSupport,
    leaderHunterScore: round(leaderHunterScore, 3),
    top5Confirmed,
    earlyTop5,
    leaderState
  });
}

async function performScan() {
  const started = Date.now();
  const prev = readState();
  const [ex, tickers, books, premiums] = await Promise.all([
    exchangeInfo(),
    jget('/fapi/v1/ticker/24hr', 15000),
    jget('/fapi/v1/ticker/bookTicker', 12000),
    jget('/fapi/v1/premiumIndex', 12000)
  ]);

  const allowed = new Set((ex.symbols || [])
    .filter(x => x.quoteAsset === 'USDT' && x.contractType === 'PERPETUAL' && x.status === 'TRADING')
    .map(x => x.symbol));

  const bookMap = new Map((books || []).map(x => [x.symbol, x]));
  const premiumMap = new Map((premiums || []).map(x => [x.symbol, x]));

  const universe = (tickers || [])
    .filter(x => allowed.has(x.symbol))
    .map(x => ({
      symbol: x.symbol,
      quoteVolume: num(x.quoteVolume),
      priceChangePercent: num(x.priceChangePercent),
      lastPrice: num(x.lastPrice)
    }))
    .filter(x => x.quoteVolume > 0 && x.lastPrice > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  universe.forEach((x, i) => { x.volumeRank = i + 1; });

  const liquid = universe.slice(0, 80);
  const candidates = liquid
    .map(x => ({
      ...x,
      preScore: Math.abs(x.priceChangePercent) * 0.75 + Math.max(0, 22 - x.volumeRank * 0.15)
    }))
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, 24);

  const enriched = await mapLimit(candidates, 8, x => enrich(
    x,
    bookMap.get(x.symbol),
    premiumMap.get(x.symbol),
    prev.bySymbol?.[x.symbol]
  ));

  const good = enriched.filter(x => !x.error).sort((a, b) => b.attackScore - a.attackScore);
  good.forEach((x, i) => addLeaderHunterFields(x, i + 1, prev.bySymbol?.[x.symbol]));

  const now = Date.now();
  const next = { ts: now, bySymbol: {} };
  for (const x of good) {
    const oldHistory = Array.isArray(prev.bySymbol?.[x.symbol]?.history)
      ? prev.bySymbol[x.symbol].history
      : [];
    const history = [...oldHistory, {
      ts: now,
      rank: x.attackRank,
      attackScore: x.attackScore,
      leaderHunterScore: x.leaderHunterScore
    }].slice(-6);

    next.bySymbol[x.symbol] = {
      rank: x.attackRank,
      oi: x.openInterest,
      rankVelocity: x.rankVelocity,
      leaderHunterScore: x.leaderHunterScore,
      history
    };
  }
  writeState(next);

  const leaderHunters = [...good].sort((a, b) => b.leaderHunterScore - a.leaderHunterScore);

  return {
    ok: true,
    source: 'Binance USDT-M public API',
    generatedAt: new Date().toISOString(),
    activeUsdtPerpetuals: allowed.size,
    universeCount: universe.length,
    liquidPrefilter: liquid.length,
    analyzed: good.length,
    failed: enriched.filter(x => x.error),
    scanMs: Date.now() - started,
    leaders: good.slice(0, 15),
    leaderHunters: leaderHunters.slice(0, 15),
    earlyTop5: leaderHunters.filter(x => x.earlyTop5).slice(0, 10),
    top5Confirmed: leaderHunters.filter(x => x.top5Confirmed).slice(0, 5)
  };
}

let inFlight = null;
let cache = null;
async function scan() {
  if (cache && Date.now() - cache.at < 15000) return { ...cache.result, cacheAgeMs: Date.now() - cache.at };
  if (inFlight) return inFlight;
  inFlight = performScan().then(result => {
    cache = { at: Date.now(), result };
    return result;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = { scan };
