'use strict';
// R2544.173: KEŞİF-SÖZ lessons reach the next decision - same entry screen of earlier REAL KEŞİF-SÖZ trades + the model's real record go to the desk
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const T = require('../top3-hunter');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const pd = fs.readFileSync(path.join(__dirname, '..', 'position-desk.js'), 'utf8');
const sf = (o = {}) => ({ leanFor:0, leanAgainst:2, stopAtr5:1.3, firstObstacleR:0.9, pos24:27, liqTrap:false, chaseHigh:false, trend:{ h4:'DOWN', h1:'RANGE' }, ...o });
let N = 0;
const L = (sym, side, R, s, extra = {}) => ({ id:'ks' + (++N), mode:'LIVE', symbol:sym, side, rule:'KESIF_SOZ', rMultiple:R, netPnl:R * 10, openedAt:1, closedAt:2, features:{ screenFacts:s, kesif:{ model:'m/dots:free' } }, ...extra });

test('R2544.173 the screen vector reads the trend against the side; a LONG and a SHORT on the same screen differ', () => {
  const s = T.kesifScreenVector('SHORT', sf()), l = T.kesifScreenVector('LONG', sf());
  assert.deepStrictEqual([s.denge, s.stopAtr5, s.engel, s.h4, s.h1, s.yer24], ['ALEYHTE', 'NORMAL', 'ORTA', 'LEHTE', 'YATAY', 'DIP']);
  assert.strictEqual(l.h4, 'ALEYHTE'); assert.strictEqual(T.kesifScreenVector('LONG', null), null);
});

test('R2544.173 similar screens of earlier real KEŞİF-SÖZ trades: count, R, $, how they closed; other rules and other screens stay out', () => {
  const ls = [L('AUSDT', 'SHORT', -1.05, sf(), { exitType:'TOP3_STOP' }), L('BUSDT', 'SHORT', -0.42, sf(), { exitCheck:{ by:'MASA' } }), L('CUSDT', 'SHORT', 0.73, sf({ pos24:30 }), { userClose:{ by:'BINANCE' } }),
    L('DUSDT', 'LONG', 2, sf({ leanFor:3, leanAgainst:0, trend:{ h4:'UP', h1:'UP' }, pos24:80 })), { ...L('EUSDT', 'SHORT', 1, sf()), rule:'SHORT_TOP_BREAK' }];
  const r = T.kesifScreenCases(ls, 'SHORT', sf());
  assert.deepStrictEqual([r.n, r.wins, r.losses], [3, 1, 2]);
  assert.deepStrictEqual(r.cases.map(c => c.exit).sort(), ['dış kapanış', 'masa', 'stop'], 'a Binance-side close has no verified actor');
  assert.ok(r.cases.every(c => /^ks\d+$/.test(c.id) && c.closedAt === 2), 'each case keeps its lesson id + close time');
  assert.match(r.text, /^KEŞİF-SÖZ benzer ekran, 3 gerçek \(CANLI\) işlem: 1 kazanç \/ 2 kayıp/); assert.match(r.text, /az örnek: anekdot/);
  assert.strictEqual(T.kesifScreenCases(ls, 'SHORT', sf(), { before:2 }).n, 0, 'only trades closed before the decision');
  assert.match(T.kesifScreenCases([], 'SHORT', sf()).text, /benzeyen gerçek \(CANLI\) işlem yok/);
});

test('R2544.173 the word holder model\'s REAL record (not its shadow forecasts); under 8 trades it says so', () => {
  const ls = [L('AUSDT', 'SHORT', -1, sf()), L('BUSDT', 'SHORT', 0.5, sf()), { ...L('CUSDT', 'SHORT', 3, sf()), features:{ screenFacts:sf(), kesif:{ model:'m/other' } } }];
  const b = T.kesifModelBook(ls, 'm/dots:free');
  assert.deepStrictEqual([b.n, b.wins, b.avgR, b.usd, b.verdict], [2, 1, -0.25, -5, 'AZ_ORNEK']);
  assert.match(b.text, /^dots gerçek \(CANLI\) işlemleri: 2 işlem, 1 kazanç, ort -0,25R, toplam -5,00\$ \(8 işlemden az: kanıt değil\)/);
});

test('R2544.173 wiring: written with the entry screen of a KEŞİF lot; the desk packet already carries experience + similar (no veto)', () => {
  assert.match(lc, /sc=top3Lib\.kesifScreenCases\(pool,lot\.side,sf,\{before:t,mode\}\)/, 'only trades closed before this lot opened');
  assert.match(lc, /ef\.experience=top3Lib\.kesifModelBook\(pool,ef\.kesif&&ef\.kesif\.model,\{before:t\}\)/);
  assert.match(lc, /cases:sc\.cases\.map\(c=>\(\{id:c\.id,symbol:c\.symbol,R:c\.R,exit:c\.exit,at:c\.at,closedAt:c\.closedAt\}\)\)/);
  assert.match(pd, /experience:f\.experience \? \{ verdict:f\.experience\.verdict, text:String\(f\.experience\.text \|\| ''\)\.slice\(0, 300\) \} : null, similar:f\.similar\?\.text \? String\(f\.similar\.text\)\.slice\(0, 300\) : null/);
});

// Codex M5 review: P1 (future data), P2 (actor, TEST vs LIVE, unknown $, case identity reaching the desk packet)
test('R2544.173 M5: a trade closed AFTER this lot opened, or with an unknown close time, never counts', () => {
  const ls = [L('AUSDT', 'SHORT', -1, sf(), { closedAt:30 }), L('BUSDT', 'SHORT', -1, sf(), { closedAt:undefined }), L('CUSDT', 'SHORT', 1, sf(), { closedAt:10 })];
  const r = T.kesifScreenCases(ls, 'SHORT', sf(), { before:20 });
  assert.deepStrictEqual(r.cases.map(c => c.symbol), ['CUSDT']);
  assert.strictEqual(T.kesifModelBook(ls, 'm/dots:free', { before:20 }).n, 1);
});

test('R2544.173 M5: TEST (virtual) trades are never called real; an unknown $ is not 0', () => {
  const ls = [L('AUSDT', 'SHORT', -1, sf(), { mode:'TEST' }), L('BUSDT', 'SHORT', 0.5, sf(), { netPnl:undefined }), L('CUSDT', 'SHORT', 1, sf(), { netPnl:undefined })];
  const b = T.kesifModelBook(ls, 'm/dots:free');
  assert.deepStrictEqual([b.n, b.usd, b.usdKnown, b.test.n], [2, null, 0, 1]);
  assert.match(b.text, /toplam \$ bilinmiyor/); assert.match(b.text, /TEST \(sanal, gerçek para değil\): 1 işlem/);
  const r = T.kesifScreenCases(ls, 'SHORT', sf());
  assert.ok(r.cases.every(c => c.symbol !== 'AUSDT'), 'a TEST lesson is not among the real ones'); assert.match(r.text, /\$ bilinmiyor/);
  assert.strictEqual(T.kesifScreenCases(ls, 'SHORT', sf(), { mode:'TEST' }).n, 1, 'a TEST lot reads the TEST book, labelled as such');
});

test('R2544.173 M5: the desk packet the models receive carries this KEŞİF experience + similar text', () => {
  const DESK = require('../position-desk');
  const ls = [L('AUSDT', 'SHORT', -1.05, sf(), { exitType:'TOP3_STOP' }), L('BUSDT', 'SHORT', -0.42, sf(), { exitCheck:{ by:'MASA' } }), L('CUSDT', 'SHORT', 0.73, sf())];
  const sc = T.kesifScreenCases(ls, 'SHORT', sf()), mb = T.kesifModelBook(ls, 'm/dots:free');
  const lot = { symbol:'XUSDT', side:'SHORT', lane:'KESIF', entryPrice:1, stopPrice:1.03, initialStopPrice:1.03, tpPrice:0.94, openedAt:0, entryFeatures:{ similar:{ text:sc.text, cases:sc.cases }, experience:mb } };
  const p = DESK.packet({ lot, mark:0.99, k5:[], k15:[], k1h:[], btc5:[], oi:[], now:600000, lane:'KESIF' });
  const body = JSON.stringify(p);
  assert.match(body, /KEŞİF-SÖZ benzer ekran, 3 gerçek \(CANLI\) işlem/); assert.match(body, /dots gerçek \(CANLI\) işlemleri: 3 işlem/);
  assert.strictEqual(p.entryInfo.experience.verdict, 'AZ_ORNEK');
});
