$ErrorActionPreference = 'Stop'

$root = 'C:\BrainHub'
$serverDir = Join-Path $root 'server'
$serverPath = Join-Path $serverDir 'server.js'
$bridgePath = Join-Path $serverDir 'leader-committee.js'

if (-not (Test-Path $serverPath)) {
    throw "BrainHub server.js not found: $serverPath"
}

$rawBase = 'https://raw.githubusercontent.com/goxel1907/antik-harita-turkiye/futures15m-alarm-public-build/brainhub'
Invoke-WebRequest -UseBasicParsing -Uri ($rawBase + '/leader-committee.js') -OutFile $bridgePath

$s = Get-Content $serverPath -Raw
$changed = $false

$requireLine = "const leaderCommittee=require('./leader-committee');"
if (-not $s.Contains($requireLine)) {
    $anchor = "const scanner=require('./scanner');"
    if (-not $s.Contains($anchor)) {
        throw 'scanner require anchor not found; install scanner first'
    }
    $s = $s.Replace($anchor, $anchor + [Environment]::NewLine + $requireLine)
    $changed = $true
}

$routeNeedle = "u.pathname==='/leader/committee'"
if (-not $s.Contains($routeNeedle)) {
    $marker = "    return send(res,404,{ok:false,error:'not found'});"
    if (-not $s.Contains($marker)) {
        throw 'server.js route marker not found'
    }

    $route = @"
    if(req.method==='GET'&&u.pathname==='/leader/committee'){
      try{
        const scan=await scanner.scan();
        const out=await leaderCommittee.run({scan,port:PORT});
        return send(res,200,out);
      }catch(e){
        log('LEADER COMMITTEE FAIL '+String(e.message||e));
        return send(res,503,{ok:false,error:'leader committee failed',detail:String(e.message||e)});
      }
    }

"@
    $s = $s.Replace($marker, $route + $marker)
    $changed = $true
}

if ($changed) {
    Copy-Item $serverPath ($serverPath + '.leader-committee.bak') -Force
    Set-Content -Path $serverPath -Value $s -Encoding UTF8
}

& node --check $bridgePath
if ($LASTEXITCODE -ne 0) {
    throw 'leader-committee.js node --check failed'
}

& node --check $serverPath
if ($LASTEXITCODE -ne 0) {
    throw 'server.js node --check failed'
}

Write-Host 'BRAINHUB_LEADER_COMMITTEE_PATCH_OK'
