param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [string]$OracleAlias = 'YEMENSOFT',
  [string]$OracleUser = 'ALBINAA_RO',
  [string]$OracleHome = 'C:\OraNT',
  [switch]$JsonResult
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($OracleUser -cne 'ALBINAA_RO') { throw 'Movement snapshots require ALBINAA_RO.' }
if ([IntPtr]::Size -ne 4) { throw 'This script must run under 32-bit PowerShell.' }
$password = [Environment]::GetEnvironmentVariable('ALBINAA_ORACLE_PASSWORD', 'Process')
if ([string]::IsNullOrWhiteSpace($password)) { throw 'ALBINAA_ORACLE_PASSWORD is required and is never written to output.' }

$env:ORACLE_HOME = $OracleHome
$env:PATH = (Join-Path $OracleHome 'Bin') + ';' + $env:PATH
Import-Module (Join-Path $PSScriptRoot 'ReadOnlyGuard.psm1') -Force
. (Join-Path $PSScriptRoot 'Get-OracleMovementQueries.ps1')
Add-Type -Path (Join-Path $PSScriptRoot 'CompatibleCsvWriter.cs')

$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$snapshotDir = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) ("snapshot-$stamp")
New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null

function ConvertTo-CsvField {
  param($Value)
  if ($null -eq $Value -or $Value -is [DBNull]) { return '""' }
  $text = [Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture)
  return '"' + $text.Replace('"', '""') + '"'
}

function Get-SnapshotSha256([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $hash.Dispose() }
}

function Export-OracleMovementSelect {
  param($Connection, $Query, [string]$Destination)
  Assert-OracleMovementReadOnlySql -Sql $Query.Sql | Out-Null
  $command = New-Object -ComObject ADODB.Command
  $command.ActiveConnection = $Connection
  $command.CommandTimeout = 120
  $command.CommandText = $Query.Sql
  $script:readStage = "execute:$($Query.Name)"
  $recordset = $command.Execute()
  $writer = New-Object IO.StreamWriter($Destination, $false, (New-Object Text.UTF8Encoding($false)))
  $count = 0
  try {
    $headers = for ($index = 0; $index -lt $recordset.Fields.Count; $index++) { ConvertTo-CsvField $recordset.Fields.Item($index).Name }
    $writer.WriteLine(($headers -join ','))
    while (-not $recordset.EOF) {
      $script:readStage = "fetch:$($Query.Name):rows=$count"
      $batch = $recordset.GetRows(2048)
      $script:readStage = "serialize:$($Query.Name):rows=$count"
      $count += [AlbinaaCompatibleMovementCsv]::WriteRows($batch, $writer)
    }
  }
  finally {
    $writer.Dispose()
    try { $recordset.Close() } catch { }
  }
  return $count
}

$connection = New-Object -ComObject ADODB.Connection
$connection.ConnectionTimeout = 30
$connection.CommandTimeout = 120
$transactionOpen = $false
$script:readStage = 'connect'
try {
  $connection.Open("Provider=MSDAORA;Data Source=$OracleAlias;User ID=$OracleUser;Password=$password;")
  # ADODB otherwise auto-commits every SELECT. Keep all extracts on one
  # Oracle read-only snapshot so detail rows and control totals cannot drift.
  $script:readStage = 'begin-read-only'
  $null = $connection.BeginTrans()
  $transactionOpen = $true
  $transaction = New-Object -ComObject ADODB.Command
  $transaction.ActiveConnection = $connection
  $transaction.CommandText = 'SET TRANSACTION READ ONLY'
  $null = $transaction.Execute()
  $identityCommand = New-Object -ComObject ADODB.Command
  $identityCommand.ActiveConnection = $connection
  $identityCommand.CommandTimeout = 30
  $identityCommand.CommandText = "SELECT SYS_CONTEXT('USERENV','SESSION_USER') FROM DUAL"
  $script:readStage = 'verify-identity'
  $identity = $identityCommand.Execute()
  try {
    if ([string]$identity.Fields.Item(0).Value -cne 'ALBINAA_RO') { throw 'Unexpected Oracle snapshot session.' }
  } finally { $identity.Close() }
  $entries = New-Object Collections.Generic.List[object]
  foreach ($query in Get-OracleMovementQueries) {
    $filePath = Join-Path $snapshotDir $query.FileName
    $rows = Export-OracleMovementSelect -Connection $connection -Query $query -Destination $filePath
    $entries.Add([pscustomobject]@{ name=$query.Name; file=$query.FileName; rows=$rows; sha256=(Get-SnapshotSha256 $filePath) })
  }
  $script:readStage = 'manifest'
  $manifest = [ordered]@{
    contractVersion='1.0'; mode='oracle-movements-read-only-snapshot'; generatedAtUtc=[DateTime]::UtcNow.ToString('o')
    source=[ordered]@{ alias='YEMENSOFT'; schema='IAS20261'; transactionMode='READ ONLY'; user='ALBINAA_RO'; numberFormat='MSDAORA-InvariantCulture' }
    files=$entries
  }
  [IO.File]::WriteAllText((Join-Path $snapshotDir 'manifest.json'),($manifest | ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
  if ($JsonResult) {
    $counts = [ordered]@{}
    foreach ($entry in $entries) { $counts[$entry.name] = $entry.rows }
    [ordered]@{directory=$snapshotDir;counts=$counts} | ConvertTo-Json -Depth 4 -Compress
  } else { Write-Output $snapshotDir }
} catch {
  $original = $_.Exception
  $details = @("stage=$script:readStage", "type=$($original.GetType().FullName)", $original.Message)
  $inner = $original.InnerException
  while ($null -ne $inner) {
    $details += "inner=$($inner.GetType().FullName): $($inner.Message)"
    $inner = $inner.InnerException
  }
  try {
    foreach ($adoError in $connection.Errors) {
      $details += "ADO native=$($adoError.NativeError) state=$($adoError.SQLState): $($adoError.Description)"
    }
  } catch { }
  $safeMessage = ($details -join ' | ').Replace($password, '[REDACTED]')
  throw $safeMessage
} finally {
  if ($transactionOpen -and $connection.State -eq 1) {
    try { $null = $connection.RollbackTrans() } catch { }
    $transactionOpen = $false
  }
  if ($connection.State -eq 1) { try { $connection.Close() } catch { } }
  Remove-Item Env:ALBINAA_ORACLE_PASSWORD -ErrorAction SilentlyContinue
  $password = $null
}
