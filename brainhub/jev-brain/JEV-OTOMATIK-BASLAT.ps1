# R2544.101 JEV-Brain otomatik baslatma + R2544.181 (kullanici 16.11: "pc yi kapatip acinca sistem otomatik kendiliginden kaldigi
# yerden baslamali"). Windows oturumu acilinca Baslangic klasorundeki kisayol bunu gizli pencerede calistirir.
#   Sira: 9Router (yalniz 127.0.0.1) -> cekirdek 8787 (manage.ps1 Start) -> Office 8790. Calisan bir parcaya dokunmaz.
#   HER MODDA baslatir. CANLI'ya donus bu betigin isi degil: cekirdek, kullanicinin acik biraktigi otomatik yenileme kaydi
#   (liveAutoRun=true) varsa ayni Binance kontrolunden gecerek KENDILIGINDEN devam eder (R2544.78 liveRenewTick, "PC restarted:
#   arm again"). Otomatik yenileme kapaliysa CANLI kendiliginden ACILMAZ (fail-closed, uyari cikar). Arm / OTO / mod dosyasina dokunmaz.
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

# 1) mod: yalniz bilgi (R2544.181: her modda baslatilir; CANLI devami cekirdegin kendi otomatik yenilemesidir)
$modeFile = Join-Path $runtime 'config\trading-mode.json'
$mode = $null; $liveAuto = $false
try { $tm = Get-Content -Raw -Path $modeFile -Encoding utf8 | ConvertFrom-Json; $mode = $tm.mode; $liveAuto = ($tm.liveAutoRun -eq $true) } catch {}
Say "mod: $mode - otomatik yenileme: $liveAuto"
$warnLiveOff = ($mode -eq 'LIVE' -and -not $liveAuto)
if ($mode -eq 'LIVE' -and $liveAuto) { Say 'CANLI + otomatik yenileme ACIK: parcalar baslatilir, cekirdek Binance kontrolunden gecip CANLI yi KENDILIGINDEN surdurur (kullanicinin acik biraktigi karar).' }
if ($warnLiveOff) { Say 'CANLI ama otomatik yenileme KAPALI: parcalar baslatilir, CANLI kendiliginden ACILMAZ; acmak kullanicinin onayidir (Office / JEV-BASLAT.cmd).' }

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
if ($warnLiveOff -and -not $DryRun) {
    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("JEV-Brain parcalari baslatildi; CANLI otomatik yenileme KAPALI oldugu icin CANLI kendiliginden ACILMADI.`nAcmak istiyorsan: Office 8790 ya da C:\JEV-Brain\JEV-BASLAT.cmd (GERCEK PARA).", 'JEV-Brain - CANLI onayi gerekli', 'OK', 'Warning') | Out-Null
    } catch {}
}
Say 'bitti'
