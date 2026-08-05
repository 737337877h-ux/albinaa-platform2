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
});
