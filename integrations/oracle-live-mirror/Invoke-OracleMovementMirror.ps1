param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$CredentialPath = (Join-Path $env:LOCALAPPDATA 'Albinaa\OracleMirror\oracle-password.dpapi'),
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'Albinaa\OracleMirror'),
  [string]$SnapshotRoot = '',
  [string]$OrganizationId = 'ced51b8c-59bb-4353-8308-a50667ef5d6c',
  [string]$TriggeredBy = 'e9436c07-4896-4f9b-a290-1585030a039e'
)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
if([string]::IsNullOrWhiteSpace($SnapshotRoot)){$SnapshotRoot=Join-Path $RepositoryRoot 'data-clean\oracle-live-mirror\movements'}
$RepositoryRoot=[IO.Path]::GetFullPath($RepositoryRoot); $SnapshotRoot=[IO.Path]::GetFullPath($SnapshotRoot); $StateRoot=[IO.Path]::GetFullPath($StateRoot)
New-Item -ItemType Directory -Path $SnapshotRoot -Force | Out-Null; New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
$logPath=Join-Path $StateRoot 'movement-events.jsonl'; $mutex=New-Object Threading.Mutex($false,'Local\AlbinaaOracleMovementMirror'); $hasLock=$false; $ptr=[IntPtr]::Zero; $secure=$null
function Event([string]$event,[hashtable]$data=@{}){Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ([ordered]@{timestampUtc=[DateTime]::UtcNow.ToString('o');event=$event;data=$data}|ConvertTo-Json -Compress -Depth 4)}
function Signature([string]$snapshot){$m=Get-Content (Join-Path $snapshot 'manifest.json') -Raw|ConvertFrom-Json;$payload=($m.files|Sort-Object name|ForEach-Object{"$($_.name):$($_.sha256)"})-join'|';$sha=[Security.Cryptography.SHA256]::Create();try{return([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
function DatabaseUrl {$lines=& docker.exe inspect albinaa-clean-backend --format '{{range .Config.Env}}{{println .}}{{end}}';$line=$lines|Where-Object{$_ -like 'DATABASE_URL=*'}|Select-Object -First 1;if(-not $line){throw'DATABASE_URL unavailable'};return($line.Substring(13)-replace '@db:5432/','@localhost:16545/')}
function Heartbeat([bool]$changed,[string]$run=''){$changedText=if($changed){'true'}else{'false'};@'
INSERT INTO oracle_mirror_heartbeats(organization_id,source_schema,mirror_kind,last_checked_at,last_success_at,last_status,last_changed,last_sync_run_id,updated_at)
VALUES(:'org'::uuid,'IAS20261','movements',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'ok',:'changed'::boolean,NULLIF(:'run','')::uuid,CURRENT_TIMESTAMP)
ON CONFLICT(organization_id,source_schema,mirror_kind) DO UPDATE SET last_checked_at=EXCLUDED.last_checked_at,last_success_at=EXCLUDED.last_success_at,last_status='ok',last_changed=EXCLUDED.last_changed,last_sync_run_id=COALESCE(EXCLUDED.last_sync_run_id,oracle_mirror_heartbeats.last_sync_run_id),updated_at=CURRENT_TIMESTAMP;
'@|docker.exe exec -i albinaa-clean-db psql -U albinaa -d albinaa_clean -X -v ON_ERROR_STOP=1 -v "org=$OrganizationId" -v "changed=$changedText" -v "run=$run"|Out-Null;if($LASTEXITCODE -ne 0){throw'heartbeat failed'}}
try{
 $hasLock=$mutex.WaitOne(0);if(-not $hasLock){Event 'run_skipped_overlap';exit 0};if(-not(Test-Path $CredentialPath)){throw 'Encrypted Oracle credential is missing'}
 $secure=Get-Content $CredentialPath -Raw|ConvertTo-SecureString;$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$env:ALBINAA_ORACLE_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr);$env:DATABASE_URL=DatabaseUrl;Event 'run_started'
 $extractor=Join-Path $RepositoryRoot 'integrations\oracle-movements-readonly\Run-OracleMovementSnapshot.ps1';$out=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $extractor -OutputRoot $SnapshotRoot;if($LASTEXITCODE -ne 0){throw 'extraction failed'};$snapshot=@($out|Where-Object{Test-Path $_})[-1];if(-not $snapshot){throw 'extractor did not return snapshot'}
 $signature=Signature $snapshot;$sigPath=Join-Path $StateRoot 'last-movements.signature';$previous=if(Test-Path $sigPath){(Get-Content $sigPath -Raw).Trim()}else{''}
 if($signature -eq $previous){Heartbeat $false;Event 'snapshot_unchanged' @{signature=$signature}}
 else{$ts=Join-Path $RepositoryRoot 'backend\node_modules\.bin\ts-node.cmd';$cli=Join-Path $RepositoryRoot 'backend\src\oracle-movement-sync\oracle-movement-sync.cli.ts';$raw=(&$ts --transpile-only $cli --snapshot $snapshot --organization $OrganizationId --triggered-by $TriggeredBy --apply 2>&1|Out-String).Trim();if($LASTEXITCODE -ne 0){throw "load failed: $raw"};$start=$raw.IndexOf('{');$end=$raw.LastIndexOf('}');if($start -lt 0 -or $end -lt $start){throw 'loader JSON missing'};$result=$raw.Substring($start,$end-$start+1)|ConvertFrom-Json;[IO.File]::WriteAllText($sigPath,$signature,(New-Object Text.UTF8Encoding($false)));Heartbeat $true $result.syncRunId;Event 'snapshot_loaded' @{run=$result.syncRunId;customer=$result.counts.customer_movements;inventory=$result.counts.inventory_movements}
 @'
BEGIN;
WITH keep AS (SELECT id FROM oracle_movement_sync_runs ORDER BY started_at DESC LIMIT 2), doomed AS (SELECT id FROM oracle_movement_sync_runs WHERE id NOT IN(SELECT id FROM keep))
DELETE FROM oracle_customer_movements_mirror WHERE sync_run_id IN(SELECT id FROM doomed);
WITH keep AS (SELECT id FROM oracle_movement_sync_runs ORDER BY started_at DESC LIMIT 2), doomed AS (SELECT id FROM oracle_movement_sync_runs WHERE id NOT IN(SELECT id FROM keep))
DELETE FROM oracle_inventory_movements_mirror WHERE sync_run_id IN(SELECT id FROM doomed);
DELETE FROM oracle_movement_sync_runs WHERE id NOT IN(SELECT id FROM oracle_movement_sync_runs ORDER BY started_at DESC LIMIT 2);
COMMIT;
'@|docker.exe exec -i albinaa-clean-db psql -U albinaa -d albinaa_clean -X -v ON_ERROR_STOP=1|Out-Null}
 $ts=Join-Path $RepositoryRoot 'backend\node_modules\.bin\ts-node.cmd'
 $publisher=Join-Path $RepositoryRoot 'backend\src\oracle-movement-sync\oracle-movement-auto-publication.cli.ts'
 $publicationRaw=(&$ts --transpile-only $publisher --organization $OrganizationId --source IAS20261 --published-by $TriggeredBy --apply 2>&1|Out-String).Trim()
 if($LASTEXITCODE-ne 0){throw "automatic publication failed: $publicationRaw"}
 $publicationStart=$publicationRaw.IndexOf('{');$publicationEnd=$publicationRaw.LastIndexOf('}')
 if($publicationStart-lt 0-or $publicationEnd-lt $publicationStart){throw 'automatic publication JSON missing'}
 $publication=$publicationRaw.Substring($publicationStart,$publicationEnd-$publicationStart+1)|ConvertFrom-Json
 $publicationBatch=if($publication.PSObject.Properties.Name-contains'batchId'){$publication.batchId}else{''}
 $publishedCustomer=if($publication.PSObject.Properties.Name-contains'counts'){$publication.counts.customers.published}else{0}
 $publishedInventory=if($publication.PSObject.Properties.Name-contains'counts'){$publication.counts.inventory.published}else{0}
 Event 'automatic_publication_checked' @{status=$publication.status;batch=$publicationBatch;customer=$publishedCustomer;inventory=$publishedInventory}
 Get-ChildItem $SnapshotRoot -Directory -Filter 'snapshot-*'|Sort-Object LastWriteTimeUtc -Descending|Select-Object -Skip 2|ForEach-Object{$resolved=[IO.Path]::GetFullPath($_.FullName);$prefix=$SnapshotRoot.TrimEnd('\')+'\';if(-not $resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'unsafe cleanup path'};Remove-Item -LiteralPath $resolved -Recurse -Force};Event 'run_completed'
}catch{Event 'run_failed' @{message=$_.Exception.Message};throw}finally{Remove-Item Env:ALBINAA_ORACLE_PASSWORD,Env:DATABASE_URL -ErrorAction SilentlyContinue;if($ptr-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};if($hasLock){$mutex.ReleaseMutex()};$mutex.Dispose()}
