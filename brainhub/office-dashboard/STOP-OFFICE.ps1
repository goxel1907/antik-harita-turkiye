# BrainHub Trade Office - durdurucu. Yalnız bu ekranın kendi node sürecini kapatır; Brain Hub'a dokunmaz.
param([int]$Port = 8790, [switch]$Tailnet, [string]$OfficeRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$here = $OfficeRoot
$pidFile = Join-Path $here 'office.pid'
. (Join-Path $PSScriptRoot 'office-process.ps1')
$officePid = Find-OfficeProcess $here $Port
if ($officePid) {
    Stop-Process -Id $officePid -Force
    for ($i=0; $i -lt 30; $i++) {
        if (-not (Get-Process -Id $officePid -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 300
    }
    if (Get-Process -Id $officePid -ErrorAction SilentlyContinue) { throw 'Office durmadi; dosyalara dokunulmadi.' }
    if (Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'Office portu halen kullanimda.' }
    Write-Host "OFFICE_STOPPED pid=$officePid"
} else {
    Write-Host 'Office zaten kapali.'
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
if ($Tailnet) {
    $tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path -LiteralPath $tailscale) { & $tailscale serve --https=$Port off | Out-Null; Write-Host "Tailscale :$Port yayini kapatildi." }
}
