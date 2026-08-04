'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { CheckCircle2, Clock, AlertTriangle, ArrowUpCircle, TrendingUp, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtMoney, CCY_AR, TASK_STATUS_AR, TASK_TYPE_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Empty, Money, Skeleton } from '@/components/ui/primitives';
import { Table, TRow, TD } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsPanel } from '@/components/ui/tabs';

/* ────────────────────────────── Types ────────────────────────────────── */

interface TodayItem {
  customerId: string;
  customerName: string;
  phone: string | null;
  reason: string;
  priority: number;
  taskId?: string;
  expectedAmount?: number;
  currency?: string;
  balances: { currency: string; balance: number }[];
  lastFollowupAt: string | null;
}

interface TodayResponse {
  collectorId: string | null;
  isCollector: boolean;
  date: string;
  settings: { staleDays: number; highBalanceTopPercent: number } | null;
  summary: {
    tasksToday: number;
    expectedByCurrency: Record<string, number>;
    totalBalanceByCurrency: Record<string, number>;
  };
  items: TodayItem[];
}

interface StoredTask {
  id: string;
  customerId: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  taskType: string;
  dueDate: string;
  priorityReason: string | null;
  expectedAmount: number | null;
  expectedCurrency: string | null;
  status: string;
  sourcePromiseId: string | null;
  createdAt: string;
  customer: { id: string; name: string; externalCustomerCode: string | null } | null;
  sourcePromise: { id: string; dueDate: string; expectedAmount: number; currencyCode: string } | null;
}

/* ────────────────────────────── Priority Helpers ─────────────────────── */

const PRIORITY_CONFIG: Record<number, { color: string; icon: typeof AlertTriangle; label: string }> = {
  1: { color: 'border-r-red-500 bg-red-50/50 dark:bg-red-900/10', icon: ArrowUpCircle, label: 'عاجل' },
  2: { color: 'border-r-amber-500 bg-amber-50/50 dark:bg-amber-900/10', icon: AlertTriangle, label: 'مهم' },
  3: { color: 'border-r-orange-400 bg-orange-50/30 dark:bg-orange-900/10', icon: Clock, label: 'متابعة متأخرة' },
  4: { color: 'border-r-blue-400 bg-blue-50/30 dark:bg-blue-900/10', icon: TrendingUp, label: 'رصيد مرتفع' },
  5: { color: 'border-r-concrete-300 bg-concrete-50/30 dark:bg-white/5', icon: TrendingUp, label: 'مخاطر' },
};

const STATUS_BADGE: Record<string, string> = {
  open: 'hazard', escalated: 'debt', done: 'pine',
};

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function TasksPage() {
  const can = useCan();
  const canManage = can('tasks.manage');
  const qc = useQueryClient();

  const [tab, setTab] = useState('today');
  const [taskFilter, setTaskFilter] = useState<string>('open');
  const [completeId, setCompleteId] = useState<string | null>(null);

  /* ──── Today Board ──── */
  const today = useQuery<TodayResponse>({
    queryKey: ['tasks-today'],
    queryFn: () => api<TodayResponse>('/tasks/today'),
    enabled: canManage,
  });

  /* ──── Stored Tasks ──── */
  const tasks = useQuery<StoredTask[]>({
    queryKey: ['tasks', taskFilter],
    queryFn: () => api<StoredTask[]>(`/tasks?status=${taskFilter}`),
    enabled: canManage && tab === 'stored',
    retry: false,
  });

  /* ──── Client-side search for stored tasks ──── */
  const [taskSearch, setTaskSearch] = useState('');
  const filteredTasks = tasks.data?.filter(t => {
    if (!taskSearch.trim()) return true;
    const s = taskSearch.toLowerCase();
    return (
      t.customer?.name?.toLowerCase().includes(s) ||
      t.customer?.externalCustomerCode?.toLowerCase().includes(s) ||
      t.priorityReason?.toLowerCase().includes(s)
    );
  }) ?? [];

  /* ──── Complete Task Mutation ──── */
  const completeMut = useMutation({
    mutationFn: (taskId: string) => api<StoredTask>(`/tasks/${taskId}/complete`, { method: 'PATCH' }),
    onMutate: (taskId) => setCompleteId(taskId),
    onSettled: () => setCompleteId(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  /* ──── Permission Gate ──── */
  if (!canManage) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية إدارة المهام (tasks.manage)" />
      </Card>
    );
  }

  const s = today.data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader title="عمل اليوم" />

      <Tabs value={tab} onChange={setTab}>
        <TabsList>
          <TabsTrigger value="today" badge={s?.tasksToday}>عمل اليوم</TabsTrigger>
          <TabsTrigger value="stored">المهام المخزنة</TabsTrigger>
        </TabsList>

        {/* ──────────────── Today Board ──────────────── */}
        <TabsPanel value="today">
          <DataState
            isLoading={today.isLoading}
            isError={today.isError}
            error={today.error}
            onRetry={() => today.refetch()}
            isFetching={today.isFetching}
            isEmpty={!today.data?.items?.length}
            emptyTitle="لا توجد مهام اليوم"
            emptyHint={today.data?.isCollector === false ? 'أنت لا تعمل كمحصل حالياً' : undefined}
            skeletonClassName="h-64"
          >
            {today.data && (
              <div className="space-y-4">
                {/* Summary Cards */}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard
                    icon={<CheckCircle2 className="h-5 w-5 text-pine-600" />}
                    label="مهام اليوم"
                    value={String(s?.tasksToday ?? 0)}
                  />
                  {Object.entries(s?.expectedByCurrency ?? {}).map(([ccy, amt]) => (
                    <SummaryCard
                      key={ccy}
                      icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
                      label={`المتوقع (${CCY_AR[ccy] ?? ccy})`}
                      value={<Money value={amt} currency={ccy} />}
                    />
                  ))}
                  {Object.entries(s?.totalBalanceByCurrency ?? {}).map(([ccy, amt]) => (
                    <SummaryCard
                      key={ccy}
                      icon={<TrendingUp className="h-5 w-5 text-blue-500" />}
                      label={`إجمالي الأرصدة (${CCY_AR[ccy] ?? ccy})`}
                      value={<Money value={amt} currency={ccy} />}
                    />
                  ))}
                </div>

                {/* Items */}
                <Card>
                  <Table>
                    <thead>
                      <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10">
                        <th className="px-4 py-2.5 font-medium">الأولوية</th>
                        <th className="px-4 py-2.5 font-medium">العميل</th>
                        <th className="px-4 py-2.5 font-medium">السبب</th>
                        <th className="px-4 py-2.5 font-medium">الأرصدة</th>
                        <th className="px-4 py-2.5 font-medium">آخر متابعة</th>
                        <th className="px-4 py-2.5 font-medium">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {today.data.items.map((item, i) => {
                        const pc = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG[5];
                        const Icon = pc.icon;
                        return (
                          <TRow key={`${item.customerId}-${i}`}>
                            <TD>
                              <span className={`inline-flex items-center gap-1.5 rounded-full border-r-4 px-3 py-1 text-xs font-medium ${pc.color}`}>
                                <Icon className="h-3 w-3" />
                                {pc.label}
                              </span>
                            </TD>
                            <TD>
                              <div>
                                <Link
                                  href={`/customers/${item.customerId}`}
                                  className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                                >
                                  {item.customerName}
                                </Link>
                                {item.phone && (
                                  <p className="flex items-center gap-1 text-xs text-concrete-400" dir="ltr">
                                    <Phone className="h-3 w-3" /> {item.phone}
                                  </p>
                                )}
                              </div>
                            </TD>
                            <TD className="text-sm text-concrete-600 dark:text-concrete-400">
                              {item.reason}
                              {item.expectedAmount != null && item.currency && (
                                <span className="mr-1 text-xs">
                                  (<Money value={item.expectedAmount} currency={item.currency} />)
                                </span>
                              )}
                            </TD>
                            <TD>
                              {item.balances.length > 0 ? (
                                <div className="space-y-0.5">
                                  {item.balances.map(b => (
                                    <Money key={b.currency} value={b.balance} currency={b.currency} signed />
                                  ))}
                                </div>
                              ) : (
                                <span className="text-concrete-400">—</span>
                              )}
                            </TD>
                            <TD className="text-xs text-concrete-500">
                              {item.lastFollowupAt ? fmtDate(item.lastFollowupAt) : 'لم تتم'}
                            </TD>
                            <TD>
                              {item.taskId ? (
                                <Link
                                  href={`/customers/${item.customerId}?tab=overview&complete=${item.taskId}`}
                                  className="inline-flex items-center gap-1 rounded-lg bg-credit-600 px-2 py-1 text-xs font-medium text-white hover:bg-credit-700"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" /> إكمال
                                </Link>
                              ) : (
                                <span className="text-concrete-300">—</span>
                              )}
                            </TD>
                          </TRow>
                        );
                      })}
                    </tbody>
                  </Table>
                </Card>

                {today.data.settings && (
                  <p className="text-[10px] text-concrete-400 text-center">
                    إعدادات: متابعة جامدة بعد {today.data.settings.staleDays} يومًا • أعلى {today.data.settings.highBalanceTopPercent}% أرصدة
                  </p>
                )}
              </div>
            )}
          </DataState>
        </TabsPanel>

        {/* ──────────────── Stored Tasks ──────────────── */}
        <TabsPanel value="stored">
          <Card>
            {/* Filters bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-concrete-100 px-4 py-3 dark:border-white/10">
              <div className="flex gap-1">
                {['open', 'escalated', 'done'].map(s => (
                  <button
                    key={s}
                    onClick={() => setTaskFilter(s)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      taskFilter === s
                        ? 'bg-pine-700 text-white dark:bg-pine-600'
                        : 'text-concrete-500 hover:bg-concrete-100 dark:hover:bg-white/10'
                    }`}
                  >
                    {TASK_STATUS_AR[s]}
                  </button>
                ))}
              </div>
              <input
                value={taskSearch}
                onChange={e => setTaskSearch(e.target.value)}
                placeholder="بحث بالاسم أو السبب..."
                className="mr-auto rounded-lg border border-concrete-200 px-3 py-1.5 text-xs dark:border-white/10 dark:bg-iron-800 dark:text-concrete-100"
              />
            </div>

            <DataState
              isLoading={tasks.isLoading}
              isError={tasks.isError}
              error={tasks.error}
              onRetry={() => tasks.refetch()}
              isFetching={tasks.isFetching}
              isEmpty={!filteredTasks.length}
              emptyTitle="لا توجد مهام"
              emptyHint={taskFilter !== 'open' ? 'جرّب تغيير الفلتر' : undefined}
              skeletonClassName="h-64"
            >
              <Table>
                <thead>
                  <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10">
                    <th className="px-4 py-2.5 font-medium">النوع</th>
                    <th className="px-4 py-2.5 font-medium">العميل</th>
                    <th className="px-4 py-2.5 font-medium">السبب</th>
                    <th className="px-4 py-2.5 font-medium">المبلغ المتوقع</th>
                    <th className="px-4 py-2.5 font-medium">تاريخ الاستحقاق</th>
                    <th className="px-4 py-2.5 font-medium">الحالة</th>
                    <th className="px-4 py-2.5 font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map(t => (
                    <TRow key={t.id}>
                      <TD className="text-xs">
                        {TASK_TYPE_AR[t.taskType] ?? t.taskType}
                      </TD>
                      <TD>
                        {t.customer ? (
                          <Link
                            href={`/customers/${t.customer.id}`}
                            className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                          >
                            {t.customer.name}
                          </Link>
                        ) : (
                          <span className="text-concrete-400">—</span>
                        )}
                        {t.customer?.externalCustomerCode && (
                          <p className="text-xs text-concrete-500" dir="ltr">{t.customer.externalCustomerCode}</p>
                        )}
                      </TD>
                      <TD className="max-w-[260px] text-xs leading-5 text-concrete-600 dark:text-concrete-400">
                        <span className="line-clamp-3" title={t.priorityReason ?? ''}>
                          {t.priorityReason ?? '—'}
                        </span>
                      </TD>
                      <TD>
                        {t.expectedAmount != null && t.expectedCurrency ? (
                          <Money value={Number(t.expectedAmount)} currency={t.expectedCurrency} />
                        ) : (
                          <span className="text-concrete-400">—</span>
                        )}
                      </TD>
                      <TD className="text-xs">{fmtDate(t.dueDate)}</TD>
                      <TD>
                        <Badge tone={STATUS_BADGE[t.status] as any}>
                          {TASK_STATUS_AR[t.status] ?? t.status}
                        </Badge>
                      </TD>
                      <TD>
                        {t.status !== 'done' && (
                          <Button
                            variant="success"
                            onClick={() => completeMut.mutate(t.id)}
                            loading={completeId === t.id}
                            className="text-xs px-2 py-1"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            إنجاز
                          </Button>
                        )}
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            </DataState>
          </Card>
        </TabsPanel>
      </Tabs>
    </div>
  );
}

/* ────────────────────────────── Helpers ────────────────────────────── */

function SummaryCard({ icon, label, value }: {
  icon: React.ReactNode; label: string; value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-concrete-100 bg-white p-4 dark:border-white/10 dark:bg-iron-900">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-concrete-50 dark:bg-white/5">
        {icon}
      </div>
      <div>
        <p className="text-xs text-concrete-500">{label}</p>
        <p className="text-lg font-bold text-iron-900 dark:text-concrete-100">{value}</p>
      </div>
    </div>
  );
}
