'use strict';
// R2544.148 KEŞİF: the models write their OWN forecast of the next move; the code scores it forward on real candles (no historical data)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const K = require('../kesif');
const M5 = 300000, H = 3600000, T0 = Math.floor(1794400000000 / M5) * M5;
const bar = (i, o, h, l, c) => [T0 + i * M5, o, h, l, c, 1000, T0 + (i + 1) * M5 - 1, 100000, 10, 500, 50000, 0];

test('R2544.148 parse: a forecast needs a direction, a stop and a target; NONE is a valid answer; numbers stay inside the band', () => {
  const p = K.parse('thinking... {"direction":"long","stopPct":2.5,"targetPct":6,"horizonH":4,"confidence":70,"reasonTr":"süpürme sonrası dönüş","wrongIfTr":"dip kırılırsa"}');
  assert.deepStrictEqual([p.ok, p.direction, p.stopPct, p.targetPct, p.horizonH, p.confidence], [true, 'LONG', 2.5, 6, 4, 70]);
  assert.strictEqual(K.parse('{"direction":"SELL","stopPct":3,"targetPct":5}').direction, 'SHORT');
  const n = K.parse('{"direction":"NONE","confidence":40,"reasonTr":"okunur hamle yok"}'); assert.deepStrictEqual([n.ok, n.direction, n.stopPct], [true, 'NONE', undefined]);
  const c = K.parse('{"direction":"LONG","stopPct":0.3,"targetPct":0.2,"horizonH":200}');
  assert.deepStrictEqual([c.stopPct, c.targetPct, c.horizonH, c.adjusted], [K.STOP_MIN, K.STOP_MIN, K.HORIZON_MAX, true], 'stop >= 1,2%, target >= stop, horizon <= 24 h');
  assert.strictEqual(K.parse('{"direction":"SHORT","stopPct":20,"targetPct":30}').stopPct, K.STOP_MAX);
  assert.strictEqual(K.parse('{"direction":"LONG"}').ok, false, 'a direction without numbers is not a forecast');
  assert.strictEqual(K.parse('no json here').ok, false); assert.strictEqual(K.valid('{"direction":"NONE"}'), true);
});

test('R2544.148 the forecast is written before the outcome: the virtual entry is the OPEN of the first 5m candle after the answer', () => {
  const f = K.parse('{"direction":"LONG","stopPct":2,"targetPct":4,"horizonH":1}');
  const r = K.open({ model:'m/a', symbol:'XUSDT', forecast:f, at:T0 + 70000, round:'r1' });
  assert.deepStrictEqual([r.entryAt, r.done, r.side, r.id], [T0 + M5, false, 'LONG', 'r1:m/a']);
  const none = K.open({ model:'m/a', symbol:'XUSDT', forecast:K.parse('{"direction":"NONE"}'), at:T0 });
  assert.deepStrictEqual([none.done, none.outcome, none.R], [true, 'NONE', null]);
  assert.strictEqual(K.open({ model:'m/a', symbol:'XUSDT', forecast:{ ok:false }, at:T0 }), null);
});

test('R2544.148 resolve: target first = +target/stop R, stop first = -1R, both in one candle = stop, neither = the result at the horizon; cost included; unknown stays open', () => {
  const mk = (side, s = 2, g = 4, h = 1) => K.open({ model:'m', symbol:'X', forecast:{ ok:true, direction:side, stopPct:s, targetPct:g, horizonH:h, confidence:50 }, at:T0 + 1000, round:'r' });
  const cost = K.COST_PCT / 2;
  // entry candle = index 1 (open 100)
  let k = [bar(0, 99, 99.5, 98.5, 99), bar(1, 100, 101, 99.5, 100.5), bar(2, 100.5, 104.2, 100.2, 104)];
  assert.strictEqual(K.resolve(mk('LONG'), k.slice(0, 2), T0 + 2 * M5), null, 'not decided yet -> open');
  let r = K.resolve(mk('LONG'), k, T0 + 3 * M5); assert.deepStrictEqual([r.outcome, r.entry, r.exit, r.R], ['TARGET', 100, 104, +(2 - cost).toFixed(3)]);
  r = K.resolve(mk('SHORT'), k, T0 + 3 * M5); assert.deepStrictEqual([r.outcome, r.exit, r.R], ['STOP', 102, +(-1 - cost).toFixed(3)]);
  k = [bar(1, 100, 104.5, 97.5, 101)]; r = K.resolve(mk('LONG'), k, T0 + 2 * M5); assert.strictEqual(r.outcome, 'STOP', 'same candle touches both: the stop counts');
  // horizon: 1 h = 12 candles from the entry candle, price drifts to 101 -> +0,5R minus cost
  k = Array.from({ length:13 }, (_, i) => bar(i + 1, 100 + i * 0.08, 100.3 + i * 0.08, 99.8 + i * 0.08, i === 11 ? 101 : 100.1 + i * 0.08));
  assert.strictEqual(K.resolve(mk('LONG'), k.slice(0, 6), T0 + 7 * M5), null, 'before the horizon and no touch -> open');
  r = K.resolve(mk('LONG'), k, T0 + 14 * M5); assert.deepStrictEqual([r.outcome, r.exit, r.R], ['HORIZON', 101, +(0.5 - cost).toFixed(3)]);
  // an unclosed candle is never used
  k = [bar(1, 100, 100.2, 99.9, 100), bar(2, 100, 105, 99.9, 104)]; assert.strictEqual(K.resolve(mk('LONG'), k, T0 + 3 * M5 - 1), null);
  assert.strictEqual(K.resolve({ done:true }, k, T0 + H), null); assert.strictEqual(K.resolve(K.open({ model:'m', symbol:'X', forecast:{ ok:true, direction:'NONE' }, at:T0 }), k, T0 + H), null);
});

test('R2544.148 consensus "ORTAK": 60% of the answers (NONE counts) the same way -> the median of their numbers; otherwise nobody', () => {
  const f = (d, s, g, h) => ({ ok:true, direction:d, stopPct:s, targetPct:g, horizonH:h });
  const c = K.consensus([f('LONG', 2, 4, 2), f('LONG', 3, 9, 6), f('LONG', 4, 6, 4), f('SHORT', 2, 2, 1), { ok:true, direction:'NONE' }]);
  assert.deepStrictEqual([c.direction, c.stopPct, c.targetPct, c.horizonH, c.confidence], ['LONG', 3, 6, 4, 60]);
  assert.strictEqual(K.consensus([f('LONG', 2, 4, 2), f('SHORT', 2, 4, 2), { ok:true, direction:'NONE' }]), null);
  assert.strictEqual(K.consensus([f('LONG', 2, 4, 2), f('LONG', 2, 4, 2)]), null, 'fewer than 3 answers is not a crowd');
});

test('R2544.148 karne (the leader\'s book): nobody is a candidate before 8 outcomes, the word needs 20 and a lower bound above zero; one lucky trade does not make a leader', () => {
  const rec = (model, R, i, side = 'LONG', conf = 50) => ({ model, done:true, outcome:R > 0 ? 'TARGET' : 'STOP', R, side, conf, at:T0 + i * H, closedAt:T0 + i * H + 1 });
  const good = Array.from({ length:24 }, (_, i) => rec('iyi', i % 3 === 0 ? -1.07 : 1.4, i, i % 2 ? 'LONG' : 'SHORT', i % 3 === 0 ? 30 : 80));
  const lucky = [...Array.from({ length:9 }, (_, i) => rec('şanslı', -1.07, i)), rec('şanslı', 30, 9)];        // average > 0 only because of one trade
  const fresh = Array.from({ length:5 }, (_, i) => rec('yeni', 2, i));
  const bad = Array.from({ length:12 }, (_, i) => rec('kötü', i % 4 === 0 ? 1.5 : -1.07, i));
  const some = Array.from({ length:10 }, (_, i) => rec('aday', i % 2 ? 1.6 : -1.07, i));
  const k = K.karne([...good, ...lucky, ...fresh, ...bad, ...some, { model:'yeni', outcome:'NONE', done:true, R:null }, { model:'yeni', done:false, side:'LONG' }], { now:T0 });
  const row = m => k.rows.find(r => r.model === m);
  assert.deepStrictEqual([row('iyi').state, row('şanslı').state, row('yeni').state, row('kötü').state, row('aday').state], ['SOZ_SAHIBI', 'KANITSIZ', 'YENI', 'KANITSIZ', 'ADAY']);
  assert.ok(row('şanslı').avgR > 0 && row('şanslı').exBestAvgR < 0, 'the average without its best trade decides');
  assert.deepStrictEqual([k.leaders, k.candidates, k.rows[0].model], [['iyi'], ['aday'], 'iyi']);
  assert.deepStrictEqual([row('yeni').calls, row('yeni').none, row('yeni').open, row('yeni').n], [7, 1, 1, 5]);
  assert.ok(row('iyi').confEdgeR > 1.5, 'its confident forecasts were the winners'); assert.strictEqual(row('iyi').hitPct, 67);
  assert.strictEqual(row('iyi').long.n + row('iyi').short.n, 24);
});

test('R2544.148 which coin next: the day\'s strongest, weakest and busiest (not one idea); the one looked at longest ago first; an hour of rest', () => {
  const tk = (symbol, ch, q) => ({ symbol, priceChangePercent:String(ch), quoteVolume:String(q), closeTime:T0 });
  const list = K.candidates([tk('AUSDT', 40, 5e7), tk('BUSDT', 25, 3e7), tk('CUSDT', -30, 4e7), tk('BTCUSDT', 1, 9e9), tk('DUSDT', 90, 1e6), tk('EUSDC', 50, 9e8), tk('OLDUSDT', 60, 9e7)].map((x, i) => i === 6 ? { ...x, closeTime:T0 - H } : x), { now:T0 });
  const syms = list.map(x => x.symbol);
  assert.ok(syms.includes('AUSDT') && syms.includes('CUSDT') && syms.includes('BTCUSDT')); assert.ok(!syms.includes('DUSDT'), 'thin coin'); assert.ok(!syms.includes('EUSDC')); assert.ok(!syms.includes('OLDUSDT'), 'not trading');
  assert.strictEqual(new Set(syms).size, syms.length);
  assert.strictEqual(K.nextCoin(list, { AUSDT:T0 - 10 * 60000, BUSDT:T0 - 2 * H, CUSDT:T0 - 3 * H, BTCUSDT:T0 - 90 * 60000 }, { now:T0 }).symbol, 'CUSDT');
  assert.strictEqual(K.nextCoin(list.slice(0, 1), { AUSDT:T0 - 10 * 60000 }, { now:T0 }), null);
});

test('R2544.148 packet: no plan is given; price now = 100, levels as % distance, coin name and date absent; the prompt asks for the model\'s own forecast', () => {
  const mkK = (ms, n, base) => Array.from({ length:n }, (_, i) => { const t = T0 - (n - i) * ms, o = base * (1 + i * 0.001), c = o * 1.0008; return [t, o, c * 1.002, o * 0.998, c, 1000 + i, t + ms - 1, 1e5, 10, 500, 5e4, 0]; });
  const k = { m5:mkK(M5, 80, 0.5), m15:mkK(3 * M5, 80, 0.48), h1:mkK(H, 80, 0.45), h4:mkK(4 * H, 80, 0.4), d1:mkK(24 * H, 80, 0.3), btc1h:mkK(H, 40, 100000) };
  const p = K.packet({ k, t:T0, context:{ change24hPct:38.2, fund:0.0005, why:'günün en çok yükselenlerinden' } });
  assert.strictEqual(p.task, 'FORECAST'); assert.strictEqual(p.plan, undefined); assert.strictEqual(p.now, 100);
  const last = p.timeframes.m5.candles.rows.at(-1); assert.ok(Math.abs(last[3] - 100) < 1e-6, 'the last closed 5m close is 100');
  assert.ok(p.levels.every(l => Number.isFinite(l.distPct))); assert.strictEqual(p.coin.fundingPct, 0.05); assert.ok(p.btc);
  assert.ok(!/USDT|2026/.test(JSON.stringify(p)), 'no coin name, no date');
  assert.strictEqual(K.packet({ k:{ m5:[] }, t:T0 }), null);
  assert.match(K.SYSTEM, /Nobody hands you a setup/); assert.match(K.SYSTEM, /"direction":"LONG\|SHORT\|NONE"/); assert.match(K.SYSTEM, /NONE is respected/);
});

test('R2544.148 deploy lists carry the new file (a missing file keeps the core from starting)', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'manage.ps1'), 'utf8'), /'kesif\.js'/);
  assert.match(fs.readFileSync(path.join(root, 'jev-brain', 'JEV-DEPLOY.ps1'), 'utf8'), /'kesif\.js'/);
});

test('R2544.148 a KEŞİF answer never touches the desk health record: bad JSON, an error or a quota answer do not bench a desk member', async () => {
  const MCx = require('../model-committee');
  const fc = { 'A:good':{ ok:true, text:'{"direction":"LONG","stopPct":2,"targetPct":4,"horizonH":2}' }, 'B:bad':{ ok:true, text:'not json at all' }, 'C:err':{ ok:false, reason:'429 quota exceeded' } };
  const members = Object.keys(fc).map(id => ({ id, call:async a => a.system === MCx.PROBE_SYSTEM ? { ok:true, text:'{"ok":true}' } : fc[id] }));
  const c = MCx.createCommittee({ members, size:3 });
  await c.probe({ force:true }); assert.strictEqual(c.healthy().length, 3);
  const snap = () => JSON.stringify(c.status().members.map(m => [m.id, m.ok, m.fail, m.consecutiveFail, m.lastOk, m.callsToday]));
  const before = snap();
  const r = await c.poll({ system:'s', prompt:'{}', validate:K.valid, parse:K.parse });
  assert.deepStrictEqual([r.asked, r.voters], [3, 1]);
  assert.strictEqual(r.votes.find(v => v.member === 'A:good').vote.direction, 'LONG');
  assert.deepStrictEqual(r.votes.filter(v => !v.ok).map(v => v.member).sort(), ['B:bad', 'C:err']);
  assert.strictEqual(snap(), before, 'health unchanged by the forecast round');
  assert.strictEqual(c.healthy().length, 3, 'nobody left the desk');
  const f = await c.poll({ system:'s', prompt:'{}', validate:K.valid, parse:K.parse, filter:id => id.startsWith('A:') }); assert.strictEqual(f.asked, 1);
});
