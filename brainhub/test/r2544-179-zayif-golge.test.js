'use strict';
// R2544.179: a weak holder never opens a real trade (user 16.11); word holders still do
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
test('R2544.179 the weak branch returns before the gate, the slots, the order and Goxel', () => {
  const a = lc.indexOf('async function sozEnter(sig,s){'), w = lc.indexOf("if(sig.weak){try{store.journal('KESIF_ZAYIF_GOLGE'", a), g = lc.indexOf('if(!g.ok)return sozNote', a), o = lc.indexOf('top3Open(', a);
  assert.ok(a > 0 && w > a && g > w && (o < 0 || o > w), JSON.stringify({ a, w, g, o }));
  assert.match(lc, /return sozNote\(s,\{\.\.\.res,weak:true,opened:false,reason:'KESIF_ZAYIF_GOLGE'\}\);\}/);
  assert.match(html, /n\.reason==='KESIF_ZAYIF_GOLGE'\?'zayıf söz: yalnız gölge, gerçek işlem yok'/);
});
test('R2544.179 Office shows what JEV spent today, not "the cap minus spend" (which read like the OpenRouter account)', () => {
  assert.ok(!/remainingUsd\?\?'—'\)\)\}\$ kaldı/.test(html) && !/remainingUsd\?\?'—'\)\+'\$ kaldı'/.test(html), 'the old "$ kaldı" label is gone');
  assert.match(html, /\$ harcandı \(günlük tavan /);
});
