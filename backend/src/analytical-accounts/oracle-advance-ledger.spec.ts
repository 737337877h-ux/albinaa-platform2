import { validateAdvanceStatement, AdvanceStatement, reconcileApprovedAdvanceOpening } from './oracle-advance-ledger';
import { OracleAdvanceLedgerService } from './oracle-advance-ledger.service';

const report = (): AdvanceStatement => ({ currency: 'YER', source: 'oracle_archive', openingBalance: 11445000,
  periodStartBalance: 11445000, periodEndBalance: 11670000, currentBalance: 11670000, accountingBalance: 11670000,
  equationClosed: true, totalDebit: 225000, totalCredit: 0, readAt: '2026-09-17T00:00:00Z', coverageStart: '2020-01-01',
  balanceAsOf: '2026-12-31', page: 1, limit: 1, total: 1, totalPages: 1,
  items: [{ id: '202600000100001001000014241-1', date: '2026-09-15', documentType: 'قيد يومية',
    documentNumber: '4241', reference: null, description: null, debit: 225000, credit: 0, runningBalance: 11670000 }] });

describe('advance ledger reconciliation', () => {
  it('reconciles the reported 225,000 variance without adding the closing balance twice', () => {
    expect(validateAdvanceStatement(report(), 11670000)).toHaveLength(64);
  });
  it('ignores read timestamp for idempotency', () => {
    expect(validateAdvanceStatement(report(), 11670000)).toBe(validateAdvanceStatement({ ...report(), readAt: '2026-09-18T00:00:00Z' }, 11670000));
  });
  it.each([
    ['incomplete', (r: AdvanceStatement) => { r.total = 2; }],
    ['non-finite', (r: AdvanceStatement) => { r.items[0].debit = NaN; }],
    ['negative', (r: AdvanceStatement) => { r.items[0].credit = -1; }],
    ['running mismatch', (r: AdvanceStatement) => { r.items[0].runningBalance++; }],
    ['closing mismatch', (r: AdvanceStatement) => { r.periodEndBalance++; }],
    ['outside year', (r: AdvanceStatement) => { r.items[0].date = '2025-12-31'; }],
  ])('rejects %s before publication', (_name, mutate) => {
    const r = report(); mutate(r); expect(() => validateAdvanceStatement(r, 11670000)).toThrow();
  });
  it('rejects a snapshot taken across an Oracle posting change', () => {
    expect(() => validateAdvanceStatement(report(), 11445000)).toThrow('Oracle balance');
  });
  it('handles exact decimal credits and negative balances', () => {
    const r = report(); Object.assign(r, { openingBalance: 0.1, periodEndBalance: -0.2 });
    Object.assign(r.items[0], { debit: 0, credit: 0.3, runningBalance: -0.2 });
    expect(validateAdvanceStatement(r, -0.2)).toHaveLength(64);
  });
  it('dry run reads and reconciles without a database transaction', async () => {
    const db = { systemSetting: { findUnique: jest.fn().mockResolvedValue(null) }, currency: { findMany: jest.fn().mockResolvedValue([{ code: 'YER' }]) }, customer: { findMany: jest.fn().mockResolvedValue([]) }, $transaction: jest.fn() };
    const reader = { read: jest.fn().mockResolvedValue({ schema: 'IAS20261', accounts: [{ accountNumber: '20011', sourceAccountCode: '113101002', analyticalType: 5, currencyCode: 'YER', balance: 11670000 }] }) };
    const statements = { read: jest.fn().mockResolvedValue(report()) };
    const result = await new OracleAdvanceLedgerService(db as any, reader as any, statements as any).sync({ organizationId: 'org' } as any, true);
    expect(result.issues).toEqual([]); expect(result.status).toBe('dry_run'); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('does not publish a failed or unreconciled source', async () => {
    const db = { systemSetting: { findUnique: jest.fn().mockResolvedValue(null) }, currency: { findMany: jest.fn().mockResolvedValue([{ code: 'YER' }]) }, customer: { findMany: jest.fn().mockResolvedValue([]) }, $transaction: jest.fn() };
    const reader = { read: jest.fn().mockResolvedValue({ schema: 'IAS20261', accounts: [{ accountNumber: '20011', sourceAccountCode: '113101002', analyticalType: 5, currencyCode: 'YER', balance: 1 }] }) };
    const result = await new OracleAdvanceLedgerService(db as any, reader as any, { read: async () => report() } as any).sync({ organizationId: 'org' } as any, false);
    expect(result.status).toBe('partial'); expect(result.issues).toHaveLength(1); expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('reviewed Oracle opening reconciliation', () => {
  const approval = { sourceOpening: 11445000, adjustment: -35000, approvedBy: 'reviewer', approvedAt: '2026-09-17T00:00:00Z', reason: 'Reviewed Oracle balance' };
  it('adjusts only opening and running balances without inventing or changing movements', () => {
    const source = report(), adjusted = reconcileApprovedAdvanceOpening(source, 11635000, approval);
    expect(adjusted.openingBalance).toBe(11410000);
    expect(adjusted.items[0].debit).toBe(source.items[0].debit);
    expect(adjusted.items[0].credit).toBe(source.items[0].credit);
    expect(adjusted.total).toBe(source.total);
    expect(adjusted.items[0].runningBalance).toBe(11635000);
    expect(source.periodEndBalance).toBe(11670000);
    expect(validateAdvanceStatement(adjusted, 11635000)).toHaveLength(64);
  });
  it('does not apply approval when Oracle sources already reconcile', () => {
    const source = report(); expect(reconcileApprovedAdvanceOpening(source, 11670000, approval)).toBe(source);
  });
  it('leaves an unapproved account subject to the normal reconciliation check', () => {
    expect(() => validateAdvanceStatement(reconcileApprovedAdvanceOpening(report(), 11635000), 11635000)).toThrow();
  });
  it('rejects a new variance beyond the approved amount', () => {
    expect(() => reconcileApprovedAdvanceOpening(report(), 11600000, approval)).toThrow('beyond');
  });
  it('rejects a changed source opening', () => {
    expect(() => reconcileApprovedAdvanceOpening(report(), 11635000, { ...approval, sourceOpening: 1 })).toThrow('beyond');
  });
  it('does not use approval to hide incomplete movements', () => {
    expect(() => reconcileApprovedAdvanceOpening({ ...report(), total: 2 }, 11635000, approval)).toThrow('Incomplete');
  });
});
