'use strict';
// R2544.179 JEV at the desk: 56/56 identical HOLD because its instruction said "HOLD is the default ... SHADOW MODE: not executed"
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const DESK = require('../position-desk');
const jd = fs.readFileSync(path.join(__dirname, '..', 'jev-decision.js'), 'utf8'), lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
test('R2544.179 the JEV desk instruction no longer says shadow / HOLD default; it says executed and boss', () => {
  const i = jd.indexOf('async function sovereignPositionDesk('), j = jd.indexOf('async function sovereignBurstExit(', i), seg = jd.slice(i, j);
  assert.ok(i > 0 && j > i);
  assert.ok(!/SHADOW MODE/.test(seg) && !/HOLD is the measured default/.test(seg), 'old biased text gone');
  assert.match(seg, /YOUR DECISION IS EXECUTED AT ONCE/); assert.match(seg, /final authority of this desk: record\.advisors/);
  assert.match(seg, /desk_confidence:\{type:'choice'/);
});
test('R2544.179 the desk passes the committee instruction and the advisors to JEV only; JEV answer keeps confidence', async () => {
  const seen = []; const judges = { jev: async (x) => { seen.push(x); return { ok:true, called:true, action:'EXIT', stopChoice:'KEEP', reason:'STRUCTURE_BROKEN_AGAINST', confidence:85 }; } };
  const r = await DESK.judge({ packet:{ symbol:'XUSDT', side:'LONG', stopChoices:{ KEEP:1 } }, mode:'LIVE', cfg:{ liveJudges:['JEV'], testJudges:['JEV'] }, judges, stats:{}, advisors:{ goxel:{ saysExit:true } } });
  assert.equal(r.judge, 'JEV'); assert.equal(r.d.action, 'EXIT'); assert.equal(r.d.confidence, 85); assert.match(r.d.reasonTr, /^JEV: yapı aleyhe kırıldı/);
  assert.match(seen[0].system, /senior discretionary crypto-futures trader/); assert.deepEqual(seen[0].packet.advisors, { goxel:{ saysExit:true } });
});
test('R2544.179 live-controller builds the advisors (Goxel 9 screens + entry) and hands them to the desk', () => {
  assert.match(lc, /advisors=\{goxel:g0\?\{at:finite\(g0\.at\)/);
  assert.match(lc, /judges:cmShared\?\{\.\.\.deskJudges,committee:cmShared\}:deskJudges,stats:deskStats\(\),advisors\}\):deskJudge\(packet,mode,cfg,advisors\)\)/); // R2544.191: JEV+KURUL'da tek paylaşılan kurul işi
});
test('R2544.179 JEV desk client: an answer with confidence is read (fake key, fake fetch)', async () => {
  const { createJevClient } = require('../jev-decision');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jev179-')); let body = null; fs.mkdirSync(path.join(root, 'config')); fs.writeFileSync(path.join(root, 'config', 'jev.json'), JSON.stringify({ enabled:true, model:'typesafe/jev-1.13', decisionsUrl:'https://example.test/api/alpha/decisions', keyUrl:'https://example.test/api/v1/key', dailyCapUsd:0.25, timeoutMs:5000, maxPayloadChars:48000, reservePerCallUsd:0.001 }));
  const fetchImpl = async (url, o) => { body = JSON.parse(o.body); return { ok:true, status:200, headers:{ get:() => null }, json:async () => ({ answers:{ desk_action:{ choice:'EXIT' }, desk_stop:{ choice:'KEEP' }, desk_reason:{ choice:'STRUCTURE_BROKEN_AGAINST' }, desk_confidence:{ choice:'HIGH' } } }), text:async () => JSON.stringify({ answers:{ desk_action:{ choice:'EXIT' }, desk_stop:{ choice:'KEEP' }, desk_reason:{ choice:'STRUCTURE_BROKEN_AGAINST' }, desk_confidence:{ choice:'HIGH' } } }) }; };
  const j = createJevClient({ root, apiKey:'sk-or-v1-' + 'x'.repeat(40), fetchImpl });
  const r = await j.sovereignPositionDesk({ packet:{ symbol:'XUSDT', side:'LONG', lane:'ILK3', rule:'R', stopChoices:{ KEEP:1 } }, system:'SYS-TEXT Answer ONLY with JSON: x' });
  assert.equal(r.called, true, JSON.stringify(r));
  assert.equal(r.action, 'EXIT'); assert.equal(r.confidence, 85);
  const d = JSON.stringify(body); assert.ok(/SYS-TEXT/.test(d) && !/Answer ONLY with JSON/.test(d));
});
