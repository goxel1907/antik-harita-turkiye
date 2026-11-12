'use strict';
// R2544.166: every closed real lot keeps Goxel's last look; desk / Goxel exits get the plan counterfactual too; who closed, against the plan
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const K = require('../kesif');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');

test('R2544.166 the closer book: user / desk / Goxel / plan / liquidation, plan result on the same trades, what Goxel said', () => {
  const gx = close => ({ watching:true, close, against:2 });
  const b = K.closerBook([
    { rMultiple:0.98, userClose:{ by:'BINANCE', cf:{ planR:1.57, userR:0.98 } }, goxel:gx(false) },
    { rMultiple:-0.72, userClose:{ by:'BINANCE', liquidated:true }, goxel:gx(false) },
    { rMultiple:-0.56, exitCheck:{ by:'MASA', cf:{ planR:-1.05 } }, goxel:gx(false) },
    { rMultiple:0.07, exitCheck:{ by:'GOXEL' }, goxel:gx(true) },
    { rMultiple:-1.1, exitType:'TOP3_STOP', goxel:{ watching:false } },
    { rMultiple:2, exitType:'TOP3_TAKE_PROFIT' }]);
  const by = Object.fromEntries(b.rows.map(r => [r.by, r]));
  assert.strictEqual(b.n, 5, 'a lesson with no Goxel look and no exit record (old) is left out');
  assert.deepStrictEqual([by.SIZ.n, by.SIZ.avgPlanR, by.SIZ.deltaR], [1, 1.57, -0.59]);
  assert.strictEqual(by.TASFIYE.n, 1, 'a liquidation is not the user\'s close');
  assert.deepStrictEqual([by.MASA.avgR, by.MASA.avgPlanR, by.MASA.deltaR], [-0.56, -1.05, 0.49]);
  assert.deepStrictEqual([by.GOXEL.n, by.GOXEL.goxelSaidExit, by.GOXEL.avgPlanR], [1, 1, null]);
  assert.deepStrictEqual([by.PLAN.n, by.PLAN.goxelSeen], [1, 0]);
});

test('R2544.166 wiring: Goxel\'s last look on every lesson; desk and Goxel exits keep the plan; the counterfactual tick covers them', () => {
  assert.match(lc, /lesson\.goxel=gxCompact\(c\?\.goxel\);/);
  assert.match(lc, /if\(\/_DESK_EXIT\$\/\.test\(x\)\)\{const last=\[\.\.\.\(c\?\.desk\?\.decisions\|\|\[\]\)\]\.reverse\(\)\.find\(d=>d&&d\.action==='EXIT'\);lesson\.exitCheck=\{by:last\?\.judge==='GOXEL'\?'GOXEL':'MASA',plan:DESK\.planOf\(c\)/);
  assert.match(lc, /const u=l\.userClose\|\|l\.exitCheck;if\(!u\|\|u\.cf\|\|!u\.plan\|\|u\.liquidated\)continue;/);
  assert.match(lc, /closers:\(\(\)=>\{try\{return KESIF\.closerBook\(/);
  assert.strictEqual(K.humanTeacher([{ symbol:'X', closedAt:1, rMultiple:0.5, exitCheck:{ by:'MASA', cf:{ planR:0, userR:0.5 } } }]).n, 0, 'desk exits never enter the user\'s book');
});
