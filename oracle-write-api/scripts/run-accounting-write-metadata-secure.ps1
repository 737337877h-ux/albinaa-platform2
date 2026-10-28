param(
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
)

$ErrorActionPreference = 'Stop'
$passwordPointer = [IntPtr]::Zero
try {
  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) {
    throw "Oracle connection settings were not found: $ReadApiEnvPath"
  }
  $settings = @{}
  foreach ($line in Get-Content -LiteralPath $ReadApiEnvPath) {
    if ($line -match '^([^#=]+)=(.*)$') {
      $settings[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  if (-not $settings['ORACLE_CONNECT_STRING'] -or -not $settings['ORACLE_CLIENT_LIB_DIR']) {
    throw 'Oracle connection location settings are missing'
  }

  $secure = Read-Host 'Enter ALBINAA_RO password (input is hidden)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:ORACLE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:ORACLE_USER = 'ALBINAA_RO'
  $env:ORACLE_CONNECT_STRING = $settings['ORACLE_CONNECT_STRING']
  $env:ORACLE_CLIENT_LIB_DIR = $settings['ORACLE_CLIENT_LIB_DIR']
  $env:ORACLE_SCHEMA = 'IAS20191'

  & node (Join-Path $PSScriptRoot 'accounting-write-metadata-live.js')
  if ($LASTEXITCODE -ne 0) { throw 'The IAS20191 accounting metadata inspection failed' }
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  'ORACLE_USER','ORACLE_PASSWORD','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}

Read-Host 'Press Enter to close this window'
