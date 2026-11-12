'use strict';
// R2544.156: the NVIDIA seats are thinking seats (time + tokens); an old verdict given with too little time is forgiven once
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const MC = require('../model-committee');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('R2544.156 NVIDIA via 9Router: thinking time and tokens, kimi-k2.6 back as a candidate, 6 NVIDIA seats', () => {
  assert.match(src, /nv\?THINK_MS-5000:110000/); assert.match(src, /nv\?8000:4096/);
  assert.match(src, /\/\^nvidia\\\/\/\.test\(m\)\?\{timeoutMs:THINK_MS\}/);
  assert.ok(src.includes("'nvidia/moonshotai/kimi-k2.6'"));
  assert.strictEqual(MC.PROVIDER_CAP.nvidia, 6);
  const ids = ['nvidia/a', 'nvidia/b', 'nvidia/c', 'nvidia/d', 'nvidia/e', 'nvidia/f', 'nvidia/g'];
  assert.strictEqual(MC.pickRouterExtras(ids, { candidates:ids, max:28 }).length, 6);
});

test('R2544.156 forgive: a benched seat comes back once; without forgive the old verdict stands', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r156-')), hf = path.join(dir, 'h.json'), T = 1794480000000;
  fs.writeFileSync(hf, JSON.stringify({ health:{ 'ROUTER:nvidia/x':{ ok:0, fail:8, lastOk:false, consecutiveFail:8, error:'The operation was aborted due to timeout', at:T - 3600000 },
    'ROUTER:other/y':{ ok:0, fail:8, lastOk:false, consecutiveFail:8, error:'The operation was aborted due to timeout', at:T - 3600000 } } }));
  let seen = null; const members = ctx => { seen = ['ROUTER:nvidia/x', 'ROUTER:other/y'].map(id => [id, ctx.gone(id)]); return []; };
  const forgive = (id, rec) => /^ROUTER:nvidia\//.test(id) && rec.at < T;
  const c1 = MC.createCommittee({ members, healthFile:hf, clock:() => T, forgive }); try { await c1.poll({ system:'s', prompt:'p', validate:() => true, parse:x => ({ ok:true }) }); } catch {}
  if (!seen) { try { c1.status(); } catch {} }
  assert.ok(seen, 'the members function was asked');
  assert.deepStrictEqual(seen, [['ROUTER:nvidia/x', false], ['ROUTER:other/y', true]]);
  seen = null; const c2 = MC.createCommittee({ members, healthFile:hf, clock:() => T }); try { await c2.poll({ system:'s', prompt:'p', validate:() => true, parse:x => ({ ok:true }) }); } catch {}
  if (!seen) { try { c2.status(); } catch {} }
  assert.deepStrictEqual(seen, [['ROUTER:nvidia/x', true], ['ROUTER:other/y', true]]);
});
