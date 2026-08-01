import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PromisesService } from '../promises/promises.service';
import { CompleteTaskDto, TASK_COMPLETE_RESULT_LABELS } from './dto/complete-task.dto';

/**
 * قائمة أولويات قائمة عمل اليوم (PR 5) — الترتيب المعتمد من مالك المنتج:
 * 1. وعد سداد متأخر (تصعيد)
 * 2. وعد سداد مستحق اليوم
 * 3. متابعة متأخرة يومين+
 * 4. عميل مخاطر حرجة
 * 5. عميل مخاطر مرتفعة (أُدرج بعد الحرجة — شرط قبول "ظهور مهام لـ High risk")
 * 6. دين عمره +120 يوم
 * 7. رصيد مرتفع دون متابعة حديثة
 * 8. لا يرد متكرر
 * 9. يحتاج زيارة
 * 10. متابعة دورية — مخاطر متوسطة
 * 11. متابعة عادية منخفضة الأولوية
 */
export const TASK_TYPE_PRIORITY: Record<string, number> = {
  promise_overdue: 1,
  promise_escalation: 1,
  promise_due_today: 2,
  promise_due: 2,
  followup_overdue: 3,
  risk_critical: 4,
  risk_high: 5,
  debt_120plus: 6,
  high_balance_no_followup: 7,
  repeated_no_answer: 8,
  needs_visit: 9,
  followup_periodic_medium: 10,
  followup_normal: 11,
};

export function priorityOfTaskType(taskType: string): number {
  return TASK_TYPE_PRIORITY[taskType] ?? 100;
}

/** مفتاح منع التكرار المعتمد (PR 5): عميل + عملة + نوع المهمة + تاريخ الاستحقاق + المصدر. */
export function queueTaskKey(
  customerId: string,
  currency: string | null,
  taskType: string,
  dueDate: Date,
  sourcePromiseId?: string | null,
): string {
  const date = dueDate.toISOString().slice(0, 10);
  return `${customerId}|${currency ?? ''}|${taskType}|${date}|${sourcePromiseId ?? ''}`;
}

const NO_ANSWER_RESULTS = ['لا يرد', 'الهاتف مغلق', 'مشغول'];
const NEEDS_VISIT_RESULTS = ['يحتاج زيارة'];

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * منتصف ليلة التوقيت المحلي كـ UTC — أعمدة @db.Date تُخزَّن وتُقرأ بمنتصف ليلة UTC،
 * فمقارنة التواريخ المحلية مباشرة تنكسر فرق التوقيت (مثل UTC+3). هذا يضمن أن
 * «اليوم» يطابق ما يُقرأ فعليًا من قاعدة البيانات.
 */
function startOfLocalDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}


/**
 * محرك المهام اليومي — "عمل اليوم" (أهم شاشة حسب المتطلبات الأصلية §10).
 *
 * منذ PR 5 (Daily Work Queue) المصدر الأساسي هو المهام المخزنة المولّدة عبر
 * POST /tasks/generate-today (قائمة عمل اليوم)؛ ويبقى الحساب الديناميكي القديم
 * (dynamicToday) مسارًا رجوعيًا فقط عند غياب أي مهام مخزنة للمحصل.
 *
 * قائمة أولويات قائمة عمل اليوم (PR 5) — المعتمدة من مالك المنتج:
 * 1. وعد سداد متأخر (تصعيد)     2. وعد سداد مستحق اليوم
 * 3. متابعة متأخرة يومين+       4. عميل مخاطر حرجة
 * 5. عميل مخاطر مرتفعة          6. دين عمره +120 يوم
 * 7. رصيد مرتفع دون متابعة حديثة 8. لا يرد متكرر
 * 9. يحتاج زيارة                10. متابعة دورية — مخاطر متوسطة
 * 11. متابعة عادية منخفضة الأولوية
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly promises: PromisesService,
    private readonly audit: AuditService,
  ) {}

  private async collectorOf(user: AuthUser) {
    return this.prisma.collector.findUnique({ where: { userId: user.id } });
  }

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
    const today = startOfLocalDayUtc(new Date());
    return {
      collectorId: null,
      isCollector: false,
      date: today,
      settings: null,
      summary: { tasksToday: 0, expectedByCurrency: {}, totalBalanceByCurrency: {} },
      items: [],
    };
  }

  /**
   * "عمل اليوم" — يفضّل المهام المخزنة (قائمة عمل اليوم المُولّدة في
   * POST /tasks/generate-today، PR 5). يبدأ بمسح الوعود المتأخرة، ثم:
   * - وُجدت مهام مخزنة مستحقة اليوم (أو المستخدم إداري) → عرض المخزن مرتبًا حسب الأولوية.
   * - لا مهام مخزنة → الرجوع إلى الحساب الديناميكي القديم للمحصل.
   * نطاق العرض: المحصل يرى مهامه المسندة؛ الإدارة ترى الكل (بما فيها غير المسندة).
   */
  async today(user: AuthUser, collectorIdParam?: string) {
    const orgId = user.organizationId;
    const collector = await this.resolveCollectorOrNull(user, collectorIdParam);

    // 0) مسح الوعود المتأخرة أولاً (idempotent)
    await this.promises.sweepOverdue(orgId);

    const today = startOfLocalDayUtc(new Date());
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const isAdmin = user.permissions.includes('customers.read_all');

    const stored = await this.prisma.task.findMany({
      where: {
        status: 'open',
        dueDate: { gte: today, lt: tomorrow },
        customer: { organizationId: orgId },
        ...(collectorIdParam
          ? { assignedTo: collectorIdParam }
          : isAdmin
            ? {}
            : collector
              ? { assignedTo: collector.id }
              : {}),
      },
      include: {
        customer: { select: { id: true, name: true, phonePrimary: true, externalCustomerCode: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    if (stored.length > 0 || isAdmin) {
      return this.boardFromTasks(user, collector?.id ?? null, isAdmin, today, stored);
    }
    if (!collector) {
      // ليس محصلاً ولم يُحدَّد محصل صراحة — نتيجة فارغة مميزة، لا خطأ إطلاقًا
      return this.emptyTodayBoard();
    }
    return this.dynamicToday(user, collector, orgId, today);
  }

  /**
   * بناء لوحة اليوم من المهام المخزنة المفتوحة المستحقة اليوم، مرتبة حسب الأولوية
   * (TASK_TYPE_PRIORITY) ثم المبلغ المتوقع تنازليًا.
   */
  private async boardFromTasks(
    _user: AuthUser,
    collectorId: string | null,
    isAdmin: boolean,
    today: Date,
    tasks: {
      id: string; customerId: string | null; assignedTo: string | null; taskType: string;
      priorityReason: string | null; expectedAmount: unknown; expectedCurrency: string | null;
      customer: { id: string; name: string; phonePrimary: string | null; externalCustomerCode: string | null } | null;
    }[],
  ) {
    const customerIds = [...new Set(tasks.map((t) => t.customerId).filter((x): x is string => !!x))];
    const [balances, followups] = await Promise.all([
      this.prisma.customerBalance.findMany({
        where: { customerId: { in: customerIds }, accountingBalance: { gt: 0 } },
        select: { customerId: true, currencyCode: true, accountingBalance: true },
      }),
      this.prisma.followup.findMany({
        where: { customerId: { in: customerIds }, deletedAt: null },
        select: { customerId: true, followupAt: true },
        orderBy: { followupAt: 'desc' },
      }),
    ]);

    const balByCustomer = new Map<string, { currency: string; balance: number }[]>();
    for (const b of balances) {
      const list = balByCustomer.get(b.customerId) ?? [];
      list.push({ currency: b.currencyCode, balance: Number(b.accountingBalance) });
      balByCustomer.set(b.customerId, list);
    }
    const lastFollowupOf = new Map<string, Date | null>();
    for (const f of followups) {
      if (!lastFollowupOf.has(f.customerId)) lastFollowupOf.set(f.customerId, f.followupAt);
    }

    const items = tasks.map((t) => ({
      customerId: t.customerId ?? '',
      customerName: t.customer?.name ?? '',
      phone: t.customer?.phonePrimary ?? null,
      customerCode: t.customer?.externalCustomerCode ?? null,
      reason: t.priorityReason ?? t.taskType,
      priority: priorityOfTaskType(t.taskType),
      taskId: t.id,
      taskType: t.taskType,
      assignedTo: t.assignedTo,
      expectedAmount: t.expectedAmount === null ? undefined : Number(t.expectedAmount),
      currency: t.expectedCurrency ?? undefined,
      balances: balByCustomer.get(t.customerId ?? '') ?? [],
      lastFollowupAt: lastFollowupOf.get(t.customerId ?? '') ?? null,
    }));
    items.sort((a, b) => a.priority - b.priority
      || (b.expectedAmount ?? 0) - (a.expectedAmount ?? 0));

    const expectedByCurrency: Record<string, number> = {};
    const totalBalanceByCurrency: Record<string, number> = {};
    for (const i of items) {
      if (i.expectedAmount && i.currency) {
        expectedByCurrency[i.currency] = (expectedByCurrency[i.currency] ?? 0) + i.expectedAmount;
      }
      for (const b of i.balances) {
        totalBalanceByCurrency[b.currency] = (totalBalanceByCurrency[b.currency] ?? 0) + b.balance;
      }
    }

    return {
      collectorId,
      isCollector: !!collectorId,
      isAdmin,
      generated: true,
      date: today,
      settings: null,
      summary: {
        tasksToday: items.length,
        expectedByCurrency,
        totalBalanceByCurrency,
        unassignedTasks: items.filter((i) => !i.assignedTo).length,
      },
      items,
    };
  }

  /**
   * محرك قائمة عمل اليوم (PR 5) — توليد مهام مخزنة ليوم اليوم من البيانات الحقيقية:
   * درجات المخاطر (PR 4)، تقادم الديون (PR 3)، الوعود، المتابعات، الأرصدة، الإسنادات.
   *
   * - منع التكرار: (عميل + عملة + نوع المهمة + تاريخ الاستحقاق + المصدر) — المفتاح
   *   (customerId|expectedCurrency|taskType|dueDate) يُفحص ضد المهام المفتوحة المستحقة
   *   اليوم قبل الإنشاء؛ إعادة التشغيل لا تُنتج أي مهام جديدة.
   * - تعدد الأسباب لنفس (عميل/عملة) → مهمة واحدة بأعلى أولوية وأسباب مدمجة في priorityReason.
   * - وعود مفتوحة (promise_due/promise_escalation) لنفس (عميل/عملة) → دمج الأسباب في
   *   مهمة الوعد بدلًا من إنشاء مهمة جديدة (لا حذف، لا تكرار).
   * - الإسناد: المحصل الحالي (effective_to IS NULL) إن وُجد؛ وإلا المهمة بلا إسناد
   *   (assigned_to = null) مع إيضاح «غير مسند لمحصل حالي» — لا نقل عملاء أبدًا.
   */
  async generateToday(user: AuthUser, req?: Request) {
    const orgId = user.organizationId;
    const today = startOfLocalDayUtc(new Date());
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const staleDays = Number(await this.setting(orgId, 'followup_stale_days', 14));
    const staleBefore = new Date(today.getTime() - staleDays * 86_400_000);
    const highBalanceTopPercent = Number(await this.setting(orgId, 'high_balance_top_percent', 10));

    // 0) مسح الوعود المتأخرة أولاً (idempotent) — التصعيدات جزء من القائمة
    await this.promises.sweepOverdue(orgId);

    const [
      customers,
      assignments,
      scores,
      agingSummaries,
      balances,
      followups,
      followupResults,
      promiseTasks,
      existingToday,
    ] = await Promise.all([
      this.prisma.customer.findMany({
        where: { organizationId: orgId, status: 'active' },
        select: { id: true },
      }),
      this.prisma.customerAssignment.findMany({
        where: { effectiveTo: null },
        select: { customerId: true, collectorId: true },
      }),
      this.prisma.customerScore.findMany({
        where: { customer: { organizationId: orgId } },
        orderBy: { computedAt: 'desc' },
        select: { customerId: true, score: true, riskLevel: true },
      }),
      this.prisma.debtAgingSummary.findMany({
        where: { customer: { organizationId: orgId } },
        select: { customerId: true, currencyCode: true, totalDue: true, bucket_120_plus: true },
      }),
      this.prisma.customerBalance.findMany({
        where: { customer: { organizationId: orgId }, accountingBalance: { gt: 0 } },
        select: { customerId: true, currencyCode: true, accountingBalance: true },
      }),
      this.prisma.followup.findMany({
        where: { customer: { organizationId: orgId }, deletedAt: null },
        select: { customerId: true, followupAt: true, nextFollowupDate: true, resultId: true },
      }),
      this.prisma.followupResult.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      }),
      this.prisma.task.findMany({
        where: {
          status: 'open',
          taskType: { in: ['promise_due', 'promise_escalation'] },
          dueDate: { lte: today },
          customer: { organizationId: orgId },
        },
        select: { id: true, customerId: true, expectedCurrency: true, priorityReason: true },
      }),
      this.prisma.task.findMany({
        where: {
          status: 'open',
          dueDate: { gte: today, lt: tomorrow },
          customer: { organizationId: orgId },
        },
        select: { customerId: true, expectedCurrency: true, taskType: true },
      }),
    ]);

    // الإسناد الحالي لكل عميل (مفتاح الدمج مع collector)
    const collectorByCustomer = new Map<string, string>();
    for (const a of assignments) collectorByCustomer.set(a.customerId, a.collectorId);

    // آخر تقييم مخاطر لكل عميل
    const riskByCustomer = new Map<string, { score: number; riskLevel: string }>();
    for (const s of scores) {
      if (!riskByCustomer.has(s.customerId)) {
        riskByCustomer.set(s.customerId, { score: Number(s.score), riskLevel: s.riskLevel });
      }
    }

    // مؤشرات نتائج المتابعات
    const noAnswerIds = new Set(followupResults.filter((r) => NO_ANSWER_RESULTS.includes(r.name)).map((r) => r.id));
    const needsVisitIds = new Set(followupResults.filter((r) => NEEDS_VISIT_RESULTS.includes(r.name)).map((r) => r.id));

    const lastFollowupAt = new Map<string, Date>();
    const nextFollowupDate = new Map<string, Date>();
    const noAnswerCount = new Map<string, number>();
    const needsVisit = new Set<string>();
    for (const f of followups) {
      const prev = lastFollowupAt.get(f.customerId);
      if (!prev || f.followupAt > prev) {
        lastFollowupAt.set(f.customerId, f.followupAt);
        if (f.nextFollowupDate) nextFollowupDate.set(f.customerId, f.nextFollowupDate);
        else nextFollowupDate.delete(f.customerId);
      }
      if (noAnswerIds.has(f.resultId)) noAnswerCount.set(f.customerId, (noAnswerCount.get(f.customerId) ?? 0) + 1);
      if (needsVisitIds.has(f.resultId)) needsVisit.add(f.customerId);
    }

    // تقادم الديون: لكل (عميل/عملة) إجمالي + علم +120
    const agingByKey = new Map<string, { totalDue: number; over120: boolean }>();
    for (const s of agingSummaries) {
      agingByKey.set(`${s.customerId}|${s.currencyCode}`, {
        totalDue: Number(s.totalDue),
        over120: Number(s.bucket_120_plus) > 0,
      });
    }

    // الأرصدة المدنية + حد "الرصيد المرتفع" (أعلى X% لكل عملة)
    const balanceByKey = new Map<string, number>();
    const balancesByCcy = new Map<string, number[]>();
    for (const b of balances) {
      const key = `${b.customerId}|${b.currencyCode}`;
      balanceByKey.set(key, Number(b.accountingBalance));
      const list = balancesByCcy.get(b.currencyCode) ?? [];
      list.push(Number(b.accountingBalance));
      balancesByCcy.set(b.currencyCode, list);
    }
    const topBalanceThresholdByCcy = new Map<string, number>();
    for (const [ccy, list] of balancesByCcy) {
      list.sort((a, b) => b - a);
      const n = Math.max(1, Math.ceil((list.length * highBalanceTopPercent) / 100));
      topBalanceThresholdByCcy.set(ccy, list[n - 1] ?? 0);
    }

    // عملات كل عميل + العملة الأساسية (أعلى دين/رصيد)
    const currenciesByCustomer = new Map<string, Set<string>>();
    for (const key of [...agingByKey.keys(), ...balanceByKey.keys()]) {
      const [cid, ccy] = key.split('|');
      if (!ccy) continue;
      const set = currenciesByCustomer.get(cid) ?? new Set<string>();
      set.add(ccy);
      currenciesByCustomer.set(cid, set);
    }
    const primaryCurrencyByCustomer = new Map<string, string | null>();
    for (const c of customers) {
      const ccySet = currenciesByCustomer.get(c.id);
      if (!ccySet || ccySet.size === 0) {
        primaryCurrencyByCustomer.set(c.id, null);
        continue;
      }
      let best: string | null = null;
      let bestVal = -1;
      for (const ccy of ccySet) {
        const val = agingByKey.get(`${c.id}|${ccy}`)?.totalDue ?? balanceByKey.get(`${c.id}|${ccy}`) ?? 0;
        if (val > bestVal) {
          bestVal = val;
          best = ccy;
        }
      }
      primaryCurrencyByCustomer.set(c.id, best);
    }

    // تغطية مهام الوعود المفتوحة (دَمج الأسباب فيها بدل الإنشاء)
    const promiseCoveredSlots = new Set<string>();
    for (const t of promiseTasks) {
      if (t.customerId) promiseCoveredSlots.add(`${t.customerId}|${t.expectedCurrency ?? ''}`);
    }

    // مفاتيح المهام المفتوحة المستحقة اليوم (منع التكرار)
    const existingKeys = new Set<string>();
    for (const t of existingToday) {
      existingKeys.add(queueTaskKey(t.customerId ?? '', t.expectedCurrency, t.taskType, today));
    }

    interface QueueReason { priority: number; taskType: string; text: string; }
    const rows: {
      customerId: string; assignedTo: string | null; createdBy: string; taskType: string;
      dueDate: Date; priorityReason: string; expectedAmount?: number; expectedCurrency?: string;
      status: string;
    }[] = [];
    const mergedPromiseBySlot = new Map<string, { task: { id: string; priorityReason: string | null } | undefined; texts: string[] }>();
    let skippedDup = 0;

    for (const c of customers) {
      const primary = primaryCurrencyByCustomer.get(c.id) ?? null;
      const risk = riskByCustomer.get(c.id);
      const last = lastFollowupAt.get(c.id) ?? null;
      const nxt = nextFollowupDate.get(c.id) ?? null;
      const noAnswer = noAnswerCount.get(c.id) ?? 0;
      const visit = needsVisit.has(c.id);
      const collectorId = collectorByCustomer.get(c.id) ?? null;

      const ccySet = currenciesByCustomer.get(c.id);
      const slots: string[] = ccySet && ccySet.size > 0
        ? [...ccySet].map((ccy) => `${c.id}|${ccy}`)
        : [`${c.id}|`];

      for (const slot of slots) {
        const ccy = slot.split('|')[1] ?? null;
        const reasons: QueueReason[] = [];

        // قواعد على مستوى العميل — تُقيَّم على العملة الأساسية فقط (تجنب التكرار بين العملات)
        if (ccy === primary) {
          if (nxt) {
            const overdueDays = Math.floor((today.getTime() - nxt.getTime()) / 86_400_000);
            if (overdueDays >= 2) {
              reasons.push({ priority: 3, taskType: 'followup_overdue', text: `متابعة متأخرة ${overdueDays} يومًا` });
            }
          }
          if (risk) {
            if (risk.riskLevel === 'critical') {
              reasons.push({ priority: 4, taskType: 'risk_critical', text: `مخاطر حرجة (${risk.score})` });
            } else if (risk.riskLevel === 'high') {
              reasons.push({ priority: 5, taskType: 'risk_high', text: `مخاطر مرتفعة (${risk.score})` });
            } else if (risk.riskLevel === 'medium') {
              reasons.push({ priority: 10, taskType: 'followup_periodic_medium', text: `متابعة دورية — مخاطر متوسطة (${risk.score})` });
            }
          }
          if (noAnswer >= 2) {
            reasons.push({ priority: 8, taskType: 'repeated_no_answer', text: `${noAnswer} متابعات بلا رد` });
          }
          if (visit) {
            reasons.push({ priority: 9, taskType: 'needs_visit', text: 'يحتاج زيارة ميدانية' });
          }
        }

        // قواعد على مستوى العملة
        if (ccy) {
          const aging = agingByKey.get(slot);
          const balance = balanceByKey.get(slot);
          if (aging?.over120) {
            reasons.push({ priority: 6, taskType: 'debt_120plus', text: `دين +120 يوم (${fmtAmount(aging.totalDue)} ${ccy})` });
          }
          const threshold = topBalanceThresholdByCcy.get(ccy) ?? 0;
          const stale = !last || last < staleBefore;
          if (balance !== undefined && balance >= threshold && stale) {
            reasons.push({ priority: 7, taskType: 'high_balance_no_followup', text: `رصيد مرتفع (${fmtAmount(balance)} ${ccy}) دون متابعة حديثة` });
          }
          if (balance !== undefined && stale) {
            reasons.push({ priority: 11, taskType: 'followup_normal', text: `متابعة عادية — رصيد مدين (${fmtAmount(balance)} ${ccy})` });
          }
        }

        if (reasons.length === 0) continue;

        reasons.sort((a, b) => a.priority - b.priority);
        const top = reasons[0];
        const texts = reasons.map((r) => r.text);

        // دمج: توجد مهمة وعد مفتوحة لنفس (عميل/عملة) → تحديث سببها فقط، لا إنشاء
        if (promiseCoveredSlots.has(slot)) {
          const existing = mergedPromiseBySlot.get(slot);
          if (existing) {
            for (const t of texts) if (!existing.texts.includes(t)) existing.texts.push(t);
          } else {
            mergedPromiseBySlot.set(slot, {
              task: promiseTasks.find((t) => t.customerId === c.id && (t.expectedCurrency ?? '') === (ccy ?? '')),
              texts: [...texts],
            });
          }
          continue;
        }

        // منع التكرار: مفتاح (عميل + عملة + نوع المهمة + تاريخ اليوم + المصدر)
        const key = queueTaskKey(c.id, ccy, top.taskType, today);
        if (existingKeys.has(key)) {
          skippedDup += 1;
          continue;
        }

        const aging = agingByKey.get(slot);
        const balance = balanceByKey.get(slot);
        const expectedAmount = aging?.totalDue ?? balance;
        rows.push({
          customerId: c.id,
          assignedTo: collectorId,
          createdBy: user.id,
          taskType: top.taskType,
          dueDate: today,
          priorityReason: texts.join('؛ ') + (collectorId ? '' : ' — غير مسند لمحصل حالي'),
          expectedAmount: expectedAmount ?? undefined,
          expectedCurrency: ccy ?? undefined,
          status: 'open',
        });
      }
    }

    const byTaskType: Record<string, number> = {};
    for (const r of rows) byTaskType[r.taskType] = (byTaskType[r.taskType] ?? 0) + 1;

    const createdCount = rows.length > 0
      ? (await this.prisma.task.createMany({ data: rows })).count
      : 0;

    // دمج الأسباب في مهام الوعود المفتوحة (تحديث priorityReason فقط — idempotent)
    for (const { task, texts } of mergedPromiseBySlot.values()) {
      if (!task) continue;
      const missing = texts.filter((t) => !(task.priorityReason ?? '').includes(t));
      if (missing.length > 0) {
        await this.prisma.task.update({
          where: { id: task.id },
          data: { priorityReason: [task.priorityReason, ...missing].filter(Boolean).join('؛ ') },
        });
      }
    }

    const assignedTasks = rows.filter((r) => r.assignedTo).length;
    const unassignedTasks = rows.length - assignedTasks;

    await this.audit.log({
      userId: user.id,
      action: 'daily_work_queue_generated',
      entityTable: 'tasks',
      newValue: { createdTasks: createdCount, assignedTasks, unassignedTasks, mergedIntoPromiseTasks: mergedPromiseBySlot.size, byTaskType },
      reason: `توليد قائمة عمل اليوم (${createdCount} مهمة جديدة، ${assignedTasks} مسندة، ${unassignedTasks} غير مسندة)`,
      req,
    });

    this.logger.log(`قائمة عمل اليوم: ${createdCount} مهمة جديدة (org ${orgId})`);
    return {
      organizationId: orgId,
      generatedAt: new Date().toISOString(),
      date: today,
      createdTasks: createdCount,
      assignedTasks,
      unassignedTasks,
      mergedIntoPromiseTasks: mergedPromiseBySlot.size,
      skippedExistingTasks: skippedDup,
      byTaskType,
    };
  }

  /**
   * الحساب الديناميكي القديم (مسار رجوعي عند غياب المهام المخزنة للمحصل).
   */
  private async dynamicToday(user: AuthUser, collector: { id: string }, orgId: string, today: Date) {
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

  /** مهام عميل مفتوحة (Customer360) — مرتبة حسب الأولوية ثم المبلغ المتوقع. */
  async listForCustomer(user: AuthUser, customerId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        status: 'open',
        customerId,
        customer: { organizationId: user.organizationId },
      },
      include: {
        customer: { select: { id: true, name: true, externalCustomerCode: true } },
        collector: { select: { id: true, user: { select: { fullName: true } } } },
      },
      orderBy: { dueDate: 'asc' },
    });
    return tasks
      .map((t) => ({
        id: t.id,
        customerId: t.customerId ?? '',
        customerName: t.customer?.name ?? '',
        customerCode: t.customer?.externalCustomerCode ?? null,
        taskType: t.taskType,
        priority: priorityOfTaskType(t.taskType),
        priorityReason: t.priorityReason ?? t.taskType,
        dueDate: t.dueDate,
        status: t.status,
        expectedAmount: t.expectedAmount === null ? null : Number(t.expectedAmount),
        expectedCurrency: t.expectedCurrency,
        assignedTo: t.assignedTo,
        assignedToName: t.collector?.user?.fullName ?? null,
      }))
      .sort((a, b) => a.priority - b.priority || (b.expectedAmount ?? 0) - (a.expectedAmount ?? 0));
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

  /**
   * إكمال مهمة مع تسجيل متابعة ونتيجتها (PR 9):
   * - يغلق المهمة المفتوحة (done) ويُسجّل متابعة بنتيجة معتمدة.
   * - عند result=promise: يُنشئ وعد سداد عبر PromisesService (وعد + مهمته في معاملة واحدة)
   *   مع التحقق المسبق من المدخلات حتى لا تُغلق المهمة ثم يفشل الوعد.
   * - بلا تحصيل مالي، بلا رسائل واتساب — إنجاز وتسجيل متابعة فقط.
   */
  async completeWithResult(user: AuthUser, taskId: string, dto: CompleteTaskDto, req?: Request) {
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
    if (task.status !== 'open') {
      throw new ConflictException(`المهمة في الحالة "${task.status}" — يمكن إتمام المهام المفتوحة فقط`);
    }
    if (!task.customerId) {
      throw new BadRequestException('المهمة بلا عميل — لا يمكن تسجيل متابعة لها');
    }

    const result = dto.result ?? 'note';
    const resultLabel = TASK_COMPLETE_RESULT_LABELS[result];

    // التحقق المسبق من الوعد قبل أي كتابة (لا إغلاق للمهمة ثم فشل الوعد)
    let promiseDue: { date: Date; amount: number; currency: string } | null = null;
    if (result === 'promise') {
      if (!dto.promiseDueDate) {
        throw new BadRequestException('عند اختيار نتيجة "وعد بالسداد" يجب تحديد تاريخ الاستحقاق (promiseDueDate)');
      }
      const amount = dto.promiseAmount ?? Number(task.expectedAmount ?? 0);
      const currency = dto.promiseCurrency ?? task.expectedCurrency ?? '';
      if (!amount || amount <= 0) {
        throw new BadRequestException(
          'عند اختيار "وعد بالسداد" يجب تحديد مبلغ الوعد (promiseAmount) أو أن يكون المبلغ المتوقع محددًا في المهمة',
        );
      }
      if (!currency) {
        throw new BadRequestException(
          'عند اختيار "وعد بالسداد" يجب تحديد عملة الوعد (promiseCurrency) أو أن تكون العملة محددة في المهمة',
        );
      }
      const currencyRow = await this.prisma.currency.findFirst({ where: { code: currency, active: true } });
      if (!currencyRow) throw new BadRequestException('العملة غير معروفة');
      promiseDue = { date: new Date(dto.promiseDueDate), amount, currency };
    }

    // نوع المتابعة الافتراضي + نتيجة المتابعة — upsert لضمان التوفر مهما كان سجل المنشأة
    const followupType = await this.prisma.followupType.upsert({
      where: { organizationId_name: { organizationId: user.organizationId, name: 'مكالمة هاتفية' } },
      update: {},
      create: { organizationId: user.organizationId, name: 'مكالمة هاتفية' },
    });
    const followupResult = await this.prisma.followupResult.upsert({
      where: { organizationId_name: { organizationId: user.organizationId, name: resultLabel } },
      update: {},
      create: { organizationId: user.organizationId, name: resultLabel },
    });

    // ذريًا: إغلاق المهمة + تسجيل المتابعة — لا إتمام بلا متابعة
    const followup = await this.prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { status: 'done' } });
      return tx.followup.create({
        data: {
          customerId: task.customerId!,
          userId: user.id,
          typeId: followupType.id,
          resultId: followupResult.id,
          followupAt: new Date(),
          notes: dto.notes
            ?? `إنجاز مهمة — ${resultLabel}${task.priorityReason ? ` (${task.priorityReason})` : ''}`,
          nextFollowupDate: dto.nextFollowupDate ? new Date(dto.nextFollowupDate) : null,
          expectedAmount: task.expectedAmount === null ? null : Number(task.expectedAmount),
          expectedCurrency: task.expectedCurrency,
        },
      });
    });

    await this.audit.log({
      userId: user.id, action: 'task_completed', entityTable: 'tasks', entityId: taskId,
      oldValue: { status: 'open' },
      newValue: {
        status: 'done', result: resultLabel, followupId: followup.id,
        promiseDueDate: promiseDue ? promiseDue.date.toISOString().slice(0, 10) : null,
      },
      req,
    });

    let promise: Awaited<ReturnType<PromisesService['create']>> | null = null;
    if (promiseDue) {
      promise = await this.promises.create(user, {
        customerId: task.customerId,
        collectorId: task.assignedTo ?? undefined,
        dueDate: promiseDue.date.toISOString(),
        expectedAmount: promiseDue.amount,
        currencyCode: promiseDue.currency,
        notes: dto.notes ?? `وعد سداد سُجّل من إكمال مهمة (${task.taskType})`,
      }, req);
    }

    return {
      task: { id: taskId, status: 'done' },
      followup: { id: followup.id, result: resultLabel },
      promise: promise ? { id: promise.id, dueDate: promiseDue!.date, status: promise.status } : null,
    };
  }

  /** إنشاء مهمة جديدة. الإدارة (customers.read_all) تحدد collectorId صراحة أو تُترك فارغة للإسناد الذاتي. */
  async create(user: AuthUser, dto: {
    customerId: string;
    taskType: string;
    dueDate: string;
    assignedTo?: string;
    priorityReason?: string;
    expectedAmount?: number;
    expectedCurrency?: string;
  }) {
    const isAdmin = user.permissions.includes('customers.read_all');
    let collectorId = dto.assignedTo;
    if (!collectorId) {
      const own = await this.collectorOf(user);
      if (own) {
        collectorId = own.id;
      } else if (isAdmin) {
        // الإدارة بلا collector: يبحث عن إسناد العميل
        const assignment = await this.prisma.customerAssignment.findFirst({
          where: { customerId: dto.customerId, effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (!assignment) {
          throw new BadRequestException('العميل غير مسند لأي محصل — يلزم إسناد ساري أو تحديد collectorId');
        }
        collectorId = assignment.collectorId;
      } else {
        throw new BadRequestException('حدد collectorId أو كن محصلاً');
      }
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود');

    const task = await this.prisma.task.create({
      data: {
        customerId: dto.customerId,
        assignedTo: collectorId,
        createdBy: user.id,
        taskType: dto.taskType,
        dueDate: new Date(dto.dueDate),
        priorityReason: dto.priorityReason,
        expectedAmount: dto.expectedAmount,
        expectedCurrency: dto.expectedCurrency,
        status: 'open',
      },
    });
    return this.prisma.task.findUnique({
      where: { id: task.id },
      include: { customer: { select: { id: true, name: true } } },
    });
  }
}
