import { CollectionsService } from './collections.service';
import { FollowupsService } from '../followups/followups.service';
import { oracleReceiptActivity } from '../common/oracle-receipt-activity';

jest.mock('../common/oracle-receipt-activity', () => ({ oracleReceiptActivity: jest.fn() }));
const user = { id: 'admin', organizationId: 'org', permissions: ['customers.read_all'] } as any;

describe('customer-scoped activity', () => {
  const direct = (customerId: string, amount: number) => ({
    id: customerId, customerId, amount, currencyCode: 'YER', collectedAt: '2026-09-07T00:00:00Z',
  });
  function setup() {
    const prisma: any = {
      collection: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
      followup: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      collector: { findUnique: jest.fn().mockResolvedValue({ id: 'collector' }) },
    };
    (oracleReceiptActivity as jest.Mock).mockResolvedValue([direct('customer-a', 100), direct('customer-b', 900)]);
    return prisma;
  }
  it('filters Oracle rows, count and totals to the requested customer', async () => {
    const prisma = setup();
    const service = new CollectionsService(prisma, {} as any, {} as any, {} as any);
    const result = await service.findAll(user, { customerId: 'customer-a' });
    expect(result.items.map(r => r.customerId)).toEqual(['customer-a']);
    expect(result.total).toBe(1);
    expect(result.totalsByCurrency).toEqual({ YER: 100 });
    for (const fn of Object.values(prisma.collection) as jest.Mock[]) {
      expect(fn.mock.calls[0][0].where).toMatchObject({ customerId: 'customer-a', customer: { organizationId: 'org' } });
    }
    const empty = await service.findAll(user, { customerId: 'unknown' });
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.totalsByCurrency).toEqual({});
  });
  it('keeps the general collections list unfiltered', async () => {
    const result = await new CollectionsService(setup(), {} as any, {} as any, {} as any).findAll(user, {});
    expect(result.total).toBe(2);
    expect(result.totalsByCurrency).toEqual({ YER: 1000 });
  });
  it.each([user, { ...user, permissions: [] }])('retains followup customer and permission scope', async actor => {
    const prisma = setup();
    const service = new FollowupsService(prisma, {} as any);
    await service.findAll(actor, { customerId: 'customer-a' });
    for (const fn of Object.values(prisma.followup) as jest.Mock[]) {
      const where = fn.mock.calls[0][0].where;
      expect(where).toMatchObject({ customerId: 'customer-a', deletedAt: null, customer: { organizationId: 'org' } });
      if (!actor.permissions.length) expect(where.customer.assignments.some.collectorId).toBe('collector');
    }
  });
});
