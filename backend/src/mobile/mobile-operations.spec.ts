import { MobileService } from './mobile.service';

describe('operations sync is separate from collection sync', () => {
  function setup() {
    const findMany = () => jest.fn().mockResolvedValue([]);
    const prisma: any = Object.fromEntries(['customer', 'task', 'followup', 'paymentPromise', 'collection', 'auditLog', 'reservation', 'currency', 'collectionMethod', 'followupType', 'followupResult', 'unit'].map(k => [k, { findMany: findMany() }]));
    prisma.collector = { findUnique: jest.fn().mockResolvedValue({ id: 'collector-1' }) };
    prisma.oracleMovementSyncRun = { findFirst: jest.fn().mockResolvedValue(null) };
    const service = new MobileService(prisma);
    prisma.customer.findMany.mockResolvedValue([{ id: 'customer-1', name: 'ط¹ظ…ظٹظ„', accountNumber: '10001', externalCustomerCode: '10001', phonePrimary: null, phoneSecondary: null, whatsapp: null }]);
    return { prisma, service };
  }
  const user: any = { id: 'u1', organizationId: 'org1', permissions: ['customers.read_all', 'customers.read', 'balances.read', 'sales_order_drafts.read', 'tasks.manage', 'followups.create', 'promises.create', 'collections.create', 'reservations.read'] };
  it('returns an allowlisted customer directory without querying collection activity', async () => {
    const { prisma, service } = setup();
    const snapshot = await service.sync(user, undefined, true);
    expect(snapshot.customers).toEqual([{ id: 'customer-1', fullName: 'ط¹ظ…ظٹظ„', accountNumber: '10001', externalCustomerCode: '10001', phonePrimary: null, phoneSecondary: null, whatsapp: null }]);
    expect(prisma.customer.findMany.mock.calls[0][0]).toMatchObject({ where: { organizationId: 'org1', status: 'active' }, select: { id: true, name: true } });
    expect(prisma.customer.findMany.mock.calls[0][0].select.balances).toBeUndefined();
    for (const model of ['task', 'followup', 'paymentPromise', 'collection', 'auditLog', 'collectionMethod', 'followupType', 'followupResult']) expect(prisma[model].findMany).not.toHaveBeenCalled();
    expect(snapshot.tasks).toEqual([]); expect(snapshot.collections).toEqual([]); expect(snapshot.newDebt).toBeNull(); expect(snapshot.customerAlerts).toBeNull();
    expect(snapshot.references).not.toHaveProperty('oracleReceiptCatalog');
  });
  it('preserves the assigned-customer scope for an ordinary operator', async () => {
    const { prisma, service } = setup();
    await service.sync({ ...user, permissions: ['sales_order_drafts.manage'] }, undefined, true);
    expect(prisma.customer.findMany.mock.calls[0][0].where.assignments).toEqual({ some: { collectorId: 'collector-1', effectiveTo: null } });
  });
  it('does not download customers for an employee-only account', async () => {
    const { prisma, service } = setup();
    const snapshot = await service.sync({ ...user, permissions: [] }, undefined, true);
    expect(prisma.customer.findMany).not.toHaveBeenCalled(); expect(snapshot.customers).toEqual([]);
  });
  it('preserves collection activity including permitted reservations but omitting inventory in the split collector', async()=>{
    const {prisma,service}=setup();prisma.customer.findMany.mockResolvedValue([]);
    const inventory={offlineReferenceCatalog:jest.fn(),summary:jest.fn()};(service as any).oracleInventory=inventory;
    const snapshot=await service.sync({...user,permissions:[...user.permissions,'reports.read']},undefined,false,true);
    expect(prisma.task.findMany).toHaveBeenCalled();expect(prisma.collection.findMany).toHaveBeenCalled();
    expect(prisma.reservation.findMany).toHaveBeenCalled();expect(inventory.offlineReferenceCatalog).not.toHaveBeenCalled();expect(inventory.summary).not.toHaveBeenCalled();
    expect(snapshot.reservations).toEqual([]);expect(snapshot.references).not.toHaveProperty('oracleItems');
  });
});
