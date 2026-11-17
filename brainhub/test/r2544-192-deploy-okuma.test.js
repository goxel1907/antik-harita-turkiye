'use strict';
// R2544.192 (17.11 17:14 JEV-TEST-DEPLOY): CANLI durdurulduktan 3 sn sonra pozisyon defteri bir kez okunamadı, betik "pozisyon oluştu ()" dedi
// (pozisyon yoktu) ve CANLI durdurulmuş kaldı; mesaj 'Kurulla CANLI' (JEV'i kapatır) önerdi. Güvenli taraf korunur: okunamazsa kurulmaz.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const ps = fs.readFileSync(path.join(__dirname, '..', 'jev-brain', 'JEV-TEST-DEPLOY.ps1'), 'utf8');
test('R2544.192 durdurmadan sonra defter 60 sn tekrar okunur; okunamadı ile açık pozisyon ayrı mesaj; okunamazsa yine KURULMAZ', () => {
  assert.match(ps, /for \(\$i = 1; \$i -le 12 -and \$null -eq \$posL; \$i\+\+\) \{ \$posL = Open-Positions \$RT; if \(\$null -eq \$posL\) \{ Start-Sleep -Seconds 5 \} \}/);
  assert.match(ps, /if \(\$null -eq \$posL\) \{ throw "Durdurmadan sonra acik pozisyon durumu 60 sn okunamadi; guvenlik icin kurulum yapilmadi/);
  assert.match(ps, /if \(\$posL\.Count -gt 0\) \{ throw "Durdurma sirasinda acik pozisyon olustu/);
  assert.ok(!/\$null -eq \$posL -or \$posL\.Count -gt 0\) \{ throw "Durdurma sirasinda acik pozisyon olustu/.test(ps), 'eski birleşik mesaj kalmadı');
});
test('R2544.192 yeniden başlatma önerisi önceki düzeni söyler (JEV + Kurul), "Kurulla CANLI" tek başına önerilmez', () => {
  assert.match(ps, /\$restartHint = "Office'ten onceki duzenle yeniden baslatin: JEV \+ Kurul acikti ise 'JEV \+ Kurul ile CANLI'ya gec'/);
  assert.ok(!/'Kurulla CANLI'ya gec'e basin/.test(ps), 'eski yanlış öneri kalmadı');
  assert.equal((ps.match(/\$restartHint/g) || []).length, 5, 'tanım + 4 kullanım');
});
