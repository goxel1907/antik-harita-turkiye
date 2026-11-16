param(
    [string]$Repository = (Join-Path $PSScriptRoot '..\..\..'),
    [string]$OutDir = (Join-Path ([IO.Path]::GetTempPath()) ('JEV-Windows-Acceptance-' + [guid]::NewGuid().ToString('N')))
)
$ErrorActionPreference = 'Stop'
$Repository = [IO.Path]::GetFullPath($Repository)
$OutDir = [IO.Path]::GetFullPath($OutDir)
$report = [ordered]@{
    status='RUNNING'; scope='ISOLATED_WINDOWS_COMPONENT_ACCEPTANCE'; productionReady=$false;
    sourceCommit=$null; startedAt=[datetime]::UtcNow.ToString('o'); finishedAt=$null;
    os=[Environment]::OSVersion.VersionString; powershell=$PSVersionTable.PSVersion.ToString();
    node=$null; parser=$false; positionPrecheck=$false; dpapiDummyRoundTrip=$false; tests=$null;
    productionAccessed=$false; installedRuntimeChanged=$false; errors=@();
    remaining=@('Installed PC state and source reconciliation','Live Office visual acceptance','Real account/order preflight','Deployment and restart acceptance')
}
function Save-Report {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    [IO.File]::WriteAllText((Join-Path $OutDir 'WINDOWS-ACCEPTANCE.json'), ($report | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
}
try {
    Save-Report
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'NATIVE_WINDOWS_REQUIRED' }
    if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1) { throw 'WINDOWS_POWERSHELL_5_1_REQUIRED' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $report.node = (& $node --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $report.node -notmatch '^v24\.') { throw 'NODE_24_REQUIRED' }
    $report.sourceCommit = (& git.exe -C $Repository rev-parse HEAD | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $report.sourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'SOURCE_COMMIT_UNAVAILABLE' }
    $psFiles = @(Get-ChildItem -LiteralPath (Join-Path $Repository 'brainhub') -Filter '*.ps1' -File -Recurse)
    foreach ($file in $psFiles) {
        $tokens=$null; $errors=$null
        [void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
        if (@($errors).Count -gt 0) { throw ('POWERSHELL_SYNTAX_ERROR: '+$file.Name) }
    }
    $report.parser=$true
    # Exercise the ACTUAL deploy helper, with local command mocks. No HTTP call.
    & {
        param($Common)
        . $Common
        function Core-Headers([string]$Root) { return @{} }
        function Invoke-RestMethod { return $script:acceptanceReply }
        $now=[DateTimeOffset]::UtcNow.ToString('o')
        foreach ($reply in @([pscustomobject]@{},[pscustomobject]@{ok=$false;open=@()},[pscustomobject]@{ok=$true;open=$null},[pscustomobject]@{ok=$true;open='bad'},
            [pscustomobject]@{ok=$true;open=@();ledgerOk=$false;asOf=$now},
            [pscustomobject]@{ok=$true;open=@();ledgerOk=$true;asOf=[DateTimeOffset]::UtcNow.AddMinutes(-5).ToString('o')},
            [pscustomobject]@{ok=$true;open=@();ledgerOk=$true;asOf=[DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o')})) {
            $script:acceptanceReply=$reply
            if ($null -ne (Open-Positions 'unused')) { throw 'UNREADABLE_POSITIONS_TREATED_AS_ZERO' }
        }
        $script:acceptanceReply=[pscustomobject]@{ok=$true;open=@();ledgerOk=$true;asOf=$now}
        $empty=Open-Positions 'unused'
        if ($null -eq $empty -or $empty.Count -ne 0) { throw 'VERIFIED_ZERO_POSITIONS_REJECTED' }
        $script:acceptanceReply=[pscustomobject]@{ok=$true;open=@([pscustomobject]@{symbol='TESTUSDT';side='LONG'});ledgerOk=$true;asOf=$now}
        $open=Open-Positions 'unused'
        if ($open.Count -ne 1 -or $open[0] -ne 'TESTUSDT LONG') { throw 'OPEN_POSITION_LOST' }
    } (Join-Path $Repository 'brainhub\jev-brain\common.ps1')
    $report.positionPrecheck=$true
    # Only a random dummy value, never a user's key/token or credential file.
    $dummy='JEV-acceptance-'+[guid]::NewGuid().ToString('N')
    $protected=ConvertTo-SecureString -String $dummy -AsPlainText -Force | ConvertFrom-SecureString
    if (-not $protected -or $protected.Contains($dummy)) { throw 'DPAPI_PROTECTION_FAILED' }
    $secure=ConvertTo-SecureString -String $protected
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { if ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) -ne $dummy) { throw 'DPAPI_ROUND_TRIP_FAILED' } }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $dummy=$null; $protected=$null }
    $report.dpapiDummyRoundTrip=$true
    $testFiles=@(Get-ChildItem -LiteralPath (Join-Path $Repository 'brainhub\test') -Filter '*.test.js' -File | Sort-Object Name)
    if ($testFiles.Count -lt 1) { throw 'NO_TEST_FILES' }
    $temp=Join-Path $OutDir 'temporary-tests'; New-Item -ItemType Directory -Force -Path $temp | Out-Null
    $psi=New-Object Diagnostics.ProcessStartInfo
    # R2544.185 (found on real Windows): passing 260 full test paths made a ~36,000 char command line, above the
    # Windows CreateProcess limit (32,767) -> "filename or extension too long". Node 24 expands the glob itself;
    # tests run from brainhub with 'test/*.test.js' exactly like the normal suite. File count goes to the evidence.
    $report.testFiles=$testFiles.Count
    $psi.FileName=$node; $psi.WorkingDirectory=(Join-Path $Repository 'brainhub'); $psi.UseShellExecute=$false
    $psi.CreateNoWindow=$true; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
    $psi.Arguments='--test --test-reporter=tap --test-concurrency=4 "test/*.test.js"'
    # Do not let a user's live credentials/config variables enter test workers.
    $psi.EnvironmentVariables.Clear()
    foreach ($name in @('PATH','SystemRoot','WINDIR','ComSpec','PATHEXT','PROCESSOR_ARCHITECTURE','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','USERNAME','USERDOMAIN','OS','NUMBER_OF_PROCESSORS','PSModulePath')) {
        $value=[Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $psi.EnvironmentVariables[$name]=$value }
    }
    $psi.EnvironmentVariables['TEMP']=$temp; $psi.EnvironmentVariables['TMP']=$temp
    $psi.EnvironmentVariables['NODE_OPTIONS']='--require="'+(Join-Path $PSScriptRoot 'no-network.cjs')+'"'
    $psi.EnvironmentVariables['JEV_TEST_PROTECT_INSTALLED']='1'
    $process=New-Object Diagnostics.Process; $process.StartInfo=$psi
    [void]$process.Start()
    $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(600000)) { $process.Kill(); throw 'TEST_TIMEOUT' }
    $text=$stdout.Result; $errText=$stderr.Result
    [IO.File]::WriteAllText((Join-Path $OutDir 'tests.tap'),$text,(New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $OutDir 'tests-stderr.txt'),$errText,(New-Object Text.UTF8Encoding($false)))
    $counts=@{}
    foreach ($key in @('tests','pass','fail','cancelled','skipped','todo')) {
        $match=[regex]::Match($text,'(?m)^# '+$key+' (\d+)\s*$')
        if (-not $match.Success) { throw ('TEST_SUMMARY_MISSING_'+$key) }
        $counts[$key]=[int]$match.Groups[1].Value
    }
    $report.tests=$counts
    if ($process.ExitCode -ne 0 -or $counts.fail -ne 0 -or $counts.cancelled -ne 0 -or $counts.skipped -ne 0 -or $counts.tests -lt 1477) { throw 'WINDOWS_TEST_ACCEPTANCE_FAILED' }
    $report.status='WINDOWS_COMPONENT_ACCEPTANCE_PASSED'
    Write-Host ('JEV_WINDOWS_COMPONENT_ACCEPTANCE_OK tests='+$counts.tests)
    Write-Host 'Production PC/Office/deploy acceptance is still separate; no live system was accessed.'
} catch {
    $report.status='WINDOWS_COMPONENT_ACCEPTANCE_FAILED'; $report.errors+=($_.Exception.Message)
    Write-Host ('JEV_WINDOWS_COMPONENT_ACCEPTANCE_FAILED: '+$_.Exception.Message)
} finally {
    $report.finishedAt=[datetime]::UtcNow.ToString('o'); Save-Report
    Write-Host ('Evidence: '+(Join-Path $OutDir 'WINDOWS-ACCEPTANCE.json'))
}
if ($report.status -ne 'WINDOWS_COMPONENT_ACCEPTANCE_PASSED') { exit 1 }
