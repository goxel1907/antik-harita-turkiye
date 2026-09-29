# JEV-Brain GECIS (CLAUDE_R2544_12_JEV_BRAIN) - calisan BrainHub'i C:\BrainHub'dan C:\JEV-Brain'e tasir.
# YONETICI olarak calistirin. Acik pozisyon varken calismaz (-AcikPozisyonaRagmen ile zorlanabilir).
# Ne yapar:
#   1) On kontrol: beklenen surum (BEKLENEN-SURUM.txt), temiz git, acik pozisyon yok
#   2) GitHub push (PC dali + public dal)
#   3) Kaynaklar: C:\JEV-Brain\source (PC) ve C:\JEV-Brain\apk-source (APK) bagimsiz git klonlari
#   4) Eski Office + core durur (C:\BrainHub)
#   5) config / data / logs / docs kopyalanir (C:\BrainHub SILINMEZ, geri donus icin durur)
#   6) manage.ps1 Update: syntax + tum testler + yedek + kopya + baslat + saglik testi (C:\JEV-Brain\runtime)
#      Hata olursa eski sistem C:\BrainHub'dan yeniden baslatilir.
#   7) Office C:\JEV-Brain\runtime\office-dashboard'dan baslar
#   8) Dosya hash dogrulamasi, otomatik baslatma kayitlarinin listesi
# NOT: Core yeniden basladigi icin LIVE ARM kapanir; uygulamadan yeniden acin.
param([switch]$AcikPozisyonaRagmen, [switch]$AutostartGuncelle)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path (Join-Path $J 'logs') | Out-Null
$log = Join-Path $J "logs\gecis-$ts.log"
Start-Transcript -Path $log | Out-Null
$oldStopped = $false
try {
  Assert-Admin
  Write-Host '== 1) ON KONTROL'
  $exp = (Get-Content -LiteralPath (Join-Path $J 'BEKLENEN-SURUM.txt') -Raw).Trim()
  $expPub = (Get-Content -LiteralPath (Join-Path $J 'BEKLENEN-PUBLIC.txt') -Raw).Trim()
  foreach ($p in "$OLD\server\server.js","$OLD\config","$OLD\data\brainhub.sqlite") { if (-not (Test-Path -LiteralPath $p)) { throw "Bulunamadi: $p" } }
  Ensure-Clone $REPO $SRC $BRANCH 'codex-yerel'
  Ensure-Clone $OLDPUB $APK $PUBBRANCH 'eski-yerel'
  if (Test-Path -LiteralPath (Join-Path $J 'GECIS-TAMAMLANDI.txt')) { throw 'Gecis daha once tamamlanmis. Guncelleme icin JEV-DEPLOY.cmd kullanin.' }
  if (Core-Pid $RT) { throw 'C:\JEV-Brain\runtime core zaten calisiyor; gecis gerekmez.' }
  $h = Invoke-Git $SRC rev-parse HEAD; $s = Invoke-Git $SRC status --short
  Write-Host "SOURCE HEAD=$h status=[$s]"
  if ($h -ne $exp) { throw "C:\JEV-Brain\source beklenen surumde degil: $h (beklenen $exp)" }
  if ($s) { throw 'C:\JEV-Brain\source temiz degil; gecis durduruldu.' }
  if ((Invoke-Git $SRC remote get-url origin) -ne $GITHUB -or (Invoke-Git $APK remote get-url origin) -ne $GITHUB) { throw 'origin GitHub adresi beklenen degil.' }
  $hp = Invoke-Git $PUB rev-parse HEAD; $sp = Invoke-Git $PUB status --short
  if ($hp -ne $expPub -or $sp) { throw "APK kaynagi (C:\JEV-Brain\apk-source) beklenen durumda degil: $hp [$sp]" }
  $pos = Open-Positions $OLD
  if ($null -eq $pos) { Write-Warning 'Core yanit vermedi (kapali olabilir); pozisyon kontrolu yapilamadi.' }
  elseif ($pos.Count -gt 0) {
    if (-not $AcikPozisyonaRagmen) { throw "ACIK POZISYON VAR: $($pos -join ', '). Kapandiktan sonra tekrar calistirin." }
    Write-Warning "Acik pozisyon var ama -AcikPozisyonaRagmen verildi: $($pos -join ', '). Borsadaki stop/TP emirleri durur; LIVE yeniden acilana kadar JEV yonetimi uygulanmaz."
  } else { Write-Host 'ACIK_POZISYON_YOK' }

  Write-Host '== 2) GITHUB PUSH'
  Invoke-Git $SRC push origin "HEAD:refs/heads/$BRANCH" | Out-Host
  Invoke-Git $PUB push origin $PUBBRANCH | Out-Host
  Write-Host "PUSH_OK $BRANCH"

  Write-Host '== 3) KAYNAK KLASORLERI'
  if (-not (Test-Path -LiteralPath "$SRC\brainhub\server.js")) { throw "Kaynak eksik: $SRC\brainhub\server.js" }
  if (-not (Test-Path -LiteralPath "$APK\codemagic.yaml")) { throw "APK kaynagi eksik: $APK\codemagic.yaml" }
  Write-Host "KAYNAK_OK $SRC • APK_KAYNAK_OK $APK"

  Write-Host '== 4) ESKI SISTEM DURUYOR (C:\BrainHub)'
  Stop-Office $OLD
  Stop-Core $OLD
  $oldStopped = $true

  Write-Host '== 5) AYAR / VERI KOPYASI'
  Robo "$OLD\config" "$RT\config"
  Robo "$OLD\data" "$RT\data"
  Robo "$OLD\logs" "$RT\logs\eski-BrainHub"
  Robo "$OLD\docs" "$RT\docs"
  New-Item -ItemType Directory -Force -Path "$RT\office-dashboard" | Out-Null
  if (Test-Path -LiteralPath "$OLD\office-dashboard\office-key.txt") { Copy-Item -LiteralPath "$OLD\office-dashboard\office-key.txt" -Destination "$RT\office-dashboard\office-key.txt" -Force }
  foreach ($f in 'brainhub.sqlite','brainhub.sqlite-wal') {
    $a = Get-Item -LiteralPath "$OLD\data\$f" -ErrorAction SilentlyContinue; $b = Get-Item -LiteralPath "$RT\data\$f" -ErrorAction SilentlyContinue
    if ($a -and (-not $b -or $a.Length -ne $b.Length)) { throw "Veri kopyasi dogrulanamadi: $f" }
  }
  Write-Host 'VERI_KOPYA_OK'

  Write-Host '== 6) YENI SURUM KURULUMU + BASLATMA (C:\JEV-Brain\runtime)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$SRC\brainhub\manage.ps1" -Action Update -Source $SRC -Root $RT
  if ($LASTEXITCODE -ne 0) { throw "manage.ps1 Update basarisiz (exit $LASTEXITCODE)" }

  Write-Host '== 7) OFFICE'
  Start-Office $RT $BK

  Write-Host '== 8) DOGRULAMA'
  Start-Sleep -Seconds 3
  $bad = 0
  foreach ($f in Get-ChildItem -LiteralPath "$SRC\brainhub" -Filter '*.js' -File) {
    $dst = Join-Path "$RT\server" $f.Name
    if (Test-Path -LiteralPath $dst) {
      if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash $dst).Hash) { Write-Warning "HASH FARKI $($f.Name)"; $bad++ }
    }
  }
  if ($bad) { throw "$bad dosyada hash farki var." }
  $o = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/ping' -Headers $(if (Test-Path "$RT\office-dashboard\office-key.txt") { @{ 'x-office-key' = (Get-Content "$RT\office-dashboard\office-key.txt" -Raw).Trim() } } else { @{} }) -TimeoutSec 10
  Write-Host ("OFFICE_PING " + ($o | ConvertTo-Json -Compress))
  if (Core-Pid $RT) { Write-Host "CORE_CALISIYOR $RT" } else { throw 'Yeni core sureci bulunamadi.' }
  Set-Content -LiteralPath "$OLD\ESKI-KLASOR-ARTIK-KULLANILMIYOR.txt" -Encoding UTF8 -Value "Bu klasor $ts itibariyla kullanilmiyor. Sistem: C:\JEV-Brain (runtime, source, BrainHubBackups). Geri donus: C:\JEV-Brain\JEV-GERI-DON.cmd"

  Write-Host '== 9) OTOMATIK BASLATMA KAYITLARI'
  $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -match 'BrainHub' })
  foreach ($t in $tasks) {
    Write-Host "GOREV $($t.TaskPath)$($t.TaskName): $(($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' | ')"
    if ($AutostartGuncelle) {
      $fix = { param($v) if ($v) { $v -replace 'C:\\BrainHub(?=\\|"|\s|$)', $RT } else { $v } }
      $new = foreach ($a in $t.Actions) {
        $prm = @{ Execute = (& $fix $a.Execute) }
        if ($a.Arguments) { $prm.Argument = (& $fix $a.Arguments) }
        if ($a.WorkingDirectory) { $prm.WorkingDirectory = (& $fix $a.WorkingDirectory) }
        New-ScheduledTaskAction @prm
      }
      Set-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Action $new | Out-Null
      Write-Host "  -> GUNCELLENDI ($RT)"
    }
  }
  if (-not $tasks.Count) { Write-Host 'BrainHub iceren zamanlanmis gorev yok.' }
  $startup = [Environment]::GetFolderPath('Startup')
  Get-ChildItem -LiteralPath $startup -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Brain|Office|JEV' } | ForEach-Object { Write-Host "BASLANGIC KLASORU: $($_.FullName) (elle kontrol edin)" }
  foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run') {
    $p = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
    if ($p) { $p.PSObject.Properties | Where-Object { "$($_.Value)" -match 'BrainHub' } | ForEach-Object { Write-Host "RUN KAYDI $k\$($_.Name): $($_.Value) (elle kontrol edin)" } }
  }
  Set-Content -LiteralPath (Join-Path $J 'GECIS-TAMAMLANDI.txt') -Encoding UTF8 -Value "Gecis $ts tamamlandi. Surum $exp."
  Write-Host "JEV_BRAIN_GECIS_OK — sistem artik C:\JEV-Brain. LIVE ARM restart ile kapandi; uygulamadan yeniden acin."
} catch {
  Write-Host "JEV_BRAIN_GECIS_FAILED: $($_.Exception.Message)"
  if ($oldStopped -and -not (Core-Pid $RT)) {
    Write-Warning 'Eski sistem C:\BrainHub yeniden baslatiliyor...'
    try {
      & powershell -NoProfile -ExecutionPolicy Bypass -File "$OLD\manage.ps1" -Action Start -Root $OLD
      Start-Office $OLD $OLDBK
      Write-Host 'ESKI_SISTEM_GERI_BASLADI (C:\BrainHub)'
    } catch { Write-Warning "Eski sistem baslatilamadi: $($_.Exception.Message). C:\BrainHub\START.ps1 ve office-dashboard\OFFICE.cmd ile elle baslatin." }
  }
  throw
} finally { Stop-Transcript | Out-Null }
