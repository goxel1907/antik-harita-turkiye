'use strict';
// R2544.186: 9Router isteğe bağlı — anahtarsız kurulumda çekirdek kapanmaz; anahtar varken davranış aynı
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const sv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
test('R2544.186 anahtar yoksa process.exit yok, uyarı + ROUTER_DISABLED', () => {
  assert.ok(!/if\(!KEY\)\{console\.error\('BRAINHUB_ROUTER_KEY missing'\);process\.exit\(2\);\}/.test(sv));
  assert.match(sv, /const ROUTER_DISABLED=!KEY;/);
  assert.match(sv, /9Router disabled \(optional module\); core continues/);
});
test('R2544.186 9Router yolları anahtarsızken hemen döner (keşif, çağrı, kurul kimlik yenileme)', () => {
  assert.match(sv, /if\(ROUTER_DISABLED\)\{routerDiscovery\.lastError='ROUTER_KEY_MISSING';return routerDiscovery;\}/);
  assert.match(sv, /if\(!isLocal&&ROUTER_DISABLED\)throw new Error\('ROUTER_KEY_MISSING'\);/);
  assert.match(sv, /async function refreshCommitteeRouterIds\(\)\{if\(ROUTER_DISABLED\)return;/);
});
test('R2544.186 /health routerKeyLoaded gerçeği söyler (eskiden sabit true)', () => {
  assert.ok(!sv.includes('routerKeyLoaded:true'));
  assert.match(sv, /routerKeyLoaded:!ROUTER_DISABLED/);
});
