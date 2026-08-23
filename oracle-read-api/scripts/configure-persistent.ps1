$ErrorActionPreference = 'Stop'

$gatewayRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $gatewayRoot
$gatewayEnv = Join-Path $gatewayRoot '.env'
$projectEnv = Join-Path $projectRoot '.env'
$errorLog = Join-Path $gatewayRoot 'setup-error.log'
if (Test-Path -LiteralPath $errorLog) { Remove-Item -LiteralPath $errorLog -Force }

function Upsert-EnvValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = [Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $Path) {
    foreach ($line in Get-Content -LiteralPath $Path) { $lines.Add($line) }
  }
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match ('^\s*' + [regex]::Escape($Name) + '\s*=')) {
      $lines[$index] = "$Name=$Value"
      $found = $true
    }
  }
  if (-not $found) { $lines.Add("$Name=$Value") }
  [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}

$securePassword = Read-Host 'Enter ALBINAA_RO password (input is hidden)' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ([string]::IsNullOrWhiteSpace($plainPassword)) { throw 'Password cannot be empty' }
  $passwordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plainPassword))
  $keyBytes = [byte[]]::new(32)
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($keyBytes) } finally { $random.Dispose() }
  $apiKey = ([BitConverter]::ToString($keyBytes) -replace '-', '').ToLowerInvariant()

  $gatewayLines = @(
    'HOST=127.0.0.1'
    'PORT=3011'
    'ORACLE_USER=ALBINAA_RO'
    "ORACLE_PASSWORD_BASE64=$passwordBase64"
    'ORACLE_CONNECT_STRING=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=192.168.1.17)(PORT=1521))(CONNECT_DATA=(SERVER=DEDICATED)(SID=orcl)))'
    'ORACLE_CLIENT_LIB_DIR=E:\oracle\instantclient_19_32'
    'ORACLE_SCHEMA=IAS20261'
    'ORACLE_ALLOWED_SCHEMAS=IAS20261'
    "ORACLE_READ_API_KEY=$apiKey"
    'ORACLE_POOL_MIN=1'
    'ORACLE_POOL_MAX=4'
    'ORACLE_POOL_INCREMENT=1'
    'ORACLE_QUEUE_TIMEOUT_MS=5000'
    'ORACLE_QUERY_TIMEOUT_MS=10000'
  )
  [IO.File]::WriteAllLines($gatewayEnv, $gatewayLines, [Text.UTF8Encoding]::new($false))
  & icacls.exe $gatewayEnv /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(F)" | Out-Null

  Upsert-EnvValue $projectEnv 'ORACLE_READ_API_KEY' $apiKey
  Upsert-EnvValue $projectEnv 'ORACLE_READ_SCHEMA' 'IAS20261'
  Write-Host 'SUCCESS: Persistent Oracle Read API configuration was created.' -ForegroundColor Green
  Read-Host 'Press Enter to close this window'
} catch {
  [IO.File]::WriteAllText($errorLog, $_.Exception.Message, [Text.UTF8Encoding]::new($false))
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  Read-Host 'Press Enter to close this window'
  throw
} finally {
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  $plainPassword = $null
}
