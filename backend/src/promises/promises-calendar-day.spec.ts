import { PromisesService } from './promises.service';

describe('promise dates at Aden midnight', () => {
  const actor = { id: 'user-1', organizationId: 'org-1', permissions: [] } as any;
  let service: PromisesService;
  let create: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-29T21:30:00.000Z') });
    create = jest.fn(async ({ data }) => ({ id: 'promise-1', ...data }));
    const tx = { paymentPromise: { create }, task: { updateMany: jest.fn(), create: jest.fn() } };
    service = new PromisesService({
      collector: {
        findUnique: jest.fn().mockResolvedValue({ id: 'collector-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      },
      currency: { findFirst: jest.fn().mockResolvedValue({ code: 'YER' }) },
      $transaction: jest.fn(async callback => callback(tx)),
    } as any, { log: jest.fn() } as any, { notifyUser: jest.fn() } as any);
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
