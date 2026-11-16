'use strict';
// R2544.180: the desk packet carries a per-coin, salience-ordered, DETERMINISTIC story (no fixed template, no randomness, hard cap)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const DESK = require('../position-desk');
const base = (sym, over = {}) => ({ symbol:sym, side:'LONG', rule:'R', lane:'ILK3',
  position:{ entry:100, initialStop:97, mark:101, nowR:0.33, mfeR:0.8, maeR:-0.2, givebackR:0.47, minutesOpen:45 },
  noiseR:{ m5:0.4 }, market:{ levels:{ high24h:104, low24h:96 }, btc1hPct:0.1, openInterestChange1hPct:0.2, funding:{ rate8hPct:0.005 },
    chartReading:{ m5:{ trend:'UP', events:[], patterns:[] }, h1:{ trend:'UP', events:[], patterns:[] } } }, ...over });
test('R2544.180 deterministic and capped: same input same story, never over 1400 chars', () => {
  const a = DESK.screenStory(base('AAAUSDT')), b = DESK.screenStory(base('AAAUSDT'));
  assert.equal(a, b); assert.ok(a.length > 60 && a.length <= 1400, a.length + ''); assert.match(a, /AAAUSDT LONG/); assert.match(a, /given back/);
});
test('R2544.180 the order follows the coin, not a template: a fresh break against outranks the trend map', () => {
  const quiet = DESK.screenStory(base('QUIETUSDT'));
  const loud = DESK.screenStory(base('LOUDUSDT', { market:{ ...base('x').market,
    chartReading:{ m5:{ trend:'DOWN', events:[{ kind:'CHOCH', side:'BEAR', barsAgo:0, R:-0.1 }], patterns:[{ type:'DOUBLE_TOP', side:'SHORT', status:'CONFIRMED' }] }, h1:{ trend:'DOWN', events:[], patterns:[] } } } }));
  assert.ok(quiet.indexOf('Trend map') < quiet.indexOf('24h range'), quiet);
  assert.ok(loud.indexOf('CHOCH BEAR 0 bars ago') < loud.indexOf('Trend map'), loud);
  assert.match(loud, /confirmed double top \(SHORT\)/);
  assert.notEqual(quiet.replace(/QUIET/g, 'X'), loud.replace(/LOUD/g, 'X'), 'two coins never read alike');
});
test('R2544.180 wiring: packet() computes the story itself, so JEV and the committee both read it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'position-desk.js'), 'utf8');
  assert.match(src, /pk\.story = screenStory\(pk\);/);
  assert.ok(src.indexOf('const pk = {\n    contract:DESK_VERSION, lane,') > 0);
});
test('R2544.180 broken input never throws: story is null, the packet still stands', () => {
  assert.equal(DESK.screenStory(null), null);
  const s = DESK.screenStory({ symbol:'XUSDT', side:'SHORT' }); assert.ok(s === null || typeof s === 'string');
});
