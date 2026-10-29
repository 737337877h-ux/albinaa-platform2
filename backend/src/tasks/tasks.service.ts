import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { isActionableDebtorBalance } from '../common/debt-followup-policy';
import { orgCalendarDayUtc } from '../common/org-time';
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
 * 6. مديونية كبيرة مرّ عليها الحد الأدنى المحدد (7 أيام افتراضيًا)
 * 7. دين عمره +120 يوم
 * 8. رصيد مرتفع دون متابعة حديثة
 * 9. لا يرد متكرر
 * 10. يحتاج زيارة
 * 11. متابعة دورية — مخاطر متوسطة
 * 12. متابعة عادية منخفضة الأولوية
 */
export const TASK_TYPE_PRIORITY: Record<string, number> = {
  promise_overdue: 1,
  promise_escalation: 1,
  escalation_legal_120: 1.5,
  promise_due_today: 2,
  promise_due: 2,
  escalation_visit_90: 2.5,
  followup_overdue: 3,
  risk_critical: 4,
  account_group_risk_critical: 4,
  escalation_call_60: 4.5,
  risk_high: 5,
  account_group_risk_high: 5,
  large_debt_7plus: 6,
  escalation_message_30: 6.5,
  debt_120plus: 7,
  high_balance_no_followup: 8,
  account_group_priority: 8,
  repeated_no_answer: 9,
  needs_visit: 10,
  followup_periodic_medium: 11,
  followup_normal: 12,
};

/**
 * أسباب تُعاد هندستها كل يوم من الرصيد والمخاطر والتقادم الحالي. لا يجوز أن
 * تتحول نسخة الأمس منها إلى مهمة متأخرة جديدة لنفس العميل؛ مهام الوعود
 * والمتابعة المحددة والتحصيل الجزئي ليست ضمن هذه القائمة وتبقى حتى الإنجاز.
 */
export const REFRESHED_DAILY_TASK_TYPES = [
  'followup_overdue',
  'risk_critical',
  'risk_high',
  'large_debt_7plus',
  'debt_120plus',
  'high_balance_no_followup',
  'repeated_no_answer',
  'needs_visit',
  'followup_periodic_medium',
  'followup_normal',
  'escalation_message_30',
  'escalation_call_60',
  'escalation_visit_90',
  'escalation_legal_120',
  'account_group_priority',
  'account_group_risk_critical',
  'account_group_risk_high',
] as const;

/**
 * المهام التي أنشأها موظف أو نتجت عن وعد/متابعة/تحصيل جزئي. هذه وحدها
 * تُعرض في عداد «مهام اليوم»؛ أما توصيات المخاطر اليومية فتبقى في لوحة
 * الأولويات ولا تتحول إلى مئات المهام المجدولة.
 */
export function isScheduledTaskType(taskType: string | null | undefined): boolean {
  return !REFRESHED_DAILY_TASK_TYPES.includes(
    String(taskType ?? '') as (typeof REFRESHED_DAILY_TASK_TYPES)[number],
  );
}

export type DebtEscalationTaskType =
  | 'escalation_message_30'
  | 'escalation_call_60'
  | 'escalation_visit_90'
  | 'escalation_legal_120';

/** أعلى إجراء واجب فقط لكل عميل/عملة، حتى لا تتكدس أربع مهام لنفس الدين. */
export function escalationForAging(buckets: {
  bucket31To60: number;
  bucket61To90: number;
  bucket91To120: number;
  bucket120Plus: number;
}): { taskType: DebtEscalationTaskType; text: string } | null {
  if (buckets.bucket120Plus > 0) {
    return { taskType: 'escalation_legal_120', text: 'إنذار قانوني — مديونية تجاوزت 120 يومًا' };
  }
  if (buckets.bucket91To120 > 0) {
    return { taskType: 'escalation_visit_90', text: 'زيارة ميدانية — مديونية تجاوزت 90 يومًا' };
  }
  if (buckets.bucket61To90 > 0) {
    return { taskType: 'escalation_call_60', text: 'مكالمة تحصيل — مديونية تجاوزت 60 يومًا' };
  }
  if (buckets.bucket31To60 > 0) {
    return { taskType: 'escalation_message_30', text: 'رسالة تذكير — مديونية تجاوزت 30 يومًا' };
  }
  return null;
}

export function priorityOfTaskType(taskType: string): number {
  return TASK_TYPE_PRIORITY[taskType] ?? 100;
}

function isAccountGroupTaskType(taskType: string): boolean {
  return taskType === 'account_group_priority'
    || taskType === 'account_group_risk_critical'
    || taskType === 'account_group_risk_high';
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

  /**
   * CustomerBalance is the last imported Oracle snapshot.  Collections and
   * other post-import events live in OperationalLedger, so work queues must
   * use the combined balance rather than the stale snapshot alone.
   */
  private async operationalDebtorBalances(orgId: string, customerIds?: string[]) {
    if (customerIds && customerIds.length === 0) return [];
    const balances = await this.prisma.customerBalance.findMany({
      where: {
        customer: { organizationId: orgId },
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
      },
      select: {
        customerId: true,
        currencyCode: true,
        accountingBalance: true,
        lastImportJob: { select: { importedAt: true } },
        customer: { select: { customerType: true, status: true } },
      },
    });
    const ids = [...new Set(balances.map((balance) => balance.customerId))];
    const ledger = ids.length === 0 ? [] : await this.prisma.operationalLedger.findMany({
      where: { customerId: { in: ids } },
      select: { customerId: true, currencyCode: true, amountSigned: true, createdAt: true },
    });
    const cutoffByKey = new Map(balances.map((balance) => [
      `${balance.customerId}|${balance.currencyCode}`,
      balance.lastImportJob?.importedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
    ]));
    const deltaByKey = new Map<string, number>();
    for (const entry of ledger) {
      const key = `${entry.customerId}|${entry.currencyCode}`;
      const cutoff = cutoffByKey.get(key);
      if (cutoff == null || entry.createdAt.getTime() <= cutoff) continue;
      deltaByKey.set(key, (deltaByKey.get(key) ?? 0) + Number(entry.amountSigned));
    }
    return balances.map((balance) => ({
      customerId: balance.customerId,
      currencyCode: balance.currencyCode,
      accountingBalance: Number(balance.accountingBalance),
      operationalBalance: Number(balance.accountingBalance)
        + (deltaByKey.get(`${balance.customerId}|${balance.currencyCode}`) ?? 0),
      customerType: balance.customer.customerType,
      customerStatus: balance.customer.status,
    })).filter((balance) => isActionableDebtorBalance(
      balance.operationalBalance,
      balance.currencyCode,
    ));
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
    const today = orgCalendarDayUtc();
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

    const today = orgCalendarDayUtc();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const isAdmin = user.permissions.includes('customers.read_all');

    const stored = await this.prisma.task.findMany({
      where: {
        status: 'open',
        dueDate: { lt: tomorrow },
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
        customer: { select: { id: true, name: true, phonePrimary: true, externalCustomerCode: true, customerType: true } },
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

  /** برنامج المهام المجدولة، منفصل عن توصيات «قرار اليوم». */
  async scheduled(
    user: AuthUser,
    bucket: 'today' | 'overdue',
    collectorIdParam?: string,
  ) {
    const orgId = user.organizationId;
    const collector = await this.resolveCollectorOrNull(user, collectorIdParam);
    const isAdmin = user.permissions.includes('customers.read_all');
    const today = orgCalendarDayUtc();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const dueDate = bucket === 'today' ? { gte: today, lt: tomorrow } : { lt: today };
    const tasks = await this.prisma.task.findMany({
      where: {
        status: 'open',
        taskType: { notIn: [...REFRESHED_DAILY_TASK_TYPES] },
        dueDate,
        customer: { organizationId: orgId },
        ...(collectorIdParam
          ? { assignedTo: collectorIdParam }
          : isAdmin
            ? {}
            : collector
              ? { assignedTo: collector.id }
              : { assignedTo: 'no-access' }),
      },
      include: {
        customer: { select: { id: true, name: true, phonePrimary: true, externalCustomerCode: true, customerType: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
    return this.boardFromTasks(user, collector?.id ?? null, isAdmin, today, tasks);
  }

  /**
   * بناء لوحة اليوم من المهام المخزنة المفتوحة المستحقة اليوم، مرتبة حسب الأولوية
   * (TASK_TYPE_PRIORITY) ثم المبلغ المتوقع تنازليًا.
   */
  private async boardFromTasks(
    user: AuthUser,
    collectorId: string | null,
    isAdmin: boolean,
    today: Date,
    tasks: {
      id: string; customerId: string | null; assignedTo: string | null; taskType: string;
      priorityReason: string | null; expectedAmount: unknown; expectedCurrency: string | null;
      customer: { id: string; name: string; phonePrimary: string | null; externalCustomerCode: string | null; customerType: string | null } | null;
    }[],
  ) {
    const customerIds = [...new Set(tasks.map((t) => t.customerId).filter((x): x is string => !!x))];
    const groupPrimaryIds = [...new Set(tasks
      .filter((task) => isAccountGroupTaskType(task.taskType) && task.customerId)
      .map((task) => task.customerId as string))];
    const groupLinks = groupPrimaryIds.length > 0
      ? await this.prisma.customerAccountLink.findMany({
        where: { organizationId: user.organizationId, primaryCustomerId: { in: groupPrimaryIds } },
        select: { primaryCustomerId: true, childCustomerId: true },
      })
      : [];
    const groupMemberIds = [...new Set([...groupPrimaryIds, ...groupLinks.map((link) => link.childCustomerId)])];
    const [allOperationalBalances, followups] = await Promise.all([
      this.operationalDebtorBalances(user.organizationId),
      this.prisma.followup.findMany({
        where: { customerId: { in: customerIds }, deletedAt: null },
        select: { customerId: true, followupAt: true },
        orderBy: { followupAt: 'desc' },
      }),
    ]);
    const customerIdSet = new Set(customerIds);
    const groupMemberIdSet = new Set(groupMemberIds);
    const balances = allOperationalBalances.filter((balance) => customerIdSet.has(balance.customerId));
    const groupMemberBalances = allOperationalBalances.filter((balance) => groupMemberIdSet.has(balance.customerId));
    const portfolioCustomerBalances = allOperationalBalances.filter((balance) =>
      balance.customerStatus === 'active' && balance.customerType !== 'advance');

    const balByCustomer = new Map<string, { currency: string; balance: number }[]>();
    for (const b of balances) {
      const list = balByCustomer.get(b.customerId) ?? [];
      list.push({ currency: b.currencyCode, balance: b.operationalBalance });
      balByCustomer.set(b.customerId, list);
    }
    const primaryByMember = new Map<string, string>();
    for (const primaryId of groupPrimaryIds) primaryByMember.set(primaryId, primaryId);
    for (const link of groupLinks) primaryByMember.set(link.childCustomerId, link.primaryCustomerId);
    const groupBalancesByPrimary = new Map<string, Map<string, number>>();
    for (const balance of groupMemberBalances) {
      const primaryId = primaryByMember.get(balance.customerId);
      if (!primaryId) continue;
      const byCurrency = groupBalancesByPrimary.get(primaryId) ?? new Map<string, number>();
      byCurrency.set(
        balance.currencyCode,
        (byCurrency.get(balance.currencyCode) ?? 0) + balance.operationalBalance,
      );
      groupBalancesByPrimary.set(primaryId, byCurrency);
    }
    const lastFollowupOf = new Map<string, Date | null>();
    for (const f of followups) {
      if (!lastFollowupOf.has(f.customerId)) lastFollowupOf.set(f.customerId, f.followupAt);
    }

    const candidateItems = tasks.map((t) => ({
      customerId: t.customerId ?? '',
      customerName: t.customer?.name ?? '',
      phone: t.customer?.phonePrimary ?? null,
      customerCode: t.customer?.externalCustomerCode ?? null,
      accountClass: t.customer?.customerType === 'advance' ? 'advance' : 'customer',
      reason: t.priorityReason ?? t.taskType,
      priority: priorityOfTaskType(t.taskType),
      taskId: t.id,
      taskType: t.taskType,
      assignedTo: t.assignedTo,
      expectedAmount: t.expectedAmount === null ? undefined : Number(t.expectedAmount),
      currency: t.expectedCurrency ?? undefined,
      balances: isAccountGroupTaskType(t.taskType)
        ? [...(groupBalancesByPrimary.get(t.customerId ?? '') ?? new Map<string, number>()).entries()]
          .map(([currency, balance]) => ({ currency, balance }))
        : balByCustomer.get(t.customerId ?? '') ?? [],
      lastFollowupAt: lastFollowupOf.get(t.customerId ?? '') ?? null,
    })).filter((item) => item.balances.length > 0);
    candidateItems.sort((a, b) => a.priority - b.priority
      || (b.expectedAmount ?? 0) - (a.expectedAmount ?? 0));
    // A collector must see one actionable card per account. Keep the highest
    // priority task and retain all positive currency balances on that card.
    const seenCustomers = new Set<string>();
    const items = candidateItems.filter((item) => {
      if (!item.customerId || seenCustomers.has(item.customerId)) return false;
      seenCustomers.add(item.customerId);
      return true;
    });
    items.sort((a, b) => a.priority - b.priority
      || (b.expectedAmount ?? 0) - (a.expectedAmount ?? 0));

    const expectedTargets = new Map<string, number>();
    for (const i of items) {
      if (!isAccountGroupTaskType(i.taskType) && i.expectedAmount && i.currency) {
        const positiveBalance = i.balances.find((b) => b.currency === i.currency)?.balance;
        const capped = positiveBalance == null ? i.expectedAmount : Math.min(i.expectedAmount, positiveBalance);
        const key = `${i.customerId}|${i.currency}`;
        expectedTargets.set(key, Math.max(expectedTargets.get(key) ?? 0, capped));
      }
    }
    const expectedByCurrency: Record<string, number> = {};
    for (const [key, amount] of expectedTargets) {
      const currency = key.split('|')[1];
      expectedByCurrency[currency] = (expectedByCurrency[currency] ?? 0) + amount;
    }
    const totalBalanceByCurrency: Record<string, number> = {};
    const customerBalanceByCurrency: Record<string, number> = {};
    const advanceBalanceByCurrency: Record<string, number> = {};
    const accountClassByCustomer = new Map(items.map((item) => [item.customerId, item.accountClass]));
    for (const balance of balances) {
      const currency = balance.currencyCode;
      const amount = balance.operationalBalance;
      totalBalanceByCurrency[currency] = (totalBalanceByCurrency[currency] ?? 0) + amount;
      const target = accountClassByCustomer.get(balance.customerId) === 'advance'
        ? advanceBalanceByCurrency
        : customerBalanceByCurrency;
      target[currency] = (target[currency] ?? 0) + amount;
    }
    const portfolioCustomerDebtByCurrency: Record<string, number> = {};
    for (const balance of portfolioCustomerBalances) {
      portfolioCustomerDebtByCurrency[balance.currencyCode] =
        (portfolioCustomerDebtByCurrency[balance.currencyCode] ?? 0) + balance.operationalBalance;
    }
    const excludedCustomerDebtByCurrency: Record<string, number> = {};
    for (const [currency, portfolioAmount] of Object.entries(portfolioCustomerDebtByCurrency)) {
      const difference = portfolioAmount - (customerBalanceByCurrency[currency] ?? 0);
      excludedCustomerDebtByCurrency[currency] = Math.abs(difference) < 0.00005 ? 0 : difference;
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
        customerBalanceByCurrency,
        advanceBalanceByCurrency,
        portfolioCustomerDebtByCurrency,
        excludedCustomerDebtByCurrency,
        unassignedTasks: items.filter((i) => !i.assignedTo).length,
        methodology: {
          expected: 'أعلى مبلغ مستهدف لكل حساب وعملة، بحد أقصى الرصيد المدين، دون تكرار المهام',
          balances: 'أرصدة مدينة فريدة للحسابات النشطة الموجودة في قائمة عمل اليوم، دون تكرار الحساب أو إدخال الحسابات المدمجة',
        },
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
    const enabledValue = await this.setting<unknown>(orgId, 'smartTasks.enabled', true);
    const enabled = enabledValue !== false && String(enabledValue).toLowerCase() !== 'false';
    if (!enabled) {
      return { organizationId: orgId, enabled: false, skipped: true, reason: 'smart_tasks_disabled', createdTasks: 0 };
    }
    const today = orgCalendarDayUtc();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const staleDays = Math.max(1, Number(await this.setting(orgId, 'smartTasks.followupStaleDays', 7)) || 7);
    const minDebtAgeDays = Math.max(1, Number(await this.setting(orgId, 'smartTasks.minDebtAgeDays', 7)) || 7);
    const staleBefore = new Date(today.getTime() - staleDays * 86_400_000);
    const highBalanceTopPercent = Math.min(100, Math.max(1, Number(await this.setting(orgId, 'smartTasks.highBalanceTopPercent', 10)) || 10));

    // 0) مسح الوعود المتأخرة أولاً (idempotent) — التصعيدات جزء من القائمة
    await this.promises.sweepOverdue(orgId);

    // مهام الأولوية المحسوبة هي لقطة يومية وليست مواعيد مستقلة. إغلاق نسخة
    // الأيام السابقة يمنع تكرار العميل في «اليوم» و«المتأخرة» معًا، مع إبقاء
    // الوعود والمتابعات اليدوية وموعد متبقي التحصيل مفتوحة كما هي.
    const refreshedPreviousTasks = await this.prisma.task.updateMany({
      where: {
        status: 'open',
        dueDate: { lt: today },
        sourcePromiseId: null,
        taskType: { in: [...REFRESHED_DAILY_TASK_TYPES] },
        customer: { organizationId: orgId },
      },
      data: { status: 'done' },
    });

    const [
      customers,
      assignments,
      scores,
      agingSummaries,
      snapshotBalances,
      latestDebitTransactions,
      followups,
      followupResults,
      promiseTasks,
      existingToday,
      accountLinks,
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
        where: { customer: { organizationId: orgId }, reversedAt: null },
        select: {
          customerId: true, currencyCode: true, totalDue: true,
          bucket_31_60: true, bucket_61_90: true, bucket_91_120: true, bucket_120_plus: true,
        },
      }),
      this.prisma.customerBalance.findMany({
        where: { customer: { organizationId: orgId }, accountingBalance: { gt: 0 } },
        select: { customerId: true, currencyCode: true, accountingBalance: true },
      }),
      this.prisma.importedTransaction.groupBy({
        by: ['customerId', 'currencyCode'],
        where: { customer: { organizationId: orgId }, debit: { gt: 0 }, reversedAt: null },
        _max: { txDate: true },
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
      this.prisma.customerAccountLink.findMany({
        where: { organizationId: orgId },
        select: { primaryCustomerId: true, childCustomerId: true },
      }),
    ]);
    // Replace the imported snapshot balances with the live operational view.
    // The snapshot query remains in the batch above for compatibility with
    // existing Prisma mocks and can be removed in a later cleanup.
    void snapshotBalances;
    const balances = await this.operationalDebtorBalances(orgId);

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
    const agingByKey = new Map<string, {
      totalDue: number;
      over120: boolean;
      escalation: ReturnType<typeof escalationForAging>;
    }>();
    for (const s of agingSummaries) {
      agingByKey.set(`${s.customerId}|${s.currencyCode}`, {
        totalDue: Number(s.totalDue),
        over120: Number(s.bucket_120_plus) > 0,
        escalation: escalationForAging({
          bucket31To60: Number(s.bucket_31_60),
          bucket61To90: Number(s.bucket_61_90),
          bucket91To120: Number(s.bucket_91_120),
          bucket120Plus: Number(s.bucket_120_plus),
        }),
      });
    }

    // الأرصدة المدنية + حد "الرصيد المرتفع" (أعلى X% لكل عملة)
    const balanceByKey = new Map<string, number>();
    const balancesByCcy = new Map<string, number[]>();
    for (const b of balances) {
      const key = `${b.customerId}|${b.currencyCode}`;
      balanceByKey.set(key, Number(b.operationalBalance));
      const list = balancesByCcy.get(b.currencyCode) ?? [];
      list.push(Number(b.operationalBalance));
      balancesByCcy.set(b.currencyCode, list);
    }
    const topBalanceThresholdByCcy = new Map<string, number>();
    for (const [ccy, list] of balancesByCcy) {
      list.sort((a, b) => b - a);
      const n = Math.max(1, Math.ceil((list.length * highBalanceTopPercent) / 100));
      topBalanceThresholdByCcy.set(ccy, list[n - 1] ?? 0);
    }
    const latestDebitByKey = new Map<string, Date>();
    for (const tx of latestDebitTransactions) {
      if (tx._max.txDate) latestDebitByKey.set(`${tx.customerId}|${tx.currencyCode}`, tx._max.txDate);
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
              reasons.push({ priority: 11, taskType: 'followup_periodic_medium', text: `متابعة دورية — مخاطر متوسطة (${risk.score})` });
            }
          }
          if (noAnswer >= 2) {
            reasons.push({ priority: 9, taskType: 'repeated_no_answer', text: `${noAnswer} متابعات بلا رد` });
          }
          if (visit) {
            reasons.push({ priority: 10, taskType: 'needs_visit', text: 'يحتاج زيارة ميدانية' });
          }
        }

        // قواعد على مستوى العملة
        if (ccy) {
          const aging = agingByKey.get(slot);
          const balance = balanceByKey.get(slot);
          if (aging?.escalation) {
            reasons.push({
              priority: priorityOfTaskType(aging.escalation.taskType),
              taskType: aging.escalation.taskType,
              text: aging.escalation.text,
            });
          }
          if (aging?.over120) {
            reasons.push({ priority: 7, taskType: 'debt_120plus', text: `دين +120 يوم (${fmtAmount(aging.totalDue)} ${ccy})` });
          }
          const threshold = topBalanceThresholdByCcy.get(ccy) ?? 0;
          const stale = !last || last < staleBefore;
          const latestDebit = latestDebitByKey.get(slot);
          const debtAgeDays = latestDebit
            ? Math.max(0, Math.floor((today.getTime() - latestDebit.getTime()) / 86_400_000))
            : null;
          if (balance !== undefined && balance >= threshold && debtAgeDays !== null && debtAgeDays >= minDebtAgeDays) {
            reasons.push({ priority: 6, taskType: 'large_debt_7plus', text: `مديونية كبيرة (${fmtAmount(balance)} ${ccy}) مرّ عليها ${debtAgeDays} يومًا` });
          }
          if (balance !== undefined && balance >= threshold && stale) {
            reasons.push({ priority: 8, taskType: 'high_balance_no_followup', text: `رصيد مرتفع (${fmtAmount(balance)} ${ccy}) دون متابعة حديثة` });
          }
          if (balance !== undefined && stale) {
            reasons.push({ priority: 12, taskType: 'followup_normal', text: `متابعة عادية — رصيد مدين (${fmtAmount(balance)} ${ccy})` });
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

    // الحساب الرئيسي يدخل قائمة الأولوية بمديونية مجموعته، دون نقل أو دمج
    // أي رصيد أو حركة من الحسابات الفرعية. هذه مهمة عرض/متابعة إضافية فقط،
    // ولا تدخل في إجمالي التحصيل المتوقع حتى لا يتكرر احتساب دين الفرعيات.
    const membersByPrimary = new Map<string, Set<string>>();
    for (const link of accountLinks) {
      const members = membersByPrimary.get(link.primaryCustomerId) ?? new Set<string>([link.primaryCustomerId]);
      members.add(link.childCustomerId);
      membersByPrimary.set(link.primaryCustomerId, members);
    }
    for (const [primaryCustomerId, memberIds] of membersByPrimary) {
      const totals = new Map<string, number>();
      for (const memberId of memberIds) {
        for (const [key, amount] of balanceByKey) {
          const [customerId, currency] = key.split('|');
          if (customerId !== memberId || !currency || amount <= 0) continue;
          totals.set(currency, (totals.get(currency) ?? 0) + amount);
        }
      }
      const collectorId = collectorByCustomer.get(primaryCustomerId) ?? null;
      const riskOrder: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
      const groupRisk = [...memberIds]
        .map((memberId) => riskByCustomer.get(memberId))
        .filter((risk): risk is { score: number; riskLevel: string } => !!risk)
        .sort((left, right) => (riskOrder[right.riskLevel] ?? -1) - (riskOrder[left.riskLevel] ?? -1)
          || right.score - left.score)[0];
      const groupTaskType = groupRisk?.riskLevel === 'critical'
        ? 'account_group_risk_critical'
        : groupRisk?.riskLevel === 'high'
          ? 'account_group_risk_high'
          : 'account_group_priority';
      const groupRiskText = groupRisk?.riskLevel === 'critical'
        ? ` — مخاطر المجموعة حرجة (${groupRisk.score})`
        : groupRisk?.riskLevel === 'high'
          ? ` — مخاطر المجموعة مرتفعة (${groupRisk.score})`
          : '';
      for (const [currency, amount] of totals) {
        const alreadyExists = ['account_group_priority', 'account_group_risk_critical', 'account_group_risk_high']
          .some((type) => existingKeys.has(queueTaskKey(primaryCustomerId, currency, type, today)));
        if (alreadyExists) continue;
        rows.push({
          customerId: primaryCustomerId,
          assignedTo: collectorId,
          createdBy: user.id,
          taskType: groupTaskType,
          dueDate: today,
          priorityReason: `حساب رئيسي — إجمالي مديونية المجموعة (${fmtAmount(amount)} ${currency})${groupRiskText}${collectorId ? '' : ' — غير مسند لمحصل حالي'}`,
          expectedAmount: amount,
          expectedCurrency: currency,
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
      enabled: true,
      generatedAt: new Date().toISOString(),
      date: today,
      refreshedPreviousTasks: refreshedPreviousTasks.count,
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
    const operationalBalances = await this.operationalDebtorBalances(
      orgId,
      assigned.map((customer) => customer.id),
    );
    const operationalByCustomer = new Map<string, { currency: string; balance: number }[]>();
    for (const balance of operationalBalances) {
      const list = operationalByCustomer.get(balance.customerId) ?? [];
      list.push({ currency: balance.currencyCode, balance: balance.operationalBalance });
      operationalByCustomer.set(balance.customerId, list);
    }

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
      return operationalByCustomer.get(id) ?? [];
    };
    const lastFollowupOf = (id: string) =>
      assigned.find((x) => x.id === id)?.followups[0]?.followupAt ?? null;

    for (const t of promiseTasks) {
      if (!t.customerId) continue;
      const taskBalances = balancesOf(t.customerId);
      if (taskBalances.length === 0) continue;
      items.push({
        customerId: t.customerId,
        customerName: t.customer?.name ?? '',
        phone: t.customer?.phonePrimary ?? null,
        reason: t.taskType === 'promise_escalation' ? 'وعد سداد متأخر (تصعيد)' : 'وعد سداد مستحق اليوم',
        priority: t.taskType === 'promise_escalation' ? 1 : 2,
        taskId: t.id,
        expectedAmount: t.expectedAmount === null ? undefined : Number(t.expectedAmount),
        currency: t.expectedCurrency ?? undefined,
        balances: taskBalances,
        lastFollowupAt: lastFollowupOf(t.customerId),
      });
      included.add(t.customerId);
    }

    // 2) لم تتم متابعتهم منذ X يومًا (وعليهم رصيد مدين)
    for (const c of assigned) {
      if (included.has(c.id) || balancesOf(c.id).length === 0) continue;
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
      for (const b of balancesOf(c.id)) {
        const list = debtorsByCcy.get(b.currency) ?? [];
        list.push({ id: c.id, bal: b.balance });
        debtorsByCcy.set(b.currency, list);
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
      if (included.has(c.id) || balancesOf(c.id).length === 0) continue;
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

    const expectedTargets = new Map<string, number>();
    for (const i of items) {
      if (i.expectedAmount && i.currency) {
        const positiveBalance = i.balances.find((b) => b.currency === i.currency)?.balance;
        const capped = positiveBalance == null ? i.expectedAmount : Math.min(i.expectedAmount, positiveBalance);
        const key = `${i.customerId}|${i.currency}`;
        expectedTargets.set(key, Math.max(expectedTargets.get(key) ?? 0, capped));
      }
    }
    const expectedByCurrency: Record<string, number> = {};
    for (const [key, amount] of expectedTargets) {
      const currency = key.split('|')[1];
      expectedByCurrency[currency] = (expectedByCurrency[currency] ?? 0) + amount;
    }
    const totalBalanceByCurrency: Record<string, number> = {};
    const seenBalances = new Set<string>();
    for (const i of items) {
      for (const b of i.balances) {
        const key = `${i.customerId}|${b.currency}`;
        if (seenBalances.has(key)) continue;
        seenBalances.add(key);
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
        methodology: {
          expected: 'أعلى مبلغ مستهدف لكل حساب وعملة، بحد أقصى الرصيد المدين، دون تكرار المهام',
          balances: 'أرصدة مدينة فريدة للحسابات الموجودة في قائمة عمل اليوم فقط، دون تكرار الحساب',
        },
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
    const [actionableBalance] = await this.operationalDebtorBalances(user.organizationId, [customerId]);
    if (!actionableBalance) return [];

    const today = orgCalendarDayUtc();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const selected = new Map<string, typeof tasks[number]>();
    for (const task of tasks) {
      const bucket = task.dueDate < today ? 'overdue' : task.dueDate < tomorrow ? 'today' : 'upcoming';
      const current = selected.get(bucket);
      if (!current || priorityOfTaskType(task.taskType) < priorityOfTaskType(current.taskType)) {
        selected.set(bucket, task);
      }
    }

    return [...selected.values()]
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
  async list(
    user: AuthUser,
    collectorIdParam?: string,
    status = 'open',
    bucket: 'today' | 'overdue' | 'upcoming' | 'all' = 'all',
  ) {
    const collector = await this.resolveCollector(user, collectorIdParam);
    const today = orgCalendarDayUtc();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const dueDate = bucket === 'today'
      ? { gte: today, lt: tomorrow }
      : bucket === 'overdue'
        ? { lt: today }
        : bucket === 'upcoming'
          ? { gte: tomorrow }
          : undefined;
    const tasks = await this.prisma.task.findMany({
      where: { assignedTo: collector.id, status, ...(dueDate ? { dueDate } : {}) },
      include: {
        customer: { select: { id: true, name: true, externalCustomerCode: true } },
        sourcePromise: { select: { id: true, dueDate: true, expectedAmount: true, currencyCode: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
    if (status !== 'open') return tasks;

    const customerIds = [...new Set(tasks
      .map((task) => task.customerId)
      .filter((id): id is string => !!id))];
    const actionableBalances = await this.operationalDebtorBalances(user.organizationId, customerIds);
    const actionableCustomers = new Set(actionableBalances.map((balance) => balance.customerId));
    const selected = new Map<string, typeof tasks[number]>();
    for (const task of tasks) {
      if (!task.customerId || !actionableCustomers.has(task.customerId)) continue;
      const current = selected.get(task.customerId);
      if (!current || priorityOfTaskType(task.taskType) < priorityOfTaskType(current.taskType)) {
        selected.set(task.customerId, task);
      }
    }
    return [...selected.values()].sort((a, b) =>
      a.dueDate.getTime() - b.dueDate.getTime()
      || priorityOfTaskType(a.taskType) - priorityOfTaskType(b.taskType));
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

    // التحقق المسبق من الوعد قبل أي كتابة (لا إغلاق للمهمة ثم فشل الوعد):
    // التاريخ/المبلغ/العملة + وجود إسناد ساري — والوعد يُسجَّل دائمًا باسم
    // المحصل المسند حاليًا للعميل (قاعدة M5: لا وعد بلا إسناد ساري).
    let promiseDue: { date: Date; amount: number; currency: string; collectorId: string } | null = null;
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
      const assignment = await this.prisma.customerAssignment.findFirst({
        where: { customerId: task.customerId!, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!assignment) {
        throw new BadRequestException('العميل غير مسند لأي محصل حاليًا — تعذّر تسجيل وعد سداد');
      }
      promiseDue = {
        date: new Date(dto.promiseDueDate),
        amount,
        currency,
        collectorId: assignment.collectorId,
      };
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
        collectorId: promiseDue.collectorId,
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
