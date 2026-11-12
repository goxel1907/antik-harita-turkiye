'use strict';
// R2544.167: KEŞİF reads, forecasts and trades ONLY the İlk 3 (#1-#3) and ZİRVE-5 (top 5) coins - no BTC, no volume list, no stock tokens
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const K = require('../kesif');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const T0 = Date.UTC(2026, 10, 13, 0, 0);
const tk = (symbol, ch, q) => ({ symbol, priceChangePercent:String(ch), quoteVolume:String(q), closeTime:T0 - 60000 });

test('R2544.167 with the İlk 3 + ZİRVE-5 list only those coins are read (even a low-volume one); BTC and the volume list are out', () => {
  const tick = [tk('AUSDT', 40, 5e7), tk('BTCUSDT', 1, 9e9), tk('NVDAUSDT', 3, 8e8), tk('LOWUSDT', 25, 1e6), tk('ZUSDT', -30, 4e7)];
  const only = new Map([['AUSDT', 'İlk 3 (#1)'], ['LOWUSDT', 'İlk 3 (#2)'], ['ZUSDT', 'ZİRVE-5 (#1)']]);
  const list = K.candidates(tick, { now:T0, only });
  assert.deepStrictEqual(list.map(x => x.symbol).sort(), ['AUSDT', 'LOWUSDT', 'ZUSDT']);
  assert.strictEqual(list.find(x => x.symbol === 'ZUSDT').why, 'ZİRVE-5 (#1)');
  assert.deepStrictEqual(K.candidates(tick, { now:T0, only:new Map() }), [], 'empty lists (just after a restart) -> nothing is read');
  assert.ok(K.candidates(tick, { now:T0 }).some(x => x.symbol === 'BTCUSDT'), 'the old call without `only` is unchanged');
});

test('R2544.167 wiring: both KEŞİF reads use the list; a word-holder forecast on a coin outside it never becomes a real trade', () => {
  assert.strictEqual((lc.match(/KESIF\.candidates\((await tickers\(\)|tick),\{now,only:kesifUniverse\(\)\}\)/g) || []).length, 2);
  assert.ok(!/KESIF\.candidates\((await tickers\(\)|tick),\{now\}\)/.test(lc), 'no KEŞİF read without the list');
  assert.match(lc, /if\(n>=1&&n<=3\)out\.set\(sym,'İlk 3 \(#'\+n\+'\)'\)/);
  assert.match(lc, /z5State\(\)\.lastScan\?\.top\|\|\[\]\)\.slice\(0,5\)/);
  assert.match(lc, /if\(!uni\.has\(sig\.symbol\)\)\{sozNote\(s,\{[^}]*reason:'KESIF_SOZ_LISTE_DISI'\}\);continue;\}/);
});
