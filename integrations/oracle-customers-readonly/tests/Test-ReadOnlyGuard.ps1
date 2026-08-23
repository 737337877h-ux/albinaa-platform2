$ErrorActionPreference = 'Stop'
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'ReadOnlyGuard.psm1') -Force
$accepted = @('SELECT COUNT(*) FROM IAS20261.CUSTOMER', 'SELECT C_CODE FROM IAS20261.CUSTOMER WHERE ROWNUM=1')
$rejected = @(
  "UPDATE IAS20261.CUSTOMER SET C_A_NAME='x'",
  'DELETE FROM IAS20261.CUSTOMER',
  'SELECT * FROM IAS20261.CUSTOMER FOR UPDATE',
  'SELECT * FROM IAS20261.CUSTOMER; DELETE FROM IAS20261.CUSTOMER',
  'SELECT * FROM CUSTOMER'
)
foreach ($sql in $accepted) { if (-not (Assert-OracleCustomerReadOnlySql -Sql $sql)) { throw "Expected accepted SQL: $sql" } }
foreach ($sql in $rejected) {
  $blocked = $false
  try { Assert-OracleCustomerReadOnlySql -Sql $sql | Out-Null } catch { $blocked = $true }
  if (-not $blocked) { throw "Expected rejected SQL: $sql" }
}
Write-Output 'Oracle customer read-only guard passed.'
