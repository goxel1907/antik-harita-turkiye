'use strict';
// R2544.191 (Codex 17.11 bağımsız inceleme): JEV'e giden paralel kurul görüşü dürüst olmalı.
// Gerçek live-controller.js parçası (deskCmViews … deskCmKick) yalıtılmış bağlamda çalıştırılır; düzeltme kaldırılınca ilgili test kırılır.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const D = require('../position-desk');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const piece = lc.slice(lc.indexOf('  const deskCmViews='), lc.indexOf('  // R2544.134 KURUL KARNESİ'));
const resp = (action = 'HOLD', consensus = 'UNANIMOUS', votes = null) => ({ ok: true, final: action, consensus, rounds: 1, voters: votes ? votes.length : 2,
  votes: votes || [{ member: 'FAKE:A', ok: true, vote: { action, stopChoice: 'KEEP', reason: 'NO_EDGE' } }, { member: 'FAKE:B', ok: true, vote: { action, stopChoice: 'KEEP', reason: 'NO_EDGE' } }] });
function harness(decide, lessons = []) {
  const box = { now: Date.UTC(2026, 10, 17, 12) }, a = { id: 'lot1', lane: 'ZIRVE5' };
  const state = { active: { lot1: a }, lessons }, z5 = { lessons: [], active: {} };
  const ctx = { clock: () => box.now, top3State: state, z5State: () => z5, DESK: D, deskJudges: { committee: { decide } },
    finite: v => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; } };
  vm.createContext(ctx);
  vm.runInContext(piece + '\nthis.p={deskCmKick,deskCmView,deskCmKarne,deskCmShared,deskCmJobs,deskPacketAt};', ctx);
  return { ...ctx.p, box, a };
}
const pk = (asOf, extra = {}) => ({ symbol: 'XUSDT', side: 'LONG', lane: 'ZIRVE5', dataCheck: { asOf }, ...extra });
const settle = () => new Promise(r => setTimeout(r, 5));

test('F4 veri yaşı ve 15 dk eskime kapısı PİYASA PAKETİNİN zamanından; cevap zamanı ayrı', async () => {
  let release;const h = harness(() => new Promise(r => { release = () => r(resp('EXIT')); }));
  const p = pk(h.box.now - 20000);
  h.deskCmKick(h.a, p, 'LIVE', {}, null, h.deskCmShared(h.a.id, p));
  await settle(); h.box.now += 180000; release(); await settle(); // kurul 3 dk sonra cevap verdi
  const v = h.deskCmView(h.a, h.box.now);
  assert.equal(v.available, true); assert.equal(v.ageSec, 200, 'paket 200 sn önce kuruldu'); assert.equal(v.answeredSecAgo, 0, 'cevap şimdi geldi');
  h.box.now += 13 * 60000 + 1000; // cevaptan 13 dk sonra, paketten 16 dk sonra
  const old = h.deskCmView(h.a, h.box.now);
  assert.equal(old.available, false, 'eskime paketin zamanından: cevap 13 dk ama veri 16 dk'); assert.equal(old.reason, 'KURUL_GORUSU_ESKI');
});

test('F5 ilk JEV 402 turunda paralel görüş ile yetkili yedek AYNI kurul işini paylaşır: tek çağrı', async () => {
  let calls = 0;const h = harness(async () => { calls++; await settle(); return resp('EXIT'); });
  const p = pk(h.box.now), shared = h.deskCmShared(h.a.id, p);
  h.deskCmKick(h.a, p, 'LIVE', {}, null, shared);
  const res = await D.judge({ packet: p, mode: 'LIVE', cfg: { liveJudges: ['JEV', 'COMMITTEE'] }, judges: { committee: shared, jev: async () => ({ ok: false, called: true, reason: 'OPENROUTER_402' }) } });
  await settle();
  assert.equal(res.judge, 'COMMITTEE'); assert.equal(res.d.action, 'EXIT');
  assert.equal(calls, 1, 'ilk 402 turunda tek committee.decide');
  assert.equal(h.deskCmView(h.a, h.box.now).final, 'EXIT', 'paralel görüş ile yetkili karar aynı işten');
});

test('F5 kredi bekleme turlarında her bakış tek iş; FARKLI/ESKİ paket paylaşılmaz', async () => {
  let calls = 0;const h = harness(async () => { calls++; await settle(); return resp('HOLD'); });
  const jev = async () => ({ ok: false, called: false, reason: 'JEV_CREDIT_WAIT' });
  for (let look = 1; look <= 3; look++) {
    h.box.now += 2 * 60000;const p = pk(h.box.now), shared = h.deskCmShared(h.a.id, p);
    h.deskCmKick(h.a, p, 'LIVE', {}, null, shared);
    await D.judge({ packet: p, mode: 'LIVE', cfg: { liveJudges: ['JEV', 'COMMITTEE'] }, judges: { committee: shared, jev } });await settle();
    assert.equal(calls, look, 'bakış ' + look + ': yalnız bir kurul çağrısı');
  }
  const pOld = pk(h.box.now - 60000), pNew = pk(h.box.now);
  await h.deskCmShared(h.a.id, pOld).decide({});await h.deskCmShared(h.a.id, pNew).decide({});
  assert.equal(calls, 5, 'farklı paket nesnesi = ayrı iş (eski cevap körlemesine kullanılmaz)');
});

test('F1 paralel kurul Goxel + giriş notunu görür; kendi görüşünü danışman diye almaz', async () => {
  let prompt = null;const h = harness(async o => { prompt = JSON.parse(o.prompt); return resp('HOLD'); });
  const p = pk(h.box.now);h.deskCmKick(h.a, p, 'LIVE', {}, { goxel: { saysExit: true }, entry: { openedBy: 'RULE' } }, h.deskCmShared(h.a.id, p));await settle();
  assert.equal(prompt.advisors.goxel.saysExit, true); assert.equal(prompt.advisors.entry.openedBy, 'RULE'); assert.ok(!('committee' in prompt.advisors));
});

test('F2 karne doğru kapsam: ZİRVE-5 lotuna İlk 3 karnesi verilmez; karne "masa (JEV+kurul)" diye etiketli', () => {
  const lessons = [{ rMultiple: -1, desk: { cf: { ok: true, acted: 1, ruleR: 1, deskR: 0, deltaR: -1 } } }];
  const h = harness(async () => resp(), lessons);
  const z = h.deskCmKarne('ZIRVE5');assert.equal(z.kind, 'NONE'); assert.equal(z.lane, 'ZIRVE5');
  const t = h.deskCmKarne('ILK3');assert.ok(t.kind === 'NONE' || t.kind === 'DESK_JEV_PLUS_COMMITTEE_NOT_COMMITTEE_ONLY', JSON.stringify(t));
  if (t.kind !== 'NONE') assert.equal(t.lane, 'ILK3');
});

test('F3 mekanik TUT gerçek görüşten ayrılır: tek oy / çoğunluk yok -> final yok, oylar kanıt; gerçek çoğunluk -> final', async () => {
  const one = resp('HOLD', 'SINGLE_VOTER_DEFAULT', [{ member: 'FAKE:A', ok: true, vote: { action: 'EXIT', stopChoice: 'KEEP', reason: 'NO_EDGE' } }]);
  let h = harness(async () => one);let p = pk(h.box.now);h.deskCmKick(h.a, p, 'LIVE', {}, null, h.deskCmShared(h.a.id, p));await settle();
  let v = h.deskCmView(h.a, h.box.now);assert.equal(v.final, null); assert.equal(v.noOpinion, 'SINGLE_VOTER_DEFAULT'); assert.deepEqual({ ...v.counts }, { EXIT: 1 });
  h = harness(async () => resp('EXIT', 'UNANIMOUS'));p = pk(h.box.now);h.deskCmKick(h.a, p, 'LIVE', {}, null, h.deskCmShared(h.a.id, p));await settle();
  v = h.deskCmView(h.a, h.box.now);assert.equal(v.final, 'EXIT'); assert.equal(v.noOpinion, undefined);
});

test('lastAt: masa bakışından sonra istatistik zamanı gerçekten yazılır (kod satırı yoruma yapışık değil)', () => {
  const seg = lc.slice(lc.indexOf('const res=await (auth?DESK.judge('), lc.indexOf('const desk=a.desk||'));
  assert.match(seg, /^[^\n/]*st\.lastAt=new Date\(now\)\.toISOString\(\);/m);
  assert.ok(!/\/\/[^\n]*st\.lastAt=/.test(seg), 'atama yorumun içinde değil');
});
