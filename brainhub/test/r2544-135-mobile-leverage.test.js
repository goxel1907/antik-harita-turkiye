'use strict';
// R2544.135 telefon: açık lotun kaldıracını kimin seçtiği (KURUL / JEV / AYAR, R2544.131) telefona da gider
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
test('R2544.135 the phone payload carries leverageBy for İlk 3 and ZİRVE-5 lots',()=>{
  const s=fs.readFileSync(path.join(__dirname,'..','mobile-status.js'),'utf8');
  assert.equal((s.match(/'leverage','leverageBy','marginQuote'/g)||[]).length,2);
});
