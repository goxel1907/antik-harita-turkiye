'use strict';
// R2544.165: the stop must come before the liquidation INCLUDING Binance's maintenance margin rate (12.11 PLAY: stop +7,03 %, liquidated at +5 %)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const safeMax = (stopPct, mmr) => Math.max(1, Math.floor(1 / (stopPct + mmr + 0.005)));

test('R2544.165 the PLAY case: 7 % stop with a 5 % maintenance rate cannot be held at 10x -> no trade; a normal coin still trades', () => {
  assert.strictEqual(safeMax(0.0703, 0.05), 7, 'PLAY: under the 10x floor -> TOP3_STOP_BEYOND_LIQUIDATION_AT_10X');
  assert.strictEqual(Math.floor(1 / (0.0703 + 0.005)), 13, 'the old check (no maintenance rate) let PLAY in at 10x');
  assert.ok(safeMax(0.025, 0.01) >= 10, 'a 2,5 % stop on a coin with 1 % maintenance trades at 10x+');
  assert.match(lc, /const safeMax=Math\.max\(1,Math\.floor\(1\/\(pre\.stopPct\+mmr\+0\.005\)\)\);/);
  assert.match(lc, /const mmr=mmrOf\(margin\*Math\.max\(10,finite\(cfg\.maxLeverage\)\?\?20\)\);/, 'the rate of the largest size the lot can reach');
  assert.match(lc, /Math\.max\(0,finite\(br\?\.maintMarginRatio\)\?\?0\.005\)/);
});

test('R2544.165 a liquidation / ADL is booked as such - never as the user\'s close (the human-teacher book leaves it out)', () => {
  assert.match(lc, /transport\._fetchJson\('GET','\/fapi\/v1\/forceOrders'/);
  assert.match(lc, /exitReason=\/ADL\/i\.test\(String\(x\?\.autoCloseType\|\|''\)\)\?'TOP3_ADL':'TOP3_LIQUIDATED'/);
  assert.match(lc, /TOP3_LIQUIDATED:'TOP3_LIQUIDATED',TOP3_ADL:'TOP3_ADL'\}/);
  assert.ok(!/_(EXTERNAL|USER)_CLOSE$/.test('TOP3_LIQUIDATED') && !/_(EXTERNAL|USER)_CLOSE$/.test('ZIRVE5_LIQUIDATED'));
});

test('R2544.165 a liquidation booked earlier as a hand close leaves the human-teacher book', () => {
  const K = require('../kesif');
  const L = (R, liq) => ({ symbol:'X', closedAt:1, rMultiple:R, userClose:{ by:'BINANCE', plan:{}, liquidated:liq, cf:{ planR:0, userR:R } } });
  assert.strictEqual(K.humanTeacher([L(0.5, false), L(-0.72, true)]).n, 1);
  assert.match(lc, /if\(!u\|\|u\.cf\|\|!u\.plan\|\|u\.liquidated\)continue;/);
});
