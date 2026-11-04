'use strict';
// R2544.123 (kullanıcı 04.11: "çık/tut/stop/yarı al komutları ekranda kalıyor, emir gerçekleşmedi hissi"): Office komutun akıbetini yanına yazar.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','office-dashboard','public','office.html'),'utf8');
const fn=new Function(html.match(/(function deskFate\(L,info\)\{[\s\S]*?\n\})/)[1]+';return deskFate;')();
test('R2544.123 deskFate: done / failed / noise guard / shadow / pending / HOLD',()=>{
  assert.equal(fn({action:'HOLD'}),null,'TUT needs no order');
  assert.match(fn({action:'EXIT',authority:true,done:{ok:true,at:Date.UTC(2026,10,4,5,0,0),price:0.222}}).t,/^✓ uygulandı .* @ 0\.222$/);
  assert.equal(fn({action:'TAKE_PARTIAL',authority:true,done:{ok:false,kind:'PARTIAL_SKIPPED',reason:'SIZE_TOO_SMALL'}}).t,'✗ uygulanamadı: SIZE_TOO_SMALL');
  const g=fn({action:'EXIT',authority:true,guard:{code:'NOISE_GUARD',openMin:90,R:-0.53}});assert.match(g.t,/^⛔ uygulanmadı: gürültü koruması \(açık 90 dk, -0,53R/);assert.equal(g.short,'⛔ KORUMA: UYGULANMADI');
  assert.equal(fn({action:'EXIT',authority:false}).short,'GÖLGE');
  assert.equal(fn({action:'TIGHTEN_STOP',authority:true},{pending:{action:'TIGHTEN_STOP',at:1}}).short,'⏳ EMİR YOLDA');
});
test('R2544.123 the fate is shown on the position card, the ticker, the reactor and the lane line',()=>{
  assert.match(html,/\$\{last\.authority\?'• YETKİLİ':'• gölge'\}\$\{\(f=>f\?` • <b style="color:\$\{f\.c\}">\$\{esc\(f\.t\)\}<\/b>`:''\)\(deskFate\(last,a\.deskInfo\)\)\}/);
  assert.match(html,/\(f=>f&&f\.short\?' • '\+f\.short:''\)\(deskFate\(d,a\.deskInfo\)\)/);
  assert.match(html,/fate:deskFate\(d,a\.deskInfo\)\}/);assert.match(html,/\$\{ev\.fate&&ev\.fate\.short\?ev\.fate\.short\+' • ':''\}/);
  assert.match(html,/\(deskFate\(L,d\)\)/);
});
test('R2544.123 result card: dollars next to R (fixed margin: a tight stop loses 1R for few dollars, a wide stop wins 1R for many) + last 24 h',()=>{
  const T=require('../top3-hunter'),now=Date.UTC(2026,10,4,6,30,0),h=3600000;
  const L=[{mode:'TEST',rule:'LONG_EARLY_RETEST',rMultiple:-1.32,netPnl:-9.53,closedAt:now-10*h},{mode:'TEST',rule:'SHORT_TOP_BREAK',rMultiple:1.19,netPnl:48.53,closedAt:now-1*h},
    {mode:'TEST',rule:'SHORT_TOP_BREAK',rMultiple:-0.9,netPnl:-30,closedAt:now-40*h}];
  const c=T.commandSummary(L,{mode:'TEST',now});
  assert.equal(c.all.totR,-1.03);assert.equal(c.all.netUsd,9,'R negative, dollars positive - both true');
  assert.equal(c.last24.n,2);assert.equal(c.last24.netUsd,39);assert.equal(c.last24.totR,-0.13);
  assert.match(html,/net <b style="color:\$\{\(L30\?L30\.net:\(a\.netUsd\|\|0\)\)>=0/,'R2544.124: the ledger first');assert.match(html,/son 24 sa: \$\{l24\.trades\?\?l24\.n\} işlem/);assert.match(html,/TEST'e eklenen sanal ek bakiye bu sonuca katılmaz/);
});
