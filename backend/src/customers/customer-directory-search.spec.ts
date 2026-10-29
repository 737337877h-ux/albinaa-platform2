import { CustomersService } from './customers.service';

describe('customer directory search balance visibility', () => {
  const actor = { id: 'user', organizationId: 'org', roles: [], permissions: ['customers.read_all'] } as any;
  function setup(collector: any = null) {
    const prisma = {
      collector: { findUnique: jest.fn().mockResolvedValue(collector) },
      customer: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, service: new CustomersService(prisma as any, {} as any, {} as any) };
  }
  it('includes zero and credit accounts in explicit name/code search', async () => {
    const { service, prisma } = setup();
    await service.findAll(actor, { search: 'العميل التجريبي الثاني' } as any);
    const where = prisma.customer.findMany.mock.calls[0][0].where;
    expect(where.balances).toBeUndefined();
    expect(where.organizationId).toBe('org');
    expect(where.AND).toHaveLength(4);
  });
  it.each([{}, { search: '20566', currency: 'YER' }, { search: '20566', balanceState: 'debtor' }, { search: '20566', excludeZero: true }])('preserves default and explicit financial filters %j', async (query) => {
    const { service, prisma } = setup();
    await service.findAll(actor, query as any);
    expect(prisma.customer.findMany.mock.calls[0][0].where.balances).toBeDefined();
  });
  it('does not widen collector permissions when searching', async () => {
    const { service, prisma } = setup({ id: 'collector' });
    await service.findAll({ ...actor, roles: ['المحصل'], permissions: [] }, { search: '20566' } as any);
    expect(prisma.customer.findMany.mock.calls[0][0].where.assignments).toEqual({ some: { collectorId: 'collector', effectiveTo: null } });
  });
});
