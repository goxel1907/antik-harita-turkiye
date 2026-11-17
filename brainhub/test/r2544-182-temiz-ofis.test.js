'use strict';
// R2544.182: dead clutter removed, stale hidden, every big section gets a lane-style open/close button (view-only)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
test('R2544.182 dead blocks are gone: R2542 history tables, legacy setups card, old-rule note', () => {
  assert.ok(!html.includes('KAPANMIŞ İŞLEMLER — TÜM GEÇMİŞ / İŞLEM SÖZLEŞMESİ'));
  assert.ok(!html.includes('<table id="setups">'));
  assert.match(html, /if\(!document\.getElementById\('setups'\)\)return;/, 'renderer guarded, no crash');
  assert.ok(!html.includes('Eski kural (R2544.64'));
});
test('R2544.182 stale is hidden, not shown as fresh: old JEV decision view, old committee ticker rows, legacy JEV details closed', () => {
  assert.match(html, /24 saatten eski — gizlendi/);
  assert.match(html, /Date\.now\(\)-\+x\.at<172800000/);
  assert.ok(html.includes('id="legacyJevA" open'), 'R2544.188: ofis katı yeniden AÇIK (kullanıcı 20.10 ve 17.11)'); assert.ok(!html.includes('id="legacyJevB" open'));
});
test('R2544.182 section toggles: defaults keep the moment-focused set open, details/archives closed; view-only note present', () => {
  const i = html.indexOf('R2544.182 BÖLÜM AÇ/KAPA'); assert.ok(i > 0);
  const seg = html.slice(i);
  for (const k of ["['walletCard','Cüzdan / pozisyonlar',1]", "['ccCard','Komuta Merkezi',1]", "['secMirror','JEV canlı görüş aynası (grafikler)',1]", "['researchCard','Kaynak laboratuvarı (yalnız bilgi)',0]", "['top3Card','İlk 3 ayrıntı + ayarlar',0]"])
    assert.ok(seg.includes(k), k);
  assert.match(seg, /veri toplanmaya devam eder/);
  assert.match(html, /\.sec-off>\*:not\(\.sec-keep\)\{display:none!important\}/);
  assert.match(html, /id="secMirror"/); assert.match(html, /id="secLadder"/); assert.match(html, /id="secAnalysis"/);
});
