# BrainHub Trade Office - durdurucu. Yalnız bu ekranın kendi node sürecini kapatır; Brain Hub'a dokunmaz.
param([int]$Port = 8790, [switch]$Tailnet)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$pidFile = Join-Path $here 'office.pid'
if (Test-Path -LiteralPath $pidFile) {
    $officePid = [int](Get-Content -LiteralPath $pidFile -Raw)
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $officePid" -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine -and $p.CommandLine.Contains((Join-Path $here 'office-server.js'))) {
        Stop-Process -Id $officePid -Force
        Write-Host "OFFICE_STOPPED pid=$officePid"
    } else {
        Write-Host 'Office sureci bulunamadi (zaten kapali).'
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
} else {
    Write-Host 'office.pid yok; Office calismiyor.'
}
if ($Tailnet) {
    $tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path -LiteralPath $tailscale) { & $tailscale serve --https=$Port off | Out-Null; Write-Host "Tailscale :$Port yayini kapatildi." }
}
