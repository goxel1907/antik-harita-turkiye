# JEV-Brain DEPLOY R2544.34 - lossless market rows and real request budget; includes R31/R32/R33.
# Kaynak: bu teslim paketindeki .\source. Hedef: C:\JEV-Brain\runtime.
# R2544.29 guvenlik ilkesi: LIVE KAPALI + ACIK POZISYON 0 olmadan deploy YAPMAZ; restart sonrasi LIVE kapali kalir.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$SRC = Join-Path $PSScriptRoot 'source'
$EXPECTED_FILE = Join-Path $PSScriptRoot 'BEKLENEN-SURUM.txt'
$EXPECTED_RELEASE = 'R2544.34-JEV-CONTEXT-WIRE-BUDGET'
$EXPECTED_OFFICE = '2.5.14-R2544.34-JEV-Brain'
$deployLogDir = Join-Path $PSScriptRoot 'logs'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path $deployLogDir | Out-Null
Start-Transcript -Path (Join-Path $deployLogDir "deploy-$ts.log") | Out-Null
try {
  Assert-Admin
  if (-not (Test-Path -LiteralPath (Join-Path $J 'GECIS-TAMAMLANDI.txt'))) { throw 'Once JEV-BRAIN-GECIS.cmd calismali.' }
  $exp = (Get-Content -LiteralPath $EXPECTED_FILE -Raw).Trim()
  $h = Invoke-Git $SRC rev-parse HEAD; $s = Invoke-Git $SRC status --short
  Write-Host "SOURCE HEAD=$h status=[$s]"
  if ($h -ne $exp) { throw "Kaynak beklenen surumde degil: $h (beklenen $exp)" }
  if ($s) { throw 'Kaynak temiz degil; deploy durduruldu.' }
  try { $liveState = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers (Core-Headers $RT) -TimeoutSec 8 }
  catch { throw "BrainHub LIVE durumu okunamadi; guvenlik icin deploy durduruldu: $($_.Exception.Message)" }
  if ($liveState.armed -eq $true) { throw 'LIVE ACIK. Once LIVE kapatin, sonra deploy edin.' }
  $pos = Open-Positions $RT
  if ($null -eq $pos) { throw 'Acik pozisyon durumu okunamadi; guvenlik icin deploy durduruldu.' }
  if ($pos.Count -gt 0) { throw "ACIK POZISYON VAR: $($pos -join ', '). Tum pozisyonlar kapandiktan sonra tekrar calistirin." }
  Write-Host 'PRECHECK_OK LIVE_KAPALI ACIK_POZISYON_0'
  try {
    $preHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers (Core-Headers $RT) -TimeoutSec 8
    $br = $preHealth.binanceRateLimit
    if ($null -ne $br -and ([int]$br.lastStatus -eq 418 -or [string]$br.cooldownReason -eq 'BINANCE_HTTP_418_IP_BAN')) {
      $nowMs = [int64](([datetime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds)
      $untilMs = $nowMs + 600000
      if ($null -ne $br.cooldownUntil -and [int64]$br.cooldownUntil -gt $untilMs) { $untilMs = [int64]$br.cooldownUntil }
      $stateDir = Join-Path $RT 'data'; New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
      $statePath = Join-Path $stateDir 'binance-rate-limit-state.json'
      $persist = [ordered]@{
        version=1;savedAt=$nowMs;cooldownUntil=$untilMs;cooldownReason='BINANCE_HTTP_418_IP_BAN';lastStatus=418;
        last429At=if($br.last429At){[int64]$br.last429At}else{0};last418At=if($br.last418At){[int64]$br.last418At}else{$nowMs};
        quarantined=$true;quarantineSince=if($br.last418At){[int64]$br.last418At}else{$nowMs};quarantineReason='BINANCE_HTTP_418_IP_BAN';
        lastRequestAt=if($br.lastRequestAt){[int64]$br.lastRequestAt}else{0};lastRequestPath=[string]$br.lastRequestPath;lastRequestKind=[string]$br.lastRequestKind
      }
      ($persist | ConvertTo-Json -Compress) | Set-Content -LiteralPath $statePath -Encoding UTF8
      Write-Host "BINANCE_418_STATE_PRESERVED quarantine=True cooldownUntil=$untilMs"
    }
  } catch { Write-Host "WARNING: Binance rate-limit state preserve okunamadi: $($_.Exception.Message)" }
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
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers (Core-Headers $RT) -TimeoutSec 10
  if ($health.runtimeRelease -ne $EXPECTED_RELEASE) { throw "Core surum dogrulamasi basarisiz: $($health.runtimeRelease) (beklenen $EXPECTED_RELEASE)" }
  if ($health.live.armed -eq $true) { throw 'Restart sonrasi LIVE beklenmedik sekilde ACIK; kontrol gerekli.' }
  foreach ($f in 'R2544_20_PREENTRY_ADVERSE_SELECTION','R2544_21_SPARSE_FLOW_CONFIDENCE','R2544_21_WINDOW_SAMPLE_WEIGHTING','R2544_21_SHORT_WINDOW_CONFIDENCE','R2544_22_HARD_CONTEXT_BUDGET','R2544_22_PASS_SPECIFIC_BUDGET','R2544_22_CORE_MARKET_PROTECTED','R2544_22_PASS1_PASS2_HANDOFF','R2544_23_PASS1_QUESTION_COMPACTION','R2544_23_PASS1_ROUTING_MEMORY_TIGHT','R2544_24_PASS2_QUESTION_COMPACTION','R2544_24_PASS2_RECORD_COMPACTION','R2544_24_PASS2_MEMORY_TIGHT','R2544_25_PASS2_DYNAMIC_RESIDUAL_BUDGET','R2544_25_PASS2_RESIDUAL_QUESTION_TIGHT','R2544_25_PASS2_RESIDUAL_RECORD_TIGHT','R2544_25_PASS2_RESIDUAL_MEMORY_TIGHT','R2544_26_ACTIVE_SYMBOL_LOCAL_L2','R2544_26_SHADOW_MODELED_LIQUIDATION','R2544_26_BEHAVIOR_MEMORY_HARDENING','R2544_26_OSS_PROVENANCE_HARDENING','R2544_26_AUDIT_PROVENANCE_HASHES','R2544_27_BINANCE_RATE_LIMIT_GUARD','R2544_27_BINANCE_429_418_COOLDOWN','R2544_27_BINANCE_WS_PATH_HARDENING','R2544_27_BINANCE_418_MANUAL_RECOVERY_QUARANTINE','R2544_27_BINANCE_RECOVERY_WARMUP','R2544_27_BINANCE_SCANNER_BURST_SMOOTHING','R2544_27_BINANCE_REMOTE_WEIGHT_HEADER_TRUTH','R2544_27_BINANCE_REQUESTS_1M_TELEMETRY','R2544_27E_SCANNER_CANDLE_BOUNDARY_CACHE','R2544_27E_PREMOVE_REUSE','R2544_27E_STREAM_PRIMARY_REST_FALLBACK','R2544_27E_BINANCE_ROUTE_TELEMETRY','R2544_27F_BINANCE_WS_SPLIT_ENDPOINTS','R2544_27F_L2_SNAPSHOT_DISCIPLINE','R2544_27F_L2_CHURN_LEASE','R2544_28_JEV_SEMANTIC_CONSISTENCY','R2544_28_JEV_MANAGEMENT_EXECUTION','R2544_28_LOCAL_L2_CONFIDENCE_MERGE','R2544_28_ADVERSE_REDUCE_RISK','R2544_28_URGENT_POSITION_REVIEW','R2544_28_CAPTURE_TIMING_LEARNING','R2544_29_BURST_SCALP','R2544_29_JEV_BURST_PREAUTH','R2544_29_1S_3S_WS_IGNITION','R2544_29_LONG_SHORT_BURST_SYMMETRY','R2544_29_SEPARATE_BURST_SLOT','R2544_29_SYNTHETIC_ADDON','R2544_29_ONE_PAUSE_EXCEPTION','R2544_29_BURST_LEARNING','R2544_31_JEV_OFFICE_LEVEL_PARITY','R2544_31_BURST_CHART_CONTEXT','R2544_31_DYNAMIC_FREE_CATALOG','R2544_31_FREE_QUOTA_GUARD','R2544_31_VALIDATED_EVIDENCE','R2544_32_CAUSAL_FAKE_BREAK_EVIDENCE','R2544_32_CLOSED_BODY_TREND_VALIDATION','R2544_32_PROTECTED_9TF_TREND_TRACE','R2544_33_AUTHORITATIVE_FREE_CATALOG','R2544_33_SHARED_WORKER_CHART_EVIDENCE','R2544_33_TASK_SPECIFIC_EVIDENCE_WORKERS','R2544_34_LOSSLESS_MARKET_ROWS','R2544_34_REQUEST_COMPONENT_BUDGET') {
    if (-not ($health.features -contains $f)) { throw "Core feature dogrulamasi basarisiz: $f eksik" }
  }
  Write-Host "CORE_VERSION_OK $($health.runtimeRelease) LIVE_ARMED=$($health.live.armed)"
  Write-Host '== OFFICE YENIDEN BASLAT'
  Stop-Office $RT
  Start-Sleep -Seconds 2
  Start-Office $RT $BK
  $officeHeaders=@{}
  $officeKeyFile=Join-Path "$RT\office-dashboard" 'office-key.txt'
  if (Test-Path -LiteralPath $officeKeyFile) { $officeKey=(Get-Content -LiteralPath $officeKeyFile -Raw).Trim(); if ($officeKey) { $officeHeaders=@{'x-office-key'=$officeKey} } }
  $officeOk=$false
  for ($i=0; $i -lt 20; $i++) {
    try { $op=Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/ping' -Headers $officeHeaders -TimeoutSec 3; if ($op.officeVersion -eq $EXPECTED_OFFICE) { $officeOk=$true; break } } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (-not $officeOk) { throw "Office surum dogrulamasi basarisiz; beklenen $EXPECTED_OFFICE" }
  Write-Host "OFFICE_VERSION_OK $EXPECTED_OFFICE"
  foreach ($f in 'server.js','live-controller.js','burst-scalp.js','position-guard.js','engine.js','pipeline.js','market.js','binance-rate-limit.js','local-l2.js','market-maker-evidence.js','preentry-microstructure.js','jev-market-packet.js','jev-wire-market.js','jev-decision.js','case-memory.js','trade-lessons.js','chart-narrator.js','free-model-registry.js','openrouter-free-worker.js','plan-workers.js','worker-expertise.js') {
    Write-Host ("HASH $f " + (Get-FileHash (Join-Path "$RT\server" $f)).Hash)
  }
  Write-Host "JEV_DEPLOY_OK $h — $EXPECTED_RELEASE — LIVE restart ile KAPALI kalir; kullanici isterse sonradan uygulamadan acar."
  Write-Host 'HEADROOM: mevcut 9Router Headroom URL=http://127.0.0.1:8788; R2544.29 bunu degistirmez.'
} catch { Write-Host "JEV_DEPLOY_FAILED: $($_.Exception.Message)"; throw }
finally { Stop-Transcript | Out-Null }
