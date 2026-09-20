'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.BRAINHUB_ROOT || path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'data', 'scanner-state.json');
const ATTENTION_PATH = path.join(ROOT, 'data', 'scanner-attention.json');
const BASE = 'https://fapi.binance.com';
const ATTENTION_MAX_AGE_MS = 15 * 60 * 1000;
const TARGET_DETAIL_LIMIT = 24;
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
function validUsdtSymbol(s) { return typeof s === 'string' && /^[A-Z0-9]{1,28}USDT$/.test(s); }

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

function readAttention(now = Date.now()) {
  try {
    const raw=JSON.parse(fs.readFileSync(ATTENTION_PATH,'utf8').replace(/^\uFEFF/,''));
    const updatedAt=Number(raw?.updatedAt || 0);
    const ageMs=updatedAt>0 ? Math.max(0,now-updatedAt) : Number.POSITIVE_INFINITY;
    const rows=Array.isArray(raw?.rows) ? raw.rows : [];
    if(ageMs>ATTENTION_MAX_AGE_MS) return { available:false, updatedAt, ageMs, rows:[] };
    const clean=rows
      .map(r=>({
        symbol:String(r?.symbol||'').toUpperCase(),
        talkScore:cap100(r?.talkScore),
        earlyMoveScore:cap100(r?.earlyMoveScore),
        sourceConfidence:cap100(r?.sourceConfidence),
        preMoveState:String(r?.preMoveState||'').slice(0,32),
        direction:String(r?.direction||'').slice(0,32)
      }))
      .filter(r=>validUsdtSymbol(r.symbol))
      .sort((a,b)=>
        b.earlyMoveScore-a.earlyMoveScore ||
        b.talkScore-a.talkScore ||
        b.sourceConfidence-a.sourceConfidence)
      .slice(0,12);
    return { available:clean.length>0, updatedAt, ageMs, rows:clean };
  } catch {
    return { available:false, updatedAt:0, ageMs:null, rows:[] };
  }
}

function writeAttentionSnapshot(body = {}) {
  const now=Date.now();
  const incomingAt=Number(body?.updatedAt || now);
  const rows=Array.isArray(body?.rows) ? body.rows : [];
  const clean=rows.slice(0,24).map(r=>({
    symbol:String(r?.symbol||'').toUpperCase(),
    talkScore:cap100(r?.talkScore),
    earlyMoveScore:cap100(r?.earlyMoveScore),
    sourceConfidence:cap100(r?.sourceConfidence),
    preMoveState:String(r?.preMoveState||'').slice(0,32),
    direction:String(r?.direction||'').slice(0,32)
  })).filter(r=>validUsdtSymbol(r.symbol));
  fs.mkdirSync(path.dirname(ATTENTION_PATH),{recursive:true});
  const tmp=ATTENTION_PATH+'.'+process.pid+'.tmp';
  const out={updatedAt:Number.isFinite(incomingAt)&&incomingAt>0?incomingAt:now,receivedAt:now,rows:clean};
  fs.writeFileSync(tmp,JSON.stringify(out,null,2),'utf8');
  fs.renameSync(tmp,ATTENTION_PATH);
  return {ok:true,received:clean.length,updatedAt:out.updatedAt};
}

function accumulationProxyScore(x) {
  const absChange=Math.abs(num(x?.priceChangePercent));
  const range=num(x?.range24hPct);
  const volRank=Math.max(1,num(x?.volumeRank)||9999);
  const liquidity=Math.max(0,1-Math.min(volRank,180)/180);
  const mutedMove=Math.max(0,1-Math.min(absChange,12)/12);
  const usableRange=range>=1.5&&range<=18 ? 1-Math.min(Math.abs(range-6),12)/12 : 0;
  return round((liquidity*40 + mutedMove*35 + usableRange*25),3);
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

function candidatePreScore(x, prevRow = null) {
  const continuityBoost =
    Math.max(0, num(prevRow?.rankVelocity)) * 1.5 +
    Math.max(0, num(prevRow?.leaderHunterScore) - 40) * 0.08;
  return Math.min(x.range24hPct,40) * 0.90 +
    Math.min(Math.abs(x.priceChangePercent),40) * 0.12 +
    Math.max(0, 6 - x.volumeRank * 0.03) +
    continuityBoost;
}

function selectCandidates(universe, prevState = {}, attentionOrLimit = readAttention(), limit = TARGET_DETAIL_LIMIT) {
  let attention=attentionOrLimit;
  if(Number.isFinite(Number(attentionOrLimit)) && typeof attentionOrLimit!=='object'){
    limit=Math.max(1,Math.trunc(Number(attentionOrLimit)));
    attention=readAttention();
  }
  if(!attention || typeof attention!=='object' || Array.isArray(attention)) attention=readAttention();
  const universeMap=new Map(universe.map(x=>[x.symbol,x]));
  const prevRows=Object.entries(prevState?.bySymbol || {})
    .filter(([symbol])=>universeMap.has(symbol))
    .map(([symbol,row])=>({symbol,row,x:universeMap.get(symbol)}));

  const previousTop3=prevRows
    .filter(z=>num(z.row?.rank)>=1&&num(z.row?.rank)<=3)
    .sort((a,b)=>num(a.row.rank)-num(b.row.rank))
    .map(z=>z.x);

  const previousTop4to10=prevRows
    .filter(z=>num(z.row?.rank)>=4&&num(z.row?.rank)<=10)
    .sort((a,b)=>num(a.row.rank)-num(b.row.rank))
    .map(z=>z.x);

  const continuity=prevRows
    .filter(z=>{
      const state=String(z.row?.leaderState||'').toUpperCase();
      const projected=num(z.row?.projectedRank);
      return state==='TOP3_APPROACH' || state==='TOP10_APPROACH' ||
        (projected>=1&&projected<=10&&num(z.row?.rank)>10&&num(z.row?.rankVelocity)>0);
    })
    .sort((a,b)=>
      num(a.row?.projectedRank)-num(b.row?.projectedRank) ||
      num(b.row?.rankVelocity)-num(a.row?.rankVelocity) ||
      num(b.row?.leaderHunterScore)-num(a.row?.leaderHunterScore))
    .map(z=>({...z.x,continuityState:z.row}));

  const top24Gainers=[...universe]
    .filter(x=>num(x.priceChangePercent)>0)
    .sort((a,b)=>num(b.priceChangePercent)-num(a.priceChangePercent)||num(b.quoteVolume)-num(a.quoteVolume))
    .slice(0,24)
    .map((x,i)=>({...x,gainerRank24:i+1}));

  const accumulationPool=[...universe]
    .filter(x=>x.volumeRank<=180&&Math.abs(num(x.priceChangePercent))<=12&&num(x.range24hPct)>=1.5&&num(x.range24hPct)<=18)
    .map(x=>({...x,accumulationProxyScore:accumulationProxyScore(x)}))
    .filter(x=>x.accumulationProxyScore>=42)
    .sort((a,b)=>b.accumulationProxyScore-a.accumulationProxyScore||a.volumeRank-b.volumeRank)
    .slice(0,12);

  const attentionPool=(attention?.rows||[])
    .map(a=>{
      const x=universeMap.get(a.symbol);
      return x ? {...x,attention:a} : null;
    })
    .filter(Boolean)
    .slice(0,8);

  const targetMap=new Map();
  const add=(items,source,maxNew)=>{
    let added=0;
    for(const raw of items){
      if(added>=maxNew||targetMap.size>=limit)break;
      const symbol=raw?.symbol;
      if(!symbol)continue;
      const existing=targetMap.get(symbol);
      if(existing){
        existing.targetSources=[...new Set([...(existing.targetSources||[]),source])];
        if(raw.gainerRank24)existing.gainerRank24=raw.gainerRank24;
        if(raw.accumulationProxyScore)existing.accumulationProxyScore=raw.accumulationProxyScore;
        if(raw.attention)existing.attention=raw.attention;
        continue;
      }
      targetMap.set(symbol,{
        ...raw,
        preScore:Number.isFinite(Number(raw?.preScore))
          ? Number(raw.preScore)
          : candidatePreScore(raw,prevState?.bySymbol?.[symbol]),
        targetSources:[source]
      });
      added++;
    }
  };

  // Heavy detail budget is deliberately small. The full 24h ticker snapshot is
  // lightweight and is used only to discover these priority buckets.
  add(previousTop3,'PREV_ATTACK_TOP3',3);
  add(previousTop4to10,'PREV_ATTACK_4_10',7);
  add(top24Gainers,'BINANCE_TOP24_GAINER',5);
  add(continuity,'APPROACH_CONTINUITY',3);
  add(accumulationPool,'ACCUMULATION_PROXY',3);
  add(attentionPool,'APP_EARLY_ATTENTION',3);

  // Fill any unused slots with the strongest remaining candidates by a cheap
  // pre-score; this avoids an empty scanner after restart without returning to
  // a 523-symbol per-symbol detail sweep.
  if(targetMap.size<limit){
    const remainder=[...universe]
      .filter(x=>!targetMap.has(x.symbol))
      .map(x=>({...x,preScore:candidatePreScore(x,prevState?.bySymbol?.[x.symbol])}))
      .sort((a,b)=>b.preScore-a.preScore)
      .slice(0,limit-targetMap.size);
    add(remainder,'LIGHTWEIGHT_FILL',limit-targetMap.size);
  }

  const candidates=[...targetMap.values()].slice(0,limit);
  return {
    previousTop3,
    previousTop4to10,
    continuity,
    top24Gainers,
    accumulationPool,
    attentionPool,
    attentionStatus:{
      available:attention?.available===true,
      updatedAt:attention?.updatedAt||0,
      ageMs:attention?.ageMs??null,
      rows:(attention?.rows||[]).length
    },
    candidates,
    targetSymbols:candidates.map(x=>x.symbol)
  };
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
    volumeRank: x.volumeRank,
    targetSources:Array.isArray(x.targetSources)?x.targetSources.slice(0,6):[],
    gainerRank24:num(x.gainerRank24)||null,
    accumulationProxyScore:num(x.accumulationProxyScore)||0,
    attention:x.attention||null
  };
}

function addLeaderHunterFields(x, rank, prevRow) {
  const oldRank = num(prevRow?.rank);
  const prevVelocity = num(prevRow?.rankVelocity);
  const rankVelocity = oldRank > 0 ? oldRank - rank : 0;
  const rankAcceleration = rankVelocity - prevVelocity;
  const projectedRank = Math.max(1, Math.round(rank - Math.max(0, rankVelocity) - Math.max(0, rankAcceleration) * 0.5));
  const dirSign = x.side === 'LONG' ? 1 : -1;
  const directionSupport = [x.m1, x.m3, x.m5].filter(v => num(v) * dirSign > 0).length;
  const flowSupport = x.side === 'LONG' ? x.takerBuyRatio >= 0.52 : x.takerBuyRatio <= 0.48;
  const oiSupport = Math.abs(num(x.oiDeltaPct)) > 0.05;
  const spreadSupport = num(x.spreadBps) <= 8;
  const expansionScore = x.side === 'LONG' ? num(x.longExpansionScore) : num(x.shortExpansionScore);
  const approachQuality = directionSupport >= 2 && x.tradeQuality >= 58 && spreadSupport && expansionScore >= 40 && (flowSupport || oiSupport);
  const top3Approach = rank > 3 && projectedRank <= 3 && rankVelocity >= 2 && rankAcceleration >= 0 && approachQuality && expansionScore >= 45;
  const top10Approach = rank > 10 && projectedRank <= 10 && rankVelocity >= 2 && rankAcceleration >= -1 && approachQuality;
  const top5Confirmed = rank <= 5 && directionSupport >= 2 && x.tradeQuality >= 55 && spreadSupport && expansionScore >= 35;
  const earlyTop5 = rank > 5 && rank <= 15 && rankVelocity >= 2 && rankAcceleration >= -1 && directionSupport >= 2 && x.tradeQuality >= 60 && spreadSupport && expansionScore >= 35 && (flowSupport || oiSupport);
  const earlyExpansion = num(x.movementPotential) >= 45 && expansionScore >= 45 && x.tradeQuality >= 58 && spreadSupport;
  const leaderHunterScore =
    num(x.attackScore) +
    Math.max(0, rankVelocity) * 1.8 +
    Math.max(0, rankAcceleration) * 0.8 +
    directionSupport * 2.5 +
    (flowSupport ? 4 : 0) +
    (oiSupport ? 2 : 0) +
    (spreadSupport ? 2 : 0) +
    expansionScore * 0.08 +
    num(x.tradeQuality) * 0.04 +
    (top3Approach ? 10 : top10Approach ? 6 : 0);
  let leaderState = 'WATCH';
  if (top3Approach) leaderState = 'TOP3_APPROACH';
  else if (top5Confirmed) leaderState = 'TOP5_CONFIRMED';
  else if (top10Approach) leaderState = 'TOP10_APPROACH';
  else if (earlyTop5) leaderState = 'EARLY_TOP5';
  else if (earlyExpansion) leaderState = 'EARLY_EXPANSION';
  else if (rankVelocity >= 2 && directionSupport >= 2) leaderState = 'RISING';
  const targetSources=Array.isArray(x.targetSources)?x.targetSources:[];
  const accumulationBreakoutCandidate=Boolean(
    targetSources.includes('ACCUMULATION_PROXY') &&
    num(x.spreadBps)<=8 &&
    num(x.tradeQuality)>=58 &&
    num(x.movementPotential)>=40 &&
    (num(x.volumeAcceleration)>=0.25 || Math.abs(num(x.oiDeltaPct))>=0.05)
  );
  Object.assign(x, {
    attackRank: rank,
    projectedRank,
    rankVelocity,
    rankAcceleration,
    directionSupport,
    flowSupport,
    oiSupport,
    spreadSupport,
    expansionScore: round(expansionScore,1),
    leaderHunterScore: round(leaderHunterScore,3),
    top3Approach,
    top10Approach,
    top5Confirmed,
    earlyTop5,
    earlyExpansion,
    accumulationBreakoutCandidate,
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
  const allowed = new Set((ex.symbols || []).filter(x => x.quoteAsset === 'USDT' && x.contractType === 'PERPETUAL' && x.status === 'TRADING' && validUsdtSymbol(x.symbol)).map(x => x.symbol));
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

  const attention=readAttention();
  const selection = selectCandidates(universe,prev,attention,TARGET_DETAIL_LIMIT);
  const { previousTop3, previousTop4to10, continuity, top24Gainers, accumulationPool, attentionPool, attentionStatus, candidates, targetSymbols } = selection;

  const enriched = await mapLimit(candidates,8,x=>enrich(x,bookMap.get(x.symbol),premiumMap.get(x.symbol),prev.bySymbol?.[x.symbol]));
  const good = enriched.filter(x=>!x.error).sort((a,b)=>b.attackScore-a.attackScore);
  good.forEach((x,i)=>addLeaderHunterFields(x,i+1,prev.bySymbol?.[x.symbol]));

  const now=Date.now();
  const next={ts:now,bySymbol:{}};
  for(const x of good){
    const oldHistory=Array.isArray(prev.bySymbol?.[x.symbol]?.history)?prev.bySymbol[x.symbol].history:[];
    const history=[...oldHistory,{ts:now,rank:x.attackRank,projectedRank:x.projectedRank,attackScore:x.attackScore,leaderHunterScore:x.leaderHunterScore,movementPotential:x.movementPotential,longExpansionScore:x.longExpansionScore,shortExpansionScore:x.shortExpansionScore,leaderState:x.leaderState}].slice(-8);
    next.bySymbol[x.symbol]={
      rank:x.attackRank,
      projectedRank:x.projectedRank,
      oi:x.openInterest,
      rankVelocity:x.rankVelocity,
      rankAcceleration:x.rankAcceleration,
      leaderHunterScore:x.leaderHunterScore,
      leaderState:x.leaderState,
      side:x.side,
      history
    };
  }
  writeState(next);
  const leaderHunters=[...good].sort((a,b)=>b.leaderHunterScore-a.leaderHunterScore);
  const earlyExpansion=[...leaderHunters].filter(x=>x.earlyExpansion).sort((a,b)=>b.movementPotential-a.movementPotential||b.expansionScore-a.expansionScore);
  const top3Approach=[...leaderHunters].filter(x=>x.top3Approach).sort((a,b)=>a.projectedRank-b.projectedRank||b.rankVelocity-a.rankVelocity||b.leaderHunterScore-a.leaderHunterScore);
  const top10Approach=[...leaderHunters].filter(x=>x.top10Approach).sort((a,b)=>a.projectedRank-b.projectedRank||b.rankVelocity-a.rankVelocity||b.leaderHunterScore-a.leaderHunterScore);
  const longExpansion=[...leaderHunters].sort((a,b)=>b.longExpansionScore-a.longExpansionScore).slice(0,10);
  const shortExpansion=[...leaderHunters].sort((a,b)=>b.shortExpansionScore-a.shortExpansionScore).slice(0,10);
  const gainerCandidates=leaderHunters.filter(x=>Array.isArray(x.targetSources)&&x.targetSources.includes('BINANCE_TOP24_GAINER'));
  const accumulationCandidates=leaderHunters.filter(x=>x.accumulationBreakoutCandidate===true || (Array.isArray(x.targetSources)&&x.targetSources.includes('ACCUMULATION_PROXY')));
  const attentionCandidates=leaderHunters.filter(x=>Array.isArray(x.targetSources)&&x.targetSources.includes('APP_EARLY_ATTENTION'));
  return {
    ok:true,
    source:'Binance USDT-M public API; short-horizon stats use closed 1m/3m/5m candles only',
    generatedAt:new Date().toISOString(),
    activeUsdtPerpetuals:allowed.size,
    universeCount:universe.length,
    lightweightUniverseCount:universe.length,
    targetUniverseCount:candidates.length,
    targetDetailLimit:TARGET_DETAIL_LIMIT,
    targetSymbols,
    priorityBuckets:{
      previousTop3:previousTop3.map(x=>x.symbol),
      previousTop4to10:previousTop4to10.map(x=>x.symbol),
      approachContinuity:continuity.map(x=>x.symbol),
      top24Gainers:top24Gainers.map(x=>x.symbol),
      accumulationProxy:accumulationPool.map(x=>x.symbol),
      appEarlyAttention:attentionPool.map(x=>x.symbol)
    },
    attentionStatus,
    analyzed:good.length,
    failed:enriched.filter(x=>x.error),
    scanMs:Date.now()-started,
    leaders:good.slice(0,15),
    leaderHunters:leaderHunters.slice(0,15),
    top3Approach:top3Approach.slice(0,10),
    top10Approach:top10Approach.slice(0,12),
    earlyExpansion:earlyExpansion.slice(0,12),
    top24Gainers:top24Gainers.map(x=>({
      symbol:x.symbol,
      priceChange24hPct:round(x.priceChangePercent,3),
      quoteVolume24h:round(x.quoteVolume,0),
      volumeRank:x.volumeRank,
      gainerRank24:x.gainerRank24
    })),
    gainerCandidates:gainerCandidates.slice(0,12),
    accumulationCandidates:accumulationCandidates.slice(0,10),
    attentionCandidates:attentionCandidates.slice(0,10),
    longExpansion,
    shortExpansion,
    earlyTop5:leaderHunters.filter(x=>x.earlyTop5).slice(0,10),
    top5Confirmed:leaderHunters.filter(x=>x.top5Confirmed).slice(0,5),
    notes:[
      '523-symbol Binance ticker data is used only as a lightweight discovery snapshot; per-symbol 1m/3m/5m/OI detail work is capped to the 24-symbol priority target universe',
      'Priority order is previous attack top3, previous attack ranks 4-10, selected members of Binance top24 gainers, objective accumulation/breakout proxies, and fresh app early-attention symbols',
      'Accumulation is a public-data proxy only, not proof of hidden orders or market-maker intent',
      'TOP10_APPROACH and TOP3_APPROACH use attack-rank velocity, acceleration, 1m/3m/5m directional expansion, flow/OI support, spread and trade quality',
      'The same early-approach logic applies independently to LONG and SHORT hypotheses',
      'Volume rank is liquidity context only and does not dominate opportunity selection',
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

module.exports={scan,tfStats,scoreExpansion,selectCandidates,addLeaderHunterFields,validUsdtSymbol,readAttention,writeAttentionSnapshot,accumulationProxyScore,TARGET_DETAIL_LIMIT};
