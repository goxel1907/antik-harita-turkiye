'use strict';
// R2544.185: Office "yedek bağlı" ile "kurul karar verdi"yi ayırır; vur-kaç CANLI metni gerçek koşulu söyler
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'office-dashboard', 'public', 'office.html'), 'utf8');
test('R2544.185 üst rozet: bağlı yedek kurul kararı gibi gösterilmez', () => {
  assert.match(html, /KURUL YEDEĞİ KARAR VERDİ \(JEV kredisiz\)/);
  assert.match(html, /JEV SON KARAR \(yedek bağlı\)/);
  assert.match(html, /fo\?\.last\?\.owner==='COMMITTEE'/);
  assert.ok(!html.includes("'JEV • KURUL YEDEĞİ'"), 'eski her-zaman-yedek rozeti kalktı');
});
test('R2544.185 vur-kaç CANLI metni gerçek koşul', () => {
  assert.ok(!html.includes('Vur-kaç canlıda kapalı (yalnız TEST'));
  assert.match(html, /Vur-kaç CANLI’da yalnız Normal sistem \(JEV\) de seçiliyken çalışır/);
});
