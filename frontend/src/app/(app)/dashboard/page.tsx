'use client';
import {DashboardReservations} from '@/components/dashboard/reservations';
import {DebtChangeDialog} from '@/components/dashboard/debt-dialog';
import {DashboardActivity} from '@/components/dashboard/activity';
import {DashboardInsights} from '@/components/dashboard/insights';
import {OperationsOverview} from '@/components/dashboard/operations-overview';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, Bot, ChevronLeft, Sparkles, UsersRound } from 'lucide-react';
import { api, tokenStore } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { todayISO } from '@/lib/errors';
import { CCY_AR, fmtDateTime, fmtMoney,  } from '@/lib/format';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Money } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';

/**
 * شرط موحّد: نفّذ الاستعلام فقط عند وجود Access Token في المتصفح.
 * يمنع 401 requests أثناء Hydration أو قبل تحميل الجلسة.
 */
const hasToken = () => typeof window !== 'undefined' && !!tokenStore.access;

import type {DashboardSummary,CollectorSummary,PromiseItem,CollectionsResponse,TodayTasks,NotificationsResponse,ReservationSummary,DebtChangeAccount,KpiResponse} from '@/components/dashboard/types';
export default function DashboardPage() {
  const can = useCan();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const today = todayISO();
  const [debtAccounts, setDebtAccounts] = useState<{ currency: string; items: DebtChangeAccount[] } | null>(null);

  const canAdminKpis = can('reports.read');
  const canCollectorKpis = can('tasks.manage');
  const canPromisesList = can('customers.read');
  const canCollectionsList = can('customers.read');
  const canTasks = can('tasks.manage');
  const canReservations = can('reservations.read');
  const isManagerView = canAdminKpis;

  const settings = useQuery<{ key: string; value: unknown }[]>({
    queryKey: ['settings'], queryFn: () => api('/settings'), enabled: canTasks && hasToken(), staleTime: 60_000,
  });
  const smartTasksEnabledRaw = settings.data?.find((s) => s.key === 'smartTasks.enabled')?.value;
  const smartTasksEnabled = smartTasksEnabledRaw !== false && String(smartTasksEnabledRaw ?? 'true').toLowerCase() !== 'false';
  const autoGenerate = useMutation({
    mutationFn: () => api<{ createdTasks: number; enabled?: boolean }>('/tasks/generate-today', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks-today'] });
      qc.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    },
  });
  useEffect(() => {
    if (!canTasks || !smartTasksEnabled || !settings.isSuccess || autoGenerate.isPending) return;
    const key = `albinaa-smart-tasks-${today}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    autoGenerate.mutate();
    // Runs once per signed-in browser session/day; backend also prevents duplicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTasks, smartTasksEnabled, settings.isSuccess, today]);

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
  const collectorDebt = useQuery({
    queryKey: ['dashboard-debt-24h'],
    queryFn: () => api<DashboardSummary['newDebt']>('/dashboard/debt-change-24h'),
    enabled: !canAdminKpis && can('customers.read') && can('balances.read') && hasToken(),
    refetchInterval: 60_000,
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
    queryFn: () => api<CollectionsResponse>('/collections/activity/today'),
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
  const reservationSummary = useQuery({
    queryKey: ['reservations-summary'],
    queryFn: () => api<ReservationSummary>('/reservations/summary'),
    enabled: canReservations && hasToken(),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-l from-[#06241B] via-[#0B3C2D] to-pine-700 p-5 text-white shadow-card sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-white/70"><Sparkles className="h-4 w-4 text-[#C59B27]" /> لوحة أعمال المنصة</div>
            <h1 className="font-display text-xl font-bold sm:text-2xl">مرحبًا{me ? `، ${me.fullName.split(' ')[0]}` : ''}</h1>
            <p className="mt-1 text-sm text-white/70">ملخص أعمالك والطلبات التي تحتاج متابعة، بحسب صلاحياتك</p>
          </div>
          {canTasks && <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm"><Bot className="h-4 w-4 text-[#C59B27]" /> المهام الذكية</div>
            <p className="mt-1 text-xs text-white/70">{smartTasksEnabled ? (autoGenerate.isPending ? 'جارٍ تحديث الأولويات…' : 'مفعّلة وتُحدّث يوميًا') : 'متوقفة من الإعدادات'}</p>
          </div>}
        </div>
      </div>

      <OperationsOverview/>

      {isManagerView && summary.data?.customerAlerts && (
        <section aria-label="تنبيهات العملاء" className="grid gap-3 sm:grid-cols-2">
          <Link href="/customers?collectorId=unassigned">
            <Card className={`flex h-full items-center justify-between gap-4 border-r-4 p-4 transition-colors hover:bg-hazard-50/60 dark:hover:bg-hazard-900/20 ${summary.data.customerAlerts.unassigned.count ? 'border-r-hazard-500' : 'border-r-credit-500'}`}>
              <div>
                <p className="text-sm font-bold">عملاء دون محصّل</p>
                <p className="mt-1 text-xs text-concrete-500">حسابات مدينة قابلة للمتابعة ولم تُسند بعد</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="tnum font-display text-2xl font-black">{summary.data.customerAlerts.unassigned.count}</span>
                <AlertTriangle className={`h-5 w-5 ${summary.data.customerAlerts.unassigned.count ? 'text-hazard-500' : 'text-credit-500'}`} />
              </div>
            </Card>
          </Link>
          <Link href={`/customers?createdSince=${String(summary.data.customerAlerts.newCustomers.since).slice(0, 10)}&sortBy=createdAt&sortDir=desc`}>
            <Card className="flex h-full items-center justify-between gap-4 border-r-4 border-r-[#C59B27] p-4 transition-colors hover:bg-[#C59B27]/5">
              <div>
                <p className="text-sm font-bold">العملاء الجدد</p>
                <p className="mt-1 text-xs text-concrete-500">الحسابات المدينة المنشأة خلال آخر 7 أيام</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="tnum font-display text-2xl font-black">{summary.data.customerAlerts.newCustomers.count}</span>
                <Sparkles className="h-5 w-5 text-[#C59B27]" />
              </div>
            </Card>
          </Link>
        </section>
      )}

      {/* المؤشرات الرئيسية */}
      {(canAdminKpis||canCollectorKpis)&&<section aria-label="المؤشرات الرئيسية">
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
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <Link href="/customers">
                  <Card className="p-4 transition-colors hover:bg-pine-50/40 dark:hover:bg-white/5">
                    <p className="text-xs text-concrete-500">إجمالي العملاء</p>
                    <p className="tnum mt-1 font-display text-2xl font-bold">{summary.data.customers.total}</p>
                    <p className="mt-1 text-xs text-concrete-500">النشطون: {summary.data.customers.active}</p>
                  </Card>
                </Link>
                <Link href="/advances">
                  <Card className="p-4 transition-colors hover:bg-pine-50/40 dark:hover:bg-white/5">
                    <p className="text-xs text-concrete-500">إجمالي السلف</p>
                    {Object.keys(summary.data.advances.byCurrency).length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {Object.entries(summary.data.advances.byCurrency).map(([ccy, value]) => (
                          <div key={ccy} className="rounded-lg bg-concrete-50 p-2 text-xs dark:bg-white/5">
                            <p className="font-semibold">{CCY_AR[ccy] ?? ccy}</p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="text-red-700 dark:text-red-300">مدين: <b className="tnum" dir="ltr">{fmtMoney(value.debtorBalance)} {ccy}</b></span>
                              <span className="text-emerald-700 dark:text-emerald-300">دائن: <b className="tnum" dir="ltr">{fmtMoney(value.creditorBalance)} {ccy}</b></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="mt-2 text-sm text-concrete-500">لا توجد سلف مستوردة</p>}
                    <p className="mt-1 text-xs text-concrete-500">{summary.data.advances.accounts} حساب</p>
                    <p className="mt-1 text-[11px] text-concrete-400" dir="ltr">
                      {(summary.data.advances.sourceAccountCodes ?? ['113101001', '113101002']).join(' + ')}
                    </p>
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
                {summary.data.newDebt?.perCurrency && (
                  <Card className="p-4">
                    <p className="text-xs text-concrete-500">صافي تغير المديونية — آخر 24 ساعة</p>
                    <p className="text-xs text-concrete-500">من حركات المنصة وحركات Oracle المنشورة خلال آخر 24 ساعة، دون تكرار السندات. إجمالي الوارد والمنصرف منفصل عن الصافي.</p>
                    {!Object.keys(summary.data.newDebt.perCurrency).length && <p>لا توجد قيود ضمن النطاق المحدد.</p>}
                    {summary.data.newDebt.window && (
                      <p className="mt-1 text-[11px] text-concrete-400">ضمن العملاء المسموحين للمستخدم، وحسب وقت إنشاء المستند في مصدره.</p>
                    )}
                    {summary.data.newDebt.comparison?.comparable && (
                      <div className="mt-2 rounded-lg bg-concrete-50 p-2 text-[11px] leading-5 text-concrete-600 dark:bg-white/5 dark:text-concrete-300">
                        <p>الأحدث: {summary.data.newDebt.comparison.latestFile}</p>
                        <p>السابق: {summary.data.newDebt.comparison.previousFile}</p>
                        {summary.data.newDebt.betweenImports?.previous && (
                          <p>
                            الفترة: {fmtDateTime(summary.data.newDebt.betweenImports.previous)} ← {fmtDateTime(summary.data.newDebt.betweenImports.latest)}
                          </p>
                        )}
                      </div>
                    )}
                    {Object.entries(summary.data.newDebt.perCurrency).map(([ccy, v]) => (
                      <div key={ccy} className="mt-2 rounded-lg border border-concrete-100 p-2 dark:border-white/10">
                        <div className="flex items-center justify-between gap-3">
                          <Badge tone="neutral">{ccy}</Badge>
                          <p
                            className={`tnum text-sm font-bold ${(v.netChange ?? v.amount) >= 0 ? 'text-debt-600 dark:text-debt-400' : 'text-credit-600 dark:text-credit-400'}`}
                            dir="ltr"
                          >
                            {fmtMoney(v.netChange ?? v.amount)} {ccy}
                          </p>
                        </div>
                        <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-concrete-500">
                          <span dir="ltr">الزيادات: {fmtMoney(v.positiveIncreases ?? 0)}</span>
                          <span dir="ltr">الانخفاضات: {fmtMoney(v.decreases ?? 0)}</span>
                        </div>
                        {(v.affectedAccounts?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => setDebtAccounts({ currency: ccy, items: v.affectedAccounts ?? [] })}
                            className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-pine-50 px-3 py-1.5 text-xs font-semibold text-pine-700 transition-colors hover:bg-pine-100 dark:bg-pine-900/50 dark:text-pine-100 dark:hover:bg-pine-900"
                          >
                            <UsersRound className="h-4 w-4" />
                            عرض {v.affectedCount ?? v.affectedAccounts?.length ?? 0} حسابًا متأثرًا
                          </button>
                        )}
                      </div>
                    ))}
                  </Card>
                )}
                {summary.data.methodology?.debtScope && (
                  <Card className="p-4 sm:col-span-2 xl:col-span-4">
                    <p className="text-xs text-concrete-500"><strong>نطاق المديونية:</strong> {summary.data.methodology.debtScope}.</p>
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
      </section>}

      {!canAdminKpis && can('customers.read') && can('balances.read') && <Card className="p-4">
        <p className="font-bold">صافي تغير المديونية — آخر 24 ساعة</p>
        <p className="text-xs text-concrete-500">حركات المنصة وحركات Oracle المنشورة لحساباتك المسموحة فقط، دون تكرار السندات.</p>
        {collectorDebt.isLoading && <p>جارٍ تحميل المؤشر…</p>}
        {collectorDebt.isError && <Button onClick={() => collectorDebt.refetch()}>تعذر التحميل — إعادة المحاولة</Button>}
        {collectorDebt.data && !Object.keys(collectorDebt.data.perCurrency ?? {}).length && <p>لا توجد قيود ضمن النطاق المحدد.</p>}
        {Object.entries(collectorDebt.data?.perCurrency ?? {}).map(([ccy, row]) => <div key={ccy} className="mt-2 border-t pt-2">
          <p>{ccy} — الصافي: {fmtMoney(row.netChange ?? row.amount)}</p>
          <p>وارد: {fmtMoney(row.positiveIncreases ?? 0)} — منصرف: {fmtMoney(row.decreases ?? 0)}</p>
          {!!row.affectedAccounts?.length && <Button onClick={() => setDebtAccounts({ currency: ccy, items: row.affectedAccounts ?? [] })}>عرض الحسابات</Button>}
        </div>)}
      </Card>}
      <DebtChangeDialog debtAccounts={debtAccounts} setDebtAccounts={setDebtAccounts}/>


      {canReservations && <DashboardReservations reservationSummary={reservationSummary}/>}

      {canTasks && (
        <Card className="overflow-hidden border border-[#C59B27]/30">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F9F3E5] px-4 py-3 dark:bg-[#C59B27]/10">
            <div>
              <h2 className="font-display text-sm font-bold text-[#0B3C2D] dark:text-pine-100">قرار اليوم — من يجب التواصل معه؟</h2>
              <p className="mt-0.5 text-xs text-concrete-500">الترتيب يجمع الوعود المتأخرة، المخاطر، كِبر المبلغ، وعمر المديونية بعد أسبوع.</p>
            </div>
            <Link href="/tasks" className="inline-flex items-center gap-1 text-xs font-medium text-pine-700 dark:text-pine-100">فتح قائمة العمل <ChevronLeft className="h-4 w-4" /></Link>
          </div>
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {(isManagerView ? (kpis.data?.topPriorityTasks ?? []).slice(0, 6).map((t) => ({
              id: t.taskId, customerId: t.customerId, name: t.customerName, reason: t.priorityReason,
              amount: t.expectedAmount, currency: t.expectedCurrency, priority: t.priority,
            })) : (tasksToday.data?.items ?? []).slice(0, 6).map((t, index) => ({
              id: `${t.customerId}-${index}`, customerId: t.customerId, name: t.customerName, reason: t.reason,
              amount: t.expectedAmount ?? null, currency: t.currency ?? null, priority: t.priority,
            }))).map((item, index) => (
              <Link key={item.id} href={`/customers/${item.customerId}`} className="group rounded-xl border border-concrete-100 bg-white p-3 transition hover:-translate-y-0.5 hover:border-pine-500 hover:shadow-card dark:border-white/10 dark:bg-iron-800">
                <div className="flex items-start justify-between gap-2"><span className="font-medium text-iron-900 dark:text-concrete-100">{index + 1}. {item.name}</span><Badge tone={item.priority <= 3 ? 'debt' : item.priority <= 6 ? 'hazard' : 'pine'}>أولوية {item.priority}</Badge></div>
                <p className="mt-2 line-clamp-2 text-xs text-concrete-500">{item.reason}</p>
                {item.amount != null && item.currency && <p className="mt-2 text-sm font-bold text-debt-600"><Money value={item.amount} currency={item.currency} /></p>}
              </Link>
            ))}
            {((isManagerView ? kpis.data?.topPriorityTasks : tasksToday.data?.items)?.length ?? 0) === 0 && <p className="p-3 text-sm text-concrete-500">لا توجد مهام ذات أولوية الآن.</p>}
          </div>
        </Card>
      )}

      {canAdminKpis && <DashboardInsights kpis={kpis}/>}

      <DashboardActivity canPromisesList={canPromisesList} canCollectionsList={canCollectionsList} canTasks={canTasks} dueTodayPromises={dueTodayPromises} overduePromises={overduePromises} collectionsToday={collectionsToday} notCollector={notCollector} tasksToday={tasksToday} notifications={notifications}/>
    </div>
  );
}
