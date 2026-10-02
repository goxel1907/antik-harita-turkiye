# JEV-Brain DEPLOY (CLAUDE_R2544_12_JEV_BRAIN) - gecisten SONRAKI guncellemeler icin.
# Kaynak: C:\JEV-Brain\source (git, dal r2544-claude-panel-guard). Hedef: C:\JEV-Brain\runtime.
# Beklenen commit C:\JEV-Brain\BEKLENEN-SURUM.txt icindedir (Claude her surumde gunceller). YONETICI olarak calistirin.
param([switch]$AcikPozisyonaRagmen)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path (Join-Path $J 'logs') | Out-Null
Start-Transcript -Path (Join-Path $J "logs\deploy-$ts.log") | Out-Null
try {
  Assert-Admin
  if (-not (Test-Path -LiteralPath (Join-Path $J 'GECIS-TAMAMLANDI.txt'))) { throw 'Once JEV-BRAIN-GECIS.cmd calismali.' }
  $exp = (Get-Content -LiteralPath (Join-Path $J 'BEKLENEN-SURUM.txt') -Raw).Trim()
  $h = Invoke-Git $SRC rev-parse HEAD; $s = Invoke-Git $SRC status --short
  Write-Host "SOURCE HEAD=$h status=[$s]"
  if ($h -ne $exp) { throw "Kaynak beklenen surumde degil: $h (beklenen $exp)" }
  if ($s) { throw 'Kaynak temiz degil; deploy durduruldu.' }
  $pos = Open-Positions $RT
  if ($pos -and $pos.Count -gt 0 -and -not $AcikPozisyonaRagmen) { throw "ACIK POZISYON VAR: $($pos -join ', '). Kapandiktan sonra tekrar calistirin (veya -AcikPozisyonaRagmen)." }
  Write-Host '== GITHUB PUSH'
  Invoke-Git $SRC push origin "HEAD:refs/heads/$BRANCH" | Out-Host
  if (Test-Path -LiteralPath (Join-Path $J 'BEKLENEN-PUBLIC.txt')) {
    $expPub = (Get-Content -LiteralPath (Join-Path $J 'BEKLENEN-PUBLIC.txt') -Raw).Trim()
    $hp = Invoke-Git $PUB rev-parse HEAD; $sp = Invoke-Git $PUB status --short
    if ($hp -ne $expPub -or $sp) { throw "Public repo beklenen durumda degil: $hp [$sp]" }
    Invoke-Git $PUB push origin $PUBBRANCH | Out-Host
  }
  Write-Host '== CORE GUNCELLEME (syntax + testler + yedek + kopya + restart + saglik; hata olursa manage.ps1 geri alir)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$SRC\brainhub\manage.ps1" -Action Update -Source $SRC -Root $RT
  if ($LASTEXITCODE -ne 0) { throw "manage.ps1 Update basarisiz (exit $LASTEXITCODE)" }
  Write-Host '== OFFICE YENIDEN BASLAT'
  Stop-Office $RT
  Start-Sleep -Seconds 2
  Start-Office $RT $BK
  foreach ($f in 'server.js','live-controller.js','burst-scalp.js','position-guard.js','engine.js','pipeline.js','market.js','jev-market-packet.js','jev-decision.js','chart-narrator.js') {
    Write-Host ("HASH $f " + (Get-FileHash (Join-Path "$RT\server" $f)).Hash)
  }
  Write-Host "JEV_DEPLOY_OK $h — LIVE ARM restart ile kapandi; uygulamadan yeniden acin."
} catch { Write-Host "JEV_DEPLOY_FAILED: $($_.Exception.Message)"; throw }
finally { Stop-Transcript | Out-Null }
