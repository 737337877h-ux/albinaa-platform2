Set-StrictMode -Version Latest

function Assert-OracleInventoryReadOnlySql {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Sql)

  $normalized = $Sql.Trim()
  if ($normalized -notmatch '^(?is)SELECT\s+') {
    throw 'Read-only guard: query must start with SELECT.'
  }
  if ($normalized -match ';') {
    throw 'Read-only guard: semicolons are not allowed.'
  }
  $blocked = '(?i)\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|BEGIN|DECLARE|EXECUTE|COMMIT|ROLLBACK|LOCK|CALL)\b'
  if ($normalized -match $blocked) {
    throw "Read-only guard: blocked SQL token $($Matches[1])."
  }
  if ($normalized -match '(?i)\bFOR\s+UPDATE\b') {
    throw 'Read-only guard: SELECT FOR UPDATE is not allowed.'
  }
  if ($normalized -notmatch '(?i)\bIAS20261\.') {
    throw 'Read-only guard: every query must reference IAS20261 explicitly.'
  }
  return $true
}

Export-ModuleMember -Function Assert-OracleInventoryReadOnlySql
