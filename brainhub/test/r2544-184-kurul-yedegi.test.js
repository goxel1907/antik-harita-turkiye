'use strict';
// R2544.185 (eski R184 dosyası, aynı konu): JEV kredisi bitince kurul yedeği TEK noktada (decision-failover). R184'ün boru-içi ikinci
// yedeği kaldırıldı (ikisi birlikte aynı karar için kurulu iki kez çağırırdı).
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const F = require('../decision-failover');
const pj = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
test('R2544.185 tek yedek noktası: pipeline/server içinde R184 decisionFallback kalmadı', () => {
  assert.ok(!/decisionFallback/.test(pj), 'pipeline');
  assert.ok(!/decisionFallback/.test(sv), 'server');
  assert.match(sv, /createCommitteeFallback\(\{committee:\(\)=>deskCommittee\}\)/);
});
const body = { questions:{ trade_plan:{ type:'choice', criteria:{ A:'', B:'', WAIT:'' } }, entry_timing:{ type:'choice', criteria:{ MARKET_NOW:'', WAIT_PULLBACK:'' } },
  target_profile:{ type:'choice', criteria:{ BALANCED:'', FAST_SCALP:'' } }, trail_rule:{ type:'choice', criteria:{ JEV_DYNAMIC:'', NONE:'' } } }, state:{} };
const ans = (p, t, tp, tr, c) => ({ trade_plan:{ choice:p, confidence:c }, entry_timing:{ choice:t }, target_profile:{ choice:tp }, trail_rule:{ choice:tr } });
test('R2544.185 mutabakat yalnız karar alanlarında: yönetim tercihleri farklı da olsa aynı plan + zamanlama = aynı imza', () => {
  assert.equal(F.signature(body, ans('A', 'MARKET_NOW', 'BALANCED', 'NONE')), F.signature(body, ans('A', 'MARKET_NOW', 'FAST_SCALP', 'JEV_DYNAMIC')));
  assert.notEqual(F.signature(body, ans('A', 'MARKET_NOW', 'BALANCED', 'NONE')), F.signature(body, ans('B', 'MARKET_NOW', 'BALANCED', 'NONE')));
  assert.notEqual(F.signature(body, ans('A', 'MARKET_NOW', 'BALANCED', 'NONE')), F.signature(body, ans('A', 'WAIT_PULLBACK', 'BALANCED', 'NONE')));
  assert.notEqual(F.fullSignature(body, ans('A', 'MARKET_NOW', 'BALANCED', 'NONE')), F.fullSignature(body, ans('A', 'MARKET_NOW', 'FAST_SCALP', 'NONE')));
});
test('R2544.185 aynı temel model farklı sağlayıcıda tek aile sayılır', () => {
  const a = F.familyOf('KILO:nvidia/nemotron-3.5-super-vl:free'), b = F.familyOf('OR:nvidia/nemotron-3.5-super-vl:free'), c = F.familyOf('nvidia/nemotron-3.5-super-vl');
  assert.equal(a, b); assert.equal(b, c);
  assert.notEqual(F.familyOf('OVH:gpt-oss-120b'), a);
});
function fakeCommittee(votes) {
  return { decide:async ({ parse }) => { const v = votes.map(x => ({ ok:true, member:x.m, model:x.m, vote:parse(JSON.stringify({ answers:x.a })) }));
    const counts = {}; for (const y of v) counts[y.vote.proposal] = (counts[y.vote.proposal] || 0) + 1;
    const final = Object.entries(counts).sort((p, q) => q[1] - p[1])[0][0];
    return { ok:true, final, consensus:'MAJORITY', votes:v.map(y => ({ ...y, vote:{ answers:y.vote.answers } })), team:votes.length, rounds:1 }; } };
}
const fail = { ok:false, httpStatus:402, reason:'JEV_PROVIDER_402' };
test('R2544.185 farklı yönetim tercihli iki farklı model aynı planda -> karar çıkar; yürütülen cevap TEK üyenin tam cevabı', async () => {
  const d = F.createCommitteeFallback({ committee:fakeCommittee([{ m:'OVH:gpt-oss-120b', a:ans('A', 'MARKET_NOW', 'BALANCED', 'NONE', 0.6) },
    { m:'KILO:nvidia/nemotron-3.5-super-vl:free', a:ans('A', 'MARKET_NOW', 'FAST_SCALP', 'JEV_DYNAMIC', 0.8) }, { m:'OVH:Qwen3.6-27B', a:ans('WAIT', 'WAIT_PULLBACK', 'BALANCED', 'NONE', 0.5) }]) });
  const r = await d({ body, failure:fail });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.answers.trade_plan.choice, 'A');
  assert.equal(r.route.executedFrom, 'KILO:nvidia/nemotron-3.5-super-vl:free', 'en emin üye');
  assert.equal(r.data.answers.target_profile.choice, 'FAST_SCALP', 'o üyenin KENDİ yönetimi, karışım yok');
  assert.equal(r.route.fullAgreement, false); assert.equal(r.route.families, 2);
});
test('R2544.185 aynı modelin üç sağlayıcıdan kopyası mutabakat sayılmaz', async () => {
  const same = ['KILO:nvidia/nemotron-3.5-super-vl:free', 'OR:nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-3.5-super-vl'].map(m => ({ m, a:ans('A', 'MARKET_NOW', 'BALANCED', 'NONE', 0.7) }));
  const r = await F.createCommitteeFallback({ committee:fakeCommittee(same) })({ body, failure:fail });
  assert.equal(r.ok, false); assert.equal(r.reason, 'FAILOVER_SAME_MODEL_ONLY');
});
test('R2544.185 süreler ölçüme göre: giriş/pozisyon 45 sn, vur-kaç 8 sn (yetişemezse işlem yok)', () => {
  assert.equal(F.TIMING.default.call, 45000); assert.equal(F.TIMING.burst_decision.call, 8000);
  assert.deepEqual(F.CRITICAL.trade_plan, ['trade_plan', 'entry_timing']);
});
