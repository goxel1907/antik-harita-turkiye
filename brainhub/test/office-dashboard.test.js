'use strict';
// CLAUDE_V109_OFFICE_DASHBOARD: salt-okunur Trade Office ekranının temel sözleşmesi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'office-dashboard');
const office = require(path.join(dir, 'office-server.js'));

test('office dashboard is read-only and never whitelists Brain Hub write routes', () => {
  const src = fs.readFileSync(path.join(dir, 'office-server.js'), 'utf8');
  assert.match(src, /req\.method !== 'GET'/);
  const m = src.match(/ALLOWED_BRAIN_PATHS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m);
  for (const bad of ['/live/arm', '/live/disarm', '/leader/auto', '/live/order', '/pair']) assert.equal(m[1].includes(`'${bad}'`), false, bad);
});

test('office derive() reports v109 shadow state and flags an old PC version', () => {
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'demo-snapshot.json'), 'utf8'));
  const sim = JSON.parse(fs.readFileSync(path.join(dir, 'demo-sim-v109.json'), 'utf8'));
  const b = office.derive(base).blockers.map(x => x.code);
  assert.ok(b.includes('VERSION_OLD'));
  assert.ok(b.includes('NO_QUALIFIED'));
  const s = office.derive(sim).blockers.map(x => x.code);
  assert.ok(s.includes('SHADOW'));
  assert.equal(s.includes('VERSION_OLD'), false);
});

test('office wait rule matches the Brain Hub wait-condition rule', () => {
  const { isNonConcreteWait } = require('../wait-condition');
  for (const w of ['NONE', 'NONE — x', 'NONE (x)', 'YOK - x', '', 'Model somut bekleme koşulu üretmedi', '15m kapanışı 1.2 üstünde']) {
    assert.equal(office.waitIsFake(w), isNonConcreteWait(w), w);
  }
});

test('office scrub removes secret-like fields', () => {
  const out = office.scrub({ apiKey:'x', nested:{ token:'y', ok:1 }, list:[{ secret:'z', v:2 }] });
  assert.equal(JSON.stringify(out).includes('"x"'), false);
  assert.equal(JSON.stringify(out).includes('"y"'), false);
  assert.equal(JSON.stringify(out).includes('"z"'), false);
});


test('office recognizes v9.5.111 and describes JEV as final strategic authority with Turkish mandatory safety wording', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(dir, 'demo-sim-v109.json'), 'utf8'));
  snap.health = snap.health || { ok:true, data:{} };
  snap.health.ok = true;
  snap.health.data = { ...(snap.health.data||{}), featureVersion:'9.5.111-CLAUDE-VISION' };
  snap.status = snap.status || { ok:true, data:{} };
  snap.status.ok = true;
  snap.status.data = { ...(snap.status.data||{}), featureVersion:'9.5.111-CLAUDE-VISION' };
  const blockers = office.derive(snap).blockers;
  assert.equal(blockers.some(x => x.code === 'VERSION_OLD'), false);
  const html = fs.readFileSync(path.join(dir, 'public', 'office.html'), 'utf8');
  assert.match(html, /JEV SON KARAR YETKİSİ/);
  assert.match(html, /JEV sonrası yalnız zorunlu güvenlik/);
});


test('R2541 Office keeps JEV policy DOM refresh null-safe and exposes full-width atomic Turkish JEV mirror telemetry', () => {
  const html = fs.readFileSync(path.join(dir, 'public', 'office.html'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(dir, 'office-server.js'), 'utf8');
  assert.match(serverSrc, /2\.1\.0-JEV-TRADER-OFFICE-R2542/);
  assert.match(html, /const jevPolicyEl=\$\('#jevPolicy'\); if\(jevPolicyEl\)/);
  assert.equal(html.includes("$('#jevPolicy').textContent ="), false);
  assert.match(html, /JEV Cortex/);
  assert.match(html, /Dinamik araştırma/);
  assert.match(html, /JEV piyasa bağlamı/);
  assert.match(html, /ŞİMDİ PİYASA GİRİŞİ değilse emir yetkilenmez/);
  assert.match(html, /yeniden deneme\/yedek geçiş/);
  assert.match(html, /OSS kaynak/);
  assert.match(html, /Pozisyon yürütme/);
  assert.match(html, /Son pozisyon yürütmesi/);
  assert.match(html, /Deneyim hafızası/);
  assert.match(html, /ömür boyu özet/);
  assert.match(html, /sovereignSelectivityDiagnostic/);
  assert.match(html, /BLOK YOK/);
  assert.match(serverSrc, /\/api\/jev-mirror/);
  assert.match(serverSrc, /\/api\/chart/);
  assert.match(serverSrc, /\/context\/jev-live-mirror/);
  assert.match(html, /JEV Canlı Görüş Aynası/);
  assert.match(html, /mirrorClean/);
  assert.match(html, /mirrorAnnotated/);
  assert.match(html, /Paket ↔ grafik/);
  assert.match(html, /Vision metin aynası/);
  assert.match(html, /JEV PNG pikselini doğrudan tüketmez/);
  assert.match(html, /JEV Canlı Görüş Aynası — Tam Görünüm/);
  assert.match(html, /TAM AÇIKLAMALI/);
  assert.match(html, /Gözlenen tasfiye bölgeleri/);
  assert.match(html, /Fib (retracement|geri çekilme)/);
  assert.match(html, /Boğa OB/);
  assert.match(html, /Ayı OB/);
  assert.match(html, /Oluşumlar/);
  assert.match(html, /mirror-charts/);
});


test('R2542 Trader Office per-desk performance is visible and read-only', () => {
  const html = fs.readFileSync(path.join(dir, 'public', 'office.html'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(dir, 'office-server.js'), 'utf8');
  assert.match(serverSrc,/2\.1\.0-JEV-TRADER-OFFICE-R2542/);
  assert.match(html,/R2542 Trader Office • 5M Scalper \/ 15M Trader performansı/);
  assert.match(html,/id="deskPerf"/);
  assert.match(html,/sovereignDeskStats/);
  assert.match(html,/deskSummary/);
  assert.match(html,/MARKET_NOW/);
  assert.match(html,/WAIT zamanlama/);
  assert.match(html,/Net R/);
  assert.match(html,/Ort R/);
});
