# JEV-Brain TEST DEPLOY (R2544.71). Yalniz TEST (sanal hesap) modunda kullanilir:
#  1) TEST'in YENI GIRISLERI durdurulur (PAUSE_TEST). Acik sanal lotlar KAPATILMAZ: stop/TP emirleri sanal borsada kalir,
#     yoneticileri calismaya devam eder, o anki durumlari beyne yazilir (kullanici 21.10: "acik pozlari beyine yaz, deploy
#     sonrasi kapanacagindan garantiye alalim"). Restart boslugu 1 dk mumlardan islenir (kacan stop/TP o fiyattan dolar).
#     Calisan cekirdek R2544.71'den eskiyse (PAUSE_TEST yok): TEST otomatik baslatma bayragi mod dosyasinda kapatilir
#     (cekirdegin kendi setAutoRun alani, atomik yazim), sonra baslatma kapatilir - lotlar yine acik kalir.
#  2) JEV-DEPLOY.ps1 AYNEN calistirilir (baslatma kapali sart; TEST'te acik SANAL lot serbest, CANLI'da acik pozisyon yasak).
#  3) Deploy basariliysa TEST yeniden baslatilir (POST /live/run START_TEST).
# CANLI modda (R2544.147): acik gercek pozisyon varken ASLA kurmaz. CANLI calisiyorsa kullanicidan yazili onay (CANLI) ister; onayla
# CANLI'yi durdurur, kurar ve ayni hatlarla yeniden baslatir. Onay yoksa hicbir sey degismez.
# Sag tik > Yonetici olarak calistir (JEV-TEST-DEPLOY.cmd).
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
  # R2544.147 (kullanici 11.11: "canlida kalacagiz, JEV-TEST-DEPLOY.cmd'ye yukle"): CANLI modda da kurar. CANLI'yi KENDISI durdurmaz /
  # baslatmaz (son basis kullanicida) ve acik GERCEK pozisyon varken kurmaz (R2544.29). Kurulumdan sonra CANLI kapali kalir.
  if ($st.tradingMode -and $st.tradingMode.mode -eq 'LIVE') {
    Write-Host "CANLI modu. surum=$($st.runtimeRelease) baslatma=$($st.armed)"
    $posL = Open-Positions $RT
    if ($null -eq $posL) { throw 'Acik pozisyon durumu okunamadi; guvenlik icin kurulum yapilmadi.' }
    if ($posL.Count -gt 0) { throw "CANLI'da ACIK GERCEK POZISYON VAR: $($posL -join ', '). Pozisyon kapaninca bu betigi yeniden calistirin (stop / hedef emirleri Binance'te duruyor)." }
    $wasArmed = ($st.armed -eq $true)
    if ($wasArmed) {
      # kullanici 11.11: "canlida kalacagiz ... ben deploy ederim". CANLI'yi durdurup yeniden baslatmak yalniz kullanicinin BURADA yazdigi onayla.
      Write-Host ''
      Write-Host 'CANLI CALISIYOR, acik pozisyon yok.'
      Write-Host 'Kurulum icin CANLI kisa sure DURDURULUR (yeni giris yok), yeni surum kurulur, sonra CANLI AYNI HATLARLA YENIDEN BASLATILIR (gercek para).'
      $ans = (Read-Host 'Onayliyorsaniz CANLI yazin (baska bir sey yazarsaniz hicbir sey yapilmaz)').Trim().ToUpperInvariant()
      if ($ans -ne 'CANLI') { throw 'Onay verilmedi; hicbir sey degismedi (CANLI calismaya devam ediyor).' }
      Write-Host '== CANLI yeni girisleri durduruluyor (Durdur)'
      $r = Core-Post '/live/run' @{ action = 'STOP' }
      if ($r.ok -ne $true) { throw "CANLI durdurulamadi: $(@($r.reasons) -join ','). Hicbir sey kurulmadi." }
      Start-Sleep -Seconds 3
      $st = Core-Get '/live/status'
      if ($st.armed -eq $true) { throw 'CANLI baslatmasi kapanmadi; kurulum yapilmadi.' }
      $posL = Open-Positions $RT
      if ($null -eq $posL -or $posL.Count -gt 0) { throw "Durdurma sirasinda acik pozisyon olustu ($($posL -join ', ')); kurulum yapilmadi. CANLI DURDURULDU: Office'ten 'Kurulla CANLI'ya gec'e basin." }
    }
    Write-Host '== CANLI mod, baslatma kapali, acik pozisyon 0: JEV-DEPLOY calistiriliyor'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'JEV-DEPLOY.ps1')
    if ($LASTEXITCODE -ne 0) { throw "JEV-DEPLOY basarisiz (exit $LASTEXITCODE). CANLI DURDURULMUS durumda: Office'ten 'Kurulla CANLI'ya gec'e basin." }
    if ($wasArmed) {
      Write-Host '== CANLI yeniden baslatiliyor (onayinizla; ayni hatlar)'
      $r = $null; $why = ''
      for ($i = 1; $i -le 6; $i++) {
        if ($i -eq 1) { Start-Sleep -Seconds 5 } else { Start-Sleep -Seconds 20 }
        try { $r = Core-Post '/live/run' @{ action = 'GO_LIVE'; confirm = 'LIVE' } } catch { $r = $null; $why = $_.Exception.Message }
        if ($r -and $r.ok -eq $true) { break }
        if ($r) { $why = (@($r.reasons) -join ',') }
        Write-Host "CANLI baslatma denemesi $i/6 olmadi ($why); tekrar denenecek"
      }
      $st = Core-Get '/live/status'
      if (-not $r -or $r.ok -ne $true -or $st.armed -ne $true) {
        Write-Host "JEV_TEST_DEPLOY_OK surum=$($st.runtimeRelease) mod=$($st.tradingMode.mode) baslatma=$($st.armed)"
        Write-Host "UYARI: yeni surum KURULDU ama CANLI YENIDEN BASLATILAMADI ($why). Office ya da telefondan 'Kurulla CANLI'ya gec'e basin."
        return
      }
      Write-Host "JEV_TEST_DEPLOY_OK surum=$($st.runtimeRelease) mod=$($st.tradingMode.mode) baslatma=$($st.armed) CANLI_YENIDEN_BASLADI"
      return
    }
    $st = Core-Get '/live/status'
    Write-Host "JEV_TEST_DEPLOY_OK surum=$($st.runtimeRelease) mod=$($st.tradingMode.mode) baslatma=$($st.armed) OTO=$($st.leaderAuto.enabled)"
    Write-Host 'CANLI BASLATILMADI (kurulumdan once de kapaliydi): Office ya da telefondan "Kurulla CANLI''ya gec"e basin.'
    return
  }
  if (-not $st.tradingMode -or $st.tradingMode.mode -ne 'TEST') { throw 'Calisma modu okunamadi (TEST / CANLI degil); kurulum yapilmadi.' }
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
