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
    tradeQuality: num(c.tradeQuality),
    directionSupport: num(c.directionSupport),
    flowSupport: Boolean(c.flowSupport),
    oiSupport: Boolean(c.oiSupport),
    m1: num(c.m1),
    m3: num(c.m3),
    m5: num(c.m5),
    oiDeltaPct: num(c.oiDeltaPct),
    takerBuyRatio: num(c.takerBuyRatio),
    spreadBps: num(c.spreadBps),
    fundingRate: num(c.fundingRate)
  };
}

function pickCandidate(scan) {
  const early = Array.isArray(scan?.earlyTop5) ? scan.earlyTop5 : [];
  const eligible = early
    .filter(x => x && x.leaderState === 'EARLY_TOP5')
    .filter(x => num(x.tradeQuality) >= 60)
    .filter(x => num(x.directionSupport) >= 2)
    .sort((a, b) => {
      const score = num(b.leaderHunterScore) - num(a.leaderHunterScore);
      if (score) return score;
      const accel = num(b.rankAcceleration) - num(a.rankAcceleration);
      if (accel) return accel;
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
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`committee non-json HTTP ${r.status}: ${raw.slice(0, 300)}`);
  }
  if (!r.ok || parsed?.ok === false) {
    throw new Error(`committee HTTP ${r.status}: ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  return parsed;
}

function buildPrompt(c) {
  const data = compactCandidate(c);
  return [
    'Leader Hunter EARLY_TOP5 adayi bulundu.',
    'Asagidaki veri sadece Binance public piyasa verisi ve deterministik scanner metrikleridir.',
    'Veride olmayan seyi uydurma. Flow/OI/taker gibi korelasyonlu metrikleri bagimsiz birden fazla teyit gibi sayma.',
    'Bu asamada emir verme veya otomatik islem karari verme; sadece analiz et.',
    '',
    'CANDIDATE_JSON:',
    JSON.stringify(data),
    '',
    'Cevabi SADECE su formatta ver:',
    'PLAN_CODE: LH_EARLY_TOP5',
    `SYMBOL: ${data.symbol}`,
    `SIDE: ${data.side}`,
    'STATUS: WATCH | QUALIFIED | REJECT',
    'CONFIDENCE: 0-100',
    'WHY: tek satir, en fazla 3 kisa gerekce',
    'RISK_NOTE: tek satir',
    'EXECUTION: ADVISORY_ONLY'
  ].join('\n');
}

async function run({ scan, port = 8787, token = '' }) {
  const candidate = pickCandidate(scan);
  if (!candidate) {
    const rising = Array.isArray(scan?.leaderHunters)
      ? scan.leaderHunters
          .filter(x => x && x.leaderState === 'RISING')
          .slice(0, 3)
          .map(compactCandidate)
      : [];
    return {
      ok: true,
      candidateFound: false,
      reason: 'NO_QUALIFIED_EARLY_TOP5',
      risingWatch: rising,
      committeeCalled: false
    };
  }

  const system = [
    'You are the Brain Hub crypto futures committee.',
    'Use only supplied deterministic scanner data.',
    'Do not invent prices, levels, news, fundamentals, or order-book facts.',
    'Leader Hunter context is supportive, not a license to override risk rules.',
    'This endpoint is advisory only and cannot place orders.'
  ].join(' ');

  const committee = await postJson(
    `http://127.0.0.1:${port}/committee`,
    { system, prompt: buildPrompt(candidate) },
    90000,
    token
  );

  return {
    ok: true,
    candidateFound: true,
    candidate: compactCandidate(candidate),
    committeeCalled: true,
    committee
  };
}

module.exports = { run, pickCandidate };
