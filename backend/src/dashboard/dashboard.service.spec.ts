import { buildCustomerAlerts, DashboardService, findComparablePreviousImport, findLatestComparableImportPair, summarizeDebtChange } from './dashboard.service';
import { REFRESHED_DAILY_TASK_TYPES } from '../tasks/tasks.service';

const importedAt = new Date('2026-08-10T00:00:00Z');
const snap = (customerId: string, currencyCode: string, balance: number) =>
  ({
    customerId,
    currencyCode,
    balance,
    customer: { id: customerId, name: `Customer ${customerId}`, externalCustomerCode: `CODE-${customerId}` },
  });

describe('dashboard debt change comparison', () => {
  it('keeps generated daily recommendations out of the navigation task badge', async () => {
    const prisma = {
      task: { count: jest.fn().mockResolvedValue(3) },
      followup: { count: jest.fn().mockResolvedValue(0) },
      paymentPromise: { count: jest.fn().mockResolvedValue(0) },
      collector: { findUnique: jest.fn() },
    };
    const service = new DashboardService(prisma as any, {} as any);

    await service.navCounts({
      id: 'admin', organizationId: 'org-1', permissions: ['customers.read_all'],
    } as any);

    expect(prisma.task.count).toHaveBeenCalledWith({
      where: {
        status: 'open',
        taskType: { notIn: [...REFRESHED_DAILY_TASK_TYPES] },
        customer: { organizationId: 'org-1' },
      },
    });
  });

  it('separates actionable unassigned customers from customers created in the last seven days', () => {
    const since = new Date('2026-08-24T00:00:00Z');
    const alerts = buildCustomerAlerts([
      { id: 'old-unassigned', name: 'قديم', externalCustomerCode: '10', createdAt: new Date('2026-08-01T00:00:00Z'), assigned: false },
      { id: 'new-assigned', name: 'جديد مسند', externalCustomerCode: '20', createdAt: new Date('2026-08-30T00:00:00Z'), assigned: true },
      { id: 'new-unassigned', name: 'جديد غير مسند', externalCustomerCode: '30', createdAt: new Date('2026-08-31T00:00:00Z'), assigned: false },
    ], since);

    expect(alerts.unassigned.count).toBe(2);
    expect(alerts.unassigned.items.map((item) => item.id)).toEqual(['new-unassigned', 'old-unassigned']);
    expect(alerts.newCustomers.count).toBe(2);
    expect(alerts.newCustomers.items.map((item) => item.id)).toEqual(['new-unassigned', 'new-assigned']);
  });

  it('skips an unrelated advances-sized import and selects the comparable customer portfolio', () => {
    const latest = {
      id: 'latest', importedAt, fileName: 'customers-new.xlsx',
      snapshots: [snap('a', 'YER', 120), snap('b', 'YER', 40), snap('c', 'SAR', 15), snap('d', 'USD', 5)],
    };
    const advances = {
      id: 'advances', importedAt, fileName: 'advances.xlsx',
      snapshots: [snap('a', 'YER', 999)],
    };
    const previousCustomers = {
      id: 'previous', importedAt, fileName: 'customers-old.xlsx',
      snapshots: [snap('a', 'YER', 100), snap('b', 'YER', 50), snap('c', 'SAR', 10), snap('d', 'USD', 5)],
    };

    expect(findComparablePreviousImport(latest, [advances, previousCustomers])?.id).toBe('previous');
  });

  it('reports net change separately from positive increases and decreases', () => {
    const result = summarizeDebtChange(
      [snap('a', 'YER', 120), snap('b', 'YER', 0), snap('d', 'USD', 800)],
      [snap('a', 'YER', 100), snap('b', 'YER', 50), snap('c', 'SAR', 10)],
    );

    expect(result.YER).toMatchObject({
      amount: -30,
      netChange: -30,
      positiveIncreases: 20,
      decreases: 50,
      accounts: 1,
      affectedCount: 2,
      newDebtors: 0,
    });
    expect(result.YER.affectedAccounts).toEqual([
      expect.objectContaining({ customerId: 'b', customerCode: 'CODE-b', change: -50, direction: 'decrease' }),
      expect.objectContaining({ customerId: 'a', customerName: 'Customer a', change: 20, direction: 'increase' }),
    ]);
    expect(result.SAR).toMatchObject({ netChange: -10, positiveIncreases: 0, decreases: 10 });
    expect(result.USD).toMatchObject({ netChange: 800, positiveIncreases: 800, newDebtors: 1 });
  });

  it('uses the final ordered snapshot when one account was updated twice in an import', () => {
    const result = summarizeDebtChange(
      [snap('a', 'YER', 90), snap('a', 'YER', 120)],
      [snap('a', 'YER', 80), snap('a', 'YER', 100)],
    );

    expect(result.YER).toMatchObject({ netChange: 20, positiveIncreases: 20 });
  });

  it('returns no comparable import when portfolio overlap is below half', () => {
    const latest = {
      id: 'latest', importedAt, fileName: 'customers.xlsx',
      snapshots: [snap('a', 'YER', 1), snap('b', 'YER', 1), snap('c', 'YER', 1)],
    };
    const unrelated = {
      id: 'unrelated', importedAt, fileName: 'other.xlsx',
      snapshots: [snap('x', 'YER', 1), snap('y', 'YER', 1)],
    };

    expect(findComparablePreviousImport(latest, [unrelated])).toBeNull();
  });

  it('excludes newer partial correction batches from the homogeneous pair', () => {
    const partialNew = { id: 'partial-new', importedAt, fileName: 'delta.csv', snapshots: [snap('a', 'YER', 9)] };
    const partialOld = { id: 'partial-old', importedAt, fileName: 'correction.csv', snapshots: [snap('a', 'YER', 8)] };
    const fullNew = {
      id: 'full-new', importedAt, fileName: 'customers-new.xlsx',
      snapshots: [snap('a', 'YER', 10), snap('b', 'YER', 20), snap('c', 'YER', 30), snap('d', 'YER', 40)],
    };
    const fullOld = {
      id: 'full-old', importedAt, fileName: 'customers-old.xlsx',
      snapshots: [snap('a', 'YER', 8), snap('b', 'YER', 19), snap('c', 'YER', 28), snap('d', 'YER', 40)],
    };

    const pair = findLatestComparableImportPair([partialNew, partialOld, fullNew, fullOld]);
    expect(pair.latest?.id).toBe('full-new');
    expect(pair.previous?.id).toBe('full-old');
  });
});

it('keeps debt-change sync fail-closed for an account without a collector',async()=>{
 const prisma:any={collector:{findUnique:jest.fn().mockResolvedValue(null)},customerBalance:{findMany:jest.fn().mockResolvedValue([])}};
 await new DashboardService(prisma,{} as any).debtChangeLast24Hours({id:'user',organizationId:'org',permissions:[]} as any);
 expect(prisma.customerBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{customer:expect.objectContaining({organizationId:'org',assignments:{some:{collectorId:{in:[]},effectiveTo:null}}})}}));
});
