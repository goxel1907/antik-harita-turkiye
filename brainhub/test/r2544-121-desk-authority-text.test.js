'use strict';
// R2544.121 (03.11 Office): "Pozisyon masası AÇIK (gölge: karar yazar, emir göndermez)" yazıyordu; oysa kurul anahtarı açık ve masa JCT/HOT/TA'yı kendisi kapattı.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const src=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('R2544.121 desk summary: authority = the lane committee switch (the same one each decision reads); Office says KURUL YETKİLİ + guard + committee calls',()=>{
  const lc=src('live-controller.js');
  assert.match(lc,/authTop3=top3Lib\.readTop3Config\(root\)\.committeeMode===true/);
  assert.match(lc,/shadow:!\(authTop3\|\|authZ5\),authority:authTop3\|\|authZ5,authorityByLane:\{TOP3:authTop3,ZIRVE5:authZ5\},guard:\{\.\.\.DESK_GUARD\}/);
  assert.doesNotMatch(lc,/function deskStatus\(\)\{[^\n]*\n\s*return \{version:DESK\.DESK_VERSION,enabled:cfg\.enabled,shadow:true,authority:false/);
  assert.match(lc,/function deskAuthority\(a\)\{try\{return \(a\?\.lane==='ZIRVE5'\?z5Lib\.readConfig\(root\):top3Lib\.readTop3Config\(root\)\)\.committeeMode===true;/);
  const off=src('office-dashboard/public/office.html');
  assert.match(off,/laneAuth===true\?`<b>KURUL YETKİLİ<\/b>/);
  assert.match(off,/bugün kurul \$\{esc\(td\.committee\|\|0\)\} çağrı/);
  assert.match(off,/:'\(gölge: karar yazar, emir göndermez\)'/,'still says shadow when the switch is off');
  assert.match(off,/laneAuth=p\.authorityByLane\?p\.authorityByLane\[lane==='ZIRVE5'\?'ZIRVE5':'TOP3'\]:p\.authority/,'each lane its own switch');
  assert.match(off,/x==='COMMITTEE'\?'Kurul'/,'COMMITTEE is shown as Kurul, not OpenRouter');
});
