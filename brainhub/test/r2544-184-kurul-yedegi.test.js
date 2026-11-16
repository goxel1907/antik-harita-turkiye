'use strict';
// R2544.184: Normal sistemde JEV sağlayıcısı düşünce (kredi/anahtar/kota/ağ) SON KARARI kurul verir; veri hataları fail-closed kalır
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const P = require('../pipeline');
const pj = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
test('R2544.184 sağlayıcı hatası sınıflandırması: kredi/kota/anahtar/ağ EVET, veri kalitesi HAYIR', () => {
  for (const r of ['JEV_DAILY_BUDGET_EXHAUSTED', 'JEV_PROVIDER_AUTH_COOLDOWN', 'OPENROUTER_NOT_CONFIGURED', 'JEV_KEY_UNAVAILABLE', 'JEV_DECISIONS_HTTP_402', 'JEV_DECISIONS_HTTP_429', 'JEV_TIMEOUT'])
    assert.equal(P.jevProviderDown(r), true, r);
  for (const r of ['SOVEREIGN_BASE_CONTEXT_UNUSABLE', 'JEV_SOVEREIGN_SCHEMA_MISMATCH', 'JEV_REQUEST_CONTEXT_TOO_LARGE', null])
    assert.equal(P.jevProviderDown(r), false, String(r));
});
test('R2544.184 kurul oyu JEV FINAL şekline çevrilir: seçilen plan MARKET_NOW, WAIT ise bekler', () => {
  const plan = { id:'LONG_15M_TRADE', side:'LONG', lane:'15M_TRADE', entryPrice:10, stopPrice:9.5 };
  const f = P.committeeFinalFromVote({ planOptions:[plan], result:{ final:'LONG_15M_TRADE', consensus:'MAJORITY_AFTER_DEBATE', votes:[{ member:'a', vote:{ choice:'LONG_15M_TRADE' } }, { member:'b', vote:{ choice:'WAIT' } }] }, stage:'PASS1', jevReason:'JEV_DAILY_BUDGET_EXHAUSTED' });
  assert.equal(f.ok, true); assert.equal(f.committeeFallback, true); assert.equal(f.finalAuthority, 'KURUL');
  assert.equal(f.selectedPlan, plan); assert.equal(f.entryTiming, 'MARKET_NOW'); assert.equal(f.targetProfile, 'BALANCED');
  assert.deepEqual(f.votes, [{ m:'a', c:'LONG_15M_TRADE' }, { m:'b', c:'WAIT' }]);
  const w = P.committeeFinalFromVote({ planOptions:[plan], result:{ final:'WAIT', consensus:'NO_MAJORITY_DEFAULT' }, stage:'FINAL', jevReason:'x' });
  assert.equal(w.selectedPlan, null); assert.equal(w.entryTiming, 'WAIT_NEW_EVIDENCE'); assert.equal(w.setupFamily, 'NONE_WAIT');
});
test('R2544.184 kablolama: boru PASS1 ve FINAL aşamalarında yedeğe gider, defter JEV_KURUL_YEDEK yazar, server deskCommittee ile bağlar', () => {
  assert.match(pj, /jevProviderDown\(pass1\?\.reason\)/);
  assert.match(pj, /jevProviderDown\(final\?\.reason\)/);
  assert.match(pj, /store\.journal\('JEV_KURUL_YEDEK'/);
  assert.match(pj, /executionIntent\?\.positionReviewOnly!==true/);
  assert.match(pj, /fbFinal\?\{mode:'KURUL_YEDEK',jevUnavailable:true\}/, 'kanıt paketi JEV içindi, yedekte atlanır');
  assert.match(pj, /decisionPass1,decisionFinal,decisionFallback,knowledgeResearch\}\);/, 'run() yedeği geçirir');
  assert.match(sv, /decisionFallback:async\(\{candidate,unified,planOptions,stage,jevReason\}\)/);
  assert.match(sv, /deskCommittee\.decide\(\{system,prompt,validate/);
  assert.match(sv, /pipeline\.committeeFinalFromVote/);
});
test('R2544.184 ekran dürüstlüğü: kurul yedeği plan açıklamasında açıkça görünür', () => {
  assert.match(pj, /KURUL YEDEĞİ \(JEV cevapsız/);
});
