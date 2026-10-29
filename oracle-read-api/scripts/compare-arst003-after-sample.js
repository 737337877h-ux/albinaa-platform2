'use strict';

const fs = require('node:fs');
const path = require('node:path');
const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');
const {
  approvalRowsQuery,
  rowsBySerialQuery,
} = require('../src/arst003-discovery');
const { snapshot } = require('./capture-arst003-baseline');

const SCHEMA = 'IAS20191';

function readBaseline(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const baseline = JSON.parse(raw);
  if (baseline.mode !== 'SELECT_ONLY' || baseline.oracleWrite !== 'NONE' || baseline.schema !== SCHEMA) {
    throw new Error('The saved file is not a SELECT-only IAS20191 ARST003 baseline');
  }
  if (!baseline.snapshot?.master?.summary || !baseline.snapshot?.detail?.summary) {
    throw new Error('The IAS20191 ARST003 baseline is incomplete');
  }
  return baseline;
}

function numeric(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function masterIdentity(row) {
  return String(row.ORDER_SER ?? '');
}

function detailIdentity(row) {
  return [row.ORDER_SER ?? '', row.RCRD_NO ?? ''].join(':');
}

function compareRows(before, after, identity) {
  const known = new Set(before.map(identity));
  return after.filter((row) => !known.has(identity(row)));
}

function populatedFields(rows) {
  const result = new Set();
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      if (value !== null && value !== '') result.add(field);
    }
  }
  return [...result];
}

async function main() {
  const baselinePath = process.env.ARST003_BASELINE_PATH
    || path.join(__dirname, '..', 'tmp', 'arst003-baseline.json');
  const baseline = readBaseline(baselinePath);
  const config = loadConfig();
  if (config.oracle.defaultSchema !== SCHEMA) {
    throw new Error(`ARST003 comparison is restricted to ${SCHEMA}`);
  }
  oracledb.fetchAsString = [oracledb.NUMBER];
  const db = new OracleReadPool(oracledb, config.oracle);
  await db.start();
  try {
    const after = await snapshot(db);
    const newMasterKeys = compareRows(
      baseline.snapshot.master.recentRows || [],
      after.master.recentRows || [],
      masterIdentity,
    );
    const newDetailKeys = compareRows(
      baseline.snapshot.detail.recentRows || [],
      after.detail.recentRows || [],
      detailIdentity,
    );
    const serials = [...new Set(newMasterKeys.map((row) => row.ORDER_SER).filter((value) => value != null))];
    let fullMasterRows = [];
    let fullDetailRows = [];
    let approvalRows = [];
    if (serials.length) {
      const masterQuery = rowsBySerialQuery(
        SCHEMA, 'SALES_ORDER', after.masterColumns, 'ORDER_SER', serials, ['ORDER_SER'],
      );
      fullMasterRows = (await db.select(masterQuery.sql, masterQuery.binds)).rows;
      const detailQuery = rowsBySerialQuery(
        SCHEMA, 'ORDER_DETAIL', after.detailColumns, 'ORDER_SER', serials, ['ORDER_SER', 'RCRD_NO'],
      );
      fullDetailRows = (await db.select(detailQuery.sql, detailQuery.binds)).rows;
      const approvalQuery = approvalRowsQuery(SCHEMA, fullMasterRows);
      approvalRows = (await db.select(approvalQuery.sql, approvalQuery.binds)).rows;
    }
    const masterAdded = numeric(after.master.summary?.ROW_COUNT)
      - numeric(baseline.snapshot.master.summary?.ROW_COUNT);
    const detailAdded = numeric(after.detail.summary?.ROW_COUNT)
      - numeric(baseline.snapshot.detail.summary?.ROW_COUNT);
    const sampleDetected = masterAdded > 0 && detailAdded > 0 && serials.length > 0;

    console.log(JSON.stringify({
      success: true,
      mode: 'SELECT_ONLY',
      oracleWrite: 'NONE',
      schema: SCHEMA,
      screen: 'ARST003',
      purpose: 'COMPARE_AFTER_ONE_YEMENSOFT_CUSTOMER_REQUEST_SAMPLE',
      baselineCapturedAt: baseline.capturedAt ?? null,
      comparedAt: new Date().toISOString(),
      comparison: {
        beforeMasterCount: numeric(baseline.snapshot.master.summary?.ROW_COUNT),
        afterMasterCount: numeric(after.master.summary?.ROW_COUNT),
        masterAdded,
        beforeDetailCount: numeric(baseline.snapshot.detail.summary?.ROW_COUNT),
        afterDetailCount: numeric(after.detail.summary?.ROW_COUNT),
        detailAdded,
        beforeMaxOrderSerial: baseline.snapshot.master.summary?.MAX_ORDER_SER ?? null,
        afterMaxOrderSerial: after.master.summary?.MAX_ORDER_SER ?? null,
        detectedSerials: serials,
        newMasterKeys,
        newDetailKeys,
      },
      evidence: {
        masterRows: fullMasterRows,
        detailRows: fullDetailRows,
        approvalRows,
        populatedMasterFields: populatedFields(fullMasterRows),
        populatedDetailFields: populatedFields(fullDetailRows),
      },
      mappingStatus: {
        sampleDetected,
        masterDetailRowsProven: sampleDetected && fullMasterRows.length > 0 && fullDetailRows.length > 0,
        requiredAndPopulatedFieldsCaptured: sampleDetected,
        approvalLinkCaptured: approvalRows.length > 0,
        sequenceValuePatternObserved: sampleDetected,
        sequenceGenerationMechanismProven: false,
        defaultOriginProven: false,
      },
      nextGate: sampleDetected
        ? 'REVIEW_FIELD_VALUES_THEN_INSPECT_YEMENSOFT_INSERT_BINDS_AND_SEQUENCE_CONTROL_METADATA'
        : 'CREATE_EXACTLY_ONE_UNAPPROVED_IAS20191_ARST003_SAMPLE_THEN_REPEAT_COMPARISON',
      cautions: [
        'A changed maximum serial proves only the observed value pattern, not the sequence generation mechanism.',
        'A populated field does not by itself prove whether YemenSoft supplied a default or the operator entered it.',
        'IAS20261 was not queried.',
        'No sequence value was read or allocated.',
        'No INSERT, UPDATE, DELETE, MERGE, procedure, commit, or Oracle write was executed.',
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
