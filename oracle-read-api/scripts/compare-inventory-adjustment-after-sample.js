'use strict';

const fs = require('node:fs');
const path = require('node:path');
const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const { snapshotSchema } = require('./capture-inventory-adjustment-baseline');

function readBaseline(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const baseline = JSON.parse(raw);
  if (baseline.mode !== 'SELECT_ONLY' || baseline.oracleWrite !== 'NONE') {
    throw new Error('The saved file is not a SELECT-only INVT008.230 baseline');
  }
  const schema = baseline.schemas?.find((entry) => entry.schema === 'IAS20191');
  if (!schema?.master?.summary || !schema?.detail?.summary) {
    throw new Error('The IAS20191 baseline is incomplete');
  }
  return { baseline, schema };
}

function numeric(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowIdentity(row) {
  return [row.DOC_SER ?? '', row.DOC_NO ?? '', row.RCRD_NO ?? ''].join(':');
}

function compareTable(before, after) {
  const beforeRows = new Set((before.recentRows ?? []).map(rowIdentity));
  const newRows = (after.recentRows ?? []).filter((row) => !beforeRows.has(rowIdentity(row)));
  return {
    beforeRowCount: numeric(before.summary?.ROW_COUNT),
    afterRowCount: numeric(after.summary?.ROW_COUNT),
    addedRowCount: numeric(after.summary?.ROW_COUNT) - numeric(before.summary?.ROW_COUNT),
    beforeMaxDocSerial: before.summary?.MAX_DOC_SER ?? null,
    afterMaxDocSerial: after.summary?.MAX_DOC_SER ?? null,
    newRows,
  };
}

async function main() {
  const baselinePath = process.env.INVT008_BASELINE_PATH
    || path.join(__dirname, '..', 'tmp', 'invt008-230-baseline.json');
  const { baseline, schema: before } = readBaseline(baselinePath);
  const config = loadConfig();
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const after = await snapshotSchema(db, 'IAS20191');
    if (after.error) throw new Error(after.error);
    const masterComparison = compareTable(before.master, after.master);
    const detailComparison = compareTable(before.detail, after.detail);
    const masterCreated = masterComparison.addedRowCount > 0;
    const detailCreated = detailComparison.addedRowCount > 0;
    const mappingProven = masterCreated && detailCreated;

    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      screen: 'INVT008.230',
      purpose: 'COMPARE_IAS20191_AFTER_YEMENSOFT_SAMPLE',
      baselineCapturedAt: baseline.capturedAt ?? null,
      comparedAt: new Date().toISOString(),
      schema: 'IAS20191',
      masterComparison,
      detailComparison,
      mappingProven,
      nextGate: mappingProven
        ? 'REVIEW_FIELD_SEMANTICS_BEFORE_ANY_POSTING_OR_PLATFORM_IMPLEMENTATION'
        : 'STK_ADJUSTMENT_NOT_PROVEN_FOR_INVT008_230_DISCOVER_ALTERNATE_TABLES',
      cautions: [
        'STK_POST and timestamps remain diagnostic until movement evidence is separately verified.',
        'The IAS20191 YemenSoft sample must remain unposted during this comparison.',
        'IAS20261 was not queried by this comparison and no production data was changed.',
        'No INSERT, UPDATE, DELETE, MERGE, procedure, sequence, commit, or Oracle write was executed.',
      ],
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message, errorNum: error.errorNum ?? null }));
  process.exitCode = 1;
});
