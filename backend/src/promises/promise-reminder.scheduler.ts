import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_PROMISE_STATUSES = ['upcoming', 'due_today', 'partially_fulfilled'];
const ADEN_TIME_ZONE = 'Asia/Aden';

export function adenDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ADEN_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function adenHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: ADEN_TIME_ZONE,
    hour: '2-digit', hourCycle: 'h23',
  }).format(now));
}

function dateOnlyUtc(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

@Injectable()
export class PromiseReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromiseReminderScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.PROMISE_REMINDERS_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.tick(), 5 * 60 * 1_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async setting<T>(organizationId: string, key: string, fallback: T): Promise<T> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    return row ? ((row.value as T) ?? fallback) : fallback;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const organizations = await this.prisma.organization.findMany({ select: { id: true } });
      for (const organization of organizations) {
        const enabled = await this.setting(organization.id, 'notifications.reminderEnabled', true);
        const hour = Number(await this.setting(organization.id, 'notifications.reminderHour', 8));
        if (enabled && adenHour(now) === Math.min(23, Math.max(0, hour))) {
          await this.runForOrganization(organization.id, now);
        }
      }
    } catch (error) {
      this.logger.error('فشل تشغيل تذكيرات وعود السداد', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }

  async runForOrganization(organizationId: string, now = new Date()) {
    const enabled = await this.setting(organizationId, 'notifications.reminderEnabled', true);
    if (!enabled) return { enabled: false, candidates: 0, created: 0, skipped: 0 };

    const reminderDate = adenDateKey(now);
    const today = dateOnlyUtc(reminderDate);
    const promises = await this.prisma.paymentPromise.findMany({
      where: {
        customer: { organizationId },
        status: { in: OPEN_PROMISE_STATUSES },
        dueDate: { lte: today },
      },
      include: {
        customer: { select: { id: true, name: true, externalCustomerCode: true } },
        collector: { select: { userId: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    let created = 0;
    let skipped = 0;
    for (const promise of promises) {
      const reminderKey = `${promise.id}|${reminderDate}`;
      const exists = await this.prisma.notification.findFirst({
        where: {
          userId: promise.collector.userId,
          kind: { in: ['promise_due', 'promise_overdue'] },
          payload: { path: ['reminderKey'], equals: reminderKey },
        },
        select: { id: true },
      });
      if (exists) {
        skipped += 1;
        continue;
      }

      const dueDate = promise.dueDate.toISOString().slice(0, 10);
      const kind = dueDate < reminderDate ? 'promise_overdue' : 'promise_due';
      await this.prisma.$transaction([
        this.prisma.notification.create({
          data: {
            userId: promise.collector.userId,
            kind,
            payload: {
              reminderKey,
              reminderDate,
              promiseId: promise.id,
              customerId: promise.customer.id,
              customerName: promise.customer.name,
              customerCode: promise.customer.externalCustomerCode,
              dueDate,
              amount: Number(promise.expectedAmount),
              currency: promise.currencyCode,
              automatic: true,
              href: `/customers/${promise.customer.id}?tab=promises`,
            },
          },
        }),
        ...(promise.status === 'upcoming'
          ? [this.prisma.paymentPromise.update({ where: { id: promise.id }, data: { status: 'due_today' } })]
          : []),
      ]);
      created += 1;
    }

    return { enabled: true, reminderDate, candidates: promises.length, created, skipped };
  }
}
