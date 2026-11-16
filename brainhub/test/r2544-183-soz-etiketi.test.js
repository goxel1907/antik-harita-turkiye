'use strict';
// R2544.183: the screen never again calls a WEAK candidate a word holder (16.11: 4 weak losses showed 'söz sahibi')
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
test('R2544.183 top3Why reads the weak flag and says ZAYIF aday, not söz sahibi', () => {
  const i = lc.indexOf("function top3Why(a){"), seg = lc.slice(i, i + 900);
  assert.match(seg, /weak\)\s*===\s*true|\.weak\)===true/);
  assert.match(seg, /ZAYIF aday \(söz sahibi DEĞİL/);
  assert.match(lc, /kesif:\{model:sig\.soz\.model,weak:sig\.soz\.weak===true,/, 'the lot itself carries weak');
});
