# JEV-Brain GERI DONUS (CLAUDE_R2544_12_JEV_BRAIN) - yeni sistemi durdurur, eski C:\BrainHub'i guncel veriyle baslatir.
# YONETICI olarak calistirin. Eski klasordeki veri once yedeklenir; sonra C:\JEV-Brain\runtime\data eski klasore kopyalanir
# (gecisten sonraki islem kayitlari kaybolmasin diye). C:\JEV-Brain SILINMEZ.
param([switch]$AcikPozisyonaRagmen)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path (Join-Path $J 'logs') | Out-Null
Start-Transcript -Path (Join-Path $J "logs\geri-don-$ts.log") | Out-Null
try {
  Assert-Admin
  $pos = Open-Positions $RT
  if ($pos -and $pos.Count -gt 0 -and -not $AcikPozisyonaRagmen) { throw "ACIK POZISYON VAR: $($pos -join ', '). Kapandiktan sonra tekrar calistirin." }
  Write-Host '== 1) YENI SISTEM DURUYOR'
  Stop-Office $RT
  Stop-Core $RT
  Write-Host '== 2) ESKI VERI YEDEGI + GUNCEL VERI'
  Robo "$OLD\data" "$OLD\_backups\data-geri-donus-oncesi-$ts"
  Robo "$RT\data" "$OLD\data"
  Write-Host '== 3) ESKI SISTEM BASLIYOR (C:\BrainHub)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$OLD\manage.ps1" -Action Start -Root $OLD
  if ($LASTEXITCODE -ne 0) { throw "Eski core baslamadi (exit $LASTEXITCODE)" }
  Start-Office $OLD $OLDBK
  if (Test-Path -LiteralPath (Join-Path $J 'GECIS-TAMAMLANDI.txt')) { Move-Item -LiteralPath (Join-Path $J 'GECIS-TAMAMLANDI.txt') -Destination (Join-Path $J "GECIS-GERI-ALINDI-$ts.txt") }
  Set-Content -LiteralPath "$OLD\ESKI-KLASOR-ARTIK-KULLANILMIYOR.txt" -Encoding UTF8 -Value "$ts : GERI DONULDU. Sistem yeniden C:\BrainHub'dan calisiyor."
  Write-Host 'JEV_GERI_DON_OK — sistem C:\BrainHub. LIVE ARM restart ile kapandi; uygulamadan yeniden acin.'
} catch { Write-Host "JEV_GERI_DON_FAILED: $($_.Exception.Message)"; throw }
finally { Stop-Transcript | Out-Null }
