import { PrismaService } from '../prisma/prisma.service';
import { OracleInventorySnapshotService } from './oracle-inventory-snapshot.service';
import { OracleInventorySyncService } from './oracle-inventory-sync.service';

describe('OracleInventorySyncService', () => {
  it('uses dry-run by default contract without touching PostgreSQL', async () => {
    const prisma = new Proxy({}, {
      get() {
        throw new Error('Database access is forbidden during dry-run');
      },
    }) as PrismaService;
    const snapshot = {
      sourceSchema: 'IAS20261',
      generatedAt: new Date('2026-08-15T01:00:00Z'),
      manifestHash: '0'.repeat(64),
      sourceCounts: { items: 1 },
      validationSummary: { passed: true },
      itemGroups: [],
      items: [],
      itemUnits: [],
      warehouseGroups: [],
      warehouses: [],
      stockBalances: [],
    };
    const snapshots = { inspect: jest.fn().mockResolvedValue(snapshot) } as unknown as OracleInventorySnapshotService;
    const service = new OracleInventorySyncService(prisma, snapshots);

    await expect(service.run({
      snapshotDirectory: 'fixture',
      organizationId: '00000000-0000-0000-0000-000000000001',
      apply: false,
    })).resolves.toMatchObject({ applied: false, syncRunId: null, status: 'validated_dry_run' });
  });
});
