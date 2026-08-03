import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RiskService } from './risk.service';

export function nextDailyRun(now: Date, hour: number): Date {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

@Injectable()
export class RiskScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RiskScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskService,
  ) {}

  onModuleInit() {
    if (process.env.RISK_AUTO_RECALCULATE_ENABLED === 'false') {
      this.logger.log('التحديث التلقائي لدرجات المخاطر معطل بالإعداد');
      return;
    }
    this.scheduleNext();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext() {
    const hour = Number(process.env.RISK_RECALCULATE_HOUR ?? 2);
    const next = nextDailyRun(new Date(), hour);
    const delay = Math.max(1_000, next.getTime() - Date.now());
    this.timer = setTimeout(() => void this.runAndReschedule(), delay);
    this.timer.unref?.();
    this.logger.log(`موعد تحديث المخاطر التالي: ${next.toISOString()}`);
  }

  private async runAndReschedule() {
    try {
      await this.runForAllOrganizations();
    } finally {
      this.scheduleNext();
    }
  }

  private async runForAllOrganizations() {
    if (this.running) return;
    this.running = true;
    try {
      const organizations = await this.prisma.organization.findMany({
        select: {
          id: true,
          users: {
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: {
              id: true,
              organizationId: true,
              branchId: true,
              username: true,
              fullName: true,
            },
          },
        },
      });

      for (const organization of organizations) {
        const user = organization.users[0];
        if (!user) {
          this.logger.warn(`تجاوز تحديث المخاطر للمنظمة ${organization.id}: لا يوجد مستخدم نشط`);
          continue;
        }
        const actor: AuthUser = { ...user, roles: [], permissions: [] };
        try {
          await this.risk.recalculate(actor, undefined, 'scheduled');
        } catch (error) {
          this.logger.error(
            `فشل تحديث المخاطر التلقائي للمنظمة ${organization.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
