'use strict';
// CLAUDE_R2544_12_JEV_BRAIN: sistem klasörü C:\JEV-Brain (runtime / source / BrainHubBackups). Eski C:\BrainHub silinmez.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const R=(...p)=>fs.readFileSync(path.join(__dirname,'..',...p),'utf8');
test('varsayılan kökler C:\\JEV-Brain',()=>{
  assert.match(R('manage.ps1'),/\[string\]\$Root = 'C:\\JEV-Brain\\runtime',/);
  const so=R('office-dashboard','START-OFFICE.ps1');
  assert.match(so,/\[string\]\$BrainRoot = 'C:\\JEV-Brain\\runtime',/);
  assert.match(so,/\[string\]\$BackupRoot = 'C:\\JEV-Brain\\BrainHubBackups'/);
  const os=R('office-dashboard','office-server.js');
  assert.match(os,/BRAINHUB_ROOT \|\| 'C:\\\\JEV-Brain\\\\runtime'/);
  assert.match(os,/OFFICE_VERSION = '2\.1\.1-R2543\+R2544\.12-JEV-Brain'/);
  assert.match(R('office-dashboard','public','office.html'),/<span id="rootLine">C:\\JEV-Brain<\/span>/);
});
test('geçiş betiği: yönetici, beklenen sürüm, açık pozisyon kapısı, geri başlatma, veri silmez',()=>{
  const g=R('jev-brain','JEV-BRAIN-GECIS.ps1'),c=R('jev-brain','common.ps1');
  assert.ok(g.charCodeAt(0)===0xFEFF,'PowerShell 5.1 için UTF-8 BOM');
  assert.match(g,/Assert-Admin/);assert.match(g,/BEKLENEN-SURUM\.txt/);
  assert.match(g,/if \(-not \$AcikPozisyonaRagmen\) \{ throw "ACIK POZISYON VAR/);
  assert.match(g,/Start-Office \$OLD \$OLDBK/,'hata olursa eski sistem yeniden başlar');
  assert.match(g,/manage\.ps1" -Action Update -Source \$SRC -Root \$RT/);
  for(const s of [g,c,R('jev-brain','JEV-GERI-DON.ps1'),R('jev-brain','JEV-DEPLOY.ps1')]){
    assert.doesNotMatch(s,/Remove-Item|\brmdir\b|\bdel \b|\/MIR|\/PURGE/i,'hiçbir betik dosya silmez');
    assert.doesNotMatch(s,/live\/arm|LiveArm|leader-auto/i,'LIVE/OTO kullanıcıya ait');
  }
  assert.match(c,/return ,@\(/,'boş pozisyon listesi \$null sayılmaz');
  assert.match(c,/function Invoke-Git/);assert.doesNotMatch(c,/function Git\b/);
});
