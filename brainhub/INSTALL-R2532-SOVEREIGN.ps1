param(
  [string]$Root = 'C:\BrainHub',
  [string]$InstallRoot = 'C:\BrainHubInstall',
  [string]$BackupRoot = 'C:\BrainHubBackups',
  [switch]$Deep
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Branch = 'futures15m-alarm-public-build'
$Repo = 'goxel1907/antik-harita-turkiye'
$ExpectedPackage = '9.5.114-R2.5.3.2-JEV-SOVEREIGN-5M15M'
$ExpectedOffice = '2.0.0-JEV-SOVEREIGN-R2532'
$Work = Join-Path $InstallRoot 'R2532-JEV-SOVEREIGN-UPDATE'
$Zip = Join-Path $Work 'source.zip'
$Extract = Join-Path $Work 'source'

function Read-Dpapi([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  $secure = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Brain-Headers([string]$BrainRoot) {
  $flag = Join-Path $BrainRoot 'config\remote-enabled'
  if (-not (Test-Path -LiteralPath $flag)) { return @{} }
  $token = Read-Dpapi (Join-Path $BrainRoot 'config\client-token.dpapi')
  if ($token) { return @{ Authorization = "Bearer $token" } }
  return @{}
}
function Get-BrainStatus([string]$BrainRoot) {
  return Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers (Brain-Headers $BrainRoot) -TimeoutSec 6
}
function Stop-Office([string]$BrainRoot) {
  $stop = Join-Path $BrainRoot 'office-dashboard\STOP-OFFICE.ps1'
  if (Test-Path -LiteralPath $stop) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stop
    if ($LASTEXITCODE -ne 0) { throw 'Office stop failed.' }
    return
  }
  $expected = Join-Path $BrainRoot 'office-dashboard\office-server.js'
  $rows = @(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($expected) })
  foreach ($p in $rows) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Start-Office([string]$BrainRoot,[string]$BackupRoot) {
  $start = Join-Path $BrainRoot 'office-dashboard\START-OFFICE.ps1'
  if (-not (Test-Path -LiteralPath $start)) { throw "Office starter missing: $start" }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $start -NoBrowser -BrainRoot $BrainRoot -BackupRoot $BackupRoot
  if ($LASTEXITCODE -ne 0) { throw 'Office start failed.' }
}

if (-not (Test-Path -LiteralPath $Root)) { throw "BrainHub root missing: $Root" }

# Never alter LIVE state here. Update requires the user to have disarmed LIVE first.
try {
  $before = Get-BrainStatus $Root
  if ($before.armed -eq $true) {
    throw 'LIVE IS ARMED. Disarm LIVE first; this installer will not disarm or re-arm it automatically.'
  }
  Write-Host 'R2532_PRECHECK_LIVE_OFF'
} catch {
  if ($_.Exception.Message -like 'LIVE IS ARMED*') { throw }
  throw "BrainHub live/status could not be verified before update: $($_.Exception.Message)"
}

New-Item -ItemType Directory -Force -Path $Work | Out-Null
Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Extract -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Extract | Out-Null

$archive = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
Write-Host "DOWNLOAD $archive"
Invoke-WebRequest -UseBasicParsing -Uri $archive -OutFile $Zip -TimeoutSec 120
Expand-Archive -LiteralPath $Zip -DestinationPath $Extract -Force

$repoDir = Get-ChildItem -LiteralPath $Extract -Directory | Select-Object -First 1
if (-not $repoDir) { throw 'Downloaded repository archive did not contain a root directory.' }
$source = Join-Path $repoDir.FullName 'brainhub'
$manage = Join-Path $source 'manage.ps1'
if (-not (Test-Path -LiteralPath $manage)) { throw "Downloaded BrainHub source is incomplete: $manage" }

Stop-Office $Root

# manage.ps1 runs syntax + unit tests, creates a BrainHub backup, updates PC + Office,
# restarts BrainHub, and rolls back on failed verification.
$args = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$manage,'-Action','Update','-Root',$Root,'-Source',$source)
if ($Deep) { $args += '-Deep' }
& powershell.exe @args
if ($LASTEXITCODE -ne 0) { throw "BrainHub R2532 update failed with exit code $LASTEXITCODE" }

Start-Office $Root $BackupRoot

$headers = Brain-Headers $Root
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers $headers -TimeoutSec 8
$live = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 8
$office = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/ping' -TimeoutSec 8
$snapshot = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/snapshot' -TimeoutSec 15

if (-not $health.ok) { throw 'BrainHub health is not OK after update.' }
if ([string]$health.jevSovereign.packageVersion -ne $ExpectedPackage) { throw "Unexpected sovereign package: $($health.jevSovereign.packageVersion)" }
if ([string]$health.jevSovereign.decisionOwner -ne 'JEV') { throw 'JEV is not the final strategic owner.' }
if ([int]$health.jevSovereign.passLimit -ne 2) { throw 'JEV passLimit is not 2.' }
if ([bool]$health.jevSovereign.autonomousPlanWorkers) { throw 'Autonomous plan workers are still enabled.' }
if (-not [bool]$health.jevSovereign.noScoreThresholds) { throw 'Score thresholds are still active in sovereign contract.' }
if (-not [bool]$health.jevSovereign.noTwoOfThreeGate) { throw '2-of-3 gate is still active in sovereign contract.' }
if (-not [bool]$health.jevSovereign.noHard15mStrategicVeto) { throw 'Hard 15m strategic veto is still active in sovereign contract.' }
if ([string]$live.jev.mode -ne 'SOVEREIGN_DIRECTOR_5M15M') { throw "Unexpected JEV mode: $($live.jev.mode)" }
if ($live.armed -eq $true) { throw 'LIVE became armed during update; refusing success.' }
if (-not $office.ok -or [string]$office.officeVersion -ne $ExpectedOffice) { throw "Office version mismatch: $($office.officeVersion)" }
if (-not $snapshot.health.ok -or -not $snapshot.status.ok) { throw 'Office snapshot is not healthy after update.' }

Write-Host 'R2532_PC_UPDATE_OK'
Write-Host 'R2532_OFFICE_UPDATE_OK'
Write-Host 'R2532_JEV_SOVEREIGN_CONTRACT_OK'
Write-Host 'R2532_LIVE_VERIFIED_OFF'
Write-Host ("BrainHub package: {0}" -f $health.jevSovereign.packageVersion)
Write-Host ("JEV mode: {0}" -f $live.jev.mode)
Write-Host ("Office: {0}" -f $office.officeVersion)
Write-Host 'Office URL: http://127.0.0.1:8790/'
Write-Host 'LIVE was not armed or re-armed by this update.'
