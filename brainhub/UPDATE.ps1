$ErrorActionPreference = 'Stop'

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$tempManage = Join-Path $env:TEMP ("brainhub-manage-latest-" + $stamp + ".ps1")
$headers = @{
    'User-Agent' = 'BrainHub-Updater'
    'Cache-Control' = 'no-cache'
    'Pragma' = 'no-cache'
}

try {
    $uri = "https://raw.githubusercontent.com/goxel1907/antik-harita-turkiye/futures15m-alarm-public-build/brainhub/manage.ps1?v=$stamp"
    Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -TimeoutSec 60 -OutFile $tempManage
    Unblock-File -LiteralPath $tempManage -ErrorAction SilentlyContinue

    $text = Get-Content -LiteralPath $tempManage -Raw
    if ($text -notmatch 'SOURCE_HEAD' -or $text -notmatch 'KIRO_FREE_QUOTA_VISION_OPT_IN' -or $text -notmatch 'VISION_PIXEL_PROBE') {
        throw 'Guncel BrainHub updater bootstrap isaretleri bulunamadi; eski updater calistirilmadi.'
    }

    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($tempManage, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if (@($parseErrors).Count -gt 0) {
        $detail = (@($parseErrors) | Select-Object -First 5 | ForEach-Object { $_.Message }) -join ' | '
        throw "Guncel BrainHub manage.ps1 PowerShell parser testini gecmedi: $detail"
    }

    & $tempManage -Action Update @args
}
finally {
    Remove-Item -LiteralPath $tempManage -Force -ErrorAction SilentlyContinue
}
