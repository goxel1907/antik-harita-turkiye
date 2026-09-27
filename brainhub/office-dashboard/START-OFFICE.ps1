# BrainHub Trade Office - başlatıcı (salt-okunur izleme ekranı)
# Kullanım:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\BrainHub\office-dashboard\START-OFFICE.ps1
#   ... -Demo          -> Brain Hub'a bağlanmadan örnek veriyle açar (21 Eylül gerçek sayıları)
#   ... -Sim           -> v9.5.109-CLAUDE panellerinin SİMÜLASYONU (uydurma sayılar, bantta yazar)
#   ... -Tailnet       -> Tailscale üzerinden telefondan açmak için https://<pc>.ts.net:8790 yayını (anahtar zorunlu)
#   ... -NoBrowser     -> tarayıcıyı açmaz
# Bu betik Brain Hub'ı durdurmaz, yeniden başlatmaz, ayarlarını değiştirmez.
param(
    [switch]$Demo,
    [switch]$Sim,
    [switch]$Tailnet,
    [switch]$NoBrowser,
    [int]$Port = 8790,
    [string]$BrainRoot = 'C:\BrainHub',
    [string]$BackupRoot = 'C:\BrainHubBackups'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$here = $PSScriptRoot
$pidFile = Join-Path $here 'office.pid'
$logDir = Join-Path $here 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Resolve-Node {
    $candidates = @((Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue), 'C:\Users\adm\AppData\Local\OpenClaw\deps\portable-node\node.exe')
    foreach ($n in $candidates) {
        if ($n -and (Test-Path -LiteralPath $n)) {
            $v = & $n -p 'parseInt(process.versions.node,10)'
            if ([int]$v -ge 18) { return $n }
        }
    }
    throw 'Node.js 18+ bulunamadi.'
}
function Read-Dpapi([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $secure = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Office-Running {
    return Find-OfficeProcess $here $Port
}

. (Join-Path $here 'office-process.ps1')
$running = Office-Running
$key = ''
$keyFile = Join-Path $here 'office-key.txt'
if ($Tailnet) {
    if (Test-Path -LiteralPath $keyFile) { $key = (Get-Content -LiteralPath $keyFile -Raw).Trim() }
    if (-not $key -or $key.Length -lt 24) {
        $bytes = New-Object byte[] 24
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $key = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
        Set-Content -LiteralPath $keyFile -Value $key -Encoding ASCII
    }
}

if (-not $running) {
    $node = Resolve-Node
    $token = ''
    if (Test-Path -LiteralPath (Join-Path $BrainRoot 'config\remote-enabled')) {
        $token = Read-Dpapi (Join-Path $BrainRoot 'config\client-token.dpapi')
    }
    $env:BRAINHUB_ROOT = $BrainRoot
    $env:BRAINHUB_BACKUP_ROOT = $BackupRoot
    $env:OFFICE_PORT = [string]$Port
    $env:OFFICE_HOST = '127.0.0.1'
    if ($token) { $env:BRAINHUB_CLIENT_TOKEN = $token }
    if ($Demo -or $Sim) { $env:OFFICE_DEMO = '1' }
    if ($key) { $env:OFFICE_KEY = $key }
    try {
        $proc = Start-Process -FilePath $node -ArgumentList @((Join-Path $here 'office-server.js')) -WorkingDirectory $here -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logDir 'office.out.log') -RedirectStandardError (Join-Path $logDir 'office.err.log') -PassThru
        Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII
    } finally {
        foreach ($n in 'BRAINHUB_ROOT','BRAINHUB_BACKUP_ROOT','OFFICE_PORT','OFFICE_HOST','BRAINHUB_CLIENT_TOKEN','OFFICE_DEMO','OFFICE_KEY') {
            Remove-Item "Env:$n" -ErrorAction SilentlyContinue
        }
        $token = ''
    }
    $ok = $false
    $pingUrl = "http://127.0.0.1:$Port/api/ping" + ($(if ($key) { "?key=$key" } else { '' }))
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        try { $r = Invoke-RestMethod -Uri $pingUrl -TimeoutSec 2; if ($r.ok) { $ok = $true; break } } catch {}
    }
    if (-not $ok) { throw "Office baslamadi. Log: $logDir" }
}

$query = @()
if ($key) { $query += "key=$key" }
if ($Sim) { $query += 'demo=sim' }
$url = "http://127.0.0.1:$Port/" + ($(if ($query.Count) { '?' + ($query -join '&') } else { '' }))
if ($Tailnet) {
    $tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    if (-not (Test-Path -LiteralPath $tailscale)) { throw 'Tailscale kurulu degil.' }
    & $tailscale serve --bg --https=$Port --yes "http://127.0.0.1:$Port" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve basarisiz.' }
    $state = (& $tailscale status --json | ConvertFrom-Json)
    $dns = ([string]$state.Self.DNSName).TrimEnd('.')
    $remote = "https://$($dns):$Port/?key=$key"
    Set-Clipboard -Value $remote
    Write-Host "OFFICE_TAILNET_OK $remote (panoya kopyalandi; yalniz kendi Tailscale cihazlarinizdan acilir)"
}
Write-Host "OFFICE_OK $url"
if (-not $NoBrowser) { Start-Process $url }
