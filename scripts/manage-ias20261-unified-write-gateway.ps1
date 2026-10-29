param(
  [ValidateSet('Install', 'Start', 'Restart', 'Status', 'Watch', 'RepairTask')]
  [string]$Action = 'Status',
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env',
  [switch]$SkipBackendRestart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$productionRoot = 'E:\albinaa-platform-staging\albinaa-platform2'
$productionEnv = Join-Path $productionRoot '.env'
$developmentEnv = Join-Path $root '.env.ias20191-test'
$runtime = Join-Path $root 'data-ias20191-test\runtime'
$logs = Join-Path $runtime 'logs'
$secrets = Join-Path $runtime 'ias20261-unified-secrets'
$pidFile = Join-Path $runtime 'gateway-pids.json'
$statusFile = Join-Path $runtime 'ias20261-unified-status.json'
$serverScript = 'src/ias20261-unified-server.js'
$taskName = 'Albinaa IAS20261 Unified Write Gateway'
$unifiedPort = 13014
$secretFiles = [ordered]@{
  ORACLE_PURCHASE_RECEIPT_TRANSFER_PASSWORD = Join-Path $secrets 'purchase-receipt-transfer.credential.xml'
  ORACLE_PAYMENT_PASSWORD = Join-Path $secrets 'payment.credential.xml'
  ORACLE_JOURNAL_PASSWORD = Join-Path $secrets 'journal.credential.xml'
  ORACLE_INVENTORY_PASSWORD = Join-Path $secrets 'inventory.credential.xml'
}

function Read-EnvironmentFile([string]$path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $values }
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
  }
  return $values
}

function Set-EnvironmentValue([string]$path, [string]$name, [string]$value) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Environment file was not found: $path" }
  $lines = @(Get-Content -LiteralPath $path)
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match ('^' + [regex]::Escape($name) + '=')) {
      $found = $true
      "$name=$value"
    } else { $line }
  }
  if (-not $found) { $updated += "$name=$value" }
  $updated | Set-Content -LiteralPath $path -Encoding UTF8
}

function New-ApiKey {
  $bytes = [byte[]]::new(36)
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

function Protect-SecretDirectory {
  New-Item -ItemType Directory -Force -Path $secrets | Out-Null
  $directory = Get-Item -LiteralPath $secrets
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $rule = New-Object Security.AccessControl.FileSystemAccessRule(
    $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
  )
  $acl.AddAccessRule($rule)
  $directory.SetAccessControl($acl)
}

function Save-Credential([string]$path, [string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  if ($secure.Length -lt 12) { throw 'Password must contain at least 12 characters' }
  $secure | Export-Clixml -LiteralPath $path -Force
}

function Ensure-Credentials([bool]$replaceExisting) {
  Protect-SecretDirectory
  $prompts = [ordered]@{
    ORACLE_PURCHASE_RECEIPT_TRANSFER_PASSWORD = 'Enter ALBINAA20261WRITER password for receipt/transfer (input is hidden)'
    ORACLE_PAYMENT_PASSWORD = 'Enter ALBINAA20261PAYWRITER password for payment (input is hidden)'
    ORACLE_JOURNAL_PASSWORD = 'Enter ALBINAA20261JRNWRITER password for journals (input is hidden)'
    ORACLE_INVENTORY_PASSWORD = 'Enter ALBINAA20261INVWRITER password for inventory count (input is hidden)'
  }
  foreach ($name in $secretFiles.Keys) {
    $path = $secretFiles[$name]
    if ($replaceExisting -or -not (Test-Path -LiteralPath $path)) {
      Save-Credential $path $prompts[$name]
    }
  }
}

function Unprotect-Secret([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Encrypted credential was not found: $path" }
  $secure = Import-Clixml -LiteralPath $path
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
}

function Get-UnifiedHealth {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$unifiedPort/health" -TimeoutSec 3
    if ($health.status -eq 'ok' -and $health.schema -eq 'IAS20261' `
        -and $health.mode -eq 'IAS20261_UNIFIED_DRAFT_INSERT_ONLY') { return $health }
  } catch {}
  return $null
}

function Stop-KnownGateways {
  $allowed = 'ias20261-(unified|purchase|payment|journal|inventory)-server\.js'
  foreach ($port in 13014, 13215, 13216, 13217) {
    $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    foreach ($processId in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
      $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
      $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue).CommandLine
      if (-not $process -or $process.ProcessName -ne 'node' -or $commandLine -notmatch $allowed) {
        throw "Port $port is owned by an unexpected process: $processId"
      }
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      $process.WaitForExit()
    }
  }
}

function Update-PlatformEnvironment([string]$apiKey) {
  $names = 'PURCHASE', 'TRANSFER', 'RECEIPT', 'PAYMENT', 'JOURNAL', 'INVENTORY'
  foreach ($path in $productionEnv, $developmentEnv) {
    foreach ($name in $names) {
      Set-EnvironmentValue $path "ORACLE_IAS20261_${name}_WRITE_API_KEY" $apiKey
      Set-EnvironmentValue $path "ORACLE_IAS20261_${name}_WRITE_ENABLED" 'true'
      Set-EnvironmentValue $path "ORACLE_IAS20261_${name}_WRITE_API_URL" "http://127.0.0.1:$unifiedPort"
      Set-EnvironmentValue $path "ORACLE_IAS20261_${name}_WRITE_SCHEMA" 'IAS20261'
    }
  }
}

function Wait-Health([System.Diagnostics.Process]$process) {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ($process.HasExited) { throw "Unified gateway stopped before becoming ready: $($process.Id)" }
    $health = Get-UnifiedHealth
    if ($health) { return $health }
    Start-Sleep -Milliseconds 500
  }
  throw "Unified gateway did not become ready on 127.0.0.1:$unifiedPort"
}

function Start-UnifiedGateway([bool]$restart) {
  $current = Get-UnifiedHealth
  if ($current -and -not $restart) { return $current }
  if ($restart -or -not $current) { Stop-KnownGateways }

  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) { throw "Read API environment file was not found: $ReadApiEnvPath" }
  foreach ($path in $secretFiles.Values) {
    if (-not (Test-Path -LiteralPath $path)) { throw 'Run this script with -Action Install first' }
  }
  $oracle = Read-EnvironmentFile $ReadApiEnvPath
  if (-not $oracle['ORACLE_CONNECT_STRING'] -or -not $oracle['ORACLE_CLIENT_LIB_DIR']) {
    throw 'Oracle connection location settings are missing'
  }
  $production = Read-EnvironmentFile $productionEnv
  $development = Read-EnvironmentFile $developmentEnv
  $apiKey = $production['ORACLE_IAS20261_RECEIPT_WRITE_API_KEY']
  if (-not $apiKey -or $apiKey -eq 'disabled') { $apiKey = $development['ORACLE_IAS20261_RECEIPT_WRITE_API_KEY'] }
  if (-not $apiKey -or $apiKey -eq 'disabled') { $apiKey = New-ApiKey }

  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $node = (Get-Command node -ErrorAction Stop).Source
  $environmentNames = @(
    'HOST', 'PORT', 'ORACLE_CONNECT_STRING', 'ORACLE_CLIENT_LIB_DIR', 'ORACLE_SCHEMA',
    'ORACLE_REQUEST_BRANCH_YEAR', 'ORACLE_AD_USER_ID', 'ORACLE_WRITE_API_KEY', 'ORACLE_QUOTATIONS_WRITE_ENABLED', 'ORACLE_SALES_ORDERS_WRITE_ENABLED'
  ) + @($secretFiles.Keys)
  try {
    $env:HOST = '127.0.0.1'
    $env:PORT = "$unifiedPort"
    $env:ORACLE_CONNECT_STRING = $oracle['ORACLE_CONNECT_STRING']
    $env:ORACLE_CLIENT_LIB_DIR = $oracle['ORACLE_CLIENT_LIB_DIR']
    $env:ORACLE_SCHEMA = 'IAS20261'
    $env:ORACLE_REQUEST_BRANCH_YEAR = '2026'
    $env:ORACLE_AD_USER_ID = '1'
    $env:ORACLE_WRITE_API_KEY = $apiKey
    $env:ORACLE_QUOTATIONS_WRITE_ENABLED = if ($production['ORACLE_QUOTATIONS_WRITE_ENABLED'] -eq 'true') { 'true' } else { 'false' }
    $env:ORACLE_SALES_ORDERS_WRITE_ENABLED = if ($production['ORACLE_SALES_ORDERS_WRITE_ENABLED'] -eq 'true') { 'true' } else { 'false' }
    foreach ($name in $secretFiles.Keys) { Set-Item "Env:$name" (Unprotect-Secret $secretFiles[$name]) }

    $gateway = Start-Process -FilePath $node -ArgumentList $serverScript `
      -WorkingDirectory (Join-Path $root 'oracle-write-api') `
      -RedirectStandardOutput (Join-Path $logs 'ias20261-unified-write.out.log') `
      -RedirectStandardError (Join-Path $logs 'ias20261-unified-write.err.log') `
      -WindowStyle Hidden -PassThru
    try { $health = Wait-Health $gateway }
    catch {
      # Only the exact child started by this attempt may be terminated. A stuck
      # connection must not leave orphan gateways behind on every retry.
      if (-not $gateway.HasExited) { Stop-Process -Id $gateway.Id -Force -ErrorAction SilentlyContinue }
      throw
    }
    if ($Action -eq 'Install') { Update-PlatformEnvironment $apiKey }
    $pids = [ordered]@{ ias20261UnifiedWriteApi = $gateway.Id; updatedAt = (Get-Date).ToString('o') }
    $pids | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
    $health | Add-Member -NotePropertyName processId -NotePropertyValue $gateway.Id -Force
    return $health
  } finally {
    foreach ($name in $environmentNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    $apiKey = $null
  }
}

function Restart-ProductionBackend {
  if ($SkipBackendRestart) { return }
  & docker compose --env-file $productionEnv -f (Join-Path $productionRoot 'docker-compose.clean.yml') `
    up -d --no-deps --force-recreate backend
  if ($LASTEXITCODE -ne 0) { throw 'The 3003 platform backend could not be restarted' }
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:18002/health' -TimeoutSec 3
      if ($health.status -eq 'ok') { return }
    } catch {}
    Start-Sleep -Seconds 2
  }
  throw 'The 3003 platform backend did not become healthy after restart'
}

function Install-WatchTask {
  $powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Action Watch -SkipBackendRestart"
  $taskAction = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1)
  $settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger @($trigger, $recoveryTrigger) -Settings $settings `
    -Principal $principal -Force | Out-Null
}

function Write-Status([object]$health, [string]$state) {
  [ordered]@{
    state = $state
    checkedAt = (Get-Date).ToString('o')
    port = $unifiedPort
    health = $health
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statusFile -Encoding UTF8
}

switch ($Action) {
  'RepairTask' {
    # Repair scheduling without prompting for, replacing, or rotating secrets.
    Install-WatchTask
    Start-ScheduledTask -TaskName $taskName
    Write-Host 'Unified gateway recovery task repaired; existing credentials and platform settings retained.'
  }
  'Install' {
    Ensure-Credentials $true
    $health = Start-UnifiedGateway $true
    Install-WatchTask
    Restart-ProductionBackend
    Write-Status $health 'ready'
    Write-Host 'SUCCESS: Unified IAS20261 gateway is ready and automatic recovery is installed.' -ForegroundColor Green
    Write-Host 'Receipt, payment, journal, inventory count, inventory transfer, and purchase drafts share port 13014.' -ForegroundColor Green
  }
  'Start' {
    $health = Start-UnifiedGateway $false
    Restart-ProductionBackend
    Write-Status $health 'ready'
    $health | ConvertTo-Json -Depth 5
  }
  'Restart' {
    Ensure-Credentials $false
    $health = Start-UnifiedGateway $true
    Restart-ProductionBackend
    Write-Status $health 'ready'
    $health | ConvertTo-Json -Depth 5
  }
  'Status' {
    $health = Get-UnifiedHealth
    if ($health) {
      Write-Status $health 'ready'
      $health | ConvertTo-Json -Depth 5
    } else {
      Write-Status $null 'stopped'
      Write-Host 'STOPPED: Unified IAS20261 gateway is not healthy.' -ForegroundColor Red
      exit 1
    }
  }
  'Watch' {
    while ($true) {
      try {
        $health = Get-UnifiedHealth
        if (-not $health) { $health = Start-UnifiedGateway $false }
        Write-Status $health 'ready'
      } catch {
        Write-Status @{ error = $_.Exception.Message } 'recovering'
      }
      Start-Sleep -Seconds 30
    }
  }
}
