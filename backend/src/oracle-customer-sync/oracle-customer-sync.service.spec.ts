import { OracleCustomerSyncService } from './oracle-customer-sync.service';

describe('OracleCustomerSyncService platform comparison', () => {
  it('normalizes Oracle currency aliases and excludes advance accounts', async () => {
    const prisma = {
      customer: {
        findMany: jest.fn().mockResolvedValue([
          { externalCustomerCode: '30001', name: 'عميل', status: 'active', accountNumber: '1101' },
          { externalCustomerCode: 'ADV-30001', name: 'سلفة', status: 'active', accountNumber: '2101' },
        ]),
      },
      customerBalance: {
        findMany: jest.fn().mockResolvedValue([
          { currencyCode: 'YER', customer: { externalCustomerCode: '30001' } },
          { currencyCode: 'USD', customer: { externalCustomerCode: '30001' } },
          { currencyCode: 'YER', customer: { externalCustomerCode: 'ADV-30001' } },
        ]),
      },
    };
    const service = new OracleCustomerSyncService(prisma as never, {} as never);
    const snapshot = {
      customers: [{
        externalCustomerCode: '30001', nameAr: 'عميل', isInactive: false, accountNumber: '1101',
      }],
      customerBalances: [
        { externalCustomerCode: '30001', currencyCode: 'YR' },
        { externalCustomerCode: '30001', currencyCode: '$' },
      ],
    };

    const result = await (service as never as {
      compareWithPlatform(snapshot: unknown, organizationId: string): Promise<Record<string, unknown>>;
    }).compareWithPlatform(snapshot, '00000000-0000-0000-0000-000000000001');

    expect(result).toMatchObject({
      oracleCustomers: 1,
      platformCustomers: 1,
      platformAdvanceAccounts: 1,
      platformOnlyCustomers: 0,
      oracleBalancePairs: 2,
      platformBalancePairs: 2,
      normalizedCurrencyBalancePairs: 2,
      advancesExcluded: true,
    });
  });
});
