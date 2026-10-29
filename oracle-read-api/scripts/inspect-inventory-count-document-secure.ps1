param(
  [int]$DocumentNo = 3,
  [int]$UserId = 1,
  [string]$ReadApiEnvPath = ''
)

$ErrorActionPreference = 'Stop'
$passwordPointer = [IntPtr]::Zero
try {
  if ($DocumentNo -le 0) { throw 'The INVT008.230 document number must be positive.' }
  if ($UserId -le 0) { throw 'The YemenSoft user id must be positive.' }
  if (-not $ReadApiEnvPath) {
    $localEnv = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
    $stableEnv = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
    if (Test-Path -LiteralPath $localEnv) { $ReadApiEnvPath = $localEnv }
    elseif (Test-Path -LiteralPath $stableEnv) { $ReadApiEnvPath = $stableEnv }
    else { throw 'Oracle Read API environment file was not found in the integration or stable project.' }
  }
  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) { throw "Read API environment file was not found: $ReadApiEnvPath" }

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
  $env:ORACLE_READ_API_KEY = 'local-select-only-inventory-count-document'
  $env:ORACLE_QUERY_TIMEOUT_MS = '60000'
  $env:INVT008_DOCUMENT_NO = $DocumentNo.ToString()
  $env:INVT008_USER_ID = $UserId.ToString()

  & node (Join-Path $PSScriptRoot 'inspect-inventory-count-document.js')
  if ($LASTEXITCODE -ne 0) { throw 'The SELECT-only INVT008.230 document diagnostic failed' }
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  'ORACLE_PASSWORD','ORACLE_USER','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA','ORACLE_ALLOWED_SCHEMAS','ORACLE_READ_API_KEY','ORACLE_QUERY_TIMEOUT_MS','INVT008_DOCUMENT_NO','INVT008_USER_ID' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
}

Read-Host 'Press Enter to close this window'
