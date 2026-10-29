import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

type CsvRow = Record<string, string>;
interface Manifest {
  contractVersion: string; mode: string; generatedAtUtc: string;
  source: { schema: string; transactionMode: string };
  files: Array<{ name: string; file: string; rows: number; sha256: string }>;
}

const CUSTOMER_COLUMNS = ['C_CODE','A_CY','DOC_DATE','DOC_TYPE','DOC_JV_TYPE','DOC_NO','DOC_SER','RCRD_NO','REF_NO','DOC_DESC','DR_AMT','CR_AMT','DR_AMTF','CR_AMTF','AD_DATE','UP_DATE'];
const INVENTORY_COLUMNS = ['DOC_TYPE','BILL_DOC_TYPE','DOC_NO','I_CODE','I_QTY','FREE_QTY','ITM_UNT','P_SIZE','P_QTY','PF_QTY','I_DATE','I_COST','W_CODE','WHG_CODE','STK_COST','A_CY','C_CODE','V_CODE','A_DESC','RCRD_NO','SERIAL','REF_NO','DOC_SER','DOC_SEQUENCE','BARCODE','IN_OUT','AD_DATE','UP_DATE','CMP_NO','BRN_NO','BRN_YEAR'];

export interface CustomerMovementRow {
  collectorNo: string | null;
  sourceFingerprint: string; sourceHash: string; duplicateOrdinal: number;
  externalCustomerCode: string; currencyCode: string; documentDate: Date;
  documentType: string; documentJvType: string | null; documentNumber: string | null;
  documentSerial: string | null; recordNumber: string | null; referenceNumber: string | null;
  description: string | null; debitLocal: string; creditLocal: string;
  debitForeign: string; creditForeign: string; sourceCreatedAt: Date | null; sourceUpdatedAt: Date | null;
}
export interface InventoryMovementRow {
  sourceFingerprint: string; sourceHash: string; duplicateOrdinal: number;
  documentType: string; billDocumentType: string | null; documentNumber: string;
  documentSerial: string; recordNumber: string | null; documentSequence: string; serialNumber: string;
  movementDate: Date; externalItemCode: string; unitName: string; packageSize: string;
  itemQuantity: string; freeQuantity: string; primaryQuantity: string; primaryFreeQuantity: string;
  inOut: number; externalWarehouseCode: string; externalWarehouseGroupCode: string | null;
  itemCost: string | null; stockCost: string | null; currencyCode: string | null;
  externalCustomerCode: string | null; externalVendorCode: string | null; description: string | null;
  referenceNumber: string | null; barcode: string | null; companyNumber: string | null;
  branchNumber: string | null; branchYear: string | null; sourceCreatedAt: Date | null; sourceUpdatedAt: Date | null;
}
export interface OracleMovementSnapshot {
  sourceSchema: string; generatedAt: Date; manifestHash: string; sourceCounts: Record<string, number>;
  validationSummary: Record<string, unknown>; customerMovements: CustomerMovementRow[]; inventoryMovements: InventoryMovementRow[];
}

function sha256(value: Buffer | string) { return createHash('sha256').update(value).digest('hex'); }
function optional(row: CsvRow, key: string) { const value = row[key]?.trim(); return value ? value : null; }
function required(row: CsvRow, key: string, context: string) { const value = optional(row, key); if (!value) throw new Error(`${context}: ${key} is blank`); return value; }
function decimal(row: CsvRow, key: string, context: string, nullable = false) {
  const value = optional(row, key); if (value === null && nullable) return null;
  if (value === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error(`${context}: ${key} is not decimal`);
  return value;
}
function integer(row: CsvRow, key: string, context: string) { const value = required(row, key, context); if (!/^-?\d+$/.test(value)) throw new Error(`${context}: ${key} is not integer`); return Number(value); }
function date(row: CsvRow, key: string, context: string, nullable = false) {
  const value = optional(row, key); if (value === null && nullable) return null;
  if (value === null || !/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/.test(value)) throw new Error(`${context}: ${key} is not an Oracle date`);
  const parsed = new Date(value.includes(' ') ? `${value.replace(' ', 'T')}Z` : `${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${context}: ${key} is invalid`);
  return parsed;
}

function parseCsv(content: string, fileName: string): { headers: string[]; rows: CsvRow[] } {
  const matrix: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') { if (quoted && content[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && content[index + 1] === '\n') index += 1; row.push(field); if (row.some(Boolean)) matrix.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error(`${fileName}: unterminated CSV quote`);
  if (field || row.length) { row.push(field); if (row.some(Boolean)) matrix.push(row); }
  if (!matrix.length) throw new Error(`${fileName}: empty CSV`);
  const headers = matrix[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '').trim() : value.trim());
  const rows = matrix.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new Error(`${fileName}: row ${index + 2} has invalid column count`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
  return { headers, rows };
}

function assertColumns(actual: string[], expected: string[], file: string) {
  if (actual.join('|') !== expected.join('|')) throw new Error(`${file}: column contract differs from the approved SELECT`);
}
function fingerprintRows(rows: CsvRow[], headers: string[]) {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const sourceHash = sha256(headers.map((header) => `${header}=${row[header] ?? ''}`).join('\u001f'));
    const duplicateOrdinal = (occurrences.get(sourceHash) ?? 0) + 1;
    occurrences.set(sourceHash, duplicateOrdinal);
    return { row, sourceHash, duplicateOrdinal, sourceFingerprint: sha256(`${sourceHash}|${duplicateOrdinal}`) };
  });
}

export function fingerprintCustomerMovements(rows: CsvRow[]) {
  return fingerprintRows(rows, CUSTOMER_COLUMNS);
}

@Injectable()
export class OracleMovementSnapshotService {
  async inspect(snapshotDirectory: string): Promise<OracleMovementSnapshot> {
    const root = path.resolve(snapshotDirectory);
    const manifestBuffer = await fs.readFile(path.join(root, 'manifest.json'));
    const manifest = JSON.parse(manifestBuffer.toString('utf8')) as Manifest;
    if (manifest.mode !== 'oracle-movements-read-only-snapshot' || manifest.source.transactionMode !== 'READ ONLY') throw new Error('Movement manifest is not an approved read-only snapshot.');
    const file = async (name: string) => {
      const entry = manifest.files.find((item) => item.name === name); if (!entry) throw new Error(`manifest missing ${name}`);
      const buffer = await fs.readFile(path.join(root, entry.file)); if (sha256(buffer) !== entry.sha256) throw new Error(`${entry.file}: SHA-256 mismatch`);
      const parsed = parseCsv(buffer.toString('utf8'), entry.file); if (parsed.rows.length !== entry.rows) throw new Error(`${entry.file}: row count mismatch`);
      return parsed;
    };
    const [customerFile, inventoryFile, controlFile] = await Promise.all([file('customer_movements'), file('inventory_movements'), file('control_totals')]);
    assertColumns(customerFile.headers, customerFile.headers.includes('COL_NO')
      ? [...CUSTOMER_COLUMNS, 'COL_NO'] : CUSTOMER_COLUMNS, 'customer_movements.csv');
    assertColumns(inventoryFile.headers, INVENTORY_COLUMNS, 'inventory_movements.csv');
    if (controlFile.rows.length !== 1) throw new Error('control_totals.csv must contain one row');
    const counts = controlFile.rows[0];
    const expectedCustomers = integer(counts, 'CUSTOMER_MOVEMENTS', 'control_totals.csv');
    const expectedInventory = integer(counts, 'INVENTORY_MOVEMENTS', 'control_totals.csv');
    if (customerFile.rows.length !== expectedCustomers || inventoryFile.rows.length !== expectedInventory) throw new Error('Movement counts differ from Oracle control totals.');

    // Collector enrichment must never change an already published movement's identity.
    const customerMovements = fingerprintCustomerMovements(customerFile.rows).map(({ row, ...baseIdentity }, index): CustomerMovementRow => {
      const identity = { ...baseIdentity, collectorNo: optional(row, 'COL_NO') };
      const context = `customer_movements.csv row ${index + 2}`;
      return { ...identity, externalCustomerCode: required(row,'C_CODE',context), currencyCode: required(row,'A_CY',context), documentDate: date(row,'DOC_DATE',context)!, documentType: required(row,'DOC_TYPE',context), documentJvType: optional(row,'DOC_JV_TYPE'), documentNumber: optional(row,'DOC_NO'), documentSerial: optional(row,'DOC_SER'), recordNumber: optional(row,'RCRD_NO'), referenceNumber: optional(row,'REF_NO'), description: optional(row,'DOC_DESC'), debitLocal: decimal(row,'DR_AMT',context)!, creditLocal: decimal(row,'CR_AMT',context)!, debitForeign: decimal(row,'DR_AMTF',context)!, creditForeign: decimal(row,'CR_AMTF',context)!, sourceCreatedAt: date(row,'AD_DATE',context,true), sourceUpdatedAt: date(row,'UP_DATE',context,true) };
    });
    const inventoryMovements = fingerprintRows(inventoryFile.rows, inventoryFile.headers).map(({ row, ...identity }, index): InventoryMovementRow => {
      const context = `inventory_movements.csv row ${index + 2}`;
      return { ...identity, documentType: required(row,'DOC_TYPE',context), billDocumentType: optional(row,'BILL_DOC_TYPE'), documentNumber: required(row,'DOC_NO',context), documentSerial: required(row,'DOC_SER',context), recordNumber: optional(row,'RCRD_NO'), documentSequence: required(row,'DOC_SEQUENCE',context), serialNumber: required(row,'SERIAL',context), movementDate: date(row,'I_DATE',context)!, externalItemCode: required(row,'I_CODE',context), unitName: required(row,'ITM_UNT',context), packageSize: decimal(row,'P_SIZE',context)!, itemQuantity: decimal(row,'I_QTY',context)!, freeQuantity: decimal(row,'FREE_QTY',context)!, primaryQuantity: decimal(row,'P_QTY',context)!, primaryFreeQuantity: decimal(row,'PF_QTY',context)!, inOut: integer(row,'IN_OUT',context), externalWarehouseCode: required(row,'W_CODE',context), externalWarehouseGroupCode: optional(row,'WHG_CODE'), itemCost: decimal(row,'I_COST',context,true), stockCost: decimal(row,'STK_COST',context,true), currencyCode: optional(row,'A_CY'), externalCustomerCode: optional(row,'C_CODE'), externalVendorCode: optional(row,'V_CODE'), description: optional(row,'A_DESC'), referenceNumber: optional(row,'REF_NO'), barcode: optional(row,'BARCODE'), companyNumber: optional(row,'CMP_NO'), branchNumber: optional(row,'BRN_NO'), branchYear: optional(row,'BRN_YEAR'), sourceCreatedAt: date(row,'AD_DATE',context,true), sourceUpdatedAt: date(row,'UP_DATE',context,true) };
    });
    const uniqueCustomer = new Set(customerMovements.map((row) => row.sourceFingerprint)).size;
    const uniqueInventory = new Set(inventoryMovements.map((row) => row.sourceFingerprint)).size;
    if (uniqueCustomer !== customerMovements.length || uniqueInventory !== inventoryMovements.length) throw new Error('Movement fingerprint collision detected.');
    return {
      sourceSchema: manifest.source.schema, generatedAt: new Date(manifest.generatedAtUtc), manifestHash: sha256(manifestBuffer),
      sourceCounts: { customer_movements: expectedCustomers, inventory_movements: expectedInventory },
      validationSummary: {
        customerMissingRecordNumber: integer(counts,'CUSTOMER_MISSING_RCRD_NO','control_totals.csv'),
        customerMissingUpdateDate: integer(counts,'CUSTOMER_MISSING_UP_DATE','control_totals.csv'),
        inventoryMissingRecordNumber: integer(counts,'INVENTORY_MISSING_RCRD_NO','control_totals.csv'),
        inventoryMissingUpdateDate: integer(counts,'INVENTORY_MISSING_UP_DATE','control_totals.csv'),
        fingerprintCollisions: 0,
      },
      customerMovements, inventoryMovements,
    };
  }
}
