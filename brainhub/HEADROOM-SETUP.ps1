param(
  [int]$Port = 8788,
  [switch]$Install
)
$ErrorActionPreference = 'Stop'
if ($Port -eq 8787) { throw '8787 BrainHub tarafindan kullaniliyor. Headroom icin 8788 veya baska bos bir port secin.' }

function Test-Headroom([int]$p) {
  try {
    $r = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $p) -TimeoutSec 3
    return ($r.status -eq 'healthy' -or $r.ready -eq $true -or $r.status)
  } catch { return $false }
}

if (Test-Headroom $Port) {
  Write-Host "HEADROOM_OK http://127.0.0.1:$Port" -ForegroundColor Green
  Write-Host "9Router > Endpoint > Token Saver > Headroom URL: http://127.0.0.1:$Port"
  exit 0
}

$cmd = Get-Command headroom -ErrorAction SilentlyContinue
if (-not $cmd -and $Install) {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $py) { throw 'Python bulunamadi. Headroom kurulumu yapilamadi.' }
  & $py.Source -m pip install 'headroom-ai[proxy]'
  if ($LASTEXITCODE -ne 0) { throw 'Headroom pip kurulumu basarisiz.' }
  $cmd = Get-Command headroom -ErrorAction SilentlyContinue
}

if (-not $cmd) {
  Write-Host 'Headroom kurulu degil. RTK 9Router icinde calismaya devam eder; Headroom opsiyoneldir.' -ForegroundColor Yellow
  Write-Host 'Kurmak icin: .\HEADROOM-SETUP.ps1 -Install'
  Write-Host "Kurulumdan sonra 9Router Headroom URL'ini http://127.0.0.1:$Port yapin."
  exit 2
}

$root = if ($env:BRAINHUB_ROOT) { $env:BRAINHUB_ROOT } else { 'C:\JEV-Brain\runtime' }
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir 'headroom.out.log'
$err = Join-Path $logDir 'headroom.err.log'
$proc = Start-Process -FilePath $cmd.Source -ArgumentList @('proxy','--host','127.0.0.1','--port',"$Port") -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
Start-Sleep -Seconds 4
if (-not (Test-Headroom $Port)) {
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw "Headroom $Port portunda saglikli baslamadi. Log: $err"
}
Write-Host "HEADROOM_STARTED pid=$($proc.Id) url=http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "9Router > Endpoint > Token Saver > Headroom URL: http://127.0.0.1:$Port"
Write-Host 'Not: BrainHub 8787 portunu kullanir; 9Router Headroom varsayilani 8787 olarak birakilamaz.'
