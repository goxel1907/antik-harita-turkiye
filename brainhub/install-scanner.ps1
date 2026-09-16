$ErrorActionPreference = 'Stop'

$root = 'C:\BrainHub'
$serverDir = Join-Path $root 'server'
$serverPath = Join-Path $serverDir 'server.js'
$scannerPath = Join-Path $serverDir 'scanner.js'

if (-not (Test-Path $serverPath)) {
    throw "BrainHub server.js not found: $serverPath"
}

$rawBase = 'https://raw.githubusercontent.com/goxel1907/antik-harita-turkiye/futures15m-alarm-public-build/brainhub'
Invoke-WebRequest -UseBasicParsing -Uri ($rawBase + '/scanner.js') -OutFile $scannerPath

$s = Get-Content $serverPath -Raw
$changed = $false

$requireLine = "const scanner=require('./scanner');"
if (-not $s.Contains($requireLine)) {
    $anchor = "const path=require('path');"
    if (-not $s.Contains($anchor)) {
        throw 'server.js require anchor not found'
    }
    $s = $s.Replace($anchor, $anchor + [Environment]::NewLine + $requireLine)
    $changed = $true
}

$routeNeedle = "u.pathname==='/scanner'"
if (-not $s.Contains($routeNeedle)) {
    $marker = "    return send(res,404,{ok:false,error:'not found'});"
    if (-not $s.Contains($marker)) {
        throw 'server.js route marker not found'
    }

    $route = @"
    if(req.method==='GET'&&u.pathname==='/scanner'){
      try{
        const out=await scanner.scan();
        return send(res,200,out);
      }catch(e){
        log('SCANNER FAIL '+String(e.message||e));
        return send(res,503,{ok:false,error:'scanner failed',detail:String(e.message||e)});
      }
    }

"@
    $s = $s.Replace($marker, $route + $marker)
    $changed = $true
}

if ($changed) {
    Copy-Item $serverPath ($serverPath + '.scanner.bak') -Force
    Set-Content -Path $serverPath -Value $s -Encoding UTF8
}

& node --check $serverPath
if ($LASTEXITCODE -ne 0) {
    throw 'node --check failed'
}

Write-Host 'BRAINHUB_SCANNER_PATCH_OK'
