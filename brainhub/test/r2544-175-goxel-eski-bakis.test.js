'use strict';
// R2544.175: a closed lot's last Goxel look is never shown as a live real lot (13.11 BULLA was shown "now" on 15.11)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
test('R2544.175 the status keeps only lots that are still open; a closed lot goes to closedLook with its age', () => {
  assert.match(lc, /goxelLive:goxelLiveView\(s\.goxelLiveLast\)/);
  const src = lc.slice(lc.indexOf('function goxelLiveView(g){'), lc.indexOf('async function goxelLive(now,s){'));
  const top3State = { active:{ t1:{} } }, finite = v => (Number.isFinite(Number(v)) && v !== null ? Number(v) : null), clock = () => 100000;
  const view = new Function('top3State', 'finite', 'clock', src + '; return goxelLiveView;')(top3State, finite, clock);
  const v = view({ at:40000, ordered:0, lots:[{ id:'ks0e20ca9e3859cf', symbol:'BULLAUSDT', side:'LONG', real:true, curR:-0.96 }, { id:'t1', symbol:'KITEUSDT', side:'SHORT', real:true, curR:0.1 }] });
  assert.deepStrictEqual(v.lots.map(x => x.id), ['t1']);
  assert.deepStrictEqual(v.closedLook.lots.map(x => x.symbol), ['BULLAUSDT']); assert.strictEqual(v.ageSec, 60);
  const none = view({ at:40000, lots:[{ id:'ks0e20ca9e3859cf', symbol:'BULLAUSDT', side:'LONG', real:true }] });
  assert.deepStrictEqual(none.lots, [], 'no open lot -> nothing is "now"');
  assert.strictEqual(view(null), null);
});
test('R2544.175 Office: with no open real lot it says so and names the closed lot with its age', () => {
  assert.match(html, /Açık gerçek lot yok • son bakılan kapanmış lot:/);
});
