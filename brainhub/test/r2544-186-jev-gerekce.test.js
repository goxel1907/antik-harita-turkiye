'use strict';
// R2544.186: JEV masa gerekçeleri pozisyona göre tanımlı; eylem-gerekçe çelişkisi YALNIZ ölçülür (eylem değişmez, veto yok)
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const DESK = require('../position-desk');
const jd = fs.readFileSync(path.join(__dirname, '..', 'jev-decision.js'), 'utf8'), lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
test('R2544.186 her gerekçenin pozisyona göre anlamı JEV\'e gider (adın küçük harfi değil)', () => {
  assert.match(jd, /STRUCTURE_BROKEN_AGAINST:'This position\\'s OWN structure broke against it/);
  assert.match(jd, /supports EXIT or TIGHTEN_STOP, never HOLD/);
  assert.match(jd, /map\(k=>\[k,DESK_REASON_TEXT\[k\]\|\|/);
  for (const k of ['STRUCTURE_INTACT', 'MOMENTUM_FADING', 'TARGET_ZONE_NEAR', 'OPPOSITE_FLOW_STRONG', 'VOLUME_CLIMAX', 'TIME_DECAY', 'NO_EDGE']) assert.ok(jd.includes('    ' + k + ':\''), k);
});
test('R2544.186 çelişki sınıflandırması', () => {
  assert.equal(DESK.coherence('HOLD', 'STRUCTURE_BROKEN_AGAINST'), 'TUT_AMA_GEREKCE_AZALT');
  assert.equal(DESK.coherence('EXIT', 'STRUCTURE_INTACT'), 'AZALT_AMA_GEREKCE_TUT');
  assert.equal(DESK.coherence('HOLD', 'STRUCTURE_INTACT'), null);
  assert.equal(DESK.coherence('EXIT', 'STRUCTURE_BROKEN_AGAINST'), null);
  assert.equal(DESK.coherence('TAKE_PARTIAL', 'MOMENTUM_FADING'), null);
});
test('R2544.186 çelişkili JEV kararı AYNEN uygulanır, yalnız işaretlenir', async () => {
  const judges = { jev: async () => ({ ok:true, called:true, action:'HOLD', stopChoice:'KEEP', reason:'STRUCTURE_BROKEN_AGAINST', confidence:40 }) };
  const r = await DESK.judge({ packet:{ symbol:'XUSDT', side:'LONG', stopChoices:{ KEEP:1 } }, mode:'LIVE', cfg:{ liveJudges:['JEV'], testJudges:['JEV'] }, judges, stats:{} });
  assert.equal(r.d.action, 'HOLD', 'JEV patron: eylem değişmedi');
  assert.equal(r.d.incoherent, 'TUT_AMA_GEREKCE_AZALT');
  assert.match(r.d.reasonTr, /⚠ gerekçe-eylem çelişkisi/);
  assert.match(lc, /\.\.\.\(d\.incoherent\?\{incoherent:d\.incoherent\}:\{\}\)\}; \/\/ R2544\.186 ölçüm/);
});
