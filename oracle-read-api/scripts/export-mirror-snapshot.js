'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { ReadonlySnapshot } = require('./readonly-snapshot');

async function main() {
  const [kind, outputRoot] = process.argv.slice(2);
  if (kind === 'movements') throw new Error('Movement snapshots must use export-compatible-movement-snapshot.js to preserve existing fingerprints');
  const kinds = { customers: 'Customer', movements: 'Movement' };
  if (!kinds[kind] || !outputRoot) throw new Error('Expected customers|movements and output directory');
  const queryFile = path.resolve(__dirname, '../../integrations', `oracle-${kind}-readonly`, `Get-Oracle${kinds[kind]}Queries.ps1`);
  const source = await fs.readFile(queryFile, 'utf8');
  const queries = [...source.matchAll(/Name\s*=\s*'([^']+)'\s*;\s*FileName\s*=\s*'([^']+)'\s*;\s*Sql\s*=\s*@"\r?\n([\s\S]*?)\r?\n"@/g)];
  if (queries.length !== (kind === 'customers' ? 5 : 3)) throw new Error('Unexpected snapshot query contract');
  const config = loadConfig();
  if (config.oracle.defaultSchema !== 'IAS20261') throw new Error('Snapshot schema must be IAS20261');
  const database = new ReadonlySnapshot(oracledb, config.oracle);
  const directory = path.resolve(outputRoot, `snapshot-${kind}-${Date.now()}`);
  const files = [];
  try {
    await database.start();
    await fs.mkdir(directory, { recursive: true });
    for (const [, name, file, sql] of queries) {
      const result = await database.select(sql);
      const headers = result.metaData.map((column) => column.name);
      const field = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const body = [headers.map(field).join(','), ...result.rows.map((row) => headers.map((key) => field(row[key])).join(','))].join('\r\n') + '\r\n';
      await fs.writeFile(path.join(directory, file), body, 'utf8');
      files.push({ name, file, rows: result.rows.length, sha256: crypto.createHash('sha256').update(body).digest('hex') });
      process.stderr.write(`${name}: ${result.rows.length} rows\n`);
    }
    const manifest = { contractVersion: '1.0', mode: `oracle-${kind}-read-only-snapshot`, generatedAtUtc: new Date().toISOString(), source: { alias: 'YEMENSOFT', schema: 'IAS20261', transactionMode: 'READ ONLY', user: 'ALBINAA_RO' }, files };
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    console.log(JSON.stringify({ directory, counts: Object.fromEntries(files.map((file) => [file.name, file.rows])) }));
  } finally { await database.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
