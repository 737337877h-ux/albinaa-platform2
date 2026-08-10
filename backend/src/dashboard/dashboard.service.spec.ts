import { findComparablePreviousImport, summarizeDebtChange } from './dashboard.service';

const importedAt = new Date('2026-08-10T00:00:00Z');
const snap = (customerId: string, currencyCode: string, balance: number) =>
  ({
    customerId,
    currencyCode,
    balance,
    customer: { id: customerId, name: `Customer ${customerId}`, externalCustomerCode: `CODE-${customerId}` },
  });

describe('dashboard debt change comparison', () => {
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
});
