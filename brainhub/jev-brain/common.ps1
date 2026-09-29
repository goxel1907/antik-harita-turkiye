# JEV-Brain ortak tanimlar (CLAUDE_R2544_12_JEV_BRAIN). Diger betikler dot-source eder.
$J      = 'C:\JEV-Brain'
$RT     = "$J\runtime"
$BK     = "$J\BrainHubBackups"
$SRC    = "$J\source"        # PC kaynak kodu (bagimsiz git klonu, dal r2544-claude-panel-guard)
$APK    = "$J\apk-source"    # Android/APK kaynagi (bagimsiz git klonu, dal futures15m-alarm-public-build; Codemagic bu daldan derler)
$OLD    = 'C:\BrainHub'
$OLDBK  = 'C:\BrainHubBackups'
$OLDWT  = 'C:\BrainHub\_work_r2543_obs_20260928-211718'   # ESKI gelistirme kopyasi (arsiv, KULLANILMAZ)
# ESKI yerler (CLAUDE_R2544_13): yalniz ilk klonlama yedegi icin; gunluk islerde KULLANILMAZ.
$REPO   = 'C:\Users\adm\Documents\Codex\2026-09-26\referenced-chatgpt-conversation-this-is-an\work\repo'
$OLDPUB = 'C:\Users\adm\Documents\Codex\2026-09-28\referenced-chatgpt-conversation-this-is-an\work\public-release'
$PUB    = $APK
$GITHUB = 'https://github.com/goxel1907/antik-harita-turkiye.git'
$BRANCH = 'r2544-claude-panel-guard'
$PUBBRANCH = 'futures15m-alarm-public-build'
$env:GIT_REDIRECT_STDERR = '2>&1'

function Assert-Admin {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Bu betigi YONETICI olarak calistirin (sag tik > Yonetici olarak calistir).' }
}
function Invoke-Git([string]$Dir) {
    $out = & git.exe -c safe.directory=* -C $Dir @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git hatasi ($Dir): $($args -join ' '): $out" }
    return ($out | Out-String).Trim()
}
function Read-Dpapi([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $secure = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Core-Headers([string]$Root) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root 'config\remote-enabled'))) { return @{} }
    $t = Read-Dpapi (Join-Path $Root 'config\client-token.dpapi')
    if ($t) { return @{ Authorization = "Bearer $t" } }
    return @{}
}
function Open-Positions([string]$Root) {
    # Donus: $null = core'a ulasilamadi; aksi halde acik pozisyon sembolleri dizisi.
    try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/live/positions?limit=1' -Headers (Core-Headers $Root) -TimeoutSec 8 }
    catch { return $null }
    $open = @()
    if ($r -and $r.PSObject.Properties['open'] -and $r.open) { $open = @($r.open) }
    return ,@($open | ForEach-Object { "$($_.symbol) $($_.side)" })   # virgul: bos dizi $null'a donusmesin
}
function Core-Pid([string]$Root) {
    $expected = Join-Path $Root 'server\server.js'
    $m = @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($expected) })
    if ($m.Count -gt 1) { throw "Birden fazla core sureci ($expected); dokunulmadi." }
    if ($m.Count -eq 1) { return [int]$m[0].ProcessId }
    return $null
}
function Port-Owner([int]$Port) {
    $l = @(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($l.Count -eq 0) { return $null }
    $ids = @($l | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($ids.Count -ne 1) { throw "$Port portu sahibi belirsiz; dokunulmadi." }
    return [int]$ids[0]
}
function Stop-Core([string]$Root) {
    $id = Core-Pid $Root
    if (-not $id) {
        $owner = Port-Owner 8787
        if ($owner) {
            $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -Headers (Core-Headers $Root) -TimeoutSec 5
            $proc = Get-Process -Id $owner -ErrorAction Stop
            if ($proc.ProcessName -ne 'node' -or -not $h.ok -or $h.version -ne 'brainhub-pro-1') { throw '8787 sahibi BrainHub olarak dogrulanamadi; dokunulmadi.' }
            $id = $owner
        }
    }
    if (-not $id) { Write-Host "CORE_ZATEN_KAPALI $Root"; return }
    Stop-Process -Id $id -Force
    for ($i = 0; $i -lt 40; $i++) {
        if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue) -and -not (Port-Owner 8787)) { Write-Host "CORE_DURDU pid=$id"; return }
        Start-Sleep -Milliseconds 300
    }
    throw 'Core 8787 portunu birakmadi.'
}
function Robo([string]$From, [string]$To, [string[]]$Extra = @()) {
    if (-not (Test-Path -LiteralPath $From)) { Write-Host "ATLANDI (yok): $From"; return }
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    & robocopy $From $To /E /COPY:DAT /R:2 /W:1 /NFL /NDL /NP /NJH @Extra | Out-Host
    if ($LASTEXITCODE -ge 8) { throw "robocopy hatasi $LASTEXITCODE : $From -> $To" }
    $global:LASTEXITCODE = 0
}
function Start-Office([string]$Root, [string]$Backups) {
    $office = Join-Path $Root 'office-dashboard'
    $args2 = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $office 'START-OFFICE.ps1'),'-NoBrowser','-BrainRoot',$Root,'-BackupRoot',$Backups)
    if (Test-Path -LiteralPath (Join-Path $office 'office-key.txt')) { $args2 += '-Tailnet' }
    & powershell @args2
}
function Stop-Office([string]$Root) {
    $stop = Join-Path $Root 'office-dashboard\STOP-OFFICE.ps1'
    if (Test-Path -LiteralPath $stop) {
        try { & powershell -NoProfile -ExecutionPolicy Bypass -File $stop } catch { Write-Warning "Office durdurma: $($_.Exception.Message)" }
    }
}
function Ensure-Clone([string]$From, [string]$To, [string]$Branch, [string]$OldRemote) {
    # Bagimsiz klon: C:\JEV-Brain disindaki hicbir klasore (worktree yolu vb.) bagli degildir.
    if (Test-Path -LiteralPath (Join-Path $To '.git')) { return }
    Write-Warning "$To yok; $From klonlaniyor."
    Invoke-Git $J -c core.autocrlf=true clone --branch $Branch $From $To | Out-Host
    Invoke-Git $To config core.autocrlf true | Out-Null
    Invoke-Git $To remote rename origin $OldRemote | Out-Null
    Invoke-Git $To remote add origin $GITHUB | Out-Null
}
