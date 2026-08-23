$ErrorActionPreference = 'Stop'
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'ReadOnlyGuard.psm1') -Force

$accepted = @(
  'SELECT COUNT(*) FROM IAS20261.IAS_ITM_MST',
  "SELECT I_CODE,I_NAME`nFROM IAS20261.IAS_ITM_MST`nWHERE ROWNUM=1"
)
$rejected = @(
  'UPDATE IAS20261.IAS_ITM_MST SET I_NAME=''x''',
  'DELETE FROM IAS20261.IAS_ITM_MST',
  'SELECT * FROM IAS20261.IAS_ITM_MST FOR UPDATE',
  'SELECT * FROM IAS20261.IAS_ITM_MST; DELETE FROM IAS20261.IAS_ITM_MST',
  'SELECT * FROM IAS_ITM_MST',
  'BEGIN NULL; END'
)

foreach ($sql in $accepted) {
  if (-not (Assert-OracleInventoryReadOnlySql -Sql $sql)) { throw "Expected accepted SQL: $sql" }
}
foreach ($sql in $rejected) {
  $rejectedAsExpected = $false
  try { Assert-OracleInventoryReadOnlySql -Sql $sql | Out-Null }
  catch { $rejectedAsExpected = $true }
  if (-not $rejectedAsExpected) { throw "Expected rejected SQL: $sql" }
}
Write-Output "Read-only guard tests passed: $($accepted.Count) accepted, $($rejected.Count) rejected."
