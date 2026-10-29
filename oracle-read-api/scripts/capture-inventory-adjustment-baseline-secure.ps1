param(
  [string]$ReadApiEnvPath = ''
)

$ErrorActionPreference = 'Stop'
$passwordPointer = [IntPtr]::Zero
try {
  if (-not $ReadApiEnvPath) {
    $localEnv = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
    $stableEnv = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
    if (Test-Path -LiteralPath $localEnv) { $ReadApiEnvPath = $localEnv }
    elseif (Test-Path -LiteralPath $stableEnv) { $ReadApiEnvPath = $stableEnv }
    else { throw 'Oracle Read API environment file was not found in the integration or stable project.' }
  }
  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) { throw "Read API environment file was not found: $ReadApiEnvPath" }

  $baselineDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'tmp'
  $baselinePath = Join-Path $baselineDirectory 'invt008-230-baseline.json'
  if (Test-Path -LiteralPath $baselinePath) {
    throw "The baseline already exists and was not replaced: $baselinePath"
  }

  $oracle = @{}
  foreach ($line in Get-Content -LiteralPath $ReadApiEnvPath) {
    if ($line -match '^([^#=]+)=(.*)$') { $oracle[$matches[1].Trim()] = $matches[2].Trim() }
  }

  $secure = Read-Host 'Enter ALBINAA_RO password (input is hidden)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:ORACLE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:ORACLE_USER = 'ALBINAA_RO'
  $env:ORACLE_CONNECT_STRING = $oracle['ORACLE_CONNECT_STRING']
  $env:ORACLE_CLIENT_LIB_DIR = $oracle['ORACLE_CLIENT_LIB_DIR']
  $env:ORACLE_SCHEMA = 'IAS20191'
  $env:ORACLE_ALLOWED_SCHEMAS = 'IAS20191,IAS20261'
  $env:ORACLE_READ_API_KEY = 'local-select-only-inventory-adjustment-baseline'
  $env:ORACLE_QUERY_TIMEOUT_MS = '60000'

  $output = & node (Join-Path $PSScriptRoot 'capture-inventory-adjustment-baseline.js') 2>&1
  $nodeExitCode = $LASTEXITCODE
  $output | ForEach-Object { Write-Host $_ }
  if ($nodeExitCode -ne 0) { throw 'The SELECT-only INVT008.230 baseline capture failed' }

  $parsed = $output -join [Environment]::NewLine | ConvertFrom-Json
  if (-not $parsed.success) { throw 'The baseline response was not successful' }
  New-Item -ItemType Directory -Path $baselineDirectory -Force | Out-Null
  $output | Set-Content -LiteralPath $baselinePath -Encoding UTF8
  Write-Host "SUCCESS: The SELECT-only baseline was saved locally: $baselinePath" -ForegroundColor Green
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  'ORACLE_PASSWORD','ORACLE_USER','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA','ORACLE_ALLOWED_SCHEMAS','ORACLE_READ_API_KEY','ORACLE_QUERY_TIMEOUT_MS' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
}

Read-Host 'Press Enter to close this window'
