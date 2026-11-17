'use strict';
// R2544.186: Goxel'in bakışı İlk 3 / ZİRVE-5 giriş kapısında da JEV'e gider (kısa biçim); not hiçbir zaman çağrıyı engellemez
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const F = require('../decision-failover');
const jd = fs.readFileSync(path.join(__dirname, '..', 'jev-decision.js'), 'utf8');
test('R2544.186 giriş kapıları danışman alır ama kurul YEDEĞİ kapsamı değişmez', () => {
  const top3 = { questions:{ top3_decision:{ type:'choice', criteria:{ APPROVE_ENTRY:'', REJECT_ENTRY:'' } } } };
  assert.equal(F.advisorEligible(top3), true); assert.equal(F.supported(top3), false, 'yedek kapsamına alınmadı');
  assert.equal(F.advisorEligible({ questions:{ zirve5_decision:{} } }), true);
  assert.equal(F.advisorEligible({ questions:{ desk_action:{} } }), false, 'masa kendi advisors alanını taşıyor (R179)');
});
test('R2544.186 kısa biçim: yön başına sayılar ve gerekçe, ekran metinleri yok, ~0,5 kB', () => {
  const full = { authority:'EVIDENCE_ONLY', source:'GOXEL_PRO', symbol:'XUSDT', at:1, available:true, kind:'ENTRY_CONTEXT', instruction:'i',
    long:{ ok:false, checked:true, against:4, big:2, needBig:1, support:false, atLevel:true, why:'15 dk kırılım aleyhe • dirence geldi', screens:new Array(9).fill({ k:'TREND', a:true, t:'x'.repeat(80) }) },
    short:{ ok:true, checked:true, against:1, big:0, needBig:1, support:true, atLevel:false, why:null, screens:new Array(9).fill({ k:'TREND', a:false, t:'y'.repeat(80) }) } };
  const c = F.compactAdvisor(full);
  assert.equal(c.kind, 'ENTRY_CONTEXT_COMPACT'); assert.equal(c.long.goxelWouldEnter, false); assert.equal(c.long.against, 4); assert.equal(c.short.goxelWouldEnter, true);
  assert.ok(!JSON.stringify(c).includes('screens')); assert.ok(Buffer.byteLength(JSON.stringify(c)) < 700, Buffer.byteLength(JSON.stringify(c)) + '');
});
test('R2544.186 danışman notu sınırı aşarsa düşer, çağrı gövdesi aynen kalır', () => {
  const body = { model:'m', state:{ record:{ symbol:'XUSDT' } }, questions:{ top3_decision:{} } };
  const fits = F.withAdvisors(body, { available:true, x:1 }, () => ({ ok:true }));
  assert.deepEqual(fits.state.advisors, { available:true, x:1 });
  const tooBig = F.withAdvisors(body, { available:true, x:'z'.repeat(60000) }, b => ({ ok:JSON.stringify(b).length < 48000 }));
  assert.equal(tooBig.state.advisors.reason, 'GOXEL_ADVISOR_DROPPED_SIZE'); assert.deepEqual(tooBig.state.record, body.state.record);
  const thrown = F.withAdvisors(body, { available:true }, () => { throw new Error('x'); });
  assert.equal(thrown.state.advisors.reason, 'GOXEL_ADVISOR_DROPPED_SIZE');
});
test('R2544.186 kablolama: jev-decision giriş kapılarına da danışman ekler ve boyut korumasından geçirir', () => {
  assert.match(jd, /failoverPolicy\.advisorEligible\(body\)&&typeof decisionAdvisors==='function'/);
  assert.match(jd, /failoverPolicy\.withAdvisors\(body,failoverPolicy\.advisorOnly\(body\)\?failoverPolicy\.compactAdvisor\(adv\):adv,prepareDecisionRequest\)/);
});
