$manage = Join-Path $PSScriptRoot 'manage.ps1'
if (-not (Test-Path -LiteralPath $manage)) { throw 'manage.ps1 bulunamadi.' }

# PowerShell 5.1 on Windows can strip the JavaScript quote characters from
# `node -p` arguments such as split("."). Use node --version and parse the
# major version in PowerShell instead. Self-heal older installed manage.ps1
# copies before pairing so future installs do not require manual editing.
$lines = @(Get-Content -LiteralPath $manage)
if ($lines -match '\$v\s*=\s*&\s*\$n\s+-p') {
    $fixed = @($lines | ForEach-Object {
        if ($_ -match '^\s*\$v\s*=\s*&\s*\$n\s+-p') {
            '            $v = (& $n --version).Trim().TrimStart(''v'').Split(''.'')[0]'
        } else {
            $_
        }
    })
    $tmp = "$manage.pairfix.tmp"
    $fixed | Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $manage -Force
    Write-Host 'NODE_CHECK_PATCH_OK'
}

& $manage -Action Pair @args
