param(
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
)

$ErrorActionPreference = 'Stop'

try {
  if (-not (Test-Path -LiteralPath $ReadApiEnvPath)) {
    throw "Oracle Read API environment file was not found: $ReadApiEnvPath"
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

  $securePassword = Read-Host 'Enter the NEW ALBINAAWRITER password (input is hidden)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ($plainPassword.Length -lt 12) {
      throw 'A weak password is rejected. Change it to at least 12 characters first.'
    }

    $env:ORACLE_TEST_WRITER_PASSWORD = $plainPassword
    $env:ORACLE_CONNECT_STRING = $settings['ORACLE_CONNECT_STRING']
    $env:ORACLE_CLIENT_LIB_DIR = $settings['ORACLE_CLIENT_LIB_DIR']

    & node (Join-Path $PSScriptRoot 'create-test-request.js')
    if ($LASTEXITCODE -ne 0) { throw 'The Oracle test request was not created' }
  }
  finally {
    Remove-Item Env:ORACLE_TEST_WRITER_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:ORACLE_CONNECT_STRING -ErrorAction SilentlyContinue
    Remove-Item Env:ORACLE_CLIENT_LIB_DIR -ErrorAction SilentlyContinue
    if ($passwordPointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $plainPassword = $null
  }
}
catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Read-Host 'Press Enter to close this window'
