$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReadOnlyGuard.psm1') -Force
. (Join-Path $PSScriptRoot 'Get-OracleMovementQueries.ps1')
$queries = @(Get-OracleMovementQueries)
if ($queries.Count -ne 3) { throw 'Expected exactly three movement queries.' }
foreach ($query in $queries) { Assert-OracleMovementReadOnlySql -Sql $query.Sql | Out-Null }
Write-Output "Oracle movement query catalog passed: $($queries.Count) guarded SELECT queries."
