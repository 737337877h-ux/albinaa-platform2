import { MobileService } from './mobile.service';

describe('MobileService customer snapshot', () => {
  const user = {
    id: 'user-1',
    organizationId: 'org-1',
    permissions: ['customers.read_all'],
  } as any;

  function createService() {
    const prisma = {
      customer: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      collector: { findUnique: jest.fn() },
      operationalLedger: { findMany: jest.fn() },
    };
    return { prisma, service: new MobileService(prisma as any) };
  }

  it('syncs active accounts only and applies ledger entries after the balance import', async () => {
    const { prisma, service } = createService();
    const importedAt = new Date('2026-08-01T00:00:00.000Z');
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'customer-1',
        name: 'عميل اختبار',
        accountNumber: '10001',
        externalCustomerCode: '10001',
        customerType: null,
        phonePrimary: null,
        phoneSecondary: null,
        whatsapp: null,
        address: null,
        geoLat: null,
        geoLng: null,
        assignments: [{ collector: { user: { fullName: 'المحصّل الأول' } } }],
        balances: [{ currencyCode: 'YER', accountingBalance: 1_000, lastImportJob: { importedAt } }],
      },
    ]);
    prisma.operationalLedger.findMany.mockResolvedValue([
      { customerId: 'customer-1', currencyCode: 'YER', amountSigned: -25, createdAt: new Date('2026-07-31T23:00:00.000Z') },
      { customerId: 'customer-1', currencyCode: 'YER', amountSigned: -100, createdAt: new Date('2026-08-02T00:00:00.000Z') },
    ]);

    const result = await service.findCustomers(user);

    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', status: 'active' },
    }));
    expect(result).toHaveLength(1);
    expect(result[0].balances).toEqual([{ currency: 'YER', balance: 900 }]);
    expect(result[0].assignedCollectorName).toBe('المحصّل الأول');
  });

  it('keeps collector assignment scope while excluding merged accounts', async () => {
    const { prisma, service } = createService();
    prisma.collector.findUnique.mockResolvedValue({ id: 'collector-1' });
    prisma.customer.findMany.mockResolvedValue([]);

    await service.findCustomers({ ...user, permissions: [] });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: 'org-1',
        assignments: { some: { collectorId: 'collector-1', effectiveTo: null } },
        status: 'active',
      },
    }));
    expect(prisma.operationalLedger.findMany).not.toHaveBeenCalled();
  });

  it('allows a collector to update contact fields for an actively assigned customer', async () => {
    const { prisma, service } = createService();
    prisma.collector.findUnique.mockResolvedValue({ id: 'collector-1' });
    prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
    prisma.customer.update.mockResolvedValue({ id: 'customer-1' });

    const result = await service.updateCustomerField(
      { ...user, permissions: [] },
      'customer-1',
      { phonePrimary: '777123456' },
    );

    expect(prisma.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'customer-1',
        organizationId: 'org-1',
        assignments: { some: { collectorId: 'collector-1', effectiveTo: null } },
      }),
    }));
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { phonePrimary: '777123456' },
    });
    expect(result).toEqual({ id: 'customer-1', updated: true });
  });
});
