param(
  [ValidateSet('Run','Install','Status','Remove')]
  [string]$Mode = 'Run',
  [string]$ProductionRoot = 'E:\albinaa-platform-staging\albinaa-platform2',
  [string]$LanUrl = 'http://192.168.1.5:3003/login'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'platform-storage-guard.ps1')
$taskName = 'Albinaa Platform 3003 Watchdog'
$composeFile = Join-Path $ProductionRoot 'docker-compose.clean.yml'
$environmentFile = Join-Path $ProductionRoot '.env'
$logDirectory = Join-Path $ProductionRoot 'data-clean\logs'
$logPath = Join-Path $logDirectory 'platform-3003-watchdog.log'
$localFrontendUrl = 'http://127.0.0.1:3003/login'
$localBackendUrl = 'http://127.0.0.1:18002/health/ready'
$oracleReadServiceUrl = 'http://127.0.0.1:3011/health'
$oracleReadBridgeUrl = 'http://127.0.0.1:23018/health'
$oracleWriteGatewayUrl = 'http://127.0.0.1:13014/health'
$oracleReadTaskName = 'AlBinaa Oracle Read API'
$oracleBridgeManager = Join-Path $PSScriptRoot 'manage-oracle-read-docker-bridge.ps1'
$oracleWriteManager = Join-Path $PSScriptRoot 'manage-ias20261-unified-write-gateway.ps1'

function Write-WatchdogEvent([string]$eventName, [hashtable]$data) {
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  [ordered]@{
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    event = $eventName
    data = $data
  } | ConvertTo-Json -Compress | Add-Content -LiteralPath $logPath -Encoding UTF8
}

function Test-HttpEndpoint([string]$url, [int]$timeoutSeconds = 8) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeoutSeconds
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400 -and $response.RawContentLength -gt 0
  } catch {
    return $false
  }
}

function Invoke-ProductionCompose([string[]]$arguments) {
  if (-not (Test-Path -LiteralPath $composeFile) -or -not (Test-Path -LiteralPath $environmentFile)) {
    throw 'Production compose or protected environment file is missing.'
  }
  & docker.exe compose --env-file $environmentFile -f $composeFile @arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed: $($arguments -join ' ')" }
}

function Test-DockerReady {
  $probe = New-Object System.Diagnostics.Process
  try {
    $probe.StartInfo.FileName = (Get-Command docker.exe).Source
    $probe.StartInfo.Arguments = 'info --format {{.ServerVersion}}'
    $probe.StartInfo.UseShellExecute = $false
    $probe.StartInfo.CreateNoWindow = $true
    $probe.StartInfo.RedirectStandardOutput = $true
    $probe.StartInfo.RedirectStandardError = $true
    [void]$probe.Start()
    $stdout = $probe.StandardOutput.ReadToEndAsync()
    $stderr = $probe.StandardError.ReadToEndAsync()
    if (-not $probe.WaitForExit(10000)) { $probe.Kill(); return $false }
    return $probe.ExitCode -eq 0
  } catch {
    return $false
  } finally {
    $probe.Dispose()
  }
}

function Wait-HttpEndpoint([string]$url, [int]$attempts = 15) {
  for ($attempt = 0; $attempt -lt $attempts; $attempt++) {
    if (Test-HttpEndpoint $url 3) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Repair-OracleReadService {
  if (Test-HttpEndpoint $oracleReadServiceUrl 3) { return $true }
  Write-WatchdogEvent 'oracle_read_service_recovery_started' @{}
  $task = Get-ScheduledTask -TaskName $oracleReadTaskName -ErrorAction SilentlyContinue
  if (-not $task) { return $false }
  Stop-ScheduledTask -TaskName $oracleReadTaskName -ErrorAction SilentlyContinue
  foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort 3011 -ErrorAction SilentlyContinue)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -match 'oracle-read-api.*src[\\/]server\.js') {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  Start-ScheduledTask -TaskName $oracleReadTaskName
  return (Wait-HttpEndpoint $oracleReadServiceUrl 20)
}

function Repair-OracleGateways {
  $readServiceReady = Repair-OracleReadService
  $readBridgeReady = Test-HttpEndpoint $oracleReadBridgeUrl 3
  if ($readServiceReady -and -not $readBridgeReady -and (Test-Path -LiteralPath $oracleBridgeManager)) {
    Write-WatchdogEvent 'oracle_read_bridge_recovery_started' @{}
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $oracleBridgeManager -Action Restart | Out-Null
    $readBridgeReady = Wait-HttpEndpoint $oracleReadBridgeUrl 20
  }

  $writeGatewayReady = Test-HttpEndpoint $oracleWriteGatewayUrl 3
  if (-not $writeGatewayReady -and (Test-Path -LiteralPath $oracleWriteManager)) {
    Write-WatchdogEvent 'oracle_write_gateway_recovery_started' @{}
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $oracleWriteManager `
      -Action Start -SkipBackendRestart | Out-Null
    $writeGatewayReady = Wait-HttpEndpoint $oracleWriteGatewayUrl 25
  }
  return [ordered]@{
    readService = $readServiceReady
    readBridge = $readBridgeReady
    writeGateway = $writeGatewayReady
  }
}

function Repair-KnownDockerSocketCrash {
  $hostLog = Join-Path $env:LOCALAPPDATA 'Docker\log\host\com.docker.backend.exe.log'
  if (-not (Test-Path -LiteralPath $hostLog)) { return $false }
  $crashes = @(Get-Content -LiteralPath $hostLog -Tail 500 | Where-Object {
    $_ -match 'backend crashed,.*starting services: initializing (Inference manager|Secrets Engine):.*(dockerInference|engine\.sock).*The file cannot be accessed by the system'
  })
  if ($crashes.Count -eq 0) { return $false }
  $crash = $crashes[-1]
  if ($crash -notmatch '^\[([^\]]+)\]') { return $false }
  $crashTime = [DateTimeOffset]::Parse($Matches[1])
  if ($crashTime.UtcDateTime -lt [DateTime]::UtcNow.AddMinutes(-10)) { return $false }
  if (Test-Path -LiteralPath $logPath) {
    $recentRecovery = @(Get-Content -LiteralPath $logPath -Tail 100 | ForEach-Object {
      try { $_ | ConvertFrom-Json } catch { }
    } | Where-Object { $_.event -eq 'docker_socket_recovery_started' -and [DateTimeOffset]::Parse($_.timestampUtc).UtcDateTime -gt [DateTime]::UtcNow.AddMinutes(-10) })
    if ($recentRecovery.Count -gt 0) { return $false }
  }
  # Only transient socket directories may be rotated; database disks stay elsewhere.
  $targets = @(
    @{ Path = (Join-Path $env:LOCALAPPDATA 'Docker\run'); Allowed = @('dockerInference','dockerEthernetVfkit','userAnalyticsOtlpHttp.sock') },
    @{ Path = (Join-Path $env:LOCALAPPDATA 'docker-secrets-engine'); Allowed = @('engine.sock') }
  )
  foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target.Path)) { continue }
    $entry = Get-Item -LiteralPath $target.Path
    if ((Resolve-Path -LiteralPath $target.Path).Path -ne $target.Path -or
        ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected socket directory path.' }
    foreach ($child in @(Get-ChildItem -LiteralPath $target.Path -Force)) {
      if ($child.PSIsContainer -or $child.Name -notin $target.Allowed) { throw 'Unexpected file in socket directory; manual review required.' }
    }
  }
  Write-WatchdogEvent 'docker_socket_recovery_started' @{ crashUtc = $crashTime.ToString('o') }
  $dockerRoot = Join-Path $env:ProgramFiles 'Docker\Docker\'
  Get-CimInstance Win32_Process -Filter "Name = 'Docker Desktop.exe' OR Name = 'com.docker.backend.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dockerRoot, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target.Path)) { continue }
    $backupName = (Split-Path $target.Path -Leaf) + '-recovery-' + $stamp
    Rename-Item -LiteralPath $target.Path -NewName $backupName
    New-Item -ItemType Directory -Path $target.Path -Force | Out-Null
    Write-WatchdogEvent 'docker_socket_directory_retained' @{ original = $target.Path; backupName = $backupName }
  }
  Start-Process -FilePath (Join-Path $dockerRoot 'Docker Desktop.exe') -WindowStyle Hidden
  return $true
}

if ($Mode -eq 'Install') {
  $powerShell = (Get-Command powershell.exe).Source
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Mode Run -ProductionRoot `"$ProductionRoot`" -LanUrl `"$LanUrl`""
  $action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments
  $logon = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon,$watchdog) `
    -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output "Installed: $taskName"
  exit 0
}

if ($Mode -eq 'Status') {
  Get-ScheduledTask -TaskName $taskName -ErrorAction Stop | Get-ScheduledTaskInfo
  if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 12 }
  exit 0
}

if ($Mode -eq 'Remove') {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed: $taskName"
  exit 0
}

$mutex = New-Object Threading.Mutex($false, 'Local\AlbinaaPlatform3003Watchdog')
$locked = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { exit 0 }
  if (-not (Test-DockerReady)) {
    if (Repair-KnownDockerSocketCrash) { exit 1 }
    $desktopRunning = Get-Process -Name 'Docker Desktop','com.docker.backend' -ErrorAction SilentlyContinue
    if (-not $desktopRunning) {
      $desktopPath = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
      if (-not (Test-Path -LiteralPath $desktopPath)) { throw 'Docker Desktop executable is missing.' }
      Start-Process -FilePath $desktopPath -WindowStyle Hidden
      Write-WatchdogEvent 'docker_start_requested' @{}
    }
    # Allow startup to finish on the next recurring check, without overlapping launches.
    Write-WatchdogEvent 'docker_starting_or_unavailable' @{}
    exit 1
  }

  $storage = Get-AlbinaaStorageHeadroom -DatabasePath (Get-AlbinaaDatabaseStoragePath) -RuntimePath $ProductionRoot
  if (-not $storage.ok) {
    Write-WatchdogEvent 'storage_low' $storage
    # Repeated restarts cannot repair a full filesystem and can obscure the cause.
    exit 1
  }
  $oracleGateways = Repair-OracleGateways
  Write-WatchdogEvent 'oracle_gateways_checked' $oracleGateways

  $backendReady = Test-HttpEndpoint $localBackendUrl
  if (-not $backendReady) {
    Write-WatchdogEvent 'backend_recovery_started' @{}
    Invoke-ProductionCompose @('up','-d','backend')
    Start-Sleep -Seconds 5
    $backendReady = Test-HttpEndpoint $localBackendUrl 12
  }

  $frontendReady = Test-HttpEndpoint $localFrontendUrl
  if (-not $frontendReady -and $backendReady) {
    Write-WatchdogEvent 'frontend_port_recovery_started' @{ reason = 'host_endpoint_empty_or_unreachable' }
    Invoke-ProductionCompose @('up','-d','--no-deps','--force-recreate','frontend')
    for ($attempt = 1; $attempt -le 12 -and -not $frontendReady; $attempt++) {
      Start-Sleep -Seconds 2
      $frontendReady = Test-HttpEndpoint $localFrontendUrl
    }
  }

  $lanReady = if ($LanUrl) { Test-HttpEndpoint $LanUrl } else { $null }
  Write-WatchdogEvent 'health_checked' @{
    backend = $backendReady
    frontend = $frontendReady
    lan = $lanReady
    oracleReadService = $oracleGateways.readService
    oracleReadBridge = $oracleGateways.readBridge
    oracleWriteGateway = $oracleGateways.writeGateway
  }
  if (-not $backendReady -or -not $frontendReady -or -not $oracleGateways.readService `
      -or -not $oracleGateways.readBridge -or -not $oracleGateways.writeGateway) { exit 1 }
} catch {
  Write-WatchdogEvent 'watchdog_failed' @{ message = $_.Exception.Message }
  exit 1
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
