import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { OracleInventorySnapshotService, OracleInventorySnapshotValidationError } from './oracle-inventory-snapshot.service';

type FixtureFiles = Record<string, string>;

function hash(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function fixtureFiles(duplicateBarcode = false): FixtureFiles {
  const units = [
    '"I_CODE","ITM_UNT","P_SIZE","MAIN_UNIT","SALE_UNIT","PUR_UNIT","STOCK_UNIT","PRICE_UNIT","NO_SALE","BARCODE","LVL_UNIT","USE_SRLNO","INACTIVE","INACTIVE_RES","UP_DATE"',
    '"ITEM-1","حبة","1","1","1","0","0","1","0","ABC-1","1","0","0","","2026-08-15 01:00:00"',
  ];
  if (duplicateBarcode) {
    units.push('"ITEM-1","كرتون","12","0","0","1","0","0","0","ABC-1","2","0","0","","2026-08-15 01:00:00"');
  }
  const unitCount = duplicateBarcode ? 2 : 1;
  return {
    'item_groups.csv': '"G_CODE","G_A_NAME","G_E_NAME","G_I_CODE","UP_DATE"\n"001","مواد بناء","Building","","2026-08-15 01:00:00"\n',
    'items.csv': '"I_CODE","I_NAME","G_CODE","PRIMARY_COST","I_CWTAVG","INACTIVE","SERVICE_ITM","UP_DATE"\n"ITEM-1","صنف اختبار","001","10.5","11.25","0","0","2026-08-15 01:00:00"\n',
    'item_units.csv': `${units.join('\n')}\n`,
    'warehouse_groups.csv': '"WHG_CODE","WHG_A_NAME","WHG_E_NAME","UP_DATE"\n"1","المخازن","Warehouses","2026-08-15 01:00:00"\n',
    'warehouses.csv': '"W_CODE","W_NAME","W_E_NAME","LOCATION","TEL_NO","INACTIVE","WH_KEEPER","WHG_CODE","W_TYPE","NO_SALE","CHK_AVL_QTY","CONN_BRN_NO","MAIN_WCODE","LATITUDE","LONGITUDE","UP_DATE"\n"101","المخزن الرئيسي","Main","","","0","","1","1","0","1","1","1","","","2026-08-15 01:00:00"\n',
    'stock_balances.csv': '"I_CODE","ITM_UNT","P_SIZE","W_CODE","WHG_CODE","AVL_QTY","PRIMARY_COST","I_CWTAVG","INACTIVE","UP_DATE"\n"ITEM-1","حبة","1","101","1","25.5","10.5","11.25","0","2026-08-15 01:00:00"\n',
    'control_totals.csv': `"ITEM_GROUPS","ITEMS","ITEM_UNITS","WAREHOUSE_GROUPS","WAREHOUSES","STOCK_BALANCE_ROWS"\n"1","1","${unitCount}","1","1","1"\n`,
  };
}

async function writeSnapshot(root: string, duplicateBarcode = false): Promise<void> {
  const files = fixtureFiles(duplicateBarcode);
  await Promise.all(Object.entries(files).map(([name, content]) => fs.writeFile(path.join(root, name), content, 'utf8')));
  const manifest = {
    contractVersion: '2.0',
    mode: 'oracle-inventory-read-only-snapshot',
    generatedAtUtc: '2026-08-15T01:00:00.000Z',
    source: { alias: 'TEST', schema: 'IAS20261', transactionMode: 'READ ONLY' },
    files: Object.entries(files).map(([file, content]) => ({
      name: file.replace('.csv', ''),
      file,
      rows: content.trim().split(/\r?\n/).length - 1,
      sha256: hash(content),
    })),
  };
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

describe('OracleInventorySnapshotService', () => {
  const service = new OracleInventorySnapshotService();
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(tmpdir(), 'albinaa-oracle-snapshot-'));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('accepts a complete read-only inventory snapshot and preserves decimal values', async () => {
    await writeSnapshot(directory);
    const snapshot = await service.inspect(directory);
    expect(snapshot.sourceSchema).toBe('IAS20261');
    expect(snapshot.sourceCounts).toEqual({
      item_groups: 1,
      items: 1,
      item_units: 1,
      warehouse_groups: 1,
      warehouses: 1,
      stock_balances: 1,
    });
    expect(snapshot.itemUnits[0].packageSize).toBe('1');
    expect(snapshot.stockBalances[0].availableQuantity).toBe('25.5');
    expect(snapshot.warehouses[0].mainExternalWarehouseCode).toBeNull();
    expect(snapshot.validationSummary).toMatchObject({ passed: true, hashesMatched: true, countsMatched: true });
  });

  it('rejects a file changed after the manifest was created', async () => {
    await writeSnapshot(directory);
    await fs.appendFile(path.join(directory, 'items.csv'), 'tampered', 'utf8');
    await expect(service.inspect(directory)).rejects.toThrow('SHA-256 mismatch');
  });

  it('rejects duplicate nonblank barcodes before any database load', async () => {
    await writeSnapshot(directory, true);
    await expect(service.inspect(directory)).rejects.toBeInstanceOf(OracleInventorySnapshotValidationError);
    await expect(service.inspect(directory)).rejects.toThrow('barcode: 1 duplicate key(s)');
  });
});
