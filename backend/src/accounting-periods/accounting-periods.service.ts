import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountingPeriodsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  list(actor: AuthUser, year?: number) {
    return this.prisma.accountingPeriod.findMany({
      where: { organizationId: actor.organizationId, ...(year ? { year } : {}) },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async lock(actor: AuthUser, year: number, month: number, reason: string, req?: Request) {
    const period = await this.prisma.accountingPeriod.upsert({
      where: { organizationId_year_month: { organizationId: actor.organizationId, year, month } },
      create: { organizationId: actor.organizationId, year, month, reason, lockedBy: actor.id },
      update: { status: 'locked', reason, lockedBy: actor.id, lockedAt: new Date(), unlockedBy: null, unlockedAt: null, unlockReason: null },
    });
    await this.audit.log({ userId: actor.id, action: 'accounting_period_locked', entityTable: 'accounting_periods', entityId: period.id, newValue: { year, month }, reason, req });
    return period;
  }

  async unlock(actor: AuthUser, id: string, reason: string, req?: Request) {
    const current = await this.prisma.accountingPeriod.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!current) throw new NotFoundException('الفترة المحاسبية غير موجودة');
    const period = await this.prisma.accountingPeriod.update({ where: { id }, data: { status: 'open', unlockedBy: actor.id, unlockedAt: new Date(), unlockReason: reason } });
    await this.audit.log({ userId: actor.id, action: 'accounting_period_unlocked', entityTable: 'accounting_periods', entityId: id, oldValue: { status: current.status }, newValue: { status: 'open' }, reason, req });
    return period;
  }

  async assertDatesOpen(actor: AuthUser, dates: Date[], overrideReason?: string, action = 'financial_entry', req?: Request) {
    const periods = [...new Map(dates.filter((d) => !Number.isNaN(d.getTime())).map((d) => [`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`, { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }])).values()];
    if (!periods.length) return;
    const locked = await this.prisma.accountingPeriod.findMany({ where: { organizationId: actor.organizationId, status: 'locked', OR: periods } });
    if (!locked.length) return;
    const labels = locked.map((p) => `${p.year}-${String(p.month).padStart(2, '0')}`).join(', ');
    if (!actor.permissions.includes('periods.override')) throw new ForbiddenException(`الفترة المحاسبية مقفلة: ${labels}`);
    if (!overrideReason || overrideReason.trim().length < 3) throw new BadRequestException(`سبب تجاوز الفترة المقفلة إلزامي: ${labels}`);
    await this.audit.log({ userId: actor.id, action: 'accounting_period_overridden', entityTable: 'accounting_periods', newValue: { action, periods: labels }, reason: overrideReason.trim(), req });
  }
}

