param([string]$BrainRoot='C:\JEV-Brain')
$ErrorActionPreference='Stop'
$report=[ordered]@{release='R2544.194';startedAt=[datetime]::UtcNow.ToString('o');phase='PRECHECK';sourceStaged=$false;runtimeVerified=$false;deploymentInvoked=$false;settingsUnchanged=$null;runStateRestored=$null;errors=@()}
$out=Join-Path (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads') ('JEV-R194-DEPLOY-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
$evidence=$null;$exitCode=1
try {
    if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'NATIVE_WINDOWS_REQUIRED'}
    if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1){throw 'WINDOWS_POWERSHELL_5_1_REQUIRED'}
    if(-not [string]::Equals([IO.Path]::GetFullPath($BrainRoot),'C:\JEV-Brain',[StringComparison]::OrdinalIgnoreCase)){throw 'THIS_DELIVERY_IS_FOR_C_JEV_BRAIN_ONLY'}
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'SAG_TIK_YONETICI_OLARAK_CALISTIR'}
    $m=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'TESLIM.json') -Raw | ConvertFrom-Json
    if($m.candidateCommit -ne '97bc7b619f82f719b8042e68bd545bdd58832904' -or $m.baseCommit -ne '27f09a041d5d5d3b8a85d53c6cf4e8037864bd6d' -or $m.tree -ne 'f3442de625647d986fd7d6bb098cd4cf7dfc5b71'){throw 'WRONG_PINNED_DELIVERY'}
    if($m.expectedTests -ne 1540 -or $m.release -ne 'R2544.194' -or $m.officeVersion -ne '2.5.170-R2544.194-JEV-Brain'){throw 'INVALID_RELEASE_MANIFEST'}
    foreach($entry in $m.bootstrapFiles.PSObject.Properties){
        if($entry.Name -ne [IO.Path]::GetFileName($entry.Name)){throw 'INVALID_BOOTSTRAP_PATH'}
        if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $entry.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$entry.Value){throw ('DELIVERY_FILE_HASH_MISMATCH: '+$entry.Name)}
    }
    if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'JEV-R194.bundle') -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$m.bundleSha256){throw 'BUNDLE_HASH_MISMATCH'}
    . (Join-Path $PSScriptRoot 'R194-Delivery.ps1')
    $git=(Get-Command git.exe -ErrorAction Stop).Source;$node=(Get-Command node.exe -ErrorAction Stop).Source
    $nodeVersion=(& $node --version | Out-String).Trim()
    if($nodeVersion -notmatch '^v24\.'){throw 'NODE_24_REQUIRED'}
    $source=Join-Path $BrainRoot 'source'
    $head=Invoke-DeliveryGit $git $source @('rev-parse','HEAD')
    if($head -notin @([string]$m.baseCommit,[string]$m.candidateCommit)){throw 'SOURCE_MOVED_RECONCILE_BEFORE_DEPLOY'}
    if(Invoke-DeliveryGit $git $source @('status','--porcelain','--untracked-files=all')){throw 'SOURCE_NOT_CLEAN_NO_FILES_CHANGED'}
    $runtimeState=Get-DeliveryRuntimeState $BrainRoot $m
    $report.runtimeBefore=$runtimeState
    Write-Host 'ADIM 1/4 - Teslim betiginin yallitilmis oz testleri (borsa/model/gercek ayar yok).'
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-R194-Delivery.ps1') -OutFile (Join-Path $out 'DELIVERY-SELFTEST.json')
    if($LASTEXITCODE -ne 0){throw 'DELIVERY_SELFTEST_FAILED'}
    $report.phase='WINDOWS_ACCEPTANCE'
    Write-Host 'ADIM 2/4 - Ayni commit icin gercek Windows kabul kaniti kontrol ediliyor.'
    $accepted=Find-DeliveryAcceptance $BrainRoot $m $nodeVersion $git
    if(-not $accepted){
        Write-Host 'Gecerli kabul bulunamadi; bot calisirken ayri kopyada test ediliyor. Bir kac dakika surebilir.'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Start-IsolatedWindowsAcceptance.ps1') -BrainRoot $BrainRoot
        $report.windowsAcceptanceExitCode=$LASTEXITCODE
        if($LASTEXITCODE -ne 0){throw 'WINDOWS_ACCEPTANCE_FAILED_NO_STAGE_OR_STOP'}
        $accepted=Find-DeliveryAcceptance $BrainRoot $m $nodeVersion $git
    }
    if(-not $accepted){throw 'WINDOWS_ACCEPTANCE_NOT_VERIFIED_NO_STAGE_OR_STOP'}
    $evidence=$accepted.evidence;$report.acceptedCommit=[string]$m.candidateCommit;$report.windowsTests=$accepted.report.tests
    if(-not (Test-Path -LiteralPath (Join-Path $BrainRoot 'GECIS-TAMAMLANDI.txt'))){throw 'EXISTING_INSTALLATION_MARKER_MISSING_NO_DEPLOY_STARTED'}
    $publicExpected=Join-Path $BrainRoot 'BEKLENEN-PUBLIC.txt'
    if(Test-Path -LiteralPath $publicExpected){
        $public=Join-Path $BrainRoot 'apk-source';$publicHead=Invoke-DeliveryGit $git $public @('rev-parse','HEAD')
        if($publicHead -ne (Get-Content -LiteralPath $publicExpected -Raw).Trim() -or (Invoke-DeliveryGit $git $public @('status','--porcelain','--untracked-files=all'))){throw 'APK_SOURCE_EXPECTATION_MISMATCH_NO_DEPLOY_STARTED'}
    }
    $report.phase='STAGE'
    Write-Host 'ADIM 3/4 - Dogrulanmis kaynak ve kok betikler eslestiriliyor; runtime ayarlarina dokunulmuyor.'
    $staged=Invoke-DeliveryStage $BrainRoot $accepted.candidate $m $git
    $report.sourceStaged=$true;$report.stage=$staged
    # Only read the existing local Office endpoint; no keys/credentials or paid calls.
    $before=Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/snapshot' -TimeoutSec 20
    if($before.status.ok -ne $true -or $before.health.ok -ne $true){throw 'LIVE_STATUS_UNREADABLE_NO_DEPLOY_STARTED'}
    $armedBefore=($before.status.data.armed -eq $true)
    $modeBefore=[string]$before.status.data.tradingMode.mode
    $lanesBefore=$before.status.data.tradingMode.run.lanes
    $preferenceBefore=Get-DeliveryPreferences $BrainRoot
    $report.preferenceValuesBefore=$preferenceBefore
    $report.preferenceFileHashesBefore=Get-DeliveryPreferences $BrainRoot -RawFiles
    $report.wasArmed=$armedBefore;$report.modeBefore=$modeBefore
    if($runtimeState -eq 'CANDIDATE' -and $before.health.data.runtimeRelease -eq [string]$m.release){
        Write-Host 'R194 zaten kurulu; gereksiz yeniden baslatma yapilmiyor.'
    } else {
        $report.phase='DEPLOY';$report.deploymentInvoked=$true
        Write-Host 'ADIM 4/4 - Mevcut JEV-TEST-DEPLOY betigi baslatiliyor. Acik gercek pozisyon varsa kurmaz.'
        Write-Host 'CANLI aciksa mevcut betik CANLI yazmanizi ister; onay verirseniz ayni hatlarla yeniden baslatir.'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $BrainRoot 'JEV-TEST-DEPLOY.ps1')
        if($LASTEXITCODE -ne 0){throw 'JEV_TEST_DEPLOY_FAILED_SEE_EXISTING_LOGS'}
    }
    $report.phase='POSTCHECK'
    $after=$null
    for($i=0;$i -lt 10;$i++){
        try { $after=Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/snapshot' -TimeoutSec 15;if($after.health.data.runtimeRelease -eq [string]$m.release){break} } catch {}
        Start-Sleep -Seconds 2
    }
    $report.runtimeAfter=Get-DeliveryRuntimeState $BrainRoot $m
    $report.runtimeVerified=($report.runtimeAfter -eq 'CANDIDATE' -and $after.health.ok -eq $true -and $after.health.data.runtimeRelease -eq [string]$m.release -and $after.officeVersion -eq [string]$m.officeVersion)
    $preferenceAfter=Get-DeliveryPreferences $BrainRoot
    $report.preferenceValuesAfter=$preferenceAfter
    $report.preferenceFileHashesAfter=Get-DeliveryPreferences $BrainRoot -RawFiles
    $report.preferenceRawFilesUnchanged=(($report.preferenceFileHashesBefore | ConvertTo-Json -Compress) -ceq ($report.preferenceFileHashesAfter | ConvertTo-Json -Compress))
    $report.settingsUnchanged=(($preferenceBefore | ConvertTo-Json -Compress) -ceq ($preferenceAfter | ConvertTo-Json -Compress))
    $report.armedAfter=($after.status.data.armed -eq $true);$report.modeAfter=[string]$after.status.data.tradingMode.mode
    $report.runStateRestored=($report.armedAfter -eq $armedBefore -and $report.modeAfter -eq $modeBefore)
    # Compare selections only; active/expiry fields legitimately change during the restart.
    $selection={param($l) [ordered]@{normal=$l.normal.selected;scalp5m=$l.normal.sub.scalp5m.selected;trade15m=$l.normal.sub.trade15m.selected;burst=$l.normal.sub.burst.selected;top3=$l.top3.selected;early=$l.top3.sub.early.selected;top=$l.top3.sub.top.selected;zirve5=$l.zirve5.selected;kesif=$l.kesif.selected}}
    $report.lanesUnchanged=(((& $selection $lanesBefore)|ConvertTo-Json -Compress) -ceq ((& $selection $after.status.data.tradingMode.run.lanes)|ConvertTo-Json -Compress))
    if(-not $report.runtimeVerified){throw 'SOURCE_STAGED_BUT_RUNTIME_NOT_VERIFIED'}
    if(-not $report.settingsUnchanged -or -not $report.lanesUnchanged){throw 'INSTALLED_BUT_USER_PREFERENCES_CHANGED_RECONCILE_NO_AUTO_RESTORE'}
    if(-not $report.runStateRestored){throw 'INSTALLED_BUT_PREVIOUS_RUN_STATE_NOT_RESTORED_CHECK_OFFICE'}
    $report.phase='COMPLETE';$exitCode=0
    Write-Host ('JEV_R194_DELIVERY_OK commit='+$m.candidateCommit+' armed='+$report.armedAfter+' mode='+$report.modeAfter)
} catch {
    $report.errors+=($_.Exception.Message)
    Write-Host ('JEV_R194_DELIVERY_NOT_COMPLETE: '+$_.Exception.Message)
    Write-Host 'Kaynak aktarildi bilgisi, calisan surum veya CANLI yeniden basladi bilgisiyle ayni sey degildir. Rapor ayri ayri gosterir.'
} finally {
    $report.finishedAt=[datetime]::UtcNow.ToString('o')
    try {
        New-Item -ItemType Directory -Path $out -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $out 'DEPLOY-SONUC.json'),($report | ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))
        if(-not $evidence -and $m -and (Test-Path -LiteralPath (Join-Path $BrainRoot 'Claud-Work'))){
            $locations=@()
            foreach($d in @(Get-ChildItem -LiteralPath (Join-Path $BrainRoot 'Claud-Work') -Directory -Filter 'codex-windows-acceptance-*')){
                $hf=Join-Path $d.FullName 'evidence/PC-DELIVERY-STATE.json'
                if(-not (Test-Path -LiteralPath $hf)){continue}
                try{$h=Get-Content -LiteralPath $hf -Raw | ConvertFrom-Json;if($h.candidateCommit -eq [string]$m.candidateCommit){$locations+=[pscustomobject]@{file=Get-Item -LiteralPath $hf;path=Split-Path -Parent $hf}}}catch{}
            }
            if($locations.Count){$evidence=($locations | Sort-Object {$_.file.LastWriteTimeUtc} -Descending | Select-Object -First 1).path}
        }
        if($evidence){foreach($name in @('WINDOWS-ACCEPTANCE.json','PC-DELIVERY-STATE.json','tests.tap','tests-stderr.txt')){$p=Join-Path $evidence $name;if(Test-Path -LiteralPath $p){Copy-Item -LiteralPath $p -Destination (Join-Path $out $name)}}}
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'TESLIM.json') -Destination (Join-Path $out 'TESLIM.json')
        if($node -and ($report.deploymentInvoked -or $report.runtimeVerified)){
            try{& $node (Join-Path $PSScriptRoot 'collect-diagnostics.cjs') --brain-root $BrainRoot --out (Join-Path $out 'teshis')}catch{Write-Host 'Ek teshis yazilamadi; deploy sonucu ayri raporda korunuyor.'}
        }
        Compress-Archive -LiteralPath $out -DestinationPath ($out+'.zip') -ErrorAction Stop
        Write-Host ('GONDERILECEK_ZIP: '+$out+'.zip')
    } catch { Write-Host ('Rapor klasoru: '+$out+'; rapor ZIP yazimi tamamlanamadi.') }
}
exit $exitCode
