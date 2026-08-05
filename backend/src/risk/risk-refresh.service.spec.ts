import { AuthUser } from '../common/guards/jwt-auth.guard';
import { RiskRefreshService } from './risk-refresh.service';

const actor: AuthUser = {
  id: 'user-1', organizationId: 'org-1', branchId: null,
  username: 'admin', fullName: 'Admin', roles: [], permissions: [],
};

describe('RiskRefreshService', () => {
  it('serializes refreshes for the same organization and deduplicates customer ids', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const risk = {
      recalculate: jest.fn()
        .mockImplementationOnce(async () => { await firstGate; return { source: 'first' }; })
        .mockResolvedValueOnce({ source: 'second' }),
    };
    const service = new RiskRefreshService({} as any, risk as any);

    const first = service.trigger(actor, ['c1', 'c1'], 'collection_created');
    const second = service.trigger(actor, ['c2'], 'promise_broken');
    await new Promise((resolve) => setImmediate(resolve));
    expect(risk.recalculate).toHaveBeenCalledTimes(1);
    expect(risk.recalculate.mock.calls[0][3]).toEqual(['c1']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(risk.recalculate).toHaveBeenCalledTimes(2);
    expect(risk.recalculate.mock.calls[1][2]).toBe('promise_broken');
  });

  it('does not fail the completed business operation when refresh fails', async () => {
    const risk = { recalculate: jest.fn().mockRejectedValue(new Error('temporary failure')) };
    const service = new RiskRefreshService({} as any, risk as any);
    await expect(service.trigger(actor, ['c1'], 'import_completed')).resolves.toBeNull();
  });

  it('uses an active organization user for system-triggered refreshes', async () => {
    const prisma = { user: { findFirst: jest.fn().mockResolvedValue(actor) } };
    const risk = { recalculate: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new RiskRefreshService(prisma as any, risk as any);
    await service.triggerSystem('org-1', ['c1'], 'promise_broken');
    expect(risk.recalculate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      undefined,
      'promise_broken',
      ['c1'],
    );
  });

  it('serializes full manual refreshes with targeted event refreshes', async () => {
    let releaseManual!: () => void;
    const manualGate = new Promise<void>((resolve) => { releaseManual = resolve; });
    const risk = {
      recalculate: jest.fn()
        .mockImplementationOnce(async () => { await manualGate; return { source: 'manual' }; })
        .mockResolvedValueOnce({ source: 'event' }),
    };
    const service = new RiskRefreshService({} as any, risk as any);

    const manual = service.refreshAll(actor, 'manual');
    const event = service.trigger(actor, ['c1'], 'collection_created');
    await new Promise((resolve) => setImmediate(resolve));
    expect(risk.recalculate).toHaveBeenCalledTimes(1);
    expect(risk.recalculate.mock.calls[0][2]).toBe('manual');

    releaseManual();
    await Promise.all([manual, event]);
    expect(risk.recalculate).toHaveBeenCalledTimes(2);
    expect(risk.recalculate.mock.calls[1][3]).toEqual(['c1']);
  });
});
