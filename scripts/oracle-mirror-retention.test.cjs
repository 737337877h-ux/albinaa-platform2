'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {TABLES,RUNS,psql,previewSql,stageSql,compactSql,cleanupSql,validate,digest}=require('./oracle-mirror-retention.cjs');
const db='albinaa_retention_test_20261022',org='00000000-0000-0000-0000-000000000001';
const options={organization:org,keep:10,stage:'mirror_retention_20261022_test'};
const id=(kind,n)=>`md5('${kind}-${n}')::uuid`;
function docker(args){const r=spawnSync('docker.exe',['exec','albinaa-clean-db',...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout;}
function query(sql){return psql(sql,db);}
test('retention SQL against isolated PostgreSQL: source references, atomic compaction, constraints and bounded cleanup',()=>{
 let created=false;
 try{
  docker(['createdb','-U','albinaa',db]);created=true;
  const setup=`CREATE TABLE organizations(id uuid PRIMARY KEY);INSERT INTO organizations VALUES('${org}');
CREATE TABLE system_settings(organization_id uuid,key text,value jsonb);
CREATE TABLE oracle_inventory_active_snapshots(organization_id uuid,source_schema text,active_run_id uuid,previous_run_id uuid);
CREATE TABLE oracle_mirror_heartbeats(organization_id uuid,source_schema text,mirror_kind text,last_sync_run_id uuid);
CREATE TABLE oracle_movement_publication_ledger(organization_id uuid,source_schema text,movement_kind text,source_run_id uuid,source_fingerprint text);
CREATE TABLE published_inventory_movements(organization_id uuid,source_schema text,source_run_id uuid,source_fingerprint text);
CREATE TABLE collections(id int PRIMARY KEY,amount numeric);INSERT INTO collections VALUES(1,100.25);
${Object.entries(RUNS).map(([kind,table])=>`CREATE TABLE ${table}(id uuid PRIMARY KEY,organization_id uuid,source_schema text,status varchar(20),started_at timestamptz,validation_summary jsonb);
INSERT INTO ${table} SELECT md5('${kind}-'||g)::uuid,'${org}','IAS20261',CASE WHEN g>20 THEN 'extracting' ELSE 'published' END,
CASE WHEN g=21 THEN CURRENT_TIMESTAMP-interval '30 minutes' ELSE CURRENT_TIMESTAMP-((40-g)||' days')::interval END,'{}' FROM generate_series(1,22) g;
INSERT INTO ${table} VALUES(${id(kind,99)},'${org}','OTHER_SCHEMA','published',CURRENT_TIMESTAMP-interval '50 days','{}');`).join('\n')}
${TABLES.map(([kind,table])=>`CREATE TABLE ${table}(id uuid PRIMARY KEY,sync_run_id uuid REFERENCES ${RUNS[kind]}(id),organization_id uuid,
source_fingerprint text,payload text,UNIQUE(sync_run_id,source_fingerprint));
INSERT INTO ${table} SELECT md5('${table}-'||g||'-'||x)::uuid,md5('${kind}-'||g)::uuid,'${org}','fp'||g||'-'||x,'source exact text '||g||'-'||x FROM generate_series(1,22) g CROSS JOIN generate_series(1,2) x;
INSERT INTO ${table} VALUES(md5('${table}-outside')::uuid,${id(kind,99)},'${org}','outside','must survive');`).join('\n')}
INSERT INTO system_settings VALUES('${org}','oracleMovementAutoPublish',jsonb_build_object('baselineRunId',${id('movements',1)}));
INSERT INTO oracle_inventory_active_snapshots VALUES('${org}','IAS20261',${id('inventory',2)},${id('inventory',3)});
INSERT INTO oracle_mirror_heartbeats VALUES('${org}','IAS20261','customers',${id('customers',4)});
INSERT INTO oracle_movement_publication_ledger VALUES('${org}','IAS20261','inventory',${id('movements',3)},'fp3-1');
INSERT INTO oracle_movement_publication_ledger VALUES('${org}','IAS20261','customer',${id('movements',3)},'fp3-1');
INSERT INTO published_inventory_movements VALUES('${org}','IAS20261',${id('movements',4)},'fp4-1');`;
  query(setup);
  query(`ALTER TABLE oracle_inventory_sync_runs ADD CONSTRAINT ck_oracle_sync_run_status CHECK(status IN ('extracting','validating','published','rejected','failed'));
ALTER TABLE oracle_movement_sync_runs ADD CONSTRAINT ck_oracle_movement_run_status CHECK(status IN ('extracting','validating','validated','published','rejected','failed'));`);
  query(fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261022030000_oracle_mirror_retention_status/migration.sql'),'utf8'));
  const preview=query(previewSql(options))[0];assert.ok(preview.candidates.movements>0);
  const staged=query(stageSql(options))[0];assert.equal(staged.manifest.length,11);
  query(`UPDATE ${options.stage}.oracle_inventory_movements_mirror SET payload='corrupted' WHERE source_fingerprint='fp3-1';`);
  assert.throws(()=>query(compactSql(options)),/checksum mismatch/);
  assert.equal(query("SELECT json_build_object('n',count(*)) FROM oracle_inventory_movements_mirror")[0].n,45);
  query(`UPDATE ${options.stage}.oracle_inventory_movements_mirror s SET payload=m.payload FROM public.oracle_inventory_movements_mirror m WHERE m.id=s.id;`);
  query(`CREATE TABLE unexpected_ref(id uuid REFERENCES oracle_inventory_movements_mirror(id));`);
  assert.throws(()=>query(compactSql(options)),/external foreign key/);query('DROP TABLE unexpected_ref;');
  query(`UPDATE oracle_inventory_active_snapshots SET active_run_id=${id('inventory',5)};`);
  assert.throws(()=>query(compactSql(options)),/Protected run set changed/);
  query(`UPDATE oracle_inventory_active_snapshots SET active_run_id=${id('inventory',2)};`);
  query(`INSERT INTO oracle_movement_publication_ledger VALUES('${org}','IAS20261','inventory',${id('movements',6)},'fp6-1');`);
  assert.throws(()=>query(compactSql(options)),/New source references/);
  query(`DELETE FROM oracle_movement_publication_ledger WHERE source_run_id=${id('movements',6)};`);
  const result=query(compactSql(options))[0];assert.equal(result.checksumsVerified,11);
  for(const[,table]of TABLES){
   const source=query(`SELECT row_to_json(d) FROM (${digest(`public.${table}`)}) d`)[0];
   const copy=staged.manifest.find(m=>m.table_name===table);assert.equal(source.digest,copy.digest);assert.equal(source.rows,copy.rows);
  }
  assert.equal(query(`SELECT json_build_object('n',count(*)) FROM oracle_inventory_movements_mirror WHERE sync_run_id=${id('movements',3)}`)[0].n,1);
  assert.equal(query("SELECT json_build_object('amount',amount) FROM collections")[0].amount,100.25);
  assert.equal(query(`SELECT json_build_object('n',count(*)) FROM oracle_inventory_movements_mirror WHERE source_fingerprint='outside'`)[0].n,1);
  assert.equal(query(cleanupSql(options))[0].removedRows,0);
  query(`INSERT INTO oracle_movement_sync_runs VALUES(${id('movements',23)},'${org}','IAS20261','published',CURRENT_TIMESTAMP-interval '1 day','{}');
INSERT INTO oracle_inventory_movements_mirror VALUES(md5('new-source')::uuid,${id('movements',23)},'${org}','fp-new','new full source');`);
  assert.ok(query(cleanupSql(options))[0].removedRows>0);
  assert.equal(query(`SELECT json_build_object('n',count(*)) FROM oracle_inventory_movements_mirror WHERE source_fingerprint='fp3-1'`)[0].n,1);
 }finally{if(created)docker(['dropdb','-U','albinaa',db]);}
});
test('rejects malformed or unsafe configuration',()=>{
 for(const bad of [{...options,organization:"x';DROP TABLE customers;--"},{...options,stage:'public'},{...options,keep:0}])assert.throws(()=>validate(bad));
 assert.ok(!cleanupSql(options).includes('DELETE FROM public.collections'));
 assert.ok(!compactSql(options).includes('CASCADE;'));
});
