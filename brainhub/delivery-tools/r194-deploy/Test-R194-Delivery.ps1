param([string]$OutFile)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'R194-Delivery.ps1')
$git=(Get-Command git -ErrorAction Stop).Source
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('jev-r194-delivery-selftest-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$results=@()
function Assert-Check($Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Expect-Failure([scriptblock]$Body,[string]$Pattern){$got=$false;try{& $Body | Out-Null}catch{$got=$_.Exception.Message -match $Pattern};Assert-Check $got ('EXPECTED_FAILURE: '+$Pattern)}
function Check([string]$Name,[scriptblock]$Body){try{& $Body;$script:results+=[pscustomobject]@{name=$Name;passed=$true};Write-Host ('SELFTEST_OK '+$Name)}catch{$script:results+=[pscustomobject]@{name=$Name;passed=$false;error=$_.Exception.Message};Write-Host ('SELFTEST_FAILED '+$Name+' '+$_.Exception.Message)}}
function Fixture {
    $homeDir=Join-Path $testRoot ([guid]::NewGuid().ToString('N'));$c=Join-Path $homeDir 'candidate';$brain=Join-Path $homeDir 'brain';$source=Join-Path $brain 'source'
    New-Item -ItemType Directory -Path (Join-Path $c 'brainhub/jev-brain') -Force | Out-Null
    [void](Invoke-DeliveryGit $git $c @('init','--quiet'))
    [void](Invoke-DeliveryGit $git $c @('config','user.name','JEV isolated test'))
    [void](Invoke-DeliveryGit $git $c @('config','user.email','isolated@example.invalid'))
    [void](Invoke-DeliveryGit $git $c @('config','core.autocrlf','false'))
    $names=@('JEV-DEPLOY.ps1','JEV-TEST-DEPLOY.ps1','common.ps1')
    foreach($n in $names){[IO.File]::WriteAllText((Join-Path $c ('brainhub/jev-brain/'+$n)),"# synthetic BASE $n`n",(New-Object Text.UTF8Encoding($false)))}
    [IO.File]::WriteAllText((Join-Path $c 'brainhub/server.js'),"// synthetic BASE`n",(New-Object Text.UTF8Encoding($false)))
    [void](Invoke-DeliveryGit $git $c @('add','.'));[void](Invoke-DeliveryGit $git $c @('commit','--quiet','-m','base'))
    $base=Invoke-DeliveryGit $git $c @('rev-parse','HEAD');$rootFiles=[ordered]@{}
    foreach($n in $names){$rootFiles[$n]=[ordered]@{before=Get-DeliveryHash (Join-Path $c ('brainhub/jev-brain/'+$n));replace=($n -ne 'common.ps1')}}
    $oldProgram=Get-DeliveryHash (Join-Path $c 'brainhub/server.js')
    foreach($n in $names | Where-Object {$_ -ne 'common.ps1'}){[IO.File]::WriteAllText((Join-Path $c ('brainhub/jev-brain/'+$n)),"# synthetic CANDIDATE $n`n",(New-Object Text.UTF8Encoding($false)))}
    [IO.File]::WriteAllText((Join-Path $c 'brainhub/server.js'),"// synthetic CANDIDATE`n",(New-Object Text.UTF8Encoding($false)))
    [void](Invoke-DeliveryGit $git $c @('add','.'));[void](Invoke-DeliveryGit $git $c @('commit','--quiet','-m','candidate'))
    foreach($n in $names){$rootFiles[$n]['after']=Get-DeliveryHash (Join-Path $c ('brainhub/jev-brain/'+$n))}
    $manifest=[pscustomobject]@{baseCommit=$base;candidateCommit=Invoke-DeliveryGit $git $c @('rev-parse','HEAD');tree=Invoke-DeliveryGit $git $c @('rev-parse','HEAD^{tree}');expectedTests=1540;rootFiles=($rootFiles | ConvertTo-Json -Depth 5 | ConvertFrom-Json);programFiles=[pscustomobject]@{'runtime/server/server.js'=[pscustomobject]@{before=$oldProgram;after=Get-DeliveryHash (Join-Path $c 'brainhub/server.js')}}}
    New-Item -ItemType Directory -Path $brain -Force | Out-Null
    [void](Invoke-DeliveryGit $git $brain @('clone','--quiet','--no-hardlinks',$c,$source))
    [void](Invoke-DeliveryGit $git $source @('checkout','--quiet','--detach',$base))
    foreach($n in $names){[IO.File]::Copy((Join-Path $source ('brainhub/jev-brain/'+$n)),(Join-Path $brain $n))}
    [IO.File]::WriteAllText((Join-Path $brain 'BEKLENEN-SURUM.txt'),$base)
    New-Item -ItemType Directory -Path (Join-Path $brain 'runtime/server') -Force | Out-Null
    [IO.File]::Copy((Join-Path $source 'brainhub/server.js'),(Join-Path $brain 'runtime/server/server.js'))
    New-Item -ItemType Directory -Path (Join-Path $brain 'runtime/config') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $brain 'runtime/config/user-sizing.json'),'{"keep":"USER_VALUE"}')
    New-Item -ItemType Directory -Path (Join-Path $brain 'runtime/data') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $brain 'runtime/data/learning-sentinel'), 'LEARNING_MUST_STAY')
    return [pscustomobject]@{brain=$brain;candidate=$c;source=$source;m=$manifest}
}
function Evidence($F,[string]$Name='one') {
    $work=Join-Path $F.brain ('Claud-Work/codex-windows-acceptance-'+$Name);$candidate=Join-Path $work 'candidate';$ev=Join-Path $work 'evidence'
    New-Item -ItemType Directory -Path $ev -Force | Out-Null
    [void](Invoke-DeliveryGit $git $work @('clone','--quiet','--no-hardlinks',$F.candidate,$candidate))
    $r=[pscustomobject]@{status='WINDOWS_COMPONENT_ACCEPTANCE_PASSED';sourceCommit=$F.m.candidateCommit;powershell='5.1.19041.1';node='v24.16.0';parser=$true;positionPrecheck=$true;dpapiDummyRoundTrip=$true;tests=[pscustomobject]@{tests=1540;pass=1540;fail=0;skipped=0;cancelled=0}}
    $h=[pscustomobject]@{candidateCommit=$F.m.candidateCommit;candidate=$candidate;acceptanceExitCode=0;sourceCommitUnchanged=$true;programSnapshotUnchanged=$true;productionDeployed=$false}
    [IO.File]::WriteAllText((Join-Path $ev 'WINDOWS-ACCEPTANCE.json'),($r|ConvertTo-Json -Depth 6))
    [IO.File]::WriteAllText((Join-Path $ev 'PC-DELIVERY-STATE.json'),($h|ConvertTo-Json -Depth 6))
    return [pscustomobject]@{r=$r;h=$h;ev=$ev}
}
try {
 Check 'matching_native_acceptance_is_required' {$f=Fixture;$e=Evidence $f;Assert-Check (Test-DeliveryAcceptance $e.r $e.h $f.m 'v24.16.0') 'matching acceptance refused'}
 Check 'wrong_commit_is_rejected' {$f=Fixture;$e=Evidence $f;$e.r.sourceCommit='bad';Assert-Check (-not (Test-DeliveryAcceptance $e.r $e.h $f.m 'v24.16.0')) 'wrong commit accepted'}
 Check 'skipped_windows_test_is_rejected' {$f=Fixture;$e=Evidence $f;$e.r.tests.skipped=1;Assert-Check (-not (Test-DeliveryAcceptance $e.r $e.h $f.m 'v24.16.0')) 'skip accepted'}
 Check 'changed_node_is_rejected' {$f=Fixture;$e=Evidence $f;Assert-Check (-not (Test-DeliveryAcceptance $e.r $e.h $f.m 'v24.17.0')) 'changed node accepted'}
 Check 'latest_failed_run_does_not_reuse_older_pass' {$f=Fixture;$e=Evidence $f 'older';[IO.File]::SetLastWriteTimeUtc((Join-Path $e.ev 'PC-DELIVERY-STATE.json'),[datetime]::UtcNow.AddMinutes(-3));$bad=Evidence $f 'newer';$bad.r.status='WINDOWS_COMPONENT_ACCEPTANCE_FAILED';[IO.File]::WriteAllText((Join-Path $bad.ev 'WINDOWS-ACCEPTANCE.json'),($bad.r|ConvertTo-Json -Depth 6));Assert-Check ($null -eq (Find-DeliveryAcceptance $f.brain $f.m 'v24.16.0' $git)) 'old pass hid newer failure'}
 Check 'cached_candidate_worktree_must_be_clean' {$f=Fixture;$e=Evidence $f;[IO.File]::AppendAllText((Join-Path $e.h.candidate 'brainhub/server.js'),'EDIT');Expect-Failure {Find-DeliveryAcceptance $f.brain $f.m 'v24.16.0' $git} 'CANDIDATE_NOT_CLEAN'}
 Check 'clean_source_stages_exact_candidate' {$f=Fixture;$s=Invoke-DeliveryStage $f.brain $f.candidate $f.m $git;Assert-Check ($s.source -eq $f.m.candidateCommit) 'source mismatch';Assert-Check ((Get-Content (Join-Path $f.brain 'BEKLENEN-SURUM.txt') -Raw).Trim() -eq $f.m.candidateCommit) 'expected mismatch';foreach($p in $f.m.rootFiles.PSObject.Properties){Assert-Check ((Get-DeliveryHash (Join-Path $f.brain $p.Name)) -eq $p.Value.after) 'root mismatch'}}
 Check 'stage_preserves_runtime_preferences_and_learning' {$f=Fixture;$before=Get-DeliveryPreferences $f.brain;[void](Invoke-DeliveryStage $f.brain $f.candidate $f.m $git);Assert-Check ((Get-DeliveryRuntimeState $f.brain $f.m) -eq 'BASE') 'runtime touched';Assert-Check ((($before|ConvertTo-Json -Compress) -ceq ((Get-DeliveryPreferences $f.brain)|ConvertTo-Json -Compress))) 'preference touched';Assert-Check ((Get-Content (Join-Path $f.brain 'runtime/data/learning-sentinel') -Raw) -eq 'LEARNING_MUST_STAY') 'learning touched'}
 Check 'second_stage_is_idempotent' {$f=Fixture;[void](Invoke-DeliveryStage $f.brain $f.candidate $f.m $git);$again=Invoke-DeliveryStage $f.brain $f.candidate $f.m $git;Assert-Check ($again.alreadyStaged -eq $true -and $null -eq $again.backup) 'second stage rewrote files'}
 Check 'dirty_source_is_not_overwritten' {$f=Fixture;$rootBefore=Get-DeliveryHash (Join-Path $f.brain 'JEV-DEPLOY.ps1');[IO.File]::AppendAllText((Join-Path $f.source 'brainhub/server.js'),'USER_EDIT');Expect-Failure {Invoke-DeliveryStage $f.brain $f.candidate $f.m $git} 'SOURCE_NOT_CLEAN';Assert-Check ((Get-DeliveryHash (Join-Path $f.brain 'JEV-DEPLOY.ps1')) -eq $rootBefore) 'root changed on dirty source'}
 Check 'custom_root_script_is_not_overwritten' {$f=Fixture;[IO.File]::AppendAllText((Join-Path $f.brain 'JEV-DEPLOY.ps1'),'USER_EDIT');Expect-Failure {Invoke-DeliveryStage $f.brain $f.candidate $f.m $git} 'ROOT_SCRIPT_CHANGED';Assert-Check ((Invoke-DeliveryGit $git $f.source @('rev-parse','HEAD')) -eq $f.m.baseCommit) 'source moved on root mismatch'}
 Check 'wrong_expected_source_is_rejected' {$f=Fixture;[IO.File]::WriteAllText((Join-Path $f.brain 'BEKLENEN-SURUM.txt'),'UNKNOWN');Expect-Failure {Invoke-DeliveryStage $f.brain $f.candidate $f.m $git} 'EXPECTED_SOURCE_MISMATCH'}
 Check 'unknown_runtime_is_not_a_verified_install' {$f=Fixture;[IO.File]::AppendAllText((Join-Path $f.brain 'runtime/server/server.js'),'USER_EDIT');Expect-Failure {Get-DeliveryRuntimeState $f.brain $f.m} 'RUNTIME_FILES_MIXED_OR_UNKNOWN'}
 Check 'copy_failure_restores_previous_root_and_source' {
  $f=Fixture;$before=Get-DeliveryHash (Join-Path $f.brain 'JEV-DEPLOY.ps1');$script:originalDeliveryCopy=(Get-Item Function:Set-DeliveryFile).ScriptBlock
  try {
   function Set-DeliveryFile([string]$From,[string]$To){if($To.EndsWith('JEV-TEST-DEPLOY.ps1')){throw 'SYNTHETIC_COPY_FAILURE'};& $script:originalDeliveryCopy $From $To}
   Expect-Failure {Invoke-DeliveryStage $f.brain $f.candidate $f.m $git} 'STAGE_NOT_COMPLETE'
  } finally { Remove-Item Function:Set-DeliveryFile }
  Assert-Check ((Get-DeliveryHash (Join-Path $f.brain 'JEV-DEPLOY.ps1')) -eq $before) 'root not restored'
  Assert-Check ((Invoke-DeliveryGit $git $f.source @('rev-parse','HEAD')) -eq $f.m.baseCommit) 'source changed on copy failure'
  Assert-Check ((Get-Content (Join-Path $f.brain 'BEKLENEN-SURUM.txt') -Raw).Trim() -eq $f.m.baseCommit) 'expected not restored'
 }
 Check 'failed_fast_forward_restores_previous_root' {
  $f=Fixture;$before=Get-DeliveryHash (Join-Path $f.brain 'JEV-DEPLOY.ps1');$script:originalDeliveryGit=(Get-Item Function:Invoke-DeliveryGit).ScriptBlock
  try {
   function Invoke-DeliveryGit([string]$Git,[string]$Directory,[string[]]$Arguments){if($Arguments[0] -eq 'merge'){throw 'SYNTHETIC_FF_FAILURE'};& $script:originalDeliveryGit $Git $Directory $Arguments}
   Expect-Failure {Invoke-DeliveryStage $f.brain $f.candidate $f.m $git} 'STAGE_NOT_COMPLETE'
  } finally { Remove-Item Function:Invoke-DeliveryGit }
  Assert-Check ((Get-DeliveryHash (Join-Path $f.brain 'JEV-DEPLOY.ps1')) -eq $before) 'root not restored after FF failure'
  Assert-Check ((Get-Content (Join-Path $f.brain 'BEKLENEN-SURUM.txt') -Raw).Trim() -eq $f.m.baseCommit) 'expected not restored after FF failure'
 }
 Check 'restart_timestamp_change_is_not_a_preference_change' {
  $f=Fixture;$p=Join-Path $f.brain 'runtime/config/top3-hunter.json'
  [IO.File]::WriteAllText($p,'{"enabled":true,"marginQuote":40,"leverage":10,"updatedAt":"before"}')
  $before=Get-DeliveryPreferences $f.brain;$rawBefore=Get-DeliveryPreferences $f.brain -RawFiles
  [IO.File]::WriteAllText($p,'{"enabled":true,"marginQuote":40,"leverage":10,"updatedAt":"after"}')
  $after=Get-DeliveryPreferences $f.brain;$rawAfter=Get-DeliveryPreferences $f.brain -RawFiles
  Assert-Check ($before['top3-hunter.json'] -eq $after['top3-hunter.json']) 'metadata caused false preference alarm'
  Assert-Check ($rawBefore['top3-hunter.json'] -ne $rawAfter['top3-hunter.json']) 'raw file evidence was lost'
 }
 Check 'margin_and_live_permission_changes_remain_detected' {
  $f=Fixture;$p=Join-Path $f.brain 'runtime/config/top3-hunter.json'
  [IO.File]::WriteAllText($p,'{"enabled":true,"liveEnabled":true,"marginQuote":40,"updatedAt":"before"}')
  $before=(Get-DeliveryPreferences $f.brain)['top3-hunter.json']
  foreach($text in @('{"enabled":true,"liveEnabled":true,"marginQuote":50,"updatedAt":"after"}','{"enabled":true,"liveEnabled":false,"marginQuote":40,"updatedAt":"after"}')){
   [IO.File]::WriteAllText($p,$text);Assert-Check ((Get-DeliveryPreferences $f.brain)['top3-hunter.json'] -ne $before) 'real preference change was hidden'
  }
 }
 Check 'format_and_property_order_do_not_change_preference_values' {
  $f=Fixture;$p=Join-Path $f.brain 'runtime/config/user-sizing.json'
  [IO.File]::WriteAllText($p,'{"version":1,"lanes":{"top3":{"leverage":10,"marginQuote":40}},"empty":[],"optional":null,"enabled":false}')
  $before=(Get-DeliveryPreferences $f.brain)['user-sizing.json']
  [IO.File]::WriteAllText($p,'{ "enabled":false, "optional":null, "empty":[], "lanes":{"top3":{"marginQuote":40,"leverage":10}}, "version":1 }')
  Assert-Check ((Get-DeliveryPreferences $f.brain)['user-sizing.json'] -eq $before) 'JSON formatting caused false change'
  [IO.File]::WriteAllText($p,'{"version":1,"lanes":{"top3":{"leverage":10,"marginQuote":40}},"empty":null,"optional":null,"enabled":false}')
  Assert-Check ((Get-DeliveryPreferences $f.brain)['user-sizing.json'] -ne $before) 'empty array was confused with null'
 }
 Check 'malformed_preferences_are_not_silently_accepted' {
  $f=Fixture;[IO.File]::WriteAllText((Join-Path $f.brain 'runtime/config/user-sizing.json'),'NOT_JSON')
  Expect-Failure {Get-DeliveryPreferences $f.brain} '.'
 }
 Check 'crlf_and_bom_do_not_create_false_code_mismatch' {
  $f=Fixture;$p=Join-Path $f.brain 'JEV-DEPLOY.ps1';$old=Get-DeliveryHash $p
  # Source clones may already contain CRLF (Windows core.autocrlf). Canonicalize once
  # before constructing each fixture; blindly replacing LF would create CRCRLF.
  $canonical=[IO.File]::ReadAllText($p).Replace("`r`n","`n")
  foreach($bom in @($false,$true)){foreach($eol in @("`n","`r`n")){
   $formatted=$canonical.Replace("`n",$eol)
   Assert-Check (-not $formatted.Contains("`r`r`n")) 'test fixture contains doubled CR'
   [IO.File]::WriteAllText($p,$formatted,(New-Object Text.UTF8Encoding -ArgumentList $bom))
   $bytes=[IO.File]::ReadAllBytes($p);$hasBom=($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)
   Assert-Check ($hasBom -eq $bom) 'UTF8 BOM fixture was not constructed as requested'
   Assert-Check ((Get-DeliveryHash $p) -eq $old) 'line endings changed normalized code hash'
  }}
 }

} finally {
 $passed=@($results | Where-Object {$_.passed}).Count;$failed=@($results | Where-Object {-not $_.passed}).Count
 $report=[ordered]@{tests=$results.Count;pass=$passed;fail=$failed;platform=[Environment]::OSVersion.Platform.ToString();powershell=$PSVersionTable.PSVersion.ToString();liveAccessed=$false;networkUsed=$false;results=$results}
 if($OutFile){[IO.File]::WriteAllText($OutFile,($report|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))}
 Write-Host ('DELIVERY_SELFTEST_RESULT tests='+$results.Count+' pass='+$passed+' fail='+$failed)
 # Keep failed fixtures for review; remove only this test's own tree after success.
 if($failed -eq 0){Remove-Item -LiteralPath $testRoot -Recurse -Force}else{Write-Host ('SELFTEST_EVIDENCE: '+$testRoot)}
}
if($failed -gt 0 -or $results.Count -ne 20){exit 1}
