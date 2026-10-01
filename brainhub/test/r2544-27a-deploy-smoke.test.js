'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2544.27a deploy smoke does not require fresh Binance REST while guard is being installed',()=>{
  const p=fs.readFileSync(path.join(__dirname,'..','manage.ps1'),'utf8');
  assert.match(p,/SkipExternalBinanceSmoke/);
  assert.match(p,/BINANCE_EXTERNAL_SMOKE_SKIPPED/);
  assert.match(p,/scanner\/last/);
  assert.match(p,/Test-Brain \$rootFull -IncludeDeep:\$Deep -SkipExternalBinanceSmoke/);
  assert.match(p,/maxConcurrent' 99\) -gt 4/);
  assert.match(p,/publicSoftWeight1m' 99999\) -gt 1600/);
  assert.match(p,/if \(\$SkipExternalBinanceSmoke\) \{[\s\S]*externalBinanceSmoke=SKIPPED[\s\S]*\} else \{[\s\S]*\$scan\.activeUsdtPerpetuals/);
  assert.doesNotMatch(p,/BINANCE_EXTERNAL_SMOKE_SKIPPED[\s\S]*Write-Host "BRAINHUB_TEST_OK[^"\n]*\$scan\.activeUsdtPerpetuals[^"\n]*"\n\}/);
});
