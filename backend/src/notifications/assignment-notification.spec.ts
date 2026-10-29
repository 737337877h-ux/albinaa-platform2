import { queueAssignmentNotification } from './assignment-notification';
import { CustomersService } from '../customers/customers.service';
import { AssignmentsService } from '../assignments/assignments.service';

function setup() {
  const assignment = { id: 'assignment', effectiveTo: null, reason: 'إسناد من Customer360',
    customer: { id: 'customer', name: 'عميل 10009', externalCustomerCode: '10009', organizationId: 'org' },
    collector: { userId: 'actor', user: { organizationId: 'org' } } };
  const tx = { customerAssignment: { findUniqueOrThrow: jest.fn().mockResolvedValue(assignment), create: jest.fn().mockResolvedValue(assignment) },
    notification: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)) },
    hrPushDelivery: { create: jest.fn().mockResolvedValue({}) }, task: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } };
  return { tx, assignment };
}

describe('assignment notification delivery', () => {
  it('queues both inbox and remote notification for the same assignment, including self-assignment', async () => {
    const { tx } = setup(); await queueAssignmentNotification(tx as any, 'assignment');
    expect(tx.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'assignment', userId: 'actor', kind: 'customer_transferred',
      payload: expect.objectContaining({ assignmentId: 'assignment', customerId: 'customer', customerCode: '10009', href: '/customers/customer' }) }) });
    expect(tx.hrPushDelivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'assignment', userId: 'actor', kind: 'customer_transferred' }) });
  });
  it('does not duplicate recovery of an already queued assignment', async () => {
    const { tx } = setup(); tx.notification.findUnique.mockResolvedValue({ id: 'assignment', userId: 'actor', kind: 'customer_transferred' });
    await queueAssignmentNotification(tx as any, 'assignment'); expect(tx.notification.create).not.toHaveBeenCalled(); expect(tx.hrPushDelivery.create).not.toHaveBeenCalled();
  });
  it.each(['ended', 'cross-org'])('rejects %s assignments', async mode => {
    const { tx, assignment } = setup(); if (mode === 'ended') (assignment as any).effectiveTo = new Date(); else assignment.collector.user.organizationId = 'other';
    await expect(queueAssignmentNotification(tx as any, 'assignment')).rejects.toThrow(); expect(tx.notification.create).not.toHaveBeenCalled();
  });
  it('propagates delivery storage failure so assignment and notification roll back together', async () => {
    const { tx } = setup(); tx.hrPushDelivery.create.mockRejectedValue(new Error('storage failure'));
    await expect(queueAssignmentNotification(tx as any, 'assignment')).rejects.toThrow('storage failure');
  });
  it('Customer360 assigns and queues delivery in the same transaction', async () => {
    const { tx } = setup(); const db = { collector: { findFirst: jest.fn().mockResolvedValue({ user: { organizationId: 'org', fullName: 'مدير' } }) },
      customerAssignment: { findFirst: jest.fn().mockResolvedValue(null) }, $transaction: jest.fn().mockImplementation(f => f(tx)) };
    const service = new CustomersService(db as any, { log: jest.fn() } as any, {} as any);
    jest.spyOn(service as any, 'assertAccess').mockResolvedValue({ id: 'customer' });
    await service.assignCollector({ id: 'actor', organizationId: 'org' } as any, 'customer', { collectorId: 'collector' });
    expect(tx.notification.create).toHaveBeenCalledTimes(1); expect(tx.hrPushDelivery.create).toHaveBeenCalledTimes(1);
  });
  it('the alternate create endpoint delegates without sending a second message', async () => {
    const customers = { assignCollector: jest.fn().mockResolvedValue({ assignment: { id: 'assignment' } }) }, notifications = { notifyUser: jest.fn() };
    const service = new AssignmentsService({} as any, customers as any, {} as any, notifications as any);
    await service.create({} as any, { customerId: 'customer', collectorId: 'collector' });
    expect(customers.assignCollector).toHaveBeenCalledTimes(1); expect(notifications.notifyUser).not.toHaveBeenCalled();
  });
});
