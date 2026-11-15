'use strict';
// R2544.177: an İZ word-holder forecast becomes a trade right after İZ fires - never after the slow committee round (16.11: 2 min 20 s late)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
test('R2544.177 order inside the KEŞİF tick: İZ fire -> sozPass -> committee round (cm.poll) -> sozPass again', () => {
  const i = lc.indexOf("store.journal('IZ_FIRE'"), d = lc.indexOf('async function sozPass(){'), c1 = lc.indexOf('await sozPass();', d), poll = lc.indexOf('await cm.poll(', c1), c2 = lc.indexOf('await sozPass(); // R2544.177', poll);
  assert.ok(i > 0 && d > i && c1 > d && poll > c1 && c2 > poll, JSON.stringify({ i, d, c1, poll, c2 }));
  assert.strictEqual((lc.match(/await sozPass\(\);/g) || []).length, 2);
  assert.match(lc, /for\(const r of fresh\)\{r\.sozTried=true;changed=true;/, 'a forecast is tried once (no double entry from the two passes)');
});
