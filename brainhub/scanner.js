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
function cap100(v) { return Math.max(0, Math.min(100, num(v))); }

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
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return { ts: 0, bySymbol: {} }; }
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
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { symbol: items[i]?.symbol || String(items[i]), error: String(e?.message || e) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function tfStats(k, now = Date.now()) {
  const closed = Array.isArray(k) ? k.filter(x => Number(x?.[6]) > 0 && Number(x[6]) < now) : [];
  if (closed.length < 2) return { mom:0, taker:0.5, volumeAcceleration:0, rangeExpansion:0, avgRangePct:0, closed:closed.length };
  const first = num(closed[0][4]);
  const last = num(closed.at(-1)[4]);
  let quote = 0, takerBuyQuote = 0;
  for (const x of closed) { quote += num(x[7]); takerBuyQuote += num(x[10]); }
  const q = closed.map(x => num(x[7]));
  const prevQ = q.slice(0, -1);
  const prevQAvg = prevQ.length ? prevQ.reduce((s,v)=>s+v,0) / prevQ.length : 0;
  const volumeAcceleration = prevQAvg > 0 ? q.at(-1) / prevQAvg - 1 : 0;
  const ranges = closed.map(x => {
    const close = num(x[4]);
    return close > 0 ? (num(x[2]) - num(x[3])) / close * 100 : 0;
  });
  const prevR = ranges.slice(0, -1);
  const prevRAvg = prevR.length ? prevR.reduce((s,v)=>s+v,0) / prevR.length : 0;
  const rangeExpansion = prevRAvg > 0 ? ranges.at(-1) / prevRAvg - 1 : 0;
  return {
    mom: pct(first, last),
    taker: quote > 0 ? takerBuyQuote / quote : 0.5,
    volumeAcceleration,
    rangeExpansion,
    avgRangePct: ranges.reduce((s,v)=>s+v,0) / ranges.length,
    closed: closed.length
  };
}

function scoreExpansion({ a, b, c, oiDeltaPct, spreadBps, fundingPct = 0 }) {
  const taker = (a.taker + b.taker + c.taker) / 3;
  const directionalMomentum = a.mom * 0.50 + b.mom * 0.30 + c.mom * 0.20;
  const volAccel = a.volumeAcceleration * 0.50 + b.volumeAcceleration * 0.30 + c.volumeAcceleration * 0.20;
  const rangeExpansion = a.rangeExpansion * 0.50 + b.rangeExpansion * 0.30 + c.rangeExpansion * 0.20;
  const sharedExpansion =
    Math.max(0, Math.min(volAccel, 3)) * 8 +
    Math.max(0, Math.min(rangeExpansion, 3)) * 6 +
    Math.min(Math.abs(oiDeltaPct), 5) * 2;
  const longMomentum = Math.max(0, directionalMomentum) * 18 + Math.max(0, a.mom) * 10 + Math.max(0, b.mom) * 5;
  const shortMomentum = Math.max(0, -directionalMomentum) * 18 + Math.max(0, -a.mom) * 10 + Math.max(0, -b.mom) * 5;
  const longFlow = Math.max(0, taker - 0.5) * 100 * 0.70;
  const shortFlow = Math.max(0, 0.5 - taker) * 100 * 0.70;
  const longCrowdingPenalty = Math.max(0, fundingPct - 0.03) * 25;
  const shortCrowdingPenalty = Math.max(0, -0.03 - fundingPct) * 25;
  const spreadPenalty = Math.max(0, spreadBps - 8) * 1.2;
  const longExpansionScore = cap100(longMomentum + sharedExpansion + longFlow - longCrowdingPenalty - spreadPenalty);
  const shortExpansionScore = cap100(shortMomentum + sharedExpansion + shortFlow - shortCrowdingPenalty - spreadPenalty);
  const movementPotential = cap100(
    Math.abs(directionalMomentum) * 18 +
    Math.max(0, Math.min(volAccel, 3)) * 10 +
    Math.max(0, Math.min(rangeExpansion, 3)) * 8 +
    Math.min(Math.abs(oiDeltaPct), 5) * 2 +
    Math.abs(taker - 0.5) * 100 * 0.45
  );
  return { taker, directionalMomentum, volAccel, rangeExpansion, longExpansionScore, shortExpansionScore, movementPotential };
}

function candidatePreScore(x) {
  return Math.min(x.range24hPct,40) * 0.85 +
    Math.min(Math.abs(x.priceChangePercent),40) * 0.25 +
    Math.max(0, 8 - x.volumeRank * 0.04);
}

function selectCandidates(universe, limit = 32) {
  const liquidTop = universe.slice(0,100);
  const volatileTop = [...universe].sort((a,b)=>b.range24hPct-a.range24hPct).slice(0,100);
  const gainerTop = [...universe]
    .filter(x => x.priceChangePercent > 0)
    .sort((a,b)=>b.priceChangePercent-a.priceChangePercent)
    .slice(0,10);
  const loserTop = [...universe]
    .filter(x => x.priceChangePercent < 0)
    .sort((a,b)=>a.priceChangePercent-b.priceChangePercent)
    .slice(0,10);

  const prefilterMap = new Map();
  for (const x of [...liquidTop,...volatileTop,...gainerTop,...loserTop]) prefilterMap.set(x.symbol,x);
  const prefilter = [...prefilterMap.values()];
  const scored = prefilter
    .map(x => ({ ...x, preScore:candidatePreScore(x) }))
    .sort((a,b)=>b.preScore-a.preScore);

  const forcedSymbols = new Set([...gainerTop,...loserTop].map(x => x.symbol));
  const bySymbol = new Map(scored.map(x => [x.symbol,x]));
  const forced = [...gainerTop,...loserTop].map(x => bySymbol.get(x.symbol)).filter(Boolean);
  const remainder = scored.filter(x => !forcedSymbols.has(x.symbol));
  const candidates = [...forced,...remainder].slice(0,limit);

  return { liquidTop, volatileTop, gainerTop, loserTop, prefilter, candidates };
}

async function enrich(x, book, premium, prev) {
  const s = encodeURIComponent(x.symbol);
  const now = Date.now();
  const [k1, k3, k5, oi] = await Promise.all([
    jget(`/fapi/v1/klines?symbol=${s}&interval=1m&limit=7`, 9000),
    jget(`/fapi/v1/klines?symbol=${s}&interval=3m&limit=7`, 9000),
    jget(`/fapi/v1/klines?symbol=${s}&interval=5m&limit=7`, 9000),
    jget(`/fapi/v1/openInterest?symbol=${s}`, 9000)
  ]);
  const a = tfStats(k1, now), b = tfStats(k3, now), c = tfStats(k5, now);
  const bid = num(book?.bidPrice), ask = num(book?.askPrice);
  const mid = (bid + ask) / 2;
  const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : 999;
  const oiNow = num(oi.openInterest);
  const oiPrev = num(prev?.oi);
  const oiDeltaPct = oiPrev > 0 ? pct(oiPrev, oiNow) : 0;
  const fundingPct = num(premium?.lastFundingRate) * 100;
  const scores = scoreExpansion({ a, b, c, oiDeltaPct, spreadBps, fundingPct });
  const side = scores.longExpansionScore === scores.shortExpansionScore
    ? (scores.directionalMomentum >= 0 ? 'LONG' : 'SHORT')
    : scores.longExpansionScore > scores.shortExpansionScore ? 'LONG' : 'SHORT';
  const directionalScore = Math.max(scores.longExpansionScore, scores.shortExpansionScore);
  const attackScore = scores.movementPotential * 0.60 + directionalScore * 0.40;
  const tradeQuality = cap100(
    100 - Math.min(spreadBps * 5, 50) - Math.min(x.volumeRank * 0.30, 28)
  );
  return {
    symbol: x.symbol,
    side,
    attackScore: round(attackScore, 3),
    movementPotential: round(scores.movementPotential, 1),
    longExpansionScore: round(scores.longExpansionScore, 1),
    shortExpansionScore: round(scores.shortExpansionScore, 1),
    tradeQuality: round(tradeQuality, 1),
    m1: round(a.mom, 4), m3: round(b.mom, 4), m5: round(c.mom, 4),
    volumeAcceleration: round(scores.volAccel, 4),
    rangeExpansion: round(scores.rangeExpansion, 4),
    avgRange1mPct: round(a.avgRangePct, 4),
    closedSamples: { m1:a.closed, m3:b.closed, m5:c.closed },
    takerBuyRatio: round(scores.taker, 4),
    openInterest: round(oiNow, 4),
    oiDeltaPct: round(oiDeltaPct, 4),
    spreadBps: round(spreadBps, 3),
    fundingRate: round(fundingPct, 5),
    priceChange24hPct: round(x.priceChangePercent, 3),
    range24hPct: round(x.range24hPct, 3),
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
  const oiSupport = Math.abs(num(x.oiDeltaPct)) > 0.05;
  const spreadSupport = num(x.spreadBps) <= 8;
  const expansionScore = x.side === 'LONG' ? num(x.longExpansionScore) : num(x.shortExpansionScore);
  const leaderHunterScore =
    num(x.attackScore) +
    Math.max(0, rankVelocity) * 1.8 +
    Math.max(0, rankAcceleration) * 0.8 +
    directionSupport * 2.5 +
    (flowSupport ? 4 : 0) +
    (oiSupport ? 2 : 0) +
    (spreadSupport ? 2 : 0) +
    expansionScore * 0.08 +
    num(x.tradeQuality) * 0.04;
  const top5Confirmed = rank <= 5 && directionSupport >= 2 && x.tradeQuality >= 55 && spreadSupport && expansionScore >= 35;
  const earlyTop5 = rank > 5 && rank <= 15 && rankVelocity >= 2 && rankAcceleration >= -1 && directionSupport >= 2 && x.tradeQuality >= 60 && spreadSupport && expansionScore >= 35 && (flowSupport || oiSupport);
  const earlyExpansion = num(x.movementPotential) >= 45 && expansionScore >= 45 && x.tradeQuality >= 58 && spreadSupport;
  let leaderState = 'WATCH';
  if (top5Confirmed) leaderState = 'TOP5_CONFIRMED';
  else if (earlyTop5) leaderState = 'EARLY_TOP5';
  else if (earlyExpansion) leaderState = 'EARLY_EXPANSION';
  else if (rankVelocity >= 2 && directionSupport >= 2) leaderState = 'RISING';
  Object.assign(x, {
    attackRank: rank, rankVelocity, rankAcceleration, directionSupport, flowSupport, oiSupport, spreadSupport,
    expansionScore: round(expansionScore,1),
    leaderHunterScore: round(leaderHunterScore,3),
    top5Confirmed, earlyTop5, earlyExpansion, leaderState
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
  const allowed = new Set((ex.symbols || []).filter(x => x.quoteAsset === 'USDT' && x.contractType === 'PERPETUAL' && x.status === 'TRADING').map(x => x.symbol));
  const bookMap = new Map((books || []).map(x => [x.symbol, x]));
  const premiumMap = new Map((premiums || []).map(x => [x.symbol, x]));
  const universe = (tickers || [])
    .filter(x => allowed.has(x.symbol))
    .map(x => {
      const lastPrice=num(x.lastPrice), high=num(x.highPrice), low=num(x.lowPrice);
      return {
        symbol:x.symbol,
        quoteVolume:num(x.quoteVolume),
        priceChangePercent:num(x.priceChangePercent),
        lastPrice,
        range24hPct:lastPrice>0?(high-low)/lastPrice*100:0
      };
    })
    .filter(x => x.quoteVolume > 0 && x.lastPrice > 0)
    .sort((a,b)=>b.quoteVolume-a.quoteVolume);
  universe.forEach((x,i)=>{x.volumeRank=i+1;});

  const selection = selectCandidates(universe,32);
  const { liquidTop, volatileTop, gainerTop, loserTop, prefilter, candidates } = selection;

  const enriched = await mapLimit(candidates,8,x=>enrich(x,bookMap.get(x.symbol),premiumMap.get(x.symbol),prev.bySymbol?.[x.symbol]));
  const good = enriched.filter(x=>!x.error).sort((a,b)=>b.attackScore-a.attackScore);
  good.forEach((x,i)=>addLeaderHunterFields(x,i+1,prev.bySymbol?.[x.symbol]));

  const now=Date.now();
  const next={ts:now,bySymbol:{}};
  for(const x of good){
    const oldHistory=Array.isArray(prev.bySymbol?.[x.symbol]?.history)?prev.bySymbol[x.symbol].history:[];
    const history=[...oldHistory,{ts:now,rank:x.attackRank,attackScore:x.attackScore,leaderHunterScore:x.leaderHunterScore,movementPotential:x.movementPotential,longExpansionScore:x.longExpansionScore,shortExpansionScore:x.shortExpansionScore}].slice(-8);
    next.bySymbol[x.symbol]={rank:x.attackRank,oi:x.openInterest,rankVelocity:x.rankVelocity,leaderHunterScore:x.leaderHunterScore,history};
  }
  writeState(next);
  const leaderHunters=[...good].sort((a,b)=>b.leaderHunterScore-a.leaderHunterScore);
  const earlyExpansion=[...leaderHunters].filter(x=>x.earlyExpansion).sort((a,b)=>b.movementPotential-a.movementPotential||b.expansionScore-a.expansionScore);
  const longExpansion=[...leaderHunters].sort((a,b)=>b.longExpansionScore-a.longExpansionScore).slice(0,10);
  const shortExpansion=[...leaderHunters].sort((a,b)=>b.shortExpansionScore-a.shortExpansionScore).slice(0,10);
  return {
    ok:true,
    source:'Binance USDT-M public API; short-horizon stats use closed 1m/3m/5m candles only',
    generatedAt:new Date().toISOString(),
    activeUsdtPerpetuals:allowed.size,
    universeCount:universe.length,
    liquidPrefilter:liquidTop.length,
    volatilePrefilter:volatileTop.length,
    gainerPrefilter:gainerTop.length,
    loserPrefilter:loserTop.length,
    combinedPrefilter:prefilter.length,
    analyzed:good.length,
    failed:enriched.filter(x=>x.error),
    scanMs:Date.now()-started,
    leaders:good.slice(0,15),
    leaderHunters:leaderHunters.slice(0,15),
    earlyExpansion:earlyExpansion.slice(0,12),
    longExpansion,
    shortExpansion,
    earlyTop5:leaderHunters.filter(x=>x.earlyTop5).slice(0,10),
    top5Confirmed:leaderHunters.filter(x=>x.top5Confirmed).slice(0,5),
    notes:[
      'Top-10 24h gainers and top-10 24h losers are guaranteed deep-scan candidates before remaining slots are ranked',
      'Volume rank is liquidity context only and no longer gets a dominant prefilter bonus',
      'LONG and SHORT expansion scores are separate hypotheses, not trade guarantees',
      'movementPotential is direction-neutral expansion context',
      'forming candles are excluded from short-horizon confirmation stats'
    ]
  };
}

let inFlight=null;
let cache=null;
async function scan(){
  if(cache&&Date.now()-cache.at<15000)return {...cache.result,cacheAgeMs:Date.now()-cache.at};
  if(inFlight)return inFlight;
  inFlight=performScan().then(result=>{cache={at:Date.now(),result};return result;}).finally(()=>{inFlight=null;});
  return inFlight;
}

module.exports={scan,tfStats,scoreExpansion,selectCandidates};
