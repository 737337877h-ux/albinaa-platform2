param(
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'data-ias20191-test\runtime'
$webEnvFile = Join-Path $root '.env.ias20191-test'
$pidFile = Join-Path $runtime 'gateway-pids.json'
$logs = Join-Path $runtime 'logs'
$passwordPointer = [IntPtr]::Zero
$journalProcess = $null
$started = $false

function Read-Hidden([string]$prompt, [int]$minimumLength) {
  $secure = Read-Host $prompt -AsSecureString
  $script:passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($script:passwordPointer)
  if ($plain.Length -lt $minimumLength) { throw "Password must contain at least $minimumLength characters" }
  return $plain
}

function Read-EnvironmentFile([string]$path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1].Trim()] = $matches[2].Trim() }
  }
  return $values
}

function Set-EnvironmentValue([string]$path, [string]$name, [string]$value) {
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

function Wait-Health([string]$url, [System.Diagnostics.Process]$process) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw "Gateway process stopped before becoming ready: $($process.Id)" }
    try {
      $response = Invoke-RestMethod -Uri $url -TimeoutSec 2
      if ($response.status -eq 'ok' -and $response.schema -eq 'IAS20261' `
          -and $response.mode -eq 'IAS20261_JOURNAL_DRAFT_INSERT_ONLY') { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "Gateway did not become ready: $url"
}

try {
  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) { throw "Read API environment file was not found: $ReadApiEnvPath" }
  if (-not (Test-Path -LiteralPath $webEnvFile)) { throw "Platform environment file was not found: $webEnvFile" }
  $oracle = Read-EnvironmentFile $ReadApiEnvPath
  $web = Read-EnvironmentFile $webEnvFile
  if (-not $oracle['ORACLE_CONNECT_STRING'] -or -not $oracle['ORACLE_CLIENT_LIB_DIR']) {
    throw 'Oracle connection location settings are missing'
  }

  $apiKey = $web['ORACLE_IAS20261_JOURNAL_WRITE_API_KEY']
  if (-not $apiKey -or $apiKey -eq 'disabled') {
    $bytes = [byte[]]::new(36)
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $apiKey = [Convert]::ToBase64String($bytes)
  }

  $journalPassword = Read-Hidden 'Enter ALBINAA20261JRNWRITER password (input is hidden)' 12

  $listeners = @(Get-NetTCPConnection -LocalPort 13216 -State Listen -ErrorAction SilentlyContinue)
  foreach ($processId in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
    $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue).CommandLine
    if (-not $process -or $process.ProcessName -ne 'node' -or $commandLine -notmatch 'ias20261-journal-server\.js') {
      throw "Port 13216 is owned by an unexpected process: $processId"
    }
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
    $process.WaitForExit()
  }

  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $node = (Get-Command node -ErrorAction Stop).Source
  $env:HOST = '127.0.0.1'
  $env:PORT = '13216'
  $env:ORACLE_USER = 'ALBINAA20261JRNWRITER'
  $env:ORACLE_PASSWORD = $journalPassword
  $env:ORACLE_CONNECT_STRING = $oracle['ORACLE_CONNECT_STRING']
  $env:ORACLE_CLIENT_LIB_DIR = $oracle['ORACLE_CLIENT_LIB_DIR']
  $env:ORACLE_SCHEMA = 'IAS20261'
  $env:ORACLE_REQUEST_BRANCH_YEAR = '2026'
  $env:ORACLE_AD_USER_ID = '1'
  $env:ORACLE_WRITE_API_KEY = $apiKey

  $journalProcess = Start-Process -FilePath $node -ArgumentList 'src/ias20261-journal-server.js' `
    -WorkingDirectory (Join-Path $root 'oracle-write-api') `
    -RedirectStandardOutput (Join-Path $logs 'ias20261-journal-write.out.log') `
    -RedirectStandardError (Join-Path $logs 'ias20261-journal-write.err.log') `
    -WindowStyle Hidden -PassThru

  Wait-Health 'http://127.0.0.1:13216/health' $journalProcess

  Set-EnvironmentValue $webEnvFile 'ORACLE_IAS20261_JOURNAL_WRITE_API_URL' 'http://127.0.0.1:13216'
  Set-EnvironmentValue $webEnvFile 'ORACLE_IAS20261_JOURNAL_WRITE_API_KEY' $apiKey
  Set-EnvironmentValue $webEnvFile 'ORACLE_IAS20261_JOURNAL_WRITE_SCHEMA' 'IAS20261'
  Set-EnvironmentValue $webEnvFile 'ORACLE_IAS20261_JOURNAL_WRITE_ENABLED' 'true'

  $gatewayPids = [ordered]@{
    readApi = $null
    writeApi = $null
    ias20261PurchaseWriteApi = $null
    ias20261PaymentWriteApi = $null
    ias20261JournalWriteApi = $journalProcess.Id
  }
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      $gatewayPids.readApi = $saved.readApi
      $gatewayPids.writeApi = $saved.writeApi
      $gatewayPids.ias20261PurchaseWriteApi = $saved.ias20261PurchaseWriteApi
      $gatewayPids.ias20261PaymentWriteApi = $saved.ias20261PaymentWriteApi
    } catch {}
  }
  $gatewayPids | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
  $started = $true
  Write-Host 'SUCCESS: IAS20261 journal draft Write API is ready on 127.0.0.1:13216.' -ForegroundColor Green
  Write-Host 'Only journal Dry Run and unapproved draft INSERT routes are exposed.' -ForegroundColor Green
  Write-Host 'No voucher, purchasing, inventory, posting, approval-decision, update, or delete route exists.' -ForegroundColor Green
  Write-Host 'Restart the platform backend to activate the journal writer.' -ForegroundColor Yellow
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  'HOST','PORT','ORACLE_USER','ORACLE_PASSWORD','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA',
  'ORACLE_REQUEST_BRANCH_YEAR','ORACLE_AD_USER_ID','ORACLE_WRITE_API_KEY' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  $journalPassword = $null
  $apiKey = $null
  if (-not $started -and $journalProcess -and -not $journalProcess.HasExited) {
    Stop-Process -Id $journalProcess.Id -Force -ErrorAction SilentlyContinue
  }
}

Read-Host 'Press Enter to close this window'
