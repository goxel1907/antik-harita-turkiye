param(
  [string]$Root = 'C:\BrainHub',
  [string]$OutRoot = 'C:\BrainHubAudit',
  [switch]$SkipBenchmark
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Read-Dpapi([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  $secure=(Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Brain-Headers([string]$BrainRoot) {
  if (-not (Test-Path -LiteralPath (Join-Path $BrainRoot 'config\remote-enabled'))) { return @{} }
  $token=Read-Dpapi (Join-Path $BrainRoot 'config\client-token.dpapi')
  if ($token) { return @{ Authorization="Bearer $token" } }
  return @{}
}
function Save-Json([string]$Path,$Object) {
  $Object | ConvertTo-Json -Depth 60 | Set-Content -LiteralPath $Path -Encoding UTF8
}
function Count-Array($v) {
  if ($null -eq $v) { return 0 }
  return @($v).Count
}

$headers=Brain-Headers $Root
$live=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 10
if ($live.armed -eq $true) {
  throw 'LIVE ARMED. Ayrintili Vision/JEV benchmark sirasinda LIVE kapali olmali; bu script LIVE durumunu degistirmez.'
}

$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$out=Join-Path $OutRoot ("JEV-VISION-AUDIT-"+$stamp)
New-Item -ItemType Directory -Force -Path $out | Out-Null
Write-Host "AUDIT_DIR $out"

$health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers $headers -TimeoutSec 10
Save-Json (Join-Path $out 'health.json') $health
Save-Json (Join-Path $out 'live-status.json') $live

if (-not $SkipBenchmark) {
  Write-Host 'VISION_BENCHMARK_21 basliyor; yerel Vision modeline gore 5-15 dk surebilir...'
  $bench=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/vision/benchmark?run=1&set=v112' -Headers $headers -TimeoutSec 3600
  Save-Json (Join-Path $out 'vision-benchmark-v112.json') $bench
  Write-Host ("VISION_BENCHMARK accuracy={0}% matched={1}/{2} unparsed={3}" -f $bench.accuracyPct,$bench.matched,$bench.cases,$bench.unparsed)
}

Write-Host 'JEV_DETAIL_PROBE basliyor...'
$probe=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/leader/detail-probe' -Headers $headers -TimeoutSec 1800
Save-Json (Join-Path $out 'jev-detail-probe.json') $probe
if (-not $probe.candidateFound) {
  throw "JEV detail-probe aday bulamadi. Dosyalar kaydedildi: $out"
}
$symbol=[string]$probe.candidate.symbol
if (-not $symbol) { $symbol=[string]$probe.symbol }
$symbol=$symbol.Trim().ToUpperInvariant()
if (-not $symbol) { throw 'Detail-probe sembol dondurmedi.' }
Write-Host "AUDIT_SYMBOL $symbol"

$ctx=Invoke-RestMethod -Uri ("http://127.0.0.1:8787/context/jev-evidence?symbol="+$symbol) -Headers $headers -TimeoutSec 60
Save-Json (Join-Path $out 'full-deterministic-context.json') $ctx

$tfs=@('1m','3m','5m','15m','30m','45m','1h','4h','1d')
$coverage=@()
foreach($tf in $tfs){
  $safe=$tf.Replace('m','M').Replace('h','H').Replace('d','D')
  $data=Invoke-RestMethod -Uri ("http://127.0.0.1:8787/chart/data?symbol=$symbol&tf=$tf&bars=128") -Headers $headers -TimeoutSec 60
  Save-Json (Join-Path $out ("chart-"+$safe+".json")) $data
  Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:8787/chart/png?symbol=$symbol&tf=$tf&mode=annotated&bars=128") -Headers $headers -OutFile (Join-Path $out ("chart-"+$safe+".png")) -TimeoutSec 60

  $a=$data.analysis
  $fvg=Count-Array $a.recentFairValueGaps
  $bullOb=Count-Array $a.orderBlocks.bullish
  $bearOb=Count-Array $a.orderBlocks.bearish
  $hasFib=($null -ne $a.smcContext.fibLevels)
  $hasOte=($null -ne $a.smcContext.oteReference)
  $hasSweep=($null -ne $a.liquidity.lastSweep)
  $coverage += [pscustomobject]@{
    tf=$tf; bars=$data.bars; closedBars=$data.closedBars; formingBars=$data.formingBars
    fvgCount=$fvg; bullishObCount=$bullOb; bearishObCount=$bearOb
    fib=$hasFib; ote=$hasOte; sweep=$hasSweep
    prior20High=$a.prior20High; prior20Low=$a.prior20Low
  }
}
Save-Json (Join-Path $out 'feature-coverage.json') $coverage

$visual=$probe.evidence.visual
$jev=$probe.jevDecision
$plan=$probe.plan
$summary=@()
$summary += "JEV VISION AUDIT R2536"
$summary += "time: $(Get-Date -Format o)"
$summary += "symbol: $symbol"
$summary += "LIVE armed: $($live.armed)"
$summary += "Vision requested frames: $(@($visual.requestedFrames) -join ',')"
$summary += "Vision attached/required: $($visual.attached)/$($visual.required)"
$summary += "Vision error: $($visual.error)"
$summary += "JEV pass1 lane/direction: $($probe.jevPass1.laneFocus) / $($probe.jevPass1.directionFocus)"
$summary += "JEV pass1 requested evidence: $(@($probe.jevPass1.requestedEvidence) -join ',')"
$summary += "JEV final action: $($jev.action)"
$summary += "JEV selected plan: $($jev.selectedPlanId)"
$summary += "Plan why: $($plan.why)"
$summary += "Plan risk: $($plan.riskNote)"
$summary += ""
$summary += "IMPORTANT: JEV decisions endpoint does NOT receive PNG pixels directly. The local Vision worker sees PNGs and JEV receives its bounded EVIDENCE_ONLY text plus requested deterministic evidence."
$summary += "Annotated PNG currently draws candles, volume, EMA20/EMA50, prior20 high/low, equal high/low and FVG overlays. OB/Fib/OTE/liquidation zones are not all drawn as overlays."
$summary += ""
$summary += "VISION TEXT:"
$summary += [string]$visual.text
$summary | Set-Content -LiteralPath (Join-Path $out 'AUDIT-SUMMARY.txt') -Encoding UTF8

$zip=$out+'.zip'
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force
Write-Host "JEV_VISION_AUDIT_OK symbol=$symbol"
Write-Host "AUDIT_ZIP $zip"
Write-Host 'Bu ZIP ayni anlik grafikler + deterministik veriler + Vision metni + JEV sonucunu birlikte icerir.'
