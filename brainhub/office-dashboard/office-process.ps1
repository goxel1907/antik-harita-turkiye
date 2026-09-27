# Identity-checked loopback lookup also works when Windows hides CommandLine.
function Find-OfficeProcess([string]$OfficeRoot, [int]$Port) {
    $expected = Join-Path $OfficeRoot 'office-server.js'
    $matches = @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($expected) })
    if ($matches.Count -gt 1) { throw 'Birden fazla Office sureci var; dokunulmadi.' }
    if ($matches.Count -eq 1) { return [int]$matches[0].ProcessId }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $null }
    $ids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($ids.Count -ne 1) { throw 'Office port sahibi belirsiz; dokunulmadi.' }
    $owner = Get-Process -Id $ids[0] -ErrorAction Stop
    $headers = @{}
    $keyPath = Join-Path $OfficeRoot 'office-key.txt'
    if (Test-Path -LiteralPath $keyPath) { $headers['x-office-key'] = (Get-Content -LiteralPath $keyPath -Raw).Trim() }
    $ping = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/ping" -Headers $headers -TimeoutSec 5
    if ($owner.ProcessName -ne 'node' -or -not $ping.ok -or $ping.officeVersion -notmatch 'JEV|OFFICE|Office') { throw 'Port sahibi Office olarak dogrulanamadi; dokunulmadi.' }
    return [int]$ids[0]
}
