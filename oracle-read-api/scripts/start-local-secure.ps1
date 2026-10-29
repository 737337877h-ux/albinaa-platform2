$ErrorActionPreference = 'Stop'

$securePassword = Read-Host 'Enter ALBINAA_RO password (input is hidden)' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:ORACLE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:HOST = '127.0.0.1'
  $env:PORT = '3011'
  $env:ORACLE_USER = 'ALBINAA_RO'
  $env:ORACLE_CONNECT_STRING = '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=192.168.1.17)(PORT=1521))(CONNECT_DATA=(SERVER=DEDICATED)(SID=orcl)))'
  $env:ORACLE_CLIENT_LIB_DIR = 'E:\oracle\instantclient_19_32'
  $env:ORACLE_SCHEMA = 'IAS20261'
  $env:ORACLE_ALLOWED_SCHEMAS = 'IAS20261'
  $env:ORACLE_READ_API_KEY = 'local-live-check-only'
  Set-Location -LiteralPath $PSScriptRoot\..
  node src/server.js
} finally {
  $env:ORACLE_PASSWORD = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
