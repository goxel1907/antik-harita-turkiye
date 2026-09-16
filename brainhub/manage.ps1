param(
    [ValidateSet('Install','Update','Start','Test','Backup','Restore','Pair','Unpair')][string]$Action = 'Update',
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
            $v = & $n -p 'process.versions.node.split(".")[0]'
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
function Start-Brain([string]$BrainRoot, [string]$Node, [string]$Key, [switch]$AcceptLegacy) {
    if (Brain-Pid $BrainRoot) { Write-Host 'BrainHub zaten calisiyor.'; return }
    $env:BRAINHUB_ROUTER_KEY = $Key
    $env:BRAINHUB_ROOT = $BrainRoot
    $token = Client-Token $BrainRoot
    if ($token) { $env:BRAINHUB_CLIENT_TOKEN = $token }
    try {
        Start-Process -FilePath $Node -ArgumentList @((Join-Path $BrainRoot 'server\server.js')) -WorkingDirectory $BrainRoot -WindowStyle Hidden | Out-Null
    } finally {
        Remove-Item Env:BRAINHUB_ROUTER_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_ROOT -ErrorAction SilentlyContinue
        Remove-Item Env:BRAINHUB_CLIENT_TOKEN -ErrorAction SilentlyContinue
    }
    for ($i=0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers (Auth-Headers $BrainRoot) -TimeoutSec 2
            if ($h.ok -and ($AcceptLegacy -or $h.version -eq 'brainhub-pro-1')) { return }
        } catch { }
    }
    throw 'BrainHub yeni surumle baslamadi; logs\brainpub.log dosyasina bakin.'
}
function Test-Brain([string]$BrainRoot, [switch]$IncludeDeep) {
    $headers = Auth-Headers $BrainRoot
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers $headers -TimeoutSec 5
    if (-not $h.ok -or $h.version -ne 'brainhub-pro-1') { throw 'Yeni BrainHub health testi gecmedi.' }
    $scan = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/scanner' -Headers $headers -TimeoutSec 90
    if (-not $scan.ok -or $scan.activeUsdtPerpetuals -lt 1) { throw 'Scanner testi gecmedi.' }
    $symbol = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/context/symbol?symbol=BTCUSDT' -Headers $headers -TimeoutSec 60
    if (-not $symbol.ok -or -not $symbol.timeframes.'15m'.available) { throw '15m sembol baglami testi gecmedi.' }
    $global = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/context/global' -Headers $headers -TimeoutSec 90
    if (-not $global.ok -or -not $global.btc.available -or -not $global.eth.available) { throw 'BTC/ETH global baglam testi gecmedi.' }
    $learn = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/learning' -Headers $headers -TimeoutSec 5
    if (-not $learn.ok) { throw 'SQLite learning testi gecmedi.' }
    if ($IncludeDeep) {
        $plan = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/leader/plan' -Headers $headers -TimeoutSec 120
        if (-not $plan.ok -or $plan.execution -ne 'ADVISORY_ONLY' -or $plan.orderPlaced) { throw 'Leader pipeline guvenlik testi gecmedi.' }
        Write-Host "PIPELINE candidate=$($plan.candidateFound) committee=$($plan.committeeCalled)"
    }
    Write-Host "BRAINHUB_TEST_OK models=$($h.configured.total) universe=$($scan.activeUsdtPerpetuals) 15m=$($symbol.timeframes.'15m'.available) sqlite=$($learn.ok)"
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
$files = @('server.js','scanner.js','leader-committee.js','engine.js','market.js','pipeline.js','store.js')
foreach ($name in $files) {
    $p = Join-Path $sourceDir $name
    if (-not (Test-Path -LiteralPath $p)) { throw "Eksik dosya: $name" }
    & $node --check $p
    if ($LASTEXITCODE -ne 0) { throw "Node syntax hatasi: $name" }
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
