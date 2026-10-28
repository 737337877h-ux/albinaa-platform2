'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { invocation, exportWithRetry } = require('../scripts/export-compatible-movement-snapshot');

test('uses the existing decimal serializer with explicit read-only identity', () => {
  const config = { user: 'ALBINAA_RO', defaultSchema: 'IAS20261', password: 'not-on-command-line', connectString: '(DESCRIPTION=test)' };
  const result = invocation(config, 'test-snapshots', 'C:/Windows');
  assert.match(result.executable.replaceAll('\\', '/'), /SysWOW64\/WindowsPowerShell/);
  assert.ok(result.args.includes('ALBINAA_RO'));
  assert.ok(result.args.includes('-JsonResult'));
  assert.ok(result.args.includes(config.connectString));
  assert.ok(!JSON.stringify(result).includes(config.password));
});

test('rejects legacy admin accounts, other schemas, and missing paths', () => {
  for (const config of [{user:'YS',defaultSchema:'IAS20261'}, {user:'ALBINAA_RO',defaultSchema:'IAS20191'}]) {
    assert.throws(() => invocation(config, 'output', 'C:/Windows'), /ALBINAA_RO/);
  }
  assert.throws(() => invocation({user:'ALBINAA_RO',defaultSchema:'IAS20261'}, '', ''), /directory/);
});

test('the generic exporter refuses movement fingerprints before any connection', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/export-mirror-snapshot.js'), 'movements', 'unused-output'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use export-compatible-movement-snapshot/);
});

test('retries a failed read transaction and returns only the complete successful snapshot', async () => {
  let calls = 0, clock = 0;
  const logs = [], timeouts = [];
  const summary = await exportWithRetry({ executable: 'test', args: [] }, {}, 'secret', {
    now: () => clock, delay: async (ms) => { clock += ms; }, log: (s) => logs.push(s),
    run: (_exe, _args, options) => {
      timeouts.push(options.timeout); clock += 30000;
      return ++calls === 1
        ? { status: 1, stderr: 'stage=fetch:inventory_movements:rows=2048 COMException Unspecified error secret' }
        : { status: 0, stdout: JSON.stringify({ directory: 'complete', counts: { inventory_movements: 71016 } }) };
    },
  });
  assert.equal(calls, 2);
  assert.equal(summary.directory, 'complete');
  assert.deepEqual(timeouts, [420000, 388000]);
  assert.ok(logs.join('\n').includes('[REDACTED]'));
  assert.ok(!logs.join('\n').includes('secret'));
});

test('stops at three transient failures without returning partial output', async () => {
  let calls = 0;
  await assert.rejects(exportWithRetry({ executable: 'test', args: [] }, {}, 'secret', {
    delay: async () => {}, log: () => {},
    run: () => { calls++; return { status: 1, stderr: 'ORA-12203: unable to connect', stdout: '{"directory":"partial"}' }; },
  }), /ORA-12203/);
  assert.equal(calls, 3);
});

test('fails closed for permissions, SQL, identity, and process timeout errors', async () => {
  for (const failure of [
    { status: 1, stderr: 'COMException ORA-01031: insufficient privileges Unspecified error' },
    { status: 1, stderr: 'ORA-00904: invalid identifier' },
    { status: 1, stderr: 'Unexpected Oracle snapshot session' },
    { status: null, error: { code: 'ETIMEDOUT', message: 'timeout' }, stderr: 'COMException Unspecified error' },
  ]) {
    let calls = 0;
    await assert.rejects(exportWithRetry({ executable: 'test', args: [] }, {}, 'secret', {
      log: () => {}, run: () => { calls++; return failure; },
    }));
    assert.equal(calls, 1);
  }
});

test('does not retry malformed successful output or extend the total deadline', async () => {
  let calls = 0, clock = 0;
  await assert.rejects(exportWithRetry({ executable: 'test', args: [] }, {}, 'secret', {
    now: () => clock, log: () => {},
    run: () => { calls++; clock = 420000; return { status: 1, stderr: 'ORA-03113: connection lost' }; },
  }), /ORA-03113/);
  assert.equal(calls, 1);
  await assert.rejects(exportWithRetry({ executable: 'test', args: [] }, {}, 'secret', {
    run: () => ({ status: 0, stdout: '{"directory":"partial"}' }),
  }), /Incomplete/);
});
