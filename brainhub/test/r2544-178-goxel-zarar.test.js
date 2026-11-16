'use strict';
// R2544.178 Goxel zarar gölgesi: a losing lot is read; "would exit" is recorded, NEVER ordered; compared at the close
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const K = require('../kesif');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
const pv = (netR, big, against) => ({ netR, curR:netR, big, against, screens:[{ against:true, txt:'1sa kırılım aleyhe' }, { against:true, txt:'satıcı baskın' }] });
test('R2544.178 the loss rule (fixed beforehand): net <= -0,3R + 1 big + 3 in all', () => {
  assert.strictEqual(K.goxelLossLook(pv(-0.45, 1, 3)).exit, true);
  assert.strictEqual(K.goxelLossLook(pv(-0.2, 2, 4)).exit, false, 'not deep enough');
  assert.strictEqual(K.goxelLossLook(pv(-0.6, 0, 4)).exit, false, 'no big screen');
  assert.strictEqual(K.goxelLossLook(pv(-0.6, 1, 2)).exit, false, 'too few screens');
});
test('R2544.178 the book compares Goxel\'s first "exit" R with the real R; under 8 it is not evidence', () => {
  const b = K.goxelLossBook([{ rMultiple:-1.07, goxelLoss:{ firstR:-0.52 } }, { rMultiple:-1.05, goxelLoss:{ firstR:-0.45 } }, { rMultiple:0.3, goxelLoss:{ firstR:-0.4 } }, { rMultiple:-1, goxelLoss:{ firstR:null } }]);
  assert.deepStrictEqual([b.watched, b.said, b.better, b.worse], [4, 3, 2, 1]);
  assert.match(b.text, /8 işlemden az: kanıt değil, yetki yok/);
});
test('R2544.178 wiring: shadow only (no deskOrder on the loss side), kept in the lesson, shown in Office', () => {
  const i = lc.indexOf('if(lossSide){'), j = lc.indexOf('continue;} // GÖLGE: no desk order, no close', i), seg = lc.slice(i, j);
  assert.ok(i > 0 && j > i); assert.ok(!/deskOrder|kickDeskOrders/.test(seg), 'the loss shadow never orders');
  assert.match(lc, /store\.journal\('GOXEL_LOSS_SHADOW'/);
  assert.match(lc, /if\(c\?\.goxelLoss\)lesson\.goxelLoss=\{n:c\.goxelLoss\.n\|\|0,firstAt:/);
  assert.match(lc, /goxelLoss:\(\(\)=>\{try\{return KESIF\.goxelLossBook\(/);
  assert.match(html, /el\.innerHTML=svg\+glc\+glh\+glz\+hth\+cbh\+/);
});
