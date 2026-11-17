# Delivery functions only. Loading this file never deploys or changes the bot.
function Get-DeliveryHash([string]$Path) {
    $s=[IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8).TrimStart([char]0xfeff).Replace("`r`n","`n")
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Invoke-DeliveryGit([string]$Git,[string]$Directory,[string[]]$Arguments) {
    $prior=$ErrorActionPreference
    try { $ErrorActionPreference='Continue';$out=& $Git -C $Directory @Arguments 2>&1;$code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$prior }
    if($code -ne 0){throw ('GIT_DELIVERY_FAILED: '+($Arguments | Select-Object -First 1))}
    return ($out | Out-String).Trim()
}
function Assert-DeliveryCandidate($Manifest,[string]$Candidate,[string]$Git) {
    if((Invoke-DeliveryGit $Git $Candidate @('rev-parse','HEAD')) -ne [string]$Manifest.candidateCommit){throw 'CANDIDATE_HEAD_MISMATCH'}
    if((Invoke-DeliveryGit $Git $Candidate @('rev-parse','HEAD^{tree}')) -ne [string]$Manifest.tree){throw 'CANDIDATE_TREE_MISMATCH'}
    if(Invoke-DeliveryGit $Git $Candidate @('status','--porcelain','--untracked-files=all')){throw 'CANDIDATE_NOT_CLEAN'}
}
function Test-DeliveryAcceptance($Report,$Handoff,$Manifest,[string]$NodeVersion) {
    return ($Report.status -eq 'WINDOWS_COMPONENT_ACCEPTANCE_PASSED' -and
        $Report.sourceCommit -eq [string]$Manifest.candidateCommit -and
        $Report.powershell -match '^5\.1\.' -and $Report.node -eq $NodeVersion -and
        $Report.parser -eq $true -and $Report.positionPrecheck -eq $true -and $Report.dpapiDummyRoundTrip -eq $true -and
        $Report.tests.tests -ge [int]$Manifest.expectedTests -and $Report.tests.pass -eq $Report.tests.tests -and
        $Report.tests.fail -eq 0 -and $Report.tests.skipped -eq 0 -and $Report.tests.cancelled -eq 0 -and
        $Handoff.candidateCommit -eq [string]$Manifest.candidateCommit -and $Handoff.acceptanceExitCode -eq 0 -and
        $Handoff.sourceCommitUnchanged -eq $true -and $Handoff.programSnapshotUnchanged -eq $true -and
        $Handoff.productionDeployed -eq $false)
}
function Find-DeliveryAcceptance([string]$BrainRoot,$Manifest,[string]$NodeVersion,[string]$Git) {
    $work=Join-Path $BrainRoot 'Claud-Work'
    if(-not (Test-Path -LiteralPath $work)){return $null}
    $items=@()
    foreach($d in @(Get-ChildItem -LiteralPath $work -Directory -Filter 'codex-windows-acceptance-*')) {
        $hf=Join-Path $d.FullName 'evidence/PC-DELIVERY-STATE.json'
        if(-not (Test-Path -LiteralPath $hf)){continue}
        try { $h=Get-Content -LiteralPath $hf -Raw | ConvertFrom-Json } catch { continue }
        if($h.candidateCommit -eq [string]$Manifest.candidateCommit){$items+=[pscustomobject]@{directory=$d;handoff=$h;file=Get-Item -LiteralPath $hf}}
    }
    if($items.Count -eq 0){return $null}
    # Never hide a newer failure by falling back to an older passed run.
    $item=$items | Sort-Object {$_.file.LastWriteTimeUtc} -Descending | Select-Object -First 1
    $rf=Join-Path $item.directory.FullName 'evidence/WINDOWS-ACCEPTANCE.json'
    if(-not (Test-Path -LiteralPath $rf)){return $null}
    try { $r=Get-Content -LiteralPath $rf -Raw | ConvertFrom-Json } catch { return $null }
    if(-not (Test-DeliveryAcceptance $r $item.handoff $Manifest $NodeVersion)){return $null}
    $candidate=[IO.Path]::GetFullPath([string]$item.handoff.candidate)
    $expected=[IO.Path]::GetFullPath((Join-Path $item.directory.FullName 'candidate'))
    if(-not [string]::Equals($candidate,$expected,[StringComparison]::OrdinalIgnoreCase)){throw 'ACCEPTANCE_CANDIDATE_PATH_MISMATCH'}
    Assert-DeliveryCandidate $Manifest $candidate $Git
    return [pscustomobject]@{candidate=$candidate;evidence=Split-Path -Parent $rf;report=$r}
}
function Set-DeliveryFile([string]$From,[string]$To) {
    $temp=$To+'.r194tmp'
    [IO.File]::Copy($From,$temp,$true)
    try { [IO.File]::Copy($temp,$To,$true) } finally { if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force} }
}
function Invoke-DeliveryStage([string]$BrainRoot,[string]$Candidate,$Manifest,[string]$Git) {
    Assert-DeliveryCandidate $Manifest $Candidate $Git
    $source=Join-Path $BrainRoot 'source'
    $head=Invoke-DeliveryGit $Git $source @('rev-parse','HEAD')
    if($head -notin @([string]$Manifest.baseCommit,[string]$Manifest.candidateCommit)){throw 'SOURCE_MOVED_RECONCILE_BEFORE_DEPLOY'}
    if(Invoke-DeliveryGit $Git $source @('status','--porcelain','--untracked-files=all')){throw 'SOURCE_NOT_CLEAN_NO_FILES_CHANGED'}
    $expectedFile=Join-Path $BrainRoot 'BEKLENEN-SURUM.txt'
    if((Get-Content -LiteralPath $expectedFile -Raw).Trim() -ne $head){throw 'EXPECTED_SOURCE_MISMATCH'}
    foreach($entry in $Manifest.rootFiles.PSObject.Properties) {
        $file=Join-Path $BrainRoot $entry.Name
        $want=if($head -eq [string]$Manifest.baseCommit){[string]$entry.Value.before}else{[string]$entry.Value.after}
        if(-not (Test-Path -LiteralPath $file) -or (Get-DeliveryHash $file) -ne $want){throw ('ROOT_SCRIPT_CHANGED: '+$entry.Name)}
        $candidateFile=Join-Path $Candidate ('brainhub/jev-brain/'+$entry.Name)
        if((Get-DeliveryHash $candidateFile) -ne [string]$entry.Value.after){throw ('CANDIDATE_SCRIPT_MISMATCH: '+$entry.Name)}
    }
    if($head -eq [string]$Manifest.candidateCommit){return [pscustomobject]@{alreadyStaged=$true;source=$head;backup=$null}}
    [void](Invoke-DeliveryGit $Git $source @('fetch','--no-tags',$Candidate,[string]$Manifest.candidateCommit))
    [void](Invoke-DeliveryGit $Git $source @('merge-base','--is-ancestor',[string]$Manifest.baseCommit,[string]$Manifest.candidateCommit))
    $backup=Join-Path $BrainRoot ('Claud-Work/r194-stage-backup-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $names=@($Manifest.rootFiles.PSObject.Properties | Where-Object {$_.Value.replace -eq $true} | ForEach-Object {$_.Name})
    foreach($name in @($names)+@('BEKLENEN-SURUM.txt')){[IO.File]::Copy((Join-Path $BrainRoot $name),(Join-Path $backup $name),$false)}
    try {
        foreach($name in $names){Set-DeliveryFile (Join-Path $Candidate ('brainhub/jev-brain/'+$name)) (Join-Path $BrainRoot $name)}
        [IO.File]::WriteAllText($expectedFile,([string]$Manifest.candidateCommit+"`r`n"),(New-Object Text.UTF8Encoding($false)))
        # Only a clean, expected base can advance; no reset, force checkout or merge conflict resolution.
        [void](Invoke-DeliveryGit $Git $source @('merge','--ff-only',[string]$Manifest.candidateCommit))
        if((Invoke-DeliveryGit $Git $source @('rev-parse','HEAD')) -ne [string]$Manifest.candidateCommit){throw 'SOURCE_ADVANCE_NOT_VERIFIED'}
        if(Invoke-DeliveryGit $Git $source @('status','--porcelain','--untracked-files=all')){throw 'SOURCE_CHANGED_DURING_STAGE'}
    } catch {
        $errorText=$_.Exception.Message
        $now=Invoke-DeliveryGit $Git $source @('rev-parse','HEAD')
        if($now -eq $head){foreach($name in @($names)+@('BEKLENEN-SURUM.txt')){[IO.File]::Copy((Join-Path $backup $name),(Join-Path $BrainRoot $name),$true)}}
        throw ('STAGE_NOT_COMPLETE: '+$errorText+'; backup='+$backup+'; source='+$now)
    }
    return [pscustomobject]@{alreadyStaged=$false;source=[string]$Manifest.candidateCommit;backup=$backup}
}
function Convert-DeliveryPreferenceValue($Value) {
    if($null -eq $Value){return $null}
    if($Value -is [System.Collections.IDictionary]){
        $o=[ordered]@{};foreach($k in @($Value.Keys | Sort-Object)){$o[$k]=Convert-DeliveryPreferenceValue $Value[$k]};return $o
    }
    if($Value -is [pscustomobject]){
        $o=[ordered]@{};foreach($p in @($Value.PSObject.Properties | Sort-Object Name)){$o[$p.Name]=Convert-DeliveryPreferenceValue $p.Value};return $o
    }
    if($Value -is [System.Array]){
        $a=@();foreach($v in $Value){$a+=,(Convert-DeliveryPreferenceValue $v)};return ,$a
    }
    return $Value
}
function Get-DeliveryPreferences([string]$BrainRoot,[switch]$RawFiles) {
    $v=[ordered]@{}
    foreach($name in @('user-sizing.json','top3-hunter.json','zirve5.json','kesif-soz.json','leader-auto.json','lane-selection.json','jev.json','position-desk.json')) {
        $file=Join-Path $BrainRoot ('runtime/config/'+$name)
        if(-not (Test-Path -LiteralPath $file)){$v[$name]='ABSENT';continue}
        if($RawFiles){$v[$name]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash;continue}
        $config=[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
        if($config -isnot [pscustomobject]){throw ('PREFERENCE_JSON_NOT_OBJECT: '+$name)}
        # GO_LIVE always rewrites these top-level timestamps. Retain every preference,
        # including enabled/liveEnabled, side switches, margin, leverage and sizing revision.
        if($name -in @('top3-hunter.json','zirve5.json','lane-selection.json')){$config.PSObject.Properties.Remove('updatedAt')}
        $text=(Convert-DeliveryPreferenceValue $config) | ConvertTo-Json -Depth 30 -Compress
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$v[$name]=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','')}
        finally{$sha.Dispose()}
    }
    return $v
}
function Get-DeliveryRuntimeState([string]$BrainRoot,$Manifest) {
    $old=0;$new=0;$total=0
    foreach($entry in $Manifest.programFiles.PSObject.Properties) {
        $file=Join-Path $BrainRoot $entry.Name;$total++
        if(-not (Test-Path -LiteralPath $file)){throw ('RUNTIME_FILE_MISSING: '+$entry.Name)}
        $h=Get-DeliveryHash $file
        if($h -eq [string]$entry.Value.before){$old++}
        if($h -eq [string]$entry.Value.after){$new++}
    }
    if($new -eq $total){return 'CANDIDATE'}
    if($old -eq $total){return 'BASE'}
    throw 'RUNTIME_FILES_MIXED_OR_UNKNOWN_NO_DEPLOY_STARTED'
}
