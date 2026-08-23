$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $root 'ReadOnlyGuard.psm1') -Force
. (Join-Path $root 'Get-OracleInventoryQueries.ps1')

$queries = @(Get-OracleInventoryQueries)
if ($queries.Count -ne 7) { throw "Expected 7 fixed snapshot queries; found $($queries.Count)." }
foreach ($query in $queries) {
  Assert-OracleInventoryReadOnlySql -Sql $query.Sql | Out-Null
  if ($query.FileName -notmatch '^[a-z][a-z0-9_]*\.csv$') {
    throw "Unsafe output file name: $($query.FileName)"
  }
}
Write-Output "Oracle inventory query catalog passed: $($queries.Count) guarded SELECT queries."
