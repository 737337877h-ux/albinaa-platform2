param(
  [ValidateSet('core','movements')][string]$Kind = 'core',
  [ValidateRange(1, 1000)][int]$SnapshotsToKeep = 10,
  [string]$ReadEnvironment = 'E:\albinaa-platform-staging\albinaa-platform2\oracle-read-api\.env'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repository = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'platform-storage-guard.ps1')
$stateRoot = 'E:\albinaa-platform-staging\albinaa-platform2\data-clean\oracle-ro-recovery'
$organization = 'ced51b8c-59bb-4353-8308-a50667ef5d6c'
$actor = 'e9436c07-4896-4f9b-a290-1585030a039e'
$node = (Get-Command node.exe).Source
$tsNode = Join-Path $repository 'backend\node_modules\ts-node\dist\bin.js'
$mutexName = if ($Kind -eq 'core') { 'Local\AlbinaaOracleLiveMirror' } else { 'Local\AlbinaaOracleMovementMirror' }
$mutex = New-Object Threading.Mutex($false, $mutexName)
$locked = $false
$failed = $false
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

function Event([string]$name, [object]$data) {
  [ordered]@{timestampUtc=[DateTime]::UtcNow.ToString('o');kind=$Kind;event=$name;data=$data} |
    ConvertTo-Json -Depth 7 -Compress | Add-Content -LiteralPath (Join-Path $stateRoot "$Kind-events.jsonl") -Encoding UTF8
}
function Child([string[]]$arguments, [string]$name, [int]$seconds = 240, [string]$executable = $node) {
  $stamp = [Guid]::NewGuid().ToString('N')
  $out = Join-Path $stateRoot "$name-$stamp.out.log"
  $err = Join-Path $stateRoot "$name-$stamp.err.log"
  $quoted = @($arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' })
  $process = Start-Process -FilePath $executable -ArgumentList $quoted -WorkingDirectory (Join-Path $repository 'backend') `
    -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  # Retain the native handle so Windows PowerShell 5.1 keeps ExitCode after exit.
  $null = $process.Handle
  if (-not $process.WaitForExit($seconds * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "$name exceeded $seconds seconds; its own child process was stopped"
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    $detail = (Get-Content -LiteralPath $err -Tail 8 | Out-String).Trim()
    throw "$name failed: $detail"
  }
  $raw = (Get-Content -LiteralPath $out -Raw).Trim()
  $first = $raw.IndexOf('{'); $last = $raw.LastIndexOf('}')
  if ($first -lt 0 -or $last -lt $first) { throw "$name did not return a complete result" }
  return $raw.Substring($first, $last - $first + 1) | ConvertFrom-Json
}
function Heartbeat([string]$part, [string]$status, [bool]$changed, [string]$run = '') {
  $changedValue = if ($changed) {'true'} else {'false'}
  @'
INSERT INTO oracle_mirror_heartbeats(organization_id,source_schema,mirror_kind,last_checked_at,last_success_at,last_status,last_changed,last_sync_run_id,updated_at)
VALUES(:'org'::uuid,'IAS20261',:'kind',CURRENT_TIMESTAMP,CASE WHEN :'status'='ok' THEN CURRENT_TIMESTAMP ELSE NULL END,:'status',:'changed'::boolean,NULLIF(:'run','')::uuid,CURRENT_TIMESTAMP)
ON CONFLICT(organization_id,source_schema,mirror_kind) DO UPDATE SET last_checked_at=EXCLUDED.last_checked_at,
last_success_at=COALESCE(EXCLUDED.last_success_at,oracle_mirror_heartbeats.last_success_at),last_status=EXCLUDED.last_status,last_changed=EXCLUDED.last_changed,
last_sync_run_id=COALESCE(EXCLUDED.last_sync_run_id,oracle_mirror_heartbeats.last_sync_run_id),updated_at=CURRENT_TIMESTAMP;
'@ | docker.exe exec -i albinaa-clean-db psql -U albinaa -d albinaa_clean -X -v ON_ERROR_STOP=1 `
    -v "org=$organization" -v "kind=$part" -v "status=$status" -v "changed=$changedValue" -v "run=$run" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not record mirror health' }
}
function Publish-Movements {
  # Run the deployed publication policy beside PostgreSQL to avoid thousands
  # of Windows-to-container round trips. No approval or transaction limits change.
  $publishCli = 'dist/oracle-movement-sync/oracle-movement-auto-publication.cli.js'
  $publication = Child @('exec','albinaa-clean-backend','node',$publishCli,'--organization',$organization,'--source','IAS20261','--published-by',$actor,'--apply') 'publish-movements' -executable (Get-Command docker.exe).Source
  if (-not $publication.applied -or $publication.status -notin @('completed','no_new_movements')) {
    throw "Movement publication did not complete: $($publication.status); configuration was not changed"
  }
  Event 'movements_published' $publication
}
function Remove-OldSnapshots([string]$outputRoot, [string]$part) {
  $root = [IO.Path]::GetFullPath($outputRoot).TrimEnd('\')
  $prefix = $root + '\'
  $snapshots = @(
    Get-ChildItem -LiteralPath $root -Directory -Filter 'snapshot-*' |
      Sort-Object LastWriteTimeUtc -Descending
  )
  $expired = @($snapshots | Select-Object -Skip $SnapshotsToKeep)
  $freedBytes = [int64]0
  foreach ($snapshot in $expired) {
    $resolved = [IO.Path]::GetFullPath($snapshot.FullName)
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a snapshot outside its expected directory: $resolved"
    }
    if (($snapshot.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to remove a reparse-point snapshot: $resolved"
    }
    # Empty failed exports have no Sum property under Windows PowerShell 5.1
    # strict mode. Count their bytes as zero and continue the bounded retention.
    foreach ($file in Get-ChildItem -LiteralPath $resolved -Recurse -File -Force) {
      $freedBytes += [int64]$file.Length
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
  Event 'snapshot_retention_completed' @{
    part = $part
    retained = [Math]::Min($SnapshotsToKeep, $snapshots.Count)
    removed = $expired.Count
    freedBytes = $freedBytes
  }
}
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { Event 'run_skipped_overlap' @{}; exit 0 }
  # Stop importing full snapshots before either the database drive or Docker's
  # production drive fills. Preserve the last usable snapshot and all history.
  $databaseStoragePath = Get-AlbinaaDatabaseStoragePath
  $storage = Get-AlbinaaStorageHeadroom -DatabasePath $databaseStoragePath -RuntimePath $stateRoot
  if (-not $storage.ok) {
    Event 'storage_guard_blocked' $storage
    foreach ($part in $(if ($Kind -eq 'core') { @('customers','inventory') } else { @('movements') })) {
      Heartbeat $part 'failed' $false
    }
    throw 'Mirror paused: insufficient storage headroom; no new snapshot was imported'
  }
  $config = @{}
  foreach ($line in Get-Content -LiteralPath $ReadEnvironment) {
    if ($line -match '^(ORACLE_USER|ORACLE_SCHEMA)=(.*)$') { $config[$Matches[1]] = $Matches[2].Trim() }
  }
  if ($config['ORACLE_USER'] -ne 'ALBINAA_RO' -or $config['ORACLE_SCHEMA'] -ne 'IAS20261') { throw 'Only ALBINAA_RO / IAS20261 is allowed' }
  $databaseLine = docker.exe inspect albinaa-clean-backend --format '{{range .Config.Env}}{{println .}}{{end}}' |
    Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1
  if (-not $databaseLine) { throw 'Production database settings unavailable' }
  $env:DATABASE_URL = $databaseLine.Substring(13).Replace('@db:5432/', '@localhost:16545/')
  if ($env:DATABASE_URL -notmatch '@localhost:16545/albinaa_clean\?') { throw 'Unexpected database target' }
  Event 'run_started' @{readUser='ALBINAA_RO'}
  $parts = if ($Kind -eq 'core') { @('customers','inventory') } else { @('movements') }
  foreach ($part in $parts) {
    try {
      $outputRoot = Join-Path $stateRoot $part
      $script = switch ($part) {
        'inventory' { 'export-invi008-inventory-snapshot.js' }
        'movements' { 'export-compatible-movement-snapshot.js' }
        default { 'export-mirror-snapshot.js' }
      }
      $argsForExport = @("--env-file=$ReadEnvironment", (Join-Path $repository "oracle-read-api\scripts\$script"))
      if ($part -eq 'customers') { $argsForExport += $part }
      $argsForExport += $outputRoot
      # The legacy 32-bit provider is slower immediately after resume. The
      # movement exporter has its own 420-second hard limit; leave enough time
      # for it while retaining the shorter bound for customer/inventory reads.
      $extractSeconds = if ($part -eq 'movements') { 480 } else { 240 }
      $snapshot = Child $argsForExport "extract-$part" $extractSeconds
      $directory = [IO.Path]::GetFullPath($snapshot.directory)
      if (-not $directory.StartsWith(([IO.Path]::GetFullPath($outputRoot).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Snapshot outside its expected directory' }
      $manifest = Get-Content -LiteralPath (Join-Path $directory 'manifest.json') -Raw | ConvertFrom-Json
      if ($manifest.source.schema -ne 'IAS20261' -or $manifest.source.transactionMode -ne 'READ ONLY') { throw 'Unexpected snapshot source' }
      $signature = ($manifest.files | Sort-Object name | ForEach-Object { "$($_.name):$($_.sha256)" }) -join '|'
      $signaturePath = Join-Path $stateRoot "$part.signature"
      $previous = if (Test-Path -LiteralPath $signaturePath) { (Get-Content -LiteralPath $signaturePath -Raw).Trim() } else { '' }
      if ($signature -eq $previous) {
        # Preserve the existing workflow: a new customer/balance snapshot may
        # need reconciliation even when the movement fingerprint is unchanged.
        if ($part -eq 'movements') { Publish-Movements }
        Heartbeat $part 'ok' $false
        Event 'snapshot_unchanged' @{part=$part}
        # This exact new export was never loaded/referenced. Existing snapshots
        # and all customer, task, collection and mirror database rows are retained.
        Remove-Item -LiteralPath $directory -Recurse -Force
        try { Remove-OldSnapshots $outputRoot $part } catch {
          Event 'snapshot_retention_failed' @{part=$part;message=$_.Exception.Message}
        }
        continue
      }
      $module = switch ($part) { 'customers' {'oracle-customer-sync'} 'inventory' {'oracle-inventory-sync'} 'movements' {'oracle-movement-sync'} }
      $cli = Join-Path $repository "backend\src\$module\$module.cli.ts"
      # Movement loading allows a 600-second database transaction. Give its
      # worker time to finish and report the result instead of killing it at 240s.
      $loadSeconds = if ($part -eq 'movements') { 660 } else { 240 }
      $storage = Get-AlbinaaStorageHeadroom -DatabasePath $databaseStoragePath -RuntimePath $stateRoot
      if (-not $storage.ok) {
        Event 'storage_guard_blocked' $storage
        throw 'Mirror paused before loading: insufficient storage headroom'
      }
      $loaded = Child @($tsNode,'--transpile-only',$cli,'--snapshot',$directory,'--organization',$organization,'--triggered-by',$actor,'--apply') "load-$part" $loadSeconds
      $expectedLoadStatus = if ($part -eq 'inventory') { 'validating' } else { 'validated' }
      if (-not $loaded.applied -or $loaded.status -ne $expectedLoadStatus -or -not $loaded.syncRunId) {
        throw "The $part snapshot did not finish loading; previous snapshot retained"
      }
      if ($part -eq 'inventory') {
        $publishCli = Join-Path $repository 'backend\src\oracle-inventory-sync\oracle-inventory-publication.cli.ts'
        $validation = Child @($tsNode,'--transpile-only',$publishCli,'--run',$loaded.syncRunId) 'validate-inventory'
        if (-not $validation.passed) { throw 'Inventory validation rejected this snapshot; previous snapshot retained' }
        $published = Child @($tsNode,'--transpile-only',$publishCli,'--run',$loaded.syncRunId,'--publish') 'publish-inventory'
        if (-not $published.published) { throw 'Inventory snapshot was not published' }
      }
      if ($part -eq 'movements') {
        Publish-Movements
      }
      $signature | Set-Content -LiteralPath $signaturePath -Encoding UTF8
      Heartbeat $part 'ok' $true $loaded.syncRunId
      Event 'snapshot_loaded' @{part=$part;run=$loaded.syncRunId;counts=$snapshot.counts}
       try {
         # Retention runs only after the current snapshot has been fully loaded
         # and, where applicable, published. A cleanup failure must not relabel
         # a healthy mirror run as failed.
         Remove-OldSnapshots $outputRoot $part
       } catch {
         Event 'snapshot_retention_failed' @{part=$part;message=$_.Exception.Message}
       }
    } catch {
      $failed = $true
      Heartbeat $part 'failed' $false
      Event 'kind_failed' @{part=$part;message=$_.Exception.Message}
    }
  }
  if (-not $failed) {
    try {
      $retentionScript = Join-Path $repository 'scripts\oracle-mirror-retention.cjs'
      $retention = Child @($retentionScript,'--organization',$organization,'--keep',"$SnapshotsToKeep",'--apply') 'retention-database' 180
      Event 'database_retention_completed' $retention
    } catch {
      Event 'database_retention_failed' @{message=$_.Exception.Message}
    }
  }
  Event 'run_completed' @{success=(-not $failed)}
} catch {
  $failed = $true
  Event 'run_failed' @{message=$_.Exception.Message}
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
if ($failed) { exit 1 }
