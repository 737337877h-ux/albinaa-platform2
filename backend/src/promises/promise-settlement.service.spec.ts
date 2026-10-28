import { oracleReceiptActivity } from '../common/oracle-receipt-activity';
import { PromiseSettlementService } from './promise-settlement.service';

jest.mock('../common/oracle-receipt-activity', () => ({ oracleReceiptActivity: jest.fn() }));
const now = new Date('2026-10-28T08:00:00Z');
function fixture() {
  const rows = [{ id: 'promise1', customerId: 'customer1', currencyCode: 'YER', expectedAmount: '15000', fulfilledAmount: null,
    promiseDate: new Date('2026-10-01'), dueDate: new Date('2026-10-08'), createdAt: new Date('2026-10-01T08:00:00Z'),
    status: 'unfulfilled', statusReason: 'تصعيد سابق', settlementDate: null, settledLate: false, missedDueDate: null }];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    paymentPromise: { findMany: jest.fn().mockResolvedValue(rows), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    paymentPromiseReceiptAllocation: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'allocation1' }) },
    collection: { findMany: jest.fn().mockResolvedValue([]) },
    task: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit1' }) },
  };
  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  (oracleReceiptActivity as jest.Mock).mockResolvedValue([{ id: 'direct1', customerId: 'customer1', currencyCode: 'YER', amount: 15000,
    referenceNumber: 'serial1617', settlementKey: 'canonical1617', collectedAt: '2026-10-06T00:00:00+03:00' }]);
  return { tx, prisma, service: new PromiseSettlementService(prisma as any), rows };
}

describe('PromiseSettlementService', () => {
  it('defaults to a write-free preview and reads only recorded positive local receipts', async () => {
    const { service, tx } = fixture();
    const result = await service.reconcileForOrganization('org1', { now });
    expect(result).toMatchObject({ dryRun: true, applied: 0 });
    expect(result.changes).toHaveLength(1);
    expect(tx.collection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'recorded', amount: { gt: 0 } }) }));
    expect(tx.paymentPromiseReceiptAllocation.create).not.toHaveBeenCalled();
    expect(tx.paymentPromise.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('requires an unchanged preview before a manual apply and records the previous missed state', async () => {
    const { service, tx } = fixture();
    await expect(service.reconcileForOrganization('org1', { now, dryRun: false })).rejects.toThrow('خطة');
    const preview = await service.reconcileForOrganization('org1', { now });
    const result = await service.reconcileForOrganization('org1', { now, dryRun: false, expectedPlanHash: preview.planHash, actorId: 'actor1' });
    expect(result.applied).toBe(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.paymentPromiseReceiptAllocation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ receiptKey: 'canonical1617', amount: '15000.0000', organizationId: 'org1' }) });
    expect(tx.paymentPromise.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'fulfilled', statusReason: expect.stringContaining('تصعيد سابق'), settledLate: false }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'promise_receipt_settlement', oldValue: expect.objectContaining({ status: 'unfulfilled' }) }) });
  });

  it('rejects stale previews before creating allocations', async () => {
    const { service, tx } = fixture();
    await expect(service.reconcileForOrganization('org1', { now, dryRun: false, expectedPlanHash: 'stale' })).rejects.toThrow('تغيّرت');
    expect(tx.paymentPromiseReceiptAllocation.create).not.toHaveBeenCalled();
  });

  it('fails the transaction if audit or concurrent status verification fails', async () => {
    const { service, tx } = fixture();
    tx.paymentPromise.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reconcileForOrganization('org1', { now, dryRun: false, automatic: true })).rejects.toThrow('حالة الوعد');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    tx.paymentPromise.updateMany.mockResolvedValue({ count: 1 });
    tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(service.reconcileForOrganization('org1', { now, dryRun: false, automatic: true })).rejects.toThrow('audit unavailable');
  });
});
