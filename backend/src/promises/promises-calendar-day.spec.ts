import { PromisesService } from './promises.service';

describe('promise dates at Aden midnight', () => {
  const actor = { id: 'user-1', organizationId: 'org-1', permissions: [] } as any;
  let service: PromisesService;
  let create: jest.Mock;
  let notifyUser: jest.Mock;
  let tx:any;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-29T21:30:00.000Z') });
    create = jest.fn(async ({ data }) => ({ id: 'promise-1', ...data }));
    tx = { $queryRaw:jest.fn(),paymentPromise: { create,findFirst:jest.fn().mockResolvedValue(null) }, task: { updateMany: jest.fn(), create: jest.fn() } };
    notifyUser = jest.fn();
    service = new PromisesService({
      collector: {
        findUnique: jest.fn().mockResolvedValue({ id: 'collector-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      },
      currency: { findFirst: jest.fn().mockResolvedValue({ code: 'YER' }) },
      $transaction: jest.fn(async callback => callback(tx)),
    } as any, { log: jest.fn() } as any, { notifyUser } as any);
    jest.spyOn(service as any, 'assertCurrentAssignment').mockResolvedValue({ name: 'Test customer' });
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'promise-1', status: 'upcoming', expectedAmount: 1000,
    } as any);
  });

  afterEach(() => { jest.useRealTimers(); });

  it('creates a promise due today using the Aden promise date and status', async () => {
    const promise = await service.create(actor, {
      customerId: 'customer-1', dueDate: '2026-10-30', currencyCode: 'YER', expectedAmount: 1000,
    });
    expect(promise.status).toBe('due_today');
    expect(create.mock.calls[0][0].data.promiseDate.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(notifyUser).toHaveBeenCalledWith('user-1', 'promise_due', expect.objectContaining({ dueDate: '2026-10-30' }));
  });

  it('keeps future promises scheduled without sending a due notification at creation', async () => {
    const promise = await service.create(actor, {
      customerId: 'customer-1', dueDate: '2026-10-31', currencyCode: 'YER', expectedAmount: 1000,
    });
    expect(promise.status).toBe('upcoming');
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('reuses an identical saved promise without creating another task, notification or promise',async()=>{
    const dto={customerId:'customer-1',dueDate:'2026-10-30',currencyCode:'YER',expectedAmount:1000};
    const first=await service.create(actor,dto);tx.paymentPromise.findFirst.mockResolvedValue(first);
    const again=await service.create(actor,dto);
    expect(again.id).toBe(first.id);expect(create).toHaveBeenCalledTimes(1);
    expect(tx.task.create).toHaveBeenCalledTimes(1);expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects editing to yesterday even when it is still today on the UTC server', async () => {
    await expect(service.update(actor, 'promise-1', { dueDate: '2026-10-29' }))
      .rejects.toThrow('تاريخ استحقاق ماضٍ');
  });

  it('does not accept the current Aden day as a future postponement', async () => {
    await expect(service.setStatus(actor, 'promise-1', {
      status: 'postponed', newDueDate: '2026-10-30', reason: 'Test postponement',
    })).rejects.toThrow('تاريخًا قادمًا');
  });
});
