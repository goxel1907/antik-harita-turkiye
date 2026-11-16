'use strict';
// R2544.181: the plain-language card at the top of the command center's left column (user 16.11 screenshot mark)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
test('R2544.181 the card sits at the TOP of the left column, before the SONUÇ header', () => {
  const i = html.indexOf('<div class="cc-panel" id="ccPnl">');
  assert.ok(i > 0);
  const seg = html.slice(i, i + 220);
  assert.ok(seg.indexOf('id="ccSimple"') > 0 && seg.indexOf('id="ccSimple"') < seg.indexOf('💰 SONUÇ'), seg);
});
test('R2544.181 the card explains now / open trade / what it seeks / on find / who decides / today / why none / learning', () => {
  const i = html.indexOf('function ccSimple(s,m){'), j = html.indexOf('function renderCC(s){', i), seg = html.slice(i, j);
  assert.ok(i > 0 && j > i);
  for (const k of ['ŞU AN', 'AÇIK İŞLEM', 'NE ARIYOR', 'BULUNCA', 'KİM KARAR VERİR', 'BUGÜN', 'NEDEN YOK', 'ÖĞRENİYOR', 'EN BASİT ANLATIM'])
    assert.ok(seg.includes(k), k);
  assert.match(seg, /para riske etmez/);
  assert.match(html, /try\{ccSimple\(s,m\);\}catch\(e\)\{console\.warn\('simple',e\);\}/, 'called in renderCC');
});
test('R2544.181 autostart: the script now starts in EVERY mode; CANLI resumes only through the core\'s own auto-renew', () => {
  const ps = fs.readFileSync(path.join(__dirname, '..', 'jev-brain', 'JEV-OTOMATIK-BASLAT.ps1'), 'utf8');
  assert.ok(!/Yalniz mod TEST ise baslatir/.test(ps), 'old TEST-only rule gone');
  assert.match(ps, /HER MODDA baslatir/); assert.match(ps, /liveRenewTick/);
  assert.match(ps, /config\\trading-mode\.json/);
  assert.match(ps, /warnLiveOff/);
});
