import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

const REQUIRED_FILES = {
  item_groups: 'item_groups.csv',
  items: 'items.csv',
  item_units: 'item_units.csv',
  warehouse_groups: 'warehouse_groups.csv',
  warehouses: 'warehouses.csv',
  stock_balances: 'stock_balances.csv',
  control_totals: 'control_totals.csv',
} as const;

const REQUIRED_COLUMNS: Record<SnapshotFileName, string[]> = {
  item_groups: ['G_CODE', 'G_A_NAME', 'G_E_NAME', 'G_I_CODE', 'UP_DATE'],
  items: ['I_CODE', 'I_NAME', 'G_CODE', 'PRIMARY_COST', 'I_CWTAVG', 'INACTIVE', 'SERVICE_ITM', 'UP_DATE'],
  item_units: ['I_CODE', 'ITM_UNT', 'P_SIZE', 'MAIN_UNIT', 'SALE_UNIT', 'PUR_UNIT', 'STOCK_UNIT', 'PRICE_UNIT', 'NO_SALE', 'BARCODE', 'LVL_UNIT', 'USE_SRLNO', 'INACTIVE', 'INACTIVE_RES', 'UP_DATE'],
  warehouse_groups: ['WHG_CODE', 'WHG_A_NAME', 'WHG_E_NAME', 'UP_DATE'],
  warehouses: ['W_CODE', 'W_NAME', 'W_E_NAME', 'LOCATION', 'TEL_NO', 'INACTIVE', 'WH_KEEPER', 'WHG_CODE', 'W_TYPE', 'NO_SALE', 'CHK_AVL_QTY', 'CONN_BRN_NO', 'MAIN_WCODE', 'LATITUDE', 'LONGITUDE', 'UP_DATE'],
  stock_balances: ['I_CODE', 'ITM_UNT', 'P_SIZE', 'W_CODE', 'WHG_CODE', 'AVL_QTY', 'PRIMARY_COST', 'I_CWTAVG', 'INACTIVE', 'UP_DATE'],
  control_totals: ['ITEM_GROUPS', 'ITEMS', 'ITEM_UNITS', 'WAREHOUSE_GROUPS', 'WAREHOUSES', 'STOCK_BALANCE_ROWS'],
};

type SnapshotFileName = keyof typeof REQUIRED_FILES;
type CsvRow = Record<string, string>;

interface SnapshotManifestFile {
  name: string;
  file: string;
  rows: number;
  sha256: string;
}

interface SnapshotManifest {
  contractVersion: string;
  mode: string;
  generatedAtUtc: string;
  source: {
    alias: string;
    schema: string;
    transactionMode: string;
  };
  files: SnapshotManifestFile[];
}

export interface ItemGroupSnapshotRow {
  externalGroupCode: string;
  nameAr: string;
  nameEn: string | null;
  parentExternalCode: string | null;
  sourceUpdatedAt: Date | null;
  sourceHash: string;
}

export interface ItemSnapshotRow {
  externalItemCode: string;
  nameAr: string;
  externalGroupCode: string;
  referencePrimaryCost: string | null;
  referenceWeightedAverageCost: string | null;
  isInactive: boolean;
  isService: boolean;
  sourceUpdatedAt: Date | null;
  sourceHash: string;
}

export interface ItemUnitSnapshotRow {
  externalItemCode: string;
  unitName: string;
  packageSize: string;
  isMainUnit: boolean;
  isSaleUnit: boolean;
  isPurchaseUnit: boolean;
  isStockUnit: boolean;
  isPriceUnit: boolean;
  noSale: boolean;
  barcode: string | null;
  unitLevel: number | null;
  usesSerialNumber: boolean;
  isInactive: boolean;
  inactiveReason: string | null;
  sourceUpdatedAt: Date | null;
  sourceHash: string;
}

export interface WarehouseGroupSnapshotRow {
  externalGroupCode: string;
  nameAr: string;
  nameEn: string | null;
  sourceUpdatedAt: Date | null;
  sourceHash: string;
}

export interface WarehouseSnapshotRow {
  externalWarehouseCode: string;
  nameAr: string;
  nameEn: string | null;
  locationText: string | null;
  phone: string | null;
  isInactive: boolean;
  keeperName: string | null;
  externalGroupCode: string | null;
  warehouseType: number | null;
  noSale: boolean;
  checkAvailableQuantity: boolean;
  externalBranchCode: string | null;
  mainExternalWarehouseCode: string | null;
  latitudeRaw: string | null;
  longitudeRaw: string | null;
  sourceUpdatedAt: Date | null;
  sourceHash: string;
}

export interface StockBalanceSnapshotRow {
  externalItemCode: string;
  unitName: string;
  packageSize: string;
  externalWarehouseCode: string;
  externalWarehouseGroupCode: string | null;
  warehouseGroupKey: string;
  availableQuantity: string;
  primaryCost: string | null;
  weightedAverageCost: string | null;
  isInactive: boolean;
  sourceUpdatedAt: Date | null;
  sourceHash: string;
}

export interface OracleInventorySnapshot {
  sourceSchema: string;
  generatedAt: Date;
  manifestHash: string;
  sourceCounts: Record<string, number>;
  validationSummary: Record<string, unknown>;
  itemGroups: ItemGroupSnapshotRow[];
  items: ItemSnapshotRow[];
  itemUnits: ItemUnitSnapshotRow[];
  warehouseGroups: WarehouseGroupSnapshotRow[];
  warehouses: WarehouseSnapshotRow[];
  stockBalances: StockBalanceSnapshotRow[];
}

export class OracleInventorySnapshotValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Oracle inventory snapshot validation failed (${issues.length} issue(s)): ${issues.slice(0, 5).join(' | ')}`);
    this.name = 'OracleInventorySnapshotValidationError';
  }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseCsv(content: string, fileName: string): { headers: string[]; rows: CsvRow[] } {
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) matrix.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (inQuotes) throw new Error(`${fileName}: unterminated quoted CSV field`);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) matrix.push(row);
  }
  if (matrix.length === 0) throw new Error(`${fileName}: CSV file is empty`);

  const headers = matrix[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '').trim() : value.trim());
  if (headers.some((value) => !value)) throw new Error(`${fileName}: CSV header contains a blank column`);
  if (new Set(headers).size !== headers.length) throw new Error(`${fileName}: CSV header contains duplicate columns`);

  const rows = matrix.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`${fileName}: row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
  });
  return { headers, rows };
}

function required(row: CsvRow, key: string, context: string): string {
  const value = row[key]?.trim();
  if (!value) throw new Error(`${context}: required field ${key} is blank`);
  return value;
}

function optional(row: CsvRow, key: string): string | null {
  const value = row[key]?.trim();
  return value ? value : null;
}

function decimal(row: CsvRow, key: string, context: string, allowNull = false): string | null {
  const value = optional(row, key);
  if (value === null && allowNull) return null;
  if (value === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    throw new Error(`${context}: ${key} is not a valid decimal`);
  }
  const [whole = '', fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const wholeDigits = whole.replace(/^0+/, '').length;
  if (fraction.length > 16 || wholeDigits + fraction.length > 38) {
    throw new Error(`${context}: ${key} exceeds NUMERIC(38,16)`);
  }
  return value;
}

function integer(row: CsvRow, key: string, context: string, allowNull = false): number | null {
  const value = optional(row, key);
  if (value === null && allowNull) return null;
  if (value === null || !/^[+-]?\d+$/.test(value)) throw new Error(`${context}: ${key} is not a valid integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${context}: ${key} exceeds the safe integer range`);
  return parsed;
}

function flag(row: CsvRow, key: string): boolean {
  const value = (optional(row, key) ?? '0').toUpperCase();
  return value === '1' || value === 'Y' || value === 'YES' || value === 'TRUE';
}

function oracleDate(row: CsvRow, key: string, context: string): Date | null {
  const value = optional(row, key);
  if (value === null) return null;
  const normalized = value.replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`${context}: ${key} must use YYYY-MM-DD HH24:MI:SS`);
  }
  const parsed = new Date(`${normalized}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${context}: ${key} is not a valid date`);
  return parsed;
}

function rowHash(row: CsvRow, headers: string[]): string {
  return sha256(JSON.stringify(headers.map((header) => row[header] ?? '')));
}

function duplicateKeys(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function assertLengths(value: string | null, max: number, context: string, field: string, issues: string[]): void {
  if (value !== null && value.length > max) issues.push(`${context}: ${field} exceeds ${max} characters`);
}

@Injectable()
export class OracleInventorySnapshotService {
  async inspect(snapshotDirectory: string): Promise<OracleInventorySnapshot> {
    const root = path.resolve(snapshotDirectory);
    const manifestPath = path.join(root, 'manifest.json');
    const manifestBuffer = await fs.readFile(manifestPath);
    const manifest = this.parseManifest(manifestBuffer.toString('utf8'));
    const fileRows = {} as Record<SnapshotFileName, { headers: string[]; rows: CsvRow[] }>;

    for (const [name, expectedFile] of Object.entries(REQUIRED_FILES) as [SnapshotFileName, string][]) {
      const entry = manifest.files.find((candidate) => candidate.name === name);
      if (!entry || entry.file !== expectedFile) throw new Error(`manifest.json: missing or invalid entry for ${name}`);
      const resolved = path.resolve(root, entry.file);
      const relative = path.relative(root, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`manifest.json: file escapes snapshot directory: ${entry.file}`);
      const buffer = await fs.readFile(resolved);
      if (sha256(buffer) !== entry.sha256.toLowerCase()) throw new Error(`${entry.file}: SHA-256 mismatch`);
      const parsed = parseCsv(buffer.toString('utf8'), entry.file);
      const missingColumns = REQUIRED_COLUMNS[name].filter((column) => !parsed.headers.includes(column));
      if (missingColumns.length > 0) throw new Error(`${entry.file}: missing columns ${missingColumns.join(', ')}`);
      if (parsed.rows.length !== entry.rows) {
        throw new Error(`${entry.file}: row count mismatch; manifest=${entry.rows}, actual=${parsed.rows.length}`);
      }
      fileRows[name] = parsed;
    }

    const itemGroups = fileRows.item_groups.rows.map((row, index) => ({
      externalGroupCode: required(row, 'G_CODE', `item_groups.csv row ${index + 2}`),
      nameAr: required(row, 'G_A_NAME', `item_groups.csv row ${index + 2}`),
      nameEn: optional(row, 'G_E_NAME'),
      parentExternalCode: optional(row, 'G_I_CODE'),
      sourceUpdatedAt: oracleDate(row, 'UP_DATE', `item_groups.csv row ${index + 2}`),
      sourceHash: rowHash(row, fileRows.item_groups.headers),
    }));
    const items = fileRows.items.rows.map((row, index) => ({
      externalItemCode: required(row, 'I_CODE', `items.csv row ${index + 2}`),
      nameAr: required(row, 'I_NAME', `items.csv row ${index + 2}`),
      externalGroupCode: required(row, 'G_CODE', `items.csv row ${index + 2}`),
      referencePrimaryCost: decimal(row, 'PRIMARY_COST', `items.csv row ${index + 2}`, true),
      referenceWeightedAverageCost: decimal(row, 'I_CWTAVG', `items.csv row ${index + 2}`, true),
      isInactive: flag(row, 'INACTIVE'),
      isService: flag(row, 'SERVICE_ITM'),
      sourceUpdatedAt: oracleDate(row, 'UP_DATE', `items.csv row ${index + 2}`),
      sourceHash: rowHash(row, fileRows.items.headers),
    }));
    const itemUnits = fileRows.item_units.rows.map((row, index) => ({
      externalItemCode: required(row, 'I_CODE', `item_units.csv row ${index + 2}`),
      unitName: required(row, 'ITM_UNT', `item_units.csv row ${index + 2}`),
      packageSize: decimal(row, 'P_SIZE', `item_units.csv row ${index + 2}`)!,
      isMainUnit: flag(row, 'MAIN_UNIT'),
      isSaleUnit: flag(row, 'SALE_UNIT'),
      isPurchaseUnit: flag(row, 'PUR_UNIT'),
      isStockUnit: flag(row, 'STOCK_UNIT'),
      isPriceUnit: flag(row, 'PRICE_UNIT'),
      noSale: flag(row, 'NO_SALE'),
      barcode: optional(row, 'BARCODE'),
      unitLevel: integer(row, 'LVL_UNIT', `item_units.csv row ${index + 2}`, true),
      usesSerialNumber: flag(row, 'USE_SRLNO'),
      isInactive: flag(row, 'INACTIVE'),
      inactiveReason: optional(row, 'INACTIVE_RES'),
      sourceUpdatedAt: oracleDate(row, 'UP_DATE', `item_units.csv row ${index + 2}`),
      sourceHash: rowHash(row, fileRows.item_units.headers),
    }));
    const warehouseGroups = fileRows.warehouse_groups.rows.map((row, index) => ({
      externalGroupCode: required(row, 'WHG_CODE', `warehouse_groups.csv row ${index + 2}`),
      nameAr: required(row, 'WHG_A_NAME', `warehouse_groups.csv row ${index + 2}`),
      nameEn: optional(row, 'WHG_E_NAME'),
      sourceUpdatedAt: oracleDate(row, 'UP_DATE', `warehouse_groups.csv row ${index + 2}`),
      sourceHash: rowHash(row, fileRows.warehouse_groups.headers),
    }));
    const warehouses = fileRows.warehouses.rows.map((row, index) => ({
      externalWarehouseCode: required(row, 'W_CODE', `warehouses.csv row ${index + 2}`),
      nameAr: required(row, 'W_NAME', `warehouses.csv row ${index + 2}`),
      nameEn: optional(row, 'W_E_NAME'),
      locationText: optional(row, 'LOCATION'),
      phone: optional(row, 'TEL_NO'),
      isInactive: flag(row, 'INACTIVE'),
      keeperName: optional(row, 'WH_KEEPER'),
      externalGroupCode: optional(row, 'WHG_CODE'),
      warehouseType: integer(row, 'W_TYPE', `warehouses.csv row ${index + 2}`, true),
      noSale: flag(row, 'NO_SALE'),
      checkAvailableQuantity: flag(row, 'CHK_AVL_QTY'),
      externalBranchCode: optional(row, 'CONN_BRN_NO'),
      // In the verified legacy schema MAIN_WCODE is a 0/1 marker, not a
      // warehouse code. Keep it in the source row hash, but do not create a
      // false self-reference in the mirror schema.
      mainExternalWarehouseCode: null,
      latitudeRaw: optional(row, 'LATITUDE'),
      longitudeRaw: optional(row, 'LONGITUDE'),
      sourceUpdatedAt: oracleDate(row, 'UP_DATE', `warehouses.csv row ${index + 2}`),
      sourceHash: rowHash(row, fileRows.warehouses.headers),
    }));
    const stockBalances = fileRows.stock_balances.rows.map((row, index) => {
      const group = optional(row, 'WHG_CODE');
      return {
        externalItemCode: required(row, 'I_CODE', `stock_balances.csv row ${index + 2}`),
        unitName: required(row, 'ITM_UNT', `stock_balances.csv row ${index + 2}`),
        packageSize: decimal(row, 'P_SIZE', `stock_balances.csv row ${index + 2}`)!,
        externalWarehouseCode: required(row, 'W_CODE', `stock_balances.csv row ${index + 2}`),
        externalWarehouseGroupCode: group,
        warehouseGroupKey: group ?? '#NULL',
        availableQuantity: decimal(row, 'AVL_QTY', `stock_balances.csv row ${index + 2}`)!,
        primaryCost: decimal(row, 'PRIMARY_COST', `stock_balances.csv row ${index + 2}`, true),
        weightedAverageCost: decimal(row, 'I_CWTAVG', `stock_balances.csv row ${index + 2}`, true),
        isInactive: flag(row, 'INACTIVE'),
        sourceUpdatedAt: oracleDate(row, 'UP_DATE', `stock_balances.csv row ${index + 2}`),
        sourceHash: rowHash(row, fileRows.stock_balances.headers),
      };
    });

    const sourceCounts = this.readControlTotals(fileRows.control_totals.rows);
    const issues = this.validateData(itemGroups, items, itemUnits, warehouseGroups, warehouses, stockBalances, sourceCounts);
    if (issues.length > 0) throw new OracleInventorySnapshotValidationError(issues);

    return {
      sourceSchema: manifest.source.schema,
      generatedAt: new Date(manifest.generatedAtUtc),
      manifestHash: sha256(manifestBuffer),
      sourceCounts,
      validationSummary: {
        passed: true,
        manifestFiles: Object.keys(REQUIRED_FILES).length,
        hashesMatched: true,
        countsMatched: true,
        duplicateKeys: 0,
        missingReferences: 0,
      },
      itemGroups,
      items,
      itemUnits,
      warehouseGroups,
      warehouses,
      stockBalances,
    };
  }

  private parseManifest(content: string): SnapshotManifest {
    const manifest = JSON.parse(content.replace(/^\uFEFF/, '')) as SnapshotManifest;
    if (manifest.contractVersion !== '2.0') throw new Error('manifest.json: unsupported contractVersion');
    if (manifest.mode !== 'oracle-inventory-read-only-snapshot') throw new Error('manifest.json: unexpected mode');
    if (manifest.source?.schema !== 'IAS20261') throw new Error('manifest.json: unexpected Oracle schema');
    if (manifest.source?.transactionMode !== 'READ ONLY') throw new Error('manifest.json: source transaction is not READ ONLY');
    if (!manifest.source.alias?.trim()) throw new Error('manifest.json: source alias is missing');
    if (Number.isNaN(new Date(manifest.generatedAtUtc).getTime())) throw new Error('manifest.json: generatedAtUtc is invalid');
    if (!Array.isArray(manifest.files)) throw new Error('manifest.json: files must be an array');
    if (duplicateKeys(manifest.files.map((entry) => entry.name)).length > 0) throw new Error('manifest.json: duplicate file names');
    if (manifest.files.length !== Object.keys(REQUIRED_FILES).length) throw new Error('manifest.json: unexpected number of files');
    for (const entry of manifest.files) {
      if (!Number.isInteger(entry.rows) || entry.rows < 0) throw new Error(`manifest.json: invalid row count for ${entry.name}`);
      if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) throw new Error(`manifest.json: invalid SHA-256 for ${entry.name}`);
    }
    return manifest;
  }

  private readControlTotals(rows: CsvRow[]): Record<string, number> {
    if (rows.length !== 1) throw new Error('control_totals.csv must contain exactly one row');
    const row = rows[0];
    const mappings: Record<string, string> = {
      item_groups: 'ITEM_GROUPS',
      items: 'ITEMS',
      item_units: 'ITEM_UNITS',
      warehouse_groups: 'WAREHOUSE_GROUPS',
      warehouses: 'WAREHOUSES',
      stock_balances: 'STOCK_BALANCE_ROWS',
    };
    return Object.fromEntries(Object.entries(mappings).map(([name, column]) => {
      const value = integer(row, column, 'control_totals.csv');
      if (value === null || value < 0) throw new Error(`control_totals.csv: ${column} must be non-negative`);
      return [name, value];
    }));
  }

  private validateData(
    itemGroups: ItemGroupSnapshotRow[],
    items: ItemSnapshotRow[],
    itemUnits: ItemUnitSnapshotRow[],
    warehouseGroups: WarehouseGroupSnapshotRow[],
    warehouses: WarehouseSnapshotRow[],
    stockBalances: StockBalanceSnapshotRow[],
    sourceCounts: Record<string, number>,
  ): string[] {
    const issues: string[] = [];
    const actualCounts: Record<string, number> = {
      item_groups: itemGroups.length,
      items: items.length,
      item_units: itemUnits.length,
      warehouse_groups: warehouseGroups.length,
      warehouses: warehouses.length,
      stock_balances: stockBalances.length,
    };
    for (const [name, actual] of Object.entries(actualCounts)) {
      if (sourceCounts[name] !== actual) issues.push(`${name}: source count=${sourceCounts[name]}, snapshot count=${actual}`);
    }

    const duplicateChecks: [string, string[]][] = [
      ['item group code', itemGroups.map((row) => row.externalGroupCode)],
      ['item code', items.map((row) => row.externalItemCode)],
      ['item/unit key', itemUnits.map((row) => `${row.externalItemCode}\u0000${row.unitName}`)],
      ['item/package key', itemUnits.map((row) => `${row.externalItemCode}\u0000${row.packageSize}`)],
      ['barcode', itemUnits.filter((row) => row.barcode !== null).map((row) => row.barcode!)],
      ['warehouse group code', warehouseGroups.map((row) => row.externalGroupCode)],
      ['warehouse code', warehouses.map((row) => row.externalWarehouseCode)],
      ['stock key', stockBalances.map((row) => [row.externalItemCode, row.unitName, row.packageSize, row.externalWarehouseCode, row.warehouseGroupKey].join('\u0000'))],
    ];
    for (const [label, values] of duplicateChecks) {
      const duplicates = duplicateKeys(values);
      if (duplicates.length > 0) issues.push(`${label}: ${duplicates.length} duplicate key(s)`);
    }

    const groupCodes = new Set(itemGroups.map((row) => row.externalGroupCode));
    const itemCodes = new Set(items.map((row) => row.externalItemCode));
    const unitKeys = new Set(itemUnits.map((row) => `${row.externalItemCode}\u0000${row.unitName}\u0000${row.packageSize}`));
    const warehouseGroupCodes = new Set(warehouseGroups.map((row) => row.externalGroupCode));
    const warehouseCodes = new Set(warehouses.map((row) => row.externalWarehouseCode));
    for (const row of items) {
      if (!groupCodes.has(row.externalGroupCode)) issues.push(`item ${row.externalItemCode}: unknown group ${row.externalGroupCode}`);
      assertLengths(row.externalItemCode, 30, `item ${row.externalItemCode}`, 'code', issues);
      assertLengths(row.nameAr, 100, `item ${row.externalItemCode}`, 'Arabic name', issues);
    }
    for (const row of itemGroups) {
      assertLengths(row.externalGroupCode, 10, `item group ${row.externalGroupCode}`, 'code', issues);
      assertLengths(row.nameAr, 100, `item group ${row.externalGroupCode}`, 'Arabic name', issues);
    }
    for (const row of itemUnits) {
      if (!itemCodes.has(row.externalItemCode)) issues.push(`unit ${row.externalItemCode}/${row.unitName}: unknown item`);
      if (Number(row.packageSize) <= 0) issues.push(`unit ${row.externalItemCode}/${row.unitName}: package size must be positive`);
      assertLengths(row.unitName, 10, `unit ${row.externalItemCode}/${row.unitName}`, 'unit name', issues);
      assertLengths(row.barcode, 30, `unit ${row.externalItemCode}/${row.unitName}`, 'barcode', issues);
    }
    for (const row of warehouseGroups) {
      assertLengths(row.externalGroupCode, 30, `warehouse group ${row.externalGroupCode}`, 'code', issues);
      assertLengths(row.nameAr, 100, `warehouse group ${row.externalGroupCode}`, 'Arabic name', issues);
    }
    for (const row of warehouses) {
      if (row.externalGroupCode && !warehouseGroupCodes.has(row.externalGroupCode)) issues.push(`warehouse ${row.externalWarehouseCode}: unknown group ${row.externalGroupCode}`);
      if (row.mainExternalWarehouseCode && !warehouseCodes.has(row.mainExternalWarehouseCode)) issues.push(`warehouse ${row.externalWarehouseCode}: unknown main warehouse ${row.mainExternalWarehouseCode}`);
      assertLengths(row.externalWarehouseCode, 30, `warehouse ${row.externalWarehouseCode}`, 'code', issues);
      assertLengths(row.nameAr, 100, `warehouse ${row.externalWarehouseCode}`, 'Arabic name', issues);
    }
    for (const row of stockBalances) {
      const context = `stock ${row.externalItemCode}/${row.unitName}/${row.externalWarehouseCode}`;
      if (!unitKeys.has(`${row.externalItemCode}\u0000${row.unitName}\u0000${row.packageSize}`)) issues.push(`${context}: unknown item unit/package`);
      if (!warehouseCodes.has(row.externalWarehouseCode)) issues.push(`${context}: unknown warehouse`);
      if (row.externalWarehouseGroupCode && !warehouseGroupCodes.has(row.externalWarehouseGroupCode)) issues.push(`${context}: unknown warehouse group`);
      if (Number(row.packageSize) <= 0) issues.push(`${context}: package size must be positive`);
    }
    return issues;
  }
}
