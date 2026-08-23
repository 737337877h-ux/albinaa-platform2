param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [string]$OracleAlias = 'YEMENSOFT',
  [string]$OracleUser = 'ys',
  [string]$OracleHome = 'C:\OraNT'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([IntPtr]::Size -ne 4) { throw 'This script must run under 32-bit PowerShell.' }
$password = [Environment]::GetEnvironmentVariable('ALBINAA_ORACLE_PASSWORD', 'Process')
if ([string]::IsNullOrWhiteSpace($password)) { throw 'ALBINAA_ORACLE_PASSWORD is required and is never written to output.' }

$env:ORACLE_HOME = $OracleHome
$env:PATH = (Join-Path $OracleHome 'Bin') + ';' + $env:PATH
Import-Module (Join-Path $PSScriptRoot 'ReadOnlyGuard.psm1') -Force
. (Join-Path $PSScriptRoot 'Get-OracleMovementQueries.ps1')

$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$snapshotDir = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) ("snapshot-$stamp")
New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null

function ConvertTo-CsvField {
  param($Value)
  if ($null -eq $Value -or $Value -is [DBNull]) { return '""' }
  $text = [Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture)
  return '"' + $text.Replace('"', '""') + '"'
}

function Export-OracleMovementSelect {
  param($Connection, $Query, [string]$Destination)
  Assert-OracleMovementReadOnlySql -Sql $Query.Sql | Out-Null
  $command = New-Object -ComObject ADODB.Command
  $command.ActiveConnection = $Connection
  $command.CommandTimeout = 1200
  $command.CommandText = $Query.Sql
  $recordset = $command.Execute()
  $writer = New-Object IO.StreamWriter($Destination, $false, (New-Object Text.UTF8Encoding($false)))
  $count = 0
  try {
    $headers = for ($index = 0; $index -lt $recordset.Fields.Count; $index++) { ConvertTo-CsvField $recordset.Fields.Item($index).Name }
    $writer.WriteLine(($headers -join ','))
    while (-not $recordset.EOF) {
      $fields = for ($index = 0; $index -lt $recordset.Fields.Count; $index++) { ConvertTo-CsvField $recordset.Fields.Item($index).Value }
      $writer.WriteLine(($fields -join ','))
      $count += 1
      $recordset.MoveNext()
    }
  }
  finally {
    $writer.Dispose()
    $recordset.Close()
  }
  return $count
}

$connection = New-Object -ComObject ADODB.Connection
$connection.ConnectionTimeout = 30
$connection.CommandTimeout = 1200
$connection.Open("Provider=MSDAORA;Data Source=$OracleAlias;User ID=$OracleUser;Password=$password;")
$transactionOpen = $false
try {
  # ADODB otherwise auto-commits every SELECT. Keep all extracts on one
  # Oracle read-only snapshot so detail rows and control totals cannot drift.
  $null = $connection.BeginTrans()
  $transactionOpen = $true
  $transaction = New-Object -ComObject ADODB.Command
  $transaction.ActiveConnection = $connection
  $transaction.CommandText = 'SET TRANSACTION READ ONLY'
  $null = $transaction.Execute()
  $entries = New-Object Collections.Generic.List[object]
  foreach ($query in Get-OracleMovementQueries) {
    $filePath = Join-Path $snapshotDir $query.FileName
    $rows = Export-OracleMovementSelect -Connection $connection -Query $query -Destination $filePath
    $entries.Add([pscustomobject]@{ name=$query.Name; file=$query.FileName; rows=$rows; sha256=(Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() })
  }
  $manifest = [ordered]@{
    contractVersion='1.0'; mode='oracle-movements-read-only-snapshot'; generatedAtUtc=[DateTime]::UtcNow.ToString('o')
    source=[ordered]@{ alias=$OracleAlias; schema='IAS20261'; transactionMode='READ ONLY' }
    files=$entries
  }
  [IO.File]::WriteAllText((Join-Path $snapshotDir 'manifest.json'),($manifest | ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
  Write-Output $snapshotDir
}
finally {
  if ($transactionOpen -and $connection.State -eq 1) {
    $null = $connection.RollbackTrans()
    $transactionOpen = $false
  }
  if ($connection.State -eq 1) { $connection.Close() }
  Remove-Item Env:ALBINAA_ORACLE_PASSWORD -ErrorAction SilentlyContinue
  $password = $null
}
