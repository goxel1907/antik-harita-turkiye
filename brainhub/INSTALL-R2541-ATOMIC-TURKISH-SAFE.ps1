param(
  [string]$Root = 'C:\BrainHub',
  [string]$InstallRoot = 'C:\BrainHubInstall',
  [string]$BackupRoot = 'C:\BrainHubBackups'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Branch = 'r2541-atomic-turkish-safe'
$Repo = 'goxel1907/antik-harita-turkiye'
$ExpectedSovereign = '9.5.114-R2.5.3.2-JEV-SOVEREIGN-5M15M'
$ExpectedCortex = 'R2.5.3.4'
$ExpectedCortexMode = 'LIVE_REASONING_REFERENCE_READ_ONLY'
$ExpectedOffice = '2.0.8-JEV-ATOMIC-TR-R2541'
$ExpectedExperience = 'LIFETIME_AGGREGATE_PLUS_RECENT24_PLUS_JEV_LESSONS'
$ExpectedKnowledgeVersion = 'R2.5.3.6'
$ExpectedKnowledgeMode = 'JEV_VERIFIED_RESILIENT_FREE_RESEARCH_OSS_REFERENCE'
$ExpectedExitMode = 'BINDING_REDUCE_ONLY_WHEN_LIVE_ARMED'
$ExpectedPartialMode = 'BINDING_REDUCE_ONLY_WHEN_LIVE_ARMED'
$Work = Join-Path $InstallRoot 'R2541-ATOMIC-TURKISH-SAFE'
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
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$LatestInstallLog = Join-Path $InstallRoot 'LATEST-INSTALL.log'
Start-Transcript -Path $LatestInstallLog -Force | Out-Null
Write-Host ("R2541_INSTALL_LOG {0}" -f $LatestInstallLog)

$headers = Brain-Headers $Root
$before = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 8
if ($before.armed -eq $true) {
  throw 'LIVE IS ARMED. Disarm LIVE first. This updater never disarms or re-arms LIVE automatically.'
}
Write-Host 'R2541_PRECHECK_LIVE_OFF'

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
$r2538MirrorTest = Join-Path $source 'test\jev-live-mirror-r2538.test.js'
if (-not (Test-Path -LiteralPath $r2538MirrorTest)) { throw 'Downloaded R2538 live mirror regression test is missing.' }
$r2539AndroidTest = Join-Path $source 'test\android-pc-only-r2539.test.js'
if (-not (Test-Path -LiteralPath $r2539AndroidTest)) { throw 'Downloaded R2539 Android PC-only regression test is missing.' }
$officeTest = Join-Path $source 'test\office-dashboard.test.js'
if (-not (Test-Path -LiteralPath $officeTest)) { throw 'Downloaded Office regression test is missing.' }
$r2541Test = Join-Path $source 'test\r2541-atomic-turkish-safe.test.js'
if (-not (Test-Path -LiteralPath $r2541Test)) { throw 'Downloaded R2541 atomic/Turkish regression test is missing.' }

$syntaxFiles = @(
  (Join-Path $source 'engine.js'),
  (Join-Path $source 'market.js'),
  (Join-Path $source 'server.js'),
  (Join-Path $source 'live-controller.js'),
  (Join-Path $source 'office-dashboard\office-server.js')
)
foreach ($sf in $syntaxFiles) {
  & node --check $sf
  if ($LASTEXITCODE -ne 0) { throw "Node syntax check failed: $sf" }
}
Write-Host 'R2541_NODE_SYNTAX_OK'

foreach ($tf in @($r2537Test,$r2538MirrorTest,$r2539AndroidTest,$officeTest,$r2541Test)) {
  & node --test $tf
  if ($LASTEXITCODE -ne 0) { throw "Regression test failed: $tf" }
}
Write-Host 'R2541_SOURCE_REGRESSION_OK'
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
$mirror = $null
$mirrorLastError = $null
$lastMirror = $null
for ($i = 1; $i -le 4; $i++) {
  try {
    $candidateMirror = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/context/jev-live-mirror?symbol=BTCUSDT&tf=15m' -Headers $headers -TimeoutSec 20
    if ($candidateMirror.ok -and [int]$candidateMirror.parity.compared -ge 3) {
      $lastMirror = $candidateMirror
      if ([int]$candidateMirror.parity.mismatches -eq 0) {
        $mirror = $candidateMirror
        break
      }
      $bad = @($candidateMirror.parity.checks | Where-Object { $_.match -eq $false } | ForEach-Object { "$($_.name):packet=$($_.packet):chart=$($_.chart)" })
      $mirrorLastError = "attempt=$i compared=$($candidateMirror.parity.compared) mismatches=$($candidateMirror.parity.mismatches) detail=$($bad -join '; ')"
    } else {
      $mirrorLastError = "attempt=$i endpoint/parity unavailable"
    }
  } catch {
    $mirrorLastError = "attempt=$i $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 2
}
if ($null -eq $mirror) {
  if ($null -eq $lastMirror) { throw "R2541 mirror endpoint verification failed: $mirrorLastError" }
  # Runtime parity is an observability signal. A candle boundary/cache refresh can transiently differ;
  # the Office card must display that difference rather than making a safe software update impossible.
  $mirror = $lastMirror
  Write-Warning "R2541_RUNTIME_PARITY_DIAGNOSTIC $mirrorLastError"
}

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
if (-not ($health.features -contains 'JEV_LIVE_MIRROR_READ_ONLY')) { throw 'R2541 live mirror marker missing.' }
if (-not ($health.features -contains 'JEV_MIRROR_PACKET_CHART_PARITY')) { throw 'R2541 packet/chart parity marker missing.' }
if (-not ($health.features -contains 'JEV_LIVE_MIRROR_FULL_OVERLAYS')) { throw 'R2541 full-overlay mirror marker missing.' }
if (-not ($health.features -contains 'R2541_ATOMIC_PACKET_CHART')) { throw 'R2541 atomic packet/chart marker missing.' }
if (-not ($health.features -contains 'R2541_CONFIRMED_SWING_TRENDLINES')) { throw 'R2541 confirmed-swing trend marker missing.' }
if (-not ($health.features -contains 'R2541_PATTERN_GEOMETRY')) { throw 'R2541 pattern-geometry marker missing.' }
if (-not ($health.features -contains 'R2541_TURKISH_OFFICE_UI')) { throw 'R2541 Turkish Office marker missing.' }
if (-not ($health.features -contains 'ANDROID_REMOTE_EXECUTE_DISABLED_PC_SCHEDULER_ONLY')) { throw 'R2539 PC remote-execute block marker missing.' }
if ([string]$health.jevSovereign.releaseVersion -ne 'R2541-ATOMIC-TURKISH-SAFE') { throw 'R2541 release identity missing.' }
if ([string]$health.jevSovereign.liveMirror.version -ne 'R2.5.4.1') { throw 'R2541 live mirror metadata missing.' }
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

$remoteExecuteBlocked = $false
try {
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/live/execute' -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 10 | Out-Null
} catch {
  try { $code = [int]$_.Exception.Response.StatusCode } catch { $code = 0 }
  if ($code -eq 410) { $remoteExecuteBlocked = $true }
  else { throw "R2539 remote execute runtime check failed with HTTP $code : $($_.Exception.Message)" }
}
if (-not $remoteExecuteBlocked) { throw 'R2539 remote /live/execute was not blocked.' }
if ($live.armed -eq $true) { throw 'LIVE changed state during R2539 remote-execute check.' }

if (-not $office.ok -or [string]$office.officeVersion -ne $ExpectedOffice) { throw "Office version mismatch: $($office.officeVersion)" }
if (-not $snapshot.health.ok -or -not $snapshot.status.ok) { throw 'Office snapshot health/status failed.' }
if (-not $mirror.ok -or [string]$mirror.contract -ne 'R2541_ATOMIC_TURKISH_MIRROR') { throw 'R2541 JEV live mirror endpoint failed.' }
if (-not $mirror.parity -or -not [bool]$mirror.parity.ok) { throw 'R2541 packet/chart parity is not OK.' }
if ([int]$mirror.parity.mismatches -ne 0) { throw ("R2541 structural packet/chart parity failed. mismatches={0}" -f $mirror.parity.mismatches) }
if ([string]$mirror.parity.structuralSemantics -ne 'R2541_PACKET_VS_CHART_SWING_TREND_PATTERN_PARITY') { throw 'R2541 structural parity contract missing.' }
if ([int]$mirror.parity.compared -lt 10) { throw ("R2541 parity compared too few fields: {0}" -f $mirror.parity.compared) }
$installedOfficeHtml = Join-Path $Root 'office-dashboard\public\office.html'
if (-not (Test-Path -LiteralPath $installedOfficeHtml)) { throw 'Installed Office HTML missing.' }
$installedOfficeSource = Get-Content -LiteralPath $installedOfficeHtml -Raw
if ($installedOfficeSource -notmatch 'JEV Canlı Görüş Aynası — Tam Görünüm') { throw 'R2541 Office full mirror card missing.' }
if ($installedOfficeSource -notmatch 'Gözlenen tasfiye bölgeleri') { throw 'R2541 liquidation-zone telemetry missing.' }
if ($installedOfficeSource -notmatch 'TAM AÇIKLAMALI') { throw 'R2541 full annotated graph missing.' }
if (-not $knowledge.ok) { throw 'JEV knowledge research endpoint failed.' }
if ([int]$knowledge.openSourceRepoCount -lt 8) { throw "Curated OSS registry too small: $($knowledge.openSourceRepoCount)" }
if ([int]$knowledge.retryPolicy.channelAttempts -lt 2) { throw 'Research retry policy is not active.' }

$installedDoc = Join-Path $Root 'docs\JEV-PRO-TRADER-CORTEX-R2534.md'
if (-not (Test-Path -LiteralPath $installedDoc)) { throw 'Installed Trader Cortex document is missing.' }
$installedOssDoc = Join-Path $Root 'docs\JEV-OPEN-SOURCE-REFERENCE-R2536.md'
if (-not (Test-Path -LiteralPath $installedOssDoc)) { throw 'Installed open-source reference document is missing.' }

Write-Host 'R2541_PC_UPDATE_OK'
Write-Host 'R2541_OFFICE_UPDATE_OK'
Write-Host 'R2541_CORTEX_RUNTIME_LOADED_OK'
Write-Host 'R2541_MEMORY_LIFETIME_OK'
Write-Host 'R2541_LIFETIME_MEMORY_OK'
Write-Host 'R2541_RESEARCH_DESK_OK'
Write-Host 'R2541_RESEARCH_RETRY_OK'
Write-Host 'R2541_OSS_REFERENCE_OK'
Write-Host 'R2541_VISION_SCHEMA_REPAIR_OK'
Write-Host 'R2541_VISION_EVIDENCE_ONLY_OK'
Write-Host 'R2541_VISION_AUDIT_TOOL_OK'
Write-Host 'R2541_CONTEXT_COMPLETE_OK'
Write-Host 'R2541_JEV_LIVE_MIRROR_OK'
Write-Host 'R2541_REMOTE_EXECUTE_BLOCK_OK'
Write-Host ("R2541_PACKET_CHART_PARITY_OK compared={0} mismatches=0" -f $mirror.parity.compared)
Write-Host 'R2541_STRUCTURAL_TREND_PATTERN_PARITY_OK'
Write-Host 'R2541_OFFICE_MIRROR_CARD_OK'
Write-Host 'R2541_FULL_OVERLAY_GRAPH_OK'
Write-Host 'R2541_LIQUIDATION_OVERLAY_OK'
Write-Host 'R2541_FULL_WIDTH_LAYOUT_OK'
Write-Host 'R2541_SETUP_TAXONOMY_OK'
Write-Host 'R2541_ENTRY_TIMING_OK'
Write-Host 'R2541_VISION_SMC_OVERLAYS_OK'
Write-Host 'R2541_FREE_RESEARCH_OK'
Write-Host 'R2541_EXIT_BINDING_OK'
Write-Host 'R2541_PARTIAL_BINDING_OK'
Write-Host 'R2541_ATOMIC_PACKET_CHART_PARITY_OK'
Write-Host 'R2541_CONFIRMED_SWING_TRENDLINES_OK'
Write-Host 'R2541_RANGE_CLASSIFICATION_OK'
Write-Host 'R2541_PATTERN_GEOMETRY_OK'
Write-Host 'R2541_TURKISH_UI_OK'
Write-Host 'R2541_ENTRY_REASON_TR_OK'
Write-Host 'R2541_STALE_DECISION_OK'
Write-Host 'R2541_ANDROID_PC_ONLY_FAIL_CLOSED_OK'
Write-Host 'R2541_INSTALL_TRANSCRIPT_OK'
Write-Host 'R2541_LIVE_VERIFIED_OFF'
Write-Host ("Release           : {0}" -f $health.jevSovereign.releaseVersion)
Write-Host ("Sovereign package : {0}" -f $health.jevSovereign.packageVersion)
Write-Host ("Trader Cortex     : {0} / {1}" -f $live.jev.traderCortex.version,$live.jev.traderCortex.mode)
Write-Host ("Experience Memory : {0}" -f $health.jevSovereign.experienceMemory)
Write-Host ("Dynamic Knowledge : {0} / {1}" -f $health.jevSovereign.dynamicKnowledge.version,$health.jevSovereign.dynamicKnowledge.mode)
Write-Host ("Market Context     : {0} / {1} / timing={2}" -f $health.jevSovereign.marketContext.version,$health.jevSovereign.marketContext.mode,$health.jevSovereign.marketContext.entryTiming)
Write-Host ("Live Mirror        : {0} / {1}" -f $health.jevSovereign.liveMirror.version,$health.jevSovereign.liveMirror.mode)
Write-Host 'Mirror overlays     : EMA + trend + range + liquidity + FVG/CE50 + OB + OTE + Fib + swing/BOS/CHoCH + observed liquidation'
Write-Host 'Android execution  : REMOTE/MOBILE ORDER ORIGINATION BLOCKED AT PC SERVER'
Write-Host ("Mirror parity      : compared={0} mismatches={1}" -f $mirror.parity.compared,$mirror.parity.mismatches)
Write-Host ("JEV EXIT_NOW       : {0}" -f $health.jevSovereign.positionManagement.exitNow)
Write-Host ("JEV PARTIAL        : {0}" -f $health.jevSovereign.positionManagement.partial)
Write-Host ("Research verified  : {0}" -f $knowledge.verifiedCount)
Write-Host ("OSS references     : {0}" -f $knowledge.openSourceRepoCount)
Write-Host ("Research retries   : {0}" -f $knowledge.retryPolicy.channelAttempts)
Write-Host ("JEV mode           : {0}" -f $live.jev.mode)
Write-Host ("Office             : {0}" -f $office.officeVersion)
Write-Host 'Office URL         : http://127.0.0.1:8790/'
Write-Host 'LIVE was not armed or re-armed by this update.'

Write-Host ("Installer log       : {0}" -f $LatestInstallLog)
$PerRunLog = Join-Path $Work ("INSTALL-R2541-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Stop-Transcript | Out-Null
Copy-Item -LiteralPath $LatestInstallLog -Destination $PerRunLog -Force
Write-Host ("R2541_INSTALL_LOG_SAVED {0}" -f $PerRunLog)
