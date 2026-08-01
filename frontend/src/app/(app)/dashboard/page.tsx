'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { api, tokenStore } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { todayISO } from '@/lib/errors';
import { CCY_AR, fmtDateTime, fmtMoney, PROMISE_STATUS_AR, TASK_TYPE_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { HBarChart, StackedBar } from '@/components/ui/charts';
import { Badge, Card, CardHeader, Money } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

/**
 * شرط موحّد: نفّذ الاستعلام فقط عند وجود Access Token في المتصفح.
 * يمنع 401 requests أثناء Hydration أو قبل تحميل الجلسة.
 */
const hasToken = () => typeof window !== 'undefined' && !!tokenStore.access;

interface DashboardSummary {
  customers: { total: number; active: number; withBalances: number };
  byCurrency: Record<string, { debtors: number; debtTotal: number; creditors: number; creditTotal: number; zero: number }>;
  lastImport: { id: string; fileName: string; importedAt: string } | null;
  newDebt: { perCurrency?: Record<string, { amount: number; accounts: number; newDebtors: number }> } | null;
}
interface CollectorSummary {
  assignedCustomers: number;
  toContactToday: number;
  overdueFollowups: number;
  overduePromises: number;
  collectionsToday: Record<string, { total: number; count: number }>;
  outstandingByCurrency: Record<string, { total: number; debtors: number }>;
}
interface PromiseItem {
  id: string; expectedAmount: string | number; currencyCode: string; status: string; dueDate: string;
  customer: { id: string; name: string } | null;
}
interface CollectionsResponse {
  total: number;
  totalsByCurrency: Record<string, number>;
  items: { id: string; amount: string | number; currencyCode: string; collectedAt: string;
    customer: { id: string; name: string } | null; method: { name: string } | null }[];
}
interface TaskItem {
  customerId: string; customerName: string; reason: string; priority: number;
  expectedAmount?: number; currency?: string;
  balances: { currency: string; balance: number }[];
}
interface TodayTasks { isCollector: boolean; items: TaskItem[]; summary: { tasksToday: number } }
interface NotificationItem { id: string; kind: string; readAt: string | null; createdAt: string; payload: Record<string, unknown> }
interface NotificationsResponse { unread: number; items: NotificationItem[] }

interface KpiResponse {
  customers: { total: number; active: number; debtors: number };
  debtByCurrency: Record<string, number>;
  riskDistribution: Record<string, number>;
  tasksToday: { total: number; assigned: number; unassigned: number };
  topReasons: { taskType: string; count: number }[];
  debt120Plus: { count: number; totalByCurrency: Record<string, number> };
  highRiskCustomers: {
    customerId: string; customerCode: string | null; customerName: string;
    score: number; riskLevel: string;
  }[];
  topPriorityTasks: {
    taskId: string; customerId: string; customerName: string; customerCode: string | null;
    taskType: string; priority: number; priorityReason: string;
    expectedAmount: number | null; expectedCurrency: string | null; assignedTo: string | null;
  }[];
  collectorPerformanceToday: {
    collectorId: string; collectorName: string; currency: string; amount: number; count: number;
  }[];
}

const RISK_LEVEL_AR: Record<string, string> = {
  low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة', critical: 'حرجة',
};

function notifText(n: NotificationItem): string {
  const p = n.payload as Record<string, any>;
  switch (n.kind) {
    case 'promise_due': return `تذكير: وعد سداد من ${p.customerName ?? 'عميل'} بمبلغ ${fmtMoney(p.amount ?? 0)} ${p.currency ?? ''}`;
    case 'promise_overdue': return `وعد متأخر من ${p.customerName ?? 'عميل'}`;
    case 'collection_created': return `تحصيل جديد: ${fmtMoney(p.amount ?? 0)} ${p.currency ?? ''} من ${p.customerName ?? ''}`;
    case 'customer_transferred': return `نُقل إليك العميل ${p.customerName ?? ''}`;
    default: return n.kind;
  }
}

export default function DashboardPage() {
  const can = useCan();
  const { data: me } = useMe();
  const today = todayISO();

  const canAdminKpis = can('reports.read');
  const canCollectorKpis = can('tasks.manage');
  const canPromisesList = can('customers.read');
  const canCollectionsList = can('customers.read');
  const canTasks = can('tasks.manage');

  // ---- المؤشرات الرئيسية: لوحة إدارية أو لوحة محصل، بحسب الصلاحية ----
  const summary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => api<DashboardSummary>('/dashboard/summary'),
    enabled: canAdminKpis && hasToken(),
  });
  const collectorSummary = useQuery({
    queryKey: ['dashboard-collector'],
    queryFn: () => api<CollectorSummary>('/dashboard/collector'),
    enabled: canCollectorKpis && !canAdminKpis && hasToken(),
    retry: false,
  });
  const kpis = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => api<KpiResponse>('/dashboard/kpis'),
    enabled: canAdminKpis && hasToken(),
  });

  // ---- الوعود المستحقة والمتأخرة ----
  const dueTodayPromises = useQuery({
    queryKey: ['promises', 'due_today'],
    queryFn: () => api<{ items: PromiseItem[] }>('/payment-promises?status=due_today&limit=5'),
    enabled: canPromisesList && hasToken(),
  });
  const overduePromises = useQuery({
    queryKey: ['promises', 'unfulfilled'],
    queryFn: () => api<{ items: PromiseItem[] }>('/payment-promises?status=unfulfilled&limit=5'),
    enabled: canPromisesList && hasToken(),
  });

  // ---- التحصيلات اليومية (مقيّدة تلقائيًا حسب نطاق المستخدم في الـ API) ----
  const collectionsToday = useQuery({
    queryKey: ['collections', 'today'],
    queryFn: () => api<CollectionsResponse>(`/collections?fromDate=${today}&toDate=${today}&limit=5`),
    enabled: canCollectionsList && hasToken(),
  });

  // ---- المهام والمتابعات المتأخرة (شخصية لحساب المحصل الحالي) ----
  const tasksToday = useQuery({
    queryKey: ['tasks-today'],
    queryFn: () => api<TodayTasks>('/tasks/today'),
    enabled: canTasks && hasToken(),
  });
  // تمييز صريح من الـAPI (isCollector=false) بدل تخمين رمز HTTP —
  // تصحيح مراجعة: /tasks/today لم يعد يُلقي خطأً لحساب إداري بلا محصل شخصي.
  const notCollector = tasksToday.data?.isCollector === false;

  // ---- أحدث الإشعارات (لا تتطلب صلاحية خاصة) ----
  const notifications = useQuery({
    queryKey: ['notifications-latest'],
    queryFn: () => api<NotificationsResponse>('/notifications?limit=5'),
    enabled: hasToken(),
  });

  return (
    <div className="space-y-5">
      <PageHeader title={`مرحبًا${me ? `، ${me.fullName.split(' ')[0]}` : ''}`} />

      {/* المؤشرات الرئيسية */}
      <section aria-label="المؤشرات الرئيسية">
        {!canAdminKpis && !canCollectorKpis ? (
          <Card><PermissionNotice message="لا تملك صلاحية عرض المؤشرات الرئيسية" /></Card>
        ) : canAdminKpis ? (
          <DataState
            isLoading={summary.isLoading}
            isError={summary.isError}
            error={summary.error}
            onRetry={() => summary.refetch()}
            isFetching={summary.isFetching}
            isEmpty={false}
            emptyTitle=""
            skeletonClassName="h-36"
          >
            {summary.data && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Link href="/customers">
                  <Card className="p-4 transition-colors hover:bg-pine-50/40 dark:hover:bg-white/5">
                    <p className="text-xs text-concrete-500">إجمالي العملاء</p>
                    <p className="tnum mt-1 font-display text-2xl font-bold">{summary.data.customers.total}</p>
                    <p className="mt-1 text-xs text-concrete-500">النشطون: {summary.data.customers.active}</p>
                  </Card>
                </Link>
                {Object.entries(summary.data.byCurrency).map(([ccy, v]) => (
                  <Card key={ccy} className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-concrete-500">{CCY_AR[ccy] ?? ccy}</p>
                      <Badge tone="pine">{ccy}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <Link href={`/customers?balanceState=debtor&currency=${ccy}`} className="rounded-lg p-1 -m-1 hover:bg-debt-50 dark:hover:bg-debt-700/20">
                        <p className="text-xs text-debt-600 dark:text-debt-400">مديونية ({v.debtors})</p>
                        <p className="tnum font-bold text-debt-600 dark:text-debt-400" dir="ltr">{fmtMoney(v.debtTotal)}</p>
                      </Link>
                      <Link href={`/customers?balanceState=creditor&currency=${ccy}`} className="rounded-lg p-1 -m-1 hover:bg-credit-50 dark:hover:bg-credit-700/20">
                        <p className="text-xs text-credit-600 dark:text-credit-400">دائن ({v.creditors})</p>
                        <p className="tnum font-bold text-credit-600 dark:text-credit-400" dir="ltr">{fmtMoney(v.creditTotal)}</p>
                      </Link>
                    </div>
                  </Card>
                ))}
                {summary.data.newDebt?.perCurrency && Object.keys(summary.data.newDebt.perCurrency).length > 0 && (
                  <Card className="p-4">
                    <p className="text-xs text-concrete-500">مديونية جديدة (بين آخر استيرادين)</p>
                    {Object.entries(summary.data.newDebt.perCurrency).map(([ccy, v]) => (
                      <p key={ccy} className="tnum mt-1 text-sm font-bold" dir="ltr">{fmtMoney(v.amount)} {ccy}</p>
                    ))}
                  </Card>
                )}
              </div>
            )}
          </DataState>
        ) : (
          <DataState
            isLoading={collectorSummary.isLoading}
            isError={collectorSummary.isError}
            error={collectorSummary.error}
            onRetry={() => collectorSummary.refetch()}
            isFetching={collectorSummary.isFetching}
            isEmpty={false}
            emptyTitle=""
            skeletonClassName="h-28"
          >
            {collectorSummary.data && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">عملائي</p>
                  <p className="tnum mt-1 font-display text-2xl font-bold">{collectorSummary.data.assignedCustomers}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">تواصل اليوم</p>
                  <p className="tnum mt-1 font-display text-2xl font-bold">{collectorSummary.data.toContactToday}</p>
                </Card>
                <Card className={collectorSummary.data.overduePromises ? 'border-r-4 border-r-hazard-500 p-4' : 'p-4'}>
                  <p className="text-xs text-concrete-500">وعود متأخرة</p>
                  <p className="tnum mt-1 font-display text-2xl font-bold">{collectorSummary.data.overduePromises}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">تحصيلات اليوم</p>
                  {Object.entries(collectorSummary.data.collectionsToday ?? {}).length ? (
                    Object.entries(collectorSummary.data.collectionsToday).map(([ccy, v]) => (
                      <p key={ccy} className="tnum text-sm font-bold" dir="ltr">{fmtMoney(v.total)} {ccy}</p>
                    ))
                  ) : (
                    <p className="mt-1 text-sm text-concrete-500">لا تحصيلات بعد</p>
                  )}
                </Card>
              </div>
            )}
          </DataState>
        )}
      </section>

      {/* KPI Dashboard (PR 7) — بيانات حقيقية: مخاطر، مهام، أعمار */}
      {canAdminKpis && (
        <DataState
          isLoading={kpis.isLoading}
          isError={kpis.isError}
          error={kpis.error}
          onRetry={() => kpis.refetch()}
          isFetching={kpis.isFetching}
          isEmpty={false}
          emptyTitle=""
          skeletonClassName="h-64"
        >
          {kpis.data && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">توزيع المخاطر</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {['low', 'medium', 'high', 'critical'].map((lv) => (
                      <div key={lv} className="rounded-lg border border-concrete-100 px-2 py-1.5 text-center dark:border-white/10">
                        <p className="tnum text-lg font-bold text-iron-900 dark:text-concrete-100">
                          {kpis.data.riskDistribution[lv] ?? 0}
                        </p>
                        <p className="text-[10px] text-concrete-500">{RISK_LEVEL_AR[lv] ?? lv}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <StackedBar
                      items={[
                        { key: 'low', label: RISK_LEVEL_AR.low, value: kpis.data.riskDistribution.low ?? 0, tone: 'pine' },
                        { key: 'medium', label: RISK_LEVEL_AR.medium, value: kpis.data.riskDistribution.medium ?? 0, tone: 'neutral' },
                        { key: 'high', label: RISK_LEVEL_AR.high, value: kpis.data.riskDistribution.high ?? 0, tone: 'hazard' },
                        { key: 'critical', label: RISK_LEVEL_AR.critical, value: kpis.data.riskDistribution.critical ?? 0, tone: 'debt' },
                      ]}
                    />
                  </div>
                </Card>
                <Link href="/tasks">
                  <Card className="p-4 transition-colors hover:bg-pine-50/40 dark:hover:bg-white/5">
                    <p className="text-xs text-concrete-500">مهام اليوم</p>
                    <p className="tnum mt-1 font-display text-2xl font-bold">{kpis.data.tasksToday.total}</p>
                    <p className="mt-1 text-xs text-concrete-500">
                      مسندة: {kpis.data.tasksToday.assigned} • غير مسندة: {kpis.data.tasksToday.unassigned}
                    </p>
                  </Card>
                </Link>
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">عملاء +120 يوم</p>
                  <p className="tnum mt-1 font-display text-2xl font-bold">{kpis.data.debt120Plus.count}</p>
                  {Object.entries(kpis.data.debt120Plus.totalByCurrency).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(kpis.data.debt120Plus.totalByCurrency).map(([ccy, amt]) => (
                        <p key={ccy} className="tnum text-xs text-debt-600 dark:text-debt-400" dir="ltr">
                          {fmtMoney(amt)} {ccy}
                        </p>
                      ))}
                    </div>
                  )}
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">أعلى أسباب المهام</p>
                  <ul className="mt-2 space-y-1">
                    {kpis.data.topReasons.map((r) => (
                      <li key={r.taskType} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-concrete-600 dark:text-concrete-400">
                          {TASK_TYPE_AR[r.taskType] ?? r.taskType}
                        </span>
                        <span className="tnum font-bold">{r.count}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <Card>
                  <CardHeader title="توزيع الديون بالعملة" />
                  <div className="p-4">
                    <HBarChart
                      emptyText="لا مديونية مسجّلة"
                      items={Object.entries(kpis.data.debtByCurrency).map(([ccy, amt]) => ({
                        key: ccy,
                        label: CCY_AR[ccy] ?? ccy,
                        value: amt,
                        valueLabel: `${fmtMoney(amt)} ${ccy}`,
                        href: `/customers?balanceState=debtor&currency=${ccy}`,
                        tone: 'debt',
                      }))}
                    />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="أداء المحصلين اليوم" />
                  <div className="p-4">
                    <HBarChart
                      emptyText="لا تحصيلات مسجّلة اليوم بعد"
                      items={kpis.data.collectorPerformanceToday.slice(0, 8).map((c) => ({
                        key: `${c.collectorId}-${c.currency}`,
                        label: `${c.collectorName} (${c.currency})`,
                        value: c.amount,
                        valueLabel: `${fmtMoney(c.amount)} ${c.currency}`,
                        href: `/customers?collectorId=${c.collectorId}`,
                        tone: 'credit',
                      }))}
                    />
                  </div>
                </Card>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <Card>
                  <CardHeader title="أعلى المخاطر" />
                  <Table>
                    <THead cols={['العميل', 'الدرجة', 'المستوى']} />
                    <tbody>
                      {kpis.data.highRiskCustomers.map((c) => (
                        <TRow key={c.customerId}>
                          <TD>
                            <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                                  href={`/customers/${c.customerId}`}>
                              {c.customerName}
                            </Link>
                            {c.customerCode && <p className="text-xs text-concrete-500" dir="ltr">{c.customerCode}</p>}
                          </TD>
                          <TD className="tnum font-bold">{c.score}</TD>
                          <TD>
                            <Badge tone={c.riskLevel === 'critical' ? 'debt' : c.riskLevel === 'high' ? 'hazard' : 'neutral'}>
                              {RISK_LEVEL_AR[c.riskLevel] ?? c.riskLevel}
                            </Badge>
                          </TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                </Card>

                <Card>
                  <CardHeader title="أولوية المهام" />
                  <Table>
                    <THead cols={['العميل', 'السبب', 'المبلغ المتوقع']} />
                    <tbody>
                      {kpis.data.topPriorityTasks.map((t) => (
                        <TRow key={t.taskId}>
                          <TD>
                            <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                                  href={`/customers/${t.customerId}`}>
                              {t.customerName}
                            </Link>
                            {t.customerCode && <p className="text-xs text-concrete-500" dir="ltr">{t.customerCode}</p>}
                          </TD>
                          <TD className="max-w-[220px] text-xs text-concrete-600 dark:text-concrete-400">
                            {t.priorityReason}
                          </TD>
                          <TD>
                            {t.expectedAmount != null && t.expectedCurrency ? (
                              <Money value={t.expectedAmount} currency={t.expectedCurrency} />
                            ) : (
                              <span className="text-concrete-400">—</span>
                            )}
                          </TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </div>
            </div>
          )}
        </DataState>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {/* الوعود المستحقة والمتأخرة */}
        <Card>
          <CardHeader title="الوعود المستحقة والمتأخرة"
                      action={<Link href="/promises" className="text-xs text-pine-700 dark:text-pine-100">الكل</Link>} />
          {!canPromisesList ? (
            <PermissionNotice message="لا تملك صلاحية عرض وعود السداد" />
          ) : (
            <div className="divide-y divide-concrete-100 dark:divide-white/10">
              <div className="px-4 py-3">
                <p className="mb-2 text-xs font-medium text-concrete-500">مستحقة اليوم</p>
                <DataState
                  isLoading={dueTodayPromises.isLoading}
                  isError={dueTodayPromises.isError}
                  error={dueTodayPromises.error}
                  onRetry={() => dueTodayPromises.refetch()}
                  isFetching={dueTodayPromises.isFetching}
                  isEmpty={!dueTodayPromises.data?.items?.length}
                  emptyTitle="لا وعود مستحقة اليوم"
                  skeletonClassName="h-16"
                >
                  <PromisesTable items={dueTodayPromises.data?.items ?? []} tone="hazard" />
                </DataState>
              </div>
              <div className="px-4 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-debt-600 dark:text-debt-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  متأخرة
                </p>
                <DataState
                  isLoading={overduePromises.isLoading}
                  isError={overduePromises.isError}
                  error={overduePromises.error}
                  onRetry={() => overduePromises.refetch()}
                  isFetching={overduePromises.isFetching}
                  isEmpty={!overduePromises.data?.items?.length}
                  emptyTitle="لا وعود متأخرة"
                  emptyHint="أحسنت — لا وعود متأخرة حاليًا"
                  skeletonClassName="h-16"
                >
                  <PromisesTable items={overduePromises.data?.items ?? []} tone="debt" />
                </DataState>
              </div>
            </div>
          )}
        </Card>

        {/* التحصيلات اليومية */}
        <Card>
          <CardHeader title="تحصيلات اليوم"
                      action={<Link href="/collections" className="text-xs text-pine-700 dark:text-pine-100">الكل</Link>} />
          {!canCollectionsList ? (
            <PermissionNotice message="لا تملك صلاحية عرض التحصيلات" />
          ) : (
            <DataState
              isLoading={collectionsToday.isLoading}
              isError={collectionsToday.isError}
              error={collectionsToday.error}
              onRetry={() => collectionsToday.refetch()}
              isFetching={collectionsToday.isFetching}
              isEmpty={!collectionsToday.data?.items?.length}
              emptyTitle="لا تحصيلات اليوم بعد"
              skeletonClassName="h-32"
            >
              <div className="px-4 py-3">
                {collectionsToday.data && Object.keys(collectionsToday.data.totalsByCurrency).length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {Object.entries(collectionsToday.data.totalsByCurrency).map(([ccy, total]) => (
                      <Badge key={ccy} tone="credit">
                        <Money value={total} currency={ccy} />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Table>
                <THead cols={['العميل', 'المبلغ', 'الطريقة']} />
                <tbody>
                  {(collectionsToday.data?.items ?? []).map((c) => {
                    const customerId = c.customer?.id;
                    const customerName = c.customer?.name ?? '—';
                    const methodName = c.method?.name ?? '—';
                    return (
                      <TRow key={c.id}>
                        <TD>
                          {customerId ? (
                            <Link className="text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${customerId}`}>
                              {customerName}
                            </Link>
                          ) : (
                            <span>{customerName}</span>
                          )}
                        </TD>
                        <TD><Money value={Number(c.amount)} currency={c.currencyCode} /></TD>
                        <TD className="text-concrete-500">{methodName}</TD>
                      </TRow>
                    );
                  })}
                </tbody>
              </Table>
            </DataState>
          )}
        </Card>

        {/* المهام والمتابعات المتأخرة */}
        <Card>
          <CardHeader title="مهام اليوم"
                      action={<Link href="/tasks" className="text-xs text-pine-700 dark:text-pine-100">الكل</Link>} />
          {!canTasks ? (
            <PermissionNotice message="لا تملك صلاحية عرض المهام اليومية" />
          ) : notCollector ? (
            <PermissionNotice message="عمل اليوم متاح لحسابات المحصلين — حسابك إداري بلا عملاء مسندين مباشرة" />
          ) : (
            <DataState
              isLoading={tasksToday.isLoading}
              isError={tasksToday.isError}
              error={tasksToday.error}
              onRetry={() => tasksToday.refetch()}
              isFetching={tasksToday.isFetching}
              isEmpty={!tasksToday.data?.items?.length}
              emptyTitle="لا مهام معلّقة اليوم"
              emptyHint="أحسنت — لا شيء يحتاج متابعة الآن"
              skeletonClassName="h-24"
            >
              <ul className="divide-y divide-concrete-100 dark:divide-white/10">
                {(tasksToday.data?.items ?? []).slice(0, 5).map((t, i) => (
                  <li key={`${t.customerId}-${i}`} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                            href={`/customers/${t.customerId}`}>
                        {t.customerName}
                      </Link>
                      {t.priority <= 2 && <Badge tone="hazard">عاجل</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-concrete-500">{t.reason}</p>
                  </li>
                ))}
              </ul>
            </DataState>
          )}
        </Card>

        {/* أحدث الإشعارات */}
        <Card>
          <CardHeader title="أحدث الإشعارات"
                      action={<Link href="/notifications" className="text-xs text-pine-700 dark:text-pine-100">الكل</Link>} />
          <DataState
            isLoading={notifications.isLoading}
            isError={notifications.isError}
            error={notifications.error}
            onRetry={() => notifications.refetch()}
            isFetching={notifications.isFetching}
            isEmpty={!notifications.data?.items?.length}
            emptyTitle="لا إشعارات"
            skeletonClassName="h-24"
          >
            <ul className="divide-y divide-concrete-100 dark:divide-white/10">
              {(notifications.data?.items ?? []).map((n) => (
                <li key={n.id} className="px-4 py-3 text-sm">
                  <p className={n.readAt ? 'text-concrete-500' : 'font-medium'}>{notifText(n)}</p>
                  <p className="mt-0.5 text-xs text-concrete-400">{fmtDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          </DataState>
        </Card>
      </div>
    </div>
  );
}

function PromisesTable({ items, tone }: { items: PromiseItem[]; tone: 'hazard' | 'debt' }) {
  return (
    <Table>
      <THead cols={['العميل', 'المبلغ', 'الحالة']} />
      <tbody>
        {items.map((p) => {
          const customerId = p.customer?.id;
          const customerName = p.customer?.name ?? '—';
          return (
            <TRow key={p.id}>
              <TD>
                {customerId ? (
                  <Link className="text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${customerId}`}>
                    {customerName}
                  </Link>
                ) : (
                  <span>{customerName}</span>
                )}
              </TD>
              <TD><Money value={Number(p.expectedAmount)} currency={p.currencyCode} /></TD>
              <TD><Badge tone={tone}>{PROMISE_STATUS_AR[p.status] ?? p.status}</Badge></TD>
            </TRow>
          );
        })}
      </tbody>
    </Table>
  );
}
