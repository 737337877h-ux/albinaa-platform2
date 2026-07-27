'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { todayISO } from '@/lib/errors';
import { CCY_AR, fmtDateTime, fmtMoney, PROMISE_STATUS_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Card, CardHeader, Money } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

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
  customer: { id: string; name: string };
}
interface CollectionsResponse {
  total: number;
  totalsByCurrency: Record<string, number>;
  items: { id: string; amount: string | number; currencyCode: string; collectedAt: string;
    customer: { id: string; name: string }; method: { name: string } }[];
}
interface TaskItem {
  customerId: string; customerName: string; reason: string; priority: number;
  expectedAmount?: number; currency?: string;
  balances: { currency: string; balance: number }[];
}
interface TodayTasks { isCollector: boolean; items: TaskItem[]; summary: { tasksToday: number } }
interface NotificationItem { id: string; kind: string; readAt: string | null; createdAt: string; payload: Record<string, unknown> }
interface NotificationsResponse { unread: number; items: NotificationItem[] }

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
    enabled: canAdminKpis,
  });
  const collectorSummary = useQuery({
    queryKey: ['dashboard-collector'],
    queryFn: () => api<CollectorSummary>('/dashboard/collector'),
    enabled: canCollectorKpis && !canAdminKpis,
    retry: false,
  });

  // ---- الوعود المستحقة والمتأخرة ----
  const dueTodayPromises = useQuery({
    queryKey: ['promises', 'due_today'],
    queryFn: () => api<{ items: PromiseItem[] }>('/payment-promises?status=due_today&limit=5'),
    enabled: canPromisesList,
  });
  const overduePromises = useQuery({
    queryKey: ['promises', 'unfulfilled'],
    queryFn: () => api<{ items: PromiseItem[] }>('/payment-promises?status=unfulfilled&limit=5'),
    enabled: canPromisesList,
  });

  // ---- التحصيلات اليومية (مقيّدة تلقائيًا حسب نطاق المستخدم في الـ API) ----
  const collectionsToday = useQuery({
    queryKey: ['collections', 'today'],
    queryFn: () => api<CollectionsResponse>(`/collections?fromDate=${today}&toDate=${today}&limit=5`),
    enabled: canCollectionsList,
  });

  // ---- المهام والمتابعات المتأخرة (شخصية لحساب المحصل الحالي) ----
  const tasksToday = useQuery({
    queryKey: ['tasks-today'],
    queryFn: () => api<TodayTasks>('/tasks/today'),
    enabled: canTasks,
  });
  // تمييز صريح من الـAPI (isCollector=false) بدل تخمين رمز HTTP —
  // تصحيح مراجعة: /tasks/today لم يعد يُلقي خطأً لحساب إداري بلا محصل شخصي.
  const notCollector = tasksToday.data?.isCollector === false;

  // ---- أحدث الإشعارات (لا تتطلب صلاحية خاصة) ----
  const notifications = useQuery({
    queryKey: ['notifications-latest'],
    queryFn: () => api<NotificationsResponse>('/notifications?limit=5'),
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
                <Card className="p-4">
                  <p className="text-xs text-concrete-500">إجمالي العملاء</p>
                  <p className="tnum mt-1 font-display text-2xl font-bold">{summary.data.customers.total}</p>
                  <p className="mt-1 text-xs text-concrete-500">النشطون: {summary.data.customers.active}</p>
                </Card>
                {Object.entries(summary.data.byCurrency).map(([ccy, v]) => (
                  <Card key={ccy} className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-concrete-500">{CCY_AR[ccy] ?? ccy}</p>
                      <Badge tone="pine">{ccy}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-debt-600 dark:text-debt-400">مديونية ({v.debtors})</p>
                        <p className="tnum font-bold text-debt-600 dark:text-debt-400" dir="ltr">{fmtMoney(v.debtTotal)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-credit-600 dark:text-credit-400">دائن ({v.creditors})</p>
                        <p className="tnum font-bold text-credit-600 dark:text-credit-400" dir="ltr">{fmtMoney(v.creditTotal)}</p>
                      </div>
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
                  {(collectionsToday.data?.items ?? []).map((c) => (
                    <TRow key={c.id}>
                      <TD>
                        <Link className="text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${c.customer.id}`}>
                          {c.customer.name}
                        </Link>
                      </TD>
                      <TD><Money value={Number(c.amount)} currency={c.currencyCode} /></TD>
                      <TD className="text-concrete-500">{c.method.name}</TD>
                    </TRow>
                  ))}
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
        {items.map((p) => (
          <TRow key={p.id}>
            <TD>
              <Link className="text-pine-700 hover:underline dark:text-pine-100" href={`/customers/${p.customer.id}`}>
                {p.customer.name}
              </Link>
            </TD>
            <TD><Money value={Number(p.expectedAmount)} currency={p.currencyCode} /></TD>
            <TD><Badge tone={tone}>{PROMISE_STATUS_AR[p.status] ?? p.status}</Badge></TD>
          </TRow>
        ))}
      </tbody>
    </Table>
  );
}
