$ErrorActionPreference = 'Stop'

$taskName = 'AlBinaa Oracle Read API'
$startScript = Join-Path $PSScriptRoot 'start-persistent.ps1'
$userId = "$env:USERDOMAIN\$env:USERNAME"
$actionArguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $watchdogTrigger) `
  -Principal $principal -Settings $settings -Force | Out-Null

$listeners = Get-NetTCPConnection -LocalPort 3011 -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'src/server\.js') {
    throw "Unexpected process owns port 3011: $($listener.OwningProcess)"
  }
  Stop-Process -Id $listener.OwningProcess -Force
}

Start-ScheduledTask -TaskName $taskName
# Task Scheduler may queue the first launch briefly while replacing the old
# instance. The watchdog trigger is one minute, so allow enough time for that
# guaranteed recovery path before reporting failure.
$deadline = (Get-Date).AddSeconds(90)
$healthy = $false
do {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3011/health' -TimeoutSec 1
    if ($response.status -eq 'ok') { $healthy = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if (-not $healthy) { throw 'Persistent gateway did not become healthy' }

Write-Output 'PERSISTENT_GATEWAY_READY'
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
Get-NetTCPConnection -LocalPort 3011 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
