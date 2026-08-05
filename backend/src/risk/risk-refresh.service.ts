import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RiskRefreshSource, RiskService } from './risk.service';

@Injectable()
export class RiskRefreshService {
  private readonly logger = new Logger(RiskRefreshService.name);
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskService,
  ) {}

  async trigger(
    actor: AuthUser,
    customerIds: string[],
    source: Exclude<RiskRefreshSource, 'manual' | 'scheduled'>,
    req?: Request,
  ) {
    const ids = [...new Set(customerIds)].filter(Boolean);
    if (!ids.length) return null;
    return this.enqueue(actor.organizationId, () => this.risk.recalculate(actor, req, source, ids));
  }

  async refreshAll(
    actor: AuthUser,
    source: Extract<RiskRefreshSource, 'manual' | 'scheduled'>,
    req?: Request,
  ) {
    return this.enqueue(actor.organizationId, () => this.risk.recalculate(actor, req, source));
  }

  async triggerSystem(
    organizationId: string,
    customerIds: string[],
    source: Exclude<RiskRefreshSource, 'manual' | 'scheduled'>,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { organizationId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) {
      this.logger.warn(`تعذر تحديث المخاطر للمنظمة ${organizationId}: لا يوجد مستخدم نشط`);
      return null;
    }
    const actor: AuthUser = { ...user, roles: [], permissions: [] };
    return this.trigger(actor, customerIds, source);
  }

  private async enqueue<T>(organizationId: string, task: () => Promise<T>): Promise<T | null> {
    const previous = this.queues.get(organizationId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.queues.set(organizationId, current);
    try {
      return await current;
    } catch (error) {
      this.logger.error(
        `فشل التحديث الفوري للمخاطر (org ${organizationId})`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    } finally {
      if (this.queues.get(organizationId) === current) this.queues.delete(organizationId);
    }
  }
}
