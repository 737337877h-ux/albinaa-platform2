import { NotificationsService } from './notifications.service';

describe('NotificationsService finance alerts', () => {
  it('scopes listing, counters and mark-all to the selected mobile application',async()=>{
    const db={notification:{count:jest.fn().mockResolvedValue(1),findMany:jest.fn().mockResolvedValue([]),updateMany:jest.fn().mockResolvedValue({count:1})}};
    const service=new NotificationsService(db as any);const user:any={id:'u'};
    await service.listMine(user,false,1,25,'collector');
    const where=db.notification.findMany.mock.calls[0][0].where;
    expect(where.NOT).toBeDefined();expect(db.notification.count.mock.calls[0][0].where).toEqual(where);
    await service.markAllRead(user,'collector');expect(db.notification.updateMany).toHaveBeenCalledWith({where:{...where,readAt:null},data:{readAt:expect.any(Date)}});
    await service.listMine(user,false,1,25);expect(db.notification.findMany.mock.calls[1][0].where).toEqual({userId:'u'});
  });
  it('sends critical finance alerts only to active users with the dedicated permission', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'finance-1' }, { id: 'finance-2' }]),
      },
      notification: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    Object.assign(prisma, {hrPushDelivery:{create:jest.fn().mockResolvedValue({})},$transaction:async(fn:any)=>fn(prisma)});
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
    Object.assign(prisma, {hrPushDelivery:{create:jest.fn().mockResolvedValue({})},$transaction:async(fn:any)=>fn(prisma)});
    const service = new NotificationsService(prisma as any);

    await service.notifyUser('user-1', 'promise_due', { customerName: 'عميل' });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.devicePushToken.findMany).not.toHaveBeenCalled();
  });

  it('atomically queues notification and remote delivery without making a network request in the business transaction', async () => {
    const tx={notification:{create:jest.fn().mockResolvedValue({id:'n'})},hrPushDelivery:{create:jest.fn().mockResolvedValue({})}};
    const prisma={$transaction:jest.fn(async(fn:any)=>fn(tx))};const network=jest.spyOn(global,'fetch');
    try{await new NotificationsService(prisma as any).notifyUser('u','promise_due',{customerName:'عميل'});
      expect(tx.hrPushDelivery.create).toHaveBeenCalledWith({data:expect.objectContaining({id:'n',userId:'u',kind:'promise_due',payload:expect.objectContaining({title:'وعد سداد مستحق'})})});
      expect(network).not.toHaveBeenCalled();
    }finally{network.mockRestore();}
  });
});
