const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R2544.33 BrainHub Pair uses dedicated tailnet-only HTTPS 8443',()=>{
  const manage=fs.readFileSync(path.join(__dirname,'..','manage.ps1'),'utf8');
  assert.match(manage,/serve --bg --https=8443 --yes 'http:\/\/127\.0\.0\.1:8787'/);
  assert.match(manage,/BRAINHUB_PAIR_OK endpoint=https:\/\/\$\(\$dns\):8443 token=PC_CLIPBOARD/);
  assert.match(manage,/serve --https=8443 off/);
  const pair=manage.slice(manage.indexOf("if ($Action -eq 'Pair')"),manage.indexOf("if ($Action -eq 'Backup')"));
  assert.doesNotMatch(pair,/serve --bg --https=8787/);
  assert.doesNotMatch(pair,/endpoint=https:\/\/\$\(\$dns\):8787/);
  assert.doesNotMatch(pair,/funnel/i);
});
