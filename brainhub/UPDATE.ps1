$ErrorActionPreference = 'Stop'

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$tempManage = Join-Path $env:TEMP ("brainhub-manage-latest-" + $stamp + ".ps1")
$headers = @{
    'User-Agent' = 'BrainHub-Updater'
    'Cache-Control' = 'no-cache'
    'Pragma' = 'no-cache'
}

try {
    $branchMeta = Invoke-RestMethod -Uri "https://api.github.com/repos/goxel1907/antik-harita-turkiye/commits/futures15m-alarm-public-build?v=$stamp" -Headers $headers -TimeoutSec 30
    $headSha = ([string]$branchMeta.sha).Trim().ToLowerInvariant()
    if ($headSha -notmatch '^[0-9a-f]{40}
    Unblock-File -LiteralPath $tempManage -ErrorAction SilentlyContinue

    $text = Get-Content -LiteralPath $tempManage -Raw
    if ($text -notmatch 'SOURCE_HEAD' -or $text -notmatch 'KIRO_FREE_QUOTA_VISION_OPT_IN' -or $text -notmatch 'VISION_PIXEL_PROBE' -or $text -notmatch 'KKK_DETAILED_9TF_DIAGNOSTICS' -or $text -notmatch 'LEADER_DETAIL_PROBE') {
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
) { throw 'GitHub branch HEAD SHA dogrulanamadi.' }
    $uri = "https://raw.githubusercontent.com/goxel1907/antik-harita-turkiye/$headSha/brainhub/manage.ps1?v=$stamp"
    Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -TimeoutSec 60 -OutFile $tempManage
    Unblock-File -LiteralPath $tempManage -ErrorAction SilentlyContinue

    $text = Get-Content -LiteralPath $tempManage -Raw
    if ($text -notmatch 'SOURCE_HEAD' -or $text -notmatch 'KIRO_FREE_QUOTA_VISION_OPT_IN' -or $text -notmatch 'VISION_PIXEL_PROBE' -or $text -notmatch 'KKK_DETAILED_9TF_DIAGNOSTICS' -or $text -notmatch 'LEADER_DETAIL_PROBE') {
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
