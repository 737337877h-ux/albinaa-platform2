param(
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'data-ias20191-test\runtime'
$envFile = Join-Path $root '.env.ias20191-test'
$pidFile = Join-Path $runtime 'gateway-pids.json'
$passwordPointers = @()
$readProcess = $null
$writeProcess = $null
$started = $false

function New-RandomSecret([int]$bytes = 48) {
  $buffer = New-Object byte[] $bytes
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($buffer)
}

function New-UrlSafeDatabasePassword([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return ([BitConverter]::ToString($buffer)).Replace('-', '').ToLowerInvariant()
}

function Read-Hidden([string]$prompt, [int]$minimumLength) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $script:passwordPointers += $pointer
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($plain.Length -lt $minimumLength) { throw "Password must contain at least $minimumLength characters" }
  return $plain
}

function Wait-Health([string]$url, [System.Diagnostics.Process]$process) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw "Gateway process stopped before becoming ready: $($process.Id)" }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw "Gateway did not become ready: $url"
}

function Stop-PreviousGateways {
  $processIds = @()
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
      $processIds += @($saved.readApi, $saved.writeApi) | Where-Object { $_ }
    } catch {}
  }

  $processIds += Get-NetTCPConnection -LocalPort 3012,3013 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess

  $processIds | Sort-Object -Unique | ForEach-Object {
    $process = Get-Process -Id ([int]$_) -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq 'node') {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      $process.WaitForExit()
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

try {
  Stop-PreviousGateways
  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) { throw "Read API environment file was not found: $ReadApiEnvPath" }
  $oracle = @{}
  foreach ($line in Get-Content -LiteralPath $ReadApiEnvPath) {
    if ($line -match '^([^#=]+)=(.*)$') { $oracle[$matches[1].Trim()] = $matches[2].Trim() }
  }
  if (-not $oracle['ORACLE_CONNECT_STRING'] -or -not $oracle['ORACLE_CLIENT_LIB_DIR']) {
    throw 'Oracle connection location settings are missing'
  }

  $readPassword = Read-Hidden 'Enter ALBINAA_RO password (input is hidden)' 1
  $writePassword = Read-Hidden 'Enter ALBINAAWRITER password (input is hidden)' 12
  $adminPassword = Read-Hidden 'Choose the isolated web admin password (input is hidden)' 12
  $readKey = New-RandomSecret
  $writeKey = New-RandomSecret
  $databasePassword = New-UrlSafeDatabasePassword
  if ((Test-Path -LiteralPath (Join-Path $root 'data-ias20191-test\postgres\PG_VERSION')) -and (Test-Path -LiteralPath $envFile)) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
      if ($line -match '^TEST_DB_PASSWORD=(.*)$' -and $matches[1]) { $databasePassword = $matches[1].Trim() }
    }
  }
  $encodedDatabasePassword = [Uri]::EscapeDataString($databasePassword)

  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $logs = Join-Path $runtime 'logs'
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $windowsIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $runtime /inheritance:r /grant:r "${windowsIdentity}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not protect the isolated runtime directory' }

  @(
    "TEST_DB_PASSWORD=$databasePassword",
    "TEST_DB_PASSWORD_URLENCODED=$encodedDatabasePassword",
    "JWT_ACCESS_SECRET=$(New-RandomSecret)",
    "JWT_REFRESH_SECRET=$(New-RandomSecret)",
    "ADMIN_INITIAL_PASSWORD=$adminPassword",
    "ORACLE_READ_API_KEY=$readKey",
    "ORACLE_WRITE_API_KEY=$writeKey"
  ) | Set-Content -LiteralPath $envFile -Encoding UTF8
  & icacls.exe $envFile /inheritance:r /grant:r "${windowsIdentity}:F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not protect the isolated environment file' }

  $node = (Get-Command node -ErrorAction Stop).Source
  $env:HOST = '127.0.0.1'; $env:PORT = '3013'; $env:ORACLE_USER = 'ALBINAA_RO'
  $env:ORACLE_PASSWORD = $readPassword; $env:ORACLE_CONNECT_STRING = $oracle['ORACLE_CONNECT_STRING']
  $env:ORACLE_CLIENT_LIB_DIR = $oracle['ORACLE_CLIENT_LIB_DIR']; $env:ORACLE_SCHEMA = 'IAS20191'
  $env:ORACLE_ALLOWED_SCHEMAS = 'IAS20191'; $env:ORACLE_READ_API_KEY = $readKey
  $readProcess = Start-Process -FilePath $node -ArgumentList 'src/server.js' -WorkingDirectory (Join-Path $root 'oracle-read-api') `
    -RedirectStandardOutput (Join-Path $logs 'read.out.log') -RedirectStandardError (Join-Path $logs 'read.err.log') -WindowStyle Hidden -PassThru

  'ORACLE_USER','ORACLE_PASSWORD','ORACLE_SCHEMA','ORACLE_ALLOWED_SCHEMAS','ORACLE_READ_API_KEY' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  $env:HOST = '127.0.0.1'; $env:PORT = '13012'; $env:ORACLE_USER = 'ALBINAAWRITER'
  $env:ORACLE_PASSWORD = $writePassword; $env:ORACLE_SCHEMA = 'IAS20191'; $env:ORACLE_REQUEST_BRANCH_YEAR = '2019'
  $env:ORACLE_REQUEST_DATE = '2020-12-31'; $env:ORACLE_WRITE_API_KEY = $writeKey
  $writeProcess = Start-Process -FilePath $node -ArgumentList 'src/server.js' -WorkingDirectory (Join-Path $root 'oracle-write-api') `
    -RedirectStandardOutput (Join-Path $logs 'write.out.log') -RedirectStandardError (Join-Path $logs 'write.err.log') -WindowStyle Hidden -PassThru

  Wait-Health 'http://127.0.0.1:3013/health' $readProcess
  Wait-Health 'http://127.0.0.1:13012/health' $writeProcess
  @{ readApi = $readProcess.Id; writeApi = $writeProcess.Id } | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

  & docker compose --env-file $envFile -f (Join-Path $root 'docker-compose.ias20191-test.yml') up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'The isolated web environment did not start' }
  $started = $true
  Write-Host 'SUCCESS: IAS20191 isolated web test is available at http://127.0.0.1:3004' -ForegroundColor Green
  Write-Host 'Oracle production IAS20261 and the current platform were not changed.' -ForegroundColor Green
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  'HOST','PORT','ORACLE_USER','ORACLE_PASSWORD','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA',
  'ORACLE_ALLOWED_SCHEMAS','ORACLE_READ_API_KEY','ORACLE_REQUEST_BRANCH_YEAR','ORACLE_REQUEST_DATE','ORACLE_WRITE_API_KEY' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  foreach ($pointer in $passwordPointers) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $readPassword = $null; $writePassword = $null; $adminPassword = $null
  if (-not $started) {
    if ($readProcess -and -not $readProcess.HasExited) { Stop-Process -Id $readProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($writeProcess -and -not $writeProcess.HasExited) { Stop-Process -Id $writeProcess.Id -Force -ErrorAction SilentlyContinue }
  }
}

Read-Host 'Press Enter to close this window'
