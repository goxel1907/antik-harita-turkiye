'use strict';

const fs = require('fs');
const path = require('path');
const { preMoveSignal, combinePreMove } = require('./premove');
const binanceRate = require('./binance-rate-limit');

const ROOT = process.env.BRAINHUB_ROOT || path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'data', 'scanner-state.json');
const ATTENTION_PATH = path.join(ROOT, 'data', 'scanner-attention.json');
// CLAUDE_R2544_16_NEAR_EXPLOSION: hareket başlamadan imza veren (PRE_MOVE/IGNITION) semboller 20 dk saklanır;
// tarayıcı ve hızlı hat yazar, tarayıcı 'patlamaya yakın' havuzunda okur (LONG ve SHORT).
const PREMOVE_HITS_PATH = path.join(ROOT, 'data', 'premove-hits.json');
const PREMOVE_HIT_TTL_MS = 20 * 60 * 1000;
const BASE = 'https://fapi.binance.com';
const ATTENTION_MAX_AGE_MS = 15 * 60 * 1000;
// CLAUDE_R2544_15_GAINER_LADDER: ayrıntılı inceleme 24 → 30 (yükselenler ilk 24 + erken teşhis + erken ilgi sığsın).
const TARGET_DETAIL_LIMIT = 36;   // R2544.16: 30→36 (yeni öncelik sırasında her katman temsil edilsin)
const LADDER_HISTORY_MS = 30 * 60 * 1000;   // yükselenler sırası geçmişi (hız hesabı)
const LADDER_TRACK_RANK = 80;               // geçmişi tutulan en kötü sıra
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
  const permit=await binanceRate.acquire({path:endpoint,kind:'PUBLIC',maxWaitMs:Math.min(5000,Math.max(1000,timeoutMs-250))});
  try{
    const r = await fetch(BASE + endpoint, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) {
      let body=null;try{body=await r.json();}catch{}
      binanceRate.observeResponse({status:r.status,headers:r.headers,body,path:endpoint,kind:'PUBLIC'});
      const e=new Error(`Binance HTTP ${r.status} ${endpoint}`);e.status=r.status;e.body=body;throw e;
    }
    binanceRate.observeResponse({status:r.status,headers:r.headers,path:endpoint,kind:'PUBLIC'});
    return r.json();
  }finally{permit.release();}
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

function readPreMoveHits(now = Date.now()) {
  try {
    const raw = JSON.parse(fs.readFileSync(PREMOVE_HITS_PATH, 'utf8').replace(/^﻿/, ''));
    const rows = raw && typeof raw.bySymbol === 'object' && raw.bySymbol ? raw.bySymbol : {};
    const out = {};
    for (const [sym, h] of Object.entries(rows)) {
      if (!validUsdtSymbol(sym) || !h || !(now - num(h.at) <= PREMOVE_HIT_TTL_MS) || num(h.at) > now + 60000) continue;
      out[sym] = { at:num(h.at), state:String(h.state || ''), direction:String(h.direction || 'BOTH'), priority:num(h.priority), frame:h.frame || null, source:String(h.source || '') };
    }
    return out;
  } catch { return {}; }
}
function recordPreMoveHits(hits = [], source = 'SCANNER', now = Date.now()) {
  const cur = readPreMoveHits(now);
  let changed = 0;
  for (const h of Array.isArray(hits) ? hits : []) {
    const sym = String(h?.symbol || '').toUpperCase();
    if (!validUsdtSymbol(sym) || !['IGNITION', 'PRE_MOVE'].includes(String(h?.state || ''))) continue;
    cur[sym] = { at:now, state:h.state, direction:['LONG', 'SHORT'].includes(h.direction) ? h.direction : 'BOTH', priority:num(h.priority), frame:h.frame || null, source };
    changed++;
  }
  if (!changed) return { ok:true, recorded:0 };
  try {
    fs.mkdirSync(path.dirname(PREMOVE_HITS_PATH), { recursive:true });
    const tmp = PREMOVE_HITS_PATH + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt:now, bySymbol:cur }), 'utf8');
    fs.renameSync(tmp, PREMOVE_HITS_PATH);
  } catch { return { ok:false, recorded:0 }; }
  return { ok:true, recorded:changed };
}
function klineObjects(k, now = Date.now()) {
  return (Array.isArray(k) ? k : []).filter(x => Number(x?.[6]) > 0 && Number(x[6]) < now).map(x => ({
    openTime:num(x[0]), open:num(x[1]), high:num(x[2]), low:num(x[3]), close:num(x[4]), volume:num(x[5]), closeTime:num(x[6]), quoteVolume:num(x[7]), takerBuyQuote:num(x[10])
  })).filter(x => x.high >= x.low && x.close > 0);
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

function lightweightAccelerationScore(x, prevRow = null) {
  const priceMove=Math.abs(pct(prevRow?.lastPrice,x?.lastPrice));
  const quoteGrowth=Math.max(0,pct(prevRow?.quoteVolume,x?.quoteVolume));
  const abs24=Math.abs(num(x?.priceChangePercent));
  const range=num(x?.range24hPct);
  const spread=Math.max(0,num(x?.lightweightSpreadBps));
  const funding=Math.abs(num(x?.lightweightFundingPct));
  return round(cap100(
    Math.min(priceMove,3)*18 +
    Math.min(quoteGrowth,8)*2.2 +
    Math.min(abs24,12)*1.2 +
    Math.min(range,15)*0.8 +
    Math.max(0,8-Math.min(spread,8))*2 +
    Math.min(funding,0.2)*20
  ),3);
}

// CLAUDE_R2544_15_GAINER_LADDER: Binance USDT-M "en çok yükselenler" merdiveni (24 saatlik değişim, her taramada TAZE
// /ticker/24hr ile yeniden sıralanır). Her sembolün sırası zaman damgasıyla saklanır; hız = son ~5 dk'daki sıra kazancı,
// kısa pencere = son taramadan beri fiyat değişimi. Katmanlar: TOP3 (1–3), TOP10 (4–10), TOP24 (11–24) ve
// ERKEN TEŞHİS (merdivende hızla tırmanan, 5 dk içinde ilk 3'e / ilk 10'a varması beklenen ya da kısa pencerede sert yükselen).
function buildGainerLadder(universe, prevState = {}, now = Date.now()) {
  const ranked = [...universe]
    .filter(x => num(x.priceChangePercent) > 0)
    .sort((a,b) => num(b.priceChangePercent) - num(a.priceChangePercent) || num(b.quoteVolume) - num(a.quoteVolume));
  const prevLadder = prevState?.ladder || {};
  const bySymbol = new Map();
  ranked.forEach((x, i) => {
    const rank = i + 1;
    const hist = (Array.isArray(prevLadder[x.symbol]?.h) ? prevLadder[x.symbol].h : []).filter(e => Array.isArray(e) && now - num(e[0]) <= LADDER_HISTORY_MS && num(e[0]) < now);
    const last = hist.length ? hist[hist.length - 1] : null;
    // ~5 dk önceki kayıt (en az 2 dk eski); yoksa en eski kayıt
    const older = hist.filter(e => now - num(e[0]) >= 2 * 60 * 1000);
    const ref = older.length ? older.reduce((best, e) => Math.abs(now - num(e[0]) - 300000) < Math.abs(now - num(best[0]) - 300000) ? e : best, older[0]) : null;
    const dtMin = ref ? (now - num(ref[0])) / 60000 : null;
    const velocity = ref && dtMin > 0 ? round((num(ref[1]) - rank) / (dtMin / 5), 2) : 0;   // sıra/5 dk (+ = tırmanıyor)
    const projected = Math.max(1, Math.round(rank - Math.max(0, velocity)));
    const pl = prevState?.lightweight?.[x.symbol];
    const shortDtMin = pl && num(pl.at) > 0 && now - num(pl.at) <= 20 * 60 * 1000 && now > num(pl.at) ? (now - num(pl.at)) / 60000 : null;
    const shortChangePct = shortDtMin ? round(pct(pl.lastPrice, x.lastPrice), 3) : null;
    const shortPer5m = shortDtMin ? round(shortChangePct / Math.max(1, shortDtMin) * 5, 3) : null;
    const tier = rank <= 3 ? 'TOP3' : rank <= 10 ? 'TOP10' : rank <= 24 ? 'TOP24' : null;
    const approach3 = rank > 3 && rank <= 60 && velocity >= 3 && projected <= 3;
    const approach10 = rank > 10 && rank <= 60 && velocity >= 3 && projected <= 10;
    const shortSurge = rank > 3 && rank <= 60 && shortPer5m !== null && shortPer5m >= 1.5;
    bySymbol.set(x.symbol, {
      symbol:x.symbol, gainerRank:rank, gainerRankPrev:last ? num(last[1]) : null, gainerRankVelocity:velocity,
      projectedGainerRank:projected, ladderTier:tier, change24hPct:round(x.priceChangePercent, 3),
      shortChangePct, shortWindowMin:shortDtMin ? round(shortDtMin, 1) : null, shortPer5mPct:shortPer5m,
      approach:approach3 ? 'TOP3_CANDIDATE' : approach10 ? 'TOP10_CANDIDATE' : shortSurge ? 'SHORT_WINDOW_SURGE' : null
    });
  });
  const rowsOf = list => list.map(x => ({ ...x, ...bySymbol.get(x.symbol) }));
  const approach = rowsOf(ranked.filter(x => bySymbol.get(x.symbol)?.approach))
    .sort((a,b) => ({TOP3_CANDIDATE:0,TOP10_CANDIDATE:1,SHORT_WINDOW_SURGE:2}[a.approach] - {TOP3_CANDIDATE:0,TOP10_CANDIDATE:1,SHORT_WINDOW_SURGE:2}[b.approach]) ||
      a.projectedGainerRank - b.projectedGainerRank || b.gainerRankVelocity - a.gainerRankVelocity || num(b.shortPer5mPct) - num(a.shortPer5mPct));
  const nextLadder = {};
  for (const x of ranked.slice(0, LADDER_TRACK_RANK)) {
    const hist = (Array.isArray(prevLadder[x.symbol]?.h) ? prevLadder[x.symbol].h : []).filter(e => Array.isArray(e) && now - num(e[0]) <= LADDER_HISTORY_MS);
    nextLadder[x.symbol] = { h: [...hist, [now, bySymbol.get(x.symbol).gainerRank]].slice(-12) };
  }
  return {
    bySymbol, rankedCount:ranked.length,
    top3:rowsOf(ranked.slice(0,3)), top10:rowsOf(ranked.slice(3,10)), top24:rowsOf(ranked.slice(10,24)),
    approach, nextLadder
  };
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

  const acceleratingPool=[...universe]
    .map(x=>({...x,lightweightAccelerationScore:lightweightAccelerationScore(x,prevState?.lightweight?.[x.symbol])}))
    .sort((a,b)=>b.lightweightAccelerationScore-a.lightweightAccelerationScore||a.volumeRank-b.volumeRank)
    .slice(0,18);
  const noveltyPool=acceleratingPool
    .filter(x=>!Object.prototype.hasOwnProperty.call(prevState?.bySymbol||{},x.symbol))
    .slice(0,12);

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

  // CLAUDE_R2544_16_SLOT_POLICY (kullanıcı kararı 29.09 akşam; kayıt analizi: ilk 3 = 42 işlem, net −60,8 USDT, ortalama
  // kayıp ortalama kazancın 1,6 katı; 4–10 SHORT PF 3,0). Yeni öncelik sırası:
  //   1) ilk 10'a ADAY (merdivende 10. sıranın dışından hızla tırmanan / kısa pencerede sert yükselen)
  //   2) 4–10. sıralar   3) 11–24. sıralar (tırmanma hızına göre)   4) uygulamadaki erken ilgi
  //   5) patlamaya yakın (ön-hareket imzası, kısa pencerede sert yükselen/DÜŞEN, sıkışmış birikim) — LONG ve SHORT
  //   6) ilk 3 EN SON (kapsama korunur, öncelik yok)   7) süreklilik/hızlanan (boş kapasite)
  // Her katmana en az bir taban kontenjan ayrılır; öncelik sırası bozulmaz.
  const ladder=buildGainerLadder(universe,prevState,Date.now());
  const tagLadder=(items)=>items.map(x=>({...x,...(ladder.bySymbol.get(x.symbol)||{})}));
  const nowTs=Date.now();
  const approachPool=tagLadder(ladder.approach.filter(x=>num(ladder.bySymbol.get(x.symbol)?.gainerRank)>10));
  const ord={TOP3_CANDIDATE:0,TOP10_CANDIDATE:1,SHORT_WINDOW_SURGE:2};
  const top10Pool=tagLadder(ladder.top10).sort((a,b)=>(ord[a.approach]??3)-(ord[b.approach]??3)||num(a.gainerRank)-num(b.gainerRank));
  const top24Pool=tagLadder(ladder.top24).sort((a,b)=>num(b.gainerRankVelocity)-num(a.gainerRankVelocity)||num(a.gainerRank)-num(b.gainerRank));
  // Patlamaya yakın havuzu: (a) saklı ön-hareket imzaları (b) kısa pencerede ±sert hareket (merdiven dışı, SHORT dahil) (c) sıkışmış birikim
  const hits=readPreMoveHits(nowTs);
  const inTop24=sym=>num(ladder.bySymbol.get(sym)?.gainerRank)>=1&&num(ladder.bySymbol.get(sym)?.gainerRank)<=24;
  const nearHits=Object.entries(hits).filter(([sym])=>universeMap.has(sym))
    .sort((a,b)=>b[1].priority-a[1].priority)
    .map(([sym,h])=>({...universeMap.get(sym),nearExplosion:{source:'PRE_MOVE_'+h.state,direction:h.direction,priority:h.priority,frame:h.frame,ageMin:round((nowTs-h.at)/60000,1)}}));
  const surgePool=[...universe].filter(x=>x.volumeRank<=220&&!inTop24(x.symbol)).map(x=>{
    const pl=prevState?.lightweight?.[x.symbol];
    const dt=pl&&num(pl.at)>0&&nowTs>num(pl.at)&&nowTs-num(pl.at)<=20*60*1000?(nowTs-num(pl.at))/60000:null;
    const ch=dt?pct(pl.lastPrice,x.lastPrice):null, per5=dt?ch/Math.max(1,dt)*5:null;
    return {x,per5,ch,dt};
  }).filter(z=>z.per5!==null&&Math.abs(z.per5)>=1.2).sort((a,b)=>Math.abs(b.per5)-Math.abs(a.per5)).slice(0,6)
    .map(z=>({...z.x,nearExplosion:{source:z.per5>0?'SURGE_UP':'SURGE_DOWN',direction:z.per5>0?'LONG':'SHORT',shortPer5mPct:round(z.per5,3),shortWindowMin:round(z.dt,1)}}));
  const squeezePool=accumulationPool.slice(0,3).map(x=>({...x,nearExplosion:{source:'COMPRESSION_ACCUMULATION',direction:'BOTH',accumulationProxyScore:x.accumulationProxyScore}}));
  const nearPool=[...nearHits,...surgePool,...squeezePool];
  const pools=[
    {items:approachPool,source:'GAINER_APPROACH',cap:6,floor:2},
    {items:top10Pool,source:'GAINER_TOP10',cap:7,floor:2},
    {items:top24Pool,source:'GAINER_TOP24',cap:14,floor:2},
    {items:attentionPool,source:'APP_EARLY_ATTENTION',cap:4,floor:2},
    {items:nearPool,source:'NEAR_EXPLOSION',cap:5,floor:2},
    {items:tagLadder(ladder.top3),source:'GAINER_TOP3',cap:3,floor:3}
  ];
  const planned=new Set();
  const distinctAvail=(p)=>new Set(p.items.map(x=>x.symbol).filter(sym=>sym&&!planned.has(sym))).size;
  pools.forEach((p,i)=>{
    const reserve=pools.slice(i+1).reduce((acc,q)=>acc+Math.min(q.floor,q.cap,distinctAvail(q)),0);
    const allowed=Math.max(0,Math.min(p.cap,limit-planned.size-reserve));
    let n=0;
    for(const x of p.items){if(n>=allowed)break;if(!x?.symbol||planned.has(x.symbol))continue;planned.add(x.symbol);n++;}
    p.allowed=n;
  });
  for(const p of pools)add(p.items,p.source,p.allowed);
  // Aynı sembol başka katmanlarda da görünüyorsa etiketleri eklenir (öncelik ilk katmandan).
  for(const p of pools)for(const x of p.items.slice(0,p.cap)){const e=targetMap.get(x.symbol);if(e){if(!e.targetSources.includes(p.source))e.targetSources.push(p.source);if(x.nearExplosion&&!e.nearExplosion)e.nearExplosion=x.nearExplosion;}}
  add(tagLadder(continuity),'APPROACH_CONTINUITY',1);
  add(tagLadder(acceleratingPool),'LIGHTWEIGHT_ACCELERATION',Math.max(0,limit-targetMap.size));
  // Geriye uyum: merdivenin ilk 24'ündeki her aday ayrıca BINANCE_TOP24_GAINER etiketi taşır.
  for(const x of targetMap.values()){
    const l=ladder.bySymbol.get(x.symbol);
    if(l){Object.assign(x,l);x.gainerRank24=l.gainerRank<=24?l.gainerRank:null;if(l.gainerRank<=24&&!x.targetSources.includes('BINANCE_TOP24_GAINER'))x.targetSources.push('BINANCE_TOP24_GAINER');}
  }
  const slotPlan=pools.map(p=>({source:p.source,available:p.items.length,selected:p.allowed}));

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
    acceleratingPool,
    noveltyPool,
    ladder,
    nearPool,
    slotPlan,
    previousAgeMs:Math.max(0,Date.now()-Number(prevState?.ts||0)),
    newTargetCount:candidates.filter(x=>!Object.prototype.hasOwnProperty.call(prevState?.bySymbol||{},x.symbol)).length,
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
    jget(`/fapi/v1/klines?symbol=${s}&interval=1m&limit=40`, 9000),   // R2544.16: 7→40 (aynı ağırlık); son 7 ile istatistik, 40 ile ön-hareket
    jget(`/fapi/v1/klines?symbol=${s}&interval=3m&limit=40`, 9000),
    jget(`/fapi/v1/klines?symbol=${s}&interval=5m&limit=7`, 9000),
    jget(`/fapi/v1/openInterest?symbol=${s}`, 9000)
  ]);
  const a = tfStats(Array.isArray(k1) ? k1.slice(-7) : k1, now), b = tfStats(Array.isArray(k3) ? k3.slice(-7) : k3, now), c = tfStats(k5, now);
  let preMove = null;
  try {
    const pm = combinePreMove({ '1m':preMoveSignal(klineObjects(k1, now), { frame:'1m' }), '3m':preMoveSignal(klineObjects(k3, now), { frame:'3m' }) });
    if (pm && pm.available) preMove = { state:pm.state, direction:pm.direction, score:pm.score, priority:pm.priority, frame:pm.frame, reasons:(pm.reasons || []).slice(0, 6) };
  } catch { preMove = null; }
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
    // CLAUDE_R2544_15: merdiven alanları (JEV radar ve Office için)
    gainerRank:num(x.gainerRank)||null, gainerRankPrev:num(x.gainerRankPrev)||null,
    gainerRankVelocity:Number.isFinite(Number(x.gainerRankVelocity))?Number(x.gainerRankVelocity):null,
    projectedGainerRank:num(x.projectedGainerRank)||null, ladderTier:x.ladderTier||null, ladderApproach:x.approach||null,
    shortChangePct:Number.isFinite(Number(x.shortChangePct))?Number(x.shortChangePct):null,
    shortWindowMin:Number.isFinite(Number(x.shortWindowMin))?Number(x.shortWindowMin):null,
    accumulationProxyScore:num(x.accumulationProxyScore)||0,
    attention:x.attention||null,
    // CLAUDE_R2544_16: 1m+3m ön-hareket imzası (her ayrıntılı aday) ve patlamaya-yakın havuz etiketi
    preMove,
    nearExplosion:x.nearExplosion||null
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
        closeTime:num(x.closeTime),
        quoteVolume:num(x.quoteVolume),
        priceChangePercent:num(x.priceChangePercent),
        lastPrice,
        range24hPct:lastPrice>0?(high-low)/lastPrice*100:0
      };
    })
    .filter(x => x.quoteVolume > 0 && x.lastPrice > 0)
    .sort((a,b)=>b.quoteVolume-a.quoteVolume);
  universe.forEach((x,i)=>{
    x.volumeRank=i+1;
    const book=bookMap.get(x.symbol);
    const bid=num(book?.bidPrice),ask=num(book?.askPrice),mid=(bid+ask)/2;
    x.lightweightSpreadBps=mid>0?(ask-bid)/mid*10000:999;
    x.lightweightFundingPct=num(premiumMap.get(x.symbol)?.lastFundingRate)*100;
    x.lightweightAccelerationScore=lightweightAccelerationScore(x,prev?.lightweight?.[x.symbol]);
  });

  const attention=readAttention();
  const selection = selectCandidates(universe,prev,attention,TARGET_DETAIL_LIMIT);
  const { previousTop3, previousTop4to10, continuity, top24Gainers, accumulationPool, attentionPool, acceleratingPool, noveltyPool, attentionStatus, newTargetCount, candidates, targetSymbols, ladder, nearPool, slotPlan } = selection;

  const enriched = await mapLimit(candidates,8,x=>enrich(x,bookMap.get(x.symbol),premiumMap.get(x.symbol),prev.bySymbol?.[x.symbol]));
  const good = enriched.filter(x=>!x.error).sort((a,b)=>b.attackScore-a.attackScore);
  good.forEach((x,i)=>addLeaderHunterFields(x,i+1,prev.bySymbol?.[x.symbol]));
  // CLAUDE_R2544_16: ayrıntılı adaylarda bulunan ön-hareket imzaları 20 dk saklanır (bir sonraki taramada patlamaya-yakın havuzu).
  try{recordPreMoveHits(good.filter(x=>x.preMove&&['IGNITION','PRE_MOVE'].includes(x.preMove.state)).map(x=>({symbol:x.symbol,...x.preMove})),'SCANNER');}catch{}

  const now=Date.now();
  const next={ts:now,bySymbol:{},lightweight:{},ladder:ladder.nextLadder};
  for(const x of universe){
    next.lightweight[x.symbol]={
      at:now,lastPrice:x.lastPrice,quoteVolume:x.quoteVolume,
      priceChangePercent:x.priceChangePercent,range24hPct:x.range24hPct,
      volumeRank:x.volumeRank,lightweightAccelerationScore:x.lightweightAccelerationScore
    };
  }
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
  // CLAUDE_R2544_15: ayrıntılı incelenen adaylar merdiven katmanına göre (sıra: yükselenler sırası).
  const bySrc=src=>good.filter(x=>Array.isArray(x.targetSources)&&x.targetSources.includes(src)).sort((a,b)=>num(a.gainerRank)-num(b.gainerRank)||0);
  const ladderTop3=bySrc('GAINER_TOP3'), ladderTop10=bySrc('GAINER_TOP10').sort((a,b)=>({TOP3_CANDIDATE:0,TOP10_CANDIDATE:1,SHORT_WINDOW_SURGE:2}[a.ladderApproach]??3)-({TOP3_CANDIDATE:0,TOP10_CANDIDATE:1,SHORT_WINDOW_SURGE:2}[b.ladderApproach]??3)||num(a.gainerRank)-num(b.gainerRank)), ladderTop24=bySrc('GAINER_TOP24').sort((a,b)=>num(b.gainerRankVelocity)-num(a.gainerRankVelocity)||num(a.gainerRank)-num(b.gainerRank));
  // CLAUDE_R2544_16: patlamaya yakın adaylar (ön-hareket önceliği → kısa pencere hızı).
  const pmRank={IGNITION:0,PRE_MOVE:1,WATCH:2};
  const nearExplosionCandidates=good.filter(x=>Array.isArray(x.targetSources)&&x.targetSources.includes('NEAR_EXPLOSION'))
    .sort((a,b)=>(pmRank[a.preMove?.state]??3)-(pmRank[b.preMove?.state]??3)||num(b.preMove?.priority)-num(a.preMove?.priority)||Math.abs(num(b.nearExplosion?.shortPer5mPct))-Math.abs(num(a.nearExplosion?.shortPer5mPct)));
  const ladderApproach=good.filter(x=>Array.isArray(x.targetSources)&&x.targetSources.includes('GAINER_APPROACH'))
    .sort((a,b)=>({TOP3_CANDIDATE:0,TOP10_CANDIDATE:1,SHORT_WINDOW_SURGE:2}[a.ladderApproach]??3)-({TOP3_CANDIDATE:0,TOP10_CANDIDATE:1,SHORT_WINDOW_SURGE:2}[b.ladderApproach]??3)||num(a.projectedGainerRank)-num(b.projectedGainerRank));
  const tickerAsOf=Math.max(0,...universe.map(x=>num(x.closeTime)));
  const analyzedSet=new Set(good.map(x=>x.symbol));
  const ladderRow=x=>({symbol:x.symbol,rank:x.gainerRank,prevRank:x.gainerRankPrev,velocity:x.gainerRankVelocity,projected:x.projectedGainerRank,
    change24hPct:x.change24hPct,shortChangePct:x.shortChangePct,shortWindowMin:x.shortWindowMin,tier:x.ladderTier,approach:x.approach||null,detailed:analyzedSet.has(x.symbol)});
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
    // CLAUDE_R2544_15_GAINER_LADDER: canlı merdiven (Office + JEV). tickerAgeMs: Binance 24s ticker verisinin yaşı.
    gainerLadder:{
      asOf:tickerAsOf?new Date(tickerAsOf).toISOString():null,
      tickerAgeMs:tickerAsOf?Math.max(0,Date.now()-tickerAsOf):null,
      rankedGainers:ladder.rankedCount,
      rows:[...ladder.top3,...ladder.top10,...ladder.top24].map(ladderRow),
      approach:ladder.approach.slice(0,10).map(ladderRow),
      attention:attentionPool.map(x=>({symbol:x.symbol,rank:ladder.bySymbol.get(x.symbol)?.gainerRank||null,detailed:analyzedSet.has(x.symbol),earlyMoveScore:x.attention?.earlyMoveScore??null,direction:x.attention?.direction||null}))
    },
    ladderTop3,ladderTop10,ladderTop24,ladderApproach,nearExplosionCandidates,
    // CLAUDE_R2544_16_SLOT_POLICY: katman başına aday/seçilen (Office ve devir raporu için)
    slotPlan,
    priorityOrder:['GAINER_APPROACH','GAINER_TOP10','GAINER_TOP24','APP_EARLY_ATTENTION','NEAR_EXPLOSION','GAINER_TOP3'],
    nearExplosion:(nearPool||[]).slice(0,10).map(x=>({symbol:x.symbol,detailed:analyzedSet.has(x.symbol),...(x.nearExplosion||{})})),
    priorityBuckets:{
      previousTop3:previousTop3.map(x=>x.symbol),
      previousTop4to10:previousTop4to10.map(x=>x.symbol),
      approachContinuity:continuity.map(x=>x.symbol),
      top24Gainers:top24Gainers.map(x=>x.symbol),
      accumulationProxy:accumulationPool.map(x=>x.symbol),
      appEarlyAttention:attentionPool.map(x=>x.symbol),
      nearExplosion:(nearPool||[]).map(x=>x.symbol),
      lightweightAcceleration:acceleratingPool.map(x=>x.symbol),
      newAcceleration:noveltyPool.map(x=>x.symbol)
    },
    newTargetCount,
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
    // CLAUDE_V109_SCANNER_NEW_ACCEL_ROUTE: ChatGPT'nin 8 'yeni sembol' slotu (LIGHTWEIGHT_NEW_ACCELERATION) derin analiz listesine hiç ulaşmıyordu.
    acceleratingCandidates:leaderHunters.filter(x=>Array.isArray(x.targetSources)&&(x.targetSources.includes('LIGHTWEIGHT_ACCELERATION')||x.targetSources.includes('LIGHTWEIGHT_NEW_ACCELERATION'))).slice(0,10),
    longExpansion,
    shortExpansion,
    earlyTop5:leaderHunters.filter(x=>x.earlyTop5).slice(0,10),
    top5Confirmed:leaderHunters.filter(x=>x.top5Confirmed).slice(0,5),
    notes:[
      '523-symbol Binance ticker data is used only as a lightweight discovery snapshot; per-symbol 1m/3m/5m/OI detail work is capped to the 24-symbol priority target universe',
      'R2544.16 priority: candidates climbing into the top10 from outside it, ranks 4-10, ranks 11-24 (by climb velocity), app early-attention, near-explosion (pre-move signature, sharp short-window up/down move, compression) LONG and SHORT, top3 last; continuity/acceleration only fill spare capacity',
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
// CLAUDE_R2544_15: Office için tarama TETİKLEMEDEN son sonuç.
function lastScan(){return cache?{...cache.result,cacheAgeMs:Date.now()-cache.at}:null;}
async function scan(){
  if(cache&&Date.now()-cache.at<15000)return {...cache.result,cacheAgeMs:Date.now()-cache.at};
  if(inFlight)return inFlight;
  inFlight=performScan().then(result=>{cache={at:Date.now(),result};return result;}).finally(()=>{inFlight=null;});
  return inFlight;
}

module.exports={readPreMoveHits,recordPreMoveHits,PREMOVE_HITS_PATH,scan,lastScan,buildGainerLadder,tfStats,scoreExpansion,selectCandidates,addLeaderHunterFields,validUsdtSymbol,readAttention,writeAttentionSnapshot,accumulationProxyScore,lightweightAccelerationScore,TARGET_DETAIL_LIMIT};
