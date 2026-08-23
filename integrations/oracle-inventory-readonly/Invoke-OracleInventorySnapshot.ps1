param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [string]$OracleAlias = 'YEMENSOFT',
  [string]$OracleUser = 'ys',
  [string]$OracleHome = 'C:\OraNT'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([IntPtr]::Size -ne 4) {
  throw 'This script must run under 32-bit PowerShell. Use Run-OracleInventorySnapshot.ps1.'
}

$password = [Environment]::GetEnvironmentVariable('ALBINAA_ORACLE_PASSWORD', 'Process')
if ([string]::IsNullOrWhiteSpace($password)) {
  throw 'ALBINAA_ORACLE_PASSWORD is required in the current process and is never written to output.'
}

$env:ORACLE_HOME = $OracleHome
$env:PATH = (Join-Path $OracleHome 'Bin') + ';' + $env:PATH
Import-Module (Join-Path $PSScriptRoot 'ReadOnlyGuard.psm1') -Force
. (Join-Path $PSScriptRoot 'Get-OracleInventoryQueries.ps1')

$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$snapshotDir = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) ("snapshot-$stamp")
New-Item -ItemType Directory -Path $snapshotDir | Out-Null

function Export-OracleInventorySelect {
  param(
    [Parameter(Mandatory = $true)]$Connection,
    [Parameter(Mandatory = $true)]$Query,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  Assert-OracleInventoryReadOnlySql -Sql $Query.Sql | Out-Null
  $command = New-Object -ComObject ADODB.Command
  $command.ActiveConnection = $Connection
  $command.CommandTimeout = 600
  $command.CommandText = $Query.Sql
  $recordset = $command.Execute()
  $rows = New-Object System.Collections.Generic.List[object]
  try {
    while (-not $recordset.EOF) {
      $record = [ordered]@{}
      for ($index = 0; $index -lt $recordset.Fields.Count; $index++) {
        $record[$recordset.Fields.Item($index).Name] = $recordset.Fields.Item($index).Value
      }
      $rows.Add([pscustomobject]$record)
      $recordset.MoveNext()
    }
  }
  finally {
    $recordset.Close()
  }
  $rows | Export-Csv -LiteralPath $Destination -NoTypeInformation -Encoding UTF8
  return $rows.Count
}

$connection = New-Object -ComObject ADODB.Connection
$connection.ConnectionTimeout = 30
$connection.CommandTimeout = 600
$connection.Open("Provider=MSDAORA;Data Source=$OracleAlias;User ID=$OracleUser;Password=$password;")

try {
  $transaction = New-Object -ComObject ADODB.Command
  $transaction.ActiveConnection = $connection
  $transaction.CommandTimeout = 30
  $transaction.CommandText = 'SET TRANSACTION READ ONLY'
  $null = $transaction.Execute()

  $entries = New-Object System.Collections.Generic.List[object]
  foreach ($query in Get-OracleInventoryQueries) {
    $filePath = Join-Path $snapshotDir $query.FileName
    $rowCount = Export-OracleInventorySelect -Connection $connection -Query $query -Destination $filePath
    $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $entries.Add([pscustomobject]@{
      name = $query.Name
      file = $query.FileName
      rows = $rowCount
      sha256 = $hash
    })
  }

  $manifest = [ordered]@{
    contractVersion = '2.0'
    mode = 'oracle-inventory-read-only-snapshot'
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    source = [ordered]@{
      alias = $OracleAlias
      schema = 'IAS20261'
      transactionMode = 'READ ONLY'
    }
    files = $entries
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText(
    (Join-Path $snapshotDir 'manifest.json'),
    ($manifest | ConvertTo-Json -Depth 6),
    $utf8NoBom
  )
  Write-Output $snapshotDir
}
finally {
  if ($connection.State -eq 1) { $connection.Close() }
  Remove-Item Env:ALBINAA_ORACLE_PASSWORD -ErrorAction SilentlyContinue
  $password = $null
}
