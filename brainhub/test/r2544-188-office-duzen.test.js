'use strict';
// R2544.188 Office düzeni: ofis katı açık, ölü masa sayaçları yok, taşma yok, sağ sütun kartı, aç/kapa, anlaşılır olay akışı, yedekler sürümüyle
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
const srv = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'office-server.js'), 'utf8');
test('R2544.188 ofis katı varsayılan AÇIK; 5M/15M masa kartları ve masa performansı tablosu yok', () => {
  assert.ok(html.includes('<details class="legacy-jev" id="legacyJevA" open>'));
  assert.ok(!html.includes('id="deskCards"')); assert.ok(!html.includes('id="deskPerf"'));
});
test('R2544.188 taşma: KEŞİF/reaktör tabloları kendi sütununda kayar; panel min-width 0', () => {
  assert.match(html, /\.ks table,\.rx table\{display:block;max-width:100%;overflow-x:auto;white-space:nowrap\}/);
  assert.match(html, /\.cc-panel\{min-width:0\}/);
});
test('R2544.188 sağ sütunda son kapanan GERÇEK işlemler; tam tablo aç/kapa', () => {
  assert.match(html, /id="ccClosed188"/); assert.match(html, /function renderClosed188\(s\)/);
  assert.match(html, /filter\(c=>c&&c\.tradingMode!=='TEST'\)/);
  assert.match(html, /<details class="fold188" id="closedFold">/);
  assert.match(html, /try\{renderClosed188\(s\);\}catch/);
});
test('R2544.188 GRAFİK OKUMA bloğu aç/kapa', () => {
  assert.match(html, /narrEl\.innerHTML=`<details class="fold188"\$\{narrOpen\?' open':''\} ontoggle="[^"]*office-narr188[^"]*"><summary><b>GRAFİK OKUMA — GÜNCEL SAYISAL BAĞLAM<\/b>/);
  assert.match(html, /\+'<\/details>';/, 'katlama kapanışı doğru dalda');
  // ayna: 5 sn'lik otomatik yenileme süren grafik yüklemesini iptal etmez
  assert.match(html, /if\(auto&&mirrorInflightAt&&Date\.now\(\)-mirrorInflightAt<60000\)return;/);
  assert.match(html, /renderMirror\(s,true\);/);
  assert.ok(html.includes("Claud-Work\\\\araclar\\\\JEV-SURUM-GERI-DON.ps1"), 'yol ters bölüleri JS içinde kaçışlı');
});
test('R2544.188 olay akışı: Türkçe cümle, GERÇEK/GÖLGE/SİSTEM etiketi, tekrar birleştirme', () => {
  assert.match(html, /KESIF_OUTCOME:\['s','Gölge tahmin sonuçlandı \(para yok\)'\]/);
  assert.match(html, /TOP3_CLOSED:\['g','Gerçek işlem kapandı'\]/);
  assert.match(html, /if\(last&&last\.kind===kind&&last\.sym===sym&&Math\.abs\(last\.ts-e\.ts\)<120000\)\{last\.n\+\+;continue;\}/);
  assert.match(html, /GERÇEK = gerçek para \/ CANLI olayı/);
});
test('R2544.188 yedekler: kurulum yedekleri önce, tarihe göre, içerdiği sürümle', () => {
  assert.match(srv, /release = m \? m\[1\] : null;/);
  assert.match(srv, /\(Number\(b\.deploy\) - Number\(a\.deploy\)\) \|\| String\(b\.mtime/);
  assert.match(html, /Son kurulum yedekleri/); assert.match(html, /JEV-SURUM-GERI-DON\.ps1/);
});
test('R2544.188 çizim döngüsü bölüm bölüm korumalı; kaldırılan elemanlara yazımlar korumalı', () => {
  assert.match(html, /for\(const \[n,f\] of \[\['setups',renderSetups\],\['timeline',renderTimeline\],\['positions',renderPositions\],\['feed',renderFeed\]\]\)\{try\{f\(s\);\}catch\(e\)\{console\.warn\(n,e\);\}\}/);
  assert.match(html, /if\(\$\('#deskCards'\)\)\$\('#deskCards'\)\.innerHTML=/);
  assert.match(html, /if\(\$\('#deskPerf'\)\)\$\('#deskPerf'\)\.innerHTML=/);
});
