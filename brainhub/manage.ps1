param(
    [ValidateSet('Install','Update','Start','Test','Backup','Restore','Pair','Unpair','VisionLocalSetup','VisionFreeSetup','VisionStatus','VisionBenchmark','OpenRouterSetup','OpenRouterCreditSetup','OpenRouterStatus','JevProbe','LiveSetup','LiveStatus','LiveReadiness','LiveArm','LiveDisarm')][string]$Action = 'Update',
    [string]$Root = 'C:\BrainHub',
    [string]$Source = '',
    [string]$BackupPath = '',
    [switch]$Deep
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-Node {
    $candidates = @((Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue), 'C:\Users\adm\AppData\Local\OpenClaw\deps\portable-node\node.exe')
    foreach ($n in $candidates) {
        if ($n -and (Test-Path -LiteralPath $n)) {
            $v = & $n -p 'parseInt(process.versions.node,10)'
            if ([int]$v -ge 22) { return $n }
        }
    }
    throw 'Node.js 22+ gerekli; node:sqlite icin kurulum yapilmadi.'
}
function Read-Dpapi([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $secure = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Save-Dpapi([string]$Path, [string]$Value) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    $secure = ConvertTo-SecureString -String $Value -AsPlainText -Force
    $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $Path -Encoding ASCII
}
function Secure-ToPlain([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Prompt-IntRange([string]$Label, [int]$Min, [int]$Max) {
    $raw = (Read-Host $Label).Trim()
    $value = 0
    if (-not [int]::TryParse($raw, [ref]$value) -or $value -lt $Min -or $value -gt $Max) { throw "$Label gecersiz ($Min-$Max)." }
    return $value
}
function Prompt-PositiveDouble([string]$Label, [double]$MinExclusive, [double]$MaxInclusive) {
    $raw = (Read-Host $Label).Trim().Replace(',','.')
    $value = 0.0
    if (-not [double]::TryParse($raw, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -or $value -le $MinExclusive -or $value -gt $MaxInclusive) { throw "$Label gecersiz (> $MinExclusive ve <= $MaxInclusive)." }
    return $value
}
function Client-Token([string]$BrainRoot) {
    $flag = Join-Path $BrainRoot 'config\remote-enabled'
    if (-not (Test-Path -LiteralPath $flag)) { return '' }
    return Read-Dpapi (Join-Path $BrainRoot 'config\client-token.dpapi')
}
function Auth-Headers([string]$BrainRoot) {
    $token = Client-Token $BrainRoot
    if ($token) { return @{ Authorization = "Bearer $token" } }
    return @{}
}
function Get-PropValue($InputObject, [string]$Name, $Default = $null) {
    if ($null -eq $InputObject) { return $Default }
    $prop = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $Default }
    return $prop.Value
}
function Router-Key([string]$BrainRoot) {
    $secret = Join-Path $BrainRoot 'config\router-key.dpapi'
    $key = Read-Dpapi $secret
    if ($key) { return $key }
    $fromDatabase = ''
    $routerDb = Join-Path $env:APPDATA '9router\db\data.sqlite'
    if (Test-Path -LiteralPath $routerDb) {
        try {
            $node = Resolve-Node
            $fromDatabase = & $node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});const r=d.prepare("SELECT key FROM apiKeys WHERE name=? AND isActive=1 LIMIT 1").get("BrainHub-PC");if(r)process.stdout.write(r.key);d.close()' $routerDb 2>$null
        } catch { }
    }
    $fromClipboard = (Get-Clipboard -Raw -ErrorAction SilentlyContinue | Out-String).Trim()
    foreach ($candidate in @($fromDatabase, $fromClipboard)) {
      if ($candidate -match '^[A-Za-z0-9_\-]{16,200}$') {
        try {
            $headers = @{ Authorization = "Bearer $candidate" }
            $r = Invoke-RestMethod -Uri 'http://127.0.0.1:20128/v1/models' -Headers $headers -TimeoutSec 8
            if ($r.data) {
                Save-Dpapi $secret $candidate
                Write-Host '9Router anahtari Windows kullanici sifrelemesiyle saklandi.'
                return $candidate
            }
        } catch { }
      }
    }
    throw '9Router anahtari bulunamadi. Anahtari panoya bir kez kopyalayip ayni komutu tekrar calistirin; calisan BrainHub durdurulmadi.'
}
function Brain-Pid([string]$BrainRoot) {
    $expected = Join-Path $BrainRoot 'server\server.js'
    $brainProcesses = @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($expected) })
    if ($brainProcesses.Count -gt 1) { throw 'Birden fazla BrainHub server.js process bulundu; dokunulmadi.' }
    if ($brainProcesses.Count -eq 0) { return $null }
    return [int]$brainProcesses[0].ProcessId
}
function Stop-Brain([string]$BrainRoot) {
    $id = Brain-Pid $BrainRoot
    if ($id) {
        Stop-Process -Id $id -Force
        for ($i=0; $i -lt 30; $i++) {
            if (-not (Brain-Pid $BrainRoot)) { return }
            Start-Sleep -Milliseconds 300
        }
        throw 'BrainHub 8787 portunu birakmadi.'
    }
}
function Startup-Detail([string]$OutLog, [string]$ErrLog) {
    $parts = @()
    if (Test-Path -LiteralPath $ErrLog) {
        $tail = (Get-Content -LiteralPath $ErrLog -Tail 20 -ErrorAction SilentlyContinue | Out-String).Trim()
        if ($tail) { $parts += "stderr=$tail" }
    }
    if (Test-Path -LiteralPath $OutLog) {
        $tail = (Get-Content -LiteralPath $OutLog -Tail 20 -ErrorAction SilentlyContinue | Out-String).Trim()
        if ($tail) { $parts += "stdout=$tail" }
    }
    return ($parts -join ' | ')
}
function Start-Brain([string]$BrainRoot, [string]$Node, [string]$Key, [switch]$AcceptLegacy) {
    if (Brain-Pid $BrainRoot) { Write-Host 'BrainHub zaten calisiyor.'; return }
    $logDir = Join-Path $BrainRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $outLog = Join-Path $logDir 'brain-startup.out.log'
    $errLog = Join-Path $logDir 'brain-startup.err.log'
    Remove-Item -LiteralPath $outLog,$errLog -Force -ErrorAction SilentlyContinue
    $env:BRAINHUB_ROUTER_KEY = $Key
    $env:BRAINHUB_ROOT = $BrainRoot
    $token = Client-Token $BrainRoot
    if ($token) { $env:BRAINHUB_CLIENT_TOKEN = $token }
    $openRouterApiKey = Read-Dpapi (Join-Path $BrainRoot 'config\openrouter-api-key.dpapi')
    if ($openRouterApiKey) { $env:BRAINHUB_OPENROUTER_API_KEY = $openRouterApiKey }
    $openRouterManagementKey = Read-Dpapi (Join-Path $BrainRoot 'config\openrouter-management-key.dpapi')
    if ($openRouterManagementKey) { $env:BRAINHUB_OPENROUTER_MANAGEMENT_KEY = $openRouterManagementKey }
    $binanceApiKey = Read-Dpapi (Join-Path $BrainRoot 'config\binance-api-key.dpapi')
    $binanceApiSecret = Read-Dpapi (Join-Path $BrainRoot 'config\binance-api-secret.dpapi')
    if ($binanceApiKey -and $binanceApiSecret) {
        $env:BRAINHUB_BINANCE_API_KEY = $binanceApiKey
        $env:BRAINHUB_BINANCE_API_SECRET = $binanceApiSecret
    }
    $proc = $null
    try {
        $proc = Start-Process -FilePath $Node -ArgumentList @((Join-Path $BrainRoot 'server\server.js')) -WorkingDirectory $BrainRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    } finally {
        Remove-Item Env:BRAINHUB_ROUTER_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_CLIENT_TOKEN -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_OPENROUTER_API_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_OPENROUTER_MANAGEMENT_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_BINANCE_API_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_BINANCE_API_SECRET -ErrorAction SilentlyContinue
        $openRouterApiKey = ''
        $openRouterManagementKey = ''
        $binanceApiKey = ''
        $binanceApiSecret = ''
    }
    $lastHealth = ''
    for ($i=0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if ($proc -and $proc.HasExited) {
            $detail = Startup-Detail $outLog $errLog
            throw "BrainHub process erken kapandi exit=$($proc.ExitCode). $detail"
        }
        try {
            $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers (Auth-Headers $BrainRoot) -TimeoutSec 2
            if ($h.ok -and ($AcceptLegacy -or $h.version -eq 'brainhub-pro-1')) { return }
            $lastHealth = "ok=$($h.ok) version=$($h.version)"
        } catch {
            $lastHealth = $_.Exception.Message
        }
    }
    $detail = Startup-Detail $outLog $errLog
    throw "BrainHub health timeout pid=$($proc.Id) lastHealth=$lastHealth. $detail"
}
function Test-Brain([string]$BrainRoot, [switch]$IncludeDeep) {
    $headers = Auth-Headers $BrainRoot
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers $headers -TimeoutSec 5
    if (-not $h.ok -or $h.version -ne 'brainhub-pro-1') { throw 'Yeni BrainHub health testi gecmedi.' }
    if ([string]$h.featureVersion -ne '9.5.112-CLAUDE-VISION') { throw "Beklenen PC Brain Hub surumu 9.5.112-CLAUDE-VISION; gelen=$($h.featureVersion)" }
    # CLAUDE_V112_UPDATER_FILESET: Claude v9.5.112 isaretleri dogrulanir.
    foreach ($v112Feature in @('CLAUDE_V112_BUILD','CLAUDE_V112_SCALP_FAST_LANE','CLAUDE_V112_CONCURRENT_REVALIDATION','CLAUDE_V112_EXECUTION_LOCK_ONLY_AT_ORDER','CLAUDE_V112_RUNNER_TWO_THIRDS','CLAUDE_V112_BINANCE_V3_POSITION_FIX','CLAUDE_V112_UPDATER_FILESET')) {
        if (-not ($h.features -contains $v112Feature)) { throw "v9.5.112-CLAUDE eksik feature: $v112Feature" }
    }
    Write-Host ("CLAUDE_V112 marker={0} fastLane={1} runnerShare={2}" -f (Get-PropValue $h 'claudeV112Marker' ''),(Get-PropValue (Get-PropValue $h 'claudeV111Config' $null) 'scalpFastLane' ''),(Get-PropValue (Get-PropValue $h 'claudeV111Config' $null) 'runnerShare' ''))
    # CLAUDE_V111_UPDATER_FILESET: Claude v9.5.111 (ChatGPT v9.5.110 uzerine) isaretleri dogrulanir.
    foreach ($v111Feature in @('CLAUDE_V111_BUILD','CLAUDE_V111_MOMENTUM_SCALP_TRIGGER','CLAUDE_V111_TRIGGER_REVALIDATION','CLAUDE_V111_JEV_FINAL_AUTHORITY','CLAUDE_V111_TRAILING_RUNNER','CLAUDE_V111_RUNNER_NEVER_WIDEN','CLAUDE_V111_UPDATER_FILESET')) {
        if (-not ($h.features -contains $v111Feature)) { throw "v9.5.111-CLAUDE eksik feature: $v111Feature" }
    }
    Write-Host ("CLAUDE_V111 marker={0} runnerMode={1} revalidation={2} v110={3}" -f (Get-PropValue $h 'claudeV111Marker' ''),(Get-PropValue (Get-PropValue $h 'claudeV111Config' $null) 'runnerMode' ''),(Get-PropValue (Get-PropValue $h 'claudeV111Config' $null) 'triggerRevalidation' ''),(Get-PropValue $h 'v110FeatureVersion' ''))
    # CLAUDE_V109_UPDATER_FILESET: Claude v9.5.109 isaretleri ve yeni moduller dogrulanir.
    if (-not ($h.features -contains 'CLAUDE_V109_BUILD') -or -not ($h.features -contains 'CLAUDE_V109_UPDATER_FILESET') -or -not ($h.features -contains 'CLAUDE_V109_TRIGGER_AUTOSELECT') -or -not ($h.features -contains 'CLAUDE_V109_TRIGGER_CHASE_GATE')) { throw 'v9.5.109-CLAUDE isaretleri /health icinde yok.' }
    Write-Host ("CLAUDE_V109 marker={0} dtMode={1} jevPolicy={2}" -f (Get-PropValue $h 'claudeMarker' ''),(Get-PropValue (Get-PropValue $h 'claudeV109Config' $null) 'deterministicTriggerMode' ''),(Get-PropValue (Get-PropValue $h 'claudeV109Config' $null) 'jevVetoPolicy' ''))
    foreach ($v110Feature in @('V110_MULTILANE_15M_SCALP','V110_SCALP_TWO_OF_THREE','V110_MOMENTUM_LADDER','V110_NUMERIC_TRIGGER_H8','V110_JEV_SHADOW_VISIBLE','V110_VISION_15M_PRIORITY_PROFILE','V110_OFFICE_LANE_UI')) {
        if (-not ($h.features -contains $v110Feature)) { throw "v9.5.110 eksik feature: $v110Feature" }
    }
    $lanePolicy = Get-PropValue $h 'tradeLanePolicy' $null
    if ($null -eq $lanePolicy -or [string](Get-PropValue $lanePolicy 'mainTradeTimeframe' '') -ne '15m' -or [int](Get-PropValue $lanePolicy 'scalpMinimumAligned' 0) -ne 2) {
        throw 'v9.5.110 15m ana / 2-of-3 scalp politika telemetrisi dogrulanamadi.'
    }
    Write-Host ("V110_POLICY main={0} scalpAligned={1} marker={2}" -f (Get-PropValue $lanePolicy 'mainTradeTimeframe' ''),(Get-PropValue $lanePolicy 'scalpMinimumAligned' 0),(Get-PropValue $h 'v110Marker' ''))
    if (-not $h.featureVersion -or -not ($h.features -contains 'UNIFIED_9TF') -or -not ($h.features -contains 'CHART_PNG_CLEAN') -or -not ($h.features -contains 'VISION_CAPABILITY_FALLBACK') -or -not ($h.features -contains 'VISION_PROBE') -or -not ($h.features -contains 'VISION_PIXEL_PROBE') -or -not ($h.features -contains 'KIRO_FREE_QUOTA_VISION_OPT_IN') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_FALLBACK') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_16K') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_32K') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_ONLY') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_TWO_STAGE') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_BATCH3') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_SINGLE_TF') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_COMPACT_FINALIZE') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_TF_CONTRACT') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_SPLIT_GLOBAL') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_PROGRESS') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_SEMANTIC_CONTRACT') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_TEXT_REPAIR') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_SLIM_TF_CONTEXT') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_SINGLE_FLIGHT') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_COMPACT_GLOBAL_CONTEXT') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_NARRATIVE_REPAIR') -or -not ($h.features -contains 'VISION_SEMANTIC_DOWNGRADE') -or -not ($h.features -contains 'LOCAL_VISION_NO_DUPLICATE_IMAGE_REPAIR') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_DIRECT_PIPELINE') -or -not ($h.features -contains 'OPENROUTER_DPAPI_SECRET') -or -not ($h.features -contains 'OPENROUTER_JEV_DECISIONS_PROBE') -or -not ($h.features -contains 'OPENROUTER_JEV_ADVISORY_VETO_GATE') -or -not ($h.features -contains 'OPENROUTER_JEV_DAILY_BUDGET') -or -not ($h.features -contains 'OPENROUTER_JEV_SOFT_HARD_BUDGET') -or -not ($h.features -contains 'OPENROUTER_ACCOUNT_CREDIT_TELEMETRY') -or -not ($h.features -contains 'ACTIVE_POSITION_9TF_REVIEW') -or -not ($h.features -contains 'JEV_POSITION_EXIT_JUDGE') -or -not ($h.features -contains 'BRAIN_LEARNING_SOFT_CONTEXT') -or -not ($h.features -contains 'ANDROID_TURKISH_DECISION_TEXT') -or -not ($h.features -contains 'BACKGROUND_VISION_COLLISION_GUARD') -or -not ($h.features -contains 'VISION_WATCH_NONE_ANTI_CHOKE') -or -not ($h.features -contains 'USER_PANEL_EXACT_SIZING') -or -not ($h.features -contains 'VISION_RUNTIME_TRUTH_STATUS') -or -not ($h.features -contains 'LEADER_STATUS_STALE_SUPPRESSION') -or -not ($h.features -contains 'LEADER_AUTO_HEALTH_TELEMETRY') -or -not ($h.features -contains 'LEADER_AUTO_COVERAGE_SCHEDULER') -or -not ($h.features -contains 'USER_PANEL_EXACT_TOTAL_EXPOSURE') -or -not ($h.features -contains 'LEADER_APPROVED_ANALYSIS_REUSE') -or -not ($h.features -contains 'PREJEV_EXECUTION_TELEMETRY') -or -not ($h.features -contains 'BRAIN_LEARNING_OUTCOME_CONTEXT_ACTIVE') -or -not ($h.features -contains 'TARGETED_PRIORITY_UNIVERSE_24') -or -not ($h.features -contains 'BINANCE_TOP24_GAINER_DISCOVERY') -or -not ($h.features -contains 'ACCUMULATION_PROXY_DISCOVERY') -or -not ($h.features -contains 'ANDROID_ATTENTION_SYNC') -or -not ($h.features -contains 'PLAN_WORKER_ORCHESTRATION') -or -not ($h.features -contains 'PLAN_WORKER_9ROUTER_TEXT') -or -not ($h.features -contains 'PLAN_WORKER_9ROUTER_FREE_ONLY') -or -not ($h.features -contains 'OPENROUTER_FREE_WORKER_SECOND_OPINION') -or -not ($h.features -contains 'WORKER_VISION_AVOIDANCE_TELEMETRY') -or -not ($h.features -contains 'PLAN_WORKER_PARALLEL_TIMER') -or -not ($h.features -contains 'V108_WORKER_ESCALATION_LATCH') -or -not ($h.features -contains 'V108_CONCRETE_WATCH_CONTRACT') -or -not ($h.features -contains 'LOCAL_VISION_FREE_QUOTA_FAILOVER') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_BATCH3_ACTIVE') -or -not ($h.features -contains 'LOCAL_OLLAMA_VISION_SINGLE_TF_FALLBACK') -or -not ($h.features -contains 'ANDROID_FULL_TURKISH_STATUS') -or -not ($h.features -contains 'VISION_CHART_896X504') -or -not ($h.features -contains 'VISION_CHART_640X360') -or -not ($h.features -contains 'VISION_CHART_448X252') -or -not ($h.features -contains 'KKK_DETAILED_9TF_DIAGNOSTICS') -or -not ($h.features -contains 'LEADER_DETAIL_PROBE') -or -not ($h.features -contains 'LIVE_FAIL_CLOSED')) { throw 'v9.5.109-CLAUDE BrainHub flow-recovery + worker + 9TF Vision feature set eksik.' }
    $live = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 5
    if (-not $live.ok -or $live.armed) { throw 'LIVE fail-closed baslangic testi gecmedi.' }
    $routes = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/models/routes' -Headers $headers -TimeoutSec 8
    if (-not $routes.ok -or -not $routes.freeFirst -or -not $routes.kiroJudgeOnly -or $null -eq $routes.localVisionEnabled -or $null -eq $routes.visionKiroFallback -or $null -eq $routes.visionKiroFreeQuota) { throw '9Router rol/Vision yonlendirme testi gecmedi.' }
    if ($routes.localVisionEnabled -and ([int]$routes.localVisionBatchSize -ne 3 -or [bool]$routes.localVisionSingleTf -or -not [bool]$routes.localVisionSingleTfFallback)) {
        throw 'v9.5.108 yerel Vision batch-3 + tek-TF fallback rotasi etkin degil.'
    }
    Write-Host "VISION_POLICY local=$($routes.localVisionEnabled) kiroFreeQuota=$($routes.visionKiroFreeQuota) paidFallback=$($routes.paidVisionFallbackEnabled)"
    Write-Host "VISION_FLOW batch=$($routes.localVisionBatchSize) singleTfFallback=$($routes.localVisionSingleTfFallback) localFailover=KIRO_FREE_QUOTA_ONLY"
    $visionProfile = Get-PropValue $routes 'visionProfile' $null
    $vpScalp = Get-PropValue $visionProfile 'scalp' $null
    $vpMain = Get-PropValue $visionProfile 'main15m' $null
    $vpContext = Get-PropValue $visionProfile 'context' $null
    if ($null -eq $visionProfile -or [int](Get-PropValue $vpScalp 'width' 0) -lt 640 -or [int](Get-PropValue $vpMain 'width' 0) -lt 896 -or [int](Get-PropValue $vpContext 'width' 0) -lt 640) {
        throw 'v9.5.110 Vision coznurluk profili dogrulanamadi.'
    }
    Write-Host ("VISION_PROFILE scalp={0}x{1} main15m={2}x{3} context={4}x{5}" -f (Get-PropValue $vpScalp 'width' 0),(Get-PropValue $vpScalp 'height' 0),(Get-PropValue $vpMain 'width' 0),(Get-PropValue $vpMain 'height' 0),(Get-PropValue $vpContext 'width' 0),(Get-PropValue $vpContext 'height' 0))
    if ($null -eq $routes.roles.SCALP -or @($routes.roles.SCALP).Count -lt 1) { throw '9Router SCALP rol rotasi eksik.' }
    if ((@($routes.roles.SCALP) -join '|') -ne (@($routes.roles.FAST) -join '|')) { throw 'SCALP rotasi FAST ile ayni hizli model havuzunu kullanmiyor.' }
    if ([string](Get-PropValue $routes 'planWorkerRouter' '') -ne '9ROUTER_FREE_TEXT') { throw 'v9.5.108 plan worker 9Router text rotasi eksik.' }
    $freeWorkerRoute = Get-PropValue $routes 'openRouterFreeWorker' $null
    if ($null -eq $freeWorkerRoute -or -not [bool](Get-PropValue $freeWorkerRoute 'freeOnly' $false) -or [string](Get-PropValue $freeWorkerRoute 'model' '') -ne 'openrouter/free') {
        throw 'v9.5.108 OpenRouter free-only worker rotasi dogrulanamadi.'
    }
    $leaderAutoStatus = Get-PropValue $live 'leaderAuto' $null
    $planWorkerStatus = Get-PropValue $leaderAutoStatus 'planWorkers' $null
    if ($null -eq $planWorkerStatus -or -not [bool](Get-PropValue $planWorkerStatus 'enabled' $false) -or -not [bool](Get-PropValue $planWorkerStatus 'parallelWithVision' $false) -or [string](Get-PropValue $planWorkerStatus 'routineRouter' '') -ne '9ROUTER_FREE_TEXT') {
        throw 'v9.5.108 plan worker runtime durumu etkin degil.'
    }
    Write-Host ("WORKER_POLICY routine={0} openRouterModel={1} freeOnly={2} configured={3}" -f (Get-PropValue $planWorkerStatus 'routineRouter' ''),(Get-PropValue $freeWorkerRoute 'model' ''),(Get-PropValue $freeWorkerRoute 'freeOnly' $false),(Get-PropValue $freeWorkerRoute 'configured' $false))
    $scan = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/scanner' -Headers $headers -TimeoutSec 90
    if (-not $scan.ok -or $scan.activeUsdtPerpetuals -lt 1) { throw 'Scanner testi gecmedi.' }
    if ($null -eq $scan.longExpansion -or $null -eq $scan.shortExpansion -or $null -eq $scan.earlyExpansion) { throw 'Cift yonlu expansion radar alanlari eksik.' }
    $symbol = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/context/symbol?symbol=BTCUSDT' -Headers $headers -TimeoutSec 60
    if (-not $symbol.ok -or -not $symbol.timeframes.'15m'.available -or -not $symbol.timeframes.'45m'.available) { throw '9TF sembol baglami testi gecmedi.' }
    $unified = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/context/unified?symbol=BTCUSDT' -Headers $headers -TimeoutSec 90
    if (-not $unified.ok -or -not $unified.dataQuality.advisoryUsable -or -not $unified.policy.unifiedEngineDoesNotWaitFor15m) { throw 'Unified Brain Context testi gecmedi.' }
    $chart = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/chart/data?symbol=BTCUSDT&tf=45m&bars=64' -Headers $headers -TimeoutSec 60
    if (-not $chart.ok -or -not $chart.synthetic -or $chart.bars -lt 52) { throw '45m causal chart data testi gecmedi.' }
    $pngPath = Join-Path $env:TEMP ("brainhub-chart-" + [guid]::NewGuid().ToString('N') + '.png')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/chart/png?symbol=BTCUSDT&tf=15m&mode=annotated&bars=64' -Headers $headers -TimeoutSec 60 -OutFile $pngPath | Out-Null
        $bytes = [IO.File]::ReadAllBytes($pngPath)
        if ($bytes.Length -lt 1000 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71) { throw 'PNG imza veya boyut testi gecmedi.' }
    } finally { Remove-Item -LiteralPath $pngPath -Force -ErrorAction SilentlyContinue }
    $global = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/context/global' -Headers $headers -TimeoutSec 90
    if (-not $global.ok -or -not $global.btc.available -or -not $global.eth.available) { throw 'BTC/ETH global baglam testi gecmedi.' }
    $learn = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/learning' -Headers $headers -TimeoutSec 5
    if (-not $learn.ok) { throw 'SQLite learning testi gecmedi.' }
    if ($IncludeDeep) {
        if (-not $routes.localVisionEnabled) {
            try {
                $plan = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/leader/plan' -Headers $headers -TimeoutSec 330
            } catch {
                Write-Host '========== LEADER PLAN HATA ==========' -ForegroundColor Red
                if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
                $brainLog = Join-Path $BrainRoot 'logs\brainpub.log'
                if (Test-Path -LiteralPath $brainLog) {
                    Write-Host '========== BRAINHUB LOG SON 80 ==========' -ForegroundColor Yellow
                    Get-Content -LiteralPath $brainLog -Tail 80
                }
                throw
            }
            if (-not $plan.ok -or $plan.execution -ne 'ADVISORY_ONLY' -or $plan.orderPlaced) { throw 'Leader pipeline guvenlik testi gecmedi.' }
            $committeeCalled = $false
            if ($null -ne $plan.PSObject.Properties['committeeCalled']) { $committeeCalled = [bool]$plan.committeeCalled }
            Write-Host "PIPELINE candidate=$($plan.candidateFound) committee=$committeeCalled"
        } else {
            Write-Host 'PIPELINE leaderPlan=SKIPPED_DUPLICATE_LOCAL_VISION detailProbeWillValidate=True'
        }

        # Local Vision is intentionally not executed twice in Deep mode. The targeted
        # analysis-only detail probe below exercises the same pipeline fail-closed and
        # is the authoritative 9TF model contract check.
        $detailJob = $null
        try {
            $jobAuthorization = ''
            if ($headers.ContainsKey('Authorization')) { $jobAuthorization = [string]$headers['Authorization'] }
            $detailJob = Start-Job -ArgumentList $jobAuthorization -ScriptBlock {
                param($authorization)
                $jobHeaders = @{}
                if (-not [string]::IsNullOrWhiteSpace($authorization)) { $jobHeaders['Authorization'] = $authorization }
                Invoke-RestMethod -Uri 'http://127.0.0.1:8787/leader/detail-probe' -Headers $jobHeaders -TimeoutSec 1500
            }
            $lastVisionStage = ''
            while ((Get-Job -Id $detailJob.Id).State -eq 'Running') {
                Start-Sleep -Seconds 2
                try {
                    $progress = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/vision/progress' -Headers $headers -TimeoutSec 3
                    $stage = [string](Get-PropValue $progress "stage" "")
                    if ($stage -and $stage -ne $lastVisionStage) {
                        $elapsed = [int]([double](Get-PropValue $progress "durationMs" 0) / 1000)
                        Write-Host ("VISION_PROGRESS stage={0} elapsedSec={1}" -f $stage,$elapsed) -ForegroundColor Cyan
                        $lastVisionStage = $stage
                    }
                } catch { }
            }
            $job = Get-Job -Id $detailJob.Id
            if ($job.State -ne 'Completed') {
                $jobReason = $job.ChildJobs[0].JobStateInfo.Reason
                throw ("Leader detail probe job failed: " + [string]$jobReason)
            }
            $detailPlanResult = Receive-Job -Id $detailJob.Id -ErrorAction Stop
        } catch {
            Write-Host '========== LEADER DETAIL PROBE HATA ==========' -ForegroundColor Red
            if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
            throw
        } finally {
            if ($null -ne $detailJob) { Remove-Job -Id $detailJob.Id -Force -ErrorAction SilentlyContinue }
        }

        $detailCandidateFound = [bool](Get-PropValue $detailPlanResult "candidateFound" $false)
        $detailCommitteeCalled = [bool](Get-PropValue $detailPlanResult "committeeCalled" $false)
        $detailAnalysisOnly = [bool](Get-PropValue $detailPlanResult "analysisOnly" $false)
        Write-Host "LEADER_DETAIL_PROBE candidate=$detailCandidateFound committee=$detailCommitteeCalled analysisOnly=$detailAnalysisOnly"

        if ($detailCandidateFound) {
            if (-not $detailAnalysisOnly) { throw 'Leader detay probe analysis-only kilidi bozuldu.' }
            if ($detailPlanResult.execution -ne 'ADVISORY_ONLY' -or [bool](Get-PropValue $detailPlanResult "orderPlaced" $false)) { throw 'Leader detay probe guvenlik kilidi bozuldu.' }
            if (-not $detailCommitteeCalled) { throw 'Leader detay probe model/committee cagrisini tamamlamadi.' }

            $detailVision = Get-PropValue $detailPlanResult "vision" $null
            $attached = [int](Get-PropValue $detailVision "attached" 0)
            if ($attached -lt 9) { throw "Leader 9TF grafik paketi 9/9 degil: $attached/9" }

            $leaderPlan = Get-PropValue $detailPlanResult "plan" $null
            if ($null -eq $leaderPlan) { throw 'Leader model plani yok.' }
            $planValid = [bool](Get-PropValue $leaderPlan "valid" $false)
            if (-not $planValid) {
                $reason = [string](Get-PropValue $leaderPlan "reason" "UNKNOWN")
                $missingObj = Get-PropValue $leaderPlan "missingVisionFields" @()
                $missing = @($missingObj) -join ','
                $rawSnippet = [string](Get-PropValue $leaderPlan "rawOutputSnippet" "")
                if (-not [string]::IsNullOrWhiteSpace($rawSnippet)) {
                    Write-Host '========== MODEL HAM CIKTI OZETI ==========' -ForegroundColor Yellow
                    Write-Host $rawSnippet
                }
                if ($reason -eq 'VISION_COMMITTEE_UNAVAILABLE') {
                    $committeeDetail = [string](Get-PropValue $leaderPlan "committeeDetail" "")
                    if (-not [string]::IsNullOrWhiteSpace($committeeDetail)) {
                        Write-Host '========== VISION COMMITTEE HATA DETAYI ==========' -ForegroundColor Yellow
                        Write-Host $committeeDetail
                    }
                    $committeeObj = Get-PropValue $detailPlanResult "committee" $null
                    if ($null -ne $committeeObj) {
                        $attempted = @(Get-PropValue $committeeObj "attemptedModels" @())
                        $failed = @(Get-PropValue $committeeObj "failed" @())
                        if ($attempted.Count -gt 0) { Write-Host ("ATTEMPTED_MODELS " + ($attempted -join ',')) }
                        foreach ($failure in $failed) {
                            $fm = [string](Get-PropValue $failure "model" "?")
                            $fe = [string](Get-PropValue $failure "error" "error")
                            Write-Host ("VISION_MODEL_FAIL {0} :: {1}" -f $fm,$fe) -ForegroundColor Yellow
                        }
                    }
                }
                throw "Leader KKK 9TF model detay sozlesmesi gecmedi. reason=$reason missing=$missing"
            }

            foreach ($name in @("why","riskNote","waitFor","formingContext","visionSummary")) {
                $value = [string](Get-PropValue $leaderPlan $name "")
                if ([string]::IsNullOrWhiteSpace($value)) { throw "Leader KKK genel $name alani eksik." }
            }

            # Empty support/veto arrays are valid (NONE). Do not route them through
            # Get-PropValue because PowerShell unrolls an empty array to no pipeline output,
            # which becomes $null and falsely looks like a missing property under StrictMode.
            $supportProp = $leaderPlan.PSObject.Properties['supportTFs']
            $vetoProp = $leaderPlan.PSObject.Properties['vetoTFs']
            if ($null -eq $supportProp -or $null -eq $vetoProp -or $null -eq $supportProp.Value -or $null -eq $vetoProp.Value) {
                throw 'Leader KKK SUPPORT_TFS/VETO_TFS alanlari eksik.'
            }
            $supportObj = @($supportProp.Value)
            $vetoObj = @($vetoProp.Value)

            $tfDiagnostics = Get-PropValue $leaderPlan "timeframeDiagnostics" $null
            if ($null -eq $tfDiagnostics) { throw 'Leader KKK timeframeDiagnostics alani eksik.' }
            $diagFrames = @('1m','3m','5m','15m','30m','45m','1h','4h','1d')
            foreach ($tf in $diagFrames) {
                $d = Get-PropValue $tfDiagnostics $tf $null
                if ($null -eq $d) { throw "Leader KKK $tf model diagnostigi eksik." }
                foreach ($name in @("summary","why","waitFor","role","formingContext","risk")) {
                    $value = [string](Get-PropValue $d $name "")
                    if ([string]::IsNullOrWhiteSpace($value)) { throw "Leader KKK $tf/$name alani eksik." }
                }
                $role = [string](Get-PropValue $d "role" "")
                if (@('SUPPORT','VETO','NEUTRAL') -notcontains $role) { throw "Leader KKK $tf role gecersiz: $role" }
            }

            $supportText = @($supportObj) -join ','
            $vetoText = @($vetoObj) -join ','
            $contractWarnings = @(Get-PropValue $leaderPlan "visionContractWarnings" @())
            if ($contractWarnings.Count -gt 0) {
                Write-Host ("LEADER_9TF_MODEL_WARNING " + ($contractWarnings -join ',')) -ForegroundColor Yellow
            }
            $detailCandidate = Get-PropValue $detailPlanResult "candidate" $null
            $detailSymbol = [string](Get-PropValue $detailCandidate "symbol" "")
            $detailSide = [string](Get-PropValue $leaderPlan "side" "")
            $detailStatus = [string](Get-PropValue $leaderPlan "status" "")
            Write-Host ("LEADER_9TF_DETAIL symbol={0} side={1} status={2} vision={3}/9 support={4} veto={5} detailed=9/9" -f $detailSymbol,$detailSide,$detailStatus,$attached,$supportText,$vetoText)
        } else {
            $detailReason = [string](Get-PropValue $detailPlanResult "reason" "NO_DIRECTIONAL_DEEP_SCAN_CANDIDATE")
            Write-Host "LEADER_9TF_DETAIL skipped=$detailReason"
        }
        try {
            $vision = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/vision/probe?symbol=BTCUSDT' -Headers $headers -TimeoutSec 1500
        } catch {
            Write-Host '========== 9TF VISION PROBE HATA ==========' -ForegroundColor Red
            if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
            try {
                $mh = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/models/healthy' -Headers $headers -TimeoutSec 10
                Write-Host '========== MODEL / VISION SAGLIK ==========' -ForegroundColor Yellow
                foreach ($m in @($mh.models)) {
                    Write-Host ("{0} text={1} vision={2} visionError={3}" -f $m.model,$m.status,$m.visionStatus,$m.visionError)
                }
            } catch {}
            $brainLog = Join-Path $BrainRoot 'logs\brainpub.log'
            if (Test-Path -LiteralPath $brainLog) {
                Write-Host '========== BRAINHUB LOG SON 100 ==========' -ForegroundColor Yellow
                Get-Content -LiteralPath $brainLog -Tail 100
            }
            throw
        }
        if (-not $vision.ok -or $vision.charts.attached -lt 9 -or $vision.vision.attached -lt 9 -or [string]::IsNullOrWhiteSpace([string]$vision.model)) {
            throw '9TF Vision model okuma testi gecmedi; grafikler uretilse bile model tarafinda gercek gorsel okuma dogrulanamadi.'
        }
        if (-not $vision.visualVerification -or -not $vision.visualVerification.ok -or $vision.visualVerification.reported -lt 9 -or $vision.visualVerification.matched -lt $vision.visualVerification.threshold) {
            throw '9TF Vision pixel okuma testi gecmedi; model dokuz probe grafigindeki gizli 3x3 diagnostik hucre konumlarini 9/9 dogrulayamadı.'
        }
        Write-Host "VISION model=$($vision.model) mode=$($vision.mode) charts=$($vision.vision.attached)/9 degraded=$($vision.degraded) pixel=$($vision.visualVerification.matched)/9 threshold=$($vision.visualVerification.threshold)"
    }
    Write-Host "BRAINHUB_TEST_OK feature=$($h.featureVersion) models=$($h.configured.total) universe=$($scan.activeUsdtPerpetuals) tf45=$($symbol.timeframes.'45m'.available) unified=$($unified.dataQuality.advisoryUsable) chart=$($chart.bars) sqlite=$($learn.ok) liveArmed=$($live.armed)"
}
function Get-Source([string]$Given) {
    if ($Given) {
        $resolved = (Resolve-Path -LiteralPath $Given).Path
        $dir = if (Test-Path -LiteralPath (Join-Path $resolved 'brainhub\server.js')) { Join-Path $resolved 'brainhub' } else { $resolved }
        if (-not (Test-Path -LiteralPath (Join-Path $dir 'server.js'))) { throw 'Source icinde brainhub/server.js yok.' }
        return $dir
    }
    $tempDir = Join-Path $env:TEMP ("brainhub-source-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $zip = Join-Path $tempDir 'repo.zip'
    $headers = @{
        'User-Agent' = 'BrainHub-Updater'
        'Cache-Control' = 'no-cache'
        'Pragma' = 'no-cache'
    }
    $meta = Invoke-RestMethod -Uri 'https://api.github.com/repos/goxel1907/antik-harita-turkiye/commits/futures15m-alarm-public-build' -Headers $headers -TimeoutSec 30
    $sha = ([string]$meta.sha).Trim().ToLowerInvariant()
    if ($sha -notmatch '^[0-9a-f]{40}$') { throw 'GitHub branch HEAD SHA dogrulanamadi.' }
    $archiveUrl = "https://codeload.github.com/goxel1907/antik-harita-turkiye/zip/$sha"
    Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -Headers $headers -TimeoutSec 120 -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $tempDir
    $dir = Get-ChildItem -LiteralPath $tempDir -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'brainhub\server.js') } | Select-Object -First 1
    if (-not $dir) { throw 'Indirilen arsivde BrainHub bulunamadi.' }
    $brainDir = Join-Path $dir.FullName 'brainhub'
    $serverText = Get-Content -LiteralPath (Join-Path $brainDir 'server.js') -Raw
    $v110Path = Join-Path $brainDir 'v110.js'
    $v110Text = if (Test-Path -LiteralPath $v110Path) { Get-Content -LiteralPath $v110Path -Raw } else { '' }
    # v110 feature isimleri server.js icine literal olarak kopyalanmaz; server v110.js
    # manifestini require edip features dizisini runtime /health'e yayar. Bu nedenle
    # bootstrap arşiv doğrulaması v110 markerlarini v110.js manifestinde kontrol eder.
    if ($serverText -notmatch 'KIRO_FREE_QUOTA_VISION_OPT_IN' -or $serverText -notmatch 'VISION_PIXEL_PROBE' -or $serverText -notmatch 'KKK_DETAILED_9TF_DIAGNOSTICS' -or $serverText -notmatch 'LEADER_DETAIL_PROBE' -or $serverText -notmatch 'VISION_RUNTIME_TRUTH_STATUS' -or $serverText -notmatch 'LEADER_STATUS_STALE_SUPPRESSION' -or $serverText -notmatch 'LEADER_AUTO_HEALTH_TELEMETRY' -or $serverText -notmatch 'LEADER_AUTO_COVERAGE_SCHEDULER' -or $serverText -notmatch 'USER_PANEL_EXACT_TOTAL_EXPOSURE' -or $serverText -notmatch 'LEADER_APPROVED_ANALYSIS_REUSE' -or $serverText -notmatch 'PREJEV_EXECUTION_TELEMETRY' -or $serverText -notmatch 'BRAIN_LEARNING_OUTCOME_CONTEXT_ACTIVE' -or $serverText -notmatch 'TARGETED_PRIORITY_UNIVERSE_24' -or $serverText -notmatch 'BINANCE_TOP24_GAINER_DISCOVERY' -or $serverText -notmatch 'ACCUMULATION_PROXY_DISCOVERY' -or $serverText -notmatch 'ANDROID_ATTENTION_SYNC' -or $serverText -notmatch 'PLAN_WORKER_ORCHESTRATION' -or $serverText -notmatch 'PLAN_WORKER_9ROUTER_TEXT' -or $serverText -notmatch 'PLAN_WORKER_9ROUTER_FREE_ONLY' -or $serverText -notmatch 'OPENROUTER_FREE_WORKER_SECOND_OPINION' -or $serverText -notmatch 'WORKER_VISION_AVOIDANCE_TELEMETRY' -or $serverText -notmatch 'PLAN_WORKER_PARALLEL_TIMER' -or $serverText -notmatch 'V108_WORKER_ESCALATION_LATCH' -or $serverText -notmatch 'V108_CONCRETE_WATCH_CONTRACT' -or $serverText -notmatch 'LOCAL_VISION_FREE_QUOTA_FAILOVER' -or $serverText -notmatch 'LOCAL_OLLAMA_VISION_BATCH3_ACTIVE' -or $serverText -notmatch 'LOCAL_OLLAMA_VISION_SINGLE_TF_FALLBACK' -or $serverText -notmatch 'OPENCODE_OFFICIAL_FREE_INFERENCE' -or $serverText -notmatch 'CLAUDE_V109' -or -not (Test-Path -LiteralPath (Join-Path $brainDir 'claude-v109.js')) -or -not (Test-Path -LiteralPath (Join-Path $brainDir 'trade-lanes.js')) -or -not (Test-Path -LiteralPath $v110Path) -or $v110Text -notmatch 'V110_MULTILANE_15M_SCALP' -or $v110Text -notmatch 'V110_SCALP_TWO_OF_THREE' -or $v110Text -notmatch 'V110_NUMERIC_TRIGGER_H8' -or -not (Test-Path -LiteralPath (Join-Path $brainDir 'claude-v111.js')) -or (Get-Content -LiteralPath (Join-Path $brainDir 'claude-v111.js') -Raw) -notmatch 'CLAUDE_V111_BUILD' -or -not (Test-Path -LiteralPath (Join-Path $brainDir 'claude-v112.js')) -or (Get-Content -LiteralPath (Join-Path $brainDir 'claude-v112.js') -Raw) -notmatch 'CLAUDE_V112_BUILD') {
        throw "GitHub HEAD $sha beklenen Vision bootstrap isaretlerini icermiyor; eski arsiv uygulanmadi."
    }
    Write-Host "SOURCE_HEAD $sha"
    return $brainDir
}
function Backup-Brain([string]$BrainRoot) {
    $parent = Split-Path -Parent $BrainRoot
    $targetRoot = Join-Path $parent 'BrainHubBackups'
    New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
    $target = Join-Path $targetRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    foreach ($name in @('server','config','data','START-BrainHub.ps1','manage.ps1','INSTALL.ps1','UPDATE.ps1','START.ps1','TEST.ps1','BACKUP.ps1','RESTORE.ps1','PAIR.ps1','UNPAIR.ps1','VISION-FREE-SETUP.ps1','VISION-STATUS.ps1','OPENROUTER-SETUP.ps1','OPENROUTER-STATUS.ps1','OPENROUTER-CREDIT-SETUP.ps1','JEV-PROBE.ps1')) {
        $p = Join-Path $BrainRoot $name
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $target -Recurse -Force }
    }
    Write-Host "BACKUP_OK $target"
    return $target
}

function Migrate-JevBudgetPolicy([string]$BrainRoot) {
    $jevPath = Join-Path $BrainRoot 'config\jev.json'
    if (-not (Test-Path -LiteralPath $jevPath)) { return }
    try { $jev = Get-Content -LiteralPath $jevPath -Raw | ConvertFrom-Json }
    catch { throw 'jev.json okunamadi; Jev butce politikasi migrate edilmedi.' }
    if ($null -eq $jev -or $jev -is [Array]) { throw 'jev.json nesne biciminde degil; Jev butce politikasi migrate edilmedi.' }

    $softProp = $jev.PSObject.Properties['softBudgetUsd']
    $dailyProp = $jev.PSObject.Properties['dailyCapUsd']
    $reserveProp = $jev.PSObject.Properties['reservePerCallUsd']
    $changed = $false

    if ($null -eq $softProp) {
        $jev | Add-Member -NotePropertyName softBudgetUsd -NotePropertyValue 0.25 -Force
        $changed = $true
    }

    if ($null -eq $dailyProp) {
        $jev | Add-Member -NotePropertyName dailyCapUsd -NotePropertyValue 2.00 -Force
        $changed = $true
    } else {
        $daily = [double](Get-PropValue $jev 'dailyCapUsd' 0.25)
        if ([Math]::Abs($daily - 0.25) -lt 0.0000001) {
            $jev.dailyCapUsd = 2.00
            $changed = $true
        }
    }

    if ($null -eq $reserveProp) {
        $jev | Add-Member -NotePropertyName reservePerCallUsd -NotePropertyValue 0.002 -Force
        $changed = $true
    } else {
        $reserve = [double](Get-PropValue $jev 'reservePerCallUsd' 0.01)
        if ([Math]::Abs($reserve - 0.01) -lt 0.0000001) {
            $jev.reservePerCallUsd = 0.002
            $changed = $true
        }
    }

    if ($changed) {
        $jev | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jevPath -Encoding UTF8
        Write-Host 'JEV_BUDGET_POLICY_MIGRATED softUsd=0.25 hardUsd=2.00 reserveUsd=0.002'
    }
}

$rootFull = [IO.Path]::GetFullPath($Root)
$node = Resolve-Node
if ($Action -eq 'Test') { Test-Brain $rootFull -IncludeDeep:$Deep; exit 0 }
if ($Action -eq 'OpenRouterStatus') {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/openrouter/status?remote=1' -Headers (Auth-Headers $rootFull) -TimeoutSec 20
    $status | ConvertTo-Json -Depth 12
    exit 0
}
if ($Action -eq 'JevProbe') {
    $status = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/jev/probe' -Headers (Auth-Headers $rootFull) -ContentType 'application/json' -Body '{}' -TimeoutSec 60
    $status | ConvertTo-Json -Depth 12
    if (-not $status.ok) { throw 'Jev probe basarisiz.' }
    exit 0
}
if ($Action -eq 'OpenRouterSetup') {
    $keyPath = Join-Path $rootFull 'config\openrouter-api-key.dpapi'
    $jevPath = Join-Path $rootFull 'config\jev.json'
    $clipboardCandidate = (Get-Clipboard -Raw -ErrorAction SilentlyContinue | Out-String).Trim()
    $savedCandidate = Read-Dpapi $keyPath
    $candidate = if ($clipboardCandidate -match '^sk-or-v1-[A-Za-z0-9_-]{20,}$') { $clipboardCandidate } elseif ($savedCandidate -match '^sk-or-v1-[A-Za-z0-9_-]{20,}$') { $savedCandidate } else { '' }
    if ($candidate -notmatch '^sk-or-v1-[A-Za-z0-9_-]{20,}$') {
        throw 'Gecerli OpenRouter API key bulunamadi. Yeni BrainHub-JEV keyini panoya kopyalayip komutu tekrar calistirin.'
    }
    try {
        $remote = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/key' -Headers @{ Authorization = "Bearer $candidate" } -TimeoutSec 20
    } catch {
        throw 'OpenRouter API key dogrulanamadi; keyi yenileyip panoya tekrar kopyalayin.'
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $rootFull 'config') | Out-Null
    Save-Dpapi $keyPath $candidate
    [ordered]@{
        enabled = $true
        model = 'typesafe/jev-1.13'
        decisionsUrl = 'https://openrouter.ai/api/alpha/decisions'
        keyUrl = 'https://openrouter.ai/api/v1/key'
        creditsUrl = 'https://openrouter.ai/api/v1/credits'
        billingCacheMs = 300000
        mode = 'ADVISORY_VETO_ONLY'
        softBudgetUsd = 0.25
        dailyCapUsd = 2.00
        timeoutMs = 30000
        maxPayloadChars = 24000
        reservePerCallUsd = 0.002
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jevPath -Encoding UTF8
    $candidate = ''
    $savedCandidate = ''
    $clipboardCandidate = ''
    try { Set-Clipboard -Value ' ' -ErrorAction Stop } catch { }
    $routerKey = Router-Key $rootFull
    Stop-Brain $rootFull
    Start-Brain $rootFull $node $routerKey
    Test-Brain $rootFull
    $local = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/openrouter/status' -Headers (Auth-Headers $rootFull) -TimeoutSec 10
    if (-not $local.configured -or -not $local.keyLoaded -or $local.model -ne 'typesafe/jev-1.13' -or $local.mode -ne 'ADVISORY_VETO_ONLY') {
        throw 'OpenRouter/Jev yerel yapilandirmasi dogrulanamadi.'
    }
    $probeOk = $false
    try {
        $probe = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/jev/probe' -Headers (Auth-Headers $rootFull) -ContentType 'application/json' -Body '{}' -TimeoutSec 60
        $probeOk = [bool]$probe.ok
        if ($probeOk) {
            Write-Host ("JEV_PROBE_OK model={0} durationMs={1}" -f $probe.model,$probe.durationMs) -ForegroundColor Green
        }
    } catch {
        Write-Warning 'OpenRouter key DPAPI ile guvenli kaydedildi ancak Jev alpha probe su anda tamamlanamadi. JEV-PROBE.ps1 ile tekrar denenebilir.'
    }
    Write-Host ("BRAINHUB_OPENROUTER_SETUP_OK model=typesafe/jev-1.13 mode=ADVISORY_VETO_ONLY softBudgetUsd=0.25 dailyCapUsd=2.00 probe={0}" -f $probeOk) -ForegroundColor Green
    exit 0
}
if ($Action -eq 'OpenRouterCreditSetup') {
    $managementPath = Join-Path $rootFull 'config\openrouter-management-key.dpapi'
    $clipboardCandidate = (Get-Clipboard -Raw -ErrorAction SilentlyContinue | Out-String).Trim()
    $savedCandidate = Read-Dpapi $managementPath
    $candidate = if ($clipboardCandidate -match '^\S{20,}$') { $clipboardCandidate } elseif ($savedCandidate -match '^\S{20,}$') { $savedCandidate } else { '' }
    if ($candidate -notmatch '^\S{20,}$') { throw 'OpenRouter Management API key bulunamadi. Management Keys sayfasinda olusturup panoya kopyalayin.' }
    try {
        $credits = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/credits' -Headers @{ Authorization = "Bearer $candidate" } -TimeoutSec 20
        $total = [double](Get-PropValue $credits.data 'total_credits' -1)
        $used = [double](Get-PropValue $credits.data 'total_usage' -1)
        if ($total -lt 0 -or $used -lt 0) { throw 'credit schema' }
    } catch { throw 'OpenRouter Management key credits API ile dogrulanamadi.' }
    Save-Dpapi $managementPath $candidate
    $candidate = ''; $savedCandidate = ''; $clipboardCandidate = ''
    try { Set-Clipboard -Value ' ' -ErrorAction Stop } catch { }
    $routerKey = Router-Key $rootFull
    Stop-Brain $rootFull
    Start-Brain $rootFull $node $routerKey
    $billing = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/openrouter/billing?force=1' -Headers (Auth-Headers $rootFull) -TimeoutSec 20
    if (-not $billing.accountCredits.available) { throw 'OpenRouter hesap kredisi BrainHub tarafinda goruntulenemedi.' }
    Write-Host ("BRAINHUB_OPENROUTER_CREDIT_OK remainingUsd={0:N4} totalCredits={1:N4} totalUsage={2:N4}" -f $billing.accountCredits.remainingCredits,$billing.accountCredits.totalCredits,$billing.accountCredits.totalUsage) -ForegroundColor Green
    exit 0
}
if ($Action -eq 'VisionBenchmark') {
    # CLAUDE_V112_VISION_BENCHMARK_21: yerel 4B Vision modelinin sentetik grafik okuma dogrulugu (21 vaka).
    Write-Host 'Vision benchmark basladi (21 sentetik grafik; tek GPU, 5-15 dk surebilir; bu sirada Leader AUTO analizi bekler)...'
    $b = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/vision/benchmark?run=1' -Headers (Auth-Headers $rootFull) -TimeoutSec 3600
    if (-not $b.ok) { throw "Vision benchmark basarisiz: $($b.error) $($b.detail)" }
    Write-Host ("VISION_BENCHMARK model={0} dogruluk=%{1} ({2}/{3}) okunamayan={4}" -f $b.model, $b.accuracyPct, $b.matched, $b.cases, $b.unparsed)
    foreach ($p in $b.byLabel.PSObject.Properties) { Write-Host ("  sinif {0,-14} %{1} ({2}/{3})" -f $p.Name, $p.Value.accuracyPct, $p.Value.matched, $p.Value.total) }
    foreach ($p in $b.byProfile.PSObject.Properties) { Write-Host ("  boyut {0,-14} %{1} ({2}/{3})" -f $p.Name, $p.Value.accuracyPct, $p.Value.matched, $p.Value.total) }
    exit 0
}
if ($Action -eq 'VisionStatus') {
    $routes = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/models/routes' -Headers (Auth-Headers $rootFull) -TimeoutSec 10
    [ordered]@{
        ok = $routes.ok
        freeFirst = $routes.freeFirst
        kiroFreeQuotaVision = $routes.visionKiroFreeQuota
        kiroFreeQuotaVisionModels = @($routes.kiroFreeQuotaVisionModels)
        localVisionEnabled = $routes.localVisionEnabled
        localVisionModels = @($routes.localVisionModels)
        localVisionBaseUrl = $routes.localVisionBaseUrl
        localVisionContextSize = $routes.localVisionContextSize
        localVisionTimeoutMs = $routes.localVisionTimeoutMs
        localVisionOnly = $routes.localVisionOnly
        localVisionTwoStage = $routes.localVisionTwoStage
        localVisionBatchSize = $routes.localVisionBatchSize
        localVisionSingleTf = $routes.localVisionSingleTf
        localVisionSingleTfFallback = $routes.localVisionSingleTfFallback
        localVisionCompactFinalize = $routes.localVisionCompactFinalize
        localVisionTfContract = $routes.localVisionTfContract
        localVisionSplitGlobal = $routes.localVisionSplitGlobal
        localVisionDirectPipeline = $routes.localVisionDirectPipeline
        paidVisionFallbackEnabled = $routes.paidVisionFallbackEnabled
        visionRoutes = $routes.visionRoutes
        note = $routes.note
    } | ConvertTo-Json -Depth 8
    exit 0
}
if ($Action -eq 'VisionLocalSetup') {
    $sourceModel = 'qwen3-vl:4b-instruct-q4_K_M'
    $runtimeModel = 'brainhub-qwen3-vl-4b-16k'
    $contextSize = 16384
    $ollamaApi = 'http://127.0.0.1:11434'
    try {
        $tags = Invoke-RestMethod -Uri ($ollamaApi + '/api/tags') -TimeoutSec 8
    } catch {
        throw 'Yerel Ollama yanit vermiyor. Once Ollama servisinin calistigini dogrulayin.'
    }
    $installed = @($tags.models | ForEach-Object { [string]$_.name })
    if ($installed -notcontains $sourceModel) {
        throw "Yerel Vision kaynak modeli bulunamadi. Once: ollama pull $sourceModel"
    }
    $ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCommand) { [string]$ollamaCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe' }
    if (-not (Test-Path -LiteralPath $ollamaExe)) { throw 'ollama.exe bulunamadi.' }
    $modelFile = Join-Path $env:TEMP ('brainhub-qwen3-vl-' + [guid]::NewGuid().ToString('N') + '.Modelfile')
    try {
        @(
            "FROM $sourceModel",
            "PARAMETER num_ctx $contextSize"
        ) | Set-Content -LiteralPath $modelFile -Encoding ASCII
        & $ollamaExe create $runtimeModel -f $modelFile
        if ($LASTEXITCODE -ne 0) { throw '16K staged yerel Vision modeli olusturulamadi.' }
        $showText = (& $ollamaExe show $runtimeModel --modelfile | Out-String)
        if ($LASTEXITCODE -ne 0 -or $showText -notmatch '(?im)^\s*PARAMETER\s+num_ctx\s+16384\s*$') {
            throw 'Yerel Vision modelinin 16K staged context ayari dogrulanamadi.'
        }
    } finally {
        Remove-Item -LiteralPath $modelFile -Force -ErrorAction SilentlyContinue
    }
    $modelsPath = Join-Path $rootFull 'config\models.json'
    if (-not (Test-Path -LiteralPath $modelsPath)) { throw 'models.json bulunamadi; once BrainHub Update/Install calistirin.' }
    $key = Router-Key $rootFull
    $wasRunning = [bool](Brain-Pid $rootFull)
    if ($wasRunning) { Stop-Brain $rootFull }
    $backup = Backup-Brain $rootFull
    try {
        $models = Get-Content -LiteralPath $modelsPath -Raw | ConvertFrom-Json
        $local = [ordered]@{
            enabled = $true
            baseUrl = 'http://127.0.0.1:11434/v1'
            models = @($runtimeModel)
            contextSize = $contextSize
            timeoutMs = 300000
            localOnly = $true
        }
        $models | Add-Member -NotePropertyName localVision -NotePropertyValue $local -Force
        $models | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $modelsPath -Encoding UTF8
        Start-Brain $rootFull $node $key
        Test-Brain $rootFull
        $routes = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/models/routes' -Headers (Auth-Headers $rootFull) -TimeoutSec 10
        if (-not $routes.localVisionEnabled -or -not $routes.localVisionOnly -or -not $routes.localVisionTwoStage -or [int]$routes.localVisionBatchSize -ne 3 -or [bool]$routes.localVisionSingleTf -or -not [bool]$routes.localVisionSingleTfFallback -or -not $routes.localVisionCompactFinalize -or -not $routes.localVisionTfContract -or -not $routes.localVisionSplitGlobal -or -not $routes.localVisionDirectPipeline -or @($routes.localVisionModels) -notcontains ('local/' + $runtimeModel) -or [int]$routes.localVisionContextSize -lt $contextSize) {
            throw 'Yerel Ollama Vision staged 16K local-only rotasi etkinlesmedi.'
        }
        Write-Host "BRAINHUB_LOCAL_VISION_SETUP_OK model=$runtimeModel context=$contextSize backup=$backup"
    } catch {
        Stop-Brain $rootFull
        $backupModels = Join-Path $backup 'config\models.json'
        if (Test-Path -LiteralPath $backupModels) { Copy-Item -LiteralPath $backupModels -Destination $modelsPath -Force }
        if ($wasRunning) { Start-Brain $rootFull $node $key -AcceptLegacy }
        throw
    }
    exit 0
}
if ($Action -eq 'VisionFreeSetup') {
    $confirm = (Read-Host 'Kiro hesabinin mevcut ucretsiz kotasini 9TF Vision icin kullanmak istiyorsaniz KIRO_FREE yazin').Trim().ToUpperInvariant()
    if ($confirm -ne 'KIRO_FREE') { throw 'Kiro free-quota Vision acik onayi verilmedi.' }
    $committeePath = Join-Path $rootFull 'config\committee.json'
    if (-not (Test-Path -LiteralPath $committeePath)) { throw 'committee.json bulunamadi; once BrainHub Update/Install calistirin.' }
    $committee = Get-Content -LiteralPath $committeePath -Raw | ConvertFrom-Json
    $committee | Add-Member -NotePropertyName allowKiroFreeQuotaVision -NotePropertyValue $true -Force
    $committee | Add-Member -NotePropertyName kiroFreeQuotaVisionModels -NotePropertyValue @('kr/claude-sonnet-4.5','kr/claude-haiku-4.5') -Force
    $committee | Add-Member -NotePropertyName allowKiroVisionFallback -NotePropertyValue $false -Force
    $committee | Add-Member -NotePropertyName minVisionAnalystReplies -NotePropertyValue 1 -Force
    $committee | Add-Member -NotePropertyName visionParallelAnalysts -NotePropertyValue 1 -Force
    $committee | Add-Member -NotePropertyName kiroCreditSaving -NotePropertyValue $true -Force
    $committee | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $committeePath -Encoding UTF8
    $key = Router-Key $rootFull
    Stop-Brain $rootFull
    Start-Brain $rootFull $node $key
    Test-Brain $rootFull
    $routes = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/models/routes' -Headers (Auth-Headers $rootFull) -TimeoutSec 10
    if (-not $routes.visionKiroFreeQuota -or $routes.paidVisionFallbackEnabled) { throw 'Kiro free-quota Vision ayari fail-closed dogrulanamadi.' }
    Write-Host ("BRAINHUB_VISION_FREE_SETUP_OK models=" + (@($routes.kiroFreeQuotaVisionModels) -join ','))
    exit 0
}
if ($Action -eq 'LiveStatus') {
    $live = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers (Auth-Headers $rootFull) -TimeoutSec 5
    $live | ConvertTo-Json -Depth 32
    exit 0
}
if ($Action -eq 'LiveReadiness') {
    $headers = Auth-Headers $rootFull
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 5
    if ($status.armed) { throw 'Readiness testi yalnız PC LIVE kapalıyken çalışır; önce LiveDisarm kullanın.' }
    $readinessUri = 'http://127.0.0.1:8787/live/readiness'
    $requestedSymbol = ([string]$env:BRAINHUB_READINESS_SYMBOL).Trim().ToUpperInvariant()
    if ($requestedSymbol) {
        $readinessUri = $readinessUri + '?symbol=' + [Uri]::EscapeDataString($requestedSymbol)
    }
    $out = Invoke-RestMethod -Uri $readinessUri -Headers $headers -TimeoutSec 300
    Write-Host '========== LIVE READINESS =========='
    $ready = Get-PropValue $out "readyForUserArm" $false
    $execution = [string](Get-PropValue $out "execution" "LIVE_READINESS_CHECK")
    $armed = Get-PropValue $out "armed" $false
    $orderPlaced = Get-PropValue $out "orderPlaced" $false
    $orderRequestSent = Get-PropValue $out "orderRequestSent" $false
    Write-Host ("readyForUserArm={0} execution={1} armed={2} orderPlaced={3} orderRequestSent={4}" -f $ready,$execution,$armed,$orderPlaced,$orderRequestSent)

    $symbol = [string](Get-PropValue $out "symbol" "")
    if (-not [string]::IsNullOrWhiteSpace($symbol)) {
        $side = [string](Get-PropValue $out "side" "")
        $planStatus = [string](Get-PropValue $out "planStatus" "")
        $originTF = [string](Get-PropValue $out "originTF" "")
        $ownerTF = [string](Get-PropValue $out "ownerTF" "")
        $visionObj = Get-PropValue $out "vision" $null
        $visionAttached = if ($null -ne $visionObj) { Get-PropValue $visionObj "attached" 0 } else { 0 }
        $visionRequired = if ($null -ne $visionObj) { Get-PropValue $visionObj "required" 9 } else { 9 }
        Write-Host ("symbol={0} side={1} plan={2} origin={3} owner={4} vision={5}/{6}" -f $symbol,$side,$planStatus,$originTF,$ownerTF,$visionAttached,$visionRequired)
    }

    $dryRunObj = Get-PropValue $out "dryRun" $null
    if ($null -ne $dryRunObj) {
        Write-Host ("dryRun ok={0} simulated={1} submitted={2} requestSent={3}" -f (Get-PropValue $dryRunObj "ok" $false),(Get-PropValue $dryRunObj "simulated" $false),(Get-PropValue $dryRunObj "submitted" $false),(Get-PropValue $dryRunObj "requestSent" $false))
    }

    $exchangeRulesObj = Get-PropValue $out "exchangeRules" $null
    if ($null -ne $exchangeRulesObj) {
        Write-Host ("exchangeRules ok={0} livePrice={1}" -f (Get-PropValue $exchangeRulesObj "ok" $false),(Get-PropValue $exchangeRulesObj "livePrice" ""))
        $exchangeRuleReasons = @(Get-PropValue $exchangeRulesObj "reasons" @())
        if ($exchangeRuleReasons.Count -gt 0) { Write-Host ("exchangeRuleReasons=" + ($exchangeRuleReasons -join ',')) -ForegroundColor Yellow }
    }

    $authSimObj = Get-PropValue $out "authorizationSimulation" $null
    if ($null -ne $authSimObj) {
        Write-Host ("authSim issue={0} consumeOnce={1} replayBlocked={2}" -f (Get-PropValue $authSimObj "issueOk" $false),(Get-PropValue $authSimObj "consumeOnceOk" $false),(Get-PropValue $authSimObj "replayBlocked" $false))
    }

    $reasons = @(Get-PropValue $out "reasons" @())
    if ($reasons.Count -gt 0) { Write-Host ("reasons=" + ($reasons -join ',')) -ForegroundColor Yellow }
    if ($ready) {
        Write-Host 'BRAINHUB_LIVE_READINESS_OK - hicbir canli emir gonderilmedi; PC LIVE hala kapali.' -ForegroundColor Green
    } else {
        Write-Host 'BRAINHUB_LIVE_READINESS_WAIT - canliya gecmeyin; yukaridaki blok nedenini cozun.' -ForegroundColor Yellow
    }
    exit 0
}
if ($Action -eq 'LiveSetup') {
    $permissionConfirm = (Read-Host 'Futures trading ACIK, withdrawal KAPALI ve API IP restriction ACIK ise LIVE yazin').Trim().ToUpperInvariant()
    if ($permissionConfirm -ne 'LIVE') { throw 'LIVE API permission onayi verilmedi.' }
    $apiKeySecure = Read-Host 'Binance API Key (gizli giris)' -AsSecureString
    $apiSecretSecure = Read-Host 'Binance API Secret (gizli giris)' -AsSecureString
    $apiKey = Secure-ToPlain $apiKeySecure
    $apiSecret = Secure-ToPlain $apiSecretSecure
    if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey.Trim().Length -lt 8) { throw 'Binance API key gecersiz.' }
    if ([string]::IsNullOrWhiteSpace($apiSecret) -or $apiSecret.Trim().Length -lt 8) { throw 'Binance API secret gecersiz.' }
    $armMinutes = Prompt-IntRange 'LIVE arm suresi dakika (5-1440)' 5 1440
    $expectedLeverage = Prompt-IntRange 'Beklenen Futures kaldirac (1-125)' 1 125
    $maxEntryDeviationPct = Prompt-PositiveDouble 'Maksimum entry fiyat sapmasi % (0-5]' 0 5
    $maxRiskPctPerTrade = Prompt-PositiveDouble 'Islem basi maksimum risk % (0-100]' 0 100
    $maxNotionalPctPerTrade = Prompt-PositiveDouble 'Islem basi maksimum notional/equity % (0-100]' 0 100
    $maxDailyLossPct = Prompt-PositiveDouble 'Gunluk maksimum kayip % (0-100]' 0 100
    $maxOpenPositions = Prompt-IntRange 'Maksimum ayni anda acik pozisyon (1-100)' 1 100
    $maxFamilyExposurePct = Prompt-PositiveDouble 'Toplam USDT perp exposure/equity % (0-100]' 0 100
    $policy = [ordered]@{
        armMinutes = $armMinutes
        expectedLeverage = $expectedLeverage
        maxEntryDeviationPct = $maxEntryDeviationPct
        limits = [ordered]@{
            maxRiskPctPerTrade = $maxRiskPctPerTrade
            maxNotionalPctPerTrade = $maxNotionalPctPerTrade
            maxDailyLossPct = $maxDailyLossPct
            maxOpenPositions = $maxOpenPositions
            maxFamilyExposurePct = $maxFamilyExposurePct
        }
        apiPermissions = [ordered]@{
            configured = $true
            futuresEnabled = $true
            withdrawalsEnabled = $false
            ipRestricted = $true
        }
    }
    $cfgDir = Join-Path $rootFull 'config'
    New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
    Save-Dpapi (Join-Path $cfgDir 'binance-api-key.dpapi') $apiKey.Trim()
    Save-Dpapi (Join-Path $cfgDir 'binance-api-secret.dpapi') $apiSecret.Trim()
    $policy | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $cfgDir 'live-policy.json') -Encoding UTF8
    $apiKey = ''
    $apiSecret = ''
    $key = Router-Key $rootFull
    Stop-Brain $rootFull
    Start-Brain $rootFull $node $key
    Test-Brain $rootFull
    $live = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers (Auth-Headers $rootFull) -TimeoutSec 5
    if (-not $live.liveConfigured) { throw 'LIVE setup kaydedildi ancak BrainHub configured durumuna gecmedi.' }
    Write-Host "BRAINHUB_LIVE_SETUP_OK configured=$($live.liveConfigured) armed=$($live.armed)"
    exit 0
}
if ($Action -eq 'LiveArm') {
    $headers = Auth-Headers $rootFull
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 5
    if (-not $status.liveConfigured) { throw 'LIVE configured degil; once LiveSetup calistirin.' }
    $body = @{ confirm='LIVE' } | ConvertTo-Json -Compress
    $out = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/live/arm' -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 20
    if (-not $out.ok -or -not $out.armed) { throw 'LIVE arm basarisiz.' }
    Write-Host "BRAINHUB_LIVE_ARMED expiresAt=$($out.expiresAt)"
    exit 0
}
if ($Action -eq 'LiveDisarm') {
    $headers = Auth-Headers $rootFull
    $body = @{ reason='USER_DISARM' } | ConvertTo-Json -Compress
    $out = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/live/disarm' -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 10
    if (-not $out.ok -or $out.armed) { throw 'LIVE disarm basarisiz.' }
    Write-Host 'BRAINHUB_LIVE_DISARMED'
    exit 0
}
if ($Action -eq 'Pair') {
    $tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    if (-not (Test-Path -LiteralPath $tailscale)) { throw 'Tailscale kurulu degil.' }
    $key = Router-Key $rootFull
    $tokenPath = Join-Path $rootFull 'config\client-token.dpapi'
    $token = Read-Dpapi $tokenPath
    if (-not $token) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
        Save-Dpapi $tokenPath $token
    }
    $flag = Join-Path $rootFull 'config\remote-enabled'
    Set-Content -LiteralPath $flag -Value 'TAILSCALE_SERVE_TOKEN_REQUIRED' -Encoding ASCII
    Stop-Brain $rootFull
    try {
        Start-Brain $rootFull $node $key
        Test-Brain $rootFull
        & $tailscale serve --bg --https=8787 --yes 'http://127.0.0.1:8787' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed' }
        $state = (& $tailscale status --json | ConvertFrom-Json)
        $dns = ([string]$state.Self.DNSName).TrimEnd('.')
        if (-not $dns) { throw 'Tailscale DNS name unavailable' }
        Set-Clipboard -Value $token
        Write-Host "BRAINHUB_PAIR_OK endpoint=https://$($dns):8787 token=PC_CLIPBOARD"
    } catch {
        Remove-Item -LiteralPath $flag -ErrorAction SilentlyContinue
        Stop-Brain $rootFull
        Start-Brain $rootFull $node $key
        throw
    }
    exit 0
}
if ($Action -eq 'Unpair') {
    $tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path -LiteralPath $tailscale) { & $tailscale serve --https=8787 off | Out-Null }
    $flag = Join-Path $rootFull 'config\remote-enabled'
    Remove-Item -LiteralPath $flag -ErrorAction SilentlyContinue
    $key = Router-Key $rootFull
    Stop-Brain $rootFull
    Start-Brain $rootFull $node $key
    Test-Brain $rootFull
    Write-Host 'BRAINHUB_UNPAIR_OK'
    exit 0
}
if ($Action -eq 'Backup') {
    $key = Router-Key $rootFull
    Stop-Brain $rootFull
    try { Backup-Brain $rootFull | Out-Null }
    finally { Start-Brain $rootFull $node $key -AcceptLegacy }
    exit 0
}
if ($Action -eq 'Restore') {
    $backupRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $rootFull) 'BrainHubBackups'))
    $resolved = (Resolve-Path -LiteralPath $BackupPath).Path
    if (-not $resolved.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Restore yolu BrainHubBackups icinde olmali.' }
    $key = Router-Key $rootFull
    Stop-Brain $rootFull
    foreach ($name in @('server','config','data','START-BrainHub.ps1','manage.ps1','INSTALL.ps1','UPDATE.ps1','START.ps1','TEST.ps1','BACKUP.ps1','RESTORE.ps1','PAIR.ps1','UNPAIR.ps1','VISION-FREE-SETUP.ps1','VISION-STATUS.ps1','OPENROUTER-SETUP.ps1','OPENROUTER-STATUS.ps1','OPENROUTER-CREDIT-SETUP.ps1','JEV-PROBE.ps1')) {
        $p = Join-Path $resolved $name
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $rootFull -Recurse -Force }
    }
    Start-Brain $rootFull $node $key
    Test-Brain $rootFull
    exit 0
}
if ($Action -eq 'Start') { Start-Brain $rootFull $node (Router-Key $rootFull); Test-Brain $rootFull; exit 0 }

$sourceDir = Get-Source $Source
# CLAUDE_V109_UPDATER_FILESET: ChatGPT v9.5.109 wait-condition.js ve vision-benchmark.js eklemis ama bu listeye
# koymamisti -> PC'de server.js MODULE_NOT_FOUND ile acilmaz, guncelleme geri alinirdi.
$files = @('server.js','scanner.js','leader-committee.js','leader-live-intent.js','engine.js','market.js','pipeline.js','store.js','risk-gate.js','binance-dry-run-executor.js','binance-account-context.js','live-authorization.js','binance-live-transport.js','live-controller.js','position-manager.js','jev-decision.js','plan-workers.js','openrouter-free-worker.js','wait-condition.js','vision-benchmark.js','claude-v109.js','trade-lanes.js','v110.js','claude-v111.js','claude-v112.js')
foreach ($name in $files) {
    $p = Join-Path $sourceDir $name
    if (-not (Test-Path -LiteralPath $p)) { throw "Eksik dosya: $name" }
    & $node --check $p
    if ($LASTEXITCODE -ne 0) { throw "Node syntax hatasi: $name" }
}
$testDir = Join-Path $sourceDir 'test'
if (Test-Path -LiteralPath $testDir) {
    foreach ($testFile in @(Get-ChildItem -LiteralPath $testDir -Filter '*.test.js' -File | Sort-Object Name)) {
        Write-Host "UNIT_TEST $($testFile.Name)"
        & $node --test $testFile.FullName
        if ($LASTEXITCODE -ne 0) { throw "Node unit test hatasi: $($testFile.Name)" }
    }
}
$key = Router-Key $rootFull
New-Item -ItemType Directory -Force -Path (Join-Path $rootFull 'server'),(Join-Path $rootFull 'config'),(Join-Path $rootFull 'data'),(Join-Path $rootFull 'logs') | Out-Null
$wasRunning = [bool](Brain-Pid $rootFull)
if ($wasRunning) { Stop-Brain $rootFull }
$backup = Backup-Brain $rootFull
try {
    foreach ($name in $files) { Copy-Item -LiteralPath (Join-Path $sourceDir $name) -Destination (Join-Path $rootFull 'server') -Force }
    foreach ($cfg in @(@('models.example.json','models.json'),@('committee.example.json','committee.json'),@('claude-v109.example.json','claude-v109.json'),@('claude-v111.example.json','claude-v111.json'))) {
        $dst = Join-Path (Join-Path $rootFull 'config') $cfg[1]
        if (-not (Test-Path -LiteralPath $dst)) { Copy-Item -LiteralPath (Join-Path $sourceDir $cfg[0]) -Destination $dst }
    }
    foreach ($script in @('manage.ps1','START-BrainHub.ps1','INSTALL.ps1','UPDATE.ps1','START.ps1','TEST.ps1','BACKUP.ps1','RESTORE.ps1','PAIR.ps1','UNPAIR.ps1','VISION-FREE-SETUP.ps1','VISION-STATUS.ps1','OPENROUTER-SETUP.ps1','OPENROUTER-STATUS.ps1','OPENROUTER-CREDIT-SETUP.ps1','JEV-PROBE.ps1','VISION-BENCHMARK.ps1')) {
        Copy-Item -LiteralPath (Join-Path $sourceDir $script) -Destination $rootFull -Force
    }
    # CLAUDE_V109_OFFICE_DASHBOARD: salt-okunur Trade Office ekrani (ayri surec; Brain Hub'a gomulu degil).
    $officeSrc = Join-Path $sourceDir 'office-dashboard'
    if (Test-Path -LiteralPath $officeSrc) {
        $officeDst = Join-Path $rootFull 'office-dashboard'
        New-Item -ItemType Directory -Force -Path $officeDst | Out-Null
        Copy-Item -Path (Join-Path $officeSrc '*') -Destination $officeDst -Recurse -Force
        Write-Host "OFFICE_DASHBOARD_DEPLOYED $officeDst (baslatmak icin: office-dashboard\START-OFFICE.ps1)"
    }
    Migrate-JevBudgetPolicy $rootFull
    Start-Brain $rootFull $node $key
    Test-Brain $rootFull -IncludeDeep:$Deep
    Write-Host "BRAINHUB_$($Action.ToUpperInvariant())_OK backup=$backup"
} catch {
    Write-Warning "Update dogrulanamadi: $($_.Exception.Message). Geri alma deneniyor."
    Stop-Brain $rootFull
    foreach ($name in @('server','config','data','START-BrainHub.ps1','manage.ps1','INSTALL.ps1','UPDATE.ps1','START.ps1','TEST.ps1','BACKUP.ps1','RESTORE.ps1','PAIR.ps1','UNPAIR.ps1','VISION-FREE-SETUP.ps1','VISION-STATUS.ps1','OPENROUTER-SETUP.ps1','OPENROUTER-STATUS.ps1','OPENROUTER-CREDIT-SETUP.ps1','JEV-PROBE.ps1')) {
        $p = Join-Path $backup $name
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $rootFull -Recurse -Force }
    }
    if ($wasRunning) { Start-Brain $rootFull $node $key -AcceptLegacy }
    throw
}
