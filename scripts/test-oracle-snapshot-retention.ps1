$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path $PSScriptRoot 'invoke-oracle-safe-mirror.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Mirror script parse errors' }
$function = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Remove-OldSnapshots'}, $true)
Invoke-Expression $function.Extent.Text
$SnapshotsToKeep = 2
function Event([string]$name,[object]$data) { $script:record = @{name=$name;data=$data} }
$root = Join-Path ([IO.Path]::GetTempPath()) ('albinaa-retention-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -Path $root -ItemType Directory | Out-Null
try {
  for ($i=0; $i -lt 5; $i++) {
    $dir = New-Item -Path (Join-Path $root "snapshot-$i") -ItemType Directory
    if ($i -gt 0) { [IO.File]::WriteAllText((Join-Path $dir.FullName 'fixture.txt'), 'source') }
    $dir.LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(-10+$i)
  }
  Remove-OldSnapshots $root 'fixture'
  $remaining = @(Get-ChildItem -LiteralPath $root -Directory | Sort-Object Name)
  if (($remaining.Name -join ',') -ne 'snapshot-3,snapshot-4') { throw 'Wrong snapshots retained' }
  if ($script:record.name -ne 'snapshot_retention_completed' -or $script:record.data.removed -ne 3 -or $script:record.data.freedBytes -ne 12) { throw 'Incorrect retention evidence' }
  Remove-OldSnapshots $root 'fixture'
  if ($script:record.data.removed -ne 0) { throw 'Retention is not idempotent' }
  Write-Output 'PASS: PowerShell 5.1 empty snapshots, keep count, byte accounting, and idempotency'
} finally {
  $resolved = [IO.Path]::GetFullPath($root)
  $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\albinaa-retention-test-'
  if ($resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
