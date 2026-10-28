param([string]$ReadApiEnvPath = '')

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
  $baselinePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'tmp\arst003-baseline.json'
  if (-not (Test-Path -LiteralPath $baselinePath)) { throw "The saved ARST003 baseline was not found: $baselinePath" }

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
  $env:ORACLE_ALLOWED_SCHEMAS = 'IAS20191'
  $env:ORACLE_READ_API_KEY = 'local-select-only-arst003-comparison'
  $env:ORACLE_QUERY_TIMEOUT_MS = '60000'
  $env:ARST003_BASELINE_PATH = $baselinePath

  & node (Join-Path $PSScriptRoot 'compare-arst003-after-sample.js')
  if ($LASTEXITCODE -ne 0) { throw 'The SELECT-only ARST003 comparison failed' }
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  'ORACLE_PASSWORD','ORACLE_USER','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA','ORACLE_ALLOWED_SCHEMAS','ORACLE_READ_API_KEY','ORACLE_QUERY_TIMEOUT_MS','ARST003_BASELINE_PATH' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
}

Read-Host 'Press Enter to close this window'
