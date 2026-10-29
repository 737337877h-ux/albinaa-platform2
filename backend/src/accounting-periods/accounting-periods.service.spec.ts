import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccountingPeriodsService } from './accounting-periods.service';

const actor = { id: 'user-1', organizationId: 'org-1', fullName: 'Manager', username: 'manager', branchId: null, roles: [], permissions: [] };

describe('AccountingPeriodsService', () => {
  const locked = [{ id: 'period-1', year: 2026, month: 7 }];

  it('blocks a dated entry in a locked period without override permission', async () => {
    const prisma = { accountingPeriod: { findMany: jest.fn().mockResolvedValue(locked) } };
    const service = new AccountingPeriodsService(prisma as any, { log: jest.fn() } as any);
    await expect(service.assertDatesOpen(actor, [new Date('2026-07-15T00:00:00Z')]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a reason and audits an authorized override', async () => {
    const prisma = { accountingPeriod: { findMany: jest.fn().mockResolvedValue(locked) } };
    const audit = { log: jest.fn() };
    const service = new AccountingPeriodsService(prisma as any, audit as any);
    const privileged = { ...actor, permissions: ['periods.override'] };
    await expect(service.assertDatesOpen(privileged, [new Date('2026-07-15T00:00:00Z')]))
      .rejects.toBeInstanceOf(BadRequestException);
    await service.assertDatesOpen(privileged, [new Date('2026-07-15T00:00:00Z')], 'تصحيح معتمد', 'collection_created');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'accounting_period_overridden', reason: 'تصحيح معتمد' }));
  });
});
