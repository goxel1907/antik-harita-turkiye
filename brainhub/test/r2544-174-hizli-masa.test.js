'use strict';
// R2544.174: the desk does not wait for its slowest model - a majority of ALL seats ends the vote; the debate round has 60 s
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { createCommittee } = require('../model-committee');
const pd = fs.readFileSync(path.join(__dirname, '..', 'position-desk.js'), 'utf8');
const member = (id, action, ms) => ({ id, call:async ({ prompt }) => { if (prompt === 'ping') return { ok:true, text:'{"ok":true}' }; await new Promise(r => setTimeout(r, ms)); return { ok:true, text:JSON.stringify({ action }) }; } });
const parse = t => { try { const j = JSON.parse(t); return { ok:true, action:j.action, reasonTr:'' }; } catch { return { ok:false }; } };
const mk = async members => { const c = createCommittee({ members, size:5, timeoutMs:5000 }); await c.probe({ force:true }); return c; };

test('R2544.174 early: 3 of 5 say EXIT fast -> decided at once, the 2 slow seats are not waited for', async () => {
  const c = await mk([member('A/a', 'EXIT', 10), member('B/b', 'EXIT', 20), member('C/c', 'EXIT', 30), member('D/d', 'HOLD', 1500), member('E/e', 'HOLD', 1500)]);
  const t0 = Date.now(), r = await c.decide({ system:'s', prompt:'p', validate:t => parse(t).ok, parse, field:'action', fallback:'HOLD', early:true });
  assert.strictEqual(r.final, 'EXIT'); assert.strictEqual(r.consensus, 'EARLY_MAJORITY'); assert.ok(Date.now() - t0 < 800, 'did not wait 1,5 s');
  assert.strictEqual(r.votes.filter(v => v.pending).length, 2);
});

test('R2544.174 no early majority -> everybody is heard as before; without `early` nothing changes', async () => {
  const c = await mk([member('A/a', 'EXIT', 10), member('B/b', 'HOLD', 20), member('C/c', 'EXIT', 30), member('D/d', 'HOLD', 60), member('E/e', 'TIGHTEN_STOP', 80)]);
  const r = await c.decide({ system:'s', prompt:'p', validate:t => parse(t).ok, parse, field:'action', fallback:'HOLD', early:true });
  assert.notStrictEqual(r.consensus, 'EARLY_MAJORITY'); assert.strictEqual(r.votes.filter(v => v.pending).length, 0);
  const c2 = await mk([member('A/a', 'EXIT', 10), member('B/b', 'EXIT', 20), member('C/c', 'EXIT', 30), member('D/d', 'HOLD', 300), member('E/e', 'HOLD', 300)]);
  const r2 = await c2.decide({ system:'s', prompt:'p', validate:t => parse(t).ok, parse, field:'action', fallback:'HOLD' });
  assert.notStrictEqual(r2.consensus, 'EARLY_MAJORITY'); assert.strictEqual(r2.votes.filter(v => v.ok).length, 5, 'the entry committee still hears all');
});

test('R2544.174 wiring: the desk uses early + a 60 s debate round', () => {
  assert.match(pd, /const DESK_FAST=\{early:true,round2Ms:60000\};/);
  assert.match(pd, /roles:DESK_ROLES, early:DESK_FAST\.early, round2Ms:DESK_FAST\.round2Ms \}/);
});
