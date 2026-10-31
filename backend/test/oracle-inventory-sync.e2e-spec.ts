import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import { OracleInventorySnapshotService } from '../src/oracle-inventory-sync/oracle-inventory-snapshot.service';
import { OracleInventorySyncService } from '../src/oracle-inventory-sync/oracle-inventory-sync.service';
import { OracleInventoryPublicationService } from '../src/oracle-inventory-sync/oracle-inventory-publication.service';
import { OracleInventoryReadService } from '../src/oracle-inventory-sync/oracle-inventory-read.service';
import { AuthUser } from '../src/common/guards/jwt-auth.guard';

function sha256(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

describe('Oracle inventory snapshot loader (isolated database)', () => {
  const prisma = new PrismaService();
  let snapshotDirectory: string;

  beforeAll(async () => {
    await prisma.$connect();
    snapshotDirectory = await fs.mkdtemp(path.join(tmpdir(), 'albinaa-oracle-e2e-'));
    const files: Record<string, string> = {
      'item_groups.csv': '"G_CODE","G_A_NAME","G_E_NAME","G_I_CODE","UP_DATE"\n"001","مواد بناء","Building","","2026-08-15 01:00:00"\n',
      'items.csv': '"I_CODE","I_NAME","G_CODE","PRIMARY_COST","I_CWTAVG","INACTIVE","SERVICE_ITM","UP_DATE"\n"ITEM-1","صنف اختبار","001","10.5","11.25","0","0","2026-08-15 01:00:00"\n',
      'item_units.csv': '"I_CODE","ITM_UNT","P_SIZE","MAIN_UNIT","SALE_UNIT","PUR_UNIT","STOCK_UNIT","PRICE_UNIT","NO_SALE","BARCODE","LVL_UNIT","USE_SRLNO","INACTIVE","INACTIVE_RES","UP_DATE"\n"ITEM-1","حبة","1","1","1","0","0","1","0","ABC-1","1","0","0","","2026-08-15 01:00:00"\n',
      'warehouse_groups.csv': '"WHG_CODE","WHG_A_NAME","WHG_E_NAME","UP_DATE"\n"1","المخازن","Warehouses","2026-08-15 01:00:00"\n',
      'warehouses.csv': '"W_CODE","W_NAME","W_E_NAME","LOCATION","TEL_NO","INACTIVE","WH_KEEPER","WHG_CODE","W_TYPE","NO_SALE","CHK_AVL_QTY","CONN_BRN_NO","MAIN_WCODE","LATITUDE","LONGITUDE","UP_DATE"\n"101","المخزن الرئيسي","Main","","","0","","1","1","0","1","1","1","","","2026-08-15 01:00:00"\n',
      'stock_balances.csv': '"I_CODE","ITM_UNT","P_SIZE","W_CODE","WHG_CODE","AVL_QTY","PRIMARY_COST","I_CWTAVG","INACTIVE","UP_DATE"\n"ITEM-1","حبة","1","101","1","25.5","10.5","11.25","0","2026-08-15 01:00:00"\n',
      'control_totals.csv': '"ITEM_GROUPS","ITEMS","ITEM_UNITS","WAREHOUSE_GROUPS","WAREHOUSES","STOCK_BALANCE_ROWS"\n"1","1","1","1","1","1"\n',
    };
    await Promise.all(Object.entries(files).map(([name, content]) => fs.writeFile(path.join(snapshotDirectory, name), content, 'utf8')));
    await fs.writeFile(path.join(snapshotDirectory, 'manifest.json'), JSON.stringify({
      contractVersion: '2.0',
      mode: 'oracle-inventory-read-only-snapshot',
      generatedAtUtc: '2026-08-15T01:00:00.000Z',
      source: { alias: 'TEST', schema: 'IAS20261', transactionMode: 'READ ONLY' },
      files: Object.entries(files).map(([file, content]) => ({
        name: file.replace('.csv', ''),
        file,
        rows: content.trim().split(/\r?\n/).length - 1,
        sha256: sha256(content),
      })),
    }), 'utf8');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await fs.rm(snapshotDirectory, { recursive: true, force: true });
  });

  it('loads, validates, publishes, rejects an invalid run, and rolls back safely', async () => {
    const organization = await prisma.organization.create({ data: { name: 'Oracle inventory loader test' } });
    const branch = await prisma.branch.create({
      data: { organizationId: organization.id, name: 'Main branch' },
    });
    const actor: AuthUser = {
      id: '00000000-0000-0000-0000-000000000001',
      organizationId: organization.id,
      branchId: branch.id,
      username: 'test-admin',
      fullName: 'Test admin',
      roles: [],
      permissions: ['reports.read'],
    };
    const loader = new OracleInventorySyncService(prisma, new OracleInventorySnapshotService());
    const publication = new OracleInventoryPublicationService(prisma);
    const reader = new OracleInventoryReadService(prisma, { log: async () => undefined } as any);
    const first = await loader.run({
      snapshotDirectory,
      organizationId: organization.id,
      apply: true,
    });

    expect(first).toMatchObject({ applied: true, status: 'validating' });
    expect(first.syncRunId).not.toBeNull();
    await expect(prisma.oracleInventorySyncRun.findUnique({ where: { id: first.syncRunId! } }))
      .resolves.toMatchObject({ status: 'validating', publishedAt: null, validatedAt: null });
    await expect(prisma.oracleItemMirror.count({ where: { syncRunId: first.syncRunId! } })).resolves.toBe(1);
    await expect(prisma.oracleItemUnitMirror.count({ where: { syncRunId: first.syncRunId! } })).resolves.toBe(1);
    await expect(prisma.oracleStockBalanceMirror.count({ where: { syncRunId: first.syncRunId! } })).resolves.toBe(1);
    await expect(prisma.oracleInventoryActiveSnapshot.count({ where: { organizationId: organization.id } })).resolves.toBe(0);

    const validation = await publication.validate(first.syncRunId!);
    expect(validation).toMatchObject({ passed: true, errorCount: 0, warningCount: 1 });
    const firstPublication = await publication.publish(first.syncRunId!);
    expect(firstPublication).toMatchObject({ published: true, status: 'published', previousRunId: null });
    await expect(prisma.oracleInventoryActiveSnapshot.findUnique({
      where: { organizationId_sourceSchema: { organizationId: organization.id, sourceSchema: 'IAS20261' } },
    })).resolves.toMatchObject({ activeRunId: first.syncRunId, previousRunId: null });
    const visibleItems = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) FROM current_oracle_items WHERE organization_id = ${organization.id}::uuid
    `;
    expect(Number(visibleItems[0].count)).toBe(1);

    await prisma.oracleBranchMapping.create({
      data: {
        organizationId: organization.id,
        sourceSchema: 'IAS20261',
        externalBranchCode: '1',
        platformBranchId: branch.id,
        verifiedAt: new Date(),
      },
    });
    await expect(reader.summary(actor, {})).resolves.toMatchObject({
      snapshot: { runId: first.syncRunId, sourceSchema: 'IAS20261' },
      counts: { itemGroups: 1, items: 1, itemUnits: 1, warehouses: 1, stockBalances: 1 },
      branchMappings: [{ externalBranchCode: '1', platformBranch: { id: branch.id } }],
    });
    await expect(reader.items(actor, { search: 'ABC-1' })).resolves.toMatchObject({
      total: 1,
      snapshotRunId: first.syncRunId,
      items: [{ externalItemCode: 'ITEM-1' }],
    });
    await expect(reader.item(actor, 'ITEM-1', {})).resolves.toMatchObject({
      externalItemCode: 'ITEM-1',
      snapshotRunId: first.syncRunId,
      units: [{ barcode: 'ABC-1', packageSize: '1' }],
      stockRows: [{ externalWarehouseCode: '101', availableQuantity: '25.5' }],
    });
    await expect(reader.warehouses(actor, {})).resolves.toMatchObject({
      snapshotRunId: first.syncRunId,
      items: [{ externalWarehouseCode: '101', branchMapping: { externalBranchCode: '1' } }],
    });
    await expect(reader.stockBalances(actor, { positiveOnly: true })).resolves.toMatchObject({
      total: 1,
      snapshotRunId: first.syncRunId,
      items: [{ externalItemCode: 'ITEM-1', availableQuantity: '25.5' }],
    });

    const firstCatalog = await reader.offlineReferenceCatalog(actor, 'IAS20261');
    const renamedItems = (await fs.readFile(path.join(snapshotDirectory, 'items.csv'), 'utf8')).replace('صنف اختبار', 'اسم الصنف الجديد');
    await fs.writeFile(path.join(snapshotDirectory, 'items.csv'), renamedItems, 'utf8');
    const renamedManifest = JSON.parse(await fs.readFile(path.join(snapshotDirectory, 'manifest.json'), 'utf8'));
    renamedManifest.files.find((file: { file: string }) => file.file === 'items.csv').sha256 = sha256(renamedItems);
    await fs.writeFile(path.join(snapshotDirectory, 'manifest.json'), JSON.stringify(renamedManifest), 'utf8');
    const second = await loader.run({ snapshotDirectory, organizationId: organization.id, apply: true });
    const secondPublication = await publication.publish(second.syncRunId!);
    expect(secondPublication).toMatchObject({ published: true, previousRunId: first.syncRunId });
    const renamedCatalog = await reader.offlineReferenceCatalog(actor, 'IAS20261', firstCatalog.catalogVersion);
    expect(renamedCatalog.catalogVersion).not.toBe(firstCatalog.catalogVersion);
    expect((renamedCatalog as any).items[0].nameAr).toBe('اسم الصنف الجديد');
    expect(await reader.offlineReferenceCatalog(actor, 'IAS20261', renamedCatalog.catalogVersion)).not.toHaveProperty('items');
    await expect(prisma.oracleInventoryActiveSnapshot.findUnique({
      where: { organizationId_sourceSchema: { organizationId: organization.id, sourceSchema: 'IAS20261' } },
    })).resolves.toMatchObject({ activeRunId: second.syncRunId, previousRunId: first.syncRunId });

    const rollback = await publication.rollbackToPrevious(organization.id, 'IAS20261');
    expect(rollback).toMatchObject({ fromRunId: second.syncRunId, toRunId: first.syncRunId });
    const restoredCatalog = await reader.offlineReferenceCatalog(actor, 'IAS20261', renamedCatalog.catalogVersion);
    expect(restoredCatalog.catalogVersion).toBe(firstCatalog.catalogVersion);
    expect((restoredCatalog as any).items[0].nameAr).toBe('صنف اختبار');
    await expect(prisma.oracleInventoryActiveSnapshot.findUnique({
      where: { organizationId_sourceSchema: { organizationId: organization.id, sourceSchema: 'IAS20261' } },
    })).resolves.toMatchObject({ activeRunId: first.syncRunId, previousRunId: second.syncRunId });

    const badRun = await prisma.oracleInventorySyncRun.create({
      data: {
        organizationId: organization.id,
        sourceSchema: 'IAS20261',
        status: 'validating',
        manifestHash: '0'.repeat(64),
        sourceCounts: { item_groups: 1, items: 1, item_units: 0, warehouse_groups: 0, warehouses: 0, stock_balances: 0 },
        loadedCounts: { item_groups: 1, items: 1, item_units: 0, warehouse_groups: 0, warehouses: 0, stock_balances: 0 },
      },
    });
    await prisma.oracleItemGroupMirror.create({
      data: {
        syncRunId: badRun.id,
        organizationId: organization.id,
        externalGroupCode: 'BAD',
        nameAr: 'مجموعة اختبار مرفوضة',
        sourceHash: '1'.repeat(64),
      },
    });
    await prisma.oracleItemMirror.create({
      data: {
        syncRunId: badRun.id,
        organizationId: organization.id,
        externalItemCode: 'BAD-ITEM',
        nameAr: 'صنف بلا وحدة',
        externalGroupCode: 'BAD',
        sourceHash: '2'.repeat(64),
      },
    });
    const rejected = await publication.publish(badRun.id);
    expect(rejected).toMatchObject({ published: false, status: 'rejected' });
    expect(rejected.validation.errorCount).toBeGreaterThan(0);
    await expect(prisma.oracleSyncIssue.count({ where: { syncRunId: badRun.id, severity: 'error' } }))
      .resolves.toBeGreaterThan(0);
    await expect(prisma.oracleInventoryActiveSnapshot.findUnique({
      where: { organizationId_sourceSchema: { organizationId: organization.id, sourceSchema: 'IAS20261' } },
    })).resolves.toMatchObject({ activeRunId: first.syncRunId });
    await expect(reader.items(actor, { status: 'all' })).resolves.toMatchObject({
      total: 1,
      snapshotRunId: first.syncRunId,
      items: [{ externalItemCode: 'ITEM-1' }],
    });
  });
});
