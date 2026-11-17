'use strict';
// R2544.187: JEV + Kurul modunda kurul PARALEL çalışır; JEV beklemez; JEV kurulun son görüşünü + karnesini görür; kurulun paralel kararı emir üretmez
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const lc = fs.readFileSync(path.join(__dirname, '..', 'live-controller.js'), 'utf8'), jd = fs.readFileSync(path.join(__dirname, '..', 'jev-decision.js'), 'utf8');
test('R2544.187 masa bakışı kurulu BEKLEMEZ: kick await edilmez, JEV çağrısı aynı satır sırasıyla sürer', () => {
  const i = lc.indexOf("if(both){advisors.committee=deskCmView(a,now);deskCmKick(a,packet,mode,cfg,{goxel:advisors.goxel,entry:advisors.entry});}"), j = lc.indexOf('const res=await (auth?DESK.judge(', i);
  assert.ok(i > 0 && j > i && j - i < 300, 'kick, JEV çağrısından hemen önce ve beklenmeden');
  assert.ok(!/await deskCmKick/.test(lc));
  const k = lc.indexOf('function deskCmKick('), seg = lc.slice(k, lc.indexOf('\n  }', k));
  assert.match(seg, /DESK\.judge\(\{packet,mode,cfg:\{\.\.\.cfg,testJudges:\['COMMITTEE'\],liveJudges:\['COMMITTEE'\]\}/);
  assert.ok(!/deskOrder|kickDeskOrders|placeOrder|closePosition/.test(seg), 'paralel kurul emir üretmez');
  assert.match(seg, /if\(deskCmRunning>=1\|\|deskCmViews\.get\(a\.id\)\?\.busy\)return false;/, 'aynı anda tek tur, kota korunur');
});
test('R2544.187 JEV kurulun son görüşünü yaşı ve karnesiyle görür; eski görüş (15 dk) gönderilmez', () => {
  assert.match(lc, /const DESK_CM_MAX_AGE_MS=15\*60000;/);
  assert.match(lc, /reason:v\?'KURUL_GORUSU_ESKI':'KURUL_GORUSU_HENUZ_YOK'/);
  assert.match(lc, /deltaVsPlanR:row\.deltaR/);
  assert.match(jd, /record\.advisors\.committee\) the free-model committee LAST opinion with its measured desk karne/);
});
test('R2544.187 ölçüm: JEV kararının yanında kurulun o anki görüşü kaydedilir', () => {
  assert.match(lc, /committeeView:\{final:advisors\.committee\.final,ageSec:advisors\.committee\.ageSec,consensus:advisors\.committee\.consensus\}/);
});
test('R2544.187 yalnız JEV + Kurul modunda (kurul tek başına yetkiliyken zaten kurul karar verir)', () => {
  assert.match(lc, /const both=auth&&jevKurul\(laneCfgOf\(a\)\),order=both\?\['JEV','COMMITTEE'\]:\['COMMITTEE'\];\n      if\(both\)\{advisors\.committee=/);
});
