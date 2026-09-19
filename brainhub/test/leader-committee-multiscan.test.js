'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectDeepCandidates, detailProbeCandidate, pickCandidate, buildPrompt } = require('../leader-committee');

function row(symbol, attackRank, leaderState, overrides = {}) {
  return {
    symbol,
    side:'LONG',
    leaderState,
    attackRank,
    projectedRank:attackRank,
    rankVelocity:0,
    rankAcceleration:0,
    leaderHunterScore:50,
    attackScore:45,
    movementPotential:45,
    longExpansionScore:45,
    shortExpansionScore:20,
    expansionScore:45,
    tradeQuality:70,
    directionSupport:2,
    flowSupport:true,
    oiSupport:false,
    m1:0.4,
    m3:0.3,
    m5:0.2,
    volumeAcceleration:0.2,
    rangeExpansion:0.2,
    oiDeltaPct:0.1,
    takerBuyRatio:0.58,
    spreadBps:2,
    fundingRate:0.01,
    ...overrides
  };
}

test('current attack top10 is deep-scanned and approaching candidates are appended without duplicates', () => {
  const top1 = row('TOP1USDT', 1, 'TOP5_CONFIRMED');
  const top2 = row('TOP2USDT', 2, 'TOP5_CONFIRMED');
  const top10 = row('TOP10USDT', 10, 'EARLY_TOP5');
  const outside = row('OUTSIDEUSDT', 11, 'WATCH');
  const approach = row('APPROACHUSDT', 12, 'TOP3_APPROACH', { projectedRank:2, rankVelocity:5, rankAcceleration:2 });
  const early = row('EARLYUSDT', 15, 'EARLY_EXPANSION', { leaderHunterScore:72 });
  const duplicateTop2 = { ...top2, leaderState:'TOP3_APPROACH', projectedRank:1 };

  const picked = selectDeepCandidates({
    leaders:[top10, outside, top2, top1],
    top3Approach:[approach, duplicateTop2],
    top10Approach:[],
    earlyTop5:[],
    earlyExpansion:[early]
  }, 16);

  assert.deepEqual(picked.map(x => x.symbol), ['TOP1USDT','TOP2USDT','TOP10USDT','APPROACHUSDT','EARLYUSDT']);
  assert.equal(picked[0].deepScanReason, 'CURRENT_ATTACK_TOP10');
  assert.equal(picked[1].deepScanReason, 'CURRENT_ATTACK_TOP10');
  assert.equal(picked[2].deepScanReason, 'CURRENT_ATTACK_TOP10');
  assert.equal(picked[3].deepScanReason, 'TOP3_APPROACH');
  assert.equal(new Set(picked.map(x => x.symbol)).size, picked.length);
});

test('low-quality current top10 stays in review package but cannot become execution candidate', () => {
  const weakTop = row('WEAKTOPUSDT', 1, 'TOP5_CONFIRMED', {
    tradeQuality:30,
    directionSupport:0,
    longExpansionScore:80,
    leaderHunterScore:99
  });
  const strongShortApproach = row('STRONGSHORTUSDT', 12, 'TOP10_APPROACH', {
    side:'SHORT',
    projectedRank:8,
    rankVelocity:4,
    rankAcceleration:1,
    leaderHunterScore:80,
    movementPotential:68,
    longExpansionScore:18,
    shortExpansionScore:58,
    expansionScore:58,
    tradeQuality:78,
    directionSupport:3,
    takerBuyRatio:0.4,
    spreadBps:2
  });
  const scan = {
    leaders:[weakTop],
    top3Approach:[],
    top10Approach:[strongShortApproach],
    earlyTop5:[],
    earlyExpansion:[]
  };

  const deep = selectDeepCandidates(scan, 16);
  assert.ok(deep.some(x => x.symbol === 'WEAKTOPUSDT'));
  assert.equal(pickCandidate(scan)?.symbol, 'STRONGSHORTUSDT');
  assert.equal(pickCandidate(scan)?.side, 'SHORT');
});

test('detail probe skips malformed symbols and normalizes the next valid USDT candidate', () => {
  const malformed = row('BAD/USDT', 1, 'TOP5_CONFIRMED', { side:'SHORT' });
  const valid = row('  GOODUSDT  ', 2, 'TOP5_CONFIRMED', { side:'long' });
  const picked = detailProbeCandidate({
    leaders:[malformed,valid],
    top3Approach:[],top10Approach:[],earlyTop5:[],earlyExpansion:[]
  },16);
  assert.equal(picked.symbol,'GOODUSDT');
  assert.equal(picked.side,'LONG');

  const none = detailProbeCandidate({
    leaders:[malformed],
    top3Approach:[],top10Approach:[],earlyTop5:[],earlyExpansion:[]
  },16);
  assert.equal(none,null);
});

test('deep-scan prompt explicitly requires independent LONG and SHORT review for every symbol', () => {
  const longRow = row('LONGUSDT', 3, 'TOP5_CONFIRMED');
  const shortRow = row('SHORTUSDT', 11, 'TOP10_APPROACH', {
    side:'SHORT',
    shortExpansionScore:55,
    longExpansionScore:15,
    projectedRank:8,
    rankVelocity:3
  });
  const prompt = buildPrompt([longRow, shortRow]);
  assert.match(prompt, /Her sembolde LONG ve SHORT hipotezlerini AYRI değerlendir/);
  assert.match(prompt, /LONG_STATUS: WATCH \| QUALIFIED \| REJECT/);
  assert.match(prompt, /SHORT_STATUS: WATCH \| QUALIFIED \| REJECT/);
  assert.match(prompt, /LONGUSDT/);
  assert.match(prompt, /SHORTUSDT/);
  assert.match(prompt, /EXECUTION: ADVISORY_ONLY/);
});
