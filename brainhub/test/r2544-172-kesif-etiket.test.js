'use strict';
// Claude M6 P2-1 (görünen = gerçek): the KEŞİF-SÖZ lane never borrows the İlk 3 entry label - its entry is the word holder model's forecast
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
test('R2544.172 KEŞİF-SÖZ lane label: entry = MODEL, managed by the desk (+ Goxel); Office shows MODEL, not the İlk 3 JEV / KURUL owner', () => {
  assert.match(lc, /decisions:'MODEL_SOZ_ENTRY_DESK_MANAGED',entryBy:'MODEL',managedBy:c\.goxelExit===false\?'DESK':'DESK_GOXEL'/);
  const i = lc.indexOf("kesif:(()=>{const c=readSozConfig()"), seg = lc.slice(i, i + 900);
  assert.ok(!/jevKurul\(t\)/.test(seg), 'no İlk 3 label inside the KEŞİF lane status');
  assert.match(html, /const ccOwner=sw=>!sw\?'—':sw\.owner==='MODEL'\?'MODEL':/);
  assert.match(html, /\{name:'KEŞİF-SÖZ',sw:typeof kl\?\.selected==='boolean'\?\{enabled:kl\.selected,liveEnabled:kl\.selected&&mode==='LIVE',owner:'MODEL'\}/);
  assert.match(html, /giriş: söz sahibi model \(JEV giriş çağrısı yok\)/);
});
