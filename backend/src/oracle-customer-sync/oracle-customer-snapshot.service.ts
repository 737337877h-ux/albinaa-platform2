import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

const REQUIRED_FILES = {
  customers: 'customers.csv',
  customer_currencies: 'customer_currencies.csv',
  customer_balances: 'customer_balances.csv',
  control_reconciliation: 'control_reconciliation.csv',
  control_totals: 'control_totals.csv',
} as const;

type FileKey = keyof typeof REQUIRED_FILES;
type CsvRow = Record<string, string>;

const REQUIRED_COLUMNS: Record<FileKey, string[]> = {
  customers: ['C_CODE', 'C_A_CODE', 'C_A_NAME', 'C_PHONE', 'C_MOBILE', 'C_ADDRESS', 'R_CODE', 'LATITUDE', 'LONGITUDE', 'C_SINCE', 'INACTIVE', 'CONN_BRN_NO', 'COL_NO', 'AD_DATE', 'UP_DATE'],
  customer_currencies: ['C_CODE', 'A_CY', 'INACTIVE', 'CR_LIMIT', 'INV_LIMIT'],
  customer_balances: ['C_CODE', 'A_CY', 'TRANSACTION_COUNT', 'OPENING_DEBIT_LOCAL', 'OPENING_CREDIT_LOCAL', 'BALANCE_LOCAL', 'OPENING_DEBIT_FOREIGN', 'OPENING_CREDIT_FOREIGN', 'BALANCE_FOREIGN', 'FIRST_TRANSACTION_DATE', 'LAST_TRANSACTION_DATE'],
  control_reconciliation: ['A_CODE', 'A_CY', 'CUSTOMER_COUNT', 'CUSTOMER_BALANCE_LOCAL', 'CRNT_BLNC_L', 'DIFFERENCE_LOCAL', 'CUSTOMER_BALANCE_FOREIGN', 'CRNT_BLNC_F', 'DIFFERENCE_FOREIGN'],
  control_totals: ['CUSTOMERS', 'CUSTOMER_CURRENCIES', 'CUSTOMER_BALANCES', 'TRANSACTION_ROWS'],
};

interface Manifest {
  contractVersion: string;
  mode: string;
  generatedAtUtc: string;
  source: { alias: string; schema: string; transactionMode: string };
  files: Array<{ name: string; file: string; rows: number; sha256: string }>;
}

export interface CustomerSnapshotRow {
  externalCustomerCode: string;
  accountNumber: string | null;
  nameAr: string;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  externalRegionCode: string | null;
  latitudeRaw: string | null;
  longitudeRaw: string | null;
  relationshipStartDate: Date | null;
  isInactive: boolean;
  externalBranchCode: string | null;
  externalCollectorCode: string | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceHash: string;
}

export interface CustomerCurrencySnapshotRow {
  externalCustomerCode: string;
  currencyCode: string;
  isInactive: boolean;
  creditLimit: string;
  invoiceLimit: string;
  sourceHash: string;
}

export interface CustomerBalanceSnapshotRow {
  externalCustomerCode: string;
  currencyCode: string;
  transactionCount: number;
  openingDebitLocal: string;
  openingCreditLocal: string;
  balanceLocal: string;
  openingDebitForeign: string;
  openingCreditForeign: string;
  balanceForeign: string;
  firstTransactionDate: Date | null;
  lastTransactionDate: Date | null;
  sourceHash: string;
}

export interface OracleCustomerSnapshot {
  sourceSchema: string;
  generatedAt: Date;
  manifestHash: string;
  sourceCounts: Record<string, number>;
  validationSummary: Record<string, unknown>;
  customers: CustomerSnapshotRow[];
  customerCurrencies: CustomerCurrencySnapshotRow[];
  customerBalances: CustomerBalanceSnapshotRow[];
}

export class OracleCustomerSnapshotValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Oracle customer snapshot validation failed (${issues.length} issue(s)): ${issues.slice(0, 5).join(' | ')}`);
    this.name = 'OracleCustomerSnapshotValidationError';
  }
}

function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function optional(row: CsvRow, key: string): string | null { const value = row[key]?.trim(); return value ? value : null; }
function required(row: CsvRow, key: string, context: string): string {
  const value = optional(row, key);
  if (value === null) throw new Error(`${context}: required field ${key} is blank`);
  return value;
}
function flag(row: CsvRow, key: string): boolean { return ['1', 'Y', 'YES', 'TRUE'].includes((optional(row, key) ?? '0').toUpperCase()); }
function integer(row: CsvRow, key: string, context: string): number {
  const value = required(row, key, context);
  if (!/^\d+$/.test(value)) throw new Error(`${context}: ${key} is not a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${context}: ${key} exceeds safe integer range`);
  return parsed;
}
function decimal(row: CsvRow, key: string, context: string): string {
  const value = required(row, key, context);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error(`${context}: ${key} is not a decimal`);
  const digits = value.replace(/^[+-]/, '').split('.');
  const wholeDigits = digits[0].replace(/^0+/, '').length;
  const fractionDigits = (digits[1] ?? '').length;
  if (fractionDigits > 16 || wholeDigits + fractionDigits > 38) throw new Error(`${context}: ${key} exceeds NUMERIC(38,16)`);
  return value;
}
function oracleDate(row: CsvRow, key: string, context: string, dateOnly = false): Date | null {
  const value = optional(row, key);
  if (value === null) return null;
  const pattern = dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!pattern.test(value)) throw new Error(`${context}: ${key} has an unexpected date format`);
  const parsed = new Date(`${value.replace(' ', 'T')}${dateOnly ? 'T00:00:00Z' : 'Z'}`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${context}: ${key} is not a valid date`);
  return parsed;
}
function rowHash(row: CsvRow, headers: string[]): string { return sha256(JSON.stringify(headers.map((header) => row[header] ?? ''))); }
function duplicateKeys(values: string[]): string[] {
  const seen = new Set<string>(); const duplicates = new Set<string>();
  for (const value of values) { if (seen.has(value)) duplicates.add(value); seen.add(value); }
  return [...duplicates];
}
function parseCsv(content: string, fileName: string): { headers: string[]; rows: CsvRow[] } {
  const matrix: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field); if (row.some((value) => value.length > 0)) matrix.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error(`${fileName}: unterminated quoted field`);
  if (field.length > 0 || row.length > 0) { row.push(field); if (row.some((value) => value.length > 0)) matrix.push(row); }
  if (matrix.length === 0) throw new Error(`${fileName}: CSV is empty`);
  const headers = matrix[0].map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, '') : value).trim());
  if (headers.some((value) => !value) || new Set(headers).size !== headers.length) throw new Error(`${fileName}: invalid CSV header`);
  const rows = matrix.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) throw new Error(`${fileName}: row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
  return { headers, rows };
}

@Injectable()
export class OracleCustomerSnapshotService {
  async inspect(snapshotDirectory: string): Promise<OracleCustomerSnapshot> {
    const root = path.resolve(snapshotDirectory);
    const manifestBuffer = await fs.readFile(path.join(root, 'manifest.json'));
    const manifest = this.parseManifest(manifestBuffer.toString('utf8'));
    const files = {} as Record<FileKey, { headers: string[]; rows: CsvRow[] }>;
    for (const [key, expectedFile] of Object.entries(REQUIRED_FILES) as [FileKey, string][]) {
      const entry = manifest.files.find((candidate) => candidate.name === key);
      if (!entry || entry.file !== expectedFile) throw new Error(`manifest.json: missing or invalid ${key}`);
      const resolved = path.resolve(root, entry.file);
      const relative = path.relative(root, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`manifest.json: file escapes snapshot directory: ${entry.file}`);
      const buffer = await fs.readFile(resolved);
      if (sha256(buffer) !== entry.sha256.toLowerCase()) throw new Error(`${entry.file}: SHA-256 mismatch`);
      const parsed = parseCsv(buffer.toString('utf8'), entry.file);
      const missing = REQUIRED_COLUMNS[key].filter((column) => !parsed.headers.includes(column));
      if (missing.length > 0) throw new Error(`${entry.file}: missing columns ${missing.join(', ')}`);
      if (parsed.rows.length !== entry.rows) throw new Error(`${entry.file}: row count mismatch`);
      files[key] = parsed;
    }

    const customers = files.customers.rows.map((row, index) => {
      const context = `customers.csv row ${index + 2}`;
      return {
        externalCustomerCode: required(row, 'C_CODE', context), accountNumber: optional(row, 'C_A_CODE'), nameAr: required(row, 'C_A_NAME', context),
        phone: optional(row, 'C_PHONE'), mobile: optional(row, 'C_MOBILE'), address: optional(row, 'C_ADDRESS'), externalRegionCode: optional(row, 'R_CODE'),
        latitudeRaw: optional(row, 'LATITUDE'), longitudeRaw: optional(row, 'LONGITUDE'), relationshipStartDate: oracleDate(row, 'C_SINCE', context, true),
        isInactive: flag(row, 'INACTIVE'), externalBranchCode: optional(row, 'CONN_BRN_NO'), externalCollectorCode: optional(row, 'COL_NO'),
        sourceCreatedAt: oracleDate(row, 'AD_DATE', context), sourceUpdatedAt: oracleDate(row, 'UP_DATE', context), sourceHash: rowHash(row, files.customers.headers),
      };
    });
    const customerCurrencies = files.customer_currencies.rows.map((row, index) => {
      const context = `customer_currencies.csv row ${index + 2}`;
      return { externalCustomerCode: required(row, 'C_CODE', context), currencyCode: required(row, 'A_CY', context), isInactive: flag(row, 'INACTIVE'), creditLimit: decimal(row, 'CR_LIMIT', context), invoiceLimit: decimal(row, 'INV_LIMIT', context), sourceHash: rowHash(row, files.customer_currencies.headers) };
    });
    const customerBalances = files.customer_balances.rows.map((row, index) => {
      const context = `customer_balances.csv row ${index + 2}`;
      return {
        externalCustomerCode: required(row, 'C_CODE', context), currencyCode: required(row, 'A_CY', context), transactionCount: integer(row, 'TRANSACTION_COUNT', context),
        openingDebitLocal: decimal(row, 'OPENING_DEBIT_LOCAL', context), openingCreditLocal: decimal(row, 'OPENING_CREDIT_LOCAL', context), balanceLocal: decimal(row, 'BALANCE_LOCAL', context),
        openingDebitForeign: decimal(row, 'OPENING_DEBIT_FOREIGN', context), openingCreditForeign: decimal(row, 'OPENING_CREDIT_FOREIGN', context), balanceForeign: decimal(row, 'BALANCE_FOREIGN', context),
        firstTransactionDate: oracleDate(row, 'FIRST_TRANSACTION_DATE', context, true), lastTransactionDate: oracleDate(row, 'LAST_TRANSACTION_DATE', context, true), sourceHash: rowHash(row, files.customer_balances.headers),
      };
    });
    const sourceCounts = this.controlTotals(files.control_totals.rows);
    const issues = this.validate(customers, customerCurrencies, customerBalances, sourceCounts, files.control_reconciliation.rows);
    if (issues.length > 0) throw new OracleCustomerSnapshotValidationError(issues);
    const missingPhone = customers.filter((row) => !row.phone && !row.mobile).length;
    const missingBranch = customers.filter((row) => !row.externalBranchCode).length;
    const missingCollector = customers.filter((row) => !row.externalCollectorCode).length;
    const currencyKeys = new Set(customerCurrencies.map((row) => `${row.externalCustomerCode}|${row.currencyCode}`));
    const balancesWithoutCurrencyConfig = customerBalances
      .filter((row) => !currencyKeys.has(`${row.externalCustomerCode}|${row.currencyCode}`))
      .map((row) => `${row.externalCustomerCode}|${row.currencyCode}`);
    return {
      sourceSchema: manifest.source.schema, generatedAt: new Date(manifest.generatedAtUtc), manifestHash: sha256(manifestBuffer), sourceCounts,
      validationSummary: {
        passed: true,
        hashesMatched: true,
        countsMatched: true,
        duplicateKeys: 0,
        missingCustomerReferences: 0,
        controlReconciliationPassed: true,
        warnings: {
          missingPhone,
          missingBranch,
          missingCollector,
          balancesWithoutCurrencyConfig: balancesWithoutCurrencyConfig.length,
          balanceCurrencyConfigSamples: balancesWithoutCurrencyConfig.slice(0, 20),
        },
      },
      customers, customerCurrencies, customerBalances,
    };
  }

  private parseManifest(content: string): Manifest {
    const manifest = JSON.parse(content.replace(/^\uFEFF/, '')) as Manifest;
    if (manifest.contractVersion !== '1.0' || manifest.mode !== 'oracle-customers-read-only-snapshot') throw new Error('manifest.json: unsupported customer snapshot contract');
    if (manifest.source?.schema !== 'IAS20261' || manifest.source?.transactionMode !== 'READ ONLY') throw new Error('manifest.json: source must be IAS20261 READ ONLY');
    if (!manifest.source.alias?.trim() || Number.isNaN(new Date(manifest.generatedAtUtc).getTime())) throw new Error('manifest.json: invalid source or generatedAtUtc');
    if (!Array.isArray(manifest.files) || manifest.files.length !== Object.keys(REQUIRED_FILES).length) throw new Error('manifest.json: unexpected files');
    if (duplicateKeys(manifest.files.map((entry) => entry.name)).length > 0) throw new Error('manifest.json: duplicate file names');
    for (const entry of manifest.files) if (!Number.isInteger(entry.rows) || entry.rows < 0 || !/^[a-f0-9]{64}$/i.test(entry.sha256)) throw new Error(`manifest.json: invalid entry ${entry.name}`);
    return manifest;
  }

  private controlTotals(rows: CsvRow[]): Record<string, number> {
    if (rows.length !== 1) throw new Error('control_totals.csv must have one row');
    const row = rows[0];
    return { customers: integer(row, 'CUSTOMERS', 'control_totals.csv'), customer_currencies: integer(row, 'CUSTOMER_CURRENCIES', 'control_totals.csv'), customer_balances: integer(row, 'CUSTOMER_BALANCES', 'control_totals.csv'), transaction_rows: integer(row, 'TRANSACTION_ROWS', 'control_totals.csv') };
  }

  private validate(customers: CustomerSnapshotRow[], currencies: CustomerCurrencySnapshotRow[], balances: CustomerBalanceSnapshotRow[], counts: Record<string, number>, reconciliation: CsvRow[]): string[] {
    const issues: string[] = [];
    if (counts.customers !== customers.length) issues.push('customer count differs from Oracle control total');
    if (counts.customer_currencies !== currencies.length) issues.push('customer currency count differs from Oracle control total');
    if (counts.customer_balances !== balances.length) issues.push('customer balance count differs from Oracle control total');
    const duplicateCustomers = duplicateKeys(customers.map((row) => row.externalCustomerCode));
    const duplicateCurrencies = duplicateKeys(currencies.map((row) => `${row.externalCustomerCode}|${row.currencyCode}`));
    const duplicateBalances = duplicateKeys(balances.map((row) => `${row.externalCustomerCode}|${row.currencyCode}`));
    if (duplicateCustomers.length) issues.push(`duplicate customer codes: ${duplicateCustomers.slice(0, 5).join(', ')}`);
    if (duplicateCurrencies.length) issues.push(`duplicate customer currency keys: ${duplicateCurrencies.slice(0, 5).join(', ')}`);
    if (duplicateBalances.length) issues.push(`duplicate customer balance keys: ${duplicateBalances.slice(0, 5).join(', ')}`);
    const customerKeys = new Set(customers.map((row) => row.externalCustomerCode));
    const unknownCurrencyCustomers = currencies.filter((row) => !customerKeys.has(row.externalCustomerCode));
    const unknownBalanceCustomers = balances.filter((row) => !customerKeys.has(row.externalCustomerCode));
    if (unknownCurrencyCustomers.length) issues.push(`${unknownCurrencyCustomers.length} currency rows reference unknown customers`);
    if (unknownBalanceCustomers.length) issues.push(`${unknownBalanceCustomers.length} balances reference unknown customers`);
    if (balances.reduce((sum, row) => sum + row.transactionCount, 0) !== counts.transaction_rows) issues.push('transaction count differs from aggregated balance rows');
    if (reconciliation.length === 0) issues.push('control reconciliation is empty');
    reconciliation.forEach((row, index) => {
      const context = `control_reconciliation.csv row ${index + 2}`;
      const local = Number(decimal(row, 'DIFFERENCE_LOCAL', context));
      const foreign = Number(decimal(row, 'DIFFERENCE_FOREIGN', context));
      if (Math.abs(local) > 0.005 || Math.abs(foreign) > 0.005) issues.push(`${context}: control-account difference exceeds tolerance`);
    });
    return issues;
  }
}
