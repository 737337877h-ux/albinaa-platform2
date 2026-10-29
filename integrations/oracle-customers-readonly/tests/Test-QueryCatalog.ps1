$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $root 'ReadOnlyGuard.psm1') -Force
. (Join-Path $root 'Get-OracleCustomerQueries.ps1')
$queries = @(Get-OracleCustomerQueries)
if ($queries.Count -ne 5) { throw "Expected 5 fixed snapshot queries; found $($queries.Count)." }
foreach ($query in $queries) {
  Assert-OracleCustomerReadOnlySql -Sql $query.Sql | Out-Null
  if ($query.FileName -notmatch '^[a-z][a-z0-9_]*\.csv$') { throw "Unsafe output file name: $($query.FileName)" }
}
Write-Output "Oracle customer query catalog passed: $($queries.Count) guarded SELECT queries."
