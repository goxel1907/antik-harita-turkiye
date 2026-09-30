'use strict';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const STATE_PRIORITY = {
  TOP3_APPROACH: 6,
  TOP10_APPROACH: 5,
  TOP5_CONFIRMED: 4,
  EARLY_TOP5: 3,
  EARLY_EXPANSION: 2,
  RISING: 1,
  WATCH: 0
};

function compactCandidate(c) {
  return {
    symbol: c.symbol,
    side: c.side,
    deepScanReason: c.deepScanReason || null,
    leaderState: c.leaderState,
    attackRank: num(c.attackRank),
    projectedRank: num(c.projectedRank),
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

function selectDeepCandidates(scan, limit = 16, options = {}) {
  if(options.deterministicPriority)return require('./attention-priority').selectDeterministicCandidates(scan,limit);
  const leaders=Array.isArray(scan?.leaders)?scan.leaders:[];
  const top3=leaders.filter(x=>x&&num(x.attackRank)>=1&&num(x.attackRank)<=3).sort((a,b)=>num(a.attackRank)-num(b.attackRank));
  const top4to10=leaders.filter(x=>x&&num(x.attackRank)>=4&&num(x.attackRank)<=10).sort((a,b)=>num(a.attackRank)-num(b.attackRank));
  const sortApproach=rows=>(Array.isArray(rows)?rows:[]).filter(Boolean).sort((a,b)=>
    (STATE_PRIORITY[b.leaderState]||0)-(STATE_PRIORITY[a.leaderState]||0) ||
    num(a.projectedRank)-num(b.projectedRank) ||
    num(b.rankVelocity)-num(a.rankVelocity) ||
    num(b.rankAcceleration)-num(a.rankAcceleration) ||
    num(b.leaderHunterScore)-num(a.leaderHunterScore));
  const top3Approach=sortApproach(scan?.top3Approach);
  const otherApproach=sortApproach([
    ...(Array.isArray(scan?.top10Approach)?scan.top10Approach:[]),
    ...(Array.isArray(scan?.earlyTop5)?scan.earlyTop5:[]),
    ...(Array.isArray(scan?.earlyExpansion)?scan.earlyExpansion:[])
  ]);
  // CLAUDE_R2544_16_SLOT_POLICY (kullanıcı kararı 29.09 akşam): JEV sırası
  //   ilk 10'a aday -> 4-10 -> 11-24 (tırmanma hızı) -> uygulamadaki erken ilgi -> patlamaya yakın (LONG/SHORT) -> ilk 3 EN SON
  //   -> eski havuzlar yalnız boş kapasite. Her ladder katmanına taban kontenjan ayrılır (liste kısa olsa da hepsi görünür).
  const arr=v=>Array.isArray(v)?v:[];
  const ladderPools=[
    {reason:'GAINER_APPROACH',rows:arr(scan?.ladderApproach),cap:5,floor:2},
    {reason:'GAINER_TOP10',rows:arr(scan?.ladderTop10),cap:7,floor:2},
    {reason:'GAINER_TOP24',rows:arr(scan?.ladderTop24),cap:14,floor:2},
    {reason:'APP_EARLY_ATTENTION',rows:arr(scan?.attentionCandidates),cap:3,floor:2},
    {reason:'NEAR_EXPLOSION',rows:arr(scan?.nearExplosionCandidates),cap:4,floor:2},
    {reason:'GAINER_TOP3',rows:arr(scan?.ladderTop3),cap:3,floor:3}
  ];
  const legacy=[
    ['CURRENT_ATTACK_TOP10',top4to10,false],
    ['TOP3_APPROACH',top3Approach,true],
    ['APPROACHING',otherApproach,true],
    ['LIGHTWEIGHT_ACCELERATION',Array.isArray(scan?.acceleratingCandidates)?scan.acceleratingCandidates:[],false],
    ['ACCUMULATION_BREAKOUT_PROXY',Array.isArray(scan?.accumulationCandidates)?scan.accumulationCandidates:[],false],
    ['CURRENT_ATTACK_TOP10',top3,false],
    ['BINANCE_TOP24_GAINER',Array.isArray(scan?.gainerCandidates)?scan.gainerCandidates:[],false]
  ];
  const seen=new Set(),out=[];
  const symOf=c=>String(c?.symbol||'').trim().toUpperCase();
  const avail=p=>new Set(p.rows.map(symOf).filter(x=>x&&!seen.has(x))).size;
  // Kısa listede (limit<20) her katmana 1 taban; aksi halde tanımlı taban (ilk 3 için 3).
  if(limit<20)for(const p of ladderPools)p.floor=1;
  ladderPools.forEach((p,i)=>{
    const reserve=ladderPools.slice(i+1).reduce((acc,q)=>acc+Math.min(q.floor,q.cap,avail(q)),0);
    const allowed=Math.max(0,Math.min(p.cap,limit-out.length-reserve));
    let n=0;
    for(const c of p.rows){
      if(n>=allowed||out.length>=limit)break;
      const symbol=symOf(c);
      if(!symbol||seen.has(symbol))continue;
      seen.add(symbol);n++;
      out.push({...c,symbol,deepScanReason:p.reason});
    }
  });
  for(const [reason,rows,leaderReason] of legacy){
    for(const c of rows){
      if(out.length>=limit)break;
      const symbol=symOf(c);
      if(!symbol||seen.has(symbol))continue;
      seen.add(symbol);
      out.push({...c,symbol,deepScanReason:leaderReason?(c.leaderState||reason):reason});
    }
    if(out.length>=limit)break;
  }
  return out.slice(0,Math.max(1,limit));
}

function detailProbeCandidate(scan, limit = 16) {
  const pool = selectDeepCandidates(scan, limit);
  for (const c of pool) {
    const side=String(c?.side || '').trim().toUpperCase();
    const symbol=String(c?.symbol || '').trim().toUpperCase();
    if (!['LONG','SHORT'].includes(side)) continue;
    if (!/^[A-Z0-9]{1,28}USDT$/.test(symbol)) continue;
    return { ...c, symbol, side };
  }
  return null;
}

function executionEligibility(c) {
  const reasons = [];
  const warnings = [];
  const side = String(c?.side || '').toUpperCase();
  const symbol = String(c?.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,28}USDT$/.test(symbol)) reasons.push('INVALID_USDT_PERPETUAL_SYMBOL');

  // Hard pre-analysis gates only protect basic execution viability.
  // Signal quality belongs to the unified 9TF plan/risk path; rejecting it here
  // made PC LIVE materially stricter than the manual chart-analysis workflow.
  if (!c || !['LONG','SHORT'].includes(side)) reasons.push('SIDE_NOT_LONG_OR_SHORT');
  if (num(c?.spreadBps) > 8) reasons.push('SPREAD_ABOVE_8_BPS');

  if (num(c?.tradeQuality) < 58) warnings.push('TRADE_QUALITY_BELOW_58');
  if (num(c?.directionSupport) < 1) warnings.push('DIRECTION_SUPPORT_MISSING');
  const directional = side === 'LONG' ? num(c?.longExpansionScore) : side === 'SHORT' ? num(c?.shortExpansionScore) : 0;
  if (directional < 35) warnings.push(side === 'SHORT' ? 'SHORT_EXPANSION_BELOW_35' : 'LONG_EXPANSION_BELOW_35');

  return {
    eligible:reasons.length === 0,
    reasons,
    warnings,
    side:side || 'NONE',
    tradeQuality:num(c?.tradeQuality),
    directionSupport:num(c?.directionSupport),
    spreadBps:num(c?.spreadBps),
    directionalExpansion:directional
  };
}

function executionEligible(c) {
  return executionEligibility(c).eligible;
}

function pickCandidate(scan) {
  // Preserve scanner/JEV discovery order. Re-sorting here used to silently put legacy
  // leaderState/Top3-style priorities back in front of the R2544.16 ladder.
  const eligible = selectDeepCandidates(scan, 16).filter(executionEligible);
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

function buildPrompt(candidates) {
  const rows = candidates.map(compactCandidate);
  return [
    'Leader Hunter derin tarama paketi.',
    "Öncelik sırası: GAINER_APPROACH (ilk 10'a yaklaşan/hızlanan) → GAINER_TOP10 (4-10) → GAINER_TOP24 (11-24, tırmanma hızı) → APP_EARLY_ATTENTION → NEAR_EXPLOSION (LONG/SHORT sıkışma/ivme) → GAINER_TOP3 EN SON. Katmanlar yalnız dikkat sırasıdır; işlem kararı değildir.",
    'Attack rank uygulamanın iç fırsat sıralamasıdır. BINANCE_TOP24_GAINER ayrı bir keşif kovasıdır ve tek başına işlem sinyali değildir.',
    'Her sembolde LONG ve SHORT hipotezlerini AYRI değerlendir. Scanner preferred side yalnız başlangıç hipotezidir, karar değildir.',
    'LONG_EXPANSION ve SHORT_EXPANSION ayrı sinyallerdir. movementPotential yönsüz hareket potansiyelidir; hiçbiri işlem garantisi değildir.',
    '1m/3m/5m momentum, spread, taker akışı, OI, funding, volume/range expansion ve trade quality verilerini birlikte değerlendir.',
    'Veride olmayan şeyi uydurma. Flow/OI/taker gibi korelasyonlu metrikleri bağımsız birden fazla teyit gibi sayma.',
    'Bu aşamada emir verme. Düşük kaliteli current-top10 coini sırf sıralamada olduğu için QUALIFIED yapma.',
    '',
    'CANDIDATES_JSON:',
    JSON.stringify(rows),
    '',
    'Her sembol için kısa bir blok üret:',
    'SYMBOL: <symbol>',
    'LONG_STATUS: WATCH | QUALIFIED | REJECT',
    'SHORT_STATUS: WATCH | QUALIFIED | REJECT',
    'PREFERRED_SIDE: LONG | SHORT | NONE',
    'CONFIDENCE: 0-100',
    'WHY: tek satır, en fazla 3 kısa gerekçe',
    'RISK_NOTE: tek satır',
    'EXECUTION: ADVISORY_ONLY',
    '',
    'En sonda yalnız bir satır ekle:',
    'BEST_REVIEW: <symbol> <LONG|SHORT|NONE>'
  ].join('\n');
}

async function run({ scan, port = 8787, token = '' }) {
  const candidates = selectDeepCandidates(scan, 16);
  const candidate = pickCandidate(scan);
  if (!candidates.length) {
    const rising = Array.isArray(scan?.leaderHunters)
      ? scan.leaderHunters.filter(x => x && ['RISING','WATCH'].includes(x.leaderState)).slice(0, 3).map(compactCandidate)
      : [];
    return { ok:true, candidateFound:false, reason:'NO_DEEP_SCAN_CANDIDATES', risingWatch:rising, committeeCalled:false };
  }
  const system = [
    'You are the Brain Hub crypto futures committee.',
    'Use only supplied deterministic scanner data.',
    'Evaluate LONG and SHORT independently for every supplied symbol.',
    'Do not invent prices, levels, news, fundamentals, liquidation maps, or order-book facts.',
    'Current attack-top10 membership is not itself a trade signal.',
    'Accumulation/breakout etiketi yalnız halka açık hacim-fiyat-OI proxy bağlamıdır; gizli emir veya market-maker niyeti kanıtı değildir. Erken ilgi/sosyal konuşulma da yalnız keşif bağlamıdır ve risk kurallarını bypass etmez.',
    'This endpoint is advisory only and cannot place orders.'
  ].join(' ');
  const committee = await postJson(
    `http://127.0.0.1:${port}/committee`,
    { role:'FAST', system, prompt:buildPrompt(candidates) },
    90000,
    token
  );
  return {
    ok:true,
    candidateFound:Boolean(candidate),
    deepScanFound:true,
    deepScanCount:candidates.length,
    candidate:candidate ? compactCandidate(candidate) : null,
    candidates:candidates.map(compactCandidate),
    committeeCalled:true,
    committee,
    execution:'ADVISORY_ONLY'
  };
}

module.exports = { run, pickCandidate, selectDeepCandidates, detailProbeCandidate, executionEligibility, executionEligible, compactCandidate, buildPrompt };
