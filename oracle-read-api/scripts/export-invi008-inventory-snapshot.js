'use strict';

// Builds the platform inventory snapshot from the SELECT-only INVI008 views
// already granted to ALBINAA_RO. It never connects as YS and never writes to Oracle.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const oracledb = require('oracledb');
const { loadConfig } = require('../src/config');
const { ReadonlySnapshot } = require('./readonly-snapshot');

const outputRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', 'output-invi008'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const text = (value) => value == null ? '' : String(value);
const flag = (value) => Number(value || 0) !== 0 ? '1' : '0';
const decimal = (value) => {
  if (value == null || value === '') return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Oracle decimal: ${value}`);
  const rounded = Math.round((parsed + Number.EPSILON) * 1e12) / 1e12;
  return String(rounded);
};
const date = (value) => {
  if (!value) return '';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
};
const csvField = (value) => `"${text(value).replaceAll('"', '""')}"`;
const csv = (headers, rows) => `${headers.map(csvField).join(',')}\r\n${rows
  .map((row) => headers.map((header) => csvField(row[header])).join(','))
  .join('\r\n')}\r\n`;

async function main() {
  const config = loadConfig();
  if (config.oracle.defaultSchema !== 'IAS20261') throw new Error('INVI008 snapshot is restricted to IAS20261');
  const database = new ReadonlySnapshot(oracledb, config.oracle);
  await database.start();
  try {
    const [detailResult, availabilityResult, stockResult, warehouseResult] = await Promise.all([
      database.select(`SELECT I_CODE,I_NAME,G_CODE,PRIMARY_COST,I_CWTAVG,
 NVL(INACTIVE,0) INACTIVE,NVL(SERVICE_ITM,0) SERVICE_ITM,
 TO_CHAR(UP_DATE,'YYYY-MM-DD HH24:MI:SS') UP_DATE,
 ITM_UNT,P_SIZE,NVL(MAIN_UNIT,0) MAIN_UNIT,NVL(SALE_UNIT,0) SALE_UNIT,
 NVL(PUR_UNIT,0) PUR_UNIT,NVL(STOCK_UNIT,0) STOCK_UNIT,NVL(NO_SALE,0) NO_SALE,
 BARCODE,LVL_UNIT,NVL(USE_SERIALNO,0) USE_SRLNO,INACTIVE_RES
FROM IAS20261.ITEM_DETAILS
ORDER BY I_CODE,LVL_UNIT,P_SIZE,ITM_UNT`),
      database.select(`SELECT I_CODE,ITM_UNT,TO_CHAR(W_CODE) W_CODE,
 MAX(I_PRICE) I_PRICE,MAX(AVL_QTY) AVL_QTY
FROM IAS20261.IAS_V_ITM_AVLQTY
GROUP BY I_CODE,ITM_UNT,W_CODE
ORDER BY W_CODE,I_CODE,ITM_UNT`),
      database.select(`SELECT I_CODE,TO_CHAR(W_CODE) W_CODE,
 SUM(CASE WHEN IN_OUT = 1 THEN NVL(P_QTY,0) + NVL(PF_QTY,0)
          WHEN IN_OUT = -1 THEN -(NVL(P_QTY,0) + NVL(PF_QTY,0))
          ELSE 0 END) PRIMARY_QTY,
 TO_CHAR(MAX(COALESCE(UP_DATE,AD_DATE,I_DATE)),'YYYY-MM-DD HH24:MI:SS') UP_DATE
FROM IAS20261.ITEM_MOVEMENT
WHERE I_CODE IS NOT NULL AND W_CODE IS NOT NULL
GROUP BY I_CODE,W_CODE
HAVING ABS(SUM(CASE WHEN IN_OUT = 1 THEN NVL(P_QTY,0) + NVL(PF_QTY,0)
                    WHEN IN_OUT = -1 THEN -(NVL(P_QTY,0) + NVL(PF_QTY,0))
                    ELSE 0 END)) > 0.000000000001
ORDER BY W_CODE,I_CODE`),
      database.select(`SELECT TO_CHAR(W_CODE) W_CODE,W_NAME,W_E_NAME,LOCATION,TEL_NO,
 NVL(INACTIVE,0) INACTIVE,WH_KEEPER,TO_CHAR(WHG_CODE) WHG_CODE,W_TYPE,
 NVL(NO_SALE,0) NO_SALE,NVL(CHK_AVL_QTY,0) CHK_AVL_QTY,
 TO_CHAR(CONN_BRN_NO) CONN_BRN_NO,TO_CHAR(MAIN_WCODE) MAIN_WCODE,
 LATITUDE,LONGITUDE,TO_CHAR(UP_DATE,'YYYY-MM-DD HH24:MI:SS') UP_DATE
FROM IAS20261.WAREHOUSE_DETAILS
ORDER BY W_CODE`),
    ]);

    const details = detailResult.rows;
    const availability = availabilityResult.rows;
    const stock = stockResult.rows;
    const warehouses = warehouseResult.rows;
    const itemByCode = new Map();
    const unitByKey = new Map();
    const unitsByItem = new Map();
    for (const row of details) {
      const itemCode = text(row.I_CODE);
      if (!itemByCode.has(itemCode)) itemByCode.set(itemCode, row);
      unitByKey.set(`${itemCode}|${text(row.ITM_UNT)}`, row);
      const units = unitsByItem.get(itemCode) ?? [];
      units.push(row);
      unitsByItem.set(itemCode, units);
    }
    const warehouseByCode = new Map(warehouses.map((row) => [text(row.W_CODE), row]));
    const priceByUnit = new Map();
    for (const row of availability) {
      const key = `${text(row.I_CODE)}|${text(row.ITM_UNT)}`;
      if (row.I_PRICE != null && !priceByUnit.has(key)) priceByUnit.set(key, row.I_PRICE);
    }
    const groupUpdatedAt = new Map();
    for (const row of itemByCode.values()) {
      const code = text(row.G_CODE);
      const value = text(row.UP_DATE);
      if (!groupUpdatedAt.has(code) || value > groupUpdatedAt.get(code)) groupUpdatedAt.set(code, value);
    }

    const files = {
      item_groups: {
        file: 'item_groups.csv',
        headers: ['G_CODE', 'G_A_NAME', 'G_E_NAME', 'G_I_CODE', 'UP_DATE'],
        rows: [...groupUpdatedAt].sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }))
          .map(([code, updatedAt]) => ({ G_CODE: code, G_A_NAME: code, G_E_NAME: '', G_I_CODE: '', UP_DATE: updatedAt })),
      },
      items: {
        file: 'items.csv',
        headers: ['I_CODE', 'I_NAME', 'G_CODE', 'PRIMARY_COST', 'I_CWTAVG', 'INACTIVE', 'SERVICE_ITM', 'UP_DATE'],
        rows: [...itemByCode.values()].map((row) => ({
          I_CODE: row.I_CODE, I_NAME: row.I_NAME, G_CODE: row.G_CODE,
          PRIMARY_COST: decimal(row.PRIMARY_COST), I_CWTAVG: decimal(row.I_CWTAVG),
          INACTIVE: flag(row.INACTIVE), SERVICE_ITM: flag(row.SERVICE_ITM), UP_DATE: row.UP_DATE,
        })),
      },
      item_units: {
        file: 'item_units.csv',
        headers: ['I_CODE', 'ITM_UNT', 'P_SIZE', 'MAIN_UNIT', 'SALE_UNIT', 'PUR_UNIT', 'STOCK_UNIT', 'PRICE_UNIT', 'NO_SALE', 'BARCODE', 'LVL_UNIT', 'USE_SRLNO', 'INACTIVE', 'INACTIVE_RES', 'SALE_PRICE', 'UP_DATE'],
        rows: [...unitByKey.values()].map((row) => ({
          I_CODE: row.I_CODE, ITM_UNT: row.ITM_UNT, P_SIZE: decimal(row.P_SIZE),
          MAIN_UNIT: flag(row.MAIN_UNIT), SALE_UNIT: flag(row.SALE_UNIT), PUR_UNIT: flag(row.PUR_UNIT),
          STOCK_UNIT: flag(row.STOCK_UNIT), PRICE_UNIT: flag(row.SALE_UNIT), NO_SALE: flag(row.NO_SALE),
          BARCODE: row.BARCODE, LVL_UNIT: row.LVL_UNIT, USE_SRLNO: flag(row.USE_SRLNO),
          INACTIVE: flag(row.INACTIVE), INACTIVE_RES: row.INACTIVE_RES,
          SALE_PRICE: decimal(priceByUnit.get(`${text(row.I_CODE)}|${text(row.ITM_UNT)}`)), UP_DATE: row.UP_DATE,
        })),
      },
      warehouse_groups: {
        file: 'warehouse_groups.csv',
        headers: ['WHG_CODE', 'WHG_A_NAME', 'WHG_E_NAME', 'UP_DATE'],
        rows: [...new Set(warehouses.map((row) => text(row.WHG_CODE)).filter(Boolean))]
          .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
          .map((code) => ({ WHG_CODE: code, WHG_A_NAME: code, WHG_E_NAME: '', UP_DATE: '' })),
      },
      warehouses: {
        file: 'warehouses.csv',
        headers: ['W_CODE', 'W_NAME', 'W_E_NAME', 'LOCATION', 'TEL_NO', 'INACTIVE', 'WH_KEEPER', 'WHG_CODE', 'W_TYPE', 'NO_SALE', 'CHK_AVL_QTY', 'CONN_BRN_NO', 'MAIN_WCODE', 'LATITUDE', 'LONGITUDE', 'UP_DATE'],
        rows: warehouses,
      },
      stock_balances: {
        file: 'stock_balances.csv',
        headers: ['I_CODE', 'ITM_UNT', 'P_SIZE', 'W_CODE', 'WHG_CODE', 'AVL_QTY', 'PRIMARY_COST', 'I_CWTAVG', 'INACTIVE', 'UP_DATE'],
        rows: stock.map((row) => {
          const itemCode = text(row.I_CODE);
          const units = unitsByItem.get(itemCode) ?? [];
          const unit = [...units].sort((left, right) =>
            Number(right.STOCK_UNIT || 0) - Number(left.STOCK_UNIT || 0)
            || Number(right.MAIN_UNIT || 0) - Number(left.MAIN_UNIT || 0)
            || (Number(left.P_SIZE || 1) === 1 ? -1 : Number(right.P_SIZE || 1) === 1 ? 1 : 0)
            || Number(left.P_SIZE || 1) - Number(right.P_SIZE || 1)
            || text(left.ITM_UNT).localeCompare(text(right.ITM_UNT), 'ar'))[0];
          const item = itemByCode.get(text(row.I_CODE));
          const warehouse = warehouseByCode.get(text(row.W_CODE));
          if (!unit || !item || !warehouse) throw new Error(`Incomplete INVI008 stock relation: ${itemCode}|${text(row.W_CODE)}`);
          const packageSize = Number(unit.P_SIZE || 1);
          if (!Number.isFinite(packageSize) || packageSize <= 0) throw new Error(`Invalid primary unit package size: ${itemCode}|${text(unit.ITM_UNT)}`);
          return {
            I_CODE: row.I_CODE, ITM_UNT: unit.ITM_UNT, P_SIZE: decimal(packageSize),
            W_CODE: row.W_CODE, WHG_CODE: warehouse.WHG_CODE, AVL_QTY: decimal(Number(row.PRIMARY_QTY) / packageSize),
            PRIMARY_COST: decimal(item.PRIMARY_COST), I_CWTAVG: decimal(item.I_CWTAVG),
            INACTIVE: flag(item.INACTIVE), UP_DATE: row.UP_DATE || item.UP_DATE,
          };
        }),
      },
    };
    files.control_totals = {
      file: 'control_totals.csv',
      headers: ['ITEM_GROUPS', 'ITEMS', 'ITEM_UNITS', 'WAREHOUSE_GROUPS', 'WAREHOUSES', 'STOCK_BALANCE_ROWS'],
      rows: [{
        ITEM_GROUPS: files.item_groups.rows.length, ITEMS: files.items.rows.length,
        ITEM_UNITS: files.item_units.rows.length, WAREHOUSE_GROUPS: files.warehouse_groups.rows.length,
        WAREHOUSES: files.warehouses.rows.length, STOCK_BALANCE_ROWS: files.stock_balances.rows.length,
      }],
    };

    const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').slice(0, 15);
    const directory = path.join(outputRoot, `snapshot-invi008-${stamp}`);
    await fs.mkdir(directory, { recursive: true });
    const manifestFiles = [];
    for (const [name, entry] of Object.entries(files)) {
      const body = csv(entry.headers, entry.rows);
      await fs.writeFile(path.join(directory, entry.file), body, 'utf8');
      manifestFiles.push({ name, file: entry.file, rows: entry.rows.length, sha256: sha256(body) });
    }
    const manifest = {
      contractVersion: '2.0',
      mode: 'oracle-inventory-read-only-snapshot',
      generatedAtUtc: new Date().toISOString(),
      source: { alias: 'YEMENSOFT', schema: 'IAS20261', transactionMode: 'READ ONLY' },
      files: manifestFiles,
    };
    await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      mode: 'SELECT_ONLY', oracleWrite: 'NONE', source: 'INVI008', directory,
      counts: Object.fromEntries(Object.entries(files).map(([name, entry]) => [name, entry.rows.length])),
    })}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
