import { CustomersService } from './customers.service';

describe('statement account access', () => {
  it('does not replace the no-access scope with the requested account ID', async () => {
    const prisma = { collector: { findUnique: jest.fn().mockResolvedValue(null) },
      customer: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new CustomersService(prisma as any, {} as any, {} as any);
    const user = { id: 'user', organizationId: 'org', permissions: ['customers.read', 'balances.read'], roles: [] };
    await expect(service.statement(user as any, 'target', { currency: 'YER', source: 'oracle_archive' })).rejects.toThrow('صلاحيتك');
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({ where: { AND: [{ organizationId: 'org', id: 'no-access' }, { id: 'target' }] } });
  });
});
