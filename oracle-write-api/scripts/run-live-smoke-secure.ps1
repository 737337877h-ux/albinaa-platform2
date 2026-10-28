param(
  [string]$ReadApiEnvPath = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
)

$ErrorActionPreference = 'Stop'
$passwordPointer = [IntPtr]::Zero

try {
  $settings = @{}
  foreach ($line in Get-Content -LiteralPath $ReadApiEnvPath) {
    if ($line -match '^([^#=]+)=(.*)$') {
      $settings[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  if (-not $settings['ORACLE_CONNECT_STRING'] -or -not $settings['ORACLE_CLIENT_LIB_DIR']) {
    throw 'Oracle connection location settings are missing'
  }

  $securePassword = Read-Host 'Enter ALBINAAWRITER password (input is hidden)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ($plainPassword.Length -lt 12) { throw 'A password shorter than 12 characters is rejected' }

  $randomBytes = New-Object byte[] 32
  $randomGenerator = New-Object Security.Cryptography.RNGCryptoServiceProvider
  try { $randomGenerator.GetBytes($randomBytes) } finally { $randomGenerator.Dispose() }

  $env:ORACLE_USER = 'ALBINAAWRITER'
  $env:ORACLE_PASSWORD = $plainPassword
  $env:ORACLE_CONNECT_STRING = $settings['ORACLE_CONNECT_STRING']
  $env:ORACLE_CLIENT_LIB_DIR = $settings['ORACLE_CLIENT_LIB_DIR']
  $env:ORACLE_SCHEMA = 'IAS20191'
  $env:ORACLE_REQUEST_BRANCH_YEAR = '2019'
  $env:ORACLE_REQUEST_DATE = '2020-12-31'
  $env:ORACLE_WRITE_API_KEY = [Convert]::ToBase64String($randomBytes)

  & node (Join-Path $PSScriptRoot 'live-smoke.js')
  if ($LASTEXITCODE -ne 0) { throw 'Oracle Write API smoke test failed' }
}
catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  'ORACLE_USER','ORACLE_PASSWORD','ORACLE_CONNECT_STRING','ORACLE_CLIENT_LIB_DIR','ORACLE_SCHEMA',
  'ORACLE_REQUEST_BRANCH_YEAR','ORACLE_REQUEST_DATE','ORACLE_WRITE_API_KEY' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $plainPassword = $null
}

Read-Host 'Press Enter to close this window'
