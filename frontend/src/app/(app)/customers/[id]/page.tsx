'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { ArrowDownUp, Download, Phone, MapPin, Building2, UserCheck, Clock, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, CCY_AR, PROMISE_STATUS_AR, COLLECTION_STATUS_AR } from '@/lib/format';
import { friendlyApiError } from '@/lib/errors';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Badge, Button, Card, Empty, Money, Pagination, Select, Skeleton } from '@/components/ui/primitives';
import { Table, THead, TRow, TD } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsPanel } from '@/components/ui/tabs';

/* ──────────────────────────────────────────── Types ───────────────────────────────────── */

interface Customer360 {
  id: string;
  externalCustomerCode: string;
  accountNumber: string | null;
  name: string;
  tradeName: string | null;
  phonePrimary: string | null;
  phoneSecondary: string | null;
  whatsapp: string | null;
  region: string | null;
  address: string | null;
  branch: { id: string; name: string } | null;
  customerType: string | null;
  status: string;
  relationshipStartDate: string | null;
  notes: string | null;
  createdAt: string;
  balances: {
    currency: string;
    accountingBalance: number;
    declaredBalance: number | null;
    openingDebit: number;
    openingCredit: number;
    lastImport: { jobId: string; at: string; file: string } | null;
    updatedAt: string;
  }[];
  currentCollector: {
    collectorId: string;
    name: string;
    since: string;
  } | null;
  assignmentHistoryCount: number;
  creditPolicy: Record<string, unknown> | null;
  latestScore: Record<string, unknown> | null;
  pendingDuplicateAlerts: number;
  counts: {
    importedTxns: number;
    followups: number;
    promises: number;
    collections: number;
    tasks: number;
  };
}

interface StatementResponse {
  currency: string;
  openingBalance: number;
  periodStartBalance: number;
  currentBalance: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: {
    date: string;
    documentType: string;
    documentNumber: string;
    description: string;
    reference: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }[];
}

interface TimelineResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: {
    at: string;
    type: string;
    title: string;
    details?: Record<string, unknown>;
  }[];
}

interface FollowupItem {
  id: string;
  followupAt: string;
  notes: string | null;
  nextFollowupDate: string | null;
  expectedAmount: number | null;
  expectedCurrency: string | null;
  type: { name: string };
  result: { name: string };
  user: { fullName: string };
  createdAt: string;
}

interface PromiseItem {
  id: string;
  promiseDate: string;
  dueDate: string;
  expectedAmount: number;
  currencyCode: string;
  status: string;
  statusReason: string | null;
  fulfilledAmount: number | null;
  notes: string | null;
  collector: { user: { fullName: string } };
  createdAt: string;
}

interface CollectionItem {
  id: string;
  currencyCode: string;
  amount: number;
  collectedAt: string;
  status: string;
  receiptNumber: string | null;
  referenceNumber: string | null;
  notes: string | null;
  collector: { user: { fullName: string } };
  method: { name: string };
  branch: { name: string } | null;
  createdAt: string;
}

interface PaginatedResponse<T> {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: T[];
  totalsByCurrency?: Record<string, number>;
}

/* ──────────────────────────────── Status Helpers ──────────────────────────────────── */

const TIMELINE_COLORS: Record<string, string> = {
  customer_created: 'bg-pine-100 text-pine-700 dark:bg-pine-900/30 dark:text-pine-200',
  balance_snapshot: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
  assignment: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
  followup: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200',
  payment_promise: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200',
  collection: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
  collection_reversal: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200',
};

function timelineColor(type: string) {
  if (type.startsWith('audit:')) return 'bg-concrete-100 text-concrete-600 dark:bg-white/10 dark:text-concrete-300';
  return TIMELINE_COLORS[type] ?? 'bg-concrete-100 text-concrete-600 dark:bg-white/10 dark:text-concrete-300';
}

function promiseStatusBadge(s: string) {
  const tones: Record<string, string> = {
    fulfilled: 'pine', partially_fulfilled: 'pine',
    upcoming: 'neutral', due_today: 'hazard',
    unfulfilled: 'debt', postponed: 'credit', cancelled_approved: 'neutral',
  };
  return tones[s] ?? 'neutral';
}

function collectionStatusBadge(s: string) {
  const tones: Record<string, string> = {
    approved: 'pine', matched: 'pine',
    recorded: 'neutral', handed_to_cashier: 'credit',
    reversed: 'debt',
  };
  return tones[s] ?? 'neutral';
}

/* ──────────────────────────────── Main Page ──────────────────────────────────────── */

export default function Customer360Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const can = useCan();
  const canRead = can('customers.read');
  const canBalances = can('balances.read');

  const [tab, setTab] = useState(searchParams.get('tab') ?? 'overview');

  const setTabSafe = (v: string) => {
    setTab(v);
    router.replace(`/customers/${id}?tab=${v}`, { scroll: false });
  };

  /* ──────── Customer 360 query ──────── */
  const customer = useQuery<Customer360>({
    queryKey: ['customer360', id],
    queryFn: () => api<Customer360>(`/customers/${id}`),
    enabled: canRead,
  });

  /* ──────── Statement queries (lazy per tab) ──────── */
  const [stmtCurrency, setStmtCurrency] = useState('YER');
  const [stmtPage, setStmtPage] = useState(1);
  const statement = useQuery<StatementResponse>({
    queryKey: ['statement', id, stmtCurrency, stmtPage],
    queryFn: () => api<StatementResponse>(
      `/customers/${id}/statement?currency=${stmtCurrency}&page=${stmtPage}&limit=50`,
    ),
    enabled: canRead && canBalances && tab === 'statement',
    retry: false,
  });

  /* ──────── Timeline queries ──────── */
  const [tlPage, setTlPage] = useState(1);
  const timeline = useQuery<TimelineResponse>({
    queryKey: ['timeline', id, tlPage],
    queryFn: () => api<TimelineResponse>(`/customers/${id}/timeline?page=${tlPage}&limit=50`),
    enabled: canRead && tab === 'timeline',
  });

  /* ──────── Followups ──────── */
  const [fuPage, setFuPage] = useState(1);
  const followups = useQuery<PaginatedResponse<FollowupItem>>({
    queryKey: ['followups', id, fuPage],
    queryFn: () => api<PaginatedResponse<FollowupItem>>(
      `/followups?customerId=${id}&page=${fuPage}&limit=25`,
    ),
    enabled: canRead && tab === 'followups',
  });

  /* ──────── Promises ──────── */
  const [prPage, setPrPage] = useState(1);
  const promises = useQuery<PaginatedResponse<PromiseItem>>({
    queryKey: ['promises', id, prPage],
    queryFn: () => api<PaginatedResponse<PromiseItem>>(
      `/payment-promises?customerId=${id}&page=${prPage}&limit=25`,
    ),
    enabled: canRead && tab === 'promises',
  });

  /* ──────── Collections ──────── */
  const [coPage, setCoPage] = useState(1);
  const collections = useQuery<PaginatedResponse<CollectionItem>>({
    queryKey: ['collections', id, coPage],
    queryFn: () => api<PaginatedResponse<CollectionItem>>(
      `/collections?customerId=${id}&page=${coPage}&limit=25`,
    ),
    enabled: canRead && tab === 'collections',
  });

  /* ──────── CSV Export ──────── */
  const exportCsv = () => {
    if (statement.data?.items?.length) {
      const headers = ['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'المرجع', 'مدين', 'دائن', 'الرصيد الجاري'];
      const rows = statement.data.items.map(r => [
        r.date, r.documentType, r.documentNumber, r.description, r.reference,
        r.debit || '', r.credit || '', r.runningBalance,
      ]);
      const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\r\n');
      const BOM = '\uFEFF';
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(BOM + csv);
      const link = document.createElement('a');
      link.href = dataUri;
      link.download = `statement-${stmtCurrency}-${stmtPage}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => document.body.removeChild(link), 200);
    } else if (c?.balances?.length) {
      const headers = ['العملة', 'الرصيد المحاسبي', 'الرصيد المعلنه', 'الديون الافتتاحية', 'الدائن الافتتاحي'];
      const rows = c.balances.map(b => [
        CCY_AR[b.currency] ?? b.currency, b.accountingBalance, b.declaredBalance ?? '',
        b.openingDebit, b.openingCredit,
      ]);
      const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\r\n');
      const BOM = '\uFEFF';
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(BOM + csv);
      const link = document.createElement('a');
      link.href = dataUri;
      link.download = `balances-${c.name}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => document.body.removeChild(link), 200);
    }
  };

  /* ──────── Permission gate ──────── */
  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض بيانات العميل" />
      </Card>
    );
  }

  const c = customer.data;
  const isLoading = customer.isLoading;
  const err = customer.error;

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title={isLoading ? '...' : c?.name ?? 'العميل'}
        action={
          c ? (
            <Link href="/customers" className="text-sm text-pine-700 hover:underline dark:text-pine-100">
              ← العودة للقائمة
            </Link>
          ) : undefined
        }
      />

      {/* Customer Info Bar */}
      {c && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="font-semibold text-iron-900 dark:text-concrete-100">{c.name}</span>
            {c.externalCustomerCode && (
              <span className="text-concrete-500" dir="ltr">{c.externalCustomerCode}</span>
            )}
            <Badge tone={c.status === 'active' ? 'pine' : 'neutral'}>
              {c.status === 'active' ? 'نشط' : 'غير نشط'}
            </Badge>
            {c.phonePrimary && (
              <span className="flex items-center gap-1 text-concrete-600 dark:text-concrete-400">
                <Phone className="h-3.5 w-3.5" /> {c.phonePrimary}
              </span>
            )}
            {c.region && (
              <span className="flex items-center gap-1 text-concrete-600 dark:text-concrete-400">
                <MapPin className="h-3.5 w-3.5" /> {c.region}
              </span>
            )}
            {c.branch && (
              <span className="flex items-center gap-1 text-concrete-600 dark:text-concrete-400">
                <Building2 className="h-3.5 w-3.5" /> {c.branch?.name ?? '—'}
              </span>
            )}
            {c.currentCollector && (
              <span className="flex items-center gap-1 text-concrete-600 dark:text-concrete-400">
                <UserCheck className="h-3.5 w-3.5" /> {c.currentCollector.name}
              </span>
            )}
            {c.pendingDuplicateAlerts > 0 && (
              <Badge tone="hazard">
                <AlertTriangle className="h-3 w-3" /> {c.pendingDuplicateAlerts} تشابه
              </Badge>
            )}
          </div>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={tab} onChange={setTabSafe}>
        <TabsList>
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="statement">كشف الحساب</TabsTrigger>
          <TabsTrigger value="timeline">الجدول الزمني</TabsTrigger>
          <TabsTrigger value="followups" badge={c?.counts.followups}>المتابعات</TabsTrigger>
          <TabsTrigger value="promises" badge={c?.counts.promises}>الوعود</TabsTrigger>
          <TabsTrigger value="collections" badge={c?.counts.collections}>التحصيلات</TabsTrigger>
        </TabsList>

        {/* ──────────────── Overview Tab ──────────────── */}
        <TabsPanel value="overview">
          <DataState
            isLoading={isLoading} isError={!!err} error={err} onRetry={() => customer.refetch()}
            isEmpty={!c} emptyTitle="العميل غير موجود"
          >
            {c && (
              <div className="space-y-5">
                {/* Stats Cards */}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="الرصيد الحالي"
                    value={
                      c.balances.length > 0
                        ? c.balances.map(b => <Money key={b.currency} value={b.accountingBalance} currency={b.currency} signed />)
                        : <span className="text-concrete-400">—</span>
                    }
                  />
                  <StatCard label="نوع العميل" value={c.customerType ?? '—'} />
                  <StatCard label="تاريخRelationship" value={c.relationshipStartDate ? fmtDate(c.relationshipStartDate) : '—'} />
                  <StatCard label="تاريخ الإنشاء" value={fmtDateTime(c.createdAt)} />
                </div>

                {/* Detail Grid */}
                <Card className="p-4">
                  <h3 className="mb-3 text-sm font-semibold text-iron-900 dark:text-concrete-100">بيانات العميل</h3>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <DetailRow label="الكود" value={c.externalCustomerCode} />
                    <DetailRow label="رقم الحساب" value={c.accountNumber} />
                    <DetailRow label="الاسم التجاري" value={c.tradeName} />
                    <DetailRow label="هاتف أساسي" value={c.phonePrimary} dir="ltr" />
                    <DetailRow label="هاتف ثانوي" value={c.phoneSecondary} dir="ltr" />
                    <DetailRow label="واتساب" value={c.whatsapp} dir="ltr" />
                    <DetailRow label="المنطقة" value={c.region} />
                    <DetailRow label="العنوان" value={c.address} />
                    <DetailRow label="الفرع" value={c.branch?.name} />
                    <DetailRow
                      label="المحصل الحالي"
                      value={c.currentCollector ? `${c.currentCollector.name} (منذ ${fmtDate(c.currentCollector.since)})` : undefined}
                    />
                    <DetailRow label="عدد التحويلات" value={c.assignmentHistoryCount > 0 ? `${c.assignmentHistoryCount} مرة` : undefined} />
                  </dl>
                </Card>

                {/* Balances */}
                {c.balances.length > 0 && (
                  <Card className="p-4">
                    <h3 className="mb-3 text-sm font-semibold text-iron-900 dark:text-concrete-100">الأرصدة</h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {c.balances.map(b => (
                        <div key={b.currency} className="rounded-lg border border-concrete-100 p-3 dark:border-white/10">
                          <p className="text-xs text-concrete-500">{CCY_AR[b.currency] ?? b.currency}</p>
                          <span className="text-lg font-bold"><Money value={b.accountingBalance} currency={b.currency} signed /></span>
                          <div className="mt-1 text-xs text-concrete-400">
                            سلف: <Money value={b.openingDebit} /> | دائن: <Money value={b.openingCredit} />
                          </div>
                          {b.lastImport && (
                            <p className="mt-1 text-[10px] text-concrete-400">
                              آخر استيراد: {b.lastImport.file} — {fmtDateTime(b.lastImport.at)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Notes */}
                {c.notes && (
                  <Card className="p-4">
                    <h3 className="mb-2 text-sm font-semibold text-iron-900 dark:text-concrete-100">ملاحظات</h3>
                    <p className="text-sm text-concrete-600 dark:text-concrete-400 whitespace-pre-wrap">{c.notes}</p>
                  </Card>
                )}

                {/* Activity Counts */}
                <Card className="p-4">
                  <h3 className="mb-3 text-sm font-semibold text-iron-900 dark:text-concrete-100">النشاط</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <CountBadge label="حركات مستوردة" count={c.counts.importedTxns} />
                    <CountBadge label="متابعات" count={c.counts.followups} />
                    <CountBadge label="وعود" count={c.counts.promises} />
                    <CountBadge label="تحصيلات" count={c.counts.collections} />
                    <CountBadge label="مهام" count={c.counts.tasks} />
                  </div>
                </Card>
              </div>
            )}
          </DataState>
        </TabsPanel>

        {/* ──────────────── Statement Tab ──────────────── */}
        <TabsPanel value="statement">
          {!canBalances ? (
            <PermissionNotice message="لا تملك صلاحية عرض الأرصدة (balances.read)" />
          ) : (
            <Card>
              <div className="flex items-center gap-3 border-b border-concrete-100 px-4 py-3 dark:border-white/10">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-concrete-500">العملة</span>
                  <Select
                    value={stmtCurrency}
                    onChange={e => { setStmtCurrency(e.target.value); setStmtPage(1); }}
                  >
                    {Object.entries(CCY_AR).map(([code, name]) => (
                      <option key={code} value={code}>{name} ({code})</option>
                    ))}
                  </Select>
                </label>
                <Button
                  variant="secondary"
                  onClick={exportCsv}
                  className="mr-auto"
                  disabled={!statement.data?.items?.length && !c?.balances?.length}
                >
                  <Download className="h-4 w-4" /> تصدير CSV
                </Button>
              </div>

              <DataState
                isLoading={statement.isLoading}
                isError={statement.isError}
                error={statement.error}
                onRetry={() => statement.refetch()}
                isFetching={statement.isFetching}
                isEmpty={!statement.data?.items?.length}
                emptyTitle="لا توجد حركات"
                emptyHint={`لا توجد حركات بهذه العملة${stmtCurrency ? ` (${CCY_AR[stmtCurrency] ?? stmtCurrency})` : ''}`}
                skeletonClassName="h-64"
              >
                {statement.data && (
                  <>
                    {/* Summary */}
                    <div className="flex flex-wrap gap-4 border-b border-concrete-100 px-4 py-2 text-xs dark:border-white/10">
                      <span className="text-concrete-500">الرصيد الافتتاحي: <Money value={statement.data.openingBalance} signed /></span>
                      <span className="text-concrete-500">رصيد بداية الفترة: <Money value={statement.data.periodStartBalance} signed /></span>
                      <span className="font-semibold text-iron-900 dark:text-concrete-100">
                        الرصيد الحالي: <Money value={statement.data.currentBalance} currency={stmtCurrency} signed />
                      </span>
                      <span className="text-concrete-500 ml-auto">{statement.data.total} حركة</span>
                    </div>

                    <Table>
                      <THead cols={['التاريخ', 'نوع المستند', 'الرقم', 'البيان', 'المرجع', 'مدين', 'دائن', 'الرصيد']} />
                      <tbody>
                        {statement.data.items.map((r, i) => (
                          <TRow key={i}>
                            <TD>{fmtDate(r.date)}</TD>
                            <TD>{r.documentType}</TD>
                            <TD className="font-mono text-xs"><span dir="ltr">{r.documentNumber}</span></TD>
                            <TD className="max-w-[200px] truncate text-xs">{r.description}</TD>
                            <TD className="font-mono text-xs"><span dir="ltr">{r.reference}</span></TD>
                            <TD>{r.debit ? <Money value={r.debit} /> : '—'}</TD>
                            <TD>{r.credit ? <Money value={r.credit} /> : '—'}</TD>
                            <TD className="font-semibold"><Money value={r.runningBalance} signed /></TD>
                          </TRow>
                        ))}
                      </tbody>
                    </Table>
                    <Pagination page={statement.data.page} totalPages={statement.data.totalPages} onPage={setStmtPage} />
                  </>
                )}
              </DataState>
            </Card>
          )}
        </TabsPanel>

        {/* ──────────────── Timeline Tab ──────────────── */}
        <TabsPanel value="timeline">
          <Card>
            <DataState
              isLoading={timeline.isLoading}
              isError={timeline.isError}
              error={timeline.error}
              onRetry={() => timeline.refetch()}
              isFetching={timeline.isFetching}
              isEmpty={!timeline.data?.items?.length}
              emptyTitle="لا توجد أحداث"
              skeletonClassName="h-64"
            >
              {timeline.data && (
                <>
                  <div className="space-y-3 px-4 py-3">
                    {timeline.data.items.map((ev, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center pt-1">
                          <span className={`inline-block h-3 w-3 rounded-full ${timelineColor(ev.type)}`} />
                          {i < timeline.data!.items.length - 1 && <span className="mt-1 h-full w-px bg-concrete-200 dark:bg-white/10" />}
                        </div>
                        <div className="flex-1 pb-3">
                          <div className="flex items-center gap-2">
                            <Badge className={timelineColor(ev.type)}>
                              {ev.type.replace(/_/g, ' ')}
                            </Badge>
                            <span className="text-xs text-concrete-400">{fmtDateTime(ev.at)}</span>
                          </div>
                          <p className="mt-1 text-sm text-iron-800 dark:text-concrete-100">{ev.title}</p>
                          {ev.details && (
                            <pre className="mt-1 max-h-32 overflow-auto rounded bg-concrete-50 p-2 text-[10px] text-concrete-600 dark:bg-white/5 dark:text-concrete-400">
                              {JSON.stringify(ev.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Pagination page={timeline.data.page} totalPages={timeline.data.totalPages} onPage={setTlPage} />
                </>
              )}
            </DataState>
          </Card>
        </TabsPanel>

        {/* ──────────────── Follow-ups Tab ──────────────── */}
        <TabsPanel value="followups">
          <Card>
            <DataState
              isLoading={followups.isLoading}
              isError={followups.isError}
              error={followups.error}
              onRetry={() => followups.refetch()}
              isFetching={followups.isFetching}
              isEmpty={!followups.data?.items?.length}
              emptyTitle="لا توجد متابعات"
              skeletonClassName="h-64"
            >
              {followups.data && (
                <>
                  <Table>
                    <THead cols={['التاريخ', 'النوع', 'النتيجة', 'المحصل', 'الملاحظات', 'التاريخ التالي']} />
                    <tbody>
                      {followups.data.items.map(f => (
                        <TRow key={f.id}>
                          <TD>{fmtDateTime(f.followupAt)}</TD>
                          <TD>{f.type?.name ?? '—'}</TD>
                          <TD><Badge tone="pine">{f.result?.name ?? '—'}</Badge></TD>
                          <TD>{f.user.fullName}</TD>
                          <TD className="max-w-[200px] truncate text-xs">{f.notes ?? '—'}</TD>
                          <TD>{f.nextFollowupDate ? fmtDate(f.nextFollowupDate) : '—'}</TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                  <Pagination page={followups.data.page} totalPages={followups.data.totalPages} onPage={setFuPage} />
                </>
              )}
            </DataState>
          </Card>
        </TabsPanel>

        {/* ──────────────── Promises Tab ──────────────── */}
        <TabsPanel value="promises">
          <Card>
            <DataState
              isLoading={promises.isLoading}
              isError={promises.isError}
              error={promises.error}
              onRetry={() => promises.refetch()}
              isFetching={promises.isFetching}
              isEmpty={!promises.data?.items?.length}
              emptyTitle="لا توجد وعود سداد"
              skeletonClassName="h-64"
            >
              {promises.data && (
                <>
                  <Table>
                    <THead cols={['تاريخ الوعد', 'الاستحقاق', 'المبلغ', 'العملة', 'الحالة', 'المحصل', 'ملاحظات']} />
                    <tbody>
                      {promises.data.items.map(p => (
                        <TRow key={p.id}>
                          <TD>{fmtDate(p.promiseDate)}</TD>
                          <TD>{fmtDate(p.dueDate)}</TD>
                          <TD><Money value={p.expectedAmount} /></TD>
                          <TD>{CCY_AR[p.currencyCode] ?? p.currencyCode}</TD>
                          <TD>
                            <Badge tone={promiseStatusBadge(p.status) as any}>
                              {PROMISE_STATUS_AR[p.status] ?? p.status}
                            </Badge>
                          </TD>
                          <TD>{p.collector?.user?.fullName ?? '—'}</TD>
                          <TD className="max-w-[200px] truncate text-xs">{p.notes ?? '—'}</TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                  <Pagination page={promises.data.page} totalPages={promises.data.totalPages} onPage={setPrPage} />
                </>
              )}
            </DataState>
          </Card>
        </TabsPanel>

        {/* ──────────────── Collections Tab ──────────────── */}
        <TabsPanel value="collections">
          <Card>
            <DataState
              isLoading={collections.isLoading}
              isError={collections.isError}
              error={collections.error}
              onRetry={() => collections.refetch()}
              isFetching={collections.isFetching}
              isEmpty={!collections.data?.items?.length}
              emptyTitle="لا توجد تحصيلات"
              skeletonClassName="h-64"
            >
              {collections.data && (
                <>
                  {collections.data.totalsByCurrency && Object.keys(collections.data.totalsByCurrency).length > 0 && (
                    <div className="flex flex-wrap gap-4 border-b border-concrete-100 px-4 py-2 text-xs dark:border-white/10">
                      {Object.entries(collections.data.totalsByCurrency).map(([ccy, total]) => (
                        <span key={ccy} className="text-concrete-500">
                          {CCY_AR[ccy] ?? ccy}: <Money value={total} currency={ccy} />
                        </span>
                      ))}
                    </div>
                  )}
                  <Table>
                    <THead cols={['التاريخ', 'المبلغ', 'العملة', 'الطريقة', 'الحالة', 'المحصل', 'المرجع', 'ملاحظات']} />
                    <tbody>
                      {collections.data.items.map(co => (
                        <TRow key={co.id}>
                          <TD>{fmtDateTime(co.collectedAt)}</TD>
                          <TD className="font-semibold"><Money value={co.amount} /></TD>
                          <TD>{CCY_AR[co.currencyCode] ?? co.currencyCode}</TD>
                          <TD>{co.method?.name ?? '—'}</TD>
                          <TD>
                            <Badge tone={collectionStatusBadge(co.status) as any}>
                              {COLLECTION_STATUS_AR[co.status] ?? co.status}
                            </Badge>
                          </TD>
                          <TD>{co.collector?.user?.fullName ?? '—'}</TD>
                          <TD className="font-mono text-xs"><span dir="ltr">{co.receiptNumber ?? co.referenceNumber ?? '—'}</span></TD>
                          <TD className="max-w-[200px] truncate text-xs">{co.notes ?? '—'}</TD>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                  <Pagination page={collections.data.page} totalPages={collections.data.totalPages} onPage={setCoPage} />
                </>
              )}
            </DataState>
          </Card>
        </TabsPanel>
      </Tabs>
    </div>
  );
}

/* ──────────────────────────── Small Helpers ────────────────────────────── */

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-concrete-100 bg-white p-4 dark:border-white/10 dark:bg-iron-900">
      <p className="text-xs text-concrete-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-iron-900 dark:text-concrete-100">{value}</div>
    </div>
  );
}

function DetailRow({ label, value, dir }: { label: string; value?: string | null; dir?: 'ltr' | 'rtl' }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-concrete-500">{label}</dt>
      <dd className="font-medium text-iron-800 dark:text-concrete-100" dir={dir}>{value}</dd>
    </div>
  );
}

function CountBadge({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-lg border border-concrete-100 p-3 text-center dark:border-white/10">
      <p className="text-lg font-bold text-iron-900 dark:text-concrete-100">{count}</p>
      <p className="text-[10px] text-concrete-500">{label}</p>
    </div>
  );
}
