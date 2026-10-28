import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FinancialTaskReview, SETTLED_FINANCIAL_TASK_TYPES, SettledFinancialTasksService,
  settledFinancialTaskExclusion,
} from './settled-financial-tasks.service';

const organizationId = 'organization';
const taskId = 'task-1';
const customerId = 'customer-1';
const asOfDate = '2026-10-27';
const importedAt = new Date('2026-10-26T10:00:00Z');
const known = new Set(['YER', 'SAR']);
const review = (overrides: Partial<FinancialTaskReview> = {}): FinancialTaskReview => ({
  id: taskId, customerId, taskType: 'promise_escalation', status: 'open',
  dueDate: '2026-10-20', createdAt: '2026-10-19T00:00:00Z', sourcePromiseId: 'promise-1',
  sourcePromiseCustomerId: customerId,
  expectedAmount: '10000', expectedCurrency: 'YER', assignedTo: 'collector-1', priorityReason: 'وعد متأخر',
  customer: { name: 'customer', code: '10001', status: 'active', customerType: 'customer' },
  balances: [{ currency: 'YER', balance: '0', importedAt: importedAt.toISOString(), ledgerFingerprint: 'empty' }],
  unknownLedgerCurrencies: [], ...overrides,
});

describe('settled financial task scope', () => {
  it('closes only overdue financial purposes, preserving manual calls, visits, and followups', () => {
    for (const type of SETTLED_FINANCIAL_TASK_TYPES) {
      expect(settledFinancialTaskExclusion(review({ taskType: type }), asOfDate, known)).toBeNull();
    }
    for (const type of ['visit', 'call', 'followup', 'followup_due', 'risk_high']) {
      expect(settledFinancialTaskExclusion(review({ taskType: type }), asOfDate, known)).toBe('not_financial');
    }
    expect(settledFinancialTaskExclusion(review({ dueDate: asOfDate }), asOfDate, known)).toBe('not_overdue');
    expect(settledFinancialTaskExclusion(review({ dueDate: '2026-11-01' }), asOfDate, known)).toBe('not_overdue');
  });

  it('never nets different currencies or treats a small residual debt as settled', () => {
    const rows = review().balances;
    expect(settledFinancialTaskExclusion(review({ balances: [
      ...rows, { ...rows[0], currency: 'SAR', balance: '0.0001' },
    ] }), asOfDate, known)).toBe('positive_balance');
    expect(settledFinancialTaskExclusion(review({ balances: [
      { ...rows[0], balance: '0.0001' }, { ...rows[0], currency: 'SAR', balance: '-1000' },
    ] }), asOfDate, known)).toBe('positive_balance');
    expect(settledFinancialTaskExclusion(review({ balances: [
      { ...rows[0], balance: '-5' }, { ...rows[0], currency: 'SAR', balance: '0' },
    ] }), asOfDate, known)).toBeNull();
  });

  it('rejects incomplete and invalid balance evidence', () => {
    const row = review().balances[0];
    expect(settledFinancialTaskExclusion(review({ balances: [] }), asOfDate, known)).toBe('missing_balances');
    expect(settledFinancialTaskExclusion(review({ unknownLedgerCurrencies: ['USD'] }), asOfDate, known)).toBe('missing_balances');
    expect(settledFinancialTaskExclusion(review({ balances: [{ ...row, importedAt: null }] }), asOfDate, known)).toBe('missing_import_provenance');
    expect(settledFinancialTaskExclusion(review({ balances: [{ ...row, currency: 'UNKNOWN' }] }), asOfDate, known)).toBe('unknown_currency');
    expect(settledFinancialTaskExclusion(review({ balances: [{ ...row, balance: 'bad' }] }), asOfDate, known)).toBe('invalid_balance');
    expect(settledFinancialTaskExclusion(review({ balances: [{ ...row, balance: 'NaN' }] }), asOfDate, known)).toBe('invalid_balance');
    expect(settledFinancialTaskExclusion(review({ sourcePromiseId: null, sourcePromiseCustomerId: null }), asOfDate, known)).toBe('invalid_promise_source');
    expect(settledFinancialTaskExclusion(review({ sourcePromiseCustomerId: 'other-customer' }), asOfDate, known)).toBe('invalid_promise_source');
  });
});

function databaseFixture() {
  const task = {
    id: taskId, customerId, assignedTo: 'collector-1', taskType: 'collection_remaining', status: 'open',
    dueDate: new Date('2026-10-20T00:00:00Z'), sourcePromiseId: null, expectedCurrency: 'YER',
    sourcePromise: null,
    expectedAmount: new Prisma.Decimal(10000), createdAt: new Date('2026-10-19T00:00:00Z'),
    priorityReason: 'متابعة المتبقي بعد تحصيل جزئي',
    customer: { name: 'customer', externalCustomerCode: '10001', status: 'active', customerType: 'customer' },
  };
  const db: any = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(0), $executeRaw: jest.fn().mockResolvedValue(1),
    task: { findMany: jest.fn().mockResolvedValue([task]), updateMany: jest.fn().mockResolvedValue({ count: 1 }), count: jest.fn().mockResolvedValue(1) },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'actor-1' }) },
    customerBalance: { findMany: jest.fn().mockResolvedValue([{ customerId, currencyCode: 'YER',
      accountingBalance: new Prisma.Decimal(10000), lastImportJob: { importedAt } }]) },
    operationalLedger: { findMany: jest.fn().mockResolvedValue([
      { id: 'old', customerId, currencyCode: 'YER', amountSigned: new Prisma.Decimal(-10000), createdAt: new Date('2026-10-25T10:00:00Z') },
      { id: 'new', customerId, currencyCode: 'YER', amountSigned: new Prisma.Decimal(-10000), createdAt: new Date('2026-10-26T11:00:00Z') },
    ]) },
    currency: { findMany: jest.fn().mockResolvedValue([{ code: 'YER' }, { code: 'SAR' }]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prisma: any = { $transaction: jest.fn((work: any) => work(db)) };
  return { db, prisma, task, service: new SettledFinancialTasksService(prisma) };
}

describe('settled financial task review and apply', () => {
  it('previews read-only and applies only post-import ledger entries per currency', async () => {
    const { db, service } = databaseFixture();
    const plan = await service.preview(organizationId, { asOfDate });
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0].balances[0].balance).toBe('0');
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(db.task.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
    expect(db.task.findMany.mock.calls[0][0].where).toMatchObject({
      customer: { organizationId }, taskType: { in: SETTLED_FINANCIAL_TASK_TYPES },
    });
  });

  it('rejects ledger-only currencies rather than ignoring an unknown balance', async () => {
    const { db, service } = databaseFixture();
    db.operationalLedger.findMany.mockResolvedValue([{ id: 'usd', customerId, currencyCode: 'USD',
      amountSigned: new Prisma.Decimal(-20), createdAt: new Date('2026-10-26T11:00:00Z') }]);
    const plan = await service.preview(organizationId, { asOfDate });
    expect(plan.candidates).toHaveLength(0);
    expect(plan.excluded).toEqual([{ taskId, customerId, reason: 'missing_balances' }]);
  });

  it('applies an exact plan atomically and appends a full review audit without changing balances or promises', async () => {
    const { db, prisma, service, task } = databaseFixture();
    const plan = await service.preview(organizationId, { asOfDate });
    const result = await service.apply(organizationId, plan, { actorId: 'actor-1', reason: 'مراجعة الحساب المسوّى' });
    expect(result).toEqual({ applied: 1, alreadyApplied: 0, planHash: plan.planHash });
    expect(prisma.$transaction.mock.calls[1][1]).toMatchObject({ isolationLevel: 'Serializable' });
    expect(db.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'done' } }));
    const audit = db.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('financial_task_closed_after_settlement');
    expect(audit.entityId).toBe(taskId);
    expect(audit.oldValue.priorityReason).toBe(task.priorityReason);
    expect(audit.oldValue.status).toBe('open');
    expect(audit.newValue).toMatchObject({ status: 'done', result: 'account_settled', planHash: plan.planHash });
  });

  it('refuses a stale review when a new debt appears after preview', async () => {
    const { db, service } = databaseFixture();
    const plan = await service.preview(organizationId, { asOfDate });
    db.operationalLedger.findMany.mockResolvedValue([]);
    await expect(service.apply(organizationId, plan, { actorId: 'actor-1', reason: 'review' })).rejects.toBeInstanceOf(ConflictException);
    expect(db.task.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses a changed task purpose and a review from another organization', async () => {
    const { db, service, task } = databaseFixture();
    const plan = await service.preview(organizationId, { asOfDate });
    db.task.findMany.mockResolvedValue([{ ...task, taskType: 'visit' }]);
    await expect(service.apply(organizationId, plan, { actorId: 'actor-1', reason: 'review' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.apply('other-org', plan, { actorId: 'actor-1', reason: 'review' })).rejects.toThrow('خطة مراجعة المهام غير صالحة');
    expect(db.task.updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent when the same completed plan is applied twice', async () => {
    const { db, service } = databaseFixture();
    const plan = await service.preview(organizationId, { asOfDate });
    db.auditLog.findMany.mockResolvedValue([{ entityId: taskId }]);
    db.task.count.mockResolvedValue(1);
    const result = await service.apply(organizationId, plan, { actorId: 'actor-1', reason: 'review' });
    expect(result).toEqual({ applied: 0, alreadyApplied: 1, planHash: plan.planHash });
    expect(db.task.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
