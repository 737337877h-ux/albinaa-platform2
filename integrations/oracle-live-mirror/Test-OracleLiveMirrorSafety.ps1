$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$oracleFiles = @(
  Join-Path $root 'oracle-customers-readonly\Get-OracleCustomerQueries.ps1'
  Join-Path $root 'oracle-inventory-readonly\Get-OracleInventoryQueries.ps1'
  Join-Path $root 'oracle-movements-readonly\Get-OracleMovementQueries.ps1'
)
$forbidden = '(?im)\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMIT|ROLLBACK|EXECUTE|BEGIN)\b'
foreach ($file in $oracleFiles) {
  $content = Get-Content -LiteralPath $file -Raw -Encoding UTF8
  if ($content -match $forbidden) { throw "Forbidden Oracle SQL verb found in ${file}: $($Matches[1])" }
}

$extractors = @(
  Join-Path $root 'oracle-customers-readonly\Invoke-OracleCustomerSnapshot.ps1'
  Join-Path $root 'oracle-inventory-readonly\Invoke-OracleInventorySnapshot.ps1'
  Join-Path $root 'oracle-movements-readonly\Invoke-OracleMovementSnapshot.ps1'
)
foreach ($extractor in $extractors) {
  $content = Get-Content -LiteralPath $extractor -Raw -Encoding UTF8
  if ($content -notmatch [regex]::Escape('SET TRANSACTION READ ONLY')) {
    throw "Oracle extractor does not start a read-only transaction: $extractor"
  }
}

$runner = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Invoke-OracleLiveMirror.ps1') -Raw -Encoding UTF8
foreach ($required in @('ALBINAA_ORACLE_PASSWORD','ConvertTo-SecureString','WaitOne(0)','snapshot_unchanged')) {
  if ($runner -notmatch [regex]::Escape($required)) { throw "Live runner is missing safety control: $required" }
}

Write-Output 'Oracle live mirror safety checks passed.'
