import { OracleInventoryReadService } from './oracle-inventory-read.service';

describe('published inventory catalog revisions', () => {
  const actor = { organizationId: 'org', permissions: [] } as any;
  function setup(run = 'run-b', status = 'published') {
    const prisma = {
      oracleInventoryActiveSnapshot: { findMany: jest.fn().mockResolvedValue([{ activeRunId: run, sourceSchema: 'IAS20261', activeRun: { status, publishedAt: new Date() } }]) },
      oracleMovementSyncRun: { findFirst: jest.fn().mockResolvedValue(null) },
      oracleWarehouseMirror: { findMany: jest.fn().mockResolvedValue([]) },
      oracleItemMirror: { findMany: jest.fn().mockResolvedValue([{ externalItemCode: 'item-1', nameAr: 'New name', units: [], group: null }]) },
      oracleInventoryMovementMirror: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, service: new OracleInventoryReadService(prisma as any, {} as any) };
  }
  it('returns renamed items for a newer snapshot without relying on a sync date', async () => {
    const { service } = setup();
    const result = await service.offlineReferenceCatalog(actor, 'IAS20261', 'IAS20261:run-a:none:standard');
    expect(result.catalogVersion).toBe('IAS20261:run-b:none:standard');
    expect((result as any).items[0].nameAr).toBe('New name');
  });
  it('does not download the large catalog again when the published revision is unchanged', async () => {
    const { prisma, service } = setup();
    expect(await service.offlineReferenceCatalog(actor, 'IAS20261', 'IAS20261:run-b:none:standard')).toEqual({ catalogVersion: 'IAS20261:run-b:none:standard' });
    expect(prisma.oracleItemMirror.findMany).not.toHaveBeenCalled();
    expect(prisma.oracleInventoryMovementMirror.findMany).not.toHaveBeenCalled();
  });
  it('refreshes movement-based prices after a completed movement revision changes', async () => {
    const { prisma, service } = setup();
    prisma.oracleMovementSyncRun.findFirst.mockResolvedValue({ id: 'movements-b' } as any);
    const result = await service.offlineReferenceCatalog(actor, 'IAS20261', 'IAS20261:run-b:movements-a:standard');
    expect(result.catalogVersion).toBe('IAS20261:run-b:movements-b:standard');
    expect(result).toHaveProperty('items');
    expect(prisma.oracleMovementSyncRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['validated', 'published'] } }),
    }));
  });
  it('refreshes legacy clients and refreshes cost data when visibility changes', async () => {
    const { service } = setup();
    expect(await service.offlineReferenceCatalog(actor)).toHaveProperty('items');
    const result = await service.offlineReferenceCatalog({ ...actor, permissions: ['mobile.inventory.cost.view'] }, 'IAS20261', 'IAS20261:run-b:none:standard');
    expect(result.catalogVersion).toBe('IAS20261:run-b:none:cost');
    expect(result).toHaveProperty('items');
  });
  it('scopes the revision to the organization and rejects unpublished snapshots', async () => {
    const { prisma, service } = setup();
    expect(await service.catalogVersion(actor, 'IAS20261')).toMatchObject({ version: 'run-b' });
    expect(prisma.oracleInventoryActiveSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org', sourceSchema: 'IAS20261' } }));
    await expect(setup('run-c', 'validating').service.catalogVersion(actor, 'IAS20261')).rejects.toThrow('not published');
  });
});
