'use strict';
// R2544.128 (04.11 ekran: açık pozisyon grafiği düz; beyin kartları yazı yığını)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const h=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
test('R2544.128 Office: the open card draws the minute path (desk looks only as a fallback); ZİRVE-5 ISO open time is read',()=>{
  assert.match(h,/path=\[\[0,0\],\.\.\.\(lp\.length>=2\?lp:dec\.filter/);assert.match(h,/o=Number\(a\.openedAt\)\|\|Date\.parse\(a\.openedAt\)\|\|null/);
});
test('R2544.128 brain cards: lesson, summary and waits stay in sight; the long "same on both sides" lists fold away',()=>{
  const fn=new Function('esc',h.match(/(function brLines\(lines\)\{[\s\S]*?\n\}\n)/)[1]+';return brLines;')(x=>String(x));
  const out=fn([{cls:'ders',text:'Ayırt edici: X'},{cls:'',text:'Tek başına neden DEĞİL (kazançta da kayıpta da benzer): a (1); b (2); c (3)'},{cls:'',text:'Eski 6 aylık laboratuvar (yalnız bilgi): z'},{cls:'sum',text:'Sorulan 20 soru'}]);
  assert.match(out,/✅ DERS: Ayırt edici: X/);assert.match(out,/🔍 Sorulan 20 soru/);
  assert.match(out,/<details class="br-more"><summary>4 etken daha:/);assert.ok(out.indexOf('<details')>out.indexOf('Sorulan'),'the folded part comes last');
});
