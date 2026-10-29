param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$CredentialPath = (Join-Path $env:LOCALAPPDATA 'Albinaa\OracleMirror\oracle-password.dpapi'),
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'Albinaa\OracleMirror'),
  [string]$SnapshotRoot = '',
  [string]$OracleAlias = 'YEMENSOFT',
  [string]$OracleUser = 'ys',
  [string]$OracleHome = 'C:\OraNT',
  [string]$SourceSchema = 'IAS20261',
  [string]$OrganizationId = 'ced51b8c-59bb-4353-8308-a50667ef5d6c',
  [string]$TriggeredBy = 'e9436c07-4896-4f9b-a290-1585030a039e',
  [int]$LocalSnapshotsToKeep = 3
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($SnapshotRoot)) {
  $SnapshotRoot = Join-Path $RepositoryRoot 'data-clean\oracle-live-mirror'
}
$RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
$SnapshotRoot = [IO.Path]::GetFullPath($SnapshotRoot)
$StateRoot = [IO.Path]::GetFullPath($StateRoot)
$CredentialPath = [IO.Path]::GetFullPath($CredentialPath)
New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
New-Item -ItemType Directory -Path $SnapshotRoot -Force | Out-Null

$logPath = Join-Path $StateRoot 'mirror-events.jsonl'
$mutex = New-Object System.Threading.Mutex($false, 'Local\AlbinaaOracleLiveMirror')
$hasLock = $false
$securePassword = $null
$passwordPointer = [IntPtr]::Zero

function Write-MirrorEvent {
  param([string]$Level, [string]$Event, [hashtable]$Data = @{})
  $safeData = @{}
  foreach ($key in $Data.Keys) {
    $safeData[$key] = ([string]$Data[$key]) -replace '(?i)(password|pwd)=[^;\s]*', '$1=[REDACTED]'
  }
  $entry = [ordered]@{
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    level = $Level
    event = $Event
    data = $safeData
  }
  Add-Content -LiteralPath $logPath -Value ($entry | ConvertTo-Json -Compress -Depth 5) -Encoding UTF8
}

function Get-SnapshotSignature {
  param([Parameter(Mandatory = $true)][string]$SnapshotDirectory)
  $manifest = Get-Content -LiteralPath (Join-Path $SnapshotDirectory 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $payload = ($manifest.files | Sort-Object name | ForEach-Object { "$($_.name):$($_.sha256)" }) -join '|'
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  }
  finally { $sha.Dispose() }
}

function Get-DatabaseUrlFromContainer {
  $environment = & docker.exe inspect albinaa-clean-backend --format '{{range .Config.Env}}{{println .}}{{end}}'
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the clean backend container.' }
  $line = $environment | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
  if (-not $line) { throw 'DATABASE_URL is unavailable from the clean backend container.' }
  $databaseUrl = $line.Substring('DATABASE_URL='.Length)
  # The backend container reaches PostgreSQL through the Docker service name.
  # This runner executes on Windows, where the same database is published on 16545.
  return $databaseUrl -replace '@db:5432/', '@localhost:16545/'
}

function Invoke-Extractor {
  param([Parameter(Mandatory = $true)][ValidateSet('customers','inventory')][string]$Kind)
  $integration = if ($Kind -eq 'customers') { 'oracle-customers-readonly' } else { 'oracle-inventory-readonly' }
  $runner = if ($Kind -eq 'customers') { 'Run-OracleCustomerSnapshot.ps1' } else { 'Run-OracleInventorySnapshot.ps1' }
  $outputRoot = Join-Path $SnapshotRoot $Kind
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $runnerPath = Join-Path $RepositoryRoot "integrations\$integration\$runner"
  $output = & $powershell -NoProfile -ExecutionPolicy Bypass -File $runnerPath `
    -OutputRoot $outputRoot -OracleAlias $OracleAlias -OracleUser $OracleUser -OracleHome $OracleHome
  if ($LASTEXITCODE -ne 0) { throw "$Kind Oracle extraction failed with exit code $LASTEXITCODE." }
  $snapshot = @($output | ForEach-Object { [string]$_ } | Where-Object { Test-Path -LiteralPath $_ })[-1]
  if (-not $snapshot) { throw "$Kind Oracle extraction did not return a snapshot directory." }
  return [IO.Path]::GetFullPath($snapshot)
}

function Invoke-Loader {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('customers','inventory')][string]$Kind,
    [Parameter(Mandatory = $true)][string]$SnapshotDirectory
  )
  $cli = if ($Kind -eq 'customers') {
    Join-Path $RepositoryRoot 'backend\src\oracle-customer-sync\oracle-customer-sync.cli.ts'
  } else {
    Join-Path $RepositoryRoot 'backend\src\oracle-inventory-sync\oracle-inventory-sync.cli.ts'
  }
  $tsNode = Join-Path $RepositoryRoot 'backend\node_modules\.bin\ts-node.cmd'
  if (-not (Test-Path -LiteralPath $cli)) { throw "$Kind mirror loader source is missing: $cli" }
  if (-not (Test-Path -LiteralPath $tsNode)) { throw "ts-node is missing: $tsNode" }
  $raw = (& $tsNode --transpile-only $cli --snapshot $SnapshotDirectory --organization $OrganizationId --triggered-by $TriggeredBy --apply 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "$Kind mirror loading failed: $raw" }
  $jsonStart = $raw.IndexOf('{')
  $jsonEnd = $raw.LastIndexOf('}')
  if ($jsonStart -lt 0 -or $jsonEnd -lt $jsonStart) {
    throw "$Kind mirror loader did not return a JSON result."
  }
  return $raw.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json
}

function Remove-OldLocalSnapshots {
  param([Parameter(Mandatory = $true)][ValidateSet('customers','inventory')][string]$Kind)
  $root = [IO.Path]::GetFullPath((Join-Path $SnapshotRoot $Kind))
  $prefix = $root.TrimEnd('\') + '\'
  $old = Get-ChildItem -LiteralPath $root -Directory -Filter 'snapshot-*' |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -Skip $LocalSnapshotsToKeep
  foreach ($directory in $old) {
    $resolved = [IO.Path]::GetFullPath($directory.FullName)
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a snapshot outside the approved root: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

function Invoke-DatabaseRetention {
  $sqlPath = Join-Path $PSScriptRoot 'Retain-LatestMirrorRuns.sql'
  Get-Content -LiteralPath $sqlPath -Raw -Encoding UTF8 |
    & docker.exe exec -i albinaa-clean-db psql -U albinaa -d albinaa_clean -X -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Mirror retention transaction failed.' }
}

function Write-MirrorHeartbeat {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('customers','inventory')][string]$Kind,
    [Parameter(Mandatory = $true)][ValidateSet('ok','failed')][string]$Status,
    [Parameter(Mandatory = $true)][bool]$Changed,
    [string]$SyncRunId = ''
  )
  $changedText = if ($Changed) { 'true' } else { 'false' }
  $sql = @'
INSERT INTO oracle_mirror_heartbeats (
  organization_id, source_schema, mirror_kind, last_checked_at, last_success_at,
  last_status, last_changed, last_sync_run_id, updated_at
)
VALUES (
  :'org'::uuid, :'schema', :'kind', CURRENT_TIMESTAMP,
  CASE WHEN :'status' = 'ok' THEN CURRENT_TIMESTAMP ELSE NULL END,
  :'status', :'changed'::boolean, NULLIF(:'run', '')::uuid, CURRENT_TIMESTAMP
)
ON CONFLICT (organization_id, source_schema, mirror_kind) DO UPDATE SET
  last_checked_at = EXCLUDED.last_checked_at,
  last_success_at = CASE
    WHEN EXCLUDED.last_status = 'ok' THEN EXCLUDED.last_checked_at
    ELSE oracle_mirror_heartbeats.last_success_at
  END,
  last_status = EXCLUDED.last_status,
  last_changed = EXCLUDED.last_changed,
  last_sync_run_id = COALESCE(EXCLUDED.last_sync_run_id, oracle_mirror_heartbeats.last_sync_run_id),
  updated_at = CURRENT_TIMESTAMP;
'@
  $sql | & docker.exe exec -i albinaa-clean-db psql -U albinaa -d albinaa_clean -X -v ON_ERROR_STOP=1 `
    -v "org=$OrganizationId" -v "schema=$SourceSchema" -v "kind=$Kind" `
    -v "status=$Status" -v "changed=$changedText" -v "run=$SyncRunId" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "$Kind mirror heartbeat update failed." }
}

try {
  $hasLock = $mutex.WaitOne(0)
  if (-not $hasLock) {
    Write-MirrorEvent -Level 'info' -Event 'run_skipped_overlap'
    exit 0
  }
  if (-not (Test-Path -LiteralPath $CredentialPath)) { throw "Encrypted Oracle credential is missing: $CredentialPath" }
  $securePassword = Get-Content -LiteralPath $CredentialPath -Raw -Encoding UTF8 | ConvertTo-SecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $env:ALBINAA_ORACLE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:DATABASE_URL = Get-DatabaseUrlFromContainer
  Write-MirrorEvent -Level 'info' -Event 'run_started'

  $loadedAny = $false
  foreach ($kind in @('customers','inventory')) {
    try {
      $snapshot = Invoke-Extractor -Kind $kind
      $signature = Get-SnapshotSignature -SnapshotDirectory $snapshot
      $signaturePath = Join-Path $StateRoot "last-$kind.signature"
      $previous = if (Test-Path -LiteralPath $signaturePath) { (Get-Content -LiteralPath $signaturePath -Raw).Trim() } else { '' }
      if ($signature -eq $previous) {
        Write-MirrorHeartbeat -Kind $kind -Status 'ok' -Changed $false
        Write-MirrorEvent -Level 'info' -Event 'snapshot_unchanged' -Data @{ kind = $kind; signature = $signature }
      } else {
        $result = Invoke-Loader -Kind $kind -SnapshotDirectory $snapshot
        [IO.File]::WriteAllText($signaturePath, $signature, (New-Object System.Text.UTF8Encoding($false)))
        $loadedAny = $true
        Write-MirrorHeartbeat -Kind $kind -Status 'ok' -Changed $true -SyncRunId $result.syncRunId
        Write-MirrorEvent -Level 'info' -Event 'snapshot_loaded' -Data @{
          kind = $kind
          signature = $signature
          syncRunId = $result.syncRunId
          status = $result.status
        }
      }
      Remove-OldLocalSnapshots -Kind $kind
    }
    catch {
      try { Write-MirrorHeartbeat -Kind $kind -Status 'failed' -Changed $false } catch {}
      Write-MirrorEvent -Level 'error' -Event 'kind_failed' -Data @{ kind = $kind; message = $_.Exception.Message }
      throw
    }
  }
  if ($loadedAny) { Invoke-DatabaseRetention }
  Write-MirrorEvent -Level 'info' -Event 'run_completed' -Data @{ loadedAny = $loadedAny }
}
catch {
  Write-MirrorEvent -Level 'error' -Event 'run_failed' -Data @{ message = $_.Exception.Message }
  throw
}
finally {
  Remove-Item Env:ALBINAA_ORACLE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  $securePassword = $null
  if ($hasLock) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
