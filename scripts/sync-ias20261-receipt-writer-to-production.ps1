param(
  [string]$SourceEnvironment = 'E:\albinaa-platform-staging\albinaa-platform2-transfer-integration\.env.ias20191-test',
  [string]$ProductionEnvironment = 'E:\albinaa-platform-staging\albinaa-platform2\.env'
)

$ErrorActionPreference = 'Stop'

function Read-EnvironmentFile([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([^#][^=]*)=(.*)$') {
      $values[$matches[1].Trim()] = $matches[2]
    }
  }
  return $values
}

function Set-EnvironmentValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in Get-Content -LiteralPath $Path) { $lines.Add($line) }

  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match ('^\s*' + [regex]::Escape($Name) + '=')) {
      $lines[$index] = "$Name=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) { $lines.Add("$Name=$Value") }

  [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $SourceEnvironment)) {
  throw "Source environment file was not found: $SourceEnvironment"
}
if (-not (Test-Path -LiteralPath $ProductionEnvironment)) {
  throw "Production environment file was not found: $ProductionEnvironment"
}

$source = Read-EnvironmentFile $SourceEnvironment
$apiKey = $source['ORACLE_IAS20261_RECEIPT_WRITE_API_KEY']
if (-not $apiKey -or $apiKey -eq 'disabled') {
  throw 'The active IAS20261 receipt writer key is missing from the source environment.'
}
if ($source['ORACLE_IAS20261_RECEIPT_WRITE_ENABLED'] -ne 'true') {
  throw 'The IAS20261 receipt writer is not enabled in the source environment.'
}

Set-EnvironmentValue $ProductionEnvironment 'ORACLE_IAS20261_RECEIPT_WRITE_ENABLED' 'true'
Set-EnvironmentValue $ProductionEnvironment 'ORACLE_IAS20261_RECEIPT_WRITE_API_KEY' $apiKey

Write-Host 'SUCCESS: IAS20261 receipt writer settings were synchronized to the 3003 production environment.' -ForegroundColor Green
