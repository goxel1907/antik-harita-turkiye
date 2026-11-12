'use strict';
// R2544.161 İNSAN ÖĞRETMEN: the user's hand closes against the plan ("plana bırakılsaydı") and Goxel's last look, on the same trades
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const K = require('../kesif'), DESK = require('../position-desk');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');

test('R2544.161 the book: user vs plan vs Goxel, ready at 8, Goxel\'s screens at the exit', () => {
  const L = (R, planR, gx) => ({ symbol:'X', side:'SHORT', closedAt:1, rMultiple:R, userClose:{ by:'BINANCE', plan:{}, goxel:gx, cf:planR === undefined ? undefined : { planR, userR:R } } });
  const gx = (close, against, a) => ({ watching:true, close, against, curR:0.9, screens:[{ k:'KAR', a }, { k:'GRAFIK', a:true }] });
  let b = K.humanTeacher([L(0.98, -1.07, gx(false, 2, true)), L(-0.05, 1.5, gx(true, 3, false)), L(0.4, undefined, null), { symbol:'Y', userClose:null }]);
  assert.deepStrictEqual([b.n, b.pending, b.userR, b.planR, b.better, b.worse, b.goxelSeen, b.goxelAgreed, b.againstAtExit, b.ready], [2, 1, 0.465, 0.215, 1, 1, 2, 1, 2.5, false]);
  assert.deepStrictEqual(b.screens, [{ k:'GRAFIK', n:2, pct:100 }, { k:'KAR', n:2, pct:50 }]);
  assert.match(b.tr, /2 elle kapanış: siz ort\. 0\.465R, plana bırakılsaydı 0\.215R/); assert.match(b.tr, /en az 8 kapanış/);
  b = K.humanTeacher(Array.from({ length:8 }, () => L(0.5, 0.2, null)));assert.strictEqual(b.ready, true);
  assert.strictEqual(K.humanTeacher([]).tr, 'henüz elle kapanış yok');
});

test('R2544.161 the plan counterfactual of a hand close is the desk\'s own simulation with no decisions', () => {
  // SHORT entry 100, stop 102, target 96, the price falls to 95.9 after the user left -> the plan would have taken the target (+2R)
  const M5 = 300000, T = 1794400000000, c = (i, o, h, l, cl) => [T + i * M5, String(o), String(h), String(l), String(cl), '1', T + (i + 1) * M5 - 1, '1', 1, '1', '1', '0'];
  const plan = { side:'SHORT', entry:100, stop:102, tp:96, partAtR:0, partShare:0.5, beFee:0.0012, openedAt:T, deadline:T + 10 * M5 };
  const cf = DESK.counterfactual({ plan, decisions:[] }, [c(0, 100, 100.5, 99, 99.2), c(1, 99.2, 99.5, 97, 97.5), c(2, 97.5, 98, 95.9, 96)]);
  assert.strictEqual(cf.ok, true); assert.ok(cf.ruleR > 1.8, String(cf.ruleR));
});

test('R2544.161 wiring: both lesson books mark hand closes, the plan is kept, the tick computes after the plan\'s time, Office shows it', () => {
  assert.strictEqual((lc.match(/humanCloseMark\(lesson,c,record\); \/\/ R2544\.161/g) || []).length, 2, 'İlk 3 / KEŞİF-SÖZ and ZİRVE-5 lessons');
  assert.match(lc, /if\(\/_\(EXTERNAL\|USER\)_CLOSE\$\/\.test\(x\)\)\{lesson\.userClose=/, 'R2544.166: hand closes marked, other exits keep Goxel and their own record');
  assert.match(lc, /lesson\.userClose=\{by:\/_USER_CLOSE\$\/\.test\(x\)\?'OFFICE':'BINANCE',plan:DESK\.planOf\(c\),goxel:c\?\.goxel\|\|null/);
  assert.match(lc, /if\(now<end\+10\*60000\)continue;/, 'only after the plan\'s own time');
  assert.match(lc, /DESK\.counterfactual\(\{plan:u\.plan,decisions:\[\]\},k\)/);
  assert.match(lc, /screens:pv\.screens\.map\(x=>\(\{k:x\.key,a:x\.against\}\)\)/, 'Goxel\'s screens stay on the lot');
  assert.match(lc, /human:\(\(\)=>\{try\{return KESIF\.humanTeacher\(/);
  const h = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
  assert.match(h, /Sizden öğrenilen \(elle kapattıklarınız\)/);
});
