import { adenDateKey, adenHour, PromiseReminderScheduler } from './promise-reminder.scheduler';

describe('PromiseReminderScheduler', () => {
  it('uses Aden local date and hour', () => {
    const now = new Date('2026-08-04T21:30:00.000Z');
    expect(adenDateKey(now)).toBe('2026-08-05');
    expect(adenHour(now)).toBe(0);
  });

  it('creates one internal reminder and advances an upcoming promise', async () => {
    const notificationCreate = jest.fn().mockResolvedValue({ id: 'notification-1' });
    const promiseUpdate = jest.fn().mockResolvedValue({ id: 'promise-1' });
    const prisma = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      paymentPromise: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'promise-1', status: 'upcoming', dueDate: new Date('2026-08-05T00:00:00.000Z'),
          expectedAmount: 250000, currencyCode: 'YER',
          collector: { userId: 'user-1' },
          customer: { id: 'customer-1', name: 'عميل تجريبي', externalCustomerCode: '10001' },
        }]),
        update: promiseUpdate,
      },
      notification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: notificationCreate,
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };

    const result = await new PromiseReminderScheduler(prisma as any)
      .runForOrganization('org-1', new Date('2026-08-05T05:00:00.000Z'));

    expect(result).toMatchObject({ enabled: true, candidates: 1, created: 1, skipped: 0 });
    expect(notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', kind: 'promise_due' }),
    }));
    expect(promiseUpdate).toHaveBeenCalledWith({
      where: { id: 'promise-1' }, data: { status: 'due_today' },
    });
  });

  it('does not create a duplicate reminder for the same promise and day', async () => {
    const prisma = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      paymentPromise: { findMany: jest.fn().mockResolvedValue([{
        id: 'promise-1', status: 'due_today', dueDate: new Date('2026-08-04T00:00:00.000Z'),
        expectedAmount: 100, currencyCode: 'YER', collector: { userId: 'user-1' },
        customer: { id: 'customer-1', name: 'عميل', externalCustomerCode: '1' },
      }]) },
      notification: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing' }),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const result = await new PromiseReminderScheduler(prisma as any)
      .runForOrganization('org-1', new Date('2026-08-05T05:00:00.000Z'));

    expect(result).toMatchObject({ candidates: 1, created: 0, skipped: 1 });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
