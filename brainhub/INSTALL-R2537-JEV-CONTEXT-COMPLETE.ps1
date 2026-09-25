param(
  [string]$Root = 'C:\BrainHub',
  [string]$InstallRoot = 'C:\BrainHubInstall',
  [string]$BackupRoot = 'C:\BrainHubBackups'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Branch = 'futures15m-alarm-public-build'
$Repo = 'goxel1907/antik-harita-turkiye'
$ExpectedSovereign = '9.5.114-R2.5.3.2-JEV-SOVEREIGN-5M15M'
$ExpectedCortex = 'R2.5.3.4'
$ExpectedCortexMode = 'LIVE_REASONING_REFERENCE_READ_ONLY'
$ExpectedOffice = '2.0.5-JEV-CONTEXT-COMPLETE-R2537'
$ExpectedExperience = 'LIFETIME_AGGREGATE_PLUS_RECENT24_PLUS_JEV_LESSONS'
$ExpectedKnowledgeVersion = 'R2.5.3.6'
$ExpectedKnowledgeMode = 'JEV_VERIFIED_RESILIENT_FREE_RESEARCH_OSS_REFERENCE'
$ExpectedExitMode = 'BINDING_REDUCE_ONLY_WHEN_LIVE_ARMED'
$ExpectedPartialMode = 'BINDING_REDUCE_ONLY_WHEN_LIVE_ARMED'
$Work = Join-Path $InstallRoot 'R2537-JEV-CONTEXT-COMPLETE'
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
  if (-not (Test-Path -LiteralPath (Join-Path $BrainRoot 'config\remote-enabled'))) { return @{} }
  $token = Read-Dpapi (Join-Path $BrainRoot 'config\client-token.dpapi')
  if ($token) { return @{ Authorization = "Bearer $token" } }
  return @{}
}
function Stop-Office([string]$BrainRoot) {
  $stop = Join-Path $BrainRoot 'office-dashboard\STOP-OFFICE.ps1'
  if (Test-Path -LiteralPath $stop) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stop
    if ($LASTEXITCODE -ne 0) { throw 'Office stop failed.' }
  }
}
function Start-Office([string]$BrainRoot,[string]$BackupRoot) {
  $start = Join-Path $BrainRoot 'office-dashboard\START-OFFICE.ps1'
  if (-not (Test-Path -LiteralPath $start)) { throw "Office starter missing: $start" }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $start -NoBrowser -BrainRoot $BrainRoot -BackupRoot $BackupRoot
  if ($LASTEXITCODE -ne 0) { throw 'Office start failed.' }
}

if (-not (Test-Path -LiteralPath $Root)) { throw "BrainHub root missing: $Root" }

$headers = Brain-Headers $Root
$before = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 8
if ($before.armed -eq $true) {
  throw 'LIVE IS ARMED. Disarm LIVE first. This updater never disarms or re-arms LIVE automatically.'
}
Write-Host 'R2537_PRECHECK_LIVE_OFF'

New-Item -ItemType Directory -Force -Path $Work | Out-Null
Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Extract -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Extract | Out-Null

$archive = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
Invoke-WebRequest -UseBasicParsing -Uri $archive -OutFile $Zip -TimeoutSec 120
Expand-Archive -LiteralPath $Zip -DestinationPath $Extract -Force

$repoDir = Get-ChildItem -LiteralPath $Extract -Directory | Select-Object -First 1
if (-not $repoDir) { throw 'Downloaded repository archive is empty.' }
$source = Join-Path $repoDir.FullName 'brainhub'
$manage = Join-Path $source 'manage.ps1'
$cortexDoc = Join-Path $source 'docs\JEV-PRO-TRADER-CORTEX-R2534.md'
if (-not (Test-Path -LiteralPath $manage)) { throw 'Downloaded BrainHub manage.ps1 is missing.' }
if (-not (Test-Path -LiteralPath $cortexDoc)) { throw 'Downloaded R2534 Full Trader Cortex document is missing.' }
$researchModule = Join-Path $source 'knowledge-research.js'
if (-not (Test-Path -LiteralPath $researchModule)) { throw 'Downloaded knowledge-research.js is missing.' }
$marketPacketModule = Join-Path $source 'jev-market-packet.js'
$r2537Test = Join-Path $source 'test\jev-r2537-context.test.js'
if (-not (Test-Path -LiteralPath $marketPacketModule)) { throw 'Downloaded jev-market-packet.js is missing.' }
if (-not (Test-Path -LiteralPath $r2537Test)) { throw 'Downloaded R2537 context regression test is missing.' }
$visionRepairModule = Join-Path $source 'vision-contract-repair.js'
$visionRepairTest = Join-Path $source 'test\vision-contract-repair-r2536.test.js'
$researchR2536Test = Join-Path $source 'test\knowledge-research-r2536.test.js'
$ossDoc = Join-Path $source 'docs\JEV-OPEN-SOURCE-REFERENCE-R2536.md'
$auditScript = Join-Path $source 'JEV-VISION-AUDIT.ps1'
if (-not (Test-Path -LiteralPath $visionRepairModule)) { throw 'Downloaded vision-contract-repair.js is missing.' }
if (-not (Test-Path -LiteralPath $visionRepairTest)) { throw 'Downloaded R2536 Vision repair regression test is missing.' }
if (-not (Test-Path -LiteralPath $researchR2536Test)) { throw 'Downloaded R2536 research regression test is missing.' }
if (-not (Test-Path -LiteralPath $ossDoc)) { throw 'Downloaded R2536 open-source reference document is missing.' }
if (-not (Test-Path -LiteralPath $auditScript)) { throw 'Downloaded JEV-VISION-AUDIT.ps1 is missing.' }
$managementTest = Join-Path $source 'test\jev-r2535-management.test.js'
if (-not (Test-Path -LiteralPath $managementTest)) { throw 'Downloaded R2536 management/research regression test is missing.' }

Stop-Office $Root

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manage -Action Update -Root $Root -Source $source
if ($LASTEXITCODE -ne 0) { throw "BrainHub update failed with exit code $LASTEXITCODE" }

Start-Office $Root $BackupRoot

$headers = Brain-Headers $Root
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers $headers -TimeoutSec 10
$live = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 10
$office = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/ping' -TimeoutSec 10
$snapshot = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/snapshot' -TimeoutSec 20
$knowledge = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/jev/knowledge' -Headers $headers -TimeoutSec 10

if (-not $health.ok) { throw 'BrainHub health failed.' }
if ([string]$health.jevSovereign.packageVersion -ne $ExpectedSovereign) { throw "Unexpected sovereign package: $($health.jevSovereign.packageVersion)" }
if ([string]$health.jevSovereign.decisionOwner -ne 'JEV') { throw 'Unexpected decision owner.' }
if ([string]$health.jevSovereign.traderCortex.version -ne $ExpectedCortex) { throw 'R2534 Full Trader Cortex health metadata missing.' }
if ([string]$health.jevSovereign.traderCortex.mode -ne $ExpectedCortexMode) { throw 'Trader Cortex mode mismatch.' }
if ([string]$health.jevSovereign.experienceMemory -ne $ExpectedExperience) { throw 'Experience Memory metadata missing.' }
if ([string]$health.jevSovereign.dynamicKnowledge.version -ne $ExpectedKnowledgeVersion) { throw 'Dynamic knowledge version mismatch.' }
if ([string]$health.jevSovereign.dynamicKnowledge.mode -ne $ExpectedKnowledgeMode) { throw 'Dynamic knowledge mode mismatch.' }
if ([string]$health.jevSovereign.positionManagement.exitNow -ne $ExpectedExitMode) { throw 'JEV EXIT_NOW binding metadata mismatch.' }
if ([string]$health.jevSovereign.positionManagement.partial -ne $ExpectedPartialMode) { throw 'JEV PARTIAL binding metadata mismatch.' }
if (-not ($health.features -contains 'JEV_CORTEX_LIVE_REASONING_ALWAYS_ON')) { throw 'Always-on Cortex feature marker missing.' }
if (-not ($health.features -contains 'JEV_EXPERIENCE_MEMORY_ALWAYS_ON')) { throw 'Always-on experience feature marker missing.' }
if (-not ($health.features -contains 'JEV_LIFETIME_MEMORY_AGGREGATE')) { throw 'Lifetime memory feature marker missing.' }
if (-not ($health.features -contains 'JEV_FREE_MODEL_KNOWLEDGE_RESEARCH')) { throw 'Free-model research feature marker missing.' }
if (-not ($health.features -contains 'JEV_VERIFIED_DYNAMIC_KNOWLEDGE')) { throw 'Verified dynamic knowledge feature marker missing.' }
if (-not ($health.features -contains 'JEV_RESEARCH_RETRY_FAILOVER')) { throw 'Research retry/failover feature marker missing.' }
if (-not ($health.features -contains 'JEV_CURATED_OSS_REFERENCE_REGISTRY')) { throw 'Curated OSS reference feature marker missing.' }
if (-not ($health.features -contains 'JEV_CONTEXT_COMPLETE_PACKET')) { throw 'R2537 complete market packet marker missing.' }
if (-not ($health.features -contains 'JEV_SETUP_FAMILY_LEARNING')) { throw 'R2537 setup-family learning marker missing.' }
if (-not ($health.features -contains 'JEV_EXPLICIT_ENTRY_TIMING')) { throw 'R2537 entry-timing marker missing.' }
if (-not ($health.features -contains 'VISION_OB_OTE_FIB_OVERLAYS')) { throw 'R2537 Vision SMC overlay marker missing.' }
if ([string]$health.jevSovereign.marketContext.version -ne 'R2.5.3.7') { throw 'R2537 market context version mismatch.' }
if ([string]$health.jevSovereign.marketContext.entryTiming -ne 'JEV_EXPLICIT') { throw 'R2537 JEV entry timing metadata missing.' }
if (-not ($health.features -contains 'VISION_CORE_LEVEL_DETERMINISTIC_REPAIR')) { throw 'Vision deterministic core-level repair marker missing.' }
if (-not ($health.features -contains 'VISION_BOTH_SIDE_TRIGGER_CANDIDATES')) { throw 'Vision both-side trigger candidate marker missing.' }
if (-not ($health.features -contains 'JEV_VISION_EVIDENCE_ONLY_NO_PLAN_SCHEMA')) { throw 'JEV Vision evidence-only schema bypass marker missing.' }
if (-not ($health.features -contains 'JEV_EXIT_NOW_REDUCE_ONLY_BINDING')) { throw 'Binding JEV EXIT_NOW feature marker missing.' }
if (-not ($health.features -contains 'JEV_PARTIAL_REDUCE_ONLY_BINDING')) { throw 'Binding JEV PARTIAL feature marker missing.' }

if ([string]$live.jev.mode -ne 'SOVEREIGN_DIRECTOR_5M15M') { throw "Unexpected JEV mode: $($live.jev.mode)" }
if (-not [bool]$live.jev.traderCortex.loaded) { throw 'Trader Cortex reference did not load at runtime.' }
if ([string]$live.jev.traderCortex.version -ne $ExpectedCortex) { throw 'Runtime Trader Cortex version mismatch.' }
if ([string]$live.jev.traderCortex.mode -ne $ExpectedCortexMode) { throw 'Runtime Trader Cortex mode mismatch.' }
if ([string]$live.positionManager.execution -ne 'JEV_POSITION_REDUCE_BINDING_WHEN_LIVE_ARMED') { throw "Position manager execution mismatch: $($live.positionManager.execution)" }
if (-not ($live.positionManager.bindingActions -contains 'EXIT_NOW')) { throw 'Runtime EXIT_NOW binding missing.' }
if (-not ($live.positionManager.bindingActions -contains 'PARTIAL_TAKE_PROFIT')) { throw 'Runtime PARTIAL binding missing.' }
if ($live.armed -eq $true) { throw 'LIVE became armed during update.' }

if (-not $office.ok -or [string]$office.officeVersion -ne $ExpectedOffice) { throw "Office version mismatch: $($office.officeVersion)" }
if (-not $snapshot.health.ok -or -not $snapshot.status.ok) { throw 'Office snapshot health/status failed.' }
if (-not $knowledge.ok) { throw 'JEV knowledge research endpoint failed.' }
if ([int]$knowledge.openSourceRepoCount -lt 8) { throw "Curated OSS registry too small: $($knowledge.openSourceRepoCount)" }
if ([int]$knowledge.retryPolicy.channelAttempts -lt 2) { throw 'Research retry policy is not active.' }

$installedDoc = Join-Path $Root 'docs\JEV-PRO-TRADER-CORTEX-R2534.md'
if (-not (Test-Path -LiteralPath $installedDoc)) { throw 'Installed Trader Cortex document is missing.' }
$installedOssDoc = Join-Path $Root 'docs\JEV-OPEN-SOURCE-REFERENCE-R2536.md'
if (-not (Test-Path -LiteralPath $installedOssDoc)) { throw 'Installed open-source reference document is missing.' }

Write-Host 'R2537_PC_UPDATE_OK'
Write-Host 'R2537_OFFICE_UPDATE_OK'
Write-Host 'R2537_CORTEX_RUNTIME_LOADED_OK'
Write-Host 'R2537_MEMORY_LIFETIME_OK'
Write-Host 'R2537_LIFETIME_MEMORY_OK'
Write-Host 'R2537_RESEARCH_DESK_OK'
Write-Host 'R2537_RESEARCH_RETRY_OK'
Write-Host 'R2537_OSS_REFERENCE_OK'
Write-Host 'R2537_VISION_SCHEMA_REPAIR_OK'
Write-Host 'R2537_VISION_EVIDENCE_ONLY_OK'
Write-Host 'R2537_VISION_AUDIT_TOOL_OK'
Write-Host 'R2537_CONTEXT_COMPLETE_OK'
Write-Host 'R2537_SETUP_TAXONOMY_OK'
Write-Host 'R2537_ENTRY_TIMING_OK'
Write-Host 'R2537_VISION_SMC_OVERLAYS_OK'
Write-Host 'R2537_FREE_RESEARCH_OK'
Write-Host 'R2537_EXIT_BINDING_OK'
Write-Host 'R2537_PARTIAL_BINDING_OK'
Write-Host 'R2537_LIVE_VERIFIED_OFF'
Write-Host ("Sovereign package : {0}" -f $health.jevSovereign.packageVersion)
Write-Host ("Trader Cortex     : {0} / {1}" -f $live.jev.traderCortex.version,$live.jev.traderCortex.mode)
Write-Host ("Experience Memory : {0}" -f $health.jevSovereign.experienceMemory)
Write-Host ("Dynamic Knowledge : {0} / {1}" -f $health.jevSovereign.dynamicKnowledge.version,$health.jevSovereign.dynamicKnowledge.mode)
Write-Host ("Market Context     : {0} / {1} / timing={2}" -f $health.jevSovereign.marketContext.version,$health.jevSovereign.marketContext.mode,$health.jevSovereign.marketContext.entryTiming)
Write-Host ("JEV EXIT_NOW       : {0}" -f $health.jevSovereign.positionManagement.exitNow)
Write-Host ("JEV PARTIAL        : {0}" -f $health.jevSovereign.positionManagement.partial)
Write-Host ("Research verified  : {0}" -f $knowledge.verifiedCount)
Write-Host ("OSS references     : {0}" -f $knowledge.openSourceRepoCount)
Write-Host ("Research retries   : {0}" -f $knowledge.retryPolicy.channelAttempts)
Write-Host ("JEV mode           : {0}" -f $live.jev.mode)
Write-Host ("Office             : {0}" -f $office.officeVersion)
Write-Host 'Office URL         : http://127.0.0.1:8790/'
Write-Host 'LIVE was not armed or re-armed by this update.'
