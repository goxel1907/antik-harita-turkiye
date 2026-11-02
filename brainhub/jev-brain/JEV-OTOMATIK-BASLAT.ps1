# R2544.101 JEV-Brain otomatik baslatma (kullanici 02.11: "bilgisayar yeniden kapanip acilirsa sistem yine durur ... yap; canliya
# sadece bariz onay istesin"). Windows oturumu acilinca Baslangic klasorundeki kisayol bunu gizli pencerede calistirir.
#   Sira: 9Router (yalniz 127.0.0.1) -> cekirdek 8787 (manage.ps1 Start) -> Office 8790. Calisan bir parcaya dokunmaz.
#   Yalniz mod TEST ise baslatir. Mod CANLI ise HICBIR SEY baslatmaz; ekrana acik bir uyari cikar, baslatmak kullanicinin
#   JEV-BASLAT.cmd onayidir. CANLI'ya asla kendiliginden gecmez; arm / OTO / mod dosyasina dokunmaz.
#   -DryRun: yalniz ne yapacagini yazar (deneme).
param([switch]$DryRun, [string]$Root = 'C:\JEV-Brain', [int]$WaitNetworkSec = 120)
$ErrorActionPreference = 'Continue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$runtime = Join-Path $Root 'runtime'
$logDir = Join-Path $Root 'logs'; New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ('otobaslat-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
function Say([string]$m) { $line = (Get-Date -Format 'HH:mm:ss') + ' ' + $m; Add-Content -Path $log -Value $line -Encoding utf8; Write-Output $line }
function Listening([int]$port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }
function WaitPort([int]$port, [int]$sec) { for ($i = 0; $i -lt $sec; $i += 2) { if (Listening $port) { return $true }; Start-Sleep -Seconds 2 }; return (Listening $port) }

Say ("JEV otomatik baslatma" + ($(if ($DryRun) { ' (DENEME, hicbir sey baslatilmaz)' } else { '' })))

# 1) mod: yalniz TEST
$modeFile = Join-Path $runtime 'config\trading-mode.json'
$mode = $null
try { $mode = (Get-Content -Raw -Path $modeFile -Encoding utf8 | ConvertFrom-Json).mode } catch { $mode = $null }
Say "mod: $mode"
if ($mode -ne 'TEST') {
    Say 'Mod TEST degil (CANLI ya da okunamadi): hicbir sey baslatilmadi. Baslatmak icin JEV-BASLAT.cmd (senin onayin).'
    if (-not $DryRun) {
        try {
            Add-Type -AssemblyName PresentationFramework
            [System.Windows.MessageBox]::Show("JEV-Brain CANLI modda kapanmisti (ya da mod okunamadi).`n`nGuvenlik icin kendiliginden BASLATILMADI.`nBaslatmak istiyorsan: C:\JEV-Brain\JEV-BASLAT.cmd (GERCEK PARA).", 'JEV-Brain - CANLI onayi gerekli', 'OK', 'Warning') | Out-Null
        } catch {}
    }
    exit 0
}

# 2) ag: Binance'e ulasilana kadar bekle (en cok WaitNetworkSec)
$net = $false
for ($i = 0; $i -lt $WaitNetworkSec; $i += 5) {
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'https://fapi.binance.com/fapi/v1/time'; if ($r.StatusCode -eq 200) { $net = $true; break } } catch {}
    if ($DryRun) { break }; Start-Sleep -Seconds 5
}
Say "ag: $(if ($net) { 'hazir' } else { 'yanit yok, yine de devam' })"

# 3) 9Router once (kurul modelleri ona bagli), yalniz bu bilgisayardan erisilir
$node = Join-Path $env:LOCALAPPDATA 'OpenClaw\deps\portable-node\node.exe'
$cli = Join-Path $env:LOCALAPPDATA 'OpenClaw\deps\portable-node\node_modules\9router\cli.js'
if (Listening 20128) { Say '9Router zaten calisiyor' }
elseif (-not ((Test-Path $node) -and (Test-Path $cli))) { Say '9Router bulunamadi, atlandi' }
elseif ($DryRun) { Say '9Router baslatilacakti (127.0.0.1:20128)' }
else {
    Start-Process -FilePath $node -ArgumentList @($cli, '--host', '127.0.0.1', '--no-browser', '--skip-update', '--tray') -WindowStyle Hidden
    Say ("9Router baslatildi: " + $(if (WaitPort 20128 90) { 'dinliyor' } else { 'DINLEMIYOR (90 sn)' }))
}

# 4) cekirdek (anahtarlari manage.ps1 kendisi DPAPI'den okur; bu betik okumaz)
if (Listening 8787) { Say 'cekirdek zaten calisiyor' }
elseif ($DryRun) { Say 'cekirdek baslatilacakti (manage.ps1 Start)' }
else {
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $runtime 'manage.ps1'), '-Action', 'Start', '-Root', $runtime) -WindowStyle Hidden
    Say ("cekirdek baslatildi: " + $(if (WaitPort 8787 180) { 'dinliyor' } else { 'DINLEMIYOR (180 sn)' }))
}

# 5) Office
if (Listening 8790) { Say 'Office zaten calisiyor' }
elseif ($DryRun) { Say 'Office baslatilacakti (START-OFFICE.ps1)' }
else {
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $runtime 'office-dashboard\START-OFFICE.ps1'), '-BrainRoot', $runtime, '-BackupRoot', (Join-Path $Root 'BrainHubBackups')) -WindowStyle Hidden
    Say ("Office baslatildi: " + $(if (WaitPort 8790 90) { 'dinliyor' } else { 'DINLEMIYOR (90 sn)' }))
}
Say 'bitti'
