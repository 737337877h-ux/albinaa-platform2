import { collapseMobileTasksByCustomer, MobileService } from './mobile.service';

describe('collapseMobileTasksByCustomer', () => {
  it('keeps one task per customer and selects the highest priority task', () => {
    const result = collapseMobileTasksByCustomer([
      { id: 'normal-new', customerId: 'c1', taskType: 'followup_normal', dueDate: '2026-08-16' },
      { id: 'high-old', customerId: 'c1', taskType: 'high_balance_no_followup', dueDate: '2026-08-12' },
      { id: 'other', customerId: 'c2', taskType: 'followup_normal', dueDate: '2026-08-16' },
    ]);

    expect(result.map((task) => task.id)).toEqual(['high-old', 'other']);
  });

  it('selects the newest task when the priority is the same', () => {
    const result = collapseMobileTasksByCustomer([
      { id: 'older', customerId: 'c1', taskType: 'high_balance_no_followup', dueDate: '2026-08-12' },
      { id: 'newer', customerId: 'c1', taskType: 'high_balance_no_followup', dueDate: '2026-08-16' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('newer');
  });
});

describe('MobileService customer snapshot', () => {
  const user = {
    id: 'user-1',
    organizationId: 'org-1',
    permissions: ['customers.read_all'],
  } as any;

  function createService() {
    const prisma = {
      customer: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      customerAccountLink: { findMany: jest.fn().mockResolvedValue([]) },
      customerBalance: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('shows balances only for customers assigned to the delivery representative', async () => {
    const { prisma, service } = createService();
    prisma.collector.findUnique.mockResolvedValue({ id: 'collector-1' });
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'customer-1', name: 'عميل توصيل مسند', accountNumber: '10001', externalCustomerCode: '10001',
        geoLat: 15.3, geoLng: 44.2, assignments: [{ collectorId: 'collector-1', collector: { user: { fullName: 'مندوب' } } }],
        balances: [{ currencyCode: 'YER', accountingBalance: 5000, lastImportJob: null }],
      },
      {
        id: 'customer-2', name: 'عميل غير مسند', accountNumber: '10002', externalCustomerCode: '10002',
        geoLat: 15.4, geoLng: 44.3, assignments: [], balances: [{ currencyCode: 'YER', accountingBalance: 9000, lastImportJob: null }],
      },
    ]);
    prisma.operationalLedger.findMany.mockResolvedValue([]);

    const result = await service.findCustomers({
      ...user,
      permissions: ['mobile.delivery.customers.view_all_no_balance'],
    });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', status: 'active' },
      include: expect.objectContaining({ balances: expect.any(Object) }),
    }));
    expect(result[0]).toEqual(expect.objectContaining({
      balanceHidden: false,
      balances: [{ currency: 'YER', balance: 5000 }],
      geoLat: 15.3,
      geoLng: 44.2,
    }));
    expect(result[1]).toEqual(expect.objectContaining({ balanceHidden: true, balances: [] }));
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
