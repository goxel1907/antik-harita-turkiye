# JEV-Brain TEST DEPLOY (R2544.71). Yalniz TEST (sanal hesap) modunda kullanilir:
#  1) TEST'in YENI GIRISLERI durdurulur (PAUSE_TEST). Acik sanal lotlar KAPATILMAZ: stop/TP emirleri sanal borsada kalir,
#     yoneticileri calismaya devam eder, o anki durumlari beyne yazilir (kullanici 21.10: "acik pozlari beyine yaz, deploy
#     sonrasi kapanacagindan garantiye alalim"). Restart boslugu 1 dk mumlardan islenir (kacan stop/TP o fiyattan dolar).
#     Calisan cekirdek R2544.71'den eskiyse (PAUSE_TEST yok): TEST otomatik baslatma bayragi mod dosyasinda kapatilir
#     (cekirdegin kendi setAutoRun alani, atomik yazim), sonra baslatma kapatilir - lotlar yine acik kalir.
#  2) JEV-DEPLOY.ps1 AYNEN calistirilir (baslatma kapali sart; TEST'te acik SANAL lot serbest, CANLI'da acik pozisyon yasak).
#  3) Deploy basariliysa TEST yeniden baslatilir (POST /live/run START_TEST).
# CANLI modda hicbir sey yapmaz. Sag tik > Yonetici olarak calistir (JEV-TEST-DEPLOY.cmd).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$CORE = 'http://127.0.0.1:8787'
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Start-Transcript -Path (Join-Path $logDir ("test-deploy-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")) | Out-Null
function Core-Get([string]$p) { Invoke-RestMethod -Uri ($CORE + $p) -Headers (Core-Headers $RT) -TimeoutSec 15 }
function Pause-AutoRun-File {
  # R2544.71 fallback for a core older than R2544.71: the same field the core's setAutoRun writes; atomic replace, no BOM
  $f = Join-Path $RT 'config\trading-mode.json'
  $j = (Get-Content -LiteralPath $f -Raw) | ConvertFrom-Json
  if ([string]$j.mode -ne 'TEST') { throw 'Mod dosyasi TEST degil; dokunulmadi.' }
  $j | Add-Member -NotePropertyName testAutoRun -NotePropertyValue $false -Force
  $tmp = $f + '.r71tmp'; $bak = $f + '.r71bak'
  [System.IO.File]::WriteAllText($tmp, ($j | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  [System.IO.File]::Replace($tmp, $f, $bak)
  $chk = (Get-Content -LiteralPath $f -Raw) | ConvertFrom-Json
  if ([string]$chk.mode -ne 'TEST' -or $chk.testAutoRun -ne $false) { throw 'Mod dosyasi dogrulanamadi.' }
}
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
  Write-Host '== TEST yeni girisleri durduruluyor (R2544.71: acik sanal lotlar KAPATILMAZ, beyne yazilir)'
  $r = Core-Post '/live/run' @{ action = 'PAUSE_TEST' }
  if ($r.ok -ne $true) {
    if (@($r.reasons) -contains 'RUN_ACTION_INVALID') {
      Write-Host 'Calisan cekirdek eski (PAUSE_TEST yok): otomatik baslatma mod dosyasinda kapatiliyor, lotlar acik kalir.'
      Pause-AutoRun-File
      $null = Core-Post '/live/leader-auto' @{ enabled = $false }
    } else { throw "TEST duraklatilamadi: $(@($r.reasons) -join ',')" }
  } else { Write-Host "Acik birakilan sanal lotlar: $(@($r.keptOpen) -join ', ') - beyne yazilan: $($r.lotsToBrain)" }
  $st = Core-Get '/live/status'
  if ($st.armed -eq $true) { $null = Core-Post '/live/disarm' @{ reason = 'TEST_DEPLOY' }; Write-Host 'Baslatma kapatildi.' }
  Start-Sleep -Seconds 3
  $st = Core-Get '/live/status'
  if ($st.armed -eq $true) { throw 'Baslatma kapanmadi (TEST otomatik baslatma hala acik); deploy yapilmadi.' }
  $pos = Open-Positions $RT
  if ($pos -and $pos.Count -gt 0) { Write-Host "Acik sanal lotlar deploy boyunca korunuyor: $($pos -join ', ')" }
  Write-Host '== JEV-DEPLOY (kendi guvenlik kontrolleriyle, degistirilmeden)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'JEV-DEPLOY.ps1')
  if ($LASTEXITCODE -ne 0) { throw "JEV-DEPLOY basarisiz (exit $LASTEXITCODE). TEST durdurulmus durumda; Office'te 'TEST'i baslat' ile yeniden baslatin." }
  Write-Host '== TEST yeniden baslatiliyor'
  # R2544.68.1 (21.10): 5 s after the core restart the account probe can still fail (BINANCE_FUTURES_CREDENTIAL_PROBE_FAILED);
  # the core supervisor then starts TEST by itself ~1.5 min later. Retry up to 6 times (~2 min); stop early if it is already running.
  $r = $null; $why = ''
  for ($i = 1; $i -le 6; $i++) {
    if ($i -eq 1) { Start-Sleep -Seconds 5 } else { Start-Sleep -Seconds 20 }
    try { $r = Core-Post '/live/run' @{ action = 'START_TEST' } } catch { $r = $null; $why = $_.Exception.Message }
    if ($r -and $r.ok -eq $true) { break }
    if ($r) { $why = (@($r.reasons) -join ',') }
    $st0 = $null; try { $st0 = Core-Get '/live/status' } catch { $st0 = $null }
    if ($st0 -and $st0.armed -eq $true -and $st0.tradingMode.mode -eq 'TEST') { $r = @{ ok = $true }; Write-Host 'TEST zaten baslamis (gozetmen).'; break }
    Write-Host "TEST baslatma denemesi $i/6 olmadi ($why); tekrar denenecek"
  }
  if (-not $r -or $r.ok -ne $true) { throw "TEST baslatilamadi (6 deneme, ~2 dk): $why. Office'te 'TEST'i baslat'a basin." }
  $st = Core-Get '/live/status'
  Write-Host "JEV_TEST_DEPLOY_OK surum=$($st.runtimeRelease) mod=$($st.tradingMode.mode) baslatma=$($st.armed) OTO=$($st.leaderAuto.enabled)"
} catch { Write-Host "JEV_TEST_DEPLOY_FAILED: $($_.Exception.Message)"; throw }
finally { Stop-Transcript | Out-Null }
