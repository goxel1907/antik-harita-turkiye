'use strict';
// R2544.168: the status object had TWO 'human' keys (robot-rule book R2544.153 + teacher R2544.161); the teacher won, and at 8 hand closes
// the KEŞİF card read teacher.rows (undefined) -> crash -> the Goxel card was never drawn (13.11 09:30, user: "goxel yeri kaybolmuş")
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');

test('R2544.168 one key each: human = robot-rule book, teacher = what you taught', () => {
  assert.strictEqual((lc.match(/[,{\s]human:/g) || []).length, 1, 'a single human key');
  assert.match(lc, /human:KESIF\.humanBook\(s\.closed\)/);
  assert.match(lc, /teacher:\(\(\)=>\{try\{return KESIF\.humanTeacher\(/);
  assert.match(html, /const ht=k\.teacher,hth=ht\?/);
});

test('R2544.168 the Goxel card is drawn first and on its own; the robot table needs its rows', () => {
  const i = html.indexOf('function renderKesif(s){'), body = html.slice(i, html.indexOf('\nfunction ', i + 10));
  assert.ok(body.indexOf('renderGoxel(k)') > -1 && body.indexOf('renderGoxel(k)') < body.indexOf('const mx='), 'before anything that can throw');
  assert.strictEqual((body.match(/renderGoxel\(k\)/g) || []).length, 1);
  assert.match(html, /const hb=k\.human,hum=hb&&hb\.n&&Array\.isArray\(hb\.rows\)\?/);
});
