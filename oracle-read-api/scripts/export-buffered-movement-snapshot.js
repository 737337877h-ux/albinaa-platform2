'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config');
const types = require('./legacy-movement-types.json');

async function main() {
  const config = process.env.ALBINAA_ORACLE_EXPORT_CONFIG
    ? JSON.parse(process.env.ALBINAA_ORACLE_EXPORT_CONFIG) : loadConfig().oracle;
  if (config.user !== 'ALBINAA_RO' || config.defaultSchema !== 'IAS20261') throw new Error('Only ALBINAA_RO / IAS20261 is allowed');
  const driver = require('oracledb');
  driver.initOracleClient({ libDir: config.clientLibDir });
  const connection = await driver.getConnection({ user: config.user, password: config.password, connectString: config.connectString });
  const directory = path.resolve(process.argv[2], `snapshot-${new Date().toISOString().replace(/[-:.]/g,'')}-${crypto.randomBytes(4).toString('hex')}`);
  const source = fs.readFileSync(path.resolve(__dirname, '../../integrations/oracle-movements-readonly/Get-OracleMovementQueries.ps1'), 'utf8');
  const queries = [...source.matchAll(/Name = '([^']+)'; FileName = '([^']+)'; Sql = @"\r?\n([\s\S]*?)\r?\n"@/g)];
  if (queries.length !== 3) throw new Error('Unexpected movement query catalog');
  fs.mkdirSync(directory, { recursive: true });
  const files = [], counts = {};
  try {
    connection.callTimeout = 120000;
    await connection.execute('SET TRANSACTION READ ONLY');
    const identity = await connection.execute("SELECT SYS_CONTEXT('USERENV','SESSION_USER') FROM DUAL");
    if (identity.rows[0][0] !== 'ALBINAA_RO') throw new Error('Unexpected Oracle snapshot session');
    for (const [,name,file,sql] of queries) {
      if (!/^SELECT\s/i.test(sql) || /;|\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|GRANT)\b/i.test(sql)) throw new Error('Only SELECT is allowed');
      const result = await connection.execute(sql, {}, {
        outFormat: driver.OUT_FORMAT_ARRAY, fetchArraySize: 5000, prefetchRows: 5000,
        fetchTypeHandler: meta => meta.dbType === driver.DB_TYPE_NUMBER ? { type: driver.STRING } : undefined,
      });
      const columns = result.metaData.map(c => c.name);
      if (columns.join('|') !== Object.keys(types[name] || {}).join('|')) throw new Error('Legacy column contract changed');
      const input = path.join(directory, `${name}.json`), output = path.join(directory,file);
      fs.writeFileSync(input, JSON.stringify({ columns, types: columns.map(c=>types[name][c]), rows: result.rows }));
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/PASSWORD|API_KEY/.test(key)) delete env[key];
      delete env.ALBINAA_ORACLE_EXPORT_CONFIG;
      delete env.PSModulePath;
      const formatted = spawnSync(path.join(process.env.SystemRoot || 'C:/Windows', 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile','-NonInteractive','-File',path.join(__dirname,'format-compatible-movement-json.ps1'),'-InputFile',input,'-OutputFile',output],
        { env, windowsHide:true, encoding:'utf8', timeout:120000 });
      if (formatted.error || formatted.status !== 0) throw new Error(`Legacy formatting failed: ${formatted.stderr || formatted.error?.message}`);
      fs.unlinkSync(input);
      counts[name] = result.rows.length;
      files.push({ name, file, rows: result.rows.length, sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex') });
      process.stderr.write(`movement-export query=${name} rows=${result.rows.length}\n`);
    }
    const manifest = { contractVersion:'1.0', mode:'oracle-movements-read-only-snapshot', generatedAtUtc:new Date().toISOString(),
      source:{ alias:'YEMENSOFT',schema:'IAS20261',transactionMode:'READ ONLY',user:'ALBINAA_RO',numberFormat:'MSDAORA-InvariantCulture',transport:'buffered-OCI' }, files };
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
    process.stdout.write(JSON.stringify({directory,counts})+'\n');
  } finally { await connection.rollback(); await connection.close(); }
}
if (require.main === module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports = { main };
