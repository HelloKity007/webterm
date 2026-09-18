$ErrorActionPreference = 'Stop'
$port = 9335
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "QA port $port is already occupied; do not replace an existing browser"
}
$name = 'WebTermStrictQA-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$profile = Join-Path $env:TEMP $name
if (Test-Path -LiteralPath $profile) { throw 'QA profile already exists' }
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path -LiteralPath $edge)) { throw 'Microsoft Edge is not installed at the expected path' }
# A separate interactive QA profile. Never stop or modify the user's Edge.
$arguments = '--user-data-dir="' + $profile + '" --remote-debugging-port=' + $port + ' --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check about:blank'
$action = New-ScheduledTaskAction -Execute $edge -Argument $arguments
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4)
Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $name
$version = $null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try { $version = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/json/version') -TimeoutSec 1; break } catch {}
  Start-Sleep -Milliseconds 250
}
[pscustomobject]@{ task = $name; profile = $profile; port = $port; ready = ($null -ne $version); browser = $version.Browser; taskResult = (Get-ScheduledTaskInfo -TaskName $name).LastTaskResult } | ConvertTo-Json -Compress
