'use strict';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function compactCandidate(c) {
  return {
    symbol: c.symbol,
    side: c.side,
    leaderState: c.leaderState,
    attackRank: num(c.attackRank),
    rankVelocity: num(c.rankVelocity),
    rankAcceleration: num(c.rankAcceleration),
    leaderHunterScore: num(c.leaderHunterScore),
    attackScore: num(c.attackScore),
    movementPotential: num(c.movementPotential),
    longExpansionScore: num(c.longExpansionScore),
    shortExpansionScore: num(c.shortExpansionScore),
    expansionScore: num(c.expansionScore),
    tradeQuality: num(c.tradeQuality),
    directionSupport: num(c.directionSupport),
    flowSupport: Boolean(c.flowSupport),
    oiSupport: Boolean(c.oiSupport),
    m1: num(c.m1),
    m3: num(c.m3),
    m5: num(c.m5),
    volumeAcceleration: num(c.volumeAcceleration),
    rangeExpansion: num(c.rangeExpansion),
    oiDeltaPct: num(c.oiDeltaPct),
    takerBuyRatio: num(c.takerBuyRatio),
    spreadBps: num(c.spreadBps),
    fundingRate: num(c.fundingRate)
  };
}

function pickCandidate(scan) {
  const pools = [
    ...(Array.isArray(scan?.earlyTop5) ? scan.earlyTop5 : []),
    ...(Array.isArray(scan?.earlyExpansion) ? scan.earlyExpansion : [])
  ];
  const seen = new Set();
  const eligible = pools
    .filter(x => x && !seen.has(x.symbol) && seen.add(x.symbol))
    .filter(x => ['EARLY_TOP5','EARLY_EXPANSION'].includes(x.leaderState))
    .filter(x => num(x.tradeQuality) >= 58)
    .filter(x => num(x.directionSupport) >= 1)
    .filter(x => num(x.expansionScore) >= 35 || x.leaderState === 'EARLY_TOP5')
    .sort((a, b) => {
      const score = num(b.leaderHunterScore) - num(a.leaderHunterScore);
      if (score) return score;
      const move = num(b.movementPotential) - num(a.movementPotential);
      if (move) return move;
      const expansion = num(b.expansionScore) - num(a.expansionScore);
      if (expansion) return expansion;
      return num(b.tradeQuality) - num(a.tradeQuality);
    });
  return eligible[0] || null;
}

async function postJson(url, body, timeoutMs = 90000, token = '') {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await r.text();
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`committee non-json HTTP ${r.status}: ${raw.slice(0, 300)}`); }
  if (!r.ok || parsed?.ok === false) throw new Error(`committee HTTP ${r.status}: ${JSON.stringify(parsed).slice(0, 500)}`);
  return parsed;
}

function buildPrompt(c) {
  const data = compactCandidate(c);
  return [
    'Leader Hunter erken genisleme adayi bulundu.',
    'Aşağıdaki veri yalnız Binance public piyasa verisi ve deterministik scanner metrikleridir.',
    'LONG_EXPANSION ve SHORT_EXPANSION ayrı hipotezlerdir. movementPotential yönsüz hareket potansiyelidir; hiçbiri işlem garantisi değildir.',
    'Veride olmayan şeyi uydurma. Flow/OI/taker gibi korelasyonlu metrikleri bağımsız birden fazla teyit gibi sayma.',
    'Bu aşamada emir verme; yalnız hangi tarafın ve hangi risklerin daha yakından incelenmesi gerektiğini değerlendir.',
    '',
    'CANDIDATE_JSON:',
    JSON.stringify(data),
    '',
    'Cevabı SADECE şu formatta ver:',
    'PLAN_CODE: LH_EARLY_EXPANSION',
    `SYMBOL: ${data.symbol}`,
    `SIDE: ${data.side}`,
    'STATUS: WATCH | QUALIFIED | REJECT',
    'CONFIDENCE: 0-100',
    'WHY: tek satır, en fazla 3 kısa gerekçe',
    'RISK_NOTE: tek satır',
    'EXECUTION: ADVISORY_ONLY'
  ].join('\n');
}

async function run({ scan, port = 8787, token = '' }) {
  const candidate = pickCandidate(scan);
  if (!candidate) {
    const rising = Array.isArray(scan?.leaderHunters)
      ? scan.leaderHunters.filter(x => x && ['RISING','WATCH'].includes(x.leaderState)).slice(0, 3).map(compactCandidate)
      : [];
    return { ok:true, candidateFound:false, reason:'NO_QUALIFIED_EARLY_EXPANSION', risingWatch:rising, committeeCalled:false };
  }
  const system = [
    'You are the Brain Hub crypto futures committee.',
    'Use only supplied deterministic scanner data.',
    'Do not invent prices, levels, news, fundamentals, liquidation maps, or order-book facts.',
    'Early expansion context is supportive, not a license to override risk rules.',
    'This endpoint is advisory only and cannot place orders.'
  ].join(' ');
  const committee = await postJson(
    `http://127.0.0.1:${port}/committee`,
    { role:'FAST', system, prompt:buildPrompt(candidate) },
    90000,
    token
  );
  return { ok:true, candidateFound:true, candidate:compactCandidate(candidate), committeeCalled:true, committee };
}

module.exports = { run, pickCandidate, compactCandidate };
