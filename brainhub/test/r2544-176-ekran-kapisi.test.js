'use strict';
// R2544.176 EKRAN KAPISI: lehte - aleyhte <= -2 -> no entry on any lane; the blocked plan is measured forward on its own 5m candles
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const T = require('../top3-hunter');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');

test('R2544.176 the gate: -2 or worse blocks (16.11 KITE 1/3, TAC 0/4); mixed and favourable pass; an unread screen never blocks', () => {
  assert.strictEqual(T.screenGate({ leanFor:1, leanAgainst:3 }).block, true, 'KITE');
  assert.strictEqual(T.screenGate({ leanFor:0, leanAgainst:4 }).block, true, 'TAC');
  assert.strictEqual(T.screenGate({ leanFor:1, leanAgainst:2 }).block, false);
  assert.strictEqual(T.screenGate({ leanFor:3, leanAgainst:0 }).block, false);
  assert.deepStrictEqual(T.screenGate(null), { block:false, known:false, balance:null }, 'sabit kural 3: no screen -> no waiting, no block');
});

test('R2544.176 the forward measurement: stop first / target first on the 5m candles after the block; a candle touching both = stop', () => {
  const at = 1_000_000, c = { side:'SHORT', entry:100, stop:102, target:96, at, horizonMs:3600000 };
  const k = (i, h, l, cl) => [at + i * 300000, 0, h, l, cl];
  assert.deepStrictEqual(T.screenGateOutcome(c, [k(0, 101, 99, 100), k(1, 102.5, 99, 101)]), { outcome:'STOP', R:-1, at:at + 300000 });
  assert.deepStrictEqual(T.screenGateOutcome(c, [k(1, 101, 95.5, 96)]), { outcome:'TARGET', R:2, at:at + 300000 });
  assert.strictEqual(T.screenGateOutcome(c, [k(1, 103, 95, 99)]).outcome, 'STOP', 'both on one candle = stop (no flattering)');
  assert.strictEqual(T.screenGateOutcome(c, [k(1, 101, 99, 100)], { now:at + 600000 }), null, 'not finished yet');
  assert.deepStrictEqual(T.screenGateOutcome(c, [k(1, 101, 99, 100), k(11, 101, 99, 99)], { now:at + 7200000 }), { outcome:'TIME', R:0.5, at:at + 11 * 300000 });
  const b = T.screenGateBook([{ symbol:'A', result:{ R:-1 } }, { symbol:'B', result:{ R:2 } }, { symbol:'C', result:null }]);
  assert.deepStrictEqual([b.blocked, b.resolved, b.wins, b.sumR], [3, 2, 1, 1]); assert.match(b.text, /eksi = kapı korudu/);
});

test('R2544.176 wiring: before the leverage / order on every lane; kept + journalled; measured; shown in Office', () => {
  const g = lc.indexOf("reason:'ENTRY_SCREEN_AGAINST'"), lev = lc.indexOf("transport._fetchJson('POST','/fapi/v1/leverage',{credentials:creds,signed:true,params:{symbol,leverage:String(leverage)}})");
  assert.ok(g > 0 && lev > g, 'the gate returns before the leverage call of top3Open');
  assert.match(lc, /const sf=await entryScreenFacts\(\{symbol,side,rule:gRule,entry:price,stop:finite\(pre\.stopPrice\),target:finite\(pre\.tpPrice\)\}\)/);
  assert.match(lc, /store\.journal\('ENTRY_SCREEN_GATE',symbol,c\)/);
  assert.match(lc, /screenGateTick\(\)\.catch/); assert.match(lc, /goxelLiveTick\(\)\.catch\(\(\)=>\{\}\);screenGateLoop\(\);/);
  assert.match(lc, /function screenGateOn\(\)\{try\{const c=JSON\.parse\(fs\.readFileSync\(path\.join\(String\(root\),'config','screen-gate\.json'\),'utf8'\)\);return c\?\.enabled!==false;\}catch\{return true;\}\}/, 'missing file = ON');
  assert.match(lc, /if\(screenGateOn\(\)\)\{const gRule=/);
  assert.match(lc, /screenGate:\(\(\)=>\{try\{return top3Lib\.screenGateBook\(top3State\.screenGate\);\}catch\{return null;\}\}\)\(\)/);
  assert.match(html, /n\.reason==='ENTRY_SCREEN_AGAINST'\?'ekran aleyhte \(zaman dilimleri ters\)'/);
  assert.match(html, /🛡 \$\{esc\(m\.sg\)\}/);
});
