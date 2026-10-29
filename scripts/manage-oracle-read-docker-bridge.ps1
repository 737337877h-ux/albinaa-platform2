param(
  [ValidateSet('Install', 'Start', 'Restart', 'Status')]
  [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'
$taskName = 'AlBinaa Oracle Read Docker Bridge'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $scriptDirectory 'oracle-read-docker-bridge.js'
$node = (Get-Command node -ErrorAction Stop).Source
$bridgePort = 23018

function Get-BridgeListener {
  Get-NetTCPConnection -State Listen -LocalPort $bridgePort -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Wait-Bridge {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $listener = Get-BridgeListener
    if ($listener) { return $listener }
    Start-Sleep -Milliseconds 500
  }
  throw "Oracle Docker bridge did not listen on port $bridgePort"
}

function Install-BridgeTask {
  if (-not (Test-Path -LiteralPath $bridgeScript)) {
    throw "Bridge script not found: $bridgeScript"
  }

  $taskAction = New-ScheduledTaskAction `
    -Execute $node `
    -Argument ('"{0}"' -f $bridgeScript) `
    -WorkingDirectory $scriptDirectory
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
  # A one-minute recurring trigger is a watchdog: MultipleInstances=IgnoreNew
  # keeps exactly one bridge while it is healthy, and starts it again within a
  # minute if Windows, Docker Desktop, or an operator stopped the process.
  $watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1)
  $settings = New-ScheduledTaskSettingsSet `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal `
    -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited

  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger @($logonTrigger, $watchdogTrigger) `
    -Settings $settings -Principal $principal -Force | Out-Null
}

function Stop-BridgeTask {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (-not (Get-BridgeListener)) { return }
    Start-Sleep -Milliseconds 250
  }

  # Stop only the exact stale bridge process. Never stop Node processes broadly.
  $listener = Get-BridgeListener
  if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -like "*$bridgeScript*") {
      Stop-Process -Id $listener.OwningProcess -Force
    }
  }

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (-not (Get-BridgeListener)) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "Port $bridgePort is still occupied after stopping the exact bridge task"
}

function Start-BridgeTask([bool]$restart) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) { throw "Scheduled task is not installed. Run with -Action Install" }

  if (-not $restart -and (Get-BridgeListener)) { return Get-BridgeListener }
  if ($restart) { Stop-BridgeTask }
  Start-ScheduledTask -TaskName $taskName
  Wait-Bridge
}

switch ($Action) {
  'Install' {
    Install-BridgeTask
    Start-BridgeTask $true | Out-Null
  }
  'Start' {
    Start-BridgeTask $false | Out-Null
  }
  'Restart' {
    Start-BridgeTask $true | Out-Null
  }
  'Status' {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $listener = Get-BridgeListener
    [pscustomobject]@{
      taskInstalled = [bool]$task
      taskState = if ($task) { [string]$task.State } else { 'Missing' }
      bridgePort = $bridgePort
      listening = [bool]$listener
      processId = if ($listener) { $listener.OwningProcess } else { $null }
    } | ConvertTo-Json
    if (-not $task -or -not $listener) { exit 2 }
    exit 0
  }
}

[pscustomobject]@{
  status = 'ok'
  taskName = $taskName
  bridgePort = $bridgePort
  target = '127.0.0.1:3011'
} | ConvertTo-Json
