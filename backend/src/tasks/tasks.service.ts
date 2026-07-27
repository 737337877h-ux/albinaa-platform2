import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PromisesService } from '../promises/promises.service';

/**
 * محرك المهام اليومي — "عمل اليوم" للمحصل (أهم شاشة حسب المتطلبات الأصلية §10).
 * يُحتسب ديناميكيًا عند الطلب (لا يحتاج مجدولاً)، ويبدأ بمسح الوعود المتأخرة
 * (تحويل تلقائي إلى غير منفذ + تصعيد + إشعار — قاعدة §12 المعتمدة).
 *
 * مصادر بنود اليوم (بترتيب الأولوية المعتمد):
 * 1. وعد سداد مستحق اليوم / متأخر (مهام promise_due/promise_escalation المفتوحة).
 * 2. عملاء لم تتم متابعتهم منذ X يومًا (X من system_settings: followup_stale_days، افتراضي 14).
 * 3. عملاء برصيد مرتفع (أعلى نسبة من المدينين لكل عملة — حد من الإعدادات).
 * 4. عملاء بمخاطر عالية (آخر تقييم high/critical — قواعد قابلة للتفسير، الذكاء الاصطناعي لاحقًا).
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly promises: PromisesService,
  ) {}

  private async setting<T>(orgId: string, key: string, fallback: T): Promise<T> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key } },
    });
    return row ? ((row.value as any) ?? fallback) : fallback;
  }

  private async resolveCollector(user: AuthUser, collectorIdParam?: string) {
    if (collectorIdParam) {
      if (!user.permissions.includes('customers.read_all')) {
        throw new ForbiddenException('عرض مهام محصل آخر يتطلب صلاحية إشرافية');
      }
      const c = await this.prisma.collector.findUnique({ where: { id: collectorIdParam } });
      if (!c) throw new NotFoundException('المحصل غير موجود');
      return c;
    }
    const own = await this.prisma.collector.findUnique({ where: { userId: user.id } });
    if (!own) throw new NotFoundException('حسابك ليس محصلاً — مرر collectorId (بصلاحية إشرافية)');
    return own;
  }

  /**
   * تصحيح مراجعة Dashboard: نسخة لا تُلقي استثناءً عند غياب سجل محصل شخصي
   * بلا collectorId صريح — هذه حالة طبيعية متوقعة لحساب إداري (وليست غياب
   * صلاحية فعليًا؛ الحارس @RequirePermissions('tasks.manage') يتكفل بذلك
   * ويبقى 403 حقيقيًا حين تغيب الصلاحية فعلاً). تمييز صريح لا يعتمد على رمز
   * HTTP عام: null هنا تعني "ليس محصلاً"، لا أكثر ولا أقل.
   * تمرير collectorId صراحة يبقى بنفس القواعد الصارمة (403 دون صلاحية
   * إشرافية، 404 لمحصل غير موجود) — هذه حالات خطأ فعلية ولا تتغير.
   */
  private async resolveCollectorOrNull(user: AuthUser, collectorIdParam?: string) {
    if (collectorIdParam) {
      if (!user.permissions.includes('customers.read_all')) {
        throw new ForbiddenException('عرض مهام محصل آخر يتطلب صلاحية إشرافية');
      }
      const c = await this.prisma.collector.findUnique({ where: { id: collectorIdParam } });
      if (!c) throw new NotFoundException('المحصل غير موجود');
      return c;
    }
    return this.prisma.collector.findUnique({ where: { userId: user.id } });
  }

  private emptyTodayBoard() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      collectorId: null,
      isCollector: false,
      date: today,
      settings: null,
      summary: { tasksToday: 0, expectedByCurrency: {}, totalBalanceByCurrency: {} },
      items: [],
    };
  }

  async today(user: AuthUser, collectorIdParam?: string) {
    const collector = await this.resolveCollectorOrNull(user, collectorIdParam);
    if (!collector) {
      // ليس محصلاً ولم يُحدَّد محصل صراحة — نتيجة فارغة مميزة، لا خطأ إطلاقًا
      return this.emptyTodayBoard();
    }
    const orgId = user.organizationId;

    // --- تسجيل تشخيصي مؤقت: يُزال بعد تحديد السبب الحقيقي لـ 500 ---
    this.logger.debug(`[today] قبل sweepOverdue — collector=${collector.id}, org=${orgId}`);
    // 0) مسح الوعود المتأخرة أولاً (idempotent)
    await this.promises.sweepOverdue(orgId);
    this.logger.debug('[today] بعد sweepOverdue');

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const staleDays = Number(await this.setting(orgId, 'followup_stale_days', 14));
    const staleBefore = new Date(today.getTime() - staleDays * 86_400_000);
    const highBalanceTopPercent = Number(await this.setting(orgId, 'high_balance_top_percent', 10));

    // العملاء المسندون حاليًا للمحصل
    const assigned = await this.prisma.customer.findMany({
      where: {
        organizationId: orgId,
        status: 'active',
        assignments: { some: { collectorId: collector.id, effectiveTo: null } },
      },
      include: {
        balances: { where: { accountingBalance: { gt: 0 } } },
        followups: {
          where: { deletedAt: null },
          orderBy: { followupAt: 'desc' },
          take: 1,
        },
        scores: { orderBy: { computedAt: 'desc' }, take: 1 },
      },
    });
    this.logger.debug(`[today] بعد جلب assigned — العدد=${assigned.length}`);
    const assignedIds = assigned.map((c) => c.id);

    // 1) مهام الوعود المفتوحة المستحقة اليوم أو المتأخرة (تشمل التصعيدات)
    const promiseTasks = await this.prisma.task.findMany({
      where: {
        assignedTo: collector.id,
        status: 'open',
        taskType: { in: ['promise_due', 'promise_escalation'] },
        dueDate: { lte: today },
      },
      include: { customer: { select: { id: true, name: true, phonePrimary: true } } },
    });
    this.logger.debug(`[today] بعد جلب promiseTasks — العدد=${promiseTasks.length}`);

    const items: {
      customerId: string; customerName: string; phone: string | null;
      reason: string; priority: number; taskId?: string;
      expectedAmount?: number; currency?: string;
      balances: { currency: string; balance: number }[];
      lastFollowupAt: Date | null;
    }[] = [];
    const included = new Set<string>();
    const balancesOf = (id: string) => {
      const c = assigned.find((x) => x.id === id);
      return (c?.balances ?? []).map((b) => ({
        currency: b.currencyCode, balance: Number(b.accountingBalance),
      }));
    };
    const lastFollowupOf = (id: string) =>
      assigned.find((x) => x.id === id)?.followups[0]?.followupAt ?? null;

    for (const t of promiseTasks) {
      if (!t.customerId) continue;
      items.push({
        customerId: t.customerId,
        customerName: t.customer?.name ?? '',
        phone: t.customer?.phonePrimary ?? null,
        reason: t.taskType === 'promise_escalation' ? 'وعد سداد متأخر (تصعيد)' : 'وعد سداد مستحق اليوم',
        priority: t.taskType === 'promise_escalation' ? 1 : 2,
        taskId: t.id,
        expectedAmount: t.expectedAmount === null ? undefined : Number(t.expectedAmount),
        currency: t.expectedCurrency ?? undefined,
        balances: balancesOf(t.customerId),
        lastFollowupAt: lastFollowupOf(t.customerId),
      });
      included.add(t.customerId);
    }

    // 2) لم تتم متابعتهم منذ X يومًا (وعليهم رصيد مدين)
    for (const c of assigned) {
      if (included.has(c.id) || c.balances.length === 0) continue;
      const last = c.followups[0]?.followupAt ?? null;
      if (!last || last < staleBefore) {
        items.push({
          customerId: c.id, customerName: c.name, phone: c.phonePrimary,
          reason: last
            ? `لم تتم متابعته منذ ${Math.floor((today.getTime() - last.getTime()) / 86_400_000)} يومًا`
            : 'لم تتم متابعته إطلاقًا',
          priority: 3,
          balances: balancesOf(c.id), lastFollowupAt: last,
        });
        included.add(c.id);
      }
    }

    // 3) الرصيد المرتفع: أعلى X% من مدينِي المحصل لكل عملة
    const debtorsByCcy = new Map<string, { id: string; bal: number }[]>();
    for (const c of assigned) {
      for (const b of c.balances) {
        const list = debtorsByCcy.get(b.currencyCode) ?? [];
        list.push({ id: c.id, bal: Number(b.accountingBalance) });
        debtorsByCcy.set(b.currencyCode, list);
      }
    }
    for (const [ccy, list] of debtorsByCcy) {
      list.sort((a, b) => b.bal - a.bal);
      const topN = Math.max(1, Math.ceil((list.length * highBalanceTopPercent) / 100));
      for (const d of list.slice(0, topN)) {
        if (included.has(d.id)) continue;
        const c = assigned.find((x) => x.id === d.id)!;
        items.push({
          customerId: d.id, customerName: c.name, phone: c.phonePrimary,
          reason: `رصيد مرتفع (${ccy}: ${d.bal.toLocaleString('en-US')})`,
          priority: 4,
          balances: balancesOf(d.id), lastFollowupAt: lastFollowupOf(d.id),
        });
        included.add(d.id);
      }
    }

    // 4) المخاطر العالية (قواعد قابلة للتفسير — الذكاء الاصطناعي مرحلة لاحقة)
    for (const c of assigned) {
      if (included.has(c.id)) continue;
      const risk = c.scores[0]?.riskLevel;
      if (risk === 'high' || risk === 'critical') {
        items.push({
          customerId: c.id, customerName: c.name, phone: c.phonePrimary,
          reason: `مستوى مخاطر ${risk === 'critical' ? 'حرج' : 'مرتفع'}`,
          priority: risk === 'critical' ? 2 : 5,
          balances: balancesOf(c.id), lastFollowupAt: lastFollowupOf(c.id),
        });
        included.add(c.id);
      }
    }

    items.sort((a, b) => a.priority - b.priority
      || (b.balances[0]?.balance ?? 0) - (a.balances[0]?.balance ?? 0));

    const expectedByCurrency: Record<string, number> = {};
    for (const i of items) {
      if (i.expectedAmount && i.currency) {
        expectedByCurrency[i.currency] = (expectedByCurrency[i.currency] ?? 0) + i.expectedAmount;
      }
    }
    const totalBalanceByCurrency: Record<string, number> = {};
    for (const i of items) {
      for (const b of i.balances) {
        totalBalanceByCurrency[b.currency] = (totalBalanceByCurrency[b.currency] ?? 0) + b.balance;
      }
    }

    return {
      collectorId: collector.id,
      isCollector: true,
      date: today,
      settings: { staleDays, highBalanceTopPercent },
      summary: {
        tasksToday: items.length,
        expectedByCurrency,
        totalBalanceByCurrency,
      },
      items,
    };
  }

  /** قائمة المهام المخزنة (المفتوحة افتراضيًا) للمحصل أو للإدارة. */
  async list(user: AuthUser, collectorIdParam?: string, status = 'open') {
    const collector = await this.resolveCollector(user, collectorIdParam);
    return this.prisma.task.findMany({
      where: { assignedTo: collector.id, status },
      include: {
        customer: { select: { id: true, name: true, externalCustomerCode: true } },
        sourcePromise: { select: { id: true, dueDate: true, expectedAmount: true, currencyCode: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async complete(user: AuthUser, taskId: string) {
    const collector = await this.resolveCollector(user, undefined).catch(() => null);
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        ...(user.permissions.includes('customers.read_all') || !collector
          ? {}
          : { assignedTo: collector.id }),
      },
    });
    if (!task) throw new NotFoundException('المهمة غير موجودة أو خارج نطاق صلاحيتك');
    return this.prisma.task.update({ where: { id: taskId }, data: { status: 'done' } });
  }
}
