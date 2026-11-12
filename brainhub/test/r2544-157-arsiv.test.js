'use strict';
// R2544.157: after a successful update the newest 10 backups stay; older backups and old logs are MOVED (never deleted) to D:\JEV-Brain-Arsiv
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const m = fs.readFileSync(path.join(__dirname, '..', 'manage.ps1'), 'utf8');

test('R2544.157 manage.ps1: archive step after the update, move only, never fails the deploy', () => {
  const fn = m.slice(m.indexOf('function Archive-Old('), m.indexOf('function Migrate-JevBudgetPolicy('));
  assert.ok(fn.length > 500, 'the archive function exists');
  assert.match(fn, /\[int\]\$Keep = 10/); assert.match(fn, /\[int\]\$LogDays = 30/); assert.match(fn, /'D:\\JEV-Brain-Arsiv'/);
  assert.match(fn, /'\^\\d\{8\}-\\d\{6\}\$'/, 'only the dated deploy backups move; named snapshots stay');
  assert.match(fn, /Select-Object -SkipLast \$Keep/); assert.match(fn, /Select-Object -First 20/, 'the newest 20 test-deploy logs always stay');
  assert.match(fn, /robocopy \$src \$dst \/E \/MOVE/, 'a folder moves with robocopy (Move-Item cannot cross drives)');
  assert.match(fn, /if \(\$rc -ge 8\)/); assert.match(fn, /\$global:LASTEXITCODE = 0/);
  assert.match(fn, /ARSIV_DISKI_YOK/); assert.match(fn, /finally \{ \$global:LASTEXITCODE = 0 \}/);
  // the only Remove-Item is the empty source folder robocopy leaves behind (no file is ever deleted)
  const rm = fn.match(/Remove-Item[^\n]*/g) || [];
  assert.strictEqual(rm.length, 1); assert.match(fn, /-not \(Get-ChildItem -LiteralPath \$src -Recurse -Force -File[^\n]*Select-Object -First 1\)\) \{ Remove-Item/);
  // called once, after the update try/catch (a failed update threw before), then a clean exit code for JEV-DEPLOY
  assert.ok(/\}\r?\n# R2544\.157[^\n]*\r?\nArchive-Old \$rootFull\r?\nexit 0\r?\n?$/.test(m), 'the last lines of manage.ps1');
  assert.strictEqual((m.match(/\nArchive-Old \$rootFull/g) || []).length, 1);
});
