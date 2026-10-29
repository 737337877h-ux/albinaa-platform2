'use strict';

// Exports the item-movement history needed by the INVI008 information screen.
// The Oracle connection is restricted to ALBINAA_RO and every statement is SELECT-only.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { OracleReadPool } = require('../src/oracle');

const outputRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', 'output-invi008-movements'));
const historyMonths = Number(process.env.INVI008_MOVEMENT_MONTHS || 36);
if (!Number.isInteger(historyMonths) || historyMonths < 3 || historyMonths > 120) {
  throw new Error('INVI008_MOVEMENT_MONTHS must be an integer between 3 and 120');
}

const CUSTOMER_COLUMNS = ['C_CODE','A_CY','DOC_DATE','DOC_TYPE','DOC_JV_TYPE','DOC_NO','DOC_SER','RCRD_NO','REF_NO','DOC_DESC','DR_AMT','CR_AMT','DR_AMTF','CR_AMTF','AD_DATE','UP_DATE'];
const INVENTORY_COLUMNS = ['DOC_TYPE','BILL_DOC_TYPE','DOC_NO','I_CODE','I_QTY','FREE_QTY','ITM_UNT','P_SIZE','P_QTY','PF_QTY','I_DATE','I_COST','W_CODE','WHG_CODE','STK_COST','A_CY','C_CODE','V_CODE','A_DESC','RCRD_NO','SERIAL','REF_NO','DOC_SER','DOC_SEQUENCE','BARCODE','IN_OUT','AD_DATE','UP_DATE','CMP_NO','BRN_NO','BRN_YEAR'];
const CONTROL_COLUMNS = ['CUSTOMER_MOVEMENTS','CUSTOMER_MISSING_RCRD_NO','CUSTOMER_MISSING_UP_DATE','INVENTORY_MOVEMENTS','INVENTORY_MISSING_RCRD_NO','INVENTORY_MISSING_UP_DATE'];

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const text = (value) => value == null ? '' : String(value);
const decimal = (value) => {
  if (value == null || value === '') return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Oracle decimal: ${value}`);
  const rounded = Math.round((parsed + Number.EPSILON) * 1_000_000_000_000) / 1_000_000_000_000;
  return String(rounded);
};
const csvField = (value) => `"${text(value).replaceAll('"', '""')}"`;
const csv = (headers, rows) => `${headers.map(csvField).join(',')}\r\n${rows
  .map((row) => headers.map((header) => csvField(row[header])).join(','))
  .join('\r\n')}${rows.length ? '\r\n' : ''}`;
const isoDate = (date) => date.toISOString().slice(0, 10);

function addMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function movementRow(row) {
  return {
    DOC_TYPE: text(row.DOC_TYPE), BILL_DOC_TYPE: text(row.BILL_DOC_TYPE), DOC_NO: text(row.DOC_NO),
    I_CODE: text(row.I_CODE), I_QTY: decimal(row.I_QTY), FREE_QTY: decimal(row.FREE_QTY),
    ITM_UNT: text(row.ITM_UNT), P_SIZE: decimal(row.P_SIZE), P_QTY: decimal(row.P_QTY),
    PF_QTY: decimal(row.PF_QTY), I_DATE: text(row.I_DATE), I_COST: decimal(row.I_COST),
    W_CODE: text(row.W_CODE), WHG_CODE: text(row.WHG_CODE), STK_COST: decimal(row.STK_COST),
    A_CY: text(row.A_CY), C_CODE: text(row.C_CODE), V_CODE: text(row.V_CODE), A_DESC: text(row.A_DESC),
    RCRD_NO: text(row.RCRD_NO), SERIAL: text(row.SERIAL), REF_NO: text(row.REF_NO),
    DOC_SER: text(row.DOC_SER), DOC_SEQUENCE: text(row.DOC_SEQUENCE), BARCODE: text(row.BARCODE),
    IN_OUT: text(row.IN_OUT), AD_DATE: text(row.AD_DATE), UP_DATE: text(row.UP_DATE),
    CMP_NO: text(row.CMP_NO), BRN_NO: text(row.BRN_NO), BRN_YEAR: text(row.BRN_YEAR),
  };
}

async function main() {
  const config = loadConfig();
  if (config.oracle.defaultSchema !== 'IAS20261') throw new Error('INVI008 movement snapshot is restricted to IAS20261');
  const database = new OracleReadPool(oracledb, config.oracle);
  await database.start();
  try {
    const currentMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const from = addMonths(currentMonth, -historyMonths);
    const until = addMonths(currentMonth, 1);
    const rows = [];
    let missingRecordNumber = 0;
    let missingUpdateDate = 0;
    for (let cursor = from; cursor < until; cursor = addMonths(cursor, 1)) {
      const next = addMonths(cursor, 1);
      const result = await database.select(`SELECT
 TO_CHAR(DOC_TYPE) DOC_TYPE,TO_CHAR(BILL_DOC_TYPE) BILL_DOC_TYPE,
 NVL(TO_CHAR(DOC_NO),'0') DOC_NO,I_CODE,NVL(I_QTY,0) I_QTY,
 NVL(FREE_QTY,0) FREE_QTY,ITM_UNT,NVL(P_SIZE,1) P_SIZE,NVL(P_QTY,0) P_QTY,
 NVL(PF_QTY,0) PF_QTY,TO_CHAR(I_DATE,'YYYY-MM-DD') I_DATE,
 I_COST,TO_CHAR(W_CODE) W_CODE,TO_CHAR(WHG_CODE) WHG_CODE,STK_COST,A_CY,
 TO_CHAR(C_CODE) C_CODE,TO_CHAR(V_CODE) V_CODE,A_DESC,TO_CHAR(RCRD_NO) RCRD_NO,
 NVL(TO_CHAR(SERIAL),'0') SERIAL,TO_CHAR(REF_NO) REF_NO,
 NVL(TO_CHAR(DOC_SER),'0') DOC_SER,NVL(TO_CHAR(DOC_SEQUENCE),'0') DOC_SEQUENCE,
 BARCODE,TO_CHAR(IN_OUT) IN_OUT,
 TO_CHAR(AD_DATE,'YYYY-MM-DD HH24:MI:SS') AD_DATE,
 TO_CHAR(UP_DATE,'YYYY-MM-DD HH24:MI:SS') UP_DATE,
 TO_CHAR(CMP_NO) CMP_NO,TO_CHAR(BRN_NO) BRN_NO,TO_CHAR(BRN_YEAR) BRN_YEAR
FROM IAS20261.ITEM_MOVEMENT
WHERE I_DATE >= TO_DATE(:fromDate,'YYYY-MM-DD')
  AND I_DATE < TO_DATE(:untilDate,'YYYY-MM-DD')
ORDER BY I_DATE,DOC_TYPE,DOC_SER,DOC_NO,DOC_SEQUENCE,SERIAL,RCRD_NO,
 I_CODE,W_CODE,ITM_UNT,P_SIZE`, { fromDate: isoDate(cursor), untilDate: isoDate(next) });
      for (const row of result.rows) {
        if (row.RCRD_NO == null) missingRecordNumber += 1;
        if (row.UP_DATE == null) missingUpdateDate += 1;
        rows.push(movementRow(row));
      }
      process.stderr.write(`INVI008 movement ${isoDate(cursor)}: ${result.rows.length} rows\n`);
    }

    const files = {
      customer_movements: { file: 'customer_movements.csv', headers: CUSTOMER_COLUMNS, rows: [] },
      inventory_movements: { file: 'inventory_movements.csv', headers: INVENTORY_COLUMNS, rows },
      control_totals: {
        file: 'control_totals.csv', headers: CONTROL_COLUMNS, rows: [{
          CUSTOMER_MOVEMENTS: 0, CUSTOMER_MISSING_RCRD_NO: 0, CUSTOMER_MISSING_UP_DATE: 0,
          INVENTORY_MOVEMENTS: rows.length, INVENTORY_MISSING_RCRD_NO: missingRecordNumber,
          INVENTORY_MISSING_UP_DATE: missingUpdateDate,
        }],
      },
    };
    const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').slice(0, 15);
    const directory = path.join(outputRoot, `snapshot-invi008-movements-${stamp}`);
    await fs.mkdir(directory, { recursive: true });
    const manifestFiles = [];
    for (const [name, entry] of Object.entries(files)) {
      const body = csv(entry.headers, entry.rows);
      await fs.writeFile(path.join(directory, entry.file), body, 'utf8');
      manifestFiles.push({ name, file: entry.file, rows: entry.rows.length, sha256: sha256(body) });
    }
    const manifest = {
      contractVersion: '1.0', mode: 'oracle-movements-read-only-snapshot', generatedAtUtc: new Date().toISOString(),
      source: {
        alias: 'YEMENSOFT', schema: 'IAS20261', transactionMode: 'READ ONLY', screen: 'INVI008',
        filter: { field: 'ITEM_MOVEMENT.I_DATE', from: isoDate(from), untilExclusive: isoDate(until), months: historyMonths },
      },
      files: manifestFiles,
    };
    await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      mode: 'SELECT_ONLY', oracleWrite: 'NONE', source: 'INVI008/ITEM_MOVEMENT', directory,
      period: manifest.source.filter, counts: { customer_movements: 0, inventory_movements: rows.length },
      missingRecordNumber, missingUpdateDate,
    })}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
