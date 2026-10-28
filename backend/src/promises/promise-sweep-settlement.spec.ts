import { PromisesService } from './promises.service';

describe('promise overdue sweep after receipt settlement', () => {
  it('does not recreate escalation when a concurrent settlement has resolved the promise', async () => {
    const transition = jest.fn().mockResolvedValue({ count: 0 });
    const tx = { paymentPromise: { updateMany: transition }, task: { updateMany: jest.fn(), create: jest.fn() } };
    const prisma = {
      paymentPromise: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', status: 'upcoming', dueDate: new Date('2026-08-01'),
        collectorId: 'collector1', collector: { userId: 'u1' }, customer: { name: 'عميل' }, customerId: 'c1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const notifications = { notifyUser: jest.fn() };
    const settlement = { reconcileForOrganization: jest.fn().mockResolvedValue({ applied: 0 }) };
    const service = new PromisesService(prisma as any, {} as any, notifications as any, undefined, settlement as any);
    expect(await service.sweepOverdue('org1')).toEqual({ swept: 0 });
    expect(settlement.reconcileForOrganization).toHaveBeenCalledWith('org1', { dryRun: false, automatic: true });
    expect(settlement.reconcileForOrganization.mock.invocationCallOrder[0]).toBeLessThan(prisma.paymentPromise.findMany.mock.invocationCallOrder[0]);
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ['upcoming', 'due_today', 'partially_fulfilled'] } }) }));
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });

  it('retains the due date when genuinely unresolved promises are escalated', async () => {
    const dueDate = new Date('2026-08-01');
    const transition = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { paymentPromise: { updateMany: transition }, task: { updateMany: jest.fn(), create: jest.fn() } };
    const prisma = { paymentPromise: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', status: 'partially_fulfilled', dueDate,
      collectorId: 'collector1', collector: { userId: 'u1' }, customer: { name: 'عميل' }, customerId: 'c1', expectedAmount: 1000, currencyCode: 'YER' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const service = new PromisesService(prisma as any, {} as any, { notifyUser: jest.fn() } as any);
    expect(await service.sweepOverdue('org1')).toEqual({ swept: 1 });
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'unfulfilled', missedDueDate: dueDate }) }));
    expect(tx.task.create).toHaveBeenCalledTimes(1);
  });
});
