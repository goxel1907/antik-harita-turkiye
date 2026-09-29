# JEV-Brain APK yeniden derleme (CLAUDE_R2544_13): yalniz C:\JEV-Brain\apk-source dalini GitHub'a push eder;
# Codemagic yeni build baslatir. PC core/Office'e dokunmaz. Beklenen commit: C:\JEV-Brain\BEKLENEN-PUBLIC.txt
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$exp = (Get-Content -LiteralPath (Join-Path $J 'BEKLENEN-PUBLIC.txt') -Raw).Trim()
$h = Invoke-Git $APK rev-parse HEAD; $s = Invoke-Git $APK status --short
Write-Host "APK-SOURCE HEAD=$h status=[$s]"
if ($h -ne $exp) { Write-Host "APK_PUSH_FAILED: beklenmeyen HEAD (beklenen $exp)"; exit 1 }
if ($s) { Write-Host 'APK_PUSH_FAILED: calisma alani temiz degil'; exit 1 }
if ((Invoke-Git $APK remote get-url origin) -ne $GITHUB) { Write-Host 'APK_PUSH_FAILED: origin GitHub degil'; exit 1 }
Invoke-Git $APK push origin $PUBBRANCH | Out-Host
Write-Host "APK_PUSH_OK — Codemagic'te YENI build basladi (eski build'i 'rerun' etmeyin)."
