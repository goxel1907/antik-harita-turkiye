'use strict';

const { pickCandidate } = require('./leader-committee');
const { symbolContext, globalContext } = require('./market');

function planFields(raw) {
  const text = String(raw || '');
  const field = name => {
    const match = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
    return match ? match[1].trim().slice(0, 500) : null;
  };
  const status = field('STATUS');
  const side = field('SIDE');
  if (!['WATCH', 'QUALIFIED', 'REJECT'].includes(status) || !['LONG', 'SHORT'].includes(side)) {
    return { valid: false, status: 'REVIEW_REQUIRED', reason: 'UNSTRUCTURED_COMMITTEE_OUTPUT' };
  }
  return {
    valid: true, planCode: 'LH_EARLY_TOP5', status, side,
    confidence: Math.max(0, Math.min(100, Number(field('CONFIDENCE')) || 0)),
    why: field('WHY'), riskNote: field('RISK_NOTE'), execution: 'ADVISORY_ONLY'
  };
}
async function run({ scan, committee, store }) {
  const candidate = pickCandidate(scan);
  if (!candidate) return { ok: true, candidateFound: false, reason: 'NO_QUALIFIED_EARLY_TOP5', committeeCalled: false, execution: 'ADVISORY_ONLY' };
  const [symbol, global] = await Promise.all([symbolContext(candidate.symbol), globalContext()]);
  const tf = symbol.timeframes['15m'];
  if (!tf?.available || Date.now() - tf.asOf > 2 * 15 * 60 * 1000 || !symbol.microstructure.available) {
    const out = { ok: true, candidateFound: true, symbol: candidate.symbol, status: 'REVIEW_REQUIRED', reason: 'STALE_OR_INCOMPLETE_MARKET_DATA', committeeCalled: false, execution: 'ADVISORY_ONLY' };
    out.journalId = store.journal('PLAN_REJECT', candidate.symbol, out);
    return out;
  }
  const compactFrames = frames => Object.fromEntries(Object.entries(frames).map(([name, f]) => [name, f.available ? {
    trend: f.trend, close: f.close, rsi14: f.rsi14, atrPct: f.atrPct,
    prior20High: f.prior20High, prior20Low: f.prior20Low,
    breakOfStructure: f.breakOfStructure, asOf: f.asOf
  } : { available: false, reason: f.reason }]));
  const globalAsset = asset => asset.available ? Object.fromEntries(['15m','1h','4h'].map(k => {
    const f = asset.frames[k];
    return [k, f?.available ? { trend:f.trend, returnPct:f.returnPct, rsi14:f.rsi14, asOf:f.asOf } : { available:false }];
  })) : { available: false, reason: asset.reason };
  const prompt = [
    'PLAN_CODE: LH_EARLY_TOP5',
    'Return exactly STATUS: WATCH | QUALIFIED | REJECT; SIDE: LONG | SHORT; CONFIDENCE: 0-100; WHY:; RISK_NOTE:; EXECUTION: ADVISORY_ONLY.',
    'This is analysis only. Do not place orders, invent missing facts, or turn incomplete data into a trade signal.',
    'Candidate:', JSON.stringify({symbol:candidate.symbol,side:candidate.side,attackRank:candidate.attackRank,rankVelocity:candidate.rankVelocity,rankAcceleration:candidate.rankAcceleration,leaderHunterScore:candidate.leaderHunterScore,tradeQuality:candidate.tradeQuality,spreadBps:candidate.spreadBps,oiDeltaPct:candidate.oiDeltaPct,takerBuyRatio:candidate.takerBuyRatio}),
    'Symbol closed candles:', JSON.stringify(compactFrames(symbol.timeframes)),
    'Microstructure:', JSON.stringify({spreadBps:symbol.microstructure.spreadBps,depth20Imbalance:symbol.microstructure.depth20Imbalance,cvdSampleQuote:symbol.microstructure.cvdSampleQuote,ofiProxyQuote:symbol.microstructure.ofiProxyQuote}),
    'Global:', JSON.stringify({btc:globalAsset(global.btc),eth:globalAsset(global.eth),ethbtc:globalAsset(global.ethbtc),marketCap:global.marketCap.available?{usdtDominancePct:global.marketCap.usdtDominancePct,total2ProxyUsd:global.marketCap.total2ProxyUsd,total3ProxyUsd:global.marketCap.total3ProxyUsd}:null})
  ].join('\n');
  let result;
  try {
    result = await committee({
      system: 'You are an advisory futures analyst. Base conclusions only on the supplied public market data. Treat missing or stale context as uncertainty. Never issue an executable order.',
      prompt
    });
  } catch (e) {
    const out = { ok: true, candidateFound: true, candidate, status: 'REVIEW_REQUIRED', reason: 'COMMITTEE_UNAVAILABLE', detail: String(e.message || e).slice(0, 160), committeeCalled: true, execution: 'ADVISORY_ONLY', orderPlaced: false };
    out.journalId = store.journal('PLAN_REJECT', candidate.symbol, { candidate, reason: out.reason });
    return out;
  }
  const plan = planFields(result.text);
  const out = {
    ok: true, candidateFound: true, candidate, symbolContext: symbol,
    globalContext: global, committee: result, plan,
    execution: 'ADVISORY_ONLY', orderPlaced: false
  };
  out.journalId = store.journal('PLAN', candidate.symbol, { candidate, plan, marketAsOf: symbol.generatedAt });
  return out;
}
module.exports = { run, planFields };
