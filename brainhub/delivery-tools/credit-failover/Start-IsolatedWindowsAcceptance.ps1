param([string]$BrainRoot='C:\JEV-Brain')
$ErrorActionPreference='Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'NATIVE_WINDOWS_REQUIRED' }
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1) { throw 'WINDOWS_POWERSHELL_5_1_REQUIRED' }
$BrainRoot=[IO.Path]::GetFullPath($BrainRoot)
$SourceRepository=Join-Path $BrainRoot 'source'
$manifestFile=Join-Path $PSScriptRoot 'TESLIM.json'
$bundle=Join-Path $PSScriptRoot 'JEV-credit-fallback.bundle'
if (-not (Test-Path -LiteralPath $manifestFile) -or -not (Test-Path -LiteralPath $bundle)) { throw 'USE_THE_COMPLETE_WINDOWS_ACCEPTANCE_ZIP' }
$manifest=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
foreach ($sha in @($manifest.candidateCommit,$manifest.baseCommit,$manifest.tree)) {
    if ([string]$sha -notmatch '^[a-f0-9]{40}$') { throw 'INVALID_DELIVERY_COMMIT' }
}
if ((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$manifest.bundleSha256) { throw 'BUNDLE_HASH_MISMATCH' }
if (-not (Test-Path -LiteralPath (Join-Path $SourceRepository '.git'))) { throw 'EXISTING_PC_SOURCE_NOT_FOUND' }
$git=(Get-Command git.exe -ErrorAction Stop).Source
$node=(Get-Command node.exe -ErrorAction Stop).Source
if ((& $node --version | Out-String).Trim() -notmatch '^v24\.') { throw 'NODE_24_REQUIRED' }
function Git-Read([string]$Directory,[string[]]$Arguments) {
    $preference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $out=& $git -C $Directory @Arguments 2>&1; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$preference }
    if ($code -ne 0) { throw 'GIT_OPERATION_FAILED_NO_LIVE_CHANGES' }
    return ($out | Out-String).Trim()
}
function Program-Snapshot {
    $files=@()
    foreach ($dir in @((Join-Path $BrainRoot 'runtime\server'),(Join-Path $BrainRoot 'runtime\office-dashboard'))) {
        if (Test-Path -LiteralPath $dir) { $files+=@(Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object {$_.Extension -in @('.js','.html','.ps1','.cmd')}) }
    }
    foreach ($relative in @('BEKLENEN-SURUM.txt','JEV-DEPLOY.ps1','JEV-TEST-DEPLOY.ps1','common.ps1','runtime\config\user-sizing.json')) {
        $p=Join-Path $BrainRoot $relative
        if (Test-Path -LiteralPath $p) { $files+=Get-Item -LiteralPath $p }
    }
    return @($files | Sort-Object FullName -Unique | ForEach-Object {
        [pscustomobject]@{file=$_.FullName.Substring($BrainRoot.Length);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
    })
}
$sourceBefore=Git-Read $SourceRepository @('rev-parse','HEAD')
[void](Git-Read $SourceRepository @('cat-file','-e',([string]$manifest.baseCommit+'^{commit}')))
$before=@(Program-Snapshot)
$work=Join-Path $BrainRoot ('Claud-Work\codex-windows-acceptance-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
$candidate=Join-Path $work 'candidate'
$evidence=Join-Path $work 'evidence'
Write-Host 'Creating an isolated source copy. The installed bot stays running.'
[void](Git-Read $work @('clone','--no-checkout','--no-hardlinks','--',$SourceRepository,$candidate))
[void](Git-Read $candidate @('bundle','verify',$bundle))
[void](Git-Read $candidate @('fetch','--no-tags',$bundle,'HEAD'))
if ((Git-Read $candidate @('rev-parse','FETCH_HEAD')) -ne [string]$manifest.candidateCommit) { throw 'FETCHED_COMMIT_MISMATCH' }
if ((Git-Read $candidate @('rev-parse',([string]$manifest.candidateCommit+'^{tree}'))) -ne [string]$manifest.tree) { throw 'SOURCE_TREE_MISMATCH' }
[void](Git-Read $candidate @('merge-base','--is-ancestor',[string]$manifest.baseCommit,[string]$manifest.candidateCommit))
[void](Git-Read $candidate @('checkout','--detach',[string]$manifest.candidateCommit))
$exitCode=1
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $candidate 'brainhub\delivery-tools\credit-failover\Test-WindowsAcceptance.ps1') -Repository $candidate -OutDir $evidence
    $exitCode=$LASTEXITCODE
} finally {
    New-Item -ItemType Directory -Force -Path $evidence | Out-Null
    $after=@(Program-Snapshot)
    $sourceAfter=Git-Read $SourceRepository @('rev-parse','HEAD')
    $samePrograms=($before | ConvertTo-Json -Depth 5 -Compress) -ceq ($after | ConvertTo-Json -Depth 5 -Compress)
    $handoff=[ordered]@{
        candidateCommit=[string]$manifest.candidateCommit; candidate=$candidate;
        sourceCommitBefore=$sourceBefore;sourceCommitAfter=$sourceAfter;
        sourceCommitUnchanged=($sourceBefore -eq $sourceAfter);programSnapshotUnchanged=$samePrograms;
        acceptanceExitCode=$exitCode;productionDeployed=$false;productionReady=$false;
        report=(Join-Path $evidence 'WINDOWS-ACCEPTANCE.json');
        next='Review actual Windows evidence, installed-PC state and deploy gates before JEV-TEST-DEPLOY.'
    }
    [IO.File]::WriteAllText((Join-Path $evidence 'PC-DELIVERY-STATE.json'),($handoff | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
    Write-Host ('Evidence folder: '+$evidence)
    Write-Host 'No live deployment or restart was performed.'
}
if ($exitCode -ne 0) { throw 'WINDOWS_ACCEPTANCE_FAILED_SEE_EVIDENCE' }
if (-not $handoff.sourceCommitUnchanged -or -not $handoff.programSnapshotUnchanged) { throw 'INSTALLED_STATE_CHANGED_DURING_TEST_RECONCILE_BEFORE_DEPLOY' }
Write-Host 'ISOLATED_WINDOWS_ACCEPTANCE_FINISHED. Installed-PC/deploy acceptance remains separate.'
