import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { priorityOfTaskType } from '../tasks/tasks.service';

/**
 * Dashboard API — المؤشرات الأساسية المتاحة من بيانات المرحلة الحالية.
 * ملاحظات منهجية موثقة (من مرحلة التحقق):
 * - كل المؤشرات المالية مفصولة حسب العملة — لا جمع مخلوطًا بين عملات.
 * - "المديونية الجديدة" = الزيادات الموجبة بين آخر استيرادين (Snapshots).
 * - أعمار الديون "تقديرية" حصريًا (بحسب أقدم حركة متاحة، لا تواريخ استحقاق) —
 *   تُعرض بعلامة estimated=true ولا تُقدَّم كعمر محاسبي مؤكد.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async navCounts(user: AuthUser) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const collector = user.permissions.includes('customers.read_all')
      ? null
      : await this.prisma.collector.findUnique({ where: { userId: user.id }, select: { id: true } });
    const customerScope = user.permissions.includes('customers.read_all')
      ? { organizationId: user.organizationId }
      : { organizationId: user.organizationId, assignments: { some: { collectorId: collector?.id ?? 'no-access', effectiveTo: null } } };
    const taskWhere = user.permissions.includes('customers.read_all')
      ? { status: 'open', customer: { organizationId: user.organizationId } }
      : { status: 'open', assignedTo: collector?.id ?? 'no-access' };
    const tasks = await this.prisma.task.count({ where: taskWhere });
    const followups = await this.prisma.followup.count({ where: { customer: customerScope, deletedAt: null, nextFollowupDate: { lte: today } } });
    const promises = await this.prisma.paymentPromise.count({ where: { customer: customerScope, status: { in: ['upcoming', 'due_today', 'unfulfilled'] }, dueDate: { lte: today } } });
    return { tasks, followups, promises };
  }

  async summary(user: AuthUser) {
    const orgId = user.organizationId;

    const [totalCustomers, activeCustomers, balances, lastImport, pendingDuplicates, advanceBalances] =
      await Promise.all([
        this.prisma.customer.count({ where: { organizationId: orgId, OR: [{ customerType: null }, { customerType: { not: 'advance' } }] } }),
        this.prisma.customer.count({ where: { organizationId: orgId, status: 'active', OR: [{ customerType: null }, { customerType: { not: 'advance' } }] } }),
        this.prisma.customerBalance.findMany({
          where: { customer: { organizationId: orgId, OR: [{ customerType: null }, { customerType: { not: 'advance' } }] } },
          select: { customerId: true, currencyCode: true, accountingBalance: true },
        }),
        this.prisma.importJob.findFirst({
          where: { organizationId: orgId, status: 'completed' },
          orderBy: { importedAt: 'desc' },
          select: { id: true, fileName: true, importedAt: true },
        }),
        this.prisma.potentialDuplicateCustomer.count({
          where: { reviewStatus: 'pending', customerA: { organizationId: orgId } },
        }),
        this.prisma.customerBalance.findMany({
          where: { customer: { organizationId: orgId, customerType: 'advance', status: 'active' } },
          select: { customerId: true, currencyCode: true, accountingBalance: true },
        }),
      ]);

    // ---- تجميع حسب العملة: مدينون/دائنون/صفر + الإجماليات ----
    const byCurrency: Record<string, {
      debtors: number; debtTotal: number;
      creditors: number; creditTotal: number;
      zero: number;
    }> = {};
    for (const b of balances) {
      const ccy = b.currencyCode;
      byCurrency[ccy] ??= { debtors: 0, debtTotal: 0, creditors: 0, creditTotal: 0, zero: 0 };
      const v = Number(b.accountingBalance);
      if (v > 0) { byCurrency[ccy].debtors += 1; byCurrency[ccy].debtTotal += v; }
      else if (v < 0) { byCurrency[ccy].creditors += 1; byCurrency[ccy].creditTotal += -v; }
      else byCurrency[ccy].zero += 1;
    }

    const advanceByCurrency: Record<string, { accounts: number; balance: number }> = {};
    for (const balance of advanceBalances) {
      advanceByCurrency[balance.currencyCode] ??= { accounts: 0, balance: 0 };
      advanceByCurrency[balance.currencyCode].accounts += 1;
      advanceByCurrency[balance.currencyCode].balance += Number(balance.accountingBalance);
    }

    return {
      customers: {
        total: totalCustomers,
        active: activeCustomers,
        withBalances: new Set(balances.map((b) => b.customerId)).size,
      },
      advances: { accounts: new Set(advanceBalances.map((row) => row.customerId)).size, byCurrency: advanceByCurrency },
      byCurrency,
      lastImport,
      pendingDuplicateAlerts: pendingDuplicates,
      newDebt: await this.newDebtBetweenLastTwoImports(orgId),
      agingEstimated: await this.estimatedAging(orgId),
      // مؤشرات المتابعات/الوعود/التحصيل تُفعَّل في مراحلها القادمة بنفس الـ endpoint
      followupsToday: null,
      promisesDueToday: null,
      collectionsToday: null,
    };
  }

  /** المديونية الجديدة بين آخر استيرادين: زيادات موجبة + عملاء ظهروا مدينين لأول مرة. */
  private async newDebtBetweenLastTwoImports(orgId: string) {
    const lastTwo = await this.prisma.importJob.findMany({
      where: { organizationId: orgId, status: 'completed' },
      orderBy: { importedAt: 'desc' },
      take: 2,
      select: { id: true, importedAt: true },
    });
    if (lastTwo.length === 0) return null;

    const [latest, previous] = lastTwo;
    const latestSnaps = await this.prisma.balanceSnapshot.findMany({
      where: { importJobId: latest.id },
      select: { customerId: true, currencyCode: true, balance: true },
    });
    const prevMap = new Map<string, number>();
    if (previous) {
      const prevSnaps = await this.prisma.balanceSnapshot.findMany({
        where: { importJobId: previous.id },
        select: { customerId: true, currencyCode: true, balance: true },
      });
      for (const s of prevSnaps) {
        prevMap.set(`${s.customerId}|${s.currencyCode}`, Number(s.balance));
      }
    }

    const perCurrency: Record<string, { amount: number; accounts: number; newDebtors: number }> = {};
    for (const s of latestSnaps) {
      const cur = Number(s.balance);
      const prev = prevMap.get(`${s.customerId}|${s.currencyCode}`);
      const increase = prev === undefined ? (cur > 0 ? cur : 0) : Math.max(cur - prev, 0);
      if (increase > 0) {
        const c = (perCurrency[s.currencyCode] ??= { amount: 0, accounts: 0, newDebtors: 0 });
        c.amount += increase;
        c.accounts += 1;
        if (prev === undefined || prev <= 0) c.newDebtors += 1;
      }
    }
    return {
      betweenImports: {
        latest: latest.importedAt,
        previous: previous?.importedAt ?? null,
      },
      perCurrency,
      note: previous
        ? null
        : 'استيراد واحد فقط حتى الآن — كل رصيد مدين يُعد مديونية جديدة',
    };
  }

  /**
   * أعمار الديون التقديرية: عمر أقدم حركة متاحة لكل حساب مدين.
   * estimated=true دائمًا — الملف لا يوفر تواريخ استحقاق الفواتير (قرار موثق: لا دقة زائفة).
   */
  private async estimatedAging(orgId: string) {
    const debtors = await this.prisma.customerBalance.findMany({
      where: { customer: { organizationId: orgId }, accountingBalance: { gt: 0 } },
      select: { customerId: true, currencyCode: true, accountingBalance: true },
    });
    if (debtors.length === 0) return { estimated: true, buckets: {}, note: 'لا مدينين' };

    const oldest = await this.prisma.importedTransaction.groupBy({
      by: ['customerId', 'currencyCode'],
      where: { customer: { organizationId: orgId }, reversedAt: null },
      _min: { txDate: true },
    });
    const oldestMap = new Map<string, Date>();
    for (const o of oldest) {
      if (o._min.txDate) oldestMap.set(`${o.customerId}|${o.currencyCode}`, o._min.txDate);
    }

    const now = Date.now();
    const buckets: Record<string, Record<string, { accounts: number; amount: number }>> = {};
    const bucketOf = (days: number) =>
      days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : days <= 120 ? '91-120' : '120+';

    for (const d of debtors) {
      const first = oldestMap.get(`${d.customerId}|${d.currencyCode}`);
      const days = first ? Math.floor((now - first.getTime()) / 86_400_000) : 0;
      const bucket = first ? bucketOf(days) : 'unknown';
      const ccy = d.currencyCode;
      buckets[ccy] ??= {};
      buckets[ccy][bucket] ??= { accounts: 0, amount: 0 };
      buckets[ccy][bucket].accounts += 1;
      buckets[ccy][bucket].amount += Number(d.accountingBalance);
    }
    return {
      estimated: true,
      basis: 'أقدم حركة متاحة في كشف الحساب — ليس تاريخ استحقاق الفاتورة',
      buckets,
    };
  }

  /**
   * KPI Dashboard (PR 7): مؤشرات من البيانات الحقيقية المبنية —
   * المخاطر (PR 4)، قائمة عمل اليوم (PR 5)، أعمار الديون (PR 3)، الأرصدة، التحصيلات.
   * كل الأرقام من قاعدة البيانات — لا أرقام وهمية.
   */
  async kpis(user: AuthUser) {
    const orgId = user.organizationId;
    const today = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
    const tomorrow = new Date(today.getTime() + 86_400_000);

    const [totalCustomers, activeCustomers, balances, scores, todayTasks, aging] = await Promise.all([
      this.prisma.customer.count({ where: { organizationId: orgId } }),
      this.prisma.customer.count({ where: { organizationId: orgId, status: 'active' } }),
      this.prisma.customerBalance.findMany({
        where: { customer: { organizationId: orgId }, accountingBalance: { gt: 0 } },
        select: { customerId: true, currencyCode: true, accountingBalance: true },
      }),
      this.prisma.customerScore.findMany({
        where: { customer: { organizationId: orgId } },
        orderBy: { computedAt: 'desc' },
        select: { customerId: true, score: true, riskLevel: true },
      }),
      this.prisma.task.findMany({
        where: { status: 'open', dueDate: { gte: today, lt: tomorrow }, customer: { organizationId: orgId } },
        select: {
          id: true, customerId: true, assignedTo: true, taskType: true, priorityReason: true,
          expectedAmount: true, expectedCurrency: true,
        },
      }),
      this.prisma.debtAgingSummary.findMany({
        where: { customer: { organizationId: orgId }, bucket_120_plus: { gt: 0 }, reversedAt: null },
        select: { customerId: true, currencyCode: true, totalDue: true },
      }),
    ]);

    const debtors = new Set(balances.map((b) => b.customerId)).size;

    const debtByCurrency: Record<string, number> = {};
    for (const b of balances) {
      debtByCurrency[b.currencyCode] = (debtByCurrency[b.currencyCode] ?? 0) + Number(b.accountingBalance);
    }

    // أحدث درجة لكل عميل (computedAt تنازلي — الأول لكل عميل يفوز)
    const latestScore = new Map<string, { score: number; riskLevel: string }>();
    for (const s of scores) {
      if (!latestScore.has(s.customerId)) latestScore.set(s.customerId, { score: Number(s.score), riskLevel: s.riskLevel });
    }
    const riskDistribution: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const v of latestScore.values()) {
      riskDistribution[v.riskLevel] = (riskDistribution[v.riskLevel] ?? 0) + 1;
    }

    const tasksToday = {
      total: todayTasks.length,
      assigned: todayTasks.filter((t) => t.assignedTo).length,
      unassigned: todayTasks.filter((t) => !t.assignedTo).length,
    };

    const byType = new Map<string, number>();
    for (const t of todayTasks) byType.set(t.taskType, (byType.get(t.taskType) ?? 0) + 1);
    const topReasons = [...byType.entries()]
      .map(([taskType, count]) => ({ taskType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const debt120TotalByCurrency: Record<string, number> = {};
    const debt120Customers = new Set<string>();
    for (const a of aging) {
      debt120Customers.add(a.customerId);
      debt120TotalByCurrency[a.currencyCode] = (debt120TotalByCurrency[a.currencyCode] ?? 0) + Number(a.totalDue);
    }
    const debt120Plus = { count: debt120Customers.size, totalByCurrency: debt120TotalByCurrency };

    const highRisk = await this.prisma.customer.findMany({
      where: {
        organizationId: orgId,
        scores: { some: { riskLevel: { in: ['high', 'critical'] } } },
      },
      select: {
        id: true,
        externalCustomerCode: true,
        name: true,
        scores: { orderBy: { computedAt: 'desc' }, take: 1, select: { score: true, riskLevel: true } },
      },
    });
    const highRiskCustomers = highRisk
      .map((c) => ({
        customerId: c.id,
        customerCode: c.externalCustomerCode,
        customerName: c.name,
        score: Number(c.scores[0]?.score ?? 0),
        riskLevel: c.scores[0]?.riskLevel ?? 'low',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const customerIds = [...new Set(todayTasks.map((t) => t.customerId).filter((x): x is string => !!x))];
    const customers = customerIds.length > 0
      ? await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true, externalCustomerCode: true },
        })
      : [];
    const nameMap = new Map(customers.map((c) => [c.id, c]));
    const topPriorityTasks = todayTasks
      .map((t) => ({
        taskId: t.id,
        customerId: t.customerId ?? '',
        customerName: nameMap.get(t.customerId ?? '')?.name ?? '',
        customerCode: nameMap.get(t.customerId ?? '')?.externalCustomerCode ?? null,
        taskType: t.taskType,
        priority: priorityOfTaskType(t.taskType),
        priorityReason: t.priorityReason ?? t.taskType,
        expectedAmount: t.expectedAmount === null ? null : Number(t.expectedAmount),
        expectedCurrency: t.expectedCurrency,
        assignedTo: t.assignedTo,
      }))
      .sort((a, b) => a.priority - b.priority || (b.expectedAmount ?? 0) - (a.expectedAmount ?? 0))
      .slice(0, 10);

    // Collector performance today: today's collections grouped by collector + currency.
    // Amounts stay separated by currency (no cross-currency summing), consistent with the rest
    // of this service. Uses only existing Collection/Collector data — no schema changes.
    const today0 = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
    const tomorrow0 = new Date(today0.getTime() + 86_400_000);
    const collectionsByCollector = await this.prisma.collection.groupBy({
      by: ['collectorId', 'currencyCode'],
      where: {
        status: { not: 'reversed' },
        collectedAt: { gte: today0, lt: tomorrow0 },
        collector: { user: { organizationId: orgId } },
      },
      _sum: { amount: true },
      _count: true,
    });
    const perfCollectorIds = [...new Set(collectionsByCollector.map((c) => c.collectorId))];
    const perfCollectors = perfCollectorIds.length
      ? await this.prisma.collector.findMany({
          where: { id: { in: perfCollectorIds } },
          include: { user: { select: { fullName: true } } },
        })
      : [];
    const perfNameMap = new Map(perfCollectors.map((c) => [c.id, c.user.fullName]));
    const collectorPerformanceToday = collectionsByCollector
      .map((c) => ({
        collectorId: c.collectorId,
        collectorName: perfNameMap.get(c.collectorId) ?? c.collectorId,
        currency: c.currencyCode,
        amount: Number(c._sum.amount ?? 0),
        count: c._count,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      customers: { total: totalCustomers, active: activeCustomers, debtors },
      debtByCurrency,
      riskDistribution,
      tasksToday,
      topReasons,
      debt120Plus,
      highRiskCustomers,
      topPriorityTasks,
      collectorPerformanceToday,
    };
  }

  /**
   * Collector Dashboard (M5): كل الأرقام لعملاء المحصل المسندين حاليًا،
   * والمبالغ مفصولة بالعملة دائمًا.
   */
  async collectorDashboard(user: AuthUser, collectorIdParam?: string) {
    let collectorId = collectorIdParam;
    if (collectorId) {
      if (!user.permissions.includes('customers.read_all')) {
        throw new ForbiddenException('عرض لوحة محصل آخر يتطلب صلاحية إشرافية');
      }
    } else {
      const own = await this.prisma.collector.findUnique({ where: { userId: user.id } });
      if (!own) throw new ForbiddenException('حسابك ليس محصلاً — مرر collectorId بصلاحية إشرافية');
      collectorId = own.id;
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today.getTime() - 6 * 86_400_000);

    const [assignedCount, assignedCustomerIds] = await Promise.all([
      this.prisma.customerAssignment.count({ where: { collectorId, effectiveTo: null } }),
      this.prisma.customerAssignment.findMany({
        where: { collectorId, effectiveTo: null },
        select: { customerId: true },
      }).then((r) => r.map((x) => x.customerId)),
    ]);

    const [dueTasksToday, overdueFollowups, overduePromises, todayCollections, weekCollections] =
      await Promise.all([
        this.prisma.task.count({
          where: { assignedTo: collectorId, status: 'open', dueDate: { lte: today } },
        }),
        // متابعات متأخرة: آخر متابعة للعميل حددت موعدًا قادمًا انقضى
        this.prisma.followup.count({
          where: {
            deletedAt: null,
            customerId: { in: assignedCustomerIds },
            nextFollowupDate: { lt: today },
          },
        }),
        this.prisma.paymentPromise.count({
          where: {
            collectorId,
            status: { in: ['upcoming', 'due_today'] },
            dueDate: { lt: today },
          },
        }),
        this.prisma.collection.groupBy({
          by: ['currencyCode'],
          where: {
            collectorId, status: { not: 'reversed' },
            collectedAt: { gte: today },
          },
          _sum: { amount: true }, _count: true,
        }),
        this.prisma.collection.groupBy({
          by: ['currencyCode'],
          where: {
            collectorId, status: { not: 'reversed' },
            collectedAt: { gte: weekAgo },
          },
          _sum: { amount: true }, _count: true,
        }),
      ]);

    const balances = await this.prisma.customerBalance.groupBy({
      by: ['currencyCode'],
      where: { customerId: { in: assignedCustomerIds }, accountingBalance: { gt: 0 } },
      _sum: { accountingBalance: true }, _count: true,
    });

    return {
      collectorId,
      assignedCustomers: assignedCount,
      toContactToday: dueTasksToday,
      overdueFollowups,
      overduePromises,
      collectionsToday: Object.fromEntries(
        todayCollections.map((c) => [c.currencyCode, { total: Number(c._sum.amount ?? 0), count: c._count }]),
      ),
      collectionsThisWeek: Object.fromEntries(
        weekCollections.map((c) => [c.currencyCode, { total: Number(c._sum.amount ?? 0), count: c._count }]),
      ),
      outstandingByCurrency: Object.fromEntries(
        balances.map((b) => [b.currencyCode, { total: Number(b._sum.accountingBalance ?? 0), debtors: b._count }]),
      ),
    };
  }
}
