'use strict';
// R2544.173: KEŞİF-SÖZ lessons reach the next decision - same entry screen of earlier REAL KEŞİF-SÖZ trades + the model's real record go to the desk
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const T = require('../top3-hunter');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const pd = fs.readFileSync(path.join(__dirname, '..', 'position-desk.js'), 'utf8');
const sf = (o = {}) => ({ leanFor:0, leanAgainst:2, stopAtr5:1.3, firstObstacleR:0.9, pos24:27, liqTrap:false, chaseHigh:false, trend:{ h4:'DOWN', h1:'RANGE' }, ...o });
const L = (sym, side, R, s, extra = {}) => ({ symbol:sym, side, rule:'KESIF_SOZ', rMultiple:R, netPnl:R * 10, openedAt:1, closedAt:2, features:{ screenFacts:s, kesif:{ model:'m/dots:free' } }, ...extra });

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
  assert.deepStrictEqual(r.cases.map(c => c.exit).sort(), ['elle', 'masa', 'stop']);
  assert.match(r.text, /^KEŞİF-SÖZ benzer ekran, 3 gerçek işlem: 1 kazanç \/ 2 kayıp/); assert.match(r.text, /az örnek: anekdot/);
  assert.strictEqual(T.kesifScreenCases(ls, 'SHORT', sf(), { before:2 }).n, 0, 'only trades closed before the decision');
  assert.match(T.kesifScreenCases([], 'SHORT', sf()).text, /benzeyen gerçek işlem yok/);
});

test('R2544.173 the word holder model\'s REAL record (not its shadow forecasts); under 8 trades it says so', () => {
  const ls = [L('AUSDT', 'SHORT', -1, sf()), L('BUSDT', 'SHORT', 0.5, sf()), { ...L('CUSDT', 'SHORT', 3, sf()), features:{ screenFacts:sf(), kesif:{ model:'m/other' } } }];
  const b = T.kesifModelBook(ls, 'm/dots:free');
  assert.deepStrictEqual([b.n, b.wins, b.avgR, b.usd, b.verdict], [2, 1, -0.25, -5, 'AZ_ORNEK']);
  assert.match(b.text, /^dots gerçek işlemleri: 2 işlem, 1 kazanç, ort -0,25R, toplam -5,00\$ \(8 işlemden az: kanıt değil\)/);
});

test('R2544.173 wiring: written with the entry screen of a KEŞİF lot; the desk packet already carries experience + similar (no veto)', () => {
  assert.match(lc, /if\(lot\.lane==='KESIF'\)\{try\{const pool=top3State\.lessons\|\|\[\];ef\.similar=similarKeep\(top3Lib\.kesifScreenCases\(pool,lot\.side,sf\)\);ef\.experience=top3Lib\.kesifModelBook\(pool,ef\.kesif&&ef\.kesif\.model\);\}catch\{\}\}/);
  assert.match(pd, /experience:f\.experience \? \{ verdict:f\.experience\.verdict, text:String\(f\.experience\.text \|\| ''\)\.slice\(0, 300\) \} : null, similar:f\.similar\?\.text \? String\(f\.similar\.text\)\.slice\(0, 300\) : null/);
});
