# JEV-Brain TEST DEPLOY (R2544.52). Yalniz TEST (sanal hesap) modunda kullanilir:
#  1) TEST guvenle durdurulur: yeni giris yok; acik sanal pozisyon kapanana kadar beklenir (R2544.52+ Durdur onu hemen kapatir,
#     R2544.51'de OTO kapatilir ve pozisyon JEV yonetiminde kendi stop/TP/cikisiyla kapanir).
#  2) JEV-DEPLOY.ps1 AYNEN calistirilir; onun guvenlik kurallari degismez (baslatma kapali + acik pozisyon 0).
#  3) Deploy basariliysa TEST yeniden baslatilir (POST /live/run START_TEST).
# CANLI modda hicbir sey yapmaz. Sag tik > Yonetici olarak calistir (JEV-TEST-DEPLOY.cmd).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$CORE = 'http://127.0.0.1:8787'
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Start-Transcript -Path (Join-Path $logDir ("test-deploy-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")) | Out-Null
function Core-Get([string]$p) { Invoke-RestMethod -Uri ($CORE + $p) -Headers (Core-Headers $RT) -TimeoutSec 15 }
function Core-Post([string]$p, $body) {
  try { return Invoke-RestMethod -Uri ($CORE + $p) -Method POST -Headers (Core-Headers $RT) -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 40 }
  catch { $m = $_.ErrorDetails.Message; if ($m) { try { return ($m | ConvertFrom-Json) } catch {} }; throw }
}
try {
  Assert-Admin
  $st = Core-Get '/live/status'
  if (-not $st.tradingMode -or $st.tradingMode.mode -ne 'TEST') { throw 'Bu betik yalniz TEST modunda calisir. CANLI moddaysaniz Office: OTO kapat (ya da Durdur), sonra JEV-DEPLOY.cmd.' }
  $hasRun = [bool]($st.tradingMode.PSObject.Properties['run'] -and $st.tradingMode.run)
  Write-Host "TEST modu. surum=$($st.runtimeRelease) baslatma=$($st.armed) OTO=$($st.leaderAuto.enabled)"
  if ($hasRun) {
    Write-Host '== TEST durduruluyor (Durdur: OTO + baslatma kapanir, sanal pozisyonlar kapatilir)'
    $r = Core-Post '/live/run' @{ action = 'STOP' }
    if ($r.ok -ne $true) { throw "TEST durdurulamadi: $(@($r.reasons) -join ',')" }
  } else {
    Write-Host '== TEST durduruluyor (R2544.51: OTO kapatilir; acik sanal pozisyon JEV yonetiminde kapanana kadar beklenir)'
    $r = Core-Post '/live/leader-auto' @{ enabled = $false }
    if ($r.ok -ne $true) { throw "OTO kapatilamadi: $(@($r.reasons) -join ',')" }
  }
  $deadline = (Get-Date).AddMinutes(45)
  while ($true) {
    $pos = Open-Positions $RT
    if ($null -eq $pos) { throw 'Pozisyon durumu okunamadi; deploy yapilmadi.' }
    if ($pos.Count -eq 0) { break }
    if ((Get-Date) -gt $deadline) { throw "Sanal pozisyon 45 dk icinde kapanmadi: $($pos -join ', '). OTO kapali; kapaninca tekrar calistirin." }
    Write-Host "Acik sanal pozisyonun kapanmasi bekleniyor: $($pos -join ', ') ($(Get-Date -Format HH:mm:ss))"
    Start-Sleep -Seconds 20
  }
  $st = Core-Get '/live/status'
  if ($st.armed -eq $true) { $null = Core-Post '/live/disarm' @{ reason = 'TEST_DEPLOY' }; Write-Host 'Baslatma kapatildi.' }
  Start-Sleep -Seconds 2
  Write-Host '== JEV-DEPLOY (kendi guvenlik kontrolleriyle, degistirilmeden)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'JEV-DEPLOY.ps1')
  if ($LASTEXITCODE -ne 0) { throw "JEV-DEPLOY basarisiz (exit $LASTEXITCODE). TEST durdurulmus durumda; Office'te 'TEST'i baslat' ile yeniden baslatin." }
  Write-Host '== TEST yeniden baslatiliyor'
  Start-Sleep -Seconds 5
  $r = Core-Post '/live/run' @{ action = 'START_TEST' }
  if ($r.ok -ne $true) { throw "TEST baslatilamadi: $(@($r.reasons) -join ','). Office'te 'TEST'i baslat'a basin." }
  $st = Core-Get '/live/status'
  Write-Host "JEV_TEST_DEPLOY_OK surum=$($st.runtimeRelease) mod=$($st.tradingMode.mode) baslatma=$($st.armed) OTO=$($st.leaderAuto.enabled)"
} catch { Write-Host "JEV_TEST_DEPLOY_FAILED: $($_.Exception.Message)"; throw }
finally { Stop-Transcript | Out-Null }
