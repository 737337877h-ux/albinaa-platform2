import {
  collapseMobileTasksByCustomer,
  mobileInventorySummaryReference,
  mobileOracleReceiptCollection,
  mobileTaskBucket,
  MobileService,
} from './mobile.service';

describe('mobile Oracle receipt collections', () => {
  it('keeps a named receipt when Oracle request has no platform customer id', () => {
    const result = mobileOracleReceiptCollection({
      id: 'audit-16',
      entityId: '202600000100092100000000161',
      createdAt: '2026-09-06T14:17:16.804Z',
      newValue: {
        kind: 'voucher', requestKind: 'receipt', requestNo: '16',
        requestSerial: '202600000100092100000000161',
        recipientName: 'عبدالرحمن/اكسسوارات', amount: 1000, currencyCode: 'YER',
      },
    }, new Map());

    expect(result).toEqual(expect.objectContaining({
      customerId: null,
      customerName: 'عبدالرحمن/اكسسوارات',
      amount: 1000,
      currencyCode: 'YER',
    }));
  });
});

describe('mobile inventory offline summary', () => {
  it('keeps the published inventory valuation for SQLite instead of falling back to zero', () => {
    const result = mobileInventorySummaryReference({
      valuation: { totalInventoryCost: 2_656_351.48, totalPrimaryQuantity: 7_581 },
      counts: { items: 6_761 },
    }, null);
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'current',
      valuation: expect.objectContaining({ totalInventoryCost: 2_656_351.48 }),
    }));
  });

  it('uses the complete catalog summary when the lightweight summary is unavailable', () => {
    expect(mobileInventorySummaryReference(null, {
      valuation: { totalInventoryCost: 99 },
    })[0]).toEqual(expect.objectContaining({ valuation: { totalInventoryCost: 99 } }));
  });
});

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

describe('mobileTaskBucket', () => {
  it('classifies Prisma Date values without mixing upcoming tasks into overdue tasks', () => {
    expect(mobileTaskBucket(new Date('2026-08-28T00:00:00.000Z'), '2026-08-29')).toBe('overdue');
    expect(mobileTaskBucket(new Date('2026-08-29T00:00:00.000Z'), '2026-08-29')).toBe('today');
    expect(mobileTaskBucket(new Date('2026-08-30T00:00:00.000Z'), '2026-08-29')).toBe('upcoming');
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
      followup: { groupBy: jest.fn().mockResolvedValue([]) },
      paymentPromise: { groupBy: jest.fn().mockResolvedValue([]) },
      collection: { groupBy: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
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
        balances: [{ currencyCode: 'YER', accountingBalance: 4_000, lastImportJob: { importedAt } }],
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
    expect(result[0].balances).toEqual([{ currency: 'YER', balance: 3900 }]);
    expect(result[0].assignedCollectorName).toBe('المحصّل الأول');
  });

  it('excludes settled and small customers while retaining significant advance creditors', async () => {
    const { prisma, service } = createService();
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'settled', name: 'عميل صافي', customerType: null, assignments: [],
        balances: [{ currencyCode: 'YER', accountingBalance: 0, lastImportJob: null }],
      },
      {
        id: 'small', name: 'عميل بسيط', customerType: null, assignments: [],
        balances: [{ currencyCode: 'SAR', accountingBalance: 30, lastImportJob: null }],
      },
      {
        id: 'debtor', name: 'عميل مدين', customerType: null, assignments: [],
        balances: [{ currencyCode: 'USD', accountingBalance: 5.01, lastImportJob: null }],
      },
      {
        id: 'advance-creditor', name: 'سلفة دائنة', customerType: 'advance', assignments: [],
        balances: [{ currencyCode: 'YER', accountingBalance: -3_001, lastImportJob: null }],
      },
    ]);
    prisma.operationalLedger.findMany.mockResolvedValue([]);

    const result = await service.findCustomers(user);

    expect(result.map((item) => item.id)).toEqual(['debtor', 'advance-creditor']);
  });

  it('keeps the full scoped snapshot for offline dashboard totals', async () => {
    const { prisma, service } = createService();
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'settled', name: 'عميل صافي', customerType: null, assignments: [],
        balances: [{ currencyCode: 'YER', accountingBalance: 0, lastImportJob: null }],
      },
      {
        id: 'small', name: 'عميل بسيط', customerType: null, assignments: [],
        balances: [{ currencyCode: 'YER', accountingBalance: 2_500, lastImportJob: null }],
      },
      {
        id: 'debtor', name: 'عميل مدين', customerType: null, assignments: [],
        balances: [{ currencyCode: 'YER', accountingBalance: 5_000, lastImportJob: null }],
      },
    ]);
    prisma.operationalLedger.findMany.mockResolvedValue([]);

    const result = await service.findCustomers(user, false);

    expect(result.map((item) => item.id)).toEqual(['settled', 'small', 'debtor']);
  });

  it('marks customers contacted by a follow-up, promise, collection, or Oracle receipt request', async () => {
    const { prisma, service } = createService();
    prisma.customer.findMany.mockResolvedValue([
      { id: 'followed', organizationId: 'org-1', name: 'متابعة', customerType: null, assignments: [], balances: [] },
      { id: 'promised', organizationId: 'org-1', name: 'وعد', customerType: null, assignments: [], balances: [] },
      { id: 'collected', organizationId: 'org-1', name: 'تحصيل', customerType: null, assignments: [], balances: [] },
      { id: 'oracle-receipt', organizationId: 'org-1', name: 'سند قبض', customerType: null, assignments: [], balances: [] },
      { id: 'never', organizationId: 'org-1', name: 'دون تواصل', customerType: null, assignments: [], balances: [] },
    ]);
    prisma.operationalLedger.findMany.mockResolvedValue([]);
    prisma.followup.groupBy.mockResolvedValue([{ customerId: 'followed', _max: { followupAt: new Date('2026-08-01T10:00:00Z') } }]);
    prisma.paymentPromise.groupBy.mockResolvedValue([{ customerId: 'promised', _max: { createdAt: new Date('2026-08-02T10:00:00Z') } }]);
    prisma.collection.groupBy.mockResolvedValue([{ customerId: 'collected', _max: { collectedAt: new Date('2026-08-03T10:00:00Z') } }]);
    prisma.auditLog.findMany.mockResolvedValue([{
      id: 'audit-receipt', entityId: 'oracle-serial',
      createdAt: new Date('2026-08-04T10:00:00Z'),
      newValue: { kind: 'voucher', requestKind: 'receipt', platformCustomerId: 'oracle-receipt' },
    }]);

    const result = await service.findCustomers(user, false);

    expect(result.filter((item) => item.hasRecordedEngagement).map((item) => item.id))
      .toEqual(['followed', 'promised', 'collected', 'oracle-receipt']);
    expect(result.filter((item) => item.hasRecordedFollowup).map((item) => item.id)).toEqual(['followed']);
    expect(result.filter((item) => !item.hasRecordedFollowup).map((item) => item.id)).toEqual(['promised', 'collected', 'oracle-receipt', 'never']);
    expect(prisma.followup.groupBy).toHaveBeenCalledWith(expect.objectContaining({where:{customerId:{in:expect.any(Array)},deletedAt:null}}));
    expect(result.find((item) => item.id === 'never')).toEqual(expect.objectContaining({
      hasRecordedEngagement: false,
      lastEngagementAt: null,
    }));
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
