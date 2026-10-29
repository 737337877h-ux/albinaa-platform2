'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../src/config');

// Existing movement fingerprints include the CSV text of decimal values.
// Keep the established provider/format; .937 vs 0.937 must not republish history.
// The identity and Oracle read-only transaction are checked in the child too.
function invocation(config, outputRoot, windowsRoot) {
  if (config.user !== 'ALBINAA_RO' || config.defaultSchema !== 'IAS20261') {
    throw new Error('Compatible movement export requires ALBINAA_RO / IAS20261');
  }
  if (!outputRoot || !windowsRoot) throw new Error('Output directory and Windows directory are required');
  return {
    executable: path.join(windowsRoot, 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.resolve(__dirname, '../../integrations/oracle-movements-readonly/Invoke-OracleMovementSnapshot.ps1'),
      '-OutputRoot', path.resolve(outputRoot), '-OracleUser', 'ALBINAA_RO',
      '-OracleAlias', config.connectString, '-JsonResult'],
  };
}

async function exportWithRetry(command, environment, password, dependencies = {}) {
  const run = dependencies.run || spawnSync;
  const now = dependencies.now || Date.now;
  const delay = dependencies.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = dependencies.log || ((message) => process.stderr.write(`${message}\n`));
  const deadline = now() + 420000;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Compatible movement export exceeded its 420-second total budget');
    const result = run(command.executable, command.args, {
      env: environment, encoding: 'utf8', windowsHide: true,
      timeout: remaining, maxBuffer: 4 * 1024 * 1024,
    });
    if (!result.error && result.status === 0) {
      const summary = JSON.parse(result.stdout.trim());
      if (!summary.directory || !summary.counts) throw new Error('Incomplete compatible snapshot result');
      log(`Movement export completed on attempt ${attempt}`);
      return summary;
    }
    const message = String(result.stderr || result.error?.message || 'Compatible movement export failed')
      .split(password).join('[REDACTED]');
    // Retry the entire read-only transaction, never resume a partial CSV.
    // Permission, SQL, identity, serialization and process-timeout errors fail closed.
    const codes = message.match(/ORA-\d{5}/g) || [];
    const transientCodes = new Set(['ORA-03113', 'ORA-03114', 'ORA-03135', 'ORA-12170',
      'ORA-12203', 'ORA-12514', 'ORA-12537', 'ORA-12541', 'ORA-12543', 'ORA-12545', 'ORA-12547', 'ORA-12570', 'ORA-12571']);
    const transient = codes.length ? codes.every((code) => transientCodes.has(code))
      : /COMException/.test(message) && /Unspecified error|0x80004005/i.test(message);
    if (result.error || !transient || attempt === 3) throw new Error(message);
    const backoff = attempt * 2000;
    if (deadline - now() <= backoff) throw new Error(message);
    log(`Transient movement read failure, attempt ${attempt}/3: ${message.trim()}`);
    await delay(backoff);
  }
}

async function main() {
  const config = loadConfig().oracle;
  const command = invocation(config, process.argv[2], process.env.SystemRoot || process.env.WINDIR);
  const environment = { ...process.env, ALBINAA_ORACLE_PASSWORD: config.password };
  for (const key of ['ORACLE_PASSWORD', 'ORACLE_PASSWORD_BASE64', 'ORACLE_READ_API_KEY', 'ORACLE_READ_API_KEYS']) delete environment[key];
  // Let Windows PowerShell discover its own compatible modules, not pwsh 7's.
  delete environment.PSModulePath;
  try {
    const summary = await exportWithRetry(command, environment, config.password);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    delete environment.ALBINAA_ORACLE_PASSWORD;
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { invocation, exportWithRetry };
