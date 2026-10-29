'use strict';

// PostgreSQL mirror history only. No Oracle connection and no operational DML.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TABLES = [
  ['customers', 'oracle_customers_mirror', 'customers'],
  ['customers', 'oracle_customer_currencies_mirror', 'customer_currencies'],
  ['customers', 'oracle_customer_balances_mirror', 'customer_balances'],
  ['inventory', 'oracle_item_groups_mirror', 'item_groups'],
  ['inventory', 'oracle_items_mirror', 'items'],
  ['inventory', 'oracle_item_units_mirror', 'item_units'],
  ['inventory', 'oracle_warehouse_groups_mirror', 'warehouse_groups'],
  ['inventory', 'oracle_warehouses_mirror', 'warehouses'],
  ['inventory', 'oracle_stock_balances_mirror', 'stock_balances'],
  ['movements', 'oracle_customer_movements_mirror', 'customer_movements', 'customer'],
  ['movements', 'oracle_inventory_movements_mirror', 'inventory_movements', 'inventory'],
];
const RUNS = { customers: 'oracle_customer_sync_runs', inventory: 'oracle_inventory_sync_runs', movements: 'oracle_movement_sync_runs' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE = /^mirror_retention_[0-9]{8}_[a-z0-9_]+$/;

function validate(options) {
  if (!UUID.test(options.organization || '')) throw Error('An explicit organization UUID is required');
  if (!Number.isInteger(options.keep) || options.keep < 2 || options.keep > 100) throw Error('Keep must be an integer from 2 to 100');
  if (options.stage && !STAGE.test(options.stage)) throw Error('Invalid maintenance staging schema');
}
function header(options) {
  return `BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='600s';
DO $$ BEGIN IF NOT pg_try_advisory_xact_lock(3941620027::bigint) THEN RAISE EXCEPTION 'Mirror retention already running'; END IF; END $$;
SELECT pg_advisory_xact_lock(3941620026::bigint);
SELECT id FROM public.organizations WHERE id='${options.organization}'::uuid FOR NO KEY UPDATE;`;
}
function plan(options) {
  validate(options);
  const org = `'${options.organization}'::uuid`, keep = options.keep;
  const parts = Object.entries(RUNS).map(([kind, table]) => `
INSERT INTO retention_runs SELECT '${kind}',id,status,started_at FROM public.${table} WHERE organization_id=${org} AND source_schema='IAS20261';
INSERT INTO retention_full
 SELECT '${kind}',id FROM public.${table} WHERE organization_id=${org} AND source_schema='IAS20261' AND status='published'
 ORDER BY started_at DESC,id DESC LIMIT ${keep} ON CONFLICT DO NOTHING;
INSERT INTO retention_full SELECT '${kind}',id FROM public.${table} WHERE organization_id=${org} AND source_schema='IAS20261'
 AND status<>'retired' AND started_at>CURRENT_TIMESTAMP-interval '2 hours' ON CONFLICT DO NOTHING;
INSERT INTO retention_full SELECT '${kind}',id FROM
 (SELECT DISTINCT ON (status) id FROM public.${table} WHERE organization_id=${org} AND source_schema='IAS20261'
 AND status IN ('validated','validating','extracting') ORDER BY status,started_at DESC,id DESC) pending ON CONFLICT DO NOTHING;`).join('\n');
  return `
CREATE TEMP TABLE retention_runs(kind text,id uuid,status text,started_at timestamptz,PRIMARY KEY(kind,id)) ON COMMIT DROP;
CREATE TEMP TABLE retention_full(kind text,id uuid,PRIMARY KEY(kind,id)) ON COMMIT DROP;
CREATE TEMP TABLE retention_refs(kind text,run_id uuid,fingerprint text,PRIMARY KEY(kind,run_id,fingerprint)) ON COMMIT DROP;
${parts}
INSERT INTO retention_full SELECT 'inventory',active_run_id FROM public.oracle_inventory_active_snapshots WHERE organization_id=${org} AND source_schema='IAS20261' ON CONFLICT DO NOTHING;
INSERT INTO retention_full SELECT 'inventory',previous_run_id FROM public.oracle_inventory_active_snapshots WHERE organization_id=${org} AND source_schema='IAS20261' AND previous_run_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO retention_full SELECT 'movements',(value->>'baselineRunId')::uuid FROM public.system_settings
 WHERE organization_id=${org} AND key='oracleMovementAutoPublish' AND value->>'baselineRunId' IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO retention_full SELECT mirror_kind,last_sync_run_id FROM public.oracle_mirror_heartbeats
 WHERE organization_id=${org} AND source_schema='IAS20261' AND last_sync_run_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO retention_refs SELECT movement_kind,source_run_id,source_fingerprint FROM public.oracle_movement_publication_ledger
 WHERE organization_id=${org} AND source_schema='IAS20261' ON CONFLICT DO NOTHING;
INSERT INTO retention_refs SELECT 'inventory',source_run_id,source_fingerprint FROM public.published_inventory_movements
 WHERE organization_id=${org} AND source_schema='IAS20261' ON CONFLICT DO NOTHING;
CREATE TEMP TABLE retention_candidates ON COMMIT DROP AS SELECT r.* FROM retention_runs r
 WHERE r.status<>'retired' AND r.started_at<CURRENT_TIMESTAMP-interval '2 hours'
 AND NOT EXISTS(SELECT 1 FROM retention_full f WHERE f.kind=r.kind AND f.id=r.id);
CREATE UNIQUE INDEX ON retention_candidates(kind,id);
CREATE TEMP TABLE retention_copy(kind text,id uuid,PRIMARY KEY(kind,id)) ON COMMIT DROP;
${Object.entries(RUNS).map(([kind,table])=>`INSERT INTO retention_copy SELECT '${kind}',r.id FROM public.${table} r
 WHERE NOT EXISTS(SELECT 1 FROM retention_candidates c WHERE c.kind='${kind}' AND c.id=r.id);`).join('\n')}
ANALYZE retention_refs; ANALYZE retention_candidates; ANALYZE retention_copy;
CREATE TEMP TABLE retention_result(table_name text,removed bigint) ON COMMIT DROP;`;
}
function retainedSelect(kind, table, movementKind) {
  // Index joins on sync_run_id avoid scanning hundreds of millions of expired rows.
  const full = `SELECT m.* FROM retention_copy r JOIN public.${table} m ON m.sync_run_id=r.id WHERE r.kind='${kind}'`;
  if (!movementKind) return full;
  return `${full} UNION ALL
 SELECT m.* FROM retention_refs ref JOIN public.${table} m ON m.sync_run_id=ref.run_id AND m.source_fingerprint=ref.fingerprint
 JOIN retention_candidates c ON c.kind='movements' AND c.id=m.sync_run_id WHERE ref.kind='${movementKind}'`;
}
function digest(table) {
  return `SELECT count(*)::bigint rows,md5(COALESCE(string_agg(md5(row_to_json(m)::text),'' ORDER BY id),'')) digest FROM ${table} m`;
}
function retireRuns(candidateTable = 'retention_candidates') {
  return Object.entries(RUNS).map(([kind, table]) => `UPDATE public.${table} r SET status='retired',
 validation_summary=COALESCE(validation_summary,'{}'::jsonb)||jsonb_build_object('retention',jsonb_build_object('prunedAt',CURRENT_TIMESTAMP,'policy','latest-10-plus-protected-and-source-references','previousStatus',r.status))
 FROM ${candidateTable} c WHERE c.kind='${kind}' AND c.id=r.id;`).join('\n');
}
function previewSql(options) {
  return `${header(options)}${plan(options)}
SELECT jsonb_build_object('mode','preview','keep',${options.keep},'schema','IAS20261',
 'candidates',(SELECT jsonb_object_agg(kind,n) FROM (SELECT kind,count(*) n FROM retention_candidates GROUP BY kind) x),
 'protectedFull',(SELECT jsonb_object_agg(kind,n) FROM (SELECT kind,count(*) n FROM retention_full GROUP BY kind) x),
 'sourceReferences',(SELECT count(*) FROM retention_refs),
 'mirrorBytes',(SELECT sum(pg_total_relation_size(name::regclass)) FROM unnest(ARRAY[${TABLES.map(t => `'public.${t[1]}'`).join(',')}]) name));
ROLLBACK;`;
}
function cleanupSql(options) {
  const deletes = [...TABLES].reverse().map(([kind, table, , movementKind]) => `
WITH removed AS(DELETE FROM public.${table} m USING retention_candidates c WHERE c.kind='${kind}' AND c.id=m.sync_run_id
 ${movementKind ? `AND NOT EXISTS(SELECT 1 FROM retention_refs ref WHERE ref.kind='${movementKind}' AND ref.run_id=m.sync_run_id AND ref.fingerprint=m.source_fingerprint)` : ''}
 RETURNING 1) INSERT INTO retention_result SELECT '${table}',count(*) FROM removed;`).join('\n');
  return `${header(options)}${plan(options)}${deletes}${retireRuns()}
SELECT jsonb_build_object('mode','applied','removedRows',(SELECT COALESCE(sum(removed),0) FROM retention_result),
 'tables',(SELECT jsonb_object_agg(table_name,removed) FROM retention_result)); COMMIT;`;
}
function stageSql(options) {
  validate(options); if (!options.stage) throw Error('Staging schema required');
  const s = options.stage;
  return `${header(options)}${plan(options)}
DO $$ BEGIN
 IF (SELECT count(*) FROM public.organizations)<>1 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id='${options.organization}'::uuid) THEN
 RAISE EXCEPTION 'Initial physical compaction supports this single-organization database only'; END IF;
END $$;
CREATE SCHEMA ${s};
CREATE TABLE ${s}.full_runs AS SELECT * FROM retention_copy;
CREATE TABLE ${s}.candidates AS SELECT * FROM retention_candidates;
CREATE TABLE ${s}.manifest(table_name text PRIMARY KEY,rows bigint,digest text,original_bytes bigint);
${TABLES.map(([kind, table, , mk]) => `CREATE TABLE ${s}.${table} AS ${retainedSelect(kind, table, mk)};
CREATE UNIQUE INDEX ON ${s}.${table}(id);
INSERT INTO ${s}.manifest SELECT '${table}',d.rows,d.digest,pg_total_relation_size('public.${table}'::regclass) FROM (${digest(`${s}.${table}`)}) d;`).join('\n')}
CREATE TABLE ${s}.run_headers AS SELECT row_to_json(r)::jsonb data,'movements' kind FROM public.oracle_movement_sync_runs r
 UNION ALL SELECT row_to_json(r)::jsonb,'inventory' FROM public.oracle_inventory_sync_runs r
 UNION ALL SELECT row_to_json(r)::jsonb,'customers' FROM public.oracle_customer_sync_runs r;
CREATE TABLE ${s}.publication_ledger AS TABLE public.oracle_movement_publication_ledger;
CREATE TABLE ${s}.published_inventory AS TABLE public.published_inventory_movements;
CREATE TABLE ${s}.active_snapshots AS TABLE public.oracle_inventory_active_snapshots;
CREATE TABLE ${s}.heartbeats AS TABLE public.oracle_mirror_heartbeats;
CREATE TABLE ${s}.baseline_settings AS SELECT * FROM public.system_settings WHERE key='oracleMovementAutoPublish';
SELECT jsonb_build_object('mode','staged','stage','${s}','manifest',(SELECT jsonb_agg(m) FROM ${s}.manifest m)); COMMIT;`;
}
function compactSql(options) {
  validate(options); if (!options.stage) throw Error('Staging schema required');
  const s = options.stage, tables = TABLES.map(t => `'public.${t[1]}'::regclass`).join(',');
  const checks = TABLES.map(([kind, table, , mk]) => `
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM (${digest(`${s}.${table}`)}) d JOIN ${s}.manifest m ON m.table_name='${table}' WHERE d.rows<>m.rows OR d.digest<>m.digest) THEN RAISE EXCEPTION 'Staging checksum mismatch: ${table}'; END IF;
 ${mk ? `IF EXISTS(SELECT 1 FROM retention_refs ref JOIN public.${table} m ON m.sync_run_id=ref.run_id AND m.source_fingerprint=ref.fingerprint
 LEFT JOIN ${s}.${table} staged ON staged.id=m.id WHERE ref.kind='${mk}' AND staged.id IS NULL) THEN RAISE EXCEPTION 'New source references require a fresh staging backup'; END IF;` : ''}
END $$;`).join('\n');
  return `${header(options)}${plan(options)}
DO $$ BEGIN
 IF (SELECT count(*) FROM public.organizations)<>1 THEN RAISE EXCEPTION 'Organization scope changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid IN (${tables}) AND conrelid NOT IN (${tables})) THEN
 RAISE EXCEPTION 'An external foreign key prevents mirror-only compaction'; END IF;
 IF EXISTS(SELECT kind,id FROM retention_copy EXCEPT SELECT kind,id FROM ${s}.full_runs) THEN RAISE EXCEPTION 'Protected run set changed; create a fresh backup'; END IF;
END $$;
${checks}
LOCK TABLE ${TABLES.map(t => `public.${t[1]}`).join(',')} IN ACCESS EXCLUSIVE MODE;
TRUNCATE TABLE ${TABLES.map(t => `public.${t[1]}`).join(',')} RESTRICT;
${TABLES.map(([, table]) => `INSERT INTO public.${table} SELECT * FROM ${s}.${table};
DO $$ BEGIN IF EXISTS(SELECT 1 FROM (${digest(`public.${table}`)}) d JOIN ${s}.manifest m ON m.table_name='${table}'
 WHERE d.rows<>m.rows OR d.digest<>m.digest) THEN RAISE EXCEPTION 'Restored checksum mismatch: ${table}'; END IF; END $$;
ALTER TABLE public.${table} SET(autovacuum_vacuum_scale_factor=0.02,autovacuum_analyze_scale_factor=0.05);`).join('\n')}
${retireRuns(`${s}.candidates`)}
SELECT jsonb_build_object('mode','compacted','stage','${s}','oldBytes',(SELECT sum(original_bytes) FROM ${s}.manifest),
 'newBytes',(SELECT sum(pg_total_relation_size(name::regclass)) FROM unnest(ARRAY[${TABLES.map(t => `'public.${t[1]}'`).join(',')}]) name),
 'checksumsVerified',${TABLES.length}); COMMIT;`;
}
function psql(sql, database) {
  const args = ['exec', '-i', 'albinaa-clean-db', 'sh', '-c', 'exec psql -U "$POSTGRES_USER" -d "${RETENTION_DATABASE:-$POSTGRES_DB}" -X -q -v ON_ERROR_STOP=1 -P pager=off -At'];
  if (database) args.splice(2, 0, '-e', `RETENTION_DATABASE=${database}`);
  const result = spawnSync(process.platform === 'win32' ? 'docker.exe' : 'docker', args, { input: sql, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw Error((result.stderr || result.error?.message || 'PostgreSQL retention failed').trim());
  const rows = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  return rows;
}
function main() {
  const argv = process.argv.slice(2), argument = name => { const i=argv.indexOf(name); return i<0 ? undefined : argv[i+1]; };
  const mode = argv.includes('--compact') ? 'compact' : argv.includes('--stage') ? 'stage' : argv.includes('--apply') ? 'apply' : 'preview';
  const options = { organization: argument('--organization'), keep: Number(argument('--keep') || 10), stage: argv.includes('--staging-schema') ? argument('--staging-schema') : undefined };
  validate(options);
  // Automatic cleanup cannot become the initial hundreds-of-millions-row delete.
  const preview = psql(previewSql(options))[0];
  if (mode === 'apply' && Object.values(preview.candidates || {}).some(n => n > 50)) throw Error('Initial compaction required; refusing an unbounded automatic delete');
  const build = { compact: compactSql, stage: stageSql, apply: cleanupSql, preview: previewSql }[mode];
  const result = mode === 'preview' ? preview : psql(build(options))[0];
  console.log(JSON.stringify(result));
  if (argv.includes('--output')) fs.writeFileSync(path.resolve(argument('--output')), JSON.stringify(result, null, 2), 'utf8');
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { TABLES, RUNS, validate, plan, previewSql, cleanupSql, stageSql, compactSql, retainedSelect, digest, psql };
