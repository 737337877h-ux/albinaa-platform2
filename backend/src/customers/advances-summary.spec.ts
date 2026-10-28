import { CustomersService } from './customers.service';

describe('CustomersService advancesSummary', () => {
  it('uses post-import operational movements and keeps the materiality policy', async () => {
    const importedAt = new Date('2026-09-01T00:00:00.000Z');
    const prisma = {
      collector: { findUnique: jest.fn().mockResolvedValue(null) },
      customer: { findMany: jest.fn().mockResolvedValue([
        {
          id: 'advance-small',
          balances: [{ currencyCode: 'YER', accountingBalance: 4_000, lastImportJob: { importedAt } }],
        },
        {
          id: 'advance-visible',
          balances: [{ currencyCode: 'YER', accountingBalance: 5_000, lastImportJob: { importedAt } }],
        },
      ]) },
      operationalLedger: { findMany: jest.fn().mockResolvedValue([
        {
          customerId: 'advance-small', currencyCode: 'YER', amountSigned: -1_500,
          createdAt: new Date('2026-09-01T01:00:00.000Z'),
        },
        {
          customerId: 'advance-visible', currencyCode: 'YER', amountSigned: -500,
          createdAt: new Date('2026-08-31T23:00:00.000Z'),
        },
      ]) },
    };
    const service = new CustomersService(prisma as any, {} as any, {} as any);

    const result = await service.advancesSummary({
      id: 'user-1', organizationId: 'org-1', roles: [], permissions: ['customers.read_all'],
    } as any);

    expect(result).toEqual({
      accounts: 1,
      byCurrency: {
        YER: {
          accounts: 1,
          debtorAccounts: 1,
          debtorBalance: 5_000,
          creditorAccounts: 0,
          creditorBalance: 0,
          netBalance: 5_000,
        },
      },
    });
  });
});
