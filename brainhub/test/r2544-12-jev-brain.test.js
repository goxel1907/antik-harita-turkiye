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
  assert.match(os,/OFFICE_VERSION = '2\.5\.17-R2544\.37-JEV-Brain'/);
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
test('R2544.13: PC ve APK kaynakları C:\\JEV-Brain içinde bağımsız klon; eski Codex yolları günlük işte kullanılmaz',()=>{
  const c=R('jev-brain','common.ps1'),g=R('jev-brain','JEV-BRAIN-GECIS.ps1'),a=R('jev-brain','APK-PUSH.ps1'),d=R('jev-brain','JEV-DEPLOY.ps1');
  assert.match(c,/\$APK    = "\$J\\apk-source"/);assert.match(c,/\$PUB    = \$APK/);
  assert.match(c,/function Ensure-Clone/);assert.match(c,/remote rename origin \$OldRemote/);
  for(const s of [c,g,a,d])assert.doesNotMatch(s,/worktree add/,'worktree yok: Windows yolları VM/başka klasöre bağlanmasın');
  assert.match(g,/Invoke-Git \$SRC rev-parse HEAD/);assert.match(g,/Invoke-Git \$SRC push origin/);
  assert.doesNotMatch(g,/Invoke-Git \$OLDWT/);
  assert.match(a,/BEKLENEN-PUBLIC\.txt/);assert.match(a,/status --short/);assert.match(a,/push origin \$PUBBRANCH/);
  assert.ok(a.charCodeAt(0)===0xFEFF);
  const rd=R('jev-brain','README.md');
  assert.match(rd,/apk-source/);assert.match(rd,/Eski yer → yeni yer/);
  assert.doesNotMatch(R('jev-brain','LIVE-KAPAT.cmd'),/LiveArm/);
});
test('R2544.13: satır sonu kuralı — kod LF, .cmd CRLF (Windows autocrlf klonunda testler bozulmasın)',()=>{
  const ga=fs.readFileSync(path.join(__dirname,'..','..','.gitattributes'),'utf8');
  for(const ext of ['js','json','html','md','ps1'])assert.match(ga,new RegExp('brainhub/\\*\\*/\\*\\.'+ext+' text eol=lf'));
  assert.match(ga,/brainhub\/\*\*\/\*\.cmd text eol=crlf/);
  for(const f of ['manage.ps1','live-controller.js','server.js'])assert.doesNotMatch(R(f),/\r\n/,f+' LF olmalı');
});
