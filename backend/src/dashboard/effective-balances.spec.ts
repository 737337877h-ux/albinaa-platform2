import { effectiveBalances } from './effective-balances';
describe('batched effective balances', () => {
  it('queries once and preserves row/currency identity, null cutoff and signs', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([{ ordinal: 1, amount: '-5' }, { ordinal: 0, amount: '7' }]) };
    const rows = [
      { customerId: 'c1', currencyCode: 'YER', accountingBalance: '100', lastImportJob: null },
      { customerId: 'c1', currencyCode: 'SAR', accountingBalance: '20', lastImportJob: { importedAt: new Date('2026-09-08T00:00:00Z') } },
      { customerId: 'c2', currencyCode: 'USD', accountingBalance: '-10', lastImportJob: null },
    ];
    const result = await effectiveBalances(db as any, rows);
    expect(result.map(r => r.effectiveBalance)).toEqual([107, 15, -10]);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const query = db.$queryRaw.mock.calls[0][0];
    expect(query.sql).toContain('l.created_at > b.imported_at');
    expect(JSON.parse(query.values[0]).map((r: any) => r.imported_at)).toEqual([null, '2026-09-08T00:00:00.000Z', null]);
  });
  it('skips empty scopes', async () => {
    const db = { $queryRaw: jest.fn() };
    expect(await effectiveBalances(db as any, [])).toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
