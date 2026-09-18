param(
    [ValidateSet('Install','Update','Start','Test','Backup','Restore','Pair','Unpair','VisionSetup','VisionStatus','LiveSetup','LiveStatus','LiveArm','LiveDisarm')][string]$Action = 'Update',
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
    $binanceApiKey = Read-Dpapi (Join-Path $BrainRoot 'config\binance-api-key.dpapi')
    $binanceApiSecret = Read-Dpapi (Join-Path $BrainRoot 'config\binance-api-secret.dpapi')
    if ($binanceApiKey -and $binanceApiSecret) {
        $env:BRAINHUB_BINANCE_API_KEY = $binanceApiKey
        $env:BRAINHUB_BINANCE_API_SECRET = $binanceApiSecret
    }
    $openRouterApiKey = Read-Dpapi (Join-Path $BrainRoot 'config\openrouter-api-key.dpapi')
    if ($openRouterApiKey) { $env:BRAINHUB_OPENROUTER_API_KEY = $openRouterApiKey }
    $proc = $null
    try {
        $proc = Start-Process -FilePath $Node -ArgumentList @((Join-Path $BrainRoot 'server\server.js')) -WorkingDirectory $BrainRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    } finally {
        Remove-Item Env:BRAINHUB_ROUTER_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_CLIENT_TOKEN -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_BINANCE_API_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_BINANCE_API_SECRET -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_OPENROUTER_API_KEY -ErrorAction SilentlyContinue
        $binanceApiKey = ''
        $binanceApiSecret = ''
        $openRouterApiKey = ''
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
    if (-not $h.featureVersion -or -not ($h.features -contains 'UNIFIED_9TF') -or -not ($h.features -contains 'CHART_PNG_CLEAN') -or -not ($h.features -contains 'VISION_CAPABILITY_FALLBACK') -or -not ($h.features -contains 'VISION_PROBE') -or -not ($h.features -contains 'OPENROUTER_FREE_VISION_FALLBACK') -or -not ($h.features -contains 'LIVE_FAIL_CLOSED')) { throw 'v9.5.95 BrainHub Vision/OpenRouter feature set eksik.' }
    $live = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers $headers -TimeoutSec 5
    if (-not $live.ok -or $live.armed) { throw 'LIVE fail-closed baslangic testi gecmedi.' }
    $routes = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/models/routes' -Headers $headers -TimeoutSec 8
    if (-not $routes.ok -or -not $routes.freeFirst -or -not $routes.kiroJudgeOnly -or $null -eq $routes.visionKiroFallback) { throw '9Router rol/Vision yonlendirme testi gecmedi.' }
    if ($null -eq $routes.roles.SCALP -or @($routes.roles.SCALP).Count -lt 1) { throw '9Router SCALP rol rotasi eksik.' }
    if ((@($routes.roles.SCALP) -join '|') -ne (@($routes.roles.FAST) -join '|')) { throw 'SCALP rotasi FAST ile ayni hizli model havuzunu kullanmiyor.' }
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
        try {
            $plan = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/leader/plan' -Headers $headers -TimeoutSec 180
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
        try {
            $oc = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/opencode/status' -Headers $headers -TimeoutSec 15
            Write-Host "VISION_FREE_PROVIDER ok=$($oc.ok) openRouterConfigured=$($oc.openRouterConfigured) fallback=$($oc.fallbackModel)"
        } catch {
            Write-Host 'VISION_FREE_PROVIDER durumu okunamadi. 9TF Vision fallback fail-closed kalacak.' -ForegroundColor Yellow
        }
        try {
            $vision = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/vision/probe?symbol=BTCUSDT' -Headers $headers -TimeoutSec 240
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
        Write-Host "VISION model=$($vision.model) mode=$($vision.mode) charts=$($vision.vision.attached)/9 degraded=$($vision.degraded)"
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
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/goxel1907/antik-harita-turkiye/archive/refs/heads/futures15m-alarm-public-build.zip' -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $tempDir
    $dir = Get-ChildItem -LiteralPath $tempDir -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'brainhub\server.js') } | Select-Object -First 1
    if (-not $dir) { throw 'Indirilen arsivde BrainHub bulunamadi.' }
    return (Join-Path $dir.FullName 'brainhub')
}
function Backup-Brain([string]$BrainRoot) {
    $parent = Split-Path -Parent $BrainRoot
    $targetRoot = Join-Path $parent 'BrainHubBackups'
    New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
    $target = Join-Path $targetRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    foreach ($name in @('server','config','data','START-BrainHub.ps1','manage.ps1','INSTALL.ps1','UPDATE.ps1','START.ps1','TEST.ps1','BACKUP.ps1','RESTORE.ps1','PAIR.ps1','UNPAIR.ps1')) {
        $p = Join-Path $BrainRoot $name
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $target -Recurse -Force }
    }
    Write-Host "BACKUP_OK $target"
    return $target
}

$rootFull = [IO.Path]::GetFullPath($Root)
$node = Resolve-Node
if ($Action -eq 'Test') { Test-Brain $rootFull -IncludeDeep:$Deep; exit 0 }
if ($Action -eq 'VisionStatus') {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/opencode/status' -Headers (Auth-Headers $rootFull) -TimeoutSec 10
    $status | ConvertTo-Json -Depth 6
    exit 0
}
if ($Action -eq 'VisionSetup') {
    $apiKeySecure = Read-Host 'OpenRouter API Key (gizli giris; free Vision router icin)' -AsSecureString
    $apiKey = Secure-ToPlain $apiKeySecure
    if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey.Trim().Length -lt 16) { throw 'OpenRouter API key gecersiz.' }
    Save-Dpapi (Join-Path $rootFull 'config\openrouter-api-key.dpapi') $apiKey.Trim()
    $apiKey = ''
    $key = Router-Key $rootFull
    Stop-Brain $rootFull
    Start-Brain $rootFull $node $key
    Test-Brain $rootFull
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/opencode/status' -Headers (Auth-Headers $rootFull) -TimeoutSec 10
    if (-not $status.openRouterConfigured) { throw 'OpenRouter Vision anahtari kaydedildi ancak BrainHub tarafinda aktif gorunmuyor.' }
    Write-Host "BRAINHUB_VISION_SETUP_OK configured=$($status.openRouterConfigured) model=$($status.fallbackModel)"
    exit 0
}
if ($Action -eq 'LiveStatus') {
    $live = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/status' -Headers (Auth-Headers $rootFull) -TimeoutSec 5
    $live | ConvertTo-Json -Depth 6
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
    foreach ($name in @('server','config','data','START-BrainHub.ps1','manage.ps1','INSTALL.ps1','UPDATE.ps1','START.ps1','TEST.ps1','BACKUP.ps1','RESTORE.ps1','PAIR.ps1','UNPAIR.ps1')) {
        $p = Join-Path $resolved $name
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $rootFull -Recurse -Force }
    }
    Start-Brain $rootFull $node $key
    Test-Brain $rootFull
    exit 0
}
if ($Action -eq 'Start') { Start-Brain $rootFull $node (Router-Key $rootFull); Test-Brain $rootFull; exit 0 }

$sourceDir = Get-Source $Source
$requiredFiles = @('server.js','scanner.js','leader-committee.js','leader-live-intent.js','engine.js','market.js','pipeline.js','store.js','risk-gate.js','binance-dry-run-executor.js','binance-account-context.js','live-authorization.js','binance-live-transport.js','live-controller.js')
foreach ($name in $requiredFiles) {
    $p = Join-Path $sourceDir $name
    if (-not (Test-Path -LiteralPath $p)) { throw "Eksik dosya: $name" }
}
$files = @(Get-ChildItem -LiteralPath $sourceDir -Filter '*.js' -File | Sort-Object Name | Select-Object -ExpandProperty Name)
foreach ($name in $files) {
    $p = Join-Path $sourceDir $name
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
    foreach ($cfg in @(@('models.example.json','models.json'),@('committee.example.json','committee.json'))) {
        $dst = Join-Path (Join-Path $rootFull 'config') $cfg[1]
        if (-not (Test-Path -LiteralPath $dst)) { Copy-Item -LiteralPath (Join-Path $sourceDir $cfg[0]) -Destination $dst }
    }
    foreach ($script in @('manage.ps1','START-BrainHub.ps1','INSTALL.ps1','UPDATE.ps1','START.ps1','TEST.ps1','BACKUP.ps1','RESTORE.ps1','PAIR.ps1','UNPAIR.ps1')) {
        Copy-Item -LiteralPath (Join-Path $sourceDir $script) -Destination $rootFull -Force
    }
    Start-Brain $rootFull $node $key
    Test-Brain $rootFull -IncludeDeep:$Deep
    Write-Host "BRAINHUB_$($Action.ToUpperInvariant())_OK backup=$backup"
} catch {
    Write-Warning "Update dogrulanamadi: $($_.Exception.Message). Geri alma deneniyor."
    Stop-Brain $rootFull
    foreach ($name in @('server','config','data','START-BrainHub.ps1','manage.ps1','INSTALL.ps1','UPDATE.ps1','START.ps1','TEST.ps1','BACKUP.ps1','RESTORE.ps1','PAIR.ps1','UNPAIR.ps1')) {
        $p = Join-Path $backup $name
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $rootFull -Recurse -Force }
    }
    if ($wasRunning) { Start-Brain $rootFull $node $key -AcceptLegacy }
    throw
}
