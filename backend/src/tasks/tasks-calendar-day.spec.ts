import { TasksService } from './tasks.service';

describe('task boards at Aden midnight', () => {
  const user = { id: 'user-1', organizationId: 'org-1', permissions: [] } as any;
  const escalation = {
    id: 'task-1', dueDate: new Date('2026-10-30T00:00:00.000Z'),
    taskType: 'promise_escalation', customerId: 'customer-1',
  };
  let service: TasksService;
  let findMany: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-29T21:30:00.000Z') });
    findMany = jest.fn(async ({ where }) => {
      const { gte, lt } = where.dueDate;
      return escalation.dueDate < lt && (!gte || escalation.dueDate >= gte) ? [escalation] : [];
    });
    service = new TasksService(
      { task: { findMany } } as any,
      { sweepOverdue: jest.fn().mockResolvedValue({ swept: 1 }) } as any,
      {} as any,
    );
    jest.spyOn(service as any, 'resolveCollectorOrNull').mockResolvedValue({ id: 'collector-1' });
    jest.spyOn(service as any, 'boardFromTasks')
      .mockImplementation(async (...args: any[]) => ({ items: args[4] }));
    jest.spyOn(service as any, 'dynamicToday').mockResolvedValue({ items: [] });
  });

  afterEach(() => { jest.useRealTimers(); });

  it('shows the new Aden day escalation even while the UTC server is on the previous day', async () => {
    expect((await service.today(user)).items).toEqual([escalation]);
    expect(findMany.mock.calls[0][0].where.dueDate.lt.toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });

  it('includes that task in today appointments and excludes it from overdue appointments', async () => {
    expect((await service.scheduled(user, 'today')).items).toEqual([escalation]);
    expect((await service.scheduled(user, 'overdue')).items).toEqual([]);
  });
});
