'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { zigzag, fiboZones, atrSeries } = require('../fibo-zones');
const { renderChartPng } = require('../market');

// 15m candles: rally to a top, pullback to a dip, break above the top, pullback to the middle of the zone
function series(points) {
  const out = []; let t = Date.UTC(2026, 9, 1);
  for (let s = 1; s < points.length; s++) {
    const [a, b, n] = [points[s - 1], points[s], 8];
    for (let i = 1; i <= n; i++) {
      const prev = a + (b - a) * (i - 1) / n, cur = a + (b - a) * i / n;
      out.push({ openTime:t, closeTime:t + 899999, open:prev, close:cur, high:Math.max(prev, cur) + 0.05, low:Math.min(prev, cur) - 0.05, volume:1000 });
      t += 900000;
    }
  }
  return out;
}
const C = series([100, 99, 104, 101, 106, 102.2, 107]);

test('ZigZag confirms alternating swing highs/lows only after a k x ATR reversal', () => {
  const p = zigzag(C, 1.5);
  assert.ok(p.length >= 4);
  for (let i = 1; i < p.length; i++) assert.notEqual(p[i].kind, p[i - 1].kind);
  for (const x of p) assert.ok(x.confirmIndex > x.index, 'a pivot is confirmed later than the bar it marks (no look-ahead)');
  const top = p.find(x => x.kind === 'H' && x.index > 8);
  assert.ok(Math.abs(top.price - 104.05) < 1e-9, 'the swing high is the highest high of the up leg');
  assert.equal(atrSeries(C).length, C.length);
});

test('FiboBuLL zone: top break -> bottom = dip that made the break, top = broken top, equilibrium filled', () => {
  const r = fiboZones(C, { k:1.5 });
  const z = r.zones.find(x => x.side === 'LONG' && Math.abs(x.top - 104.05) < 1e-9);
  assert.ok(z, 'a LONG zone forms when the close breaks the confirmed 104 top');
  assert.ok(Math.abs(z.bottom - 100.95) < 1e-9, 'zone bottom = the 101 dip before the break');
  assert.ok(Math.abs(z.equilibrium - (z.top + z.bottom) / 2) < 1e-12);
  assert.ok(z.ote.from < z.ote.to && z.ote.from > z.bottom);
  assert.equal(z.state, 'TARGET', 'the pullback to 102.2 reached the 102.5 equilibrium'); assert.ok(Math.abs(z.entry - 102.5) < 1e-9 && z.rr > 1);
});

test('forming candle is ignored; changing it does not move pivots or zones', () => {
  const a = fiboZones(C), b = fiboZones([...C, { ...C.at(-1), openTime:C.at(-1).openTime + 900000, closeTime:C.at(-1).closeTime + 900000, high:200, low:1, forming:true }]);
  assert.deepEqual(a.pivots, b.pivots); assert.deepEqual(a.zones, b.zones);
});

test('sade chart draws the Fibo overlay and can be switched off', () => {
  const chart = { symbol:'TESTUSDT', frame:'15m', candles:C, analysis:{} };
  const on = renderChartPng(chart, 'sade', { sade:{ levels:{} } }), off = renderChartPng(chart, 'sade', { sade:{ levels:{} }, fibo:false });
  assert.equal(on.subarray(1, 4).toString(), 'PNG'); assert.notDeepEqual(on, off);
  const src = fs.readFileSync(path.join(__dirname, '..', 'market.js'), 'utf8');
  assert.match(src, /R2544\.63 FiboBuLL/); assert.match(src, /require\('\.\/fibo-zones'\)/);
});
