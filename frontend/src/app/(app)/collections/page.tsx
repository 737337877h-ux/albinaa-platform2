'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Download, Plus, RotateCcw, HandCoins } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, CCY_AR, COLLECTION_STATUS_AR } from '@/lib/format';
import { PageHeader } from '@/components/app-shell';
import { DataState, PermissionNotice } from '@/components/ui/data-state';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Badge, Button, Card, Field, Input, Pagination, Select, Textarea } from '@/components/ui/primitives';
import { Table, TRow, TD } from '@/components/ui/table';

/* ────────────────────────────── Types ────────────────────────────────── */

interface CollectionCustomer {
  id: string;
  name: string;
  externalCustomerCode: string | null;
}

interface CollectionCollector {
  user: { fullName: string };
}

interface CollectionMethod {
  name: string;
}

interface CollectionBranch {
  name: string;
}

interface CollectionItem {
  id: string;
  customerId: string;
  currencyCode: string;
  amount: number;
  collectedAt: string;
  status: string;
  receiptNumber: string | null;
  referenceNumber: string | null;
  notes: string | null;
  customer: CollectionCustomer;
  collector: CollectionCollector;
  method: CollectionMethod;
  branch: CollectionBranch;
}

interface CollectionsResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  totalsByCurrency: Record<string, number>;
  items: CollectionItem[];
}

interface NameId {
  id: string;
  name: string;
}

interface CollectorOption {
  id: string;
  user: { fullName: string };
}

interface CustomerSearchItem {
  id: string;
  name: string;
  externalCustomerCode: string | null;
}

/* ────────────────────────────── Helpers ──────────────────────────────── */

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/* ────────────────────────────── Validation ────────────────────────────── */

const createSchema = z.object({
  customerId: z.string().uuid('اختر عميلًا'),
  currencyCode: z.string().min(1, 'العملة مطلوبة'),
  amount: z.string().min(1, 'المبلغ مطلوب').refine((v) => Number(v) > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
  methodId: z.string().uuid('اختر طريقة التحصيل'),
  branchId: z.string().uuid('اختر الفرع').optional(),
  collectedAt: z.string().optional(),
  referenceNumber: z.string().optional(),
  notes: z.string().max(2000, 'الملاحظات لا تتجاوز 2000 حرف').optional(),
});

type CreateForm = z.infer<typeof createSchema>;

const reverseSchema = z.object({
  reason: z.string().min(3, 'السبب مطلوب (3 أحرف على الأقل)'),
});

type ReverseForm = z.infer<typeof reverseSchema>;

/* ────────────────────────────── Status Helpers ───────────────────────── */

function statusBadgeTone(status: string): string {
  switch (status) {
    case 'approved':
    case 'matched':
      return 'pine';
    case 'recorded':
      return 'neutral';
    case 'handed_to_cashier':
      return 'credit';
    case 'reversed':
      return 'debt';
    default:
      return 'neutral';
  }
}

/* ────────────────────────────── Main Page ────────────────────────────── */

export default function CollectionsPage() {
  const can = useCan();
  const canRead = can('customers.read');
  const canCreate = can('collections.create');
  const canReverse = can('collections.reverse');
  const canHandover = can('cash.receive');
  const canExport = can('reports.export');
  const canListCollectors = can('users.manage');
  const qc = useQueryClient();

  /* ──── Filter State ──── */
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [collectorFilter, setCollectorFilter] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  /* ──── Dialog State ──── */
  const [createOpen, setCreateOpen] = useState(false);
  const [reverseItem, setReverseItem] = useState<CollectionItem | null>(null);
  const [handoverItem, setHandoverItem] = useState<CollectionItem | null>(null);

  /* ──── Queries ──── */
  const query = useQuery<CollectionsResponse>({
    queryKey: ['collections', debouncedSearch, fromDate, toDate, statusFilter, currencyFilter, branchFilter, collectorFilter, page],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('page', String(page));
      p.set('limit', '25');
      if (fromDate) p.set('fromDate', fromDate);
      if (toDate) p.set('toDate', toDate);
      if (statusFilter) p.set('status', statusFilter);
      if (currencyFilter) p.set('currency', currencyFilter);
      if (branchFilter) p.set('branchId', branchFilter);
      if (collectorFilter) p.set('collectorId', collectorFilter);
      return api<CollectionsResponse>(`/collections?${p.toString()}`);
    },
    enabled: canRead,
  });

  const methodsQuery = useQuery<NameId[]>({
    queryKey: ['collection-methods'],
    queryFn: () => api<NameId[]>('/collections/methods'),
    enabled: canRead,
  });

  const branchesQuery = useQuery<NameId[]>({
    queryKey: ['branches'],
    queryFn: () => api<NameId[]>('/branches'),
    enabled: canRead,
  });

  const collectorsQuery = useQuery<CollectorOption[]>({
    queryKey: ['collectors', 'collection-report-options'],
    queryFn: () => api<CollectorOption[]>('/collectors'),
    enabled: canRead && canListCollectors,
  });

  function reportParams(pageNumber: number) {
    const p = new URLSearchParams({ page: String(pageNumber), limit: '100' });
    if (fromDate) p.set('fromDate', fromDate);
    if (toDate) p.set('toDate', toDate);
    if (statusFilter) p.set('status', statusFilter);
    if (currencyFilter) p.set('currency', currencyFilter);
    if (branchFilter) p.set('branchId', branchFilter);
    if (collectorFilter) p.set('collectorId', collectorFilter);
    return p;
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const first = await api<CollectionsResponse>(`/collections?${reportParams(1).toString()}`);
      const rows = [...first.items];
      const pages = Math.min(first.totalPages, 100);
      for (let current = 2; current <= pages; current += 1) {
        const result = await api<CollectionsResponse>(`/collections?${reportParams(current).toString()}`);
        rows.push(...result.items);
      }
      const needle = debouncedSearch.trim().toLowerCase();
      const exported = needle
        ? rows.filter((row) => [row.customer.name, row.customer.externalCustomerCode, row.receiptNumber, row.referenceNumber]
          .some((value) => value?.toLowerCase().includes(needle)))
        : rows;
      const header = ['التاريخ', 'العميل', 'كود العميل', 'المبلغ', 'العملة', 'الطريقة', 'الفرع', 'المحصل', 'الحالة', 'المرجع', 'ملاحظات'];
      const lines = exported.map((row) => [
        row.collectedAt, row.customer.name, row.customer.externalCustomerCode, row.amount,
        row.currencyCode, row.method?.name, row.branch?.name, row.collector?.user?.fullName,
        COLLECTION_STATUS_AR[row.status] ?? row.status, row.receiptNumber ?? row.referenceNumber, row.notes,
      ].map(csvCell).join(','));
      const blob = new Blob([`\uFEFF${header.map(csvCell).join(',')}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `collections-report-${fromDate || 'all'}-${toDate || 'all'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast(`تم تصدير ${exported.length} عملية تحصيل`, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذر تصدير التقرير', 'err');
    } finally {
      setExporting(false);
    }
  }

  /* ──── Client-side search ──── */
  const items = query.data?.items ?? [];
  const filtered = debouncedSearch
    ? items.filter((c) => {
        const s = debouncedSearch.toLowerCase();
        return (
          (c.customer?.name ?? '').toLowerCase().includes(s) ||
          c.customer?.externalCustomerCode?.toLowerCase().includes(s) ||
          c.referenceNumber?.toLowerCase().includes(s) ||
          c.receiptNumber?.toLowerCase().includes(s) ||
          c.notes?.toLowerCase().includes(s)
        );
      })
    : items;

  /* ──── Create Mutation ──── */
  const createMut = useMutation({
    mutationFn: (data: CreateForm) => {
      const body: Record<string, unknown> = {
        customerId: data.customerId,
        currencyCode: data.currencyCode,
        amount: Number(data.amount),
        methodId: data.methodId,
      };
      if (data.branchId) body.branchId = data.branchId;
      if (data.collectedAt) body.collectedAt = data.collectedAt;
      if (data.referenceNumber) body.referenceNumber = data.referenceNumber;
      if (data.notes) body.notes = data.notes;
      return api<CollectionItem>('/collections', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast('تم تسجيل التحصيل بنجاح', 'ok');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Reverse Mutation ──── */
  const reverseMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/collections/${id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      toast('تم عكس التحصيل بنجاح', 'ok');
      setReverseItem(null);
      qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Handover Mutation ──── */
  const handoverMut = useMutation({
    mutationFn: ({ id, receiptNumber }: { id: string; receiptNumber?: string }) =>
      api(`/collections/${id}/handover`, {
        method: 'POST',
        body: JSON.stringify(receiptNumber ? { receiptNumber } : {}),
      }),
    onSuccess: () => {
      toast('تم التسليم للصندوق بنجاح', 'ok');
      setHandoverItem(null);
      qc.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err: Error) => toast(err.message, 'err'),
  });

  /* ──── Permission Gate ──── */
  if (!canRead) {
    return (
      <Card>
        <PermissionNotice message="لا تملك صلاحية عرض التحصيلات (customers.read)" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="التحصيلات"
        action={(
          <div className="flex flex-wrap gap-2">
            {canExport && (
              <Button variant="secondary" loading={exporting} onClick={exportCsv}>
                <Download className="h-4 w-4" aria-hidden /> تصدير CSV/Excel
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                تحصيل جديد
              </Button>
            )}
          </div>
        )}
      />

      {/* ──── إجمالي العملات ──── */}
      {query.data && query.data.totalsByCurrency && Object.keys(query.data.totalsByCurrency).length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center gap-4 px-4 py-3">
            <span className="text-xs font-medium text-concrete-500">إجمالي التحصيلات:</span>
            {Object.entries(query.data.totalsByCurrency).map(([ccy, total]) => (
              <Badge key={ccy} tone="pine">
                {CCY_AR[ccy] ?? ccy}: {fmtMoney(total)}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Card>
        {/* ──── شريط الفلاتر ──── */}
        <div className="border-b border-concrete-100 px-4 py-3 dark:border-white/10">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالعميل، الكود، أو المرجع…"
              aria-label="بحث في التحصيلات"
            />
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">الحالة</span>
              <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">الكل</option>
                <option value="recorded">مسجلة</option>
                <option value="handed_to_cashier">مسلمة للصندوق</option>
                <option value="matched">مطابقة</option>
                <option value="approved">معتمدة</option>
                <option value="reversed">معكوسة</option>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">العملة</span>
              <Select value={currencyFilter} onChange={(e) => { setCurrencyFilter(e.target.value); setPage(1); }}>
                <option value="">الكل</option>
                {Object.entries(CCY_AR).map(([code, name]) => (
                  <option key={code} value={code}>{name} ({code})</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">من تاريخ</span>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">إلى تاريخ</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-concrete-500">الفرع</span>
              <Select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}>
                <option value="">كل الفروع</option>
                {(branchesQuery.data ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </Select>
            </label>
            {canListCollectors && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-concrete-500">المحصل</span>
                <Select value={collectorFilter} onChange={(e) => { setCollectorFilter(e.target.value); setPage(1); }}>
                  <option value="">كل المحصلين</option>
                  {(collectorsQuery.data ?? []).map((collector) => <option key={collector.id} value={collector.id}>{collector.user.fullName}</option>)}
                </Select>
              </label>
            )}
          </div>
        </div>

        {/* ──── الجدول ──── */}
        <DataState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
          isFetching={query.isFetching}
          isEmpty={!filtered.length}
          emptyTitle="لا توجد تحصيلات"
          emptyHint={debouncedSearch || fromDate || toDate || statusFilter || currencyFilter ? 'جرّب تغيير معايير البحث أو الفلاتر' : undefined}
          skeletonClassName="h-64"
        >
          <>
            <Table>
              <thead>
                <tr className="border-b border-concrete-100 text-right text-xs text-concrete-500 dark:border-white/10 dark:text-concrete-400">
                  <th className="px-4 py-2.5 font-medium">التاريخ</th>
                  <th className="px-4 py-2.5 font-medium">العميل</th>
                  <th className="px-4 py-2.5 font-medium">المبلغ</th>
                  <th className="px-4 py-2.5 font-medium">العملة</th>
                  <th className="px-4 py-2.5 font-medium">الطريقة</th>
                  <th className="px-4 py-2.5 font-medium">الفرع</th>
                  <th className="px-4 py-2.5 font-medium">الحالة</th>
                  <th className="px-4 py-2.5 font-medium">المحصل</th>
                  <th className="px-4 py-2.5 font-medium">المرجع</th>
                  <th className="px-4 py-2.5 font-medium">ملاحظات</th>
                  <th className="px-4 py-2.5 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <TRow key={c.id}>
                    <TD className="text-xs whitespace-nowrap">{fmtDateTime(c.collectedAt)}</TD>
                    <TD>
                      {c.customer?.id ? (
                        <Link
                          href={`/customers/${c.customer.id}`}
                          className="font-medium text-pine-700 hover:underline dark:text-pine-100"
                        >
                          {c.customer.name ?? '—'}
                        </Link>
                      ) : (
                        <span>{c.customer?.name ?? '—'}</span>
                      )}
                      {c.customer?.externalCustomerCode && (
                        <p className="text-xs text-concrete-500" dir="ltr">{c.customer.externalCustomerCode}</p>
                      )}
                    </TD>
                    <TD className="text-sm font-medium">{fmtMoney(c.amount)}</TD>
                    <TD>
                      <Badge tone="pine">{CCY_AR[c.currencyCode] ?? c.currencyCode}</Badge>
                    </TD>
                    <TD className="text-sm">{c.method?.name ?? '—'}</TD>
                    <TD className="text-sm">{c.branch?.name ?? '—'}</TD>
                    <TD>
                      <Badge tone={statusBadgeTone(c.status) as 'pine' | 'neutral' | 'credit' | 'debt'}>
                        {COLLECTION_STATUS_AR[c.status] ?? c.status}
                      </Badge>
                    </TD>
                    <TD className="text-sm">{c.collector?.user?.fullName ?? '—'}</TD>
                    <TD className="text-xs">
                      {c.receiptNumber && <span dir="ltr" className="block">إيصال: {c.receiptNumber}</span>}
                      {c.referenceNumber && <span dir="ltr" className="block">مرجع: {c.referenceNumber}</span>}
                      {!c.receiptNumber && !c.referenceNumber && '—'}
                    </TD>
                    <TD className="max-w-[140px] truncate text-xs text-concrete-600 dark:text-concrete-400">
                      {c.notes ?? '—'}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        {c.status === 'recorded' && canHandover && (
                          <button
                            onClick={() => setHandoverItem(c)}
                            className="rounded p-1.5 text-concrete-400 hover:bg-credit-50 hover:text-credit-600 dark:hover:bg-credit-700/20 dark:hover:text-credit-400"
                            aria-label="تسليم للصندوق"
                          >
                            <HandCoins className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {c.status !== 'reversed' && canReverse && (
                          <button
                            onClick={() => setReverseItem(c)}
                            className="rounded p-1.5 text-concrete-400 hover:bg-debt-50 hover:text-debt-600 dark:hover:bg-debt-700/20 dark:hover:text-debt-400"
                            aria-label="عكس التحصيل"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
            <Pagination page={query.data?.page ?? 1} totalPages={query.data?.totalPages ?? 1} onPage={setPage} />
          </>
        </DataState>
      </Card>

      {/* ──── إجمالي النتائج ──── */}
      {query.data && (
        <p className="text-center text-xs text-concrete-400">
          إجمالي النتائج: {query.data.total} تحصيل — الصفحة {query.data.page} من {query.data.totalPages}
        </p>
      )}

      {/* ──── إنشاء تحصيل ──── */}
      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        methods={methodsQuery.data ?? []}
        branches={branchesQuery.data ?? []}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      {/* ──── عكس تحصيل ──── */}
      <ReverseDialog
        item={reverseItem}
        onClose={() => setReverseItem(null)}
        onSubmit={(reason) => {
          if (reverseItem) reverseMut.mutate({ id: reverseItem.id, reason });
        }}
        loading={reverseMut.isPending}
      />

      {/* ──── تسليم للصندوق ──── */}
      <HandoverDialog
        item={handoverItem}
        onClose={() => setHandoverItem(null)}
        onSubmit={(receiptNumber) => {
          if (handoverItem) handoverMut.mutate({ id: handoverItem.id, receiptNumber: receiptNumber || undefined });
        }}
        loading={handoverMut.isPending}
      />
    </div>
  );
}

/* ────────────────────────────── Create Dialog ────────────────────────── */

function CreateDialog({
  open, onClose, methods, branches, onSubmit, loading,
}: {
  open: boolean;
  onClose: () => void;
  methods: NameId[];
  branches: NameId[];
  onSubmit: (data: CreateForm) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { collectedAt: new Date().toISOString().slice(0, 16) },
  });

  const [custSearch, setCustSearch] = useState('');
  const [custResults, setCustResults] = useState<CustomerSearchItem[]>([]);
  const [selectedCust, setSelectedCust] = useState<CustomerSearchItem | null>(null);
  const [custSearching, setCustSearching] = useState(false);
  const debouncedCust = useDebounced(custSearch, 300);

  useEffect(() => {
    if (!open) {
      reset();
      setCustSearch('');
      setCustResults([]);
      setSelectedCust(null);
    }
  }, [open, reset]);

  useEffect(() => {
    if (!debouncedCust || debouncedCust.length < 2) {
      setCustResults([]);
      return;
    }
    let cancelled = false;
    setCustSearching(true);
    api<{ items: CustomerSearchItem[] }>(`/customers?search=${encodeURIComponent(debouncedCust)}&limit=10`)
      .then((res) => { if (!cancelled) setCustResults(res.items); })
      .catch(() => { if (!cancelled) setCustResults([]); })
      .finally(() => { if (!cancelled) setCustSearching(false); });
    return () => { cancelled = true; };
  }, [debouncedCust]);

  const selectCustomer = (c: CustomerSearchItem) => {
    setSelectedCust(c);
    setValue('customerId', c.id, { shouldValidate: true });
    setCustSearch('');
    setCustResults([]);
  };

  return (
    <Dialog open={open} onClose={onClose} title="تسجيل تحصيل جديد">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* اختيار العميل */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-concrete-700 dark:text-concrete-200">العميل *</label>
          {selectedCust ? (
            <div className="flex items-center justify-between rounded-lg border border-concrete-200 bg-concrete-50 px-3 py-2 dark:border-white/10 dark:bg-iron-700">
              <div>
                <span className="text-sm font-medium">{selectedCust.name}</span>
                {selectedCust.externalCustomerCode && (
                  <span className="mr-2 text-xs text-concrete-500" dir="ltr">{selectedCust.externalCustomerCode}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setSelectedCust(null); setValue('customerId', ''); }}
                className="text-xs text-debt-600 hover:underline"
              >
                تغيير
              </button>
            </div>
          ) : (
            <>
              <Input
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
                placeholder="ابحث عن العميل بالاسم أو الكود…"
              />
              {custSearching && <p className="text-xs text-concrete-400">جارٍ البحث…</p>}
              {custResults.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-concrete-200 bg-white dark:border-white/10 dark:bg-iron-800">
                  {custResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full px-3 py-2 text-right text-sm hover:bg-pine-50 dark:hover:bg-white/5"
                    >
                      <span className="font-medium">{c.name}</span>
                      {c.externalCustomerCode && (
                        <span className="mr-2 text-xs text-concrete-500" dir="ltr">{c.externalCustomerCode}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <input type="hidden" {...register('customerId')} />
          {errors.customerId && (
            <p className="text-xs text-debt-600 dark:text-debt-500">{errors.customerId.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="المبلغ *" error={errors.amount?.message}>
            <Input type="number" step="0.01" min="0" placeholder="0.00" {...register('amount')} />
          </Field>
          <Field label="العملة *" error={errors.currencyCode?.message}>
            <Select {...register('currencyCode')}>
              <option value="">اختر العملة…</option>
              {Object.entries(CCY_AR).map(([code, name]) => (
                <option key={code} value={code}>{name} ({code})</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="طريقة التحصيل *" error={errors.methodId?.message}>
            <Select {...register('methodId')}>
              <option value="">اختر الطريقة…</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="الفرع" error={errors.branchId?.message}>
            <Select {...register('branchId')}>
              <option value="">اختر الفرع…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="تاريخ التحصيل" error={errors.collectedAt?.message}>
          <Input type="datetime-local" {...register('collectedAt')} />
        </Field>

        <Field label="رقم المرجع" error={errors.referenceNumber?.message}>
          <Input placeholder="أدخل رقم المرجع…" {...register('referenceNumber')} />
        </Field>

        <Field label="ملاحظات" error={errors.notes?.message}>
          <Textarea rows={3} placeholder="أضف ملاحظات…" {...register('notes')} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={loading}>
            <Plus className="h-4 w-4" aria-hidden />
            تسجيل التحصيل
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Reverse Dialog ───────────────────────── */

function ReverseDialog({
  item, onClose, onSubmit, loading,
}: {
  item: CollectionItem | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ReverseForm>({
    resolver: zodResolver(reverseSchema),
  });

  useEffect(() => {
    if (!item) reset();
  }, [item, reset]);

  return (
    <Dialog open={!!item} onClose={onClose} title="عكس التحصيل">
      <form onSubmit={handleSubmit((data) => onSubmit(data.reason))} className="space-y-4">
        {item && (
          <div className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-sm dark:border-white/10 dark:bg-iron-700">
            <p><span className="font-medium">العميل:</span> {item.customer?.name ?? '—'}</p>
            <p><span className="font-medium">المبلغ:</span> {fmtMoney(item.amount)}</p>
            <p><span className="font-medium">التاريخ:</span> {fmtDateTime(item.collectedAt)}</p>
          </div>
        )}

        <Field label="سبب العكس *" error={errors.reason?.message}>
          <Textarea
            rows={3}
            placeholder="أدخل سبب عكس التحصيل…"
            {...register('reason')}
          />
        </Field>

        <p className="text-xs text-concrete-500">
          سيتم عكس التحصيل وإنشاء سجل عكس مرتبط بالسجل الأصلي.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>إلغاء</Button>
          <Button variant="danger" type="submit" loading={loading}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            عكس التحصيل
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ────────────────────────────── Handover Dialog ──────────────────────── */

function HandoverDialog({
  item, onClose, onSubmit, loading,
}: {
  item: CollectionItem | null;
  onClose: () => void;
  onSubmit: (receiptNumber: string) => void;
  loading: boolean;
}) {
  const [receiptNumber, setReceiptNumber] = useState('');

  useEffect(() => {
    if (!item) setReceiptNumber('');
  }, [item]);

  return (
    <Dialog open={!!item} onClose={onClose} title="تسليم التحصيل للصندوق">
      <div className="space-y-4">
        {item && (
          <div className="rounded-lg border border-concrete-100 bg-concrete-50 p-3 text-sm dark:border-white/10 dark:bg-iron-700">
            <p><span className="font-medium">العميل:</span> {item.customer?.name ?? '—'}</p>
            <p><span className="font-medium">المبلغ:</span> {fmtMoney(item.amount)}</p>
            <p><span className="font-medium">التاريخ:</span> {fmtDateTime(item.collectedAt)}</p>
          </div>
        )}

        <Field label="رقم الإيصال" error={undefined}>
          <Input
            value={receiptNumber}
            onChange={(e) => setReceiptNumber(e.target.value)}
            placeholder="أدخل رقم الإيصال (اختياري)…"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button onClick={() => onSubmit(receiptNumber)} loading={loading}>
            <HandCoins className="h-4 w-4" aria-hidden />
            تسليم للصندوق
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
