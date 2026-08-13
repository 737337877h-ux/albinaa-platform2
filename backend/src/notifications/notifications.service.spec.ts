import { NotificationsService } from './notifications.service';

describe('NotificationsService finance alerts', () => {
  it('sends critical finance alerts only to active users with the dedicated permission', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'finance-1' }, { id: 'finance-2' }]),
      },
      notification: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new NotificationsService(prisma as any);

    await service.notifyFinance('org-1', 'import_reversed', {
      importJobId: 'job-1', reason: 'تصحيح ملف',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: 'org-1',
        isActive: true,
        userRoles: { some: { role: { rolePermissions: { some: { permission: { code: 'finance.alerts.receive' } } } } } },
      }),
    }));
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      kind: 'finance_alert',
      payload: expect.objectContaining({
        event: 'import_reversed', severity: 'critical', importJobId: 'job-1',
      }),
    }) });
  });

  it('keeps external push disabled unless explicitly enabled', async () => {
    const prisma = {
      notification: { create: jest.fn().mockResolvedValue({}) },
      devicePushToken: { findMany: jest.fn() },
    };
    const service = new NotificationsService(prisma as any);

    await service.notifyUser('user-1', 'promise_due', { customerName: 'عميل' });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.devicePushToken.findMany).not.toHaveBeenCalled();
  });

  it('sends Expo push and removes a token rejected as DeviceNotRegistered', async () => {
    const previous = process.env.PUSH_ENABLED;
    process.env.PUSH_ENABLED = 'true';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
    } as Response);
    const prisma = {
      notification: { create: jest.fn().mockResolvedValue({}) },
      devicePushToken: {
        findMany: jest.fn().mockResolvedValue([{ token: 'ExpoPushToken[valid-token]' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new NotificationsService(prisma as any);

    try {
      await service.notifyUser('user-1', 'promise_due', { customerName: 'عميل' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://exp.host/--/api/v2/push/send',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(prisma.devicePushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['ExpoPushToken[valid-token]'] } },
      });
    } finally {
      fetchMock.mockRestore();
      if (previous === undefined) delete process.env.PUSH_ENABLED;
      else process.env.PUSH_ENABLED = previous;
    }
  });
});
