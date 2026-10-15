param([Parameter(Mandatory=$true)][string]$CandidateSha256)
$ErrorActionPreference='Stop'
$root=Join-Path (Get-Location) '.cache/native-windows'
$evidence=Join-Path (Get-Location) '.artifacts/native-windows'
if(Test-Path $root){throw 'Native app qualification requires a fresh app directory'}
New-Item -ItemType Directory -Path $root,$evidence -Force | Out-Null
$installer=Join-Path $root 'Nimbalyst-Windows-x64.exe'
$url='https://github.com/nimbalyst/nimbalyst/releases/download/v0.80.6/Nimbalyst-Windows-x64.exe'
$expected='b7f2e307e94f438980f83ab59490d5b969c7d66b0904c857d22e616771670c94'
Invoke-WebRequest -Uri $url -OutFile $installer -TimeoutSec 300
if((Get-Item $installer).Length -ne 411583600 -or (Get-FileHash -Algorithm SHA256 $installer).Hash.ToLowerInvariant() -ne $expected){throw 'Official released Windows app hash/size mismatch'}
$seven=(Get-Command 7z.exe -ErrorAction Stop).Source
$stage=Join-Path $root 'installer-content'; & $seven x $installer "-o$stage" -y *> (Join-Path $evidence 'extract-installer.log');if($LASTEXITCODE -ne 0){throw 'Official installer extraction failed'}
$payload=@(Get-ChildItem $stage -Recurse -File -Filter 'app-64.7z');if($payload.Count -ne 1){throw 'Expected exactly one official x64 application payload'}
$appDir=Join-Path $root 'app'; & $seven x $payload[0].FullName "-o$appDir" -y *> (Join-Path $evidence 'extract-app.log');if($LASTEXITCODE -ne 0){throw 'Official app payload extraction failed'}
$executables=@(Get-ChildItem $appDir -Recurse -File -Filter 'Nimbalyst.exe');if($executables.Count -ne 1){throw 'Expected exactly one released Nimbalyst executable'}
$exe=$executables[0].FullName;$profile=Join-Path $root 'profile';$workspace=Join-Path $root 'workspace';New-Item -ItemType Directory -Path $workspace | Out-Null
[IO.File]::WriteAllText((Join-Path $workspace 'brief.terraphim.md'),"Risk requires a Decision.`n",[Text.UTF8Encoding]::new($false))
$inputReceipt=Get-Content (Join-Path $evidence 'input-receipt.json') -Raw | ConvertFrom-Json
python scripts/native/verify-candidate.py --package $inputReceipt.packagePath --destination (Join-Path $profile 'extensions/terraphim-editor') --sha256 $CandidateSha256 --receipt (Join-Path $evidence 'installed-inputs.json')
if($LASTEXITCODE -ne 0){throw 'Candidate installation verification failed'}
$portListener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$portListener.Start();$port=$portListener.LocalEndpoint.Port;$portListener.Stop()
$safeNames=@('SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','HOMEDRIVE','HOMEPATH','PATH','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS')
$appEnvironment=@{};foreach($name in $safeNames){$value=[Environment]::GetEnvironmentVariable($name,'Process');if($null -ne $value){$appEnvironment[$name]=$value}}
$appEnvironment['NIMBALYST_USER_DATA_DIR']=$profile;$appEnvironment['NIMBALYST_USER_DATA_PATH']=$profile;$appEnvironment['NODE_ENV']='production'
$rule='TerraphimNativeQualification-'+[Guid]::NewGuid().ToString();$process=$null;$exit=1
try {
 New-NetFirewallRule -DisplayName $rule -Direction Outbound -Program $exe -Action Block -Profile Any | Out-Null
 $appArguments=@("--remote-debugging-port=$port",'--remote-debugging-address=127.0.0.1','--workspace',$workspace,'--file',(Join-Path $workspace 'brief.terraphim.md'))
 $startInfo=[Diagnostics.ProcessStartInfo]::new($exe);$startInfo.UseShellExecute=$false;$startInfo.RedirectStandardOutput=$true;$startInfo.RedirectStandardError=$true;$startInfo.Environment.Clear()
 foreach($entry in $appEnvironment.GetEnumerator()){$startInfo.Environment[$entry.Key]=$entry.Value};foreach($argument in $appArguments){$startInfo.ArgumentList.Add($argument)}
 $process=[Diagnostics.Process]::Start($startInfo);$stdoutTask=$process.StandardOutput.ReadToEndAsync();$stderrTask=$process.StandardError.ReadToEndAsync()
 @{scope='Actual official app launch inputs; no qualification result';url=$url;installerSha256=$expected;executableSha256=(Get-FileHash -Algorithm SHA256 $exe).Hash.ToLowerInvariant();productVersion=$executables[0].VersionInfo.ProductVersion;pid=$process.Id;profile=$profile;workspace=$workspace;argv=$appArguments;environmentKeys=@($startInfo.Environment.Keys | Sort-Object);network='Outbound app traffic blocked by job-local firewall rule'} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $evidence 'launch.json')
 $ready=$false
 for($n=0;$n -lt 60;$n++){if($process.HasExited){throw 'Released app exited before exposing its renderer'};try{Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 1 | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $evidence 'cdp-runtime.json');$ready=$true;break}catch{Start-Sleep -Milliseconds 500}}
 if(-not $ready){throw 'Actual released app did not expose its renderer within deadline'}
 node scripts/native/lifecycle.mjs "http://127.0.0.1:$port" $workspace $evidence
 $exit=$LASTEXITCODE
} finally {
 if($null -ne $process -and -not $process.HasExited){taskkill /PID $process.Id /T /F *> (Join-Path $evidence 'owned-process-cleanup.log')}
 if($null -ne $process){$null=$process.WaitForExit(5000);if($stdoutTask.IsCompleted){[IO.File]::WriteAllText((Join-Path $evidence 'app.stdout'),$stdoutTask.Result)};if($stderrTask.IsCompleted){[IO.File]::WriteAllText((Join-Path $evidence 'app.stderr'),$stderrTask.Result)}}
 Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
 python scripts/native/verify-candidate.py --package $inputReceipt.packagePath --destination (Join-Path $profile 'extensions/terraphim-editor') --sha256 $CandidateSha256 --verify-installed --receipt (Join-Path $evidence 'post-run-installed-files.json')
 if($LASTEXITCODE -ne 0){$exit=1}
 # Preserve the actual source on both failure and success; this is never substituted with fixture input.
 $actual=Join-Path $workspace 'brief.terraphim.md';if(Test-Path $actual){Copy-Item $actual (Join-Path $evidence 'workspace-source-after.md')}
}
exit $exit
