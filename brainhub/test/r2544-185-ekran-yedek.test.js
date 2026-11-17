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
test('R2544.185 BOT ŞU AN kartı defteri Office kâr/zarar paneliyle AYNI kaynaktan okur (top3.pnl)', () => {
  assert.match(html, /p=t\.pnl\|\|ccG\(s\?\.pnl\)\|\|\{\};/);
  assert.match(html, /plRender\(\(ccG\(s\?\.top3\)\|\|\{\}\)\.pnl\|\|null\)/, 'panel de top3.pnl okuyor');
  assert.match(html, /komisyon brüt kârın <b>%/);
  assert.match(html, /R ile \$ ters yönde/);
});
test('R2544.185 Goxel karoları gerçek lot mu gölge tahmin mi açıkça söyler', () => {
  assert.match(html, /🟢 GERÇEK LOT:/); assert.match(html, /👻 GÖLGE TAHMİN:/);
  assert.match(html, /gerçek pozisyon DEĞİL, para riske girmiyor/);
  assert.match(html, /el\.innerHTML=gxWhat\+svg\+/);
});
