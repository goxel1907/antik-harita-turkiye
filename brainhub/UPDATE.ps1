$ErrorActionPreference = 'Stop'

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$tempManage = Join-Path $env:TEMP ("brainhub-manage-latest-" + $stamp + ".ps1")
$headers = @{
    'User-Agent' = 'BrainHub-Updater'
    'Cache-Control' = 'no-cache'
    'Pragma' = 'no-cache'
}

try {
    $branchUri = 'https://api.github.com/repos/goxel1907/antik-harita-turkiye/branches/futures15m-alarm-public-build'
    $branchMeta = Invoke-RestMethod -Uri $branchUri -Headers $headers -TimeoutSec 30
    $headSha = ([string]$branchMeta.commit.sha).Trim().ToLowerInvariant()
    if ($headSha -notmatch '^[0-9a-f]{40}$') {
        throw 'GitHub branch HEAD SHA dogrulanamadi.'
    }

    $uri = "https://raw.githubusercontent.com/goxel1907/antik-harita-turkiye/$headSha/brainhub/manage.ps1?v=$stamp"
    Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -TimeoutSec 60 -OutFile $tempManage
    Unblock-File -LiteralPath $tempManage -ErrorAction SilentlyContinue

    $text = Get-Content -LiteralPath $tempManage -Raw
    if (
        $text -notmatch 'SOURCE_HEAD' -or
        $text -notmatch 'KIRO_FREE_QUOTA_VISION_OPT_IN' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_FALLBACK' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_16K' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_32K' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_ONLY' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_TWO_STAGE' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_BATCH3' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_SINGLE_TF' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_COMPACT_FINALIZE' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_TF_CONTRACT' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_SPLIT_GLOBAL' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_PROGRESS' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_SEMANTIC_CONTRACT' -or
        $text -notmatch 'LOCAL_OLLAMA_VISION_DIRECT_PIPELINE' -or
        $text -notmatch 'VISION_CHART_896X504' -or
        $text -notmatch 'VISION_CHART_640X360' -or
        $text -notmatch 'VISION_CHART_448X252' -or
        $text -notmatch 'VISION_PIXEL_PROBE' -or
        $text -notmatch 'KKK_DETAILED_9TF_DIAGNOSTICS' -or
        $text -notmatch 'LEADER_DETAIL_PROBE'
    ) {
        throw 'Guncel BrainHub updater bootstrap isaretleri bulunamadi; eski updater calistirilmadi.'
    }

    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $tempManage,
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null
    if (@($parseErrors).Count -gt 0) {
        $detail = (@($parseErrors) | Select-Object -First 5 | ForEach-Object { $_.Message }) -join ' | '
        throw "Guncel BrainHub manage.ps1 PowerShell parser testini gecmedi: $detail"
    }

    Write-Host "BOOTSTRAP_HEAD $headSha"
    & $tempManage -Action Update @args
}
finally {
    Remove-Item -LiteralPath $tempManage -Force -ErrorAction SilentlyContinue
}
